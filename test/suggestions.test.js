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

test('predictRace: nutzt die geglättete Form (VDOT), nicht den schnellsten Einzellauf', () => {
  const date = addDays(todayStr(), -5);
  const res = predictRace([{ date, distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10);
  assert.ok(res);
  assert.equal(res.method, 'form');
  // 5 km in 20:00 => VDOT ~49,8 => 10-km-Äquivalent knapp über 41 min.
  assert.ok(res.seconds > 2400 && res.seconds < 2650, `10-km-Äquivalent plausibel, war ${res.seconds}`);
  assert.match(res.basis, /VDOT/);
});

test('predictRace: ein schneller Kurzlauf ohne Marathon-Umfang ergibt eine Prognose MIT Vorbehalt', () => {
  const t = todayStr();
  // Drei lange, lockere Läufe + ein sehr schneller 5er – Ø nur ~22 km pro Woche.
  const sessions = [
    { date: addDays(t, -21), distanceKm: 30, durationSec: 10800, type: 'long' },
    { date: addDays(t, -14), distanceKm: 25, durationSec: 9000, type: 'long' },
    { date: addDays(t, -7), distanceKm: 28, durationSec: 10080, type: 'long' },
    { date: addDays(t, -2), distanceKm: 5, durationSec: 1080, type: 'tempo' }, // 3:36/km
  ];
  const res = predictRace(sessions, 42.195, { today: t });
  assert.ok(res);
  assert.equal(res.method, 'form');
  assert.equal(res.onlyEasy, false, 'die Form stammt aus dem harten Lauf');
  // Die Äquivalenzzeit gilt nur mit passendem Umfang – das sagt die Prognose jetzt dazu.
  assert.equal(res.caveat, 'volume');
  assert.match(res.note, /ausreichender Vorbereitung/);
});

test('predictRace: mit Marathon-Umfang (≥ 50 km/Woche, Long Run ≥ 25 km) kein Vorbehalt', () => {
  const t = todayStr();
  const sessions = [];
  for (let w = 0; w < 4; w++) {
    sessions.push({ date: addDays(t, -w * 7 - 1), distanceKm: 28, durationSec: 28 * 330, type: 'long' });
    sessions.push({ date: addDays(t, -w * 7 - 3), distanceKm: 14, durationSec: 14 * 300, type: 'tempo' });
    sessions.push({ date: addDays(t, -w * 7 - 5), distanceKm: 12, durationSec: 12 * 340, type: 'easy' });
  }
  const res = predictRace(sessions, 42.195, { today: t });
  assert.equal(res.caveat, null);
  assert.equal(res.note, null);
});

test('predictRace: nur lockere Läufe -> als „eher zu vorsichtig“ gekennzeichnet', () => {
  const t = todayStr();
  const sessions = [1, 8, 15].map((d) => ({ date: addDays(t, -d), distanceKm: 10, durationSec: 3600, type: 'easy' }));
  const res = predictRace(sessions, 10, { today: t });
  assert.equal(res.onlyEasy, true);
  assert.match(res.basis, /lockeren Trainingsläufen/);
});

test('predictRace: keine Basis -> null', () => {
  assert.equal(predictRace([], 10), null);
  assert.equal(predictRace([{ date: todayStr(), distanceKm: 5, durationSec: 1200, type: 'tempo' }], 0), null);
  // zu alt für beide Pfade (VDOT-Fenster 42 Tage, Riegel 50 Tage)
  assert.equal(predictRace([{ date: addDays(todayStr(), -60), distanceKm: 5, durationSec: 1200, type: 'tempo' }], 10), null);
});

test('predictRace: Riegel-Fallback nur bei vertretbarer Extrapolation', () => {
  const t = todayStr();
  // 45 Tage alt: außerhalb des VDOT-Fensters (42 Tage), noch im Riegel-Fenster (50)
  // -> der Fallback-Pfad greift.
  const old = [{ date: addDays(t, -45), distanceKm: 5, durationSec: 1500, type: 'tempo' }];
  // 5 km auf 42,2 km wäre Faktor 8,4 (> Grenze 4): lieber keine Prognose als eine schlechte.
  assert.equal(predictRace(old, 42.195), null);
  // Auf 10 km (Faktor 2) liefert der Fallback dagegen eine Schätzung.
  const near = predictRace(old, 10);
  assert.ok(near && near.method === 'riegel');
});

test('trainingTip: kontextabhängige, freundliche Hinweise', () => {
  assert.match(trainingTip({ todaysUnits: [{ type: 'race' }] }), /Wettkampf/);
  assert.match(trainingTip({ todaysUnits: [{ type: 'long' }] }), /Long Run/);
  assert.match(trainingTip({ todaysUnits: [] }), /Ruhetag/);
  // streak = Wochen-Serie (TRAIN-39) – Ruhetage gehören dazu.
  assert.match(trainingTip({ todaysUnits: [{ type: 'easy' }], streak: 5 }), /5 Wochen in Folge/);
});
