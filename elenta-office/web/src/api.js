// Live client: talks to the office server over the HTTP API and the
// Server-Sent Events stream (SPEC section 7). Same interface as demo.js.

function asList(x, ...keys) {
  if (Array.isArray(x)) return x;
  for (const k of keys) if (x && Array.isArray(x[k])) return x[k];
  return [];
}

async function call(method, url, body) {
  const init = { method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(url, init); } catch { throw new Error('The office server is not reachable.'); }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = data && typeof data === 'object' ? (data.error || data.message) : '';
    throw new Error(msg || `The server answered ${res.status}.`);
  }
  return data;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export async function probeHealth(timeoutMs = 2500) {
  if (location.protocol === 'file:') return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function createLiveClient() {
  return {
    mode: 'live',
    health: () => call('GET', '/api/health'),
    org: () => call('GET', '/api/org'),
    jobs: async () => asList(await call('GET', '/api/jobs'), 'jobs'),
    job: async (id) => {
      const d = await call('GET', `/api/jobs/${encodeURIComponent(id)}`);
      return d && d.job && !d.id ? d.job : d;
    },
    createJob: async (body) => {
      const d = await call('POST', '/api/jobs', body);
      return d && d.job && !d.id ? d.job : d;
    },
    cancel: (id) => call('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`, {}),
    revise: (id, note) => call('POST', `/api/jobs/${encodeURIComponent(id)}/revise`, { note }),
    approvals: async () => asList(await call('GET', '/api/approvals'), 'approvals', 'jobs'),
    decide: (id, body) => call('POST', `/api/approvals/${encodeURIComponent(id)}`, body),
    audit: async (params) => asList(await call('GET', `/api/audit${qs(params)}`), 'entries', 'audit', 'items'),
    auditCsvUrl: (params) => `/api/audit${qs({ ...params, format: 'csv' })}`,
    library: async () => asList(await call('GET', '/api/library'), 'notes', 'index', 'items'),
    note: (path) => call('GET', `/api/library/note${qs({ path })}`),
    file: async (job, path) => {
      const d = await call('GET', `/api/files${qs({ job, path })}`);
      if (typeof d === 'string') return d;
      return d && (d.text ?? d.content ?? '');
    },
    setDepartments: (off) => call('POST', '/api/departments', { off }),
    subscribe(handler) {
      let es = null; let closed = false; let retry = 1000;
      const parse = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
      const open = () => {
        if (closed) return;
        es = new EventSource('/api/events');
        es.onopen = () => { retry = 1000; handler('status', { connected: true }); };
        es.addEventListener('job', (e) => { const d = parse(e); if (d) handler('job', d.job && !d.id ? d.job : d); });
        es.addEventListener('activity', (e) => { const d = parse(e); if (d) handler('activity', d); });
        es.onmessage = (e) => {
          const d = parse(e);
          if (d && (d.type === 'job' || d.type === 'activity')) handler(d.type, d.data || d);
        };
        es.onerror = () => {
          handler('status', { connected: false });
          if (es.readyState === EventSource.CLOSED) {
            es.close();
            setTimeout(open, retry);
            retry = Math.min(retry * 2, 15000);
          }
        };
      };
      open();
      return () => { closed = true; if (es) es.close(); };
    },
  };
}
