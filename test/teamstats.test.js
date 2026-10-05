/* Tests for the team/family metrics (js/teamstats.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamMonthKm, teamWeekActivity, teamUpcomingRaces, teamAchievements, teamLoad } from '../js/teamstats.js';
import { useHrReference } from '../js/load.js';
import { evaluateBadges, BADGES, TRAINING_BADGE_CATS } from '../js/badges.js';

const TODAY = '2026-06-15';
const members = () => [
  { id: 'a', name: 'Alex', color: '#18b48a', emoji: '🏃', shareMetrics: true, shareGoal: true,
    sessions: [{ id: 's1', date: '2026-06-15', distanceKm: 10 }, { id: 's2', date: '2026-06-05', distanceKm: 8 }, { id: 's3', date: '2026-05-30', distanceKm: 5 }],
    events: [{ id: 'e1', name: 'City Run', date: '2026-08-01' }], plans: [] },
  { id: 'b', name: 'Bea', color: '#3d8bff', emoji: '🦊', shareMetrics: false, shareGoal: false,
    sessions: [{ id: 's4', date: '2026-06-15', distanceKm: 6 }],
    events: [{ id: 'e2', name: 'Geheimlauf', date: '2026-07-01' }], plans: [] },
  { id: 'c', name: 'Cara', color: '#ff8a3d', emoji: '⚡', shareMetrics: true, shareGoal: true,
    sessions: [],
    events: [{ id: 'e3', name: 'Marathon', date: '2026-06-20', priority: 'A' }], plans: [] },
];

test('teamMonthKm: anonymous monthly total (previous month excluded) + milestone', () => {
  const r = teamMonthKm(members(), TODAY);
  assert.equal(r.km, 24);           // 10 + 8 + 6 (the May run does not count)
  assert.equal(r.milestone, 50);    // next milestone above 24
  assert.ok(Math.abs(r.pct - 0.48) < 1e-9);
});

test('teamWeekActivity: trained status, most active person, shareMetrics hidden', () => {
  const r = teamWeekActivity(members(), TODAY);
  const ids = r.rows.map((x) => x.id);
  assert.deepEqual(ids, ['a', 'c']);             // Bea (shareMetrics:false) is missing
  assert.equal(r.rows.find((x) => x.id === 'a').trained, true);
  assert.equal(r.rows.find((x) => x.id === 'c').trained, false);
  assert.equal(r.mostActiveId, 'a');
});

test('teamUpcomingRaces: sorted by date, shareGoal & past excluded', () => {
  const r = teamUpcomingRaces(members(), TODAY);
  assert.deepEqual(r.map((x) => x.name), ['Marathon', 'City Run']); // 06-20 before 08-01
  assert.ok(!r.some((x) => x.memberName === 'Bea'));                  // shareGoal:false
});

test('teamUpcomingRaces: programmes and completed events drop out', () => {
  const m = [{ id: 'x', name: 'X', shareGoal: true, events: [
    { id: 'p', name: 'Programm', date: '2026-07-01', kind: 'program' },
    { id: 'done', name: 'Vorbei', date: '2026-07-02', status: 'abgeschlossen' },
    { id: 'ok', name: 'Echt', date: '2026-07-03' },
  ] }];
  assert.deepEqual(teamUpcomingRaces(m, TODAY).map((x) => x.name), ['Echt']);
});

test('teamAchievements: badge total + longest weekly streak (holder only if shared)', () => {
  const ms = members();
  // Alex: 3 training days each in the two previous weeks (Mon, Wed, Fri) → weekly streak 2
  // (counted as "days in a row" it would be only 1 – 15.06.).
  ms[0].sessions.push(...['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12']
    .map((date, i) => ({ id: `w${i}`, date, distanceKm: 5, type: 'easy' })));
  const r = teamAchievements(ms, TODAY);
  assert.ok(r.badges >= 2, `at least 2 badges, was ${r.badges}`);
  assert.equal(r.longestStreak, 2);
  assert.equal(r.streakHolder, 'Alex');   // Alex shares metrics; Bea (hidden) would not appear by name
});

test('TRAIN-40: team counts only training badges (health/cycle are never reachable there)', () => {
  assert.ok(!TRAINING_BADGE_CATS.has('Gesundheit') && !TRAINING_BADGE_CATS.has('Zyklus'));
  const ms = members();
  const r = teamAchievements(ms, TODAY);
  const expected = ms.reduce((n, m) => n + evaluateBadges({ sessions: m.sessions, plans: m.plans, events: m.events, isProtectedDay: () => false }, TODAY)
    .filter((b) => b.unlocked && TRAINING_BADGE_CATS.has(b.cat)).length, 0);
  assert.equal(r.badges, expected);
  // Every category is either training or deliberately excluded – new categories stand out.
  const cats = new Set(BADGES.map((b) => b.cat));
  cats.forEach((c) => assert.ok(TRAINING_BADGE_CATS.has(c) || ['Gesundheit', 'Zyklus'].includes(c), `classify category ${c}`));
});

test('TRAIN-53: trainer view only with consent, load with the max HR of the respective person', () => {
  const T = '2026-09-29';
  const run = (d) => ({ id: `s${d}`, date: `2026-09-${String(29 - d).padStart(2, '0')}`, type: 'easy', durationSec: 3600, avgHr: 150, source: 'apple-health' });
  const sessions = [0, 2, 4].map(run);
  useHrReference(() => ({ maxHr: 200 }));   // the viewer – must not count
  try {
    const rows = teamLoad([
      { id: 'a', name: 'Anna', shareLoad: true, maxHr: 170, sessions, health: [{ date: '2026-09-28', energy: 4, mood: 6 }] },
      { id: 'b', name: 'Ben', shareLoad: true, maxHr: 200, sessions },
      { id: 'c', name: 'Cem', sessions },                                  // no consent
      { id: 'd', name: 'Dana', shareLoad: false, maxHr: 180, sessions },
    ], T);
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Anna', 'Ben']);
    const anna = rows.find((r) => r.name === 'Anna'), ben = rows.find((r) => r.name === 'Ben');
    assert.ok(anna.load7 > ben.load7, 'the same HR is more strenuous at a lower max HR');
    assert.deepEqual([anna.energy, anna.mood], [4, 6]);
    assert.equal(ben.energy, null);
  } finally { useHrReference(null); }
});
