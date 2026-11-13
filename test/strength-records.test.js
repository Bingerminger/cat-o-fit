/* Strength in depth (4.2): estimated one-repetition maximum (Brzycki 1993), best values per exercise,
   a new personal record (only when an earlier value is beaten), the plate calculator – and where the
   app shows them (set logger, session review, exercise sheet). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { estimateOneRm, exerciseRecords, exerciseKey, newRecords, platesPerSide, PLATES, nextWeight } from '../js/strength.js';
import { recordsLine, newRecordText } from '../js/strength-ui.js';
import { setUnits, METRIC } from '../js/units.js';

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  setUnits(METRIC);
});

test('1RM: Brzycki up to 10 repetitions, none above, none without a weight', () => {
  assert.equal(estimateOneRm({ reps: 1, kg: 100 }), 100);
  assert.equal(estimateOneRm({ reps: 5, kg: 80 }), 90);          // 80 × 36 / 32
  assert.equal(estimateOneRm({ reps: 10, kg: 60 }), 80);         // 60 × 36 / 27
  assert.equal(estimateOneRm({ reps: 11, kg: 60 }), null, 'beyond ten reps the estimate is not reliable');
  assert.equal(estimateOneRm({ reps: 8, kg: null }), null);
  assert.equal(estimateOneRm({ reps: 8, kg: 0 }), null);
});

const S = (id, date, x) => ({ id, date, type: 'strength', strengthSets: [x] });
const sessions = [
  S('a', '2026-10-01', { exerciseId: 'deadlift', sets: [{ reps: 5, kg: 80 }, { reps: 8, kg: 70 }] }),
  S('b', '2026-10-08', { exerciseId: 'deadlift', sets: [{ reps: 3, kg: 90 }] }),
  S('c', '2026-10-08', { exerciseId: 'pushup', sets: [{ reps: 20, kg: null }, { reps: 25, kg: null }] }),
  S('d', '2026-10-09', { exerciseId: null, name: 'Bench Press (Barbell)', sets: [{ reps: 5, kg: 60 }] }),
];

test('best values per exercise: estimated 1RM, heaviest set, most reps without weight – each with its day', () => {
  const dl = exerciseRecords(sessions, 'deadlift');
  assert.equal(dl.oneRm.value, 95.3);                             // 90 × 36 / 34 beats 80 × 36 / 32 = 90
  assert.equal(dl.oneRm.date, '2026-10-08');
  assert.deepEqual([dl.weight.value, dl.weight.reps], [90, 3]);
  assert.equal(dl.reps, null);
  assert.equal(exerciseRecords(sessions, 'pushup').reps.value, 25);
  assert.equal(exerciseRecords(sessions, 'deadlift', { beforeDate: '2026-10-08' }).oneRm.value, 90);
  assert.equal(exerciseRecords(sessions, 'deadlift', { excludeId: 'b' }).weight.value, 80);
  // An exercise from another app counts by its name.
  assert.equal(exerciseKey(sessions[3].strengthSets[0]), 'name:bench press (barbell)');
  assert.equal(exerciseRecords(sessions, 'name:bench press (barbell)').weight.value, 60);
  assert.match(recordsLine(dl), /1RM ≈ 95,3\skg · schwerster Satz 3 × 90\skg/);
});

test('new record: only beating an earlier value counts, the first time is none', () => {
  const before = exerciseRecords(sessions, 'deadlift', { beforeDate: '2026-10-08' });
  assert.deepEqual(newRecords(before, [{ reps: 3, kg: 90 }]), { oneRm: 95.3, weight: 90, reps: null });
  assert.deepEqual(newRecords(before, [{ reps: 5, kg: 75 }]), { oneRm: null, weight: null, reps: null });
  assert.deepEqual(newRecords(exerciseRecords([], 'deadlift'), [{ reps: 5, kg: 200 }]), { oneRm: null, weight: null, reps: null });
  assert.match(newRecordText({ oneRm: 95.3, weight: 90, reps: null }), /1RM ≈ 95,3\skg, 90\skg bewegt/);
});

test('plate calculator: per side, greedy over the usual plates, rest and bar', () => {
  assert.deepEqual(platesPerSide(100, 20, PLATES.kg), { plates: [25, 15], rest: 0, under: false });
  assert.deepEqual(platesPerSide(62.5, 20, PLATES.kg), { plates: [20, 1.25], rest: 0, under: false });
  assert.deepEqual(platesPerSide(61, 20, PLATES.kg), { plates: [20], rest: 1, under: false }, '1 kg cannot be made up');
  assert.deepEqual(platesPerSide(20, 20, PLATES.kg), { plates: [], rest: 0, under: false });
  assert.equal(platesPerSide(15, 20, PLATES.kg).under, true);
  assert.deepEqual(platesPerSide(225, 45, PLATES.lb), { plates: [45, 45], rest: 0, under: false });
});

test('next weight in pounds: about 5 % on 2.5 / 5 lb steps', () => {
  setUnits({ ...METRIC, weight: 'lb' });
  assert.equal(nextWeight(100 * 0.45359237).text, '105 lb');
  assert.equal(nextWeight(20 * 0.45359237).text, '22,5 lb');
  assert.ok(nextWeight(20 * 0.45359237).pct > 0.1, '2.5 lb on 20 lb is more than 10 %');
});

test('session review: a set that beats the best so far is marked as a record', async () => {
  for (const s of sessions) store.upsert('sessions', s);
  const now = S('e', '2026-10-15', { exerciseId: 'deadlift', sets: [{ reps: 5, kg: 92.5 }] });
  store.upsert('sessions', now);
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) { const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  const { render } = await import('../js/session.js');
  render(view, 'e');
  assert.match(view.textContent, /🏆 Bestleistung: 1RM ≈ 104,1 kg, 92,5 kg bewegt/);
});
