/* FE-18 (Rest): gemeinsame Helfer statt Kopien – Dezimalkomma (fmtDec), Mitgliedsfarben
   (safeAccent/colorTint) und Neuzeichnen (rerenderView). Der Wächter unten verhindert, dass
   Kopien zurückkehren. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as store from '../js/storage.js';
import { el, fmtDec, colorTint, rerenderView } from '../js/ui.js';
import { render as renderLogin } from '../js/login.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

test('fmtDec: Dezimalkomma, Strich für fehlende Werte', () => {
  assert.equal(fmtDec(7.5), '7,5');
  assert.equal(fmtDec('12'), '12');
  assert.equal(fmtDec(null), '–');
  assert.equal(fmtDec(undefined), '–');
});

test('colorTint: nur echte Hex-Farben, kurze werden ausgeschrieben', () => {
  assert.equal(colorTint('#18b48a'), '#18b48a22');
  assert.equal(colorTint('#abc'), '#aabbcc22');
  assert.equal(colorTint('#fff url(https://x.example/a.png)'), '#18b48a22');
  assert.equal(colorTint('var(--accent)'), '#18b48a22');
});

test('rerenderView: leert die Ansicht und zeichnet neu', () => {
  const view = setupShell();
  view.appendChild(el('span', { text: 'alt' }));
  rerenderView((v) => v.appendChild(el('span', { text: 'neu' })));
  assert.equal(view.textContent, 'neu');
});

test('Anmeldung: eine manipulierte Mitgliedsfarbe erreicht das Stylesheet nicht', () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin', color: '#fff url(https://x.example/a.png)' }], settings: {}, pantry: [] });
  const view = setupShell();
  renderLogin(view);
  const avatars = view.querySelectorAll('span').filter((s) => String(s.className).includes('member-card__avatar'));
  assert.ok(avatars.length >= 1);
  for (const a of avatars) {
    assert.ok(!/url/i.test(`${a.style.background} ${a.style.color}`), `Stil: ${a.style.background} / ${a.style.color}`);
    assert.equal(a.style.background, '#18b48a22');
  }
});

test('Wächter: keine kopierten Helfer mehr in den Modulen', () => {
  const dir = join(import.meta.dirname, '..', 'js');
  const offenders = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    if (!['ui.js', 'csv-export.js'].includes(f) && src.includes(".replace('.', ',')")) offenders.push(`${f}: Dezimalkomma von Hand`);
    if (/const hex = \(c\)/.test(src)) offenders.push(`${f}: eigene hex()-Kopie`);
    if (/function rerender\([^)]*\) \{ refreshView\(/.test(src)) offenders.push(`${f}: eigene rerender()-Kopie`);
  }
  assert.deepEqual(offenders, []);
});
