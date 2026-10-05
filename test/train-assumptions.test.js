/* Central training assumptions whose breakage the suite used not to notice
   (toggle proofs T01, T07, T10, T11, T12). Every test has a positive control,
   so that it does not – like the old ACWR test – become unable to go red at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { restDaySuggestion } from '../js/rolling.js';
import { acwr, monotonyStrain } from '../js/load.js';
import { sessionLoad, loadBalance, RPE_BY_TYPE } from '../js/fitness.js';
import { repaceUnits, paceKeyOf, mergeFromDate } from '../js/planflow.js';
import { pacesFromVdot, raceZone, racePaceFromVdot } from '../js/vdot.js';

const T = '2026-06-17'; // Wednesday

test('T01: rest day not with a young history – but with a real load spike (with an open hard unit)', () => {
  const plan = { units: [{ id: 'hard', date: addDays(T, 1), type: 'interval', status: 'geplant' }] };
  // Only 5 days of data: arithmetically a high ACWR, but no real increase.
  const young = [
    { date: addDays(T, -4), type: 'easy', durationSec: 3600, rpe: 5 },
    { date: addDays(T, -2), type: 'tempo', durationSec: 3600, rpe: 8 },
    { date: T, type: 'long', durationSec: 5400, rpe: 6 },
  ];
  assert.equal(acwr(young, T).sparse, true);
  assert.equal(restDaySuggestion({ plan, sessions: young, today: T }), null, 'no false alarm while the data base is still building up');
  // Positive control: 5 calm weeks, then a week with 90 min of hard training daily → ACWR > 1.5.
  const spike = [];
  for (let d = 35; d >= 8; d -= 2) spike.push({ date: addDays(T, -d), type: 'easy', durationSec: 1800, rpe: 3 });
  for (let d = 6; d >= 0; d--) spike.push({ date: addDays(T, -d), type: 'interval', durationSec: 5400, rpe: 8 });
  assert.equal(acwr(spike, T).sparse, false);
  const rd = restDaySuggestion({ plan, sessions: spike, today: T });
  assert.ok(rd && rd.unit.id === 'hard', 'with a real load spike the hard unit is suggested');
});

test('T07: Without duration and distance a unit counts as 30 minutes (flat rate)', () => {
  assert.equal(sessionLoad({ type: 'easy' }), 30 * RPE_BY_TYPE.easy);
  assert.equal(sessionLoad({ type: 'easy', rpe: 6 }), 180);
  assert.equal(sessionLoad({ type: 'easy', distanceKm: 10 }), 60 * RPE_BY_TYPE.easy, 'distance → 6 min/km');
  assert.equal(sessionLoad({ type: 'tempo', durationSec: 3600, rpe: 7 }), 420);
});

test('T10/TRAIN-11: monotony warns from 2 – only when the week is clearly above the usual average', () => {
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
    assert.equal(m.tone, expect, `Monotony ${m.monotony}, week ${m.weekLoad} vs. ${m.chronicWeek}`);
    if (m.tone === 'warn') warned++; else calm++;
    if (m.monotony >= 2 && m.tone === 'good') monotonousButUsual++;
  }
  assert.ok(warned > 5 && calm > 5, `both sides of the threshold occur (${warned}/${calm})`);
  assert.ok(monotonousButUsual > 3, 'uniform at the usual level does not warn');
});

test('T11/TRAIN-10: statistics traffic light ≡ load ratio of the load card (one source)', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  let hoch = 0, niedrig = 0, ok = 0, aufbau = 0;
  const MAP = { optimal: 'ok', niedrig: 'niedrig', 'erhöht': 'hoch', hoch: 'hoch', aufbau: 'aufbau', unklar: 'unklar' };
  for (let k = 0; k < 200; k++) {
    const s = [];
    const base = 1200 + rnd() * 2400, bump = rnd() * 2, span = rnd() < 0.2 ? 20 : 40;
    for (let d = span; d >= 0; d--) if (rnd() < 0.6) s.push({ date: addDays(T, -d), type: 'easy', durationSec: Math.round(base * (d < 7 ? bump : 1)), rpe: 5 });
    const ac = acwr(s, T), lb = loadBalance(s, T);
    assert.equal(lb.ratio, ac.ratio, 'same metric');
    assert.equal(lb.level, MAP[ac.zone], `Zone ${ac.zone}, ratio ${ac.ratio}`);
    ({ hoch: () => hoch++, niedrig: () => niedrig++, ok: () => ok++, aufbau: () => aufbau++, unklar: () => {} })[lb.level]();
  }
  assert.ok(hoch && niedrig && ok && aufbau, `all ranges checked (${hoch}/${niedrig}/${ok}/${aufbau})`);
});

test('T12/TRAIN-05: adapting to current form assigns via the zone key, not via the HR zone', () => {
  const zones = pacesFromVdot(45);
  const units = [
    { id: 'm', date: addDays(T, 20), type: 'race', paceKey: 'race', targetHrZone: 3, targetPaceSecPerKm: 280, targetPaceMaxSecPerKm: 290 },
    { id: 'l', date: addDays(T, 2), type: 'long', paceKey: 'long', targetHrZone: 2, targetPaceSecPerKm: 300, targetPaceMaxSecPerKm: 320 },
    { id: 't', date: addDays(T, 3), type: 'tempo', targetHrZone: 4, targetPaceSecPerKm: 300, targetPaceMaxSecPerKm: 310 },   // legacy data without key
    { id: 'old', date: addDays(T, -2), type: 'easy', paceKey: 'easy', targetPaceSecPerKm: 400, targetPaceMaxSecPerKm: 420 },
    { id: 'fx', date: addDays(T, 1), type: 'cross_football', fixed: true },
  ];
  // With a target time the race pace stays the goal.
  let r = repaceUnits(units, zones, { today: T, race: null });
  const by = (id) => r.units.find((u) => u.id === id);
  assert.equal(by('m').targetPaceSecPerKm, 280, 'race pace from the target time stays');
  assert.equal(by('l').targetPaceSecPerKm, zones.long.min, 'long run gets the long zone (not easy)');
  assert.equal(by('t').targetPaceSecPerKm, zones.threshold.min, 'legacy data: tempo → threshold');
  assert.equal(by('t').paceKey, 'threshold');
  assert.equal(by('old').targetPaceSecPerKm, 400, 'the past stays');
  assert.equal(by('fx'), units[4], 'fixed appointments stay untouched');
  // Without a target time the race pace follows the form – marathon pace, not HM pace.
  const race = raceZone(racePaceFromVdot(45, 42.195), 42.195);
  r = repaceUnits(units, zones, { today: T, race });
  assert.equal(r.units.find((u) => u.id === 'm').targetPaceSecPerKm, race.min);
  assert.ok(race.min > zones.race_hm.min);
  assert.equal(paceKeyOf({ type: 'interval' }), 'vo2');
});

test('TRAIN-19: regenerating from today leaves the past untouched (missed, moved, done)', () => {
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
  assert.ok(['a', 'b', 'c', 'd'].every((id) => ids.includes(id)), 'the past and completed units stay');
  assert.equal(m.find((u) => u.id === 'a').missedReason, 'sick', 'reason for missing stays');
  assert.ok(!ids.includes('n1') && !ids.includes('n2'), 'no new units in the past (no duplicates)');
  assert.ok(!ids.includes('n3'), 'done today → nothing new next to it');
  assert.ok(ids.includes('n4') && !ids.includes('e'), 'future is planned anew');
});
