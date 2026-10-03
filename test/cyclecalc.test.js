/* Zyklus-Rechnungen (js/cyclecalc.js): lange Zyklen zählen, vergessene Einträge nicht,
   und eine überfällige Periode führt erst zur Nachfrage, dann zum Arzthinweis. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodStarts, cycleGaps, typicalCycleLength, longCycleCount, periodSignal } from '../js/cyclecalc.js';
import { redFlags } from '../js/redflags.js';

const T = '2026-09-29';

test('cyclecalc: Zyklen über 40 Tage zählen mit, statt still auf 28 Tage zu fallen', () => {
  const s = ['2026-03-01', '2026-04-15', '2026-05-30', '2026-07-14'];
  assert.deepEqual(cycleGaps(s), [45, 45, 45]);
  assert.equal(typicalCycleLength(s), 45);
  assert.equal(longCycleCount(s), 3);
});

test('cyclecalc: ein vergessener Eintrag (≈ doppelte Länge) zählt nicht als Zyklus', () => {
  const s = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-04-23', '2026-05-21'];
  assert.deepEqual(cycleGaps(s), [28, 28, 28]);
  assert.equal(typicalCycleLength(s), 28);
  assert.equal(longCycleCount(s), 0);
});

test('cyclecalc: Periodenstarts ohne Hilfsdatensätze, Duplikate und Löschungen', () => {
  const cycle = [
    { id: 'a', startDate: '2026-05-01' }, { id: 'b', startDate: '2026-05-01' },
    { id: 'c', startDate: '2026-04-03', deleted: true },
    { id: 'cycle-check', _kind: 'check', for: '2026-05-01', answer: 'verhuetung' },
  ];
  assert.deepEqual(periodStarts(cycle), ['2026-05-01']);
});

test('periodSignal: erst nachfragen, Arzthinweis nur bei „ausgeblieben“ oder nach 90 Tagen', () => {
  const s = ['2026-05-01', '2026-05-29', '2026-06-26'];
  assert.equal(periodSignal({ starts: s, today: '2026-07-20' }), null, 'im üblichen Rahmen');
  const ask = periodSignal({ starts: s, today: '2026-08-05' });   // 40 Tage > 28 + 7
  assert.equal(ask.state, 'ask');
  assert.equal(ask.flag, false);
  const late = periodSignal({ starts: s, today: T });              // 95 Tage, unbeantwortet
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
  // Eine Antwort zu einem früheren Zyklus gilt nicht mehr.
  assert.equal(answered('nicht-eingetragen', '2026-05-29').flag, true);
  // Schwangerschaft aus der Abgrenzung: kein Alarm.
  assert.equal(periodSignal({ starts: s, today: T, gate: { pregnancy: true } }).flag, false);
});

test('redFlags: kein RED-S-Alarm bei Schwangerschaft oder beendeter Erfassung (HEALTH-09)', () => {
  const cycle = [{ id: 'c1', startDate: '2026-05-01' }, { id: 'c2', startDate: '2026-05-29' }, { id: 'c3', startDate: '2026-06-26' }];
  assert.equal(redFlags({ cycle, today: T }).length, 1, 'unbeantwortet nach 95 Tagen: Hinweis');
  assert.equal(redFlags({ cycle, today: T, gate: { pregnancy: true } }).length, 0);
  assert.equal(redFlags({ cycle, today: T, cycleCheck: { for: '2026-06-26', answer: 'nicht-eingetragen' } }).length, 0);
  // Bestätigt ausgeblieben: Hinweis schon vor 90 Tagen.
  const flags = redFlags({ cycle, today: '2026-08-20', cycleCheck: { for: '2026-06-26', answer: 'ausgeblieben' } });
  assert.equal(flags.length, 1);
  assert.match(flags[0].text, /ausgeblieben/);
});
