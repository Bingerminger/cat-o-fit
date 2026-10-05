#!/usr/bin/env node
/* =========================================================================
   build-demo.mjs — the public demo as a static site (GitHub Pages).

   Copies the app shell (index.html, manifest, service worker, js/, css/,
   assets/, locales/, LICENSE) – no api/, no data/ – and marks index.html with
   `data-demo`. The app then answers its API in the browser (js/demo-mode.js,
   js/demo-server.js), starts every visit with the demo family and saves nothing.

     node tools/build-demo.mjs              # into dist/demo
     node tools/build-demo.mjs --out /tmp/x

   Try it locally: `php -S 127.0.0.1:8090 -t dist/demo` (or any static server)
   and open http://127.0.0.1:8090/ – the PHP server only serves files here.
   ========================================================================= */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'manifest.webmanifest', 'service-worker.js', 'LICENSE'];
const DIRS = ['js', 'css', 'assets', 'locales'];

/** Builds the demo into `out` (emptied first) and returns the list of copied top-level entries. */
export function buildDemo(out = join(ROOT, 'dist', 'demo')) {
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of FILES) cpSync(join(ROOT, f), join(out, f));
  for (const d of DIRS) cpSync(join(ROOT, d), join(out, d), { recursive: true });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const marked = html.replace(/<html(\s[^>]*)?>/, (tag) => tag.replace(/>$/, ' data-demo>'));
  if (marked === html) throw new Error('index.html: <html> tag not found');
  writeFileSync(join(out, 'index.html'), marked);
  writeFileSync(join(out, '.nojekyll'), '');   // GitHub Pages: serve files as they are
  return [...FILES, ...DIRS, '.nojekyll'];
}

function option(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(option(process.argv.slice(2), '--out', join(ROOT, 'dist', 'demo')));
  const entries = buildDemo(out);
  console.log(`Demo built in ${out} (${entries.length} entries).`);
}
