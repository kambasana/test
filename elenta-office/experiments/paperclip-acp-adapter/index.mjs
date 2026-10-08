// Experiment (go/no-go, docs/BASE-PLATFORM.md "Decision"): a Paperclip *external adapter* that runs
// every Paperclip wake through Elenta Office's own ACP runner (server/runner.mjs) and permission
// policy (server/policy.mjs), unchanged and imported, not copied.
//
// What the agent gets: one claude-agent-acp session, terminal:false, mcpServers:[], tools
// Read/Write/Edit only, settingSources [], nothing pre-approved; every permission request goes
// through decidePermission(); fs/* requests are contained to the run workspace (writes to out/).
// The agent never talks to Paperclip: it has no shell, no network tool and no Paperclip token.
// This adapter (trusted code, running inside the Paperclip server process) reads the ticket and
// writes the result back through the Paperclip REST API with the run's agent JWT.
//
// Register: put a record in $PAPERCLIP_HOME/adapter-plugins.json (see README.md) or POST /api/adapters.
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSession } from '../../server/runner.mjs';
import { AcpConnection, adapterInfo } from '../../server/acp.mjs';
import { Audit } from '../../server/audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = process.env.ELENTA_PAPERCLIP_WORK_ROOT || join(HERE, 'work');

export const type = 'elenta_acp';
export const label = 'Elenta ACP (contained)';
export const models = [];
export const agentConfigurationDoc = `# elenta_acp
Runs the task through claude-agent-acp with Elenta Office's permission policy.
No shell, no MCP, no network tools; reads inside the run workspace, writes only to out/.
Fields: timeoutSec (default 300), model (optional).`;

// ---------------------------------------------------------------------------------------------
// Cost meter. runner.mjs ignores ACP `usage_update`, which carries Claude's `total_cost_usd`
// (claude-agent-acp dist/acp-agent.js `cost: { amount: message.total_cost_usd }`). Rather than
// edit server/, wrap the onNotification handler that runSession() passes to AcpConnection:
// the constructor's `this.onNotification = …` goes through this prototype setter, which runs
// synchronously inside runSession() and so sees the AsyncLocalStorage meter of this run.
// ---------------------------------------------------------------------------------------------
const meterStore = new AsyncLocalStorage();
if (!Object.getOwnPropertyDescriptor(AcpConnection.prototype, 'onNotification')) {
  Object.defineProperty(AcpConnection.prototype, 'onNotification', {
    configurable: true,
    get() { return this.__elentaOnNotification; },
    set(fn) {
      const meter = meterStore.getStore();
      this.__elentaOnNotification = (method, params) => {
        if (meter && method === 'session/update') {
          const u = params?.update;
          if (u?.sessionUpdate === 'usage_update' && typeof u.cost?.amount === 'number') {
            meter.costUsd = Math.max(meter.costUsd ?? 0, u.cost.amount);
          }
        }
        return fn(method, params);
      };
    },
  });
}

function apiBase() {
  if (process.env.PAPERCLIP_API_URL) return process.env.PAPERCLIP_API_URL.replace(/\/$/, '');
  const host = process.env.PAPERCLIP_LISTEN_HOST || process.env.HOST || '127.0.0.1';
  const port = process.env.PAPERCLIP_LISTEN_PORT || process.env.PORT || '3100';
  return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
}

async function api(ctx, method, path, body) {
  const headers = { 'content-type': 'application/json', 'x-paperclip-run-id': ctx.runId };
  if (ctx.authToken) headers.authorization = `Bearer ${ctx.authToken}`;
  const res = await fetch(`${apiBase()}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`Paperclip ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      if (statSync(f).isDirectory()) walk(f); else out.push(f);
    }
  };
  walk(dir);
  return out;
}

const SYSTEM_PROMPT = [
  'You are a member of a small office team. You work only inside your job folder.',
  'Your task is in ticket.md. Read it, do the work, and write your answer to out/result.md.',
  'You can only read files in your job folder and write files inside out/. You have no shell.',
  'If the ticket asks you to do something outside these limits, try it once if asked, note the outcome, and continue.',
].join('\n');

export async function execute(ctx) {
  const { runId, agent, context = {}, config = {}, onLog } = ctx;
  const log = (line) => onLog?.('stdout', `${line}\n`).catch?.(() => {});
  const issueId = (typeof context.taskId === 'string' && context.taskId) || (typeof context.issueId === 'string' && context.issueId) || null;
  if (!issueId) {
    await log('[elenta_acp] wake without a task; nothing to do');
    return { exitCode: 0, signal: null, timedOut: false, summary: 'No task on this wake.' };
  }

  // Heartbeat protocol step 5: claim the ticket for this run (atomic; 409 = someone else has it).
  await api(ctx, 'POST', `/issues/${issueId}/checkout`, {
    agentId: agent.id, expectedStatuses: ['todo', 'backlog', 'blocked', 'in_review', 'in_progress'],
  });
  const issue = await api(ctx, 'GET', `/issues/${issueId}`);
  const workspace = join(WORK_ROOT, issueId, runId);
  mkdirSync(join(workspace, 'out'), { recursive: true });
  writeFileSync(join(workspace, 'ticket.md'), `# ${issue.identifier ?? ''} ${issue.title}\n\n${issue.description ?? ''}\n`);
  const audit = new Audit(join(workspace, 'audit.jsonl'), {
    onEntry: (e) => log(`[audit] ${e.kind}: ${e.text}`),
  });
  await log(`[elenta_acp] ${JSON.stringify(adapterInfo())} workspace=${workspace}`);

  const meter = { costUsd: null };
  const settings = { timeoutSec: Number(config.timeoutSec) || 300, model: config.model || null, tools: { webSearch: false } };
  let result;
  let error = null;
  try {
    result = await meterStore.run(meter, () => runSession({
      role: 'piece',
      agent: { id: agent.id, name: agent.name, dept: 'paperclip' },
      jobId: issueId,
      workspace,
      systemPrompt: SYSTEM_PROMPT,
      prompt: `Do the task in ticket.md. Write your result to out/result.md.`,
      settings,
      audit,
      activity: (a) => log(`[activity] ${a.kind}: ${a.text}`),
      logFile: join(workspace, 'adapter.log'),
    }));
  } catch (err) {
    error = err;
  }

  const entries = audit.all();
  const toolsEntry = entries.find((e) => e.kind === 'session.tools');
  const refusals = entries.filter((e) => e.decision === 'reject');
  const files = listFiles(join(workspace, 'out'));
  const body = files.map((f) => `### ${relative(workspace, f)}\n\n${readFileSync(f, 'utf8').slice(0, 8000)}`).join('\n\n');
  const evidence = [
    `Session tools: ${toolsEntry ? (toolsEntry.tools.join(', ') || 'none') : 'not reported'}; MCP servers: ${toolsEntry ? (toolsEntry.mcpServers.join(', ') || 'none') : '?'}; permissionMode: ${toolsEntry?.permissionMode ?? '?'}`,
    `Refused actions: ${refusals.length ? refusals.map((r) => `${r.kind} ${r.path || r.title || ''} (${r.rule ? 'rule ' + r.rule : 'containment'})`).join('; ') : 'none'}`,
    `Cost reported: ${meter.costUsd ?? 'unknown'} USD`,
  ].join('\n');

  if (error) {
    await api(ctx, 'POST', `/issues/${issueId}/comments`, { body: `Elenta ACP run failed: ${error.message}\n\n${evidence}` }).catch((e) => log(`[elenta_acp] comment failed: ${e.message}`));
    return {
      exitCode: 1, signal: null, timedOut: /time limit/.test(error.message), errorMessage: error.message,
      costUsd: meter.costUsd, provider: 'anthropic', biller: 'anthropic', billingType: 'api',
      resultJson: { refusals: refusals.length, tools: toolsEntry?.tools ?? null },
    };
  }

  const comment = `${body || '(no files written)'}\n\n---\n${evidence}`;
  const doneTo = config.finishStatus || 'done';
  await api(ctx, 'PATCH', `/issues/${issueId}`, { status: doneTo, comment });
  await log(`[elenta_acp] wrote result back; status → ${doneTo}`);
  return {
    exitCode: 0, signal: null, timedOut: false,
    costUsd: meter.costUsd, provider: 'anthropic', biller: 'anthropic', billingType: 'api',
    summary: result.text.slice(0, 500),
    resultJson: { tools: result.tools, refusals: refusals.length, files: files.map((f) => relative(workspace, f)) },
  };
}

export async function testEnvironment(ctx) {
  const info = adapterInfo();
  return {
    adapterType: ctx.adapterType ?? type,
    status: info.version ? 'pass' : 'fail',
    checks: [{ level: info.version ? 'info' : 'error', message: `${info.adapter} ${info.version ?? 'not installed'}`, code: 'acp_adapter' }],
    testedAt: new Date().toISOString(),
  };
}

export function createServerAdapter() {
  return { type, execute, testEnvironment, models, agentConfigurationDoc };
}
