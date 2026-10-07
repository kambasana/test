// Application state shared by the views, plus derived per-person presence.
import { TERMINAL_STATES } from './constants.js';
import { leadId } from './org.js';

const listeners = new Map();

export const state = {
  client: null,
  mode: 'live',
  health: null,
  org: null,
  layout: null,
  jobs: new Map(),
  activity: [],          // newest last, capped
  flashes: new Map(),    // agent id -> { tone, until }
  connected: true,
  focus: null,           // { dept, person } currently focused on the floor
  filter: 'all',         // job list filter: all | waiting | active
};

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function emit(type, data) {
  for (const fn of listeners.get(type) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

export function sortedJobs() {
  return [...state.jobs.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function isRefusal(ev) {
  const d = String(ev && (ev.decision ?? ev.outcome ?? '')).toLowerCase();
  return /^(reject|rejected|refuse|refused|deny|denied)/.test(d) || ev?.kind === 'refused';
}

export function isAllowed(ev) {
  const d = String(ev && (ev.decision ?? ev.outcome ?? '')).toLowerCase();
  return /^(allow|allowed|approve|approved)/.test(d);
}

const RANK = { idle: 0, working: 1, waiting: 2, error: 3 };

// agent id -> 'working' | 'waiting' | 'error' | 'idle'
export function presence() {
  const out = new Map();
  const set = (id, s) => {
    if (!id) return;
    const cur = out.get(id) || 'idle';
    if (RANK[s] > RANK[cur]) out.set(id, s);
  };
  const org = state.org;
  const bossLead = org && org.boss && org.boss.lead ? org.boss.lead.id : null;
  const now = Date.now();
  for (const job of state.jobs.values()) {
    const lead = leadId(job);
    const pieces = Array.isArray(job.pieces) ? job.pieces : [];
    switch (job.state) {
      case 'routing': set(bossLead, 'working'); break;
      case 'planning': case 'combining': set(lead, 'working'); break;
      case 'working':
        set(lead, 'working');
        for (const p of pieces) if (['working', 'running', 'started'].includes(p.state)) set(p.agent, 'working');
        break;
      case 'waiting_approval':
        set(lead, 'waiting');
        for (const p of pieces) set(p.agent, 'waiting');
        break;
      case 'failed':
        if (now - Date.parse(job.updatedAt || 0) < 120000) set(lead, 'error');
        break;
      default: break;
    }
    if (!TERMINAL_STATES.has(job.state)) for (const p of pieces) if (['failed', 'error'].includes(p.state)) set(p.agent, 'error');
  }
  for (const [id, f] of state.flashes) {
    if (f.until < now) state.flashes.delete(id);
    else set(id, f.tone);
  }
  return out;
}

export function upsertJob(job) {
  if (!job || !job.id) return null;
  const prev = state.jobs.get(job.id) || null;
  const next = prev ? { ...prev, ...job } : job;
  if (prev && Array.isArray(prev.events) && !Array.isArray(job.events)) next.events = prev.events;
  state.jobs.set(job.id, next);
  return { prev, next };
}
