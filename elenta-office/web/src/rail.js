// Left rail: the organisation as a tree (department -> sub-team -> people)
// with live state dots. Clicking focuses the floor.
import { h, clear } from './dom.js';
import { state } from './store.js';

const TONE = { working: 'live', waiting: 'waiting', error: 'error', idle: 'idle' };
const WORD = { working: 'working', waiting: 'waiting for approval', error: 'refused or failed', idle: 'idle' };

export function createRail(root, { onFocus }) {
  const dots = new Map(); // person id -> { dot, sr }
  const deptRows = new Map(); // key -> { row, sum }
  const expanded = new Set();
  let lastBuiltFor = null;

  function personRow(p, isLead) {
    const dot = h('span', { class: 'dot tone-idle', 'aria-hidden': 'true' });
    const sr = h('span', { class: 'sr-only' }, ', idle');
    const btn = h('button', { type: 'button', class: `tree-person${isLead ? ' is-lead' : ''}`, dataset: { person: p.id } },
      dot,
      h('span', { class: 'tree-person-text' },
        h('span', { class: 'tree-person-name' }, p.name),
        p.role ? h('span', { class: 'tree-person-role' }, p.role) : null),
      sr);
    btn.addEventListener('click', () => onFocus({ dept: state.org.people.get(p.id).dept.key, person: p.id }));
    dots.set(p.id, { dot, sr });
    return h('li', null, btn);
  }

  function build() {
    const org = state.org;
    if (!lastBuiltFor) org.departments.forEach((d) => { if (d.on) expanded.add(d.key); });
    clear(root);
    dots.clear(); deptRows.clear();
    root.append(
      h('div', { class: 'rail-head' },
        h('h2', { class: 'panel-title' }, 'Organisation'),
        h('p', { class: 'rail-sub' }, `${org.departments.length} departments · ${org.headcount} people`)),
    );
    const list = h('ul', { class: 'tree' });
    for (const d of org.departments) {
      const count = (d.lead ? 1 : 0) + d.teams.reduce((a, t) => a + t.people.length, 0);
      const open = expanded.has(d.key);
      const kids = h('ul', { class: 'tree-kids', id: `tree-${d.key}`, hidden: !open });
      if (d.lead) kids.append(personRow(d.lead, true));
      for (const t of d.teams) {
        const teamBtn = h('button', { type: 'button', class: 'tree-team' }, h('span', { class: 'tree-team-name' }, t.name), h('span', { class: 'mono muted' }, String(t.people.length)));
        teamBtn.addEventListener('click', () => onFocus({ dept: d.key }));
        kids.append(h('li', { class: 'tree-team-li' }, teamBtn, h('ul', { class: 'tree-people' }, t.people.map((p) => personRow(p, false)))));
      }
      const toggle = h('button', { type: 'button', class: 'tree-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': `tree-${d.key}`, 'aria-label': `Show ${d.name} sub-teams` },
        h('span', { class: 'chev', 'aria-hidden': 'true' }));
      toggle.addEventListener('click', () => {
        const now = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(now));
        kids.hidden = !now;
        if (now) expanded.add(d.key); else expanded.delete(d.key);
      });
      const sum = h('span', { class: 'tree-sum mono' });
      const row = h('button', { type: 'button', class: `tree-dept${d.on ? '' : ' is-off'}`, dataset: { dept: d.key } },
        h('span', { class: 'swatch', style: { background: d.color }, 'aria-hidden': 'true' }),
        h('span', { class: 'tree-dept-name' }, d.boss ? `${d.name}` : d.name),
        d.boss ? h('span', { class: 'tag' }, 'COMMAND') : null,
        d.on ? null : h('span', { class: 'tag tag-off' }, 'OFF'),
        h('span', { class: 'tree-count mono' }, String(count)),
        sum);
      row.addEventListener('click', () => {
        onFocus({ dept: d.key });
        if (!expanded.has(d.key)) toggle.click();
      });
      deptRows.set(d.key, { row, sum });
      list.append(h('li', { class: 'tree-dept-li' }, h('div', { class: 'tree-dept-row' }, toggle, row), kids));
    }
    root.append(list);
    if (org.problems.length) {
      root.append(h('div', { class: 'rail-problems', role: 'note' },
        h('h3', null, 'Org file problems'),
        h('ul', null, org.problems.map((p) => h('li', null, p)))));
    }
    lastBuiltFor = org;
  }

  return {
    render() { if (lastBuiltFor !== state.org) build(); },
    setPresence(map) {
      const per = new Map();
      for (const [id, { dot, sr }] of dots) {
        const st = map.get(id) || 'idle';
        dot.className = `dot tone-${TONE[st]}`;
        sr.textContent = `, ${WORD[st]}`;
        const dk = state.org.people.get(id)?.dept.key;
        if (!dk) continue;
        const c = per.get(dk) || { working: 0, waiting: 0, error: 0 };
        if (st !== 'idle') c[st]++;
        per.set(dk, c);
      }
      for (const [k, { sum }] of deptRows) {
        const c = per.get(k) || {};
        clear(sum);
        if (c.working) sum.append(h('span', { class: 'sum tone-live', title: 'working' }, String(c.working)));
        if (c.waiting) sum.append(h('span', { class: 'sum tone-waiting', title: 'waiting for approval' }, String(c.waiting)));
        if (c.error) sum.append(h('span', { class: 'sum tone-error', title: 'refused or failed' }, String(c.error)));
      }
    },
    setFocus(sel) {
      for (const [k, { row }] of deptRows) row.classList.toggle('is-focus', !!sel && sel.dept === k);
      for (const el of root.querySelectorAll('.tree-person')) el.classList.toggle('is-focus', !!sel && sel.person === el.dataset.person);
      if (sel && sel.dept && !expanded.has(sel.dept)) {
        const toggle = deptRows.get(sel.dept)?.row.previousElementSibling;
        if (toggle) toggle.click();
      }
    },
  };
}
