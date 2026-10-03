/* =========================================================================
   layout-fixes.test.js — Darstellungsfehler, die beim Neurendern der Doku-Bilder
   (tools/render-screenshots.mjs, 390 × 844) sichtbar wurden: Wörter, die über
   Kacheln laufen oder mitten im Wort umbrechen, ein Banner auf halber Breite,
   Wetter über dem Zellrand. Geprüft wird die Regel im CSS und die Klasse im DOM.
   ========================================================================= */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as store from '../js/storage.js';
import * as events from '../js/events.js';
import * as health from '../js/health.js';
import * as calendar from '../js/calendar.js';
import { todayStr, addDays } from '../js/ui.js';

const read = (f) => readFileSync(new URL(`../css/${f}`, import.meta.url), 'utf8');
/** Deklarationsblock eines Selektors (erster Treffer). */
function rule(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `Regel ${selector} fehlt`);
  return css.slice(i, css.indexOf('}', i));
}

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events'].forEach((a) => store.replaceArea(a, []));
  store.setProfile({ name: 'Test', heightCm: 170, weightKg: 70, birthYear: 1990, sex: 'w' });
});

test('Abzeichen trennen an den weichen Trennstrichen („Tausend-sassa“) – nicht mitten im Wort', () => {
  const css = read('cards.css');
  for (const sel of ['.badge-card__name', '.badge-card__desc']) {
    const r = rule(css, sel);
    assert.doesNotMatch(r, /hyphens:\s*none/, `${sel}: „hyphens: none“ schaltet auch weiche Trennstriche ab`);
    assert.match(r, /hyphens:\s*manual/);
  }
});

test('Kennzahl-Kacheln: lange Wörter umbrechen statt über den Rand zu laufen', () => {
  const css = read('cards.css');
  assert.match(rule(css, '.stat'), /min-width:\s*0/);
  assert.match(rule(css, '.stat__label'), /hyphens:\s*auto/);
  assert.match(rule(css, '.stat-grid--pairs'), /minmax\(140px,\s*1fr\)/);
});

test('Wettkampf-Detail: Distanz als Zahl, Streckenname darunter', () => {
  store.replaceArea('events', [{ id: 'e1', name: 'Stadtlauf', kind: 'race', date: addDays(todayStr(), 40), distanceType: 'HM', distanceKm: 21.0975, targetTime: '01:55:00' }]);
  const view = setupShell();
  events.renderDetail(view, 'e1');
  const stat = view.querySelectorAll('.stat')[0];
  assert.equal(stat.querySelector('.stat__val').textContent, '21,1\u00a0km', 'vorher „Halbmarathon“ – passte nicht in die Kachel');
  assert.equal(stat.querySelector('.stat__label').textContent, 'Halbmarathon');
});

test('Körperwerte: Kacheln paarweise (iPhone) statt vier zu schmale nebeneinander', () => {
  const t = todayStr();
  store.replaceArea('health', [
    { id: 'h1', date: addDays(t, -9), weight: 72.6, bodyFat: 25, muscleMass: 28, restingHr: 52 },
    { id: 'h2', date: t, weight: 72.3, bodyFat: 24.7, muscleMass: 28.2, restingHr: 50 },
  ]);
  const view = setupShell();
  health.render(view);
  const grid = view.querySelectorAll('.stat-grid').find((g) => g.querySelector('.metric-tile'));
  assert.ok(grid, 'Kachel-Übersicht vorhanden');
  assert.ok(grid.className.includes('stat-grid--pairs'));
});

test('Workout: Trinkpausen-Banner nimmt seine Textbreite, nicht die halbe Bildschirmbreite', () => {
  assert.match(rule(read('workout-mode.css'), '.workout__drink'), /width:\s*max-content/);
});

test('Kalender: Wetter rutscht in schmalen Zellen unter das Datum', () => {
  assert.match(rule(read('calendar.css'), '.cal-cell__head'), /flex-wrap:\s*wrap/);
  const view = setupShell();
  calendar.render(view);
  const cell = view.querySelectorAll('.cal-cell')[0];
  assert.ok(cell.querySelector('.cal-cell__head'), 'Kopfzeile der Zelle trägt die Klasse');
});
