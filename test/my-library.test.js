/* Own exercises, own workouts and a workout assigned to a planned session (4.2). */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { saveMyExercise, removeMyExercise, myExercises, saveMyWorkout, removeMyWorkout, myWorkouts, findWorkout } from '../js/my-library.js';
import { findExercise, suggestedExercisesFor, render as renderLibrary } from '../js/exercises.js';
import { programForPlanned, programForWorkout, buildShow } from '../js/show-program.js';
import { exerciseRecords } from '../js/strength.js';

const doc = globalThis.document;
function shell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root', 'toast-root']) { const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('own exercise: found like a library one, suggested first for strength, records by its id', () => {
  const id = saveMyExercise({ name: '  Latzug   am Kabel ', category: 'strength', gear: 'Kabelzug', notes: 'Brust raus\nZur Brust ziehen' });
  const e = findExercise(id);
  assert.equal(e.name, 'Latzug am Kabel');
  assert.equal(e.custom, true);
  assert.equal(e.art, 'squat', 'picture by kind');
  assert.deepEqual(e.steps, ['Brust raus', 'Zur Brust ziehen']);
  assert.equal(suggestedExercisesFor('strength')[0].id, id);
  assert.ok(!suggestedExercisesFor('mobility').some((x) => x.id === id));
  const rec = exerciseRecords([{ id: 's', date: '2026-11-01', strengthSets: [{ exerciseId: id, sets: [{ reps: 8, kg: 50 }] }] }], id);
  assert.equal(rec.weight.value, 50);
  saveMyExercise({ id, name: 'Latzug', category: 'strength', art: 'row' });
  assert.equal(myExercises().length, 1, 'edited, not added');
  assert.equal(findExercise(id).art, 'row');
  removeMyExercise(id);
  assert.equal(findExercise(id), null);
});

test('own workout: plays like a catalogue one; deleted, a session falls back to its text', () => {
  const id = saveMyWorkout({ title: 'Morgenrunde', items: ['squat', 'pushup', 'plank'], work: 30, rest: 15, rounds: 3 });
  const w = findWorkout(id);
  assert.deepEqual([w.title, w.work, w.rest, w.rounds, w.items.length], ['Morgenrunde', 30, 15, 3, 3]);
  const prog = programForWorkout(w);
  assert.equal(prog.items.length, 3);
  assert.ok(buildShow(prog).total > 3 * 3 * 30);
  const unit = { id: 'k', type: 'strength', title: 'Kraft', description: 'Kniebeugen 12× · Liegestütz 10×', workoutId: id };
  assert.equal(programForPlanned(unit).workoutId, id, 'the assigned workout replaces the text');
  removeMyWorkout(id);
  assert.equal(myWorkouts().length, 0);
  assert.equal(programForPlanned(unit).workoutId, undefined, 'gone: back to the plan text');
  assert.equal(programForPlanned({ ...unit, workoutId: 'ganzkoerper' }).workoutId, 'ganzkoerper', 'a catalogue workout works too');
});

test('library: own exercise and own workout appear first, marked as own', () => {
  saveMyExercise({ name: 'Latzug', category: 'strength' });
  saveMyWorkout({ title: 'Morgenrunde', items: ['squat', 'plank'] });
  const view = shell();
  renderLibrary(view);
  assert.match(view.textContent, /Eigene Übung anlegen/);
  assert.match(view.querySelectorAll('.ex-card')[0].textContent, /Latzug.*Eigene/);
  view.querySelectorAll('button').find((b) => /^Workouts/.test(b.textContent)).click();
  assert.match(view.textContent, /Eigenes Workout zusammenstellen/);
  assert.match(view.querySelectorAll('.wo-card')[0].textContent, /Morgenrunde/);
});

test('editors: an own exercise and an own workout are saved from their sheets', async () => {
  const { openMyExerciseSheet, openMyWorkoutSheet } = await import('../js/my-library-ui.js');
  shell();
  const root = doc.getElementById('modal-root');
  openMyExerciseSheet(null);
  root.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Name').value = 'Beinpresse';
  root.querySelectorAll('button').find((b) => b.textContent === 'Speichern').click();
  assert.equal(myExercises()[0].name, 'Beinpresse');
  openMyWorkoutSheet(null);
  root.querySelectorAll('input').find((i) => i.getAttribute('aria-label') === 'Name des Workouts').value = 'Kurz & knackig';
  root.querySelectorAll('button').find((b) => b.textContent === 'Speichern').click();
  assert.equal(myWorkouts().length, 0, 'without an exercise nothing is saved');
  const add = root.querySelectorAll('select').find((s) => s.getAttribute('aria-label') === 'Übung hinzufügen …');
  add.value = 'squat'; add.dispatchEvent(new Event('change'));
  root.querySelectorAll('button').find((b) => b.textContent === 'Speichern').click();
  assert.deepEqual(myWorkouts().map((w) => [w.title, w.items]), [['Kurz & knackig', ['squat']]]);
});

test('planned session: assign a workout, follow it along, remove it again', async () => {
  const unit = { id: 'k1', date: '2026-12-01', type: 'strength', title: 'Kraft – Ganzkörper', description: 'Kniebeugen 12× · Liegestütz 10×', status: 'geplant' };
  store.upsert('plans', { id: 'p1', eventId: 'e1', units: [unit] });
  const { render } = await import('../js/session.js');
  let view = shell();
  render(view, 'k1');
  assert.match(view.textContent, /Workout zuordnen/);
  view.querySelectorAll('button').find((b) => b.textContent === 'Workout zuordnen').click();
  await new Promise((r) => setTimeout(r, 20));
  doc.getElementById('modal-root').querySelectorAll('button').find((b) => /Ganzkörper/.test(b.textContent)).click();
  assert.equal(store.find('plans', 'p1').units[0].workoutId, 'ganzkoerper');
  view = shell();
  render(view, 'k1');
  assert.match(view.textContent, /Zugeordnet: /);
  assert.match(view.textContent, /mitmachen · ≈ \d+\smin/);
  view.querySelectorAll('button').find((b) => b.textContent === 'Lösen').click();
  assert.equal(store.find('plans', 'p1').units[0].workoutId, null);
});
