/* Unit tests for the cycle phase logic (js/cycle.js).
   Integration-style: fills the store (cycle data) and enables the module. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays, diffDays, todayStr } from '../js/ui.js';
import {
  cyclePhase, isProtectedDay, cycleEnabled, avgCycleLength, avgPeriodLength, nextPredictedStart,
  cycleSoftenTargets, cycleEaseVariant,
} from '../js/cycle.js';

// Last real period start RELATIVE to today: a fixed date made the "next period" test
// turn red from about 92 days afterwards (the forecast then deliberately no longer
// protects), although the code was correct.
const REAL = addDays(todayStr(), -20);
function seed({ enabled = true } = {}) {
  store.replaceArea('cycle', [
    { id: 'cyc-a', startDate: addDays(REAL, -28), periodLength: 5, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'cyc-b', startDate: REAL, periodLength: 5, createdAt: '2026-01-01T00:00:00Z' },
  ]);
  store.setSetting('modules', enabled ? { cycle: true } : { cycle: false });
}

beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('cycleEnabled: on by default, can be switched off in the settings', () => {
  assert.equal(cycleEnabled(), true);              // beforeEach: {} -> on by default
  store.setSetting('modules', { cycle: false });
  assert.equal(cycleEnabled(), false);             // explicitly deselected
  store.setSetting('modules', { cycle: true });
  assert.equal(cycleEnabled(), true);
});

test('disabled module -> no phase', () => {
  seed({ enabled: false });
  assert.equal(cyclePhase(REAL), null);
  assert.equal(isProtectedDay(REAL), false);
});

test('avgCycleLength/avgPeriodLength from the entries', () => {
  seed();
  assert.equal(avgCycleLength(), 28); // two starts 28 days apart
  assert.equal(avgPeriodLength(), 5);
});

test('avgCycleLength: long cycles (45 days) count instead of 28 (HEALTH-12)', () => {
  const last = addDays(todayStr(), -10);
  store.replaceArea('cycle', [0, 1, 2, 3].map((i) => ({ id: `cyc-${i}`, startDate: addDays(last, -45 * (3 - i)), periodLength: 5 })));
  assert.equal(avgCycleLength(), 45);
});

test('check-in helper record (period missed?) does not count as a period start', () => {
  seed();
  store.upsert('cycle', { id: 'cycle-check', _kind: 'check', for: REAL, answer: 'verhuetung', at: '2026-01-01T00:00:00Z' });
  assert.equal(avgCycleLength(), 28);
  assert.equal(avgPeriodLength(), 5);
  assert.doesNotThrow(() => cyclePhase(REAL));
});

test('Phases across the cycle (real start)', () => {
  seed();
  const at = (n) => cyclePhase(addDays(REAL, n));
  assert.equal(at(0).phase, 'menstruation');
  assert.equal(at(0).cycleDay, 1);
  assert.equal(at(0).predicted, false);
  assert.equal(at(4).phase, 'menstruation'); // day 5, periodLength 5
  assert.equal(at(5).phase, 'follikel');
  assert.equal(at(13).phase, 'ovulation');
  assert.equal(at(16).phase, 'luteal');
});

test('isProtectedDay only during menstruation', () => {
  seed();
  assert.equal(isProtectedDay(REAL), true);
  assert.equal(isProtectedDay(addDays(REAL, 4)), true);
  assert.equal(isProtectedDay(addDays(REAL, 5)), false); // follicular phase
  assert.equal(isProtectedDay(addDays(REAL, 16)), false); // luteal phase
});

test('v3.17.0: stale forecasts no longer protect', () => {
  seed();
  // A predicted menstruation day shortly after the last real entry
  // still protects (28-day cycle -> REAL + 28 is the next start).
  assert.equal(isProtectedDay(addDays(REAL, 28)), true, 'fresh forecast protects');
  // Four months later the forecast is no longer reliable: without a new entry it
  // would otherwise permanently excuse sessions (no penalty for missing them) and
  // silently flatter the plan adherence.
  assert.equal(isProtectedDay(addDays(REAL, 28 * 5)), false, 'stale forecast does not protect');
  // The real entry itself always stays protected.
  assert.equal(isProtectedDay(REAL), true);
});

test('next period is forecast into the future', () => {
  seed();
  const next = nextPredictedStart();
  const today = todayStr();
  // Date-stable invariants instead of a fixed date (the old comparison with
  // REAL+28 failed on exactly the day when today == REAL+28):
  assert.ok(next > today, 'forecast lies in the future (after today)');
  assert.ok(next > REAL, 'and after the last real start');
  assert.equal(diffDays(REAL, next) % avgCycleLength(), 0, 'on the 28-day grid of the real start');
  assert.ok(addDays(next, -avgCycleLength()) <= today, 'first appointment after today (none skipped)');
  // A predicted menstruation day is also protected.
  assert.equal(isProtectedDay(next), true);
  assert.equal(cyclePhase(next).predicted, true);
});

test('nextPredictedStart with a given reference date (date-proof)', () => {
  seed();
  assert.equal(nextPredictedStart(addDays(REAL, 1)), addDays(REAL, 28));
  assert.equal(nextPredictedStart(addDays(REAL, 28)), addDays(REAL, 56), 'reference date = forecast -> the next one');
});

test('cycleSoftenTargets: open, demanding/normal sessions on day 1 – not fixed/easy/race (#3)', () => {
  const D = '2026-07-11';
  const units = [
    { id: 'a', date: D, type: 'long', status: 'geplant' },
    { id: 'b', date: D, type: 'strength', status: 'geplant' },
    { id: 'c', date: D, type: 'recovery', status: 'geplant' },                    // already easy -> out
    { id: 'd', date: D, type: 'cross_football', fixed: true, status: 'geplant' }, // fixed appointment -> out
    { id: 'e', date: D, type: 'race', status: 'geplant' },                        // race -> out
    { id: 'f', date: D, type: 'easy', status: 'erledigt' },                       // done -> out
    { id: 'g', date: '2026-07-12', type: 'tempo', status: 'geplant' },            // other day -> out
  ];
  assert.deepEqual(cycleSoftenTargets(units, D).map((u) => u.id).sort(), ['a', 'b']);
});

test('cycleEaseVariant: run -> recovery, strength -> mobility, marker cycleEased (#3)', () => {
  const run = cycleEaseVariant({ type: 'long', targetDistanceKm: 18 });
  assert.equal(run.type, 'recovery');
  assert.equal(run.cycleEased, true);
  assert.equal(run.originalType, 'long');
  const str = cycleEaseVariant({ type: 'strength' });
  assert.equal(str.type, 'mobility');
  assert.equal(str.cycleEased, true);
});
