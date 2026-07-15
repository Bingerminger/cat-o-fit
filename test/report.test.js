/* Unit-Tests für js/report.js (Report-/Urkunden-Snapshots). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, aggregateSessions, buildMonthReport, buildEventReport, buildGoalReport } from '../js/report.js';

const profile = { name: 'Nora', targetWeightKg: 65 };

test('monthRange: Monatsgrenzen und Label', () => {
  assert.deepEqual(monthRange('2026-06'), { from: '2026-06-01', to: '2026-06-30', label: 'Juni 2026' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28', label: 'Februar 2026' });
});

test('aggregateSessions: km, Dauer, aktive Tage, Verteilung', () => {
  const a = aggregateSessions([
    { date: '2026-06-01', type: 'easy', distanceKm: 8, durationSec: 2880 },
    { date: '2026-06-01', type: 'strength', durationSec: 2400 },
    { date: '2026-06-03', type: 'easy', distanceKm: 6, durationSec: 2160 },
  ]);
  assert.equal(a.count, 3);
  assert.equal(a.km, 14);
  assert.equal(a.activeDays, 2);
  assert.equal(a.byType['Lockerer Lauf'], 2);
  assert.equal(a.byType['Kraft'], 1);
});

test('buildMonthReport: Struktur, Stammdaten, Werte-Sektion', () => {
  const sessions = [
    { date: '2026-06-02', type: 'easy', distanceKm: 8, durationSec: 2880 },
    { date: '2026-06-05', type: 'tempo', distanceKm: 9, durationSec: 2700 },
    { date: '2026-05-30', type: 'long', distanceKm: 18, durationSec: 6500 }, // außerhalb -> ignoriert
  ];
  const health = [
    { date: '2026-06-01', weight: 70 },
    { date: '2026-06-28', weight: 69 },
  ];
  const r = buildMonthReport({ profile, sessions, plans: [], health, events: [], monthStr: '2026-06', today: '2026-06-29' });
  assert.equal(r.type, 'month');
  assert.match(r.title, /Juni 2026/);
  assert.equal(r.subject.name, 'Nora');
  const training = r.sections.find((s) => s.heading === 'Training');
  assert.ok(training.items.some((i) => i.label === 'Trainingseinheiten' && i.value === '2'));
  const weight = r.sections.find((s) => s.heading === 'Körpergewicht');
  assert.ok(weight.items.some((i) => i.value === '-1 kg'));
  assert.equal(typeof r.verdict, 'string');
});

test('buildEventReport: mit Ergebnis und erreichter Zielzeit', () => {
  const event = { id: 'e1', name: 'Stadtlauf', date: '2026-06-20', distanceKm: 10, targetTime: '00:45:00' };
  const plan = {
    id: 'p1', eventId: 'e1', startDate: '2026-05-01', weeks: 7,
    units: [
      { id: 'u1', type: 'easy', date: '2026-05-05', status: 'erledigt' },
      { id: 'u2', type: 'tempo', date: '2026-05-12', status: 'erledigt' },
      { id: 'race', type: 'race', date: '2026-06-20', status: 'erledigt', executedSessionId: 'sres' },
    ],
  };
  const sessions = [
    { id: 'sa', date: '2026-05-05', type: 'easy', distanceKm: 8, durationSec: 2880 },
    { id: 'sres', date: '2026-06-20', type: 'race', distanceKm: 10, durationSec: 2640, avgHr: 172 }, // 44:00 -> unter 45:00
  ];
  const r = buildEventReport({ profile, event, plan, sessions, health: [], today: '2026-06-21' });
  assert.equal(r.type, 'event');
  assert.equal(r.subtitle, 'Stadtlauf');
  const res = r.sections.find((s) => s.heading === 'Wettkampf-Ergebnis');
  assert.ok(res, 'Ergebnis-Sektion fehlt');
  assert.ok(res.items.some((i) => i.value === 'erreicht ✓'));
  assert.equal(r.result.hit, true);
  assert.match(r.verdict, /Ziel erreicht/);
});

test('buildEventReport: ohne Ergebnis (vor dem Wettkampf)', () => {
  const event = { id: 'e2', name: 'HM', date: '2026-10-25', distanceKm: 21.1, targetTime: '01:55:00' };
  const plan = { id: 'p2', eventId: 'e2', startDate: '2026-08-01', units: [{ id: 'u', type: 'long', date: '2026-08-09', status: 'erledigt' }] };
  const sessions = [{ id: 's', date: '2026-08-09', type: 'long', distanceKm: 16, durationSec: 6000 }];
  const r = buildEventReport({ profile, event, plan, sessions, health: [], today: '2026-08-10' });
  assert.equal(r.result, null);
  assert.ok(!r.sections.some((s) => s.heading === 'Wettkampf-Ergebnis'));
  assert.match(r.verdict, /Ergebnis kann nach dem Wettkampf/);
});

test('buildGoalReport: Urkunde mit Stammdaten', () => {
  const r = buildGoalReport({ profile, goalTitle: 'Zielgewicht 65 kg erreicht', goalDetail: 'von 72 auf 65 kg', date: '2026-06-29' });
  assert.equal(r.type, 'goal');
  assert.equal(r.certificate, true);
  assert.equal(r.subject.name, 'Nora');
  assert.match(r.verdict, /Nora/);
  assert.match(r.verdict, /Zielgewicht/);
});
