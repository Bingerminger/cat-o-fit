import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { dayIsHard, consecutiveHardDays, restDaySuggestion, recoveryVariant, pushAdaptLog, footballFollowupEase, gentleVariant } from '../js/rolling.js';

const TODAY = '2026-07-06'; // Monday
const S = (offset, rpe, type = 'tempo', durMin = 60) => ({ date: addDays(TODAY, -offset), durationSec: durMin * 60, rpe, type });

test('dayIsHard: completed hard unit or hard session', () => {
  assert.equal(dayIsHard([{ date: TODAY, status: 'erledigt', type: 'tempo' }], [], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, rpe: 8, type: 'easy' }], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, rpe: 3, type: 'easy' }], TODAY), false);
  // Football counts as a hard day – unless "light" (#5)
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football' }], TODAY), true);
  assert.equal(dayIsHard([], [{ date: TODAY, type: 'cross_football', intensity: 'leicht' }], TODAY), false);
});

test('footballFollowupEase: after ACTUALLY demanding football the next hard unit is eased (#5)', () => {
  const units = [
    { id: 'fb', date: TODAY, type: 'cross_football', intensity: 'intensiv', fixed: true, status: 'erledigt' },
    { id: 'q', date: addDays(TODAY, 1), type: 'tempo', status: 'geplant' },
  ];
  const r = footballFollowupEase({ units, sessions: [], today: TODAY });
  assert.ok(r, 'candidate found');
  assert.equal(r.unit.id, 'q');       // the tempo unit on the following day
  assert.equal(r.when, 'heute');
  // "light" triggers nothing
  assert.equal(footballFollowupEase({ units: [{ ...units[0], intensity: 'leicht' }, units[1]], sessions: [], today: TODAY }), null);
  // without a following hard unit likewise nothing
  assert.equal(footballFollowupEase({ units: [units[0]], sessions: [], today: TODAY }), null);
  // A logged football session (yesterday) counts the same – a match too
  const played = footballFollowupEase({ units: [units[1]], sessions: [{ date: addDays(TODAY, -1), type: 'match' }], today: TODAY });
  assert.equal(played && played.when, 'gestern');
});

test('TRAIN-03: only PLANNED football (not played yet) triggers no easing', () => {
  // The generator takes the week structure into account – the coach reacts only to what actually happened.
  const units = [
    { id: 'fb', date: TODAY, type: 'cross_football', intensity: 'intensiv', fixed: true, status: 'geplant' },
    { id: 'q', date: addDays(TODAY, 1), type: 'tempo', status: 'geplant' },
  ];
  assert.equal(footballFollowupEase({ units, sessions: [], today: TODAY }), null);
});

test('TRAIN-03: hard days in a row that follow the plan do not trigger a recovery day', () => {
  // Mon football, Tue tempo, Wed football – planned that way and done that way. It used to say: "3 demanding
  // days in a row – recovery …" for exactly the long run that the plan sets as its most important unit.
  const d = (n) => addDays(TODAY, n);
  const units = [
    { id: 'm', date: d(-2), type: 'cross_football', fixed: true, status: 'erledigt' },
    { id: 't', date: d(-1), type: 'tempo', status: 'erledigt' },
    { id: 'w', date: d(0), type: 'cross_football', fixed: true, status: 'erledigt' },
    { id: 'l', date: d(2), type: 'long', status: 'geplant' },
  ];
  assert.equal(restDaySuggestion({ plan: { units }, sessions: [], today: TODAY }), null);
  // If the planned easy unit runs hard instead (RPE 8), that is a deviation.
  const units2 = units.map((u) => (u.id === 't' ? { ...u, type: 'easy' } : u));
  const sessions = [{ date: d(-1), type: 'easy', rpe: 8, durationSec: 3600 }];
  const rd = restDaySuggestion({ plan: { units: units2 }, sessions, today: TODAY });
  assert.ok(rd && rd.unit.id === 'l', 'deviation from the plan → recovery day');
  assert.match(rd.reason, /mehr als geplant/);
});

test('TRAIN-03: no long run is cancelled days in advance – only the next 48 hours', () => {
  const sessions = [S(0, 8, 'tempo'), S(1, 8, 'tempo'), S(2, 8, 'tempo')];   // unplanned hard
  const far = { units: [{ id: 'l', date: addDays(TODAY, 4), status: 'geplant', type: 'long' }] };
  assert.equal(restDaySuggestion({ plan: far, sessions, today: TODAY }), null, 'easy days lie in between');
  const near = { units: [{ id: 'l', date: addDays(TODAY, 2), status: 'geplant', type: 'long' }] };
  assert.equal(restDaySuggestion({ plan: near, sessions, today: TODAY }).unit.id, 'l');
});

test('TRAIN-03: a high load ratio that matches the plan is no warning sign', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 4, 'easy', 40));          // quiet baseline
  for (let i = 0; i < 7; i++) sessions.push(S(i, 7, 'tempo', 60));          // clearly more …
  // … but planned exactly that way: 7 tempo units of 60 min in the last 7 days.
  const planned = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, date: addDays(TODAY, -i), type: 'tempo', targetDurationMin: 60, status: 'erledigt' }));
  const plan = { units: [...planned, { id: 'next', date: addDays(TODAY, 1), type: 'interval', status: 'geplant' }] };
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('gentleVariant: runs -> recovery, strength -> mobility, keeps originalType (#3/#4)', () => {
  const run = gentleVariant({ type: 'long', targetDistanceKm: 18 });
  assert.equal(run.type, 'recovery');
  assert.equal(run.originalType, 'long');
  assert.ok(run.targetDistanceKm <= 5);
  const str = gentleVariant({ type: 'strength' });
  assert.equal(str.type, 'mobility');
  assert.equal(str.originalType, 'strength');
});

test('consecutiveHardDays: counts the streak backwards, stops at a gap', () => {
  assert.equal(consecutiveHardDays([], [S(0, 8), S(1, 8), S(2, 8)], TODAY), 3);
  assert.equal(consecutiveHardDays([], [S(0, 8), S(2, 8)], TODAY), 1); // -1 is missing
});

test('restDaySuggestion: ACWR spike -> next open hard unit (fixed appointments skipped)', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 2, 'easy', 30));  // quiet baseline
  for (let i = 0; i < 7; i++) sessions.push(S(i, 9, 'interval', 120)); // hard week
  const plan = { units: [
    { id: 'c1', date: addDays(TODAY, 1), status: 'geplant', type: 'match', fixed: true }, // fixed -> skip
    { id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'tempo' },              // open, hard
  ] };
  const rd = restDaySuggestion({ plan, sessions, today: TODAY });
  assert.ok(rd, 'suggestion expected');
  assert.equal(rd.unit.id, 'u1');
  assert.match(rd.reason, /Verhältnis/);
  assert.doesNotMatch(rd.reason, /sicheren Bereich|schützt|Verletzung/);   // TRAIN-24
});

test('restDaySuggestion: calm situation -> null', () => {
  const sessions = [];
  for (let i = 0; i < 28; i++) sessions.push(S(i, 4, 'easy', 40));
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'tempo' }] };
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('restDaySuggestion: 3 hard days in a row trigger even without ACWR', () => {
  const sessions = [S(0, 8, 'tempo'), S(1, 8, 'tempo'), S(2, 8, 'tempo')];
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'geplant', type: 'long' }] };
  const rd = restDaySuggestion({ plan, sessions, today: TODAY });
  assert.ok(rd && rd.hardStreak >= 3);
});

test('restDaySuggestion: no open hard unit on the horizon -> null', () => {
  const sessions = [S(0, 8), S(1, 8), S(2, 8)];
  const plan = { units: [{ id: 'u1', date: addDays(TODAY, 1), status: 'erledigt', type: 'tempo' }] }; // already done
  assert.equal(restDaySuggestion({ plan, sessions, today: TODAY }), null);
});

test('recoveryVariant: hard -> active recovery day', () => {
  const v = recoveryVariant({ type: 'tempo', title: 'Schwelle', targetDistanceKm: 11 });
  assert.equal(v.type, 'recovery');
  assert.equal(v.autoRest, true);
  assert.equal(v.originalType, 'tempo');
  assert.ok(v.targetDistanceKm <= 5);
});

test('pushAdaptLog: newest first, id/ts set, capped at max', () => {
  let log = [];
  for (let i = 0; i < 30; i++) log = pushAdaptLog(log, { kind: 'rest', title: 'x' + i });
  assert.equal(log.length, 25);
  assert.equal(log[0].title, 'x29');
  assert.ok(log[0].id && log[0].ts);
});
