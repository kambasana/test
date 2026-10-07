// Audit view: a filterable table of the append-only audit log, with CSV export.
import { h, clear, put } from './dom.js';
import { state, isRefusal, isAllowed } from './store.js';
import { personLabel, deptName } from './org.js';

const KNOWN_KINDS = ['job.created', 'job.routed', 'job.planned', 'permission', 'file.read', 'file.write', 'approval', 'settings'];
const SHOWN = new Set(['ts', 'at', 'time', 'kind', 'type', 'dept', 'agent', 'job', 'text', 'decision', 'outcome']);

function when(e) {
  const t = Date.parse(e.ts || e.at || e.time);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function detail(e) {
  if (e.text) return String(e.text);
  const rest = Object.entries(e).filter(([k]) => !SHOWN.has(k));
  return rest.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

function csvCell(v) {
  const s = String(v ?? '');
  // neutralise spreadsheet formulas, then quote
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createAudit() {
  const dialog = h('dialog', { class: 'sheet sheet-audit', 'aria-labelledby': 'au-title' });
  put(document.body, dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  const dept = h('select', { id: 'au-dept' });
  const kind = h('select', { id: 'au-kind' });
  const q = h('input', { id: 'au-q', type: 'search', placeholder: 'Search text, ids, paths…', autocomplete: 'off' });
  const exportBtn = h('button', { type: 'button', class: 'btn' }, 'Export CSV');
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const tbody = h('tbody');
  const close = h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Close audit' }, '×');
  close.addEventListener('click', () => dialog.close());
  let rows = [];
  let timer = 0;

  put(dialog, 
    h('header', { class: 'sheet-head' },
      h('div', { class: 'sheet-head-text' }, h('h2', { id: 'au-title', class: 'sheet-title' }, 'Audit log'),
        h('p', { class: 'muted small' }, 'Every job step, permission decision, agent file read and write, approval and settings change. Newest first.')), close),
    h('div', { class: 'audit-filters' },
      h('div', { class: 'field' }, h('label', { for: 'au-dept' }, 'Department'), dept),
      h('div', { class: 'field' }, h('label', { for: 'au-kind' }, 'Kind'), kind),
      h('div', { class: 'field grow' }, h('label', { for: 'au-q' }, 'Search'), q),
      h('div', { class: 'field field-end' }, exportBtn)),
    count,
    h('div', { class: 'table-wrap' }, h('table', { class: 'audit-table' },
      h('caption', { class: 'sr-only' }, 'Audit entries'),
      h('thead', null, h('tr', null, ['Time', 'Kind', 'Department', 'Who', 'Decision', 'Detail'].map((t) => h('th', { scope: 'col' }, t)))),
      tbody)));

  function params() { return { dept: dept.value, kind: kind.value, q: q.value.trim(), limit: 500 }; }

  async function load() {
    count.textContent = 'Loading…';
    try {
      rows = await state.client.audit(params());
    } catch (e) { rows = []; count.textContent = e.message; return; }
    const kinds = new Set([...KNOWN_KINDS, ...rows.map((r) => r.kind || r.type).filter(Boolean)]);
    if (kind.options.length - 1 < kinds.size) {
      const cur = kind.value;
      put(clear(kind), h('option', { value: '' }, 'All kinds'), [...kinds].sort().map((k) => h('option', { value: k }, k)));
      kind.value = cur;
    }
    clear(tbody);
    for (const e of rows) {
      const refused = isRefusal(e); const allowed = isAllowed(e);
      put(tbody, h('tr', { class: refused ? 'is-refused' : '' },
        h('td', { class: 'mono nowrap' }, when(e)),
        h('td', { class: 'mono' }, e.kind || e.type || ''),
        h('td', null, e.dept ? deptName(state.org, e.dept) : '—'),
        h('td', null, e.agent ? personLabel(state.org, e.agent) : '—', e.job ? h('span', { class: 'mono muted small block' }, e.job) : null),
        h('td', null, refused ? h('span', { class: 'badge-refused' }, 'REFUSED') : allowed ? h('span', { class: 'badge-allowed' }, 'ALLOWED') : e.decision ? h('span', { class: 'mono' }, String(e.decision)) : '—'),
        h('td', { class: 'detail' }, detail(e))));
    }
    count.textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
  }

  dept.addEventListener('change', load);
  kind.addEventListener('change', load);
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  exportBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    if (typeof state.client.auditCsvUrl === 'function') {
      a.href = state.client.auditCsvUrl(params());
    } else {
      const head = ['time', 'kind', 'dept', 'agent', 'job', 'decision', 'detail'];
      const lines = [head.map(csvCell).join(',')].concat(rows.map((e) => [e.ts, e.kind, e.dept, e.agent, e.job, e.decision, detail(e)].map(csvCell).join(',')));
      a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    put(document.body, a); a.click(); a.remove();
  });

  return {
    open() {
      put(clear(dept), h('option', { value: '' }, 'All departments'), state.org.departments.map((d) => h('option', { value: d.key }, d.name)));
      if (!kind.options.length) put(clear(kind), h('option', { value: '' }, 'All kinds'), KNOWN_KINDS.map((k) => h('option', { value: k }, k)));
      if (!dialog.open) dialog.showModal();
      load();
    },
    refresh() { if (dialog.open) { clearTimeout(timer); timer = setTimeout(load, 600); } },
  };
}
