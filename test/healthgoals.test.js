/* Unit tests for js/healthgoals.js — weekly health goals. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GOALS, weeklyGoals, weekActivity, goalProgress, latestWeight,
} from '../js/healthgoals.js';

// Wednesday, 2026-07-01 -> week Mon 29.06. .. Sun 05.07.
const TODAY = '2026-07-01';

test('weeklyGoals: defaults and overrides', () => {
  assert.deepEqual(weeklyGoals({}), DEFAULT_GOALS);
  const g = weeklyGoals({ settings: { weeklyGoals: { activeMinutes: 200, trainingDays: 5 } } });
  assert.equal(g.activeMinutes, 200);
  assert.equal(g.trainingDays, 5);
  // invalid values fall back to the default
  assert.equal(weeklyGoals({ settings: { weeklyGoals: { activeMinutes: -3 } } }).activeMinutes, 150);
});

test('weekActivity counts only the current week, minutes and unique days', () => {
  const sessions = [
    { id: 'a', date: '2026-06-29', durationSec: 1800 },   // Mon, 30 min
    { id: 'b', date: '2026-07-01', distanceKm: 10 },       // Wed, 10 km -> 60 min
    { id: 'c', date: '2026-07-01', durationSec: 600 },     // Wed (same day), 10 min
    { id: 'd', date: '2026-06-20', durationSec: 3600 },    // last week -> ignored
    { id: 'e', date: '2026-07-01', durationSec: 600, deleted: true }, // deleted
  ];
  const a = weekActivity(sessions, TODAY);
  assert.equal(a.activeMinutes, 30 + 60 + 10); // 100
  assert.equal(a.trainingDays, 2);             // Mon + Wed
});

test('latestWeight takes the most recent valid value', () => {
  const health = [
    { date: '2026-05-01', weight: 72 },
    { date: '2026-06-15', weight: 70 },
    { date: '2026-06-10', weight: 71, deleted: true },
  ];
  assert.equal(latestWeight(health), 70);
  assert.equal(latestWeight([]), null);
});

test('goalProgress: rings for minutes and days, allMet flag', () => {
  const sessions = [
    { id: 'a', date: '2026-06-29', durationSec: 3600 },  // 60 min
    { id: 'b', date: '2026-06-30', durationSec: 3600 },  // 60 min
    { id: 'c', date: '2026-07-01', durationSec: 1800 },  // 30 min
  ];
  const p = goalProgress({ profile: {}, sessions, today: TODAY });
  assert.equal(p.minutes.value, 150);
  assert.equal(p.minutes.pct, 100);
  assert.equal(p.days.value, 3);
  assert.equal(p.days.pct, 100);
  assert.equal(p.allMet, true);
});

test('goalProgress: weight progress (direction & difference)', () => {
  const p = goalProgress({
    profile: { targetWeightKg: 65 },
    sessions: [],
    health: [{ date: '2026-06-20', weight: 70 }],
    today: TODAY,
  });
  assert.ok(p.weight);
  assert.equal(p.weight.current, 70);
  assert.equal(p.weight.target, 65);
  assert.equal(p.weight.deltaKg, 5);
  assert.equal(p.weight.direction, 'down'); // still has to go down
  assert.equal(p.weight.reached, false);
});

test('goalProgress: no weight without a target weight or a measurement', () => {
  assert.equal(goalProgress({ profile: {}, health: [{ date: '2026-06-20', weight: 70 }], today: TODAY }).weight, null);
  assert.equal(goalProgress({ profile: { targetWeightKg: 65 }, health: [], today: TODAY }).weight, null);
});
