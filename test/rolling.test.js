import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { dayIsHard, consecutiveHardDays, restDaySuggestion, recoveryVariant, pushAdaptLog, footballFollowupEase, gentleVariant } from '../js/rolling.js';

const TODAY = '2026-07-06'; // Montag
const S = (offset, rpe, type = 'tempo', durMin = 60) => ({ date: addDays(TODAY, -offset), durationSec: durMin * 60, rpe, type });

test('dayIsHard: erledigte harte Einheit oder harte Session', () => {
  assert.equal(dayIsHard([{ date: TODAY, status: 'erledigt', type: 'tempo' }], [], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, rpe: 8, type: 'easy' }], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, rpe: 3, type: 'easy' }], TODAY), false);
  // Fußball zählt als harter Tag – außer „leicht“ (#5)
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football' }], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football', intensity: 'leicht' }], TODAY), false);
});

test('footballFollowupEase: nach TATSÄCHLICH forderndem Fußball die nächste harte Einheit als Entlastung (#5)', () => {
  const units = [
    { id: 'fb', date: TODAY, type: 'cross_football', intensity: 'intensiv', fixed: true, status: 'erledigt' },
    { id: 'q', date: addDays(TODAY, 1), type: 'tempo', status: 'geplant' },
  ];
  const r = footballFollowupEase({ units, sessions: [], today: TODAY });
  assert.ok(r, 'Kandidat gefunden');
  assert.equal(r.unit.id, 'q');       // die Tempoeinheit am Folgetag
  assert.equal(r.when, 'heute');
  // „leicht“ löst nichts aus
  assert.equal(footballFollowupEase({ units: [{ ...units[0], intensity: 'leicht' }, units[1]], sessions: [], today: TODAY }), null);
  // ohne folgende harte Einheit ebenfalls nichts
  assert.equal(footballFollowupEase({ units: [units[0]], sessions: [], today: TODAY }), null);
  // Eine erfasste Fußball-Session (gestern) zählt genauso – auch ein Spiel
  const played = footballFollowupEase({ units: [units[1]], sessions: [{ date: addDays(TODAY, -1), type: 'match' }], today: TODAY });
  assert.equal(played && played.when, 'gestern');
});

test('TRAIN-03: nur GEPLANTER Fußball (noch nicht gespielt) löst keine Entlastung aus', () => {
  // Die Wochenstruktur berücksichtigt der Generator – der Coach reagiert nur aufs Ist.
  const units = [
    { id: 'fb', date: TODAY, type: 'cross_football', intensity: 'intensiv', fixed: true, status: 'geplant' },
    { id: 'q', date: addDays(TODAY, 1), type: 'tempo', status: 'geplant' },
  ];
  assert.equal(footballFollowupEase({ units, sessions: [], today: TODAY }), null);
});

test('TRAIN-03: plangemäße harte Tage in Folge lösen keinen Erholungstag aus', () => {
  // Mo Fußball, Di Tempo, Mi Fußball – so geplant und so erledigt. Früher: „3 fordernde
  // Tage in Folge – Erholung …" für genau den Long Run, den der Plan als wichtigste Einheit setzt.
  const d = (n) => addDays(TODAY, n);
  const units = [
    { id: 'm', date: d(-2), type: 'cross_football', fixed: true, status: 'erledigt' },
    { id: 't', date: d(-1), type: 'tempo', status: 'erledigt' },
    { id: 'w', date: d(0), type: 'cross_football', fixed: true, status: 'erledigt' },
    { id: 'l', date: d(2), type: 'long', status: 'geplant' },
  ];
  assert.equal(restDaySuggestion({ plan: { units }, sessions: [], today: TODAY }), null);
  // Läuft die geplant lockere Einheit dagegen hart (RPE 8), ist das eine Abweichung.
  const units2 = units.map((u) => (u.id === 't' ? { ...u, type: 'easy' } : u));
  const sessions = [{ date: d(-1), type: 'easy', rpe: 8, durationSec: 3600 }];
  const rd = restDaySuggestion({ plan: { units: units2 }, sessions, today: TODAY });
  assert.ok(rd && rd.unit.id === 'l', 'Abweichung vom Plan → Erholungstag');
  assert.match(rd.reason, /mehr als geplant/);
});

test('TRAIN-03: kein Long Run wird Tage im Voraus gestrichen – nur die nächsten 48 Stunden', () => {
  const sessions = [S(0, 8, 'tempo'), S(1, 8, 'tempo'), S(2, 8, 'tempo')];   // ungeplant hart
  const far = { units: [{ id: 'l', date: addDays(TODAY, 4), status: 'geplant', type: 'long' }] };
  assert.equal(restDaySuggestion({ plan: far, sessions, today: TODAY }), null, 'dazwischen liegen lockere Tage');
  const near = { units: [{ id: 'l', date: addDays(TODAY, 2), status: 'geplant', type: 'long' }] };
  assert.equal(restDaySuggestion({ plan: near, sessions, today: TODAY }).unit.id, 'l');
});

test('TRAIN-03: ein hohes Lastverhältnis, das dem Plan entspricht, ist kein Warnsignal', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 4, 'easy', 40));          // ruhige Basis
  for (let i = 0; i < 7; i++) sessions.push(S(i, 7, 'tempo', 60));          // deutlich mehr …
  // … aber genau so geplant: 7 Tempoeinheiten à 60 min in den letzten 7 Tagen.
  const planned = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, date: addDays(TODAY, -i), type: 'tempo', targetDurationMin: 60, status: 'erledigt' }));
  const plan = { units: [...planned, { id: 'next', date: addDays(TODAY, 1), type: 'interval', status: 'geplant' }] };
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('gentleVariant: Läufe -> Recovery, Kraft -> Mobility, behält originalType (#3/#4)', () => {
  const run = gentleVariant({ type: 'long', targetDistanceKm: 18 });
  assert.equal(run.type, 'recovery');
  assert.equal(run.originalType, 'long');
  assert.ok(run.targetDistanceKm <= 5);
  const str = gentleVariant({ type: 'strength' });
  assert.equal(str.type, 'mobility');
  assert.equal(str.originalType, 'strength');
});

test('consecutiveHardDays: zählt Serie rückwärts, bricht bei Lücke ab', () => {
  assert.equal(consecutiveHardDays([], [S(0, 8), S(1, 8), S(2, 8)], TODAY), 3);
  assert.equal(consecutiveHardDays([], [S(0, 8), S(2, 8)], TODAY), 1); // -1 fehlt
});

test('restDaySuggestion: ACWR-Sprung -> nächste offene harte Einheit (feste Termine übersprungen)', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 2, 'easy', 30));  // ruhige Basis
  for (let i = 0; i < 7; i++) sessions.push(S(i, 9, 'interval', 120)); // harte Woche
  const plan = { units: [
    { id: 'c1', date: addDays(TODAY, 1), status: 'geplant', type: 'match', fixed: true }, // fest -> skip
    { id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'tempo' },              // offen, hart
  ] };
  const rd = restDaySuggestion({ plan, sessions, today: TODAY });
  assert.ok(rd, 'Vorschlag erwartet');
  assert.equal(rd.unit.id, 'u1');
  assert.match(rd.reason, /Verhältnis/);
  assert.doesNotMatch(rd.reason, /sicheren Bereich|schützt|Verletzung/);   // TRAIN-24
});

test('restDaySuggestion: ruhige Lage -> null', () => {
  const sessions = [];
  for (let i = 0; i < 28; i++) sessions.push(S(i, 4, 'easy', 40));
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'tempo' }] };
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('restDaySuggestion: 3 harte Tage in Folge triggert auch ohne ACWR', () => {
  const sessions = [S(0, 8, 'tempo'), S(1, 8, 'tempo'), S(2, 8, 'tempo')];
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'long' }] };
  const rd = restDaySuggestion({ plan, sessions, today: TODAY });
  assert.ok(rd && rd.hardStreak >= 3);
});

test('restDaySuggestion: keine offene harte Einheit im Horizont -> null', () => {
  const sessions = [S(0, 8), S(1, 8), S(2, 8)];
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'erledigt', type: 'tempo' }] }; // schon erledigt
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('recoveryVariant: hart -> aktiver Erholungstag', () => {
  const v = recoveryVariant({ type: 'tempo', title: 'Schwelle', targetDistanceKm: 11 });
  assert.equal(v.type, 'recovery');
  assert.equal(v.autoRest, true);
  assert.equal(v.originalType, 'tempo');
  assert.ok(v.targetDistanceKm <= 5);
});

test('pushAdaptLog: neuestes vorne, id/ts gesetzt, auf max gedeckelt', () => {
  let log = [];
  for (let i = 0; i < 30; i++) log = pushAdaptLog(log, { kind: 'rest', title: 'x' + i });
  assert.equal(log.length, 25);
  assert.equal(log[0].title, 'x29');
  assert.ok(log[0].id && log[0].ts);
});
