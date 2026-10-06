/* Units in the views (v4.1): a person on miles, pounds and °F sees mi, min/mi, ft, lb and °F in the
   main views – no kilometre or kilogram is left over. The data stay metric and the generated plan
   texts are stored metric; they are converted only when shown. Every test switches back to metric. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { setUnits, METRIC } from '../js/units.js';
import { todayStr, addDays } from '../js/ui.js';
import { lsSet } from '../js/env.js';
import { encodePolyline } from '../js/gpx.js';
import * as dashboard from '../js/dashboard.js';
import * as plans from '../js/plans.js';
import * as session from '../js/session.js';
import * as statistics from '../js/statistics.js';
import * as health from '../js/health.js';
import * as badges from '../js/badges.js';
import * as settings from '../js/settings.js';
import * as events from '../js/events.js';
import { buildMonthReport } from '../js/report.js';

const IMPERIAL = { distance: 'mi', weight: 'lb', temperature: 'f' };
/** A kilometre, kilogram or °C left over in the visible text. */
const METRIC_LEFT = /\bkm\b|\bkg\b|°C/;
const doc = globalThis.document;
const today = todayStr();

function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
/** Visible text with ordinary spaces (keepUnits puts no-break spaces between number and unit). */
const text = (view) => view.textContent.replace(/ /g, ' ');

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events', 'nutrition', 'shopping', 'checklist', 'cycle'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', {});
  store.setProfile({ name: 'Alex', heightCm: 180, weightKg: 80, targetWeightKg: 75, birthYear: 1990, sex: 'm' });
  setUnits(IMPERIAL);
});
afterEach(() => setUnits(METRIC));

/** A plan with one generated session today (metric text, as stored by plangen). */
function planWithLongRun() {
  const unit = {
    id: 'u-long', planId: 'p1', eventId: 'e1', date: today, dow: 1, week: 3, phase: 'build', type: 'long',
    title: 'Langer Lauf 18 km', description: '18 km locker, die letzten 2 km bei 5:20–5:34 min/km.',
    targetDistanceKm: 18, targetPaceSecPerKm: 320, targetPaceMaxSecPerKm: 334, status: 'geplant',
  };
  store.replaceArea('events', [{ id: 'e1', name: 'Stadtlauf', date: addDays(today, 60), distanceKm: 21.0975, kind: 'race', sport: 'run', targetTime: '01:55:00' }]);
  store.replaceArea('plans', [{
    id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(today, -14), endDate: addDays(today, 60), weeks: 11,
    phases: [{ key: 'build', name: 'Aufbau', color: '#3d8bff', startWeek: 1, endWeek: 11, focus: '' }],
    commitments: [], units: [unit],
  }]);
  return unit;
}

test('dashboard: today\'s session, pace and weekly running distance in miles; weight goal in pounds', () => {
  planWithLongRun();
  store.replaceArea('health', [{ id: 'h1', date: addDays(today, -1), weight: 80 }]);
  store.replaceArea('sessions', [{ id: 's1', date: today, type: 'easy', title: 'Lauf', distanceKm: 8, durationSec: 2880, status: 'erledigt' }]);
  const view = setupShell();
  dashboard.render(view);
  const txt = text(view);
  assert.match(txt, /Langer Lauf 11,2 mi/, 'generated title converted');
  assert.match(txt, /8:35\/mi/, 'pace per mile');
  assert.match(txt, /Lauf-mi/, 'weekly label names the unit');
  assert.match(txt, /176,4 lb/, 'weight in pounds');
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('plan view: unit titles, weekly totals, paces and the planned distance label in miles', () => {
  const ev = { id: 'e1', name: 'Test-HM', date: addDays(today, 56), distanceKm: 21.0975, sport: 'run', status: 'geplant', targetTime: '01:55:00' };
  store.replaceArea('events', [ev]);
  const plan = plans.createPlanForEvent(ev);
  assert.ok(plan.units.some((u) => / km\b/.test(u.title)), 'stored plan texts stay metric');
  assert.ok(!plan.units.some((u) => /\bmi\b/.test(`${u.title} ${u.description}`)), 'no miles in stored texts');
  const view = setupShell();
  plans.render(view, 'e1');
  const txt = text(view);
  assert.match(txt, /Geplante Lauf-mi/);
  assert.match(txt, /\d mi\b/);
  assert.match(txt, /min\/mi/);
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('session view (planned): title, description, target distance, pace and weather converted', () => {
  planWithLongRun();
  lsSet('weather', JSON.stringify({ lat: 51, lon: 13, fetchedAt: Date.now(), days: { [today]: { code: 0, tMax: 30, tMin: 18, precip: 0, wind: 5 } } }));
  const view = setupShell();
  session.render(view, 'u-long');
  const txt = text(view);
  assert.match(txt, /Langer Lauf 11,2 mi/);
  assert.match(txt, /11,2 mi locker, die letzten 1,24 mi bei 8:35–8:58 min\/mi/, 'description converted when shown');
  assert.match(txt, /Zielpace8:35–8:58 min\/mi/, 'target pace range per mile');
  assert.match(txt, /64–86 °F/, 'weather in °F');
  assert.match(txt, /Heiß \(86 °F\)/, 'heat hint in °F, threshold still 28 °C');
  assert.doesNotMatch(txt, METRIC_LEFT);
  // The stored unit is untouched.
  assert.equal(store.get('plans')[0].units[0].title, 'Langer Lauf 18 km');
});

test('session view (completed): distance, pace, elevation, mile splits and strength sets in imperial units', () => {
  const route = {
    poly: encodePolyline([[51.05, 13.73], [51.06, 13.74], [51.07, 13.72], [51.05, 13.73]]),
    ele: Array.from({ length: 60 }, (_, i) => 110 + Math.round(20 * Math.sin(i / 9))),
  };
  store.replaceArea('sessions', [
    {
      id: 'f1', date: today, type: 'easy', title: 'Lauf 10 km', distanceKm: 10, durationSec: 3000, paceSecPerKm: 300, ascentM: 100, route, source: 'gpx',
      splits: Array.from({ length: 10 }, (_, i) => ({ km: i + 1, sec: 300 })),
      splitsMi: Array.from({ length: 6 }, (_, i) => ({ mi: i + 1, sec: 483 })),
    },
    { id: 'k1', date: today, type: 'strength', title: 'Kraft', durationSec: 1800, strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 20 }, { reps: 10, kg: 20 }] }] },
  ]);
  let view = setupShell();
  session.render(view, 'f1');
  let txt = text(view);
  assert.match(txt, /Lauf 6,2 mi/);
  assert.match(txt, /6,2mi/, 'big distance figure in miles');
  assert.match(txt, /8:03min\/mi/, 'pace per mile');
  assert.match(txt, /328 ft bergauf/);
  assert.match(txt, /6,2 mi/);
  const head = view.querySelectorAll('th').map((th) => th.textContent);
  assert.equal(head[0], 'mi', 'mile splits for a person on miles');
  assert.equal(view.querySelectorAll('tr').length, 1 + 6, 'header + six mile splits');
  assert.match(txt, /8:03/, 'split time as it is');
  assert.doesNotMatch(txt, METRIC_LEFT);

  view = setupShell();
  session.render(view, 'k1');
  txt = text(view);
  assert.match(txt, /10 × 44,1 lb/);
  assert.match(txt, /882 lb bewegt/);
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('session view (completed, km splits only): the honest header stays "km"', () => {
  store.replaceArea('sessions', [{ id: 'f2', date: today, type: 'easy', distanceKm: 3, durationSec: 900, splits: [{ km: 1, sec: 300 }, { km: 2, sec: 300 }, { km: 3, sec: 300 }] }]);
  const view = setupShell();
  session.render(view, 'f2');
  assert.equal(view.querySelectorAll('th')[0].textContent, 'km');
  assert.match(text(view), /5:00/, 'time per km split, not converted');
});

test('statistics: weekly running distance, key figures and weight chart in imperial units', () => {
  store.replaceArea('sessions', [
    { id: 's1', date: today, type: 'easy', distanceKm: 8, durationSec: 2880, status: 'erledigt', avgHr: 135 },
    { id: 's2', date: addDays(today, -3), type: 'long', distanceKm: 16, durationSec: 5400, status: 'erledigt' },
  ]);
  store.replaceArea('health', [
    { id: 'h1', date: addDays(today, -25), weight: 82, restingHr: 58 },
    { id: 'h2', date: addDays(today, -1), weight: 80, restingHr: 54 },
  ]);
  const view = setupShell();
  statistics.render(view);
  const txt = text(view);
  assert.match(txt, /Lauf-mi pro Woche/);
  assert.match(txt, /Lauf-mi · 7 Tage/);
  assert.match(txt, /Gewicht \(lb\)/);
  assert.match(txt, /176,4 lb/);
  assert.match(txt, /mi\/Wo/);
  assert.match(txt, /min\/mi/);
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('body values: tiles, trends and entries in pounds', () => {
  store.replaceArea('health', [
    { id: 'h1', date: addDays(today, -20), weight: 82, restingHr: 58, leanMass: 62 },
    { id: 'h2', date: addDays(today, -10), weight: 81, restingHr: 56, leanMass: 62.5 },
    { id: 'h3', date: today, weight: 80, restingHr: 54, leanMass: 63 },
  ]);
  const view = setupShell();
  health.render(view);
  const txt = text(view);
  assert.match(txt, /176,4 lb/);
  assert.match(txt, /Gewicht \(lb\)/);
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('monthly report: distances in miles, weight change in pounds', () => {
  const r = buildMonthReport({
    profile: { name: 'Alex' }, monthStr: '2026-06', today: '2026-07-15',
    sessions: [{ id: 's1', date: '2026-06-02', type: 'easy', distanceKm: 16.09344, durationSec: 3600 }, { id: 's2', date: '2026-06-03', type: 'cross_bike', distanceKm: 40, durationSec: 4800 }],
    health: [{ id: 'h1', date: '2026-06-01', weight: 80 }, { id: 'h2', date: '2026-06-28', weight: 79 }],
  });
  const items = r.sections.flatMap((s) => s.items);
  assert.equal(items.find((i) => i.label === 'Gelaufene Strecke').value, '10 mi');
  assert.equal(items.find((i) => /Weitere Strecken/.test(i.label)).value, '25 mi');
  assert.equal(items.find((i) => /Monatsbeginn/.test(i.label)).value, '176,4 lb');
  assert.equal(items.find((i) => /Monatsende/.test(i.label)).value, '174,2 lb');
  assert.equal(items.find((i) => i.label === 'Veränderung').value, '-2,2 lb');
  const all = JSON.stringify(r);
  assert.doesNotMatch(all, METRIC_LEFT);
});

test('badges: names, descriptions and progress of the distance badges in miles', () => {
  const sessions = [];
  for (let i = 0; i < 12; i++) sessions.push({ id: 'b' + i, date: addDays(today, -i * 2), type: 'easy', distanceKm: 6, status: 'erledigt' });
  store.replaceArea('sessions', sessions);
  const view = setupShell();
  badges.render(view);
  const txt = text(view);
  assert.match(txt, /Erste 62 mi/);
  assert.match(txt, /Ein Lauf über 9,3 mi/);
  assert.match(txt, /44,7 \/ 62/, 'progress in miles (72 km of 100 km)');
  assert.doesNotMatch(txt, METRIC_LEFT);
});

test('settings and races: height in ft/in, weights in lb, race distance and pace in miles', () => {
  let view = setupShell();
  settings.render(view);
  let txt = text(view);
  assert.match(txt, /5′ 11″ · 176,4 lb · Ziel 165,3 lb/, 'profile line');

  store.replaceArea('events', [{ id: 'e9', name: 'Stadtlauf', date: addDays(today, 30), distanceKm: 21.0975, distanceType: 'HM', sport: 'run', status: 'geplant', priority: 'A', targetTime: '01:45:00' }]);
  view = setupShell();
  events.renderDetail(view, 'e9');
  txt = text(view);
  assert.match(txt, /13,1 mi/);
  assert.match(txt, /Zielpace min\/mi/);
  assert.match(txt, /8:01/, 'target pace per mile (4:59/km)');
  assert.doesNotMatch(txt, METRIC_LEFT);

  store.replaceArea('events', [{ id: 'e5', name: 'Firmenlauf', date: addDays(today, 30), distanceKm: 5, distanceType: '5k', sport: 'run', status: 'geplant' }]);
  view = setupShell();
  events.renderList(view);
  assert.match(text(view), /5K/, 'a 5 km race keeps its race name');
  assert.doesNotMatch(text(view), METRIC_LEFT);
});

test('metric stays as it was: the same views still say km and kg', () => {
  setUnits(METRIC);
  planWithLongRun();
  store.replaceArea('health', [{ id: 'h1', date: addDays(today, -1), weight: 80 }]);
  const view = setupShell();
  session.render(view, 'u-long');
  assert.match(text(view), /Langer Lauf 18 km/);
  assert.match(text(view), /5:20–5:34 min\/km/);
  assert.match(text(view), /Distanz18 km/);
});
