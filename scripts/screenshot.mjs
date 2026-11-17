/**
 * Captures docs/screenshots/app.png (desktop) and mobile.png from the built app.
 * Requires `npm run build` first. Uses the shared Chromium at F:\云南vibe\_tools.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../_tools/node_modules/playwright/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
await mkdir(outDir, { recursive: true });

const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), 'dist'], {
  env: { ...process.env, PORT: '4178' },
  stdio: 'inherit'
});

const base = 'http://127.0.0.1:4178/';
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(base);
    if (response.ok) break;
  } catch {
    /* retry */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const browser = await chromium.launch();
const results = [];

async function audit(page, label) {
  const data = await page.evaluate(() => {
    const rootWidth = document.documentElement.scrollWidth;
    const viewport = window.innerWidth;
    const small = [...document.querySelectorAll('button, a, input, select, textarea, label.btn-file')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && !el.classList.contains('visually-hidden');
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, id: el.id, w: Math.round(rect.width), h: Math.round(rect.height) };
      })
      .filter((item) => item.w < 44 || item.h < 44);
    return { rootWidth, viewport, small };
  });
  results.push({ label, ...data });
}

async function prepare(context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('vinewatch');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#welcome-demo');
  await page.waitForSelector('.record', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.record').length === 12);
  await page.waitForTimeout(3600);
  return page;
}

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const desktop = await prepare(desktopContext, { width: 1440, height: 900 });
await desktop.evaluate(() => document.querySelector('.list-head').scrollIntoView({ block: 'start' }));
await desktop.waitForTimeout(300);
await audit(desktop, 'desktop 1440x900');
await desktop.screenshot({ path: join(outDir, 'app.png') });

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: 'light',
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});
const mobile = await prepare(mobileContext, { width: 390, height: 844 });
await audit(mobile, 'mobile 390x844');
await mobile.evaluate(() => window.scrollTo(0, 0));
await mobile.screenshot({ path: join(outDir, 'mobile.png') });

const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const dark = await prepare(darkContext, { width: 1440, height: 900 });
await dark.evaluate(() => document.querySelector('.list-head').scrollIntoView({ block: 'start' }));
await dark.waitForTimeout(300);
await audit(dark, 'dark 1440x900');
await dark.screenshot({ path: join(outDir, 'app-dark.png') });

for (const item of results) {
  console.log(
    `${item.label}: scrollWidth=${item.rootWidth} viewport=${item.viewport} smallTargets=${item.small.length}`
  );
  if (item.small.length) console.log(item.small.slice(0, 12));
}

await browser.close();
server.kill();
console.log('screenshots → docs/screenshots/app.png, mobile.png, app-dark.png');
