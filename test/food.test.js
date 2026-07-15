/* Unit-Tests für die Mengen-Engine der Einkaufsliste (js/food.js, rein). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseIngredient, guessCategory, aggregateNeeds, itemKey,
  computeShoppingList, applyPurchase, applyConsumption, nextShoppingDay, fmtAmount,
} from '../js/food.js';

test('parseAmount: Ganzzahl, Dezimal (Komma/Punkt), Brüche', () => {
  assert.equal(parseAmount('250'), 250);
  assert.equal(parseAmount('1,5'), 1.5);
  assert.equal(parseAmount('1.5'), 1.5);
  assert.equal(parseAmount('1/2'), 0.5);
  assert.equal(parseAmount('1 1/2'), 1.5);
  assert.equal(parseAmount('3/4'), 0.75);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(null), null);
});

test('parseIngredient: Menge + Einheit + Name', () => {
  assert.deepEqual(parseIngredient('250 g Skyr'), { name: 'Skyr', amount: 250, unit: 'g', raw: '250 g Skyr' });
  assert.deepEqual(parseIngredient('1 TL Honig'), { name: 'Honig', amount: 1, unit: 'TL', raw: '1 TL Honig' });
  assert.deepEqual(parseIngredient('100 g Beeren'), { name: 'Beeren', amount: 100, unit: 'g', raw: '100 g Beeren' });
});

test('parseIngredient: Stück-Zutaten ohne Einheitenwort', () => {
  const eier = parseIngredient('3 Eier');
  assert.equal(eier.name, 'Eier');
  assert.equal(eier.amount, 3);
  assert.equal(eier.unit, 'Stück');

  const avo = parseIngredient('1/2 Avocado');
  assert.equal(avo.name, 'Avocado');
  assert.equal(avo.amount, 0.5);
  assert.equal(avo.unit, 'Stück');

  // ß im Namen darf den Token-Match nicht abschneiden ("Sü ßkartoffel"-Bug)
  const suka = parseIngredient('1 Süßkartoffel');
  assert.equal(suka.name, 'Süßkartoffel');
  assert.equal(suka.amount, 1);
  assert.equal(suka.unit, 'Stück');
});

test('parseIngredient: kg/l werden auf g/ml normalisiert', () => {
  const mehl = parseIngredient('1 kg Mehl');
  assert.equal(mehl.unit, 'g');
  assert.equal(mehl.amount, 1000);

  const milch = parseIngredient('0,5 l Milch');
  assert.equal(milch.unit, 'ml');
  assert.equal(milch.amount, 500);
});

test('parseIngredient: Zutat ganz ohne Menge', () => {
  const spinat = parseIngredient('Spinat');
  assert.equal(spinat.name, 'Spinat');
  assert.equal(spinat.amount, null);
  assert.equal(spinat.unit, null);
});

test('guessCategory: Schlüsselwörter -> Kategorie, sonst Sonstiges', () => {
  assert.equal(guessCategory('Skyr'), 'Milchprodukte');
  assert.equal(guessCategory('Hähnchenbrust'), 'Fleisch & Fisch');
  assert.equal(guessCategory('Lachsfilet'), 'Fleisch & Fisch');
  assert.equal(guessCategory('Haferflocken'), 'Trockenwaren');
  assert.equal(guessCategory('Beeren'), 'Obst & Gemüse');
  assert.equal(guessCategory('Süßkartoffel'), 'Obst & Gemüse');
  assert.equal(guessCategory('Olivenöl'), 'Sonstiges');
});

test('aggregateNeeds: gleiche Zutat über Gerichte × Portionen summieren', () => {
  const needs = aggregateNeeds([
    { ingredients: ['50 g Haferflocken', '250 g Skyr'], servings: 2 },
    { ingredients: ['30 g Haferflocken'], servings: 1 },
  ]);
  const hafer = needs.find((n) => n.name === 'Haferflocken');
  assert.equal(hafer.amount, 130); // 50*2 + 30*1
  assert.equal(hafer.unit, 'g');
  assert.equal(hafer.hasAmount, true);
  const skyr = needs.find((n) => n.name === 'Skyr');
  assert.equal(skyr.amount, 500); // 250*2
});

test('aggregateNeeds: mengenlose Zutat behält hasAmount=false', () => {
  const needs = aggregateNeeds([{ ingredients: ['Spinat'], servings: 3 }]);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].name, 'Spinat');
  assert.equal(needs[0].hasAmount, false);
});

test('itemKey: deterministisch, ß wird zu Trenner', () => {
  assert.equal(itemKey('Skyr', 'g'), 'pty-skyr-g');
  assert.equal(itemKey('Hähnchenbrust', 'g'), 'pty-hähnchenbrust-g');
  assert.equal(itemKey('Süßkartoffel', 'g'), 'pty-sü-kartoffel-g');
});

test('computeShoppingList: Bedarf minus Lager, nur Positives', () => {
  const needs = [{ name: 'Skyr', unit: 'g', amount: 500, hasAmount: true, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, [{ name: 'Skyr', unit: 'g', amount: 300 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].buy, 200); // 500 - 300
  assert.equal(list[0].have, 300);
  assert.equal(list[0].need, 500);
});

test('computeShoppingList: voll auf Lager -> nicht in Liste', () => {
  const needs = [{ name: 'Skyr', unit: 'g', amount: 300, hasAmount: true, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, [{ name: 'Skyr', unit: 'g', amount: 500 }]);
  assert.equal(list.length, 0);
});

test('computeShoppingList: „nach Bedarf" nur ohne Lagereintrag', () => {
  const needs = [{ name: 'Spinat', unit: null, amount: 0, hasAmount: false, category: 'Obst & Gemüse' }];
  assert.equal(computeShoppingList(needs, []).length, 1);
  assert.equal(computeShoppingList(needs, []) [0].buy, null);
  assert.equal(computeShoppingList(needs, [{ name: 'Spinat', unit: null, amount: 0 }]).length, 0);
});

test('applyPurchase: neuer Eintrag bekommt itemKey-ID, bestehender wird erhöht', () => {
  const p1 = applyPurchase([], [{ name: 'Skyr', unit: 'g', buy: 200, category: 'Milchprodukte' }]);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].id, 'pty-skyr-g');
  assert.equal(p1[0].amount, 200);

  const p2 = applyPurchase([{ name: 'Skyr', unit: 'g', amount: 200 }], [{ name: 'Skyr', unit: 'g', buy: 300 }]);
  assert.equal(p2.length, 1);
  assert.equal(p2[0].amount, 500);
});

test('applyPurchase: „nach Bedarf" (buy=null) wird nicht gebucht', () => {
  const p = applyPurchase([], [{ name: 'Spinat', unit: null, buy: null }]);
  assert.equal(p.length, 0);
});

test('applyConsumption: Verbrauch × Portionen, nie unter 0, leeres raus', () => {
  const p = applyConsumption([{ name: 'Skyr', unit: 'g', amount: 750 }], ['250 g Skyr'], 2);
  assert.equal(p[0].amount, 250); // 750 - 250*2

  const leer = applyConsumption([{ name: 'Skyr', unit: 'g', amount: 100 }], ['250 g Skyr'], 1);
  assert.equal(leer.length, 0); // 100-250 -> 0 -> herausgefiltert
});

test('nextShoppingDay: nächster Dienstag (2) ab Sonntag', () => {
  assert.equal(nextShoppingDay(2, '2026-06-28'), '2026-06-30'); // So 28.6 -> Di 30.6
  assert.equal(nextShoppingDay(2, '2026-06-30'), '2026-06-30'); // schon Dienstag -> selber Tag
  assert.equal(nextShoppingDay(0, '2026-06-29'), '2026-07-05'); // Mo -> nächster So
});

test('fmtAmount: Einheiten, Stück als ×, null als „nach Bedarf"', () => {
  assert.equal(fmtAmount(500, 'g'), '500 g');
  assert.equal(fmtAmount(3, 'Stück'), '3×');
  assert.equal(fmtAmount(null, 'g'), 'nach Bedarf');
  assert.equal(fmtAmount(1.5, 'TL'), '1.5 TL');
});
