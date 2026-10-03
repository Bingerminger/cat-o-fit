/* UI-39: Ein Bericht wird erst nach der Vorschau versiegelt – „Ändern“ führt zurück ins
   Formular (Eingaben bleiben), „Bericht speichern“ legt ihn unveränderlich ab. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { render } from '../js/reports.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
const btn = (root, text) => root.querySelectorAll('button').find((b) => b.textContent.trim() === text);

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('Monatsbericht: erst Vorschau, dann versiegeln; „Ändern“ speichert nichts', () => {
  const view = setupShell();
  render(view);
  btn(view, 'Bericht erstellen').click();
  const root = doc.querySelector('#modal-root');
  btn(root, 'Monatsbericht erstellen').click();
  assert.equal(store.get('reports').length, 0, 'noch nicht gespeichert');
  assert.match(root.textContent, /Vorschau – nach dem Speichern bleibt der Bericht unverändert/);
  assert.ok(root.querySelectorAll('div').some((d) => String(d.className).includes('report-sheet')), 'Bericht als Vorschau');
  btn(root, 'Ändern').click();
  assert.equal(store.get('reports').length, 0);
  btn(root, 'Monatsbericht erstellen').click();
  btn(root, 'Bericht speichern').click();
  assert.equal(store.get('reports').length, 1, 'erst jetzt versiegelt');
});

test('Urkunde: Titel bleibt nach „Ändern“ erhalten, gespeichert wird mit Titel', () => {
  const view = setupShell();
  render(view);
  btn(view, 'Bericht erstellen').click();
  const root = doc.querySelector('#modal-root');
  btn(root, 'Urkunde').click();
  const title = root.querySelectorAll('input').find((i) => i.getAttribute('placeholder') === 'z. B. Zielgewicht erreicht');
  title.value = '14 Wochen am Stück';
  btn(root, 'Urkunde erstellen').click();
  assert.equal(store.get('reports').length, 0);
  btn(root, 'Ändern').click();
  assert.equal(title.value, '14 Wochen am Stück', 'Eingabe bleibt');
  btn(root, 'Urkunde erstellen').click();
  btn(root, 'Urkunde speichern').click();
  const r = store.get('reports');
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'goal');
});
