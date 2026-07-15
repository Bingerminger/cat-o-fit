/* Unit-Tests für js/planflow.js — Belastungsklassen, Wochenfenster und der
   Ausgleichsvorschlag beim Hinzufügen einer eigenen Einheit (#2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClass, unitsInWeek, weekLoad, suggestOffsetUnit, isHard, rescheduleCheck, mergeRegeneratedWeek, softenSuggestion, easierVariant, missedKeyUnits, findMakeupDay, weekDeloadCandidates, deloadVariant, progressVariant, dayLoadUnits } from '../js/planflow.js';
import { addDays } from '../js/ui.js';

// 2026-06-28 ist ein Sonntag -> Woche Mo 22.06. bis So 28.06.
const MON = '2026-06-22', WED = '2026-06-24', FRI = '2026-06-26', SUN = '2026-06-28';
const T = SUN; // Bezugstag für die adaptiven Tests
const NEXT = '2026-06-30'; // Dienstag der Folgewoche

test('loadClass: Typen den Belastungsklassen zugeordnet', () => {
  assert.equal(loadClass('tempo'), 'quality');
  assert.equal(loadClass('interval'), 'quality');
  assert.equal(loadClass('easy'), 'endurance');
  assert.equal(loadClass('long'), 'endurance');
  assert.equal(loadClass('recovery'), 'recovery');
  assert.equal(loadClass('strength'), 'strength');
  assert.equal(loadClass('rest'), 'other');
  // Testspiel & Trainingslager gelten als fordernd (#12)
  assert.equal(loadClass('match'), 'quality');
  assert.equal(loadClass('camp'), 'quality');
  assert.equal(isHard({ type: 'match' }), true);
  assert.equal(isHard({ type: 'camp' }), true);
});

test('unitsInWeek: nur dieselbe Mo–So-Woche, ohne verpasst/verschoben/rest', () => {
  const units = [
    { id: 'a', date: MON, type: 'easy', status: 'geplant' },
    { id: 'b', date: FRI, type: 'tempo', status: 'erledigt' },
    { id: 'c', date: SUN, type: 'rest', status: 'geplant' },        // Ruhetag zählt nicht
    { id: 'd', date: WED, type: 'easy', status: 'verpasst' },        // verpasst zählt nicht
    { id: 'e', date: NEXT, type: 'easy', status: 'geplant' },        // andere Woche
  ];
  const inWeek = unitsInWeek(units, SUN).map((u) => u.id).sort();
  assert.deepEqual(inWeek, ['a', 'b']);
});

test('weekLoad: zählt Einheiten und km (Ziel oder tatsächlich)', () => {
  const units = [
    { id: 'a', date: MON, type: 'easy', status: 'geplant', targetDistanceKm: 8 },
    { id: 'b', date: FRI, type: 'long', status: 'erledigt', distanceKm: 15 },
  ];
  const l = weekLoad(units, SUN);
  assert.equal(l.count, 2);
  assert.equal(l.km, 23);
});

test('suggestOffsetUnit: schlägt gleiche Belastungsklasse derselben Woche vor', () => {
  const units = [
    { id: 'easy1', date: MON, type: 'easy', status: 'geplant' },
    { id: 'tempo1', date: WED, type: 'tempo', status: 'geplant' },
    { id: 'done', date: FRI, type: 'easy', status: 'erledigt' }, // erledigt -> nicht abwählbar
  ];
  // Nora fügt am Sonntag einen Extra-Lauf (endurance) hinzu
  const neu = { id: 'neu', date: SUN, type: 'easy', status: 'geplant' };
  const offset = suggestOffsetUnit(units, neu);
  assert.equal(offset.id, 'easy1'); // der offene Grundlagenlauf, nicht die erledigte/Quali-Einheit
});

test('suggestOffsetUnit: kein Vorschlag ohne vergleichbare Einheit', () => {
  const units = [{ id: 'tempo1', date: WED, type: 'tempo', status: 'geplant' }];
  const neu = { id: 'neu', date: SUN, type: 'strength', status: 'geplant' };
  assert.equal(suggestOffsetUnit(units, neu), null);
  // ebenso, wenn die Woche leer ist
  assert.equal(suggestOffsetUnit([], neu), null);
});

test('isHard: Qualität, Kraft und Long Run sind fordernd', () => {
  assert.equal(isHard({ type: 'interval' }), true);
  assert.equal(isHard({ type: 'strength' }), true);
  assert.equal(isHard({ type: 'long' }), true);
  assert.equal(isHard({ type: 'easy' }), false);
  assert.equal(isHard({ type: 'recovery' }), false);
});

test('isHard: Fußball ist fordernd – außer ausdrücklich „leicht" (#5)', () => {
  assert.equal(isHard({ type: 'cross_football' }), true);                       // ohne Angabe = normal
  assert.equal(isHard({ type: 'cross_football', intensity: 'normal' }), true);
  assert.equal(isHard({ type: 'cross_football', intensity: 'intensiv' }), true);
  assert.equal(isHard({ type: 'cross_football', intensity: 'leicht' }), false);
});

test('dayLoadUnits: offene, nicht-fixe, lastrelevante Einheiten eines Tages (#4)', () => {
  const D = '2026-07-11';
  const units = [
    { id: 'a', date: D, type: 'long', status: 'geplant' },
    { id: 'b', date: D, type: 'strength', status: 'geplant' },
    { id: 'c', date: D, type: 'cross_football', fixed: true, status: 'geplant' }, // fester Termin -> aus
    { id: 'd', date: D, type: 'easy', status: 'erledigt' },                        // erledigt -> aus
    { id: 'e', date: D, type: 'rest' },                                            // Ruhetag -> aus
    { id: 'f', date: '2026-07-12', type: 'tempo', status: 'geplant' },             // anderer Tag -> aus
  ];
  assert.deepEqual(dayLoadUnits(units, D).map((u) => u.id).sort(), ['a', 'b']);
});

test('rescheduleCheck: erkennt Doppelbelastung am Zieltag', () => {
  const units = [
    { id: 'move', date: MON, type: 'easy', status: 'geplant' },
    { id: 'fix', date: FRI, type: 'easy', status: 'geplant' },
  ];
  const r = rescheduleCheck(units, 'move', FRI);
  assert.equal(r.sameDay.id, 'fix');
  assert.equal(r.hardNeighbor, null);
});

test('rescheduleCheck: warnt vor harter Einheit ohne Erholungstag', () => {
  const units = [
    { id: 'move', date: MON, type: 'tempo', status: 'geplant' },     // hart
    { id: 'long', date: SUN, type: 'long', status: 'geplant' },      // hart, am Folgetag von FRI? nein
    { id: 'quali', date: WED, type: 'interval', status: 'geplant' }, // hart
  ];
  // Tempo von MON auf DO (24->25) verschieben -> Nachbar WED(interval) am Vortag
  const THU = '2026-06-25';
  const r = rescheduleCheck(units, 'move', THU);
  assert.equal(r.hardNeighbor.unit.id, 'quali');
  assert.equal(r.hardNeighbor.dir, 'prev');
});

test('rescheduleCheck: weiche Einheit verschoben -> keine Erholungswarnung', () => {
  const units = [
    { id: 'move', date: MON, type: 'easy', status: 'geplant' },
    { id: 'quali', date: WED, type: 'interval', status: 'geplant' },
  ];
  const THU = '2026-06-25';
  const r = rescheduleCheck(units, 'move', THU); // easy neben interval = ok
  assert.equal(r.hardNeighbor, null);
});

test('mergeRegeneratedWeek: erledigte bleiben, Rest wird ersetzt, keine Dubletten (#10)', () => {
  const existing = [
    { id: 'mo-done', date: MON, type: 'easy', status: 'erledigt' },   // bleibt
    { id: 'mi-open', date: WED, type: 'tempo', status: 'geplant' },   // wird ersetzt
    { id: 'fr-missed', date: FRI, type: 'easy', status: 'verpasst' }, // wird ersetzt
  ];
  const fresh = [
    { id: 'f-mo', date: MON, type: 'long', status: 'geplant' },   // entfällt (Mo schon erledigt)
    { id: 'f-mi', date: WED, type: 'interval', status: 'geplant' },
    { id: 'f-fr', date: FRI, type: 'strength', status: 'geplant' },
  ];
  const merged = mergeRegeneratedWeek(existing, fresh);
  const ids = merged.map((u) => u.id).sort();
  assert.deepEqual(ids, ['f-fr', 'f-mi', 'mo-done']);
  // Montag bleibt die erledigte Einheit, kein frischer Long
  assert.equal(merged.find((u) => u.date === MON).id, 'mo-done');
});

test('mergeRegeneratedWeek: ohne erledigte einfach die frischen', () => {
  const merged = mergeRegeneratedWeek([{ id: 'a', date: MON, status: 'geplant' }], [{ id: 'f', date: MON, status: 'geplant' }]);
  assert.deepEqual(merged.map((u) => u.id), ['f']);
});

test('softenSuggestion: lockern nur bei niedriger Bereitschaft + harter Einheit', () => {
  const hard = [{ id: 'q', type: 'tempo', status: 'geplant' }];
  assert.equal(softenSuggestion(hard, { score: 42 }).unit.id, 'q');
  assert.equal(softenSuggestion(hard, { score: 60 }), null);                 // solide -> kein Vorschlag
  assert.equal(softenSuggestion([{ id: 'e', type: 'easy', status: 'geplant' }], { score: 40 }), null); // weiche Einheit
  assert.equal(softenSuggestion(hard, null), null);
  assert.equal(softenSuggestion([{ id: 'q', type: 'tempo', status: 'erledigt' }], { score: 40 }), null); // schon erledigt
});

test('easierVariant: Typ easy, ~60 % Distanz, Original gemerkt', () => {
  const v = easierVariant({ type: 'tempo', targetDistanceKm: 10 }, { min: 360, max: 385, hrZone: 2 });
  assert.equal(v.type, 'easy');
  assert.equal(v.targetDistanceKm, 6);
  assert.equal(v.targetPaceSecPerKm, 360);
  assert.equal(v.softened, true);
  assert.equal(v.originalType, 'tempo');
});

test('missedKeyUnits: nur verpasste harte Einheiten im Fenster, jüngste zuerst', () => {
  const plans = [{ units: [
    { id: 'q1', date: addDays(T, -2), type: 'tempo', status: 'verpasst' },
    { id: 'q2', date: addDays(T, -5), type: 'interval', status: 'verpasst' },
    { id: 'e1', date: addDays(T, -1), type: 'easy', status: 'verpasst' },      // weich
    { id: 'q3', date: addDays(T, -20), type: 'long', status: 'verpasst' },     // außerhalb
    { id: 'q4', date: addDays(T, -3), type: 'tempo', status: 'erledigt' },     // erledigt
  ] }];
  assert.deepEqual(missedKeyUnits(plans, T, 10).map((u) => u.id), ['q1', 'q2']);
});

test('findMakeupDay: erster freier Tag ohne fordernden Nachbarn', () => {
  const units = [{ id: 'x', date: addDays(T, 2), type: 'tempo', status: 'geplant' }];
  const day = findMakeupDay(units, { id: 'm', type: 'tempo' }, T, 7);
  assert.equal(day, addDays(T, 4)); // T+1 (Nachbar T+2 hart), T+2 belegt, T+3 (Nachbar hart) -> T+4
});

test('findMakeupDay: alles frei -> morgen; nichts frei -> null', () => {
  assert.equal(findMakeupDay([], { id: 'm', type: 'tempo' }, T, 7), addDays(T, 1));
  const fullHard = [];
  for (let i = 1; i <= 7; i++) fullHard.push({ id: 'h' + i, date: addDays(T, i), type: 'tempo', status: 'geplant' });
  assert.equal(findMakeupDay(fullHard, { id: 'm', type: 'tempo' }, T, 7), null);
});

test('weekDeloadCandidates: offene lastrelevante Einheiten der nächsten 7 Tage', () => {
  const units = [
    { id: 'a', date: T, type: 'tempo', status: 'geplant' },
    { id: 'b', date: addDays(T, 3), type: 'easy', status: 'geplant' },
    { id: 'c', date: addDays(T, 3), type: 'rest', status: 'geplant' },     // Ruhetag
    { id: 'd', date: addDays(T, 3), type: 'tempo', status: 'erledigt' },   // erledigt
    { id: 'e', date: addDays(T, 10), type: 'tempo', status: 'geplant' },   // außerhalb
    { id: 'f', date: addDays(T, -1), type: 'tempo', status: 'geplant' },   // vergangen
  ];
  assert.deepEqual(weekDeloadCandidates(units, T, 7).map((u) => u.id).sort(), ['a', 'b']);
});

test('progressVariant: Umfang ~12 % rauf, Typ bleibt', () => {
  const v = progressVariant({ type: 'easy', targetDistanceKm: 10 });
  assert.equal(v.targetDistanceKm, 11); // 10 * 1.12 = 11.2 -> 11 (auf 0,5 gerundet)
  assert.equal(v.boosted, true);
  assert.equal(v.type, undefined); // kein Typwechsel
  const dur = progressVariant({ type: 'cross', targetDurationMin: 60 });
  assert.equal(dur.targetDurationMin, 66);
});

test('deloadVariant: harte Einheit -> easy + ~75 % Umfang; weiche -> nur Umfang', () => {
  const hard = deloadVariant({ type: 'interval', targetDistanceKm: 10 });
  assert.equal(hard.type, 'easy');
  assert.equal(hard.targetDistanceKm, 7.5);
  assert.equal(hard.deloaded, true);
  const soft = deloadVariant({ type: 'easy', targetDistanceKm: 12 });
  assert.equal(soft.targetDistanceKm, 9);
  assert.equal(soft.type, undefined); // Typ bleibt unverändert (Patch ohne type)
});
