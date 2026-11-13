/* The methods table (docs/knowledge/methods-and-sources.md, English and German) and the user guide
   name thresholds the code uses. These checks hold the two together: change a constant and the
   sentence describing it turns red, and the other way round. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heatSlowdownPct } from '../js/heat.js';
import { weatherHint } from '../js/weather.js';
import { estimateVdot } from '../js/vdot.js';
import { estimateMaxHr } from '../js/hrzones.js';
import { POWER_ZONES } from '../js/perftest.js';
import { loadMinutes } from '../js/load.js';

const doc = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
const methods = { en: doc('knowledge/methods-and-sources.md'), de: doc('de/knowledge/methods-and-sources.md') };
const row = (text, start) => text.split('\n').find((l) => l.startsWith(`| ${start}`)) || '';

test('heat: from 20 °C, 0.4 % per degree above 15 °C, at most 8 %; the hint names it from 24 °C', () => {
  assert.equal(heatSlowdownPct(19.9), 0);
  assert.equal(heatSlowdownPct(20), Math.round((20 - 15) * 0.4));
  assert.equal(heatSlowdownPct(45), 8);
  const hint = (tMax) => weatherHint({ type: 'easy' }, { tMax, code: 3, wind: 5, precip: 0 });
  assert.match(hint(24).text, /\d\s?%/);
  assert.equal(hint(23), null);
  const en = row(methods.en, 'Heat hint'), de = row(methods.de, 'Hitze-Hinweis');
  for (const s of ['from 20 °C', '0.4% per degree above 15 °C', 'at most 8%', 'from 24 °C']) assert.ok(en.includes(s), s);
  for (const s of ['ab 20 °C', '0,4 % je Grad über 15 °C', 'höchstens 8 %', 'ab 24 °C']) assert.ok(de.includes(s), s);
});

test('climbing: more than 5 m per km counts, exactly 5 does not', () => {
  const today = '2026-11-10';
  const run = (ascentM) => estimateVdot([{ id: 'r', date: '2026-11-08', type: 'tempo', distanceKm: 10, durationSec: 3000, ascentM }], today).vdot;
  assert.equal(run(50), run(0));
  assert.ok(run(51) > run(0));
  assert.ok(row(methods.en, 'Elevation gain').includes('more than 5 m of climbing per km'));
  assert.ok(row(methods.de, 'Höhenmeter').includes('mehr als 5 Hm je km'));
});

test('max HR 208 − 0.7 × age, power levels as in the table', () => {
  assert.equal(estimateMaxHr(40), 180);
  assert.ok(row(methods.en, 'Max HR').includes('208 − 0.7 × age'));
  const bounds = POWER_ZONES.map(([a, b]) => [a, b]);
  assert.deepEqual(bounds.map(([, b]) => b), [55, 75, 90, 105, 120]);
  assert.ok(row(methods.en, 'Power zones').includes('below 55 %, 56–75 %, 76–90 %, 91–105 %, 106–120 %'));
});

test('load minutes from the distance: the minutes per km the guide names', () => {
  const per = (type) => loadMinutes({ type, distanceKm: 10 }).min / 10;
  const expect = { easy: 6, cross_bike: 2.5, rowing: 5, walk: 12, hike: 15, swim: 25 };
  for (const [type, m] of Object.entries(expect)) assert.equal(per(type), m, type);
  assert.match(doc('usage/coach-and-load.md'), /running 6 min\/km, cycling 2\.5, rowing 5, walking 12, hiking 15, swimming\n> 25/);
  assert.match(doc('de/usage/coach-and-load.md'), /Laufen 6 min\/km, Rad 2,5, Rudern 5, Gehen 12, Wandern 15,\n> Schwimmen 25/);
});
