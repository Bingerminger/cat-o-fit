/* =========================================================================
   rpe-hr.test.js — Belastung aus Uhrendaten: Fehlt die Anstrengung (RPE), schätzt
   die Ø-Herzfrequenz sie relativ zur Max-HF; die Belastung bleibt sRPE. Dazu die
   Nachfrage „Wie hart war's?“ auf „Heute“ für importierte Trainings.
   ========================================================================= */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { rpeFromHr, sessionRpeInfo, sessionRpe, sessionLoad, useHrReference, trainingLoad } from '../js/load.js';
import { rpeAskList } from '../js/planflow.js';
import * as dashboard from '../js/dashboard.js';
import { todayStr, addDays } from '../js/ui.js';

const T = '2026-07-18';
afterEach(() => useHrReference(null));

test('RPE aus der Herzfrequenz: Stützstellen der HF-Zonen, unbrauchbare Werte → null', () => {
  assert.equal(rpeFromHr(133, 190), 4);        // 70 % → 4
  assert.equal(rpeFromHr(152, 190), 6);        // 80 % → 6
  assert.equal(rpeFromHr(161.5, 190), 7);      // 85 % → 7
  assert.equal(rpeFromHr(90, 190), 1.5);       // unter 50 % → 1,5
  assert.equal(rpeFromHr(null, 190), null);
  assert.equal(rpeFromHr(150, null), null, 'ohne Max-HF keine Schätzung');
  assert.equal(rpeFromHr(230, 190), null, 'Ø-HF deutlich über der Max-HF ist ein Messfehler');
});

test('Importiertes Intervalltraining (als „locker“ gespeichert) zählt nicht mehr als locker', () => {
  useHrReference(() => ({ maxHr: 190 }));
  const s = { date: T, type: 'easy', source: 'apple-health', durationSec: 3600, avgHr: 162 };
  const info = sessionRpeInfo(s);
  assert.equal(info.source, 'herzfrequenz');
  assert.ok(info.rpe > 6.5 && info.rpe < 7.5, `Schätzung ≈ 7, war ${info.rpe}`);
  assert.equal(sessionLoad(s), Math.round(60 * info.rpe), 'Belastung bleibt Dauer × Anstrengung');
  assert.ok(sessionLoad(s) > 60 * 4, 'vorher 240 Punkte (Standardwert „locker“)');
  assert.equal(trainingLoad([s], T, 7), sessionLoad(s), 'dieselbe Rechnung in der Wochenlast');
});

test('Erfasste RPE hat Vorrang, harte Typen behalten ihren Mindestwert, Fußball seine Intensität', () => {
  useHrReference(() => ({ maxHr: 190 }));
  assert.deepEqual(sessionRpeInfo({ type: 'easy', rpe: 3, avgHr: 170 }), { rpe: 3, source: 'erfasst' });
  // Intervalle: Die Ø-HF enthält die Pausen und unterschätzt – der Typ-Wert 8 bleibt Untergrenze.
  assert.equal(sessionRpe({ type: 'interval', avgHr: 150 }), 8);
  assert.equal(sessionRpeInfo({ type: 'cross_football', intensity: 'intensiv', avgHr: 120 }).rpe, 8.5);
  // Lockerer Lauf mit niedriger HF darf unter den Standardwert fallen.
  assert.ok(sessionRpe({ type: 'easy', avgHr: 120 }) < 4);
});

test('Ohne Max-HF oder ohne HF bleibt es beim Standardwert der Sportart (wie bisher)', () => {
  assert.deepEqual(sessionRpeInfo({ type: 'easy', avgHr: 160 }), { rpe: 4, source: 'typ' });
  useHrReference(() => ({ maxHr: 190 }));
  assert.deepEqual(sessionRpeInfo({ type: 'long' }), { rpe: 6, source: 'typ' });
  assert.equal(sessionRpe({ type: 'easy', avgHr: 160 }, null), 4, 'expliziter Bezug null schaltet die Schätzung ab');
});

test('Nachfrage „Wie hart war\'s?“: nur importierte Trainings der letzten Tage ohne Anstrengung', () => {
  const list = rpeAskList([
    { id: 'a', date: T, type: 'easy', source: 'apple-health' },
    { id: 'b', date: addDays(T, -1), type: 'cross_bike', source: 'gpx' },
    { id: 'c', date: T, type: 'easy', source: 'apple-health', rpe: 5 },          // schon beantwortet
    { id: 'd', date: T, type: 'easy', source: 'manual' },                        // von Hand erfasst
    { id: 'e', date: T, type: 'walk', source: 'apple-health' },                  // Gehen: keine Frage
    { id: 'f', date: addDays(T, -3), type: 'easy', source: 'apple-health' },     // zu alt
    { id: 'g', date: T, type: 'easy', source: 'health', rpeDismissed: true },    // weggeklickt
  ], T);
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
});

test('„Heute“ fragt nach – ein Tipp speichert die Anstrengung', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  ['sessions', 'plans', 'events', 'health'].forEach((a) => store.replaceArea(a, []));
  store.setProfile({ name: 'Test', maxHr: 190, heightCm: 170, weightKg: 70, birthYear: 1990, sex: 'w' });
  const today = todayStr();
  store.upsert('sessions', { id: 'imp1', date: addDays(today, -1), type: 'easy', title: 'Lauf', source: 'apple-health', durationSec: 3000, distanceKm: 9.2, avgHr: 150 });
  dashboard.render(view);
  assert.match(view.textContent, /Wie hart war’s\?/);
  const hart = view.querySelectorAll('button').find((b) => b.textContent === 'hart');
  assert.ok(hart, 'Antwort „hart“ angeboten');
  hart.click();
  assert.equal(store.find('sessions', 'imp1').rpe, 7);
});
