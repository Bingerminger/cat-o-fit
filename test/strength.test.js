/* MKT-11/TRAIN-52: strength training with repetitions and weight per set, "last time"
   and double progression – plus carrying over all import fields when assigning
   to a planned unit (calories, ascent and route used to get lost). */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { cleanSet, fmtSet, volume, toStrengthSets, lastSetsFor, progressionHint, REP_TOP } from '../js/strength.js';
import { completeUnit } from '../js/session.js';
import { render as renderWorkout } from '../js/workout-mode.js';
import { todayStr } from '../js/ui.js';

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('Sets: clean up, display, volume', () => {
  assert.deepEqual(cleanSet({ reps: '12', kg: '22,5' }), { reps: 12, kg: 22.5 });
  assert.deepEqual(cleanSet({ reps: 10, kg: '' }), { reps: 10, kg: null });
  assert.equal(cleanSet({ reps: 0, kg: 20 }), null, 'no set without repetitions');
  assert.equal(fmtSet({ reps: 12, kg: 22.5 }), '12 × 22,5 kg');
  assert.equal(fmtSet({ reps: 15, kg: null }), '15 Wdh.');
  assert.equal(volume([{ reps: 10, kg: 20 }, { reps: 8, kg: 25 }, { reps: 12, kg: null }]), 400);
  assert.deepEqual(toStrengthSets({ squat: [{ reps: 10, kg: 40 }], plank: [] }), [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 40 }] }]);
});

test('Last time and double progression', () => {
  const sessions = [
    { date: '2026-09-10', strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 40 }] }] },
    { date: '2026-09-17', strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 12, kg: 40 }, { reps: 12, kg: 40 }] }] },
    { date: '2026-09-24', strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 8, kg: 45 }] }] },
  ];
  assert.equal(lastSetsFor(sessions, 'squat', '2026-09-24').date, '2026-09-17', 'before the current day');
  assert.equal(lastSetsFor(sessions, 'lunge'), null);
  assert.match(progressionHint([{ reps: REP_TOP, kg: 40 }, { reps: REP_TOP, kg: 40 }]), /etwa 42,5 kg/);
  assert.match(progressionHint([{ reps: 12, kg: 6 }]), /etwa 7 kg/, 'light dumbbells: +1 kg');
  assert.match(progressionHint([{ reps: 9, kg: 40 }, { reps: 12, kg: 40 }]), /Wiederholungen steigern/);
  assert.match(progressionHint([{ reps: 15, kg: null }]), /schwerere Variante/);
});

test('Assigning to the planned unit carries over sets, calories, ascent and route', () => {
  const unit = { id: 'u1', date: todayStr(), type: 'strength', title: 'Kraft' };
  const plan = { id: 'p1', eventId: 'e1', units: [unit] };
  store.upsert('plans', plan);
  const s = completeUnit(plan, unit, {
    durationSec: 2400, kcal: 310, ascentM: 12, route: { poly: 'abc' },
    strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 40 }] }],
  });
  assert.equal(s.kcal, 310);
  assert.equal(s.ascentM, 12);
  assert.deepEqual(s.route, { poly: 'abc' });
  assert.deepEqual(s.strengthSets, [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 40 }] }]);
});

test('Workout mode: record sets per linked exercise and save them on finishing', () => {
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  const unit = { id: 'k1', date: todayStr(), type: 'strength', title: 'Kraft', exerciseIds: ['squat'], status: 'geplant' };
  store.upsert('plans', { id: 'p2', eventId: 'e2', units: [unit] });
  store.upsert('sessions', { id: 'alt', date: '2026-01-05', type: 'strength', strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 12, kg: 30 }, { reps: 12, kg: 30 }] }] });
  renderWorkout(view, 'k1');
  assert.match(view.textContent, /Letztes Mal: 12 × 30\u00a0kg · 12 × 30\u00a0kg/);
  assert.match(view.textContent, /etwa 32,5\u00a0kg/);
  const reps = view.querySelectorAll('input').find((i) => /Wiederholungen$/.test(i.getAttribute('aria-label') || ''));
  const kg = view.querySelectorAll('input').find((i) => /Gewicht \(kg\)$/.test(i.getAttribute('aria-label') || ''));
  assert.ok(reps && kg, 'inputs for repetitions and weight');
  reps.value = '10'; kg.value = '32,5';
  view.querySelectorAll('button').find((b) => b.textContent === '+ Satz').click();
  assert.match(view.textContent, /1\. 10 × 32,5\u00a0kg/);
  view.querySelectorAll('button').find((b) => b.textContent.includes('Training beenden')).click();
  doc.querySelector('#modal-root').querySelectorAll('button').find((b) => b.textContent.includes('Speichern & abschließen')).click();
  const saved = store.get('sessions').find((x) => x.plannedId === 'k1');
  assert.ok(saved, 'unit done');
  assert.deepEqual(saved.strengthSets, [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 32.5 }] }]);
});

test('Workout mode: hold exercises (plank …) get no set recording by repetitions', async () => {
  const { EXERCISES } = await import('../js/exercises.js');
  const hold = EXERCISES.filter((e) => e.hold).map((e) => e.id);
  for (const id of ['hollow_hold', 'plank', 'pogo_jumps', 'side_plank', 'wall_sit']) assert.ok(hold.includes(id), id);
  assert.ok(!hold.includes('squat') && !hold.includes('pushup'));
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  store.upsert('plans', { id: 'p3', eventId: 'e3', units: [{ id: 'k3', date: todayStr(), type: 'strength', title: 'Kraft', exerciseIds: ['squat', 'plank'], status: 'geplant' }] });
  renderWorkout(view, 'k3');
  const repInputs = view.querySelectorAll('input').filter((i) => /Wiederholungen$/.test(i.getAttribute('aria-label') || ''));
  assert.deepEqual(repInputs.map((i) => i.getAttribute('aria-label')), ['Kniebeuge: Wiederholungen']);
});
