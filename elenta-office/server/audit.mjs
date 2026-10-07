// Append-only audit log, one JSON object per line (data/audit.jsonl).
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const AUDIT_KINDS = [
  'office.start', 'job.created', 'job.routed', 'job.planned', 'job.state', 'job.cancelled',
  'session.tools', 'permission', 'file.read', 'file.write', 'approval', 'settings', 'error',
];

export class Audit {
  constructor(file, { onEntry } = {}) {
    this.file = file;
    this.onEntry = onEntry || (() => {});
    mkdirSync(dirname(file), { recursive: true });
  }

  /** Record one entry. `kind` and `text` are required; everything else is optional context. */
  write(kind, text, extra = {}) {
    const entry = { ts: new Date().toISOString(), kind, text: String(text), ...extra };
    appendFileSync(this.file, JSON.stringify(entry) + '\n', { flag: 'a' });
    try { this.onEntry(entry); } catch {}
    return entry;
  }

  all() {
    if (!existsSync(this.file)) return [];
    const out = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  }

  /** Newest first, filtered. */
  query({ dept, kind, q, job, limit } = {}) {
    const n = Math.max(1, Math.min(Number(limit) || 500, 10000));
    const needle = q ? String(q).toLowerCase() : null;
    const res = [];
    const all = this.all();
    for (let i = all.length - 1; i >= 0 && res.length < n; i--) {
      const e = all[i];
      if (dept && e.dept !== dept) continue;
      if (kind && e.kind !== kind && !String(e.kind).startsWith(kind + '.')) continue;
      if (job && e.job !== job) continue;
      if (needle && !JSON.stringify(e).toLowerCase().includes(needle)) continue;
      res.push(e);
    }
    return res;
  }
}

const CSV_COLUMNS = ['ts', 'kind', 'dept', 'job', 'agent', 'tool', 'decision', 'path', 'text'];
function csvCell(v) {
  if (v === undefined || v === null) return '';
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  // Neutralise spreadsheet formulas.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(entries) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of entries) lines.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
