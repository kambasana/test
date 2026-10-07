import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { computeLayout, overlaps } from '../server/layout.mjs';
import { loadOrg, validateOrg } from '../server/org.mjs';
import { ROOT } from './helpers.mjs';

test('the Elenta floor has no overlapping hub, library, bays or clusters', () => {
  const { org } = loadOrg(join(ROOT, 'orgs', 'elenta.json'));
  const layout = computeLayout(org.departments);
  assert.equal(layout.bays.length, 2);
  assert.deepEqual(overlaps(layout), []);
});

test('random orgs of 1–12 departments never overlap, and bays grow with their teams', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + rnd(12);
    const departments = Array.from({ length: n }, (_, i) => ({
      key: `d${i}`, name: `D${i}`, lead: { name: 'Lead' }, boss: i === 0 && rnd(2) === 0,
      teams: Array.from({ length: rnd(6) }, (_, t) => ({ name: `T${t}`, people: Array.from({ length: 1 + rnd(8) }, (_, p) => ({ name: `P${p}` })) })),
    }));
    const { org, problems } = validateOrg({ title: 'R', departments });
    if (!org) { assert.ok(problems.length); continue; }
    const layout = computeLayout(org.departments);
    assert.deepEqual(overlaps(layout), [], `trial ${trial}`);
  }
  const small = computeLayout(validateOrg({ title: 'S', departments: [{ key: 'a', lead: { name: 'L' }, teams: [{ name: 'T', people: [{ name: 'P' }] }] }] }).org.departments);
  const bigDept = { key: 'a', lead: { name: 'L' }, teams: Array.from({ length: 5 }, (_, t) => ({ name: `T${t}`, people: Array.from({ length: 5 }, (_, p) => ({ name: `P${p}` })) })) };
  const big = computeLayout(validateOrg({ title: 'B', departments: [bigDept] }).org.departments);
  assert.ok(big.bays[0].r > small.bays[0].r);
});
