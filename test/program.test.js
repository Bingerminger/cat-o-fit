/* Unit-Tests für js/program.js — Fitness-/Health-Programme ohne Wettkampf. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAM_TYPES, programMeta, spreadDays, programWeekBlocks,
  programPhases, buildProgramUnits, createProgramPlan,
} from '../js/program.js';
import { isoDow } from '../js/ui.js';

test('PROGRAM_TYPES: vier Vorlagen mit Label, Fokus und Bausteinen', () => {
  const keys = Object.keys(PROGRAM_TYPES);
  assert.deepEqual(keys.sort(), ['fitness', 'mobility', 'strength', 'weightloss']);
  for (const k of keys) {
    const m = PROGRAM_TYPES[k];
    assert.ok(m.label && m.focus && Array.isArray(m.blocks) && m.blocks.length >= 6);
    assert.ok(m.defaultDays >= 2 && m.defaultDays <= 6);
  }
});

test('programMeta fällt auf fitness zurück', () => {
  assert.equal(programMeta('gibtsnicht').label, PROGRAM_TYPES.fitness.label);
});

test('spreadDays verteilt 2–6 Tage und klemmt Ausreißer', () => {
  assert.equal(spreadDays(3).length, 3);
  assert.equal(spreadDays(5).length, 5);
  assert.equal(spreadDays(99).length, 6);   // auf 6 geklemmt
  assert.equal(spreadDays(0).length, 2);    // auf 2 geklemmt
  // alle Wochentage gültig (1..7) und aufsteigend
  const d = spreadDays(4);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));
  assert.ok(d.every((x) => x >= 1 && x <= 7));
});

test('programWeekBlocks: richtige Anzahl, nur bekannte Bausteine', () => {
  const wk = programWeekBlocks('strength', 4);
  assert.equal(wk.length, 4);
  assert.ok(wk.every((x) => ['cardio', 'strength', 'walk', 'mobility'].includes(x.block)));
  // Kraftprogramm beginnt mit Kraft
  assert.equal(wk[0].block, 'strength');
});

test('programPhases deckt alle Wochen lückenlos ab', () => {
  for (const weeks of [1, 2, 4, 8, 12]) {
    const ph = programPhases(weeks);
    assert.equal(ph[0].startWeek, 1);
    assert.equal(ph[ph.length - 1].endWeek, weeks);
    // keine Lücken/Überlappungen
    for (let i = 1; i < ph.length; i++) assert.equal(ph[i].startWeek, ph[i - 1].endWeek + 1);
  }
});

test('buildProgramUnits: weeks × daysPerWeek Einheiten, korrekte Felder, sortiert', () => {
  const units = buildProgramUnits({ programType: 'fitness', weeks: 4, daysPerWeek: 4 }, 'plan-1', '2026-07-06'); // Montag
  assert.equal(units.length, 4 * 4);
  // aufsteigend datiert
  for (let i = 1; i < units.length; i++) assert.ok(units[i].date >= units[i - 1].date);
  // jede Einheit plan-kompatibel
  for (const u of units) {
    assert.equal(u.planId, 'plan-1');
    assert.equal(u.eventId, null);
    assert.ok(u.id && u.date && u.type && u.title);
    assert.equal(typeof u.dur, 'number');
    assert.equal(u.done, false);
    assert.equal(u.dow, isoDow(u.date));
  }
});

test('createProgramPlan: startet am Montag, kind=program, Phasen & Einheiten vorhanden', () => {
  const plan = createProgramPlan(
    { id: 'prog-1', name: 'Mein Plan', programType: 'weightloss', weeks: 8, daysPerWeek: 5 },
    '2026-07-01', // Mittwoch -> Start am nächsten Montag (06.07.)
  );
  assert.equal(plan.kind, 'program');
  assert.equal(plan.programType, 'weightloss');
  assert.equal(isoDow(plan.startDate), 1);          // Montag
  assert.equal(plan.weeks, 8);
  assert.ok(Array.isArray(plan.phases) && plan.phases.length >= 1);
  assert.equal(plan.units.length, 8 * 5);
  assert.equal(plan.eventId, 'prog-1');             // verweist auf das Programm-Ziel
});
