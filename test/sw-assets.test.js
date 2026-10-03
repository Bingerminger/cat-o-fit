/* Service Worker: Jedes Modul und jedes Stylesheet muss im Offline-Cache stehen.
   Fehlt ein neues Modul in SHELL_ASSETS, lädt die App offline nicht – der Fehler
   fällt online nicht auf und wäre ohne diesen Test erst beim Nutzer sichtbar. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('service-worker.js', root), 'utf8');
const block = sw.slice(sw.indexOf('const SHELL_ASSETS = ['), sw.indexOf('];', sw.indexOf('const SHELL_ASSETS = [')));
const assets = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

test('SHELL_ASSETS enthält alle Module und Stylesheets', () => {
  const missing = [
    ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('css/', root)).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`),
  ].filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], `Im Service Worker fehlen: ${missing.join(', ')}`);
});

test('SHELL_ASSETS verweist nur auf vorhandene Dateien', () => {
  const dangling = assets.filter((f) => !existsSync(new URL(f, root)));
  assert.deepEqual(dangling, []);
});

// FE-15: Die App-Symbole (Homescreen, Manifest) fehlten im Offline-Cache.
test('SHELL_ASSETS enthält die App-Symbole aus Manifest und index.html', () => {
  const missing = readdirSync(new URL('assets/icons/', root))
    .map((f) => `assets/icons/${f}`).filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], `Im Service Worker fehlen: ${missing.join(', ')}`);
});

// FE-15/UI-22: Querformat auf Tablets und Zoomen bleiben erlaubt.
test('Manifest sperrt keine Ausrichtung, index.html kein Zoomen', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.orientation, undefined);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const viewport = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';
  assert.ok(viewport.includes('width=device-width'));
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?![.\d])/);
});
