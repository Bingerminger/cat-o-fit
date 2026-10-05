/* Unit tests for status/date/format logic from js/ui.js (pure functions). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveStatus, isOverdue, diffDays, addDays, isoDow, weekStartMonday,
  parseHms, fmtDuration, fmtPace, fmtNum, fmtKm, fmtInt, typeMeta,
  SESSION_TYPES, TYPE_OPTIONS, ICONS,
} from '../js/ui.js';

const TODAY = '2026-06-28';

test('effectiveStatus: done/missed win regardless of the date', () => {
  assert.equal(effectiveStatus({ status: 'erledigt', date: '2020-01-01', type: 'long' }, TODAY), 'erledigt');
  assert.equal(effectiveStatus({ status: 'verpasst', date: '2020-01-01', type: 'long' }, TODAY), 'verpasst');
});

test('effectiveStatus: a past, open unit is overdue', () => {
  assert.equal(effectiveStatus({ type: 'long', date: '2026-06-27' }, TODAY), 'ueberfaellig');
  // a unit moved into the past also becomes overdue
  assert.equal(effectiveStatus({ type: 'long', date: '2026-06-27', status: 'verschoben' }, TODAY), 'ueberfaellig');
});

test('effectiveStatus: a rest day never becomes overdue', () => {
  assert.equal(effectiveStatus({ type: 'rest', date: '2020-01-01' }, TODAY), 'geplant');
});

test('effectiveStatus: today/future keeps planned or its own status', () => {
  assert.equal(effectiveStatus({ type: 'long', date: TODAY }, TODAY), 'geplant');
  assert.equal(effectiveStatus({ type: 'long', date: '2026-06-29' }, TODAY), 'geplant');
  assert.equal(effectiveStatus({ type: 'long', date: '2026-06-29', status: 'verschoben' }, TODAY), 'verschoben');
  assert.equal(effectiveStatus(null, TODAY), 'geplant');
});

test('isOverdue is the boolean view of effectiveStatus', () => {
  assert.equal(isOverdue({ type: 'tempo', date: '2026-06-01' }, TODAY), true);
  assert.equal(isOverdue({ type: 'tempo', date: '2026-06-01', status: 'erledigt' }, TODAY), false);
  assert.equal(isOverdue({ type: 'rest', date: '2026-06-01' }, TODAY), false);
});

test('Date helpers: diffDays, addDays, isoDow, weekStartMonday', () => {
  assert.equal(diffDays('2026-06-12', '2026-07-10'), 28);
  assert.equal(diffDays('2026-06-28', '2026-06-28'), 0);
  assert.equal(diffDays('2026-06-29', '2026-06-28'), -1);
  assert.equal(addDays('2026-06-28', 2), '2026-06-30');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isoDow('2026-06-28'), 7); // Sunday
  assert.equal(isoDow('2026-06-30'), 2); // Tuesday
  assert.equal(weekStartMonday('2026-06-28'), '2026-06-22'); // Monday of the same ISO week
});

test('Time helpers: parseHms <-> fmtDuration, fmtPace', () => {
  assert.equal(parseHms('1:30:00'), 5400);
  assert.equal(parseHms('45:30'), 2730); // mm:ss
  assert.equal(parseHms('90'), 90);
  assert.equal(parseHms(''), 0);
  assert.equal(fmtDuration(5400), '1:30:00');
  assert.equal(fmtDuration(2730), '45:30');
  assert.equal(fmtDuration(null), '–');
  assert.equal(fmtPace(300), '5:00');
  assert.equal(fmtPace(0), '–');
});

test('Number formatting German (comma)', () => {
  assert.equal(fmtNum(3.456, 1), '3,5');
  assert.equal(fmtNum(null), '–');
  assert.equal(fmtKm(9, 1), '9,0 km');
});

test('typeMeta returns a fallback for unknown types', () => {
  assert.ok(typeMeta('long'));
  assert.ok(typeMeta('gibtsnicht'));
  assert.equal(typeof typeMeta('long').label, 'string');
});

test('fmtInt: thousands separator (German notation)', () => {
  assert.equal(fmtInt(1234), '1.234');
  assert.equal(fmtInt(1234567), '1.234.567');
  assert.equal(fmtInt(999), '999');
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(-1500), '-1.500');
  assert.equal(fmtInt(1234.6), '1.235'); // rounds
  assert.equal(fmtInt(null), '–');
  assert.equal(fmtInt(undefined), '–');
});

test('Sport consistency: every selectable type exists and has a valid icon', () => {
  for (const opt of TYPE_OPTIONS) {
    const meta = SESSION_TYPES[opt.value];
    assert.ok(meta, `TYPE_OPTIONS "${opt.value}" missing in SESSION_TYPES`);
    assert.ok(meta.label && meta.short && meta.color && meta.cat, `${opt.value} incomplete`);
    assert.ok(ICONS[meta.icon], `Icon "${meta.icon}" for ${opt.value} missing in ICONS`);
  }
});

test('New sports exist and are selectable', () => {
  const neu = ['swim', 'hike', 'rowing', 'tennis', 'badminton', 'squash', 'tabletennis', 'spinning', 'elliptical', 'gym'];
  const optionValues = new Set(TYPE_OPTIONS.map((o) => o.value));
  for (const t of neu) {
    assert.ok(SESSION_TYPES[t], `Sport ${t} missing in SESSION_TYPES`);
    assert.ok(optionValues.has(t), `Sport ${t} is not selectable (TYPE_OPTIONS)`);
    // counts towards total load or strength, but is not a run (no run km)
    assert.notEqual(typeMeta(t).cat, 'run');
  }
});
