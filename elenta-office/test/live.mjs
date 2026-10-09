#!/usr/bin/env node
// Live end-to-end run against real Claude (SPEC §9): `npm run live`.
// Starts the office on a random port with the Elenta org and isolated data folders, gives the Boss a
// request, waits for approval, checks the result and the audit trail, then approves.
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST = 'Write a one-page test plan for the data-logger software, with a requirements traceability table';
const TIMEOUT_MS = 15 * 60 * 1000;
const SHELL = new Set(['Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Monitor']);

const dir = mkdtempSync(join(tmpdir(), 'eo-live-'));
cpSync(join(ROOT, 'library'), join(dir, 'library'), { recursive: true });
const env = {
  ...process.env,
  EO_ORG: 'elenta',
  EO_PORT: '0',
  EO_DATA: join(dir, 'data'),
  EO_WORK: join(dir, 'work'),
  EO_DELIVERABLES: join(dir, 'deliverables'),
  EO_LIBRARY: join(dir, 'library'),
  EO_SETTINGS: join(dir, 'settings.local.json'),
};
const log = (...a) => console.log(`[live ${new Date().toISOString().slice(11, 19)}]`, ...a);
log(`folders: ${dir}`);

const server = spawn(process.execPath, [join(ROOT, 'server', 'main.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stderr.on('data', (d) => { serverOut += d; });
const base = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`office did not start:\n${serverOut}`)), 20000);
  server.stdout.on('data', (d) => {
    serverOut += d;
    const m = String(serverOut).match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
  server.on('exit', (c) => reject(new Error(`office exited (${c}):\n${serverOut}`)));
});
log(`office at ${base}`);

const api = async (path, body) => {
  const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const v = await r.json();
  if (r.status >= 400) throw new Error(`${path}: ${r.status} ${v.error}`);
  return v;
};

let exitCode = 0;
try {
  const health = await api('/api/health');
  assert.equal(health.ok, true);
  log(`health: ${health.org}, ${health.departments} departments, ${health.people} people, adapter ${health.acp.version}`);

  const created = await api('/api/jobs', { dept: 'boss', text: REQUEST });
  log(`job ${created.id} created`);
  const start = Date.now();
  let job;
  let shown = 0;
  for (;;) {
    job = await api(`/api/jobs/${created.id}`);
    for (const e of job.events.slice(shown)) log(`  ${e.agent || '-'} ${e.kind}: ${String(e.text).slice(0, 140)}`);
    shown = job.events.length;
    if (['waiting_approval', 'failed', 'cancelled', 'rejected', 'done'].includes(job.state)) break;
    if (Date.now() - start > TIMEOUT_MS) throw new Error(`timed out in state ${job.state}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  log(`state ${job.state} after ${Math.round((Date.now() - start) / 1000)}s`);
  assert.equal(job.state, 'waiting_approval', `job ended ${job.state}: ${job.error}`);

  // Routing
  const orgInfo = (await api('/api/org')).departments ? await api('/api/org') : { departments: [] };
  assert.ok(orgInfo.departments.find((d) => d.key === job.dept)?.group === 'Military', `the Boss should route to a Military-group department, got ${job.dept}`);
  assert.ok(job.routedBy && job.routedBy.why, 'routedBy is recorded');
  log(`routed to ${job.dept}: ${job.routedBy.why}`);

  // Pieces
  assert.ok(job.pieces.length >= 2, 'at least two pieces');
  const teams = new Set(job.pieces.map((p) => p.team));
  assert.ok(teams.size >= 2, 'pieces from at least two sub-teams');
  for (const p of job.pieces) log(`piece ${p.id} ${p.name} [${p.team}] ${p.state}: ${p.title}`);

  // Deliverable
  const deliverable = join(env.EO_WORK, job.id, 'out', 'deliverable.md');
  assert.ok(existsSync(deliverable), 'out/deliverable.md exists');
  const text = readFileSync(deliverable, 'utf8');
  const size = statSync(deliverable).size;
  assert.ok(size >= 800, `deliverable is non-trivial (${size} bytes)`);
  assert.match(text, /^\s*\|.*\|\s*$/m, 'deliverable has a table');
  assert.match(text, /REQ-|requirement/i, 'deliverable mentions requirements');
  log(`deliverable ${size} bytes`);

  // Audit
  const audit = (await api(`/api/audit?job=${job.id}&limit=10000`)).entries;
  const toolsSeen = audit.filter((e) => e.kind === 'session.tools');
  assert.ok(toolsSeen.length >= job.pieces.length + 2, 'every session reported its tool list');
  for (const e of toolsSeen) {
    for (const t of e.tools) assert.ok(!SHELL.has(t) && !t.startsWith('mcp__'), `session exposed ${t}`);
    assert.deepEqual(e.mcpServers, [], 'no MCP servers');
  }
  const perms = audit.filter((e) => e.kind === 'permission');
  for (const e of perms) {
    if (SHELL.has(e.tool)) assert.equal(e.decision, 'reject', 'shell refused');
    if (e.decision === 'allow' && ['Write', 'Edit', 'MultiEdit'].includes(e.tool)) {
      for (const p of String(e.path).split(' ')) assert.ok(p.startsWith('out/'), `write allowed outside out/: ${p}`);
    }
    if (e.decision === 'allow') assert.ok(String(e.path).split(' ').every((p) => p && !p.startsWith('..') && !p.startsWith('/')), `allowed path outside workspace: ${e.path}`);
  }
  for (const e of audit.filter((x) => x.kind === 'file.write')) {
    if (e.decision === 'reject') continue;
    assert.ok(e.inside !== false && String(e.path).startsWith('out/'), `write outside out/: ${e.path}`);
  }
  for (const e of audit.filter((x) => x.kind === 'file.read')) {
    if (e.decision === 'reject') continue;
    assert.ok(e.inside !== false && !String(e.path).startsWith('..') && !String(e.path).startsWith('/'), `read outside the workspace: ${e.path}`);
  }
  const toolNames = [...new Set(toolsSeen.flatMap((e) => e.tools))];
  log(`tools exposed across sessions: ${toolNames.join(', ') || 'none'}`);
  const permSummary = perms.map((e) => `${e.decision} ${e.tool} ${e.path}`);
  log(`permission decisions (${perms.length}):\n    ${permSummary.join('\n    ')}`);
  log(`file reads: ${audit.filter((x) => x.kind === 'file.read').length}, file writes: ${audit.filter((x) => x.kind === 'file.write').length}`);

  // Approve
  const done = await api(`/api/approvals/${job.id}`, { decision: 'approve' });
  assert.equal(done.state, 'done');
  const folder = join(env.EO_DELIVERABLES, done.output.folder);
  assert.ok(existsSync(join(folder, 'deliverable.md')), 'deliverables folder has deliverable.md');
  log(`approved; deliverables/${done.output.folder}: ${readdirSync(folder).join(', ')}`);
  log('LIVE RUN PASSED');
  console.log(JSON.stringify({
    job: job.id, dept: job.dept, routedBy: job.routedBy,
    pieces: job.pieces.map((p) => ({ id: p.id, agent: p.agent, team: p.team, state: p.state, title: p.title })),
    deliverableBytes: size, tools: toolNames, permissions: permSummary, folder: done.output.folder,
  }, null, 2));
} catch (err) {
  exitCode = 1;
  console.error(`LIVE RUN FAILED: ${err.message}`);
  const logs = join(env.EO_DATA, 'logs');
  if (existsSync(logs)) console.error(`adapter logs in ${logs}`);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  process.exit(exitCode);
}
