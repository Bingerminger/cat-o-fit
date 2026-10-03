/* Ergänzungsregeln, Energieverfügbarkeit und Laborbewertung nach Paket C:
   Richtung je Regel, „nie ohne Befund“, keine Leistungspräparate für Kinder,
   Schwellen je Geschlecht, Abnehmbereich, Kinder- und Jugendprofil im Labor. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { assess, overview } from '../js/labs.js';
import { recommend, catalogFor, SUPPLEMENTS, DOPING_NOTE } from '../js/supplements.js';
import { energyAvailability, leanMassNow, EA_LOW, EA_LOW_MALE } from '../js/redflags.js';

const T = '2026-09-29';
const lab = (analyte, value, date = addDays(T, -10), extra = {}) => ({ id: `l-${analyte}-${value}`, analyte, value, date, ...extra });
const MINOR = { minor: true, noPerformanceSupplements: true, noWeightGoals: true, labsEvaluate: false };

/* ------------------------------ Richtung -------------------------------- */

test('assess: „side“ sagt, in welche Richtung ein Wert auffällt', () => {
  assert.equal(assess('ferritin', 10).side, 'low');
  assert.equal(assess('ferritin', 350).side, 'high');
  assert.equal(assess('ferritin', 250).side, 'high', 'über dem Sportkorridor');
  assert.equal(assess('ferritin', 100).side, null);
});

test('supplements: hohes Ferritin führt nie zu Eisen, sondern zum Prüfhinweis (HEALTH-01)', () => {
  const rec = recommend({ labs: [lab('ferritin', 350)], profile: { sex: 'w' }, today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron, 'Hinweis vorhanden');
  assert.equal(iron.holdOnly, true, 'kein „In meinen Plan“');
  assert.match(iron.action, /Kein Eisen/);
});

test('supplements: zu hohes Vitamin D oder Magnesium heißt „nicht ergänzen“', () => {
  const rec = recommend({ labs: [lab('vitaminD', 180), lab('b12', 200), lab('magnesium', 3.0)], profile: {}, today: T });
  for (const key of ['vitaminD', 'magnesium']) {
    const it = rec.items.find((i) => i.key === key);
    assert.ok(it, `${key} erwähnt`);
    assert.equal(it.holdOnly, true, `${key}: kein Einnahmevorschlag`);
    assert.match(it.action, /Nicht \(weiter\) ergänzen/);
  }
  // Holo-TC hat keine Obergrenze (LADR) – ein hoher Wert ist kein Befund.
  assert.ok(!rec.items.some((i) => i.key === 'b12'));
});

/* --------------------------- Nie ohne Befund ----------------------------- */

test('supplements: Magnesium nur mit Laborwert, nicht aus der Trainingslast (HEALTH-37)', () => {
  // Drei ruhige Wochen, dann eine harte Woche: Die akute Last liegt deutlich über dem Schnitt.
  const sessions = [];
  for (let i = 7; i < 28; i += 2) sessions.push({ id: `c${i}`, date: addDays(T, -i), type: 'easy', distanceKm: 6, durationSec: 2400, rpe: 4 });
  for (let i = 0; i < 7; i++) sessions.push({ id: `a${i}`, date: addDays(T, -i), type: 'tempo', distanceKm: 16, durationSec: 5400, rpe: 8 });
  const rec = recommend({ labs: [], profile: { weightKg: 70 }, sessions, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'magnesium'), 'kein Präparatehinweis ohne Befund');
  assert.ok(!rec.items.some((i) => /Krampf/.test(`${i.reason} ${i.action}`)));
  assert.ok(!rec.items.some((i) => i.key === 'protein'), 'Eiweiß nicht aus der Last');
});

test('supplements: Eiweiß aus dem Ess-Tagebuch statt aus der Trainingslast (HEALTH-37)', () => {
  const diaryLow = [], diaryOk = [];
  for (let i = 0; i < 7; i++) {
    diaryLow.push({ id: `a${i}`, date: addDays(T, -i), kcal: 1800, protein: 50 });
    diaryOk.push({ id: `b${i}`, date: addDays(T, -i), kcal: 2200, protein: 110 });
  }
  const low = recommend({ profile: { weightKg: 60 }, diary: diaryLow, today: T });
  assert.ok(low.items.some((i) => i.key === 'protein'), '0,8 g/kg liegt unter 1,2');
  const ok = recommend({ profile: { weightKg: 60 }, diary: diaryOk, today: T });
  assert.ok(!ok.items.some((i) => i.key === 'protein'));
});

test('supplements: Kreatin aus echten Krafteinheiten, nicht aus Zieltexten (HEALTH-36)', () => {
  const byText = recommend({ profile: { goals: ['Muskelmasse erhöhen', 'Kraft aufbauen'] }, sessions: [], today: T });
  assert.ok(!byText.items.some((i) => i.key === 'creatine'));
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push({ id: `k${i}`, date: addDays(T, -3 * i), type: 'strength', durationSec: 3600 });
  const byTraining = recommend({ profile: {}, sessions, today: T });
  const creatine = byTraining.items.find((i) => i.key === 'creatine');
  assert.ok(creatine);
  assert.equal(creatine.performance, true);
});

test('supplements: Eisen erscheint ohne Befund höchstens als Messhinweis (requiresLab, HEALTH-30)', () => {
  const rec = recommend({ labs: [], profile: { sex: 'w' }, cycle: [{ id: 'c', startDate: addDays(T, -12) }], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron, 'Zyklus: Hinweis, Ferritin messen zu lassen');
  assert.equal(iron.holdOnly, true);
  assert.equal(SUPPLEMENTS.iron.requiresLab, true);
  // „Noch kein Präparat nötig“ (fallender, aber guter Wert) ohne „In meinen Plan“.
  const falling = [lab('ferritin', 120, addDays(T, -150)), lab('ferritin', 90, addDays(T, -90)), lab('ferritin', 60, addDays(T, -10))];
  const trendRec = recommend({ labs: falling, profile: { sex: 'w' }, today: T }).items.find((i) => i.key === 'iron');
  assert.ok(trendRec, 'Trend-Hinweis vorhanden');
  assert.match(trendRec.action, /Noch kein Präparat nötig/);
  assert.equal(trendRec.holdOnly, true);
});

/* ---------------------- Kinder- und Jugendprofil ------------------------- */

test('supplements: keine Leistungspräparate für Minderjährige', () => {
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push({ id: `k${i}`, date: addDays(T, -3 * i), type: 'strength', durationSec: 3600 });
  const rec = recommend({ profile: {}, sessions, today: T, elig: MINOR });
  assert.ok(!rec.items.some((i) => SUPPLEMENTS[i.key].performance));
  const keys = catalogFor(MINOR);
  assert.ok(!keys.includes('creatine'));
  assert.ok(keys.includes('vitaminD'));
  assert.equal(catalogFor(null).length, Object.keys(SUPPLEMENTS).length);
});

test('supplements: Doping-Hinweis und Quelle im Katalog (HEALTH-38, HEALTH-17)', () => {
  assert.match(DOPING_NOTE, /Kölner Liste/);
  for (const [key, s] of Object.entries(SUPPLEMENTS)) assert.ok(s.source, `${key} ohne Quellenangabe`);
  // Mengen an den Obergrenzen ausgerichtet (Beispiele aus dem Befund).
  assert.match(SUPPLEMENTS.magnesium.typical, /250 mg/);
  assert.match(SUPPLEMENTS.vitaminD.typical, /800 IE/);
});

test('labs: Kinder- und Jugendprofil wird nur dokumentiert, nicht bewertet', () => {
  const labs = [lab('ferritin', 12), lab('vitaminD', 40)];
  const adult = overview(labs, { sex: 'w', today: T });
  assert.ok(adult.every((r) => r.assessment.status === 'niedrig'));
  const kid = overview(labs, { sex: 'w', today: T, evaluate: false });
  assert.equal(kid.length, 2);
  for (const r of kid) {
    assert.equal(r.assessment.status, 'unbewertet');
    assert.equal(r.assessment.ref, null, 'keine Erwachsenen-Referenz');
    assert.equal(r.trend, null);
  }
});

/* ------------------------ Energieverfügbarkeit --------------------------- */

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

test('Energieverfügbarkeit: Schwelle je Geschlecht (HEALTH-11)', () => {
  assert.equal(EA_LOW, 30);
  assert.equal(EA_LOW_MALE, 25);
  // Aufnahme so wählen, dass die EA zwischen 25 und 30 liegt.
  const w = energyAvailability(eaData({ kcal: 1850 }));
  assert.ok(w.ea > 25 && w.ea < 30, `EA ${w.ea}`);
  assert.equal(w.level, 'kritisch');
  const m = energyAvailability(eaData({ kcal: 1850, sex: 'm' }));
  assert.equal(m.level, 'niedrig', 'bei Männern liegt die Grenze niedriger');
});

test('Energieverfügbarkeit: gerundet mit Spanne; Abnehmbereich als eigener Hinweis (HEALTH-10)', () => {
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

test('Energieverfügbarkeit: fehlender Körperfettwert wird benannt statt still zu verschwinden (HEALTH-35)', () => {
  const lm = leanMassNow({ profile: { weightKg: 60 }, health: [{ date: T, weight: 60 }], today: T });
  assert.equal(lm.ffm, null);
  assert.equal(lm.missing, 'bodyFat');
  assert.equal(leanMassNow({ profile: {}, health: [], today: T }).missing, 'weight');
  // Körperfett älter als vier Monate zählt nicht mehr.
  const old = leanMassNow({ profile: {}, health: [{ date: addDays(T, -130), weight: 60, bodyFat: 20 }, { date: T, weight: 60 }], today: T });
  assert.equal(old.ffm, null);
});
