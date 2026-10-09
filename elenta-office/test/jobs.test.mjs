import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canTransition, STATES, TERMINAL } from '../server/jobs.mjs';
import { startOffice } from '../server/office.mjs';
import { isolatedEnv, fakeRunner, waitFor } from './helpers.mjs';

const json = { 'content-type': 'application/json' };

async function office(t, runner = fakeRunner(), extraEnv = {}) {
  const iso = isolatedEnv(extraEnv);
  const o = await startOffice({ env: iso.env, runSession: runner, log: () => {} });
  t.after(() => o.close());
  const base = `http://127.0.0.1:${o.port}`;
  const api = async (path, body) => {
    const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: json, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const waitState = (id, states) => waitFor(async () => {
    const j = (await api(`/api/jobs/${id}`)).body;
    return states.includes(j.state) ? j : null;
  });
  return { o, api, waitState, dir: iso.dir, env: iso.env };
}

test('state machine: allowed and forbidden transitions', () => {
  assert.ok(canTransition('queued', 'routing'));
  assert.ok(canTransition('routing', 'planning'));
  assert.ok(canTransition('planning', 'working'));
  assert.ok(canTransition('working', 'combining'));
  assert.ok(canTransition('combining', 'waiting_approval'));
  assert.ok(canTransition('waiting_approval', 'done'));
  assert.ok(canTransition('waiting_approval', 'rejected'));
  for (const s of STATES) if (!TERMINAL.has(s)) assert.ok(canTransition(s, 'cancelled'), s);
  for (const s of TERMINAL) for (const t of STATES) assert.ok(!canTransition(s, t), `${s}->${t}`);
  assert.ok(!canTransition('queued', 'done'));
  assert.ok(!canTransition('working', 'done'));
  assert.ok(!canTransition('planning', 'waiting_approval'));
});

test('a Boss job is routed, planned by sub-team, worked in parallel, combined and approved', async (t) => {
  const runner = fakeRunner();
  const { api, waitState, env } = await office(t, runner);
  const created = await api('/api/jobs', { dept: 'boss', text: 'Write a test plan for the data logger.' });
  assert.equal(created.status, 201);
  assert.equal(created.body.mode, 'team');
  const job = await waitState(created.body.id, ['waiting_approval', 'failed']);
  assert.equal(job.state, 'waiting_approval', job.error);
  assert.equal(job.dept, 'capability');
  assert.equal(job.routedBy.by, 'boss');
  assert.ok(job.routedBy.why.length > 0);
  assert.equal(job.pieces.length, 3);
  assert.deepEqual(new Set(job.pieces.map((p) => p.team)), new Set(['TEST & EVALUATION', 'CAPABILITY (J8)', 'DOCUMENTATION']));
  assert.ok(job.pieces.every((p) => p.state === 'done'));
  assert.match(job.deliverable, /# Combined deliverable/);
  assert.deepEqual(runner.calls.map((c) => c.role).sort(), ['combine', 'piece', 'piece', 'piece', 'plan', 'route']);
  // Each piece prompt names its own out/ file and the department's notes only.
  const piecePrompt = runner.calls.find((c) => c.role === 'piece').prompt;
  assert.match(piecePrompt, /library\/military\/test-plan-template\.md/);
  assert.doesNotMatch(piecePrompt, /library\/business\//);
  // Workspace copy holds shared + military notes, not business ones.
  const lib = join(env.EO_WORK, job.id, 'library');
  assert.ok(existsSync(join(lib, 'shared', 'glossary.md')));
  assert.ok(existsSync(join(lib, 'military', 'test-plan-template.md')));
  assert.ok(!existsSync(join(lib, 'business')));
  // History of states in events.
  const states = job.events.filter((e) => e.kind === 'state').map((e) => e.text);
  assert.deepEqual(states, ['queued', 'routing', 'planning', 'working', 'combining', 'waiting_approval']);
  // Approvals list, file API, then approve.
  assert.equal((await api('/api/approvals')).body.jobs.length, 1);
  const approved = await api(`/api/approvals/${job.id}`, { decision: 'approve' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.state, 'done');
  const folder = join(env.EO_DELIVERABLES, approved.body.output.folder);
  assert.ok(existsSync(join(folder, 'deliverable.md')));
  assert.ok(existsSync(join(folder, 'p1.md')));
  assert.match(approved.body.output.folder, /^\d{4}-\d{2}-\d{2}-write-a-test-plan/);
  const again = await api(`/api/approvals/${job.id}`, { decision: 'approve' });
  assert.equal(again.status, 409);
  // Audit trail.
  const audit = (await api(`/api/audit?job=${job.id}`)).body.entries.map((e) => e.kind);
  for (const k of ['job.created', 'job.routed', 'job.planned', 'approval']) assert.ok(audit.includes(k), k);
});

test('files API serves only from out/ or the deliverables folder', async (t) => {
  const { o, api, waitState } = await office(t);
  const { body } = await api('/api/jobs', { dept: 'capability', text: 'Review the code.', mode: 'team' });
  await waitState(body.id, ['waiting_approval']);
  const base = `http://127.0.0.1:${o.port}`;
  const ok = await fetch(`${base}/api/files?job=${body.id}&path=deliverable.md`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/markdown/);
  assert.equal((await fetch(`${base}/api/files?job=${body.id}&path=out/p1.md`)).status, 200);
  assert.equal((await fetch(`${base}/api/files?job=${body.id}&path=../library/shared/glossary.md`)).status, 404);
  assert.equal((await fetch(`${base}/api/files?job=${body.id}&path=/etc/passwd`)).status, 404);
  assert.equal((await fetch(`${base}/api/files?job=nope&path=deliverable.md`)).status, 404);
});

test('reject with a note writes a lesson that later jobs for that department receive; revise re-runs', async (t) => {
  const runner = fakeRunner();
  const { api, waitState, env } = await office(t, runner);
  const { body } = await api('/api/jobs', { dept: 'capability', text: 'Draft the export screening.' });
  await waitState(body.id, ['waiting_approval']);
  const rej = await api(`/api/approvals/${body.id}`, { decision: 'reject', note: 'Always cite the document number.' });
  assert.equal(rej.body.state, 'rejected');
  const lesson = readFileSync(join(env.EO_LIBRARY, 'lessons', 'capability.md'), 'utf8');
  assert.match(lesson, /Always cite the document number\./);
  assert.match(lesson, /## \d{4}-\d{2}-\d{2} — Draft the export screening\./);
  const rev = await api(`/api/jobs/${body.id}/revise`, { note: 'Add numbers.' });
  assert.equal(rev.status, 201);
  assert.equal(rev.body.revisionOf, body.id);
  await waitState(rev.body.id, ['waiting_approval']);
  const later = runner.calls.filter((c) => c.role === 'piece').pop().prompt;
  assert.match(later, /Always cite the document number\./);
  assert.match(later, /Revision requested by the owner: Add numbers\./);
  const plan = runner.calls.filter((c) => c.role === 'plan').pop().prompt;
  assert.match(plan, /Lessons from earlier rejected work/);
});

test('invalid plan → the lead does it alone; single mode → one piece; unknown route → the Boss keeps it', async (t) => {
  const bogus = fakeRunner({ plan: [{ agent: 'nobody', title: 'x', text: 'y' }, { agent: 'mil-cap-lead', title: 'lead', text: 'no' }] });
  const a = await office(t, bogus);
  const j1 = (await a.api('/api/jobs', { dept: 'capability', text: 'Something.' })).body;
  const r1 = await a.waitState(j1.id, ['waiting_approval', 'failed']);
  assert.equal(r1.pieces.length, 1);
  assert.equal(r1.pieces[0].agent, 'mil-cap-lead');
  assert.equal(r1.state, 'waiting_approval');

  const j2 = (await a.api('/api/jobs', { dept: 'capability', text: 'Something small.', mode: 'single' })).body;
  const r2 = await a.waitState(j2.id, ['waiting_approval', 'failed']);
  assert.equal(r2.pieces.length, 1);
  assert.equal(r2.mode, 'single');

  const lost = fakeRunner({ routeTo: 'nonsense', plan: [{ agent: 'chief-of-staff', title: 'Brief', text: 'Do it.' }] });
  const b = await office(t, lost);
  const j3 = (await b.api('/api/jobs', { dept: 'boss', text: 'Where does this go?' })).body;
  const r3 = await b.waitState(j3.id, ['waiting_approval', 'failed']);
  assert.equal(r3.dept, 'boss');
  assert.match(r3.routedBy.why, /.+/);
});

test('a failing piece does not sink the job; all failing pieces fail it', async (t) => {
  const some = await office(t, fakeRunner({ failPieces: ['mil-writer'] }));
  const j = (await some.api('/api/jobs', { dept: 'capability', text: 'Plan.' })).body;
  const r = await some.waitState(j.id, ['waiting_approval', 'failed']);
  assert.equal(r.state, 'waiting_approval');
  assert.equal(r.pieces.find((p) => p.agent === 'mil-writer').state, 'failed');
  const all = await office(t, fakeRunner({ failPieces: ['mil-writer', 'mil-test-engineer', 'mil-req-analyst'] }));
  const j2 = (await all.api('/api/jobs', { dept: 'capability', text: 'Plan.' })).body;
  const r2 = await all.waitState(j2.id, ['waiting_approval', 'failed']);
  assert.equal(r2.state, 'failed');
  assert.match(r2.error, /Every piece failed/);
});

test('cancel stops a running job; refused inputs give sentences', async (t) => {
  const { api, waitState } = await office(t, fakeRunner({ delayMs: 400 }));
  const j = (await api('/api/jobs', { dept: 'capability', text: 'Long job.' })).body;
  await waitState(j.id, ['planning', 'working']);
  const c = await api(`/api/jobs/${j.id}/cancel`, {});
  assert.equal(c.body.state, 'cancelled');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal((await api(`/api/jobs/${j.id}`)).body.state, 'cancelled');
  assert.equal((await api(`/api/jobs/${j.id}/cancel`, {})).status, 409);
  assert.equal((await api('/api/jobs', { dept: 'capability', text: '' })).status, 400);
  assert.equal((await api('/api/jobs', { dept: 'capability', text: 'x', mode: 'swarm' })).status, 400);
  assert.equal((await api('/api/jobs', { dept: 'ghost', text: 'x' })).status, 400);
  assert.equal((await api('/api/approvals/nope', { decision: 'approve' })).status, 404);
});

test('switched-off departments refuse jobs and are never routed to; the switch is saved locally', async (t) => {
  const { api, env } = await office(t, fakeRunner(), { EO_OFF: 'business' });
  const org = (await api('/api/org')).body;
  assert.equal(org.departments.find((d) => d.key === 'business').on, false);
  assert.ok(org.layout && org.layout.bays.length === 9);
  assert.equal((await api('/api/jobs', { dept: 'business', text: 'Pay the invoice.' })).status, 409);
  const saved = await api('/api/departments', { off: ['capability'] });
  assert.equal(saved.body.restartRequired, true);
  const local = JSON.parse(readFileSync(env.EO_SETTINGS, 'utf8'));
  assert.deepEqual(local.departments.capability, { on: false });
  assert.equal((await api('/api/departments', { off: ['boss', 'intel', 'operations', 'information', 'cyber', 'warfare', 'logistics', 'capability', 'support', 'business'] })).status, 400);
  assert.equal((await api('/api/departments', { off: ['ghost'] })).status, 400);
  const audit = (await api('/api/audit?kind=settings')).body.entries;
  assert.equal(audit.length, 1);
});

test('restart marks running jobs failed with "office restarted"', async () => {
  const iso = isolatedEnv();
  mkdirSync(iso.env.EO_DATA, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(iso.env.EO_DATA, 'jobs.json'), JSON.stringify({ version: 1, jobs: [
    { id: 'job-a', title: 'A', text: 'A', dept: 'capability', mode: 'team', state: 'working', pieces: [{ id: 'p1', state: 'working' }], events: [], createdAt: now, updatedAt: now },
    { id: 'job-b', title: 'B', text: 'B', dept: 'capability', mode: 'team', state: 'waiting_approval', pieces: [], events: [], createdAt: now, updatedAt: now },
  ] }));
  const o = await startOffice({ env: iso.env, runSession: fakeRunner(), log: () => {} });
  try {
    const jobs = (await (await fetch(`http://127.0.0.1:${o.port}/api/jobs`)).json()).jobs;
    const a = jobs.find((j) => j.id === 'job-a');
    assert.equal(a.state, 'failed');
    assert.equal(a.error, 'office restarted');
    assert.equal(a.pieces[0].state, 'failed');
    assert.equal(jobs.find((j) => j.id === 'job-b').state, 'waiting_approval');
    const saved = JSON.parse(readFileSync(join(iso.env.EO_DATA, 'jobs.json'), 'utf8'));
    assert.equal(saved.jobs[0].state, 'failed');
    assert.ok(!readdirSync(iso.env.EO_DATA).some((f) => f.endsWith('.tmp')));
  } finally { await o.close(); }
});

test('server-sent events announce job changes and activity', async (t) => {
  const { o, api } = await office(t);
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${o.port}/api/events`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const seen = new Set();
  let buf = '';
  await api('/api/jobs', { dept: 'capability', text: 'Events please.' });
  const dec = new TextDecoder();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !(seen.has('job') && seen.has('activity'))) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    for (const m of buf.matchAll(/^event: (\w+)$/gm)) seen.add(m[1]);
  }
  ctrl.abort();
  assert.ok(seen.has('hello'));
  assert.ok(seen.has('job'));
  assert.ok(seen.has('activity'));
});
