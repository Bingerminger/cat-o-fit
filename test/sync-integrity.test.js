/* Data integrity of the sync against the protocol-faithful test server (test-setup.js,
   __fakeServer): there the push response carries the GLOBAL area rev, as on the real
   server; there is the 2000-ops limit (413), latency and errors per request.
   Every test here was red with the v3.19.0 state. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

const realFetch = globalThis.fetch;
let srv;
const meta = (u) => JSON.parse(localStorage.getItem(scopeKey(`${u}:__meta`)) || '{}');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  srv = globalThis.__fakeServer.install();
  store.clearActiveUser();
  store.saveFamily({
    members: [
      { id: 'u-1', name: 'Nora', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'u-2', name: 'Kind', role: 'user', createdAt: '2026-01-02T00:00:00Z' },
    ],
    settings: {}, pantry: [], teams: [],
  });
  await store.login('u-1', '');
});
afterEach(() => { globalThis.fetch = realFetch; localStorage.__setQuota(Infinity); });

test('FE-01: a change made elsewhere between two syncs still arrives after an own push', async () => {
  store.upsert('sessions', { id: 's-a', date: '2026-09-01' });
  await store.syncNow();
  // Health ingest or a second device writes directly to the server …
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-1'] = { id: 'hk-1', date: '2026-09-02', updatedAt: new Date().toISOString(), rev: ++s.rev };
  // … and this device then pushes an own change (response rev > hk-1).
  store.upsert('sessions', { id: 's-b', date: '2026-09-03' });
  await store.syncNow();
  await store.syncNow();
  assert.ok(store.find('sessions', 'hk-1'), 'record from elsewhere is on the device');
  assert.ok(store.find('sessions', 's-b'), 'own record stays');
});

test('FE-01 (family): a member from elsewhere is not lost after an own family push', async () => {
  const f = srv.store('family', { scope: 'family' });
  f.records['u-x'] = { id: 'u-x', _kind: 'member', name: 'Fremd', role: 'user', createdAt: '2026-09-01T00:00:00Z', updatedAt: new Date().toISOString(), rev: ++f.rev };
  await store.addMember({ name: 'Neu' });   // own family push with global rev
  await store.refreshFamily();
  await store.refreshFamily();
  assert.ok(store.members().some((m) => m.id === 'u-x'), 'member from the other device is there');
});

test('FE-24/FE-04: more than 2000 ops go out in chunks, later changes follow', async () => {
  const recs = Array.from({ length: 2100 }, (_, i) => ({ id: `h-${i}`, date: `2026-01-01`, weight: 70 }));
  const saved = store.upsertMany('health', recs);
  assert.equal(saved.length, 2100);
  assert.equal(meta('u-1').ops.health.length, 2100, 'one op per record, one write operation');
  await store.syncNow();
  const s = srv.store('health', { user: 'u-1' });
  assert.equal(Object.keys(s.records).length, 2100, 'all days on the server');
  const pushes = srv.requests.filter((r) => r.action === 'ops' && r.area === 'health');
  assert.ok(pushes.length >= 5 && pushes.every((r) => r.ops <= 500), 'at most 500 ops per request');
  store.upsert('health', { id: 'h-heute', date: '2026-09-29', weight: 71 });
  await store.syncNow();
  assert.ok(s.records['h-heute'], 'later single change arrives');
  assert.equal((meta('u-1').ops.health || []).length, 0, 'queue empty');
});

test('FE-24: with a smaller server limit the client halves the chunks (413)', async () => {
  srv.opts.opLimit = 100;
  store.upsertMany('health', Array.from({ length: 300 }, (_, i) => ({ id: `x-${i}`, date: '2026-02-01' })));
  await store.syncNow();
  assert.equal(Object.keys(srv.store('health', { user: 'u-1' }).records).length, 300);
  assert.ok(srv.requests.some((r) => r.status === 413), 'server rejected chunks that were too large');
});

test('FE-02: switching user during a slow push mixes nothing up', async () => {
  srv.opts.latencyMs = (u) => (u.searchParams.get('action') === 'ops' && u.searchParams.get('user') === 'u-1' ? 150 : 0);
  store.upsert('sessions', { id: 's-admin-1', date: '2026-09-01' });
  const running = store.syncNow();         // slow push of the admin is running
  await store.enterMember('u-2');           // admin opens the child
  store.upsert('sessions', { id: 's-kid-1', date: '2026-09-02' });
  await store.syncNow();
  await running;
  await store.syncNow();
  const kid = srv.store('sessions', { user: 'u-2' });
  const admin = srv.store('sessions', { user: 'u-1' });
  assert.ok(kid.records['s-kid-1'], 'input for the child on the server');
  assert.equal(kid.records['s-admin-1'], undefined, 'admin unit not with the child');
  assert.ok(admin.records['s-admin-1'], 'admin unit with the admin');
  assert.ok(!store.get('sessions').some((x) => x.id === 's-admin-1'), 'view of the child without the admin unit');
});

test('FE-03: full device storage – change is rolled back and reported', async () => {
  await store.syncNow();
  const events = [];
  const prev = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };
  try {
    localStorage.__setQuota(localStorage.__used() + 50);
    store.upsert('sessions', { id: 's-gross', notes: 'x'.repeat(500) });
    assert.equal(store.find('sessions', 's-gross'), null, 'not in the state');
    assert.ok(!((meta('u-1').ops || {}).sessions || []).some((o) => o.record && o.record.id === 's-gross'), 'no op in the queue');
    const lsArea = JSON.parse(localStorage.getItem(scopeKey('u-1:sessions')) || '[]');
    assert.ok(!lsArea.some((r) => r.id === 's-gross'), 'not in LocalStorage');
    assert.ok(events.includes('catofit:storage-full'), 'notice triggered');
  } finally { globalThis.dispatchEvent = prev; localStorage.__setQuota(Infinity); }
});

test('FE-03: managing a member leaves no data ballast', async () => {
  srv.store('sessions', { user: 'u-2' }).records['s-k'] = { id: 's-k', updatedAt: new Date().toISOString(), rev: 1 };
  srv.store('sessions', { user: 'u-2' }).rev = 1;
  await store.enterMember('u-2');
  await store.syncNow();          // since FE-08 the sync runs in the background
  assert.ok(localStorage.getItem(scopeKey('u-2:sessions')), 'cached while managing');
  await store.backToSelf();
  assert.equal(localStorage.getItem(scopeKey('u-2:sessions')), null, 'discarded after switching back');
});

test('FE-03: queue compacts ops of the same record', () => {
  store.upsert('events', { id: 'e1', name: 'A' });
  store.patch('events', 'e1', { name: 'B' });
  store.patch('events', 'e1', { name: 'C' });
  const ops = meta('u-1').ops.events;
  assert.equal(ops.length, 1);
  assert.equal(ops[0].record.name, 'C');
  assert.ok(ops[0].opId, 'op carries an opId');
});

test('API-04: server falls below the marker after a restore → cautious sync', async () => {
  for (const id of ['e-alt', 'e-2', 'e-3']) { store.upsert('events', { id }); await store.syncNow(); }
  const s = srv.store('events', { user: 'u-1' });
  // Restore of an older state (only e-alt) …
  const alt = { ...s.records['e-alt'] };
  s.records = { 'e-alt': alt }; s.rev = alt.rev;
  // … then another device keeps writing, the rev stays below this device's marker.
  s.records['e-neu'] = { id: 'e-neu', updatedAt: new Date(Date.now() + 1000).toISOString(), rev: ++s.rev };
  await store.syncNow();
  assert.ok(store.find('events', 'e-neu'), 'change after the restore arrives');
  assert.ok(store.find('events', 'e-3'), 'local copy is kept – nothing is deleted');
  assert.equal(meta('u-1').revs.events, s.rev, 'marker follows the server');
});

test('API-04: weekly full sync also finds an inconspicuous restore', async () => {
  for (const id of ['e-1', 'e-2']) { store.upsert('events', { id }); await store.syncNow(); }
  const s = srv.store('events', { user: 'u-1' });
  const first = { ...s.records['e-1'] };
  s.records = { 'e-1': first }; s.rev = first.rev;
  s.records['e-x'] = { id: 'e-x', updatedAt: new Date(Date.now() + 1000).toISOString(), rev: ++s.rev };   // rev == marker
  await store.syncNow();
  assert.equal(store.find('events', 'e-x'), null, 'the rev comparison alone does not see it');
  localStorage.setItem(scopeKey('u-1:__fullSync'), '0');
  await store.syncNow();
  assert.ok(store.find('events', 'e-x'), 'full sync fetches it');
});

test('FE-17: two tabs of the same user – both inputs stay in the queue', async () => {
  const tabB = await import('../js/storage.js?tab=b');
  await tabB.refreshFamily();
  await tabB.login('u-1', '');
  store.upsert('sessions', { id: 's-tabA', date: '2026-09-01' });
  tabB.upsert('sessions', { id: 's-tabB', date: '2026-09-01' });
  store.upsert('sessions', { id: 's-tabA2', date: '2026-09-02' });
  const ids = (meta('u-1').ops.sessions || []).map((o) => o.record && o.record.id).sort();
  assert.deepEqual(ids, ['s-tabA', 's-tabA2', 's-tabB'], 'no input overwritten');
  await store.syncNow();
  const s = srv.store('sessions', { user: 'u-1' });
  assert.ok(s.records['s-tabA'] && s.records['s-tabA2'] && s.records['s-tabB'], 'all three on the server');
  await tabB.logout();
});

test('FE-05: backup while managing leaves out private areas and only adds certificates', async () => {
  localStorage.setItem(scopeKey('u-2:reports'), JSON.stringify([{ id: 'r-alt', title: 'Alt', sealed: true, rev: 1 }]));
  await store.enterMember('u-2');
  const res = store.importAll({
    app: 'catofit', version: 1, events: [{ id: 'e-b' }],
    labs: [{ id: 'l-admin' }], cycle: [{ id: 'c-admin' }], reports: [{ id: 'r-neu', title: 'Neu' }],
  });
  assert.deepEqual([...res.privateSkipped].sort(), ['cycle', 'labs']);
  const ops = meta('u-2').ops;
  assert.ok(!(ops.labs || []).length && !(ops.cycle || []).length, 'no op for private areas');
  assert.ok(!(ops.reports || []).some((o) => o.op === 'replace'), 'certificates are not replaced');
  assert.deepEqual(store.get('reports').map((r) => r.id).sort(), ['r-alt', 'r-neu']);
});

test('API-05: full backup contains the teams; old backups without teams delete none', async () => {
  store.addTeam({ name: 'Läufer', memberIds: ['u-1'] });
  const dump = await store.exportFamilyAll();
  assert.equal(dump.family.teams.length, 1, 'teams in the backup');
  await store.importFamilyAll(dump);
  assert.equal(store.teams().length, 1, 'teams there after the restore');
  const old = { ...dump, family: { ...dump.family } };
  delete old.family.teams;
  await store.importFamilyAll(old);
  assert.equal(store.teams().length, 1, 'old backup without teams deletes no teams');
});

test('FE-16/API-06: restore waits for the server, reports what is pending and overwrites nothing newer later', async () => {
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'ops' && u.searchParams.get('user') === 'u-2' ? 500 : null);
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1,
    family: { members: [{ id: 'u-1', name: 'Nora', role: 'admin' }, { id: 'u-2', name: 'Kind', role: 'user' }], settings: {}, pantry: [], teams: [] },
    users: { 'u-1': { events: [{ id: 'e-bak' }] }, 'u-2': { sessions: [{ id: 's-bak' }] } },
  };
  const res = await store.importFamilyAll(dump);
  assert.equal(res.areas, 2);
  assert.equal(res.pending, 1, 'one area is still waiting');
  assert.ok(srv.store('events', { user: 'u-1' }).records['e-bak'], 'the reachable area is already on the server');
  // The child meanwhile records something themselves (on the server, newer than the restore state).
  const s = srv.store('sessions', { user: 'u-2' });
  s.records['s-neu'] = { id: 's-neu', updatedAt: new Date().toISOString(), rev: ++s.rev };
  srv.opts.failWhen = null;
  await store.syncNow();                     // sends the waiting replacement afterwards
  assert.ok(s.records['s-bak'] && !s.records['s-bak'].deleted, 'backup record arrived');
  assert.ok(s.records['s-neu'] && !s.records['s-neu'].deleted, 'newer input by the child is preserved');
});

test('One-off healing: old markers are discarded exactly once on first start', async () => {
  localStorage.setItem(scopeKey('u-2:__meta'), JSON.stringify({ revs: { sessions: 99 }, ops: {} }));
  localStorage.removeItem(scopeKey('syncHeal'));
  await store.init();
  assert.deepEqual(meta('u-2').revs, {}, 'markers reset');
  assert.equal(localStorage.getItem(scopeKey('syncHeal')), '3.20');
  localStorage.setItem(scopeKey('u-2:__meta'), JSON.stringify({ revs: { sessions: 5 }, ops: {} }));
  await store.init();
  assert.equal(meta('u-2').revs.sessions, 5, 'not a second time');
  await wait(0);
});

test('syncNow during a running sync waits for its end (including the new change)', async () => {
  srv.opts.latencyMs = 15;
  const first = store.syncNow();                 // running (e.g. the sync after login)
  store.upsert('sessions', { id: 's-spaet', date: '2026-09-29' });
  await store.syncNow();                         // "Sync now" – must wait
  const s = srv.store('sessions', { user: 'u-1' });
  assert.ok(s.records['s-spaet'], 'the new change is on the server after the await');
  await first;
  srv.opts.latencyMs = 0;
});

test('FE-08: server hangs – login waits only briefly, the app stays usable offline', async () => {
  store.clearActiveUser();
  srv.opts.latencyMs = 60000;                     // accepts connections, never answers
  const t0 = Date.now();
  const ok = await store.login('u-1', '');
  const took = Date.now() - t0;
  assert.equal(ok, true, 'login works without a server');
  assert.ok(took < 4000, `Login took ${took} ms (previously up to 6.6 min)`);
  assert.equal(store.activeUserId(), 'u-1');
  store.upsert('sessions', { id: 's-off', date: '2026-09-29' });   // keep working offline
  srv.opts.latencyMs = 0;
  await store.syncNow();
  assert.ok(srv.store('sessions', { user: 'u-1' }).records['s-off'], 'goes out after the return');
});
