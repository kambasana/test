import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveLocalSettings, DEFAULTS } from '../server/settings.mjs';
import { tempDir } from './helpers.mjs';

test('defaults ← settings.json ← settings.local.json ← environment', () => {
  const root = tempDir();
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ org: 'base', concurrency: 2, tools: { webSearch: false } }));
  writeFileSync(join(root, 'settings.local.json'), JSON.stringify({ concurrency: 3, wings: [{ name: 'Lab', url: 'http://localhost:4181' }, { name: 'Bad', url: 'http://example.com' }] }));
  const { settings, paths, problems } = loadSettings({ root, env: { EO_PORT: '0', EO_OFF: 'business,admin', EO_WEB_SEARCH: '1' } });
  assert.equal(settings.org, 'base');
  assert.equal(settings.concurrency, 3);
  assert.equal(settings.port, 0);
  assert.equal(settings.tools.webSearch, true);
  assert.equal(settings.team.max, DEFAULTS.team.max);
  assert.deepEqual(settings.departments, { business: { on: false }, admin: { on: false } });
  assert.deepEqual(settings.wings, [{ name: 'Lab', url: 'http://localhost:4181' }]);
  assert.ok(problems.some((p) => p.includes('Wing')));
  assert.equal(paths.org, join(root, 'orgs', 'base.json'));
});

test('bad values fall back with a sentence; a path-like org name is refused', () => {
  const root = tempDir();
  writeFileSync(join(root, 'settings.json'), '{ not json');
  const r = loadSettings({ root, env: { EO_ORG: '../../etc/passwd' } });
  assert.equal(r.settings.org, DEFAULTS.org);
  assert.ok(r.problems.length >= 2);
});

test('local settings are merged and written atomically', () => {
  const root = tempDir();
  const local = join(root, 'settings.local.json');
  saveLocalSettings(local, { departments: { a: { on: false } } });
  saveLocalSettings(local, { departments: { b: { on: true } }, concurrency: 2 });
  assert.deepEqual(JSON.parse(readFileSync(local, 'utf8')), { departments: { a: { on: false }, b: { on: true } }, concurrency: 2 });
  assert.deepEqual(readdirSync(root), ['settings.local.json']);
});
