/* Tests für die Umgebungs-Isolation des Client-Speichers (Fix „doppelte Nutzer").
   Mehrere Deployments auf derselben Origin (Prod /cat-o-fit/ + Abnahme
   /cat-o-fit-acc/) dürfen sich LocalStorage/Session NICHT teilen:
     - Alle Storage-Keys tragen den Umgebungs-Namespace (scopeKey).
     - resetApp löscht NUR die Keys der eigenen Umgebung.
     - createFirstAdmin legt keinen zweiten Admin an, wenn der Server schon eine
       Familie hat (Pull war beim Boot evtl. noch nicht durch). */
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

test('Storage-Keys tragen den Umgebungs-Namespace (kein flaches catofit:<user>:<area>)', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'Stadtlauf' });

  const nsKey = scopeKey('u-1:events');
  assert.ok(nsKey.startsWith('catofit:') && nsKey.includes(APP_NS), 'Key enthält Namespace');
  assert.ok(localStorage.getItem(nsKey), 'namespaced Key existiert');
  assert.equal(localStorage.getItem('catofit:u-1:events'), null, 'kein flacher Legacy-Key');
});

test('resetApp löscht NUR die eigene Umgebung – fremde Namespaces bleiben', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'X' });

  // „Andere Umgebung" (z. B. /cat-o-fit-acc/) + ein Fremd-App-Key auf gleicher Origin.
  localStorage.setItem('catofit:/cat-o-fit-acc/:u-9:events', JSON.stringify([{ id: 'z' }]));
  localStorage.setItem('anderes-tool:state', 'behalten');

  await store.resetApp();

  assert.equal(localStorage.getItem(scopeKey('u-1:events')), null, 'eigener Key gelöscht');
  assert.ok(localStorage.getItem('catofit:/cat-o-fit-acc/:u-9:events'), 'fremde Umgebung bleibt');
  assert.equal(localStorage.getItem('anderes-tool:state'), 'behalten', 'fremde App bleibt');
});

test('createFirstAdmin legt KEINEN zweiten Admin an, wenn der Server schon eine Familie hat', async () => {
  // Server hat bereits einen Admin (z. B. auf einem anderen Gerät angelegt).
  const fam = srv(key('family', 'family', null));
  fam.records['u-existing'] = { id: 'u-existing', _kind: 'member', name: 'Nora', role: 'admin', createdAt: '2026-06-01T10:00:00Z', rev: ++fam.rev };

  // Lokal ist die Familie noch leer (Pull war beim Boot nicht durch).
  const id = await store.createFirstAdmin({ name: 'Nora-Doppel', pin: '1234' });

  assert.equal(id, null, 'kein neuer Admin angelegt');
  const names = store.members().map((m) => m.name);
  assert.deepEqual(names, ['Nora'], 'nur der vorhandene Server-Admin, kein Duplikat');
});
