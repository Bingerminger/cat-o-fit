/* Tests für js/sollist.js (Soll-Ist-Vergleich) und die Formschätzung aus harten
   Läufen (js/vdot.js estimateVdot) – TRAIN-22, TRAIN-15, FE-22. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareToPlan, isStructured, splitBarPct } from '../js/sollist.js';
import { estimateVdot, vdotFromPerf } from '../js/vdot.js';
import { addDays } from '../js/ui.js';

const Z = [
  { zone: 1, min: 95, max: 114 }, { zone: 2, min: 114, max: 133 }, { zone: 3, min: 133, max: 152 },
  { zone: 4, min: 152, max: 171 }, { zone: 5, min: 171, max: 190 },
];

test('TRAIN-22: zu schneller lockerer Lauf gilt NICHT als „erreicht“ und wird benannt', () => {
  const unit = { type: 'easy', targetDistanceKm: 10, targetPaceSecPerKm: 294, targetPaceMaxSecPerKm: 314, targetHrZone: 2 };
  const ex = { distanceKm: 10, paceSecPerKm: 260, avgHr: 160 };   // 4:20 statt 4:54–5:14
  const r = compareToPlan(unit, ex, { hrZones: Z });
  assert.equal(r.tooFast, true);
  assert.equal(r.hit, false);
  assert.equal(r.rows.find((x) => x.key === 'pace').verdict, 'zu schnell');
  assert.match(r.note, /Zu schnell für eine lockere Einheit/);
  // Im Zielbereich: erreicht.
  const ok = compareToPlan(unit, { distanceKm: 10.1, paceSecPerKm: 300, avgHr: 128 }, { hrZones: Z });
  assert.equal(ok.hit, true);
  // Langsamer als geplant ist beim lockeren Lauf kein Drama, wird aber benannt.
  assert.equal(compareToPlan(unit, { distanceKm: 10, paceSecPerKm: 360 }, { hrZones: Z }).rows.find((x) => x.key === 'pace').verdict, 'langsamer als geplant');
});

test('TRAIN-22: sauber gelaufene Intervalle werden nicht über den Gesamtschnitt abgestraft', () => {
  // 6×800 m perfekt, mit Ein-/Auslaufen und Trabpausen: Ø 5:08 min/km, Ø-HF 150.
  const unit = { type: 'interval', title: 'VO2max-Intervalle 6×800 m', targetDistanceKm: 9, targetPaceSecPerKm: 251, targetPaceMaxSecPerKm: 261, targetHrZone: 5 };
  const r = compareToPlan(unit, { distanceKm: 10.8, paceSecPerKm: 308, avgHr: 150 }, { hrZones: Z });
  assert.equal(r.structured, true);
  assert.ok(!r.rows.some((x) => x.key === 'pace' || x.key === 'hr'), 'kein Pace-/HF-Urteil über den Schnitt');
  assert.equal(r.hit, true, 'Distanz erfüllt → erreicht, keine „Abweichung“');
  assert.match(r.note, /Belastungsabschnitte/);
  assert.equal(isStructured({ type: 'long', raceBlockKm: 6 }), true, 'Long Run mit Renntempo-Block');
  assert.equal(isStructured({ type: 'easy' }), false);
});

test('TRAIN-22: Wettkampf einseitig – schneller ist gut; Dauer bei zeitbasierten Einheiten', () => {
  const race = { type: 'race', targetDistanceKm: 21.1, targetPaceSecPerKm: 320, targetPaceMaxSecPerKm: 334 };
  assert.equal(compareToPlan(race, { distanceKm: 21.1, paceSecPerKm: 300 }).hit, true);
  assert.equal(compareToPlan(race, { distanceKm: 21.1, paceSecPerKm: 360 }).hit, false);
  const timed = { type: 'strength', targetDurationMin: 40 };
  assert.equal(compareToPlan(timed, { durationSec: 38 * 60 }).rows[0].key, 'duration');
  assert.equal(compareToPlan(timed, { durationSec: 38 * 60 }).hit, true);
});

test('FE-22: Splits-Balken auf fester Skala (±30 s um den Median)', () => {
  const splits = [{ km: 1, sec: 300 }, { km: 2, sec: 301 }, { km: 3, sec: 330 }];
  const a = splitBarPct(300, splits), b = splitBarPct(301, splits), c = splitBarPct(330, splits);
  assert.ok(Math.abs(a - b) <= 2, `5:00 und 5:01 sehen fast gleich aus (${a} / ${b})`);
  assert.ok(c < b - 40, 'ein 29 s langsamerer Kilometer ist deutlich kürzer');
  assert.ok(c >= 6 && a <= 100);
});

test('TRAIN-15: Formschätzung nur aus harten Läufen; lockere Läufe höchstens Untergrenze', () => {
  const T = '2026-06-28';
  // Sechs Wochen nur locker (VDOT-50-Läuferin in ihrer Easy-Pace): früher ~VDOT 42 als „Form“.
  const easy = [];
  for (let w = 0; w < 6; w++) {
    easy.push({ date: addDays(T, -w * 7 - 1), type: 'easy', distanceKm: 10, durationSec: 10 * 305 });
    easy.push({ date: addDays(T, -w * 7 - 4), type: 'long', distanceKm: 18, durationSec: 18 * 315 });
  }
  const onlyEasy = estimateVdot(easy, T);
  assert.equal(onlyEasy.onlyEasy, true, 'als Schätzung aus lockeren Läufen gekennzeichnet');
  // Ein Tempolauf trägt die Form; die lockeren Läufe ziehen sie nicht herunter.
  const withTempo = [...easy, { date: addDays(T, -2), type: 'tempo', distanceKm: 8, durationSec: 8 * 255 }];
  const est = estimateVdot(withTempo, T);
  assert.equal(est.onlyEasy, false);
  assert.equal(est.hardCount, 1);
  assert.ok(Math.abs(est.vdot - vdotFromPerf(8000, 8 * 255)) < 0.2, `Form aus dem Tempolauf, war ${est.vdot}`);
  // Harte Läufe auch über RPE ≥ 7 oder die Herzfrequenz ab Zone 4 erkannt.
  const byRpe = estimateVdot([{ date: addDays(T, -1), type: 'run', distanceKm: 5, durationSec: 1350, rpe: 8 }], T);
  assert.equal(byRpe.onlyEasy, false);
  const byHr = estimateVdot([{ date: addDays(T, -1), type: 'easy', distanceKm: 6, durationSec: 1700, avgHr: 165 }], T, 42, { hrZones: Z });
  assert.equal(byHr.onlyEasy, false);
  assert.equal(estimateVdot([{ date: addDays(T, -1), type: 'easy', distanceKm: 6, durationSec: 1700, avgHr: 165 }], T).onlyEasy, true, 'ohne Zonen zählt die HF nicht');
});
