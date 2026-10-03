/* Unit-Tests für js/fitness.js — Ampelstatus, Trainingslast, Verpasst-Gründe,
   Kennzahlen mit Zielwerten. today wird übergeben -> datumsunabhängig. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBalance, missedBreakdown, planStatus, keyMetrics, activityMatrix, trainingLoad, recentLongRunKm, footballRpe, sessionLoad } from '../js/fitness.js';
import { addDays } from '../js/ui.js';

const T = '2026-06-28';
const run = (n, km, extra = {}) => ({ date: addDays(T, -n), type: 'easy', distanceKm: km, ...extra });

test('loadBalance: stabil, hoch, niedrig, unklar', () => {
  // 28 Tage täglich gleich -> Verhältnis 1
  const even = [];
  for (let n = 0; n < 28; n++) even.push(run(n, 5));
  const lb = loadBalance(even, T);
  assert.equal(lb.level, 'ok');

  assert.equal(loadBalance([], T).level, 'unklar');

  // letzte Woche viel mehr als der Schnitt der drei Wochen davor -> hoch
  const spike = [run(1, 40), run(10, 5), run(17, 5), run(24, 5), run(27, 5)];
  assert.equal(loadBalance(spike, T).level, 'hoch');

  // letzte Woche fast nichts -> niedrig
  const taper = [run(2, 2), run(10, 30), run(17, 30), run(24, 30), run(27, 30)];
  assert.equal(loadBalance(taper, T).level, 'niedrig');
});

test('TRAIN-10: in den ersten 4 Wochen Stufe „aufbau“ – keine rote Ampel für Einsteiger', () => {
  // Einsteigerin: 6 lockere Läufe in 12 Tagen, keine ältere Historie.
  const newbie = [0, 2, 4, 7, 9, 11].map((n) => run(n, 5, { rpe: 4 }));
  const lb = loadBalance(newbie, T);
  assert.equal(lb.level, 'aufbau');
  assert.equal(lb.sparse, true);
  const st = planStatus({ plans: [], sessions: newbie, today: T });
  assert.notEqual(st.level, 'rot');
  assert.ok(!st.reasons.some((r) => /deutlich über/.test(r.text)), 'keine Überlastungswarnung');
  assert.ok(st.reasons.some((r) => /Datenbasis wächst/.test(r.text)));
});

test('TRAIN-44: „Lockeres Tempo“ wertet nur Läufe in Z2 – zu schnelle Läufe gelten nicht als Fortschritt', () => {
  const profile = { hrZones: [{ zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }, { zone: 3, min: 133, max: 152 }] };
  // Vor 4–8 Wochen: 6:00 min/km in Z2. Jetzt: 5:00 min/km – aber mit HF 150 (Z3, nicht locker).
  const before = [30, 35, 40].map((n) => run(n, 10, { durationSec: 3600, avgHr: 128 }));
  const now = [2, 6, 10].map((n) => run(n, 10, { durationSec: 3000, avgHr: 150 }));
  const nowZ2 = [3].map((n) => run(n, 10, { durationSec: 3480, avgHr: 130 }));
  const m = keyMetrics({ profile, sessions: [...before, ...now, ...nowZ2], today: T }).find((x) => x.key === 'easyPace');
  assert.equal(Math.round(m.value), 348, 'nur der Z2-Lauf zählt (5:48 statt Schnitt mit den zu schnellen Läufen)');
  assert.match(m.hint, /Z2/);
  // Ohne HF-Zonen: Wert ja, Urteil nein.
  const noHr = keyMetrics({ sessions: [...before, ...now], today: T }).find((x) => x.key === 'easyPace');
  assert.equal(noHr.good, null);
  assert.match(noHr.hint, /ohne Herzfrequenz/);
});

test('TRAIN-25: Lauf-km zählen nur Läufe (Rad, Gehen, Schwimmen nicht)', () => {
  const mixed = [run(1, 8), { date: addDays(T, -2), type: 'cross_bike', distanceKm: 40 }, { date: addDays(T, -3), type: 'walk', distanceKm: 10 }, { date: addDays(T, -4), type: 'swim', distanceKm: 2 }];
  const lb = loadBalance(mixed, T);
  assert.equal(lb.last7, 8);
  assert.equal(lb.last28, 8);
  const wk = keyMetrics({ sessions: mixed, today: T }).find((m) => m.key === 'weeklyKm');
  assert.equal(wk.value, 2);                  // 8 km / 4 Wochen
});

test('missedBreakdown: zählt nach Grund und nur im Fenster', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), status: 'verpasst', missedReason: 'injured' },
    { date: addDays(T, -3), status: 'verpasst', missedReason: 'sick' },
    { date: addDays(T, -4), status: 'verpasst' }, // ohne Grund -> other
    { date: addDays(T, -5), status: 'erledigt' }, // nicht verpasst
    { date: addDays(T, -40), status: 'verpasst', missedReason: 'time' }, // außerhalb 28d
  ] }];
  const m = missedBreakdown(plans, T, 28);
  assert.equal(m.total, 3);
  assert.equal(m.byReason.injured, 1);
  assert.equal(m.byReason.sick, 1);
  assert.equal(m.byReason.other, 1);
  assert.equal(m.byReason.time, 0);
});

test('planStatus: grün bei guter Einhaltung und stabiler Last', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -4), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -6), type: 'tempo', status: 'erledigt' },
    { date: addDays(T, -8), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -9), type: 'long', status: 'erledigt' },
  ] }];
  const sessions = [];
  for (let n = 0; n < 28; n += 7) sessions.push(run(n, 10));
  const st = planStatus({ plans, sessions, today: T });
  assert.equal(st.level, 'gruen');
  assert.equal(st.adherence, 100);
});

test('TRAIN-26: Verletzungs- und Krankheitsausfälle sind neutral (Einhaltung, Ampel)', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'verpasst', missedReason: 'injured' },
    { date: addDays(T, -4), type: 'easy', status: 'verpasst', missedReason: 'sick' },
    { date: addDays(T, -6), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -8), type: 'easy', status: 'erledigt' },
  ] }];
  const st = planStatus({ plans, sessions: [], today: T });
  assert.equal(st.adherence, 100, 'nur die erledigten zählen als fällig');
  assert.equal(st.level, 'gruen');
  assert.ok(st.reasons.some((r) => /verletzungsbedingt/.test(r.text) && /nicht gegen dich/.test(r.text)));
});

test('planStatus: geschützte Tage zählen nicht gegen die Einhaltung', () => {
  const plans = [{ units: [
    { date: addDays(T, -2), type: 'easy', status: 'erledigt' },
    { date: addDays(T, -3), type: 'easy', status: 'offen' }, // geschützt -> kein Malus
  ] }];
  const isProtectedDay = (d) => d === addDays(T, -3);
  const st = planStatus({ plans, sessions: [], today: T, isProtectedDay });
  assert.equal(st.adherence, 100);
});

test('keyMetrics: Gewicht Richtung Ziel — abnehmend ist gut', () => {
  const health = [
    { date: addDays(T, -30), weight: 70 },
    { date: addDays(T, -1), weight: 68 },
  ];
  const profile = { targetWeightKg: 65 };
  const m = keyMetrics({ profile, health, sessions: [], today: T }).find((x) => x.key === 'weight');
  assert.equal(m.dir, 'down');
  assert.equal(m.good, true);     // über Ziel + abnehmend = gut
  assert.equal(m.goal, 'verbessern');
});

test('keyMetrics: am Zielgewicht -> halten', () => {
  const health = [{ date: addDays(T, -1), weight: 65.2 }];
  const m = keyMetrics({ profile: { targetWeightKg: 65 }, health, sessions: [], today: T }).find((x) => x.key === 'weight');
  assert.equal(m.goal, 'halten');
  assert.equal(m.good, true);
});

test('trainingLoad: Belastungspunkte aller Sportarten im 7-Tage-Fenster', () => {
  const sessions = [
    { date: T, type: 'easy', durationSec: 3600 },                  // 60 min × RPE 4 = 240
    { date: addDays(T, -1), type: 'strength', durationSec: 2400 }, // 40 min × 5 = 200
    { date: addDays(T, -3), type: 'cross_football', durationSec: 5400 }, // 90 min × 7 = 630 (Fußball „normal“, #5)
    { date: addDays(T, -10), type: 'easy', durationSec: 3600 },    // außerhalb 7 Tage
  ];
  assert.equal(trainingLoad(sessions, T, 7), 240 + 200 + 630);
});

test('trainingLoad: erfasstes RPE schlägt den Typ-Default', () => {
  assert.equal(trainingLoad([{ date: T, type: 'easy', durationSec: 3600, rpe: 8 }], T, 7), 480); // 60 × 8
});

test('footballRpe: Intensität leicht/normal/intensiv (#5)', () => {
  assert.equal(footballRpe('leicht'), 5);
  assert.equal(footballRpe('normal'), 7);
  assert.equal(footballRpe('intensiv'), 8.5);
  assert.equal(footballRpe(undefined), 7);   // Default = normal
  assert.equal(footballRpe('quatsch'), 7);
});

test('sessionLoad: Fußball nutzt die Intensität, wenn kein RPE erfasst wurde (#5)', () => {
  const min60 = { type: 'cross_football', durationSec: 3600 };
  assert.equal(sessionLoad({ ...min60, intensity: 'intensiv' }), 510); // 60 × 8.5
  assert.equal(sessionLoad({ ...min60, intensity: 'leicht' }), 300);   // 60 × 5
  assert.equal(sessionLoad(min60), 420);                                // ohne Angabe: normal (60 × 7)
  assert.equal(sessionLoad({ ...min60, intensity: 'intensiv', rpe: 6 }), 360); // erfasstes RPE schlägt Intensität
});

test('recentLongRunKm: längster Lauf im Fenster, ohne Nicht-Läufe', () => {
  const sessions = [
    { date: T, type: 'long', distanceKm: 16 },
    { date: addDays(T, -5), type: 'easy', distanceKm: 10 },
    { date: addDays(T, -40), type: 'long', distanceKm: 22 },     // außerhalb 28 Tage
    { date: T, type: 'strength', distanceKm: 99 },               // kein Lauf
  ];
  assert.equal(recentLongRunKm(sessions, T), 16);
  assert.equal(recentLongRunKm([], T), 0);
});

test('activityMatrix: 53 Wochen × 7 Tage, Level nach Minuten', () => {
  const sessions = [
    { date: T, durationSec: 1200 },             // 20 min -> Level 1
    { date: addDays(T, -1), durationSec: 4500 },// 75 min -> Level 3
    { date: addDays(T, -2), distanceKm: 10 },   // 10 km -> 60 min -> Level 3
  ];
  const m = activityMatrix({ sessions, today: T });
  assert.equal(m.cols.length, 53);
  m.cols.forEach((c) => assert.equal(c.days.length, 7));
  const todayCell = m.cols.flatMap((c) => c.days).find((d) => d.date === T);
  assert.equal(todayCell.minutes, 20);
  assert.equal(todayCell.level, 1);
  assert.equal(m.activeDays, 3);
});

test('activityMatrix: zukünftige Tage sind markiert (level -1)', () => {
  const WED = '2026-06-24'; // Mittwoch -> Do–So der laufenden Woche liegen in der Zukunft
  const m = activityMatrix({ sessions: [], today: WED });
  const future = m.cols.flatMap((c) => c.days).filter((d) => d.date > WED);
  assert.ok(future.length > 0);
  assert.ok(future.every((d) => d.level === -1 && d.future));
});

test('keyMetrics: Ruhepuls runter = gut, leere Eingabe = []', () => {
  const health = [
    { date: addDays(T, -25), restingHr: 58 },
    { date: addDays(T, -1), restingHr: 54 },
  ];
  const m = keyMetrics({ health, sessions: [], today: T }).find((x) => x.key === 'restingHr');
  assert.equal(m.dir, 'down');
  assert.equal(m.good, true);
  assert.deepEqual(keyMetrics({ today: T }), []);
});
