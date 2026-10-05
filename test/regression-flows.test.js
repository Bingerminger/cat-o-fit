/* Regression tests for the most important end-to-end flows (several modules
   working together):
     1) Shopping flow: weekly plan -> needs -> shopping list -> pantry -> cooking
     2) "Penalty-free" on cycle days: protected days do not reduce plan adherence or
        momentum; the cycle badge rewards logging (neutral), not
        training despite a period. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';
import { aggregateNeeds, computeShoppingList, applyPurchase, applyConsumption } from '../js/food.js';
import { isProtectedDay } from '../js/cycle.js';
import { computeStats, momentum, evaluateBadges } from '../js/badges.js';

const T = '2026-06-28';

beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('Shopping flow: plan -> needs -> list -> pantry -> cooking', () => {
  // 1) Weekly meal plan (dishes × servings)
  const meals = [
    { ingredients: ['250 g Skyr', '50 g Haferflocken', '100 g Beeren'], servings: 3 },
    { ingredients: ['200 g Hähnchenbrust', '150 g Quinoa'], servings: 2 },
  ];

  // 2) Aggregate the needs
  const needs = aggregateNeeds(meals);
  const need = (n) => needs.find((x) => x.name === n).amount;
  assert.equal(need('Skyr'), 750);          // 250 × 3
  assert.equal(need('Haferflocken'), 150);  // 50 × 3
  assert.equal(need('Beeren'), 300);        // 100 × 3
  assert.equal(need('Hähnchenbrust'), 400); // 200 × 2
  assert.equal(need('Quinoa'), 300);        // 150 × 2

  // 3) Pantry: 300 g skyr already in stock -> the shopping list subtracts it
  const pantry0 = [{ id: 'pty-skyr-g', name: 'Skyr', unit: 'g', amount: 300, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, pantry0);
  const buy = (n) => list.find((x) => x.name === n);
  assert.equal(buy('Skyr').buy, 450);       // 750 − 300
  assert.equal(buy('Hähnchenbrust').buy, 400);
  assert.ok(!list.some((x) => x.buy <= 0));  // only real shortfalls

  // 4) Purchase -> restock the pantry
  const pantry1 = applyPurchase(pantry0, list);
  const stock = (p, n) => p.find((x) => x.name === n)?.amount ?? 0;
  assert.equal(stock(pantry1, 'Skyr'), 750);        // 300 + 450
  assert.equal(stock(pantry1, 'Hähnchenbrust'), 400);

  // 5) Cook one skyr bowl (1 serving) -> the pantry is debited
  const pantry2 = applyConsumption(pantry1, ['250 g Skyr', '50 g Haferflocken', '100 g Beeren'], 1);
  assert.equal(stock(pantry2, 'Skyr'), 500);        // 750 − 250
  assert.equal(stock(pantry2, 'Haferflocken'), 100); // 150 − 50
  assert.equal(stock(pantry2, 'Beeren'), 200);      // 300 − 100
  // Ingredients not used are left untouched
  assert.equal(stock(pantry2, 'Quinoa'), 300);
});

function enableCycleAround(startDate) {
  // Menstruation (protected) from startDate for 5 days.
  store.replaceArea('cycle', [{ id: 'c1', startDate, periodLength: 5, createdAt: '2026-01-01T00:00:00Z' }]);
  store.setSetting('modules', { cycle: true });
}

test('Penalty-free: a protected day does not reduce plan adherence', () => {
  const missedDay = addDays(T, -1);
  const plans = [{ units: [
    { date: addDays(T, -3), type: 'easy', status: 'erledigt', week: 1 },
    { date: missedDay, type: 'tempo', status: 'geplant', week: 1 }, // open, due (day is over)
    { date: T, type: 'easy', status: 'geplant', week: 1 },          // today: not due yet
  ] }];

  // Module off: yesterday's open unit counts as not met -> 50 %
  assert.equal(computeStats({ plans }, T).adherence, 50);

  // Module on and yesterday was a menstruation day: the open unit is "penalty-free"
  enableCycleAround(addDays(T, -2));
  assert.equal(isProtectedDay(missedDay), true);
  assert.equal(computeStats({ plans }, T).adherence, 100); // only the done one counts as due
});

test('Penalty-free: a missed unit on a protected day does not reduce momentum', () => {
  const missedDay = addDays(T, -1);
  const plans = [{ units: [{ date: missedDay, type: 'easy', status: 'geplant', week: 1 }] }];

  // Module off: counts as missed -> momentum drops below the baseline 42
  assert.equal(momentum({ sessions: [], plans }, T).missed, 1);
  assert.ok(momentum({ sessions: [], plans }, T).score < 42);

  // Module on, missedDay is protected: no miss -> momentum stays at the baseline
  enableCycleAround(addDays(T, -2)); // Menstruation covers T-2..T+2, so also T-1
  assert.equal(isProtectedDay(missedDay), true);
  const m = momentum({ sessions: [], plans }, T);
  assert.equal(m.missed, 0);
  assert.equal(m.score, 42);
});

test('TRAIN-30: cycle badge is neutral – logging counts, not "trained anyway"', () => {
  enableCycleAround(T);
  const data = { sessions: [{ date: T, distanceKm: 6, type: 'easy' }] };
  const ids = evaluateBadges(data, T).map((b) => b.id);
  assert.ok(!ids.includes('hardfighter'), 'no badge for training on period days');
  const cyc = (cycle) => evaluateBadges({ ...data, cycle }, T).find((b) => b.id === 'cycle3');
  assert.equal(cyc([]).unlocked, false);
  const three = ['2026-04-05', '2026-05-03', '2026-05-31'].map((startDate, i) => ({ id: `c${i}`, startDate }));
  assert.equal(cyc(three).unlocked, true);
});
