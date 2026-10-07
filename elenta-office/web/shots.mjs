// Playwright screenshots of the interface into web/shots/.
//   node web/shots.mjs                       demo mode, served from web/dist with the production CSP
//   node web/shots.mjs --url http://127.0.0.1:4700   against a running office (live mode)
// Builds web/dist first. Prints console errors and CSP violations.
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const out = path.join(here, 'shots');
const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const prefix = args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : (urlArg ? 'live-' : '');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

const CSP = "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.txt': 'text/plain' };

function serveDist() {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no server"}'); return; }
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const file = path.join(dist, path.normalize(rel));
    if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });
await mkdir(out, { recursive: true });

let server = null;
let base = urlArg;
if (!base) {
  server = await serveDist();
  base = `http://127.0.0.1:${server.address().port}`;
}
const demo = urlArg ? '' : 'demo=1&';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const shots = [
  { name: 'overview', q: '', wait: 6500 },
  { name: 'department', q: 'focus=military', wait: 6500 },
  { name: 'job', q: 'open=waiting', wait: 4500 },
  { name: 'job-deliverable', q: 'open=waiting', wait: 4500, scroll: '.jv-main' },
  { name: 'audit', q: 'open=audit', wait: 4500 },
  { name: 'departments', q: 'open=departments', wait: 3500 },
  { name: 'overview-light', q: 'theme=light', wait: 6000 },
  { name: 'overview-off', q: 'off=business', wait: 5000, demoOnly: true },
  { name: 'narrow', q: '', wait: 5000, viewport: { width: 1100, height: 760 }, drawer: 'Work' },
  { name: 'narrow-org', q: '', wait: 5000, viewport: { width: 820, height: 760 }, drawer: 'Org' },
];

const problems = [];
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  if (s.demoOnly && urlArg) continue;
  const ctx = await browser.newContext({ viewport: s.viewport || { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`[${s.name}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${s.name}] page error: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  const url = `${base}/?${demo}shot=1&${s.q}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="true"]', { timeout: 30000 });
  if (s.drawer) {
    await page.getByRole('button', { name: s.drawer, exact: true }).click();
  }
  await page.waitForTimeout(s.wait);
  if (s.scroll) {
    await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollTop = el.scrollHeight; }, s.scroll);
    await page.waitForTimeout(300);
  }
  const file = path.join(out, `${prefix}${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(`shot ${path.relative(process.cwd(), file)}`);
  await ctx.close();
}

await browser.close();
if (server) server.close();
if (problems.length) {
  console.log('\nProblems seen while rendering:');
  for (const p of problems) console.log(`  ${p}`);
} else console.log('\nNo console errors or CSP violations.');
