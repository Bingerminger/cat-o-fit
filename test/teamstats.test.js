/* Tests für die Team-/Familien-Kennzahlen (js/teamstats.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamMonthKm, teamWeekActivity, teamUpcomingRaces, teamAchievements, teamLoad } from '../js/teamstats.js';
import { useHrReference } from '../js/load.js';
import { evaluateBadges, BADGES, TRAINING_BADGE_CATS } from '../js/badges.js';

const TODAY = '2026-06-15';
const members = () => [
  { id: 'a', name: 'Alex', color: '#18b48a', emoji: '🏃', shareMetrics: true, shareGoal: true,
    sessions: [{ id: 's1', date: '2026-06-15', distanceKm: 10 }, { id: 's2', date: '2026-06-05', distanceKm: 8 }, { id: 's3', date: '2026-05-30', distanceKm: 5 }],
    events: [{ id: 'e1', name: 'City Run', date: '2026-08-01' }], plans: [] },
  { id: 'b', name: 'Bea', color: '#3d8bff', emoji: '🦊', shareMetrics: false, shareGoal: false,
    sessions: [{ id: 's4', date: '2026-06-15', distanceKm: 6 }],
    events: [{ id: 'e2', name: 'Geheimlauf', date: '2026-07-01' }], plans: [] },
  { id: 'c', name: 'Cara', color: '#ff8a3d', emoji: '⚡', shareMetrics: true, shareGoal: true,
    sessions: [],
    events: [{ id: 'e3', name: 'Marathon', date: '2026-06-20', priority: 'A' }], plans: [] },
];

test('teamMonthKm: anonyme Monatssumme (Vormonat ausgeschlossen) + Meilenstein', () => {
  const r = teamMonthKm(members(), TODAY);
  assert.equal(r.km, 24);           // 10 + 8 + 6 (Mai-Lauf zählt nicht)
  assert.equal(r.milestone, 50);    // nächster Meilenstein über 24
  assert.ok(Math.abs(r.pct - 0.48) < 1e-9);
});

test('teamWeekActivity: trainiert-Status, aktivste Person, shareMetrics ausgeblendet', () => {
  const r = teamWeekActivity(members(), TODAY);
  const ids = r.rows.map((x) => x.id);
  assert.deepEqual(ids, ['a', 'c']);             // Bea (shareMetrics:false) fehlt
  assert.equal(r.rows.find((x) => x.id === 'a').trained, true);
  assert.equal(r.rows.find((x) => x.id === 'c').trained, false);
  assert.equal(r.mostActiveId, 'a');
});

test('teamUpcomingRaces: nach Datum sortiert, shareGoal & Vergangenheit ausgeschlossen', () => {
  const r = teamUpcomingRaces(members(), TODAY);
  assert.deepEqual(r.map((x) => x.name), ['Marathon', 'City Run']); // 06-20 vor 08-01
  assert.ok(!r.some((x) => x.memberName === 'Bea'));                  // shareGoal:false
});

test('teamUpcomingRaces: Programme und abgeschlossene Events fallen raus', () => {
  const m = [{ id: 'x', name: 'X', shareGoal: true, events: [
    { id: 'p', name: 'Programm', date: '2026-07-01', kind: 'program' },
    { id: 'done', name: 'Vorbei', date: '2026-07-02', status: 'abgeschlossen' },
    { id: 'ok', name: 'Echt', date: '2026-07-03' },
  ] }];
  assert.deepEqual(teamUpcomingRaces(m, TODAY).map((x) => x.name), ['Echt']);
});

test('teamAchievements: Abzeichensumme + längste Wochen-Serie (Halter nur wenn geteilt)', () => {
  const ms = members();
  // Alex: in den zwei Vorwochen je 3 Trainingstage (Mo, Mi, Fr) → Wochen-Serie 2
  // (als „Tage in Folge“ wären es nur 1 – der 15.06.).
  ms[0].sessions.push(...['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12']
    .map((date, i) => ({ id: `w${i}`, date, distanceKm: 5, type: 'easy' })));
  const r = teamAchievements(ms, TODAY);
  assert.ok(r.badges >= 2, `mind. 2 Abzeichen, war ${r.badges}`);
  assert.equal(r.longestStreak, 2);
  assert.equal(r.streakHolder, 'Alex');   // Alex teilt Kennzahlen; Bea (verborgen) würde nicht namentlich erscheinen
});

test('TRAIN-40: Team zählt nur Trainings-Abzeichen (Gesundheit/Zyklus sind dort nie erreichbar)', () => {
  assert.ok(!TRAINING_BADGE_CATS.has('Gesundheit') && !TRAINING_BADGE_CATS.has('Zyklus'));
  const ms = members();
  const r = teamAchievements(ms, TODAY);
  const expected = ms.reduce((n, m) => n + evaluateBadges({ sessions: m.sessions, plans: m.plans, events: m.events, isProtectedDay: () => false }, TODAY)
    .filter((b) => b.unlocked && TRAINING_BADGE_CATS.has(b.cat)).length, 0);
  assert.equal(r.badges, expected);
  // Jede Kategorie ist entweder Training oder bewusst ausgenommen – neue Kategorien fallen auf.
  const cats = new Set(BADGES.map((b) => b.cat));
  cats.forEach((c) => assert.ok(TRAINING_BADGE_CATS.has(c) || ['Gesundheit', 'Zyklus'].includes(c), `Kategorie ${c} einordnen`));
});

test('TRAIN-53: Trainer-Sicht nur mit Freigabe, Last mit der Max-HF der jeweiligen Person', () => {
  const T = '2026-09-29';
  const run = (d) => ({ id: `s${d}`, date: `2026-09-${String(29 - d).padStart(2, '0')}`, type: 'easy', durationSec: 3600, avgHr: 150, source: 'apple-health' });
  const sessions = [0, 2, 4].map(run);
  useHrReference(() => ({ maxHr: 200 }));   // die Betrachterin – darf nicht zählen
  try {
    const rows = teamLoad([
      { id: 'a', name: 'Anna', shareLoad: true, maxHr: 170, sessions, health: [{ date: '2026-09-28', energy: 4, mood: 6 }] },
      { id: 'b', name: 'Ben', shareLoad: true, maxHr: 200, sessions },
      { id: 'c', name: 'Cem', sessions },                                  // keine Freigabe
      { id: 'd', name: 'Dana', shareLoad: false, maxHr: 180, sessions },
    ], T);
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Anna', 'Ben']);
    const anna = rows.find((r) => r.name === 'Anna'), ben = rows.find((r) => r.name === 'Ben');
    assert.ok(anna.load7 > ben.load7, 'dieselbe HF ist bei niedrigerer Max-HF anstrengender');
    assert.deepEqual([anna.energy, anna.mood], [4, 6]);
    assert.equal(ben.energy, null);
  } finally { useHrReference(null); }
});
