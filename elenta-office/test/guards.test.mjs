import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRequest, CSP } from '../server/http.mjs';
import { startOffice } from '../server/office.mjs';
import { isolatedEnv, fakeRunner } from './helpers.mjs';

const P = 4180;
const req = (method, headers) => ({ method, headers });
const json = { 'content-type': 'application/json' };

test('Host must be this office on loopback (or an allowed host)', () => {
  assert.equal(guardRequest(req('GET', { host: `localhost:${P}` }), { port: P }), null);
  assert.equal(guardRequest(req('GET', { host: `127.0.0.1:${P}` }), { port: P }), null);
  assert.equal(guardRequest(req('GET', { host: `localhost:9999` }), { port: P }).status, 403);
  assert.equal(guardRequest(req('GET', { host: `evil.example:${P}` }), { port: P }).status, 403);
  assert.equal(guardRequest(req('GET', {}), { port: P }).status, 403);
  assert.equal(guardRequest(req('GET', { host: 'office.internal:8080' }), { port: P, allowedHosts: ['office.internal:8080'] }), null);
});

test('non-GET requests: own Origin only, JSON only, 1 MB max, POST only', () => {
  const h = { host: `localhost:${P}` };
  assert.equal(guardRequest(req('POST', { ...h, ...json }), { port: P }), null);
  assert.equal(guardRequest(req('POST', { ...h, ...json, origin: `http://localhost:${P}` }), { port: P }), null);
  assert.equal(guardRequest(req('POST', { ...h, ...json, origin: 'http://evil.example' }), { port: P }).status, 403);
  assert.equal(guardRequest(req('POST', { ...h, ...json, origin: `http://localhost:${P + 1}` }), { port: P }).status, 403);
  assert.equal(guardRequest(req('POST', { ...h, 'content-type': 'text/plain' }), { port: P }).status, 415);
  assert.equal(guardRequest(req('POST', { ...h, 'content-type': 'application/x-www-form-urlencoded' }), { port: P }).status, 415);
  assert.equal(guardRequest(req('POST', { ...h, 'content-type': 'application/json; charset=utf-8' }), { port: P }), null);
  assert.equal(guardRequest(req('POST', { ...h, ...json, 'content-length': String(2 * 1024 * 1024) }), { port: P }).status, 413);
  assert.equal(guardRequest(req('DELETE', { ...h, ...json }), { port: P }).status, 405);
});

test('the live server applies the guards and sends the security headers', async (t) => {
  const { env } = isolatedEnv();
  const office = await startOffice({ env, runSession: fakeRunner(), log: () => {} });
  t.after(() => office.close());
  const base = `http://127.0.0.1:${office.port}`;
  const r1 = await fetch(`${base}/`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('content-security-policy'), CSP);
  assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r1.headers.get('referrer-policy'), 'no-referrer');
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.product, 'Elenta Office');
  assert.equal(health.departments, 10);
  assert.equal(health.acp.adapter, '@agentclientprotocol/claude-agent-acp');
  // Body too large (streamed without a length header).
  const big = await fetch(`${base}/api/jobs`, { method: 'POST', headers: json, body: JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 10) }) });
  assert.equal(big.status, 413);
  const bad = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(bad.status, 415);
  const cross = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { ...json, origin: 'http://evil.example' }, body: '{}' });
  assert.equal(cross.status, 403);
  const notJson = await fetch(`${base}/api/jobs`, { method: 'POST', headers: json, body: '[1,2' });
  assert.equal(notJson.status, 400);
  const trav = await fetch(`${base}/api/library/note?path=../package.json`);
  assert.equal(trav.status, 404);
  const note = await (await fetch(`${base}/api/library/note?path=shared/glossary.md`)).json();
  assert.match(note.text, /# Glossary/);
});
