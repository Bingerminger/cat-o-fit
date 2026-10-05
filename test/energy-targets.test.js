/* Energy targets (js/energy.js): one goal definition, smoothed weight, lower limits
   when losing weight, protection of vulnerable groups, estimation aid with kitchen measures
   and a recipe catalogue whose values match its ingredients. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightNow, weightGoalStatus, energyBalance, energyTargets, estimateNutrition, bmr,
} from '../js/energy.js';
import { eligibilityFor } from '../js/eligibility.js';
import { SUGGESTED_MEALS } from '../js/nutrition.js';

const T = '2026-09-29';
const ADULT = { answered: true, minor: false, noWeightGoals: false };

test('weightNow: 7-day median instead of a single value, profile as fallback', () => {
  const h = [
    { date: '2026-09-20', weight: 70 }, { date: '2026-09-25', weight: 72.5 },
    { date: '2026-09-27', weight: 70.4 }, { date: '2026-09-28', weight: 70.6 },
  ];
  assert.equal(weightNow(h, {}, T), 70.6);            // window 22–28.09.: 70.4 · 70.6 · 72.5
  assert.equal(weightNow([], { weightKg: 68 }), 68);
  assert.equal(weightNow([{ date: 'kaputt', weight: 66 }], {}), 66, 'unreadable date: most recent value instead of NaN');
});

test('weightGoalStatus: one definition – hold ± 0.5 kg, direction from the starting weight', () => {
  let s = weightGoalStatus({ current: 65.3, target: 65, start: 70 });
  assert.equal(s.status, 'halten');
  assert.equal(s.reached, false);
  assert.equal(s.direction, 'down');
  // Just below the weight-loss target: reached and hold – never automatically "gain" (HEALTH-21).
  s = weightGoalStatus({ current: 64.6, target: 65, start: 70 });
  assert.equal(s.reached, true);
  assert.equal(s.status, 'halten');
  assert.equal(s.beyond, false);
  s = weightGoalStatus({ current: 63, target: 65, start: 70 });
  assert.equal(s.status, 'halten');
  assert.equal(s.beyond, true);
  // A genuine weight-gain goal.
  s = weightGoalStatus({ current: 55, target: 58, start: 55 });
  assert.equal(s.direction, 'up');
  assert.equal(s.status, 'zunehmen');
  assert.equal(s.remaining, 3);
  assert.equal(weightGoalStatus({ current: null, target: 60 }), null);
});

test('energyTargets: below the weight-loss target means hold, not "gain +300" (HEALTH-21)', () => {
  const profile = { weightKg: 64, targetWeightKg: 65, targetWeightStartKg: 70, heightCm: 170, birthYear: 1990, sex: 'w' };
  const t = energyTargets({ profile, health: [], today: T, elig: ADULT });
  assert.equal(t.goalStatus.reached, true);
  assert.equal(t.goal, 'halten');
  assert.equal(t.balance.goal, 'halten');
  assert.equal(t.balance.delta, 0);
});

test('energyBalance: daily target when losing weight never below training + 30 kcal per kg FFM (HEALTH-05)', () => {
  const profile = { weightKg: 60, targetWeightKg: 55, heightCm: 168, birthYear: 1996, sex: 'w' };
  const sessions = [{ date: T, type: 'easy', durationSec: 3600, distanceKm: 10 }];
  const withFfm = energyBalance({ profile, sessions, diary: [], today: T, ffm: 45 });
  const eaMin = withFfm.trainingGross + 30 * 45;
  assert.ok(withFfm.out - 400 < eaMin, 'precondition: the standard deficit would fall below the limit');
  assert.ok(withFfm.targetIntake >= eaMin - 5, `daily target ${withFfm.targetIntake} below ${eaMin}`);
  assert.equal(withFfm.floorReason, 'ea');
  assert.match(withFfm.hint, /30 kcal je kg fettfreier Masse/);

  // Without fat-free mass at most 15 % deficit.
  const noFfm = energyBalance({ profile, sessions, diary: [], today: T });
  assert.equal(noFfm.floorReason, 'share');
  assert.ok(-noFfm.delta <= Math.round(noFfm.out * 0.15) + 1, `deficit ${noFfm.delta} above 15 %`);
  assert.ok(noFfm.targetIntake >= noFfm.bmr, 'basal metabolic rate remains the lower limit');
});

test('energyTargets: target BMI below 18.5 → hold instead of deficit (HEALTH-08)', () => {
  const profile = { weightKg: 60, targetWeightKg: 48, heightCm: 170, birthYear: 1990, sex: 'w' };
  const t = energyTargets({ profile, health: [], today: T, elig: ADULT });
  assert.equal(t.block, 'bmi');
  assert.equal(t.goal, 'halten');
  assert.equal(t.balance.delta, 0);
});

test('energyTargets: child and youth profile without basal metabolic rate and without target (HEALTH-07)', () => {
  const profile = { weightKg: 28, targetWeightKg: 26, heightCm: 128, birthYear: 2019, sex: 'm' };
  const t = energyTargets({ profile, health: [], today: T, elig: eligibilityFor({ profile, settings: {}, today: T }) });
  assert.equal(t.block, 'minor');
  assert.equal(t.balance, null, 'no daily target from an adult formula');
  assert.equal(t.goal, 'halten');
});

test('energyTargets: pregnancy and eating disorder – no weight-loss target', () => {
  const profile = { weightKg: 70, targetWeightKg: 62, heightCm: 168, birthYear: 1992, sex: 'w' };
  for (const gate of [{ pregnancy: true }, { eatingDisorder: true }]) {
    const elig = eligibilityFor({ profile, settings: { labsGate: { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, ...gate } }, today: T });
    const t = energyTargets({ profile, health: [], today: T, elig });
    assert.equal(t.block, 'eligibility');
    assert.equal(t.goal, 'halten');
    assert.ok(t.balance.delta >= 0);
  }
});

test('energyTargets: nutrition and cockpit calculate with the smoothed weight (HEALTH-20)', () => {
  const profile = { weightKg: 75, targetWeightKg: 65, heightCm: 170, birthYear: 1990, sex: 'w' };
  const health = [
    { date: '2026-09-24', weight: 70 }, { date: '2026-09-25', weight: 70.2 },
    { date: '2026-09-26', weight: 69.8 }, { date: '2026-09-28', weight: 72 },   // outlier after eating
  ];
  const t = energyTargets({ profile, health, today: T, elig: ADULT });
  assert.equal(t.weightNow, 70.1);
  assert.equal(t.balance.bmr, bmr({ ...profile, weightKg: 70.1 }, T));
  assert.equal(t.goalStatus.status, 'abnehmen');
});

test('estimateNutrition: kitchen measures instead of a 45 kcal flat rate, "Ei" only as a whole word (HEALTH-27)', () => {
  const est = (x) => estimateNutrition([x]);
  assert.equal(est('1 EL Öl').kcal, 90);
  assert.equal(est('2 Scheiben Vollkornbrot').kcal, 210);
  assert.equal(est('2 Scheiben Knäckebrot').kcal, 70);
  assert.equal(est('1 Dose Kichererbsen').kcal, 310);
  assert.equal(est('1 Prise Meersalz').kcal, 0);
  assert.equal(est('1 TL Honig').kcal, 20);
  assert.equal(est('50 g Grieß').kcal, 180);
  const reiswaffeln = est('2 Reiswaffeln');
  assert.equal(reiswaffeln.kcal, 60, 'rice cakes are not eggs');
  assert.ok(reiswaffeln.protein <= 2);
  assert.ok(est('1 Pizzateig').kcal > 500, 'pizza dough is not an egg');
  assert.equal(est('3 Eier').protein, 21, 'real eggs still count as eggs');
});

test('Recipe catalogue: nutrition values match the ingredients (± 15 %, HEALTH-22)', () => {
  assert.ok(SUGGESTED_MEALS.length >= 40);
  for (const m of SUGGESTED_MEALS) {
    const e = estimateNutrition(m.ingredients);
    assert.ok(Math.abs(m.kcal - e.kcal) <= e.kcal * 0.15, `${m.title}: ${m.kcal} kcal, from the ingredients ${e.kcal}`);
    if (e.protein != null) {
      assert.ok(Math.abs(m.protein - e.protein) <= Math.max(3, e.protein * 0.15), `${m.title}: ${m.protein} g protein, from the ingredients ${e.protein}`);
    }
  }
});
