/* Lab units (v4.1): stored and rated canonically; a person who chose conventional units (default in
   the United States) sees the common conventional unit where an analyte has one – values, trend,
   ranges and supplement hints alike. SI shows everything as before. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr } from '../js/ui.js';
import { setUnits, METRIC } from '../js/units.js';
import { shownUnit, toShown, unitLabel } from '../js/labs.js';
import * as labsView from '../js/labs-view.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
afterEach(() => setUnits(METRIC));

test('conventional units where an analyte has one, canonical otherwise', () => {
  assert.equal(shownUnit('vitaminD'), 'nmol/l');
  setUnits({ labs: 'conventional' });
  assert.equal(shownUnit('vitaminD'), 'ng/ml');
  assert.equal(unitLabel('ng/ml'), 'ng/mL');
  assert.equal(unitLabel('mg/dl (BUN)'), 'mg/dL (BUN)');
  assert.equal(toShown('vitaminD', 75), 30, 'three significant digits');
  assert.equal(shownUnit('ck'), 'U/l', 'no conventional unit of its own');
  assert.equal(toShown('ck', 180), 180);
});

test('labs view: vitamin D in ng/mL for a person on conventional units, nmol/l with SI', () => {
  store.replaceArea('labs', [{ id: 'l1', analyte: 'vitaminD', value: 75, unit: 'nmol/l', date: todayStr() }]);
  store.setSetting('labsGate', { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false });
  store.setProfile({ name: 'Test', birthYear: 1990, sex: 'w' });
  let view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /75\s?nmol\/l/);
  setUnits({ labs: 'conventional' });
  view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /30\s?ng\/mL/);
  assert.doesNotMatch(view.textContent, /75\s?nmol\/l/);
});
