/* The store in parts (since 4.2): js/storage.js is the only door, the parts js/store-*.js lie in
   layers. Each part names its layer in its head ("Layer N") and imports only parts of a lower
   layer – so there is never an import cycle (FE-18) and a part can be read without the ones above.
   Views and tests import the store from js/storage.js, never a part directly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = join(ROOT, 'js');
const parts = readdirSync(JS).filter((f) => /^store-[\w-]+\.js$/.test(f));
const read = (f) => readFileSync(join(JS, f), 'utf8');
const layerOf = (f) => Number((read(f).match(/Layer (\d+)/) || [])[1]);
const importsOf = (src) => [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'(?:\.\/|\.\.\/js\/)(store-[\w-]+\.js)'/gm)].map((m) => m[1]);

test('STORE-01: every part names its layer and imports only lower layers', () => {
  assert.ok(parts.length >= 10, `only ${parts.length} parts found`);
  const bad = [];
  for (const f of parts) {
    const own = layerOf(f);
    if (!Number.isInteger(own)) { bad.push(`${f}: no "Layer N" in its head`); continue; }
    for (const d of importsOf(read(f))) {
      if (!parts.includes(d)) bad.push(`${f} imports ${d}, which does not exist`);
      else if (!(layerOf(d) < own)) bad.push(`${f} (layer ${own}) imports ${d} (layer ${layerOf(d)})`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('STORE-02: only js/storage.js imports the parts', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', 'scratch', 'dist', 'graphify-out', '.claude'].includes(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.(m?js)$/.test(e.name) ? [p] : []);
  });
  const outside = walk(ROOT)
    .filter((p) => !/\/js\/store-[\w-]+\.js$/.test(p) && !p.endsWith('/js/storage.js'))
    .filter((p) => importsOf(readFileSync(p, 'utf8')).length || /import\(\s*'[^']*store-[\w-]+\.js'/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p));
  assert.deepEqual(outside, [], `import the store from js/storage.js: ${outside.join(', ')}`);
});

test('STORE-03: the door re-exports the public names, nothing else lives in it', () => {
  const door = read('storage.js').replace(/\/\*[\s\S]*?\*\//g, '');
  const code = door.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(code.every((l) => /^export \{$|^[\w$, ]+,?$|^\} from '\.\/store-[\w-]+\.js';$/.test(l)), `storage.js holds more than re-exports:\n${code.filter((l) => !/^export \{$|^[\w$, ]+,?$|^\} from/.test(l)).join('\n')}`);
});
