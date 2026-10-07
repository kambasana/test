// One agent run = one adapter process = one ACP session (SPEC §5).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import { AcpConnection } from './acp.mjs';
import { containedPath, isContained, PathError } from './paths.mjs';
import { decidePermission, permissionResponse, toolNameOf, pathsOf, MAX_FILE_BYTES, MAX_FILES_PER_JOB, SHELL_TOOLS } from './policy.mjs';
import { PRODUCT_NAME, VERSION, oneLine } from './util.mjs';

/** Tools that must never be available to an agent, whatever the step. */
export const ALWAYS_DISALLOWED = [
  'Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Monitor', 'Glob', 'Grep', 'LS', 'NotebookEdit', 'NotebookRead',
  'Task', 'Agent', 'TaskStop', 'WebFetch', 'TodoWrite', 'Skill', 'SlashCommand', 'AskUserQuestion',
  'ExitPlanMode', 'EnterPlanMode', 'EnterWorktree', 'ExitWorktree', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
];

/** The built-in tools a step may use. */
export function toolsForRole(role, webSearch) {
  if (role === 'route' || role === 'plan') return [];
  if (role === 'combine') return ['Read', 'Write', 'Edit'];
  return webSearch ? ['Read', 'Write', 'Edit', 'WebSearch'] : ['Read', 'Write', 'Edit'];
}

export function sessionOptions(role, { webSearch = false, model = null } = {}) {
  const tools = toolsForRole(role, webSearch);
  const disallowedTools = [...ALWAYS_DISALLOWED];
  for (const t of ['Read', 'Write', 'Edit', 'MultiEdit', 'WebSearch']) if (!tools.includes(t)) disallowedTools.push(t);
  return {
    tools,
    // Nothing is pre-approved: every write, and every read outside the session folder, must pass
    // the office's own policy through session/request_permission.
    allowedTools: [],
    disallowedTools,
    // Do not load user/project settings, hooks, MCP servers or CLAUDE.md files.
    settingSources: [],
    allowDangerouslySkipPermissions: false,
    ...(model ? { model } : {}),
  };
}

/** A tool list is acceptable only if it is a subset of what the step asked for. */
export function unexpectedTools(seen, allowed) {
  return (seen || []).filter((t) => !allowed.includes(t));
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      const st = statSync(f);
      if (st.isDirectory()) walk(f); else n++;
    }
  };
  walk(dir);
  return n;
}

/**
 * Run one ACP session to completion.
 * @param {object} o
 * @param {'route'|'plan'|'piece'|'combine'} o.role
 * @param {{id:string,name:string,dept:string}} o.agent
 * @param {string} o.jobId
 * @param {string} o.workspace  work/<job-id>
 * @param {string} o.systemPrompt
 * @param {string} o.prompt
 * @param {object} o.settings   office settings (tools.webSearch, timeoutSec, model)
 * @param {import('./audit.mjs').Audit} o.audit
 * @param {(a:{kind:string,text:string,data?:object})=>void} o.activity  live activity for this agent
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.logFile]  where to append the adapter's stderr
 * @returns {Promise<{ text: string, stopReason: string, tools: string[] }>}
 */
export async function runSession(o) {
  const { role, agent, jobId, workspace, settings, audit, activity } = o;
  const outDir = join(workspace, 'out');
  mkdirSync(outDir, { recursive: true });
  const webSearch = settings.tools?.webSearch === true;
  const options = sessionOptions(role, { webSearch, model: settings.model });
  const canWrite = role === 'piece' || role === 'combine';
  const base = { job: o.jobId, dept: agent.dept, agent: agent.id };
  const stderrTail = [];
  const toolCalls = new Map();
  let text = '';
  let sessionId = null;
  let seenTools = null;
  let violation = null;
  let lastThinking = 0;

  const logLine = (line) => {
    stderrTail.push(line);
    if (stderrTail.length > 40) stderrTail.shift();
    if (o.logFile) { try { appendFileSync(o.logFile, `${new Date().toISOString()} [${agent.id}/${role}] ${line}\n`); } catch {} }
  };

  const rel = (p) => { try { return relative(workspace, p) || '.'; } catch { return p; } };

  const onRequest = async (method, params) => {
    if (method === 'session/request_permission') {
      const tc = params.toolCall || {};
      const known = toolCalls.get(tc.toolCallId) || {};
      const merged = { ...known.raw, ...tc, name: toolNameOf(tc) || known.name, kind: tc.kind || known.kind };
      const d = decidePermission(merged, {
        workspace, outDir, canWrite, webSearch,
        fileCount: countFiles(outDir), existing: (p) => existsSync(p),
      });
      audit.write('permission', `${d.decision === 'allow' ? 'Allowed' : 'Refused'} ${d.tool || d.kind}: ${oneLine(merged.title || '', 160)} (${d.reason})`,
        { ...base, tool: d.tool, toolKind: d.kind, title: merged.title || '', decision: d.decision, rule: d.rule, path: d.paths.map(rel).join(' ') });
      activity({ kind: d.decision === 'allow' ? 'tool' : 'error', text: `${d.decision === 'allow' ? 'allowed' : 'refused'}: ${merged.title || d.tool}`, data: { tool: d.tool, decision: d.decision, reason: d.reason } });
      return permissionResponse(d.decision, params.options);
    }
    if (method === 'fs/read_text_file') {
      let full;
      try { full = containedPath(workspace, params.path); } catch (err) {
        audit.write('file.read', `Refused read of ${params.path}: ${err.message}`, { ...base, decision: 'reject', path: String(params.path) });
        throw err;
      }
      const content = readFileSync(full, 'utf8');
      let out = content;
      if (params.line || params.limit) {
        const lines = content.split('\n');
        const start = Math.max(0, (params.line || 1) - 1);
        out = lines.slice(start, params.limit ? start + params.limit : undefined).join('\n');
      }
      audit.write('file.read', `Read ${rel(full)}`, { ...base, path: rel(full), via: 'fs/read_text_file' });
      activity({ kind: 'read', text: rel(full), data: { path: rel(full) } });
      return { content: out };
    }
    if (method === 'fs/write_text_file') {
      if (!canWrite) throw new PathError('This step may not write files.');
      let full;
      try { full = containedPath(outDir, params.path); } catch (err) {
        audit.write('file.write', `Refused write to ${params.path}: ${err.message}`, { ...base, decision: 'reject', path: String(params.path) });
        throw err;
      }
      const content = String(params.content ?? '');
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new PathError('A file may be at most 512 KB.');
      if (!existsSync(full) && countFiles(outDir) >= MAX_FILES_PER_JOB) throw new PathError(`A job may write at most ${MAX_FILES_PER_JOB} files.`);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      audit.write('file.write', `Wrote ${rel(full)} (${Buffer.byteLength(content)} bytes)`, { ...base, path: rel(full), via: 'fs/write_text_file' });
      activity({ kind: 'write', text: rel(full), data: { path: rel(full) } });
      return null;
    }
    const e = new Error(`Method not supported by ${PRODUCT_NAME}: ${method}`);
    e.code = -32601;
    throw e;
  };

  const onNotification = (method, params) => {
    if (method === '_claude/sdkMessage') {
      const m = params.message;
      if (m && m.type === 'system' && m.subtype === 'init') {
        seenTools = Array.isArray(m.tools) ? m.tools : [];
        const bad = unexpectedTools(seenTools, options.tools);
        const mcp = Array.isArray(m.mcp_servers) ? m.mcp_servers.map((s) => s.name) : [];
        audit.write('session.tools', `Session tools for ${agent.name} (${role}): ${seenTools.join(', ') || 'none'}${mcp.length ? `; MCP servers: ${mcp.join(', ')}` : ''}`,
          { ...base, tools: seenTools, mcpServers: mcp, model: m.model, permissionMode: m.permissionMode, role });
        if (bad.length || mcp.length) violation = `The agent was given tools it should not have (${[...bad, ...mcp].join(', ')}); the run was stopped.`;
      }
      return;
    }
    if (method !== 'session/update') return;
    const u = params.update || {};
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content?.type === 'text') text += u.content.text;
        const now = Date.now();
        if (now - lastThinking > 4000) { lastThinking = now; activity({ kind: 'thinking', text: oneLine(text.slice(-160), 160) }); }
        break;
      }
      case 'agent_thought_chunk': {
        const now = Date.now();
        if (now - lastThinking > 4000) { lastThinking = now; activity({ kind: 'thinking', text: 'thinking…' }); }
        break;
      }
      case 'plan':
        activity({ kind: 'thinking', text: `plan: ${(u.entries || []).map((e) => e.content).join(' · ')}`.slice(0, 300) });
        break;
      case 'tool_call':
      case 'tool_call_update': {
        const prev = toolCalls.get(u.toolCallId) || { raw: {} };
        const raw = { ...prev.raw };
        for (const k of ['title', 'kind', 'rawInput', 'locations', 'name', 'status', 'content']) if (u[k] !== undefined) raw[k] = u[k];
        const name = u.name || u._meta?.claudeCode?.toolName || prev.name || '';
        const entry = { raw, name, kind: raw.kind || prev.kind, reported: prev.reported || false };
        toolCalls.set(u.toolCallId, entry);
        if (u.sessionUpdate === 'tool_call') activity({ kind: 'tool', text: `${name || raw.kind}: ${raw.title || ''}`, data: { tool: name, toolCallId: u.toolCallId, status: raw.status } });
        if (SHELL_TOOLS.has(name)) violation = `The agent tried a shell tool (${name}); the run was stopped.`;
        if (raw.status === 'completed' && !entry.reported) {
          entry.reported = true;
          const paths = pathsOf({ ...raw, name });
          const inside = paths.every((p) => isContained(workspace, p));
          if (entry.kind === 'read' || name === 'Read') {
            for (const p of paths) {
              audit.write('file.read', `Read ${rel(p)}`, { ...base, tool: name, path: rel(p), inside: isContained(workspace, p) });
              activity({ kind: 'read', text: rel(p), data: { path: rel(p) } });
            }
          } else if (entry.kind === 'edit' || ['Write', 'Edit', 'MultiEdit'].includes(name)) {
            for (const p of paths) {
              audit.write('file.write', `${name || 'Edit'} ${rel(p)}`, { ...base, tool: name, path: rel(p), inside: isContained(outDir, p) });
              activity({ kind: 'write', text: rel(p), data: { path: rel(p) } });
            }
          } else if (name === 'WebSearch') {
            activity({ kind: 'tool', text: `web search: ${oneLine(raw.rawInput?.query || raw.title, 120)}` });
          }
          if (!inside && paths.length) violation = `A tool touched a path outside the workspace (${paths.join(', ')}); the run was stopped.`;
        } else if (raw.status === 'failed' && !entry.reported) {
          entry.reported = true;
          activity({ kind: 'error', text: `${name || 'tool'} failed: ${oneLine(raw.title || '', 120)}` });
        }
        break;
      }
      default:
        break;
    }
  };

  const conn = new AcpConnection({ onRequest, onNotification, onStderr: logLine, cwd: workspace });
  const timeoutMs = (settings.timeoutSec || 600) * 1000;
  let timer;
  let stopReason = 'unknown';
  const stop = async (why) => {
    try { if (sessionId) conn.notify('session/cancel', { sessionId }); } catch {}
    await conn.kill();
    return why;
  };
  const aborted = new Promise((_, reject) => {
    timer = setTimeout(() => { stop(); reject(new Error(`The agent ran past the ${settings.timeoutSec}s time limit.`)); }, timeoutMs);
    timer.unref?.();
    if (o.signal) {
      if (o.signal.aborted) reject(new Error('cancelled'));
      o.signal.addEventListener('abort', () => { stop(); reject(new Error('cancelled')); }, { once: true });
    }
  });
  aborted.catch(() => {});
  const violationWatch = new Promise((_, reject) => {
    const iv = setInterval(() => { if (violation) { clearInterval(iv); stop(); reject(new Error(violation)); } }, 200);
    iv.unref?.();
    conn.exited.then(() => clearInterval(iv));
  });
  violationWatch.catch(() => {});

  try {
    const work = (async () => {
      await conn.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: 'elenta-office', title: PRODUCT_NAME, version: VERSION },
      });
      const s = await conn.request('session/new', {
        cwd: workspace,
        mcpServers: [],
        _meta: {
          systemPrompt: o.systemPrompt,
          claudeCode: { options, emitRawSDKMessages: [{ type: 'system', subtype: 'init' }] },
        },
      });
      sessionId = s.sessionId;
      if (s.modes && s.modes.currentModeId !== 'default') {
        await conn.request('session/set_mode', { sessionId, modeId: 'default' });
      }
      const r = await conn.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: o.prompt }] });
      stopReason = r?.stopReason || 'end_turn';
      if (violation) throw new Error(violation);
      if (seenTools === null) logLine('[office] no init message seen; tool list not verified');
      return { text: text.trim(), stopReason, tools: seenTools || [] };
    })();
    return await Promise.race([work, aborted, violationWatch]);
  } catch (err) {
    const tail = stderrTail.filter((l) => !l.startsWith('[session/')).slice(-5).join(' | ');
    if (err.message !== 'cancelled' && tail) err.message += ` (agent log: ${oneLine(tail, 400)})`;
    throw err;
  } finally {
    clearTimeout(timer);
    await conn.kill();
  }
}
