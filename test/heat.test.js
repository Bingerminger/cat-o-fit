/* Weather per session in the form estimate (since 4.2): a run in the heat counts with its cool-weather
   time (the same rule as the weather hint, at most 8 %), indoors never; sessions without the fields are
   estimated exactly as before. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatSlowdownPct, sessionHeatPct, sessionWeather } from '../js/heat.js';
import { heatSlowdownPct as hintRule } from '../js/weather.js';
import { estimateVdot, vdotFromPerf } from '../js/vdot.js';
import { completeUnit } from '../js/unit-actions.js';
import { activityData } from '../js/health-import.js';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';

const TODAY = '2026-07-20';
const run = (daysAgo, extra = {}) => ({ id: `r${daysAgo}`, date: addDays(TODAY, -daysAgo), type: 'tempo', distanceKm: 10, durationSec: 2700, ...extra });

test('one heat rule for hint and estimate: from 20 °C, 0.4 % per degree above 15, at most 8 %', () => {
  assert.equal(hintRule, heatSlowdownPct);
  assert.deepEqual([19, 20, 25, 30, 35, 45].map(heatSlowdownPct), [0, 2, 4, 6, 8, 8]);
  assert.deepEqual([null, '', undefined, 'x'].map(heatSlowdownPct), [0, 0, 0, 0]);
  assert.equal(sessionHeatPct({ tempC: 30, indoor: true }), 0, 'indoors never');
});

test('a hot run counts with its cool-weather time; indoors and without a temperature as before', () => {
  const plain = estimateVdot([run(2)], TODAY);
  const hot = estimateVdot([run(2, { tempC: 30 })], TODAY);
  assert.equal(hot.vdot, vdotFromPerf(10000, 2700 / 1.06));
  assert.ok(hot.vdot > plain.vdot);
  assert.equal(hot.basis.heatPct, 6);
  assert.equal(estimateVdot([run(2, { tempC: 30, indoor: true })], TODAY).vdot, plain.vdot, 'indoors: no correction');
  assert.equal(estimateVdot([run(2, { tempC: 12 })], TODAY).vdot, plain.vdot, 'cool: no correction');
  assert.deepEqual(estimateVdot([run(2, { tempC: null })], TODAY), plain, 'an empty field changes nothing');
});

test('a hot block followed by "adjust to form" stays bounded by the 8 % cap', () => {
  const block = [2, 9, 16, 23].map((d) => run(d, { tempC: 38 }));
  const est = estimateVdot(block, TODAY);
  assert.ok(est.vdot <= vdotFromPerf(10000, 2700 / 1.08) + 0.05, `${est.vdot}`);
});

test('weather fields: indoors wins, the temperature only when plausible, sessions keep their shape', () => {
  assert.deepEqual(sessionWeather({ indoor: true, tempC: 30 }), { indoor: true });
  assert.deepEqual(sessionWeather({ tempC: '21.46' }), { tempC: 21.46 });
  assert.deepEqual(sessionWeather({ tempC: 80 }), {});
  assert.deepEqual(sessionWeather({ indoor: false, tempC: null }), {});
  assert.deepEqual(sessionWeather(null), {});
  // Imports and completing a planned session carry them; without them nothing is added.
  assert.equal(activityData({ distanceKm: 5, durationSec: 1500, indoor: true }, 'easy').indoor, true);
  assert.equal('indoor' in activityData({ distanceKm: 5, durationSec: 1500 }, 'easy'), false);
  store.upsert('plans', { id: 'p-h', eventId: 'e', units: [{ id: 'u-h', planId: 'p-h', date: TODAY, type: 'easy', status: 'geplant' }] });
  const plan = store.find('plans', 'p-h');
  const s = completeUnit(plan, plan.units[0], { distanceKm: 8, durationSec: 2400, tempC: 27 });
  assert.equal(s.tempC, 27);
  assert.equal('indoor' in s, false);
  store.remove('plans', 'p-h');
  store.remove('sessions', s.id);
});
