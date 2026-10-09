// The job engine (SPEC §4): states, routing, planning, parallel pieces, combining, approval.
import { existsSync, readFileSync, mkdirSync, cpSync, readdirSync, statSync, lstatSync, writeFileSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { atomicWriteJson, newJobId, slugify, isoDay, extractJson, runLimited, oneLine } from './util.mjs';
import { deptPeople, findDept, bossDept } from './org.mjs';
import { notesForDept } from './library.mjs';
import { containedPath } from './paths.mjs';
import { systemPromptFor, routePrompt, planPrompt, piecePrompt, combinePrompt } from './prompts.mjs';

export const STATES = ['queued', 'routing', 'planning', 'working', 'combining', 'waiting_approval', 'done', 'failed', 'rejected', 'cancelled'];
export const RUNNING = new Set(['queued', 'routing', 'planning', 'working', 'combining']);
export const TERMINAL = new Set(['done', 'failed', 'rejected', 'cancelled']);
const TRANSITIONS = {
  queued: ['routing', 'planning', 'working', 'failed', 'cancelled'],
  routing: ['planning', 'working', 'failed', 'cancelled'],
  planning: ['working', 'failed', 'cancelled'],
  working: ['combining', 'waiting_approval', 'failed', 'cancelled'],
  combining: ['waiting_approval', 'failed', 'cancelled'],
  waiting_approval: ['done', 'rejected', 'cancelled'],
  done: [], failed: [], rejected: [], cancelled: [],
};
export function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }

const MAX_EVENTS = 1500;
const MAX_TEXT = 20000;

export class JobError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class JobEngine {
  /**
   * @param {object} o
   * @param {object} o.org validated org (may be null)
   * @param {object} o.settings
   * @param {{data:string, work:string, deliverables:string}} o.paths
   * @param {import('./library.mjs').Library} o.library
   * @param {import('./audit.mjs').Audit} o.audit
   * @param {(type:string, payload:any)=>void} o.emit   live events: 'job' and 'activity'
   * @param {Function} o.runSession  the ACP runner (replaceable in tests)
   */
  constructor({ org, settings, paths, library, audit, emit, runSession }) {
    Object.assign(this, { org, settings, paths, library, audit, runSession });
    this.emit = emit || (() => {});
    this.file = join(paths.data, 'jobs.json');
    this.jobs = [];
    this.controllers = new Map(); // job id -> AbortController
    this.saveTimer = null;
    this.load();
  }

  // ---------- persistence ----------
  load() {
    mkdirSync(this.paths.data, { recursive: true });
    if (!existsSync(this.file)) return;
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8'));
      this.jobs = Array.isArray(v.jobs) ? v.jobs : [];
    } catch (err) {
      this.audit.write('error', `Could not read jobs.json (${err.message}); starting with no jobs.`);
      this.jobs = [];
    }
    let changed = false;
    for (const j of this.jobs) {
      if (RUNNING.has(j.state)) {
        j.state = 'failed';
        j.error = 'office restarted';
        j.updatedAt = new Date().toISOString();
        for (const p of j.pieces || []) if (!TERMINAL.has(p.state) && p.state !== 'done') p.state = 'failed';
        this.audit.write('job.state', `Job "${j.title}" marked failed: office restarted.`, { job: j.id, dept: j.dept, state: 'failed' });
        changed = true;
      }
    }
    if (changed) this.saveNow();
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    atomicWriteJson(this.file, { version: 1, jobs: this.jobs });
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
    this.saveTimer.unref?.();
  }

  // ---------- views ----------
  summary(job) {
    const { events, ...rest } = job;
    return { ...rest, eventCount: events.length };
  }
  list() { return [...this.jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((j) => this.summary(j)); }
  get(id) { return this.jobs.find((j) => j.id === id) || null; }
  detail(id) {
    const j = this.get(id);
    if (!j) return null;
    let deliverable = null;
    const f = this.outFile(j, 'deliverable.md');
    if (f && existsSync(f)) { try { deliverable = readFileSync(f, 'utf8'); } catch {} }
    return { ...j, deliverable };
  }

  workspaceOf(job) { return join(this.paths.work, job.id); }

  /** Absolute path of a file in the job's out/ (or, after approval, its deliverables folder). */
  outFile(job, rel) {
    const clean = String(rel || '').replace(/^\/+/, '').replace(/^out\//, '');
    const candidates = [join(this.workspaceOf(job), 'out')];
    if (job.output?.folder) candidates.push(join(this.paths.deliverables, job.output.folder));
    for (const root of candidates) {
      if (!existsSync(root)) continue;
      try { const p = containedPath(root, clean); if (existsSync(p)) return p; } catch { return null; }
    }
    return null;
  }

  // ---------- state ----------
  setState(job, state, extra = {}) {
    if (job.state === state) return;
    if (!canTransition(job.state, state)) throw new JobError(`A job cannot go from ${job.state} to ${state}.`, 409);
    job.state = state;
    Object.assign(job, extra);
    job.updatedAt = new Date().toISOString();
    this.event(job, { kind: 'state', text: state });
    this.audit.write('job.state', `Job "${job.title}" is now ${state}.`, { job: job.id, dept: job.dept, state });
    this.changed(job, true);
  }

  changed(job, now = false) {
    job.updatedAt = new Date().toISOString();
    this.emit('job', this.summary(job));
    if (now) this.saveNow(); else this.save();
  }

  event(job, ev) {
    const e = { t: new Date().toISOString(), ...ev };
    job.events.push(e);
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    return e;
  }

  activity(job, agent, kind, text, data) {
    const e = this.event(job, { kind, agent: agent?.id, text: oneLine(text, 300), ...(data ? { data } : {}) });
    this.emit('activity', { job: job.id, agent: agent?.id || null, dept: agent?.dept || job.dept, kind, text: e.text, t: e.t, ...(data ? { data } : {}) });
    this.save();
  }

  // ---------- create ----------
  create({ dept, text, mode, title, revisionOf } = {}) {
    if (!this.org) throw new JobError('The org file has problems, so no jobs can run. Fix it and restart.', 409);
    const d = findDept(this.org, dept);
    if (!d) throw new JobError(`There is no department "${dept}".`);
    if (!d.on) throw new JobError(`${d.name} is switched off and takes no jobs.`, 409);
    if (typeof text !== 'string' || !text.trim()) throw new JobError('The request text is empty.');
    if (text.length > MAX_TEXT) throw new JobError(`The request is longer than ${MAX_TEXT} characters.`);
    mode = mode === undefined ? 'team' : mode;
    if (mode !== 'team' && mode !== 'single') throw new JobError('mode must be "team" or "single".');
    const now = new Date().toISOString();
    const job = {
      id: newJobId(),
      title: oneLine(title || text.split('\n').find((l) => l.trim()) || text, 80),
      text: text.trim(),
      dept: d.key,
      requestedDept: d.key,
      routedBy: null,
      mode,
      state: 'queued',
      lead: d.lead ? d.lead.id : null,
      plan: null,
      pieces: [],
      output: null,
      error: null,
      revisionOf: revisionOf || null,
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    this.jobs.push(job);
    this.audit.write('job.created', `Job "${job.title}" created for ${d.name} (${mode}).`, { job: job.id, dept: d.key, mode });
    this.event(job, { kind: 'state', text: 'queued' });
    this.changed(job, true);
    queueMicrotask(() => this.run(job).catch((err) => this.fail(job, err)));
    return job;
  }

  revise(id, note) {
    const j = this.get(id);
    if (!j) throw new JobError('No such job.', 404);
    if (!['rejected', 'failed', 'cancelled', 'done'].includes(j.state)) throw new JobError('Only finished, rejected, failed or cancelled jobs can be revised.', 409);
    const extra = note && String(note).trim() ? `\n\nRevision requested by the owner: ${String(note).trim()}` : '';
    return this.create({ dept: j.dept, text: j.text + extra, mode: j.mode, title: `Revise: ${j.title}`.slice(0, 80), revisionOf: j.id });
  }

  fail(job, err) {
    const msg = err?.message || String(err);
    if (this.stopping) return;
    if (TERMINAL.has(job.state) || job.state === 'waiting_approval') return;
    if (msg === 'cancelled' || job.cancelRequested) {
      if (job.state !== 'cancelled') this.setState(job, 'cancelled');
      return;
    }
    this.activity(job, null, 'error', msg);
    this.audit.write('error', `Job "${job.title}" failed: ${msg}`, { job: job.id, dept: job.dept });
    this.setState(job, 'failed', { error: oneLine(msg, 600) });
  }

  cancel(id) {
    const j = this.get(id);
    if (!j) throw new JobError('No such job.', 404);
    if (TERMINAL.has(j.state)) throw new JobError(`The job is already ${j.state}.`, 409);
    j.cancelRequested = true;
    this.controllers.get(j.id)?.abort();
    for (const p of j.pieces) if (!['done', 'failed'].includes(p.state)) p.state = 'cancelled';
    this.audit.write('job.cancelled', `Job "${j.title}" cancelled by the owner.`, { job: j.id, dept: j.dept });
    this.setState(j, 'cancelled');
    return j;
  }

  /** Cancel everything that is running (shutdown). */
  stopAll() {
    // Leave the jobs in their running state: the next start marks them failed ("office restarted").
    this.stopping = true;
    for (const c of this.controllers.values()) c.abort();
  }

  // ---------- run ----------
  async session(job, role, person, dept, prompt) {
    const ctrl = this.controllers.get(job.id);
    const agent = { id: person.id, name: person.name, dept: dept.key };
    const logDir = join(this.paths.data, 'logs');
    mkdirSync(logDir, { recursive: true });
    return this.runSession({
      role, agent, jobId: job.id,
      workspace: this.workspaceOf(job),
      systemPrompt: systemPromptFor(role, { org: this.org, dept, person }),
      prompt,
      settings: this.settings,
      audit: this.audit,
      activity: ({ kind, text, data }) => this.activity(job, agent, kind, text, data),
      signal: ctrl?.signal,
      logFile: join(logDir, `${job.id}.log`),
    });
  }

  checkCancelled(job) {
    if (job.cancelRequested || job.state === 'cancelled') throw new Error('cancelled');
  }

  async run(job) {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    try {
      const ws = this.workspaceOf(job);
      mkdirSync(join(ws, 'out'), { recursive: true });
      let dept = findDept(this.org, job.dept);

      // 2. Route
      if (dept.boss) {
        this.setState(job, 'routing');
        const candidates = this.org.departments.filter((d) => d.on && !d.boss);
        let chosen = null, why = '';
        if (candidates.length) {
          const boss = dept.lead;
          const res = await this.session(job, 'route', boss, dept, routePrompt({ request: job.text, departments: candidates }));
          this.checkCancelled(job);
          const ans = extractJson(res.text) || {};
          chosen = candidates.find((d) => d.key === ans.dept) || null;
          why = typeof ans.why === 'string' ? oneLine(ans.why, 300) : '';
        }
        if (chosen) {
          job.dept = chosen.key;
          job.lead = chosen.lead?.id || null;
          job.routedBy = { by: dept.lead.id, name: dept.lead.name, why: why || `Owned by ${chosen.name}.` };
          dept = chosen;
        } else {
          job.routedBy = { by: dept.lead.id, name: dept.lead.name, why: why || 'No other department fits; the Boss keeps it.' };
        }
        this.activity(job, { id: job.routedBy.by, dept: 'boss' }, 'route', `→ ${dept.name}: ${job.routedBy.why}`, { to: dept.key });
        this.audit.write('job.routed', `Boss routed "${job.title}" to ${dept.name}: ${job.routedBy.why}`, { job: job.id, dept: dept.key, from: job.requestedDept });
        this.changed(job, true);
      }

      // Workspace library copy for the owning department.
      const index = this.library.copyForDept(dept, ws).map((e) => ({ ...e }));
      const lessons = this.library.lessonsText(dept.key);
      job.notes = index.map((e) => e.path);

      // 3. Plan
      const people = deptPeople(dept);
      const members = people.filter((p) => !p.lead);
      const byId = new Map(people.map((p) => [p.id, p]));
      let planned = [];
      let why = '';
      if (members.length === 0) {
        why = 'Single-person department: the lead does the work.';
      } else {
        this.setState(job, 'planning');
        const max = Math.max(2, Math.min(this.settings.team?.max || 6, members.length));
        const single = job.mode === 'single';
        const res = await this.session(job, 'plan', dept.lead, dept, planPrompt({ request: job.text, dept, index, lessons, min: Math.min(2, members.length), max, single }));
        this.checkCancelled(job);
        const ans = extractJson(res.text) || {};
        why = typeof ans.why === 'string' ? oneLine(ans.why, 300) : '';
        const used = new Set();
        for (const p of Array.isArray(ans.pieces) ? ans.pieces : []) {
          const person = byId.get(p?.agent);
          if (!person || person.lead || used.has(person.id)) continue;
          used.add(person.id);
          planned.push({ person, title: oneLine(p.title || 'Piece', 100), text: String(p.text || p.title || '').slice(0, 2000) });
          if (planned.length >= (single ? 1 : max)) break;
        }
        if (!planned.length) why = (why ? why + ' ' : '') + 'No valid pieces came back, so the lead does it alone.';
      }
      if (!planned.length) planned = [{ person: dept.lead, title: oneLine(job.title, 100), text: job.text }];
      job.pieces = planned.map((p, i) => ({
        id: `p${i + 1}`,
        agent: p.person.id,
        name: p.person.name,
        team: p.person.team,
        title: p.title,
        text: p.text,
        state: 'queued',
        file: `out/p${i + 1}.md`,
        summary: null,
        error: null,
      }));
      job.plan = { why, teams: [...new Set(job.pieces.map((p) => p.team || 'LEAD'))] };
      this.audit.write('job.planned', `${dept.name} lead planned ${job.pieces.length} piece(s): ${job.pieces.map((p) => `${p.id}→${p.name}`).join(', ')}. ${why}`, { job: job.id, dept: dept.key, pieces: job.pieces.map((p) => ({ id: p.id, agent: p.agent, team: p.team })) });
      for (const p of job.pieces) this.activity(job, { id: p.agent, dept: dept.key }, 'assigned', `${p.id}: ${p.title}`, { from: job.lead, piece: p.id });
      this.changed(job, true);

      // 4. Work
      this.setState(job, 'working');
      await runLimited(job.pieces, this.settings.concurrency || 4, async (piece) => {
        if (job.cancelRequested) return;
        const person = byId.get(piece.agent) || dept.lead;
        piece.state = 'working';
        piece.startedAt = new Date().toISOString();
        this.changed(job);
        const outFile = join(ws, piece.file);
        try {
          const res = await this.session(job, 'piece', person, dept, piecePrompt({
            request: job.text, dept, person, piece, pieces: job.pieces, index, lessons, outFile, workspace: ws,
          }));
          if (!existsSync(outFile) && res.text) {
            writeFileSync(outFile, res.text + '\n');
            this.audit.write('file.write', `Office saved ${piece.file} from ${person.name}'s answer (the agent did not write it).`, { job: job.id, dept: dept.key, agent: 'office', path: piece.file });
          }
          if (!existsSync(outFile)) throw new Error('The piece produced no output.');
          piece.state = 'done';
          piece.summary = oneLine(res.text.split('\n').filter((l) => l.trim()).pop() || '', 300);
          this.activity(job, { id: person.id, dept: dept.key }, 'done', `${piece.id} done: ${piece.summary}`);
        } catch (err) {
          if (job.cancelRequested) { piece.state = 'cancelled'; return; }
          piece.state = 'failed';
          piece.error = oneLine(err.message, 400);
          this.activity(job, { id: person.id, dept: dept.key }, 'error', `${piece.id} failed: ${piece.error}`);
        } finally {
          piece.endedAt = new Date().toISOString();
          this.changed(job, true);
        }
      });
      this.checkCancelled(job);
      const ok = job.pieces.filter((p) => p.state === 'done');
      if (!ok.length) throw new Error(`Every piece failed: ${job.pieces.map((p) => p.error).filter(Boolean).join('; ')}`);

      // 5. Combine
      const deliverable = join(ws, 'out', 'deliverable.md');
      if (job.pieces.length === 1) {
        writeFileSync(deliverable, readFileSync(join(ws, ok[0].file), 'utf8'));
        this.audit.write('file.write', 'Office copied the only piece to out/deliverable.md.', { job: job.id, dept: dept.key, agent: 'office', path: 'out/deliverable.md' });
      } else {
        this.setState(job, 'combining');
        const res = await this.session(job, 'combine', dept.lead, dept, combinePrompt({ request: job.text, dept, pieces: job.pieces, workspace: ws, deliverable, index }));
        this.checkCancelled(job);
        if (!existsSync(deliverable)) {
          const text = res.text.length > 400 ? res.text : ok.map((p) => readFileSync(join(ws, p.file), 'utf8')).join('\n\n');
          writeFileSync(deliverable, `# ${job.title}\n\n${text}\n`);
          this.audit.write('file.write', 'Office wrote out/deliverable.md (the lead did not write it).', { job: job.id, dept: dept.key, agent: 'office', path: 'out/deliverable.md' });
        }
        job.summary = oneLine(res.text.split('\n').filter((l) => l.trim()).pop() || '', 300);
      }
      const bytes = statSync(deliverable).size;
      job.output = { path: 'deliverable.md', bytes, files: listFiles(join(ws, 'out')), folder: null };
      this.setState(job, 'waiting_approval');
      this.activity(job, { id: job.lead, dept: dept.key }, 'done', `Deliverable ready (${bytes} bytes); waiting for approval.`);
    } catch (err) {
      this.fail(job, err);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  // ---------- approval ----------
  decide(id, { decision, note } = {}) {
    const j = this.get(id);
    if (!j) throw new JobError('No such job.', 404);
    if (j.state !== 'waiting_approval') throw new JobError(`The job is ${j.state}, not waiting for approval.`, 409);
    const dept = findDept(this.org, j.dept);
    if (decision === 'approve') {
      const src = join(this.workspaceOf(j), 'out');
      let folder = `${isoDay()}-${slugify(j.title, 48)}`;
      for (let n = 2; existsSync(join(this.paths.deliverables, folder)); n++) folder = `${isoDay()}-${slugify(j.title, 48)}-${n}`;
      const dest = join(this.paths.deliverables, folder);
      mkdirSync(this.paths.deliverables, { recursive: true });
      cpSync(src, dest, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (s) => !lstatSync(s).isSymbolicLink() });
      j.output = { ...(j.output || {}), folder, files: listFiles(dest) };
      this.audit.write('approval', `Owner approved "${j.title}"; saved to deliverables/${folder}.`, { job: j.id, dept: j.dept, decision: 'approve', path: `deliverables/${folder}` });
      this.setState(j, 'done', { approvedAt: new Date().toISOString(), note: note ? String(note).slice(0, 4000) : null });
      return j;
    }
    if (decision === 'reject') {
      const text = note ? String(note).trim().slice(0, 4000) : '';
      let lesson = null;
      if (text && dept) lesson = this.library.addLesson(dept, text, j.title);
      this.audit.write('approval', `Owner rejected "${j.title}"${text ? `: ${oneLine(text, 200)}` : ''}.`, { job: j.id, dept: j.dept, decision: 'reject', path: lesson });
      this.setState(j, 'rejected', { note: text || null, lesson });
      return j;
    }
    throw new JobError('decision must be "approve" or "reject".');
  }
}

export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (st.isFile()) out.push({ path: relative(dir, f).split(sep).join(posix.sep), bytes: st.size });
    }
  };
  walk(dir);
  return out;
}
