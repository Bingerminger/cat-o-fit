/* Unit-Tests für den „Coach" (js/adaptive.js): Readiness, Belastung, Insights.
   today wird explizit übergeben -> unabhängig vom Ausführungsdatum. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readinessScore, recentLoadFeedback, adaptiveInsights, paceHrFeedback } from '../js/adaptive.js';
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

test('recentLoadFeedback: erst ab 3 Einheiten, dann nach RPE-Schnitt', () => {
  const d = '2026-06-25'; // 3 Tage vor T
  assert.equal(recentLoadFeedback([{ date: d, rpe: 8 }, { date: d, rpe: 8 }], T), null); // < 3
  assert.equal(recentLoadFeedback([{ date: d, rpe: 8 }, { date: d, rpe: 8 }, { date: d, rpe: 8 }], T).level, 'hoch');
  assert.equal(recentLoadFeedback([{ date: d, rpe: 3 }, { date: d, rpe: 3 }, { date: d, rpe: 3 }], T).level, 'niedrig');
  assert.equal(recentLoadFeedback([{ date: d, rpe: 5 }, { date: d, rpe: 6 }, { date: d, rpe: 5 }], T).level, 'ausgewogen');
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
