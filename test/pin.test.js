/* PIN and server session (js/storage.js against the test server in test-setup.js, which
   mimics api/auth.php):
   - SHA-256 is bit-exact; the PIN hash does not leave the server (the device only knows `hasPin`).
   - The server checks the PIN (including the old djb2 format) and opens a session.
   - Without a server only with the check value of this device; private areas only with a session.
   - Changing a PIN: your own only with the previous one, 4–8 digits, not 0000; other people's only by an admin.
   Before v3.20.0 only the device checked, against a hash that anyone could read via the API. */
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

test('sha256Hex: known vectors (bit-exact like crypto.subtle)', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(sha256Hex('catofit:u-1:1234'), sha256Hex('catofit:u-1:1234')); // deterministic
});

beforeEach(async () => {
  setOnline(true);
  localStorage.clear();
  sessionStorage.clear();
  srv = globalThis.__fakeServer.install();
  store.clearActiveUser();
  // Server state: admin with PIN 1234, member with an old djb2 hash (PIN 4711).
  const f = srv.store('family', { scope: 'family' });
  f.records['u-1'] = { id: 'u-1', _kind: 'member', name: 'Admin', role: 'admin', pinHash: H('u-1', '1234'), createdAt: '2026-01-01T00:00:00Z', rev: ++f.rev };
  f.records['u-2'] = { id: 'u-2', _kind: 'member', name: 'Kind', role: 'user', pinHash: djb2('catofit:u-2:4711'), createdAt: '2026-01-02T00:00:00Z', rev: ++f.rev };
  // Reset the local state (rev 0 -> the server state wins on sync).
  store.saveFamily({ members: [{ id: 'u-1', name: 'Admin', role: 'admin' }, { id: 'u-2', name: 'Kind', role: 'user' }] });
  await store.refreshFamily();
});
afterEach(() => { setOnline(true); globalThis.fetch = realFetch; store.setSharedDevice(false); });

test('Login: the server checks the PIN, the hash never reaches the device', async () => {
  assert.equal(store.memberHasPin('u-1'), true, 'lock comes from hasPin');
  assert.ok(!famLS().includes(H('u-1', '1234')), 'no PIN hash in device storage');
  assert.equal(await store.login('u-1', '9999'), false);
  assert.equal(store.lastLoginError().code, 'pin');
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal(srv.auth.session, 'u-1', 'server session opened');
  assert.equal(store.serverSessionActive(), true);
  assert.ok(!famLS().includes(H('u-1', '1234')), 'no hash after the sync either');
});

test('The server still checks the old djb2 format (backward compatibility)', async () => {
  assert.equal(await store.login('u-2', '0000'), false);
  assert.equal(await store.login('u-2', '4711'), true);
});

test('After five failed attempts the login reports a lockout', async () => {
  for (let i = 0; i < 4; i++) assert.equal(await store.login('u-2', '1111'), false);
  assert.equal(await store.login('u-2', '1111'), false);
  assert.equal(store.lastLoginError().code, 'locked');
  assert.equal(await store.login('u-2', '4711'), false, 'even the correct PIN has to wait out the lockout');
});

test('Without a server: login only with the check value of this device, private data follows later', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  await store.logout();
  setOnline(false);
  assert.equal(await store.login('u-2', '4711'), false, 'u-2 was never logged in online on this device');
  assert.equal(store.lastLoginError().code, 'offline-first');
  assert.equal(await store.login('u-1', '0000'), false, 'wrong PIN rejected offline too');
  assert.equal(await store.login('u-1', '1234'), true, 'check value of the device');
  assert.equal(store.serverSessionActive(), false, 'no server session yet');
  store.upsert('labs', { id: 'l1', analyte: 'ferritin', value: 40, date: '2026-09-01' });
  setOnline(true);
  srv.auth.session = null;
  await store.syncNow();
  assert.equal(srv.auth.session, 'u-1', 'server login made up for');
  assert.ok(srv.store('labs', { user: 'u-1' }).records.l1, 'private data sent after the login');
});

test('Private areas sync only with an own session – ops wait otherwise', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;                       // session expired on the server
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    store.upsert('cycle', { id: 'c1', startDate: '2026-09-10' });
    await store.syncNow();
    assert.ok(!srv.store('cycle', { user: 'u-1' }).records.c1, 'nothing sent without a session');
    assert.ok(events.includes('catofit:session-required'), 'the UI is asked to request the PIN');
    assert.equal(await store.reauth('1234'), true);   // triggers a sync itself
    for (let i = 0; i < 200 && !srv.store('cycle', { user: 'u-1' }).records.c1; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(srv.store('cycle', { user: 'u-1' }).records.c1, 'sent after logging in again');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});

test('After the update without a server session: ask for the PIN once, then sync', async () => {
  // v3.19.0 had no server session. After the update the person is still logged in
  // in the app (browser session), but the server does not know them – until now cycle,
  // labs and supplements then silently stayed put without the app asking for the PIN.
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;
  const events = [];
  const onEv = (e) => events.push(e.type);
  window.addEventListener('catofit:session-required', onEv);
  try {
    await store.init();                               // reload with a restored login
    store.upsert('labs', { id: 'l9', analyte: 'ferritin', value: 41, date: '2026-09-02' });
    await store.syncNow();
    await store.syncNow();
    assert.equal(events.length, 1, 'exactly one prompt per page load ("Later" counts)');
    assert.ok(!srv.store('labs', { user: 'u-1' }).records.l9, 'without a session the value waits');
    assert.equal(await store.reauth('1234'), true);
    for (let i = 0; i < 200 && !srv.store('labs', { user: 'u-1' }).records.l9; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(srv.store('labs', { user: 'u-1' }).records.l9, 'sent after the PIN');
  } finally { window.removeEventListener('catofit:session-required', onEv); }
});

test('Managing: the admin does not even request the private areas of the member', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.requests.length = 0;
  await store.enterMember('u-2');
  await store.syncNow();
  const priv = srv.requests.filter((r) => r.user === 'u-2' && ['cycle', 'labs', 'supplements'].includes(r.area));
  assert.equal(priv.length, 0, 'no requests to private areas of other people');
});

test('Managing: waiting private data of the member does not show a permanent "Offline"', async () => {
  const ind = document.createElement('div'); ind.setAttribute('id', 'sync-indicator'); document.body.appendChild(ind);
  try {
    assert.equal(await store.login('u-1', '1234'), true);
    await store.enterMember('u-2');
    // This is how the first-time setup with demo data creates private values of a member.
    store.upsert('labs', { id: 'l-kind', analyte: 'ferritin', value: 30, date: '2026-09-01' });
    await store.syncNow();
    assert.ok(!srv.store('labs', { user: 'u-2' }).records['l-kind'], 'waits for the member to log in');
    assert.equal(ind.dataset.state, 'idle', 'the connection is fine');
    // Own private data that has not been sent yet, by contrast, still counts as pending.
    await store.backToSelf();
    srv.auth.session = null;
    store.upsert('cycle', { id: 'c-eigen', startDate: '2026-09-10' });
    srv.opts.offline = true;
    await store.syncNow();
    assert.notEqual(ind.dataset.state, 'idle');
  } finally { srv.opts.offline = false; ind.remove(); }
});

test('Changing a PIN: your own only with the previous one, 4–8 digits, not 0000', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal((await store.setMemberPin('u-1', '12', '1234')).code, 'weak');
  assert.equal((await store.setMemberPin('u-1', '0000', '1234')).code, 'weak');
  assert.equal((await store.setMemberPin('u-1', '5678', '1111')).code, 'pin', 'wrong previous PIN');
  assert.equal((await store.setMemberPin('u-1', '5678', '1234')).ok, true);
  assert.equal(srv.store('family', { scope: 'family' }).records['u-1'].pinHash, H('u-1', '5678'));
  await store.logout();
  assert.equal(await store.login('u-1', '1234'), false);
  assert.equal(await store.login('u-1', '5678'), true);
});

test('PIN of a member: only an admin can set it anew (without the old PIN)', async () => {
  assert.equal(await store.login('u-2', '4711'), true);
  assert.equal((await store.setMemberPin('u-1', '2468')).code, 'admin', 'a member must not set the PIN of someone else');
  await store.logout();
  assert.equal(await store.login('u-1', '1234'), true);
  assert.equal((await store.setMemberPin('u-2', '2468')).ok, true);
  await store.logout();
  assert.equal(await store.login('u-2', '2468'), true);
});

test('New member: the starting PIN goes to the server only as a hash', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  const neu = await store.addMember({ name: 'Neu' });
  await store.syncNow();
  assert.equal(srv.store('family', { scope: 'family' }).records[neu.id].pinHash, H(neu.id, '0000'));
  assert.equal(store.memberHasPin(neu.id), true);
  assert.ok(!famLS().includes(H(neu.id, '0000')), 'hash not in device storage');
});

test('Family: the server rejects role changes without an admin session, the device follows the server', async () => {
  assert.equal(await store.login('u-1', '1234'), true);
  srv.auth.session = null;                       // e.g. session expired
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
    assert.equal(srv.store('family', { scope: 'family' }).records['u-2'].role, 'user', 'server unchanged');
    assert.equal(store.members().find((m) => m.id === 'u-2').role, 'user', 'device shows the server state again');
    assert.deepEqual(seen, [1], 'the UI learns about the rejection');
    assert.deepEqual(reasons, ['Rollen kann nur eine Admin-Person mit Serververbindung ändern.'], 'reason translated from the code, not the English server text');
  } finally { window.removeEventListener('catofit:ops-rejected', onEv); window.removeEventListener('catofit:ops-rejected', onReason); }
});

test('Shared device: logging out clears personal data, unsent changes stay', async () => {
  store.setSharedDevice(true);
  assert.equal(await store.login('u-1', '1234'), true);
  store.upsert('health', { id: 'h1', date: '2026-09-01', weight: 70 });
  await store.syncNow();
  setOnline(false);
  store.upsert('diary', { id: 'd1', date: '2026-09-02', text: 'offline notiert' });
  await store.logout();
  assert.equal(localStorage.getItem(scopeKey('u-1:health')), null, 'area data removed');
  assert.equal(localStorage.getItem(scopeKey('pinLocal')), null, 'device check values removed');
  const meta = JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || 'null');
  assert.equal(meta && meta.ops.diary.length, 1, 'unsent change is kept');
  assert.ok(famLS(), 'family list for the login stays');
});

test('Older caches: PIN hashes disappear at start-up', async () => {
  localStorage.setItem(scopeKey('familyStore'), JSON.stringify({
    rev: 0, ops: [],
    records: { 'u-1': { id: 'u-1', _kind: 'member', name: 'Admin', role: 'admin', pinHash: H('u-1', '1234') } },
  }));
  await store.init();
  assert.ok(!famLS().includes(H('u-1', '1234')), 'hash removed from device storage');
  assert.equal(store.memberHasPin('u-1'), true, 'lock stays');
});
