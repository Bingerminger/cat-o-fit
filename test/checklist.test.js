/* Tests für die Kalender-Anbindung der Checkliste (js/checklist.js):
   datedItems() liefert die Termine (Einträge mit Datum) eines Tages – nach
   Uhrzeit sortiert, ohne Routinen, ohne gelöschte Einträge. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { datedItems } from '../js/checklist.js';

beforeEach(() => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'A', role: 'admin' }], settings: {} });
});

test('datedItems liefert nur Termine des Tages, nach Uhrzeit sortiert (ohne Zeit ans Ende)', async () => {
  await store.login('u-1', '');
  store.replaceArea('checklist', [
    { id: 'r1', text: 'Routine', recurring: true, dueDate: null },        // Routine -> nie im Kalender
    { id: 't1', text: 'Spät', dueDate: '2026-07-01', time: '18:00' },
    { id: 't2', text: 'Früh', dueDate: '2026-07-01', time: '08:30' },
    { id: 't3', text: 'Ohne Zeit', dueDate: '2026-07-01', time: null },
    { id: 't4', text: 'Anderer Tag', dueDate: '2026-07-02', time: '09:00' },
  ]);
  assert.deepEqual(datedItems('2026-07-01').map((i) => i.text), ['Früh', 'Spät', 'Ohne Zeit']);
  assert.equal(datedItems('2026-07-03').length, 0);          // Tag ohne Termine
});

test('datedItems blendet gelöschte Termine (Tombstones) aus', async () => {
  await store.login('u-1', '');
  store.replaceArea('checklist', [{ id: 'tx', text: 'Weg', dueDate: '2026-07-01', time: '10:00' }]);
  store.remove('checklist', 'tx');
  assert.equal(datedItems('2026-07-01').length, 0);
});
