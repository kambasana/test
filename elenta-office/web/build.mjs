// Bundles the interface into web/dist/ (index.html, app.js, styles.css).
// No inline scripts, so the server's CSP `script-src 'self'` holds.
//   node web/build.mjs           build once
//   node web/build.mjs --watch   rebuild on change
import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PRODUCT_NAME } from './src/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const watch = process.argv.includes('--watch');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function writeHtml() {
  const html = await readFile(path.join(here, 'index.html'), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error('index.html must not contain inline scripts (CSP script-src \'self\').');
  await writeFile(path.join(dist, 'index.html'), html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(PRODUCT_NAME)}</title>`));
}

const js = {
  entryPoints: [path.join(here, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2021', 'chrome100', 'firefox100', 'safari15'],
  minify: !watch,
  sourcemap: true,
  legalComments: 'linked',
  outfile: path.join(dist, 'app.js'),
  logLevel: 'info',
};
const css = {
  entryPoints: [path.join(here, 'styles.css')],
  bundle: true,
  minify: !watch,
  outfile: path.join(dist, 'styles.css'),
  external: ['https://*'],
  logLevel: 'info',
};

await mkdir(dist, { recursive: true });
await writeHtml();
if (watch) {
  const a = await context(js); const b = await context(css);
  await Promise.all([a.watch(), b.watch()]);
  console.log('watching web/ …');
} else {
  await Promise.all([build(js), build(css)]);
  console.log(`built ${path.relative(process.cwd(), dist)}/ (index.html, app.js, styles.css)`);
}
