/* =========================================================================
   rpe-hr.test.js — load from watch data: if the effort rating (RPE) is missing, the
   average heart rate estimates it relative to max HR; the load stays sRPE. Plus the
   "How hard was it?" prompt on "Today" for imported workouts.
   ========================================================================= */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { rpeFromHr, sessionRpeInfo, sessionRpe, sessionLoad, useHrReference, trainingLoad } from '../js/load.js';
import { rpeAskList } from '../js/planflow.js';
import * as dashboard from '../js/dashboard.js';
import { todayStr, addDays } from '../js/ui.js';

const T = '2026-07-18';
afterEach(() => useHrReference(null));

test('RPE from heart rate: anchor points of the HR zones, unusable values → null', () => {
  assert.equal(rpeFromHr(133, 190), 4);        // 70 % → 4
  assert.equal(rpeFromHr(152, 190), 6);        // 80 % → 6
  assert.equal(rpeFromHr(161.5, 190), 7);      // 85 % → 7
  assert.equal(rpeFromHr(90, 190), 1.5);       // below 50 % → 1.5
  assert.equal(rpeFromHr(null, 190), null);
  assert.equal(rpeFromHr(150, null), null, 'no estimate without max HR');
  assert.equal(rpeFromHr(230, 190), null, 'average HR well above max HR is a measurement error');
});

test('Imported interval training (stored as "easy") no longer counts as easy', () => {
  useHrReference(() => ({ maxHr: 190 }));
  const s = { date: T, type: 'easy', source: 'apple-health', durationSec: 3600, avgHr: 162 };
  const info = sessionRpeInfo(s);
  assert.equal(info.source, 'herzfrequenz');
  assert.ok(info.rpe > 6.5 && info.rpe < 7.5, `Estimate ≈ 7, was ${info.rpe}`);
  assert.equal(sessionLoad(s), Math.round(60 * info.rpe), 'load remains duration × effort');
  assert.ok(sessionLoad(s) > 60 * 4, 'previously 240 points (default value "easy")');
  assert.equal(trainingLoad([s], T, 7), sessionLoad(s), 'same calculation in the weekly load');
});

test('Recorded RPE takes precedence, hard types keep their minimum value, football keeps its intensity', () => {
  useHrReference(() => ({ maxHr: 190 }));
  assert.deepEqual(sessionRpeInfo({ type: 'easy', rpe: 3, avgHr: 170 }), { rpe: 3, source: 'erfasst' });
  // Intervals: the average HR includes the rests and underestimates – the type value 8 remains the lower bound.
  assert.equal(sessionRpe({ type: 'interval', avgHr: 150 }), 8);
  assert.equal(sessionRpeInfo({ type: 'cross_football', intensity: 'intensiv', avgHr: 120 }).rpe, 8.5);
  // An easy run with a low HR may fall below the default value.
  assert.ok(sessionRpe({ type: 'easy', avgHr: 120 }) < 4);
});

test('Without max HR or without HR, the default value of the sport stays (as before)', () => {
  assert.deepEqual(sessionRpeInfo({ type: 'easy', avgHr: 160 }), { rpe: 4, source: 'typ' });
  useHrReference(() => ({ maxHr: 190 }));
  assert.deepEqual(sessionRpeInfo({ type: 'long' }), { rpe: 6, source: 'typ' });
  assert.equal(sessionRpe({ type: 'easy', avgHr: 160 }, null), 4, 'an explicit reference of null switches the estimate off');
});

test('Prompt "How hard was it?": only imported workouts of the last few days without an effort rating', () => {
  const list = rpeAskList([
    { id: 'a', date: T, type: 'easy', source: 'apple-health' },
    { id: 'b', date: addDays(T, -1), type: 'cross_bike', source: 'gpx' },
    { id: 'c', date: T, type: 'easy', source: 'apple-health', rpe: 5 },          // already answered
    { id: 'd', date: T, type: 'easy', source: 'manual' },                        // entered by hand
    { id: 'e', date: T, type: 'walk', source: 'apple-health' },                  // walking: no question
    { id: 'f', date: addDays(T, -3), type: 'easy', source: 'apple-health' },     // too old
    { id: 'g', date: T, type: 'easy', source: 'health', rpeDismissed: true },    // dismissed
  ], T);
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
});

test('"Today" asks – one tap saves the effort rating', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  ['sessions', 'plans', 'events', 'health'].forEach((a) => store.replaceArea(a, []));
  store.setProfile({ name: 'Test', maxHr: 190, heightCm: 170, weightKg: 70, birthYear: 1990, sex: 'w' });
  const today = todayStr();
  store.upsert('sessions', { id: 'imp1', date: addDays(today, -1), type: 'easy', title: 'Lauf', source: 'apple-health', durationSec: 3000, distanceKm: 9.2, avgHr: 150 });
  dashboard.render(view);
  assert.match(view.textContent, /Wie hart war’s\?/);
  const hart = view.querySelectorAll('button').find((b) => b.textContent === 'hart');
  assert.ok(hart, 'answer "hard" offered');
  hart.click();
  assert.equal(store.find('sessions', 'imp1').rpe, 7);
});
