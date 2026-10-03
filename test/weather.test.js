/* Unit-Tests für das Wetter-Mapping und die Lauf-Hinweise (js/weather.js).
   Reine Funktionen wmo()/weatherHint(); kein Netz, kein Store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmo, weatherHint, heatSlowdownPct } from '../js/weather.js';

test('wmo: WMO-Codes -> Emoji + Label', () => {
  assert.equal(wmo(0).label, 'klar');
  assert.equal(wmo(2).label, 'heiter');
  assert.equal(wmo(3).label, 'bewölkt');
  assert.equal(wmo(45).label, 'Nebel');
  assert.equal(wmo(63).label, 'Regen');
  assert.equal(wmo(75).label, 'Schnee');
  assert.equal(wmo(81).label, 'Schauer');
  assert.equal(wmo(95).label, 'Gewitter');
  assert.equal(wmo(99).label, 'Gewitter');
  assert.ok(wmo(0).emoji); // Emoji vorhanden
});

test('weatherHint: nur für Läufe, nicht für Kraft/Ruhe', () => {
  assert.equal(weatherHint({ type: 'strength' }, { code: 96 }), null);
  assert.equal(weatherHint({ type: 'rest' }, { code: 96 }), null);
  assert.equal(weatherHint({ type: 'easy' }, null), null);
});

test('weatherHint: Warnungen nach Priorität', () => {
  assert.equal(weatherHint({ type: 'easy' }, { code: 96 }).tone, 'warn'); // Gewitter
  assert.match(weatherHint({ type: 'long' }, { code: 96 }).text, /Gewitter/);
  assert.equal(weatherHint({ type: 'easy' }, { code: 73 }).tone, 'warn'); // Schnee
  assert.equal(weatherHint({ type: 'easy' }, { code: 1, wind: 50 }).tone, 'warn'); // Sturm
  assert.match(weatherHint({ type: 'easy' }, { code: 0, tMax: 30 }).text, /Heiß/); // Hitze
});

test('weatherHint: neutrale und gute Hinweise', () => {
  assert.equal(weatherHint({ type: 'easy' }, { code: 63, tMax: 15 }).tone, 'neutral'); // Regen
  assert.match(weatherHint({ type: 'easy' }, { code: 0, tMax: -2 }).text, /Frostig/);
  assert.equal(weatherHint({ type: 'easy' }, { code: 1, tMax: 15 }).tone, 'good'); // perfektes Laufwetter
  assert.equal(weatherHint({ type: 'easy' }, { code: 3, tMax: 15 }), null); // unauffällig -> kein Hinweis
});

test('UI-40: Ortssuche liefert bis zu fünf Treffer mit Region und Land', async () => {
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
    assert.equal(list.length, 2, 'keine stille Übernahme des ersten Treffers');
    assert.equal(placeLabel(list[1]), 'Frankfurt (Oder), Brandenburg, DE');
  } finally { globalThis.fetch = real; }
});

test('TRAIN-49: Wärme mit konkreter Pace-Korrektur statt nur „langsamer angehen“', () => {
  assert.equal(heatSlowdownPct(18), 0);
  assert.equal(heatSlowdownPct(25), 4);
  assert.equal(heatSlowdownPct(30), 6);
  assert.equal(heatSlowdownPct(40), 8, 'gedeckelt');
  const run = { type: 'easy' };
  assert.match(weatherHint(run, { code: 1, tMax: 30, wind: 10 }).text, /Heiß \(30 °C\).*rund 6 % langsamer/);
  const warm = weatherHint(run, { code: 1, tMax: 25, wind: 10 });
  assert.equal(warm.tone, 'neutral');
  assert.match(warm.text, /Warm \(25 °C\).*rund 4 % langsamer/);
  assert.match(weatherHint(run, { code: 1, tMax: 20, wind: 10 }).text, /Perfektes Laufwetter/);
});
