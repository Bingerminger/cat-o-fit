/* Unit-Tests für Kennzahlen, Badges und Momentum (js/badges.js).
   today wird explizit übergeben. Das Zyklus-Modul bleibt aus, damit
   isProtectedDay() deterministisch false ist (keine geschützten Tage). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';
import { computeStats, evaluateBadges, momentum, BADGES, alcoholFreeStreak, softWrap } from '../js/badges.js';

const T = '2026-06-28';
beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('computeStats: leere Daten -> Nullwerte', () => {
  const s = computeStats({}, T);
  assert.equal(s.totalSessions, 0);
  assert.equal(s.totalKm, 0);
  assert.equal(s.streak, 0);
  assert.equal(s.adherence, 0);
  assert.equal(s.raceFinished, false);
});

test('computeStats: Summen, längster Lauf, Qualitätseinheiten', () => {
  const s = computeStats({
    sessions: [
      { date: '2026-06-10', distanceKm: 10, type: 'easy' },
      { date: '2026-06-12', distanceKm: 21, type: 'long' },
      { date: '2026-06-14', distanceKm: 8, type: 'interval' },
      { date: '2026-06-16', distanceKm: 9, type: 'tempo' },
      { date: '2026-06-18', distanceKm: 5, type: 'easy', deleted: true }, // zählt nicht
    ],
  }, T);
  assert.equal(s.totalSessions, 4);
  assert.equal(s.totalKm, 48);
  assert.equal(s.longestRun, 21);
  assert.equal(s.intervalCount, 1);
  assert.equal(s.qualityCount, 2); // tempo + interval
});

test('computeStats: Aktiv-Streak in Tagen', () => {
  const s = computeStats({
    sessions: [{ date: T, distanceKm: 6, type: 'easy' }, { date: addDays(T, -1), distanceKm: 5, type: 'easy' }, { date: addDays(T, -2), distanceKm: 8, type: 'long' }],
  }, T);
  assert.equal(s.streak, 3);
});

test('computeStats: Plan-Einhaltung zählt nur fällige, nicht-geschützte Tage', () => {
  const s = computeStats({
    plans: [{ units: [
      { date: '2026-06-20', type: 'easy', status: 'erledigt' },
      { date: '2026-06-21', type: 'tempo', status: 'geplant' }, // fällig, offen
      { date: '2026-06-22', type: 'rest', status: 'geplant' },  // Ruhetag zählt nicht
      { date: '2026-12-01', type: 'long', status: 'geplant' },  // Zukunft zählt nicht
    ] }],
  }, T);
  assert.equal(s.adherence, 50); // 1 erledigt von 2 fälligen
});

test('computeStats: Wettkampf erkannt (Session race oder Event abgeschlossen)', () => {
  assert.equal(computeStats({ sessions: [{ date: T, type: 'race', distanceKm: 21 }] }, T).raceFinished, true);
  assert.equal(computeStats({ events: [{ status: 'abgeschlossen' }] }, T).raceFinished, true);
});

test('computeStats: einzelne erledigte MANUELLE Einheit löst keine „Perfekte Woche" aus', () => {
  // Vollständiger Plan, Woche 1 (01.–07.06.). Generierte Einheit offen, dazu eine
  // manuell angelegte Einheit OHNE `week`-Feld (erledigt, in der Vergangenheit).
  const plan = {
    id: 'p1', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'geplant' },   // Woche 1 unvollständig
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' },            // manuell, kein week
    ],
  };
  // Ohne die Datums-Ableitung landete m1 im „undefined"-Eimer und gälte allein als
  // perfekte Woche – jetzt gehört sie zu Woche 1, die wegen g1 nicht vollständig ist.
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, false);
});

test('computeStats: echte komplette Woche (inkl. manueller Einheit) bleibt „Perfekte Woche"', () => {
  const plan = {
    id: 'p2', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'erledigt' },
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' }, // manuell, kein week
    ],
  };
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, true);
});

test('evaluateBadges: „Erster Schritt" schaltet beim ersten Training frei', () => {
  const leer = evaluateBadges({}, T).find((b) => b.id === 'first');
  assert.equal(leer.unlocked, false);
  assert.equal(leer.progress, 0);
  const eins = evaluateBadges({ sessions: [{ date: T, distanceKm: 5, type: 'easy' }] }, T).find((b) => b.id === 'first');
  assert.equal(eins.unlocked, true);
  assert.equal(eins.progress, 1);
});

test('evaluateBadges: jeder Badge liefert cur/target/progress im gültigen Bereich', () => {
  const all = evaluateBadges({ sessions: [{ date: T, distanceKm: 5, type: 'easy' }] }, T);
  assert.equal(all.length, BADGES.length);
  for (const b of all) {
    assert.ok(b.progress >= 0 && b.progress <= 1, `${b.id} progress in [0,1]`);
    assert.equal(b.unlocked, b.cur >= b.target);
  }
});

test('alcoholFreeStreak: Tage seit dem letzten Alkohol-Tag', () => {
  assert.equal(alcoholFreeStreak([], T), null);                        // nie getrackt -> keine Aussage
  assert.equal(alcoholFreeStreak([{ date: T, alcohol: true }], T), 0); // heute getrunken
  assert.equal(alcoholFreeStreak([{ date: addDays(T, -3), alcohol: true }], T), 3);
  // alcohol:false bricht die Serie nicht
  assert.equal(alcoholFreeStreak([{ date: addDays(T, -5), alcohol: true }, { date: T, alcohol: false }], T), 5);
});

test('momentum: Grundwert, steigt mit Aktivität, sinkt mit Versäumnissen', () => {
  assert.equal(momentum({ sessions: [], plans: [] }, T).score, 42); // Basis
  // 3 Einheiten in den letzten 14 Tagen, 3er-Streak
  const aktiv = momentum({ sessions: [
    { date: T, distanceKm: 6, type: 'easy' }, { date: addDays(T, -1), distanceKm: 5, type: 'easy' }, { date: addDays(T, -2), distanceKm: 8, type: 'long' },
  ], plans: [] }, T);
  assert.equal(aktiv.score, 66); // 42 + 3*6 + min(3,10)*2
  assert.equal(aktiv.done14, 3);
  // eine verpasste, fällige Einheit zieht ab
  const schwach = momentum({ sessions: [], plans: [{ units: [{ date: addDays(T, -8), type: 'easy', status: 'geplant', week: 1 }] }] }, T);
  assert.equal(schwach.missed, 1);
  assert.equal(schwach.score, 34); // 42 - 8
});

test('Badges: jeder Eintrag hat eine gültige Aufwand-Stufe (tier 1–4)', () => {
  for (const b of BADGES) {
    assert.ok([1, 2, 3, 4].includes(b.tier), `${b.id} ohne gültiges tier`);
    assert.ok(b.emoji && b.name && b.desc && typeof b.p === 'function');
  }
  // alle ids eindeutig
  const ids = BADGES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'Badge-IDs müssen eindeutig sein');
});

test('Sportart-Badges schalten frei (Schwimmen, Rudern, Vielfalt)', () => {
  const T = '2026-06-29';
  const sessions = [
    { date: '2026-06-01', type: 'swim' },
    { date: '2026-06-02', type: 'rowing' },
    { date: '2026-06-03', type: 'tennis' },
    { date: '2026-06-04', type: 'hike' },
    { date: '2026-06-05', type: 'strength' },
  ];
  const badges = evaluateBadges({ sessions, plans: [], health: [], events: [], profile: {} }, T);
  const ok = (id) => badges.find((b) => b.id === id)?.unlocked;
  assert.equal(ok('swim1'), true);
  assert.equal(ok('row1'), true);
  assert.equal(ok('racket1'), true);  // tennis zählt als Rückschlag
  assert.equal(ok('hike1'), true);
  assert.equal(ok('variety5'), true); // 5 verschiedene Arten
});

test('Eventart-Badges: Programm abgeschlossen & Hyrox', () => {
  const T = '2026-06-29';
  const events = [
    { id: 'p', kind: 'program', status: 'abgeschlossen' },
    { id: 'h', name: 'Hyrox Berlin', sport: 'hyrox', status: 'abgeschlossen' },
  ];
  const badges = evaluateBadges({ sessions: [], plans: [], health: [], events, profile: {} }, T);
  assert.equal(badges.find((b) => b.id === 'program1')?.unlocked, true);
  assert.equal(badges.find((b) => b.id === 'hyrox')?.unlocked, true);
});

test('softWrap: Zero-Width-Space vor dem Hauptwort, kein Trennstrich', () => {
  const z = '​';
  assert.equal(softWrap('Langstreckenliebe'), 'Langstrecken' + z + 'liebe');
  assert.equal(softWrap('Schlafchampion'), 'Schlaf' + z + 'champion');
  assert.equal(softWrap('Wochenheld:in'), 'Wochen' + z + 'held:in');
  assert.equal(softWrap('Vielseitig'), 'Vielseitig'); // kein Hauptwort-Treffer
  assert.ok(!softWrap('Langstreckenliebe').includes('-')); // kein Trennstrich
});
