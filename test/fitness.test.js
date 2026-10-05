/* Unit tests for js/fitness.js — traffic-light status, training load, missed reasons,
   key figures with target values. today is passed in -> date-independent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBalance, missedBreakdown, planStatus, keyMetrics, activityMatrix, trainingLoad, recentLongRunKm, footballRpe, sessionLoad } from '../js/fitness.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';
const run = (n, km, extra = {}) => ({ date: addDays(T, -n), type: 'easy', distanceKm: km, ...extra });

test('loadBalance: stable, high, low, unclear', () => {
  // 28 days the same every day -> ratio 1
  const even = [];
  for (let n = 0; n < 28; n++) even.push(run(n, 5));
  const lb = loadBalance(even, T);
  assert.equal(lb.level, 'ok');

  assert.equal(loadBalance([], T).level, 'unklar');

  // last week much more than the average of the three weeks before -> high
  const spike = [run(1, 40), run(10, 5), run(17, 5), run(24, 5), run(27, 5)];
  assert.equal(loadBalance(spike, T).level, 'hoch');

  // last week almost nothing -> low
  const taper = [run(2, 2), run(10, 30), run(17, 30), run(24, 30), run(27, 30)];
  assert.equal(loadBalance(taper, T).level, 'niedrig');
});

test('TRAIN-10: level "aufbau" in the first 4 weeks – no red traffic light for beginners', () => {
  // Beginner: 6 easy runs in 12 days, no older history.
  const newbie = [0, 2, 4, 7, 9, 11].map((n) => run(n, 5, { rpe: 4 }));
  const lb = loadBalance(newbie, T);
  assert.equal(lb.level, 'aufbau');
  assert.equal(lb.sparse, true);
  const st = planStatus({ plans: [], sessions: newbie, today: T });
  assert.notEqual(st.level, 'rot');
  assert.ok(!st.reasons.some((r) => /deutlich über/.test(r.text)), 'no overload warning');
  assert.ok(st.reasons.some((r) => /Datenbasis wächst/.test(r.text)));
});

test('TRAIN-44: the easy-pace metric counts only runs in Z2 – runs that are too fast do not count as progress', () => {
  const profile = { hrZones: [{ zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }, { zone: 3, min: 133, max: 152 }] };
  // 4–8 weeks ago: 6:00 min/km in Z2. Now: 5:00 min/km – but with HR 150 (Z3, not easy).
  const before = [30, 35, 40].map((n) => run(n, 10, { durationSec: 3600, avgHr: 128 }));
  const now = [2, 6, 10].map((n) => run(n, 10, { durationSec: 3000, avgHr: 150 }));
  const nowZ2 = [3].map((n) => run(n, 10, { durationSec: 3480, avgHr: 130 }));
  const m = keyMetrics({ profile, sessions: [...before, ...now, ...nowZ2], today: T }).find((x) => x.key === 'easyPace');
  assert.equal(Math.round(m.value), 348, 'only the Z2 run counts (5:48 instead of an average with the runs that were too fast)');
  assert.match(m.hint, /Z2/);
  // Without HR zones: value yes, verdict no.
  const noHr = keyMetrics({ sessions: [...before, ...now], today: T }).find((x) => x.key === 'easyPace');
  assert.equal(noHr.good, null);
  assert.match(noHr.hint, /ohne Herzfrequenz/);
});

test('TRAIN-25: running km count runs only (not cycling, walking, swimming)', () => {
  const mixed = [run(1, 8), { date: addDays(T, -2), type: 'cross_bike', distanceKm: 40 }, { date: addDays(T, -3), type: 'walk', distanceKm: 10 }, { date: addDays(T, -4), type: 'swim', distanceKm: 2 }];
  const lb = loadBalance(mixed, T);
  assert.equal(lb.last7, 8);
  assert.equal(lb.last28, 8);
  const wk = keyMetrics({ sessions: mixed, today: T }).find((m) => m.key === 'weeklyKm');
  assert.equal(wk.value, 2);                  // 8 km / 4 weeks
});

test('missedBreakdown: counts by reason and only within the window', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), status: 'verpasst', missedReason: 'injured' },
    { date: addDays(T, -3), status: 'verpasst', missedReason: 'sick' },
    { date: addDays(T, -4), status: 'verpasst' }, // without reason -> other
    { date: addDays(T, -5), status: 'erledigt' }, // not missed
    { date: addDays(T, -40), status: 'verpasst', missedReason: 'time' }, // outside 28d
  ] }];
  const m = missedBreakdown(plans, T, 28);
  assert.equal(m.total, 3);
  assert.equal(m.byReason.injured, 1);
  assert.equal(m.byReason.sick, 1);
  assert.equal(m.byReason.other, 1);
  assert.equal(m.byReason.time, 0);
});

test('planStatus: green with good adherence and stable load', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -4), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -6), type: 'tempo', status: 'erledigt' },
    { date: addDays(T, -8), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -9), type: 'long', status: 'erledigt' },
  ] }];
  const sessions = [];
  for (let n = 0; n < 28; n += 7) sessions.push(run(n, 10));
  const st = planStatus({ plans, sessions, today: T });
  assert.equal(st.level, 'gruen');
  assert.equal(st.adherence, 100);
});

test('TRAIN-26: injury and illness absences are neutral (adherence, traffic light)', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'verpasst', missedReason: 'injured' },
    { date: addDays(T, -4), type: 'easy', status: 'verpasst', missedReason: 'sick' },
    { date: addDays(T, -6), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -8), type: 'easy', status: 'erledigt' },
  ] }];
  const st = planStatus({ plans, sessions: [], today: T });
  assert.equal(st.adherence, 100, 'only the completed ones count as due');
  assert.equal(st.level, 'gruen');
  assert.ok(st.reasons.some((r) => /verletzungsbedingt/.test(r.text) && /nicht gegen dich/.test(r.text)));
});

test('planStatus: protected days do not count against adherence', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -3), type: 'easy', status: 'offen' }, // protected -> no penalty
  ] }];
  const isProtectedDay = (d) => d === addDays(T, -3);
  const st = planStatus({ plans, sessions: [], today: T, isProtectedDay });
  assert.equal(st.adherence, 100);
});

test('keyMetrics: weight towards target — decreasing is good', () => {
  const health = [
    { date: addDays(T, -30), weight: 70 },
    { date: addDays(T, -1), weight: 68 },
  ];
  const profile = { targetWeightKg: 65 };
  const m = keyMetrics({ profile, health, sessions: [], today: T }).find((x) => x.key === 'weight');
  assert.equal(m.dir, 'down');
  assert.equal(m.good, true);     // above target + decreasing = good
  assert.equal(m.goal, 'verbessern');
});

test('keyMetrics: at target weight -> hold', () => {
  const health = [{ date: addDays(T, -1), weight: 65.2 }];
  const m = keyMetrics({ profile: { targetWeightKg: 65 }, health, sessions: [], today: T }).find((x) => x.key === 'weight');
  assert.equal(m.goal, 'halten');
  assert.equal(m.good, true);
});

test('trainingLoad: load points of all sports in the 7-day window', () => {
  const sessions = [
    { date: T, type: 'easy', durationSec: 3600 },                  // 60 min × RPE 4 = 240
    { date: addDays(T, -1), type: 'strength', durationSec: 2400 }, // 40 min × 5 = 200
    { date: addDays(T, -3), type: 'cross_football', durationSec: 5400 }, // 90 min × 7 = 630 (football "normal", #5)
    { date: addDays(T, -10), type: 'easy', durationSec: 3600 },    // outside 7 days
  ];
  assert.equal(trainingLoad(sessions, T, 7), 240 + 200 + 630);
});

test('trainingLoad: recorded RPE beats the type default', () => {
  assert.equal(trainingLoad([{ date: T, type: 'easy', durationSec: 3600, rpe: 8 }], T, 7), 480); // 60 × 8
});

test('footballRpe: intensity leicht/normal/intensiv (#5)', () => {
  assert.equal(footballRpe('leicht'), 5);
  assert.equal(footballRpe('normal'), 7);
  assert.equal(footballRpe('intensiv'), 8.5);
  assert.equal(footballRpe(undefined), 7);   // default = normal
  assert.equal(footballRpe('quatsch'), 7);
});

test('sessionLoad: football uses the intensity when no RPE was recorded (#5)', () => {
  const min60 = { type: 'cross_football', durationSec: 3600 };
  assert.equal(sessionLoad({ ...min60, intensity: 'intensiv' }), 510); // 60 × 8.5
  assert.equal(sessionLoad({ ...min60, intensity: 'leicht' }), 300);   // 60 × 5
  assert.equal(sessionLoad(min60), 420);                                // without a value: normal (60 × 7)
  assert.equal(sessionLoad({ ...min60, intensity: 'intensiv', rpe: 6 }), 360); // recorded RPE beats intensity
});

test('recentLongRunKm: longest run in the window, excluding non-runs', () => {
  const sessions = [
    { date: T, type: 'long', distanceKm: 16 },
    { date: addDays(T, -5), type: 'easy', distanceKm: 10 },
    { date: addDays(T, -40), type: 'long', distanceKm: 22 },     // outside 28 days
    { date: T, type: 'strength', distanceKm: 99 },               // not a run
  ];
  assert.equal(recentLongRunKm(sessions, T), 16);
  assert.equal(recentLongRunKm([], T), 0);
});

test('activityMatrix: 53 weeks × 7 days, level by minutes', () => {
  const sessions = [
    { date: T, durationSec: 1200 },             // 20 min -> Level 1
    { date: addDays(T, -1), durationSec: 4500 },// 75 min -> Level 3
    { date: addDays(T, -2), distanceKm: 10 },   // 10 km -> 60 min -> Level 3
  ];
  const m = activityMatrix({ sessions, today: T });
  assert.equal(m.cols.length, 53);
  m.cols.forEach((c) => assert.equal(c.days.length, 7));
  const todayCell = m.cols.flatMap((c) => c.days).find((d) => d.date === T);
  assert.equal(todayCell.minutes, 20);
  assert.equal(todayCell.level, 1);
  assert.equal(m.activeDays, 3);
});

test('activityMatrix: future days are marked (level -1)', () => {
  const WED = '2026-06-24'; // Wednesday -> Thu–Sun of the current week are in the future
  const m = activityMatrix({ sessions: [], today: WED });
  const future = m.cols.flatMap((c) => c.days).filter((d) => d.date > WED);
  assert.ok(future.length > 0);
  assert.ok(future.every((d) => d.level === -1 && d.future));
});

test('keyMetrics: resting HR down = good, empty input = []', () => {
  const health = [
    { date: addDays(T, -25), restingHr: 58 },
    { date: addDays(T, -1), restingHr: 54 },
  ];
  const m = keyMetrics({ health, sessions: [], today: T }).find((x) => x.key === 'restingHr');
  assert.equal(m.dir, 'down');
  assert.equal(m.good, true);
  assert.deepEqual(keyMetrics({ today: T }), []);
});
