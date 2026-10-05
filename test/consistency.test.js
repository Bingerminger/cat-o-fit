/* Consistency: the same key figure has the same value everywhere (package "One coach, one
   number"). Formerly the monthly report showed 82 %, statistics and the race page 93 %
   plan adherence for the same data; "running km" included cycling and walking depending
   on the view. Here statistics, achievements, race page, monthly report, "Today" and
   team dashboard are checked against each other with the same data. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays, weekStartMonday } from '../js/ui.js';
import { planStatus, adherence, runKm, loadBalance, keyMetrics } from '../js/fitness.js';
import { computeStats, momentum } from '../js/badges.js';
import { buildMonthReport } from '../js/report.js';
import { teamAchievements } from '../js/teamstats.js';

const T = '2026-06-24';   // Wednesday; month June, statistics window: 27.05.–24.06.
beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

function data() {
  const u = (id, date, status, extra = {}) => ({ id, date, type: 'easy', title: id, status, ...extra });
  const plan = { id: 'p1', eventId: 'e1', startDate: '2026-06-01', units: [
    u('a', '2026-06-02', 'erledigt'), u('b', '2026-06-04', 'erledigt'), u('c', '2026-06-06', 'verpasst', { missedReason: 'time' }),
    u('d', '2026-06-09', 'erledigt'), u('e', '2026-06-11', 'verpasst', { missedReason: 'sick' }),   // illness: neutral
    u('f', '2026-06-13', 'erledigt'), u('g', '2026-06-16', 'erledigt'), u('h', '2026-06-18', 'geplant'), // overdue
    u('i', '2026-06-20', 'erledigt'), u('r', '2026-06-21', 'geplant', { type: 'rest' }),
    u('j', '2026-06-24', 'geplant'),                                       // today, still open: not due
    u('k', '2026-06-26', 'geplant'), u('l', '2026-06-28', 'geplant'),     // future: not due
  ] };
  const sessions = [
    { id: 's1', date: '2026-06-02', type: 'easy', distanceKm: 8, durationSec: 2880 },
    { id: 's2', date: '2026-06-22', type: 'easy', distanceKm: 10, durationSec: 3600 },
    { id: 's3', date: '2026-06-23', type: 'cross_bike', distanceKm: 40, durationSec: 5400 },
    { id: 's4', date: '2026-06-20', type: 'walk', distanceKm: 6, durationSec: 4000 },
  ];
  return { plans: [plan], sessions };
}

test('Plan adherence: statistics, achievements, race page and monthly report show the same value', () => {
  const { plans, sessions } = data();
  // due: a b c d f g h i (e ill, r rest day, j today, k/l future) → 6 of 8 = 75 %
  const statistik = planStatus({ plans, sessions, today: T }).adherence;
  const erfolge = computeStats({ plans, sessions }, T).adherence;
  const wettkampf = adherence(plans, { today: T }).pct;
  const bericht = buildMonthReport({ plans, sessions, monthStr: '2026-06', today: T })
    .sections[0].items.find((i) => i.label === 'Plan-Einhaltung').value;
  assert.equal(statistik, 75);
  assert.equal(erfolge, 75);
  assert.equal(wettkampf, 75);
  assert.equal(bericht, '75 % (6/8)');
});

test('Plan adherence: the rate does not drop in the morning (the session of today is not due yet)', () => {
  const { plans } = data();
  const morning = adherence(plans, { today: T }).pct;
  const withoutToday = [{ ...plans[0], units: plans[0].units.filter((x) => x.id !== 'j') }];
  assert.equal(morning, adherence(withoutToday, { today: T }).pct, 'the open session of today changes nothing');
  const done = [{ ...plans[0], units: plans[0].units.map((x) => (x.id === 'j' ? { ...x, status: 'erledigt' } : x)) }];
  assert.ok(adherence(done, { today: T }).pct > morning, 'only the completed session counts – then positive');
});

test('Running km: statistics, "Today", monthly report and key figure count runs only', () => {
  const { sessions } = data();
  const ws = weekStartMonday(T);
  assert.equal(runKm(sessions, ws, addDays(ws, 6)), 10);                    // "Today": week 22–28.06.
  assert.equal(loadBalance(sessions, T).last7, 10);                          // statistics "Running km · 7 days"
  const bericht = buildMonthReport({ sessions, plans: [], monthStr: '2026-06', today: T }).sections[0].items;
  assert.equal(bericht.find((i) => i.label === 'Gelaufene Kilometer').value, '18 km');
  assert.equal(bericht.find((i) => /Weitere Kilometer/.test(i.label)).value, '46 km');
  assert.equal(keyMetrics({ sessions, today: T }).find((m) => m.key === 'weeklyKm').value, 4.5);   // 18 km / 4 weeks
});

test('Weekly streak and momentum: own view and team dashboard agree', () => {
  const { plans, sessions } = data();
  const more = [...sessions, ...['2026-06-15', '2026-06-17', '2026-06-19', '2026-06-08', '2026-06-10', '2026-06-12']
    .map((date, i) => ({ id: `x${i}`, date, type: 'easy', distanceKm: 5 }))];
  const own = computeStats({ plans, sessions: more }, T).streak;
  const team = teamAchievements([{ id: 'm', name: 'M', shareMetrics: true, sessions: more, plans, events: [] }], T).longestStreak;
  assert.ok(own >= 2);
  assert.equal(team, own);
  // Momentum: same data, same number – identical even without cycle data (team).
  assert.equal(momentum({ plans, sessions: more, isProtectedDay: () => false }, T).score, momentum({ plans, sessions: more }, T).score);
});

test('TRAIN-27: monthly report before the end of the month – future sessions do not permanently depress adherence', () => {
  const { plans, sessions } = data();
  const pctOf = (today) => buildMonthReport({ plans, sessions, monthStr: '2026-06', today })
    .sections[0].items.find((i) => i.label === 'Plan-Einhaltung').value;
  // Sealed on 24.06.: only the sessions due by then (formerly 6/12 incl. future).
  assert.equal(pctOf(T), '75 % (6/8)');
  // After the end of the month the whole month counts (j, k, l are then missed).
  assert.equal(pctOf('2026-07-05'), '55 % (6/11)');
});
