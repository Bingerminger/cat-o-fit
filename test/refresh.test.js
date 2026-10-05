/* =========================================================================
   refresh.test.js — redraw instead of reload (UI-10, FE-12):
   After saving, the app redraws the open view via the router –
   the scroll position is kept, the confirmation stays visible, a form from
   another view does not replace the open page. The background sync redraws
   only when there is genuinely new content.
   ========================================================================= */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as store from '../js/storage.js';
import { el, setRefreshHandler, refreshView, goOrRefresh } from '../js/ui.js';
import { register, refresh, onAfterRender } from '../js/router.js';
import { render as renderChecklist } from '../js/checklist.js';

['view', 'header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root'].forEach((id) => {
  if (!document.getElementById(id)) document.body.appendChild(el('div', { id }));
});

// Simulate the window scroll position (the router reads scrollY and calls scrollTo).
let scrollCalls = [];
globalThis.scrollY = 0;
globalThis.scrollTo = (x, y) => { scrollCalls.push(y); globalThis.scrollY = y; };

afterEach(() => { setRefreshHandler(null); });

test('location.reload() remains only for restart, restoring a backup, app update and diagnosis', () => {
  const dir = new URL('../js/', import.meta.url);
  const found = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const n = (readFileSync(new URL(f, dir), 'utf8').match(/location\.reload\(/g) || []).length;
    if (n) found[f] = n;
  }
  // settings.js: reset the app, restore a backup, restore a family backup –
  // afterwards the whole data set is new. app.js: new service worker. boot-check.js: diagnosis.
  assert.deepEqual(found, { 'app.js': 1, 'boot-check.js': 1, 'settings.js': 3 });
});

test('refreshView: with the app shell the router redraws, without a shell the own fallback applies', () => {
  let routed = 0; let local = 0;
  refreshView(() => { local++; });
  assert.equal(local, 1, 'without a handler (tests, single view) the fallback applies');
  setRefreshHandler(() => { routed++; });
  refreshView(() => { local++; });
  refreshView();
  assert.equal(routed, 2);
  assert.equal(local, 1, 'with a handler no additional local drawing');
});

test('goOrRefresh: same page → redraw, other page → navigate', () => {
  let routed = 0;
  setRefreshHandler(() => { routed++; });
  location.hash = '#/plan/e1';
  goOrRefresh('#/plan/e1');
  assert.equal(routed, 1);
  assert.equal(location.hash, '#/plan/e1');
  goOrRefresh('#/calendar');
  assert.equal(routed, 1, 'navigating does not additionally redraw');
  assert.equal(location.hash, '#/calendar');
});

test('router.refresh keeps the scroll position, a page change starts at the top', () => {
  const seen = [];
  const off = onAfterRender((cur, info) => seen.push([cur.path, info && info.refreshed]));
  let renders = 0;
  register('/lang', (view) => { renders++; view.appendChild(el('p', { text: 'lange Liste' })); });
  register('/anders', () => {});
  location.hash = '#/lang'; refresh();           // first call = page change
  globalThis.scrollY = 640; scrollCalls = [];
  refresh();                                       // save → redraw
  assert.equal(renders, 2);
  assert.deepEqual(scrollCalls, [640], 'scroll position restored');
  location.hash = '#/anders'; scrollCalls = [];
  refresh();
  assert.deepEqual(scrollCalls, [0], 'new page starts at the top');
  assert.deepEqual(seen, [['/lang', false], ['/lang', true], ['/anders', false]]);
  off();
});

test('Checklist: ticking off redraws via the router (not the checklist into other pages)', async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  store.replaceArea('checklist', [{ id: 'c1', text: '2 Liter Wasser', recurring: true, checked: false, category: 'routine' }]);
  const view = document.getElementById('view');
  view.innerHTML = '';
  renderChecklist(view);
  let routed = 0;
  setRefreshHandler(() => { routed++; });
  const box = view.querySelectorAll('button').find((b) => b.getAttribute('role') === 'checkbox'
    || /offen|erledigt/.test(b.getAttribute('aria-label') || ''));
  assert.ok(box, 'tick-off button present');
  box.click();
  assert.equal(routed, 1, 'the router redraws the open page');
  assert.equal(store.find('checklist', 'c1').checked, true);
});

/* ------------------------- Background sync (FE-12) ------------------------- */
const realFetch = globalThis.fetch;
test('Sync: own records with a server rev do not trigger a redraw, changes from others do', async () => {
  localStorage.clear();
  const srv = globalThis.__fakeServer.install();
  try {
    store.clearActiveUser();
    store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' }], settings: {}, pantry: [], teams: [] });
    await store.login('u-1', '');
    await store.syncNow();
    const events = [];
    const off = store.onSync((area, origin) => { if (origin === 'sync') events.push(area); });
    store.upsert('sessions', { id: 's-a', date: '2026-09-01', type: 'lauf' });
    await store.syncNow();
    await store.syncNow();
    assert.deepEqual(events.filter((a) => a === 'sessions'), [], 'only the own unit came back');
    // A second device changes the unit on the server.
    const s = srv.store('sessions', { user: 'u-1' });
    s.records['s-a'] = { ...s.records['s-a'], distanceKm: 8, updatedAt: new Date().toISOString(), rev: ++s.rev };
    await store.syncNow();
    assert.ok(events.includes('sessions'), 'a real change redraws');
    assert.equal(store.find('sessions', 's-a').distanceKm, 8);
    off();
  } finally { globalThis.fetch = realFetch; }
});

test('UI-41/UI-30: Checklist – real checkbox, deleting with "Undo"', async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  store.replaceArea('checklist', [{ id: 'c2', text: 'Dehnen', recurring: true, checked: false, category: 'routine' }]);
  if (!document.getElementById('toast-root')) document.body.appendChild(el('div', { id: 'toast-root' }));
  const view = document.getElementById('view');
  view.innerHTML = '';
  renderChecklist(view);
  const box = view.querySelectorAll('button').find((b) => b.getAttribute('role') === 'checkbox');
  assert.equal(box.getAttribute('aria-label'), 'Dehnen', 'name = entry');
  assert.equal(box.getAttribute('aria-checked'), 'false');
  const del = view.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === '„Dehnen“ löschen');
  del.click();
  assert.equal(store.find('checklist', 'c2'), null, 'deleted');
  const undo = document.getElementById('toast-root').querySelectorAll('button').find((b) => b.textContent === 'Rückgängig');
  assert.ok(undo, 'toast offers "Undo"');
  undo.click();
  assert.equal(store.find('checklist', 'c2').text, 'Dehnen', 'restored');
});
