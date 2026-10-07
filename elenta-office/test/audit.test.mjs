import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Audit, toCsv } from '../server/audit.mjs';
import { tempDir } from './helpers.mjs';

test('audit entries are appended as JSON lines and returned newest first with filters', () => {
  const file = join(tempDir(), 'data', 'audit.jsonl');
  const seen = [];
  const a = new Audit(file, { onEntry: (e) => seen.push(e) });
  a.write('job.created', 'Job one created', { dept: 'military', job: 'j1' });
  a.write('permission', 'Refused Bash', { dept: 'military', job: 'j1', decision: 'reject', tool: 'Bash' });
  a.write('permission', 'Allowed Write', { dept: 'business', job: 'j2', decision: 'allow', tool: 'Write' });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => typeof JSON.parse(l).ts === 'string'));
  assert.equal(seen.length, 3);
  assert.deepEqual(a.query().map((e) => e.text), ['Allowed Write', 'Refused Bash', 'Job one created']);
  assert.equal(a.query({ dept: 'military' }).length, 2);
  assert.equal(a.query({ kind: 'permission' }).length, 2);
  assert.equal(a.query({ kind: 'job' }).length, 1);
  assert.equal(a.query({ q: 'bash' }).length, 1);
  assert.equal(a.query({ limit: 1 }).length, 1);
  // Append-only: a new Audit on the same file keeps the old entries.
  new Audit(file).write('approval', 'ok');
  assert.equal(new Audit(file).all().length, 4);
});

test('CSV export quotes cells and neutralises spreadsheet formulas', () => {
  const csv = toCsv([{ ts: 't', kind: 'k', text: '=HYPERLINK("x")' }, { ts: 't', kind: 'k', text: 'a,b\n"c"' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'ts,kind,dept,job,agent,tool,decision,path,text');
  assert.ok(lines[1].endsWith(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"a,b\n""c"""'));
});
