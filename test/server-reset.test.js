/* Leerer oder neu aufgesetzter Server (z. B. nach dem Leeren der ACC- oder TEST-Umgebung):
   Das Gerät darf keine Profile mehr anbieten, die der Server nicht kennt – sonst endet jede
   Anmeldung mit „Dieses Profil gibt es nicht (mehr).“ und die Ersteinrichtung erscheint nie. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../js/sha256.js';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';
import { render as renderLogin } from '../js/login.js';

const realFetch = globalThis.fetch;
const H = (id, pin) => sha256Hex(`catofit:${id}:${pin}`);
const setOnline = (on) => window.dispatchEvent(new Event(on ? 'online' : 'offline'));
const wait = async (cond, ms = 2000) => { for (let t = 0; t < ms && !cond(); t += 10) await new Promise((r) => setTimeout(r, 10)); };
let srv;

beforeEach(async () => {
  setOnline(true);
  localStorage.clear();
  sessionStorage.clear();
  srv = globalThis.__fakeServer.install();
  store.clearActiveUser();
  const f = srv.store('family', { scope: 'family' });
  f.records['u-1'] = { id: 'u-1', _kind: 'member', name: 'Alex', role: 'admin', pinHash: H('u-1', '2468'), createdAt: '2026-09-01T00:00:00Z', rev: ++f.rev };
  f.records['u-2'] = { id: 'u-2', _kind: 'member', name: 'Lea', role: 'user', createdAt: '2026-09-02T00:00:00Z', rev: ++f.rev };
  store.saveFamily({ members: [] });
  localStorage.removeItem(scopeKey('familyStore'));
  await store.init();                  // neues Gerät: holt die Familie vom Server
  await wait(() => store.members().length === 2);
});
afterEach(() => { setOnline(true); globalThis.fetch = realFetch; });

test('Server geleert (ACC/TEST): das Gerät übernimmt den leeren Stand, die Ersteinrichtung erscheint', async () => {
  assert.equal(store.members().length, 2, 'Ausgangslage: zwei Profile vom Server');
  // Deploy leert die Laufzeitdaten des Servers; der Browser behält seinen Zwischenspeicher.
  const f = srv.store('family', { scope: 'family' });
  f.rev = 0; f.records = {};
  store.clearActiveUser();
  await store.init();                  // App neu geöffnet: zeigt zuerst den Zwischenspeicher …
  await wait(() => store.members().length === 0);
  assert.equal(store.members().length, 0, '… und übernimmt dann den leeren Server');
  assert.equal(store.serverWasReset(), true);
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  location.hash = '#/login';
  renderLogin(view);                   // lädt bei leerer Liste kurz nach und entscheidet dann
  await wait(() => /Der Server ist leer/.test(view.textContent));
  assert.match(view.textContent, /Der Server ist leer/);
  assert.match(view.textContent, /Administrator:in anlegen/, 'Ersteinrichtung statt alter Kacheln');
});

test('Profil auf dem Server unbekannt: die Anmeldung räumt die veraltete Kachel ab', async () => {
  // Gerät kennt noch „Tom“ (anderswo entfernt), der Server nicht – ohne ungesendete Änderungen.
  const fam = JSON.parse(localStorage.getItem(scopeKey('familyStore')));
  fam.records['u-9'] = { id: 'u-9', _kind: 'member', name: 'Tom', role: 'user', rev: 1 };
  localStorage.setItem(scopeKey('familyStore'), JSON.stringify(fam));
  store.clearActiveUser();
  await store.init();
  assert.ok(store.members().some((m) => m.id === 'u-9'), 'Kachel noch da');
  const ok = await store.login('u-9', '');
  assert.equal(ok, false);
  assert.equal(store.lastLoginError().code, 'unknown');
  assert.ok(!store.members().some((m) => m.id === 'u-9'), 'veraltete Kachel entfernt');
  assert.equal(store.members().length, 2, 'die echten Profile bleiben');
  assert.equal(store.serverWasReset(), false, 'kein leerer Server');
});

test('Offline begonnene Ersteinrichtung bleibt erhalten (ungesendete Familien-Änderungen)', async () => {
  // Server leer, aber das Gerät hat eine noch nicht gesendete Familie: nichts verwerfen.
  const f = srv.store('family', { scope: 'family' });
  f.rev = 0; f.records = {};
  setOnline(false);
  store.saveFamily({ members: [{ id: 'u-5', name: 'Neu', role: 'admin' }] });
  setOnline(true);
  srv.opts.offline = true;             // Senden scheitert noch
  store.clearActiveUser();
  await store.init();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(store.members().some((m) => m.id === 'u-5'), 'ungesendete Mitglieder bleiben');
});
