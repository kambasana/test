import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateOrg, loadOrg, deptPeople, countPeople, PALETTE } from '../server/org.mjs';
import { ROOT } from './helpers.mjs';

const elenta = () => JSON.parse(readFileSync(join(ROOT, 'orgs', 'elenta.json'), 'utf8'));
const minimal = (deps) => ({ title: 'T', departments: deps });
const dept = (key, extra = {}) => ({ key, name: key.toUpperCase(), lead: { name: `${key} lead` }, teams: [{ name: 'TEAM', people: [{ name: 'Worker' }] }], ...extra });

test('the shipped Elenta org is valid and has the expected shape', () => {
  const { org, problems, warnings } = loadOrg(join(ROOT, 'orgs', 'elenta.json'));
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
  assert.equal(org.title, 'Elenta');
  const keys = org.departments.map((d) => d.key);
  assert.equal(keys[0], 'boss');
  assert.equal(keys[keys.length - 1], 'business');
  const military = ['intel', 'operations', 'information', 'cyber', 'warfare', 'logistics', 'capability', 'support'];
  for (const k of military) assert.ok(keys.includes(k), k);
  // every military department is in the Military group and carries the rules
  for (const k of military) {
    const dept = org.departments.find((d) => d.key === k);
    assert.equal(dept.group, 'Military', k);
    assert.ok(dept.rules.some((r) => /targets/.test(r)), `${k} keeps the no-targeting rule`);
    assert.ok(dept.lead, `${k} has a lead`);
  }
  assert.equal(org.departments.find((d) => d.key === 'business').group, 'Business');
  assert.equal(org.departments.filter((d) => d.boss).length, 1);
  // the intelligence department covers the full set of disciplines
  const intel = org.departments.find((d) => d.key === 'intel');
  for (const t of ['ALL-SOURCE INTEL (J2)', 'TECHNICAL INTEL', 'CRYPTOLOGY', 'ISR & RECCE', 'GEOSPATIAL & METOC']) assert.ok(intel.teams.map((x) => x.name).includes(t), t);
  assert.ok(countPeople(org) >= 110, `people: ${countPeople(org)}`);
  const ids = org.departments.flatMap(deptPeople).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('names are upper-cased, ids generated from key + name and kept unique', () => {
  const { org, problems } = validateOrg(minimal([dept('ops', { teams: [{ name: 'crew', people: [{ name: 'Pilot' }, { name: 'pilot' }] }] })]));
  assert.deepEqual(problems, []);
  const people = deptPeople(org.departments[0]);
  assert.equal(org.departments[0].teams[0].name, 'CREW');
  assert.deepEqual(people.map((p) => p.id), ['ops-ops-lead', 'ops-pilot', 'ops-pilot-2']);
  assert.ok(people.every((p) => p.name === p.name.toUpperCase()));
});

test('bad keys, duplicate keys and two bosses are reported as sentences, and nothing is applied', () => {
  const r = validateOrg(minimal([dept('Bad Key'), dept('ok'), dept('ok'), dept('b1', { boss: true }), dept('b2', { boss: true })]));
  assert.equal(r.org, null);
  assert.ok(r.problems.some((p) => p.includes('"Bad Key"')));
  assert.ok(r.problems.some((p) => p.includes('"ok" is used twice')));
  assert.ok(r.problems.some((p) => p.includes('Only one department may be the boss')));
  assert.ok(r.problems.every((p) => /[.]$/.test(p)));
});

test('limits: key length, name/role/does length, departments and people counts', () => {
  assert.ok(validateOrg(minimal([dept('a'.repeat(25))])).problems.length);
  assert.ok(validateOrg(minimal([dept('a', { name: 'N'.repeat(33) })])).problems.length);
  assert.ok(validateOrg(minimal([dept('a', { lead: { name: 'L', role: 'r'.repeat(81) } })])).problems.length);
  assert.ok(validateOrg(minimal([dept('a', { lead: { name: 'L', does: 'd'.repeat(401) } })])).problems.length);
  const many = Array.from({ length: 13 }, (_, i) => dept(`d${i}`));
  assert.ok(validateOrg(minimal(many)).problems.some((p) => p.includes('13 departments')));
  const big = dept('big', { teams: [{ name: 'T', people: Array.from({ length: 120 }, (_, i) => ({ name: `P${i}` })) }] });
  assert.ok(validateOrg(minimal([big])).problems.some((p) => p.includes('121 people')));
  const six = Array.from({ length: 6 }, (_, k) => dept(`d${k}`, { teams: [{ name: 'T', people: Array.from({ length: 60 }, (_, i) => ({ name: `P${i}` })) }] }));
  assert.ok(validateOrg(minimal(six)).problems.some((p) => p.includes('366 people')));
  assert.ok(validateOrg(minimal([])).problems.length);
  assert.ok(validateOrg(null).problems.length);
});

test('explicit duplicate ids across departments are refused', () => {
  const r = validateOrg(minimal([dept('a', { lead: { id: 'same', name: 'X' } }), dept('b', { lead: { id: 'same', name: 'Y' } })]));
  assert.equal(r.org, null);
  assert.ok(r.problems.some((p) => p.includes('"same" is used twice')));
});

test('colours: explicit kept, missing ones from the palette without repeating explicit ones, bad ones refused', () => {
  const { org } = validateOrg(minimal([dept('a'), dept('b', { color: PALETTE[0] })]));
  assert.equal(org.departments[1].color, PALETTE[0]);
  assert.notEqual(org.departments[0].color, PALETTE[0]);
  assert.ok(PALETTE.includes(org.departments[0].color));
  assert.ok(validateOrg(minimal([dept('a', { color: 'red' })])).problems.length);
});

test('departments can be switched off, but at least one stays on', () => {
  const raw = elenta();
  const r1 = validateOrg(raw, { deptSettings: { business: { on: false }, ghost: { on: false } } });
  assert.equal(r1.org.departments.find((d) => d.key === 'business').on, false);
  assert.ok(r1.warnings.some((w) => w.includes('"ghost"')));
  const r2 = validateOrg(raw, { deptSettings: Object.fromEntries(raw.departments.map((d) => [d.key, { on: false }])) });
  assert.ok(r2.org.departments.every((d) => d.on));
  assert.ok(r2.warnings.some((w) => w.includes('at least one')));
});
