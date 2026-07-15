/* =========================================================================
   no-raw-localstorage.test.js — Architektur-Invariante der Umgebungs-Isolation.

   Nur die Storage-Kapsel (js/env.js, js/storage.js) darf localStorage direkt
   berühren. Jeder andere Zugriff MUSS über lsGet/lsSet/lsRemove aus env.js
   laufen, damit der Umgebungs-Namespace (scopeKey) nie vergessen wird und
   Produktion (/cat-o-fit/) und Abnahme (/cat-o-fit-acc/) auf derselben Origin
   getrennt bleiben. Dieser Test failt, sobald irgendwo im Produktivcode rohes
   localStorage auftaucht – die CI (Node 22 & 24) fängt das bei jedem Push.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const ALLOWED = new Set(['env.js', 'storage.js']); // die einzige erlaubte Storage-Kapsel

test('kein rohes localStorage außerhalb der Storage-Kapsel (env.js/storage.js)', () => {
  const offenders = [];
  for (const file of readdirSync(JS_DIR)) {
    if (!file.endsWith('.js') || ALLOWED.has(file)) continue;
    const src = readFileSync(join(JS_DIR, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\blocalStorage\s*[.[]/.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    `Rohe localStorage-Zugriffe gefunden – nutze lsGet/lsSet/lsRemove aus env.js:\n${offenders.join('\n')}`);
});
