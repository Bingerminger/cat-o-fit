/* Tests for js/workout-engine.js — phases of workout mode and time calculation
   by real time (instead of a fixed 0.2 s per timer tick). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhases, advance, phaseRemaining, parseStructure } from '../js/workout-engine.js';
import { generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';
import { planPaces } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const works = (ph) => ph.filter((p) => p.kind === 'work');

test('buildPhases: distance intervals run via the target pace, with warm-up and cool-down', () => {
  const unit = {
    type: 'interval', title: 'VO2max 8×400 m', targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261, targetHrZone: 5,
    intervals: { warmupKm: 2, cooldownKm: 2, segments: Array.from({ length: 8 }, (_, i) => ({ workM: 400, workSec: 102, restSec: 90, label: `400 m · ${i + 1}/8` })) },
  };
  const ph = buildPhases(unit);
  assert.equal(ph[0].kind, 'warmup');
  assert.equal(ph.at(-1).kind, 'cooldown');
  assert.equal(works(ph).length, 8);
  // 400 m at 4:16 min/km ≈ 102 s – not 3 minutes as before.
  assert.ok(works(ph).every((p) => p.sec >= 98 && p.sec <= 106), works(ph).map((p) => p.sec).join(','));
  assert.equal(ph.filter((p) => p.kind === 'rest').length, 7, 'no rest after the last effort');
  assert.deepEqual(works(ph)[0].target, { pace: [251, 261], hrZone: 5 }, 'target pace and zone per phase');
  assert.ok(ph[0].sec > 500 && ph[0].sec < 700, `2 km warm-up at an easy pace, was ${ph[0].sec}`);
});

test('buildPhases: older units without segments – structure from the title, distance via the pace', () => {
  const vo2 = buildPhases({ type: 'interval', title: 'VO2max-Intervalle 6×800 m', targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261 });
  assert.equal(works(vo2).length, 6);
  assert.ok(works(vo2).every((p) => Math.abs(p.sec - 205) <= 3), `800 m ≈ 205 s, was ${works(vo2)[0].sec}`);
  assert.equal(vo2[0].kind, 'warmup', 'older units also start with a warm-up');
  const mara = buildPhases({ type: 'tempo', title: 'Marathon-Renntempo 3×4 km', targetPaceSecPerKm: 290, targetPaceMaxSecPerKm: 302 });
  assert.equal(works(mara).length, 3);
  assert.ok(works(mara)[0].sec > 1100, `4 km ≈ 19 min, was ${works(mara)[0].sec}`);
  // The "Aktivierung" unit carries the structure only in the description (3×2 min), not 3×6 min.
  const act = buildPhases({ type: 'tempo', title: 'Aktivierung', description: '2 km locker, 3×2 min im Renntempo, 4 Steigerungen.' });
  assert.deepEqual(works(act).map((p) => p.sec), [120, 120, 120]);
  assert.equal(buildPhases({ type: 'easy', title: 'Lockerer Dauerlauf' }), null, 'continuous run = stopwatch');
});

test('parseStructure: recognises minutes, metres and kilometres', () => {
  assert.deepEqual(parseStructure('Schwellenlauf 3×6 min'), { rounds: 3, workMin: 6 });
  assert.deepEqual(parseStructure('VO2max 8x400 m'), { rounds: 8, workM: 400 });
  assert.deepEqual(parseStructure('HM-Renntempo 3×3 km'), { rounds: 3, workM: 3000 });
  assert.equal(parseStructure('Long Run 18 km'), null);
});

test('advance: continues by real time – also across several phases (screen lock)', () => {
  const phases = [{ kind: 'work', sec: 60 }, { kind: 'rest', sec: 60 }, { kind: 'work', sec: 60 }, { kind: 'rest', sec: 60 }];
  // 5 s blocked (like a locked screen): the phase keeps running for 5 s anyway.
  let s = advance({ phase: 0, phaseElapsed: 2 }, phases, 5);
  assert.equal(s.phase, 0);
  assert.equal(phaseRemaining(s, phases), 53);
  // 130 s in the background: two phase changes, but no 3-2-1 signals while catching up.
  s = advance(s, phases, 130);
  assert.equal(s.phase, 2);
  assert.equal(Math.round(s.phaseElapsed), 17);
  assert.equal(s.events.filter((e) => e.type === 'phase').length, 2);
  assert.equal(s.events.filter((e) => e.type === 'count').length, 0);
  s = advance(s, phases, 200);
  assert.equal(s.done, true);
  assert.equal(s.events.at(-1).type, 'done');
});

test('advance: at the normal tick the 3-2-1 comes before the change', () => {
  const phases = [{ kind: 'work', sec: 4 }, { kind: 'rest', sec: 10 }];
  let s = { phase: 0, phaseElapsed: 0 };
  const counts = [];
  for (let i = 0; i < 25; i++) { s = advance(s, phases, 0.2); counts.push(...s.events.filter((e) => e.type === 'count').map((e) => e.k)); }
  assert.deepEqual(counts, [3, 2, 1]);
  assert.equal(s.phase, 1);
});

test('Workout phases fit every title of a generated plan (TRAIN-09/31)', () => {
  for (const [km, targetSec] of [[5, 1500], [10, 3000], [21.0975, 6900], [42.195, 14400]]) {
    const start = '2026-10-05';
    const event = { id: 'e', date: addDays(start, 11 * 7 + 5), distanceKm: km, sport: 'run' };
    const pp = planPaces({ distanceKm: km, targetSec });
    const plan = { id: 'p', eventId: 'e', startDate: start, weeks: 12, phases: makePhases(12), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: weekTemplateFor('run', 4), commitments: [], paces: pp.zones };
    const units = generatePlanUnits(plan, event, {}).filter((u) => ['tempo', 'interval'].includes(u.type));
    assert.ok(units.length > 5);
    for (const u of units) {
      const ph = buildPhases(u);
      const st = parseStructure(u.title);
      assert.ok(ph && ph.length, `${u.title}: phases present`);
      if (st) assert.equal(works(ph).length, st.rounds, `${u.title}: ${works(ph).length} efforts`);
      if (st && st.workMin) assert.ok(works(ph).every((p) => p.sec === st.workMin * 60), `${u.title}: time blocks`);
      if (st && st.workM) {
        const expect = (st.workM / 1000) * ((u.targetPaceSecPerKm + u.targetPaceMaxSecPerKm) / 2);
        assert.ok(works(ph).every((p) => Math.abs(p.sec - expect) <= 3), `${u.title}: distance via the pace (${works(ph)[0].sec} vs. ${Math.round(expect)})`);
      }
      assert.equal(ph[0].kind, 'warmup', `${u.title}: starts with a warm-up`);
    }
  }
});

test('Run-walk intervals: walking pauses and warm-up while walking', () => {
  const start = '2026-10-05';
  const event = { id: 'e', date: addDays(start, 11 * 7 + 5), distanceKm: 5, sport: 'run' };
  const plan = { id: 'p', eventId: 'e', startDate: start, weeks: 12, phases: makePhases(12), level: 'einsteiger', daysPerWeek: 3, weekTemplate: weekTemplateFor('run', 3), commitments: [] };
  const u = generatePlanUnits(plan, event, {}).find((x) => x.title.startsWith('Lauf-Geh-Wechsel'));
  const ph = buildPhases(u);
  assert.equal(ph[0].label, 'Aufwärmen (gehen)');
  assert.match(works(ph)[0].label, /^Laufen 1\//);
  assert.equal(ph.find((p) => p.kind === 'rest').label, 'Gehen');
});
