/* =========================================================================
   import-graph.test.js — FE-18: no import cycles between the modules.
   A cycle (health → badges → plans → session → health) risked a TDZ error at module
   start-up with every restructuring ("Cannot access … before
   initialization") – the app would then stay blank.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
/** Only STATIC imports count (dynamic import() does not trigger a cycle at load time). */
const graph = Object.fromEntries(files.map((f) => {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const deps = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'\.\/([\w-]+\.js)'/gm)].map((m) => m[1]);
  return [f, [...new Set(deps)]];
}));

function findCycles() {
  const cycles = [];
  const state = {};   // 1 = in progress, 2 = done
  const stack = [];
  const visit = (n) => {
    state[n] = 1; stack.push(n);
    for (const d of graph[n] || []) {
      if (state[d] === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].join(' → '));
      else if (!state[d]) visit(d);
    }
    stack.pop(); state[n] = 2;
  };
  files.forEach((f) => { if (!state[f]) visit(f); });
  return cycles;
}

test('FE-18: no import cycles between the modules', () => {
  assert.deepEqual(findCycles(), []);
});
