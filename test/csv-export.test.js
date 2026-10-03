/* Eigene Daten als Tabelle (MKT-12): CSV für deutsche Tabellenprogramme – Semikolon,
   Dezimalkomma, UTF-8 mit BOM – und entschärfte Formeln in Textfeldern. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, sessionsCsv, healthCsv, labsCsv, diaryCsv } from '../js/csv-export.js';
import * as store from '../js/storage.js';
import * as settings from '../js/settings.js';

const lines = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('Format: BOM, Semikolon, Dezimalkomma, Zeilenende CRLF', () => {
  const csv = sessionsCsv([
    { id: 'b', date: '2026-09-02', type: 'easy', title: 'Lauf', durationSec: 3000, distanceKm: 9.25, paceSecPerKm: 324, avgHr: 148, rpe: 4 },
    { id: 'a', date: '2026-09-01', type: 'cross_bike', title: 'Radtour', durationSec: 5400, distanceKm: 40 },
    { id: 'x', date: '2026-09-03', type: 'easy', deleted: true },
  ]);
  assert.ok(csv.startsWith('﻿Datum;Sportart;Titel;Dauer (min);Distanz (km)'));
  const rows = lines(csv);
  assert.equal(rows.length, 3, 'Kopf + zwei Einträge, gelöschte nicht');
  assert.match(rows[1], /^2026-09-01;Radtour;Radtour;90,0;40,00;/, 'nach Datum sortiert');
  assert.match(rows[2], /^2026-09-02;Lockerer Lauf;Lauf;50,0;9,25;5:24;148;;4;200;/);
});

test('Texte: Trenner und Anführungszeichen maskiert, Formeln entschärft', () => {
  const csv = diaryCsv([
    { date: '2026-09-01', title: 'Porridge; mit „Beeren“ und "Honig"', kcal: 500.5, protein: 30 },
    { date: '2026-09-02', title: '=HYPERLINK("x")', kcal: 1 },
    { date: '2026-09-03', title: '-5 km locker', kcal: 1 },
  ]);
  const rows = lines(csv);
  assert.equal(rows[1], '2026-09-01;"Porridge; mit „Beeren“ und ""Honig""";500,5;30;');
  assert.equal(rows[2], `2026-09-02;"'=HYPERLINK(""x"")";1;;`);
  assert.equal(rows[3], "2026-09-03;'-5 km locker;1;;");
  assert.ok(toCsv([], [['A', () => '']]).startsWith('﻿A'), 'leere Tabelle: nur der Kopf');
});

test('Körperwerte, Labor (mit eigenem Referenzbereich) und Tagebuch', () => {
  const h = lines(healthCsv([{ date: '2026-09-01', weight: 72.4, bodyFat: 24.7, hrv: 48, hrvMethod: 'rmssd', sleepHours: 7.5 }]));
  assert.match(h[1], /^2026-09-01;72,4;24,7;;;;;48;RMSSD;;7,5;/);
  const l = lines(labsCsv([{ date: '2026-07-06', analyte: 'ferritin', value: 47, unit: 'µg/l', refLow: 15, refHigh: 150, note: 'nüchtern' }]));
  assert.equal(l[0], 'Datum;Wert;Messwert;Einheit;Referenz von;Referenz bis;Notiz');
  assert.equal(l[1], '2026-07-06;Ferritin;47;µg/l;15;150;nüchtern');
  const t = lines(diaryCsv([{ date: '2026-09-01', _kind: 'day', complete: true }, { date: '2026-09-01', title: 'Porridge', kcal: 520 }]));
  assert.equal(t.length, 2, '„Tag vollständig“ ist keine Mahlzeit');
});

test('Einstellungen bieten den Tabellen-Export an', () => {
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

test('MKT-15: Lesezugang ist aus, lässt sich einschalten (Schlüssel) und wieder ausschalten', () => {
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
  assert.doesNotMatch(view.textContent, /X-Catofit-Token/, 'aus: keine Adresse, kein Schlüssel');
  const sw = () => view.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Lesezugang erlauben');
  sw().checked = true;
  sw().dispatchEvent({ type: 'change', target: sw() });
  assert.match(store.profile().readToken, /^[0-9a-f]{48}$/);
  view = render();
  assert.ok(view.querySelectorAll('input').some((i) => String(i.value).includes('action=read')), 'Adresse wird angezeigt');
  sw().checked = false;
  sw().dispatchEvent({ type: 'change', target: sw() });
  assert.equal(store.profile().readToken, null);
});
