/* =========================================================================
   import-graph.test.js — FE-18: keine Import-Zyklen zwischen den Modulen.
   Ein Zyklus (health → badges → plans → session → health) riskierte bei jeder
   Umstellung einen TDZ-Fehler beim Modulstart („Cannot access … before
   initialization") – dann bliebe die App weiß.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
/** Nur STATISCHE Importe zählen (dynamisches import() löst keinen Zyklus beim Laden aus). */
const graph = Object.fromEntries(files.map((f) => {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const deps = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'\.\/([\w-]+\.js)'/gm)].map((m) => m[1]);
  return [f, [...new Set(deps)]];
}));

function findCycles() {
  const cycles = [];
  const state = {};   // 1 = in Arbeit, 2 = fertig
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

test('FE-18: keine Import-Zyklen zwischen den Modulen', () => {
  assert.deepEqual(findCycles(), []);
});
