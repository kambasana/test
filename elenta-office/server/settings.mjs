// Settings: built-in defaults ← settings.json ← settings.local.json (or EO_SETTINGS) ← EO_* environment.
// The office only ever writes settings.local.json (or the EO_SETTINGS file), atomically.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { ROOT, atomicWriteJson } from './util.mjs';

export const DEFAULTS = Object.freeze({
  org: 'elenta',
  library: 'library',
  host: '127.0.0.1',
  port: 4180,
  dataDir: 'data',
  workDir: 'work',
  deliverablesDir: 'deliverables',
  team: { max: 6 },
  concurrency: 4,
  timeoutSec: 600,
  tools: { webSearch: false },
  model: null,
  allowedHosts: [],
  wing: null,
  wings: [],
  departments: {},
});

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function readJson(path, problems) {
  if (!existsSync(path)) return {};
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObj(v)) { problems.push(`${path} does not hold a JSON object, so it was ignored.`); return {}; }
    return v;
  } catch (err) {
    problems.push(`${path} is not valid JSON (${err.message}), so it was ignored.`);
    return {};
  }
}

const WING_URL = /^http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})\/?$/;

export function loadSettings({ root = ROOT, env = process.env } = {}) {
  const problems = [];
  const basePath = join(root, 'settings.json');
  const localPath = env.EO_SETTINGS ? resolve(root, env.EO_SETTINGS) : join(root, 'settings.local.json');
  let s = deepMerge(structuredClone(DEFAULTS), readJson(basePath, problems));
  s = deepMerge(s, readJson(localPath, problems));

  if (env.EO_ORG) s.org = env.EO_ORG;
  if (env.EO_LIBRARY) s.library = env.EO_LIBRARY;
  if (env.EO_HOST) s.host = env.EO_HOST;
  if (env.EO_PORT !== undefined && env.EO_PORT !== '') s.port = Number(env.EO_PORT);
  if (env.EO_DATA) s.dataDir = env.EO_DATA;
  if (env.EO_WORK) s.workDir = env.EO_WORK;
  if (env.EO_DELIVERABLES) s.deliverablesDir = env.EO_DELIVERABLES;
  if (env.EO_MODEL) s.model = env.EO_MODEL;
  if (env.EO_WING) s.wing = env.EO_WING;
  if (env.EO_WEB_SEARCH !== undefined) s.tools = { ...s.tools, webSearch: /^(1|true|yes|on)$/i.test(env.EO_WEB_SEARCH) };
  if (env.EO_CONCURRENCY) s.concurrency = Number(env.EO_CONCURRENCY);
  if (env.EO_TIMEOUT_SEC) s.timeoutSec = Number(env.EO_TIMEOUT_SEC);
  if (env.EO_OFF !== undefined) {
    const off = String(env.EO_OFF).split(',').map((x) => x.trim()).filter(Boolean);
    const deps = { ...(isObj(s.departments) ? s.departments : {}) };
    for (const k of off) deps[k] = { ...(deps[k] || {}), on: false };
    s.departments = deps;
  }

  // Sanity checks: fall back to defaults with a sentence, never crash.
  if (typeof s.org !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s.org)) { problems.push(`Setting "org" must be a plain file name; using "${DEFAULTS.org}".`); s.org = DEFAULTS.org; }
  if (!Number.isInteger(s.port) || s.port < 0 || s.port > 65535) { problems.push(`Setting "port" must be 0–65535; using ${DEFAULTS.port}.`); s.port = DEFAULTS.port; }
  const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  s.team = { max: clampInt(s.team?.max, 2, 12, 6) };
  s.concurrency = clampInt(s.concurrency, 1, 16, 4);
  s.timeoutSec = clampInt(s.timeoutSec, 30, 7200, 600);
  s.tools = { webSearch: s.tools?.webSearch === true };
  s.allowedHosts = Array.isArray(s.allowedHosts) ? s.allowedHosts.filter((h) => typeof h === 'string' && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(h)) : [];
  if (!isObj(s.departments)) s.departments = {};
  const wings = [];
  for (const w of Array.isArray(s.wings) ? s.wings : []) {
    if (isObj(w) && typeof w.name === 'string' && w.name.trim() && typeof w.url === 'string' && WING_URL.test(w.url)) {
      wings.push({ name: w.name.trim().slice(0, 40), url: w.url.replace(/\/$/, '') });
    } else problems.push(`Wing ${JSON.stringify(w).slice(0, 80)} was ignored: a wing needs a name and a url of the form http://localhost:<port> or http://127.0.0.1:<port>.`);
  }
  s.wings = wings;
  if (s.model !== null && typeof s.model !== 'string') s.model = null;

  const abs = (p) => (isAbsolute(p) ? p : join(root, p));
  const paths = {
    root,
    org: join(root, 'orgs', `${s.org}.json`),
    library: abs(s.library),
    data: abs(s.dataDir),
    work: abs(s.workDir),
    deliverables: abs(s.deliverablesDir),
    local: localPath,
    web: join(root, 'web', 'dist'),
  };
  return { settings: s, paths, problems };
}

/** Merge a patch into the local settings file (atomic). Returns the new local object. */
export function saveLocalSettings(localPath, patch) {
  const problems = [];
  const current = readJson(localPath, problems);
  if (problems.length) throw new Error(problems[0]);
  const next = deepMerge(current, patch);
  atomicWriteJson(localPath, next);
  return next;
}
