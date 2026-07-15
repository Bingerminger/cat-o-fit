/* Regressionstests für die wichtigsten durchgängigen Abläufe (mehrere Module
   im Zusammenspiel):
     1) Einkaufs-Flow: Wochenplan -> Bedarf -> Einkaufsliste -> Lager -> Kochen
     2) „Schadfrei" an Zyklustagen: geschützte Tage mindern Plan-Einhaltung und
        Momentum nicht; Training an so einem Tag gibt das „Harte Kämpferin"-Badge. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { addDays } from '../js/ui.js';
import { aggregateNeeds, computeShoppingList, applyPurchase, applyConsumption } from '../js/food.js';
import { isProtectedDay } from '../js/cycle.js';
import { computeStats, momentum } from '../js/badges.js';

const T = '2026-06-28';

beforeEach(() => { store.replaceArea('cycle', []); store.setSetting('modules', {}); });

test('Einkaufs-Flow: Plan -> Bedarf -> Liste -> Lager -> Kochen', () => {
  // 1) Wochen-Speiseplan (Gerichte × Portionen)
  const meals = [
    { ingredients: ['250 g Skyr', '50 g Haferflocken', '100 g Beeren'], servings: 3 },
    { ingredients: ['200 g Hähnchenbrust', '150 g Quinoa'], servings: 2 },
  ];

  // 2) Bedarf aggregieren
  const needs = aggregateNeeds(meals);
  const need = (n) => needs.find((x) => x.name === n).amount;
  assert.equal(need('Skyr'), 750);          // 250 × 3
  assert.equal(need('Haferflocken'), 150);  // 50 × 3
  assert.equal(need('Beeren'), 300);        // 100 × 3
  assert.equal(need('Hähnchenbrust'), 400); // 200 × 2
  assert.equal(need('Quinoa'), 300);        // 150 × 2

  // 3) Lager: 300 g Skyr sind schon da -> Einkaufsliste zieht das ab
  const pantry0 = [{ id: 'pty-skyr-g', name: 'Skyr', unit: 'g', amount: 300, category: 'Milchprodukte' }];
  const list = computeShoppingList(needs, pantry0);
  const buy = (n) => list.find((x) => x.name === n);
  assert.equal(buy('Skyr').buy, 450);       // 750 − 300
  assert.equal(buy('Hähnchenbrust').buy, 400);
  assert.ok(!list.some((x) => x.buy <= 0));  // nur echte Fehlmengen

  // 4) Einkauf -> Lager auffüllen
  const pantry1 = applyPurchase(pantry0, list);
  const stock = (p, n) => p.find((x) => x.name === n)?.amount ?? 0;
  assert.equal(stock(pantry1, 'Skyr'), 750);        // 300 + 450
  assert.equal(stock(pantry1, 'Hähnchenbrust'), 400);

  // 5) Ein Skyr-Bowl kochen (1 Portion) -> Lager wird abgebucht
  const pantry2 = applyConsumption(pantry1, ['250 g Skyr', '50 g Haferflocken', '100 g Beeren'], 1);
  assert.equal(stock(pantry2, 'Skyr'), 500);        // 750 − 250
  assert.equal(stock(pantry2, 'Haferflocken'), 100); // 150 − 50
  assert.equal(stock(pantry2, 'Beeren'), 200);      // 300 − 100
  // Nicht verbrauchte Zutaten bleiben unangetastet
  assert.equal(stock(pantry2, 'Quinoa'), 300);
});

function enableCycleAround(startDate) {
  // Menstruation (geschützt) ab startDate für 5 Tage.
  store.replaceArea('cycle', [{ id: 'c1', startDate, periodLength: 5, createdAt: '2026-01-01T00:00:00Z' }]);
  store.setSetting('modules', { cycle: true });
}

test('Schadfrei: geschützter Tag mindert die Plan-Einhaltung nicht', () => {
  const plans = [{ units: [
    { date: addDays(T, -3), type: 'easy', status: 'erledigt', week: 1 },
    { date: T, type: 'tempo', status: 'geplant', week: 1 }, // offen, fällig
  ] }];

  // Modul aus: die offene Einheit zählt als nicht eingehalten -> 50 %
  assert.equal(computeStats({ plans }, T).adherence, 50);

  // Modul an und T ist ein Menstruationstag: die offene Einheit ist „schadfrei"
  enableCycleAround(T);
  assert.equal(isProtectedDay(T), true);
  assert.equal(computeStats({ plans }, T).adherence, 100); // nur die erledigte zählt als fällig
});

test('Schadfrei: verpasste Einheit an geschütztem Tag zieht Momentum nicht ab', () => {
  const missedDay = addDays(T, -1);
  const plans = [{ units: [{ date: missedDay, type: 'easy', status: 'geplant', week: 1 }] }];

  // Modul aus: gilt als verpasst -> Momentum sinkt unter die Basis 42
  assert.equal(momentum({ sessions: [], plans }, T).missed, 1);
  assert.ok(momentum({ sessions: [], plans }, T).score < 42);

  // Modul an, missedDay ist geschützt: kein Versäumnis -> Momentum bleibt auf Basis
  enableCycleAround(addDays(T, -2)); // Menstruation deckt T-2..T+2 ab, also auch T-1
  assert.equal(isProtectedDay(missedDay), true);
  const m = momentum({ sessions: [], plans }, T);
  assert.equal(m.missed, 0);
  assert.equal(m.score, 42);
});

test('Harte Kämpferin: Training an einem geschützten Tag schaltet das Badge frei', () => {
  enableCycleAround(T);
  const data = { sessions: [{ date: T, distanceKm: 6, type: 'easy' }] };
  assert.equal(computeStats(data, T).hardFighter, true);
  // Modul abgewählt -> kein geschützter Tag -> kein Badge
  store.setSetting('modules', { cycle: false });
  assert.equal(computeStats(data, T).hardFighter, false);
});
