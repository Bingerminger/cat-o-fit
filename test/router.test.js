/* =========================================================================
   router.test.js — Hash-Router (#/session/:id): Registrierung, Param-Extraktion,
   Guard, Not-Found und afterRender-Callback. Baut die minimale App-Shell
   (#view + Header-Elemente) auf, die der Router beim Rendern erwartet.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { el } from '../js/ui.js';
import { register, setNotFound, setGuard, onAfterRender, refresh } from '../js/router.js';

// window.scrollTo ist im test-setup nicht gesetzt – der Router ruft es nach dem Rendern.
globalThis.scrollTo = globalThis.scrollTo || (() => {});

// App-Shell, die render()/setHeader() per getElementById erwarten.
['view', 'header-title', 'header-subtitle', 'header-back', 'header-actions'].forEach((id) => {
  document.body.appendChild(el('div', { id }));
});

function go(hash) { location.hash = hash; refresh(); }

test('register + Dispatch: Handler erhält (view, params) bei passender Route', () => {
  let got = null;
  register('/session/:id', (view, params) => { got = { hasView: !!view, params }; });
  go('#/session/abc123');
  assert.ok(got, 'Handler aufgerufen');
  assert.equal(got.hasView, true);
  assert.deepEqual(got.params, { id: 'abc123' }, ':id extrahiert');
});

test('Param-Dekodierung: %-kodierte Segmente werden dekodiert', () => {
  let p = null;
  register('/plan/:name', (v, params) => { p = params; });
  go('#/plan/Woche%201');
  assert.deepEqual(p, { name: 'Woche 1' });
});

test('Trailing-Slash und leerer Hash normalisieren auf "/"', () => {
  let hits = 0;
  register('/', () => { hits++; });
  go('#/');
  location.hash = ''; refresh();  // leerer Hash -> "/"
  assert.ok(hits >= 2, 'Root-Route greift bei "#/" und bei leerem Hash');
});

test('setNotFound: Fallback-Handler bei keiner passenden Route', () => {
  let nf = false;
  setNotFound(() => { nf = true; });
  go('#/gibt-es-nicht-xyz');
  assert.equal(nf, true);
});

test('onAfterRender: feuert nach dem Rendern mit current {path, params}', () => {
  let seen = null;
  const off = onAfterRender((cur) => { seen = cur; });
  register('/after/:id', () => {});
  go('#/after/7');
  assert.equal(seen && seen.path, '/after/7');
  assert.deepEqual(seen.params, { id: '7' });
  off();
});

test('setGuard: gibt der Guard false zurück, wird NICHT gerendert', () => {
  let rendered = false;
  register('/guarded/:id', () => { rendered = true; });
  setGuard((path) => !path.startsWith('/guarded'));  // blockt /guarded* (Guard hat "umgeleitet")
  go('#/guarded/1');
  assert.equal(rendered, false, 'Guard blockiert den Render');
  setGuard(null);  // für etwaige Folgetests zurücksetzen
});
