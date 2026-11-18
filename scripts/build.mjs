import { rm, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

for (const file of ['styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) {
  await copyFile(join(root, file), join(dist, file));
}

// Stamp the cache name with a hash of the build, so every deploy activates a
// fresh cache and old ones are deleted instead of being served forever.
const swSource = await readFile(join(root, 'sw.js'), 'utf8');
const bundle = await readFile(join(dist, 'assets', 'app.js'));
const stamp = createHash('sha256')
  .update(built)
  .update(bundle)
  .update(swSource)
  .digest('hex')
  .slice(0, 12);
const swBuilt = swSource.replace('const VERSION = \'vinewatch-v1\';', `const VERSION = 'vinewatch-${stamp}';`);
if (swBuilt === swSource) throw new Error('sw.js VERSION placeholder not found');
await writeFile(join(dist, 'sw.js'), swBuilt);

const files = ['index.html', '404.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'assets/app.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
let total = 0;
for (const file of files) {
  const { size } = await stat(join(dist, file));
  total += size;
}
console.log(`build ok → dist/ (${files.length} files, ${(total / 1024).toFixed(1)} KiB)`);
