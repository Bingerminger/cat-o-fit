/* "Reset the app" (Settings, admin only) against the protocol-faithful test server: it deletes every
   person and the family on the server and only then reports success; if the server cannot do it,
   the device keeps its data and the app says so. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

const realFetch = globalThis.fetch;
let srv;
const FAMILY = {
  members: [
    { id: 'u-1', name: 'Robin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'u-2', name: 'Kim', role: 'user', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'u-3', name: 'Sam', role: 'admin', createdAt: '2026-01-03T00:00:00Z' },
  ],
  settings: {}, pantry: [], teams: [],
};
const wait = async (cond, ms = 2000) => { for (let t = 0; t < ms && !cond(); t += 10) await new Promise((r) => setTimeout(r, 10)); };
const live = (scope, area, user) => Object.values(srv.store(area, { scope, user }).records).filter((r) => r && !r.deleted);

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  srv = globalThis.__fakeServer.install();
  srv.opts.features = ['changes-all', 'ops-since', 'merge-ops'];
  store.clearActiveUser();
  // The family lives on the server; the device fetches it like a real one.
  const f = srv.store('family', { scope: 'family' });
  for (const m of FAMILY.members) f.records[m.id] = { ...m, _kind: 'member', rev: ++f.rev };
  store.saveFamily({ members: [] });
  localStorage.removeItem(scopeKey('familyStore'));
  await store.init();
  await wait(() => store.members().length === 3);
  await store.login('u-1', '');
  await store.syncNow();
  for (const u of ['u-2', 'u-3']) {
    const s = srv.store('sessions', { user: u });
    s.records[`s-${u}`] = { id: `s-${u}`, date: '2026-11-01', updatedAt: new Date().toISOString(), rev: ++s.rev };
  }
  store.upsert('sessions', { id: 's-u-1', date: '2026-11-02' });
  await store.syncNow();
});
afterEach(() => { globalThis.fetch = realFetch; });

test('reset deletes every person and the family on the server, then reports success', async () => {
  assert.equal(live('family', 'family', null).length, 3);
  const ok = await store.resetApp();
  assert.equal(ok, true);
  assert.equal(live('family', 'family', null).filter((r) => (r._kind || 'member') === 'member').length, 0, 'no member left on the server');
  for (const u of ['u-1', 'u-2', 'u-3']) assert.equal(live('user', 'sessions', u).length, 0, `${u}: data gone`);
  assert.equal(store.members().length, 0, 'the device starts over');
});

test('nothing sent after the reset recreates data on the server', async () => {
  store.setSetting('accent', 'teal');          // a change still waiting in the queue
  await store.resetApp();
  await store.syncNow();
  assert.equal(live('user', 'profile', 'u-1').length, 0, 'no profile file appears again');
});

test('server not reachable: no success, the device keeps its data', async () => {
  srv.opts.offline = true;
  const ok = await store.resetApp();
  assert.equal(ok, false);
  assert.equal(store.members().length, 3, 'family still on the device');
  assert.ok(store.find('sessions', 's-u-1'), 'own data still on the device');
});

test('a deletion the server refuses: no success, the device keeps its data', async () => {
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'delete-user' && u.searchParams.get('user') === 'u-2' ? 500 : null);
  const ok = await store.resetApp();
  assert.equal(ok, false);
  assert.equal(store.members().length, 3);
});
