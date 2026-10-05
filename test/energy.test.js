/* Unit tests for js/energy.js — basal metabolic rate, training expenditure, daily balance
   and kcal estimation. today is passed in -> date-independent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bmr, trainingKcal, energyBalance, estimateKcal, estimateNutrition, portionKcal } from '../js/energy.js';

const T = '2026-06-28';
const P = { weightKg: 68, heightCm: 170, birthYear: 1990 }; // age 36

test('bmr: Mifflin-St Jeor incl. sex offset', () => {
  // neutral: 10*68 + 6.25*170 - 5*36 - 78 = 1484.5 -> 1485 (when rounded up)
  assert.equal(bmr(P, T), 1485);
  assert.equal(bmr({ ...P, sex: 'm' }, T), 1568);   // -78 -> +5  (= +83)
  assert.equal(bmr({ ...P, sex: 'w' }, T), 1402);   // -78 -> -161 (= -83)
});

test('bmr: null when data is missing', () => {
  assert.equal(bmr({ weightKg: 68, heightCm: 170 }, T), null); // birthYear missing
  assert.equal(bmr({}, T), null);
});

test('trainingKcal: duration via MET, otherwise km, otherwise 0', () => {
  assert.equal(trainingKcal({ type: 'easy', durationSec: 3600 }, 70), 630); // 9*70*1h
  assert.equal(trainingKcal({ type: 'easy', distanceKm: 10 }, 68), 680);    // ~1 kcal/kg/km
  assert.equal(trainingKcal({ type: 'strength' }, 70), 0);                  // without duration/distance
});

test('energyBalance: null without a profile basis', () => {
  assert.equal(energyBalance({ profile: {}, today: T }), null);
});

test('energyBalance: balance + recommendation towards the target weight', () => {
  const profile = { ...P, targetWeightKg: 65 }; // 3 kg above target -> lose weight
  const sessions = [{ date: T, type: 'easy', distanceKm: 10 }]; // 680 kcal
  const r = energyBalance({ profile, sessions, diary: [], today: T });
  assert.equal(r.bmr, 1485);
  assert.equal(r.trainingOut, 680);
  assert.equal(r.tdeeBase, 2005);       // round(1485 * 1.35)
  assert.equal(r.out, 2685);            // 2005 + 680
  assert.equal(r.goal, 'abnehmen');
  assert.equal(r.delta, -400);
  assert.equal(r.status, 'unklar'); // no meal recorded
  assert.equal(r.hasIntake, false);
});

test('energyBalance: status passt/hoch depending on intake', () => {
  const profile = { ...P, targetWeightKg: 68 }; // hold
  const diary = [{ kcal: 0, date: T }]; // without kcal does not count
  const base = energyBalance({ profile, sessions: [], diary, today: T });
  assert.equal(base.goal, 'halten');
  assert.equal(base.hasIntake, false);

  // Intake close to the target corridor -> fits ('passt')
  const near = energyBalance({ profile, sessions: [], diary: [{ kcal: base.targetIntake, date: T }], today: T });
  assert.equal(near.status, 'passt');
  // clearly above -> high ('hoch')
  const over = energyBalance({ profile, sessions: [], diary: [{ kcal: base.targetIntake + 600, date: T }], today: T });
  assert.equal(over.status, 'hoch');
});

test('estimateKcal: roughly estimated from ingredients', () => {
  assert.equal(estimateKcal(['100 g Haferflocken']), 370); // curated: 370/100 g
  assert.equal(estimateKcal(['2 Eier']), 150);             // 2*75 per piece
  assert.equal(estimateKcal([]), null);
  assert.ok(estimateKcal(['Spinat']) > 0);                 // without amount -> flat rate
});

test('estimateNutrition: curated table delivers exact kcal + protein', () => {
  const r = estimateNutrition(['100 g Haferflocken']);
  assert.equal(r.kcal, 370);
  assert.equal(r.protein, 13);
});

test('estimateNutrition: several curated ingredients summed', () => {
  const r = estimateNutrition(['150 g Hähnchen', '80 g Reis']);
  assert.equal(r.kcal, 450);     // 1.10*150 + 3.50*80 = 445 -> rounded to 10
  assert.equal(r.protein, 40);   // 0.23*150 + 0.07*80 = 40.1
});

test('estimateNutrition: per-piece ingredients count kcal + protein', () => {
  const r = estimateNutrition(['2 Eier']);
  assert.equal(r.kcal, 150);
  assert.equal(r.protein, 14);   // 7 * 2
});

test('estimateNutrition: curated table takes precedence over Open Food Facts', () => {
  const r = estimateNutrition(['100 g Haferflocken'], () => ({ kcal100: 999, protein100: 99 }));
  assert.equal(r.kcal, 370);     // curated wins -> OFF ignored
  assert.equal(r.protein, 13);
});

test('estimateNutrition: for an unknown ingredient Open Food Facts counts (plausible)', () => {
  // "Wunderzeug" is in no table -> heuristic fallback 1.2/g; OFF 2.0/g is plausible.
  const r = estimateNutrition(['100 g Wunderzeug'], () => ({ kcal100: 200, protein100: 12 }));
  assert.equal(r.kcal, 200);
  assert.equal(r.protein, 12);
});

test('estimateNutrition: implausible OFF value is discarded (sanity gate)', () => {
  // OFF 0.4/g vs. heuristic fallback 1.2/g -> factor 0.33 -> discarded, heuristic wins.
  const r = estimateNutrition(['100 g Wunderzeug'], () => ({ kcal100: 40, protein100: 3 }));
  assert.equal(r.kcal, 120);
});

test('estimateNutrition: empty list -> null', () => {
  assert.equal(estimateNutrition([]), null);
  assert.equal(estimateNutrition(), null);
});

test('portionKcal: flat-rate sizes', () => {
  assert.equal(portionKcal('klein'), 350);
  assert.equal(portionKcal('restaurant'), 1000);
  assert.equal(portionKcal('unbekannt'), 550); // default medium
});

test('HEALTH-40: measured active energy (Apple) instead of estimate – gross with, net without everyday expenditure', () => {
  const s = { type: 'swim', durationSec: 3600, kcal: 500, source: 'apple-health' };
  assert.equal(trainingKcal(s, 70), 570, 'gross = active 500 + resting metabolism 70 kcal of the hour');
  assert.equal(trainingKcal(s, 70, { net: true }), 476, 'net = active − 0.35 MET-hours of everyday activity');
  assert.equal(trainingKcal({ ...s, source: 'health' }, 70), 570, 'also from the full import');
  // From a file (watch total unclear, active or total?) the estimate remains.
  assert.equal(trainingKcal({ ...s, source: 'gpx' }, 70), 560, 'swimming: 8 MET instead of the flat 6');
});

test('HEALTH-40: other sports with their own MET value instead of the flat 6', () => {
  const h = (type) => trainingKcal({ type, durationSec: 3600 }, 70);
  assert.equal(h('rowing'), 490);
  assert.equal(h('hike'), 420);
  assert.equal(h('tabletennis'), 280);
});
