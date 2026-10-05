/* Body-measurement entry (js/health.js openHealthEntry) via the mini DOM:
   Changing the date in the dialog must neither move nor overwrite the entry of the day
   the dialog was opened on (before v3.20.0: silent data loss + duplicate entries). */
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

test('UI-01: changing the date in the dialog does not move the entry for today', () => {
  const today = todayStr();
  const yday = addDays(today, -1);
  store.upsert('health', { id: 'h-today', date: today, weight: 70.1 });
  store.upsert('health', { id: 'h-yday', date: yday, weight: 70.6 });
  openHealthEntry();
  const w = root.querySelectorAll('input[type="number"]').find((i) => String(i.value) === '70.1');
  assert.ok(w, 'dialog shows the value for today');
  const d = dateInput();
  d.value = yday;
  d.dispatchEvent({ type: 'change', target: d });
  assert.equal(String(w.value), '70.6', 'after the date change the field holds the values for yesterday');
  w.value = '70.4';
  saveButton().click();
  const h = store.get('health');
  assert.equal(h.filter((x) => x.date === today).length, 1, 'exactly one entry for today');
  assert.equal(h.find((x) => x.date === today).weight, 70.1, 'entry for today unchanged');
  assert.equal(h.filter((x) => x.date === yday).length, 1, 'no duplicate entry for yesterday');
  assert.equal(h.find((x) => x.date === yday).weight, 70.4, 'yesterday corrected');
});

test('UI-01: a new date without an entry creates its own record', () => {
  const today = todayStr();
  const earlier = addDays(today, -3);
  store.upsert('health', { id: 'h-today', date: today, weight: 70.1, notes: 'heute' });
  openHealthEntry();
  const d = dateInput();
  d.value = earlier;
  d.dispatchEvent({ type: 'change', target: d });
  const nums = root.querySelectorAll('input[type="number"]');
  assert.ok(nums.every((i) => String(i.value) === ''), 'fields for the new day are empty');
  nums[0].value = '71';
  saveButton().click();
  const h = store.get('health');
  assert.equal(h.find((x) => x.id === 'h-today').date, today, 'entry of the opening day stays on today');
  assert.equal(h.find((x) => x.id === 'h-today').notes, 'heute');
  const neu = h.find((x) => x.date === earlier);
  assert.ok(neu && neu.id !== 'h-today', 'separate record for the new day');
});

test('Muscle mass entered by hand on a day with Apple values stays muscle mass', () => {
  const today = todayStr();
  store.upsert('health', { id: 'h-apple', date: today, source: 'apple-health', weight: 72.1, bodyFat: 24.7 });
  openHealthEntry();
  const label = root.querySelectorAll('label').find((l) => l.textContent.startsWith('Muskelmasse'));
  assert.ok(label, 'muscle mass field in the dialog');
  label.querySelector('input').value = '28.2';
  saveButton().click();
  const h = store.get('health').find((x) => x.date === today);
  assert.equal(h.muscleMass, 28.2, 'stays muscle mass (previously read as lean mass)');
  assert.ok(h.leanMass == null, 'no lean mass of 28.2 kg');
  assert.equal(h.weight, 72.1, 'Apple values of the day are kept');
});
