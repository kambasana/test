// Departments panel: switch departments on/off (applies on restart) and wings.
import { h, clear, put } from './dom.js';
import { state } from './store.js';

export function safeWingUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url), location.href);
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

export function createDepartments() {
  const dialog = h('dialog', { class: 'sheet sheet-depts', 'aria-labelledby': 'dp-title' });
  put(document.body, dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  let want = new Map();

  function build() {
    clear(dialog);
    const org = state.org;
    want = new Map(org.departments.filter((d) => !d.boss).map((d) => [d.key, d.on]));
    const status = h('p', { class: 'dp-status', role: 'status' });
    const close = h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Close departments' }, '×');
    close.addEventListener('click', () => dialog.close());
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Save');
    const list = h('ul', { class: 'dp-list' });
    for (const d of org.departments) {
      if (d.boss) {
        put(list, h('li', { class: 'dp-row' },
          h('span', { class: 'swatch', style: { background: d.color } }),
          h('div', { class: 'dp-text' }, h('strong', null, `${d.name}`), h('span', { class: 'muted small' }, 'Command. Always on: it routes work to the others.'))));
        continue;
      }
      const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(d.on), 'aria-label': `${d.name} on` }, h('span', { class: 'switch-knob' }));
      const people = (d.lead ? 1 : 0) + d.teams.reduce((a, t) => a + t.people.length, 0);
      sw.addEventListener('click', () => {
        const next = sw.getAttribute('aria-checked') !== 'true';
        const onCount = [...want.values()].filter(Boolean).length;
        if (!next && onCount <= 1) { status.textContent = 'At least one department has to stay on.'; return; }
        want.set(d.key, next);
        sw.setAttribute('aria-checked', String(next));
        status.textContent = '';
      });
      put(list, h('li', { class: 'dp-row' },
        h('span', { class: 'swatch', style: { background: d.color } }),
        h('div', { class: 'dp-text' }, h('strong', null, d.name), h('span', { class: 'muted small' }, `${d.teams.map((t) => t.name).join(' · ')} — ${people} people`), d.about ? h('span', { class: 'small' }, d.about) : null),
        sw));
    }
    save.addEventListener('click', async () => {
      const off = [...want].filter(([, on]) => !on).map(([k]) => k);
      save.disabled = true;
      try {
        await state.client.setDepartments(off);
        status.textContent = state.mode === 'demo'
          ? 'Saved. Restart to apply — in demo mode, reload the page.'
          : 'Saved to settings.local.json. Restart the office to apply.';
      } catch (e) { status.textContent = e.message; } finally { save.disabled = false; }
    });

    const wings = (org.office.wings || []).map((w) => ({ name: String(w.name || ''), url: safeWingUrl(w.url) })).filter((w) => w.name);
    put(dialog, 
      h('header', { class: 'sheet-head' },
        h('div', { class: 'sheet-head-text' }, h('h2', { id: 'dp-title', class: 'sheet-title' }, 'Departments'),
          h('p', { class: 'muted small' }, 'A switched-off department stays on the floor as a dashed outline with its name. It takes no jobs, the Boss never routes to it, and the server refuses jobs for it. At least one department stays on. Changes apply when the office restarts.')), close),
      list,
      h('div', { class: 'dp-foot' }, status, save),
      h('section', { class: 'dp-wings' },
        h('h3', { class: 'section-title' }, 'Wings'),
        h('p', { class: 'muted small' }, 'Each wing is a separate office with its own org, library, data and sandbox.'),
        wings.length ? h('ul', { class: 'wing-list' }, wings.map((w) => h('li', null,
          w.url ? h('a', { href: w.url, class: 'wing-link' }, w.name) : h('span', null, w.name),
          w.name === org.office.wing ? h('span', { class: 'tag' }, 'THIS WING') : null,
          w.url ? h('span', { class: 'mono muted small' }, ` ${w.url}`) : null))) : h('p', { class: 'muted' }, 'No other wings configured.')));
  }

  return { open() { build(); dialog.showModal(); } };
}
