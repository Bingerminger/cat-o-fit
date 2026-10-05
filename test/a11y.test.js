/* =========================================================================
   a11y.test.js — operability of the basic building blocks (package G):
   UI-04  button groups not inside <label> (tapping the caption selected the 1st option)
   UI-19  sheets as dialogs: name, Escape, focus returns to the trigger
   UI-25  RPE scale with anchors as a radio group, duration with units
   FE-15  segments as a radio group (aria-checked)
   ========================================================================= */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  el, field, input, segmented, openSheet, closeSheet, rpeScale, feelingPicker, durationFields, RPE_WORDS,
} from '../js/ui.js';
import * as store from '../js/storage.js';
import * as settings from '../js/settings.js';

const doc = globalThis.document;
beforeEach(() => {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'view', 'modal-root']) doc.body.appendChild(el('div', { id }));
});
const radios = (node) => node.querySelectorAll('button').filter((b) => b.getAttribute('role') === 'radio');

test('UI-04: button groups sit in a named group, not in <label>', () => {
  const f = field('Anstrengung (RPE)', rpeScale(0, () => {}));
  assert.equal(f.tagName, 'DIV', 'no <label>: otherwise every tap on the caption lands on RPE 1');
  const label = f.querySelectorAll('.field__label')[0];
  const group = f.querySelectorAll('.rpe-scale')[0];
  assert.equal(group.getAttribute('role'), 'radiogroup');
  assert.equal(group.getAttribute('aria-labelledby'), label.getAttribute('id'), 'group carries the field name');

  const g2 = field('Portionsgröße', el('div', { class: 'row' }, [el('button', { text: 'Klein' }), el('button', { text: 'Mittel' })]));
  assert.equal(g2.tagName, 'DIV');
  assert.equal(g2.getAttribute('role'), 'group');

  // Input fields keep the <label> (tapping the caption places the cursor).
  assert.equal(field('Gewicht', input({ type: 'number' })).tagName, 'LABEL');
  assert.equal(field('Dauer', durationFields({ min: 30 }).node).tagName, 'LABEL');
});

test('FE-15: segments are a radio group with aria-checked and a single tab stop', () => {
  let picked = null;
  const s = segmented([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a', (v) => { picked = v; });
  assert.equal(s.getAttribute('role'), 'radiogroup');
  const [a, b] = radios(s);
  assert.equal(a.getAttribute('aria-checked'), 'true');
  assert.equal(b.getAttribute('tabindex'), '-1');
  b.click();
  assert.equal(picked, 'b');
  assert.equal(a.getAttribute('aria-checked'), 'false');
  assert.equal(b.getAttribute('aria-checked'), 'true');
  assert.equal(b.getAttribute('tabindex'), '0');
});

test('UI-25: RPE scale with anchors – every level named, selection announced', () => {
  let v = 0;
  const s = rpeScale(0, (x) => { v = x; });
  const r = radios(s);
  assert.equal(r.length, 10);
  assert.equal(r[6].getAttribute('aria-label'), '7 – hart');
  assert.equal(r[0].getAttribute('aria-label'), '1 – sehr leicht');
  assert.equal(RPE_WORDS[10], 'maximal');
  assert.match(s.textContent, /1 sehr leicht · 3 locker · 5 mittel · 7 hart · 10 maximal/);
  r[6].click();
  assert.equal(v, 7);
  assert.equal(r[6].getAttribute('aria-checked'), 'true');
  assert.match(s.textContent, /7 = hart/);
  const f = feelingPicker('gut', () => {});
  assert.equal(radios(f).find((b) => b.getAttribute('aria-checked') === 'true').getAttribute('aria-label'), 'gut');
});

test('UI-25: duration fields carry unit and name', () => {
  const d = durationFields({ min: 45, sec: 30 });
  assert.equal(d.minI.getAttribute('aria-label'), 'Dauer in Minuten');
  assert.equal(d.secI.getAttribute('aria-label'), 'Sekunden');
  assert.match(d.node.textContent, /min.*s/);
});

test('UI-19: sheet is named, Escape closes it, focus returns to the trigger', () => {
  const trigger = el('button', { text: 'Öffnen' });
  doc.getElementById('view').appendChild(trigger);
  let focused = null;
  trigger.focus = () => { focused = trigger; };
  trigger.isConnected = true;
  doc.activeElement = trigger;
  let closed = 0;
  const { sheet } = openSheet({ title: 'Körperwerte erfassen', body: el('p', { text: 'x' }), onClose: () => { closed++; } });
  assert.equal(sheet.getAttribute('role'), 'dialog');
  const titleId = sheet.getAttribute('aria-labelledby');
  assert.ok(titleId, 'dialog has a name');
  assert.equal(sheet.querySelectorAll(`#${titleId}`)[0].textContent, 'Körperwerte erfassen');
  sheet.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(closed, 1, 'Escape closes');
  assert.equal(doc.getElementById('modal-root').classList.contains('is-open'), false);
  assert.equal(focused, trigger, 'focus returns to the trigger');
  delete doc.activeElement;
});

test('UI-19: if the trigger was redrawn after saving, focus lands on the page title', () => {
  const title = doc.getElementById('header-title');
  let focused = null;
  title.focus = () => { focused = title; };
  const gone = el('button');       // no longer in the document (isConnected missing)
  doc.activeElement = gone;
  openSheet({ title: 'Test' });
  closeSheet();
  assert.equal(focused, title);
  delete doc.activeElement;
});

test('UI-18: every switch in the settings has a name', async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  for (const id of ['header-subtitle', 'header-back', 'header-actions']) doc.body.appendChild(el('div', { id }));
  const view = doc.getElementById('view');
  settings.render(view);
  const boxes = view.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'checkbox');
  assert.ok(boxes.length >= 15, `only ${boxes.length} switches found`);
  const unnamed = boxes.filter((b) => !(b.getAttribute('aria-label') || '').trim());
  assert.equal(unnamed.length, 0, `${unnamed.length} switches without a name`);
  assert.ok(boxes.some((b) => b.getAttribute('aria-label') === 'Modul Ernährung'));
});

test('UI-36: backup on iPhone via the share menu, on the Mac as a download – neutral message', async () => {
  const { saveFile, savedFileMessage } = await import('../js/ui.js');
  const realMM = globalThis.matchMedia;
  const realNav = globalThis.navigator;
  let shared = null;
  try {
    globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { ...realNav, canShare: () => true, share: async (d) => { shared = d; } } });
    const blob = new Blob(['{}'], { type: 'application/json' });
    assert.equal(await saveFile('catofit-backup.json', blob), 'shared');
    assert.equal(shared.files[0].name, 'catofit-backup.json');
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    assert.equal(await saveFile('catofit-backup.json', blob), 'downloaded');
    assert.doesNotMatch(savedFileMessage('downloaded', 'x.json'), /heruntergeladen/);
  } finally {
    globalThis.matchMedia = realMM;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: realNav });
  }
});

test('UI-15: settings start with a jump bar to the sections', async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin' }], settings: {} });
  await store.login('u-1', '');
  for (const id of ['header-subtitle', 'header-back', 'header-actions']) if (!doc.getElementById(id)) doc.body.appendChild(el('div', { id }));
  const view = doc.getElementById('view');
  view.innerHTML = '';
  settings.render(view);
  const nav = view.childNodes[0];
  assert.equal(nav.getAttribute('aria-label'), 'Abschnitte der Einstellungen');
  const labels = nav.querySelectorAll('button').map((b) => b.textContent);
  assert.ok(labels.includes('Module') && labels.includes('Daten & Backup'), labels.join(', '));
});
