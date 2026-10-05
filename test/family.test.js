/* Unit tests for roles, admin co-management and member CRUD (js/storage.js).
   Checks in particular the privacy rule: the cycle is private while managing. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { cycleEnabled } from '../js/cycle.js';
import { scopeKey } from '../js/ui.js';
import { sha256Hex } from '../js/sha256.js';

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

test('Roles: isAdmin reflects the role of the signed-in person', async () => {
  seedFamily();
  assert.equal(store.isAdmin(), false); // nobody signed in
  await store.login('u-1', '');
  assert.equal(store.isAdmin(), true);
  assert.equal(store.isViewingSelf(), true);
  assert.equal(store.isManaging(), false);
});

test('Admin enters a member: isManaging, identity remains, cycle becomes private', async () => {
  seedFamily();
  await store.login('u-1', '');
  assert.equal(await store.enterMember('u-2'), true);
  assert.equal(store.activeUserId(), 'u-2');   // viewed user
  assert.equal(store.identityId(), 'u-1');      // signed-in person remains
  assert.equal(store.isManaging(), true);
  assert.equal(store.isViewingSelf(), false);

  // Even if the member had the cycle module on: private while managing.
  store.setSetting('modules', { cycle: true });
  assert.equal(cycleEnabled(), false);

  await store.backToSelf();
  assert.equal(store.activeUserId(), 'u-1');
  assert.equal(store.isManaging(), false);
});

test('Privacy in the own view: cycle can be enabled normally', async () => {
  seedFamily();
  await store.login('u-2', '');           // child views their own data
  store.setSetting('modules', { cycle: true });
  assert.equal(store.isManaging(), false);
  assert.equal(cycleEnabled(), true);     // own view -> active
});

test('Only admins may enter or manage members', async () => {
  seedFamily();
  await store.login('u-2', '');           // child (user)
  assert.equal(store.isAdmin(), false);
  assert.equal(await store.enterMember('u-1'), false);
  assert.equal(store.activeUserId(), 'u-2'); // unchanged
  assert.equal(await store.addMember({ name: 'X' }), null); // no admin -> nothing
  assert.equal(store.members().length, 2);
});

test('Member CRUD: create, edit, protect the last admin', async () => {
  seedFamily();
  await store.login('u-1', '');           // admin
  const papa = await store.addMember({ name: 'Papa', role: 'admin' });
  assert.ok(papa && papa.id);
  assert.equal(store.members().length, 3);

  store.updateMember('u-2', { name: 'Lena' });
  assert.equal(store.members().find((x) => x.id === 'u-2').name, 'Lena');

  assert.equal(store.removeMember('u-2'), true);        // remove user
  assert.equal(store.members().length, 2);
  assert.equal(store.removeMember(papa.id), true);      // one admin of two
  assert.equal(store.removeMember('u-1'), false);       // last admin -> protected
  assert.equal(store.members().length, 1);
});

test('addMember mandatorily assigns a start PIN (0000) – the hash goes only to the server', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  const neu = await store.addMember({ name: 'Kind' });
  assert.ok(store.memberHasPin(neu.id), 'new member must have a PIN');
  const fs = JSON.parse(localStorage.getItem(scopeKey('familyStore')));
  const op = fs.ops.find((o) => o.record && o.record.id === neu.id);
  assert.equal(op.record.pinHash, sha256Hex(`catofit:${neu.id}:0000`), 'start PIN 0000 as a hash in the op');
  assert.equal(fs.records[neu.id].pinHash, undefined, 'locally only hasPin, no hash');
});

test('addMember respects the member maximum', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }] });
  await store.login('u-1', '');
  for (let i = 0; i < store.MAX_MEMBERS + 3; i++) await store.addMember({ name: 'M' + i });
  assert.equal(store.members().length, store.MAX_MEMBERS);
});

test('Family pantry: setFamilyPantry/familyPantry are family-wide', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], pantry: [] });
  await store.login('u-1', '');
  assert.deepEqual(store.familyPantry(), []);
  store.setFamilyPantry([{ id: 'pty-skyr-g', name: 'Skyr', unit: 'g', amount: 500 }]);
  assert.equal(store.familyPantry().length, 1);
  assert.equal(store.familyPantry()[0].amount, 500);
});

test('refreshFamily does NOT empty the members when the server is equally current (wipe bug regression)', async () => {
  // Earlier cause of the intermittent login-tile bug: with an identical
  // timestamp mergeObject returned the family reference; the subsequent
  // "delete, then assign" emptied it. Server == local -> members remain.
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  const remote = JSON.parse(JSON.stringify(store.getFamily()));  // identical updatedAt
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: remote }) });
  try {
    assert.equal((await store.refreshFamily()).length, 1);
    assert.equal((await store.refreshFamily()).length, 1, 'second refresh must not empty');
    assert.equal((await store.refreshFamily()).length, 1, 'third refresh must not empty');
  } finally { globalThis.fetch = realFetch; }
});
