/* Tests for the ONE daily recommendation (js/coach.js) and the rules around it:
   fixed priority, return after illness/injury, fixed appointments taboo,
   undo without side effects, what-if from the change, weekly check across
   the week boundary, generator without quality sessions next to hard appointments.
   today is always passed in -> date-independent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { coachDecision, coachWhy, returnPhase, RETURN_DAYS } from '../js/coach.js';
import { weekDeloadCandidates, missedKeyUnits, weekVolumeBalance, deloadVariant } from '../js/planflow.js';
import { undoUnits, canUndo } from '../js/adapt.js';
import { simulateAdd, simulateMove, unitLoad, impactText } from '../js/whatif.js';
import { weekCollisions } from '../js/triage.js';
import { createPlanForEvent, generatePlanUnits } from '../js/plans.js';
import { mkCommit, defaultCommitments } from '../js/commitments.js';
import { isHard } from '../js/planflow.js';

const T = '2026-07-08';   // Wednesday
const d = (n) => addDays(T, n);
const S = (n, rpe, type = 'easy', min = 60) => ({ date: d(n), type, rpe, durationSec: min * 60 });

/** 5 weeks of even, easy history (RPE 3–4) – a reliable data basis. */
function calmHistory() {
  const out = [];
  for (let i = 1; i <= 35; i += 2) out.push(S(-i, i % 4 === 1 ? 3 : 4, 'easy', 45));
  return out;
}

test('TRAIN-12/UI-11: exactly one recommendation – warning signal before plan upkeep and progression', () => {
  // Hard, unplanned streak (3 days) + missed key session + easy RPE history.
  const sessions = [...calmHistory(), S(0, 8, 'tempo'), S(-1, 8, 'interval'), S(-2, 8, 'tempo')];
  const plans = [{ id: 'p', units: [
    { id: 'miss', date: d(-4), type: 'interval', status: 'verpasst', missedReason: 'time', planId: 'p' },
    { id: 'long', date: d(2), type: 'long', status: 'geplant', planId: 'p', targetDistanceKm: 16 },
    { id: 'e1', date: d(3), type: 'easy', status: 'geplant', planId: 'p', targetDistanceKm: 8 },
  ] }];
  const c = coachDecision({ plans, sessions, today: T });
  assert.equal(c.primary.kind, 'rest');
  assert.equal(c.warning, true);
  assert.ok(c.suppressed.some((s) => s.kind === 'makeup'), 'make-up deferred');
  assert.ok(!c.suppressed.some((s) => s.kind === 'boost'), 'no progression next to a warning');
  assert.match(coachWhy(c), /Vorrang/);
  assert.match(coachWhy(c), /Schlüsseleinheit nachholen/);
});

test('TRAIN-13: after illness – return instead of make-up and extra volume', () => {
  const sessions = calmHistory();
  const plans = [{ id: 'p', units: [
    { id: 'i1', date: d(-2), type: 'interval', status: 'verpasst', missedReason: 'sick', targetDistanceKm: 9, planId: 'p' },
    { id: 'e0', date: d(-1), type: 'easy', status: 'verpasst', missedReason: 'sick', targetDistanceKm: 10, planId: 'p' },
    { id: 'e2', date: d(1), type: 'easy', status: 'geplant', targetDistanceKm: 6, planId: 'p' },
    { id: 't3', date: d(2), type: 'tempo', status: 'geplant', targetDistanceKm: 9, planId: 'p' },
    { id: 'l4', date: d(4), type: 'long', status: 'geplant', targetDistanceKm: 15, planId: 'p' },
  ] }];
  // Individual building blocks: no make-up suggestion, no volume compensation for health-related absences.
  assert.equal(missedKeyUnits(plans, T).length, 0);
  const bal = weekVolumeBalance(plans[0].units, T);
  assert.ok(!bal || !bal.suggestion, 'no weekly-volume balancing');
  // The recommendation: gentle return, easing off with the next hard session.
  const c = coachDecision({ plans, sessions, today: T });
  assert.equal(c.primary.kind, 'return');
  assert.equal(c.primary.unit.id, 't3');
  assert.ok(!c.suppressed.some((s) => ['makeup', 'volume', 'boost'].includes(s.kind)));
  // With missed reason "time" instead of "sick" there would be the make-up suggestion.
  const time = [{ id: 'p', units: plans[0].units.map((u) => (u.missedReason ? { ...u, missedReason: 'time' } : u)) }];
  assert.ok(missedKeyUnits(time, T).length > 0, 'positive control: make-up for reason "time"');
});

test('TRAIN-13: progression stays locked for 14 days after an absence', () => {
  const easyRated = [];
  for (let i = 0; i < 35; i += 2) easyRated.push(S(-i, 3, 'easy', 40));    // consistently easy → "progress"
  const upcoming = [
    { id: 'a', date: d(1), type: 'easy', status: 'geplant', targetDistanceKm: 6, planId: 'p' },
    { id: 'b', date: d(3), type: 'easy', status: 'geplant', targetDistanceKm: 8, planId: 'p' },
  ];
  const healthy = coachDecision({ plans: [{ id: 'p', units: upcoming }], sessions: easyRated, today: T });
  assert.equal(healthy.primary && healthy.primary.kind, 'boost', 'positive control: without an absence progression is offered');
  const sickUnit = { id: 's', date: d(-12), type: 'easy', status: 'verpasst', missedReason: 'injured', planId: 'p' };
  const locked = coachDecision({ plans: [{ id: 'p', units: [sickUnit, ...upcoming] }], sessions: easyRated, today: T });
  assert.ok(!locked.primary || locked.primary.kind !== 'boost', 'no progression within 14 days');
  assert.ok(returnPhase([{ units: [sickUnit] }], T).daysAgo <= RETURN_DAYS);
});

test('TRAIN-07: deload and progression leave fixed appointments untouched', () => {
  const units = [
    { id: 'fb', date: d(1), type: 'cross_football', fixed: true, status: 'geplant', targetDurationMin: 90 },
    { id: 'm', date: d(4), type: 'match', fixed: true, status: 'geplant', targetDurationMin: 120 },
    { id: 't', date: d(2), type: 'tempo', status: 'geplant', targetDistanceKm: 9 },
    { id: 'l', date: d(5), type: 'long', status: 'geplant', targetDistanceKm: 16 },
  ];
  const cands = weekDeloadCandidates(units, T);
  assert.deepEqual(cands.map((u) => u.id).sort(), ['l', 't']);
  // A deload does not turn the tempo run into an easy run (type stays).
  assert.equal(deloadVariant(units[2]).type, undefined);
});

test('TRAIN-03: no recovery recommendation without a warning signal when training goes to plan', () => {
  // Mon football, Tue tempo, Wed football – planned and done like that; Sat long run open.
  const plans = [{ id: 'p', units: [
    { id: 'm', date: d(-2), type: 'cross_football', fixed: true, status: 'erledigt', planId: 'p' },
    { id: 't', date: d(-1), type: 'tempo', status: 'erledigt', planId: 'p' },
    { id: 'w', date: d(0), type: 'cross_football', fixed: true, status: 'erledigt', planId: 'p' },
    { id: 'l', date: d(3), type: 'long', status: 'geplant', planId: 'p', targetDistanceKm: 16 },
  ] }];
  const c = coachDecision({ plans, sessions: calmHistory(), today: T });
  assert.ok(!c.primary || !['rest', 'football'].includes(c.primary.kind), `no warning, was ${c.primary && c.primary.kind}`);
});

test('TRAIN-21: undo leaves completed sessions and later changes alone', () => {
  const before = { id: 'u', date: d(1), type: 'interval', title: 'VO2max 6×800 m', status: 'geplant', targetDistanceKm: 9 };
  const entry = { id: 'al', kind: 'rest', undo: { units: [before], fields: ['type', 'title', 'targetDistanceKm', 'autoRest'] } };
  // Completed after the adjustment (with a session) → nothing to revert.
  const done = [{ ...before, type: 'recovery', title: 'Erholungstag (automatisch)', targetDistanceKm: 4, autoRest: true, status: 'erledigt', executedSessionId: 's1' }];
  assert.equal(canUndo(done, entry), false);
  const r1 = undoUnits(done, entry);
  assert.equal(r1.units[0].status, 'erledigt');
  assert.equal(r1.units[0].executedSessionId, 's1');
  assert.equal(r1.units[0].type, 'recovery');
  assert.equal(r1.skipped, 1);
  // Still open but moved in the meantime → only the adjusted fields revert, the date stays.
  const moved = [{ ...done[0], status: 'geplant', executedSessionId: null, date: d(2), movedFrom: d(1) }];
  const r2 = undoUnits(moved, entry);
  assert.equal(r2.units[0].type, 'interval');
  assert.equal(r2.units[0].title, 'VO2max 6×800 m');
  assert.equal(r2.units[0].date, d(2), 'later move stays');
  assert.equal('autoRest' in r2.units[0], false, 'adjustment marker removed');
});

test('TRAIN-34: what-if rates by the change – 15 min of mobility is hardly a change', () => {
  // Week with Mon/Wed football, tempo and long run: already 4 hard sessions.
  const week = [
    { id: 'm', date: '2026-07-06', type: 'cross_football', intensity: 'normal', targetDurationMin: 90, fixed: true, status: 'geplant' },
    { id: 't', date: '2026-07-07', type: 'tempo', targetDurationMin: 60, status: 'geplant' },
    { id: 'w', date: '2026-07-08', type: 'cross_football', intensity: 'normal', targetDurationMin: 90, fixed: true, status: 'geplant' },
    { id: 'l', date: '2026-07-11', type: 'long', targetDistanceKm: 16, status: 'geplant' },
  ];
  const mob = simulateAdd(week, { id: 'x', date: '2026-07-10', type: 'mobility', targetDurationMin: 15, status: 'geplant' });
  assert.equal(mob.level, 'ok', impactText(mob));
  assert.match(impactText(mob), /Kaum Auswirkung/);
  // A hard session right next to the long run, by contrast, is a real change.
  const hard = simulateAdd(week, { id: 'y', date: '2026-07-10', type: 'interval', targetDurationMin: 60, status: 'geplant' });
  assert.equal(hard.level, 'hoch');
  assert.match(impactText(hard), /harte Tage direkt aufeinander/);
  // Moving within the same week: same load, but a new hard consecutive day.
  const moved = simulateMove(week, 'l', '2026-07-09');   // long run from Sat to Thu – right after the Wed football
  assert.equal(moved.target.level, 'hoch');
  assert.match(impactText(moved.target), /bleibt gleich .*zwei harte Tage direkt aufeinander/);
  // Football intensity counts as it does for the recorded load.
  assert.ok(unitLoad({ type: 'cross_football', intensity: 'intensiv', targetDurationMin: 90 }) > unitLoad({ type: 'cross_football', intensity: 'normal', targetDurationMin: 90 }));
});

test('TRAIN-35: weekly check detects Sunday match → Monday training across the week boundary', () => {
  const units = [
    { id: 'so', date: '2026-07-12', type: 'match', title: 'Fußballspiel', fixed: true, status: 'geplant' },
    { id: 'mo', date: '2026-07-13', type: 'cross_football', title: 'Fußballtraining', fixed: true, status: 'geplant' },
  ];
  const next = weekCollisions(units, '2026-07-13').filter((c) => c.kind === 'hard-b2b');
  assert.equal(next.length, 1, 'week from Mon 13.07. sees the Sunday before');
  assert.match(next[0].text, /Vorwoche/);
  assert.match(next[0].suggest, /Beide sind feste Termine/);
  const prev = weekCollisions(units, '2026-07-06').filter((c) => c.kind === 'hard-b2b');
  assert.equal(prev.length, 1, 'week up to Sun 12.07. sees the Monday after');
});

test('TRAIN-03: generator places no quality session and no long run next to hard fixed appointments', () => {
  const ev = { id: 'e', name: 'HM', kind: 'race', date: '2027-01-17', distanceType: 'HM', distanceKm: 21.0975, targetTime: '01:55:00' };
  const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: '2026-10-25' })];
  const plan = createPlanForEvent(ev, { level: 'fortgeschritten', daysPerWeek: 4, commitments, today: '2026-09-28' });
  const units = generatePlanUnits(plan, ev, {});
  const hardFixed = new Set(units.filter((u) => u.fixed && isHard(u)).map((u) => u.date));
  const keyNextToFixed = units.filter((u) => !u.fixed && u.type !== 'race' && isHard(u)
    && (hardFixed.has(addDays(u.date, -1)) || hardFixed.has(addDays(u.date, 1))));
  assert.deepEqual(keyNextToFixed.map((u) => `${u.date} ${u.title}`), []);
  assert.ok(units.some((u) => u.downgradedFrom === 'quality'), 'without a calm day: easy with progressions');
  // No appointment → no rebuilds (positive control: quality stays quality).
  const free = createPlanForEvent(ev, { level: 'fortgeschritten', daysPerWeek: 4, commitments: [], today: '2026-09-28' });
  const freeUnits = generatePlanUnits(free, ev, {});
  assert.ok(!freeUnits.some((u) => u.downgradedFrom || u.relocatedFrom));
  assert.ok(freeUnits.some((u) => ['tempo', 'interval'].includes(u.type)));
});
