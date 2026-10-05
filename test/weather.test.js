/* Unit tests for the weather mapping and the running hints (js/weather.js).
   Pure functions wmo()/weatherHint(); no network, no store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmo, weatherHint, heatSlowdownPct } from '../js/weather.js';

test('wmo: WMO codes -> emoji + label', () => {
  assert.equal(wmo(0).label, 'klar');
  assert.equal(wmo(2).label, 'heiter');
  assert.equal(wmo(3).label, 'bewölkt');
  assert.equal(wmo(45).label, 'Nebel');
  assert.equal(wmo(63).label, 'Regen');
  assert.equal(wmo(75).label, 'Schnee');
  assert.equal(wmo(81).label, 'Schauer');
  assert.equal(wmo(95).label, 'Gewitter');
  assert.equal(wmo(99).label, 'Gewitter');
  assert.ok(wmo(0).emoji); // emoji present
});

test('weatherHint: only for runs, not for strength/rest', () => {
  assert.equal(weatherHint({ type: 'strength' }, { code: 96 }), null);
  assert.equal(weatherHint({ type: 'rest' }, { code: 96 }), null);
  assert.equal(weatherHint({ type: 'easy' }, null), null);
});

test('weatherHint: warnings by priority', () => {
  assert.equal(weatherHint({ type: 'easy' }, { code: 96 }).tone, 'warn'); // thunderstorm
  assert.match(weatherHint({ type: 'long' }, { code: 96 }).text, /Gewitter/);
  assert.equal(weatherHint({ type: 'easy' }, { code: 73 }).tone, 'warn'); // snow
  assert.equal(weatherHint({ type: 'easy' }, { code: 1, wind: 50 }).tone, 'warn'); // storm
  assert.match(weatherHint({ type: 'easy' }, { code: 0, tMax: 30 }).text, /Heiß/); // heat
});

test('weatherHint: neutral and good hints', () => {
  assert.equal(weatherHint({ type: 'easy' }, { code: 63, tMax: 15 }).tone, 'neutral'); // rain
  assert.match(weatherHint({ type: 'easy' }, { code: 0, tMax: -2 }).text, /Frostig/);
  assert.equal(weatherHint({ type: 'easy' }, { code: 1, tMax: 15 }).tone, 'good'); // perfect running weather
  assert.equal(weatherHint({ type: 'easy' }, { code: 3, tMax: 15 }), null); // unremarkable -> no hint
});

test('UI-40: place search returns up to five results with region and country', async () => {
  const { geocode, placeLabel } = await import('../js/weather.js');
  const real = globalThis.fetch;
  let url = '';
  globalThis.fetch = async (u) => { url = String(u); return { ok: true, json: async () => ({ results: [
    { name: 'Frankfurt am Main', admin1: 'Hessen', country_code: 'DE', latitude: 50.1, longitude: 8.7 },
    { name: 'Frankfurt (Oder)', admin1: 'Brandenburg', country_code: 'DE', latitude: 52.3, longitude: 14.5 },
  ] }) }; };
  try {
    const list = await geocode('Frankfurt');
    assert.match(url, /count=5/);
    assert.equal(list.length, 2, 'no silent adoption of the first result');
    assert.equal(placeLabel(list[1]), 'Frankfurt (Oder), Brandenburg, DE');
  } finally { globalThis.fetch = real; }
});

test('TRAIN-49: heat with a concrete pace correction instead of just "go slower"', () => {
  assert.equal(heatSlowdownPct(18), 0);
  assert.equal(heatSlowdownPct(25), 4);
  assert.equal(heatSlowdownPct(30), 6);
  assert.equal(heatSlowdownPct(40), 8, 'capped');
  const run = { type: 'easy' };
  assert.match(weatherHint(run, { code: 1, tMax: 30, wind: 10 }).text, /Heiß \(30 °C\).*rund 6 % langsamer/);
  const warm = weatherHint(run, { code: 1, tMax: 25, wind: 10 });
  assert.equal(warm.tone, 'neutral');
  assert.match(warm.text, /Warm \(25 °C\).*rund 4 % langsamer/);
  assert.match(weatherHint(run, { code: 1, tMax: 20, wind: 10 }).text, /Perfektes Laufwetter/);
});
