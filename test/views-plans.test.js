/* Package "Plans that fit" – store and view tests: creating a plan without
   phantom appointments, updating from today, programmes with duration and instructions,
   free workouts (calendar, Today, statistics), import assignment. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr, addDays } from '../js/ui.js';
import * as plans from '../js/plans.js';
import * as calendar from '../js/calendar.js';
import * as session from '../js/session.js';
import * as dashboard from '../js/dashboard.js';
import * as statistics from '../js/statistics.js';
import { saveImportedActivity } from '../js/health-import.js';
import { importedMatches } from '../js/planflow.js';
import { makePhases, DEFAULT_WEEK_TEMPLATE, LEGACY_COMMITMENT_IDS, PLAN_GEN } from '../js/plangen.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events', 'nutrition', 'shopping', 'checklist', 'cycle'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', {});
  store.setProfile({ name: 'Test', heightCm: 170, weightKg: 70, birthYear: 1990, sex: 'w', paceZones: null });
});

test('TRAIN-02/04/47: new plan without phantom appointments, with paces from the target time; no plan for past races', () => {
  const today = todayStr();
  const ev = { id: 'e1', name: 'HM', date: addDays(today, 70), distanceKm: 21.0975, sport: 'run', targetTime: '01:55:00' };
  store.replaceArea('events', [ev]);
  const plan = plans.createPlanForEvent(ev, { level: 'fortgeschritten', daysPerWeek: 4 });
  assert.deepEqual(plan.commitments, []);
  assert.equal(plan.units.filter((u) => u.fixed).length, 0, 'no unrequested football training');
  assert.equal(plan.gen, PLAN_GEN);
  assert.equal(plan.level, 'fortgeschritten');
  assert.ok(plan.paces && plan.paces.race, 'paces stored per plan');
  assert.ok(plan.paceInfo.goalVdot > 37 && plan.paceInfo.goalVdot < 40);
  const run = plan.units.filter((u) => ['easy', 'long', 'tempo', 'interval', 'recovery', 'race'].includes(u.type));
  assert.ok(run.length > 20 && run.every((u) => u.targetPaceSecPerKm), 'every run unit with a target pace – even without form data');
  assert.equal(plans.createPlanForEvent({ ...ev, id: 'e2', date: addDays(today, -3) }), null, 'race over → no empty plan');
  assert.equal(plans.createPlanForEvent({ ...ev, id: 'e3', date: today }), null, 'race today → no plan');
});

test('TRAIN-19/offer: update plan from today – the past stays, legacy-plan football becomes explicit', () => {
  const today = todayStr();
  const start = addDays(today, -21);
  const ev = { id: 'e1', name: 'HM', date: addDays(start, 11 * 7 + 5), distanceKm: 21.0975, sport: 'run', targetTime: '01:55:00' };
  store.replaceArea('events', [ev]);
  // Legacy plan without `commitments` and without generator version – with a sickness absence in the past.
  const past = [
    { id: 'old-1', planId: 'p1', date: addDays(today, -5), type: 'tempo', title: 'Schwelle', status: 'verpasst', missedReason: 'sick' },
    { id: 'old-2', planId: 'p1', date: addDays(today, -3), type: 'long', title: 'Long Run', status: 'erledigt', executedSessionId: 's1' },
    { id: 'old-3', planId: 'p1', date: addDays(today, -1), type: 'easy', title: 'Locker', status: 'geplant' },
    { id: 'fut-1', planId: 'p1', date: addDays(today, 2), type: 'easy', title: 'Alt künftig', status: 'geplant' },
  ];
  store.replaceArea('plans', [{ id: 'p1', eventId: 'e1', name: 'Plan', startDate: start, endDate: ev.date, weeks: 12, phases: makePhases(12), weekTemplate: DEFAULT_WEEK_TEMPLATE, units: past, generated: true }]);
  let view = setupShell();
  plans.render(view, 'e1');
  assert.match(view.textContent, /Neue Planlogik verfügbar/);
  const updated = plans.updatePlanFromToday(store.find('plans', 'p1'), ev, { level: 'fortgeschritten', daysPerWeek: 4 });
  const byId = (id) => updated.units.find((u) => u.id === id);
  assert.equal(byId('old-1').missedReason, 'sick', 'reason for missing stays');
  assert.equal(byId('old-2').executedSessionId, 's1');
  assert.ok(byId('old-3'), 'past open unit stays (is not regenerated)');
  assert.equal(byId('fut-1'), undefined, 'future recalculated');
  assert.ok(!updated.units.some((u) => u.date < today && !u.id.startsWith('old-')), 'nothing new in the past');
  assert.equal(updated.gen, PLAN_GEN);
  assert.deepEqual(updated.commitments.map((c) => c.id), LEGACY_COMMITMENT_IDS, 'football stays – now explicitly');
  assert.ok(updated.units.some((u) => u.type === 'race' && u.date === ev.date));
  view = setupShell();
  plans.render(view, 'e1');
  assert.doesNotMatch(view.textContent, /Neue Planlogik verfügbar/);
  assert.match(view.textContent, /Niveau Fortgeschritten/);
});

test('TRAIN-06: programme unit from earlier versions shows duration and instructions', () => {
  const today = todayStr();
  store.replaceArea('events', [{ id: 'prog', name: 'Fit', kind: 'program', programType: 'fitness' }]);
  store.replaceArea('plans', [{ id: 'pp', eventId: 'prog', kind: 'program', startDate: today, endDate: addDays(today, 27), weeks: 4, phases: [], units: [
    { id: 'pu', planId: 'pp', eventId: null, date: today, type: 'strength', title: 'Kraft – Ganzkörper', dur: 40, desc: 'Ganzkörper, 3 Runden: Kniebeugen 12×', status: 'geplant', done: false },
  ] }]);
  const view = setupShell();
  session.render(view, 'pu');
  assert.match(view.textContent, /40\u00a0min/);
  assert.match(view.textContent, /Kniebeugen 12×/);
});

test('UI-06: free workouts appear in the calendar, on "Today" and in the statistics', () => {
  const today = todayStr();
  store.replaceArea('sessions', [{ id: 'free1', date: today, type: 'cross_bike', title: 'Radtour an der Elbe', distanceKm: 32, durationSec: 5400, plannedId: null, source: 'manual' }]);
  let view = setupShell();
  calendar.render(view);
  assert.ok(view.querySelector('.cal-dot--free'), 'dot for the free workout in the month');
  view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Radtour an der Elbe/);
  assert.match(view.textContent, /Training erfassen/);
  assert.doesNotMatch(view.textContent, /Ruhetag/, 'no "rest day" when training has already happened');
  view = setupShell();
  statistics.render(view);
  assert.match(view.textContent, /Trainings ohne Plan/);
  assert.match(view.textContent, /Radtour an der Elbe/);
});

test('TRAIN-28/MKT-05: import assigns to planned units – otherwise free workout; suggestions on "Today"', () => {
  const today = todayStr();
  store.replaceArea('plans', [{ id: 'p1', eventId: 'e1', units: [
    { id: 'u-run', planId: 'p1', date: today, type: 'easy', title: 'Lockerer Dauerlauf', status: 'geplant', targetDistanceKm: 8 },
    { id: 'u-run2', planId: 'p1', date: addDays(today, -1), type: 'long', title: 'Long Run', status: 'geplant', targetDistanceKm: 14 },
  ] }]);
  const run = saveImportedActivity({ date: today, durationSec: 2700, distanceKm: 8.1, avgHr: 140, splits: [{ km: 1, sec: 330 }], timeInZones: { 2: 2000 } }, 'run');
  assert.equal(run.matched.id, 'u-run');
  assert.equal(store.find('plans', 'p1').units.find((u) => u.id === 'u-run').status, 'erledigt');
  assert.equal(run.session.plannedId, 'u-run');
  assert.deepEqual(run.session.splits, [{ km: 1, sec: 330 }]);
  const bike = saveImportedActivity({ date: today, durationSec: 3600, distanceKm: 25 }, 'cross_bike');
  assert.equal(bike.matched, null, 'bike does not match a run');
  assert.equal(store.find('sessions', bike.session.id).plannedId, null);
  // Automatically imported run from yesterday: suggestion on "Today".
  store.upsert('sessions', { id: 'ah', date: addDays(today, -1), type: 'easy', title: 'Lauf (Apple Health)', distanceKm: 14, durationSec: 5000, source: 'apple-health', plannedId: null });
  const m = importedMatches(store.get('plans'), store.get('sessions'), today);
  assert.equal(m.length, 1);
  assert.equal(m[0].unit.id, 'u-run2');
  const view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Importierte Trainings zuordnen/);
  session.linkSession(m[0].plan, m[0].unit, m[0].session);
  assert.equal(importedMatches(store.get('plans'), store.get('sessions'), today).length, 0);
  assert.equal(store.find('sessions', 'ah').plannedId, 'u-run2');
});

test('UI-09: ▶ on "Today" starts directly, the unit has an action bar, runs collapse exercises', () => {
  const today = todayStr();
  store.replaceArea('events', [{ id: 'e9', name: 'HM', date: addDays(today, 60), distanceKm: 21.0975, sport: 'run' }]);
  store.replaceArea('plans', [{ id: 'p9', eventId: 'e9', startDate: addDays(today, -7), weeks: 10, phases: [], commitments: [], units: [
    { id: 'u9', planId: 'p9', date: today, dow: 1, week: 2, type: 'easy', title: 'Lockerer Dauerlauf', targetDistanceKm: 8, status: 'geplant' },
  ] }]);
  let view = setupShell();
  dashboard.render(view);
  const play = view.querySelectorAll('a').find((a) => a.getAttribute('href') === '#/workout/u9');
  assert.ok(play, '▶ is a link to the workout');
  assert.equal(play.getAttribute('aria-label'), 'Training starten: Lockerer Dauerlauf');

  view = setupShell();
  session.render(view, 'u9');
  const bar = view.querySelectorAll('.action-bar')[0];
  assert.ok(bar, 'action bar present');
  assert.match(bar.textContent, /Starten/);
  assert.match(bar.textContent, /Erledigt erfassen/);
  const ics = doc.getElementById('header-actions').querySelectorAll('button').map((b) => b.getAttribute('aria-label'));
  assert.ok(ics.includes('In Kalender übernehmen (.ics)'), `Header actions: ${ics.join(', ')}`);
  const details = view.querySelectorAll('details');
  if (details.length) assert.match(details[0].textContent, /Übungen für diese Einheit/);
});

test('UI-34: plan header only with "+" and "…" – rare actions with text in the menu', () => {
  const today = todayStr();
  store.replaceArea('events', [{ id: 'e8', name: 'HM', date: addDays(today, 60), distanceKm: 21.0975, sport: 'run' }]);
  store.replaceArea('plans', [{ id: 'p8', eventId: 'e8', startDate: today, weeks: 8, phases: [], commitments: [], units: [] }]);
  const view = setupShell();
  plans.render(view, 'e8');
  const labels = doc.getElementById('header-actions').querySelectorAll('button').map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels, ['Einheit hinzufügen', 'Weitere Aktionen']);
  const titles = doc.getElementById('header-actions').querySelectorAll('button').map((b) => b.getAttribute('title'));
  assert.deepEqual(titles, labels, 'tooltip = name');
});

test('UI-29: Moving – "next free day" skips occupied days', () => {
  const units = [
    { id: 'a', date: '2026-10-01', type: 'easy', status: 'geplant' },
    { id: 'b', date: '2026-10-02', type: 'tempo', status: 'geplant' },
    { id: 'c', date: '2026-10-03', type: 'rest', status: 'geplant' },
  ];
  assert.equal(session.nextFreeDay(units, 'x', '2026-10-01'), '2026-10-03', 'rest day counts as free');
  assert.equal(session.nextFreeDay(units, 'a', '2026-10-01'), '2026-10-01', 'the unit itself does not block');
});

test('UI-23: dragging in the calendar – on a conflict first a confirmation prompt, then "Undo"', async () => {
  const today = todayStr();
  const mon = addDays(today, 7);
  const wed = addDays(today, 9);
  store.replaceArea('events', [{ id: 'e7', name: 'HM', date: addDays(today, 60), distanceKm: 21.1, sport: 'run' }]);
  store.replaceArea('plans', [{ id: 'p7', eventId: 'e7', startDate: today, weeks: 8, phases: [], commitments: [], units: [
    { id: 'm1', planId: 'p7', date: mon, dow: 1, type: 'cross_football', title: 'Fußball', status: 'geplant' },
    { id: 'w1', planId: 'p7', date: wed, dow: 3, type: 'cross_football', title: 'Fußball', status: 'geplant' },
  ] }]);
  for (const id of ['modal-root', 'toast-root']) if (!doc.getElementById(id)) doc.body.appendChild(doc.createElement('div')).setAttribute('id', id);
  const view = setupShell();
  for (const id of ['modal-root', 'toast-root']) { const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  calendar.render(view);
  const unit = () => store.get('plans')[0].units.find((u) => u.id === 'm1');
  const pending = calendar.reschedule(unit(), wed);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(unit().date, mon, 'nothing saved without confirmation');
  const sheet = doc.getElementById('modal-root');
  assert.match(sheet.textContent, /An diesem Tag liegt bereits „Fußball“/);
  sheet.querySelectorAll('button').find((b) => b.textContent === 'Trotzdem verschieben').click();
  await pending;
  assert.equal(unit().date, wed);
  const undo = doc.getElementById('toast-root').querySelectorAll('button').find((b) => b.textContent === 'Rückgängig');
  assert.ok(undo, '"Undo" in the toast');
  undo.click();
  assert.equal(unit().date, mon, 'taken back');
});

test('UI-17: month calendar names units as short titles and for screen readers', () => {
  const today = todayStr();
  store.replaceArea('events', [{ id: 'e6', name: 'HM', date: addDays(today, 60), distanceKm: 21.1, sport: 'run' }]);
  store.replaceArea('plans', [{ id: 'p6', eventId: 'e6', startDate: today, weeks: 8, phases: [], commitments: [], units: [
    { id: 'l1', planId: 'p6', date: today, dow: 1, type: 'long', title: 'Long Run', targetDistanceKm: 14, status: 'geplant' },
  ] }]);
  const view = setupShell();
  calendar.render(view);
  const cell = view.querySelectorAll('button').find((b) => /\(heute\)/.test(b.getAttribute('aria-label') || ''));
  assert.ok(cell, 'cell for today');
  assert.match(cell.getAttribute('aria-label'), /Long 14 km/);
  assert.match(cell.textContent, /Long 14\u00a0km/);
});
