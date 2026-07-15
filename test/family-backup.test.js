/* Tests für das Admin-Vollbackup der gesamten Familie (js/storage.js):
   - nur Admin darf exportieren/wiederherstellen
   - strikt private Zyklusdaten sind NIE im Vollbackup
   - Wiederherstellung ist autoritativ (Mitglieder + alle enthaltenen Bereiche)
   - Zyklusdaten bleiben bei der Wiederherstellung unangetastet erhalten */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

// fetch-Mock: bedient GET ?area= aus dem LocalStorage (wie der echte Server die
// logische Sicht liefert); ops/changes antworten leer. So liest exportFamilyAll
// (peekUserArea -> apiGet) die im Test gesetzten Daten.
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
      let recs = null; try { recs = JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { /* egal */ }
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

test('exportFamilyAll erfordert eine Admin-Person', async () => {
  await store.login('u-2', '');                 // Kind (user)
  await assert.rejects(() => store.exportFamilyAll(), /Administrator/);
});

test('exportFamilyAll bündelt alle Mitglieder + Familie, OHNE private Zyklusdaten', async () => {
  // Daten für beide Mitglieder anlegen (u-1 über den Store, u-2 direkt im LS).
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'Stadtlauf' });
  store.addReport({ id: 'r1', kind: 'certificate', title: 'Finisher' });
  store.replaceArea('cycle', [{ id: 'c1', date: '2026-06-01' }]);  // privat!
  localStorage.setItem(scopeKey('u-2:events'), JSON.stringify([{ id: 'e2', name: 'Schwimmen' }]));
  localStorage.setItem(scopeKey('u-2:cycle'), JSON.stringify([{ id: 'c2', date: '2026-06-10' }]));

  const dump = await store.exportFamilyAll();
  assert.equal(dump.app, 'catofit');
  assert.equal(dump.kind, 'family-full');
  assert.equal(dump.family.members.length, 2);
  assert.equal(dump.family.pantry.length, 1, 'Familien-Lager ist enthalten');

  // Beide Mitglieder enthalten – Reports ja, Zyklus niemals.
  assert.ok(dump.users['u-1'], 'u-1 enthalten');
  assert.ok(dump.users['u-2'], 'u-2 enthalten');
  assert.equal(dump.users['u-1'].events.length, 1);
  assert.equal(dump.users['u-1'].events[0].name, 'Stadtlauf');
  assert.ok(Array.isArray(dump.users['u-1'].reports) && dump.users['u-1'].reports.length === 1, 'Urkunden/Reports sind im Vollbackup');
  assert.equal(dump.users['u-1'].cycle, undefined, 'Zyklus von u-1 ist NICHT im Vollbackup');
  assert.equal(dump.users['u-2'].cycle, undefined, 'Zyklus von u-2 ist NICHT im Vollbackup');
});

test('importFamilyAll erfordert eine Admin-Person', async () => {
  await store.login('u-2', '');
  await assert.rejects(() => store.importFamilyAll({ app: 'catofit', kind: 'family-full', family: { members: [] }, users: {} }), /Administrator/);
});

test('importFamilyAll lehnt ungültige Dateien und Backups ohne Admin ab', async () => {
  await store.login('u-1', '');
  await assert.rejects(() => store.importFamilyAll(null), /gültige/);
  await assert.rejects(() => store.importFamilyAll({ app: 'andere', kind: 'family-full', family: { members: [] }, users: {} }), /gültige/);
  await assert.rejects(() => store.importFamilyAll({ app: 'catofit', kind: 'family-full', family: { members: [{ id: 'x', role: 'user' }] }, users: {} }), /Admin-Person/);
});

test('importFamilyAll stellt Mitglieder + Bereiche autoritativ wieder her', async () => {
  await store.login('u-1', '');
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1, exportedAt: new Date().toISOString(),
    family: {
      members: [
        { id: 'u-1', name: 'Nora', role: 'admin' },
        { id: 'u-9', name: 'Opa', role: 'user' },   // neues Mitglied aus dem Backup
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

  // Familie autoritativ ersetzt (u-2 ist weg, u-9 ist da).
  const ids = store.members().map((m) => m.id).sort();
  assert.deepEqual(ids, ['u-1', 'u-9']);
  assert.equal(store.familySettings().accent, '#7c5cff');

  // Fremd-Mitglied u-9 liegt im LocalStorage bereit (server-autoritativ separat).
  assert.deepEqual(JSON.parse(localStorage.getItem(scopeKey('u-9:events'))), [{ id: 'eB', name: 'Walken' }]);
  assert.deepEqual(JSON.parse(localStorage.getItem(scopeKey('u-9:reports'))), [{ id: 'rB', title: 'Urkunde' }]);

  // Aktive Sicht (u-1) wurde neu geladen.
  assert.equal(store.find('events', 'eA').name, 'Marathon');
});

test('importFamilyAll lässt private Zyklusdaten unangetastet', async () => {
  await store.login('u-1', '');
  store.replaceArea('cycle', [{ id: 'c1', date: '2026-06-01' }]);   // privat, lokal vorhanden
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1,
    family: { members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] },
    users: { 'u-1': { events: [{ id: 'eX', name: 'Lauf' }] } },   // kein cycle im Backup
  };
  await store.importFamilyAll(dump);
  // Zyklus bleibt erhalten (nicht überschrieben, nicht gelöscht).
  assert.equal(store.get('cycle').length, 1);
  assert.equal(store.get('cycle')[0].id, 'c1');
});
