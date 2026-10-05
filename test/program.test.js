/* Unit tests for js/program.js — fitness/health programmes without a race. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAM_TYPES, programMeta, spreadDays, programWeekBlocks,
  programPhases, buildProgramUnits, createProgramPlan, weeklyCardioMinutes, migratePlan,
} from '../js/program.js';
import { isoDow, addDays } from '../js/ui.js';

test('PROGRAM_TYPES: four templates with label, focus, endurance target and strength days', () => {
  const keys = Object.keys(PROGRAM_TYPES);
  assert.deepEqual(keys.sort(), ['fitness', 'mobility', 'strength', 'weightloss']);
  for (const k of keys) {
    const m = PROGRAM_TYPES[k];
    assert.ok(m.label && m.focus && m.desc);
    assert.ok(Array.isArray(m.cardio) && m.cardio[1] >= m.cardio[0]);
    assert.ok(m.strengthDays(3) >= 2, `${k}: at least two strength days`);
    assert.ok(m.defaultDays >= 2 && m.defaultDays <= 6);
  }
});

test('programMeta falls back to fitness', () => {
  assert.equal(programMeta('gibtsnicht').label, PROGRAM_TYPES.fitness.label);
});

test('spreadDays distributes 2–6 days and clamps outliers', () => {
  assert.equal(spreadDays(3).length, 3);
  assert.equal(spreadDays(5).length, 5);
  assert.equal(spreadDays(99).length, 6);   // clamped to 6
  assert.equal(spreadDays(0).length, 2);    // clamped to 2
  // all weekdays valid (1..7) and ascending
  const d = spreadDays(4);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.ok(d.every((x) => x >= 1 && x <= 7));
});

test('programWeekBlocks: correct count, only known building blocks', () => {
  const wk = programWeekBlocks('strength', 4);
  assert.equal(wk.length, 4);
  const known = ['cardio', 'strength', 'walk', 'mobility'];
  assert.ok(wk.every((x) => known.includes(x.block) && x.extra.every((b) => known.includes(b))));
  // strength programme starts with strength
  assert.equal(wk[0].block, 'strength');
});

test('programPhases covers all weeks without gaps', () => {
  for (const weeks of [1, 2, 4, 8, 12]) {
    const ph = programPhases(weeks);
    assert.equal(ph[0].startWeek, 1);
    assert.equal(ph[ph.length - 1].endWeek, weeks);
    // no gaps/overlaps
    for (let i = 1; i < ph.length; i++) assert.equal(ph[i].startWeek, ph[i - 1].endWeek + 1);
  }
});

test('buildProgramUnits: weeks × daysPerWeek training days, plan-compatible fields, sorted', () => {
  const units = buildProgramUnits({ programType: 'fitness', weeks: 4, daysPerWeek: 4 }, 'plan-1', '2026-07-06'); // Monday
  assert.equal(new Set(units.map((u) => u.date)).size, 4 * 4, 'four training days per week');
  // dated ascending
  for (let i = 1; i < units.length; i++) assert.ok(units[i].date >= units[i - 1].date);
  // every unit plan-compatible: the same fields as race plans (duration + instructions visible)
  for (const u of units) {
    assert.equal(u.planId, 'plan-1');
    assert.equal(u.eventId, null);
    assert.ok(u.id && u.date && u.type && u.title);
    assert.equal(typeof u.targetDurationMin, 'number');
    assert.ok(u.description.length > 20, 'instructions are in `description`');
    assert.equal(u.dur, undefined, 'no special field any more');
    assert.equal(u.status, 'geplant');
    assert.equal(u.dow, isoDow(u.date));
  }
});

test('createProgramPlan: starts on Monday, kind=program, phases & units present', () => {
  const plan = createProgramPlan(
    { id: 'prog-1', name: 'Mein Plan', programType: 'weightloss', weeks: 8, daysPerWeek: 5 },
    '2026-07-01', // Wednesday -> starts on the next Monday (06.07.)
  );
  assert.equal(plan.kind, 'program');
  assert.equal(plan.programType, 'weightloss');
  assert.equal(isoDow(plan.startDate), 1);          // Monday
  assert.equal(plan.weeks, 8);
  assert.ok(Array.isArray(plan.phases) && plan.phases.length >= 1);
  assert.equal(new Set(plan.units.map((u) => u.date)).size, 8 * 5);
  assert.equal(plan.eventId, 'prog-1');             // refers to the programme goal
});

/** Endurance minutes (endurance + walking) and strength days per programme week. */
function weekStats(units, startDate, week) {
  const ws = addDays(startDate, (week - 1) * 7), we = addDays(ws, 6);
  const wk = units.filter((u) => u.date >= ws && u.date <= we);
  return {
    cardio: wk.filter((u) => u.type === 'cross' || u.type === 'walk').reduce((a, u) => a + u.targetDurationMin, 0),
    strengthDays: new Set(wk.filter((u) => u.type === 'strength').map((u) => u.date)).size,
    strengthMin: wk.filter((u) => u.type === 'strength').reduce((a, u) => a + u.targetDurationMin, 0),
  };
}

test('Programmes: WHO recommendation reached from 3 days – ≥ 150 min endurance and 2 strength days (TRAIN-29)', () => {
  for (const type of ['fitness', 'weightloss']) {
    for (const days of [3, 4, 5]) {
      const units = buildProgramUnits({ programType: type, weeks: 8, daysPerWeek: days }, 'p', '2026-07-06');
      const last = weekStats(units, '2026-07-06', 7);
      assert.ok(last.cardio >= 150, `${type}/${days} days: ${last.cardio} min endurance in week 7`);
      assert.ok(last.strengthDays >= 2, `${type}/${days} days: ${last.strengthDays} strength days`);
    }
  }
  // Weight loss is noticeably higher (ACSM: 225–250 min).
  const wl = buildProgramUnits({ programType: 'weightloss', weeks: 12, daysPerWeek: 5 }, 'p', '2026-07-06');
  assert.ok(weekStats(wl, '2026-07-06', 11).cardio >= 220);
});

test('Programmes: progression, easier 4th week and different phases (TRAIN-29)', () => {
  const m = weeklyCardioMinutes('fitness', 12);
  assert.ok(m[3] > m[1], 'endurance increases');
  assert.ok(m[4] < m[3], 'every 4th week easier');
  assert.ok(m[5] >= m[3] && m[5] <= m[3] * 1.01, 'after the easier week back to the previous level');
  assert.ok(m.slice(1).every((v) => v <= 180), 'upper limit of the programme');
  const units = buildProgramUnits({ programType: 'fitness', weeks: 12, daysPerWeek: 4 }, 'p', '2026-07-06');
  const s1 = weekStats(units, '2026-07-06', 1), s6 = weekStats(units, '2026-07-06', 6), s11 = weekStats(units, '2026-07-06', 11);
  assert.ok(s6.strengthMin > s1.strengthMin, 'strength becomes longer/more extensive');
  const k1 = units.find((u) => u.week === 1 && u.type === 'strength').description;
  const k11 = units.find((u) => u.week === 11 && u.type === 'strength').description;
  assert.match(k1, /Eingewöhnung/);
  assert.match(k11, /Festigen/);
  assert.ok(s11.cardio > s1.cardio);
  assert.deepEqual(programPhases(12).map((p) => p.key), ['intro', 'build', 'consolidate']);
});

test('migratePlan: programme units with `dur`/`desc` get the plan fields when read (TRAIN-06)', () => {
  const plan = { id: 'p', kind: 'program', units: [
    { id: 'u1', date: '2026-07-06', type: 'strength', title: 'Kraft', dur: 40, desc: 'Kniebeugen 12× …' },
    { id: 'u2', date: '2026-07-08', type: 'easy', title: 'Cardio', targetDurationMin: 30, description: 'neu' },
  ] };
  const m = migratePlan(plan);
  assert.equal(m.units[0].targetDurationMin, 40);
  assert.equal(m.units[0].description, 'Kniebeugen 12× …');
  assert.equal(m.units[1], plan.units[1], 'new units are left untouched');
  assert.equal(plan.units[0].targetDurationMin, undefined, 'nothing is stored');
  assert.equal(migratePlan(plan), m, 'same copy on re-reading');
  const race = { id: 'r', units: [{ id: 'x', dur: 5 }] };
  assert.equal(migratePlan(race), race, 'race plans stay as they are');
});
