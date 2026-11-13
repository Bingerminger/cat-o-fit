/* Performance tests (since 4.2): the threshold pace enters the form estimate as one hard performance on
   its date – the one pace source stays the estimate; FTP gives bike sessions watts, CSS is the swim
   reference. Undated values never count. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as store from '../js/storage.js';
import * as settings from '../js/settings.js';
import { estimateVdot, formOptions, pacesFromVdot, vdotFromThresholdPace } from '../js/vdot.js';
import { powerZones, powerForZone, parseMinSec, testValidity } from '../js/perftest.js';
import { addDays, todayStr } from '../js/ui.js';

const TODAY = '2026-11-07';

test('the tested threshold pace comes back as the threshold range of the form it gives', () => {
  const bad = [];
  for (let sec = 200; sec <= 480; sec++) {
    const z = pacesFromVdot(vdotFromThresholdPace(sec)).threshold;
    if (!(z.min <= sec && sec <= z.max)) bad.push(`${sec}: ${z.min}–${z.max}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} paces outside their own range`);
  assert.equal(vdotFromThresholdPace(60), null);
});

test('a dated test counts like one hard run on its day, for the window of the estimate', () => {
  const profile = { thresholdPaceSecPerKm: 285, thresholdPaceDate: addDays(TODAY, -10) };
  const est = estimateVdot([], TODAY, 42, formOptions(profile));
  assert.equal(est.vdot, vdotFromThresholdPace(285));
  assert.equal(est.basis.type, 'test');
  assert.equal(est.basis.paceSecPerKm, 285);
  assert.equal(est.onlyEasy, false);
  // Undated (as in profiles from before 4.2) or older than six weeks: no effect.
  assert.equal(formOptions({ thresholdPaceSecPerKm: 285 }).perfTest, null);
  assert.equal(estimateVdot([], TODAY, 42, formOptions({ thresholdPaceSecPerKm: 285 })), null);
  assert.equal(estimateVdot([], TODAY, 42, formOptions({ ...profile, thresholdPaceDate: addDays(TODAY, -43) })), null);
  assert.equal(estimateVdot([], TODAY, 42, formOptions({ ...profile, thresholdPaceDate: addDays(TODAY, 1) })), null, 'not from the future');
  // Blended with runs: in its week the better of test and runs counts.
  const runs = [{ id: 'r', date: addDays(TODAY, -3), type: 'tempo', distanceKm: 10, durationSec: 2700 }];
  const both = estimateVdot(runs, TODAY, 42, formOptions(profile));
  assert.equal(both.weeks, 2);
  assert.ok(both.vdot >= Math.min(estimateVdot(runs, TODAY).vdot, est.vdot));
  assert.deepEqual(testValidity(profile.thresholdPaceDate, TODAY), { until: addDays(profile.thresholdPaceDate, 42), counts: true });
});

test('every form estimate gets the same inputs (formOptions) – no second source', () => {
  const files = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const bad = [];
  for (const f of files) {
    const src = readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
    for (const line of src.split('\n')) {
      if (/export function (estimateVdot|predictRace)/.test(line)) continue;
      if (/\b(estimateVdot|predictRace)\(/.test(line) && !/formOptions\(|\{ hrZones, perfTest \}/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('power zones from FTP (Allen & Coggan levels 1–5), watts for a bike zone', () => {
  assert.deepEqual(powerZones(200).map((z) => [z.min, z.max]), [[0, 110], [112, 150], [152, 180], [182, 210], [212, 240]]);
  assert.deepEqual(powerForZone(200, 2), { zone: 2, min: 112, max: 150 });
  assert.equal(powerForZone(null, 2), null);
  assert.deepEqual(powerZones(20), []);
  assert.equal(parseMinSec('1:50'), 110);
  assert.equal(parseMinSec('110'), 110);
  assert.equal(parseMinSec('1:75'), null);
  assert.equal(parseMinSec(''), null);
});

/* ------------------------------- Settings ------------------------------- */
const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
const inputByLabel = (view, label) => view.querySelectorAll('input').find((x) => x.getAttribute('aria-label') === label);
beforeEach(() => { store.setProfile({ name: 'Test', thresholdPaceSecPerKm: null, thresholdPaceDate: null, ftpW: null, ftpDate: null, cssSecPer100m: null, cssDate: null }); });

test('settings: threshold pace, FTP and CSS are stored with the day of the test', () => {
  const view = setupShell();
  settings.render(view);
  const pace = inputByLabel(view, 'Schwellenpace (min/km)');
  assert.ok(pace, 'threshold pace field');
  pace.value = '4:45';
  pace.dispatchEvent({ type: 'change', target: pace });
  assert.deepEqual([store.profile().thresholdPaceSecPerKm, store.profile().thresholdPaceDate], [285, todayStr()]);
  assert.match(view.textContent, /am Testtag – bis /, 'the note says until when it counts – updated in place, no redraw');
  assert.doesNotMatch(view.textContent, /\.\.FTP/, 'no double full stop after the date');
  assert.ok(view.querySelectorAll('input').includes(pace), 'the same field is still there');
  const ftp = inputByLabel(view, 'FTP (Watt)');
  ftp.value = '230';
  ftp.dispatchEvent({ type: 'change', target: ftp });
  assert.deepEqual([store.profile().ftpW, store.profile().ftpDate], [230, todayStr()]);
  assert.match(view.textContent, /Z2 129–173[\s ]W/);
  const css = inputByLabel(view, 'CSS (min/100 m)');
  css.value = '1:52';
  css.dispatchEvent({ type: 'change', target: css });
  assert.equal(store.profile().cssSecPer100m, 112);
  // Emptied: removed.
  pace.value = '';
  pace.dispatchEvent({ type: 'change', target: pace });
  assert.deepEqual([store.profile().thresholdPaceSecPerKm, store.profile().thresholdPaceDate], [null, null]);
  const again = setupShell();
  settings.render(again);
  assert.match(again.textContent, /Z2 129–173[\s ]W/);
});
