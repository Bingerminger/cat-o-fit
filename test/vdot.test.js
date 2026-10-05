/* Unit tests for js/vdot.js — VDOT estimate (Jack Daniels) and derived
   training paces. Reference: 5 km in 25:00 ≈ VDOT 38 (Daniels table). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vdotFromPerf, paceForPct, pacesFromVdot, estimateVdot, paceAdjustment } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';

test('vdotFromPerf: 5 km in 25:00 ≈ VDOT 38', () => {
  const v = vdotFromPerf(5000, 1500);
  assert.ok(v >= 37 && v <= 40, `VDOT was ${v}`);
});

test('vdotFromPerf: HM in 1:55:00 ≈ VDOT 38', () => {
  const v = vdotFromPerf(21097.5, 6900);
  assert.ok(v >= 36 && v <= 40, `VDOT was ${v}`);
});

test('vdotFromPerf: faster -> higher VDOT; nonsense -> null', () => {
  assert.ok(vdotFromPerf(5000, 1320) > vdotFromPerf(5000, 1500));
  assert.equal(vdotFromPerf(0, 1500), null);
  assert.equal(vdotFromPerf(5000, 0), null);
  assert.equal(vdotFromPerf(100, 30), null);
});

test('pacesFromVdot: order recovery slower than vo2, all plausible', () => {
  const p = pacesFromVdot(38);
  assert.ok(p.recovery.min > p.easy.min);   // slower = more sec/km
  assert.ok(p.easy.min > p.threshold.min);
  assert.ok(p.threshold.min > p.vo2.min);
  Object.values(p).forEach((z) => {
    assert.ok(z.min <= z.max, `min<=max at ${z.label}`);
    assert.ok(z.min >= 150 && z.max <= 480, `plausible at ${z.label}: ${z.min}-${z.max}`);
  });
});

test('paceForPct: higher intensity -> faster (smaller) pace', () => {
  assert.ok(paceForPct(40, 0.95) < paceForPct(40, 0.70));
});

test('estimateVdot: best value from the most recent hard runs', () => {
  const sessions = [
    { date: T, type: 'tempo', distanceKm: 5, durationSec: 1500 },          // ~VDOT 38
    { date: addDays(T, -3), type: 'easy', distanceKm: 8, durationSec: 2880 }, // slower
    { date: addDays(T, -200), type: 'race', distanceKm: 5, durationSec: 1200 }, // too old
  ];
  const r = estimateVdot(sessions, T);
  assert.ok(r.vdot >= 37 && r.vdot <= 40, `VDOT was ${r.vdot}`);
  assert.equal(r.basis.type, 'tempo');
});

test('estimateVdot: at equal VDOT the MOST RECENT unit wins as basis (not an old one)', () => {
  const sessions = [
    { date: addDays(T, -30), type: 'interval', distanceKm: 8, durationSec: 2000 }, // old
    { date: addDays(T, -3), type: 'interval', distanceKm: 8, durationSec: 2000 },   // young, same VDOT
  ];
  const r = estimateVdot(sessions, T);
  assert.equal(r.basis.date, addDays(T, -3), 'form basis references the most recent unit, not the oldest');
});

test('estimateVdot: a single outlier is smoothed, not adopted 1:1 as form', () => {
  // 6 weeks of constant tempo runs (~VDOT 39) + one single far too fast outlier.
  const sessions = [];
  for (let w = 0; w < 6; w++) sessions.push({ date: addDays(T, -w * 7 - 1), type: 'tempo', distanceKm: 8, durationSec: 8 * 300 });
  sessions.push({ date: addDays(T, -2), type: 'interval', distanceKm: 8, durationSec: 8 * 200 }); // outlier (~VDOT 63)
  const baseline = vdotFromPerf(8000, 8 * 300);
  const outlier = vdotFromPerf(8000, 8 * 200);
  const r = estimateVdot(sessions, T);
  assert.ok(outlier > baseline + 15, 'test precondition: outlier lies far above the baseline');
  assert.ok(r.weeks >= 3, 'smoothed over several weeks');
  assert.ok(r.vdot < baseline + 4, `smoothed form ${r.vdot} must not jump to the outlier ${outlier.toFixed(1)}`);
  assert.ok(r.vdot >= baseline - 1, `smoothed form ${r.vdot} must not fall below the baseline ${baseline.toFixed(1)}`);
});

test('estimateVdot: no suitable runs -> null', () => {
  assert.equal(estimateVdot([{ date: T, type: 'strength', durationSec: 2400 }], T), null);
  assert.equal(estimateVdot([], T), null);
});

test('paceAdjustment: detects plan paces that are too slow (form faster)', () => {
  const r = paceAdjustment({ threshold: { min: 355, max: 365 } }, 48);
  assert.ok(r.deltaSec > 0, `delta was ${r.deltaSec}`);
  assert.ok(r.fresh.threshold.min < 355);
});

test('paceAdjustment: without existing zones only fresh paces are returned', () => {
  const r = paceAdjustment({}, 40);
  assert.equal(r.deltaSec, null);
  assert.ok(r.fresh.easy.min > 0);
});

test('TRAIN-49: hilly runs no longer depress the form estimate', () => {
  const T = '2026-09-29';
  // The same time over 10 km – once flat, once with 250 metres of ascent.
  const flat = estimateVdot([{ date: addDays(T, -3), type: 'tempo', distanceKm: 10, durationSec: 2700 }], T);
  const hilly = estimateVdot([{ date: addDays(T, -3), type: 'tempo', distanceKm: 10, durationSec: 2700, ascentM: 250 }], T);
  assert.ok(hilly.vdot > flat.vdot, `hilly ${hilly.vdot} > flat ${flat.vdot}`);
  // A few metres of undulation (under 5 m per km) are left out.
  const wavy = estimateVdot([{ date: addDays(T, -3), type: 'tempo', distanceKm: 10, durationSec: 2700, ascentM: 40 }], T);
  assert.equal(wavy.vdot, flat.vdot);
});
