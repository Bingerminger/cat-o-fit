/* Unit tests for js/planflow.js — load classes, week windows and the
   offset suggestion when adding an own unit (#2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClass, unitsInWeek, weekLoad, suggestOffsetUnit, isHard, rescheduleCheck, mergeRegeneratedWeek, softenSuggestion, easierVariant, missedKeyUnits, findMakeupDay, weekDeloadCandidates, deloadVariant, progressVariant, dayLoadUnits } from '../js/planflow.js';
import { addDays } from '../js/ui.js';

// 2026-06-28 is a Sunday -> week Mon 22.06. to Sun 28.06.
const MON = '2026-06-22', WED = '2026-06-24', FRI = '2026-06-26', SUN = '2026-06-28';
const T = SUN; // reference day for the adaptive tests
const NEXT = '2026-06-30'; // Tuesday of the following week

test('loadClass: types mapped to the load classes', () => {
  assert.equal(loadClass('tempo'), 'quality');
  assert.equal(loadClass('interval'), 'quality');
  assert.equal(loadClass('easy'), 'endurance');
  assert.equal(loadClass('long'), 'endurance');
  assert.equal(loadClass('recovery'), 'recovery');
  assert.equal(loadClass('strength'), 'strength');
  assert.equal(loadClass('rest'), 'other');
  // Test matches & training camps count as demanding (#12)
  assert.equal(loadClass('match'), 'quality');
  assert.equal(loadClass('camp'), 'quality');
  assert.equal(isHard({ type: 'match' }), true);
  assert.equal(isHard({ type: 'camp' }), true);
});

test('unitsInWeek: only the same Mon–Sun week, without missed/moved/rest', () => {
  const units = [
    { id: 'a', date: MON, type: 'easy', status: 'geplant' },
    { id: 'b', date: FRI, type: 'tempo', status: 'erledigt' },
    { id: 'c', date: SUN, type: 'rest', status: 'geplant' },        // rest day does not count
    { id: 'd', date: WED, type: 'easy', status: 'verpasst' },        // missed does not count
    { id: 'e', date: NEXT, type: 'easy', status: 'geplant' },        // other week
  ];
  const inWeek = unitsInWeek(units, SUN).map((u) => u.id).sort();
  assert.deepEqual(inWeek, ['a', 'b']);
});

test('weekLoad: counts units and km (target or actual)', () => {
  const units = [
    { id: 'a', date: MON, type: 'easy', status: 'geplant', targetDistanceKm: 8 },
    { id: 'b', date: FRI, type: 'long', status: 'erledigt', distanceKm: 15 },
  ];
  const l = weekLoad(units, SUN);
  assert.equal(l.count, 2);
  assert.equal(l.km, 23);
});

test('suggestOffsetUnit: suggests the same load class in the same week', () => {
  const units = [
    { id: 'easy1', date: MON, type: 'easy', status: 'geplant' },
    { id: 'tempo1', date: WED, type: 'tempo', status: 'geplant' },
    { id: 'done', date: FRI, type: 'easy', status: 'erledigt' }, // done -> cannot be deselected
  ];
  // Robin adds an extra run (endurance) on Sunday
  const neu = { id: 'neu', date: SUN, type: 'easy', status: 'geplant' };
  const offset = suggestOffsetUnit(units, neu);
  assert.equal(offset.id, 'easy1'); // the open base run, not the done/quality unit
});

test('suggestOffsetUnit: no suggestion without a comparable unit', () => {
  const units = [{ id: 'tempo1', date: WED, type: 'tempo', status: 'geplant' }];
  const neu = { id: 'neu', date: SUN, type: 'strength', status: 'geplant' };
  assert.equal(suggestOffsetUnit(units, neu), null);
  // likewise when the week is empty
  assert.equal(suggestOffsetUnit([], neu), null);
});

test('isHard: quality, strength and long run are demanding', () => {
  assert.equal(isHard({ type: 'interval' }), true);
  assert.equal(isHard({ type: 'strength' }), true);
  assert.equal(isHard({ type: 'long' }), true);
  assert.equal(isHard({ type: 'easy' }), false);
  assert.equal(isHard({ type: 'recovery' }), false);
});

test('isHard: football is demanding – unless explicitly "light" (#5)', () => {
  assert.equal(isHard({ type: 'cross_football' }), true);                       // no value = normal
  assert.equal(isHard({ type: 'cross_football', intensity: 'normal' }), true);
  assert.equal(isHard({ type: 'cross_football', intensity: 'intensiv' }), true);
  assert.equal(isHard({ type: 'cross_football', intensity: 'leicht' }), false);
});

test('dayLoadUnits: open, non-fixed, load-relevant units of a day (#4)', () => {
  const D = '2026-07-11';
  const units = [
    { id: 'a', date: D, type: 'long', status: 'geplant' },
    { id: 'b', date: D, type: 'strength', status: 'geplant' },
    { id: 'c', date: D, type: 'cross_football', fixed: true, status: 'geplant' }, // fixed appointment -> out
    { id: 'd', date: D, type: 'easy', status: 'erledigt' },                        // done -> out
    { id: 'e', date: D, type: 'rest' },                                            // rest day -> out
    { id: 'f', date: '2026-07-12', type: 'tempo', status: 'geplant' },             // other day -> out
  ];
  assert.deepEqual(dayLoadUnits(units, D).map((u) => u.id).sort(), ['a', 'b']);
});

test('rescheduleCheck: detects a double load on the target day', () => {
  const units = [
    { id: 'move', date: MON, type: 'easy', status: 'geplant' },
    { id: 'fix', date: FRI, type: 'easy', status: 'geplant' },
  ];
  const r = rescheduleCheck(units, 'move', FRI);
  assert.equal(r.sameDay.id, 'fix');
  assert.equal(r.hardNeighbor, null);
});

test('rescheduleCheck: warns about a hard unit without a recovery day', () => {
  const units = [
    { id: 'move', date: MON, type: 'tempo', status: 'geplant' },     // hard
    { id: 'long', date: SUN, type: 'long', status: 'geplant' },      // hard, on the day after FRI? no
    { id: 'quali', date: WED, type: 'interval', status: 'geplant' }, // hard
  ];
  // Move tempo from MON to THU (24->25) -> neighbour WED (interval) on the previous day
  const THU = '2026-06-25';
  const r = rescheduleCheck(units, 'move', THU);
  assert.equal(r.hardNeighbor.unit.id, 'quali');
  assert.equal(r.hardNeighbor.dir, 'prev');
});

test('rescheduleCheck: soft unit moved -> no recovery warning', () => {
  const units = [
    { id: 'move', date: MON, type: 'easy', status: 'geplant' },
    { id: 'quali', date: WED, type: 'interval', status: 'geplant' },
  ];
  const THU = '2026-06-25';
  const r = rescheduleCheck(units, 'move', THU); // easy next to interval = ok
  assert.equal(r.hardNeighbor, null);
});

test('mergeRegeneratedWeek: done units stay, the rest is replaced, no duplicates (#10)', () => {
  const existing = [
    { id: 'mo-done', date: MON, type: 'easy', status: 'erledigt' },   // stays
    { id: 'mi-open', date: WED, type: 'tempo', status: 'geplant' },   // is replaced
    { id: 'fr-missed', date: FRI, type: 'easy', status: 'verpasst' }, // is replaced
  ];
  const fresh = [
    { id: 'f-mo', date: MON, type: 'long', status: 'geplant' },   // dropped (Mon already done)
    { id: 'f-mi', date: WED, type: 'interval', status: 'geplant' },
    { id: 'f-fr', date: FRI, type: 'strength', status: 'geplant' },
  ];
  const merged = mergeRegeneratedWeek(existing, fresh);
  const ids = merged.map((u) => u.id).sort();
  assert.deepEqual(ids, ['f-fr', 'f-mi', 'mo-done']);
  // Monday stays the done unit, no fresh long run
  assert.equal(merged.find((u) => u.date === MON).id, 'mo-done');
});

test('mergeRegeneratedWeek: without done units simply the fresh ones', () => {
  const merged = mergeRegeneratedWeek([{ id: 'a', date: MON, status: 'geplant' }], [{ id: 'f', date: MON, status: 'geplant' }]);
  assert.deepEqual(merged.map((u) => u.id), ['f']);
});

test('softenSuggestion: ease off only with low readiness + a hard unit', () => {
  const hard = [{ id: 'q', type: 'tempo', status: 'geplant' }];
  assert.equal(softenSuggestion(hard, { score: 42 }).unit.id, 'q');
  assert.equal(softenSuggestion(hard, { score: 60 }), null);                 // solid -> no suggestion
  assert.equal(softenSuggestion([{ id: 'e', type: 'easy', status: 'geplant' }], { score: 40 }), null); // soft unit
  assert.equal(softenSuggestion(hard, null), null);
  assert.equal(softenSuggestion([{ id: 'q', type: 'tempo', status: 'erledigt' }], { score: 40 }), null); // already done
});

test('easierVariant: type easy, ~60 % distance, original remembered', () => {
  const v = easierVariant({ type: 'tempo', targetDistanceKm: 10 }, { min: 360, max: 385, hrZone: 2 });
  assert.equal(v.type, 'easy');
  assert.equal(v.targetDistanceKm, 6);
  assert.equal(v.targetPaceSecPerKm, 360);
  assert.equal(v.softened, true);
  assert.equal(v.originalType, 'tempo');
});

test('missedKeyUnits: only missed hard units in the window, most recent first', () => {
  const plans = [{ units: [
    { id: 'q1', date: addDays(T, -2), type: 'tempo', status: 'verpasst' },
    { id: 'q2', date: addDays(T, -5), type: 'interval', status: 'verpasst' },
    { id: 'e1', date: addDays(T, -1), type: 'easy', status: 'verpasst' },      // soft
    { id: 'q3', date: addDays(T, -20), type: 'long', status: 'verpasst' },     // outside the window
    { id: 'q4', date: addDays(T, -3), type: 'tempo', status: 'erledigt' },     // done
  ] }];
  assert.deepEqual(missedKeyUnits(plans, T, 10).map((u) => u.id), ['q1', 'q2']);
});

test('findMakeupDay: first free day without a demanding neighbour', () => {
  const units = [{ id: 'x', date: addDays(T, 2), type: 'tempo', status: 'geplant' }];
  const day = findMakeupDay(units, { id: 'm', type: 'tempo' }, T, 7);
  assert.equal(day, addDays(T, 4)); // T+1 (neighbour T+2 hard), T+2 occupied, T+3 (neighbour hard) -> T+4
});

test('findMakeupDay: everything free -> tomorrow; nothing free -> null', () => {
  assert.equal(findMakeupDay([], { id: 'm', type: 'tempo' }, T, 7), addDays(T, 1));
  const fullHard = [];
  for (let i = 1; i <= 7; i++) fullHard.push({ id: 'h' + i, date: addDays(T, i), type: 'tempo', status: 'geplant' });
  assert.equal(findMakeupDay(fullHard, { id: 'm', type: 'tempo' }, T, 7), null);
});

test('weekDeloadCandidates: open load-relevant units of the next 7 days', () => {
  const units = [
    { id: 'a', date: T, type: 'tempo', status: 'geplant' },
    { id: 'b', date: addDays(T, 3), type: 'easy', status: 'geplant' },
    { id: 'c', date: addDays(T, 3), type: 'rest', status: 'geplant' },     // rest day
    { id: 'd', date: addDays(T, 3), type: 'tempo', status: 'erledigt' },   // done
    { id: 'e', date: addDays(T, 10), type: 'tempo', status: 'geplant' },   // outside the window
    { id: 'f', date: addDays(T, -1), type: 'tempo', status: 'geplant' },   // past
  ];
  assert.deepEqual(weekDeloadCandidates(units, T, 7).map((u) => u.id).sort(), ['a', 'b']);
});

test('progressVariant: volume up ~12 %, type stays', () => {
  const v = progressVariant({ type: 'easy', targetDistanceKm: 10 });
  assert.equal(v.targetDistanceKm, 11); // 10 * 1.12 = 11.2 -> 11 (rounded to 0.5)
  assert.equal(v.boosted, true);
  assert.equal(v.type, undefined); // no type change
  const dur = progressVariant({ type: 'cross', targetDurationMin: 60 });
  assert.equal(dur.targetDurationMin, 66);
});

test('deloadVariant: ~75 % volume, the intensity stays (quality is shortened, not made easy)', () => {
  const hard = deloadVariant({ type: 'interval', title: 'VO2max 6×800 m', targetDistanceKm: 10, intervals: { rounds: 6, workSec: 200, restSec: 120 } });
  assert.equal(hard.type, undefined, 'intervals stay intervals');
  assert.equal(hard.targetDistanceKm, 7.5);
  assert.equal(hard.intervals.rounds, 4, 'a third fewer repetitions');
  assert.equal(hard.deloaded, true);
  assert.match(hard.title, /verkürzt/);
  const segs = [1, 2, 3, 4, 5, 6].map((i) => ({ workSec: 60 * i, restSec: 90 }));
  assert.equal(deloadVariant({ type: 'interval', title: 'Pyramide', intervals: { segments: segs } }).intervals.segments.length, 4);
  const soft = deloadVariant({ type: 'easy', targetDistanceKm: 12 });
  assert.equal(soft.targetDistanceKm, 9);
  assert.equal(soft.type, undefined); // type stays unchanged (patch without type)
  assert.equal(soft.intervals, undefined);
});
