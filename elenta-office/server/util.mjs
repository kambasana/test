// Small shared helpers. No dependencies.
import { writeFileSync, renameSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The product name lives here and only here. */
export const PRODUCT_NAME = 'Elenta Office';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
})();

/** Write a file atomically: temp file in the same folder, then rename over the target. */
export function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
export function atomicWriteJson(path, value) {
  atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

export function slugify(text, max = 40) {
  const s = String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s.slice(0, max).replace(/-+$/, '')) || 'item';
}

export function newJobId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `job-${stamp}-${randomBytes(3).toString('hex')}`;
}

export function isoDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Find the first JSON object in a model answer (handles ```json fences and surrounding prose). */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const c of candidates) {
    for (let start = c.indexOf('{'); start !== -1; start = c.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < c.length; i++) {
        const ch = c[i];
        if (inStr) {
          if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { const v = JSON.parse(c.slice(start, i + 1)); if (v && typeof v === 'object') return v; } catch {}
            break;
          }
        }
      }
    }
  }
  return null;
}

/** Run async tasks with at most `limit` in flight. */
export async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function oneLine(text, max = 200) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
