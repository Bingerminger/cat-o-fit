import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommitments, mkCommit, commitmentActiveOn, commitmentDates, commitmentsSummary, dowLabel } from '../js/commitments.js';

// 2026-07-06 is a Monday (cf. plans.test.js). 2026-08-19 is a Wednesday.

test('defaultCommitments: Mon + Wed football 90 min', () => {
  const c = defaultCommitments();
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.dow).sort(), [1, 3]);
  assert.ok(c.every((x) => x.type === 'cross_football' && x.durationMin === 90));
});

test('commitmentActiveOn: weekday must match', () => {
  const c = mkCommit('cross_football', 1); // Monday
  assert.equal(commitmentActiveOn(c, '2026-07-06'), true);  // Mon
  assert.equal(commitmentActiveOn(c, '2026-07-07'), false); // Tue
});

test('commitmentActiveOn: fromDate (Sunday matches from 19.08.)', () => {
  const m = mkCommit('match', 7, { fromDate: '2026-08-19' }); // dow=Sun
  assert.equal(commitmentActiveOn(m, '2026-08-16'), false); // Sun before fromDate
  assert.equal(commitmentActiveOn(m, '2026-08-23'), true);  // first Sun >= 19.08.
});

test('commitmentActiveOn: untilDate limits the end', () => {
  const c = mkCommit('cross_football', 3, { untilDate: '2026-07-15' });
  assert.equal(commitmentActiveOn(c, '2026-07-08'), true);  // Wed <= until
  assert.equal(commitmentActiveOn(c, '2026-07-22'), false); // Wed > until
});

test('commitmentDates: all active appointments in the range, chronological', () => {
  const c = [mkCommit('cross_football', 1), mkCommit('cross_football', 3)];
  const dates = commitmentDates(c, '2026-07-06', '2026-07-12'); // Mon–Sun
  assert.deepEqual(dates.map((d) => d.date), ['2026-07-06', '2026-07-08']); // Mon, Wed
});

test('commitmentDates: empty/invalid range => empty', () => {
  assert.deepEqual(commitmentDates(defaultCommitments(), '2026-07-12', '2026-07-06'), []);
  assert.deepEqual(commitmentDates([], '2026-07-06', '2026-07-12'), []);
});

test('commitmentsSummary: readable summary', () => {
  const c = [mkCommit('cross_football', 1), mkCommit('cross_football', 3), mkCommit('match', 7, { fromDate: '2026-08-19' })];
  const s = commitmentsSummary(c);
  assert.match(s, /Fußball Mo, Mi/);
  assert.match(s, /Spiele So ab 19\.08\./);
  assert.equal(commitmentsSummary([]), 'Keine festen Termine');
});

test('dowLabel: Mon..Sun', () => {
  assert.equal(dowLabel(1), 'Mo');
  assert.equal(dowLabel(7), 'So');
});

test('mkCommit: football carries intensity (default normal), match does not (#5)', () => {
  assert.equal(mkCommit('cross_football', 1).intensity, 'normal');
  assert.equal(mkCommit('cross_football', 1, { intensity: 'intensiv' }).intensity, 'intensiv');
  assert.equal(mkCommit('match', 7).intensity, null);
});

test('commitmentsSummary: football intensity only if it differs from normal (#5)', () => {
  assert.match(commitmentsSummary([mkCommit('cross_football', 1, { intensity: 'intensiv' })]), /Fußball Mo \(intensiv\)/);
  assert.doesNotMatch(commitmentsSummary([mkCommit('cross_football', 1)]), /\(normal\)/);
});
