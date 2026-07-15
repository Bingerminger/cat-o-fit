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
  // Fußball zählt als harter Tag – außer „leicht" (#5)
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football' }], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football', intensity: 'leicht' }], TODAY), false);
});

test('footballFollowupEase: nach forderndem Fußball die nächste harte Einheit als Entlastung (#5)', () => {
  const units = [
    { id: 'fb', date: TODAY, type: 'cross_football', intensity: 'intensiv', fixed: true, status: 'geplant' },
    { id: 'q', date: addDays(TODAY, 1), type: 'tempo', status: 'geplant' },
  ];
  const r = footballFollowupEase({ units, sessions: [], today: TODAY });
  assert.ok(r, 'Kandidat gefunden');
  assert.equal(r.unit.id, 'q');       // die Tempoeinheit am Folgetag
  assert.equal(r.when, 'heute');
  // „leicht" löst nichts aus
  assert.equal(footballFollowupEase({ units: [{ ...units[0], intensity: 'leicht' }, units[1]], sessions: [], today: TODAY }), null);
  // ohne folgende harte Einheit ebenfalls nichts
  assert.equal(footballFollowupEase({ units: [units[0]], sessions: [], today: TODAY }), null);
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
  assert.match(rd.reason, /ACWR/);
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
