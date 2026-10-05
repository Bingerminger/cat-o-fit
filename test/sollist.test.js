/* Tests for js/sollist.js (planned-vs-actual comparison) and the form estimate from hard
   runs (js/vdot.js estimateVdot) – TRAIN-22, TRAIN-15, FE-22. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareToPlan, isStructured, splitBarPct } from '../js/sollist.js';
import { estimateVdot, vdotFromPerf } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const Z = [
  { zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }, { zone: 3, min: 133, max: 152 },
  { zone: 4, min: 152, max: 171 }, { zone: 5, min: 171, max: 190 },
];

test('TRAIN-22: an easy run that is too fast does NOT count as "achieved" and is called out', () => {
  const unit = { type: 'easy', targetDistanceKm: 10, targetPaceSecPerKm: 294, targetPaceMaxSecPerKm: 314, targetHrZone: 2 };
  const ex = { distanceKm: 10, paceSecPerKm: 260, avgHr: 160 };   // 4:20 instead of 4:54–5:14
  const r = compareToPlan(unit, ex, { hrZones: Z });
  assert.equal(r.tooFast, true);
  assert.equal(r.hit, false);
  assert.equal(r.rows.find((x) => x.key === 'pace').verdict, 'zu schnell');
  assert.match(r.note, /Zu schnell für eine lockere Einheit/);
  // In the target range: achieved.
  const ok = compareToPlan(unit, { distanceKm: 10.1, paceSecPerKm: 300, avgHr: 128 }, { hrZones: Z });
  assert.equal(ok.hit, true);
  // Slower than planned is no drama on an easy run, but it is called out.
  assert.equal(compareToPlan(unit, { distanceKm: 10, paceSecPerKm: 360 }, { hrZones: Z }).rows.find((x) => x.key === 'pace').verdict, 'langsamer als geplant');
});

test('TRAIN-22: cleanly run intervals are not penalised via the overall average', () => {
  // 6×800 m perfect, with warm-up/cool-down and jog recoveries: avg 5:08 min/km, avg HR 150.
  const unit = { type: 'interval', title: 'VO2max-Intervalle 6×800 m', targetDistanceKm: 9, targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261, targetHrZone: 5 };
  const r = compareToPlan(unit, { distanceKm: 10.8, paceSecPerKm: 308, avgHr: 150 }, { hrZones: Z });
  assert.equal(r.structured, true);
  assert.ok(!r.rows.some((x) => x.key === 'pace' || x.key === 'hr'), 'no pace/HR verdict on the average');
  assert.equal(r.hit, true, 'distance fulfilled → achieved, no "deviation"');
  assert.match(r.note, /Belastungsabschnitte/);
  assert.equal(isStructured({ type: 'long', raceBlockKm: 6 }), true, 'long run with a race-pace block');
  assert.equal(isStructured({ type: 'easy' }), false);
});

test('TRAIN-22: race one-sided – faster is good; duration for time-based units', () => {
  const race = { type: 'race', targetDistanceKm: 21.1, targetPaceSecPerKm: 320, targetPaceMaxSecPerKm: 334 };
  assert.equal(compareToPlan(race, { distanceKm: 21.1, paceSecPerKm: 300 }).hit, true);
  assert.equal(compareToPlan(race, { distanceKm: 21.1, paceSecPerKm: 360 }).hit, false);
  const timed = { type: 'strength', targetDurationMin: 40 };
  assert.equal(compareToPlan(timed, { durationSec: 38 * 60 }).rows[0].key, 'duration');
  assert.equal(compareToPlan(timed, { durationSec: 38 * 60 }).hit, true);
});

test('FE-22: split bars on a fixed scale (±30 s around the median)', () => {
  const splits = [{ km: 1, sec: 300 }, { km: 2, sec: 301 }, { km: 3, sec: 330 }];
  const a = splitBarPct(300, splits), b = splitBarPct(301, splits), c = splitBarPct(330, splits);
  assert.ok(Math.abs(a - b) <= 2, `5:00 and 5:01 look almost the same (${a} / ${b})`);
  assert.ok(c < b - 40, 'a kilometre that is 29 s slower is clearly shorter');
  assert.ok(c >= 6 && a <= 100);
});

test('TRAIN-15: form estimate only from hard runs; easy runs at most a lower bound', () => {
  const T = '2026-06-28';
  // Six weeks of easy running only (a VDOT-50 runner at her easy pace): previously ~VDOT 42 as "form".
  const easy = [];
  for (let w = 0; w < 6; w++) {
    easy.push({ date: addDays(T, -w * 7 - 1), type: 'easy', distanceKm: 10, durationSec: 10 * 305 });
    easy.push({ date: addDays(T, -w * 7 - 4), type: 'long', distanceKm: 18, durationSec: 18 * 315 });
  }
  const onlyEasy = estimateVdot(easy, T);
  assert.equal(onlyEasy.onlyEasy, true, 'flagged as an estimate from easy runs');
  // A tempo run carries the form; the easy runs do not drag it down.
  const withTempo = [...easy, { date: addDays(T, -2), type: 'tempo', distanceKm: 8, durationSec: 8 * 255 }];
  const est = estimateVdot(withTempo, T);
  assert.equal(est.onlyEasy, false);
  assert.equal(est.hardCount, 1);
  assert.ok(Math.abs(est.vdot - vdotFromPerf(8000, 8 * 255)) < 0.2, `Form from the tempo run, was ${est.vdot}`);
  // Hard runs are also detected via RPE ≥ 7 or heart rate from zone 4.
  const byRpe = estimateVdot([{ date: addDays(T, -1), type: 'run', distanceKm: 5, durationSec: 1350, rpe: 8 }], T);
  assert.equal(byRpe.onlyEasy, false);
  const byHr = estimateVdot([{ date: addDays(T, -1), type: 'easy', distanceKm: 6, durationSec: 1700, avgHr: 165 }], T, 42, { hrZones: Z });
  assert.equal(byHr.onlyEasy, false);
  assert.equal(estimateVdot([{ date: addDays(T, -1), type: 'easy', distanceKm: 6, durationSec: 1700, avgHr: 165 }], T).onlyEasy, true, 'without zones the HR does not count');
});
