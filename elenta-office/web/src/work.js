// Right panel: the composer and the job list.
import { h, clear, timeAgo, put } from './dom.js';
import { state, sortedJobs } from './store.js';
import { STATE_LABEL, stateTone, TERMINAL_STATES } from './constants.js';
import { deptName } from './org.js';

export function pieceTeam(piece) {
  if (piece.team) return String(piece.team);
  const info = state.org && state.org.people.get(piece.agent);
  if (info) return info.team ? info.team.name : 'LEAD';
  return 'TEAM';
}

export function stateChip(st, extra = '') {
  return h('span', { class: `chip tone-${stateTone(st)} ${extra}` }, STATE_LABEL[st] || String(st || '').toUpperCase());
}

export function routedLine(job) {
  if (!job.routedBy) return null;
  const r = job.routedBy;
  return h('span', { class: 'job-routed' },
    h('span', { class: 'mono routed-by' }, `${r.name || deptName(state.org, r.by) || 'BOSS'} → ${deptName(state.org, job.dept)}`),
    r.why ? h('span', { class: 'routed-why' }, r.why) : null);
}

function progress(job) {
  const pieces = Array.isArray(job.pieces) ? job.pieces : [];
  if (!pieces.length) return null;
  const groups = new Map();
  for (const p of pieces) {
    const t = pieceTeam(p);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(p);
  }
  const done = pieces.filter((p) => p.state === 'done').length;
  return h('span', { class: 'job-progress', 'aria-label': `${done} of ${pieces.length} pieces done` },
    [...groups].map(([team, ps]) => h('span', { class: 'pg' },
      h('span', { class: 'pg-name' }, team),
      h('span', { class: 'pg-bars', 'aria-hidden': 'true' }, ps.map((p) => h('span', { class: `pg-seg tone-${p.state === 'done' ? 'done' : stateTone(p.state)}` }))))),
    h('span', { class: 'pg-count mono' }, `${done}/${pieces.length}`));
}

function cardTitle(job) {
  const t = String(job.title || '');
  const text = String(job.text || '').split('\n')[0];
  if ((!t || /…$|\.\.\.$/.test(t)) && text && text.length <= 200) return text;
  return t || text;
}

export function createWork(root, { onSend, onOpen, onFilter }) {
  const cards = new Map();
  let modeValue = 'team';

  const deptSel = h('select', { id: 'c-dept', name: 'dept' });
  const text = h('textarea', { id: 'c-text', name: 'text', rows: 4, placeholder: 'e.g. Write a one-page test plan for the data-logger software, with a requirements traceability table' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const hint = h('p', { class: 'hint', id: 'c-mode-hint' });
  const segBtns = ['team', 'single'].map((m) => {
    const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': m === modeValue ? 'true' : 'false', tabindex: m === modeValue ? '0' : '-1', dataset: { mode: m } }, m.toUpperCase());
    b.addEventListener('click', () => setMode(m));
    b.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const next = modeValue === 'team' ? 'single' : 'team';
        setMode(next);
        segBtns.find((x) => x.dataset.mode === next).focus();
      }
    });
    return b;
  });
  function setMode(m) {
    modeValue = m;
    for (const b of segBtns) {
      const on = b.dataset.mode === m;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    hint.textContent = m === 'team'
      ? 'Team: the lead splits it by sub-team; pieces run in parallel and come back as one deliverable.'
      : 'Single: the lead hands it to one person.';
  }
  setMode('team');

  const send = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Send');
  const form = h('form', { class: 'composer', id: 'composer', novalidate: true },
    h('h2', { class: 'panel-title' }, 'Work'),
    h('div', { class: 'field' }, h('label', { for: 'c-dept' }, 'Send to'), deptSel),
    h('div', { class: 'field' }, h('label', { for: 'c-text' }, 'What do you need?'), text),
    h('div', { class: 'composer-row' },
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'How to run it', 'aria-describedby': 'c-mode-hint' }, segBtns),
      send),
    hint, err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const body = { dept: deptSel.value, text: text.value.trim(), mode: modeValue };
    if (!body.text) { err.textContent = 'Write what you need first.'; text.focus(); return; }
    send.disabled = true;
    try {
      await onSend(body);
      text.value = '';
    } catch (ex) {
      err.textContent = ex.message || String(ex);
    } finally { send.disabled = false; }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  const filterBtns = [['all', 'All'], ['active', 'Active'], ['waiting', 'Needs approval']].map(([k, label]) => {
    const b = h('button', { type: 'button', class: 'filter-btn', 'aria-pressed': k === state.filter ? 'true' : 'false', dataset: { filter: k } }, label);
    b.addEventListener('click', () => onFilter(k));
    return b;
  });
  const list = h('ul', { class: 'job-list', 'aria-label': 'Jobs' });
  const empty = h('p', { class: 'empty' }, 'No jobs yet. Send the Boss a request above.');
  put(root, form, h('div', { class: 'jobs-head' }, h('h2', { class: 'panel-title' }, 'Jobs'), h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter jobs' }, filterBtns)), list, empty);

  function renderDepts() {
    const org = state.org;
    const cur = deptSel.value;
    clear(deptSel);
    const ordered = [...org.departments].sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0));
    for (const d of ordered) {
      put(deptSel, h('option', { value: d.key, disabled: !d.on }, d.boss ? `${d.name} — routes it for you` : `${d.name}${d.on ? '' : ' (switched off)'}`));
    }
    deptSel.value = cur && org.byKey.get(cur)?.on ? cur : ordered.find((d) => d.on).key;
  }

  function fillCard(btn, job) {
    clear(btn);
    const d = state.org.byKey.get(job.dept);
    btn.setAttribute('aria-label', `${cardTitle(job)}. ${STATE_LABEL[job.state] || job.state}. ${d ? d.name : ''}`);
    put(btn, 
      h('span', { class: 'job-top' },
        stateChip(job.state),
        h('span', { class: 'job-dept' }, h('span', { class: 'swatch', style: { background: d ? d.color : '#8B98A9' } }), d ? d.name : String(job.dept || '').toUpperCase()),
        h('span', { class: 'job-time mono' }, timeAgo(job.updatedAt || job.createdAt))),
      h('span', { class: 'job-title' }, cardTitle(job)),
      routedLine(job),
      progress(job));
  }

  function renderJobs() {
    const jobs = sortedJobs().filter((j) => state.filter === 'all'
      || (state.filter === 'waiting' && j.state === 'waiting_approval')
      || (state.filter === 'active' && !TERMINAL_STATES.has(j.state) && j.state !== 'waiting_approval'));
    const seen = new Set();
    let prev = null;
    for (const job of jobs) {
      seen.add(job.id);
      let c = cards.get(job.id);
      if (!c) {
        const btn = h('button', { type: 'button', class: 'job-open' });
        btn.addEventListener('click', () => onOpen(job.id));
        const li = h('li', { class: 'job-card' }, btn);
        c = { li, btn, sig: '' };
        cards.set(job.id, c);
      }
      const sig = JSON.stringify([job.state, job.dept, job.updatedAt, job.routedBy, (job.pieces || []).map((p) => p.state), job.title]);
      if (sig !== c.sig) { fillCard(c.btn, job); c.sig = sig; }
      c.li.dataset.tone = stateTone(job.state);
      const want = prev ? prev.nextSibling : list.firstChild;
      if (want !== c.li) list.insertBefore(c.li, want);
      prev = c.li;
    }
    for (const [id, c] of cards) if (!seen.has(id)) { c.li.remove(); cards.delete(id); }
    empty.hidden = jobs.length > 0;
    empty.textContent = state.filter === 'waiting' ? 'Nothing is waiting for approval.' : state.filter === 'active' ? 'Nothing is running right now.' : 'No jobs yet. Send the Boss a request above.';
    for (const b of filterBtns) b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
    const n = jobs.length; void n;
  }

  // keep "3 min ago" fresh
  setInterval(() => { for (const c of cards.values()) c.sig = ''; renderJobs(); }, 30000);

  return { renderDepts, renderJobs, focusComposer: () => text.focus(), setDept: (k) => { if (state.org.byKey.get(k)?.on) deptSel.value = k; } };
}
