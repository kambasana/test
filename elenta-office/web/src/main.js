// Entry point: picks live or demo mode, builds the views and wires events.
import { PRODUCT_NAME, STATE_LABEL, STATUS } from './constants.js';
import { h, clear, announce, put } from './dom.js';
import { state, emit, presence, upsertJob, sortedJobs, isRefusal } from './store.js';
import { normaliseOrg, leadId, deptName } from './org.js';
import { computeLayout } from './layout.js';
import { probeHealth, createLiveClient } from './api.js';
import { createDemoClient } from './demo.js';
import { createFloor } from './floor.js';
import { createRail } from './rail.js';
import { createWork } from './work.js';
import { createJobView } from './jobview.js';
import { createAudit } from './audit.js';
import { createDepartments, safeWingUrl } from './departments.js';

const params = new URLSearchParams(location.search);

function storedTheme() {
  try { return localStorage.getItem('eo-theme'); } catch { return null; }
}

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem('eo-theme', name); } catch { /* ignore */ }
}

function topbar() {
  const root = document.getElementById('topbar');
  const orgTitle = h('span', { class: 'org-title' });
  const wingSlot = h('span', { class: 'wing-slot' });
  const mode = h('span', { class: 'mode-badge mono' });
  const apprCount = h('span', { class: 'count-badge mono', 'aria-hidden': 'true' }, '0');
  const apprSr = h('span', { class: 'sr-only' }, ', none waiting');
  const btnOrg = h('button', { type: 'button', class: 'btn btn-ghost drawer-btn', 'aria-controls': 'rail', 'aria-expanded': 'false' }, 'Org');
  const btnWork = h('button', { type: 'button', class: 'btn btn-ghost drawer-btn', 'aria-controls': 'work', 'aria-expanded': 'false' }, 'Work');
  const btnAppr = h('button', { type: 'button', class: 'btn btn-ghost appr-btn' }, 'Approvals', apprCount, apprSr);
  const btnAudit = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Audit');
  const btnDepts = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Departments');
  const btnTheme = h('button', { type: 'button', class: 'btn btn-ghost theme-btn', 'aria-label': 'Light theme', 'aria-pressed': 'false' }, h('span', { class: 'theme-icon', 'aria-hidden': 'true' }));
  put(root, 
    btnOrg,
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, PRODUCT_NAME)),
    h('span', { class: 'divider', 'aria-hidden': 'true' }),
    orgTitle, wingSlot, mode,
    h('span', { class: 'spacer' }),
    h('nav', { class: 'top-actions', 'aria-label': 'Office' }, btnAppr, btnAudit, btnDepts, btnTheme),
    btnWork);
  return { orgTitle, wingSlot, mode, apprCount, apprSr, btnAppr, btnAudit, btnDepts, btnTheme, btnOrg, btnWork };
}

async function boot() {
  const top = topbar();
  const theme = ['dark', 'light'].includes(params.get('theme')) ? params.get('theme') : (storedTheme() || 'dark');
  applyTheme(theme);

  let health = null;
  const forceDemo = params.get('demo') === '1' || location.protocol === 'file:';
  if (!forceDemo) health = await probeHealth();
  if (health) {
    state.client = createLiveClient();
    state.mode = 'live';
  } else {
    state.client = createDemoClient({ speed: params.get('speed'), off: (params.get('off') || '').split(',').filter(Boolean), autoplay: params.get('autoplay') !== '0' });
    state.mode = 'demo';
    health = await state.client.health();
  }
  state.health = health;
  document.documentElement.dataset.mode = state.mode;

  let rawOrg;
  try { rawOrg = await state.client.org(); } catch (e) {
    put(document.getElementById('floor'), h('p', { class: 'fatal' }, `Could not load the organisation: ${e.message}`));
    return;
  }
  state.org = normaliseOrg(rawOrg);
  state.layout = computeLayout(state.org);
  document.title = `${state.org.office.name} · ${PRODUCT_NAME}`;

  top.orgTitle.textContent = state.org.office.name;
  const wings = (state.org.office.wings || []).filter((w) => w && w.name);
  if (wings.length > 1) {
    const sel = h('select', { class: 'wing-select', 'aria-label': 'Wing' }, wings.map((w) => h('option', { value: safeWingUrl(w.url) || '', disabled: !safeWingUrl(w.url) && w.name !== state.org.office.wing }, w.name)));
    const cur = wings.find((w) => w.name === state.org.office.wing);
    if (cur) sel.value = safeWingUrl(cur.url) || '';
    sel.addEventListener('change', () => { const u = safeWingUrl(sel.value); if (u) location.href = u; });
    put(top.wingSlot, sel);
  } else if (state.org.office.wing) {
    put(top.wingSlot, h('span', { class: 'wing-name mono' }, `WING ${state.org.office.wing.toUpperCase()}`));
  }
  const setMode = () => {
    top.mode.textContent = state.mode === 'demo' ? 'DEMO' : state.connected ? 'LIVE' : 'RECONNECTING';
    top.mode.dataset.tone = state.mode === 'demo' ? 'waiting' : state.connected ? 'live' : 'error';
    top.mode.title = state.mode === 'demo' ? 'Demo mode: simulated activity, no Claude' : `Adapter: ${health.acp ? `${health.acp.adapter || ''} ${health.acp.version || ''}` : 'unknown'}`;
  };
  setMode();

  // ---- views ----------------------------------------------------------
  const floorEl = document.getElementById('floor-stage');
  const libraryIndex = await state.client.library().catch(() => []);
  const floor = createFloor(floorEl, {
    onSelect: (sel) => focus(sel),
    libraryMeta: () => `${libraryIndex.length} notes`,
    preserve: params.get('shot') === '1',
  });
  floor.setTheme(theme);
  floor.setOrg(state.org, state.layout);
  floor.setLibraryMeta(`${libraryIndex.length} notes`);

  const rail = createRail(document.getElementById('rail'), { onFocus: (sel) => focus(sel) });
  rail.render();

  const crumb = document.getElementById('floor-crumb');
  function renderCrumb() {
    clear(crumb);
    const all = h('button', { type: 'button', class: 'crumb-btn' }, 'Floor');
    all.addEventListener('click', () => focus(null));
    put(crumb, all);
    const f = state.focus;
    if (f) {
      const d = f.kind === 'library' ? { name: 'LIBRARY', color: '#9C8CF0' } : state.org.byKey.get(f.dept);
      if (d) put(crumb, h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'), h('span', { class: 'crumb-cur' }, h('span', { class: 'swatch', style: { background: d.color } }), d.boss ? 'COMMAND' : d.name));
      if (f.person) put(crumb, h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'), h('span', { class: 'crumb-cur' }, state.org.people.get(f.person)?.person.name || ''));
    }
  }

  function focus(sel) {
    if (sel && sel.kind === 'command') sel = { ...sel, dept: sel.dept || (state.org.boss ? state.org.boss.key : 'command') };
    state.focus = sel && (sel.dept || sel.kind === 'library') ? sel : null;
    floor.focus(state.focus);
    rail.setFocus(state.focus);
    if (state.focus && state.focus.dept && !state.focus.person) work.setDept(state.focus.dept);
    renderCrumb();
    closeDrawers();
  }

  const work = createWork(document.getElementById('work'), {
    onSend: async (body) => {
      const job = await state.client.createJob(body);
      if (job && job.id) { ingestJob(job); announce(`Sent to ${deptName(state.org, body.dept)}.`); }
    },
    onOpen: (id) => jobView.open(id),
    onFilter: (f) => { state.filter = f; work.renderJobs(); },
  });
  work.renderDepts();

  const jobView = createJobView({
    onDecide: async (id, body) => {
      const job = await state.client.decide(id, body);
      if (job && job.id) ingestJob(job); else ingestJob(await state.client.job(id));
    },
    onCancel: async (id) => {
      const res = await state.client.cancel(id);
      if (res && res.id) ingestJob(res); else ingestJob(await state.client.job(id));
    },
    onRevise: async (job) => {
      const text = `${job.text}\n\nRevise: ${job.note || 'see the owner\'s rejection note'}`;
      const created = await state.client.createJob({ dept: job.dept, text, mode: job.mode || 'team' });
      if (created && created.id) { ingestJob(created); jobView.open(created.id); }
    },
    onFocusPerson: (id) => { const p = state.org.people.get(id); if (p) { jobView.close(); focus({ dept: p.dept.key, person: id }); } },
  });
  const audit = createAudit();
  const depts = createDepartments();

  // ---- drawers (below 1280px) ------------------------------------------
  const scrim = document.getElementById('scrim');
  function closeDrawers() {
    document.body.classList.remove('show-rail', 'show-work');
    top.btnOrg.setAttribute('aria-expanded', 'false');
    top.btnWork.setAttribute('aria-expanded', 'false');
  }
  function toggleDrawer(which, btn) {
    const cls = `show-${which}`;
    const open = !document.body.classList.contains(cls);
    closeDrawers();
    if (open) {
      document.body.classList.add(cls);
      btn.setAttribute('aria-expanded', 'true');
      document.getElementById(which).querySelector('button, select, textarea, input')?.focus();
    }
  }
  top.btnOrg.addEventListener('click', () => toggleDrawer('rail', top.btnOrg));
  top.btnWork.addEventListener('click', () => toggleDrawer('work', top.btnWork));
  scrim.addEventListener('click', closeDrawers);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.matches('.show-rail, .show-work')) closeDrawers(); });

  top.btnAudit.addEventListener('click', () => audit.open());
  top.btnDepts.addEventListener('click', () => depts.open());
  top.btnAppr.addEventListener('click', () => {
    state.filter = state.filter === 'waiting' ? 'all' : 'waiting';
    work.renderJobs();
    if (window.matchMedia('(max-width: 1279px)').matches) toggleDrawer('work', top.btnWork);
  });
  const syncThemeBtn = () => {
    const light = document.documentElement.dataset.theme === 'light';
    top.btnTheme.setAttribute('aria-pressed', String(light));
    top.btnTheme.setAttribute('aria-label', light ? 'Dark theme' : 'Light theme');
    top.btnTheme.title = light ? 'Switch to the dark theme' : 'Switch to the light theme';
  };
  syncThemeBtn();
  top.btnTheme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next); floor.setTheme(next); syncThemeBtn();
    floor.setPresence(presence());
  });

  document.getElementById('zoom-in').addEventListener('click', () => floor.zoomBy(1.25));
  document.getElementById('zoom-out').addEventListener('click', () => floor.zoomBy(0.8));
  document.getElementById('zoom-fit').addEventListener('click', () => focus(null));
  renderCrumb();

  // ---- data flow ------------------------------------------------------
  let refreshTimer = 0;
  function refreshPresence() {
    const map = presence();
    floor.setPresence(map);
    rail.setPresence(map);
    const waiting = sortedJobs().filter((j) => j.state === 'waiting_approval').length;
    top.apprCount.textContent = String(waiting);
    top.apprSr.textContent = waiting ? `, ${waiting} waiting` : ', none waiting';
    top.btnAppr.dataset.waiting = waiting ? 'true' : 'false';
  }
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = requestAnimationFrame(() => { refreshTimer = 0; refreshPresence(); work.renderJobs(); });
  }

  function choreograph(prev, next) {
    const dept = state.org.byKey.get(next.dept);
    const color = dept ? dept.color : STATUS.live;
    const lead = leadId(next);
    if (prev && prev.state === 'routing' && next.state !== 'routing' && next.routedBy) floor.pulse('command', next.dept, color);
    if ((!prev || prev.state === 'queued') && next.state === 'planning' && !next.routedBy) floor.pulse('command', next.dept, color);
    const prevPieces = prev && Array.isArray(prev.pieces) ? prev.pieces.length : 0;
    const pieces = Array.isArray(next.pieces) ? next.pieces : [];
    if (pieces.length && !prevPieces && lead) pieces.forEach((p, i) => setTimeout(() => floor.pulse(lead, p.agent, STATUS.live), i * 140));
    if (prev && Array.isArray(prev.pieces)) {
      for (const p of pieces) {
        const old = prev.pieces.find((x) => x.id === p.id);
        if (old && old.state !== 'done' && p.state === 'done' && lead) floor.pulse(p.agent, lead, color);
      }
    }
    if (prev && prev.state !== 'waiting_approval' && next.state === 'waiting_approval' && lead) floor.pulse(lead, 'command', STATUS.waiting);
  }

  function ingestJob(job, quiet) {
    const r = upsertJob(job);
    if (!r) return;
    const { prev, next } = r;
    if (!quiet) {
      choreograph(prev, next);
      if (!prev || prev.state !== next.state) {
        const label = STATE_LABEL[next.state] || next.state;
        announce(`${next.title || 'Job'}: ${label.toLowerCase()}${next.state === 'routing' ? '' : ` in ${deptName(state.org, next.dept)}`}.`);
      }
    }
    if (jobView.openId === next.id) {
      jobView.update(next);
      if (!Array.isArray(job.events) && state.mode === 'live') refetchOpen();
    }
    audit.refresh();
    scheduleRefresh();
  }

  let refetchTimer = 0;
  function refetchOpen() {
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      const id = jobView.openId;
      if (!id) return;
      try { const j = await state.client.job(id); upsertJob(j); jobView.update(j); } catch { /* ignore */ }
    }, 800);
  }

  function ingestActivity(ev) {
    state.activity.push(ev);
    if (state.activity.length > 500) state.activity.splice(0, state.activity.length - 500);
    const kind = String(ev.kind || '');
    const path = String(ev.path || ev.text || '');
    if (kind === 'read' && !/(^|\/)out\//.test(path)) floor.pulse('library', ev.agent, '#9C8CF0');
    if (isRefusal(ev) || kind === 'error') {
      state.flashes.set(ev.agent, { tone: 'error', until: Date.now() + 7000 });
      announce(`Refused: ${ev.text || 'a tool call'}.`);
    }
    if (ev.job) {
      jobView.addEvent(ev);
      const j = state.jobs.get(ev.job);
      if (j && Array.isArray(j.events) && state.mode === 'live') j.events.push(ev);
    }
    audit.refresh();
    scheduleRefresh();
  }

  try {
    const jobs = await state.client.jobs();
    for (const j of jobs) ingestJob(j, true);
  } catch (e) { console.warn(e); }
  scheduleRefresh();

  state.client.subscribe((type, data) => {
    if (type === 'job') ingestJob(data);
    else if (type === 'activity') ingestActivity(data);
    else if (type === 'status') {
      const was = state.connected;
      state.connected = !!data.connected; setMode();
      if (!was && state.connected && state.mode === 'live') {
        state.client.jobs().then((jobs) => jobs.forEach((j) => ingestJob(j, true))).catch(() => {});
      }
    }
  });
  setInterval(refreshPresence, 1000);

  // deep links used by the screenshot script and for sharing a view
  const fDept = params.get('focus');
  if (fDept && state.org.byKey.get(fDept)) setTimeout(() => focus({ dept: fDept }), 50);
  const open = params.get('open');
  if (open === 'waiting') {
    const j = sortedJobs().find((x) => x.state === 'waiting_approval');
    if (j) jobView.open(j.id);
  } else if (open === 'audit') audit.open();
  else if (open === 'departments') depts.open();
  else if (open) jobView.open(open);

  document.documentElement.dataset.ready = 'true';
  emit('ready');
}

boot().catch((e) => {
  console.error(e);
  const floor = document.getElementById('floor');
  if (floor) put(floor, h('p', { class: 'fatal' }, `Something went wrong while starting: ${e.message}`));
});
