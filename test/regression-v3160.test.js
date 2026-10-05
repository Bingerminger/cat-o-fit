/* =========================================================================
   Regression tests for the v3.16.0 review — each test pins down exactly one of the
   defects found back then, so that it does not return.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayStr, effectiveStatus } from '../js/ui.js';
import { unitsInWeek, isOpen, mergeRegeneratedWeek, findMakeupDay } from '../js/planflow.js';
import { weekUnits } from '../js/triage.js';
import { weekPlan } from '../js/whatif.js';
import { acwr, monotonyStrain, loadSummary, formSeries } from '../js/load.js';
import { restDaySuggestion } from '../js/rolling.js';
import { loadBalance } from '../js/fitness.js';
import { makePhases, buildWeekUnits, supportRunKm, DEFAULT_WEEK_TEMPLATE } from '../js/plans.js';

const T = '2026-06-17'; // Wednesday

/* ---- Moved units still count towards the load ------------------ */

test('v3.16.0: a moved unit stays visible in weekly load, triage and what-if', () => {
  // Legacy data: status "verschoben" (set before v3.16.0) on the new date.
  const units = [
    { id: 'a', date: '2026-06-16', type: 'tempo', status: 'verschoben', targetDistanceKm: 10 },
    { id: 'b', date: '2026-06-18', type: 'easy', status: 'geplant', targetDistanceKm: 8 },
  ];
  assert.equal(unitsInWeek(units, T).length, 2, 'weekly load counts the moved unit');
  assert.equal(weekUnits(units, T).length, 2, 'triage sees the moved unit');
  assert.equal(weekPlan(units, T).count, 2, 'what-if includes it');
  assert.ok(isOpen(units[0]), 'moved counts as open/changeable');
});

test('v3.16.0: a day with a moved unit no longer counts as free', () => {
  const units = [{ id: 'a', date: addDays(T, 2), type: 'tempo', status: 'verschoben' }];
  const day = findMakeupDay(units, { id: 'x' }, T, 7);
  assert.notEqual(day, addDays(T, 2), 'an occupied day is not suggested as a make-up day');
});

test('v3.16.0: movedFrom controls only the display, not the calculation', () => {
  const u = { id: 'a', date: addDays(T, 1), type: 'tempo', status: 'geplant', movedFrom: T };
  assert.equal(effectiveStatus(u, T), 'verschoben', 'chip still shows "Moved"');
  assert.equal(unitsInWeek([u], T).length, 1, 'still counts towards the weekly load');
});

/* ---- Plan generator ----------------------------------------------------- */

test('v3.16.0: long-run start follows the level, not half the race distance', () => {
  // Marathon, 16 weeks from Mon 15.06., race Sat 03.10.
  const event = { id: 'e1', date: '2026-10-03', distanceKm: 42.195 };
  const mk = (extra) => ({ id: 'p', eventId: 'e1', startDate: '2026-06-15', weeks: 16, phases: makePhases(16), weekTemplate: DEFAULT_WEEK_TEMPLATE, commitments: [], ...extra });
  const long1 = (plan) => buildWeekUnits(plan, event, {}, 1).find((u) => u.type === 'long').targetDistanceKm;
  // Without history (beginner): used to be 21.1 km in week 1.
  const noHistory = long1(mk({ level: 'einsteiger' }));
  assert.ok(noHistory <= 12, `conservative start without history, was ${noHistory}`);
  // With history the start begins at the actual level …
  const withHistory = long1(mk({ baseLongKm: 24 }));
  assert.ok(withHistory >= 20 && withHistory <= 32, `Start close to the history, was ${withHistory}`);
  // … but never beyond the peak distance.
  assert.ok(long1(mk({ baseLongKm: 40 })) <= 35);
});

test('v3.16.0: short plans always end with a taper week', () => {
  for (const weeks of [2, 3, 4, 8, 16]) {
    const phases = makePhases(weeks);
    assert.equal(phases.at(-1).key, 'taper', `${weeks} weeks: last phase is tapering`);
    assert.equal(phases.at(-1).endWeek, weeks);
    assert.equal(phases[0].startWeek, 1);
  }
});

test('v3.16.0: a fixed appointment displaces the key unit instead of deleting it', () => {
  const plan = {
    id: 'p1', startDate: '2026-06-15', weeks: 4, eventId: 'e1',
    phases: makePhases(4), weekTemplate: DEFAULT_WEEK_TEMPLATE,
    // Football Tue + Thu – exactly the days of the key unit and the volume run.
    commitments: [
      { id: 'c1', type: 'cross_football', dow: 2, durationMin: 90, intensity: 'normal' },
      { id: 'c2', type: 'cross_football', dow: 4, durationMin: 90, intensity: 'normal' },
    ],
  };
  const event = { id: 'e1', date: '2026-07-12', distanceKm: 21.0975 };
  const units = buildWeekUnits(plan, event, {}, 1);
  const types = units.map((u) => u.type);
  assert.ok(types.includes('cross_football'), 'fixed appointments are in the plan');
  assert.ok(units.some((u) => u.relocatedFrom), 'displaced unit was moved, not deleted');
  // The key stimulus (quality -> tempo/easy/interval) must not go missing without replacement.
  assert.ok(units.some((u) => ['tempo', 'interval', 'easy'].includes(u.type)),
    'running units are kept despite two appointment days');
  // No day carries both a fixed appointment and a displaced unit.
  const commitDates = new Set(units.filter((u) => u.fixed).map((u) => u.date));
  assert.ok(!units.some((u) => !u.fixed && commitDates.has(u.date)), 'no double on an appointment day');
});

/* ---- Load metrics --------------------------------------------- */

test('v3.16.0: a young history produces no ACWR false alarm', () => {
  // Data for only 5 days: arithmetically high ACWR, but no real load spike.
  const sessions = [
    { date: addDays(T, -4), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: addDays(T, -2), type: 'tempo', durationSec: 3600, rpe: 8 },
    { date: T, type: 'long', durationSec: 5400, rpe: 6 },
  ];
  const a = acwr(sessions, T);
  assert.equal(a.sparse, true, 'incomplete history is detected');
  assert.equal(a.zone, 'aufbau');
  assert.equal(loadSummary(sessions, T).hasData, false, 'card does not assess yet');
  // With an open hard unit on the horizon – otherwise the test could never turn red.
  const plan = { units: [{ id: 'hard', date: addDays(T, 1), type: 'interval', status: 'geplant' }] };
  assert.equal(restDaySuggestion({ plan, sessions, today: T }), null,
    'no automatic recovery day while the data base is still building up');
});

test('v3.16.0: form is not permanently negative under constant load (CTL warm-up)', () => {
  // Half a year of the same load every day -> fitness and fatigue in balance.
  const sessions = [];
  for (let i = 0; i < 200; i++) sessions.push({ date: addDays(T, -i), type: 'easy', durationSec: 3600, rpe: 5 });
  const last = formSeries(sessions, T, { days: 7 }).at(-1);
  assert.ok(Math.abs(last.form) < 12, `Form close to zero instead of artificially negative, was ${last.form}`);
  assert.ok(last.ctl > 250, `Fitness settled, was ${last.ctl}`);
});

test('v3.16.0: the statistics traffic light measures all sports (sRPE), not just running km', () => {
  // Strength and football without km: the load used to stay completely invisible here.
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push({ date: addDays(T, -i), type: 'strength', durationSec: 1800 });
  for (let i = 0; i < 7; i++) sessions.push({ date: addDays(T, -i), type: 'cross_football', durationSec: 5400, intensity: 'intensiv' });
  const lb = loadBalance(sessions, T);
  assert.equal(lb.last7, 0, 'no running km present');
  assert.ok(lb.ratio > 1.3 && lb.level === 'hoch', `Load spike detected (ratio ${lb.ratio})`);
});

test('v3.16.0: monotony uses the sample standard deviation (Foster)', () => {
  const sessions = [
    { date: addDays(T, -1), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: T, type: 'easy', durationSec: 3600, rpe: 5 },
  ];
  const m = monotonyStrain(sessions, T);
  // 2 days at 300, 5 days at 0: mean 85.7; SD(n-1) ≈ 141.4 -> monotony ≈ 0.61.
  assert.ok(m.monotony > 0.55 && m.monotony < 0.68, `Monotony ≈ 0.61, was ${m.monotony}`);
});

/* ---- Weekly volume scales with the level (v3.17.0) --------------------- */

test('v3.17.0: support runs scale with the long run instead of a fixed 8–9 km', () => {
  // Beginner (long run 10 km) vs. advanced runner (long run 30 km).
  assert.equal(supportRunKm(10, 0.5), 5);
  assert.equal(supportRunKm(30, 0.5), 15);
  // Limits apply: never below min, never above max.
  assert.equal(supportRunKm(4, 0.5, { min: 5, max: 16 }), 5);
  assert.equal(supportRunKm(40, 0.5, { min: 5, max: 16 }), 16);
  // Without a reference value, the minimum.
  assert.equal(supportRunKm(null, 0.5, { min: 5 }), 5);
});

test('v3.17.0: the weekly volume grows with the history', () => {
  const mkPlan = (baseLongKm) => ({
    id: 'p', startDate: '2026-06-15', weeks: 8, eventId: 'e1',
    phases: makePhases(8), weekTemplate: DEFAULT_WEEK_TEMPLATE, commitments: [], baseLongKm,
  });
  const event = { id: 'e1', date: '2026-08-09', distanceKm: 21.0975 };
  const km = (plan) => buildWeekUnits(plan, event, {}, 3)
    .filter((u) => ['easy', 'long', 'recovery'].includes(u.type))
    .reduce((a, u) => a + (u.targetDistanceKm || 0), 0);
  const beginner = km(mkPlan(null));
  const advanced = km(mkPlan(20));
  assert.ok(advanced > beginner * 1.3,
    `experienced runners get clearly more volume (${beginner} vs. ${advanced} km)`);
});

/* ---- Plan history ------------------------------------------------------ */

test('v3.16.0: regenerating keeps done units', () => {
  const existing = [
    { id: 'done', date: '2026-06-15', type: 'tempo', status: 'erledigt', executedSessionId: 's1' },
    { id: 'open', date: '2026-06-17', type: 'easy', status: 'geplant' },
  ];
  const fresh = [
    { id: 'n1', date: '2026-06-15', type: 'interval', status: 'geplant' },
    { id: 'n2', date: '2026-06-17', type: 'long', status: 'geplant' },
  ];
  const merged = mergeRegeneratedWeek(existing, fresh);
  const kept = merged.find((u) => u.id === 'done');
  assert.ok(kept, 'done unit survives regeneration');
  assert.equal(kept.executedSessionId, 's1', 'link to the session stays');
  assert.ok(!merged.some((u) => u.id === 'n1'), 'no duplicate on the same day');
  assert.ok(merged.some((u) => u.id === 'n2'), 'open days are planned afresh');
});
