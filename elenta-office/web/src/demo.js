// Demo mode: an in-browser stand-in for the HTTP API + event stream. It plays
// plausible activity with a word-matching Boss and timed pieces, so the floor
// can be reviewed without a Claude login. It exposes the same interface as
// the live client in api.js.
import { DEMO_ORG, DEMO_NOTES, TEAM_WORDS, DEPT_WORDS, PIECE_TITLES, SAMPLE_REQUESTS } from './demo-data.js';
import { PRODUCT_NAME, TERMINAL_STATES } from './constants.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const words = (text) => String(text).toLowerCase().match(/[a-z][a-z0-9'-]*/g) || [];
const clone = (x) => JSON.parse(JSON.stringify(x));
const iso = (t) => new Date(t).toISOString();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function readOff() {
  try { return JSON.parse(localStorage.getItem('eo-demo-off') || '[]'); } catch { return []; }
}

export function createDemoClient(options = {}) {
  const speed = Math.max(0.25, Math.min(8, Number(options.speed) || 1));
  const random = rng(7);
  const offKeys = new Set([...(options.off || []), ...readOff()]);
  const org = clone(DEMO_ORG);
  for (const d of org.departments) d.on = !offKeys.has(d.key) || d.boss;
  if (!org.departments.some((d) => d.on && !d.boss)) org.departments.forEach((d) => { d.on = true; });

  const deptByKey = new Map(org.departments.map((d) => [d.key, d]));
  const bossDept = org.departments.find((d) => d.boss);
  const notes = clone(DEMO_NOTES);
  const jobs = new Map();
  const files = new Map(); // `${job}/${path}` -> text
  const audit = [];
  const listeners = new Set();
  const timers = new Map(); // job id -> Set of timeout ids
  let seq = 100;
  let sampleIdx = 0;

  const emit = (type, data) => { for (const l of listeners) { try { l(type, data); } catch (e) { console.error(e); } } };
  const later = (job, ms, fn) => {
    const id = setTimeout(() => { timers.get(job.id)?.delete(id); fn(); }, ms / speed);
    if (!timers.has(job.id)) timers.set(job.id, new Set());
    timers.get(job.id).add(id);
  };
  const log = (entry, at = Date.now()) => {
    audit.unshift({ ts: iso(at), ...entry });
  };
  const touch = (job, at = Date.now()) => {
    job.updatedAt = iso(at);
    emit('job', clone(job));
  };
  const activity = (job, agent, kind, text, extra = {}, at = Date.now()) => {
    const ev = { ts: iso(at), agent, dept: job.dept, kind, text, job: job.id, ...extra };
    job.events.push(ev);
    emit('activity', ev);
    return ev;
  };

  function teamOf(dept, personId) {
    return dept.teams.find((t) => t.people.some((p) => p.id === personId)) || null;
  }

  function route(text) {
    const w = words(text);
    let best = null;
    for (const d of org.departments) {
      if (d.boss || !d.on) continue;
      const vocab = new Set([...(DEPT_WORDS[d.key] || []), ...d.teams.flatMap((t) => TEAM_WORDS[t.name] || []), ...words(d.about)]);
      const hits = [...new Set(w.filter((x) => vocab.has(x)))];
      if (!best || hits.length > best.hits.length) best = { dept: d, hits };
    }
    if (!best || !best.hits.length) return { dept: bossDept.key, why: 'No department clearly owns this; the office of the Boss keeps it.' };
    const quoted = best.hits.slice(0, 3).map((h) => `“${h}”`).join(', ');
    return { dept: best.dept.key, why: `Mentions ${quoted}. ${best.dept.name} owns ${best.dept.teams.map((t) => t.name.toLowerCase()).join(', ')}.` };
  }

  function plan(job) {
    const dept = deptByKey.get(job.dept);
    const w = new Set(words(job.text));
    const scored = dept.teams.map((t, i) => ({ t, i, s: (TEAM_WORDS[t.name] || []).filter((x) => w.has(x)).length }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    let chosen = scored.filter((x) => x.s > 0).map((x) => x.t);
    if (job.mode === 'single') chosen = [scored[0].t];
    else {
      for (const x of scored) if (chosen.length < 2 && !chosen.includes(x.t)) chosen.push(x.t);
      chosen = chosen.slice(0, 4);
    }
    return chosen.filter((t) => t.people.length).map((t, i) => {
      const person = t.people[(seq + i) % t.people.length];
      const id = `p${i + 1}-${slug(t.name)}`;
      return { id, agent: person.id, team: t.name, title: PIECE_TITLES[t.name] || `${t.name.toLowerCase()} part`, text: `${PIECE_TITLES[t.name] || 'Part'} for: ${job.text}`, state: 'queued', file: `${id}.md`, summary: '' };
    });
  }

  function pieceBody(job, piece) {
    const t = piece.team;
    if (t === 'COMPLIANCE') return `# ${piece.title}\n\n| Requirement | Covered by | Status |\n|---|---|---|\n| REQ-01 Logging rate 10 Hz | TC-01 | covered |\n| REQ-02 Power-loss safe write | TC-04 | covered |\n| REQ-03 Export marking on outputs | — | *(assumed)* not applicable |\n\nNo controlled performance figures found in the request.`;
    if (t === 'SOFTWARE') return `# ${piece.title}\n\n- **TC-01** Sample at 10 Hz for 1 h; expect 36,000 records.\n- **TC-02** Clock drift under 2 s a day.\n- **TC-03** Full-card rollover keeps the newest data.\n- **TC-04** Pull power mid-write; file stays readable.\n\nThe unit tests could not be run here (no shell for agents); cases are written for the bench.`;
    if (t === 'FINANCE') return `# ${piece.title}\n\n| Item | Cost |\n|---|---:|\n| Range hire, 12 days | 38,400 |\n| Staff, 3 people | 21,600 |\n| Handling (8%) | 4,800 |\n| **Total** | **64,800** |`;
    if (t === 'CONTRACTS') return `# ${piece.title}\n\n- Current term ends 31 Dec; 60 days notice.\n- Liability cap is 1x annual value; ask for 2x.\n- Indexation clause *(assumed)* CPI.`;
    return `# ${piece.title}\n\nFollows the house style and the document template. Purpose, scope and open points are listed for the lead to combine.`;
  }

  function deliverableBody(job) {
    const dept = deptByKey.get(job.dept);
    const lines = [`# ${job.title}`, '', `**Department:** ${dept.name}  `, `**Request:** ${job.text}`, '', '## Summary', '',
      `${dept.name} split this request across ${job.pieces.length} sub-teams and combined the results below.`, ''];
    for (const p of job.pieces) {
      lines.push(`## ${p.team[0]}${p.team.slice(1).toLowerCase()}: ${p.title}`, '');
      const body = (files.get(`${job.id}/${p.file}`) || '').split('\n').slice(2).join('\n');
      lines.push(body, '');
    }
    lines.push('## Notes used', '', '- shared/house-style.md', '- shared/document-template.md');
    if (job.dept === 'military') lines.push('- military/test-plan-template.md', '- lessons/military.md');
    lines.push('', '## Assumed', '', '- Items marked *(assumed)* above need the owner\'s confirmation.');
    return lines.join('\n');
  }

  function makeJob({ dept, text, mode }, at = Date.now()) {
    const id = `j-${(seq++).toString(36)}${Math.floor(random() * 1e4).toString(36)}`;
    const title = text.length > 72 ? `${text.slice(0, 70).replace(/\s+\S*$/, '')}…` : text;
    const job = { id, title, text, dept, mode: mode === 'single' ? 'single' : 'team', state: 'queued', lead: null, pieces: [], output: null, createdAt: iso(at), updatedAt: iso(at), events: [] };
    jobs.set(id, job);
    log({ kind: 'job.created', dept, job: id, agent: 'owner', text: `Job created: ${title}` }, at);
    return job;
  }

  // ---- live flow -------------------------------------------------------
  function start(job) {
    if (deptByKey.get(job.dept)?.boss) {
      job.state = 'routing'; job.lead = bossDept.lead.id; touch(job);
      activity(job, 'boss', 'thinking', 'Reading the request and matching it to a department');
      later(job, 1800, () => {
        const r = route(job.text);
        job.routedBy = { by: 'boss', name: 'BOSS', why: r.why };
        job.dept = r.dept;
        log({ kind: 'job.routed', dept: r.dept, job: job.id, agent: 'boss', text: `Routed to ${deptByKey.get(r.dept).name}: ${r.why}` });
        activity(job, 'boss', 'done', `Handed to ${deptByKey.get(r.dept).name}`);
        doPlan(job);
      });
    } else doPlan(job);
  }

  function doPlan(job) {
    const dept = deptByKey.get(job.dept);
    job.lead = dept.lead.id; job.state = 'planning'; touch(job);
    activity(job, job.lead, 'thinking', job.mode === 'single' ? 'Picking one person for this' : 'Splitting the work by sub-team');
    later(job, 2000, () => {
      job.pieces = plan(job);
      job.plan = { why: `Split by sub-team fit: ${job.pieces.map((p) => p.team.toLowerCase()).join(', ')}.` };
      log({ kind: 'job.planned', dept: job.dept, job: job.id, agent: job.lead, text: `${job.pieces.length} piece(s): ${job.pieces.map((p) => p.team).join(', ')}` });
      job.state = 'working'; touch(job);
      job.pieces.forEach((p, i) => later(job, 300 + i * 450, () => runPiece(job, p, 9000 + random() * 7000)));
    });
  }

  function runPiece(job, piece, duration, startFrac = 0) {
    piece.state = 'working'; touch(job);
    const step = (frac, fn) => { if (frac >= startFrac) later(job, (frac - startFrac) * duration, fn); };
    const note = job.dept === 'military'
      ? ['military/test-plan-template.md', 'shared/house-style.md', 'military/export-screening-checklist.md', 'lessons/military.md'][job.pieces.indexOf(piece) % 4]
      : ['business/cost-model-notes.md', 'shared/document-template.md', 'business/contract-review-checklist.md'][job.pieces.indexOf(piece) % 3];
    step(0.05, () => activity(job, piece.agent, 'thinking', `Working on: ${piece.title}`));
    step(0.18, () => {
      log({ kind: 'permission', dept: job.dept, job: job.id, agent: piece.agent, decision: 'allow', text: `Read library/${note} — allowed once` });
      log({ kind: 'file.read', dept: job.dept, job: job.id, agent: piece.agent, text: `library/${note}` });
      activity(job, piece.agent, 'read', `library/${note}`, { decision: 'allow', path: `library/${note}` });
    });
    if (piece.team === 'SOFTWARE' || piece.team === 'ANALYSIS') {
      step(0.42, () => {
        const tool = piece.team === 'SOFTWARE' ? 'Bash' : 'WebFetch';
        const what = piece.team === 'SOFTWARE' ? 'run the unit tests' : 'fetch an external results page';
        log({ kind: 'permission', dept: job.dept, job: job.id, agent: piece.agent, decision: 'reject', tool, text: `${tool} (${what}) — refused: not in the agent tool set` });
        activity(job, piece.agent, 'tool', `${tool}: ${what}`, { decision: 'reject', tool });
      });
    }
    step(0.7, () => {
      log({ kind: 'permission', dept: job.dept, job: job.id, agent: piece.agent, decision: 'allow', tool: 'Write', text: `Write out/${piece.file} — allowed once` });
      activity(job, piece.agent, 'tool', `Write out/${piece.file}`, { decision: 'allow', tool: 'Write' });
    });
    step(1, () => {
      files.set(`${job.id}/${piece.file}`, pieceBody(job, piece));
      log({ kind: 'file.write', dept: job.dept, job: job.id, agent: piece.agent, text: `out/${piece.file}` });
      piece.state = 'done';
      piece.summary = `${piece.title} — written to ${piece.file}`;
      activity(job, piece.agent, 'write', `out/${piece.file}`);
      activity(job, piece.agent, 'done', piece.summary);
      touch(job);
      if (job.pieces.every((p) => p.state === 'done')) combine(job);
    });
  }

  function combine(job) {
    job.state = 'combining'; touch(job);
    activity(job, job.lead, 'thinking', 'Combining the pieces into one deliverable');
    job.pieces.forEach((p, i) => later(job, 300 + i * 250, () => activity(job, job.lead, 'read', `out/${p.file}`, { decision: 'allow' })));
    later(job, 2600, () => finishCombine(job));
  }

  function finishCombine(job, at = Date.now()) {
    files.set(`${job.id}/deliverable.md`, deliverableBody(job));
    job.output = { file: 'deliverable.md' };
    job.state = 'waiting_approval';
    log({ kind: 'file.write', dept: job.dept, job: job.id, agent: job.lead, text: 'out/deliverable.md' }, at);
    log({ kind: 'job.waiting', dept: job.dept, job: job.id, agent: job.lead, text: 'Deliverable ready for approval' }, at);
    activity(job, job.lead, 'done', 'Deliverable ready for approval', {}, at);
    touch(job, at);
  }

  // Builds a job that already went all the way through (for the seed).
  function seedComplete(spec, ageMin, finalState, note) {
    const t0 = Date.now() - ageMin * 60000;
    const job = makeJob({ dept: spec.dept, text: spec.text, mode: 'team' }, t0);
    if (spec.dept === bossDept.key) {
      const r = route(spec.text);
      job.routedBy = { by: 'boss', name: 'BOSS', why: r.why };
      job.dept = r.dept;
      log({ kind: 'job.routed', dept: r.dept, job: job.id, agent: 'boss', text: `Routed to ${deptByKey.get(r.dept).name}: ${r.why}` }, t0 + 2000);
    }
    job.lead = deptByKey.get(job.dept).lead.id;
    job.pieces = plan(job);
    job.plan = { why: `Split by sub-team fit: ${job.pieces.map((p) => p.team.toLowerCase()).join(', ')}.` };
    let t = t0 + 4000;
    for (const p of job.pieces) {
      activity(job, p.agent, 'read', 'library/shared/house-style.md', { decision: 'allow' }, t += 3000);
      if (p.team === 'SOFTWARE') {
        activity(job, p.agent, 'tool', 'Bash: run the unit tests', { decision: 'reject', tool: 'Bash' }, t += 2000);
        log({ kind: 'permission', dept: job.dept, job: job.id, agent: p.agent, decision: 'reject', tool: 'Bash', text: 'Bash (run the unit tests) — refused: not in the agent tool set' }, t);
      }
      activity(job, p.agent, 'tool', `Write out/${p.file}`, { decision: 'allow', tool: 'Write' }, t += 2000);
      files.set(`${job.id}/${p.file}`, pieceBody(job, p));
      p.state = 'done'; p.summary = `${p.title} — written to ${p.file}`;
      activity(job, p.agent, 'done', p.summary, {}, t += 1000);
    }
    finishCombine(job, t += 4000);
    if (finalState === 'done') {
      job.state = 'done';
      log({ kind: 'approval', dept: job.dept, job: job.id, agent: 'owner', decision: 'approve', text: 'Approved; copied to deliverables/' }, t + 60000);
    }
    if (finalState === 'rejected') {
      job.state = 'rejected'; job.note = note;
      log({ kind: 'approval', dept: job.dept, job: job.id, agent: 'owner', decision: 'reject', text: `Rejected: ${note}` }, t + 60000);
    }
    job.updatedAt = iso(Math.min(Date.now(), t + 60000));
    return job;
  }

  function seed() {
    seedComplete({ dept: 'boss', text: 'Prepare a cost breakdown for the Q4 supplier contract renewal' }, 52, 'done');
    seedComplete({ dept: 'military', text: 'Write a one-page test plan for the data-logger software, with a requirements traceability table' }, 9, 'waiting_approval');
    // A running job: pieces partly done, so the floor is busy from the start.
    if (deptByKey.get('military').on) {
      const job = makeJob({ dept: 'boss', text: 'Review the radar documentation against the export-screening checklist and draft a compliance memo' }, Date.now() - 50000);
      const r = route(job.text);
      job.routedBy = { by: 'boss', name: 'BOSS', why: r.why };
      job.dept = r.dept; job.lead = deptByKey.get(r.dept).lead.id;
      if (deptByKey.get(r.dept).boss) { start(job); return; }
      job.pieces = plan(job);
      if (job.pieces.length < 3) {
        const extra = deptByKey.get(r.dept).teams.find((t) => t.name === 'SOFTWARE' && !job.pieces.some((p) => p.team === t.name));
        if (extra) job.pieces.push({ id: 'p3-software', agent: extra.people[0].id, team: 'SOFTWARE', title: PIECE_TITLES.SOFTWARE, text: 'Check the tool outputs', state: 'queued', file: 'p3-software.md', summary: '' });
      }
      job.plan = { why: `Split by sub-team fit: ${job.pieces.map((p) => p.team.toLowerCase()).join(', ')}.` };
      job.state = 'working';
      log({ kind: 'job.routed', dept: job.dept, job: job.id, agent: 'boss', text: `Routed to ${deptByKey.get(job.dept).name}: ${r.why}` }, Date.now() - 46000);
      job.pieces.forEach((p, i) => runPiece(job, p, 26000 + i * 6000, 0.1 + i * 0.12));
    }
    if (deptByKey.get('business').on) {
      const job = makeJob({ dept: 'business', text: 'Draft the renewal terms and a cost check for the test-range supplier contract' }, Date.now() - 2000);
      start(job);
    }
  }

  function autoplay() {
    const active = [...jobs.values()].filter((j) => !TERMINAL_STATES.has(j.state) && j.state !== 'waiting_approval').length;
    if (active < 2) {
      const text = SAMPLE_REQUESTS[sampleIdx++ % SAMPLE_REQUESTS.length];
      const job = makeJob({ dept: bossDept.key, text, mode: 'team' });
      emit('job', clone(job));
      start(job);
    }
    setTimeout(autoplay, 16000 / speed);
  }

  let started = false;
  function boot() {
    if (started) return; started = true;
    seed();
    if (options.autoplay !== false) setTimeout(autoplay, 14000 / speed);
  }

  const sorted = () => [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const ok = (x) => Promise.resolve(clone(x));
  const fail = (msg) => Promise.reject(new Error(msg));

  return {
    mode: 'demo',
    health: () => ok({ ok: true, product: PRODUCT_NAME, version: 'demo', org: org.office.name, wing: org.office.wing, departments: org.departments.length, people: org.departments.reduce((n, d) => n + 1 + d.teams.reduce((m, t) => m + t.people.length, 0), 0), acp: { adapter: 'demo (no Claude)', version: '—' } }),
    org: () => ok(org),
    jobs: () => { boot(); return ok(sorted()); },
    job: (id) => (jobs.has(id) ? ok(jobs.get(id)) : fail('No such job.')),
    createJob: ({ dept, text, mode }) => {
      const d = deptByKey.get(dept);
      if (!d) return fail('Unknown department.');
      if (!d.on) return fail(`${d.name} is switched off.`);
      if (!String(text || '').trim()) return fail('Write what you need first.');
      const job = makeJob({ dept, text: String(text).trim(), mode });
      emit('job', clone(job));
      setTimeout(() => start(job), 250);
      return ok(job);
    },
    cancel: (id) => {
      const job = jobs.get(id);
      if (!job) return fail('No such job.');
      if (TERMINAL_STATES.has(job.state)) return fail('This job has already finished.');
      for (const t of timers.get(id) || []) clearTimeout(t);
      timers.delete(id);
      job.state = 'cancelled';
      job.pieces.forEach((p) => { if (p.state !== 'done') p.state = 'cancelled'; });
      log({ kind: 'job.cancelled', dept: job.dept, job: id, agent: 'owner', text: 'Cancelled by the owner' });
      touch(job);
      return ok(job);
    },
    approvals: () => ok(sorted().filter((j) => j.state === 'waiting_approval')),
    decide: (id, { decision, note }) => {
      const job = jobs.get(id);
      if (!job || job.state !== 'waiting_approval') return fail('This job is not waiting for approval.');
      if (decision === 'approve') {
        job.state = 'done';
        log({ kind: 'approval', dept: job.dept, job: id, agent: 'owner', decision: 'approve', text: `Approved; copied to deliverables/${iso(Date.now()).slice(0, 10)}-${slug(job.title)}/` });
      } else {
        if (!String(note || '').trim()) return fail('Add a note so the department can learn from it.');
        job.state = 'rejected'; job.note = String(note);
        const lessons = notes.find((n) => n.path === `lessons/${job.dept}.md`) || (notes.push({ path: `lessons/${job.dept}.md`, title: `Lessons: ${deptByKey.get(job.dept).name}`, text: `# Lessons: ${deptByKey.get(job.dept).name}\n` }), notes[notes.length - 1]);
        lessons.text += `\n- ${iso(Date.now()).slice(0, 10)}: ${note}`;
        log({ kind: 'approval', dept: job.dept, job: id, agent: 'owner', decision: 'reject', text: `Rejected: ${note}` });
      }
      touch(job);
      return ok(job);
    },
    audit: ({ dept = '', kind = '', q = '', limit = 300 } = {}) => {
      const needle = q.toLowerCase();
      return ok(audit.filter((e) => (!dept || e.dept === dept) && (!kind || e.kind === kind)
        && (!needle || JSON.stringify(e).toLowerCase().includes(needle))).slice(0, limit));
    },
    auditCsvUrl: null,
    library: () => ok(notes.map((n) => ({ path: n.path, title: n.title, folder: n.path.split('/')[0], preview: n.text.replace(/^#.*\n+/, '').slice(0, 200) }))),
    note: (path) => { const n = notes.find((x) => x.path === path); return n ? ok(n) : fail('No such note.'); },
    file: (jobId, path) => { const t = files.get(`${jobId}/${path}`); return t != null ? Promise.resolve(t) : fail('File not found.'); },
    setDepartments: (off) => {
      try { localStorage.setItem('eo-demo-off', JSON.stringify(off)); } catch { /* storage may be blocked */ }
      log({ kind: 'settings', agent: 'owner', text: `Departments switched off: ${off.length ? off.join(', ') : 'none'}` });
      return ok({ ok: true, restart: true, off });
    },
    subscribe(handler) { listeners.add(handler); handler('status', { connected: true }); return () => listeners.delete(handler); },
  };
}
