/* Tests für die PIN-Härtung (js/sha256.js + js/storage.js):
   - SHA-256 ist korrekt (bekannte Vektoren) und deterministisch in JEDEM Kontext.
   - Neue PINs sind SHA-256; alte djb2-PINs werden weiter akzeptiert
     (Abwärtskompatibilität – sonst wären Personen je nach http/https ausgesperrt). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../js/sha256.js';
import * as store from '../js/storage.js';

test('sha256Hex: bekannte Vektoren (bit-genau wie crypto.subtle)', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(sha256Hex('catofit:u-1:1234'), sha256Hex('catofit:u-1:1234')); // deterministisch
});

beforeEach(() => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Admin', role: 'admin' }], settings: {} });
});

test('Neuer PIN ist SHA-256 und überall prüfbar', async () => {
  await store.login('u-1', '');
  const m = await store.addMember({ name: 'Kind', pin: '0000' });
  assert.equal(store.memberHasPin(m.id), true);
  assert.equal(await store.verifyPin(m.id, '0000'), true);
  assert.equal(await store.verifyPin(m.id, '9999'), false);
  const hash = store.members().find((x) => x.id === m.id).pinHash;
  assert.match(hash, /^[0-9a-f]{64}$/, 'SHA-256-Hex, kein djb2-Präfix');
});

test('Alter djb2-PIN wird weiter akzeptiert (Abwärtskompatibilität)', async () => {
  const djb2 = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return 'fb' + h.toString(16); };
  const legacy = djb2('catofit:u-9:1234');
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Admin', role: 'admin' },
    { id: 'u-9', name: 'Alt', role: 'user', pinHash: legacy },
  ], settings: {} });
  await store.login('u-1', '');
  assert.equal(await store.verifyPin('u-9', '1234'), true, 'alter PIN muss weiter passen');
  assert.equal(await store.verifyPin('u-9', '0000'), false);
});

test('Geändeter PIN wird auf SHA-256 umgestellt', async () => {
  await store.login('u-1', '');
  await store.setMemberPin('u-1', '5678');
  const hash = store.members().find((x) => x.id === 'u-1').pinHash;
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await store.verifyPin('u-1', '5678'), true);
});
