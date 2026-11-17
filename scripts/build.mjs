import { rm, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'assets'), { recursive: true });
await mkdir(join(dist, 'icons'), { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, 'src', 'app.js')],
  outfile: join(dist, 'assets', 'app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  sourcemap: false,
  legalComments: 'none'
});
if (result.warnings.length) console.warn(result.warnings);

const html = await readFile(join(root, 'index.html'), 'utf8');
const built = html.replace('./src/app.js', './assets/app.js');
await writeFile(join(dist, 'index.html'), built);
await writeFile(join(dist, '404.html'), built);

for (const file of ['styles.css', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) {
  await copyFile(join(root, file), join(dist, file));
}

const files = ['index.html', '404.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'assets/app.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
let total = 0;
for (const file of files) {
  const { size } = await stat(join(dist, file));
  total += size;
}
console.log(`build ok → dist/ (${files.length} files, ${(total / 1024).toFixed(1)} KiB)`);
