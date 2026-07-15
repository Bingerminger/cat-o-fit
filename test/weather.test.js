/* Unit-Tests für das Wetter-Mapping und die Lauf-Hinweise (js/weather.js).
   Reine Funktionen wmo()/weatherHint(); kein Netz, kein Store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wmo, weatherHint } from '../js/weather.js';

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
