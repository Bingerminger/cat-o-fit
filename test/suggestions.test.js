/* Unit tests for target pace, Riegel prediction and training tip (js/suggestions.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayStr } from '../js/ui.js';
import { targetPaceSecPerKm, riegel, predictRace, trainingTip } from '../js/suggestions.js';

test('targetPaceSecPerKm: target time/distance -> seconds per km', () => {
  assert.equal(targetPaceSecPerKm('1:45:00', 21.1), 299); // 6300s / 21.1 km
  assert.equal(targetPaceSecPerKm('0:50:00', 10), 300);
  assert.equal(targetPaceSecPerKm(null, 10), null);
  assert.equal(targetPaceSecPerKm('1:00:00', 0), null);
});

test('riegel: linear at exp=1, disproportionate at the default exp', () => {
  assert.equal(riegel(1200, 5, 10, 1), 2400); // double distance, exp 1 -> double time
  const def = riegel(1200, 5, 10); // exp 1.06 -> slightly more than double
  assert.ok(def > 2400 && Math.abs(def - 2501.8) < 1, `Riegel default ~2501.8, was ${def}`);
  assert.equal(riegel(0, 5, 10), null);
  assert.equal(riegel(1200, 5, 0), null);
});

test('predictRace: uses the smoothed form (VDOT), not the fastest single run', () => {
  const date = addDays(todayStr(), -5);
  const res = predictRace([{ date, distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10);
  assert.ok(res);
  assert.equal(res.method, 'form');
  // 5 km in 20:00 => VDOT ~49.8 => 10 km equivalent just over 41 min.
  assert.ok(res.seconds > 2400 && res.seconds < 2650, `10 km equivalent plausible, was ${res.seconds}`);
  assert.match(res.basis, /VDOT/);
});

test('predictRace: a fast short run without marathon volume gives a forecast WITH a caveat', () => {
  const t = todayStr();
  // Three long, easy runs + one very fast 5 km – avg only ~22 km per week.
  const sessions = [
    { date: addDays(t, -21), distanceKm: 30, durationSec: 10800, type: 'long' },
    { date: addDays(t, -14), distanceKm: 25, durationSec: 9000, type: 'long' },
    { date: addDays(t, -7), distanceKm: 28, durationSec: 10080, type: 'long' },
    { date: addDays(t, -2), distanceKm: 5, durationSec: 1080, type: 'tempo' }, // 3:36/km
  ];
  const res = predictRace(sessions, 42.195, { today: t });
  assert.ok(res);
  assert.equal(res.method, 'form');
  assert.equal(res.onlyEasy, false, 'the form comes from the hard run');
  // The equivalent time only holds with suitable volume – the forecast now says so.
  assert.equal(res.caveat, 'volume');
  assert.match(res.note, /ausreichender Vorbereitung/);
});

test('predictRace: with marathon volume (≥ 50 km/week, long run ≥ 25 km) no caveat', () => {
  const t = todayStr();
  const sessions = [];
  for (let w = 0; w < 4; w++) {
    sessions.push({ date: addDays(t, -w * 7 - 1), distanceKm: 28, durationSec: 28 * 330, type: 'long' });
    sessions.push({ date: addDays(t, -w * 7 - 3), distanceKm: 14, durationSec: 14 * 300, type: 'tempo' });
    sessions.push({ date: addDays(t, -w * 7 - 5), distanceKm: 12, durationSec: 12 * 340, type: 'easy' });
  }
  const res = predictRace(sessions, 42.195, { today: t });
  assert.equal(res.caveat, null);
  assert.equal(res.note, null);
});

test('predictRace: easy runs only -> flagged as "rather too cautious"', () => {
  const t = todayStr();
  const sessions = [1, 8, 15].map((d) => ({ date: addDays(t, -d), distanceKm: 10, durationSec: 3600, type: 'easy' }));
  const res = predictRace(sessions, 10, { today: t });
  assert.equal(res.onlyEasy, true);
  assert.match(res.basis, /lockeren Trainingsläufen/);
});

test('predictRace: no basis -> null', () => {
  assert.equal(predictRace([], 10), null);
  assert.equal(predictRace([{ date: todayStr(), distanceKm: 5, durationSec: 1200, type: 'tempo' }], 0), null);
  // too old for both paths (VDOT window 42 days, Riegel 50 days)
  assert.equal(predictRace([{ date: addDays(todayStr(), -60), distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10), null);
});

test('predictRace: Riegel fallback only for a justifiable extrapolation', () => {
  const t = todayStr();
  // 45 days old: outside the VDOT window (42 days), still within the Riegel window (50)
  // -> the fallback path applies.
  const old = [{ date: addDays(t, -45), distanceKm: 5, durationSec: 1500, type: 'tempo' }];
  // 5 km to 42.2 km would be a factor of 8.4 (> limit 4): better no forecast than a poor one.
  assert.equal(predictRace(old, 42.195), null);
  // To 10 km (factor 2), by contrast, the fallback delivers an estimate.
  const near = predictRace(old, 10);
  assert.ok(near && near.method === 'riegel');
});

test('trainingTip: context-dependent, friendly hints', () => {
  assert.match(trainingTip({ todaysUnits: [{ type: 'race' }] }), /Wettkampf/);
  assert.match(trainingTip({ todaysUnits: [{ type: 'long' }] }), /Long Run/);
  assert.match(trainingTip({ todaysUnits: [] }), /Ruhetag/);
  // streak = weekly streak (TRAIN-39) – rest days count towards it.
  assert.match(trainingTip({ todaysUnits: [{ type: 'easy' }], streak: 5 }), /5 Wochen in Folge/);
});
