/* Körperwerte-Erfassung (js/health.js openHealthEntry) über das Mini-DOM:
   Ein Datumswechsel im Dialog darf den Eintrag des Öffnungstags weder verschieben
   noch überschreiben (vor v3.20.0: stiller Datenverlust + Doppel-Einträge). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { openHealthEntry } from '../js/health.js';
import { todayStr, addDays } from '../js/ui.js';

const { MiniNode } = globalThis.__domTest;
let root;

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  document.body.childNodes = [];
  root = new MiniNode('div');
  root.setAttribute('id', 'modal-root');
  document.body.appendChild(root);
});

const saveButton = () => root.querySelectorAll('button').find((b) => b.textContent === 'Speichern');
const dateInput = () => root.querySelector('input[type="date"]');

test('UI-01: Datum im Dialog ändern verschiebt den heutigen Eintrag nicht', () => {
  const today = todayStr();
  const yday = addDays(today, -1);
  store.upsert('health', { id: 'h-today', date: today, weight: 70.1 });
  store.upsert('health', { id: 'h-yday', date: yday, weight: 70.6 });
  openHealthEntry();
  const w = root.querySelectorAll('input[type="number"]').find((i) => String(i.value) === '70.1');
  assert.ok(w, 'Dialog zeigt den heutigen Wert');
  const d = dateInput();
  d.value = yday;
  d.dispatchEvent({ type: 'change', target: d });
  assert.equal(String(w.value), '70.6', 'nach dem Datumswechsel stehen die Werte von gestern im Feld');
  w.value = '70.4';
  saveButton().click();
  const h = store.get('health');
  assert.equal(h.filter((x) => x.date === today).length, 1, 'heute genau ein Eintrag');
  assert.equal(h.find((x) => x.date === today).weight, 70.1, 'heutiger Eintrag unverändert');
  assert.equal(h.filter((x) => x.date === yday).length, 1, 'kein Doppel-Eintrag für gestern');
  assert.equal(h.find((x) => x.date === yday).weight, 70.4, 'gestern korrigiert');
});

test('UI-01: neues Datum ohne Eintrag legt einen eigenen Datensatz an', () => {
  const today = todayStr();
  const earlier = addDays(today, -3);
  store.upsert('health', { id: 'h-today', date: today, weight: 70.1, notes: 'heute' });
  openHealthEntry();
  const d = dateInput();
  d.value = earlier;
  d.dispatchEvent({ type: 'change', target: d });
  const nums = root.querySelectorAll('input[type="number"]');
  assert.ok(nums.every((i) => String(i.value) === ''), 'Felder für den neuen Tag sind leer');
  nums[0].value = '71';
  saveButton().click();
  const h = store.get('health');
  assert.equal(h.find((x) => x.id === 'h-today').date, today, 'Eintrag des Öffnungstags bleibt auf heute');
  assert.equal(h.find((x) => x.id === 'h-today').notes, 'heute');
  const neu = h.find((x) => x.date === earlier);
  assert.ok(neu && neu.id !== 'h-today', 'eigener Datensatz für den neuen Tag');
});

test('Muskelmasse von Hand an einem Tag mit Apple-Werten bleibt Muskelmasse', () => {
  const today = todayStr();
  store.upsert('health', { id: 'h-apple', date: today, source: 'apple-health', weight: 72.1, bodyFat: 24.7 });
  openHealthEntry();
  const label = root.querySelectorAll('label').find((l) => l.textContent.startsWith('Muskelmasse'));
  assert.ok(label, 'Feld „Muskelmasse“ im Dialog');
  label.querySelector('input').value = '28.2';
  saveButton().click();
  const h = store.get('health').find((x) => x.date === today);
  assert.equal(h.muscleMass, 28.2, 'bleibt Muskelmasse (vorher als fettfreie Masse gelesen)');
  assert.ok(h.leanMass == null, 'keine fettfreie Masse von 28,2 kg');
  assert.equal(h.weight, 72.1, 'Apple-Werte des Tages bleiben');
});
