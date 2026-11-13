/* Health figures at their edges (4.2): energy of a session with only a distance, a lab value on its
   shown limit, the BMI protective limit, the year of birth, the Hb limit of the named source, trends
   within natural variation, CRP from another day, the children's weekly goal, the protein hint. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingKcal, energyTargets } from '../js/energy.js';
import { assess, trend } from '../js/labs.js';
import { eligibilityFor } from '../js/eligibility.js';
import { weeklyGoals } from '../js/healthgoals.js';
import { recommend } from '../js/supplements.js';
import { addDays } from '../js/ui.js';

const TODAY = '2026-11-07';

test('energy: only a distance, not a run – the sport\'s MET over the duration the load assumes', () => {
  // 60 km by bike at 2.5 min/km = 150 min × MET of cycling – not 60 × 70 kcal as if running.
  const bike = trainingKcal({ type: 'cross_bike', distanceKm: 60 }, 70);
  const timed = trainingKcal({ type: 'cross_bike', durationSec: 150 * 60 }, 70);
  assert.equal(bike, timed);
  assert.ok(bike < 2000, `${bike}`);
  // Swimming 2 km (25 min/km) – no longer 140 kcal.
  assert.equal(trainingKcal({ type: 'swim', distanceKm: 2 }, 70), trainingKcal({ type: 'swim', durationSec: 50 * 60 }, 70));
  // Running stays ~1 kcal/kg/km.
  assert.equal(trainingKcal({ type: 'easy', distanceKm: 10 }, 70), 700);
});

test('labs: a value on the shown limit lies within it, in every unit', () => {
  const vitd = (ngml) => assess('vitaminD', ngml * 2.496, { record: { analyte: 'vitaminD', value: ngml * 2.496, date: TODAY } });
  assert.equal(vitd(20).status !== 'niedrig', true, '20 ng/ml is the lower limit itself');
  assert.equal(vitd(19.8).status, 'niedrig');
  assert.notEqual(vitd(12).deficient, true, '12 ng/ml (29.95 nmol/l) is not below the deficiency limit of 30 nmol/l');
  assert.equal(vitd(11.8).deficient, true);
  assert.notEqual(assess('magnesiumSerum', 1.7 * 0.4114).status, 'niedrig', '1.7 mg/dl is the shown lower limit');
});

test('BMI: the protective limit 18.5 is compared unrounded', () => {
  const profile = { heightCm: 170, weightKg: 60, targetWeightKg: 53.46, targetWeightStartKg: 60, sex: 'w', birthYear: 1990 };
  const out = energyTargets({ profile, today: TODAY, elig: { minor: false, noWeightGoals: false } });
  assert.equal(out.block, 'bmi', 'BMI 18.498 is below 18.5');
  assert.equal(energyTargets({ profile: { ...profile, targetWeightKg: 53.5 }, today: TODAY, elig: { minor: false } }).block, null);
});

test('year of birth only: the youth profile holds until the year someone turns 19', () => {
  const at = (by) => eligibilityFor({ profile: { birthYear: by }, settings: {}, today: TODAY });
  assert.equal(at(2008).minor, true, 'turns 18 this year – may still be 17');
  assert.equal(at(2007).minor, false);
  assert.match(at(2008).reasons.join(), /17–18/);
});

test('Hb: the default lower limit is the one of the source shown (WHO 2024: men 13.0)', () => {
  assert.notEqual(assess('hb', 13.2, { sex: 'm' }).status, 'niedrig');
  assert.equal(assess('hb', 12.9, { sex: 'm' }).status, 'niedrig');
});

test('trends: CRP, TSH and CK only beyond their natural variation', () => {
  const series = (key, vals) => vals.map((v, i) => ({ id: `${key}${i}`, analyte: key, value: v, date: addDays(TODAY, (i - vals.length + 1) * 45) }));
  assert.equal(trend(series('crp', [1.0, 1.3, 1.6]), 'crp').dir, 'flat');
  assert.equal(trend(series('tsh', [1.5, 1.8, 2.1]), 'tsh').dir, 'flat');
  assert.equal(trend(series('ck', [120, 145, 170]), 'ck', { sex: 'm' }).dir, 'flat');
  assert.equal(trend(series('crp', [1.0, 2.0, 4.0]), 'crp').dir, 'up', 'a real rise still shows');
});

test('ferritin with a CRP from another day: the text names the day', () => {
  const crp = { id: 'c', analyte: 'crp', value: 12, date: addDays(TODAY, -3) };
  const fer = { id: 'f', analyte: 'ferritin', value: 80, date: TODAY };
  const a = assess('ferritin', 80, { sex: 'w', labs: [crp, fer], record: fer });
  assert.match(a.blocked, /3 Tage daneben/);
  const same = assess('ferritin', 80, { sex: 'w', labs: [{ ...crp, date: TODAY }, fer], record: fer });
  assert.doesNotMatch(same.blocked, /daneben/);
  const calm = assess('ferritin', 60, { sex: 'w', labs: [{ ...crp, value: 2 }, fer], record: { ...fer, value: 60 } });
  assert.ok(calm.caveats.some((c) => /nicht vom selben Tag/.test(c)));
});

test('weekly goal of a child: WHO\'s 60 minutes a day, not the adults\' 150 a week', () => {
  assert.deepEqual(weeklyGoals({ birthYear: 2016 }, TODAY), { activeMinutes: 420, trainingDays: 3 });
  assert.deepEqual(weeklyGoals({ birthYear: 1990 }, TODAY), { activeMinutes: 150, trainingDays: 3 });
  assert.equal(weeklyGoals({ birthYear: 2016, settings: { weeklyGoals: { activeMinutes: 300, trainingDays: 4 } } }, TODAY).activeMinutes, 300, 'a goal set stays');
});

test('protein hint: the value shown is below the range it names', () => {
  const diary = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, date: addDays(TODAY, -i), protein: 83 }));
  const { items } = recommend({ profile: { weightKg: 70 }, today: TODAY, diary });
  const p = items.find((x) => x.key === 'protein' || x.id === 'protein');
  assert.ok(p, 'hint shown for 1.186 g/kg');
  assert.match(JSON.stringify(p), /1,1 g/);
});
