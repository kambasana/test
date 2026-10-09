import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrg, deptPeople } from '../server/org.mjs';
import { exportPack, writePack, readPack, splitPersona } from '../server/pack.mjs';
import { systemPromptFor, planPrompt } from '../server/prompts.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const shipped = () => loadOrg(join(ROOT, 'orgs', 'elenta.json')).org;

test('every shipped department round-trips through an Open Plugin Spec pack unchanged', () => {
  const org = shipped();
  for (const d of org.departments) {
    const dir = tempDir();
    writePack(dir, exportPack(d, { orgTitle: org.title }));
    const { department, problems } = readPack(dir);
    assert.deepEqual(problems, [], d.key);
    assert.equal(department.key, d.key);
    assert.deepEqual(department.rules || [], d.rules);
    assert.deepEqual(department.teams.map((t) => t.name), d.teams.map((t) => t.name));
    const want = deptPeople(d).map(({ id, name, role, does }) => ({ id, name, role, does }));
    const got = [department.lead, ...department.teams.flatMap((t) => t.people)].map(({ id, name, role, does }) => ({ id, name, role, does }));
    assert.deepEqual(got, want, d.key);
  }
});

test('persona files carry only Buzz frontmatter keys (Buzz rejects unknown ones)', () => {
  const files = exportPack(shipped().departments.find((d) => d.key === 'military'), { orgTitle: 'Elenta' });
  const allowed = new Set(['name', 'display_name', 'avatar', 'description', 'version', 'author', 'skills', 'mcp_servers', 'subscribe', 'triggers', 'model', 'runtime', 'temperature', 'max_context_tokens', 'thread_replies', 'broadcast_replies', 'hooks']);
  const mil = shipped().departments.find((d) => d.key === 'military');
  const n = deptPeople(mil).length;
  const personas = Object.entries(files).filter(([k]) => k.endsWith('.persona.md'));
  assert.equal(personas.length, n);
  for (const [, text] of personas) for (const k of Object.keys(splitPersona(text).front)) assert.ok(allowed.has(k), k);
  const manifest = JSON.parse(files['.plugin/plugin.json']);
  assert.equal(manifest.personas.length, n);
  assert.match(files['instructions.md'], /No selecting, nominating, prioritising or locating targets/);
});

test('a plain Buzz pack imports: first persona leads, hooks ignored, MCP servers become connector requests, models ignored', () => {
  const dir = tempDir();
  mkdirSync(join(dir, '.plugin'), { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, '.plugin', 'plugin.json'), JSON.stringify({ id: 'com.example.ops', name: 'Example Ops', version: '1.0.0', personas: ['agents/a.persona.md', 'agents/b.persona.md'], hooks_config: 'hooks/hooks.json', mcp_config: '.mcp.json' }));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
  writeFileSync(join(dir, 'agents', 'a.persona.md'), '---\nname: Lead_One\ndisplay_name: "Lead One"\ndescription: Leads\nmodel: "x:y"\nhooks:\n  on_start: ./run.sh\n---\nBody A\n');
  writeFileSync(join(dir, 'agents', 'b.persona.md'), '---\nname: two\ndisplay_name: Two\ndescription: Helps\nmcp_servers:\n  - name: "semgrep"\n    command: "semgrep-mcp"\nskills:\n  - ./skills/review/\n---\nBody B\n');
  const { department, problems, warnings, review } = readPack(dir);
  assert.deepEqual(problems, []);
  assert.equal(department.lead.id, 'lead-one');
  assert.equal(department.lead.name, 'LEAD ONE');
  assert.deepEqual(department.teams[0].people.map((p) => p.id), ['two']);
  assert.ok(review.hooksIgnored);
  assert.deepEqual(review.connectorRequests.map((c) => c.name).sort(), ['github', 'semgrep']);
  assert.deepEqual(review.modelsIgnored, ['lead-one']);
  assert.equal(review.skills.length, 1);
  assert.ok(warnings.some((w) => /never runs pack code/.test(w)));
});

test('packs cannot reach outside their folder', () => {
  const dir = tempDir();
  mkdirSync(join(dir, '.plugin'), { recursive: true });
  writeFileSync(join(dir, '.plugin', 'plugin.json'), JSON.stringify({ id: 'x', name: 'X', version: '1', personas: ['../../etc/passwd.persona.md', '/abs.persona.md', 'agents/x.md'] }));
  const { department, problems } = readPack(dir);
  assert.equal(department, null);
  assert.equal(problems.filter((p) => /inside the pack/.test(p)).length, 3);
});

test('an org file can name a department by its pack folder', () => {
  const org = shipped();
  const dir = tempDir();
  writePack(join(dir, 'packs', 'military'), exportPack(org.departments.find((d) => d.key === 'military'), { orgTitle: 'Elenta' }));
  const raw = { title: 'Packed', departments: [{ key: 'boss', boss: true, lead: { name: 'Boss' } }, { pack: 'packs/military' }] };
  writeFileSync(join(dir, 'org.json'), JSON.stringify(raw));
  const { org: got, problems } = loadOrg(join(dir, 'org.json'));
  assert.deepEqual(problems, []);
  assert.ok(deptPeople(got.departments[1]).length >= 90);
});

test('department rules reach the workers and the lead\'s plan', () => {
  const org = shipped();
  const mil = org.departments.find((d) => d.key === 'military');
  const sys = systemPromptFor('work', { org, dept: mil, person: mil.teams[2].people[0] });
  assert.match(sys, /Rules of the MILITARY department/);
  assert.match(sys, /targets/);
  const plan = planPrompt({ request: 'x', dept: mil, index: [], lessons: '', min: 2, max: 4, single: false });
  assert.match(plan, /Department rules/);
  const biz = org.departments.find((d) => d.key === 'business');
  assert.doesNotMatch(systemPromptFor('work', { org, dept: biz, person: biz.lead }), /Rules of the BUSINESS/);
});
