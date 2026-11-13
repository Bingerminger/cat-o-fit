/* =========================================================================
   no-raw-localstorage.test.js — architectural invariant of the environment isolation.

   Only the storage capsule (js/env.js and the store parts js/store-*.js) may touch localStorage
   directly. Every other access MUST go through lsGet/lsSet/lsRemove from env.js
   so that the environment namespace (scopeKey) is never forgotten and
   production (/cat-o-fit/) and acceptance (/cat-o-fit-acc/) stay separate on the same
   origin. This test fails as soon as raw localStorage shows up anywhere in the
   production code – CI (Node 22 & 24) catches that on every push.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
// The only permitted storage capsule: env.js and the parts of the store (js/store-*.js, since 4.2;
// js/storage.js is only their door and touches no storage itself).
const allowed = (file) => file === 'env.js' || /^store-[\w-]+\.js$/.test(file);

test('no raw localStorage outside the storage capsule (env.js and the store parts)', () => {
  const offenders = [];
  for (const file of readdirSync(JS_DIR)) {
    if (!file.endsWith('.js') || allowed(file)) continue;
    const src = readFileSync(join(JS_DIR, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\blocalStorage\s*[.[]/.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    `Raw localStorage accesses found – use lsGet/lsSet/lsRemove from env.js:\n${offenders.join('\n')}`);
});
