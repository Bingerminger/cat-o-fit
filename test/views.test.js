/* View-Render-Tests: rufen echte render()-Funktionen gegen das Mini-DOM auf und
   prüfen, dass die Kernabschnitte ohne Crash erscheinen. Genau diese Art Test
   hätte z. B. einen Render-Fehler bei einem Plan ohne Phasen sofort gefangen. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr, addDays, weekStartMonday } from '../js/ui.js';
import * as statistics from '../js/statistics.js';
import * as plans from '../js/plans.js';
import * as dashboard from '../js/dashboard.js';
import * as calendar from '../js/calendar.js';
import * as cycle from '../js/cycle.js';
import * as badges from '../js/badges.js';
import * as checklist from '../js/checklist.js';
import * as health from '../js/health.js';
import * as nutrition from '../js/nutrition.js';
import * as shopping from '../js/shopping.js';
import * as settings from '../js/settings.js';
import * as family from '../js/family.js';
import * as familyAdmin from '../js/family-admin.js';
import * as help from '../js/help.js';
import * as reports from '../js/reports.js';
import * as events from '../js/events.js';
import * as himport from '../js/health-import.js';

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
  store.setProfile({ name: 'Test', heightCm: 170, weightKg: 70, targetWeightKg: 65, birthYear: 1990, sex: 'w' });
});

test('health-import.render: „Zuletzt importiert" zeigt nur apple-health-Werte', () => {
  store.replaceArea('health', [
    { id: 'h1', date: '2026-06-30', weight: 70.1, restingHr: 45, hrv: 96, sleepHours: 5.6, source: 'apple-health' },
    { id: 'h2', date: '2026-06-20', weight: 72.0, restingHr: 50, source: 'manual' },   // manuell -> NICHT in der Übersicht
  ]);
  store.replaceArea('sessions', [
    { id: 'hk-1', date: '2026-06-30', type: 'easy', title: 'Lauf (Apple Health)', distanceKm: 8.2, durationSec: 2700, avgHr: 152, source: 'apple-health' },
  ]);
  const view = setupShell();
  himport.render(view);
  const txt = view.textContent;
  assert.match(txt, /Zuletzt importiert/);
  assert.match(txt, /HRV 96/);
  assert.match(txt, /5,6 h Schlaf/);
  assert.match(txt, /Lauf/);               // Workout-Zeile
  assert.doesNotMatch(txt, /72,0 kg/);     // manueller Eintrag bleibt außen vor
});

test('health-import.render: ohne Import-Daten keine Übersicht, kein Crash', () => {
  const view = setupShell();
  assert.doesNotThrow(() => himport.render(view));
  assert.doesNotMatch(view.textContent, /Zuletzt importiert/);
  assert.match(view.textContent, /Automatisch aus Apple Health/);   // Aktivieren-Bereich immer da
});

test('statistics.render: Kernkarten erscheinen, kein Crash', () => {
  const today = todayStr();
  store.replaceArea('sessions', [
    { id: 's1', date: today, type: 'easy', distanceKm: 8, durationSec: 2880, status: 'erledigt', avgHr: 135 },
    { id: 's2', date: addDays(today, -3), type: 'long', distanceKm: 15, durationSec: 5400, status: 'erledigt' },
  ]);
  store.replaceArea('health', [
    { id: 'h1', date: addDays(today, -25), weight: 70, restingHr: 58 },
    { id: 'h2', date: addDays(today, -1), weight: 68, restingHr: 54 },
  ]);
  const view = setupShell();
  statistics.render(view);
  const txt = view.textContent;
  assert.match(txt, /Bin ich auf Plan/);
  assert.match(txt, /Trainingsjahr/);
  assert.match(txt, /Wochenumfang/);
  assert.match(txt, /Werte & Ziele/);
});

test('statistics.render: ohne Daten -> Leerzustand ohne Crash', () => {
  const view = setupShell();
  statistics.render(view);
  assert.match(view.textContent, /Noch keine Daten/);
});

test('plans.render: echter Plan zeigt Phasen, Wochenübersicht und Wochen-Neuberechnung', () => {
  const today = todayStr();
  const ev = { id: 'e1', name: 'Test-HM', date: addDays(today, 56), distanceKm: 21.1, sport: 'run', status: 'geplant', targetTime: '01:55:00' };
  store.replaceArea('events', [ev]);
  plans.createPlanForEvent(ev); // erzeugt Plan inkl. phases + units
  const view = setupShell();
  plans.render(view, 'e1');
  const txt = view.textContent;
  assert.match(txt, /Woche 1 von/);
  assert.match(txt, /Wochenübersicht/);
  assert.match(txt, /Diese Woche neu berechnen/);
});

test('plans.render: manuelle Einheit vor dem Planstart erzeugt keine „Wundefined"-Woche', () => {
  const today = todayStr();
  const ev = { id: 'em', name: 'Manuell-HM', date: addDays(today, 63), distanceKm: 21.1, sport: 'run', status: 'geplant', targetTime: '01:50:00' };
  store.replaceArea('events', [ev]);
  const plan = plans.createPlanForEvent(ev); // Start = kommender Montag
  // Manuelle Einheit wie openUnitCreator: OHNE `week`-Feld, datiert VOR dem Planstart.
  const manual = {
    id: 'u-manual', planId: plan.id, eventId: plan.eventId,
    date: addDays(plan.startDate, -3), type: 'easy', title: 'Manueller Testlauf',
    status: 'geplant', targetDistanceKm: 6,
  };
  const cur = store.find('plans', plan.id);
  store.patch('plans', plan.id, { units: [...(cur.units || []), manual] });

  const view = setupShell();
  plans.render(view, 'em');
  const txt = view.textContent;
  assert.doesNotMatch(txt, /Wundefined/);   // keine kaputte Phasen-Pille
  assert.doesNotMatch(txt, /NaN/);          // keine kaputte Datumszeile
  assert.match(txt, /Manueller Testlauf/);  // Einheit ist einsortiert & sichtbar
});

test('plans.render: kein Plan -> Leerzustand', () => {
  const view = setupShell();
  plans.render(view, 'gibt-es-nicht');
  assert.match(view.textContent, /Noch kein Plan/);
});

test('plans.render: unvollständiger Plan (ohne phases) crasht nicht, bietet Neu-Generieren', () => {
  const today = todayStr();
  const ev = { id: 'e2', name: 'Alt-Import', date: addDays(today, 40), distanceKm: 10, sport: 'run', status: 'geplant' };
  store.replaceArea('events', [ev]);
  // Plan aus altem Backup: keine phases/weeks
  store.replaceArea('plans', [{ id: 'p-old', eventId: 'e2', units: [] }]);
  const view = setupShell();
  assert.doesNotThrow(() => plans.render(view, 'e2'));
  assert.match(view.textContent, /unvollständig/i);
  assert.match(view.textContent, /neu generieren/i);
});

/* ---- Smoke: jede Haupt-View rendert mit leeren Daten ohne Crash ---- */
const SMOKE = [
  ['dashboard', () => dashboard.render(setupShell())],
  ['calendar', () => calendar.render(setupShell())],
  ['cycle', () => cycle.render(setupShell())],
  ['badges', () => badges.render(setupShell())],
  ['checklist', () => checklist.render(setupShell())],
  ['health', () => health.render(setupShell())],
  ['nutrition', () => nutrition.render(setupShell())],
  ['shopping', () => shopping.render(setupShell())],
  ['statistics', () => statistics.render(setupShell())],
  ['settings', () => settings.render(setupShell())],
  ['family', () => family.render(setupShell())],
  ['family-admin', () => familyAdmin.render(setupShell())],
  ['help', () => help.render(setupShell())],
  ['events-liste', () => events.renderList(setupShell())],
  ['reports', () => reports.render(setupShell())],
];
for (const [name, run] of SMOKE) {
  test(`Smoke: ${name}.render – leere Daten, kein Crash`, () => {
    assert.doesNotThrow(run);
  });
}

test('dashboard.render: mit Daten zeigt Inhalte ohne Crash', () => {
  const today = todayStr();
  store.replaceArea('sessions', [{ id: 's1', date: today, type: 'easy', distanceKm: 8, durationSec: 2880, status: 'erledigt' }]);
  store.replaceArea('health', [{ id: 'h1', date: today, sleepHours: 8, restingHr: 52 }]);
  const view = setupShell();
  assert.doesNotThrow(() => dashboard.render(view));
  assert.ok(view.textContent.length > 0);
});

test('dashboard.render: R2 Erholungstag-Vorschlag + Anpassungs-Log (ohne Crash)', () => {
  const today = todayStr();
  // 3 fordernde Tage in Folge -> Erholungstag-Vorschlag triggert
  store.replaceArea('sessions', [
    { id: 's1', date: today, type: 'tempo', distanceKm: 10, durationSec: 3000, rpe: 8, status: 'erledigt' },
    { id: 's2', date: addDays(today, -1), type: 'tempo', distanceKm: 10, durationSec: 3000, rpe: 8, status: 'erledigt' },
    { id: 's3', date: addDays(today, -2), type: 'interval', distanceKm: 9, durationSec: 2700, rpe: 8, status: 'erledigt' },
  ]);
  const plan = {
    id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(today, -14), endDate: addDays(today, 30), weeks: 7,
    phases: [{ key: 'build', name: 'Aufbau', color: '#3d8bff', startWeek: 1, endWeek: 7, focus: '' }],
    units: [{ id: 'u1', planId: 'p1', date: addDays(today, 1), dow: 2, week: 3, phase: 'build', type: 'tempo', title: 'Schwellenlauf', targetDistanceKm: 11, status: 'geplant' }],
    adaptLog: [{ id: 'al-1', ts: '2026-07-03T10:00:00Z', kind: 'deload', title: 'Entlastung eingeplant', reason: 'Belastung zuletzt hoch.', undo: { units: [] } }],
  };
  store.replaceArea('plans', [plan]);
  const view = setupShell();
  assert.doesNotThrow(() => dashboard.render(view));
  assert.match(view.textContent, /Erholungstag empfohlen/);
  assert.match(view.textContent, /Zuletzt automatisch angepasst/);
});

test('plans.render: Wochen-Check zeigt Kollision (R3-Triage, ohne Crash)', () => {
  const today = todayStr();
  const ws = weekStartMonday(today);
  const ev = { id: 'e1', name: 'HM', date: addDays(today, 60), distanceKm: 21.0975, kind: 'race', sport: 'run', targetTime: '01:55:00' };
  store.replaceArea('events', [ev]);
  const plan = {
    id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(ws, -14), endDate: ev.date, weeks: 12,
    phases: [{ key: 'build', name: 'Aufbau', color: '#3d8bff', startWeek: 1, endWeek: 12, focus: '' }],
    weekTemplate: plans.DEFAULT_WEEK_TEMPLATE, commitments: [],
    // Zwei harte Einheiten an aufeinanderfolgenden Tagen DER LAUFENDEN WOCHE (Mi+Do) –
    // datums-robust (funktioniert auch, wenn heute ein Sonntag ist).
    units: [
      { id: 'u1', date: addDays(ws, 2), type: 'tempo', title: 'Schwelle', status: 'geplant', week: 3, phase: 'build' },
      { id: 'u2', date: addDays(ws, 3), type: 'interval', title: 'VO2max', status: 'geplant', week: 3, phase: 'build' },
    ],
  };
  store.replaceArea('plans', [plan]);
  const view = setupShell();
  assert.doesNotThrow(() => plans.render(view, 'e1'));
  assert.match(view.textContent, /Wochen-Check/);
});

test('dashboard.render: R4 Ziel-Cockpit (Dual-Goal HM + Abnehmen)', () => {
  const today = todayStr();
  store.setProfile({ name: 'Nora', weightKg: 72, targetWeightKg: 65, heightCm: 170, birthYear: 1990, sex: 'w' });
  store.replaceArea('health', [{ id: 'h1', date: addDays(today, -2), weight: 70 }]);
  store.replaceArea('events', [{ id: 'e1', name: 'Stadtlauf Halbmarathon', date: addDays(today, 60), distanceKm: 21.0975, kind: 'race', targetTime: '01:55:00' }]);
  store.replaceArea('sessions', [
    { id: 's1', date: addDays(today, -3), type: 'tempo', distanceKm: 10, durationSec: 3000, rpe: 7, status: 'erledigt' },
    { id: 's2', date: addDays(today, -6), type: 'long', distanceKm: 16, durationSec: 6000, rpe: 6, status: 'erledigt' },
  ]);
  store.replaceArea('plans', [{
    id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(today, -14), endDate: addDays(today, 60), weeks: 11,
    phases: [{ key: 'base', name: 'Grundlage', startWeek: 1, endWeek: 5 }, { key: 'build', name: 'Aufbau', startWeek: 6, endWeek: 11 }],
    commitments: [], units: [],
  }]);
  const view = setupShell();
  assert.doesNotThrow(() => dashboard.render(view));
  assert.match(view.textContent, /Ziel-Cockpit · Halbmarathon \+ Abnehmen/);
  assert.match(view.textContent, /Empfohlenes Defizit/);
});

test('events.renderDetail: Event mit Plan rendert', () => {
  const today = todayStr();
  const ev = { id: 'e9', name: 'Stadtlauf', date: addDays(today, 30), distanceKm: 10, sport: 'run', status: 'geplant', priority: 'A', targetTime: '00:50:00' };
  store.replaceArea('events', [ev]);
  const view = setupShell();
  assert.doesNotThrow(() => events.renderDetail(view, 'e9'));
  assert.match(view.textContent, /Stadtlauf/);
});

test('nutrition.render: mit Mahlzeiten + Kalorienbilanz', () => {
  store.replaceArea('nutrition', [
    { id: 'n1', title: 'Skyr-Bowl', category: 'fruehstueck', kcal: 380, protein: 32, ingredients: ['250 g Skyr'], tags: ['proteinreich'], lastCooked: todayStr(), cookedCount: 1 },
  ]);
  const view = setupShell();
  assert.doesNotThrow(() => nutrition.render(view));
  assert.match(view.textContent, /Skyr-Bowl/);
});

test('badges.render: mit absolvierten Sessions', () => {
  const today = todayStr();
  const sessions = [];
  for (let i = 0; i < 12; i++) sessions.push({ id: 'b' + i, date: addDays(today, -i * 2), type: 'easy', distanceKm: 6, status: 'erledigt' });
  store.replaceArea('sessions', sessions);
  const view = setupShell();
  assert.doesNotThrow(() => badges.render(view));
  assert.ok(view.textContent.length > 0);
});

test('calendar.render: mit geplanten Einheiten im Monat', () => {
  const today = todayStr();
  store.replaceArea('plans', [{
    id: 'p1', eventId: 'e1', name: 'Plan', generated: true,
    units: [
      { id: 'u1', date: today, type: 'easy', title: 'Lauf', status: 'geplant', targetDistanceKm: 7 },
      { id: 'u2', date: addDays(today, 1), type: 'tempo', title: 'Tempo', status: 'geplant', targetDistanceKm: 9 },
    ],
  }]);
  store.replaceArea('events', [{ id: 'e1', name: 'HM', date: addDays(today, 40), distanceKm: 21.1, sport: 'run', status: 'geplant' }]);
  const view = setupShell();
  assert.doesNotThrow(() => calendar.render(view));
  assert.ok(view.textContent.length > 0);
});

test('health.render: mit Körperwerten zeigt Trends', () => {
  const today = todayStr();
  store.replaceArea('health', [
    { id: 'h1', date: addDays(today, -20), weight: 70, restingHr: 58, hrv: 45 },
    { id: 'h2', date: addDays(today, -10), weight: 69, restingHr: 56, hrv: 48 },
    { id: 'h3', date: today, weight: 68, restingHr: 54, hrv: 52 },
  ]);
  const view = setupShell();
  assert.doesNotThrow(() => health.render(view));
  assert.ok(view.textContent.length > 0);
});

test('cycle.render: aktiviertes Modul rendert ohne Crash', () => {
  store.setSetting('modules', { cycle: true });
  store.replaceArea('cycle', [{ id: 'c1', date: addDays(todayStr(), -14), periodStart: true }]);
  const view = setupShell();
  assert.doesNotThrow(() => cycle.render(view));
  assert.ok(view.textContent.length > 0);
});
