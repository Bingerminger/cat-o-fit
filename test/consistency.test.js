/* Konsistenz: dieselbe Kennzahl hat überall denselben Wert (Paket „Ein Coach, eine
   Zahl"). Früher zeigte der Monatsbericht 82 %, Statistik und Wettkampfseite 93 %
   Plan-Einhaltung für dieselben Daten; „Lauf-km“ enthielt je nach Ansicht Rad und
   Gehen. Hier werden Statistik, Erfolge, Wettkampfseite, Monatsbericht, „Heute“ und
   Team-Dashboard mit denselben Daten gegeneinander geprüft. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays, weekStartMonday } from '../js/ui.js';
import { planStatus, adherence, runKm, loadBalance, keyMetrics } from '../js/fitness.js';
import { computeStats, momentum } from '../js/badges.js';
import { buildMonthReport } from '../js/report.js';
import { teamAchievements } from '../js/teamstats.js';

const T = '2026-06-24';   // Mittwoch; Monat Juni, Fenster der Statistik: 27.05.–24.06.
beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

function data() {
  const u = (id, date, status, extra = {}) => ({ id, date, type: 'easy', title: id, status, ...extra });
  const plan = { id: 'p1', eventId: 'e1', startDate: '2026-06-01', units: [
    u('a', '2026-06-02', 'erledigt'), u('b', '2026-06-04', 'erledigt'), u('c', '2026-06-06', 'verpasst', { missedReason: 'time' }),
    u('d', '2026-06-09', 'erledigt'), u('e', '2026-06-11', 'verpasst', { missedReason: 'sick' }),   // Krankheit: neutral
    u('f', '2026-06-13', 'erledigt'), u('g', '2026-06-16', 'erledigt'), u('h', '2026-06-18', 'geplant'), // überfällig
    u('i', '2026-06-20', 'erledigt'), u('r', '2026-06-21', 'geplant', { type: 'rest' }),
    u('j', '2026-06-24', 'geplant'),                                       // heute, noch offen: nicht fällig
    u('k', '2026-06-26', 'geplant'), u('l', '2026-06-28', 'geplant'),     // Zukunft: nicht fällig
  ] };
  const sessions = [
    { id: 's1', date: '2026-06-02', type: 'easy', distanceKm: 8, durationSec: 2880 },
    { id: 's2', date: '2026-06-22', type: 'easy', distanceKm: 10, durationSec: 3600 },
    { id: 's3', date: '2026-06-23', type: 'cross_bike', distanceKm: 40, durationSec: 5400 },
    { id: 's4', date: '2026-06-20', type: 'walk', distanceKm: 6, durationSec: 4000 },
  ];
  return { plans: [plan], sessions };
}

test('Plan-Einhaltung: Statistik, Erfolge, Wettkampfseite und Monatsbericht zeigen denselben Wert', () => {
  const { plans, sessions } = data();
  // fällig: a b c d f g h i (e krank, r Ruhetag, j heute, k/l Zukunft) → 6 von 8 = 75 %
  const statistik = planStatus({ plans, sessions, today: T }).adherence;
  const erfolge = computeStats({ plans, sessions }, T).adherence;
  const wettkampf = adherence(plans, { today: T }).pct;
  const bericht = buildMonthReport({ plans, sessions, monthStr: '2026-06', today: T })
    .sections[0].items.find((i) => i.label === 'Plan-Einhaltung').value;
  assert.equal(statistik, 75);
  assert.equal(erfolge, 75);
  assert.equal(wettkampf, 75);
  assert.equal(bericht, '75 % (6/8)');
});

test('Plan-Einhaltung: morgens sinkt die Quote nicht (die heutige Einheit ist noch nicht fällig)', () => {
  const { plans } = data();
  const morning = adherence(plans, { today: T }).pct;
  const withoutToday = [{ ...plans[0], units: plans[0].units.filter((x) => x.id !== 'j') }];
  assert.equal(morning, adherence(withoutToday, { today: T }).pct, 'die offene heutige Einheit ändert nichts');
  const done = [{ ...plans[0], units: plans[0].units.map((x) => (x.id === 'j' ? { ...x, status: 'erledigt' } : x)) }];
  assert.ok(adherence(done, { today: T }).pct > morning, 'erst die erledigte Einheit zählt – dann positiv');
});

test('Lauf-km: Statistik, „Heute“, Monatsbericht und Kennzahl zählen nur Läufe', () => {
  const { sessions } = data();
  const ws = weekStartMonday(T);
  assert.equal(runKm(sessions, ws, addDays(ws, 6)), 10);                    // „Heute“: Woche 22.–28.06.
  assert.equal(loadBalance(sessions, T).last7, 10);                          // Statistik „Lauf-km · 7 Tage“
  const bericht = buildMonthReport({ sessions, plans: [], monthStr: '2026-06', today: T }).sections[0].items;
  assert.equal(bericht.find((i) => i.label === 'Gelaufene Kilometer').value, '18 km');
  assert.equal(bericht.find((i) => /Weitere Kilometer/.test(i.label)).value, '46 km');
  assert.equal(keyMetrics({ sessions, today: T }).find((m) => m.key === 'weeklyKm').value, 4.5);   // 18 km / 4 Wochen
});

test('Wochen-Serie und Momentum: eigene Sicht und Team-Dashboard stimmen überein', () => {
  const { plans, sessions } = data();
  const more = [...sessions, ...['2026-06-15', '2026-06-17', '2026-06-19', '2026-06-08', '2026-06-10', '2026-06-12']
    .map((date, i) => ({ id: `x${i}`, date, type: 'easy', distanceKm: 5 }))];
  const own = computeStats({ plans, sessions: more }, T).streak;
  const team = teamAchievements([{ id: 'm', name: 'M', shareMetrics: true, sessions: more, plans, events: [] }], T).longestStreak;
  assert.ok(own >= 2);
  assert.equal(team, own);
  // Momentum: gleiche Daten, gleiche Zahl – auch ohne Zyklusdaten (Team) identisch.
  assert.equal(momentum({ plans, sessions: more, isProtectedDay: () => false }, T).score, momentum({ plans, sessions: more }, T).score);
});

test('TRAIN-27: Monatsbericht vor Monatsende – künftige Einheiten drücken die Einhaltung nicht dauerhaft', () => {
  const { plans, sessions } = data();
  const pctOf = (today) => buildMonthReport({ plans, sessions, monthStr: '2026-06', today })
    .sections[0].items.find((i) => i.label === 'Plan-Einhaltung').value;
  // Am 24.06. versiegelt: nur die bis dahin fälligen Einheiten (früher 6/12 inkl. Zukunft).
  assert.equal(pctOf(T), '75 % (6/8)');
  // Nach Monatsende zählt der ganze Monat (j, k, l sind dann verpasst).
  assert.equal(pctOf('2026-07-05'), '55 % (6/11)');
});
