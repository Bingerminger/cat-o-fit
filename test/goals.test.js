/* Tests for the dedicated health/weight goals (js/goals.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress, goalsProgress, latestMetric } from '../js/goals.js';

test('latestMetric: most recent value from health, otherwise profile weight', () => {
  const health = [
    { date: '2026-06-01', weight: 68 },
    { date: '2026-06-20', weight: 65.5 },
    { date: '2026-06-10', weight: 67 },
  ];
  assert.equal(latestMetric('weight', { health }), 65.5);
  assert.equal(latestMetric('weight', { health: [], profile: { weightKg: 70 } }), 70);
  assert.equal(latestMetric('vo2max', { health: [] }), null);
  // Ignore tombstones/empty values
  assert.equal(latestMetric('weight', { health: [{ date: '2026-06-21', weight: 64, deleted: true }, { date: '2026-06-20', weight: 65.5 }] }), 65.5);
});

test('goalProgress: weight loss (down) – progress, reached, remaining amount', () => {
  const p = goalProgress({ metric: 'weight', start: 70, target: 65 }, { health: [{ date: '2026-06-20', weight: 66 }] });
  assert.equal(p.down, true);
  assert.equal(p.current, 66);
  assert.ok(Math.abs(p.pct - 0.8) < 0.001, `pct ${p.pct}`);   // (70-66)/(70-65)
  assert.equal(p.reached, false);
  assert.equal(p.remaining, 1);
  const reached = goalProgress({ metric: 'weight', start: 70, target: 65 }, { health: [{ date: 'x', weight: 64 }] });
  assert.equal(reached.reached, true);
  assert.equal(reached.pct, 1);
});

test('goalProgress: gain (up) – e.g. VO₂max', () => {
  const p = goalProgress({ metric: 'vo2max', start: 40, target: 45 }, { health: [{ date: 'x', vo2max: 42 }] });
  assert.equal(p.down, false);
  assert.ok(Math.abs(p.pct - 0.4) < 0.001);
  assert.equal(p.reached, false);
});

test('goalProgress: without a measured value -> current null, pct 0', () => {
  const p = goalProgress({ metric: 'hrv', start: 40, target: 50 }, { health: [] });
  assert.equal(p.current, null);
  assert.equal(p.pct, 0);
  assert.equal(p.reached, false);
});

test('goalsProgress reads profile.settings.healthGoals + deadline in days', () => {
  const profile = { settings: { healthGoals: [{ id: 'g1', metric: 'weight', start: 70, target: 65, deadline: '2026-07-10' }] } };
  const list = goalsProgress({ profile, health: [{ date: '2026-06-20', weight: 67 }], today: '2026-06-30' });
  assert.equal(list.length, 1);
  assert.equal(list[0].goal.id, 'g1');
  assert.equal(list[0].daysLeft, 10);
  assert.equal(list[0].current, 67);
});
