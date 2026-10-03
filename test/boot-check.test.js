/* =========================================================================
   boot-check.test.js — Startdiagnose (FE-08): Ein langsamer Start (Server im
   Ruhezustand, schwaches Netz) ist kein Fehler; die Fehlerseite erscheint nur,
   wenn das Programm nicht lief oder ein echter Fehler aufgezeichnet wurde – und
   verschwindet, sobald die App doch startet. Der Service Worker nimmt nach 3 s
   die gespeicherte Shell.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/boot-check.js', import.meta.url), 'utf8');

/** Führt boot-check.js mit nachgebautem Fenster und Hand-Timern aus. */
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

test('FE-08: langsamer Start ohne Fehler zeigt keine Fehlerseite', () => {
  const r = run();
  r.listeners.load();
  r.tick();                         // nach 8 s: noch nicht gebootet, aber kein Fehler
  assert.equal(r.body.kids.length, 0, 'keine Fehlerseite');
  r.win.__catofitBooted = true;
  r.tick();                         // spätere Prüfung
  assert.equal(r.body.kids.length, 0);
});

test('FE-08: echter Fehler zeigt die Diagnose – und sie verschwindet, wenn die App doch startet', () => {
  const r = run();
  r.listeners.error({ message: 'Boom', target: r.win });
  r.listeners.load();
  r.tick();
  assert.equal(r.body.kids.length, 1, 'Fehlerseite bei echtem Fehler');
  r.win.__catofitBooted = true;
  r.tick();                         // Wächter räumt auf
  assert.equal(r.body.kids.length, 0, 'nach dem späten Start wieder weg');
});

test('FE-08: nicht ausgeführtes Programm (MIME/fehlende Datei) zeigt die Diagnose weiterhin', () => {
  const r = run({ moduleLoaded: false });
  r.listeners.load();
  r.tick();
  assert.equal(r.body.kids.length, 1);
});

test('FE-08/UI-43: Service Worker nimmt nach 3 s die gespeicherte Shell', () => {
  const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /setTimeout\(\(\) => resolve\('timeout'\), 3000\)/);
  assert.match(sw, /Promise\.race\(\[network, timeout\]\)/);
});
