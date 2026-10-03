/* Körperwerte: fettfreie Masse statt „Muskelmasse“ aus Apple Health (HEALTH-23) und
   HRV-Messart (HEALTH-29) – als Lese-Migration, ohne die gespeicherten Daten anzufassen. */
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

test('Apple „Lean Body Mass“ wird als fettfreie Masse gelesen, Waagen-Muskelmasse bleibt (HEALTH-23)', () => {
  const apple = migrateHealthRecord({ id: 'a', date: T, source: 'apple-health', muscleMass: 54.5, weight: 72 });
  assert.equal(apple.leanMass, 54.5);
  assert.equal(apple.muscleMass, undefined);
  const xml = migrateHealthRecord({ id: 'x', date: T, source: 'health', muscleMass: 53 });
  assert.equal(xml.leanMass, 53, 'auch aus dem Voll-Import');
  const scale = { id: 'm', date: T, source: 'manual', muscleMass: 28.1 };
  assert.equal(migrateHealthRecord(scale), scale, 'manuell erfasste Muskelmasse bleibt Muskelmasse');
});

test('Speicher liest umgedeutet, das Backup enthält die Rohdaten', () => {
  store.upsert('health', { id: 'h1', date: T, source: 'apple-health', muscleMass: 54.5, hrv: 44 });
  const read = store.get('health')[0];
  assert.equal(read.leanMass, 54.5);
  assert.equal(read.hrvMethod, 'sdnn');
  const dump = store.exportAll();
  assert.equal(dump.health[0].muscleMass, 54.5, 'Backup unverändert');
  assert.equal(dump.health[0].leanMass, undefined);
});

test('Energieverfügbarkeit nutzt die gemessene fettfreie Masse', () => {
  const health = [{ date: addDays(T, -2), weight: 70, leanMass: 58, source: 'manual' }];
  const lm = leanMassNow({ profile: {}, health, today: T });
  assert.equal(lm.ffm, 58);
  assert.equal(lm.measured, true);
  // Ohne gemessene FFM: aus Körperfett gerechnet.
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

test('HRV-Messart: Apple = SDNN, Vergleiche nur innerhalb einer Messart (HEALTH-29)', () => {
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

test('Bereitschaft: ein Gerätewechsel (SDNN → RMSSD) ist kein HRV-Sprung', () => {
  const health = [];
  for (let i = 10; i >= 2; i--) health.push({ date: addDays(T, -i), hrv: 40, hrvMethod: 'sdnn', restingHr: 52 });
  health.push({ date: addDays(T, -1), hrv: 75, hrvMethod: 'rmssd', restingHr: 52 });
  const r = readinessScore(health, T);
  assert.ok(!r.factors.includes('HRV gut'), 'RMSSD 75 wird nicht mit SDNN 40 verglichen');
});

test('HRV-Ziel zählt nur Werte seiner Messart', () => {
  const health = [
    { date: addDays(T, -10), hrv: 40, hrvMethod: 'sdnn' },
    { date: addDays(T, -1), hrv: 72, hrvMethod: 'rmssd' },
  ];
  const p = goalProgress({ metric: 'hrv', start: 38, target: 50, hrvMethod: 'sdnn' }, { health, today: T });
  assert.equal(p.current, 40);
  assert.equal(p.reached, false);
});

test('Voll-Import: fettfreie Masse und HRV-Messart übernommen, Herkunft eines manuellen Tags bleibt', () => {
  store.upsert('health', { id: 'h-m', date: '2026-09-01', weight: 70.1, muscleMass: 29, source: 'manual' });
  importResult({ health: [{ date: '2026-09-01', leanMass: 55, hrv: 44, hrvMethod: 'sdnn' }, { date: '2026-09-02', leanMass: 55.2 }], workouts: [] });
  const day = store.find('health', 'h-m');
  assert.equal(day.source, 'manual', 'nicht zum Import umetikettiert');
  assert.equal(day.muscleMass, 29, 'Waagenwert bleibt Muskelmasse');
  assert.equal(day.leanMass, 55);
  assert.equal(day.hrvMethod, 'sdnn');
  assert.equal(store.get('health').find((h) => h.date === '2026-09-02').leanMass, 55.2);
});

test('Demo-Geschichten passen zur Logik: Ferritin mit Projektion, Magnesium im Bereich (HEALTH-34)', () => {
  const d = buildDemo(T);
  const t = trend(d.self.labs, 'ferritin', { sex: 'w' });
  assert.ok(t && t.daysToLimit != null && t.limitSide === 'low', 'fallender Eisenspeicher mit Projektion');
  const rows = overview(d.self.labs, { sex: 'w', today: T });
  assert.equal(rows.find((r) => r.key === 'magnesium').assessment.status, 'gut');
  const rec = recommend({ labs: d.self.labs, profile: { sex: 'w', weightKg: 72 }, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'magnesium'), 'kein Magnesium-Vorschlag aus einem guten Wert');
  assert.ok(rec.items.some((i) => i.key === 'iron' && i.holdOnly), 'Eisen: „noch kein Präparat nötig“');
  assert.ok(d.self.health.every((h) => h.hrv == null || h.hrvMethod === 'rmssd'));
});

test('Von Hand eingetragene Muskelmasse an einem Apple-Tag zählt nicht als fettfreie Masse', () => {
  const rec = { id: 'a', date: T, source: 'apple-health', weight: 72, bodyFat: 24.7, muscleMass: 28.2, muscleMassManual: true };
  const read = migrateHealthRecord(rec);
  assert.equal(read.muscleMass, 28.2);
  assert.equal(read.leanMass, undefined);
  // Die Energieversorgung rechnet dann mit der FFM aus Gewicht und Körperfett – nicht mit 28,2 kg.
  const lm = leanMassNow({ profile: {}, health: [rec], today: T });
  assert.equal(lm.measured, undefined);
  assert.equal(lm.ffm, 54.2);
});

test('HEALTH-40: Energieversorgung nennt die Herkunft des Trainingsverbrauchs', () => {
  const health = [{ date: T, weight: 70, bodyFat: 20 }];
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 2600 }, { id: `day-${d}`, _kind: 'day', date: d, complete: true });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', durationSec: 3600, kcal: 600, source: 'apple-health' });
  }
  const ea = energyAvailability({ profile: { weightKg: 70 }, health, sessions, diary, today: T });
  assert.equal(ea.trainingSource, 'gemessen');
  assert.equal(ea.trainingAvg, 576, 'aktiv 600 − 0,35 × 70 kcal Alltag');
  sessions[0] = { ...sessions[0], source: 'manual' };
  assert.equal(energyAvailability({ profile: { weightKg: 70 }, health, sessions, diary, today: T }).trainingSource, 'teils');
});
