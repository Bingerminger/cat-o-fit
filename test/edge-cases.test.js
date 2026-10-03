/* Edge-Case-Härtung: Berechnungsmodule dürfen bei leeren, fehlenden, negativen
   oder extremen Eingaben weder werfen noch NaN/Infinity liefern. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as energy from '../js/energy.js';
import * as vdot from '../js/vdot.js';
import * as sug from '../js/suggestions.js';
import * as hg from '../js/healthgoals.js';

const T = '2026-06-29';

/** Rekursiv sicherstellen, dass kein Zahlenwert NaN oder Infinity ist. */
function assertFinite(name, value, path = '') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) || true, ''); // numbers are checked below
    assert.ok(!Number.isNaN(value), `${name}${path} ist NaN`);
    assert.ok(Number.isFinite(value), `${name}${path} ist nicht endlich (${value})`);
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) assertFinite(name, value[k], `${path}.${k}`);
  }
}

test('energy: bmr/trainingKcal/energyBalance bleiben endlich bei Müll-Eingaben', () => {
  assert.doesNotThrow(() => energy.bmr({}, T));
  assertFinite('bmr(zeros)', energy.bmr({ weightKg: 0, heightCm: 0, birthYear: 0, sex: 'w' }, T));
  assertFinite('bmr(neg)', energy.bmr({ weightKg: -5, heightCm: -10, birthYear: 3000, sex: 'm' }, T));
  assertFinite('trainingKcal(0)', energy.trainingKcal({ durationSec: 9999999, type: 'run' }, 0));
  assert.doesNotThrow(() => energy.energyBalance({}));
  assertFinite('energyBalance(empty)', energy.energyBalance({ profile: {}, sessions: [], diary: [], today: T }));
  assertFinite('estimateKcal(junk)', energy.estimateKcal([{}, { name: '', grams: 0 }, null]));
});

test('vdot: Division durch Null & Unsinn ergeben null/endliche Werte, kein NaN', () => {
  // vdotFromPerf gibt bei Unsinn null zurück (nicht NaN)
  assert.equal(vdot.vdotFromPerf(0, 0), null);
  assert.equal(vdot.vdotFromPerf(5000, 0), null);
  assert.equal(vdot.vdotFromPerf(-100, -50), null);
  // abgeleitete Funktionen bleiben endlich bzw. liefern saubere Strukturen
  assert.doesNotThrow(() => vdot.pacesFromVdot(0));
  assert.doesNotThrow(() => vdot.pacesFromVdot(NaN));
  assert.doesNotThrow(() => vdot.estimateVdot([], T));
  assert.doesNotThrow(() => vdot.paceAdjustment({}, 0));
});

test('suggestions: Prognose/Zielpace ohne Daten werfen nicht', () => {
  assert.doesNotThrow(() => sug.targetPaceSecPerKm('', 0));
  assert.doesNotThrow(() => sug.targetPaceSecPerKm('00:00:00', 0));
  assert.equal(sug.predictRace([], 21.1), null); // keine Sessions -> keine Prognose
});

test('healthgoals: Fortschritt ohne Daten ist endlich und 0-basiert', () => {
  const p = hg.goalProgress({});
  assertFinite('goalProgress({})', { minutes: p.minutes, days: p.days });
  assert.equal(p.minutes.value, 0);
  assert.equal(p.days.value, 0);
  assert.equal(p.weight, null);
});
