import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekUnits, unitPriority, weekCollisions, weekTriage, PRIORITY_RANK, destackSuggestion } from '../js/triage.js';

// 2026-07-06 = Monday; week Mon–Sun = 06..12.
const U = (date, type, extra = {}) => ({ id: date + type, date, type, title: `${type}@${date}`, status: 'geplant', ...extra });

test('weekUnits: filters to the week, without rest/missed', () => {
  const units = [
    U('2026-07-06', 'tempo'),
    U('2026-07-12', 'long'),
    U('2026-07-13', 'easy'),                 // next week
    U('2026-07-08', 'rest'),                 // rest day does not count
    U('2026-07-09', 'easy', { status: 'verpasst' }),
  ];
  const w = weekUnits(units, '2026-07-06');
  assert.deepEqual(w.map((u) => u.date).sort(), ['2026-07-06', '2026-07-12']);
});

test('unitPriority: fixed appointments > key > strength > volume > recovery', () => {
  assert.equal(unitPriority({ type: 'cross_football', fixed: true }), 'fixed');
  assert.equal(unitPriority({ type: 'tempo' }), 'key');
  assert.equal(unitPriority({ type: 'long' }), 'key');
  assert.equal(unitPriority({ type: 'strength' }), 'strength');
  assert.equal(unitPriority({ type: 'easy' }), 'endurance');
  assert.equal(unitPriority({ type: 'recovery' }), 'recovery');
  assert.ok(PRIORITY_RANK.fixed > PRIORITY_RANK.key && PRIORITY_RANK.key > PRIORITY_RANK.strength);
});

test('weekCollisions: hard back-to-backs detected (with suggestion)', () => {
  const c = weekCollisions([U('2026-07-06', 'tempo'), U('2026-07-07', 'interval')], '2026-07-06');
  const b2b = c.find((x) => x.kind === 'hard-b2b');
  assert.ok(b2b, 'hard-b2b expected');
  assert.ok(b2b.suggest && b2b.suggest.length > 0);
});

test('weekCollisions: too many hard units', () => {
  const c = weekCollisions([
    U('2026-07-06', 'tempo'), U('2026-07-08', 'interval'), U('2026-07-10', 'long'), U('2026-07-12', 'race'),
  ], '2026-07-06');
  const tmh = c.find((x) => x.kind === 'too-many-hard');
  assert.ok(tmh, 'too-many-hard expected');
});

test('weekCollisions: no rest day', () => {
  const units = ['06', '07', '08', '09', '10', '11', '12'].map((d) => U(`2026-07-${d}`, 'easy'));
  const c = weekCollisions(units, '2026-07-06');
  assert.ok(c.some((x) => x.kind === 'no-rest'));
});

test('weekCollisions: two hard units on the same day', () => {
  const c = weekCollisions([U('2026-07-06', 'tempo'), U('2026-07-06', 'strength', { id: 'x' })], '2026-07-06');
  assert.ok(c.some((x) => x.kind === 'double-hard'));
});

test('weekCollisions: relaxed week -> no collision', () => {
  const c = weekCollisions([U('2026-07-06', 'easy'), U('2026-07-08', 'strength'), U('2026-07-10', 'tempo')], '2026-07-06');
  assert.equal(c.length, 0);
});

test('destackSuggestion: two units on the same day -> the weaker one to a free day (#4)', () => {
  const today = '2026-07-06'; // Mon
  const units = [U('2026-07-07', 'long'), U('2026-07-07', 'strength')]; // Tue double-booked
  const s = destackSuggestion(units, today);
  assert.ok(s, 'suggestion present');
  assert.equal(s.date, '2026-07-07');
  assert.equal(s.move.type, 'strength');   // strength has a lower priority than the long run (key)
  assert.equal(s.keep.type, 'long');
  assert.ok(s.target > '2026-07-07', 'target day lies after the stacked day');
});

test('destackSuggestion: only one unit per day -> null', () => {
  assert.equal(destackSuggestion([U('2026-07-07', 'long'), U('2026-07-09', 'tempo')], '2026-07-06'), null);
});

test('weekTriage: ordered by priority, ok flag', () => {
  // Football has counted as demanding since #5 – hence Thu instead of Wed, so that it does not lie directly
  // before the tempo unit (otherwise hard days in a row are flagged). hardCount = football + tempo.
  const t = weekTriage([U('2026-07-06', 'easy'), U('2026-07-07', 'cross_football', { fixed: true }), U('2026-07-09', 'tempo')], '2026-07-06');
  assert.equal(unitPriority(t.ranked[0]), 'fixed');   // fixed appointment right at the top
  assert.equal(t.ok, true);
  assert.equal(t.hardCount, 2);
});
