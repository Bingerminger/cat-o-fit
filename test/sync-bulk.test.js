/* FE-26: bulk fetch (server with the capabilities 'changes-all' and 'ops-since') – one sync fetches the changes of all areas
   in ONE request instead of one per area; a push with "since" brings changes made elsewhere
   along. Older servers (without these capabilities) keep running unchanged via the single-area path. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { sha256Hex } from '../js/sha256.js';

const realFetch = globalThis.fetch;
let srv;
const count = (action) => srv.requests.filter((r) => r.action === action).length;

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  sessionStorage.clear();
  srv = globalThis.__fakeServer.install();
  store.clearActiveUser();
  // Server state: admin with PIN 1234 – the login opens a server session.
  const f = srv.store('family', { scope: 'family' });
  f.records['u-1'] = { id: 'u-1', _kind: 'member', name: 'Test', role: 'admin', pinHash: sha256Hex('catofit:u-1:1234'), createdAt: '2026-01-01T00:00:00Z', rev: ++f.rev };
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }] });
  await store.refreshFamily();
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Log in and get the first sync (incl. the weekly full sync) out of the way. */
async function ready(features) {
  srv.opts.features = features;
  assert.equal(await store.login('u-1', '1234'), true);
  await store.syncNow();
  srv.requests.length = 0;
}

test('FE-26: one bulk fetch instead of one request per area, a change made elsewhere arrives', async () => {
  await ready(['changes-all', 'ops-since']);
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-1'] = { id: 'hk-1', date: '2026-09-02', updatedAt: new Date().toISOString(), rev: ++s.rev };
  const l = srv.store('labs', { user: 'u-1' });
  l.records.l1 = { id: 'l1', analyte: 'ferritin', value: 44, date: '2026-09-01', updatedAt: new Date().toISOString(), rev: ++l.rev };
  await store.syncNow();
  assert.equal(count('changes-all'), 1, 'exactly one bulk fetch');
  assert.equal(srv.requests.filter((r) => r.action === 'changes' && r.scope === 'user').length, 0, 'no single-area fetches (the family has its own fetch)');
  assert.ok(store.find('sessions', 'hk-1'), 'record from elsewhere is on the device');
  assert.ok(store.find('labs', 'l1'), 'with its own session the private areas too');
});

test('FE-26: older servers – the single-area path, unchanged', async () => {
  await ready([]);
  await store.syncNow();
  assert.equal(count('changes-all'), 0);
  assert.ok(count('changes') >= 10, 'one fetch per area');
});

test('FE-26: push with "since" brings the change made elsewhere along', async () => {
  await ready(['changes-all', 'ops-since']);
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-2'] = { id: 'hk-2', date: '2026-09-03', updatedAt: new Date().toISOString(), rev: ++s.rev };
  store.upsert('sessions', { id: 'eigen', date: '2026-09-04' });
  // Only wait for the push – the bulk fetch should no longer have to contribute anything here.
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'changes-all' ? 503 : null);
  await store.syncNow();
  const push = srv.requests.find((r) => r.action === 'ops' && r.area === 'sessions');
  assert.ok(Number.isInteger(JSON.parse(push.body).since), 'the own marker is sent along');
  assert.ok(store.find('sessions', 'hk-2'), 'record from elsewhere arrived with the push response');
  assert.ok(store.find('sessions', 'eigen'));
});

test('FE-26: a restore on the server is also noticed in the bulk fetch (full sync of the area)', async () => {
  await ready(['changes-all', 'ops-since']);
  store.upsert('health', { id: 'h1', date: '2026-09-01', weight: 70 });
  await store.syncNow();
  srv.requests.length = 0;
  const h = srv.store('health', { user: 'u-1' });
  h.rev = 0;          // older state restored: rev below the remembered marker
  h.records = {};
  await store.syncNow();
  const full = srv.requests.find((r) => r.action === 'changes' && r.area === 'health' && /since=0\b/.test(r.url));
  assert.ok(full, 'full sync of the affected area');
  assert.ok(store.find('health', 'h1'), 'nothing is deleted locally in the process');
});

test('FE-26: expired server session – private areas locked, the app asks for the PIN', async () => {
  await ready(['changes-all', 'ops-since']);
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    srv.auth.session = null;
    const s = srv.store('sessions', { user: 'u-1' });
    s.records['hk-3'] = { id: 'hk-3', date: '2026-09-05', updatedAt: new Date().toISOString(), rev: ++s.rev };
    await store.syncNow();
    assert.equal(events.length, 1, 'ask for the PIN once');
    assert.ok(store.find('sessions', 'hk-3'), 'the remaining areas arrive anyway');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});
