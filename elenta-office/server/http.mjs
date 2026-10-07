// HTTP server: request guards (SPEC §6), JSON API and Server-Sent Events (SPEC §7), static files.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { containedPath } from './paths.mjs';
import { toCsv, AUDIT_KINDS } from './audit.mjs';
import { JobError } from './jobs.mjs';
import { countPeople } from './org.mjs';
import { computeLayout } from './layout.mjs';
import { saveLocalSettings } from './settings.mjs';
import { adapterInfo } from './acp.mjs';
import { PRODUCT_NAME, VERSION } from './util.mjs';

export const MAX_BODY = 1024 * 1024;
export const CSP = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};

/**
 * Pure request guard. Returns null when the request may proceed, or { status, error }.
 * @param {{method:string, headers:Record<string,string|undefined>}} req
 * @param {{port:number, allowedHosts?:string[]}} o
 */
export function guardRequest(req, { port, allowedHosts = [] }) {
  const host = String(req.headers.host || '').toLowerCase();
  const okHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...allowedHosts.map((h) => h.toLowerCase())]);
  if (!okHosts.has(host)) return { status: 403, error: 'This office only answers on its own local address.' };
  const method = req.method || 'GET';
  if (method === 'GET' || method === 'HEAD') return null;
  if (method !== 'POST') return { status: 405, error: 'Method not allowed.' };
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const okOrigins = new Set([...okHosts].map((h) => `http://${h}`));
    if (!okOrigins.has(String(origin).toLowerCase())) return { status: 403, error: 'Requests from other sites are refused.' };
  }
  const ct = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (ct !== 'application/json') return { status: 415, error: 'Send the body as application/json.' };
  const len = req.headers['content-length'];
  if (len !== undefined && Number(len) > MAX_BODY) return { status: 413, error: 'The body is larger than 1 MB.' };
  return null;
}

function baseHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
    ...extra,
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }));
  res.end(body);
}
function sendError(res, status, message) { sendJson(res, status, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('The body is larger than 1 MB.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        const v = JSON.parse(text);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject(Object.assign(new Error('The body is not a JSON object.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${PRODUCT_NAME}</title></head>
<body style="font-family:sans-serif;background:#0E1116;color:#E6EDF3;padding:2rem">
<h1>${PRODUCT_NAME}</h1><p>The server is running, but the interface has not been built yet. Run <code>npm run build</code>.</p>
<p>The API is at <code>/api/health</code>.</p></body></html>`;

/**
 * @param {object} ctx { settings, paths, org, orgProblems, library, audit, engine, bus, settingsProblems }
 */
export function createOfficeServer(ctx) {
  const { settings, paths, library, audit, engine, bus } = ctx;
  const clients = new Set();
  let port = settings.port;

  const send = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) { try { res.write(payload); } catch {} }
  };
  bus.on('job', (j) => send('job', j));
  bus.on('activity', (a) => send('activity', a));
  bus.on('library', (l) => send('library', { notes: l.length }));
  const heartbeat = setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch {} } }, 25000);
  heartbeat.unref();

  const orgView = () => {
    const org = ctx.org;
    return {
      office: { name: org?.title || PRODUCT_NAME, product: PRODUCT_NAME, wing: settings.wing || org?.title || PRODUCT_NAME, wings: settings.wings },
      departments: (org?.departments || []).map((d) => ({
        key: d.key, name: d.name, about: d.about, boss: d.boss, color: d.color, on: d.on, lead: d.lead,
        teams: d.teams.map((t) => ({ name: t.name, people: t.people.map((p) => ({ id: p.id, name: p.name, role: p.role, does: p.does })) })),
      })),
      layout: org ? computeLayout(org.departments) : null,
      problems: [...ctx.orgProblems, ...ctx.settingsProblems],
    };
  };

  const routes = async (req, res, url) => {
    const p = url.pathname;
    const m = req.method;
    const q = url.searchParams;
    let match;

    if (m === 'GET' && p === '/api/health') {
      return sendJson(res, 200, {
        ok: !!ctx.org, product: PRODUCT_NAME, version: VERSION, org: ctx.org?.title || null,
        wing: settings.wing || ctx.org?.title || null,
        departments: ctx.org?.departments.length || 0, people: countPeople(ctx.org),
        acp: adapterInfo(),
      });
    }
    if (m === 'GET' && p === '/api/org') return sendJson(res, 200, orgView());
    if (m === 'POST' && p === '/api/departments') {
      const body = await readBody(req);
      if (!ctx.org) return sendError(res, 409, 'The org file has problems; fix it first.');
      if (!Array.isArray(body.off) || !body.off.every((k) => typeof k === 'string')) return sendError(res, 400, 'Send { "off": [department keys] }.');
      const keys = ctx.org.departments.map((d) => d.key);
      const unknown = body.off.filter((k) => !keys.includes(k));
      if (unknown.length) return sendError(res, 400, `Unknown department(s): ${unknown.join(', ')}.`);
      if (body.off.length >= keys.length) return sendError(res, 400, 'At least one department must stay on.');
      const departments = Object.fromEntries(keys.map((k) => [k, { on: !body.off.includes(k) }]));
      saveLocalSettings(paths.local, { departments });
      audit.write('settings', `Departments switched off: ${body.off.join(', ') || 'none'} (applies on restart).`, { off: body.off });
      return sendJson(res, 200, { ok: true, off: body.off, restartRequired: true });
    }
    if (m === 'GET' && p === '/api/jobs') return sendJson(res, 200, { jobs: engine.list() });
    if (m === 'POST' && p === '/api/jobs') {
      const body = await readBody(req);
      const job = engine.create({ dept: body.dept, text: body.text, mode: body.mode });
      return sendJson(res, 201, engine.summary(job));
    }
    if ((match = p.match(/^\/api\/jobs\/([a-z0-9-]{1,64})$/))) {
      if (m !== 'GET') return sendError(res, 405, 'Method not allowed.');
      const j = engine.detail(match[1]);
      return j ? sendJson(res, 200, j) : sendError(res, 404, 'No such job.');
    }
    if (m === 'POST' && (match = p.match(/^\/api\/jobs\/([a-z0-9-]{1,64})\/cancel$/))) {
      await readBody(req);
      return sendJson(res, 200, engine.summary(engine.cancel(match[1])));
    }
    if (m === 'POST' && (match = p.match(/^\/api\/jobs\/([a-z0-9-]{1,64})\/revise$/))) {
      const body = await readBody(req);
      return sendJson(res, 201, engine.summary(engine.revise(match[1], body.note)));
    }
    if (m === 'GET' && p === '/api/approvals') return sendJson(res, 200, { jobs: engine.list().filter((j) => j.state === 'waiting_approval') });
    if (m === 'POST' && (match = p.match(/^\/api\/approvals\/([a-z0-9-]{1,64})$/))) {
      const body = await readBody(req);
      return sendJson(res, 200, engine.summary(engine.decide(match[1], { decision: body.decision, note: body.note })));
    }
    if (m === 'GET' && p === '/api/audit') {
      const entries = audit.query({ dept: q.get('dept') || undefined, kind: q.get('kind') || undefined, q: q.get('q') || undefined, job: q.get('job') || undefined, limit: q.get('limit') || undefined });
      if (q.get('format') === 'csv') {
        const body = toCsv(entries);
        res.writeHead(200, baseHeaders({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"', 'Cache-Control': 'no-store' }));
        return res.end(body);
      }
      return sendJson(res, 200, { entries, kinds: AUDIT_KINDS });
    }
    if (m === 'GET' && p === '/api/library') return sendJson(res, 200, { notes: library.index });
    if (m === 'GET' && p === '/api/library/note') {
      const rel = q.get('path') || '';
      try {
        const text = library.readNote(rel);
        return sendJson(res, 200, { path: rel, text });
      } catch (err) { return sendError(res, 404, err.message || 'Not found.'); }
    }
    if (m === 'GET' && p === '/api/files') {
      const job = engine.get(q.get('job') || '');
      if (!job) return sendError(res, 404, 'No such job.');
      const f = engine.outFile(job, q.get('path') || '');
      if (!f || !statSync(f).isFile()) return sendError(res, 404, 'No such file in this job.');
      const ext = extname(f).toLowerCase();
      const type = ext === '.md' ? 'text/markdown; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
      res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" }));
      return res.end(readFileSync(f));
    }
    if (m === 'GET' && p === '/api/events') {
      res.writeHead(200, baseHeaders({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' }));
      res.write('retry: 3000\n\n');
      res.write(`event: hello\ndata: ${JSON.stringify({ product: PRODUCT_NAME, version: VERSION })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    return sendError(res, 404, 'No such API route.');
  };

  const serveStatic = (req, res, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method not allowed.');
    const root = paths.web;
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    rel = rel.replace(/^\/+/, '');
    let file = null;
    if (existsSync(root)) {
      try { file = containedPath(root, rel); } catch { return sendError(res, 404, 'Not found.'); }
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(rel)) return sendError(res, 404, 'Not found.');
        file = join(root, 'index.html');
      }
    }
    if (!file || !existsSync(file)) {
      res.writeHead(200, baseHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }));
      return res.end(req.method === 'HEAD' ? undefined : FALLBACK_HTML);
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, baseHeaders({ 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'no-cache' }));
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  };

  const server = createServer(async (req, res) => {
    const denied = guardRequest(req, { port, allowedHosts: settings.allowedHosts });
    if (denied) return sendError(res, denied.status, denied.error);
    let url;
    try { url = new URL(req.url, `http://localhost:${port}`); } catch { return sendError(res, 400, 'Bad URL.'); }
    try {
      if (url.pathname.startsWith('/api/')) await routes(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      const status = err instanceof JobError ? err.status : err.status || 500;
      if (status >= 500) audit.write('error', `HTTP ${req.method} ${url.pathname}: ${err.message}`);
      if (!res.headersSent) sendError(res, status, status >= 500 ? 'Something went wrong in the office server.' : err.message);
      else res.end();
    }
  });
  server.on('listening', () => { port = server.address().port; });
  server.closeClients = () => { for (const r of clients) { try { r.end(); } catch {} } clients.clear(); clearInterval(heartbeat); };
  return server;
}
