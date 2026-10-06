/* First day of the week (v4.1, U4): the person's choice (Monday, Saturday, Sunday) applies to everything
   shown – calendar, statistics, weekly goals, heatmap, the strip on "Today", streaks – and to NEW plans,
   which begin on that day. Existing plans keep their dates and their 7-day plan weeks; stored weekdays
   stay ISO (Mon = 1 … Sun = 7). Every test switches back to the default (Monday). */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { setUnits, METRIC } from '../js/units.js';
import {
  todayStr, addDays, parseDate, isoDow, weekStart, weekStartMonday, weekDows, nextWeekStart, dateOfDow,
  blockStart, weekRangeLabel,
} from '../js/ui.js';
import { weekdayNames } from '../js/format.js';
import { activityMatrix } from '../js/fitness.js';
import { heatmap } from '../js/charts.js';
import { weekActivity } from '../js/healthgoals.js';
import { weekStreak } from '../js/badges.js';
import { weeklyMedian } from '../js/health.js';
import { weekRange } from '../js/planflow.js';
import { weekPlan } from '../js/whatif.js';
import { weekUnits } from '../js/triage.js';
import { planWindow, generatePlanUnits, weekVolumes, volumeConfig, phaseForWeek, makePhases, raceOnlyLastWeek } from '../js/plangen.js';
import { createProgramPlan, buildProgramUnits } from '../js/program.js';
import * as plans from '../js/plans.js';
import * as calendar from '../js/calendar.js';
import * as dashboard from '../js/dashboard.js';
import * as statistics from '../js/statistics.js';

const SUN = 0, MON = 1, SAT = 6;
const useWeek = (ws) => setUnits({ ...METRIC, weekStart: ws });
const doc = globalThis.document;
// Fixed days: 2026-10-03 Saturday, 10-04 Sunday, 10-05 Monday, 10-07 Wednesday, 10-10 Saturday.
const WED = '2026-10-07';

function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
const texts = (view, sel) => view.querySelectorAll(sel).map((n) => n.textContent);
/** Dates and kinds of a plan's sessions – what must not move. */
const shape = (units) => units.map((u) => `${u.date}|${u.type}|${u.week}`).sort();

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events', 'nutrition', 'shopping', 'checklist', 'cycle'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', {});
  store.setProfile({ name: 'Alex', heightCm: 180, weightKg: 80, birthYear: 1990, sex: 'm' });
});
afterEach(() => setUnits(METRIC));

/* ------------------------------ Core helpers ------------------------------ */
test('weekStart: Sunday and Saturday starts; the default is the ISO Monday', () => {
  useWeek(SUN);
  assert.equal(weekStart(WED), '2026-10-04');
  assert.equal(weekStart('2026-10-04'), '2026-10-04');          // Sunday itself
  assert.equal(weekStart('2026-10-10'), '2026-10-04');          // Saturday is the last day
  useWeek(SAT);
  assert.equal(weekStart(WED), '2026-10-03');
  assert.equal(weekStart('2026-10-09'), '2026-10-03');          // Friday is the last day
  assert.equal(weekStart('2026-10-10'), '2026-10-10');
  setUnits(METRIC);
  for (let i = 0; i < 14; i++) {
    const d = addDays('2026-10-01', i);
    assert.equal(weekStart(d), weekStartMonday(d));
  }
});

test('weekDows, weekRangeLabel, nextWeekStart, dateOfDow and blockStart follow the first day', () => {
  const names = weekdayNames();
  assert.deepEqual(weekDows(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(weekRangeLabel(), `${names[1]}–${names[0]}`);
  assert.equal(nextWeekStart(WED), '2026-10-12');
  useWeek(SUN);
  assert.deepEqual(weekDows(), [7, 1, 2, 3, 4, 5, 6]);
  assert.equal(weekRangeLabel(), `${names[0]}–${names[6]}`);
  assert.equal(nextWeekStart(WED), '2026-10-11');
  assert.equal(nextWeekStart('2026-10-11'), '2026-10-11');      // already the first day
  useWeek(SAT);
  assert.deepEqual(weekDows(), [6, 7, 1, 2, 3, 4, 5]);
  assert.equal(nextWeekStart(WED), '2026-10-10');
  // ISO weekday inside the seven days from any start
  assert.equal(dateOfDow('2026-10-04', 7), '2026-10-04');       // Sunday start: Sunday is day 1
  assert.equal(dateOfDow('2026-10-04', 6), '2026-10-10');       // … and Saturday day 7
  assert.equal(dateOfDow('2026-10-05', 7), '2026-10-11');       // Monday start: Sunday is day 7
  // Plan weeks: 7-day blocks from the plan start, whatever the person's week
  assert.equal(blockStart('2026-10-18', '2026-10-12'), '2026-10-12');
  assert.equal(blockStart('2026-10-19', '2026-10-12'), '2026-10-19');
  assert.equal(blockStart('2026-10-18'), weekStart('2026-10-18'));
});

/* --------------------------------- Views --------------------------------- */
test('Calendar: weekday header and the 42-cell month grid start on the first day', () => {
  const names = weekdayNames();
  const first = (() => { const d = parseDate(todayStr()); d.setDate(1); return d; })();
  for (const ws of [SUN, SAT, MON]) {
    useWeek(ws);
    const view = setupShell();
    calendar.render(view);
    assert.deepEqual(texts(view, '.cal-grid__dow'), [0, 1, 2, 3, 4, 5, 6].map((i) => names[(ws + i) % 7]));
    const nums = texts(view, '.cal-cell__num');
    assert.equal(nums.length, 42);
    const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() - ws + 7) % 7));
    assert.equal(nums[0], String(gridStart.getDate()));
    assert.ok(nums.slice(0, 7).includes('1'), 'the 1st lies in the first row');
  }
});

test('Today: the week strip runs from the first day', () => {
  const names = weekdayNames();
  useWeek(SUN);
  const view = setupShell();
  dashboard.render(view);
  const dows = texts(view, '.week-strip__dow');
  assert.deepEqual(dows, [0, 1, 2, 3, 4, 5, 6].map((i) => names[i]));
  assert.ok(texts(view, '.week-strip__date').includes(String(parseDate(todayStr()).getDate())));
});

test('Heatmap: columns begin on the first day and the row labels follow', () => {
  const names = weekdayNames();
  useWeek(SUN);
  const m = activityMatrix({ sessions: [{ id: 's', date: '2026-10-04', type: 'easy', distanceKm: 5, durationSec: 1800 }], today: WED, weeks: 3 });
  assert.ok(m.cols.every((c) => parseDate(c.weekStart).getDay() === SUN && c.days[0].date === c.weekStart));
  assert.equal(m.cols.at(-1).weekStart, '2026-10-04');
  assert.ok(m.cols.at(-1).days[0].minutes > 0);                 // the Sunday session opens the current column
  const labels = heatmap(m).querySelectorAll('text').slice(0, 3).map((n) => n.textContent);
  assert.deepEqual(labels, [names[0], names[2], names[4]]);
  setUnits(METRIC);
  const iso = heatmap(activityMatrix({ sessions: [], today: WED, weeks: 3 })).querySelectorAll('text').slice(0, 3).map((n) => n.textContent);
  assert.deepEqual(iso, [names[1], names[3], names[5]]);       // Mon/Wed/Fri as before
});

test('Statistics: weekly buckets and the axis text follow the first day', () => {
  const sessions = [
    { id: 'a', date: '2026-10-03', type: 'easy', distanceKm: 5, durationSec: 1800 },    // Saturday
    { id: 'b', date: '2026-10-04', type: 'long', distanceKm: 10, durationSec: 3600 },   // Sunday
  ];
  const last = (ws) => { useWeek(ws); return statistics.weeklyRunKm(sessions, WED).slice(-2); };
  assert.deepEqual(last(MON), [{ ws: '2026-09-28', km: 15 }, { ws: '2026-10-05', km: 0 }]);
  assert.deepEqual(last(SUN), [{ ws: '2026-09-27', km: 5 }, { ws: '2026-10-04', km: 10 }]);
  assert.deepEqual(last(SAT), [{ ws: '2026-09-26', km: 0 }, { ws: '2026-10-03', km: 15 }]);
  assert.equal(statistics.weeklyRunKm(sessions, WED).length, 8);

  const today = todayStr();
  store.replaceArea('sessions', [{ id: 's1', date: today, type: 'easy', distanceKm: 8, durationSec: 2880 }]);
  useWeek(SUN);
  const view = setupShell();
  statistics.render(view);
  const names = weekdayNames();
  assert.ok(view.textContent.includes(`(${names[0]}–${names[6]})`), 'axis names the Sunday–Saturday week');
});

test('Weekly goals, streak and body-value medians count the person\'s week', () => {
  const s = (id, date) => ({ id, date, type: 'easy', distanceKm: 5, durationSec: 1800 });
  const sessions = [s('a', '2026-10-03'), s('b', '2026-10-04'), s('c', '2026-10-10')];
  useWeek(MON);
  assert.equal(weekActivity(sessions, WED).trainingDays, 1);    // Mon 5 – Sun 11: only Sat 10
  useWeek(SUN);
  assert.equal(weekActivity(sessions, WED).trainingDays, 2);    // Sun 4 – Sat 10
  useWeek(SAT);
  assert.equal(weekActivity(sessions, WED).trainingDays, 2);    // Sat 3 – Fri 9

  const streakData = { sessions: [s('x', '2026-10-04'), s('y', '2026-10-05'), s('z', '2026-10-06')], plans: [] };
  useWeek(MON);
  assert.equal(weekStreak(streakData, WED), 0);                 // split over two Monday weeks
  useWeek(SUN);
  assert.equal(weekStreak(streakData, WED), 1);                 // three days in one Sunday week

  const med = weeklyMedian([{ date: '2026-10-04', value: 70 }, { date: '2026-10-06', value: 72 }]);
  assert.deepEqual(med.map((p) => p.date), ['2026-10-04']);    // one Sunday week
});

test('The session sheet\'s "this week" (load offset, what-if) is the person\'s week', () => {
  useWeek(SUN);
  assert.deepEqual(weekRange(WED), { ws: '2026-10-04', we: '2026-10-10' });
  const units = [
    { id: 'u1', date: '2026-10-04', type: 'easy', targetDurationMin: 40, status: 'geplant' },
    { id: 'u2', date: '2026-10-11', type: 'easy', targetDurationMin: 40, status: 'geplant' },
  ];
  assert.equal(weekPlan(units, WED).count, 1);
});

/* ------------------------------ Plans: new ------------------------------ */
test('A new race plan starts on Sunday, its sessions keep their weekdays, the race ends the taper', () => {
  const ev = { id: 'e1', name: 'Marathon', date: '2026-12-13', distanceKm: 42.195, sport: 'run', status: 'geplant' };   // a Sunday
  store.replaceArea('events', [ev]);
  useWeek(MON);
  const mon = plans.createPlanForEvent(ev, { today: WED, daysPerWeek: 4 });
  store.replaceArea('plans', []);
  useWeek(SUN);
  assert.equal(planWindow(ev.date, WED).start, '2026-10-11');
  const sun = plans.createPlanForEvent(ev, { today: WED, daysPerWeek: 4 });
  assert.equal(sun.startDate, '2026-10-11');
  assert.equal(isoDow(sun.startDate), 7);

  const tplDows = new Set(sun.weekTemplate.map((r) => r.dow));
  for (const u of sun.units) {
    assert.equal(u.dow, isoDow(u.date), 'stored weekday stays ISO');
    const ws = addDays(sun.startDate, (u.week - 1) * 7);
    assert.ok(u.date >= ws && u.date <= addDays(ws, 6), `${u.date} lies in plan week ${u.week}`);
    if (u.type !== 'race') assert.ok(tplDows.has(isoDow(u.date)), `${u.type} on a template weekday`);
  }
  assert.ok(sun.units.some((u) => u.date === sun.startDate), 'the Sunday session opens week 1');
  const race = sun.units.find((u) => u.type === 'race');
  assert.equal(race.date, ev.date);

  // The race falls on the first day of the last plan week: that week holds race day only, and the
  // taper counts back from the week before – as in the Monday plan, no long run late in the taper.
  assert.equal(sun.weeks, mon.weeks + 1);
  assert.deepEqual(sun.units.filter((u) => u.week === sun.weeks).map((u) => u.type), ['race']);
  const vol = weekVolumes(sun, volumeConfig(sun, ev, sun.paces || {}));
  assert.equal(vol[sun.weeks - 1].taper, 'race');
  assert.equal(phaseForWeek(sun, sun.weeks - 1).key, 'taper');
  const longest = (p) => Math.max(...p.units.filter((u) => u.type !== 'race' && u.date >= addDays(ev.date, -9)).map((u) => u.targetDistanceKm || 0));
  assert.equal(longest(sun), longest(mon));
});

test('Only new plans join a race-day-only last week to the taper; an older one keeps its taper', () => {
  const ev = { id: 'e3', name: 'Pfingstlauf', date: '2026-12-14', distanceKm: 10, sport: 'run', status: 'geplant' };   // a Monday
  store.replaceArea('events', [ev]);
  const plan = plans.createPlanForEvent(ev, { today: WED, daysPerWeek: 4 });
  assert.equal(plan.startDate, '2026-10-12', 'a Monday plan for a Monday race');
  assert.equal(plan.raceDayJoinsTaper, true);
  assert.ok(raceOnlyLastWeek(plan));
  const cfg = volumeConfig(plan, ev, plan.paces || {});
  assert.equal(weekVolumes(plan, cfg)[plan.weeks - 1].taper, 'race', 'new: the taper ends the week before race day');

  // The same plan as created before v4.1: no marker, phases over all weeks – planned as it always was.
  const { raceDayJoinsTaper, ...old } = { ...plan, phases: makePhases(plan.weeks) };
  assert.equal(raceOnlyLastWeek(old), false);
  const vol = weekVolumes(old, volumeConfig(old, ev, old.paces || {}));
  assert.equal(vol[old.weeks].taper, 'race', 'old: the race week is the last plan week');
  assert.notEqual(vol[old.weeks - 1].taper, 'race');
  // Recalculating it from today keeps it an old plan.
  store.replaceArea('plans', [old]);
  assert.equal(plans.updatePlanFromToday(old, ev, { today: WED, daysPerWeek: 4 }).raceDayJoinsTaper, undefined);
});

test('A new programme starts on the first day and keeps its training weekdays', () => {
  const prog = { id: 'pr', name: 'Fit', programType: 'fitness', weeks: 4, daysPerWeek: 4 };
  const mon = createProgramPlan(prog, WED);
  useWeek(SUN);
  const sun = createProgramPlan(prog, WED);
  assert.equal(mon.startDate, '2026-10-12');
  assert.equal(sun.startDate, '2026-10-11');
  const dows = (p, w) => p.units.filter((u) => u.week === w).map((u) => isoDow(u.date)).sort().join();
  for (let w = 1; w <= 4; w++) assert.equal(dows(sun, w), dows(mon, w), `week ${w}: same weekdays`);
  for (const u of sun.units) {
    const ws = addDays(sun.startDate, (u.week - 1) * 7);
    assert.ok(u.date >= ws && u.date <= addDays(ws, 6));
    assert.equal(u.dow, isoDow(u.date));
  }
});

/* ---------------------------- Plans: existing ---------------------------- */
test('An existing Monday plan does not move after switching to Sunday', () => {
  const ev = { id: 'e2', name: 'HM', date: '2026-12-12', distanceKm: 21.0975, sport: 'run', status: 'geplant' };
  store.replaceArea('events', [ev]);
  const plan = plans.createPlanForEvent(ev, { today: WED, daysPerWeek: 4 });
  assert.equal(plan.startDate, '2026-10-12');
  const before = shape(plan.units);

  useWeek(SUN);
  // Regenerating the whole plan keeps every date and every plan week.
  assert.deepEqual(shape(generatePlanUnits(plan, ev, store.profile())), before);
  // A plan that is generated later (ensureGenerated) too.
  store.patch('plans', plan.id, { units: [], generated: false });
  plans.ensureGenerated();
  const again = store.find('plans', plan.id);
  assert.equal(again.startDate, '2026-10-12');
  assert.deepEqual(shape(again.units), before);
  // Recalculating from today keeps the start and the days as well.
  const updated = plans.updatePlanFromToday(again, ev, { today: WED, daysPerWeek: 4 });
  assert.equal(updated.startDate, '2026-10-12');
  assert.deepEqual(shape(updated.units), before);
  // The week check stays on the plan week (Mon–Sun), not on the person's Sunday week.
  const inPlanWeek = weekUnits(updated.units, '2026-10-18', updated.startDate).map((u) => u.date);
  assert.ok(inPlanWeek.every((d) => d >= '2026-10-12' && d <= '2026-10-18'));
  assert.ok(inPlanWeek.includes('2026-10-18'));
});

test('An existing Monday programme keeps its dates when regenerated under a Sunday week', () => {
  const p = { programType: 'weightloss', weeks: 4, daysPerWeek: 5 };
  const before = shape(buildProgramUnits(p, 'plan-x', '2026-10-12'));
  useWeek(SUN);
  assert.deepEqual(shape(buildProgramUnits(p, 'plan-x', '2026-10-12')), before);
});
