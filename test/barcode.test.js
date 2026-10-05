/* MKT-18: look up a barcode (EAN) – check digit, portion from the per-100 g values
   and the "Barcode" mode in "Log what you ate" (request only via our own server and
   only when "Fill in nutrition values online" is switched on). */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { validGtin, portionFromProduct } from '../js/barcode.js';
import { openQuickEaten } from '../js/nutrition.js';

const realFetch = globalThis.fetch;
beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});
afterEach(() => { globalThis.fetch = realFetch; });

test('Check digit: EAN-13, EAN-8 and UPC-A valid, typos and nonsense not', () => {
  assert.equal(validGtin('4006381333931'), true);
  assert.equal(validGtin('73513537'), true);
  assert.equal(validGtin('036000291452'), true);
  assert.equal(validGtin('4006381333932'), false, 'wrong check digit');
  assert.equal(validGtin('12345'), false);
  assert.equal(validGtin('40063813339x1'), false);
});

test('Portion: kcal and protein for the amount eaten', () => {
  assert.deepEqual(portionFromProduct({ kcal100: 539, protein100: 6.3 }, 30), { kcal: 162, protein: 1.9 });
  assert.deepEqual(portionFromProduct({ kcal100: 60, protein100: null }, '250'), { kcal: 150, protein: null });
  assert.equal(portionFromProduct({ kcal100: null }, 100), null, 'no calculation without a calorie value');
  assert.equal(portionFromProduct({ kcal100: 100 }, 0), null);
});

test('Log what you ate → barcode: look up via our own server, amount, save', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ found: true, name: 'Haselnusscreme (Beispiel)', kcal100: 539, protein100: 6.3 }) };
  };
  const doc = globalThis.document;
  doc.body.childNodes = [];
  const root = doc.createElement('div'); root.setAttribute('id', 'modal-root'); doc.body.appendChild(root);
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'view']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  openQuickEaten();
  root.querySelectorAll('button').find((b) => b.textContent === 'Barcode').click();
  const code = root.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Strichcode (EAN)');
  const grams = root.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Menge in Gramm');
  code.value = '4006381333932';   // typo: never even leaves the device
  root.querySelectorAll('button').find((b) => b.textContent === 'Suchen').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((u) => u.includes('action=foodfacts')).length, 0);
  assert.match(root.textContent, /kein gültiger Strichcode/);
  code.value = '4006381333931';
  // New profile: "Fill in nutrition values online" is off – then no barcode leaves the device either.
  assert.equal(store.foodLookupEnabled(), false);
  root.querySelectorAll('button').find((b) => b.textContent === 'Suchen').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((u) => u.includes('action=foodfacts')).length, 0, 'switched off → no request');
  assert.match(root.textContent, /Open Food Facts ist ausgeschaltet/);
  root.querySelectorAll('button').find((b) => b.textContent === 'Einschalten und suchen').click();
  for (let i = 0; i < 400 && !/539 kcal/.test(root.textContent); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(store.foodLookupEnabled(), true, 'the button switches the setting on');
  assert.ok(calls.some((u) => u.includes('action=foodfacts') && u.includes('code=4006381333931')), 'request goes to our own proxy');
  grams.value = '30';
  grams.dispatchEvent({ type: 'input', target: grams });
  assert.match(root.textContent, /→ 162 kcal, 1,9 g Eiweiß/);
  root.querySelectorAll('button').find((b) => b.textContent === 'Erfassen').click();
  const d = store.get('diary')[0];
  assert.equal(d.kcal, 162);
  assert.equal(d.title, 'Haselnusscreme (Beispiel) (30 g)');
});
