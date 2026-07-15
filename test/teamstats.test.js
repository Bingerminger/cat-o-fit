/* Tests für die Team-/Familien-Kennzahlen (js/teamstats.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamMonthKm, teamWeekActivity, teamUpcomingRaces, teamAchievements } from '../js/teamstats.js';

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

test('teamAchievements: Abzeichensumme + längste Serie (Halter nur wenn geteilt)', () => {
  const r = teamAchievements(members(), TODAY);
  assert.ok(r.badges >= 2, `mind. 2 Abzeichen, war ${r.badges}`);
  assert.ok(r.longestStreak >= 1);
  assert.equal(r.streakHolder, 'Alex');   // Alex teilt Kennzahlen; Bea (1 Serie, verborgen) würde nicht namentlich erscheinen
});
