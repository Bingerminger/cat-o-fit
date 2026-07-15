import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitLoad, weekPlan, simulateAdd, simulateMove, impactText } from '../js/whatif.js';

const U = (date, type, extra = {}) => ({ id: date + type, date, type, title: `${type}`, status: 'geplant', ...extra });

test('unitLoad: Minuten × Typ-RPE (sRPE), rest = 0', () => {
  assert.equal(unitLoad({ type: 'tempo', targetDurationMin: 60 }), 60 * 7);      // RPE tempo = 7
  assert.equal(unitLoad({ type: 'easy', targetDistanceKm: 10 }), 60 * 4);        // 10 km → 60 min, RPE easy = 4
  assert.equal(unitLoad({ type: 'rest' }), 0);
  assert.equal(unitLoad({ type: 'strength' }), 40 * 5);                          // Default 40 min, RPE 5
});

test('weekPlan: Belastung, harte Einheiten, Anzahl (Mo–So)', () => {
  const units = [U('2026-07-06', 'tempo', { targetDurationMin: 60 }), U('2026-07-08', 'easy', { targetDistanceKm: 10 }), U('2026-07-13', 'long')];
  const w = weekPlan(units, '2026-07-06');
  assert.equal(w.count, 2);        // 13.07. ist nächste Woche
  assert.equal(w.hard, 1);         // nur tempo
  assert.equal(w.load, 60 * 7 + 60 * 4);
});

test('simulateAdd: harte Einheit hebt Last & harte Anzahl', () => {
  const units = [U('2026-07-06', 'easy', { targetDistanceKm: 8 })];
  const sim = simulateAdd(units, U('2026-07-08', 'interval', { targetDurationMin: 60 }));
  assert.equal(sim.after.hard, sim.before.hard + 1);
  assert.ok(sim.after.load > sim.before.load);
  assert.ok(['erhöht', 'hoch'].includes(sim.level));
});

test('simulateMove: gleiche Woche -> nur Zielwoche; andere Woche -> beide', () => {
  const units = [U('2026-07-06', 'tempo', { targetDurationMin: 60 }), U('2026-07-08', 'easy')];
  const same = simulateMove(units, '2026-07-06tempo', '2026-07-10');
  assert.ok(same.target && same.source === null);
  const cross = simulateMove(units, '2026-07-06tempo', '2026-07-14'); // nächste Woche
  assert.ok(cross.target && cross.source);
  assert.ok(cross.source.after.load < cross.source.before.load); // Quelle wird leichter
});

test('impactText: Klartext nach Level', () => {
  assert.match(impactText({ level: 'ok', before: { load: 100, hard: 1 }, after: { load: 110, hard: 1 } }), /Kaum Auswirkung/);
  assert.match(impactText({ level: 'hoch', before: { load: 100, hard: 2 }, after: { load: 300, hard: 4 } }), /fordernder/);
});
