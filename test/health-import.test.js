/* Importing an Apple Health export (js/health-import.js importResult):
   large exports in a single write, supplementing instead of overwriting, and
   duplicate detection even for runs that were matched to a planned unit. */
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
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});
afterEach(() => { localStorage.setItem = realSetItem; localStorage.__setQuota(Infinity); });

test('FE-04: 1,500 days of body measurements are imported in a few writes', () => {
  const health = Array.from({ length: 1500 }, (_, i) => ({ date: addDays('2022-01-01', i), weight: 70 + (i % 10) / 10 }));
  let writes = 0;
  localStorage.setItem = function (k, v) { writes++; return realSetItem.call(this, k, v); };
  const r = importResult({ health, workouts: [] });
  localStorage.setItem = realSetItem;
  assert.equal(r.hImp, 1500);
  assert.equal(store.get('health').length, 1500, 'all days in the store');
  assert.ok(writes <= 4, `at most a handful of writes instead of one per day (were ${writes})`);
});

test('FE-04: existing days are only supplemented, own values are kept', () => {
  store.upsert('health', { id: 'h-1', date: '2026-09-01', weight: 70.1, source: 'manual' });
  const r = importResult({ health: [{ date: '2026-09-01', weight: 72, restingHr: 48 }, { date: '2026-09-02', weight: 70.3 }], workouts: [] });
  assert.equal(r.hImp, 2);
  const day = store.find('health', 'h-1');
  assert.equal(day.weight, 70.1, 'own value not overwritten');
  assert.equal(day.restingHr, 48, 'missing value supplemented');
  assert.equal(store.get('health').filter((h) => h.date === '2026-09-01').length, 1, 'no second entry for the day');
  assert.ok(store.get('health').some((h) => h.date === '2026-09-02'), 'new day created');
});

test('A run exported twice on a day with a planned unit counts only once', () => {
  store.upsert('plans', { id: 'p-1', eventId: null, units: [{ id: 'un-1', date: '2026-09-03', type: 'easy', title: 'Lockerer Lauf', status: 'geplant' }] });
  const run = { date: '2026-09-03', distanceKm: 8.02, durationSec: 2890 };
  const r = importResult({ health: [], workouts: [run, { ...run }] });
  assert.equal(r.matched, 1, 'the first run completes the planned unit');
  assert.equal(r.wSkip, 1, 'the duplicate is detected');
  assert.equal(store.get('sessions').filter((s) => s.date === '2026-09-03').length, 1, 'exactly one unit on the day');
});

test('FE-03/FE-04: device storage full – the import reports 0 instead of invented numbers', () => {
  localStorage.__setQuota(localStorage.__used() + 200);
  const health = Array.from({ length: 50 }, (_, i) => ({ date: addDays('2025-01-01', i), weight: 70 }));
  const r = importResult({ health, workouts: [] });
  localStorage.__setQuota(Infinity);
  assert.equal(r.hImp, 0, 'nothing imported');
  assert.equal(store.get('health').length, 0, 'store unchanged');
});

test('Full import: all sports with their type, cycle only on request and without duplicates', () => {
  store.upsert('cycle', { id: 'c-hand', startDate: '2026-08-02', periodLength: 5 });   // entered by hand
  const result = {
    health: [],
    workouts: [
      { date: '2026-09-12', type: 'cross_bike', title: 'Radtour (Health-Import)', distanceKm: 24, durationSec: 3600 },
      { date: '2026-09-13', distanceKm: 8, durationSec: 2700 },                 // older server: run without a type
    ],
    periods: [{ start: '2026-08-01', length: 4 }, { start: '2026-09-01', length: 5 }],
  };
  const without = importResult({ ...result, workouts: [] });
  assert.equal(without.pImp, 0, 'no cycle without consent');
  const r = importResult(result, { cycle: true });
  const types = store.get('sessions').map((s) => s.type).sort();
  assert.deepEqual(types, ['cross_bike', 'easy']);
  assert.equal(store.get('sessions').find((s) => s.type === 'cross_bike').title, 'Radtour (Health-Import)');
  assert.equal(r.pImp, 1, 'period on 1 Aug lies next to the entry of 2 Aug – only the September one is added');
  const sept = store.get('cycle').find((c) => c.startDate === '2026-09-01');
  assert.ok(sept && sept.periodLength === 5 && sept.source === 'health');
});

test('Bulk file import: duplicates dropped, a single write, routes only for more recent units', () => {
  const T = '2026-09-29';
  store.upsert('sessions', { id: 'had', date: '2026-09-20', type: 'run', distanceKm: 10, durationSec: 3000 });
  const act = (date, km, sec, extra = {}) => ({ act: { date, distanceKm: km, durationSec: sec, type: 'run', sportKnown: true, splits: [], route: { poly: '_p~iF~ps|U' }, ascentM: 40, ...extra } });
  let writes = 0;
  localStorage.setItem = function (k, v) { writes++; return realSetItem.call(this, k, v); };
  const r = importActivities([
    act('2026-01-10', 8, 2800),                         // old: no route
    act('2026-09-20', 10.1, 3020),                      // already present
    act('2026-09-25', 12, 4000),                        // new, with route
    act('2026-09-25', 12.1, 4030),                      // the same unit twice in the archive
    act('2026-09-26', 30, 3600, { type: 'run', sportKnown: false }),   // no sport type, 30 km/h → bike
  ], T);
  localStorage.setItem = realSetItem;
  assert.deepEqual(r, { added: 3, matched: 0, dup: 2 });
  const s = store.get('sessions').filter((x) => x.id !== 'had').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(s[0].route, null, 'older than 90 days: no route saved');
  assert.equal(s[1].route.poly, '_p~iF~ps|U');
  assert.equal(s[1].ascentM, 40);
  assert.equal(s[2].type, 'cross_bike');
  assert.ok(writes <= 4, `a single write instead of one per activity (were ${writes})`);
});

test('"Save the route too" off: import without the line, elevation gain and values are kept', () => {
  store.setSetting('activityRoutes', false);
  const r = importActivities([{ act: { date: '2026-09-25', distanceKm: 12, durationSec: 4000, type: 'run', sportKnown: true, splits: [], route: { poly: '_p~iF~ps|U' }, ascentM: 40 } }], '2026-09-29');
  assert.equal(r.added, 1);
  const s = store.get('sessions').find((x) => x.date === '2026-09-25');
  assert.equal(s.route, null, 'no route saved');
  assert.equal(s.ascentM, 40);
  const one = saveImportedActivity({ date: '2026-09-27', durationSec: 1800, distanceKm: 5, route: { poly: '_p~iF~ps|U' } }, 'run', { link: false });
  assert.equal(one.session.route, null, 'also for a single import');
  store.setSetting('activityRoutes', true);
  const two = saveImportedActivity({ date: '2026-09-28', durationSec: 1800, distanceKm: 5, route: { poly: '_p~iF~ps|U' } }, 'run', { link: false });
  assert.equal(two.session.route.poly, '_p~iF~ps|U', 'switched on: route included');
});
