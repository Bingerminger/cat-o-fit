/* Service worker: every module and every stylesheet must be in the offline cache.
   If a new module is missing from SHELL_ASSETS, the app does not load offline – the error
   goes unnoticed online and would only become visible to the user without this test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('service-worker.js', root), 'utf8');
const block = sw.slice(sw.indexOf('const SHELL_ASSETS = ['), sw.indexOf('];', sw.indexOf('const SHELL_ASSETS = [')));
const assets = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

test('SHELL_ASSETS contains all modules and stylesheets', () => {
  const missing = [
    ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('css/', root)).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`),
  ].filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], `Missing from the service worker: ${missing.join(', ')}`);
});

test('SHELL_ASSETS only refers to existing files', () => {
  const dangling = assets.filter((f) => !existsSync(new URL(f, root)));
  assert.deepEqual(dangling, []);
});

// FE-15: The app icons (home screen, manifest) were missing from the offline cache.
test('SHELL_ASSETS contains the app icons from the manifest and index.html', () => {
  const missing = readdirSync(new URL('assets/icons/', root))
    .map((f) => `assets/icons/${f}`).filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], `Missing from the service worker: ${missing.join(', ')}`);
});

// FE-15/UI-22: Landscape on tablets and zooming remain allowed.
test('Manifest locks no orientation, index.html no zooming', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.orientation, undefined);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const viewport = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';
  assert.ok(viewport.includes('width=device-width'));
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?![.\d])/);
});
