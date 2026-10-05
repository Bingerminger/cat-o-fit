/* Unit tests for the "coach" (js/adaptive.js): readiness, load, insights.
   today is passed explicitly -> independent of the execution date. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adaptive from '../js/adaptive.js';
import { readinessScore, adaptiveInsights, paceHrFeedback } from '../js/adaptive.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';

test('readinessScore: null without data', () => {
  assert.equal(readinessScore([], T), null);
});

test('readinessScore: good sleep raises, poor sleep lowers', () => {
  const gut = readinessScore([{ date: T, sleepHours: 8 }], T);
  assert.equal(gut.score, 76); // 68 + 8
  assert.equal(gut.label, 'hoch');
  assert.ok(gut.factors.includes('Schlaf 8 h'));

  const schlecht = readinessScore([{ date: T, sleepHours: 5 }], T);
  assert.equal(schlecht.score, 58); // 68 - 10
  assert.equal(schlecht.label, 'solide');
});

test('readinessScore: stale values (> 4 days) do not count', () => {
  assert.equal(readinessScore([{ date: '2026-06-01', sleepHours: 8 }], T), null);
});

test('UI-11: no second load verdict – adaptive.js does not judge the load', () => {
  // Formerly recentLoadFeedback (a "balanced load" card) delivered an RPE
  // verdict next to the ACWR verdict from load.js. The single source is now load.js.
  assert.equal(adaptive.recentLoadFeedback, undefined);
  const d = '2026-06-25';
  const hard = [8, 8, 8, 8].map((rpe) => ({ date: d, rpe, type: 'tempo' }));
  const out = adaptiveInsights({ sessions: hard, today: T });
  assert.ok(!out.some((i) => /Belastung/.test(i.title)), 'no load card from adaptive.js');
});

test('TRAIN-12: readiness does not contradict a warning recommendation', () => {
  const health = [{ date: T, sleepHours: 8 }];                // readiness "high"
  const normal = adaptiveInsights({ health, today: T });
  assert.match(normal[0].text, /anspruchsvolles Training/);
  const warn = adaptiveInsights({ health, today: T, coachWarning: true });
  assert.doesNotMatch(warn[0].text, /anspruchsvolles Training/, 'not next to the rest-day recommendation');
  assert.match(warn[0].text, /Empfehlung oben/);
});

test('paceHrFeedback: warns when easy runs are above Z2 (#17)', () => {
  const profile = { hrZones: [{ zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }] };
  const high = [-2, -5, -8].map((n) => ({ date: addDays(T, n), type: 'easy', avgHr: 140, distanceKm: 8, durationSec: 2880 }));
  const r = paceHrFeedback(high, profile, T);
  assert.ok(r && /über der Grundlagenzone/.test(r.text), 'hint when HR is too high');
  const ok = [-2, -5, -8].map((n) => ({ date: addDays(T, n), type: 'easy', avgHr: 128, distanceKm: 8, durationSec: 2880 }));
  assert.equal(paceHrFeedback(ok, profile, T), null, 'no hint within the target range');
  assert.equal(paceHrFeedback(high, {}, T), null, 'no hint without zones');
});

test('adaptiveInsights: empty input -> no insights', () => {
  assert.deepEqual(adaptiveInsights({ today: T }), []);
});

test('adaptiveInsights: readiness produces a readiness insight', () => {
  const out = adaptiveInsights({ health: [{ date: T, sleepHours: 8 }], today: T });
  assert.ok(out.some((i) => /Bereitschaft/.test(i.title)));
});

/* TRAIN-48: ln(HRV) as a 7-day mean against the person's own normal range (28 days, ± 0.5 SD). */
const TH = '2026-09-29';
const hrvDays = (fn, n = 28, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `h${i}`, date: addDays(TH, -(n - 1 - i)), hrv: fn(i), hrvMethod: 'rmssd', restingHr: 52, ...extra,
}));

test('TRAIN-48: a single bad day no longer tips the readiness', () => {
  const h = hrvDays((i) => 50 + (i % 2 ? 6 : -6));
  h[h.length - 1] = { ...h[h.length - 1], hrv: 36 };             // one outlier today
  const band = adaptive.hrvBand(h, h[h.length - 1], TH);
  assert.equal(band.state, 'normal', 'daily noise: within the normal range');
  const r = readinessScore(h, TH);
  assert.ok(r.factors.includes('HRV im Normalbereich'));
  assert.ok(r.score >= 60, `no slump from a single day (was ${r.score})`);
});

test('TRAIN-48: persistently low HRV over several days lowers the readiness', () => {
  const h = hrvDays((i) => (i >= 21 ? 38 : 55) + (i % 3) - 1);
  const band = adaptive.hrvBand(h, h[h.length - 1], TH);
  assert.equal(band.state, 'low');
  const r = readinessScore(h, TH);
  assert.ok(r.factors.includes('HRV unter deinem Normalbereich (7-Tage-Mittel)'));
  assert.ok(r.score < 68 - 5);
});

test('TRAIN-48: too few values → no HRV statement (instead of a comparison with itself)', () => {
  const h = hrvDays(() => 50, 6);
  assert.equal(adaptive.hrvBand(h, h[h.length - 1], TH), null);
  assert.ok(!readinessScore(h, TH).factors.some((f) => f.startsWith('HRV')));
});
