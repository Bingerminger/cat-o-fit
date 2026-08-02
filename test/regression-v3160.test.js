/* =========================================================================
   Regressionstests zum Review v3.16.0 — jeder Test hält genau einen der
   damals gefundenen Fehler fest, damit er nicht zurückkehrt.
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
import { makePhases, longRunStartKm, buildWeekUnits, DEFAULT_WEEK_TEMPLATE } from '../js/plans.js';

const T = '2026-06-17'; // Mittwoch

/* ---- Verschobene Einheiten zählen weiter zur Belastung ------------------ */

test('v3.16.0: verschobene Einheit bleibt in Wochenlast, Triage und What-if sichtbar', () => {
  // Altbestand: Status "verschoben" (vor v3.16.0 gesetzt) am neuen Datum.
  const units = [
    { id: 'a', date: '2026-06-16', type: 'tempo', status: 'verschoben', targetDistanceKm: 10 },
    { id: 'b', date: '2026-06-18', type: 'easy', status: 'geplant', targetDistanceKm: 8 },
  ];
  assert.equal(unitsInWeek(units, T).length, 2, 'Wochenlast zählt die verschobene Einheit mit');
  assert.equal(weekUnits(units, T).length, 2, 'Triage sieht die verschobene Einheit');
  assert.equal(weekPlan(units, T).count, 2, 'What-if rechnet sie ein');
  assert.ok(isOpen(units[0]), 'verschoben gilt als offen/veränderbar');
});

test('v3.16.0: ein Tag mit verschobener Einheit gilt nicht mehr als frei', () => {
  const units = [{ id: 'a', date: addDays(T, 2), type: 'tempo', status: 'verschoben' }];
  const day = findMakeupDay(units, { id: 'x' }, T, 7);
  assert.notEqual(day, addDays(T, 2), 'belegter Tag wird nicht als Nachholtag vorgeschlagen');
});

test('v3.16.0: movedFrom steuert nur die Anzeige, nicht die Berechnung', () => {
  const u = { id: 'a', date: addDays(T, 1), type: 'tempo', status: 'geplant', movedFrom: T };
  assert.equal(effectiveStatus(u, T), 'verschoben', 'Chip zeigt weiterhin „Verschoben"');
  assert.equal(unitsInWeek([u], T).length, 1, 'zählt trotzdem zur Wochenlast');
});

/* ---- Plan-Generator ----------------------------------------------------- */

test('v3.16.0: Long-Run-Start folgt dem Niveau, nicht der halben Renndistanz', () => {
  // Marathon ohne Historie: früher 21,1 km in Woche 1.
  const noHistory = longRunStartKm(42.195, null);
  assert.ok(noHistory <= 12, `konservativer Einstieg ohne Historie, war ${noHistory}`);
  // Mit Historie hebt sich der Start auf das tatsächliche Niveau.
  assert.equal(longRunStartKm(42.195, 24), 24);
  // …aber nie über die Spitzendistanz hinaus.
  assert.ok(longRunStartKm(42.195, 40) <= 32);
});

test('v3.16.0: Kurzpläne enden immer mit einer Tapering-Woche', () => {
  for (const weeks of [2, 3, 4, 8, 16]) {
    const phases = makePhases(weeks);
    assert.equal(phases.at(-1).key, 'taper', `${weeks} Wochen: letzte Phase ist Tapering`);
    assert.equal(phases.at(-1).endWeek, weeks);
    assert.equal(phases[0].startWeek, 1);
  }
});

test('v3.16.0: fester Termin verdrängt die Schlüsseleinheit, statt sie zu streichen', () => {
  const plan = {
    id: 'p1', startDate: '2026-06-15', weeks: 4, eventId: 'e1',
    phases: makePhases(4), weekTemplate: DEFAULT_WEEK_TEMPLATE,
    // Fußball Di + Do – genau die Tage von Schlüsseleinheit und Umfangslauf.
    commitments: [
      { id: 'c1', type: 'cross_football', dow: 2, durationMin: 90, intensity: 'normal' },
      { id: 'c2', type: 'cross_football', dow: 4, durationMin: 90, intensity: 'normal' },
    ],
  };
  const event = { id: 'e1', date: '2026-07-12', distanceKm: 21.0975 };
  const units = buildWeekUnits(plan, event, {}, 1);
  const types = units.map((u) => u.type);
  assert.ok(types.includes('cross_football'), 'feste Termine stehen im Plan');
  assert.ok(units.some((u) => u.relocatedFrom), 'verdrängte Einheit wurde verschoben, nicht gelöscht');
  // Der Schlüsselreiz (quality -> tempo/easy/interval) darf nicht ersatzlos fehlen.
  assert.ok(units.some((u) => ['tempo', 'interval', 'easy'].includes(u.type)),
    'Laufeinheiten bleiben trotz zweier Termintage erhalten');
  // Kein Tag trägt gleichzeitig festen Termin und ausgewichene Einheit.
  const commitDates = new Set(units.filter((u) => u.fixed).map((u) => u.date));
  assert.ok(!units.some((u) => !u.fixed && commitDates.has(u.date)), 'kein Doppel am Termintag');
});

/* ---- Belastungs-Kennzahlen --------------------------------------------- */

test('v3.16.0: junge Historie erzeugt keinen ACWR-Fehlalarm', () => {
  // Erst seit 5 Tagen Daten: rechnerisch hoher ACWR, aber kein echter Lastsprung.
  const sessions = [
    { date: addDays(T, -4), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: addDays(T, -2), type: 'tempo', durationSec: 3600, rpe: 8 },
    { date: T, type: 'long', durationSec: 5400, rpe: 6 },
  ];
  const a = acwr(sessions, T);
  assert.equal(a.sparse, true, 'unvollständige Historie wird erkannt');
  assert.equal(a.zone, 'aufbau');
  assert.equal(loadSummary(sessions, T).hasData, false, 'Karte bewertet noch nicht');
  assert.equal(restDaySuggestion({ plan: { units: [] }, sessions, today: T }), null,
    'kein automatischer Erholungstag in der Aufbauphase der Datenbasis');
});

test('v3.16.0: Form ist bei konstanter Last nicht dauerhaft negativ (CTL-Warmup)', () => {
  // Ein halbes Jahr täglich gleiche Last -> Fitness und Ermüdung im Gleichgewicht.
  const sessions = [];
  for (let i = 0; i < 200; i++) sessions.push({ date: addDays(T, -i), type: 'easy', durationSec: 3600, rpe: 5 });
  const last = formSeries(sessions, T, { days: 7 }).at(-1);
  assert.ok(Math.abs(last.form) < 12, `Form nahe null statt künstlich negativ, war ${last.form}`);
  assert.ok(last.ctl > 250, `Fitness eingeschwungen, war ${last.ctl}`);
});

test('v3.16.0: Statistik-Ampel misst alle Sportarten (sRPE), nicht nur Lauf-km', () => {
  // Kraft und Fußball ohne km: früher blieb die Last hier komplett unsichtbar.
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push({ date: addDays(T, -i), type: 'strength', durationSec: 1800 });
  for (let i = 0; i < 7; i++) sessions.push({ date: addDays(T, -i), type: 'cross_football', durationSec: 5400, intensity: 'intensiv' });
  const lb = loadBalance(sessions, T);
  assert.equal(lb.last7, 0, 'keine Lauf-km vorhanden');
  assert.ok(lb.ratio > 1.3 && lb.level === 'hoch', `Belastungssprung erkannt (ratio ${lb.ratio})`);
});

test('v3.16.0: Monotonie nutzt die Stichproben-Standardabweichung (Foster)', () => {
  const sessions = [
    { date: addDays(T, -1), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: T, type: 'easy', durationSec: 3600, rpe: 5 },
  ];
  const m = monotonyStrain(sessions, T);
  // 2 Tage à 300, 5 Tage 0: Mittel 85,7; SD(n-1) ≈ 141,4 -> Monotonie ≈ 0,61.
  assert.ok(m.monotony > 0.55 && m.monotony < 0.68, `Monotonie ≈ 0,61, war ${m.monotony}`);
});

/* ---- Plan-Historie ------------------------------------------------------ */

test('v3.16.0: Neu-Generieren erhält erledigte Einheiten', () => {
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
  assert.ok(kept, 'erledigte Einheit überlebt das Neu-Generieren');
  assert.equal(kept.executedSessionId, 's1', 'Verknüpfung zur Session bleibt');
  assert.ok(!merged.some((u) => u.id === 'n1'), 'kein Duplikat am selben Tag');
  assert.ok(merged.some((u) => u.id === 'n2'), 'offene Tage werden frisch geplant');
});
