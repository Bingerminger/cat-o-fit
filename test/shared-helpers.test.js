/* FE-18 (remainder): shared helpers instead of copies – decimal comma (fmtDec), member colours
   (safeAccent/colorTint) and redrawing (rerenderView). The guard below prevents copies
   from coming back. */
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

test('fmtDec: decimal comma, dash for missing values', () => {
  assert.equal(fmtDec(7.5), '7,5');
  assert.equal(fmtDec('12'), '12');
  assert.equal(fmtDec(null), '–');
  assert.equal(fmtDec(undefined), '–');
});

test('colorTint: real hex colours only, short ones are expanded', () => {
  assert.equal(colorTint('#18b48a'), '#18b48a22');
  assert.equal(colorTint('#abc'), '#aabbcc22');
  assert.equal(colorTint('#fff url(https://x.example/a.png)'), '#18b48a22');
  assert.equal(colorTint('var(--accent)'), '#18b48a22');
});

test('rerenderView: clears the view and redraws', () => {
  const view = setupShell();
  view.appendChild(el('span', { text: 'alt' }));
  rerenderView((v) => v.appendChild(el('span', { text: 'neu' })));
  assert.equal(view.textContent, 'neu');
});

test('Login: a tampered member colour does not reach the stylesheet', () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin', color: '#fff url(https://x.example/a.png)' }], settings: {}, pantry: [] });
  const view = setupShell();
  renderLogin(view);
  const avatars = view.querySelectorAll('span').filter((s) => String(s.className).includes('member-card__avatar'));
  assert.ok(avatars.length >= 1);
  for (const a of avatars) {
    assert.ok(!/url/i.test(`${a.style.background} ${a.style.color}`), `Style: ${a.style.background} / ${a.style.color}`);
    assert.equal(a.style.background, '#18b48a22');
  }
});

test('Guard: no copied helpers left in the modules', () => {
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
