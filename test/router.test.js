/* =========================================================================
   router.test.js — hash router (#/session/:id): registration, parameter extraction,
   guard, not-found and afterRender callback. Builds the minimal app shell
   (#view + header elements) that the router expects when rendering.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { el } from '../js/ui.js';
import { register, setNotFound, setGuard, onAfterRender, refresh } from '../js/router.js';

// window.scrollTo is not set in test-setup – the router calls it after rendering.
globalThis.scrollTo = globalThis.scrollTo || (() => {});

// App shell that render()/setHeader() expect via getElementById.
['view', 'header-title', 'header-subtitle', 'header-back', 'header-actions'].forEach((id) => {
  document.body.appendChild(el('div', { id }));
});

function go(hash) { location.hash = hash; refresh(); }

test('register + dispatch: handler receives (view, params) on a matching route', () => {
  let got = null;
  register('/session/:id', (view, params) => { got = { hasView: !!view, params }; });
  go('#/session/abc123');
  assert.ok(got, 'handler called');
  assert.equal(got.hasView, true);
  assert.deepEqual(got.params, { id: 'abc123' }, ':id extracted');
});

test('Param decoding: %-encoded segments are decoded', () => {
  let p = null;
  register('/plan/:name', (v, params) => { p = params; });
  go('#/plan/Woche%201');
  assert.deepEqual(p, { name: 'Woche 1' });
});

test('Trailing slash and empty hash normalise to "/"', () => {
  let hits = 0;
  register('/', () => { hits++; });
  go('#/');
  location.hash = ''; refresh();  // empty hash -> "/"
  assert.ok(hits >= 2, 'root route matches on "#/" and on an empty hash');
});

test('setNotFound: fallback handler when no route matches', () => {
  let nf = false;
  setNotFound(() => { nf = true; });
  go('#/gibt-es-nicht-xyz');
  assert.equal(nf, true);
});

test('onAfterRender: fires after rendering with current {path, params}', () => {
  let seen = null;
  const off = onAfterRender((cur) => { seen = cur; });
  register('/after/:id', () => {});
  go('#/after/7');
  assert.equal(seen && seen.path, '/after/7');
  assert.deepEqual(seen.params, { id: '7' });
  off();
});

test('setGuard: if the guard returns false, nothing is rendered', () => {
  let rendered = false;
  register('/guarded/:id', () => { rendered = true; });
  setGuard((path) => !path.startsWith('/guarded'));  // blocks /guarded* (the guard has "redirected")
  go('#/guarded/1');
  assert.equal(rendered, false, 'guard blocks the render');
  setGuard(null);  // reset for any following tests
});

test('FE-19: lazily loaded view – follow-up work only after drawing', async () => {
  const order = [];
  const off = onAfterRender((cur) => { if (cur.path === '/spaet') order.push('after'); });
  register('/spaet', (view) => Promise.resolve().then(() => { view.appendChild(el('p', { text: 'geladen' })); order.push('render'); }));
  go('#/spaet');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ['render', 'after']);
  off();
});

test('FE-19: demo.js and the large views do not load at startup', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (f) => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
  const statics = ['app.js', 'storage.js', 'dashboard.js', 'capture.js'].map(src).join('\n');
  for (const m of ['demo', 'help', 'labs-view', 'reports', 'family-admin', 'health-import', 'workout-mode']) {
    assert.doesNotMatch(statics, new RegExp(`from '\\./${m}\\.js'`), `${m}.js statically imported`);
  }
});
