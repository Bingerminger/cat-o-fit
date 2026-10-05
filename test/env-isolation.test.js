/* Tests for the environment isolation of the client storage (fix "duplicate users").
   Several deployments on the same origin (prod /cat-o-fit/ + acceptance
   /cat-o-fit-acc/) must NOT share LocalStorage/Session:
     - All storage keys carry the environment namespace (scopeKey).
     - resetApp deletes ONLY the keys of its own environment.
     - createFirstAdmin does not create a second admin if the server already has
       a family (the pull may not have finished at boot). */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey, APP_NS } from '../js/ui.js';

const realFetch = globalThis.fetch;
let serverStores = {};
const key = (area, scope, user) => `${scope}|${user || ''}|${area}`;
const srv = (k) => (serverStores[k] ||= { rev: 0, records: {} });
const jsonResp = (o) => ({ ok: true, status: 200, json: async () => o });

function applyOps(s, ops) {
  const now = new Date().toISOString();
  const applied = [];
  for (const op of ops) {
    if (op.op === 'upsert') { const r = { ...op.record, updatedAt: now, rev: ++s.rev }; delete r.deleted; s.records[r.id] = r; applied.push(r); }
    else if (op.op === 'delete') { const t = { id: op.id, deleted: true, updatedAt: now, rev: ++s.rev }; s.records[op.id] = t; applied.push(t); }
    else if (op.op === 'replace') {
      const keep = new Set();
      for (const r of op.records) { const rec = { ...r, updatedAt: now, rev: ++s.rev }; delete rec.deleted; s.records[rec.id] = rec; applied.push(rec); keep.add(rec.id); }
      for (const id in s.records) { if (!keep.has(id) && !s.records[id].deleted) { const t = { id, deleted: true, updatedAt: now, rev: ++s.rev }; s.records[id] = t; applied.push(t); } }
    }
  }
  return applied;
}

function installMock() {
  serverStores = {};
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (action === 'ping') return jsonResp({ ok: true });
    if (action === 'delete-user') return jsonResp({ ok: true });
    const area = u.searchParams.get('area');
    const scope = u.searchParams.get('scope') === 'family' ? 'family' : 'user';
    const user = u.searchParams.get('user');
    const s = srv(key(area, scope, user));
    if (action === 'changes') {
      const since = parseInt(u.searchParams.get('since') || '0', 10);
      const records = Object.values(s.records).filter((r) => (r.rev || 0) > since).sort((a, b) => a.rev - b.rev);
      return jsonResp({ ok: true, rev: s.rev, records });
    }
    if (action === 'ops') { const applied = applyOps(s, JSON.parse(opts.body).ops || []); return jsonResp({ ok: true, rev: s.rev, records: applied }); }
    const data = Object.values(s.records).filter((r) => !r.deleted).map((r) => { const c = { ...r }; delete c.rev; return c; });
    return jsonResp({ ok: true, data });
  };
}

beforeEach(() => { localStorage.clear(); installMock(); store.clearActiveUser(); });
afterEach(() => { globalThis.fetch = realFetch; });

test('Storage keys carry the environment namespace (no flat catofit:<user>:<area>)', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'Stadtlauf' });

  const nsKey = scopeKey('u-1:events');
  assert.ok(nsKey.startsWith('catofit:') && nsKey.includes(APP_NS), 'key contains the namespace');
  assert.ok(localStorage.getItem(nsKey), 'namespaced key exists');
  assert.equal(localStorage.getItem('catofit:u-1:events'), null, 'no flat legacy key');
});

test('resetApp deletes ONLY its own environment – foreign namespaces remain', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'X' });

  // "Other environment" (e.g. /cat-o-fit-acc/) + a foreign app key on the same origin.
  localStorage.setItem('catofit:/cat-o-fit-acc/:u-9:events', JSON.stringify([{ id: 'z' }]));
  localStorage.setItem('anderes-tool:state', 'behalten');

  await store.resetApp();

  assert.equal(localStorage.getItem(scopeKey('u-1:events')), null, 'own key deleted');
  assert.ok(localStorage.getItem('catofit:/cat-o-fit-acc/:u-9:events'), 'foreign environment remains');
  assert.equal(localStorage.getItem('anderes-tool:state'), 'behalten', 'foreign app remains');
});

test('createFirstAdmin creates NO second admin if the server already has a family', async () => {
  // The server already has an admin (e.g. created on another device).
  const fam = srv(key('family', 'family', null));
  fam.records['u-existing'] = { id: 'u-existing', _kind: 'member', name: 'Robin', role: 'admin', createdAt: '2026-06-01T10:00:00Z', rev: ++fam.rev };

  // Locally the family is still empty (the pull had not finished at boot).
  const id = await store.createFirstAdmin({ name: 'Robin-Doppel', pin: '1234' });

  assert.equal(id, null, 'no new admin created');
  const names = store.members().map((m) => m.name);
  assert.deepEqual(names, ['Robin'], 'only the existing server admin, no duplicate');
});
