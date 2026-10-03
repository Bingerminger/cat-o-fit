/* FE-26: Sammelabruf (Server mit den Fähigkeiten 'changes-all' und 'ops-since') – ein Abgleich holt die Änderungen aller Bereiche
   in EINER Anfrage statt einer je Bereich; ein Push mit „since“ bringt fremde Änderungen
   gleich mit. Ältere Server (ohne diese Fähigkeiten) laufen unverändert über den Einzelweg. */
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
  // Server-Stand: Admin mit PIN 1234 – die Anmeldung öffnet eine Server-Sitzung.
  const f = srv.store('family', { scope: 'family' });
  f.records['u-1'] = { id: 'u-1', _kind: 'member', name: 'Test', role: 'admin', pinHash: sha256Hex('catofit:u-1:1234'), createdAt: '2026-01-01T00:00:00Z', rev: ++f.rev };
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }] });
  await store.refreshFamily();
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Anmelden und den ersten Abgleich (inkl. wöchentlichem Voll-Abgleich) hinter sich bringen. */
async function ready(features) {
  srv.opts.features = features;
  assert.equal(await store.login('u-1', '1234'), true);
  await store.syncNow();
  srv.requests.length = 0;
}

test('FE-26: ein Sammelabruf statt einer Anfrage je Bereich, fremde Änderung kommt an', async () => {
  await ready(['changes-all', 'ops-since']);
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-1'] = { id: 'hk-1', date: '2026-09-02', updatedAt: new Date().toISOString(), rev: ++s.rev };
  const l = srv.store('labs', { user: 'u-1' });
  l.records.l1 = { id: 'l1', analyte: 'ferritin', value: 44, date: '2026-09-01', updatedAt: new Date().toISOString(), rev: ++l.rev };
  await store.syncNow();
  assert.equal(count('changes-all'), 1, 'genau ein Sammelabruf');
  assert.equal(srv.requests.filter((r) => r.action === 'changes' && r.scope === 'user').length, 0, 'keine Einzelabrufe der Bereiche (die Familie hat ihren eigenen Abruf)');
  assert.ok(store.find('sessions', 'hk-1'), 'fremder Datensatz ist auf dem Gerät');
  assert.ok(store.find('labs', 'l1'), 'mit eigener Sitzung auch die privaten Bereiche');
});

test('FE-26: ältere Server – unverändert der Einzelweg', async () => {
  await ready([]);
  await store.syncNow();
  assert.equal(count('changes-all'), 0);
  assert.ok(count('changes') >= 10, 'je Bereich ein Abruf');
});

test('FE-26: Push mit „since“ bringt die fremde Änderung gleich mit', async () => {
  await ready(['changes-all', 'ops-since']);
  const s = srv.store('sessions', { user: 'u-1' });
  s.records['hk-2'] = { id: 'hk-2', date: '2026-09-03', updatedAt: new Date().toISOString(), rev: ++s.rev };
  store.upsert('sessions', { id: 'eigen', date: '2026-09-04' });
  // Nur den Push abwarten – der Sammelabruf soll hier nichts mehr beitragen müssen.
  srv.opts.failWhen = (u) => (u.searchParams.get('action') === 'changes-all' ? 503 : null);
  await store.syncNow();
  const push = srv.requests.find((r) => r.action === 'ops' && r.area === 'sessions');
  assert.ok(Number.isInteger(JSON.parse(push.body).since), 'die eigene Marke wird mitgeschickt');
  assert.ok(store.find('sessions', 'hk-2'), 'fremder Datensatz kam mit der Push-Antwort');
  assert.ok(store.find('sessions', 'eigen'));
});

test('FE-26: Rücksicherung am Server fällt auch im Sammelabruf auf (Voll-Abgleich des Bereichs)', async () => {
  await ready(['changes-all', 'ops-since']);
  store.upsert('health', { id: 'h1', date: '2026-09-01', weight: 70 });
  await store.syncNow();
  srv.requests.length = 0;
  const h = srv.store('health', { user: 'u-1' });
  h.rev = 0;          // älterer Stand zurückgesichert: rev unter der gemerkten Marke
  h.records = {};
  await store.syncNow();
  const full = srv.requests.find((r) => r.action === 'changes' && r.area === 'health' && /since=0\b/.test(r.url));
  assert.ok(full, 'Voll-Abgleich des betroffenen Bereichs');
  assert.ok(store.find('health', 'h1'), 'lokal wird dabei nichts gelöscht');
});

test('FE-26: abgelaufene Server-Sitzung – private Bereiche gesperrt, die App fragt nach der PIN', async () => {
  await ready(['changes-all', 'ops-since']);
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    srv.auth.session = null;
    const s = srv.store('sessions', { user: 'u-1' });
    s.records['hk-3'] = { id: 'hk-3', date: '2026-09-05', updatedAt: new Date().toISOString(), rev: ++s.rev };
    await store.syncNow();
    assert.equal(events.length, 1, 'einmal nach der PIN fragen');
    assert.ok(store.find('sessions', 'hk-3'), 'die übrigen Bereiche kommen trotzdem an');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});
