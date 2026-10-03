/* „Ziel erreicht“ überall gleich (HEALTH-21), Trends über den geglätteten Wert
   (HEALTH-28) und keine Gewichtsziele, wo die Eignung sie ausschließt (HEALTH-07). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress as healthGoal, goalsProgress } from '../js/goals.js';
import { goalProgress as weekGoals } from '../js/healthgoals.js';
import { keyMetrics, smoothedChange } from '../js/fitness.js';
import { buildMonthReport } from '../js/report.js';

const T = '2026-09-29';
// Letzte Woche knapp unter 65 kg, der jüngste Einzelwert (nach dem Abendessen) darüber.
const HEALTH = [
  { date: '2026-09-25', weight: 64.7 }, { date: '2026-09-26', weight: 64.8 },
  { date: '2026-09-27', weight: 64.6 }, { date: '2026-09-28', weight: 65.4 },
];

test('Gesundheitsziel Gewicht: geglätteter Wert entscheidet, nicht die letzte Einzelmessung', () => {
  const p = healthGoal({ metric: 'weight', start: 70, target: 65 }, { health: HEALTH, today: T });
  assert.equal(p.current, 64.8);                 // Median der Woche
  assert.equal(p.reached, true);
  assert.equal(p.remaining, 0);
  assert.equal(p.pct, 1);
});

test('Wochenziele und Gesundheitsziele sagen dasselbe über das Zielgewicht', () => {
  const profile = { targetWeightKg: 65, targetWeightStartKg: 70 };
  const week = weekGoals({ profile, sessions: [], health: HEALTH, today: T });
  assert.equal(week.weight.current, 64.8);
  assert.equal(week.weight.reached, true);
  assert.equal(week.weight.status, 'halten');
  const metrics = keyMetrics({ profile, health: HEALTH, sessions: [], today: T });
  assert.equal(metrics.find((m) => m.key === 'weight').goal, 'halten');
});

test('keyMetrics: Hinweis „über/unter dem Ziel“ folgt der Zielrichtung', () => {
  const up = keyMetrics({ profile: { targetWeightKg: 58, targetWeightStartKg: 54 }, health: [{ date: T, weight: 55 }], sessions: [], today: T });
  assert.match(up.find((m) => m.key === 'weight').hint, /3 kg unter Ziel/);
  const beyond = keyMetrics({ profile: { targetWeightKg: 65, targetWeightStartKg: 70 }, health: [{ date: T, weight: 63 }], sessions: [], today: T });
  assert.match(beyond.find((m) => m.key === 'weight').hint, /unter dem Ziel – halten/);
});

test('Ohne Gewichtsziele (Kinder, Schwangerschaft, Essstörung): kein Ziel in Statistik und auf „Heute“', () => {
  const profile = {
    targetWeightKg: 60,
    settings: { healthGoals: [{ id: 'g1', metric: 'weight', target: 60, start: 70 }, { id: 'g2', metric: 'restingHr', target: 50, start: 60 }, { id: 'g3', metric: 'bodyFat', target: 15, start: 25 }] },
  };
  const m = keyMetrics({ profile, health: [{ date: T, weight: 70 }], sessions: [], today: T, noWeightGoals: true });
  const w = m.find((x) => x.key === 'weight');
  assert.equal(w.target, null);
  assert.equal(w.hint, 'aktueller Wert');
  const goals = goalsProgress({ profile, health: [], today: T, noWeightGoals: true });
  assert.deepEqual(goals.map((g) => g.goal.id), ['g2']);
  assert.equal(goalsProgress({ profile, health: [], today: T }).length, 3, 'gespeichert bleibt alles');
});

test('smoothedChange: Wochenmedian statt zweier Einzelwerte (HEALTH-28)', () => {
  const h = [
    { date: '2026-09-14', weight: 70.0 }, { date: '2026-09-15', weight: 70.4 }, { date: '2026-09-16', weight: 70.2 },
    { date: '2026-09-26', weight: 69.6 }, { date: '2026-09-27', weight: 69.8 }, { date: '2026-09-28', weight: 71.0 },
  ];
  const ch = smoothedChange(h, 'weight');
  assert.equal(ch.now, 69.8);                    // Median 26.–28.09.
  assert.equal(ch.since, '2026-09-16');           // letzte Messung ≥ 7 Tage davor
  assert.equal(ch.before, 70.2);                  // Median 10.–16.09.
  assert.equal(ch.delta, -0.4);                   // Einzelwerte hätten +0,8 gezeigt
  // Seltenes Wiegen (einmal im Monat) funktioniert trotzdem.
  const sparse = smoothedChange([{ date: '2026-08-01', weight: 72 }, { date: '2026-09-01', weight: 71 }], 'weight');
  assert.equal(sparse.delta, -1);
  assert.equal(smoothedChange([{ date: T, weight: 70 }], 'weight').delta, null);
  assert.equal(smoothedChange([], 'weight'), null);
});

test('Monatsbericht: Gewicht als Wochenmittel; ohne Gewicht, wo Gewichtsziele gesperrt sind', () => {
  const health = [
    { date: '2026-06-01', weight: 70 }, { date: '2026-06-02', weight: 71.5 }, { date: '2026-06-03', weight: 70.2 },
    { date: '2026-06-26', weight: 69 }, { date: '2026-06-27', weight: 68.4 }, { date: '2026-06-28', weight: 69.2 },
  ];
  const r = buildMonthReport({ profile: { name: 'Test' }, health, monthStr: '2026-06', today: '2026-06-30' });
  const w = r.sections.find((s) => s.heading === 'Körpergewicht');
  assert.ok(w.items.some((i) => i.value === '70,2 kg'), 'Beginn: Median der ersten Messwoche');
  assert.ok(w.items.some((i) => i.value === '69 kg'), 'Ende: Median der letzten Messwoche');
  assert.ok(w.items.some((i) => i.value === '-1,2 kg'));
  const hidden = buildMonthReport({ profile: { name: 'Kind' }, health, monthStr: '2026-06', today: '2026-06-30', showWeight: false });
  assert.ok(!hidden.sections.some((s) => s.heading === 'Körpergewicht'));
});
