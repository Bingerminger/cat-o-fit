/* Unit-Tests für den „Coach“ (js/adaptive.js): Readiness, Belastung, Insights.
   today wird explizit übergeben -> unabhängig vom Ausführungsdatum. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adaptive from '../js/adaptive.js';
import { readinessScore, adaptiveInsights, paceHrFeedback } from '../js/adaptive.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';

test('readinessScore: ohne Daten null', () => {
  assert.equal(readinessScore([], T), null);
});

test('readinessScore: guter Schlaf hebt, schlechter senkt', () => {
  const gut = readinessScore([{ date: T, sleepHours: 8 }], T);
  assert.equal(gut.score, 76); // 68 + 8
  assert.equal(gut.label, 'hoch');
  assert.ok(gut.factors.includes('Schlaf 8 h'));

  const schlecht = readinessScore([{ date: T, sleepHours: 5 }], T);
  assert.equal(schlecht.score, 58); // 68 - 10
  assert.equal(schlecht.label, 'solide');
});

test('readinessScore: veraltete Werte (> 4 Tage) zählen nicht', () => {
  assert.equal(readinessScore([{ date: '2026-06-01', sleepHours: 8 }], T), null);
});

test('UI-11: kein zweites Belastungsurteil – adaptive.js urteilt nicht über die Belastung', () => {
  // Früher lieferte recentLoadFeedback („Belastung: ausgewogen – Weiter so!“) ein
  // RPE-Urteil neben dem ACWR-Urteil aus load.js. Die eine Quelle ist jetzt load.js.
  assert.equal(adaptive.recentLoadFeedback, undefined);
  const d = '2026-06-25';
  const hard = [8, 8, 8, 8].map((rpe) => ({ date: d, rpe, type: 'tempo' }));
  const out = adaptiveInsights({ sessions: hard, today: T });
  assert.ok(!out.some((i) => /Belastung/.test(i.title)), 'keine Belastungs-Karte aus adaptive.js');
});

test('TRAIN-12: Bereitschaft widerspricht einer Warn-Empfehlung nicht', () => {
  const health = [{ date: T, sleepHours: 8 }];                // Bereitschaft „hoch“
  const normal = adaptiveInsights({ health, today: T });
  assert.match(normal[0].text, /anspruchsvolles Training/);
  const warn = adaptiveInsights({ health, today: T, coachWarning: true });
  assert.doesNotMatch(warn[0].text, /anspruchsvolles Training/, 'nicht neben „Erholungstag empfohlen“');
  assert.match(warn[0].text, /Empfehlung oben/);
});

test('paceHrFeedback: warnt, wenn lockere Läufe über Z2 liegen (#17)', () => {
  const profile = { hrZones: [{ zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }] };
  const high = [-2, -5, -8].map((n) => ({ date: addDays(T, n), type: 'easy', avgHr: 140, distanceKm: 8, durationSec: 2880 }));
  const r = paceHrFeedback(high, profile, T);
  assert.ok(r && /über der Grundlagenzone/.test(r.text), 'Hinweis bei zu hoher HF');
  const ok = [-2, -5, -8].map((n) => ({ date: addDays(T, n), type: 'easy', avgHr: 128, distanceKm: 8, durationSec: 2880 }));
  assert.equal(paceHrFeedback(ok, profile, T), null, 'kein Hinweis im Zielbereich');
  assert.equal(paceHrFeedback(high, {}, T), null, 'ohne Zonen kein Hinweis');
});

test('adaptiveInsights: leere Eingabe -> keine Hinweise', () => {
  assert.deepEqual(adaptiveInsights({ today: T }), []);
});

test('adaptiveInsights: Readiness erzeugt einen Bereitschafts-Hinweis', () => {
  const out = adaptiveInsights({ health: [{ date: T, sleepHours: 8 }], today: T });
  assert.ok(out.some((i) => /Bereitschaft/.test(i.title)));
});

/* TRAIN-48: ln(HRV) im 7-Tage-Mittel gegen die eigene Normalbandbreite (28 Tage, ± 0,5 SD). */
const TH = '2026-09-29';
const hrvDays = (fn, n = 28, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `h${i}`, date: addDays(TH, -(n - 1 - i)), hrv: fn(i), hrvMethod: 'rmssd', restingHr: 52, ...extra,
}));

test('TRAIN-48: ein einzelner schlechter Tag kippt die Bereitschaft nicht mehr', () => {
  const h = hrvDays((i) => 50 + (i % 2 ? 6 : -6));
  h[h.length - 1] = { ...h[h.length - 1], hrv: 36 };             // ein Ausreißer heute
  const band = adaptive.hrvBand(h, h[h.length - 1], TH);
  assert.equal(band.state, 'normal', 'Tagesrauschen: im Normalbereich');
  const r = readinessScore(h, TH);
  assert.ok(r.factors.includes('HRV im Normalbereich'));
  assert.ok(r.score >= 60, `kein Einbruch durch einen Tag (war ${r.score})`);
});

test('TRAIN-48: anhaltend niedrige HRV über mehrere Tage senkt die Bereitschaft', () => {
  const h = hrvDays((i) => (i >= 21 ? 38 : 55) + (i % 3) - 1);
  const band = adaptive.hrvBand(h, h[h.length - 1], TH);
  assert.equal(band.state, 'low');
  const r = readinessScore(h, TH);
  assert.ok(r.factors.includes('HRV unter deinem Normalbereich (7-Tage-Mittel)'));
  assert.ok(r.score < 68 - 5);
});

test('TRAIN-48: zu wenige Werte → keine HRV-Aussage (statt eines Vergleichs mit sich selbst)', () => {
  const h = hrvDays(() => 50, 6);
  assert.equal(adaptive.hrvBand(h, h[h.length - 1], TH), null);
  assert.ok(!readinessScore(h, TH).factors.some((f) => f.startsWith('HRV')));
});
