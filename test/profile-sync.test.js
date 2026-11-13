/* The profile across devices, against the protocol-faithful test server (test-setup.js).
   A first sign-in on a new device must not overwrite what the server knows about the person,
   and settings changed on two devices must both survive: profile writes go out field by field
   (op `merge`), and the region's unit defaults are saved only after the profile was fetched. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { ensureUnitDefaults } from '../js/unit-prefs.js';
import { scopeKey } from '../js/ui.js';

const realFetch = globalThis.fetch;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let srv;
let unsubscribe = null;
const FEATURES = ['changes-all', 'ops-since', 'merge-ops'];
const FAMILY = {
  members: [{ id: 'u-1', name: 'Robin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' }],
  settings: {}, pantry: [], teams: [],
};
const serverProfile = () => srv.store('profile', { user: 'u-1' }).records.profile || {};
const meta = () => JSON.parse(localStorage.getItem(scopeKey('u-1:__meta')) || '{}');

function setLanguages(languages) {
  Object.defineProperty(globalThis, 'navigator', { value: { ...globalThis.navigator, languages, language: languages[0] }, configurable: true, writable: true });
}

/** Sign in like the app: the profile event saves the region's units (app.js onSync). */
async function signIn() {
  unsubscribe?.();
  unsubscribe = store.onSync((area) => { if (area === 'profile') ensureUnitDefaults(); });
  await store.login('u-1', '');
  await store.syncNow();
  await store.syncNow();
}

/** A new device: empty browser storage, the same server. */
async function freshDevice(languages) {
  store.clearActiveUser();
  localStorage.clear();
  setLanguages(languages);
  store.saveFamily(FAMILY);
  await signIn();
}

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  srv = globalThis.__fakeServer.install();
  srv.opts.features = FEATURES.slice();
  store.clearActiveUser();
  store.saveFamily(FAMILY);
  setLanguages(['de-DE']);
  await signIn();
  // Device A: a complete profile with the person's own units.
  store.setProfile({ name: 'Robin', heightCm: 179, weightKg: 72, birthYear: 1990, sex: 'f' });
  store.setSetting('weeklyGoals', { activeMinutes: 150, trainingDays: 4 });
  await store.syncNow();
});
afterEach(() => {
  unsubscribe?.(); unsubscribe = null;
  globalThis.fetch = realFetch;
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
});

test('first sign-in on a new device keeps the profile on the server', async () => {
  assert.equal(serverProfile().heightCm, 179, 'device A saved the profile');
  await freshDevice(['de-DE']);
  const p = serverProfile();
  assert.deepEqual([p.heightCm, p.weightKg, p.birthYear, p.sex], [179, 72, 1990, 'f'], 'nothing lost on the server');
  assert.deepEqual(p.settings.weeklyGoals, { activeMinutes: 150, trainingDays: 4 });
  assert.equal(store.profile().heightCm, 179, 'the new device shows the profile');
});

test('a new device in another region does not switch the person\'s units', async () => {
  const before = { ...serverProfile().settings };
  assert.equal(before.distanceUnit, 'km', 'device A saved its units after fetching');
  await freshDevice(['en-US']);
  const s = serverProfile().settings;
  assert.deepEqual([s.distanceUnit, s.weightUnit, s.temperatureUnit, s.weekStart, s.labUnits],
    [before.distanceUnit, before.weightUnit, before.temperatureUnit, before.weekStart, before.labUnits]);
  assert.equal(store.settings().distanceUnit, 'km', 'the device takes the person\'s units');
});

test('unit defaults wait for the first fetch of the profile', async () => {
  store.clearActiveUser();
  localStorage.clear();
  store.saveFamily(FAMILY);
  srv.opts.offline = true;                  // signed in, the server cannot be reached yet
  await signIn();
  assert.equal((meta().ops?.profile || []).length, 0, 'nothing queued before the profile was fetched');
  srv.opts.offline = false;
  await store.syncNow();
  assert.equal(serverProfile().heightCm, 179);
});

test('a setting changed before the first fetch only writes that setting', async () => {
  store.clearActiveUser();
  localStorage.clear();
  store.saveFamily(FAMILY);
  srv.opts.offline = true;
  await signIn();
  store.setSetting('showMusic', 'calm');    // e.g. switched in the workout player while offline
  srv.opts.offline = false;
  await store.syncNow();
  const p = serverProfile();
  assert.equal(p.settings.showMusic, 'calm');
  assert.equal(p.heightCm, 179, 'the rest of the profile stays');
  assert.deepEqual(p.settings.weeklyGoals, { activeMinutes: 150, trainingDays: 4 });
  assert.equal(store.profile().heightCm, 179, 'the device gets the whole profile back');
});

test('settings changed on two devices both survive', async () => {
  // Device B changes the accent colour on the server meanwhile …
  const s = srv.store('profile', { user: 'u-1' });
  const p = s.records.profile;
  s.records.profile = { ...p, settings: { ...p.settings, accent: 'teal' }, updatedAt: new Date().toISOString(), rev: ++s.rev };
  // … and this device, not yet synced, changes another setting and a field.
  store.setSetting('showVoice', false);
  store.setProfile({ weightKg: 71 });
  await store.syncNow();
  const after = serverProfile();
  assert.equal(after.settings.accent, 'teal', 'the other device\'s setting survives');
  assert.equal(after.settings.showVoice, false);
  assert.equal(after.weightKg, 71);
  assert.equal(store.settings().accent, 'teal', 'and arrives here');
});

test('several setting changes before a push go out as one op', async () => {
  srv.opts.offline = true;
  store.setSetting('showMusic', 'pop');
  store.setSetting('showVoice', true);
  store.setSetting('showMusic', 'calm');
  const ops = meta().ops.profile;
  assert.equal(ops.length, 1, 'combined in the queue');
  srv.opts.offline = false;
  await store.syncNow();
  const p = serverProfile();
  assert.deepEqual([p.settings.showMusic, p.settings.showVoice, p.heightCm], ['calm', true, 179]);
});

test('a server without field-wise profile writes still gets the whole profile', async () => {
  srv.opts.features = ['changes-all', 'ops-since'];
  store.setSetting('accent', 'violet');
  await store.syncNow();
  const p = serverProfile();
  assert.equal(p.settings.accent, 'violet');
  assert.equal(p.heightCm, 179);
});
