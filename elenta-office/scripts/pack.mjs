#!/usr/bin/env node
// Department packages on the command line (SPEC §11).
//   node scripts/pack.mjs export <org.json> <dept-key|all> <out-dir>   write Open Plugin Spec packs
//   node scripts/pack.mjs check <pack-dir>                             read a pack and print the review
import { join } from 'node:path';
import { loadOrg } from '../server/org.mjs';
import { exportPack, writePack, readPack } from '../server/pack.mjs';

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'export') {
  const [orgPath, which, out] = args;
  const { org, problems } = loadOrg(orgPath);
  if (!org) { for (const p of problems) console.error(p); process.exit(1); }
  const depts = which === 'all' ? org.departments : org.departments.filter((d) => d.key === which);
  if (!depts.length) { console.error(`No department "${which}".`); process.exit(1); }
  for (const d of depts) {
    const dir = join(out, d.key);
    writePack(dir, exportPack(d, { orgTitle: org.title }));
    console.log(`Wrote ${dir}`);
  }
} else if (cmd === 'check') {
  const { department, problems, warnings, review } = readPack(args[0]);
  for (const p of problems) console.log(`Problem: ${p}`);
  for (const w of warnings) console.log(`Note: ${w}`);
  if (department) {
    console.log(`${review.name} ${review.version}: department "${department.key}", ${review.people.length} people, ${department.teams.length} sub-teams.`);
    console.log(`Skills to review: ${review.skills.length}. Connector requests: ${review.connectorRequests.map((c) => c.name).join(', ') || 'none'}. Hooks: ${review.hooksIgnored ? 'ignored' : 'none'}.`);
  }
  process.exit(department ? 0 : 1);
} else {
  console.error('Usage: pack.mjs export <org.json> <dept|all> <out-dir> | check <pack-dir>');
  process.exit(2);
}
