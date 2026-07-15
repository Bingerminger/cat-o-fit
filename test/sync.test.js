/* Tests für das server-autoritative Sync-Modell (Option B, v3.0.0).
   Ein In-Memory-„Server" mockt fetch und wendet Ops an (vergibt rev), sodass
   die Merge-Invarianten ohne echtes Backend prüfbar sind:
     - Push vergibt eine server-rev, Pull ist inkrementell.
     - Zwei Geräte, verschiedene Datensätze -> beide überleben (kein Verlust).
     - Letzter-Schreiber-pro-Datensatz nach server-rev, Tombstones propagieren.
     - Offline gepufferte Ops fließen beim nächsten Sync nach. */
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
    // GET ?area= -> logische Sicht
    const data = Object.values(s.records).filter((r) => !r.deleted).map((r) => { const c = { ...r }; delete c.rev; return c; });
    return jsonResp({ ok: true, data });
  };
}

beforeEach(async () => {
  localStorage.clear();
  installMock(true);
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});
afterEach(() => { globalThis.fetch = realFetch; });

test('Push vergibt eine server-rev; lokale rev-Marke zieht nach', async () => {
  store.upsert('events', { id: 'a', name: 'A' });
  await store.syncNow();
  const s = srv(key('events', 'user', 'u-1'));
  assert.ok((s.records['a'].rev || 0) > 0, 'Server vergibt rev');
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.equal(meta.revs.events, s.rev, 'lokale rev == server-rev');
});

test('Zwei Geräte, verschiedene Datensätze -> beide überleben (kein Verlust)', async () => {
  store.upsert('events', { id: 'a', name: 'Gerät A' });     // Gerät A
  await store.syncNow();
  // Gerät B schreibt direkt auf den Server
  const s = srv(key('events', 'user', 'u-1'));
  s.records['b'] = { id: 'b', name: 'Gerät B', rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();                                     // Gerät A pullt
  assert.deepEqual(store.get('events').map((e) => e.id).sort(), ['a', 'b']);
});

test('Konkurrierender Edit am selben Datensatz: höhere server-rev gewinnt', async () => {
  store.upsert('events', { id: 'a', name: 'alt' });
  await store.syncNow();
  // Gerät B überschreibt a mit höherer rev
  const s = srv(key('events', 'user', 'u-1'));
  s.records['a'] = { id: 'a', name: 'neu von B', rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();
  assert.equal(store.find('events', 'a').name, 'neu von B');
});

test('Mehrere Profil-Upserts in EINEM Batch: neueste Felder bleiben (Regression v3.3.1)', async () => {
  // Wie bei seedDemo / schnellen Profil-Edits: Profil + zwei Settings in Folge,
  // BEVOR gepusht wird. Der Server liefert dann MEHRERE 'profile'-Records zurück –
  // lokal muss der mit der HÖCHSTEN rev gelten (früher gewann fälschlich der erste).
  store.setProfile({ name: 'Nora' });
  store.setSetting('location', { name: 'Dresden', lat: 51.05, lon: 13.74 });
  store.setSetting('weather', true);
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.ok((meta.ops.profile || []).length >= 3, 'mehrere Profil-Ops in einem Batch');
  await store.syncNow();
  assert.equal(store.settings().location?.name, 'Dresden', 'Standort überlebt den Sync');
  assert.equal(store.settings().weather, true, 'weather überlebt den Sync');
  assert.equal(store.profile().name, 'Nora');
});

test('Tombstone propagiert: Remote-Delete entfernt den Datensatz lokal', async () => {
  store.upsert('events', { id: 'a' });
  store.upsert('events', { id: 'b' });
  await store.syncNow();
  const s = srv(key('events', 'user', 'u-1'));
  s.records['a'] = { id: 'a', deleted: true, rev: ++s.rev, updatedAt: new Date().toISOString() };
  await store.syncNow();
  assert.deepEqual(store.get('events').map((e) => e.id), ['b']);
});

test('Gepufferte Ops fließen beim nächsten Sync nach', async () => {
  store.upsert('events', { id: 'x', name: 'angelegt' });
  // Op ist gepuffert (debounced Push noch nicht gefeuert) und noch nicht am Server.
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');
  assert.ok((meta.ops.events || []).length >= 1, 'Op liegt in der Queue');
  assert.equal(srv(key('events', 'user', 'u-1')).records['x'], undefined, 'noch nicht beim Server');
  await store.syncNow();
  assert.ok(srv(key('events', 'user', 'u-1')).records['x'], 'Op ist beim Sync nachgeflossen');
});

test('Familie: zwei Admins legen je ein Mitglied an -> kein stiller Verlust', async () => {
  await store.addMember({ name: 'Kind A', role: 'user' });   // dieses Gerät
  await store.syncNow();
  // anderes Gerät legt direkt auf dem Server ein Mitglied an
  const f = srv(key('family', 'family', null));
  f.records['u-other'] = { id: 'u-other', _kind: 'member', name: 'Kind B', role: 'user', createdAt: '2026-06-29T20:00:00Z', rev: ++f.rev };
  await store.refreshFamily();
  const names = store.members().map((m) => m.name).sort();
  assert.ok(names.includes('Kind A') && names.includes('Kind B') && names.includes('Nora'), `beide Kinder + Nora erwartet, war: ${names}`);
});
