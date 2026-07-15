import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekUnits, unitPriority, weekCollisions, weekTriage, PRIORITY_RANK, destackSuggestion } from '../js/triage.js';

// 2026-07-06 = Montag; Woche Mo–So = 06..12.
const U = (date, type, extra = {}) => ({ id: date + type, date, type, title: `${type}@${date}`, status: 'geplant', ...extra });

test('weekUnits: filtert auf die Woche, ohne rest/verpasst', () => {
  const units = [
    U('2026-07-06', 'tempo'),
    U('2026-07-12', 'long'),
    U('2026-07-13', 'easy'),                 // nächste Woche
    U('2026-07-08', 'rest'),                 // Ruhetag zählt nicht
    U('2026-07-09', 'easy', { status: 'verpasst' }),
  ];
  const w = weekUnits(units, '2026-07-06');
  assert.deepEqual(w.map((u) => u.date).sort(), ['2026-07-06', '2026-07-12']);
});

test('unitPriority: feste Termine > Schlüssel > Kraft > Umfang > Erholung', () => {
  assert.equal(unitPriority({ type: 'cross_football', fixed: true }), 'fixed');
  assert.equal(unitPriority({ type: 'tempo' }), 'key');
  assert.equal(unitPriority({ type: 'long' }), 'key');
  assert.equal(unitPriority({ type: 'strength' }), 'strength');
  assert.equal(unitPriority({ type: 'easy' }), 'endurance');
  assert.equal(unitPriority({ type: 'recovery' }), 'recovery');
  assert.ok(PRIORITY_RANK.fixed > PRIORITY_RANK.key && PRIORITY_RANK.key > PRIORITY_RANK.strength);
});

test('weekCollisions: harte Back-to-Backs erkannt (mit Vorschlag)', () => {
  const c = weekCollisions([U('2026-07-06', 'tempo'), U('2026-07-07', 'interval')], '2026-07-06');
  const b2b = c.find((x) => x.kind === 'hard-b2b');
  assert.ok(b2b, 'hard-b2b erwartet');
  assert.ok(b2b.suggest && b2b.suggest.length > 0);
});

test('weekCollisions: zu viele harte Einheiten', () => {
  const c = weekCollisions([
    U('2026-07-06', 'tempo'), U('2026-07-08', 'interval'), U('2026-07-10', 'long'), U('2026-07-12', 'race'),
  ], '2026-07-06');
  const tmh = c.find((x) => x.kind === 'too-many-hard');
  assert.ok(tmh, 'too-many-hard erwartet');
});

test('weekCollisions: kein Ruhetag', () => {
  const units = ['06', '07', '08', '09', '10', '11', '12'].map((d) => U(`2026-07-${d}`, 'easy'));
  const c = weekCollisions(units, '2026-07-06');
  assert.ok(c.some((x) => x.kind === 'no-rest'));
});

test('weekCollisions: zwei harte Einheiten am selben Tag', () => {
  const c = weekCollisions([U('2026-07-06', 'tempo'), U('2026-07-06', 'strength', { id: 'x' })], '2026-07-06');
  assert.ok(c.some((x) => x.kind === 'double-hard'));
});

test('weekCollisions: entspannte Woche -> keine Kollision', () => {
  const c = weekCollisions([U('2026-07-06', 'easy'), U('2026-07-08', 'strength'), U('2026-07-10', 'tempo')], '2026-07-06');
  assert.equal(c.length, 0);
});

test('destackSuggestion: zwei Einheiten am selben Tag -> die schwächere auf einen freien Tag (#4)', () => {
  const today = '2026-07-06'; // Mo
  const units = [U('2026-07-07', 'long'), U('2026-07-07', 'strength')]; // Di doppelt belegt
  const s = destackSuggestion(units, today);
  assert.ok(s, 'Vorschlag vorhanden');
  assert.equal(s.date, '2026-07-07');
  assert.equal(s.move.type, 'strength');   // Kraft ist niedriger priorisiert als der Long Run (key)
  assert.equal(s.keep.type, 'long');
  assert.ok(s.target > '2026-07-07', 'Zieltag liegt nach dem Stapeltag');
});

test('destackSuggestion: nur eine Einheit pro Tag -> null', () => {
  assert.equal(destackSuggestion([U('2026-07-07', 'long'), U('2026-07-09', 'tempo')], '2026-07-06'), null);
});

test('weekTriage: nach Priorität geordnet, ok-Flag', () => {
  // Fußball zählt seit #5 als fordernd – daher Do statt Mi, damit er nicht direkt
  // vor der Tempoeinheit liegt (sonst „harte Tage in Folge"). hardCount = Fußball + Tempo.
  const t = weekTriage([U('2026-07-06', 'easy'), U('2026-07-07', 'cross_football', { fixed: true }), U('2026-07-09', 'tempo')], '2026-07-06');
  assert.equal(unitPriority(t.ranked[0]), 'fixed');   // fester Termin ganz oben
  assert.equal(t.ok, true);
  assert.equal(t.hardCount, 2);
});
