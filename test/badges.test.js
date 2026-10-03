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

// T = So 28.06.2026. Drei Trainingstage je Woche mit Ruhetagen dazwischen.
const week3 = (monday) => [0, 2, 5].map((d) => ({ date: addDays(monday, d), distanceKm: 6, type: 'easy' }));

test('TRAIN-39: Wochen-Serie – Ruhetage erhalten die Serie', () => {
  // Drei Wochen mit je 3 Trainingstagen (Mo, Mi, Sa) – nie zwei Tage am Stück.
  const sessions = [...week3('2026-06-08'), ...week3('2026-06-15'), ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions }, T).streak, 3);
  // Eine Woche mit nur 2 Trainingstagen bricht die Serie.
  const broken = [...week3('2026-06-08'), { date: '2026-06-15', type: 'easy' }, { date: '2026-06-17', type: 'easy' }, ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions: broken }, T).streak, 1);
  // Die laufende Woche bricht die Serie nicht, solange sie läuft (erst 1 Trainingstag).
  const running = [...week3('2026-06-08'), ...week3('2026-06-15'), { date: '2026-06-22', type: 'easy' }];
  assert.equal(computeStats({ sessions: running }, T).streak, 2);
});

test('TRAIN-39: krankheitsbedingter Ausfall pausiert die Wochen-Serie statt sie zu brechen', () => {
  const sessions = [...week3('2026-06-08'), { date: '2026-06-15', type: 'easy' }, ...week3('2026-06-22')];
  const plans = [{ units: [{ date: '2026-06-17', type: 'easy', status: 'verpasst', missedReason: 'sick' }] }];
  assert.equal(computeStats({ sessions, plans }, T).streak, 2, 'Woche mit Krankheit zählt nicht, bricht aber nicht');
  const time = [{ units: [{ date: '2026-06-17', type: 'easy', status: 'verpasst', missedReason: 'time' }] }];
  assert.equal(computeStats({ sessions, plans: time }, T).streak, 1, '„keine Zeit“ bricht die Serie');
});

test('TRAIN-39: Serien-Abzeichen verlangen Wochen, nicht Tage ohne Ruhetag', () => {
  const ids = BADGES.map((b) => b.id);
  assert.ok(!ids.includes('streak60') && !ids.includes('streak30'), 'keine Tage-in-Folge-Abzeichen mehr');
  const konstanz = BADGES.filter((b) => b.cat === 'Konstanz');
  assert.ok(konstanz.every((b) => /Wochen/.test(b.desc)));
  // 7 Tage am Stück ohne Pause bringen keine höhere Stufe als 3 Tage je Woche.
  const daily = Array.from({ length: 21 }, (_, i) => ({ date: addDays(T, -i), type: 'easy' }));
  const regular = [...week3('2026-06-08'), ...week3('2026-06-15'), ...week3('2026-06-22')];
  assert.equal(computeStats({ sessions: daily }, T).streak, computeStats({ sessions: regular }, T).streak);
});

test('TRAIN-25: längster Lauf zählt nur Läufe – die Radtour schaltet kein Long-Run-Abzeichen frei', () => {
  const s = computeStats({ sessions: [{ date: T, type: 'cross_bike', distanceKm: 40 }, { date: T, type: 'easy', distanceKm: 8 }] }, T);
  assert.equal(s.longestRun, 8);
  assert.equal(evaluateBadges({ sessions: [{ date: T, type: 'cross_bike', distanceKm: 40 }] }, T).find((b) => b.id === 'long21').unlocked, false);
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

test('computeStats: einzelne erledigte MANUELLE Einheit löst keine „Perfekte Woche“ aus', () => {
  // Vollständiger Plan, Woche 1 (01.–07.06.). Generierte Einheit offen, dazu eine
  // manuell angelegte Einheit OHNE `week`-Feld (erledigt, in der Vergangenheit).
  const plan = {
    id: 'p1', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'geplant' },   // Woche 1 unvollständig
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' },            // manuell, kein week
    ],
  };
  // Ohne die Datums-Ableitung landete m1 im „undefined“-Eimer und gälte allein als
  // perfekte Woche – jetzt gehört sie zu Woche 1, die wegen g1 nicht vollständig ist.
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, false);
});

test('computeStats: echte komplette Woche (inkl. manueller Einheit) bleibt „Perfekte Woche“', () => {
  const plan = {
    id: 'p2', startDate: '2026-06-01', endDate: '2026-06-28', weeks: 4,
    units: [
      { id: 'g1', date: '2026-06-02', week: 1, type: 'easy', status: 'erledigt' },
      { id: 'm1', date: '2026-06-03', type: 'easy', status: 'erledigt' }, // manuell, kein week
    ],
  };
  assert.equal(computeStats({ plans: [plan] }, T).perfectWeek, true);
});

test('evaluateBadges: „Erster Schritt“ schaltet beim ersten Training frei', () => {
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
  // 3 Trainingstage in derselben Kalenderwoche → Wochen-Serie 1
  const aktiv = momentum({ sessions: [
    { date: T, distanceKm: 6, type: 'easy' }, { date: addDays(T, -1), distanceKm: 5, type: 'easy' }, { date: addDays(T, -2), distanceKm: 8, type: 'long' },
  ], plans: [] }, T);
  assert.equal(aktiv.score, 62); // 42 + 3*6 + min(1,10)*2
  assert.equal(aktiv.activeDays, 3);
  // eine verpasste, fällige Einheit zieht ab
  const schwach = momentum({ sessions: [], plans: [{ units: [{ date: addDays(T, -8), type: 'easy', status: 'geplant', week: 1 }] }] }, T);
  assert.equal(schwach.missed, 1);
  assert.equal(schwach.score, 34); // 42 - 8
});

test('TRAIN-39: Momentum steigt ab dem 6. Trainingstag einer Woche nicht weiter', () => {
  const fiveDays = [0, 1, 2, 3, 4].map((d) => ({ date: addDays('2026-06-22', d), type: 'easy' }));
  const sevenDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ date: addDays('2026-06-22', d), type: 'easy' }));
  assert.equal(momentum({ sessions: fiveDays, plans: [] }, T).activeDays, 5);
  assert.equal(momentum({ sessions: sevenDays, plans: [] }, T).activeDays, 5);
  assert.equal(momentum({ sessions: sevenDays, plans: [] }, T).score, momentum({ sessions: fiveDays, plans: [] }, T).score);
});

test('TRAIN-26: Krankheit/Verletzung pausiert das Momentum statt es abzuziehen', () => {
  const sessions = [-9, -11, -13].map((d) => ({ date: addDays(T, d), type: 'easy' }));
  const base = momentum({ sessions, plans: [] }, T);
  const sick = [{ units: [-1, -3, -5].map((d) => ({ date: addDays(T, d), type: 'easy', status: 'verpasst', missedReason: 'sick' })) }];
  const m = momentum({ sessions, plans: sick }, T);
  assert.equal(m.missed, 0, 'krankheitsbedingte Ausfälle ziehen nichts ab');
  assert.ok(m.score >= base.score, `pausiert statt gesunken (${m.score} vs. ${base.score})`);
  assert.equal(m.paused, true);
  assert.match(m.message, /Pausiert/);
  const time = [{ units: [-1, -3, -5].map((d) => ({ date: addDays(T, d), type: 'easy', status: 'verpasst', missedReason: 'time' })) }];
  assert.equal(momentum({ sessions, plans: time }, T).missed, 3, '„keine Zeit“ zählt weiter als Versäumnis');
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

test('softWrap: weiches Trennzeichen vor dem Hauptwort (UI-42)', () => {
  const z = '\u00ad';
  assert.equal(softWrap('Langstreckenliebe'), 'Langstrecken' + z + 'liebe');
  assert.equal(softWrap('Schlafchampion'), 'Schlaf' + z + 'champion');
  assert.equal(softWrap('Wochenheld:in'), 'Wochen' + z + 'held:in');
  assert.equal(softWrap('Vielseitig'), 'Vielseitig'); // kein Hauptwort-Treffer
  assert.ok(!softWrap('Langstreckenliebe').includes('\u200b'), 'kein Umbruch ohne Trennstrich mehr');
});
