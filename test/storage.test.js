/* Unit tests for data integrity & backup/recovery (js/storage.js):
   - consistency of AREAS / ARRAY_AREAS (would have prevented the diary-{} crash)
   - exportAll/importAll: round trip, validation, type protection */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';

beforeEach(() => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {} });
});

test('ARRAY_AREAS covers exactly all list areas (only profile is an object)', () => {
  // This invariant prevents bugs such as diary as {} instead of [] -> .filter crashes.
  const listAreas = store.AREAS.filter((a) => a !== 'profile');
  assert.deepEqual([...store.ARRAY_AREAS].sort(), [...listAreas].sort());
  assert.equal(store.ARRAY_AREAS.includes('profile'), false);
});

test('get() returns an array for every fresh list area (no crash)', async () => {
  await store.login('u-1', '');
  for (const a of store.ARRAY_AREAS) {
    assert.ok(Array.isArray(store.get(a)), `${a} should be an array`);
  }
});

test('exportAll carries the app identifier, version and user context', async () => {
  await store.login('u-1', '');
  const dump = store.exportAll();
  assert.equal(dump.app, 'catofit');
  assert.equal(typeof dump.version, 'number');
  assert.equal(dump.user, 'u-1');
  assert.equal(dump.userName, 'Robin');
});

test('Export/import round trip restores data', async () => {
  await store.login('u-1', '');
  store.upsert('events', { id: 'e1', name: 'Stadtlauf' });
  store.upsert('diary', { id: 'd1', date: '2026-06-29', kcal: 500 });
  const dump = store.exportAll();

  store.replaceArea('events', []);
  store.replaceArea('diary', []);
  assert.equal(store.get('events').length, 0);

  const res = store.importAll(dump);
  assert.ok(res.imported.includes('events'));
  assert.ok(res.imported.includes('diary'));
  assert.equal(store.get('events').length, 1);
  assert.equal(store.find('events', 'e1').name, 'Stadtlauf');
  assert.ok(Array.isArray(store.getRaw('diary')));
});

test('importAll rejects non-objects', () => {
  assert.throws(() => store.importAll(null));
  assert.throws(() => store.importAll('text'));
  assert.throws(() => store.importAll([1, 2, 3]));
});

test('importAll rejects a foreign app identifier', () => {
  assert.throws(() => store.importAll({ app: 'andereApp', events: [] }), /Cat-O-Fit/);
});

test('importAll rejects a newer backup version', () => {
  assert.throws(() => store.importAll({ app: 'catofit', version: 999, events: [] }), /neuere/);
});

test('importAll skips areas of the wrong type instead of crashing', async () => {
  await store.login('u-1', '');
  const res = store.importAll({
    app: 'catofit',
    version: 1,
    events: [{ id: 'e9', name: 'OK' }],   // correct -> imported
    diary: {},                             // wrong type (object instead of array) -> skipped
    profile: 'kaputt',                     // wrong type (string instead of object) -> skipped
  });
  assert.ok(res.imported.includes('events'));
  assert.ok(res.skipped.includes('diary'));
  assert.ok(res.skipped.includes('profile'));
  // diary stays a usable array
  assert.ok(Array.isArray(store.getRaw('diary')));
});

test('exportAll leaves out private areas (cycle) when managing other members', async () => {
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Mama', role: 'admin' },
    { id: 'u-2', name: 'Tochter', role: 'user' },
  ], settings: {} });
  await store.login('u-1', '');
  await store.enterMember('u-2');           // admin manages u-2 -> isManaging
  store.upsert('cycle', { id: 'c1', startDate: '2026-06-01' });
  store.upsert('sessions', { id: 's1', date: '2026-06-02' });
  const dump = store.exportAll();
  assert.equal(dump.cycle, undefined);       // cycle NOT exported (privacy)
  assert.ok(Array.isArray(dump.sessions));   // other areas are included
});

test('exportAll includes the cycle for the person themselves', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  store.upsert('cycle', { id: 'c2', startDate: '2026-06-01' });
  const dump = store.exportAll();
  assert.ok(Array.isArray(dump.cycle));      // own cycle data is included
});

test('importAll leaves areas that are not included unchanged', async () => {
  await store.login('u-1', '');
  store.upsert('events', { id: 'keep', name: 'Behalten' });
  store.importAll({ app: 'catofit', version: 1, diary: [{ id: 'd2', kcal: 1 }] });
  assert.equal(store.find('events', 'keep').name, 'Behalten'); // events not overwritten
});

test('reports are sealed: addReport appends, remove/patch/upsert have no effect', async () => {
  await store.login('u-1', '');
  store.replaceArea('reports', []); // clean start (replaceArea is internal, not a user path)
  const rep = store.addReport({ type: 'goal', title: 'Urkunde', verdict: 'geschafft' });
  assert.ok(rep.id && rep.sealed === true && rep.createdAt);
  assert.equal(store.get('reports').length, 1);

  // Deleting has no effect
  store.remove('reports', rep.id);
  assert.equal(store.get('reports').length, 1, 'report must not be deletable');
  assert.notEqual(store.find('reports', rep.id), null);

  // Editing has no effect
  store.patch('reports', rep.id, { title: 'manipuliert' });
  assert.equal(store.find('reports', rep.id).title, 'Urkunde', 'report must not be editable');

  // upsert has no effect (no second way into the sealed area)
  store.upsert('reports', { id: 'fremd', title: 'eingeschmuggelt' });
  assert.equal(store.get('reports').length, 1, 'upsert must not change reports');
});

test('Exercise usage: bumpExerciseUsage counts up per exercise (per user)', async () => {
  await store.login('u-1', '');
  assert.deepEqual(store.exerciseUsage(), {}, 'empty at first');
  store.bumpExerciseUsage(['squat', 'squat', 'plank']);
  store.bumpExerciseUsage('squat'); // a single id is also allowed
  assert.deepEqual(store.exerciseUsage(), { squat: 3, plank: 1 });
});

test('Privacy: private areas (cycle) are locked when managing other members', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Admin', role: 'admin' }, { id: 'u-2', name: 'Mia', role: 'user' }], settings: {} });
  await store.login('u-1', '');
  assert.equal(store.isManaging(), false, 'not managing as oneself');
  assert.equal(store.areaAllowed('cycle'), true, 'own cycle allowed');
  await store.enterMember('u-2');
  assert.equal(store.isManaging(), true, 'now managing a member');
  assert.equal(store.areaAllowed('cycle'), false, 'cycle of another person locked');
  assert.equal(store.get('cycle').length, 0, 'get("cycle") returns [] when managing');
  assert.equal(store.areaAllowed('health'), true, 'non-private areas stay visible');
});
