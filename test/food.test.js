/* Unit tests for the quantity engine of the shopping list (js/food.js, pure). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseIngredient, guessCategory, aggregateNeeds, itemKey,
  computeShoppingList, applyPurchase, applyConsumption, nextShoppingDay, fmtAmount,
} from '../js/food.js';

test('parseAmount: integer, decimal (comma/point), fractions', () => {
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

test('parseIngredient: amount + unit + name', () => {
  assert.deepEqual(parseIngredient('250 g Skyr'), { name: 'Skyr', amount: 250, unit: 'g', raw: '250 g Skyr' });
  assert.deepEqual(parseIngredient('1 TL Honig'), { name: 'Honig', amount: 1, unit: 'TL', raw: '1 TL Honig' });
  assert.deepEqual(parseIngredient('100 g Beeren'), { name: 'Beeren', amount: 100, unit: 'g', raw: '100 g Beeren' });
});

test('parseIngredient: piece ingredients without a unit word', () => {
  const eier = parseIngredient('3 Eier');
  assert.equal(eier.name, 'Eier');
  assert.equal(eier.amount, 3);
  assert.equal(eier.unit, 'Stück');

  const avo = parseIngredient('1/2 Avocado');
  assert.equal(avo.name, 'Avocado');
  assert.equal(avo.amount, 0.5);
  assert.equal(avo.unit, 'Stück');

  // ß in the name must not cut off the token match ("Sü ßkartoffel" bug)
  const suka = parseIngredient('1 Süßkartoffel');
  assert.equal(suka.name, 'Süßkartoffel');
  assert.equal(suka.amount, 1);
  assert.equal(suka.unit, 'Stück');
});

test('parseIngredient: kg/l are normalised to g/ml', () => {
  const mehl = parseIngredient('1 kg Mehl');
  assert.equal(mehl.unit, 'g');
  assert.equal(mehl.amount, 1000);

  const milch = parseIngredient('0,5 l Milch');
  assert.equal(milch.unit, 'ml');
  assert.equal(milch.amount, 500);
});

test('parseIngredient: ingredient without any amount', () => {
  const spinat = parseIngredient('Spinat');
  assert.equal(spinat.name, 'Spinat');
  assert.equal(spinat.amount, null);
  assert.equal(spinat.unit, null);
});

test('guessCategory: keywords -> category, otherwise "Sonstiges"', () => {
  assert.equal(guessCategory('Skyr'), 'Milchprodukte');
  assert.equal(guessCategory('Hähnchenbrust'), 'Fleisch & Fisch');
  assert.equal(guessCategory('Lachsfilet'), 'Fleisch & Fisch');
  assert.equal(guessCategory('Haferflocken'), 'Trockenwaren');
  assert.equal(guessCategory('Beeren'), 'Obst & Gemüse');
  assert.equal(guessCategory('Süßkartoffel'), 'Obst & Gemüse');
  assert.equal(guessCategory('Olivenöl'), 'Sonstiges');
});

test('aggregateNeeds: sum the same ingredient across dishes × servings', () => {
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

test('aggregateNeeds: ingredient without amount keeps hasAmount=false', () => {
  const needs = aggregateNeeds([{ ingredients: ['Spinat'], servings: 3 }]);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].name, 'Spinat');
  assert.equal(needs[0].hasAmount, false);
});

test('itemKey: deterministic, ß becomes a separator', () => {
  assert.equal(itemKey('Skyr', 'g'), 'pty-skyr-g');
  assert.equal(itemKey('Hähnchenbrust', 'g'), 'pty-hähnchenbrust-g');
  assert.equal(itemKey('Süßkartoffel', 'g'), 'pty-sü-kartoffel-g');
});

test('computeShoppingList: need minus pantry, positives only', () => {
  const needs = [{ name: 'Skyr', unit: 'g', amount: 500, hasAmount: true, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, [{ name: 'Skyr', unit: 'g', amount: 300 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].buy, 200); // 500 - 300
  assert.equal(list[0].have, 300);
  assert.equal(list[0].need, 500);
});

test('computeShoppingList: fully in stock -> not in list', () => {
  const needs = [{ name: 'Skyr', unit: 'g', amount: 300, hasAmount: true, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, [{ name: 'Skyr', unit: 'g', amount: 500 }]);
  assert.equal(list.length, 0);
});

test('computeShoppingList: "as needed" only without a pantry entry', () => {
  const needs = [{ name: 'Spinat', unit: null, amount: 0, hasAmount: false, category: 'Obst & Gemüse' }];
  assert.equal(computeShoppingList(needs, []).length, 1);
  assert.equal(computeShoppingList(needs, []) [0].buy, null);
  assert.equal(computeShoppingList(needs, [{ name: 'Spinat', unit: null, amount: 0 }]).length, 0);
});

test('applyPurchase: a new entry gets an itemKey ID, an existing one is increased', () => {
  const p1 = applyPurchase([], [{ name: 'Skyr', unit: 'g', buy: 200, category: 'Milchprodukte' }]);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].id, 'pty-skyr-g');
  assert.equal(p1[0].amount, 200);

  const p2 = applyPurchase([{ name: 'Skyr', unit: 'g', amount: 200 }], [{ name: 'Skyr', unit: 'g', buy: 300 }]);
  assert.equal(p2.length, 1);
  assert.equal(p2[0].amount, 500);
});

test('applyPurchase: "as needed" (buy=null) is not booked', () => {
  const p = applyPurchase([], [{ name: 'Spinat', unit: null, buy: null }]);
  assert.equal(p.length, 0);
});

test('applyConsumption: consumption × servings, never below 0, empty ones removed', () => {
  const p = applyConsumption([{ name: 'Skyr', unit: 'g', amount: 750 }], ['250 g Skyr'], 2);
  assert.equal(p[0].amount, 250); // 750 - 250*2

  const leer = applyConsumption([{ name: 'Skyr', unit: 'g', amount: 100 }], ['250 g Skyr'], 1);
  assert.equal(leer.length, 0); // 100-250 -> 0 -> filtered out
});

test('nextShoppingDay: next Tuesday (2) from Sunday', () => {
  assert.equal(nextShoppingDay(2, '2026-06-28'), '2026-06-30'); // Sun 28.6 -> Tue 30.6
  assert.equal(nextShoppingDay(2, '2026-06-30'), '2026-06-30'); // already Tuesday -> same day
  assert.equal(nextShoppingDay(0, '2026-06-29'), '2026-07-05'); // Mon -> next Sun
});

test('fmtAmount: units, piece as ×, null as "nach Bedarf"', () => {
  assert.equal(fmtAmount(500, 'g'), '500 g');
  assert.equal(fmtAmount(3, 'Stück'), '3×');
  assert.equal(fmtAmount(null, 'g'), 'nach Bedarf');
  assert.equal(fmtAmount(1.5, 'TL'), '1,5 TL');   // decimal comma in German
});
