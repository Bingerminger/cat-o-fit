/* Unit-Tests für Zielpace, Riegel-Prognose und Trainingstipp (js/suggestions.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayStr } from '../js/ui.js';
import { targetPaceSecPerKm, riegel, predictRace, trainingTip } from '../js/suggestions.js';

test('targetPaceSecPerKm: Zielzeit/Distanz -> Sek pro km', () => {
  assert.equal(targetPaceSecPerKm('1:45:00', 21.1), 299); // 6300s / 21,1 km
  assert.equal(targetPaceSecPerKm('0:50:00', 10), 300);
  assert.equal(targetPaceSecPerKm(null, 10), null);
  assert.equal(targetPaceSecPerKm('1:00:00', 0), null);
});

test('riegel: linear bei exp=1, überproportional bei Default-exp', () => {
  assert.equal(riegel(1200, 5, 10, 1), 2400); // doppelte Distanz, exp 1 -> doppelte Zeit
  const def = riegel(1200, 5, 10); // exp 1.06 -> etwas mehr als das Doppelte
  assert.ok(def > 2400 && Math.abs(def - 2501.8) < 1, `Riegel-Default ~2501.8, war ${def}`);
  assert.equal(riegel(0, 5, 10), null);
  assert.equal(riegel(1200, 5, 0), null);
});

test('predictRace: beste Prognose aus jüngeren Läufen', () => {
  const date = addDays(todayStr(), -5);
  const res = predictRace([{ date, distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10);
  assert.ok(res);
  assert.ok(Math.abs(res.seconds - 2501.8) < 1);
  assert.equal(res.basis, '5,0 km in 20:00');
});

test('predictRace: keine Basis -> null', () => {
  assert.equal(predictRace([], 10), null);
  // zu kurz (< 4 km)
  assert.equal(predictRace([{ date: todayStr(), distanceKm: 3, durationSec: 900, type: 'easy' }], 10), null);
  // zu alt (> 50 Tage)
  assert.equal(predictRace([{ date: addDays(todayStr(), -60), distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10), null);
});

test('trainingTip: kontextabhängige, freundliche Hinweise', () => {
  assert.match(trainingTip({ todaysUnits: [{ type: 'race' }] }), /Wettkampf/);
  assert.match(trainingTip({ todaysUnits: [{ type: 'long' }] }), /Long Run/);
  assert.match(trainingTip({ todaysUnits: [] }), /Ruhetag/);
  assert.match(trainingTip({ todaysUnits: [{ type: 'easy' }], streak: 5 }), /5 Tage/);
});
