/* PIN und Server-Sitzung (js/storage.js gegen den Test-Server in test-setup.js, der
   api/auth.php nachbildet):
   - SHA-256 ist bit-genau; der PIN-Hash verlässt den Server nicht (Gerät kennt nur `hasPin`).
   - Der Server prüft die PIN (auch das alte djb2-Format) und öffnet eine Sitzung.
   - Ohne Server nur mit dem Prüfwert dieses Geräts; private Bereiche erst mit Sitzung.
   - PIN ändern: eigene nur mit der bisherigen, 4–8 Ziffern, nicht 0000; fremde nur Admin.
   Vor v3.20.0 prüfte allein das Gerät gegen einen Hash, den jeder über die API lesen konnte. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../js/sha256.js';
import * as store from '../js/storage.js';
import { scopeKey } from '../js/ui.js';

const realFetch = globalThis.fetch;
let srv;
const H = (id, pin) => sha256Hex(`catofit:${id}:${pin}`);
const djb2 = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return 'fb' + h.toString(16); };
const famLS = () => localStorage.getItem(scopeKey('familyStore')) || '';
const setOnline = (on) => window.dispatchEvent(new Event(on ? 'online' : 'offline'));

test('sha256Hex: bekannte Vektoren (bit-genau wie crypto.subtle)', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(sha256Hex('catofit:u-1:1234'), sha256Hex('catofit:u-1:1234')); // deterministisch
});

beforeEach(async () => {
  setOnline(true);
  localStorage.clear();
  sessionStorage.clear();
  srv = globalThis.__fakeServer.install();
  store.clearActiveUser();
  // Server-Stand: Admin mit PIN 1234, Mitglied mit altem djb2-Hash (PIN 4711).
  const f = srv.store('family', { scope: 'family' });
  f.records['u-1'] = { id: 'u-1', _kind: 'member', name: 'Admin', role: 'admin', pinHash: H('u-1', '1234'), createdAt: '2026-01-01T00:00:00Z', rev: ++f.rev };
  f.records['u-2'] = { id: 'u-2', _kind: 'member', name: 'Kind', role: 'user', pinHash: djb2('catofit:u-2:4711'), createdAt: '2026-01-02T00:00:00Z', rev: ++f.rev };
  // Lokalen Stand zurücksetzen (rev 0 -> der Server-Stand gewinnt beim Abgleich).
  store.saveFamily({ members: [{ id: 'u-1', name: 'Admin', role: 'admin' }, { id: 'u-2', name: 'Kind', role: 'user' }] });
  await store.refreshFamily();
});
afterEach(() => { setOnline(true); globalThis.fetch = realFetch; store.setSharedDevice(false); });

test('Anmeldung: der Server prüft die PIN, der Hash erreicht das Gerät nie', async () => {
  assert.equal(store.memberHasPin('u-1'), true, 'Schloss kommt aus hasPin');
  assert.ok(!famLS().includes(H('u-1', '1234')), 'kein PIN-Hash im Gerätespeicher');
  assert.equal(await store.login('u-1', '9999'), false);
  assert.equal(store.lastLoginError().code, 'pin');
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal(srv.auth.session, 'u-1', 'Server-Sitzung geöffnet');
  assert.equal(store.serverSessionActive(), true);
  assert.ok(!famLS().includes(H('u-1', '1234')), 'auch nach dem Abgleich kein Hash');
});

test('Altes djb2-Format prüft der Server weiter (Abwärtskompatibilität)', async () => {
  assert.equal(await store.login('u-2', '0000'), false);
  assert.equal(await store.login('u-2', '4711'), true);
});

test('Nach fünf Fehlversuchen meldet die Anmeldung eine Pause', async () => {
  for (let i = 0; i < 4; i++) assert.equal(await store.login('u-2', '1111'), false);
  assert.equal(await store.login('u-2', '1111'), false);
  assert.equal(store.lastLoginError().code, 'locked');
  assert.equal(await store.login('u-2', '4711'), false, 'auch die richtige PIN wartet die Pause ab');
});

test('Ohne Server: Anmeldung nur mit dem Prüfwert dieses Geräts, private Daten folgen später', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  await store.logout();
  setOnline(false);
  assert.equal(await store.login('u-2', '4711'), false, 'u-2 war hier nie online angemeldet');
  assert.equal(store.lastLoginError().code, 'offline-first');
  assert.equal(await store.login('u-1', '0000'), false, 'falsche PIN auch offline abgelehnt');
  assert.equal(await store.login('u-1', '1234'), true, 'Prüfwert des Geräts');
  assert.equal(store.serverSessionActive(), false, 'noch keine Server-Sitzung');
  store.upsert('labs', { id: 'l1', analyte: 'ferritin', value: 40, date: '2026-09-01' });
  setOnline(true);
  srv.auth.session = null;
  await store.syncNow();
  assert.equal(srv.auth.session, 'u-1', 'Server-Anmeldung nachgeholt');
  assert.ok(srv.store('labs', { user: 'u-1' }).records.l1, 'private Daten nach der Anmeldung gesendet');
});

test('Private Bereiche syncen nur mit eigener Sitzung – Ops warten sonst', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;                       // Sitzung am Server abgelaufen
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    store.upsert('cycle', { id: 'c1', startDate: '2026-09-10' });
    await store.syncNow();
    assert.ok(!srv.store('cycle', { user: 'u-1' }).records.c1, 'ohne Sitzung nichts gesendet');
    assert.ok(events.includes('catofit:session-required'), 'Oberfläche wird um die PIN gebeten');
    assert.equal(await store.reauth('1234'), true);   // stößt selbst einen Abgleich an
    for (let i = 0; i < 200 && !srv.store('cycle', { user: 'u-1' }).records.c1; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(srv.store('cycle', { user: 'u-1' }).records.c1, 'nach erneuter Anmeldung gesendet');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});

test('Nach dem Update ohne Server-Sitzung: einmal nach der PIN fragen, dann abgleichen', async () => {
  // v3.19.0 kannte keine Server-Sitzung. Nach dem Update ist die Person in der App noch
  // angemeldet (Browser-Sitzung), der Server kennt sie aber nicht – bisher blieben Zyklus,
  // Labor und Ergänzungen dann still liegen, ohne dass die App nach der PIN fragte.
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    await store.init();                               // Neuladen mit wiederhergestellter Anmeldung
    store.upsert('labs', { id: 'l9', analyte: 'ferritin', value: 41, date: '2026-09-02' });
    await store.syncNow();
    await store.syncNow();
    assert.equal(events.length, 1, 'genau eine Nachfrage je Seitenaufruf („Später“ gilt)');
    assert.ok(!srv.store('labs', { user: 'u-1' }).records.l9, 'ohne Sitzung wartet der Wert');
    assert.equal(await store.reauth('1234'), true);
    for (let i = 0; i < 200 && !srv.store('labs', { user: 'u-1' }).records.l9; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(srv.store('labs', { user: 'u-1' }).records.l9, 'nach der PIN gesendet');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});

test('Verwalten: Die Admin-Person fragt private Bereiche des Mitglieds gar nicht erst an', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.requests.length = 0;
  await store.enterMember('u-2');
  await store.syncNow();
  const priv = srv.requests.filter((r) => r.user === 'u-2' && ['cycle', 'labs', 'supplements'].includes(r.area));
  assert.equal(priv.length, 0, 'keine Anfragen an private Bereiche fremder Personen');
});

test('Verwalten: wartende private Daten des Mitglieds zeigen kein Dauer-„Offline“', async () => {
  const ind = document.createElement('div'); ind.setAttribute('id', 'sync-indicator'); document.body.appendChild(ind);
  try {
    assert.equal(await store.login('u-1', '1234'), true);
    await store.enterMember('u-2');
    // So legt die Ersteinrichtung mit Demodaten private Werte eines Mitglieds an.
    store.upsert('labs', { id: 'l-kind', analyte: 'ferritin', value: 30, date: '2026-09-01' });
    await store.syncNow();
    assert.ok(!srv.store('labs', { user: 'u-2' }).records['l-kind'], 'wartet auf die Anmeldung des Mitglieds');
    assert.equal(ind.dataset.state, 'idle', 'die Verbindung ist in Ordnung');
    // Eigene, noch nicht gesendete private Daten zählen dagegen weiter als ausstehend.
    await store.backToSelf();
    srv.auth.session = null;
    store.upsert('cycle', { id: 'c-eigen', startDate: '2026-09-10' });
    srv.opts.offline = true;
    await store.syncNow();
    assert.notEqual(ind.dataset.state, 'idle');
  } finally { srv.opts.offline = false; ind.remove(); }
});

test('PIN ändern: eigene nur mit der bisherigen, 4–8 Ziffern, nicht 0000', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal((await store.setMemberPin('u-1', '12', '1234')).code, 'weak');
  assert.equal((await store.setMemberPin('u-1', '0000', '1234')).code, 'weak');
  assert.equal((await store.setMemberPin('u-1', '5678', '1111')).code, 'pin', 'falsche bisherige PIN');
  assert.equal((await store.setMemberPin('u-1', '5678', '1234')).ok, true);
  assert.equal(srv.store('family', { scope: 'family' }).records['u-1'].pinHash, H('u-1', '5678'));
  await store.logout();
  assert.equal(await store.login('u-1', '1234'), false);
  assert.equal(await store.login('u-1', '5678'), true);
});

test('PIN eines Mitglieds: nur eine Admin-Person setzt sie neu (ohne alte PIN)', async () => {
  assert.equal(await store.login('u-2', '4711'), true);
  assert.equal((await store.setMemberPin('u-1', '2468')).code, 'admin', 'Mitglied darf fremde PIN nicht setzen');
  await store.logout();
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal((await store.setMemberPin('u-2', '2468')).ok, true);
  await store.logout();
  assert.equal(await store.login('u-2', '2468'), true);
});

test('Neues Mitglied: die Start-PIN geht nur als Hash an den Server', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  const neu = await store.addMember({ name: 'Neu' });
  await store.syncNow();
  assert.equal(srv.store('family', { scope: 'family' }).records[neu.id].pinHash, H(neu.id, '0000'));
  assert.equal(store.memberHasPin(neu.id), true);
  assert.ok(!famLS().includes(H(neu.id, '0000')), 'Hash nicht im Gerätespeicher');
});

test('Familie: Rollenwechsel ohne Admin-Sitzung lehnt der Server ab, das Gerät folgt dem Server', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;                       // z. B. Sitzung abgelaufen
  const seen = [];
  const onEv = (e) => seen.push(e.detail && e.detail.count);
  const reasons = [];
  const onReason = (e) => reasons.push(e.detail && e.detail.reason);
  window.addEventListener('catofit:ops-rejected', onEv);
  window.addEventListener('catofit:ops-rejected', onReason);
  try {
    store.updateMember('u-2', { role: 'admin' });
    await store.syncNow();
    await store.refreshFamily();
    assert.equal(srv.store('family', { scope: 'family' }).records['u-2'].role, 'user', 'Server unverändert');
    assert.equal(store.members().find((m) => m.id === 'u-2').role, 'user', 'Gerät zeigt wieder den Server-Stand');
    assert.deepEqual(seen, [1], 'Oberfläche erfährt von der Ablehnung');
    assert.deepEqual(reasons, ['Rollen kann nur eine Admin-Person mit Serververbindung ändern.'], 'Grund aus dem Code übersetzt, nicht der englische Server-Text');
  } finally { window.removeEventListener('catofit:ops-rejected', onEv); window.removeEventListener('catofit:ops-rejected', onReason); }
});

test('Gemeinsames Gerät: Abmelden räumt Personendaten ab, Ungesendetes bleibt', async () => {
  store.setSharedDevice(true);
  assert.equal(await store.login('u-1', '1234'), true);
  store.upsert('health', { id: 'h1', date: '2026-09-01', weight: 70 });
  await store.syncNow();
  setOnline(false);
  store.upsert('diary', { id: 'd1', date: '2026-09-02', text: 'offline notiert' });
  await store.logout();
  assert.equal(localStorage.getItem(scopeKey('u-1:health')), null, 'Bereichsdaten entfernt');
  assert.equal(localStorage.getItem(scopeKey('pinLocal')), null, 'Geräte-Prüfwerte entfernt');
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || 'null');
  assert.equal(meta && meta.ops.diary.length, 1, 'ungesendete Änderung bleibt erhalten');
  assert.ok(famLS(), 'Familienliste für die Anmeldung bleibt');
});

test('Ältere Zwischenspeicher: PIN-Hashes verschwinden beim Start', async () => {
  localStorage.setItem(scopeKey('familyStore'), JSON.stringify({
    rev: 0, ops: [],
    records: { 'u-1': { id: 'u-1', _kind: 'member', name: 'Admin', role: 'admin', pinHash: H('u-1', '1234') } },
  }));
  await store.init();
  assert.ok(!famLS().includes(H('u-1', '1234')), 'Hash aus dem Gerätespeicher entfernt');
  assert.equal(store.memberHasPin('u-1'), true, 'Schloss bleibt');
});
