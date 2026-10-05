/* Cycle calculations (js/cyclecalc.js): long cycles count, forgotten entries do not,
   and an overdue period leads first to a query, then to a doctor notice. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodStarts, cycleGaps, typicalCycleLength, longCycleCount, periodSignal } from '../js/cyclecalc.js';
import { redFlags } from '../js/redflags.js';

const T = '2026-09-29';

test('cyclecalc: cycles over 40 days count instead of silently falling back to 28 days', () => {
  const s = ['2026-03-01', '2026-04-15', '2026-05-30', '2026-07-14'];
  assert.deepEqual(cycleGaps(s), [45, 45, 45]);
  assert.equal(typicalCycleLength(s), 45);
  assert.equal(longCycleCount(s), 3);
});

test('cyclecalc: a forgotten entry (≈ double length) does not count as a cycle', () => {
  const s = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-04-23', '2026-05-21'];
  assert.deepEqual(cycleGaps(s), [28, 28, 28]);
  assert.equal(typicalCycleLength(s), 28);
  assert.equal(longCycleCount(s), 0);
});

test('cyclecalc: period starts without helper records, duplicates and deletions', () => {
  const cycle = [
    { id: 'a', startDate: '2026-05-01' }, { id: 'b', startDate: '2026-05-01' },
    { id: 'c', startDate: '2026-04-03', deleted: true },
    { id: 'cycle-check', _kind: 'check', for: '2026-05-01', answer: 'verhuetung' },
  ];
  assert.deepEqual(periodStarts(cycle), ['2026-05-01']);
});

test('periodSignal: ask first, doctor notice only for "missed" or after 90 days', () => {
  const s = ['2026-05-01', '2026-05-29', '2026-06-26'];
  assert.equal(periodSignal({ starts: s, today: '2026-07-20' }), null, 'within the usual range');
  const ask = periodSignal({ starts: s, today: '2026-08-05' });   // 40 days > 28 + 7
  assert.equal(ask.state, 'ask');
  assert.equal(ask.flag, false);
  const late = periodSignal({ starts: s, today: T });              // 95 days, unanswered
  assert.equal(late.state, 'ask');
  assert.equal(late.flag, true);
  assert.equal(late.days, 95);

  const answered = (answer, forStart = '2026-06-26') => periodSignal({ starts: s, today: T, check: { for: forStart, answer } });
  assert.equal(answered('schwanger').flag, false);
  assert.equal(answered('verhuetung').state, 'contraception');
  assert.equal(answered('verhuetung').flag, false);
  assert.equal(answered('nicht-eingetragen').flag, false);
  assert.equal(answered('ausgeblieben').state, 'missed');
  assert.equal(answered('ausgeblieben').flag, true);
  // An answer to an earlier cycle no longer applies.
  assert.equal(answered('nicht-eingetragen', '2026-05-29').flag, true);
  // Pregnancy from the gate: no alarm.
  assert.equal(periodSignal({ starts: s, today: T, gate: { pregnancy: true } }).flag, false);
});

test('redFlags: no RED-S alarm with pregnancy or terminated tracking (HEALTH-09)', () => {
  const cycle = [{ id: 'c1', startDate: '2026-05-01' }, { id: 'c2', startDate: '2026-05-29' }, { id: 'c3', startDate: '2026-06-26' }];
  assert.equal(redFlags({ cycle, today: T }).length, 1, 'unanswered after 95 days: notice');
  assert.equal(redFlags({ cycle, today: T, gate: { pregnancy: true } }).length, 0);
  assert.equal(redFlags({ cycle, today: T, cycleCheck: { for: '2026-06-26', answer: 'nicht-eingetragen' } }).length, 0);
  // Confirmed missed: notice already before 90 days.
  const flags = redFlags({ cycle, today: '2026-08-20', cycleCheck: { for: '2026-06-26', answer: 'ausgeblieben' } });
  assert.equal(flags.length, 1);
  assert.match(flags[0].text, /ausgeblieben/);
});
