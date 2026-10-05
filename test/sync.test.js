/* Tests for the server-authoritative sync model (option B, v3.0.0).
   An in-memory "server" mocks fetch and applies ops (assigns rev), so that
   the merge invariants can be checked without a real backend:
     - A push assigns a server rev, pull is incremental.
     - Two devices, different records -> both survive (no loss).
     - Last writer per record by server rev, tombstones propagate.
     - Ops buffered offline flow in at the next sync. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

const realFetch = globalThis.fetch;
let serverStores = {};

const key = (area, scope, user) => `${scope}|${user || ''}|${area}`;
const srv = (k) => (serverStores[k] ||= { rev: 0, records: {} });
const jsonResp = (o) => ({ ok: true, status: 200, json: async () => o });

function applyOps(s, ops) {
  const now = new Date().toISOString();
  const applied = [];
  for (const op of ops) {
    if (op.op === 'upsert') {
      const rec = { ...op.record, updatedAt: now, rev: ++s.rev };
      delete rec.deleted;
      s.records[rec.id] = rec; applied.push(rec);
    } else if (op.op === 'delete') {
      const prev = s.records[op.id] || {};
      const t = { id: op.id, deleted: true, updatedAt: now, rev: ++s.rev, ...(prev._kind ? { _kind: prev._kind } : {}) };
      s.records[op.id] = t; applied.push(t);
    } else if (op.op === 'replace') {
      const keep = new Set();
      for (const r of op.records) { const rec = { ...r, updatedAt: now, rev: ++s.rev }; delete rec.deleted; s.records[rec.id] = rec; applied.push(rec); keep.add(rec.id); }
      for (const id in s.records) { if (!keep.has(id) && !s.records[id].deleted) { const t = { id, deleted: true, updatedAt: now, rev: ++s.rev }; s.records[id] = t; applied.push(t); } }
    }
  }
  return applied;
}

function installMock(reset = true) {
  if (reset) serverStores = {};
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (action === 'ping') return jsonResp({ ok: true });
    const area = u.searchParams.get('area');
    const scope = u.searchParams.get('scope') === 'family' ? 'family' : 'user';
    const user = u.searchParams.get('user');
    const s = srv(key(area, scope, user));
    if (action === 'changes') {
      const since = parseInt(u.searchParams.get('since') || '0', 10);
      const records = Object.values(s.records).filter((r) => (r.rev || 0) > since).sort((a, b) => a.rev - b.rev);
      return jsonResp({ ok: true, rev: s.rev, records });
    }
    if (action === 'ops') {
      const body = JSON.parse(opts.body);
      const applied = applyOps(s, body.ops || []);
      return jsonResp({ ok: true, rev: s.rev, records: applied });
    }
    // GET ?area= -> logical view
    const data = Object.values(s.records).filter((r) => !r.deleted).map((r) => { const c = { ...r }; delete c.rev; return c; });
    return jsonResp({ ok: true, data });
  };
}

beforeEach(async () => {
  localStorage.clear();
  installMock(true);
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});
afterEach(() => { globalThis.fetch = realFetch; });

test('Push assigns a server rev; the local rev marker catches up', async () => {
  store.upsert('events', { id: 'a', name: 'A' });
  await store.syncNow();
  const s = srv(key('events', 'user', 'u-1'));
  assert.ok((s.records['a'].rev || 0) > 0, 'server assigns rev');
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.equal(meta.revs.events, s.rev, 'local rev == server rev');
});

test('Two devices, different records -> both survive (no loss)', async () => {
  store.upsert('events', { id: 'a', name: 'Gerät A' });     // device A
  await store.syncNow();
  // Device B writes directly to the server
  const s = srv(key('events', 'user', 'u-1'));
  s.records['b'] = { id: 'b', name: 'Gerät B', rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();                                     // device A pulls
  assert.deepEqual(store.get('events').map((e) => e.id).sort(), ['a', 'b']);
});

test('Concurrent edit on the same record: higher server rev wins', async () => {
  store.upsert('events', { id: 'a', name: 'alt' });
  await store.syncNow();
  // Device B overwrites a with a higher rev
  const s = srv(key('events', 'user', 'u-1'));
  s.records['a'] = { id: 'a', name: 'neu von B', rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();
  assert.equal(store.find('events', 'a').name, 'neu von B');
});

test('Several profile upserts before the push: newest fields remain (regression v3.3.1)', async () => {
  // As with seedDemo / quick profile edits: profile + two settings in a row,
  // BEFORE pushing. Since v3.20.0 the queue compacts ops of the same record:
  // exactly ONE profile op with all fields remains (previously three, and the server
  // returned several 'profile' records, of which the first wrongly won).
  store.setProfile({ name: 'Robin' });
  store.setSetting('location', { name: 'Dresden', lat: 51.05, lon: 13.74 });
  store.setSetting('weather', true);
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.equal((meta.ops.profile || []).length, 1, 'profile ops compacted into one');
  assert.equal(meta.ops.profile[0].record.settings.location.name, 'Dresden', 'the remaining op carries all fields');
  await store.syncNow();
  assert.equal(store.settings().location?.name, 'Dresden', 'location survives the sync');
  assert.equal(store.settings().weather, true, 'weather survives the sync');
  assert.equal(store.profile().name, 'Robin');
});

test('Tombstone propagates: remote delete removes the record locally', async () => {
  store.upsert('events', { id: 'a' });
  store.upsert('events', { id: 'b' });
  await store.syncNow();
  const s = srv(key('events', 'user', 'u-1'));
  s.records['a'] = { id: 'a', deleted: true, rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();
  assert.deepEqual(store.get('events').map((e) => e.id), ['b']);
});

test('Buffered ops flow in at the next sync', async () => {
  store.upsert('events', { id: 'x', name: 'angelegt' });
  // Op is buffered (debounced push not yet fired) and not yet on the server.
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.ok((meta.ops.events || []).length >= 1, 'op is in the queue');
  assert.equal(srv(key('events', 'user', 'u-1')).records['x'], undefined, 'not yet on the server');
  await store.syncNow();
  assert.ok(srv(key('events', 'user', 'u-1')).records['x'], 'op flowed in during the sync');
});

test('Family: two admins each add a member -> no silent loss', async () => {
  await store.addMember({ name: 'Kind A', role: 'user' });   // this device
  await store.syncNow();
  // another device adds a member directly on the server
  const f = srv(key('family', 'family', null));
  f.records['u-other'] = { id: 'u-other', _kind: 'member', name: 'Kind B', role: 'user', createdAt: '2026-06-29T20:00:00Z', rev: ++f.rev };
  await store.refreshFamily();
  const names = store.members().map((m) => m.name).sort();
  assert.ok(names.includes('Kind A') && names.includes('Kind B') && names.includes('Robin'), `both children + Robin expected, was: ${names}`);
});
