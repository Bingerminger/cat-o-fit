/* Route without a map service: simplified line + elevation profile (MKT-17) – drawn as SVG
   and visible in the evaluation of an imported unit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { routeMap } from '../js/charts.js';
import { encodePolyline, decodePolyline } from '../js/gpx.js';
import { render as renderSession } from '../js/session.js';

const route = {
  poly: encodePolyline([[51.05, 13.73], [51.06, 13.74], [51.07, 13.72], [51.05, 13.73]]),
  ele: Array.from({ length: 60 }, (_, i) => 110 + Math.round(20 * Math.sin(i / 9))),
};

test('routeMap: line with start and finish, elevation profile with min/max – without map tiles', () => {
  const box = routeMap(route, { distanceKm: 8.4, ascentM: 64, decode: decodePolyline });
  const svgs = box.querySelectorAll('svg');
  assert.equal(svgs.length, 2);
  assert.match(svgs[0].getAttribute('aria-label'), /Strecke über 8,4 km – ohne Karte/);
  const path = svgs[0].querySelector('path');
  assert.match(path.getAttribute('d'), /^M[\d. ]+L/);
  assert.equal(svgs[0].querySelectorAll('circle').length, 2, 'start and finish');
  assert.ok(!box.querySelector('image') && !box.querySelector('img'), 'no map images');
  assert.match(svgs[1].getAttribute('aria-label'), /Höhenprofil: 90 m bis 130 m, 64 m bergauf/);
  const labels = svgs[1].querySelectorAll('text').map((t) => t.textContent);
  assert.ok(labels.includes('130 m') && labels.includes('90 m') && labels.includes('8,4 km'));
});

test('The evaluation of an imported unit shows the route', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  store.replaceArea('sessions', [{ id: 'f1', date: '2026-09-25', type: 'run', title: 'Lauf (Datei-Import)', distanceKm: 8.4, durationSec: 2900, ascentM: 64, route, source: 'gpx' }]);
  renderSession(view, 'f1');
  assert.match(view.textContent, /Strecke/);
  assert.match(view.textContent, /64\sm bergauf/);
  assert.ok(view.querySelector('.route-map'), 'map without tiles included');
});
