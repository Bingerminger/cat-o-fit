/* The admin's full backup in one request per member (since 4.2), against the protocol-faithful test
   server (test-setup.js). Before, the app asked member × area one after another (10 members: 100
   requests); now one `changes-all` per member, a few members at a time. The file must stay the same:
   - one request per member, the same content as area by area,
   - the private areas are never asked for and never in the file (also not one's own),
   - tombstones and revs stay out, the profile has no id (as the server's logical view),
   - if the server cannot do it or the request fails, the backup asks area by area as before,
   - the members keep the family's order in the file. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';

const realFetch = globalThis.fetch;
const API = new URL('api/api.php', location.href).href;
const FEATURES = ['changes-all', 'ops-since', 'merge-ops'];
const IDS = ['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-6'];
const FAMILY = {
  members: IDS.map((id, i) => ({ id, name: `Person ${i + 1}`, role: i === 0 ? 'admin' : 'user', createdAt: `2026-01-0${i + 1}T00:00:00Z` })),
  settings: {}, pantry: [], teams: [],
};
const PRIVATE = ['cycle', 'labs', 'supplements'];
let srv;

async function ops(user, area, list) {
  const r = await globalThis.fetch(`${API}?action=ops&area=${area}&user=${user}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ops: list }),
  });
  const json = await r.json();
  assert.ok(json.ok, `seeding ${user}/${area}: ${JSON.stringify(json)}`);
}

/** Lists sorted by id: the order of records in the file does not matter for a restore. */
function canon(users) {
  const out = {};
  for (const [id, bucket] of Object.entries(users)) {
    out[id] = {};
    for (const [a, v] of Object.entries(bucket)) out[id][a] = Array.isArray(v) ? [...v].sort((x, y) => String(x.id).localeCompare(String(y.id))) : v;
  }
  return out;
}
const count = (pred) => srv.requests.filter(pred).length;
const isBulk = (r) => r.action === 'changes-all';
const isAreaGet = (r) => !r.action && r.area && r.scope === 'user';

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  srv = globalThis.__fakeServer.install();
  srv.opts.features = FEATURES.slice();
  store.clearActiveUser();
  // The first admin, then the others with the admin's session (the server takes new members only so).
  store.saveFamily({ ...FAMILY, members: FAMILY.members.slice(0, 1) });
  await store.login('u-1', '');
  await store.syncNow();
  store.saveFamily(FAMILY);
  await store.syncNow();
  assert.deepEqual(store.members().map((m) => m.id), IDS, 'all members on the server');
  for (const id of IDS) {
    await ops(id, 'profile', [{ op: 'upsert', record: { id: 'profile', name: `Person ${id}`, heightCm: 170 } }]);
    await ops(id, 'events', [{ op: 'upsert', record: { id: `e-${id}-1`, name: 'Race', date: '2026-12-01' } }, { op: 'upsert', record: { id: `e-${id}-2`, name: 'Run', date: '2026-12-08' } }]);
    await ops(id, 'sessions', [{ op: 'upsert', record: { id: `s-${id}`, date: '2026-11-01', type: 'easy', durationMin: 40 } }]);
  }
  await ops('u-2', 'events', [{ op: 'delete', id: 'e-u-2-1' }]);       // a tombstone
  store.replaceArea('cycle', [{ id: 'c1', date: '2026-11-01' }]);       // the admin's own private data
  await store.syncNow();
});
afterEach(() => { globalThis.fetch = realFetch; });

test('BACKUP-01: one request per member, the same content as area by area', async () => {
  srv.requests.length = 0;
  const bulk = await store.exportFamilyAll();
  assert.equal(count(isBulk), IDS.length, 'one changes-all per member');
  assert.equal(count(isAreaGet), 0, 'no request per area');

  // The same backup from a server without changes-all (the way before 4.2).
  srv.opts.features = ['ops-since', 'merge-ops'];
  await store.syncNow();                     // the app learns the features from the ping
  srv.requests.length = 0;
  const single = await store.exportFamilyAll();
  assert.equal(count(isBulk), 0);
  assert.equal(count(isAreaGet), IDS.length * 10, 'member × area');

  assert.deepEqual(Object.keys(bulk.users), Object.keys(single.users));
  assert.deepEqual(canon(bulk.users), canon(single.users));
  assert.deepEqual(bulk.family, single.family);
});

test('BACKUP-02: the private areas are never asked for and never in the file', async () => {
  srv.requests.length = 0;
  const dump = await store.exportFamilyAll();
  for (const r of srv.requests.filter(isBulk)) {
    const since = new URL(r.url).searchParams.get('since');
    for (const a of PRIVATE) assert.doesNotMatch(since, new RegExp(`\\b${a}:`), `${a} asked for`);
  }
  for (const id of IDS) for (const a of PRIVATE) assert.equal(dump.users[id][a], undefined, `${id}/${a} in the file`);
  assert.equal(dump.users['u-1'].cycle, undefined, 'not even the admin\'s own cycle');
});

test('BACKUP-03: tombstones and revs stay out, the profile has no id', async () => {
  const dump = await store.exportFamilyAll();
  assert.deepEqual(dump.users['u-2'].events.map((e) => e.id), ['e-u-2-2'], 'the deleted event is not in the file');
  assert.doesNotMatch(JSON.stringify(dump.users), /"rev":/);
  assert.doesNotMatch(JSON.stringify(dump.users), /"deleted":/);
  assert.equal(dump.users['u-3'].profile.id, undefined);
  assert.equal(dump.users['u-3'].profile.name, 'Person u-3');
  assert.equal(dump.users['u-3'].events.length, 2);
});

test('BACKUP-04: if the request per member fails, the backup asks area by area', async () => {
  const full = canon((await store.exportFamilyAll()).users);
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'changes-all' ? 500 : null);
  srv.requests.length = 0;
  const dump = await store.exportFamilyAll();
  assert.equal(count(isAreaGet), IDS.length * 10);
  assert.deepEqual(canon(dump.users), full);
});

test('BACKUP-05: the members keep the family\'s order in the file', async () => {
  // The first members answer slowest: the file must still list them first.
  srv.opts.latencyMs = (u) => (u.searchParams.get('action') === 'changes-all' ? (7 - Number(u.searchParams.get('user').slice(2))) * 5 : 0);
  const dump = await store.exportFamilyAll();
  srv.opts.latencyMs = 0;
  assert.deepEqual(Object.keys(dump.users), IDS);
});
