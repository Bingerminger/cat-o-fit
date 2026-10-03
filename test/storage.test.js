/* Unit-Tests für Datenintegrität & Backup/Recovery (js/storage.js):
   - Konsistenz von AREAS / ARRAY_AREAS (hätte den diary-{}-Crash verhindert)
   - exportAll/importAll: Roundtrip, Validierung, Typ-Schutz */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';

beforeEach(() => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {} });
});

test('ARRAY_AREAS deckt genau alle Listen-Bereiche ab (nur profile ist ein Objekt)', () => {
  // Diese Invariante verhindert Bugs wie diary als {} statt [] -> .filter crasht.
  const listAreas = store.AREAS.filter((a) => a !== 'profile');
  assert.deepEqual([...store.ARRAY_AREAS].sort(), [...listAreas].sort());
  assert.equal(store.ARRAY_AREAS.includes('profile'), false);
});

test('get() liefert für jeden frischen Listen-Bereich ein Array (kein Crash)', async () => {
  await store.login('u-1', '');
  for (const a of store.ARRAY_AREAS) {
    assert.ok(Array.isArray(store.get(a)), `${a} sollte ein Array sein`);
  }
});

test('exportAll trägt App-Kennung, Version und Nutzer-Kontext', async () => {
  await store.login('u-1', '');
  const dump = store.exportAll();
  assert.equal(dump.app, 'catofit');
  assert.equal(typeof dump.version, 'number');
  assert.equal(dump.user, 'u-1');
  assert.equal(dump.userName, 'Nora');
});

test('Export/Import-Roundtrip stellt Daten wieder her', async () => {
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

test('importAll lehnt Nicht-Objekte ab', () => {
  assert.throws(() => store.importAll(null));
  assert.throws(() => store.importAll('text'));
  assert.throws(() => store.importAll([1, 2, 3]));
});

test('importAll lehnt fremde App-Kennung ab', () => {
  assert.throws(() => store.importAll({ app: 'andereApp', events: [] }), /Cat-O-Fit/);
});

test('importAll lehnt neuere Backup-Version ab', () => {
  assert.throws(() => store.importAll({ app: 'catofit', version: 999, events: [] }), /neuere/);
});

test('importAll überspringt Bereiche mit falschem Typ statt zu crashen', async () => {
  await store.login('u-1', '');
  const res = store.importAll({
    app: 'catofit',
    version: 1,
    events: [{ id: 'e9', name: 'OK' }],   // korrekt -> übernommen
    diary: {},                             // falscher Typ (Objekt statt Array) -> übersprungen
    profile: 'kaputt',                     // falscher Typ (String statt Objekt) -> übersprungen
  });
  assert.ok(res.imported.includes('events'));
  assert.ok(res.skipped.includes('diary'));
  assert.ok(res.skipped.includes('profile'));
  // diary bleibt ein nutzbares Array
  assert.ok(Array.isArray(store.getRaw('diary')));
});

test('exportAll lässt private Bereiche (Zyklus) beim Verwalten fremder Mitglieder aus', async () => {
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Mama', role: 'admin' },
    { id: 'u-2', name: 'Tochter', role: 'user' },
  ], settings: {} });
  await store.login('u-1', '');
  await store.enterMember('u-2');           // Admin verwaltet u-2 -> isManaging
  store.upsert('cycle', { id: 'c1', startDate: '2026-06-01' });
  store.upsert('sessions', { id: 's1', date: '2026-06-02' });
  const dump = store.exportAll();
  assert.equal(dump.cycle, undefined);       // Zyklus NICHT mitexportiert (Datenschutz)
  assert.ok(Array.isArray(dump.sessions));   // andere Bereiche schon
});

test('exportAll enthält Zyklus für die eigene Person', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  store.upsert('cycle', { id: 'c2', startDate: '2026-06-01' });
  const dump = store.exportAll();
  assert.ok(Array.isArray(dump.cycle));      // eigene Zyklusdaten sind dabei
});

test('importAll lässt nicht enthaltene Bereiche unverändert', async () => {
  await store.login('u-1', '');
  store.upsert('events', { id: 'keep', name: 'Behalten' });
  store.importAll({ app: 'catofit', version: 1, diary: [{ id: 'd2', kcal: 1 }] });
  assert.equal(store.find('events', 'keep').name, 'Behalten'); // events nicht überschrieben
});

test('reports sind versiegelt: addReport appendet, remove/patch/upsert wirkungslos', async () => {
  await store.login('u-1', '');
  store.replaceArea('reports', []); // sauberer Start (replaceArea ist intern, kein User-Weg)
  const rep = store.addReport({ type: 'goal', title: 'Urkunde', verdict: 'geschafft' });
  assert.ok(rep.id && rep.sealed === true && rep.createdAt);
  assert.equal(store.get('reports').length, 1);

  // Löschen wirkungslos
  store.remove('reports', rep.id);
  assert.equal(store.get('reports').length, 1, 'Report darf nicht löschbar sein');
  assert.notEqual(store.find('reports', rep.id), null);

  // Editieren wirkungslos
  store.patch('reports', rep.id, { title: 'manipuliert' });
  assert.equal(store.find('reports', rep.id).title, 'Urkunde', 'Report darf nicht editierbar sein');

  // upsert wirkungslos (kein zweiter Weg in den versiegelten Bereich)
  store.upsert('reports', { id: 'fremd', title: 'eingeschmuggelt' });
  assert.equal(store.get('reports').length, 1, 'upsert darf reports nicht verändern');
});

test('Übungs-Nutzung: bumpExerciseUsage zählt je Übung hoch (pro Nutzer)', async () => {
  await store.login('u-1', '');
  assert.deepEqual(store.exerciseUsage(), {}, 'anfangs leer');
  store.bumpExerciseUsage(['squat', 'squat', 'plank']);
  store.bumpExerciseUsage('squat'); // Einzel-id ist ebenfalls erlaubt
  assert.deepEqual(store.exerciseUsage(), { squat: 3, plank: 1 });
});

test('Datenschutz: private Bereiche (Zyklus) sind beim Verwalten fremder Mitglieder gesperrt', async () => {
  store.saveFamily({ members: [{ id: 'u-1', name: 'Admin', role: 'admin' }, { id: 'u-2', name: 'Mia', role: 'user' }], settings: {} });
  await store.login('u-1', '');
  assert.equal(store.isManaging(), false, 'als man selbst kein Managing');
  assert.equal(store.areaAllowed('cycle'), true, 'eigener Zyklus erlaubt');
  await store.enterMember('u-2');
  assert.equal(store.isManaging(), true, 'jetzt Verwaltung eines Mitglieds');
  assert.equal(store.areaAllowed('cycle'), false, 'fremder Zyklus gesperrt');
  assert.equal(store.get('cycle').length, 0, 'get("cycle") gibt beim Verwalten [] zurück');
  assert.equal(store.areaAllowed('health'), true, 'nicht-private Bereiche bleiben sichtbar');
});
