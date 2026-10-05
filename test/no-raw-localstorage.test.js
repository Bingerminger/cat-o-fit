/* =========================================================================
   no-raw-localstorage.test.js — architectural invariant of the environment isolation.

   Only the storage capsule (js/env.js, js/storage.js) may touch localStorage
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
const ALLOWED = new Set(['env.js', 'storage.js']); // the only permitted storage capsule

test('no raw localStorage outside the storage capsule (env.js/storage.js)', () => {
  const offenders = [];
  for (const file of readdirSync(JS_DIR)) {
    if (!file.endsWith('.js') || ALLOWED.has(file)) continue;
    const src = readFileSync(join(JS_DIR, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\blocalStorage\s*[.[]/.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [],
    `Raw localStorage accesses found – use lsGet/lsSet/lsRemove from env.js:\n${offenders.join('\n')}`);
});
