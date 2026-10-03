/* Energieziele (js/energy.js): eine Zieldefinition, geglättetes Gewicht, Untergrenzen
   beim Abnehmen, Schutz verletzlicher Gruppen, Schätzhilfe mit Küchenmaßen und ein
   Rezeptkatalog, dessen Werte zu seinen Zutaten passen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightNow, weightGoalStatus, energyBalance, energyTargets, estimateNutrition, bmr,
} from '../js/energy.js';
import { eligibilityFor } from '../js/eligibility.js';
import { SUGGESTED_MEALS } from '../js/nutrition.js';

const T = '2026-09-29';
const ADULT = { answered: true, minor: false, noWeightGoals: false };

test('weightNow: 7-Tage-Median statt Einzelwert, Profil als Rückfall', () => {
  const h = [
    { date: '2026-09-20', weight: 70 }, { date: '2026-09-25', weight: 72.5 },
    { date: '2026-09-27', weight: 70.4 }, { date: '2026-09-28', weight: 70.6 },
  ];
  assert.equal(weightNow(h, {}, T), 70.6);            // Fenster 22.–28.09.: 70,4 · 70,6 · 72,5
  assert.equal(weightNow([], { weightKg: 68 }), 68);
  assert.equal(weightNow([{ date: 'kaputt', weight: 66 }], {}), 66, 'unlesbares Datum: jüngster Wert statt NaN');
});

test('weightGoalStatus: eine Definition – ± 0,5 kg halten, Richtung vom Startgewicht', () => {
  let s = weightGoalStatus({ current: 65.3, target: 65, start: 70 });
  assert.equal(s.status, 'halten');
  assert.equal(s.reached, false);
  assert.equal(s.direction, 'down');
  // Knapp unter dem Abnehmziel: erreicht und halten – nie automatisch „zunehmen“ (HEALTH-21).
  s = weightGoalStatus({ current: 64.6, target: 65, start: 70 });
  assert.equal(s.reached, true);
  assert.equal(s.status, 'halten');
  assert.equal(s.beyond, false);
  s = weightGoalStatus({ current: 63, target: 65, start: 70 });
  assert.equal(s.status, 'halten');
  assert.equal(s.beyond, true);
  // Echtes Zunahmeziel.
  s = weightGoalStatus({ current: 55, target: 58, start: 55 });
  assert.equal(s.direction, 'up');
  assert.equal(s.status, 'zunehmen');
  assert.equal(s.remaining, 3);
  assert.equal(weightGoalStatus({ current: null, target: 60 }), null);
});

test('energyTargets: unter dem Abnehmziel heißt halten, nicht „zunehmen +300“ (HEALTH-21)', () => {
  const profile = { weightKg: 64, targetWeightKg: 65, targetWeightStartKg: 70, heightCm: 170, birthYear: 1990, sex: 'w' };
  const t = energyTargets({ profile, health: [], today: T, elig: ADULT });
  assert.equal(t.goalStatus.reached, true);
  assert.equal(t.goal, 'halten');
  assert.equal(t.balance.goal, 'halten');
  assert.equal(t.balance.delta, 0);
});

test('energyBalance: Tagesziel beim Abnehmen nie unter Training + 30 kcal je kg FFM (HEALTH-05)', () => {
  const profile = { weightKg: 60, targetWeightKg: 55, heightCm: 168, birthYear: 1996, sex: 'w' };
  const sessions = [{ date: T, type: 'easy', durationSec: 3600, distanceKm: 10 }];
  const withFfm = energyBalance({ profile, sessions, diary: [], today: T, ffm: 45 });
  const eaMin = withFfm.trainingGross + 30 * 45;
  assert.ok(withFfm.out - 400 < eaMin, 'Vorbedingung: das Standarddefizit läge unter der Grenze');
  assert.ok(withFfm.targetIntake >= eaMin - 5, `Tagesziel ${withFfm.targetIntake} unter ${eaMin}`);
  assert.equal(withFfm.floorReason, 'ea');
  assert.match(withFfm.hint, /30 kcal je kg fettfreier Masse/);

  // Ohne fettfreie Masse höchstens 15 % Defizit.
  const noFfm = energyBalance({ profile, sessions, diary: [], today: T });
  assert.equal(noFfm.floorReason, 'share');
  assert.ok(-noFfm.delta <= Math.round(noFfm.out * 0.15) + 1, `Defizit ${noFfm.delta} über 15 %`);
  assert.ok(noFfm.targetIntake >= noFfm.bmr, 'Grundumsatz bleibt Untergrenze');
});

test('energyTargets: Ziel-BMI unter 18,5 → halten statt Defizit (HEALTH-08)', () => {
  const profile = { weightKg: 60, targetWeightKg: 48, heightCm: 170, birthYear: 1990, sex: 'w' };
  const t = energyTargets({ profile, health: [], today: T, elig: ADULT });
  assert.equal(t.block, 'bmi');
  assert.equal(t.goal, 'halten');
  assert.equal(t.balance.delta, 0);
});

test('energyTargets: Kinder- und Jugendprofil ohne Grundumsatz und ohne Ziel (HEALTH-07)', () => {
  const profile = { weightKg: 28, targetWeightKg: 26, heightCm: 128, birthYear: 2019, sex: 'm' };
  const t = energyTargets({ profile, health: [], today: T, elig: eligibilityFor({ profile, settings: {}, today: T }) });
  assert.equal(t.block, 'minor');
  assert.equal(t.balance, null, 'kein Tagesziel aus einer Erwachsenenformel');
  assert.equal(t.goal, 'halten');
});

test('energyTargets: Schwangerschaft und Essstörung – kein Abnehmziel', () => {
  const profile = { weightKg: 70, targetWeightKg: 62, heightCm: 168, birthYear: 1992, sex: 'w' };
  for (const gate of [{ pregnancy: true }, { eatingDisorder: true }]) {
    const elig = eligibilityFor({ profile, settings: { labsGate: { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, ...gate } }, today: T });
    const t = energyTargets({ profile, health: [], today: T, elig });
    assert.equal(t.block, 'eligibility');
    assert.equal(t.goal, 'halten');
    assert.ok(t.balance.delta >= 0);
  }
});

test('energyTargets: Ernährung und Cockpit rechnen mit dem geglätteten Gewicht (HEALTH-20)', () => {
  const profile = { weightKg: 75, targetWeightKg: 65, heightCm: 170, birthYear: 1990, sex: 'w' };
  const health = [
    { date: '2026-09-24', weight: 70 }, { date: '2026-09-25', weight: 70.2 },
    { date: '2026-09-26', weight: 69.8 }, { date: '2026-09-28', weight: 72 },   // Ausreißer nach dem Essen
  ];
  const t = energyTargets({ profile, health, today: T, elig: ADULT });
  assert.equal(t.weightNow, 70.1);
  assert.equal(t.balance.bmr, bmr({ ...profile, weightKg: 70.1 }, T));
  assert.equal(t.goalStatus.status, 'abnehmen');
});

test('estimateNutrition: Küchenmaße statt 45-kcal-Pauschale, „Ei“ nur als ganzes Wort (HEALTH-27)', () => {
  const est = (x) => estimateNutrition([x]);
  assert.equal(est('1 EL Öl').kcal, 90);
  assert.equal(est('2 Scheiben Vollkornbrot').kcal, 210);
  assert.equal(est('2 Scheiben Knäckebrot').kcal, 70);
  assert.equal(est('1 Dose Kichererbsen').kcal, 310);
  assert.equal(est('1 Prise Meersalz').kcal, 0);
  assert.equal(est('1 TL Honig').kcal, 20);
  assert.equal(est('50 g Grieß').kcal, 180);
  const reiswaffeln = est('2 Reiswaffeln');
  assert.equal(reiswaffeln.kcal, 60, 'Reiswaffeln sind keine Eier');
  assert.ok(reiswaffeln.protein <= 2);
  assert.ok(est('1 Pizzateig').kcal > 500, 'Pizzateig ist kein Ei');
  assert.equal(est('3 Eier').protein, 21, 'echte Eier zählen weiter als Eier');
});

test('Rezeptkatalog: Nährwerte passen zu den Zutaten (± 15 %, HEALTH-22)', () => {
  assert.ok(SUGGESTED_MEALS.length >= 40);
  for (const m of SUGGESTED_MEALS) {
    const e = estimateNutrition(m.ingredients);
    assert.ok(Math.abs(m.kcal - e.kcal) <= e.kcal * 0.15, `${m.title}: ${m.kcal} kcal, aus den Zutaten ${e.kcal}`);
    if (e.protein != null) {
      assert.ok(Math.abs(m.protein - e.protein) <= Math.max(3, e.protein * 0.15), `${m.title}: ${m.protein} g Eiweiß, aus den Zutaten ${e.protein}`);
    }
  }
});
