/* Empty or freshly set-up server (e.g. after emptying the ACC or TEST environment):
   the device must not offer any profiles that the server does not know – otherwise every
   login ends with "This profile does not exist (any more)." and the first-time setup never appears. */
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
  await store.init();                  // new device: fetches the family from the server
  await wait(() => store.members().length === 2);
});
afterEach(() => { setOnline(true); globalThis.fetch = realFetch; });

test('Server emptied (ACC/TEST): the device adopts the empty state, the first-time setup appears', async () => {
  assert.equal(store.members().length, 2, 'starting point: two profiles from the server');
  // The deploy empties the server's runtime data; the browser keeps its cache.
  const f = srv.store('family', { scope: 'family' });
  f.rev = 0; f.records = {};
  store.clearActiveUser();
  await store.init();                  // app reopened: first shows the cache …
  await wait(() => store.members().length === 0);
  assert.equal(store.members().length, 0, '… and then adopts the empty server');
  assert.equal(store.serverWasReset(), true);
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  location.hash = '#/login';
  renderLogin(view);                   // reloads briefly when the list is empty and then decides
  await wait(() => /Der Server ist leer/.test(view.textContent));
  assert.match(view.textContent, /Der Server ist leer/);
  assert.match(view.textContent, /Administrator:in anlegen/, 'first-time setup instead of old tiles');
});

test('Profile unknown on the server: the login removes the stale tile', async () => {
  // The device still knows "Tom" (removed elsewhere), the server does not – without unsent changes.
  const fam = JSON.parse(localStorage.getItem(scopeKey('familyStore')));
  fam.records['u-9'] = { id: 'u-9', _kind: 'member', name: 'Tom', role: 'user', rev: 1 };
  localStorage.setItem(scopeKey('familyStore'), JSON.stringify(fam));
  store.clearActiveUser();
  await store.init();
  assert.ok(store.members().some((m) => m.id === 'u-9'), 'tile still there');
  const ok = await store.login('u-9', '');
  assert.equal(ok, false);
  assert.equal(store.lastLoginError().code, 'unknown');
  assert.ok(!store.members().some((m) => m.id === 'u-9'), 'stale tile removed');
  assert.equal(store.members().length, 2, 'the real profiles remain');
  assert.equal(store.serverWasReset(), false, 'not an empty server');
});

test('First-time setup begun offline is preserved (unsent family changes)', async () => {
  // Server empty, but the device has a family that has not been sent yet: discard nothing.
  const f = srv.store('family', { scope: 'family' });
  f.rev = 0; f.records = {};
  setOnline(false);
  store.saveFamily({ members: [{ id: 'u-5', name: 'Neu', role: 'admin' }] });
  setOnline(true);
  srv.opts.offline = true;             // sending still fails
  store.clearActiveUser();
  await store.init();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(store.members().some((m) => m.id === 'u-5'), 'unsent members remain');
});
