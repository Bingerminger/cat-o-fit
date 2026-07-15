/* Unit-Tests für js/energy.js — Grundumsatz, Trainingsverbrauch, Tagesbilanz
   und kcal-Schätzung. today wird übergeben -> datumsunabhängig. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bmr, trainingKcal, energyBalance, estimateKcal, estimateNutrition, portionKcal } from '../js/energy.js';

const T = '2026-06-28';
const P = { weightKg: 68, heightCm: 170, birthYear: 1990 }; // age 36

test('bmr: Mifflin-St-Jeor inkl. Geschlechts-Offset', () => {
  // neutral: 10*68 + 6.25*170 - 5*36 - 78 = 1484.5 -> 1485 (wenn aufgerundet)
  assert.equal(bmr(P, T), 1485);
  assert.equal(bmr({ ...P, sex: 'm' }, T), 1568);   // -78 -> +5  (= +83)
  assert.equal(bmr({ ...P, sex: 'w' }, T), 1402);   // -78 -> -161 (= -83)
});

test('bmr: null, wenn Angaben fehlen', () => {
  assert.equal(bmr({ weightKg: 68, heightCm: 170 }, T), null); // birthYear fehlt
  assert.equal(bmr({}, T), null);
});

test('trainingKcal: Dauer per MET, sonst km, sonst 0', () => {
  assert.equal(trainingKcal({ type: 'easy', durationSec: 3600 }, 70), 630); // 9*70*1h
  assert.equal(trainingKcal({ type: 'easy', distanceKm: 10 }, 68), 680);    // ~1 kcal/kg/km
  assert.equal(trainingKcal({ type: 'strength' }, 70), 0);                  // ohne Dauer/Distanz
});

test('energyBalance: null ohne Profilbasis', () => {
  assert.equal(energyBalance({ profile: {}, today: T }), null);
});

test('energyBalance: Bilanz + Empfehlung Richtung Zielgewicht', () => {
  const profile = { ...P, targetWeightKg: 65 }; // 3 kg über Ziel -> abnehmen
  const sessions = [{ date: T, type: 'easy', distanceKm: 10 }]; // 680 kcal
  const r = energyBalance({ profile, sessions, diary: [], today: T });
  assert.equal(r.bmr, 1485);
  assert.equal(r.trainingOut, 680);
  assert.equal(r.tdeeBase, 2005);       // round(1485 * 1.35)
  assert.equal(r.out, 2685);            // 2005 + 680
  assert.equal(r.goal, 'abnehmen');
  assert.equal(r.delta, -400);
  assert.equal(r.status, 'unklar'); // keine Mahlzeit erfasst
  assert.equal(r.hasIntake, false);
});

test('energyBalance: Status passt/hoch je nach Einnahme', () => {
  const profile = { ...P, targetWeightKg: 68 }; // halten
  const diary = [{ kcal: 0, date: T }]; // ohne kcal zählt nicht
  const base = energyBalance({ profile, sessions: [], diary, today: T });
  assert.equal(base.goal, 'halten');
  assert.equal(base.hasIntake, false);

  // Einnahme nahe Zielkorridor -> passt
  const near = energyBalance({ profile, sessions: [], diary: [{ kcal: base.targetIntake, date: T }], today: T });
  assert.equal(near.status, 'passt');
  // deutlich darüber -> hoch
  const over = energyBalance({ profile, sessions: [], diary: [{ kcal: base.targetIntake + 600, date: T }], today: T });
  assert.equal(over.status, 'hoch');
});

test('estimateKcal: aus Zutaten grob geschätzt', () => {
  assert.equal(estimateKcal(['100 g Haferflocken']), 370); // kuratiert: 370/100 g
  assert.equal(estimateKcal(['2 Eier']), 150);             // 2*75 Stück
  assert.equal(estimateKcal([]), null);
  assert.ok(estimateKcal(['Spinat']) > 0);                 // ohne Menge -> Pauschale
});

test('estimateNutrition: kuratierte Tabelle liefert genaue kcal + Protein', () => {
  const r = estimateNutrition(['100 g Haferflocken']);
  assert.equal(r.kcal, 370);
  assert.equal(r.protein, 13);
});

test('estimateNutrition: mehrere kuratierte Zutaten summiert', () => {
  const r = estimateNutrition(['150 g Hähnchen', '80 g Reis']);
  assert.equal(r.kcal, 450);     // 1.10*150 + 3.50*80 = 445 -> auf 10 gerundet
  assert.equal(r.protein, 40);   // 0.23*150 + 0.07*80 = 40.1
});

test('estimateNutrition: Stück-Zutaten zählen kcal + Protein', () => {
  const r = estimateNutrition(['2 Eier']);
  assert.equal(r.kcal, 150);
  assert.equal(r.protein, 14);   // 7 * 2
});

test('estimateNutrition: kuratierte Tabelle hat Vorrang vor Open Food Facts', () => {
  const r = estimateNutrition(['100 g Haferflocken'], () => ({ kcal100: 999, protein100: 99 }));
  assert.equal(r.kcal, 370);     // kuratiert gewinnt -> OFF ignoriert
  assert.equal(r.protein, 13);
});

test('estimateNutrition: für unbekannte Zutat zählt Open Food Facts (plausibel)', () => {
  // „Wunderzeug“ steht in keiner Tabelle -> Heuristik-Fallback 1.2/g; OFF 2.0/g ist plausibel.
  const r = estimateNutrition(['100 g Wunderzeug'], () => ({ kcal100: 200, protein100: 12 }));
  assert.equal(r.kcal, 200);
  assert.equal(r.protein, 12);
});

test('estimateNutrition: unplausibler OFF-Wert wird verworfen (Sanity-Gate)', () => {
  // OFF 0.4/g vs. Heuristik-Fallback 1.2/g -> Faktor 0.33 -> verworfen, Heuristik gewinnt.
  const r = estimateNutrition(['100 g Wunderzeug'], () => ({ kcal100: 40, protein100: 3 }));
  assert.equal(r.kcal, 120);
});

test('estimateNutrition: leere Liste -> null', () => {
  assert.equal(estimateNutrition([]), null);
  assert.equal(estimateNutrition(), null);
});

test('portionKcal: pauschale Größen', () => {
  assert.equal(portionKcal('klein'), 350);
  assert.equal(portionKcal('restaurant'), 1000);
  assert.equal(portionKcal('unbekannt'), 550); // Default mittel
});
