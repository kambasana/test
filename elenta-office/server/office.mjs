// Wires settings, org, library, audit, job engine and HTTP server together.
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadSettings } from './settings.mjs';
import { loadOrg, countPeople } from './org.mjs';
import { Library } from './library.mjs';
import { Audit } from './audit.mjs';
import { JobEngine } from './jobs.mjs';
import { createOfficeServer } from './http.mjs';
import { runSession as realRunSession } from './runner.mjs';
import { computeLayout, overlaps } from './layout.mjs';
import { PRODUCT_NAME, VERSION } from './util.mjs';

export async function startOffice({ env = process.env, root, runSession = realRunSession, log = console.log } = {}) {
  const { settings, paths, problems: settingsProblems } = loadSettings({ root, env });
  for (const d of [paths.data, paths.work, paths.deliverables]) mkdirSync(d, { recursive: true });
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const audit = new Audit(join(paths.data, 'audit.jsonl'));
  const { org, problems, warnings } = loadOrg(paths.org, { deptSettings: settings.departments });
  const orgProblems = [...problems, ...warnings];
  if (org) {
    const bad = overlaps(computeLayout(org.departments));
    if (bad.length) orgProblems.push(`The floor layout has overlapping shapes: ${bad.map((b) => b.join('/')).join(', ')}.`);
  }
  const library = new Library(paths.library, { onChange: (idx) => bus.emit('library', idx) });
  library.watch();
  const engine = new JobEngine({ org, settings, paths, library, audit, emit: (t, p) => bus.emit(t, p), runSession });
  const ctx = { settings, paths, org, orgProblems, settingsProblems, library, audit, engine, bus };
  const server = createOfficeServer(ctx);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, settings.host, resolve);
  });
  const port = server.address().port;
  const url = `http://${settings.host === '127.0.0.1' || settings.host === '0.0.0.0' ? '127.0.0.1' : settings.host}:${port}`;
  audit.write('office.start', `${PRODUCT_NAME} ${VERSION} started on ${url} with org "${org?.title || settings.org}".`, { org: settings.org, port });
  if (org) log(`${PRODUCT_NAME} ${VERSION}: org "${org.title}", ${org.departments.length} departments, ${countPeople(org)} people, ${library.index.length} notes.`);
  for (const p of [...orgProblems, ...settingsProblems]) log(`Problem: ${p}`);
  log(`${PRODUCT_NAME} listening on ${url}`);

  const close = async () => {
    engine.stopAll();
    engine.saveNow();
    library.close();
    server.closeClients();
    await new Promise((r) => server.close(() => r()));
  };
  return { server, port, url, ctx, close };
}
