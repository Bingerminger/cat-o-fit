/* Unit-Tests für js/healthgoals.js — Wochen-Gesundheitsziele. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GOALS, weeklyGoals, weekActivity, goalProgress, latestWeight,
} from '../js/healthgoals.js';

// Mittwoch, 2026-07-01 -> Woche Mo 29.06. .. So 05.07.
const TODAY = '2026-07-01';

test('weeklyGoals: Defaults und Überschreibung', () => {
  assert.deepEqual(weeklyGoals({}), DEFAULT_GOALS);
  const g = weeklyGoals({ settings: { weeklyGoals: { activeMinutes: 200, trainingDays: 5 } } });
  assert.equal(g.activeMinutes, 200);
  assert.equal(g.trainingDays, 5);
  // ungültige Werte fallen auf Default zurück
  assert.equal(weeklyGoals({ settings: { weeklyGoals: { activeMinutes: -3 } } }).activeMinutes, 150);
});

test('weekActivity zählt nur die laufende Woche, Minuten und eindeutige Tage', () => {
  const sessions = [
    { id: 'a', date: '2026-06-29', durationSec: 1800 },   // Mo, 30 min
    { id: 'b', date: '2026-07-01', distanceKm: 10 },       // Mi, 10 km -> 60 min
    { id: 'c', date: '2026-07-01', durationSec: 600 },     // Mi (selber Tag), 10 min
    { id: 'd', date: '2026-06-20', durationSec: 3600 },    // letzte Woche -> ignoriert
    { id: 'e', date: '2026-07-01', durationSec: 600, deleted: true }, // gelöscht
  ];
  const a = weekActivity(sessions, TODAY);
  assert.equal(a.activeMinutes, 30 + 60 + 10); // 100
  assert.equal(a.trainingDays, 2);             // Mo + Mi
});

test('latestWeight nimmt den jüngsten gültigen Wert', () => {
  const health = [
    { date: '2026-05-01', weight: 72 },
    { date: '2026-06-15', weight: 70 },
    { date: '2026-06-10', weight: 71, deleted: true },
  ];
  assert.equal(latestWeight(health), 70);
  assert.equal(latestWeight([]), null);
});

test('goalProgress: Ringe für Minuten und Tage, allMet-Flag', () => {
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

test('goalProgress: Gewichtsfortschritt (Richtung & Differenz)', () => {
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
  assert.equal(p.weight.direction, 'down'); // muss noch runter
  assert.equal(p.weight.reached, false);
});

test('goalProgress: kein Gewicht ohne Zielgewicht oder Messwert', () => {
  assert.equal(goalProgress({ profile: {}, health: [{ date: '2026-06-20', weight: 70 }], today: TODAY }).weight, null);
  assert.equal(goalProgress({ profile: { targetWeightKg: 65 }, health: [], today: TODAY }).weight, null);
});
