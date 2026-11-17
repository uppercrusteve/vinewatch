/** Renders icons/icon.svg to real 192/512 PNGs with the local Chromium build. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../_tools/node_modules/playwright/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, 'icons', 'icon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl}" alt="">`
  );
  await page.locator('img').screenshot({ path: join(root, 'icons', `icon-${size}.png`), omitBackground: true });
  console.log(`icons/icon-${size}.png`);
}

await browser.close();
