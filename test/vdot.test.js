/* Unit-Tests für js/vdot.js — VDOT-Schätzung (Jack Daniels) und abgeleitete
   Trainings-Paces. Referenz: 5 km in 25:00 ≈ VDOT 38 (Daniels-Tabelle). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vdotFromPerf, paceForPct, pacesFromVdot, estimateVdot, paceAdjustment } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';

test('vdotFromPerf: 5 km in 25:00 ≈ VDOT 38', () => {
  const v = vdotFromPerf(5000, 1500);
  assert.ok(v >= 37 && v <= 40, `VDOT war ${v}`);
});

test('vdotFromPerf: HM in 1:55:00 ≈ VDOT 38', () => {
  const v = vdotFromPerf(21097.5, 6900);
  assert.ok(v >= 36 && v <= 40, `VDOT war ${v}`);
});

test('vdotFromPerf: schneller -> höherer VDOT; Unsinn -> null', () => {
  assert.ok(vdotFromPerf(5000, 1320) > vdotFromPerf(5000, 1500));
  assert.equal(vdotFromPerf(0, 1500), null);
  assert.equal(vdotFromPerf(5000, 0), null);
  assert.equal(vdotFromPerf(100, 30), null);
});

test('pacesFromVdot: Reihenfolge recovery langsamer als vo2, alle plausibel', () => {
  const p = pacesFromVdot(38);
  assert.ok(p.recovery.min > p.easy.min);   // langsamer = mehr sec/km
  assert.ok(p.easy.min > p.threshold.min);
  assert.ok(p.threshold.min > p.vo2.min);
  Object.values(p).forEach((z) => {
    assert.ok(z.min <= z.max, `min<=max bei ${z.label}`);
    assert.ok(z.min >= 150 && z.max <= 480, `plausibel bei ${z.label}: ${z.min}-${z.max}`);
  });
});

test('paceForPct: höhere Intensität -> schnellere (kleinere) Pace', () => {
  assert.ok(paceForPct(40, 0.95) < paceForPct(40, 0.70));
});

test('estimateVdot: bester Wert aus jüngsten harten Läufen', () => {
  const sessions = [
    { date: T, type: 'tempo', distanceKm: 5, durationSec: 1500 },          // ~VDOT 38
    { date: addDays(T, -3), type: 'easy', distanceKm: 8, durationSec: 2880 }, // langsamer
    { date: addDays(T, -200), type: 'race', distanceKm: 5, durationSec: 1200 }, // zu alt
  ];
  const r = estimateVdot(sessions, T);
  assert.ok(r.vdot >= 37 && r.vdot <= 40, `VDOT war ${r.vdot}`);
  assert.equal(r.basis.type, 'tempo');
});

test('estimateVdot: bei gleichem VDOT gewinnt die JÜNGSTE Einheit als Basis (nicht eine alte)', () => {
  const sessions = [
    { date: addDays(T, -30), type: 'interval', distanceKm: 8, durationSec: 2000 }, // alt
    { date: addDays(T, -3), type: 'interval', distanceKm: 8, durationSec: 2000 },   // jung, gleicher VDOT
  ];
  const r = estimateVdot(sessions, T);
  assert.equal(r.basis.date, addDays(T, -3), 'Form-Basis referenziert die jüngste, nicht die älteste Einheit');
});

test('estimateVdot: einzelner Ausreißer wird geglättet, nicht 1:1 als Form übernommen', () => {
  // 6 Wochen konstante Tempoläufe (~VDOT 39) + ein einzelner viel zu schneller Ausreißer.
  const sessions = [];
  for (let w = 0; w < 6; w++) sessions.push({ date: addDays(T, -w * 7 - 1), type: 'tempo', distanceKm: 8, durationSec: 8 * 300 });
  sessions.push({ date: addDays(T, -2), type: 'interval', distanceKm: 8, durationSec: 8 * 200 }); // Ausreißer (~VDOT 63)
  const baseline = vdotFromPerf(8000, 8 * 300);
  const outlier = vdotFromPerf(8000, 8 * 200);
  const r = estimateVdot(sessions, T);
  assert.ok(outlier > baseline + 15, 'Testvoraussetzung: Ausreißer liegt weit über der Baseline');
  assert.ok(r.weeks >= 3, 'über mehrere Wochen geglättet');
  assert.ok(r.vdot < baseline + 4, `geglättete Form ${r.vdot} darf nicht zum Ausreißer ${outlier.toFixed(1)} springen`);
  assert.ok(r.vdot >= baseline - 1, `geglättete Form ${r.vdot} darf nicht unter die Baseline ${baseline.toFixed(1)} fallen`);
});

test('estimateVdot: keine geeigneten Läufe -> null', () => {
  assert.equal(estimateVdot([{ date: T, type: 'strength', durationSec: 2400 }], T), null);
  assert.equal(estimateVdot([], T), null);
});

test('paceAdjustment: erkennt zu langsame Plan-Paces (Form schneller)', () => {
  const r = paceAdjustment({ threshold: { min: 355, max: 365 } }, 48);
  assert.ok(r.deltaSec > 0, `delta war ${r.deltaSec}`);
  assert.ok(r.fresh.threshold.min < 355);
});

test('paceAdjustment: ohne vorhandene Zonen liefert nur frische Paces', () => {
  const r = paceAdjustment({}, 40);
  assert.equal(r.deltaSec, null);
  assert.ok(r.fresh.easy.min > 0);
});
