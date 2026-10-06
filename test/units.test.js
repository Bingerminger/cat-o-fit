/* Units (v4.1): data stay metric; units.js converts for display and input. Per person
   (settings distanceUnit, weightUnit, temperatureUnit, weekStart, labUnits); without a choice
   the browser's region decides – the United States imperial, Sunday, conventional lab units. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import {
  units, setUnits, defaultUnits, METRIC, kmToShown, shownToKm, paceToShown, shownToPace, kgToShown, shownToKg,
  celsiusToShown, metresToShown, cmToFeetInches, feetInchesToCm, distanceUnit, paceUnit, weightUnit, temperatureUnit, elevationUnit,
} from '../js/units.js';
import { personUnits, applyUnits, ensureUnitDefaults } from '../js/unit-prefs.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
afterEach(() => setUnits(METRIC));

test('defaults: metric everywhere, the United States imperial with weeks from Sunday', () => {
  assert.deepEqual(defaultUnits('de-DE'), { ...METRIC });
  assert.deepEqual(defaultUnits(['en-GB', 'en']), { ...METRIC });
  assert.deepEqual(defaultUnits(['en-US', 'en']), { distance: 'mi', weight: 'lb', temperature: 'f', weekStart: 0, labs: 'conventional' });
  assert.deepEqual(defaultUnits(null), { ...METRIC });
});

test('setUnits keeps valid values only and reports a change', () => {
  assert.equal(setUnits({ distance: 'mi', weight: 'stone', weekStart: 9 }), true);
  assert.deepEqual(units(), { ...METRIC, distance: 'mi' });
  assert.equal(setUnits({ distance: 'mi' }), false, 'same state, no change');
});

test('conversions both ways: miles, pace per mile, pounds, °F, feet', () => {
  assert.equal(kmToShown(10), 10);
  setUnits({ distance: 'mi', weight: 'lb', temperature: 'f' });
  close(kmToShown(42.195), 26.2187575);
  close(shownToKm(1), 1.609344);
  close(paceToShown(300), 482.8032, 1e-4);      // 5:00/km ≈ 8:03/mi
  close(shownToPace(482.8032), 300, 1e-4);
  close(kgToShown(72.4), 159.6146, 1e-3);
  close(shownToKg(160), 72.574779, 1e-5);
  assert.equal(celsiusToShown(20), 68);
  close(metresToShown(100), 328.08399, 1e-4);
  assert.deepEqual([distanceUnit(), paceUnit(), weightUnit(), temperatureUnit(), elevationUnit()], ['mi', 'min/mi', 'lb', '°F', 'ft']);
});

test('height in feet and inches, rounded without 12 inches', () => {
  assert.deepEqual(cmToFeetInches(180), { ft: 5, in: 11 });
  assert.deepEqual(cmToFeetInches(182.6), { ft: 6, in: 0 });
  assert.equal(feetInchesToCm(5, 11), 180);
});

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('the person: own settings first, else the region; saved once for the server', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { ...globalThis.navigator, languages: ['en-US'], language: 'en-US' }, configurable: true, writable: true });
  try {
    assert.equal(personUnits().distance, 'mi', 'region default');
    store.setSetting('distanceUnit', 'km');
    assert.equal(personUnits().distance, 'km', 'own choice wins');
    ensureUnitDefaults();
    const s = store.settings();
    assert.deepEqual([s.distanceUnit, s.weightUnit, s.temperatureUnit, s.weekStart, s.labUnits], ['km', 'lb', 'f', 0, 'conventional']);
    assert.equal(applyUnits(), true);
    assert.equal(units().weight, 'lb');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});

test('formatting follows the units: distance, pace, weight, height, temperature, elevation', async () => {
  const { fmtKm, fmtWeight, fmtHeight, fmtTemp, fmtElevation } = await import('../js/format.js');
  const { fmtPace, fmtPaceRange, fmtMinSec } = await import('../js/ui.js');
  assert.equal(fmtKm(21.0975, 1), '21,1 km');
  assert.equal(fmtPaceRange(300, 320), '5:00–5:20 min/km');
  assert.equal(fmtWeight(72.4), '72,4 kg');
  assert.equal(fmtHeight(180), '180 cm');
  assert.equal(fmtTemp(21.4), '21 °C');
  setUnits({ distance: 'mi', weight: 'lb', temperature: 'f' });
  assert.equal(fmtKm(21.0975, 1), '13,1 mi');
  assert.equal(fmtPace(300), '8:03');
  assert.equal(fmtPaceRange(300, 320), '8:03–8:35 min/mi');
  assert.equal(fmtMinSec(300), '5:00', 'a split time is shown as it is');
  assert.equal(fmtWeight(72.4), '159,6 lb');
  assert.equal(fmtHeight(180), '5′ 11″');
  assert.equal(fmtTemp(21.4), '71 °F');
  assert.equal(fmtElevation(100), '328 ft');
});

test('generated plan texts: km and paces converted for miles, metre intervals and km/h untouched', async () => {
  const { localizeUnits } = await import('../js/format.js');
  const text = 'Long run 18 km at 5:20–5:34 min/km, then 6×800 m and 4×1 km at 4:45/km (bike 25 km/h)';
  assert.equal(localizeUnits(text), text, 'metric: unchanged');
  setUnits({ distance: 'mi' });
  assert.equal(localizeUnits(text), 'Long run 11,2 mi at 8:35–8:58 min/mi, then 6×800 m and 4×0,62 mi at 7:39/mi (bike 25 km/h)');
});
