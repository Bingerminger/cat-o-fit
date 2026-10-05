/* Own data as a table (MKT-12): CSV for German spreadsheet programs – semicolon,
   decimal comma, UTF-8 with BOM – and defused formulas in text fields. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, sessionsCsv, healthCsv, labsCsv, diaryCsv } from '../js/csv-export.js';
import * as store from '../js/storage.js';
import * as settings from '../js/settings.js';

const lines = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('Format: BOM, semicolon, decimal comma, CRLF line endings', () => {
  const csv = sessionsCsv([
    { id: 'b', date: '2026-09-02', type: 'easy', title: 'Lauf', durationSec: 3000, distanceKm: 9.25, paceSecPerKm: 324, avgHr: 148, rpe: 4 },
    { id: 'a', date: '2026-09-01', type: 'cross_bike', title: 'Radtour', durationSec: 5400, distanceKm: 40 },
    { id: 'x', date: '2026-09-03', type: 'easy', deleted: true },
  ]);
  assert.ok(csv.startsWith('﻿Datum;Sportart;Titel;Dauer (min);Distanz (km)'));
  const rows = lines(csv);
  assert.equal(rows.length, 3, 'header + two entries, deleted ones not');
  assert.match(rows[1], /^2026-09-01;Radtour;Radtour;90,0;40,00;/, 'sorted by date');
  assert.match(rows[2], /^2026-09-02;Lockerer Lauf;Lauf;50,0;9,25;5:24;148;;4;200;/);
});

test('Texts: separators and quotation marks escaped, formulas defused', () => {
  const csv = diaryCsv([
    { date: '2026-09-01', title: 'Porridge; mit „Beeren“ und "Honig"', kcal: 500.5, protein: 30 },
    { date: '2026-09-02', title: '=HYPERLINK("x")', kcal: 1 },
    { date: '2026-09-03', title: '-5 km locker', kcal: 1 },
  ]);
  const rows = lines(csv);
  assert.equal(rows[1], '2026-09-01;"Porridge; mit „Beeren“ und ""Honig""";500,5;30;');
  assert.equal(rows[2], `2026-09-02;"'=HYPERLINK(""x"")";1;;`);
  assert.equal(rows[3], "2026-09-03;'-5 km locker;1;;");
  assert.ok(toCsv([], [['A', () => '']]).startsWith('﻿A'), 'empty table: header only');
});

test('Body values, labs (with own reference range) and diary', () => {
  const h = lines(healthCsv([{ date: '2026-09-01', weight: 72.4, bodyFat: 24.7, hrv: 48, hrvMethod: 'rmssd', sleepHours: 7.5 }]));
  assert.match(h[1], /^2026-09-01;72,4;24,7;;;;;48;RMSSD;;7,5;/);
  const l = lines(labsCsv([{ date: '2026-07-06', analyte: 'ferritin', value: 47, unit: 'µg/l', refLow: 15, refHigh: 150, note: 'nüchtern' }]));
  assert.equal(l[0], 'Datum;Wert;Messwert;Einheit;Referenz von;Referenz bis;Notiz');
  assert.equal(l[1], '2026-07-06;Ferritin;47;µg/l;15;150;nüchtern');
  const t = lines(diaryCsv([{ date: '2026-09-01', _kind: 'day', complete: true }, { date: '2026-09-01', title: 'Porridge', kcal: 520 }]));
  assert.equal(t.length, 2, 'the "day complete" marker is not a meal');
});

test('Settings offer the table export', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  store.setProfile({ name: 'Test' });
  settings.render(view);
  assert.ok(view.querySelectorAll('button').some((b) => b.textContent.includes('Als Tabelle exportieren (CSV)')));
});

test('MKT-15: read access is off, can be switched on (key) and switched off again', () => {
  const doc = globalThis.document;
  const render = () => {
    doc.body.childNodes = [];
    for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
      const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
    }
    const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
    settings.render(view);
    return view;
  };
  store.setProfile({ name: 'Test', readToken: null });
  let view = render();
  assert.match(view.textContent, /Lesezugang für eigene Werkzeuge/);
  assert.doesNotMatch(view.textContent, /X-Catofit-Token/, 'off: no address, no key');
  const sw = () => view.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Lesezugang erlauben');
  sw().checked = true;
  sw().dispatchEvent({ type: 'change', target: sw() });
  assert.match(store.profile().readToken, /^[0-9a-f]{48}$/);
  view = render();
  assert.ok(view.querySelectorAll('input').some((i) => String(i.value).includes('action=read')), 'address is shown');
  sw().checked = false;
  sw().dispatchEvent({ type: 'change', target: sw() });
  assert.equal(store.profile().readToken, null);
});
