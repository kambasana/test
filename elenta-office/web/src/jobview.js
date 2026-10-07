// Job view: request, routing, plan, live activity, deliverable, approval.
import { h, clear, clock, timeAgo, put } from './dom.js';
import { state, isRefusal, isAllowed } from './store.js';
import { STATE_LABEL, TERMINAL_STATES } from './constants.js';
import { deptName, personLabel, leadId } from './org.js';
import { renderMarkdown } from './markdown.js';
import { stateChip, routedLine, pieceTeam } from './work.js';

const KIND_LABEL = { thinking: 'THINKING', tool: 'TOOL', read: 'READ', write: 'WRITE', done: 'DONE', error: 'ERROR', plan: 'PLAN', message: 'SAYS' };

// Servers may shorten titles with an ellipsis; show the request instead of
// clipped text when it is short enough to read as a heading.
export function fullTitle(job) {
  const t = String(job.title || '');
  const text = String(job.text || '');
  if ((!t || /…$|\.\.\.$/.test(t)) && text && text.length <= 200) return text.split('\n')[0];
  return t || text;
}

export function createJobView({ onDecide, onCancel, onRevise, onFocusPerson }) {
  const dialog = h('dialog', { class: 'sheet sheet-job', 'aria-labelledby': 'jv-title' });
  put(document.body, dialog);
  let job = null;
  let lastState = null;
  let eventCount = 0;
  let deliverableFor = null;
  const s = {};

  dialog.addEventListener('close', () => { job = null; });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  function scaffold() {
    clear(dialog);
    s.title = h('h2', { id: 'jv-title', class: 'sheet-title', tabindex: '-1' });
    s.meta = h('div', { class: 'sheet-meta' });
    const close = h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Close job view' }, '×');
    close.addEventListener('click', () => dialog.close());
    s.request = h('div', { class: 'jv-section' });
    s.plan = h('div', { class: 'jv-section' });
    s.feed = h('ol', { class: 'feed', 'aria-label': 'Activity' });
    s.deliverable = h('div', { class: 'jv-section jv-deliverable' });
    s.actions = h('div', { class: 'jv-actions' });
    s.status = h('p', { class: 'form-error', role: 'alert' });
    put(dialog, 
      h('header', { class: 'sheet-head' }, h('div', { class: 'sheet-head-text' }, s.title, s.meta), close),
      h('div', { class: 'jv-grid' },
        h('div', { class: 'jv-main' }, s.request, s.plan, s.deliverable),
        h('div', { class: 'jv-side' }, h('h3', { class: 'section-title' }, 'Live activity'), s.feed)),
      h('footer', { class: 'sheet-foot' }, s.status, s.actions));
  }

  function renderHead() {
    s.title.textContent = fullTitle(job);
    clear(s.meta);
    const d = state.org.byKey.get(job.dept);
    put(s.meta, stateChip(job.state),
      h('span', { class: 'job-dept' }, h('span', { class: 'swatch', style: { background: d ? d.color : '#8B98A9' } }), deptName(state.org, job.dept)),
      h('span', { class: 'mono muted' }, (job.mode || 'team').toUpperCase()),
      h('span', { class: 'mono muted' }, job.id),
      h('span', { class: 'muted' }, `created ${timeAgo(job.createdAt)}`));
  }

  function renderRequest() {
    clear(s.request);
    put(s.request, h('h3', { class: 'section-title' }, 'Request'), h('p', { class: 'jv-text' }, job.text || ''));
    if (job.routedBy) put(s.request, h('div', { class: 'jv-routed' }, routedLine(job)));
    if (job.note) put(s.request, h('p', { class: 'jv-note' }, h('strong', null, 'Owner note: '), job.note));
    if (job.error || job.reason) put(s.request, h('p', { class: 'jv-note tone-error' }, String(job.error || job.reason)));
  }

  function renderPlan() {
    clear(s.plan);
    const pieces = Array.isArray(job.pieces) ? job.pieces : [];
    const lead = leadId(job);
    put(s.plan, h('h3', { class: 'section-title' }, 'Plan'));
    if (lead) put(s.plan, h('p', { class: 'muted small' }, `Lead: ${personLabel(state.org, lead)}`));
    const why = job.plan && job.plan.why ? job.plan.why : job.why;
    if (why) put(s.plan, h('p', { class: 'jv-why' }, why));
    if (!pieces.length) {
      put(s.plan, h('p', { class: 'muted' }, ['queued', 'routing', 'planning'].includes(job.state) ? 'The lead is still splitting the work.' : 'No pieces.'));
      return;
    }
    const groups = new Map();
    for (const p of pieces) { const t = pieceTeam(p); if (!groups.has(t)) groups.set(t, []); groups.get(t).push(p); }
    const wrap = h('div', { class: 'plan' });
    for (const [team, ps] of groups) {
      put(wrap, h('div', { class: 'plan-team' },
        h('h4', { class: 'plan-team-name' }, team),
        h('ul', { class: 'plan-pieces' }, ps.map((p) => {
          const fileBtn = p.file || p.state === 'done' ? h('button', { type: 'button', class: 'btn btn-small' }, 'Open file') : null;
          const body = h('div', { class: 'piece-file', hidden: true });
          if (fileBtn) {
            fileBtn.addEventListener('click', async () => {
              if (!body.hidden) { body.hidden = true; fileBtn.textContent = 'Open file'; return; }
              fileBtn.disabled = true;
              try {
                const text = await state.client.file(job.id, p.file || `${p.id}.md`);
                put(clear(body), renderMarkdown(text));
              } catch (e) { put(clear(body), h('p', { class: 'muted' }, e.message)); }
              body.hidden = false; fileBtn.disabled = false; fileBtn.textContent = 'Hide file';
            });
          }
          const who = h('button', { type: 'button', class: 'link-btn' }, personLabel(state.org, p.agent));
          who.addEventListener('click', () => onFocusPerson(p.agent));
          return h('li', { class: 'piece' },
            h('div', { class: 'piece-row' },
              h('div', { class: 'piece-text' }, h('span', { class: 'piece-title' }, p.title || p.text || p.id), h('span', { class: 'piece-who' }, who), p.file ? h('span', { class: 'piece-path mono muted' }, /^out\//.test(p.file) ? p.file : `out/${p.file}`) : null),
              stateChip(p.state === 'working' || p.state === 'running' ? 'working' : p.state),
              fileBtn),
            p.summary ? h('p', { class: 'piece-summary muted small' }, p.summary) : null,
            body);
        }))));
    }
    put(s.plan, wrap);
  }

  function eventItem(ev) {
    const refused = isRefusal(ev);
    const allowed = isAllowed(ev);
    const kind = String(ev.kind || ev.type || 'event');
    const d = state.org.people.get(ev.agent);
    return h('li', { class: `feed-item kind-${kind.replace(/[^a-z_-]/gi, '')}${refused ? ' is-refused' : ''}` },
      h('span', { class: 'feed-time mono' }, clock(ev.ts || ev.t || ev.at || ev.time)),
      h('span', { class: 'feed-body' },
        h('span', { class: 'feed-who' },
          d ? h('span', { class: 'swatch', style: { background: d.dept.color } }) : null,
          personLabel(state.org, ev.agent) || 'OFFICE'),
        h('span', { class: 'feed-kind mono' }, KIND_LABEL[kind] || kind.toUpperCase()),
        refused ? h('span', { class: 'badge-refused' }, 'REFUSED') : allowed && kind !== 'read' ? h('span', { class: 'badge-allowed' }, 'ALLOWED') : null,
        h('span', { class: 'feed-text' }, String(ev.text ?? ev.title ?? ev.tool ?? ''))));
  }

  function renderFeed(reset) {
    const evs = Array.isArray(job.events) ? job.events : [];
    if (reset || evs.length < eventCount) { clear(s.feed); eventCount = 0; }
    const atBottom = s.feed.scrollHeight - s.feed.scrollTop - s.feed.clientHeight < 40;
    for (let i = eventCount; i < evs.length; i++) put(s.feed, eventItem(evs[i]));
    eventCount = evs.length;
    if (!evs.length && !s.feed.firstChild) put(s.feed, h('li', { class: 'muted feed-empty' }, 'Nothing yet.'));
    else s.feed.querySelector('.feed-empty')?.remove();
    if (atBottom || reset) s.feed.scrollTop = s.feed.scrollHeight;
  }

  async function renderDeliverable() {
    const ready = ['waiting_approval', 'done', 'rejected'].includes(job.state);
    if (!ready) {
      put(clear(s.deliverable), h('h3', { class: 'section-title' }, 'Deliverable'), h('p', { class: 'muted' }, TERMINAL_STATES.has(job.state) ? 'No deliverable.' : 'Appears here once the lead has combined the pieces.'));
      deliverableFor = null;
      return;
    }
    const sig = `${job.id}:${job.state}`;
    if (deliverableFor === sig) return;
    deliverableFor = sig;
    put(clear(s.deliverable), h('h3', { class: 'section-title' }, 'Deliverable', h('span', { class: 'mono muted small' }, '  out/deliverable.md')), h('p', { class: 'muted' }, 'Loading…'));
    let text = typeof job.deliverable === 'string' && job.deliverable ? job.deliverable : null;
    if (text == null) {
      try { text = await state.client.file(job.id, (job.output && job.output.path) || 'deliverable.md'); } catch { /* fall back below */ }
    }
    if (text == null && job.output) text = typeof job.output === 'string' ? job.output : job.output.text || null;
    if (!job || `${job.id}:${job.state}` !== sig) return;
    put(clear(s.deliverable), h('h3', { class: 'section-title' }, 'Deliverable', h('span', { class: 'mono muted small' }, '  out/deliverable.md')),
      text ? h('div', { class: 'doc' }, renderMarkdown(text)) : h('p', { class: 'muted' }, 'The deliverable file could not be loaded.'));
  }

  function renderActions() {
    clear(s.actions);
    s.status.textContent = '';
    const busy = (btn, fn) => async () => {
      btn.disabled = true; s.status.textContent = '';
      try { await fn(); } catch (e) { s.status.textContent = e.message || String(e); } finally { btn.disabled = false; }
    };
    if (job.state === 'waiting_approval') {
      const note = h('textarea', { id: 'jv-note', rows: 2, placeholder: 'What should change? The note becomes a lesson for the department.' });
      const approve = h('button', { type: 'button', class: 'btn btn-approve' }, 'Approve');
      const reject = h('button', { type: 'button', class: 'btn btn-reject' }, 'Reject with note');
      approve.addEventListener('click', busy(approve, () => onDecide(job.id, { decision: 'approve' })));
      reject.addEventListener('click', busy(reject, async () => {
        if (!note.value.trim()) { note.focus(); throw new Error('Add a note so the department can learn from it.'); }
        await onDecide(job.id, { decision: 'reject', note: note.value.trim() });
      }));
      put(s.actions, h('div', { class: 'field grow' }, h('label', { for: 'jv-note' }, 'Note (for a rejection)'), note), h('div', { class: 'btn-row' }, reject, approve));
    } else if (!TERMINAL_STATES.has(job.state)) {
      const cancel = h('button', { type: 'button', class: 'btn btn-reject' }, 'Cancel job');
      cancel.addEventListener('click', busy(cancel, () => onCancel(job.id)));
      put(s.actions, h('p', { class: 'muted grow' }, `${STATE_LABEL[job.state] || job.state}: the department is on it. You will be asked to approve the result.`), cancel);
    } else if (job.state === 'rejected') {
      const revise = h('button', { type: 'button', class: 'btn btn-primary' }, 'Revise');
      revise.addEventListener('click', busy(revise, () => onRevise(job)));
      put(s.actions, h('p', { class: 'muted grow' }, 'Rejected. Revise sends it back to the department with your note.'), revise);
    } else if (job.state === 'done') {
      put(s.actions, h('p', { class: 'muted grow' }, 'Approved. The output was copied to the deliverables folder.'));
    } else {
      put(s.actions, h('p', { class: 'muted grow' }, `${STATE_LABEL[job.state] || job.state}.`));
    }
  }

  function render(full) {
    renderHead(); renderRequest(); renderPlan(); renderFeed(full);
    renderDeliverable();
    if (full || lastState !== job.state) renderActions();
    lastState = job.state;
  }

  return {
    get openId() { return dialog.open && job ? job.id : null; },
    async open(id) {
      const cached = state.jobs.get(id);
      scaffold();
      job = cached || { id, title: 'Loading…', events: [], pieces: [] };
      deliverableFor = null; eventCount = 0; lastState = null;
      render(true);
      if (!dialog.open) dialog.showModal();
      s.title.focus();
      try {
        const fresh = await state.client.job(id);
        if (job && job.id === id && fresh) { job = { ...job, ...fresh }; render(true); }
      } catch (e) { s.status.textContent = e.message; }
    },
    update(next) {
      if (!job || !next || next.id !== job.id) return;
      job = { ...job, ...next };
      if (!Array.isArray(next.events) && Array.isArray(state.jobs.get(job.id)?.events)) job.events = state.jobs.get(job.id).events;
      render(false);
    },
    addEvent(ev) {
      if (!job || !ev || ev.job !== job.id) return;
      if (!Array.isArray(job.events)) job.events = [];
      const evs = job.events;
      const last = evs[evs.length - 1];
      if (last && (last.ts || last.t) === (ev.ts || ev.t) && last.text === ev.text && last.agent === ev.agent) return;
      evs.push(ev);
      renderFeed(false);
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
