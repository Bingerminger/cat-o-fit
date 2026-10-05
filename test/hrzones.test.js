/* HR zones (TRAIN-37): starting value from age (Tanaka), optionally via the
   heart-rate reserve (Karvonen) – and shown as an estimate in the settings. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr } from '../js/ui.js';
import * as settings from '../js/settings.js';
import { estimateMaxHr, hrZonesFrom } from '../js/hrzones.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(() => { store.setProfile({ name: 'Test', maxHr: null, restHr: null, hrZones: null, hrZoneMethod: null, maxHrEstimated: false, lthr: null }); });

test('TRAIN-37: max HR estimate by Tanaka (208 − 0.7 × age)', () => {
  assert.equal(estimateMaxHr(40), 180);
  assert.equal(estimateMaxHr(20), 194);
  assert.equal(estimateMaxHr(null), null);
});

test('TRAIN-37: zones as % of max HR and via the heart-rate reserve (Karvonen)', () => {
  const pct = hrZonesFrom({ maxHr: 190 });
  assert.deepEqual([pct[1].min, pct[1].max], [114, 133]);         // Z2: 60–70 % of 190
  const hfr = hrZonesFrom({ maxHr: 190, restHr: 50, method: 'karvonen' });
  assert.deepEqual([hfr[1].min, hfr[1].max], [134, 148]);         // 50 + 0.6/0.7 × 140
  assert.equal(hfr[1].basis, 'hfr');
  assert.ok(hfr[1].min > pct[1].min, 'with a resting heart rate the base zone is higher');
  // Without a plausible resting heart rate: fall back to % max HR.
  assert.equal(hrZonesFrom({ maxHr: 190, restHr: null, method: 'karvonen' })[1].basis, 'hfmax');
  assert.deepEqual(hrZonesFrom({ maxHr: 20 }), [], 'implausible max HR → no zones');
});

test('TRAIN-37: without a max HR the settings offer a marked starting value derived from age', () => {
  const year = Number(todayStr().slice(0, 4));
  store.setProfile({ birthYear: year - 40 });
  const view = setupShell();
  settings.render(view);
  assert.match(view.textContent, /Zonen aus dem Alter schätzen \(HFmax ≈ 180\)/);
  assert.match(view.textContent, /Schätzung aus dem Alter/);
});

test('TRAIN-51: zones from the threshold HR (test/performance diagnostics), zone 5 up to max HR', () => {
  const z = hrZonesFrom({ method: 'lthr', lthr: 170 });
  assert.deepEqual(z.map((x) => [x.min, x.max]), [[111, 145], [145, 153], [153, 162], [162, 170], [170, 180]]);
  assert.equal(z[0].basis, 'lthr');
  assert.equal(hrZonesFrom({ method: 'lthr', lthr: 170, maxHr: 191 })[4].max, 191, 'a known max HR caps zone 5');
  assert.equal(hrZonesFrom({ method: 'lthr', lthr: 60, maxHr: 190 })[0].basis, 'hfmax', 'implausible threshold → fallback');
});

test('TRAIN-51: settings – choose "Threshold", enter the threshold HR, zones follow', () => {
  store.setProfile({ maxHr: 190 });
  let view = setupShell();
  settings.render(view);
  view.querySelectorAll('button').find((b) => b.textContent === 'Schwelle').click();
  assert.equal(store.profile().hrZoneMethod, 'lthr');
  view = setupShell();
  settings.render(view);
  const i = view.querySelectorAll('input').find((x) => x.getAttribute('aria-label') === 'Schwellen-HF (bpm)');
  assert.ok(i, 'input for the threshold HR');
  assert.match(view.textContent, /30 Minuten/);
  i.value = '168';
  i.dispatchEvent({ type: 'change', target: i });
  const zones = store.profile().hrZones;
  assert.equal(store.profile().lthr, 168);
  assert.equal(zones[3].max, 168, 'zone 4 ends at the threshold');
  assert.equal(zones[0].basis, 'lthr');
});
