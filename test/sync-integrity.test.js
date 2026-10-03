/* Datenintegrität des Syncs gegen den protokolltreuen Test-Server (test-setup.js,
   __fakeServer): Die Push-Antwort trägt dort wie beim echten Server die GLOBALE
   Bereichs-rev, es gibt die 2000-Ops-Grenze (413), Latenz und Fehler je Anfrage.
   Jeder Test hier war mit dem Stand v3.19.0 rot. */
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

test('FE-01: fremde Änderung zwischen zwei Syncs kommt nach eigenem Push trotzdem an', async () => {
  store.upsert('sessions', { id: 's-a', date: '2026-09-01' });
  await store.syncNow();
  // Health-Ingest oder ein zweites Gerät schreibt direkt auf den Server …
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-1'] = { id: 'hk-1', date: '2026-09-02', updatedAt: new Date().toISOString(), rev: ++s.rev };
  // … und dieses Gerät pusht danach eine eigene Änderung (Antwort-rev > hk-1).
  store.upsert('sessions', { id: 's-b', date: '2026-09-03' });
  await store.syncNow();
  await store.syncNow();
  assert.ok(store.find('sessions', 'hk-1'), 'fremder Datensatz ist auf dem Gerät');
  assert.ok(store.find('sessions', 's-b'), 'eigener Datensatz bleibt');
});

test('FE-01 (Familie): fremdes Mitglied geht nach eigenem Familien-Push nicht verloren', async () => {
  const f = srv.store('family', { scope: 'family' });
  f.records['u-x'] = { id: 'u-x', _kind: 'member', name: 'Fremd', role: 'user', createdAt: '2026-09-01T00:00:00Z', updatedAt: new Date().toISOString(), rev: ++f.rev };
  await store.addMember({ name: 'Neu' });   // eigener Familien-Push mit globaler rev
  await store.refreshFamily();
  await store.refreshFamily();
  assert.ok(store.members().some((m) => m.id === 'u-x'), 'Mitglied vom anderen Gerät ist da');
});

test('FE-24/FE-04: über 2000 Ops gehen in Stücken raus, spätere Änderungen folgen', async () => {
  const recs = Array.from({ length: 2100 }, (_, i) => ({ id: `h-${i}`, date: `2026-01-01`, weight: 70 }));
  const saved = store.upsertMany('health', recs);
  assert.equal(saved.length, 2100);
  assert.equal(meta('u-1').ops.health.length, 2100, 'eine Op je Datensatz, ein Schreibvorgang');
  await store.syncNow();
  const s = srv.store('health', { user: 'u-1' });
  assert.equal(Object.keys(s.records).length, 2100, 'alle Tage am Server');
  const pushes = srv.requests.filter((r) => r.action === 'ops' && r.area === 'health');
  assert.ok(pushes.length >= 5 && pushes.every((r) => r.ops <= 500), 'höchstens 500 Ops je Anfrage');
  store.upsert('health', { id: 'h-heute', date: '2026-09-29', weight: 71 });
  await store.syncNow();
  assert.ok(s.records['h-heute'], 'spätere Einzeländerung kommt an');
  assert.equal((meta('u-1').ops.health || []).length, 0, 'Queue leer');
});

test('FE-24: bei einer kleineren Servergrenze halbiert der Client die Stücke (413)', async () => {
  srv.opts.opLimit = 100;
  store.upsertMany('health', Array.from({ length: 300 }, (_, i) => ({ id: `x-${i}`, date: '2026-02-01' })));
  await store.syncNow();
  assert.equal(Object.keys(srv.store('health', { user: 'u-1' }).records).length, 300);
  assert.ok(srv.requests.some((r) => r.status === 413), 'Server lehnte zu große Stücke ab');
});

test('FE-02: Nutzerwechsel während eines langsamen Pushs vermischt nichts', async () => {
  srv.opts.latencyMs = (u) => (u.searchParams.get('action') === 'ops' && u.searchParams.get('user') === 'u-1' ? 150 : 0);
  store.upsert('sessions', { id: 's-admin-1', date: '2026-09-01' });
  const running = store.syncNow();         // langsamer Push des Admins läuft
  await store.enterMember('u-2');           // Admin öffnet das Kind
  store.upsert('sessions', { id: 's-kid-1', date: '2026-09-02' });
  await store.syncNow();
  await running;
  await store.syncNow();
  const kid = srv.store('sessions', { user: 'u-2' });
  const admin = srv.store('sessions', { user: 'u-1' });
  assert.ok(kid.records['s-kid-1'], 'Eingabe fürs Kind am Server');
  assert.equal(kid.records['s-admin-1'], undefined, 'Admin-Einheit nicht beim Kind');
  assert.ok(admin.records['s-admin-1'], 'Admin-Einheit beim Admin');
  assert.ok(!store.get('sessions').some((x) => x.id === 's-admin-1'), 'Sicht des Kindes ohne Admin-Einheit');
});

test('FE-03: voller Gerätespeicher – Änderung wird zurückgerollt und gemeldet', async () => {
  await store.syncNow();
  const events = [];
  const prev = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };
  try {
    localStorage.__setQuota(localStorage.__used() + 50);
    store.upsert('sessions', { id: 's-gross', notes: 'x'.repeat(500) });
    assert.equal(store.find('sessions', 's-gross'), null, 'nicht im State');
    assert.ok(!((meta('u-1').ops || {}).sessions || []).some((o) => o.record && o.record.id === 's-gross'), 'keine Op in der Queue');
    const lsArea = JSON.parse(localStorage.getItem(scopeKey('u-1:sessions')) || '[]');
    assert.ok(!lsArea.some((r) => r.id === 's-gross'), 'nicht im LocalStorage');
    assert.ok(events.includes('catofit:storage-full'), 'Hinweis ausgelöst');
  } finally { globalThis.dispatchEvent = prev; localStorage.__setQuota(Infinity); }
});

test('FE-03: das Verwalten eines Mitglieds hinterlässt keinen Datenballast', async () => {
  srv.store('sessions', { user: 'u-2' }).records['s-k'] = { id: 's-k', updatedAt: new Date().toISOString(), rev: 1 };
  srv.store('sessions', { user: 'u-2' }).rev = 1;
  await store.enterMember('u-2');
  await store.syncNow();          // der Abgleich läuft seit FE-08 im Hintergrund
  assert.ok(localStorage.getItem(scopeKey('u-2:sessions')), 'beim Verwalten zwischengespeichert');
  await store.backToSelf();
  assert.equal(localStorage.getItem(scopeKey('u-2:sessions')), null, 'nach dem Zurückwechseln verworfen');
});

test('FE-03: Queue verdichtet Ops desselben Datensatzes', () => {
  store.upsert('events', { id: 'e1', name: 'A' });
  store.patch('events', 'e1', { name: 'B' });
  store.patch('events', 'e1', { name: 'C' });
  const ops = meta('u-1').ops.events;
  assert.equal(ops.length, 1);
  assert.equal(ops[0].record.name, 'C');
  assert.ok(ops[0].opId, 'Op trägt eine opId');
});

test('API-04: Server fällt nach einer Rücksicherung unter die Marke → vorsichtiger Abgleich', async () => {
  for (const id of ['e-alt', 'e-2', 'e-3']) { store.upsert('events', { id }); await store.syncNow(); }
  const s = srv.store('events', { user: 'u-1' });
  // Rücksicherung eines älteren Stands (nur e-alt) …
  const alt = { ...s.records['e-alt'] };
  s.records = { 'e-alt': alt }; s.rev = alt.rev;
  // … danach schreibt ein anderes Gerät weiter, die rev bleibt unter der Marke dieses Geräts.
  s.records['e-neu'] = { id: 'e-neu', updatedAt: new Date(Date.now() + 1000).toISOString(), rev: ++s.rev };
  await store.syncNow();
  assert.ok(store.find('events', 'e-neu'), 'Änderung nach der Rücksicherung kommt an');
  assert.ok(store.find('events', 'e-3'), 'lokale Kopie bleibt erhalten – nichts wird gelöscht');
  assert.equal(meta('u-1').revs.events, s.rev, 'Marke folgt dem Server');
});

test('API-04: wöchentlicher Voll-Abgleich findet auch eine unauffällige Rücksicherung', async () => {
  for (const id of ['e-1', 'e-2']) { store.upsert('events', { id }); await store.syncNow(); }
  const s = srv.store('events', { user: 'u-1' });
  const first = { ...s.records['e-1'] };
  s.records = { 'e-1': first }; s.rev = first.rev;
  s.records['e-x'] = { id: 'e-x', updatedAt: new Date(Date.now() + 1000).toISOString(), rev: ++s.rev };   // rev == Marke
  await store.syncNow();
  assert.equal(store.find('events', 'e-x'), null, 'rev-Vergleich allein sieht es nicht');
  localStorage.setItem(scopeKey('u-1:__fullSync'), '0');
  await store.syncNow();
  assert.ok(store.find('events', 'e-x'), 'Voll-Abgleich holt es');
});

test('FE-17: zwei Tabs desselben Nutzers – beide Eingaben bleiben in der Queue', async () => {
  const tabB = await import('../js/storage.js?tab=b');
  await tabB.refreshFamily();
  await tabB.login('u-1', '');
  store.upsert('sessions', { id: 's-tabA', date: '2026-09-01' });
  tabB.upsert('sessions', { id: 's-tabB', date: '2026-09-01' });
  store.upsert('sessions', { id: 's-tabA2', date: '2026-09-02' });
  const ids = (meta('u-1').ops.sessions || []).map((o) => o.record && o.record.id).sort();
  assert.deepEqual(ids, ['s-tabA', 's-tabA2', 's-tabB'], 'keine Eingabe überschrieben');
  await store.syncNow();
  const s = srv.store('sessions', { user: 'u-1' });
  assert.ok(s.records['s-tabA'] && s.records['s-tabA2'] && s.records['s-tabB'], 'alle drei am Server');
  await tabB.logout();
});

test('FE-05: Backup beim Verwalten lässt private Bereiche aus und ergänzt Urkunden nur', async () => {
  localStorage.setItem(scopeKey('u-2:reports'), JSON.stringify([{ id: 'r-alt', title: 'Alt', sealed: true, rev: 1 }]));
  await store.enterMember('u-2');
  const res = store.importAll({
    app: 'catofit', version: 1, events: [{ id: 'e-b' }],
    labs: [{ id: 'l-admin' }], cycle: [{ id: 'c-admin' }], reports: [{ id: 'r-neu', title: 'Neu' }],
  });
  assert.deepEqual([...res.privateSkipped].sort(), ['cycle', 'labs']);
  const ops = meta('u-2').ops;
  assert.ok(!(ops.labs || []).length && !(ops.cycle || []).length, 'keine Op für private Bereiche');
  assert.ok(!(ops.reports || []).some((o) => o.op === 'replace'), 'Urkunden werden nicht ersetzt');
  assert.deepEqual(store.get('reports').map((r) => r.id).sort(), ['r-alt', 'r-neu']);
});

test('API-05: Vollbackup enthält die Teams; alte Backups ohne Teams löschen keine', async () => {
  store.addTeam({ name: 'Läufer', memberIds: ['u-1'] });
  const dump = await store.exportFamilyAll();
  assert.equal(dump.family.teams.length, 1, 'Teams im Backup');
  await store.importFamilyAll(dump);
  assert.equal(store.teams().length, 1, 'Teams nach der Wiederherstellung da');
  const old = { ...dump, family: { ...dump.family } };
  delete old.family.teams;
  await store.importFamilyAll(old);
  assert.equal(store.teams().length, 1, 'altes Backup ohne Teams löscht keine Teams');
});

test('FE-16/API-06: Wiederherstellung wartet auf den Server, meldet Ausstehendes und überschreibt später nichts Neueres', async () => {
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'ops' && u.searchParams.get('user') === 'u-2' ? 500 : null);
  const dump = {
    app: 'catofit', kind: 'family-full', version: 1,
    family: { members: [{ id: 'u-1', name: 'Nora', role: 'admin' }, { id: 'u-2', name: 'Kind', role: 'user' }], settings: {}, pantry: [], teams: [] },
    users: { 'u-1': { events: [{ id: 'e-bak' }] }, 'u-2': { sessions: [{ id: 's-bak' }] } },
  };
  const res = await store.importFamilyAll(dump);
  assert.equal(res.areas, 2);
  assert.equal(res.pending, 1, 'ein Bereich wartet noch');
  assert.ok(srv.store('events', { user: 'u-1' }).records['e-bak'], 'der erreichbare Bereich ist schon am Server');
  // Das Kind erfasst inzwischen selbst etwas (am Server, neuer als der Stand der Wiederherstellung).
  const s = srv.store('sessions', { user: 'u-2' });
  s.records['s-neu'] = { id: 's-neu', updatedAt: new Date().toISOString(), rev: ++s.rev };
  srv.opts.failWhen = null;
  await store.syncNow();                     // sendet die wartende Ersetzung nach
  assert.ok(s.records['s-bak'] && !s.records['s-bak'].deleted, 'Backup-Datensatz angekommen');
  assert.ok(s.records['s-neu'] && !s.records['s-neu'].deleted, 'neuere Eingabe des Kindes bleibt erhalten');
});

test('Einmal-Heilung: alte Marken werden beim ersten Start genau einmal verworfen', async () => {
  localStorage.setItem(scopeKey('u-2:__meta'), JSON.stringify({ revs: { sessions: 99 }, ops: {} }));
  localStorage.removeItem(scopeKey('syncHeal'));
  await store.init();
  assert.deepEqual(meta('u-2').revs, {}, 'Marken zurückgesetzt');
  assert.equal(localStorage.getItem(scopeKey('syncHeal')), '3.20');
  localStorage.setItem(scopeKey('u-2:__meta'), JSON.stringify({ revs: { sessions: 5 }, ops: {} }));
  await store.init();
  assert.equal(meta('u-2').revs.sessions, 5, 'kein zweites Mal');
  await wait(0);
});

test('syncNow während eines laufenden Abgleichs wartet auf dessen Ende (samt neuer Änderung)', async () => {
  srv.opts.latencyMs = 15;
  const first = store.syncNow();                 // läuft (z. B. der Abgleich nach der Anmeldung)
  store.upsert('sessions', { id: 's-spaet', date: '2026-09-29' });
  await store.syncNow();                         // „Jetzt synchronisieren“ – muss warten
  const s = srv.store('sessions', { user: 'u-1' });
  assert.ok(s.records['s-spaet'], 'die neue Änderung ist nach dem await am Server');
  await first;
  srv.opts.latencyMs = 0;
});

test('FE-08: Server hängt – Anmeldung wartet höchstens kurz, die App bleibt offline bedienbar', async () => {
  store.clearActiveUser();
  srv.opts.latencyMs = 60000;                     // nimmt Verbindungen an, antwortet nie
  const t0 = Date.now();
  const ok = await store.login('u-1', '');
  const took = Date.now() - t0;
  assert.equal(ok, true, 'Anmeldung klappt ohne Server');
  assert.ok(took < 4000, `Anmeldung dauerte ${took} ms (vorher bis 6,6 min)`);
  assert.equal(store.activeUserId(), 'u-1');
  store.upsert('sessions', { id: 's-off', date: '2026-09-29' });   // offline weiterarbeiten
  srv.opts.latencyMs = 0;
  await store.syncNow();
  assert.ok(srv.store('sessions', { user: 'u-1' }).records['s-off'], 'geht nach der Rückkehr raus');
});
