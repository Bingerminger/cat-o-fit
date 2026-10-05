/* Supplement rules, energy availability and lab assessment after package C:
   direction per rule, "never without a finding", no performance supplements for children,
   thresholds per sex, weight-loss band, child and adolescent profile in the labs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { assess, overview } from '../js/labs.js';
import { recommend, catalogFor, SUPPLEMENTS, dopingNote } from '../js/supplements.js';
import { energyAvailability, leanMassNow, EA_LOW, EA_LOW_MALE } from '../js/redflags.js';

const T = '2026-09-29';
const lab = (analyte, value, date = addDays(T, -10), extra = {}) => ({ id: `l-${analyte}-${value}`, analyte, value, date, ...extra });
const MINOR = { minor: true, noPerformanceSupplements: true, noWeightGoals: true, labsEvaluate: false };

/* ------------------------------ Direction ------------------------------- */

test('assess: "side" says in which direction a value is out of range', () => {
  assert.equal(assess('ferritin', 10).side, 'low');
  assert.equal(assess('ferritin', 350).side, 'high');
  assert.equal(assess('ferritin', 250).side, 'high', 'above the sports corridor');
  assert.equal(assess('ferritin', 100).side, null);
});

test('supplements: high ferritin never leads to iron, but to a check note (HEALTH-01)', () => {
  const rec = recommend({ labs: [lab('ferritin', 350)], profile: { sex: 'w' }, today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron, 'note present');
  assert.equal(iron.holdOnly, true, 'no "Add to my plan"');
  assert.match(iron.action, /Kein Eisen/);
});

test('supplements: too high vitamin D or magnesium means "do not supplement"', () => {
  const rec = recommend({ labs: [lab('vitaminD', 180), lab('b12', 200), lab('magnesium', 3.0)], profile: {}, today: T });
  for (const key of ['vitaminD', 'magnesium']) {
    const it = rec.items.find((i) => i.key === key);
    assert.ok(it, `${key} mentioned`);
    assert.equal(it.holdOnly, true, `${key}: no intake suggestion`);
    assert.match(it.action, /Nicht \(weiter\) ergänzen/);
  }
  // Holo-TC has no upper limit (LADR) – a high value is not a finding.
  assert.ok(!rec.items.some((i) => i.key === 'b12'));
});

/* --------------------------- Never without a finding ----------------------------- */

test('supplements: magnesium only with a lab value, not from training load (HEALTH-37)', () => {
  // Three calm weeks, then one hard week: the acute load is well above the average.
  const sessions = [];
  for (let i = 7; i < 28; i += 2) sessions.push({ id: `c${i}`, date: addDays(T, -i), type: 'easy', distanceKm: 6, durationSec: 2400, rpe: 4 });
  for (let i = 0; i < 7; i++) sessions.push({ id: `a${i}`, date: addDays(T, -i), type: 'tempo', distanceKm: 16, durationSec: 5400, rpe: 8 });
  const rec = recommend({ labs: [], profile: { weightKg: 70 }, sessions, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'magnesium'), 'no supplement note without a finding');
  assert.ok(!rec.items.some((i) => /Krampf/.test(`${i.reason} ${i.action}`)));
  assert.ok(!rec.items.some((i) => i.key === 'protein'), 'protein not from the load');
});

test('supplements: protein from the food diary instead of from training load (HEALTH-37)', () => {
  const diaryLow = [], diaryOk = [];
  for (let i = 0; i < 7; i++) {
    diaryLow.push({ id: `a${i}`, date: addDays(T, -i), kcal: 1800, protein: 50 });
    diaryOk.push({ id: `b${i}`, date: addDays(T, -i), kcal: 2200, protein: 110 });
  }
  const low = recommend({ profile: { weightKg: 60 }, diary: diaryLow, today: T });
  assert.ok(low.items.some((i) => i.key === 'protein'), '0.8 g/kg is below 1.2');
  const ok = recommend({ profile: { weightKg: 60 }, diary: diaryOk, today: T });
  assert.ok(!ok.items.some((i) => i.key === 'protein'));
});

test('supplements: creatine from real strength sessions, not from goal texts (HEALTH-36)', () => {
  const byText = recommend({ profile: { goals: ['Muskelmasse erhöhen', 'Kraft aufbauen'] }, sessions: [], today: T });
  assert.ok(!byText.items.some((i) => i.key === 'creatine'));
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push({ id: `k${i}`, date: addDays(T, -3 * i), type: 'strength', durationSec: 3600 });
  const byTraining = recommend({ profile: {}, sessions, today: T });
  const creatine = byTraining.items.find((i) => i.key === 'creatine');
  assert.ok(creatine);
  assert.equal(creatine.performance, true);
});

test('supplements: without a finding, iron appears at most as a measurement note (requiresLab, HEALTH-30)', () => {
  const rec = recommend({ labs: [], profile: { sex: 'w' }, cycle: [{ id: 'c', startDate: addDays(T, -12) }], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron, 'cycle: note to have ferritin measured');
  assert.equal(iron.holdOnly, true);
  assert.equal(SUPPLEMENTS.iron.requiresLab, true);
  // "No supplement needed yet" (falling, but good value) without "Add to my plan".
  const falling = [lab('ferritin', 120, addDays(T, -150)), lab('ferritin', 90, addDays(T, -90)), lab('ferritin', 60, addDays(T, -10))];
  const trendRec = recommend({ labs: falling, profile: { sex: 'w' }, today: T }).items.find((i) => i.key === 'iron');
  assert.ok(trendRec, 'trend note present');
  assert.match(trendRec.action, /Noch kein Präparat nötig/);
  assert.equal(trendRec.holdOnly, true);
});

/* ---------------------- Child and adolescent profile ------------------------- */

test('supplements: no performance supplements for minors', () => {
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push({ id: `k${i}`, date: addDays(T, -3 * i), type: 'strength', durationSec: 3600 });
  const rec = recommend({ profile: {}, sessions, today: T, elig: MINOR });
  assert.ok(!rec.items.some((i) => SUPPLEMENTS[i.key].performance));
  const keys = catalogFor(MINOR);
  assert.ok(!keys.includes('creatine'));
  assert.ok(keys.includes('vitaminD'));
  assert.equal(catalogFor(null).length, Object.keys(SUPPLEMENTS).length);
});

test('supplements: doping note and source in the catalogue (HEALTH-38, HEALTH-17)', () => {
  assert.match(dopingNote(), /Kölner Liste/);
  for (const [key, s] of Object.entries(SUPPLEMENTS)) assert.ok(s.source, `${key} without a source reference`);
  // Amounts aligned with the upper limits (examples from the review finding).
  assert.match(SUPPLEMENTS.magnesium.typical, /250 mg/);
  assert.match(SUPPLEMENTS.vitaminD.typical, /800 IE/);
});

test('labs: child and adolescent profile is only documented, not assessed', () => {
  const labs = [lab('ferritin', 12), lab('vitaminD', 40)];
  const adult = overview(labs, { sex: 'w', today: T });
  assert.ok(adult.every((r) => r.assessment.status === 'niedrig'));
  const kid = overview(labs, { sex: 'w', today: T, evaluate: false });
  assert.equal(kid.length, 2);
  for (const r of kid) {
    assert.equal(r.assessment.status, 'unbewertet');
    assert.equal(r.assessment.ref, null, 'no adult reference');
    assert.equal(r.trend, null);
  }
});

/* ------------------------ Energy availability --------------------------- */

function eaData({ kcal, sex = 'w', days = 7, confirm = true }) {
  const profile = { weightKg: 60, sex, activityFactor: 1.35 };
  const health = [{ id: 'h1', date: addDays(T, -3), weight: 60, bodyFat: 20 }];   // FFM 48 kg
  const diary = [], sessions = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal });
    if (confirm) diary.push({ id: `day-${d}`, _kind: 'day', date: d, complete: true });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 10, durationSec: 3600 });
  }
  return { profile, health, sessions, diary, today: T };
}

test('Energy availability: threshold per sex (HEALTH-11)', () => {
  assert.equal(EA_LOW, 30);
  assert.equal(EA_LOW_MALE, 25);
  // Choose the intake so that the EA lies between 25 and 30.
  const w = energyAvailability(eaData({ kcal: 1850 }));
  assert.ok(w.ea > 25 && w.ea < 30, `EA ${w.ea}`);
  assert.equal(w.level, 'kritisch');
  const m = energyAvailability(eaData({ kcal: 1850, sex: 'm' }));
  assert.equal(m.level, 'niedrig', 'for men the limit is lower');
});

test('Energy availability: rounded with a range; weight-loss band as a separate note (HEALTH-10)', () => {
  const args = eaData({ kcal: 2300 });
  const ea = energyAvailability(args);
  assert.ok(ea.ea >= 30 && ea.ea < 45, `EA ${ea.ea}`);
  assert.equal(ea.eaRounded, Math.round(ea.ea));
  assert.deepEqual(ea.range, [Math.round(ea.ea * 0.85), Math.round(ea.ea * 1.15)]);
  assert.equal(ea.lossBand, false);
  assert.match(ea.hint, /mehr essen/);
  const loss = energyAvailability({ ...args, lossGoal: true });
  assert.equal(loss.level, 'niedrig');
  assert.equal(loss.lossBand, true);
  assert.match(loss.hint, /beim Abnehmen vorübergehend vertretbar/);
});

test('Energy availability: a missing body fat value is named instead of silently disappearing (HEALTH-35)', () => {
  const lm = leanMassNow({ profile: { weightKg: 60 }, health: [{ date: T, weight: 60 }], today: T });
  assert.equal(lm.ffm, null);
  assert.equal(lm.missing, 'bodyFat');
  assert.equal(leanMassNow({ profile: {}, health: [], today: T }).missing, 'weight');
  // Body fat older than four months no longer counts.
  const old = leanMassNow({ profile: {}, health: [{ date: addDays(T, -130), weight: 60, bodyFat: 20 }, { date: T, weight: 60 }], today: T });
  assert.equal(old.ffm, null);
});
