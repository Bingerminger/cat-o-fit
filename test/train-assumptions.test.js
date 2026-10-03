/* Zentrale Trainingsannahmen, deren Bruch die Suite früher nicht bemerkte
   (Toggle-Beweise T01, T07, T10, T11, T12). Jeder Test hat eine Positivkontrolle,
   damit er nicht – wie der alte ACWR-Test – gar nicht rot werden kann. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { restDaySuggestion } from '../js/rolling.js';
import { acwr, monotonyStrain } from '../js/load.js';
import { sessionLoad, loadBalance, RPE_BY_TYPE } from '../js/fitness.js';
import { repaceUnits, paceKeyOf, mergeFromDate } from '../js/planflow.js';
import { pacesFromVdot, raceZone, racePaceFromVdot } from '../js/vdot.js';

const T = '2026-06-17'; // Mittwoch

test('T01: Erholungstag nicht bei junger Historie – wohl aber bei echter Lastspitze (mit offener harter Einheit)', () => {
  const plan = { units: [{ id: 'hard', date: addDays(T, 1), type: 'interval', status: 'geplant' }] };
  // Erst seit 5 Tagen Daten: rechnerisch hoher ACWR, aber keine echte Steigerung.
  const young = [
    { date: addDays(T, -4), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: addDays(T, -2), type: 'tempo', durationSec: 3600, rpe: 8 },
    { date: T, type: 'long', durationSec: 5400, rpe: 6 },
  ];
  assert.equal(acwr(young, T).sparse, true);
  assert.equal(restDaySuggestion({ plan, sessions: young, today: T }), null, 'kein Fehlalarm in der Aufbauphase der Datenbasis');
  // Positivkontrolle: 5 Wochen ruhig, dann eine Woche mit täglich 90 min hart → ACWR > 1,5.
  const spike = [];
  for (let d = 35; d >= 8; d -= 2) spike.push({ date: addDays(T, -d), type: 'easy', durationSec: 1800, rpe: 3 });
  for (let d = 6; d >= 0; d--) spike.push({ date: addDays(T, -d), type: 'interval', durationSec: 5400, rpe: 8 });
  assert.equal(acwr(spike, T).sparse, false);
  const rd = restDaySuggestion({ plan, sessions: spike, today: T });
  assert.ok(rd && rd.unit.id === 'hard', 'bei echter Lastspitze wird die harte Einheit vorgeschlagen');
});

test('T07: Ohne Dauer und Strecke zählt eine Einheit als 30 Minuten (Pauschale)', () => {
  assert.equal(sessionLoad({ type: 'easy' }), 30 * RPE_BY_TYPE.easy);
  assert.equal(sessionLoad({ type: 'easy', rpe: 6 }), 180);
  assert.equal(sessionLoad({ type: 'easy', distanceKm: 10 }), 60 * RPE_BY_TYPE.easy, 'Strecke → 6 min/km');
  assert.equal(sessionLoad({ type: 'tempo', durationSec: 3600, rpe: 7 }), 420);
});

test('T10/TRAIN-11: Monotonie warnt ab 2 – nur, wenn die Woche deutlich über dem eigenen Schnitt liegt', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let warned = 0, calm = 0, monotonousButUsual = 0;
  for (let k = 0; k < 300; k++) {
    const s = [];
    for (let d = 7; d < 28; d++) if (rnd() < 0.5) s.push({ date: addDays(T, -d), type: 'easy', durationSec: Math.round(1800 + rnd() * 1800), rpe: 5 });
    const bump = 0.5 + rnd() * 2;
    for (let d = 0; d < 7; d++) if (rnd() < 0.85) s.push({ date: addDays(T, -d), type: 'easy', durationSec: Math.round((1500 + rnd() * 900) * bump), rpe: 5 });
    const m = monotonyStrain(s, T);
    if (Math.abs(m.monotony - 2) < 0.02 || Math.abs(m.weekLoad - m.chronicWeek * 1.1) < 5) continue;
    const expect = m.monotony >= 2 && m.chronicWeek > 0 && m.weekLoad >= m.chronicWeek * 1.1 ? 'warn' : 'good';
    assert.equal(m.tone, expect, `Monotonie ${m.monotony}, Woche ${m.weekLoad} vs. ${m.chronicWeek}`);
    if (m.tone === 'warn') warned++; else calm++;
    if (m.monotony >= 2 && m.tone === 'good') monotonousButUsual++;
  }
  assert.ok(warned > 5 && calm > 5, `beide Seiten der Schwelle kommen vor (${warned}/${calm})`);
  assert.ok(monotonousButUsual > 3, 'gleichförmig auf gewohntem Niveau warnt nicht');
});

test('T11/TRAIN-10: Statistik-Ampel ≡ Lastverhältnis der Belastungskarte (eine Quelle)', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  let hoch = 0, niedrig = 0, ok = 0, aufbau = 0;
  const MAP = { optimal: 'ok', niedrig: 'niedrig', 'erhöht': 'hoch', hoch: 'hoch', aufbau: 'aufbau', unklar: 'unklar' };
  for (let k = 0; k < 200; k++) {
    const s = [];
    const base = 1200 + rnd() * 2400, bump = rnd() * 2, span = rnd() < 0.2 ? 20 : 40;
    for (let d = span; d >= 0; d--) if (rnd() < 0.6) s.push({ date: addDays(T, -d), type: 'easy', durationSec: Math.round(base * (d < 7 ? bump : 1)), rpe: 5 });
    const ac = acwr(s, T), lb = loadBalance(s, T);
    assert.equal(lb.ratio, ac.ratio, 'gleiche Kennzahl');
    assert.equal(lb.level, MAP[ac.zone], `Zone ${ac.zone}, ratio ${ac.ratio}`);
    ({ hoch: () => hoch++, niedrig: () => niedrig++, ok: () => ok++, aufbau: () => aufbau++, unklar: () => {} })[lb.level]();
  }
  assert.ok(hoch && niedrig && ok && aufbau, `alle Bereiche geprüft (${hoch}/${niedrig}/${ok}/${aufbau})`);
});

test('T12/TRAIN-05: „An Form anpassen“ ordnet über den Zonenschlüssel zu, nicht über die HF-Zone', () => {
  const zones = pacesFromVdot(45);
  const units = [
    { id: 'm', date: addDays(T, 20), type: 'race', paceKey: 'race', targetHrZone: 3, targetPaceSecPerKm: 280, targetPaceMaxSecPerKm: 290 },
    { id: 'l', date: addDays(T, 2), type: 'long', paceKey: 'long', targetHrZone: 2, targetPaceSecPerKm: 300, targetPaceMaxSecPerKm: 320 },
    { id: 't', date: addDays(T, 3), type: 'tempo', targetHrZone: 4, targetPaceSecPerKm: 300, targetPaceMaxSecPerKm: 310 },   // Altbestand ohne Schlüssel
    { id: 'old', date: addDays(T, -2), type: 'easy', paceKey: 'easy', targetPaceSecPerKm: 400, targetPaceMaxSecPerKm: 420 },
    { id: 'fx', date: addDays(T, 1), type: 'cross_football', fixed: true },
  ];
  // Mit Zielzeit bleibt das Renntempo das Ziel.
  let r = repaceUnits(units, zones, { today: T, race: null });
  const by = (id) => r.units.find((u) => u.id === id);
  assert.equal(by('m').targetPaceSecPerKm, 280, 'Renntempo aus der Zielzeit bleibt');
  assert.equal(by('l').targetPaceSecPerKm, zones.long.min, 'Long Run bekommt die Long-Zone (nicht Easy)');
  assert.equal(by('t').targetPaceSecPerKm, zones.threshold.min, 'Altbestand: Tempo → Schwelle');
  assert.equal(by('t').paceKey, 'threshold');
  assert.equal(by('old').targetPaceSecPerKm, 400, 'Vergangenes bleibt');
  assert.equal(by('fx'), units[4], 'feste Termine bleiben unberührt');
  // Ohne Zielzeit folgt das Renntempo der Form – Marathon-Tempo, nicht HM-Tempo.
  const race = raceZone(racePaceFromVdot(45, 42.195), 42.195);
  r = repaceUnits(units, zones, { today: T, race });
  assert.equal(r.units.find((u) => u.id === 'm').targetPaceSecPerKm, race.min);
  assert.ok(race.min > zones.race_hm.min);
  assert.equal(paceKeyOf({ type: 'interval' }), 'vo2');
});

test('TRAIN-19: Neu-Generieren ab heute lässt die Vergangenheit unberührt (verpasst, verschoben, erledigt)', () => {
  const existing = [
    { id: 'a', date: addDays(T, -3), type: 'tempo', status: 'verpasst', missedReason: 'sick' },
    { id: 'b', date: addDays(T, -2), type: 'easy', status: 'erledigt', executedSessionId: 's1' },
    { id: 'c', date: addDays(T, -1), type: 'long', status: 'geplant', movedFrom: addDays(T, -4) },
    { id: 'd', date: T, type: 'interval', status: 'erledigt', executedSessionId: 's2' },
    { id: 'e', date: addDays(T, 2), type: 'easy', status: 'geplant' },
  ];
  const fresh = [
    { id: 'n1', date: addDays(T, -3), type: 'interval', status: 'geplant' },
    { id: 'n2', date: addDays(T, -4), type: 'long', status: 'geplant' },
    { id: 'n3', date: T, type: 'tempo', status: 'geplant' },
    { id: 'n4', date: addDays(T, 2), type: 'recovery', status: 'geplant' },
  ];
  const m = mergeFromDate(existing, fresh, T);
  const ids = m.map((u) => u.id);
  assert.ok(['a', 'b', 'c', 'd'].every((id) => ids.includes(id)), 'Vergangenes und Erledigtes bleibt');
  assert.equal(m.find((u) => u.id === 'a').missedReason, 'sick', 'Ausfallgrund bleibt');
  assert.ok(!ids.includes('n1') && !ids.includes('n2'), 'keine neuen Einheiten in der Vergangenheit (keine Dubletten)');
  assert.ok(!ids.includes('n3'), 'heute erledigt → nichts Neues daneben');
  assert.ok(ids.includes('n4') && !ids.includes('e'), 'Zukunft wird neu geplant');
});
