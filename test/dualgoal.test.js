import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { phaseEmphasis, currentPhaseKey, recommendedDeficit, stimulusCheck, PHASE_EMPHASIS } from '../js/dualgoal.js';

const mkPlan = (start) => ({
  startDate: start, endDate: addDays(start, 12 * 7 - 1), weeks: 12,
  phases: [
    { key: 'base', name: 'Grundlage', startWeek: 1, endWeek: 5 },
    { key: 'build', name: 'Aufbau', startWeek: 6, endWeek: 9 },
    { key: 'peak', name: 'Spitze', startWeek: 10, endWeek: 11 },
    { key: 'taper', name: 'Tapering', startWeek: 12, endWeek: 12 },
  ],
});
const START = '2026-06-01';

test('currentPhaseKey / phaseEmphasis: Woche → Phase', () => {
  const p = mkPlan(START);
  assert.equal(currentPhaseKey(p, START), 'base');                    // Woche 1
  assert.equal(currentPhaseKey(p, addDays(START, 7 * 5)), 'build');   // Woche 6
  assert.equal(currentPhaseKey(p, addDays(START, 7 * 9)), 'peak');    // Woche 10
  assert.equal(currentPhaseKey(p, addDays(START, 7 * 11)), 'taper');  // Woche 12
});

test('phaseEmphasis: Grundlage betont Abnehmen, Tapering betont Leistung', () => {
  const p = mkPlan(START);
  const base = phaseEmphasis(p, START);
  assert.ok(base.loss > base.perf && base.kcal === PHASE_EMPHASIS.base.kcal);
  const taper = phaseEmphasis(p, addDays(START, 7 * 11));
  assert.ok(taper.perf > taper.loss && taper.kcal === 0);
  assert.equal(taper.phaseName, 'Tapering');
});

test('recommendedDeficit: phasenabhängig, 0 bei erreichtem Zielgewicht', () => {
  const p = mkPlan(START);
  const build = recommendedDeficit(p, addDays(START, 7 * 5), { currentKg: 72, targetKg: 65 });
  assert.equal(build.kcal, PHASE_EMPHASIS.build.kcal);
  assert.equal(build.reached, false);
  const done = recommendedDeficit(p, addDays(START, 7 * 5), { currentKg: 64.9, targetKg: 65 });
  assert.equal(done.kcal, 0);
  assert.equal(done.reached, true);
});

test('stimulusCheck: genug Reiz → enough true', () => {
  const today = '2026-07-14';
  const sessions = [
    { date: addDays(today, -1), type: 'tempo', rpe: 7 },
    { date: addDays(today, -3), type: 'interval', rpe: 8 },
    { date: addDays(today, -5), type: 'easy', rpe: 4 },
    { date: addDays(today, -7), type: 'long', rpe: 6 },
    { date: addDays(today, -9), type: 'easy', rpe: 4 },
    { date: addDays(today, -11), type: 'strength', rpe: 5 },
  ];
  const s = stimulusCheck(sessions, today);
  assert.equal(s.enough, true);
  assert.match(s.message, /genug Reiz/);
});

test('stimulusCheck: nur Ruhe/wenig Reiz → enough false + ehrlicher Hinweis', () => {
  const today = '2026-07-14';
  const sessions = [
    { date: addDays(today, -2), type: 'easy', rpe: 3 },
    { date: addDays(today, -6), type: 'walk', rpe: 2 },
  ];
  const s = stimulusCheck(sessions, today);
  assert.equal(s.enough, false);
  assert.match(s.message, /Ruhetage allein/);
});
