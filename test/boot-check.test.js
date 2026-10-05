/* =========================================================================
   boot-check.test.js — start-up diagnostics (FE-08): a slow start (server
   idle, weak network) is not an error; the error page appears only if the
   program did not run or a real error was recorded – and disappears as soon
   as the app does start. After 3 s the service worker takes the stored shell.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/boot-check.js', import.meta.url), 'utf8');

/** Runs boot-check.js with a simulated window and hand-driven timers. */
function run({ moduleLoaded = true } = {}) {
  const listeners = {};
  const timers = [];
  const body = { kids: [], appendChild(n) { this.kids.push(n); n.parentNode = body; }, removeChild(n) { this.kids = this.kids.filter((k) => k !== n); n.parentNode = null; } };
  const win = { addEventListener: (t, f) => { listeners[t] = f; } };
  if (moduleLoaded) win.__catofitModuleLoaded = true;
  const doc = {
    body,
    getElementById: () => ({ children: [] }),
    createElement: () => ({ setAttribute() {}, set innerHTML(v) { this.html = v; }, querySelector: () => null, parentNode: null }),
  };
  const later = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  vm.runInNewContext(SRC, { window: win, document: doc, setTimeout: later, setInterval: later, clearInterval: () => {}, location: {} });
  const tick = () => { const t = timers.shift(); if (t) t.f(); };
  return { win, body, listeners, tick, timers };
}

test('FE-08: slow start without an error shows no error page', () => {
  const r = run();
  r.listeners.load();
  r.tick();                         // after 8 s: not booted yet, but no error
  assert.equal(r.body.kids.length, 0, 'no error page');
  r.win.__catofitBooted = true;
  r.tick();                         // later check
  assert.equal(r.body.kids.length, 0);
});

test('FE-08: a real error shows the diagnostics – and they disappear if the app does start after all', () => {
  const r = run();
  r.listeners.error({ message: 'Boom', target: r.win });
  r.listeners.load();
  r.tick();
  assert.equal(r.body.kids.length, 1, 'error page on a real error');
  r.win.__catofitBooted = true;
  r.tick();                         // watchdog cleans up
  assert.equal(r.body.kids.length, 0, 'gone again after the late start');
});

test('FE-08: program not executed (MIME/missing file) still shows the diagnostics', () => {
  const r = run({ moduleLoaded: false });
  r.listeners.load();
  r.tick();
  assert.equal(r.body.kids.length, 1);
});

test('FE-08/UI-43: service worker takes the stored shell after 3 s', () => {
  const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /setTimeout\(\(\) => resolve\('timeout'\), 3000\)/);
  assert.match(sw, /Promise\.race\(\[network, timeout\]\)/);
});
