/* Unit-Tests für Rollen, Admin-Mitverwaltung und Mitglieder-CRUD (js/storage.js).
   Prüft besonders die Datenschutz-Regel: Zyklus ist beim Verwalten privat. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { cycleEnabled } from '../js/cycle.js';

function seedFamily() {
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Mama', role: 'admin', emoji: '👩', color: '#18b48a' },
    { id: 'u-2', name: 'Kind', role: 'user', emoji: '🧒', color: '#3d8bff' },
  ] });
}

beforeEach(() => {
  store.clearActiveUser();
  store.saveFamily({ members: [], settings: {} });
});

test('Rollen: isAdmin spiegelt die Rolle der angemeldeten Person', async () => {
  seedFamily();
  assert.equal(store.isAdmin(), false); // niemand angemeldet
  await store.login('u-1', '');
  assert.equal(store.isAdmin(), true);
  assert.equal(store.isViewingSelf(), true);
  assert.equal(store.isManaging(), false);
});

test('Admin betritt Mitglied: isManaging, Identität bleibt, Zyklus wird privat', async () => {
  seedFamily();
  await store.login('u-1', '');
  assert.equal(await store.enterMember('u-2'), true);
  assert.equal(store.activeUserId(), 'u-2');   // betrachteter Nutzer
  assert.equal(store.identityId(), 'u-1');      // angemeldete Person bleibt
  assert.equal(store.isManaging(), true);
  assert.equal(store.isViewingSelf(), false);

  // Selbst wenn das Mitglied das Zyklus-Modul an hätte: beim Verwalten privat.
  store.setSetting('modules', { cycle: true });
  assert.equal(cycleEnabled(), false);

  await store.backToSelf();
  assert.equal(store.activeUserId(), 'u-1');
  assert.equal(store.isManaging(), false);
});

test('Datenschutz in der eigenen Sicht: Zyklus normal aktivierbar', async () => {
  seedFamily();
  await store.login('u-2', '');           // Kind betrachtet sich selbst
  store.setSetting('modules', { cycle: true });
  assert.equal(store.isManaging(), false);
  assert.equal(cycleEnabled(), true);     // eigene Sicht -> aktiv
});

test('Nur Admins dürfen Mitglieder betreten oder verwalten', async () => {
  seedFamily();
  await store.login('u-2', '');           // Kind (user)
  assert.equal(store.isAdmin(), false);
  assert.equal(await store.enterMember('u-1'), false);
  assert.equal(store.activeUserId(), 'u-2'); // unverändert
  assert.equal(await store.addMember({ name: 'X' }), null); // kein Admin -> nichts
  assert.equal(store.members().length, 2);
});

test('Mitglieder-CRUD: anlegen, bearbeiten, letzten Admin schützen', async () => {
  seedFamily();
  await store.login('u-1', '');           // admin
  const papa = await store.addMember({ name: 'Papa', role: 'admin' });
  assert.ok(papa && papa.id);
  assert.equal(store.members().length, 3);

  store.updateMember('u-2', { name: 'Lena' });
  assert.equal(store.members().find((x) => x.id === 'u-2').name, 'Lena');

  assert.equal(store.removeMember('u-2'), true);        // user entfernen
  assert.equal(store.members().length, 2);
  assert.equal(store.removeMember(papa.id), true);      // ein Admin von zweien
  assert.equal(store.removeMember('u-1'), false);       // letzter Admin -> geschützt
  assert.equal(store.members().length, 1);
});

test('addMember vergibt verpflichtend einen Default-PIN (0000), der prüfbar ist', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  const neu = await store.addMember({ name: 'Kind' });
  assert.ok(store.memberHasPin(neu.id), 'neues Mitglied muss einen PIN haben');
  assert.equal(await store.verifyPin(neu.id, '0000'), true, 'Default-PIN 0000 muss passen');
  assert.equal(await store.verifyPin(neu.id, '9999'), false, 'falscher PIN wird abgelehnt');
});

test('addMember respektiert das Mitglieder-Maximum', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }] });
  await store.login('u-1', '');
  for (let i = 0; i < store.MAX_MEMBERS + 3; i++) await store.addMember({ name: 'M' + i });
  assert.equal(store.members().length, store.MAX_MEMBERS);
});

test('Familien-Lager: setFamilyPantry/familyPantry sind familienweit', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], pantry: [] });
  await store.login('u-1', '');
  assert.deepEqual(store.familyPantry(), []);
  store.setFamilyPantry([{ id: 'pty-skyr-g', name: 'Skyr', unit: 'g', amount: 500 }]);
  assert.equal(store.familyPantry().length, 1);
  assert.equal(store.familyPantry()[0].amount, 500);
});

test('refreshFamily leert die Mitglieder NICHT, wenn der Server gleich aktuell ist (Regression Wipe-Bug)', async () => {
  // Frühere Ursache des intermittierenden Login-Kachel-Bugs: Bei gleichem
  // Zeitstempel gab mergeObject die family-Referenz zurück; das anschließende
  // „löschen, dann zuweisen" leerte sie. Server == lokal -> Mitglieder bleiben.
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  const remote = JSON.parse(JSON.stringify(store.getFamily()));  // identischer updatedAt
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: remote }) });
  try {
    assert.equal((await store.refreshFamily()).length, 1);
    assert.equal((await store.refreshFamily()).length, 1, 'zweiter Refresh darf nicht leeren');
    assert.equal((await store.refreshFamily()).length, 1, 'dritter Refresh darf nicht leeren');
  } finally { globalThis.fetch = realFetch; }
});
