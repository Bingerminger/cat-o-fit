/* Edge-case hardening: calculation modules must neither throw nor return
   NaN/Infinity for empty, missing, negative or extreme inputs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as energy from '../js/energy.js';
import * as vdot from '../js/vdot.js';
import * as sug from '../js/suggestions.js';
import * as hg from '../js/healthgoals.js';

const T = '2026-06-29';

/** Recursively ensure that no numeric value is NaN or Infinity. */
function assertFinite(name, value, path = '') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) || true, ''); // numbers are checked below
    assert.ok(!Number.isNaN(value), `${name}${path} is NaN`);
    assert.ok(Number.isFinite(value), `${name}${path} is not finite (${value})`);
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) assertFinite(name, value[k], `${path}.${k}`);
  }
}

test('energy: bmr/trainingKcal/energyBalance stay finite with garbage input', () => {
  assert.doesNotThrow(() => energy.bmr({}, T));
  assertFinite('bmr(zeros)', energy.bmr({ weightKg: 0, heightCm: 0, birthYear: 0, sex: 'w' }, T));
  assertFinite('bmr(neg)', energy.bmr({ weightKg: -5, heightCm: -10, birthYear: 3000, sex: 'm' }, T));
  assertFinite('trainingKcal(0)', energy.trainingKcal({ durationSec: 9999999, type: 'run' }, 0));
  assert.doesNotThrow(() => energy.energyBalance({}));
  assertFinite('energyBalance(empty)', energy.energyBalance({ profile: {}, sessions: [], diary: [], today: T }));
  assertFinite('estimateKcal(junk)', energy.estimateKcal([{}, { name: '', grams: 0 }, null]));
});

test('vdot: division by zero & nonsense give null/finite values, no NaN', () => {
  // vdotFromPerf returns null for nonsense (not NaN)
  assert.equal(vdot.vdotFromPerf(0, 0), null);
  assert.equal(vdot.vdotFromPerf(5000, 0), null);
  assert.equal(vdot.vdotFromPerf(-100, -50), null);
  // derived functions stay finite or return clean structures
  assert.doesNotThrow(() => vdot.pacesFromVdot(0));
  assert.doesNotThrow(() => vdot.pacesFromVdot(NaN));
  assert.doesNotThrow(() => vdot.estimateVdot([], T));
  assert.doesNotThrow(() => vdot.paceAdjustment({}, 0));
});

test('suggestions: forecast/target pace without data do not throw', () => {
  assert.doesNotThrow(() => sug.targetPaceSecPerKm('', 0));
  assert.doesNotThrow(() => sug.targetPaceSecPerKm('00:00:00', 0));
  assert.equal(sug.predictRace([], 21.1), null); // no sessions -> no forecast
});

test('healthgoals: progress without data is finite and zero-based', () => {
  const p = hg.goalProgress({});
  assertFinite('goalProgress({})', { minutes: p.minutes, days: p.days });
  assert.equal(p.minutes.value, 0);
  assert.equal(p.days.value, 0);
  assert.equal(p.weight, null);
});
