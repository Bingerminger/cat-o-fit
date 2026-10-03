/* =========================================================================
   refresh.test.js — Neu zeichnen statt Neuladen (UI-10, FE-12):
   Nach dem Speichern zeichnet die App die offene Ansicht über den Router neu –
   Scrollposition bleibt, die Bestätigung bleibt sichtbar, ein Formular aus einer
   anderen Ansicht ersetzt nicht die offene Seite. Der Hintergrund-Sync zeichnet
   nur bei echtem neuem Inhalt neu.
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

// Scrollposition des Fensters nachbilden (der Router liest scrollY und ruft scrollTo).
let scrollCalls = [];
globalThis.scrollY = 0;
globalThis.scrollTo = (x, y) => { scrollCalls.push(y); globalThis.scrollY = y; };

afterEach(() => { setRefreshHandler(null); });

test('location.reload() bleibt nur für Neustart, Backup-Einspielen, App-Update und Diagnose', () => {
  const dir = new URL('../js/', import.meta.url);
  const found = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const n = (readFileSync(new URL(f, dir), 'utf8').match(/location\.reload\(/g) || []).length;
    if (n) found[f] = n;
  }
  // settings.js: App zurücksetzen, Backup einspielen, Familien-Backup einspielen –
  // danach ist der ganze Datenbestand neu. app.js: neuer Service Worker. boot-check.js: Diagnose.
  assert.deepEqual(found, { 'app.js': 1, 'boot-check.js': 1, 'settings.js': 3 });
});

test('refreshView: mit App-Shell zeichnet der Router neu, ohne Shell der eigene Rückfall', () => {
  let routed = 0; let local = 0;
  refreshView(() => { local++; });
  assert.equal(local, 1, 'ohne Handler (Tests, Einzelansicht) greift der Rückfall');
  setRefreshHandler(() => { routed++; });
  refreshView(() => { local++; });
  refreshView();
  assert.equal(routed, 2);
  assert.equal(local, 1, 'mit Handler kein zusätzliches lokales Zeichnen');
});

test('goOrRefresh: gleiche Seite → neu zeichnen, andere Seite → wechseln', () => {
  let routed = 0;
  setRefreshHandler(() => { routed++; });
  location.hash = '#/plan/e1';
  goOrRefresh('#/plan/e1');
  assert.equal(routed, 1);
  assert.equal(location.hash, '#/plan/e1');
  goOrRefresh('#/calendar');
  assert.equal(routed, 1, 'Seitenwechsel zeichnet nicht zusätzlich neu');
  assert.equal(location.hash, '#/calendar');
});

test('router.refresh behält die Scrollposition, ein Seitenwechsel beginnt oben', () => {
  const seen = [];
  const off = onAfterRender((cur, info) => seen.push([cur.path, info && info.refreshed]));
  let renders = 0;
  register('/lang', (view) => { renders++; view.appendChild(el('p', { text: 'lange Liste' })); });
  register('/anders', () => {});
  location.hash = '#/lang'; refresh();           // erster Aufruf = Seitenwechsel
  globalThis.scrollY = 640; scrollCalls = [];
  refresh();                                       // Speichern → neu zeichnen
  assert.equal(renders, 2);
  assert.deepEqual(scrollCalls, [640], 'Scrollposition wiederhergestellt');
  location.hash = '#/anders'; scrollCalls = [];
  refresh();
  assert.deepEqual(scrollCalls, [0], 'neue Seite beginnt oben');
  assert.deepEqual(seen, [['/lang', false], ['/lang', true], ['/anders', false]]);
  off();
});

test('Checkliste: Abhaken zeichnet über den Router neu (nicht die Checkliste in fremde Seiten)', async () => {
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
  assert.ok(box, 'Abhaken-Knopf vorhanden');
  box.click();
  assert.equal(routed, 1, 'Router zeichnet die offene Seite neu');
  assert.equal(store.find('checklist', 'c1').checked, true);
});

/* ------------------------- Hintergrund-Sync (FE-12) ------------------------- */
const realFetch = globalThis.fetch;
test('Sync: eigene Datensätze mit Server-rev lösen kein Neuzeichnen aus, fremde Änderungen schon', async () => {
  localStorage.clear();
  const srv = globalThis.__fakeServer.install();
  try {
    store.clearActiveUser();
    store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin', createdAt: '2026-01-01T00:00:00Z' }], settings: {}, pantry: [], teams: [] });
    await store.login('u-1', '');
    await store.syncNow();
    const events = [];
    const off = store.onSync((area, origin) => { if (origin === 'sync') events.push(area); });
    store.upsert('sessions', { id: 's-a', date: '2026-09-01', type: 'lauf' });
    await store.syncNow();
    await store.syncNow();
    assert.deepEqual(events.filter((a) => a === 'sessions'), [], 'nur die eigene Einheit kam zurück');
    // Ein zweites Gerät ändert die Einheit auf dem Server.
    const s = srv.store('sessions', { user: 'u-1' });
    s.records['s-a'] = { ...s.records['s-a'], distanceKm: 8, updatedAt: new Date().toISOString(), rev: ++s.rev };
    await store.syncNow();
    assert.ok(events.includes('sessions'), 'echte Änderung zeichnet neu');
    assert.equal(store.find('sessions', 's-a').distanceKm, 8);
    off();
  } finally { globalThis.fetch = realFetch; }
});

test('UI-41/UI-30: Checkliste – echte Checkbox, Löschen mit „Rückgängig“', async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  store.replaceArea('checklist', [{ id: 'c2', text: 'Dehnen', recurring: true, checked: false, category: 'routine' }]);
  if (!document.getElementById('toast-root')) document.body.appendChild(el('div', { id: 'toast-root' }));
  const view = document.getElementById('view');
  view.innerHTML = '';
  renderChecklist(view);
  const box = view.querySelectorAll('button').find((b) => b.getAttribute('role') === 'checkbox');
  assert.equal(box.getAttribute('aria-label'), 'Dehnen', 'Name = Eintrag');
  assert.equal(box.getAttribute('aria-checked'), 'false');
  const del = view.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === '„Dehnen“ löschen');
  del.click();
  assert.equal(store.find('checklist', 'c2'), null, 'gelöscht');
  const undo = document.getElementById('toast-root').querySelectorAll('button').find((b) => b.textContent === 'Rückgängig');
  assert.ok(undo, 'Toast bietet „Rückgängig“');
  undo.click();
  assert.equal(store.find('checklist', 'c2').text, 'Dehnen', 'zurückgeholt');
});
