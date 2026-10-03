/* Strecke ohne Kartendienst: vereinfachte Linie + Höhenprofil (MKT-17) – als SVG
   gezeichnet und in der Auswertung einer importierten Einheit sichtbar. */
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

test('routeMap: Linie mit Start und Ziel, Höhenprofil mit Min/Max – ohne Kartenkacheln', () => {
  const box = routeMap(route, { distanceKm: 8.4, ascentM: 64, decode: decodePolyline });
  const svgs = box.querySelectorAll('svg');
  assert.equal(svgs.length, 2);
  assert.match(svgs[0].getAttribute('aria-label'), /Strecke über 8,4 km – ohne Karte/);
  const path = svgs[0].querySelector('path');
  assert.match(path.getAttribute('d'), /^M[\d. ]+L/);
  assert.equal(svgs[0].querySelectorAll('circle').length, 2, 'Start und Ziel');
  assert.ok(!box.querySelector('image') && !box.querySelector('img'), 'keine Kartenbilder');
  assert.match(svgs[1].getAttribute('aria-label'), /Höhenprofil: 90 bis 130 m, 64 Höhenmeter/);
  const labels = svgs[1].querySelectorAll('text').map((t) => t.textContent);
  assert.ok(labels.includes('130 m') && labels.includes('90 m') && labels.includes('8,4 km'));
});

test('Auswertung einer importierten Einheit zeigt die Strecke', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  store.replaceArea('sessions', [{ id: 'f1', date: '2026-09-25', type: 'run', title: 'Lauf (Datei-Import)', distanceKm: 8.4, durationSec: 2900, ascentM: 64, route, source: 'gpx' }]);
  renderSession(view, 'f1');
  assert.match(view.textContent, /Strecke/);
  assert.match(view.textContent, /64 Höhenmeter bergauf/);
  assert.ok(view.querySelector('.route-map'), 'Karte ohne Kacheln eingebaut');
});
