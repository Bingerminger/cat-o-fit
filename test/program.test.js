/* Unit-Tests für js/program.js — Fitness-/Health-Programme ohne Wettkampf. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAM_TYPES, programMeta, spreadDays, programWeekBlocks,
  programPhases, buildProgramUnits, createProgramPlan, weeklyCardioMinutes, migratePlan,
} from '../js/program.js';
import { isoDow, addDays } from '../js/ui.js';

test('PROGRAM_TYPES: vier Vorlagen mit Label, Fokus, Ausdauerziel und Krafttagen', () => {
  const keys = Object.keys(PROGRAM_TYPES);
  assert.deepEqual(keys.sort(), ['fitness', 'mobility', 'strength', 'weightloss']);
  for (const k of keys) {
    const m = PROGRAM_TYPES[k];
    assert.ok(m.label && m.focus && m.desc);
    assert.ok(Array.isArray(m.cardio) && m.cardio[1] >= m.cardio[0]);
    assert.ok(m.strengthDays(3) >= 2, `${k}: mindestens zwei Krafttage`);
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
  const known = ['cardio', 'strength', 'walk', 'mobility'];
  assert.ok(wk.every((x) => known.includes(x.block) && x.extra.every((b) => known.includes(b))));
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

test('buildProgramUnits: weeks × daysPerWeek Trainingstage, plan-kompatible Felder, sortiert', () => {
  const units = buildProgramUnits({ programType: 'fitness', weeks: 4, daysPerWeek: 4 }, 'plan-1', '2026-07-06'); // Montag
  assert.equal(new Set(units.map((u) => u.date)).size, 4 * 4, 'vier Trainingstage je Woche');
  // aufsteigend datiert
  for (let i = 1; i < units.length; i++) assert.ok(units[i].date >= units[i - 1].date);
  // jede Einheit plan-kompatibel: dieselben Felder wie Wettkampfpläne (Dauer + Anleitung sichtbar)
  for (const u of units) {
    assert.equal(u.planId, 'plan-1');
    assert.equal(u.eventId, null);
    assert.ok(u.id && u.date && u.type && u.title);
    assert.equal(typeof u.targetDurationMin, 'number');
    assert.ok(u.description.length > 20, 'Anleitung steht in `description`');
    assert.equal(u.dur, undefined, 'kein Sonderfeld mehr');
    assert.equal(u.status, 'geplant');
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
  assert.equal(new Set(plan.units.map((u) => u.date)).size, 8 * 5);
  assert.equal(plan.eventId, 'prog-1');             // verweist auf das Programm-Ziel
});

/** Ausdauerminuten (Ausdauer + Gehen) und Krafttage je Programmwoche. */
function weekStats(units, startDate, week) {
  const ws = addDays(startDate, (week - 1) * 7), we = addDays(ws, 6);
  const wk = units.filter((u) => u.date >= ws && u.date <= we);
  return {
    cardio: wk.filter((u) => u.type === 'cross' || u.type === 'walk').reduce((a, u) => a + u.targetDurationMin, 0),
    strengthDays: new Set(wk.filter((u) => u.type === 'strength').map((u) => u.date)).size,
    strengthMin: wk.filter((u) => u.type === 'strength').reduce((a, u) => a + u.targetDurationMin, 0),
  };
}

test('Programme: WHO-Empfehlung ab 3 Tagen erreicht – ≥ 150 min Ausdauer und 2 Krafttage (TRAIN-29)', () => {
  for (const type of ['fitness', 'weightloss']) {
    for (const days of [3, 4, 5]) {
      const units = buildProgramUnits({ programType: type, weeks: 8, daysPerWeek: days }, 'p', '2026-07-06');
      const last = weekStats(units, '2026-07-06', 7);
      assert.ok(last.cardio >= 150, `${type}/${days} Tage: ${last.cardio} min Ausdauer in Woche 7`);
      assert.ok(last.strengthDays >= 2, `${type}/${days} Tage: ${last.strengthDays} Krafttage`);
    }
  }
  // Abnehmen liegt spürbar darüber (ACSM: 225–250 min).
  const wl = buildProgramUnits({ programType: 'weightloss', weeks: 12, daysPerWeek: 5 }, 'p', '2026-07-06');
  assert.ok(weekStats(wl, '2026-07-06', 11).cardio >= 220);
});

test('Programme: Progression, leichtere 4. Woche und unterschiedliche Phasen (TRAIN-29)', () => {
  const m = weeklyCardioMinutes('fitness', 12);
  assert.ok(m[3] > m[1], 'Ausdauer steigt');
  assert.ok(m[4] < m[3], 'jede 4. Woche leichter');
  assert.ok(m[5] >= m[3] && m[5] <= m[3] * 1.01, 'nach der leichteren Woche zurück aufs Niveau davor');
  assert.ok(m.slice(1).every((v) => v <= 180), 'Obergrenze des Programms');
  const units = buildProgramUnits({ programType: 'fitness', weeks: 12, daysPerWeek: 4 }, 'p', '2026-07-06');
  const s1 = weekStats(units, '2026-07-06', 1), s6 = weekStats(units, '2026-07-06', 6), s11 = weekStats(units, '2026-07-06', 11);
  assert.ok(s6.strengthMin > s1.strengthMin, 'Kraft wird länger/umfangreicher');
  const k1 = units.find((u) => u.week === 1 && u.type === 'strength').description;
  const k11 = units.find((u) => u.week === 11 && u.type === 'strength').description;
  assert.match(k1, /Eingewöhnung/);
  assert.match(k11, /Festigen/);
  assert.ok(s11.cardio > s1.cardio);
  assert.deepEqual(programPhases(12).map((p) => p.key), ['intro', 'build', 'consolidate']);
});

test('migratePlan: Programmeinheiten mit `dur`/`desc` bekommen beim Lesen die Plan-Felder (TRAIN-06)', () => {
  const plan = { id: 'p', kind: 'program', units: [
    { id: 'u1', date: '2026-07-06', type: 'strength', title: 'Kraft', dur: 40, desc: 'Kniebeugen 12× …' },
    { id: 'u2', date: '2026-07-08', type: 'easy', title: 'Cardio', targetDurationMin: 30, description: 'neu' },
  ] };
  const m = migratePlan(plan);
  assert.equal(m.units[0].targetDurationMin, 40);
  assert.equal(m.units[0].description, 'Kniebeugen 12× …');
  assert.equal(m.units[1], plan.units[1], 'neue Einheiten bleiben unangetastet');
  assert.equal(plan.units[0].targetDurationMin, undefined, 'gespeichert wird nichts');
  assert.equal(migratePlan(plan), m, 'gleiche Kopie bei erneutem Lesen');
  const race = { id: 'r', units: [{ id: 'x', dur: 5 }] };
  assert.equal(migratePlan(race), race, 'Wettkampfpläne bleiben, wie sie sind');
});
