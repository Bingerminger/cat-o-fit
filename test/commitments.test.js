import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCommitments, mkCommit, commitmentActiveOn, commitmentDates, commitmentsSummary, dowLabel } from '../js/commitments.js';

// 2026-07-06 ist ein Montag (vgl. plans.test.js). 2026-08-19 ist ein Mittwoch.

test('defaultCommitments: Mo + Mi Fußball 90 min', () => {
  const c = defaultCommitments();
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.dow).sort(), [1, 3]);
  assert.ok(c.every((x) => x.type === 'cross_football' && x.durationMin === 90));
});

test('commitmentActiveOn: Wochentag muss passen', () => {
  const c = mkCommit('cross_football', 1); // Montag
  assert.equal(commitmentActiveOn(c, '2026-07-06'), true);  // Mo
  assert.equal(commitmentActiveOn(c, '2026-07-07'), false); // Di
});

test('commitmentActiveOn: fromDate (Sonntagsspiele ab 19.08.)', () => {
  const m = mkCommit('match', 7, { fromDate: '2026-08-19' }); // dow=So
  assert.equal(commitmentActiveOn(m, '2026-08-16'), false); // So vor fromDate
  assert.equal(commitmentActiveOn(m, '2026-08-23'), true);  // erster So >= 19.08.
});

test('commitmentActiveOn: untilDate begrenzt nach hinten', () => {
  const c = mkCommit('cross_football', 3, { untilDate: '2026-07-15' });
  assert.equal(commitmentActiveOn(c, '2026-07-08'), true);  // Mi <= until
  assert.equal(commitmentActiveOn(c, '2026-07-22'), false); // Mi > until
});

test('commitmentDates: alle aktiven Termine im Bereich, chronologisch', () => {
  const c = [mkCommit('cross_football', 1), mkCommit('cross_football', 3)];
  const dates = commitmentDates(c, '2026-07-06', '2026-07-12'); // Mo–So
  assert.deepEqual(dates.map((d) => d.date), ['2026-07-06', '2026-07-08']); // Mo, Mi
});

test('commitmentDates: leerer/ungültiger Bereich => leer', () => {
  assert.deepEqual(commitmentDates(defaultCommitments(), '2026-07-12', '2026-07-06'), []);
  assert.deepEqual(commitmentDates([], '2026-07-06', '2026-07-12'), []);
});

test('commitmentsSummary: lesbare Zusammenfassung', () => {
  const c = [mkCommit('cross_football', 1), mkCommit('cross_football', 3), mkCommit('match', 7, { fromDate: '2026-08-19' })];
  const s = commitmentsSummary(c);
  assert.match(s, /Fußball Mo, Mi/);
  assert.match(s, /Spiele So ab 19\.08\./);
  assert.equal(commitmentsSummary([]), 'Keine festen Termine');
});

test('dowLabel: Mo..So', () => {
  assert.equal(dowLabel(1), 'Mo');
  assert.equal(dowLabel(7), 'So');
});

test('mkCommit: Fußball trägt Intensität (Default normal), Spiel nicht (#5)', () => {
  assert.equal(mkCommit('cross_football', 1).intensity, 'normal');
  assert.equal(mkCommit('cross_football', 1, { intensity: 'intensiv' }).intensity, 'intensiv');
  assert.equal(mkCommit('match', 7).intensity, null);
});

test('commitmentsSummary: Fußball-Intensität nur abweichend von normal (#5)', () => {
  assert.match(commitmentsSummary([mkCommit('cross_football', 1, { intensity: 'intensiv' })]), /Fußball Mo \(intensiv\)/);
  assert.doesNotMatch(commitmentsSummary([mkCommit('cross_football', 1)]), /\(normal\)/);
});
