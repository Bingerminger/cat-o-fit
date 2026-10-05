/* Unit tests for key figures, badges and momentum (js/badges.js).
   today is passed explicitly. The cycle module stays off so that
   isProtectedDay() is deterministically false (no protected days). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';
import { computeStats, evaluateBadges, momentum, BADGES, alcoholFreeStreak, softWrap } from '../js/badges.js';

const T = '2026-06-28';
beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('computeStats: empty data -> zero values', () => {
  const s = computeStats({}, T);
  assert.equal(s.totalSessions, 0);
  assert.equal(s.totalKm, 0);
  assert.equal(s.streak, 0);
  assert.equal(s.adherence, 0);
  assert.equal(s.raceFinished, false);
});

test('computeStats: sums, longest run, quality sessions', () => {
  const s = computeStats({
    sessions: [
      { date: '2026-06-10', distanceKm: 10, type: 'easy' },
      { date: '2026-06-12', distanceKm: 21, type: 'long' },
      { date: '2026-06-14', distanceKm: 8, type: 'interval' },
      { date: '2026-06-16', distanceKm: 9, type: 'tempo' },
      { date: '2026-06-18', distanceKm: 5, type: 'easy', deleted: true }, // does not count
    ],
  }, T);
  assert.equal(s.totalSessions, 4);
  assert.equal(s.totalKm, 48);
  assert.equal(s.longestRun, 21);
  assert.equal(s.intervalCount, 1);
  assert.equal(s.qualityCount, 2); // tempo + interval
});

// T = Sun 28.06.2026. Three training days per week with rest days in between.
const week3 = (monday) => [0, 2, 5].map((d) => ({ date: addDays(monday, d), distanceKm: 6, type: 'easy' }));

test('TRAIN-39: weekly streak – rest days preserve the streak', () => {
  // Three weeks with 3 training days each (Mon, Wed, Sat) – never two days in a row.
  const sessions = [...week3('2026-06-08'), ...week3('2026-06-15'), ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions }, T).streak, 3);
  // A week with only 2 training days breaks the streak.
  const broken = [...week3('2026-06-08'), { date: '2026-06-15', type: 'easy' }, { date: '2026-06-17', type: 'easy' }, ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions: broken }, T).streak, 1);
  // The current week does not break the streak while it is still running (only 1 training day so far).
  const running = [...week3('2026-06-08'), ...week3('2026-06-15'), { date: '2026-06-22', type: 'easy' }];
  assert.equal(computeStats({ sessions: running }, T).streak, 2);
});

test('TRAIN-39: an absence due to illness pauses the weekly streak instead of breaking it', () => {
  const sessions = [...week3('2026-06-08'), { date: '2026-06-15', type: 'easy' }, ...week3('2026-06-22')];
  const plans = [{ units: [{ date: '2026-06-17', type: 'easy', status: 'verpasst', missedReason: 'sick' }] }];
  assert.equal(computeStats({ sessions, plans }, T).streak, 2, 'week with illness does not count, but does not break the streak');
  const time = [{ units: [{ date: '2026-06-17', type: 'easy', status: 'verpasst', missedReason: 'time' }] }];
  assert.equal(computeStats({ sessions, plans: time }, T).streak, 1, 'missed reason "time" breaks the streak');
});

test('TRAIN-39: streak badges demand weeks, not days without a rest day', () => {
  const ids = BADGES.map((b) => b.id);
  assert.ok(!ids.includes('streak60') && !ids.includes('streak30'), 'no more days-in-a-row badges');
  const konstanz = BADGES.filter((b) => b.cat === 'Konstanz');
  assert.ok(konstanz.every((b) => /Wochen/.test(b.desc)));
  // 7 days in a row without a break give no higher tier than 3 days per week.
  const daily = Array.from({ length: 21 }, (_, i) => ({ date: addDays(T, -i), type: 'easy' }));
  const regular = [...week3('2026-06-08'), ...week3('2026-06-15'), ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions: daily }, T).streak, computeStats({ sessions: regular }, T).streak);
});

test('TRAIN-25: longest run counts runs only – the bike ride does not unlock a long-run badge', () => {
  const s = computeStats({ sessions: [{ date: T, type: 'cross_bike', distanceKm: 40 }, { date: T, type: 'easy', distanceKm: 8 }] }, T);
  assert.equal(s.longestRun, 8);
  assert.equal(evaluateBadges({ sessions: [{ date: T, type: 'cross_bike', distanceKm: 40 }] }, T).find((b) => b.id === 'long21').unlocked, false);
});

test('computeStats: plan adherence counts only due, non-protected days', () => {
  const s = computeStats({
    plans: [{ units: [
      { date: '2026-06-20', type: 'easy', status: 'erledigt' },
      { date: '2026-06-21', type: 'tempo', status: 'geplant' }, // due, open
      { date: '2026-06-22', type: 'rest', status: 'geplant' },  // rest day does not count
      { date: '2026-12-01', type: 'long', status: 'geplant' },  // future does not count
    ] }],
  }, T);
  assert.equal(s.adherence, 50); // 1 done out of 2 due
});

test('computeStats: race detected (session race or event completed)', () => {
  assert.equal(computeStats({ sessions: [{ date: T, type: 'race', distanceKm: 21 }] }, T).raceFinished, true);
  assert.equal(computeStats({ events: [{ status: 'abgeschlossen' }] }, T).raceFinished, true);
});

test('computeStats: a single completed MANUAL session does not trigger a "Perfect week"', () => {
  // Complete plan, week 1 (1–7 June). Generated session open, plus a manually created
  // session WITHOUT a `week` field (done, in the past).
  const plan = {
    id: 'p1', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'geplant' },   // week 1 incomplete
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' },            // manual, no week
    ],
  };
  // Without deriving the week from the date, m1 would land in the "undefined" bucket and count alone as
  // a perfect week – now it belongs to week 1, which is incomplete because of g1.
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, false);
});

test('computeStats: a truly complete week (incl. manual session) remains a "Perfect week"', () => {
  const plan = {
    id: 'p2', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'erledigt' },
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' }, // manual, no week
    ],
  };
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, true);
});

test('evaluateBadges: "First step" unlocks with the first workout', () => {
  const leer = evaluateBadges({}, T).find((b) => b.id === 'first');
  assert.equal(leer.unlocked, false);
  assert.equal(leer.progress, 0);
  const eins = evaluateBadges({ sessions: [{ date: T, distanceKm: 5, type: 'easy' }] }, T).find((b) => b.id === 'first');
  assert.equal(eins.unlocked, true);
  assert.equal(eins.progress, 1);
});

test('evaluateBadges: every badge delivers cur/target/progress in the valid range', () => {
  const all = evaluateBadges({ sessions: [{ date: T, distanceKm: 5, type: 'easy' }] }, T);
  assert.equal(all.length, BADGES.length);
  for (const b of all) {
    assert.ok(b.progress >= 0 && b.progress <= 1, `${b.id} progress in [0,1]`);
    assert.equal(b.unlocked, b.cur >= b.target);
  }
});

test('alcoholFreeStreak: days since the last alcohol day', () => {
  assert.equal(alcoholFreeStreak([], T), null);                        // never tracked -> no statement
  assert.equal(alcoholFreeStreak([{ date: T, alcohol: true }], T), 0); // drank today
  assert.equal(alcoholFreeStreak([{ date: addDays(T, -3), alcohol: true }], T), 3);
  // alcohol:false does not break the streak
  assert.equal(alcoholFreeStreak([{ date: addDays(T, -5), alcohol: true }, { date: T, alcohol: false }], T), 5);
});

test('momentum: base value, rises with activity, falls with omissions', () => {
  assert.equal(momentum({ sessions: [], plans: [] }, T).score, 42); // base
  // 3 training days in the same calendar week → weekly streak 1
  const aktiv = momentum({ sessions: [
    { date: T, distanceKm: 6, type: 'easy' }, { date: addDays(T, -1), distanceKm: 5, type: 'easy' }, { date: addDays(T, -2), distanceKm: 8, type: 'long' },
  ], plans: [] }, T);
  assert.equal(aktiv.score, 62); // 42 + 3*6 + min(1,10)*2
  assert.equal(aktiv.activeDays, 3);
  // one missed, due session deducts
  const schwach = momentum({ sessions: [], plans: [{ units: [{ date: addDays(T, -8), type: 'easy', status: 'geplant', week: 1 }] }] }, T);
  assert.equal(schwach.missed, 1);
  assert.equal(schwach.score, 34); // 42 - 8
});

test('TRAIN-39: momentum stops rising from the 6th training day of a week', () => {
  const fiveDays = [0, 1, 2, 3, 4].map((d) => ({ date: addDays('2026-06-22', d), type: 'easy' }));
  const sevenDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: addDays('2026-06-22', d), type: 'easy' }));
  assert.equal(momentum({ sessions: fiveDays, plans: [] }, T).activeDays, 5);
  assert.equal(momentum({ sessions: sevenDays, plans: [] }, T).activeDays, 5);
  assert.equal(momentum({ sessions: sevenDays, plans: [] }, T).score, momentum({ sessions: fiveDays, plans: [] }, T).score);
});

test('TRAIN-26: illness/injury pauses the momentum instead of deducting from it', () => {
  const sessions = [-9, -11, -13].map((d) => ({ date: addDays(T, d), type: 'easy' }));
  const base = momentum({ sessions, plans: [] }, T);
  const sick = [{ units: [-1, -3, -5].map((d) => ({ date: addDays(T, d), type: 'easy', status: 'verpasst', missedReason: 'sick' })) }];
  const m = momentum({ sessions, plans: sick }, T);
  assert.equal(m.missed, 0, 'absences due to illness deduct nothing');
  assert.ok(m.score >= base.score, `paused instead of dropped (${m.score} vs. ${base.score})`);
  assert.equal(m.paused, true);
  assert.match(m.message, /Pausiert/);
  const time = [{ units: [-1, -3, -5].map((d) => ({ date: addDays(T, d), type: 'easy', status: 'verpasst', missedReason: 'time' })) }];
  assert.equal(momentum({ sessions, plans: time }, T).missed, 3, 'missed reason "time" still counts as an omission');
});

test('Badges: every entry has a valid effort tier (tier 1–4)', () => {
  for (const b of BADGES) {
    assert.ok([1, 2, 3, 4].includes(b.tier), `${b.id} without a valid tier`);
    assert.ok(b.emoji && b.name && b.desc && typeof b.p === 'function');
  }
  // all ids unique
  const ids = BADGES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'badge IDs must be unique');
});

test('Sport badges unlock (swimming, rowing, variety)', () => {
  const T = '2026-06-29';
  const sessions = [
    { date: '2026-06-01', type: 'swim' },
    { date: '2026-06-02', type: 'rowing' },
    { date: '2026-06-03', type: 'tennis' },
    { date: '2026-06-04', type: 'hike' },
    { date: '2026-06-05', type: 'strength' },
  ];
  const badges = evaluateBadges({ sessions, plans: [], health: [], events: [], profile: {} }, T);
  const ok = (id) => badges.find((b) => b.id === id)?.unlocked;
  assert.equal(ok('swim1'), true);
  assert.equal(ok('row1'), true);
  assert.equal(ok('racket1'), true);  // tennis counts as a racket sport
  assert.equal(ok('hike1'), true);
  assert.equal(ok('variety5'), true); // 5 different kinds
});

test('Event badges: programme completed & Hyrox', () => {
  const T = '2026-06-29';
  const events = [
    { id: 'p', kind: 'program', status: 'abgeschlossen' },
    { id: 'h', name: 'Hyrox Berlin', sport: 'hyrox', status: 'abgeschlossen' },
  ];
  const badges = evaluateBadges({ sessions: [], plans: [], health: [], events, profile: {} }, T);
  assert.equal(badges.find((b) => b.id === 'program1')?.unlocked, true);
  assert.equal(badges.find((b) => b.id === 'hyrox')?.unlocked, true);
});

test('softWrap: soft hyphen before the head noun (UI-42)', () => {
  const z = '\u00ad';
  assert.equal(softWrap('Langstreckenliebe'), 'Langstrecken' + z + 'liebe');
  assert.equal(softWrap('Schlafchampion'), 'Schlaf' + z + 'champion');
  assert.equal(softWrap('Wochenheld:in'), 'Wochen' + z + 'held:in');
  assert.equal(softWrap('Vielseitig'), 'Vielseitig'); // no head-noun match
  assert.ok(!softWrap('Langstreckenliebe').includes('\u200b'), 'no line break without a hyphen any more');
});
