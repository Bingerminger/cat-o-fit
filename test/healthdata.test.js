/* Body measurements: lean mass instead of "muscle mass" from Apple Health (HEALTH-23) and
   HRV measurement method (HEALTH-29) – as a read-time migration, without touching the stored data. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';
import { migrateHealthRecord, hrvMethodOf, currentHrvMethod, withHrvMethod, hrvLabel } from '../js/healthdata.js';
import { leanMassNow, energyAvailability } from '../js/redflags.js';
import { readinessScore } from '../js/adaptive.js';
import { goalProgress } from '../js/goals.js';
import { importResult } from '../js/health-import.js';
import { buildDemo } from '../js/demo.js';
import { overview, trend } from '../js/labs.js';
import { recommend } from '../js/supplements.js';

const T = '2026-09-29';

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('Apple "Lean Body Mass" is read as lean mass, scale muscle mass is kept (HEALTH-23)', () => {
  const apple = migrateHealthRecord({ id: 'a', date: T, source: 'apple-health', muscleMass: 54.5, weight: 72 });
  assert.equal(apple.leanMass, 54.5);
  assert.equal(apple.muscleMass, undefined);
  const xml = migrateHealthRecord({ id: 'x', date: T, source: 'health', muscleMass: 53 });
  assert.equal(xml.leanMass, 53, 'also from the full import');
  const scale = { id: 'm', date: T, source: 'manual', muscleMass: 28.1 };
  assert.equal(migrateHealthRecord(scale), scale, 'manually entered muscle mass stays muscle mass');
});

test('The store reads reinterpreted values, the backup contains the raw data', () => {
  store.upsert('health', { id: 'h1', date: T, source: 'apple-health', muscleMass: 54.5, hrv: 44 });
  const read = store.get('health')[0];
  assert.equal(read.leanMass, 54.5);
  assert.equal(read.hrvMethod, 'sdnn');
  const dump = store.exportAll();
  assert.equal(dump.health[0].muscleMass, 54.5, 'backup unchanged');
  assert.equal(dump.health[0].leanMass, undefined);
});

test('Energy availability uses the measured lean mass', () => {
  const health = [{ date: addDays(T, -2), weight: 70, leanMass: 58, source: 'manual' }];
  const lm = leanMassNow({ profile: {}, health, today: T });
  assert.equal(lm.ffm, 58);
  assert.equal(lm.measured, true);
  // Without a measured FFM: calculated from body fat.
  assert.equal(leanMassNow({ profile: {}, health: [{ date: T, weight: 70, bodyFat: 20 }], today: T }).ffm, 56);
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 2400 }, { id: `day-${d}`, _kind: 'day', date: d, complete: true });
  }
  const ea = energyAvailability({ profile: { weightKg: 70 }, health, sessions, diary, today: T });
  assert.equal(ea.ffm, 58);
  assert.equal(ea.ffmMeasured, true);
});

test('HRV measurement method: Apple = SDNN, comparisons only within one method (HEALTH-29)', () => {
  assert.equal(hrvMethodOf({ hrv: 50, source: 'apple-health' }), 'sdnn');
  assert.equal(hrvMethodOf({ hrv: 50, hrvMethod: 'rmssd' }), 'rmssd');
  assert.equal(hrvMethodOf({ hrv: 50, source: 'manual' }), 'unbekannt');
  const health = [
    { date: addDays(T, -3), hrv: 40, hrvMethod: 'sdnn' },
    { date: addDays(T, -1), hrv: 70, hrvMethod: 'rmssd' },
  ];
  assert.equal(currentHrvMethod(health), 'rmssd');
  assert.deepEqual(withHrvMethod(health, 'rmssd').filter((h) => h.hrv != null).map((h) => h.hrv), [70]);
  assert.equal(hrvLabel('sdnn'), 'HRV (SDNN)');
});

test('Readiness: a device change (SDNN → RMSSD) is not an HRV jump', () => {
  const health = [];
  for (let i = 10; i >= 2; i--) health.push({ date: addDays(T, -i), hrv: 40, hrvMethod: 'sdnn', restingHr: 52 });
  health.push({ date: addDays(T, -1), hrv: 75, hrvMethod: 'rmssd', restingHr: 52 });
  const r = readinessScore(health, T);
  assert.ok(!r.factors.includes('HRV gut'), 'RMSSD 75 is not compared with SDNN 40');
});

test('An HRV goal counts only values of its own measurement method', () => {
  const health = [
    { date: addDays(T, -10), hrv: 40, hrvMethod: 'sdnn' },
    { date: addDays(T, -1), hrv: 72, hrvMethod: 'rmssd' },
  ];
  const p = goalProgress({ metric: 'hrv', start: 38, target: 50, hrvMethod: 'sdnn' }, { health, today: T });
  assert.equal(p.current, 40);
  assert.equal(p.reached, false);
});

test('Full import: lean mass and HRV method imported, source of a manual day is kept', () => {
  store.upsert('health', { id: 'h-m', date: '2026-09-01', weight: 70.1, muscleMass: 29, source: 'manual' });
  importResult({ health: [{ date: '2026-09-01', leanMass: 55, hrv: 44, hrvMethod: 'sdnn' }, { date: '2026-09-02', leanMass: 55.2 }], workouts: [] });
  const day = store.find('health', 'h-m');
  assert.equal(day.source, 'manual', 'not relabelled as import');
  assert.equal(day.muscleMass, 29, 'scale value stays muscle mass');
  assert.equal(day.leanMass, 55);
  assert.equal(day.hrvMethod, 'sdnn');
  assert.equal(store.get('health').find((h) => h.date === '2026-09-02').leanMass, 55.2);
});

test('Demo stories match the logic: ferritin with projection, magnesium in range (HEALTH-34)', () => {
  const d = buildDemo(T);
  const t = trend(d.self.labs, 'ferritin', { sex: 'w' });
  assert.ok(t && t.daysToLimit != null && t.limitSide === 'low', 'falling iron stores with projection');
  const rows = overview(d.self.labs, { sex: 'w', today: T });
  assert.equal(rows.find((r) => r.key === 'magnesium').assessment.status, 'gut');
  const rec = recommend({ labs: d.self.labs, profile: { sex: 'w', weightKg: 72 }, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'magnesium'), 'no magnesium suggestion from a good value');
  assert.ok(rec.items.some((i) => i.key === 'iron' && i.holdOnly), 'iron: "no supplement needed yet"');
  assert.ok(d.self.health.every((h) => h.hrv == null || h.hrvMethod === 'rmssd'));
});

test('Muscle mass entered by hand on an Apple day does not count as lean mass', () => {
  const rec = { id: 'a', date: T, source: 'apple-health', weight: 72, bodyFat: 24.7, muscleMass: 28.2, muscleMassManual: true };
  const read = migrateHealthRecord(rec);
  assert.equal(read.muscleMass, 28.2);
  assert.equal(read.leanMass, undefined);
  // Energy availability then uses the FFM derived from weight and body fat – not 28.2 kg.
  const lm = leanMassNow({ profile: {}, health: [rec], today: T });
  assert.equal(lm.measured, undefined);
  assert.equal(lm.ffm, 54.2);
});

test('HEALTH-40: energy availability names the source of the training expenditure', () => {
  const health = [{ date: T, weight: 70, bodyFat: 20 }];
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 2600 }, { id: `day-${d}`, _kind: 'day', date: d, complete: true });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', durationSec: 3600, kcal: 600, source: 'apple-health' });
  }
  const ea = energyAvailability({ profile: { weightKg: 70 }, health, sessions, diary, today: T });
  assert.equal(ea.trainingSource, 'gemessen');
  assert.equal(ea.trainingAvg, 576, 'active 600 − 0.35 × 70 kcal everyday activity');
  sessions[0] = { ...sessions[0], source: 'manual' };
  assert.equal(energyAvailability({ profile: { weightKg: 70 }, health, sessions, diary, today: T }).trainingSource, 'teils');
});
