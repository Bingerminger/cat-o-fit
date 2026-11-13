/* Training figures at their edges (4.2): form right after the start-up, HRV on a day without an HRV
   value, the run the form card names, calendar weeks, zone 5 against HRmax, pace on miles, ranges of
   distances on miles, and two thresholds that floating point used to tip. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { formToday, formState, relativeForm, monotonyStrain } from '../js/load.js';
import { readinessScore } from '../js/adaptive.js';
import { estimateVdot, planPaces, vdotFromPerf } from '../js/vdot.js';
import { hrZonesFrom } from '../js/hrzones.js';
import { setUnits, METRIC, paceFromInput, paceToInput } from '../js/units.js';
import { localizeUnits } from '../js/format.js';
import { addDays } from '../js/ui.js';

after(() => setUnits(METRIC));

const TODAY = '2026-11-07';   // a Saturday

test('form: perfectly even training reads "balanced" from the first rated day on', () => {
  for (const days of [90, 95, 100, 150, 220]) {
    const sessions = Array.from({ length: days }, (_, i) => ({ id: `s${i}`, date: addDays(TODAY, -i), type: 'easy', durationSec: 3600, rpe: 5 }));
    const fs = formState(formToday(sessions, TODAY), days);
    assert.equal(fs.key, 'ausgeglichen', `${days} days: ${fs.key} (${Math.round(fs.rel * 100)} %)`);
    assert.ok(Math.abs(fs.rel) < 0.02, `${days} days: ${fs.rel}`);
  }
  // A real jump still shows: the last week 42 % higher.
  const jump = Array.from({ length: 92 }, (_, i) => ({ id: `j${i}`, date: addDays(TODAY, -i), type: 'easy', durationSec: i < 7 ? 5112 : 3600, rpe: 5 }));
  assert.ok(relativeForm(formToday(jump, TODAY), 92) < -0.15);
});

test('readiness: a day with only sleep keeps the HRV verdict of the days before', () => {
  const health = [];
  for (let i = 27; i >= 1; i--) health.push({ id: `h${i}`, date: addDays(TODAY, -i), hrv: i <= 6 ? 49 : 64, restingHr: 50, hrvMethod: 'rmssd' });
  const withHrv = readinessScore([...health, { id: 'h0', date: TODAY, hrv: 47, restingHr: 53, sleepHours: 7, hrvMethod: 'rmssd' }], TODAY);
  const without = readinessScore([...health, { id: 'h0', date: TODAY, restingHr: 53, sleepHours: 7 }], TODAY);
  const none = readinessScore(health, TODAY);
  const low = (r) => r.factors.some((f) => /HRV/.test(f) && /unter|below/i.test(f));
  assert.ok(low(withHrv) && low(without) && low(none), JSON.stringify([withHrv.factors, without.factors, none.factors]));
  assert.ok(without.score < 55, `without today's HRV: ${without.score}`);
});

test('form card: with under three weeks the basis is the run the number comes from', () => {
  const sessions = [
    { id: 'a', date: addDays(TODAY, -1), type: 'tempo', distanceKm: 10, durationSec: 3000 },   // VDOT ~40
    { id: 'b', date: addDays(TODAY, -9), type: 'race', distanceKm: 5, durationSec: 1200 },      // VDOT ~49.8
  ];
  const est = estimateVdot(sessions, TODAY);
  assert.equal(est.vdot, Math.round(vdotFromPerf(5000, 1200) * 10) / 10);
  assert.equal(est.basis.distanceKm, 5);
  assert.equal(est.basis.date, addDays(TODAY, -9));
});

test('form: the weekly best is per calendar week, not per 7 days back from today', () => {
  setUnits({ ...METRIC, weekStart: 1 });
  try {
    const run = (date, sec) => ({ id: date, date, type: 'tempo', distanceKm: 10, durationSec: sec });
    // Sat 7 Nov: Sun 1 Nov and Sat 31 Oct are one calendar week (Mon 26 Oct – Sun 1 Nov), Fri 23 Oct another.
    const two = estimateVdot([run('2026-11-01', 2800), run('2026-10-31', 2700), run('2026-10-23', 2850)], TODAY);
    assert.equal(two.weeks, 2);
    assert.equal(two.basis.date, '2026-10-31', 'the best single run');
    const three = estimateVdot([run('2026-11-07', 2800), run('2026-11-01', 2800), run('2026-10-24', 2800)], TODAY);
    assert.equal(three.weeks, 3, 'Saturday 7 Nov and Sunday 1 Nov are different weeks');
  } finally { setUnits(METRIC); }
});

test('threshold zones: a known HRmax closes zone 5 – never above it, up to it when higher', () => {
  const z5 = (maxHr) => hrZonesFrom({ method: 'lthr', lthr: 170, maxHr })[4];
  assert.deepEqual([z5(175).min, z5(175).max], [170, 175]);
  assert.deepEqual([z5(190).min, z5(190).max], [170, 190]);
  assert.equal(z5(null).max, 180, 'without HRmax 106 % of the threshold');
});

test('pace on miles: every whole second per mile comes back as typed', () => {
  setUnits({ ...METRIC, distance: 'mi' });
  try {
    const bad = [];
    for (let n = 240; n <= 900; n++) {
      const stored = paceFromInput(n);
      if (paceToInput(stored) !== n) bad.push(`${n} → ${paceToInput(stored)}`);
    }
    assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of 661 values changed`);
  } finally { setUnits(METRIC); }
  assert.equal(paceFromInput(300), 300, 'on km whole seconds as before');
});

test('plan texts on miles: ranges of distances convert both ends', () => {
  setUnits({ ...METRIC, distance: 'mi' });
  try {
    assert.equal(localizeUnits('Rad-Alternative: ~68–85 km'), 'Rad-Alternative: ~42,3–52,8 mi');
    assert.equal(localizeUnits('die letzten 1–2 km'), 'die letzten 0,62–1,24 mi');
    assert.equal(localizeUnits('10-15 km, 18 km bei 5:20–5:34 min/km'), '6,2-9,3 mi, 11,2 mi bei 8:35–8:58 min/mi');
    // A sentence dash is no range: only the distance after it changes.
    assert.equal(localizeUnits('in Z2 – 10 km'), 'in Z2 – 6,2 mi');
    assert.equal(localizeUnits('1:55:00 – 21,1 km'), '1:55:00 – 13,1 mi');
    assert.equal(localizeUnits('Woche 3 – 12 km'), 'Woche 3 – 7,5 mi');
  } finally { setUnits(METRIC); }
});

test('thresholds that floating point tipped: 10 % above usual, 3 VDOT above form', () => {
  // A week exactly 10 % above the three before, monotonous: the hint shows.
  const series = [];
  for (let i = 27; i >= 7; i--) series.push({ id: `c${i}`, date: addDays(TODAY, -i), type: 'easy', durationSec: 20 * 60, rpe: 5 });   // 100 AU a day → 700 a week
  for (let i = 6; i >= 0; i--) series.push({ id: `a${i}`, date: addDays(TODAY, -i), type: 'easy', durationSec: 22 * 60, rpe: 5 });   // 110 AU a day → 770
  assert.equal(monotonyStrain(series, TODAY).tone, 'warn');
  // Goal exactly 3.0 VDOT above the form (as both are shown): not "ambitious".
  for (const form of [61.4, 61.9, 62.4, 63.9]) {
    let targetSec = 2400;
    while (Math.round(vdotFromPerf(10000, targetSec) * 10) / 10 < Math.round((form + 3) * 10) / 10) targetSec -= 1;
    const pp = planPaces({ distanceKm: 10, targetSec, formVdot: form });
    if (Math.round((pp.goalVdot - form) * 10) === 30) assert.equal(pp.ambitious, false, `form ${form}, goal ${pp.goalVdot}`);
  }
});
