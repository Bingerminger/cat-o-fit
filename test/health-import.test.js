/* Übernahme eines Apple-Health-Exports (js/health-import.js importResult):
   große Exporte in einem Schreibvorgang, Ergänzen statt Überschreiben und
   Doppel-Erkennung auch für Läufe, die einer geplanten Einheit zugeordnet wurden. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { importResult, importActivities, saveImportedActivity } from '../js/health-import.js';
import { addDays } from '../js/ui.js';

const realSetItem = localStorage.setItem;

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});
afterEach(() => { localStorage.setItem = realSetItem; localStorage.__setQuota(Infinity); });

test('FE-04: 1 500 Tage Körperwerte werden in wenigen Schreibvorgängen übernommen', () => {
  const health = Array.from({ length: 1500 }, (_, i) => ({ date: addDays('2022-01-01', i), weight: 70 + (i % 10) / 10 }));
  let writes = 0;
  localStorage.setItem = function (k, v) { writes++; return realSetItem.call(this, k, v); };
  const r = importResult({ health, workouts: [] });
  localStorage.setItem = realSetItem;
  assert.equal(r.hImp, 1500);
  assert.equal(store.get('health').length, 1500, 'alle Tage im Bestand');
  assert.ok(writes <= 4, `höchstens eine Handvoll Schreibvorgänge statt einer je Tag (waren ${writes})`);
});

test('FE-04: vorhandene Tage werden nur ergänzt, eigene Werte bleiben', () => {
  store.upsert('health', { id: 'h-1', date: '2026-09-01', weight: 70.1, source: 'manual' });
  const r = importResult({ health: [{ date: '2026-09-01', weight: 72, restingHr: 48 }, { date: '2026-09-02', weight: 70.3 }], workouts: [] });
  assert.equal(r.hImp, 2);
  const day = store.find('health', 'h-1');
  assert.equal(day.weight, 70.1, 'eigener Wert nicht überschrieben');
  assert.equal(day.restingHr, 48, 'fehlender Wert ergänzt');
  assert.equal(store.get('health').filter((h) => h.date === '2026-09-01').length, 1, 'kein zweiter Eintrag für den Tag');
  assert.ok(store.get('health').some((h) => h.date === '2026-09-02'), 'neuer Tag angelegt');
});

test('Doppelt exportierter Lauf an einem Tag mit geplanter Einheit zählt nur einmal', () => {
  store.upsert('plans', { id: 'p-1', eventId: null, units: [{ id: 'un-1', date: '2026-09-03', type: 'easy', title: 'Lockerer Lauf', status: 'geplant' }] });
  const run = { date: '2026-09-03', distanceKm: 8.02, durationSec: 2890 };
  const r = importResult({ health: [], workouts: [run, { ...run }] });
  assert.equal(r.matched, 1, 'der erste Lauf erledigt die geplante Einheit');
  assert.equal(r.wSkip, 1, 'die Doppelung wird erkannt');
  assert.equal(store.get('sessions').filter((s) => s.date === '2026-09-03').length, 1, 'genau eine Einheit am Tag');
});

test('FE-03/FE-04: voller Gerätespeicher – der Import meldet 0 statt erfundener Zahlen', () => {
  localStorage.__setQuota(localStorage.__used() + 200);
  const health = Array.from({ length: 50 }, (_, i) => ({ date: addDays('2025-01-01', i), weight: 70 }));
  const r = importResult({ health, workouts: [] });
  localStorage.__setQuota(Infinity);
  assert.equal(r.hImp, 0, 'nichts übernommen');
  assert.equal(store.get('health').length, 0, 'Bestand unverändert');
});

test('Voll-Import: alle Sportarten mit ihrem Typ, Zyklus nur auf Wunsch und ohne Doppel', () => {
  store.upsert('cycle', { id: 'c-hand', startDate: '2026-08-02', periodLength: 5 });   // von Hand erfasst
  const result = {
    health: [],
    workouts: [
      { date: '2026-09-12', type: 'cross_bike', title: 'Radtour (Health-Import)', distanceKm: 24, durationSec: 3600 },
      { date: '2026-09-13', distanceKm: 8, durationSec: 2700 },                 // älterer Server: Lauf ohne Typ
    ],
    periods: [{ start: '2026-08-01', length: 4 }, { start: '2026-09-01', length: 5 }],
  };
  const without = importResult({ ...result, workouts: [] });
  assert.equal(without.pImp, 0, 'ohne Zustimmung kein Zyklus');
  const r = importResult(result, { cycle: true });
  const types = store.get('sessions').map((s) => s.type).sort();
  assert.deepEqual(types, ['cross_bike', 'easy']);
  assert.equal(store.get('sessions').find((s) => s.type === 'cross_bike').title, 'Radtour (Health-Import)');
  assert.equal(r.pImp, 1, 'Periode am 1.8. liegt neben dem Eintrag vom 2.8. – nur die im September kommt dazu');
  const sept = store.get('cycle').find((c) => c.startDate === '2026-09-01');
  assert.ok(sept && sept.periodLength === 5 && sept.source === 'health');
});

test('Massenimport von Dateien: Doppelte raus, ein Schreibvorgang, Strecken nur für jüngere Einheiten', () => {
  const T = '2026-09-29';
  store.upsert('sessions', { id: 'had', date: '2026-09-20', type: 'run', distanceKm: 10, durationSec: 3000 });
  const act = (date, km, sec, extra = {}) => ({ act: { date, distanceKm: km, durationSec: sec, type: 'run', sportKnown: true, splits: [], route: { poly: '_p~iF~ps|U' }, ascentM: 40, ...extra } });
  let writes = 0;
  localStorage.setItem = function (k, v) { writes++; return realSetItem.call(this, k, v); };
  const r = importActivities([
    act('2026-01-10', 8, 2800),                         // alt: ohne Strecke
    act('2026-09-20', 10.1, 3020),                      // schon vorhanden
    act('2026-09-25', 12, 4000),                        // neu, mit Strecke
    act('2026-09-25', 12.1, 4030),                      // dieselbe Einheit doppelt im Archiv
    act('2026-09-26', 30, 3600, { type: 'run', sportKnown: false }),   // ohne Sportart, 30 km/h → Rad
  ], T);
  localStorage.setItem = realSetItem;
  assert.deepEqual(r, { added: 3, matched: 0, dup: 2 });
  const s = store.get('sessions').filter((x) => x.id !== 'had').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(s[0].route, null, 'älter als 90 Tage: keine Strecke gespeichert');
  assert.equal(s[1].route.poly, '_p~iF~ps|U');
  assert.equal(s[1].ascentM, 40);
  assert.equal(s[2].type, 'cross_bike');
  assert.ok(writes <= 4, `ein Schreibvorgang statt einer je Aktivität (waren ${writes})`);
});

test('„Strecke mitspeichern“ aus: Import ohne Linie, Höhenmeter und Werte bleiben', () => {
  store.setSetting('activityRoutes', false);
  const r = importActivities([{ act: { date: '2026-09-25', distanceKm: 12, durationSec: 4000, type: 'run', sportKnown: true, splits: [], route: { poly: '_p~iF~ps|U' }, ascentM: 40 } }], '2026-09-29');
  assert.equal(r.added, 1);
  const s = store.get('sessions').find((x) => x.date === '2026-09-25');
  assert.equal(s.route, null, 'keine Strecke gespeichert');
  assert.equal(s.ascentM, 40);
  const one = saveImportedActivity({ date: '2026-09-27', durationSec: 1800, distanceKm: 5, route: { poly: '_p~iF~ps|U' } }, 'run', { link: false });
  assert.equal(one.session.route, null, 'auch beim Einzelimport');
  store.setSetting('activityRoutes', true);
  const two = saveImportedActivity({ date: '2026-09-28', durationSec: 1800, distanceKm: 5, route: { poly: '_p~iF~ps|U' } }, 'run', { link: false });
  assert.equal(two.session.route.poly, '_p~iF~ps|U', 'eingeschaltet: Strecke dabei');
});
