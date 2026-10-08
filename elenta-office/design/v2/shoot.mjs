import { createRequire } from 'node:module';
const require = createRequire('/home/user/test/elenta-office/package.json');
const { chromium } = require('playwright-core');
const [, , dir, view, w, h] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(`file://${dir}/floor.html?view=${view}`); await p.waitForSelector('body[data-ready="1"]', { timeout: 90000 }); await p.waitForTimeout(1500);
await p.screenshot({ path: `${dir}/floor-${view}.png` }); await b.close();
