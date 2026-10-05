/* MKT-09: record a whole lab report at once instead of value by value –
   same checks as single entry (unit, own reference range,
   implausible order of magnitude), circumstances of the blood draw for all values. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { labRecordsFromReport, LAB_SCHEMA } from '../js/labs.js';
import * as labsView from '../js/labs-view.js';

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.setProfile({ name: 'Test', sex: 'w', birthYear: 1990 });
  // Scope check answered (adults, nothing applies) – otherwise the view shows the setup first.
  store.setSetting('labsGate', { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false });
});

test('Report → records: only filled-in values, unit converted, own range, circumstances for all', () => {
  const res = labRecordsFromReport({
    date: '2026-09-20', note: ' Sportcheck ', ctx: { fasting: true, cycleDay: 9 },
    rows: [
      { key: 'ferritin', value: '47', unit: 'µg/l', refLow: '15', refHigh: '150' },
      { key: 'vitaminD', value: '30', unit: 'ng/ml' },          // ng/ml → nmol/l
      { key: 'hb', value: '', unit: 'g/dl' },                    // empty: does not count
      { key: 'crp', value: '1,2', unit: 'mg/l' },                 // comma allowed
    ],
  }, { sex: 'w' });
  assert.deepEqual(res.errors, []);
  assert.equal(res.records.length, 3);
  const [fer, vd, crp] = res.records;
  assert.deepEqual([fer.refLow, fer.refHigh, fer.refSource], [15, 150, 'lab']);
  assert.equal(vd.unit, 'nmol/l');
  assert.ok(Math.abs(vd.value - 74.9) < 0.2, `30 ng/ml ≈ 74.9 nmol/l, was ${vd.value}`);
  assert.deepEqual([vd.enteredValue, vd.enteredUnit], [30, 'ng/ml']);
  assert.equal(crp.value, 1.2);
  for (const r of res.records) {
    assert.equal(r.date, '2026-09-20');
    assert.equal(r.note, 'Sportcheck');
    assert.equal(r.fasting, true);
    assert.equal(r.cycleDay, 9);
    assert.equal(r.schema, LAB_SCHEMA);
  }
});

test('Report: half-filled or reversed reference ranges are errors, implausible values are reported', () => {
  const res = labRecordsFromReport({ date: '2026-09-20', rows: [
    { key: 'ferritin', value: '47', refLow: '15', refHigh: '' },
    { key: 'hb', value: '13', refLow: '16', refHigh: '12' },
    { key: 'vitaminD', value: '2' },                            // nmol/l mixed up with ng/ml?
  ] }, { sex: 'w' });
  assert.equal(res.errors.length, 2);
  assert.match(res.errors[0], /^Ferritin: bitte beide Grenzen/);
  assert.match(res.errors[1], /obere Grenze muss größer/);
  assert.deepEqual(res.implausible, ['Vitamin D (25-OH)']);
});

test('View: recording a report creates all values in one step', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  labsView.render(view);
  const open = view.querySelectorAll('button').find((b) => b.textContent.includes('Befund mit mehreren Werten erfassen'));
  assert.ok(open, 'button below the values');
  open.click();
  const root = doc.querySelector('#modal-root');
  const byLabel = (l) => root.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === l);
  byLabel('Ferritin: Messwert').value = '52';
  byLabel('Magnesium (Vollblut): Messwert').value = '1,4';
  root.querySelectorAll('button').find((b) => b.textContent.includes('Befund speichern')).click();
  const labs = store.get('labs');
  assert.equal(labs.length, 2);
  assert.ok(labs.every((l) => l.date === labs[0].date && l.id));
});
