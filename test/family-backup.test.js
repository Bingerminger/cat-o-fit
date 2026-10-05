/* Tests for the admin full backup of the whole family (js/storage.js):
   - only an admin may export/restore
   - strictly private cycle data is NEVER in the full backup
   - restore is authoritative (members + all included areas)
   - cycle data remains untouched on restore */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

// fetch mock: serves GET ?area= from LocalStorage (as the real server delivers
// the logical view); ops/changes answer empty. This way exportFamilyAll
// (peekUserArea -> apiGet) reads the data set in the test.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (action && action !== 'ping') return { ok: true, status: 200, json: async () => ({ ok: true, rev: 0, records: [] }) };
    const area = u.searchParams.get('area');
    const scope = u.searchParams.get('scope') === 'family' ? 'family' : 'user';
    const user = u.searchParams.get('user');
    let data = [];
    if (scope !== 'family' && area) {
      let recs = null; try { recs = JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { /* ignore */ }
      if (Array.isArray(recs)) data = recs.filter((r) => !r.deleted).map((r) => { const c = { ...r }; delete c.rev; return c; });
      else if (recs) data = recs;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({
    members: [
      { id: 'u-1', name: 'Nora', role: 'admin', emoji: '👩', color: '#18b48a' },
      { id: 'u-2', name: 'Kind', role: 'user', emoji: '🧒', color: '#3d8bff' },
    ],
    settings: { accent: '#18b48a' },
    pantry: [{ id: 'pty-1', name: 'Skyr', unit: 'g', amount: 500 }],
  });
});
afterEach(() => { globalThis.fetch = realFetch; });

test('exportFamilyAll requires an admin person', async () => {
  await store.login('u-2', '');                 // child (user)
  await assert.rejects(() => store.exportFamilyAll(), /Administrator/);
});

test('exportFamilyAll bundles all members + family, WITHOUT private cycle data', async () => {
  // Create data for both members (u-1 via the store, u-2 directly in LS).
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'Stadtlauf' });
  store.addReport({ id: 'r1', kind: 'certificate', title: 'Finisher' });
  store.replaceArea('cycle', [{ id: 'c1', date: '2026-06-01' }]);  // private!
  localStorage.setItem(scopeKey('u-2:events'), JSON.stringify([{ id: 'e2', name: 'Schwimmen' }]));
  localStorage.setItem(scopeKey('u-2:cycle'), JSON.stringify([{ id: 'c2', date: '2026-06-10' }]));

  const dump = await store.exportFamilyAll();
  assert.equal(dump.app, 'catofit');
  assert.equal(dump.kind, 'family-full');
  assert.equal(dump.family.members.length, 2);
  assert.equal(dump.family.pantry.length, 1, 'family pantry is included');

  // Both members included – reports yes, cycle never.
  assert.ok(dump.users['u-1'], 'u-1 included');
  assert.ok(dump.users['u-2'], 'u-2 included');
  assert.equal(dump.users['u-1'].events.length, 1);
  assert.equal(dump.users['u-1'].events[0].name, 'Stadtlauf');
  assert.ok(Array.isArray(dump.users['u-1'].reports) && dump.users['u-1'].reports.length === 1, 'certificates/reports are in the full backup');
  assert.equal(dump.users['u-1'].cycle, undefined, 'cycle of u-1 is NOT in the full backup');
  assert.equal(dump.users['u-2'].cycle, undefined, 'cycle of u-2 is NOT in the full backup');
});

test('importFamilyAll requires an admin person', async () => {
  await store.login('u-2', '');
  await assert.rejects(() => store.importFamilyAll({ app: 'catofit', kind: 'family-full', family: { members: [] }, users: {} }), /Administrator/);
});

test('importFamilyAll rejects invalid files and backups without an admin', async () => {
  await store.login('u-1', '');
  await assert.rejects(() => store.importFamilyAll(null), /gültige/);
  await assert.rejects(() => store.importFamilyAll({ app: 'andere', kind: 'family-full', family: { members: [] }, users: {} }), /gültige/);
  await assert.rejects(() => store.importFamilyAll({ app: 'catofit', kind: 'family-full', family: { members: [{ id: 'x', role: 'user' }] }, users: {} }), /Admin-Person/);
});

test('importFamilyAll restores members + areas authoritatively', async () => {
  await store.login('u-1', '');
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1, exportedAt: new Date().toISOString(),
    family: {
      members: [
        { id: 'u-1', name: 'Nora', role: 'admin' },
        { id: 'u-9', name: 'Opa', role: 'user' },   // new member from the backup
      ],
      settings: { accent: '#7c5cff' }, pantry: [],
    },
    users: {
      'u-1': { events: [{ id: 'eA', name: 'Marathon' }] },
      'u-9': { events: [{ id: 'eB', name: 'Walken' }], reports: [{ id: 'rB', title: 'Urkunde' }] },
    },
  };
  const res = await store.importFamilyAll(dump);
  assert.equal(res.users, 2);
  assert.ok(res.areas >= 3);

  // Family replaced authoritatively (u-2 is gone, u-9 is there).
  const ids = store.members().map((m) => m.id).sort();
  assert.deepEqual(ids, ['u-1', 'u-9']);
  assert.equal(store.familySettings().accent, '#7c5cff');

  // Foreign member u-9 is ready in LocalStorage (server-authoritative separately).
  assert.deepEqual(JSON.parse(localStorage.getItem(scopeKey('u-9:events'))), [{ id: 'eB', name: 'Walken' }]);
  assert.deepEqual(JSON.parse(localStorage.getItem(scopeKey('u-9:reports'))), [{ id: 'rB', title: 'Urkunde' }]);

  // Active view (u-1) was reloaded.
  assert.equal(store.find('events', 'eA').name, 'Marathon');
});

test('importFamilyAll leaves private cycle data untouched', async () => {
  await store.login('u-1', '');
  store.replaceArea('cycle', [{ id: 'c1', date: '2026-06-01' }]);   // private, present locally
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1,
    family: { members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] },
    users: { 'u-1': { events: [{ id: 'eX', name: 'Lauf' }] } },   // no cycle in the backup
  };
  await store.importFamilyAll(dump);
  // Cycle is retained (not overwritten, not deleted).
  assert.equal(store.get('cycle').length, 1);
  assert.equal(store.get('cycle')[0].id, 'c1');
});
