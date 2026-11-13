/* =========================================================================
   my-library.js — the person's own exercises and follow-along workouts (since 4.2).

   Stored in the profile settings (`customExercises`, `customWorkouts`): synced field by field like every
   setting, part of every backup, and only the person's. Own exercises have no animation – they borrow the
   picture of a library exercise and are for logging sets; own workouts are put together from library
   exercises (those can be followed along) with work and rest time and rounds, like the catalogue.
   ========================================================================= */

import * as store from './storage.js';
import { uid } from './ui.js';
import { WORKOUTS } from './workouts.js';

/** Categories an own exercise can have (the library's, without prevention). */
export const MY_CATEGORIES = ['strength', 'core', 'mobility', 'cardio'];
/** Picture of an own exercise by category, when none was chosen. */
const ART_BY_CATEGORY = { strength: 'squat', core: 'plank', mobility: 'cat_cow', cardio: 'jumping_jack' };
/** Choices for an own workout. */
export const WORK_CHOICES = [20, 30, 40, 45, 60];
export const REST_CHOICES_WO = [10, 15, 20, 30];
export const ROUND_CHOICES = [1, 2, 3, 4];
const clampText = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** An own exercise as the library shapes exercises (findExercise, cards, set logging). */
export function shapeExercise(x) {
  if (!x || !x.id || !x.name) return null;
  const category = MY_CATEGORIES.includes(x.category) ? x.category : 'strength';
  const notes = String(x.notes || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return {
    id: x.id, name: clampText(x.name, 60), category, difficulty: 1, custom: true,
    art: x.art || ART_BY_CATEGORY[category], look: x.art || null,
    hold: x.hold === true, aliases: [], muscles: [], steps: notes, notesText: String(x.notes || ''),
    equipment: clampText(x.gear, 60), gear: clampText(x.gear, 60), tip: '', caution: '', progression: '',
  };
}

/** The person's own exercises (shaped like library exercises). */
export function myExercises() {
  return (store.settings().customExercises || []).map(shapeExercise).filter(Boolean);
}

/** Saves an own exercise (new: id assigned); returns its id. */
export function saveMyExercise({ id = null, name, category = 'strength', hold = false, gear = '', notes = '', art = null }) {
  const list = (store.settings().customExercises || []).slice();
  const rec = { id: id || uid('myx'), name: clampText(name, 60), category, hold: !!hold, gear: clampText(gear, 60), notes: String(notes || '').slice(0, 1000), art: art || null };
  const i = list.findIndex((x) => x && x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  store.setSetting('customExercises', list);
  return rec.id;
}

export function removeMyExercise(id) {
  store.setSetting('customExercises', (store.settings().customExercises || []).filter((x) => x && x.id !== id));
}

/** An own workout as the catalogue shapes workouts (programForWorkout, cards). */
export function shapeWorkout(w) {
  if (!w || !w.id || !Array.isArray(w.items) || !w.items.length) return null;
  const pick = (v, list, d) => (list.includes(Number(v)) ? Number(v) : d);
  return {
    id: w.id, custom: true, cat: 'mine', level: 1, style: w.style || null,
    title: clampText(w.title, 60), subtitle: '',
    work: pick(w.work, WORK_CHOICES, 40), rest: pick(w.rest, REST_CHOICES_WO, 20),
    rounds: pick(w.rounds, ROUND_CHOICES, 2), roundRest: 60,
    items: w.items.filter((x) => typeof x === 'string').slice(0, 30),
  };
}

/** The person's own workouts. */
export function myWorkouts() {
  return (store.settings().customWorkouts || []).map(shapeWorkout).filter(Boolean);
}

export function saveMyWorkout({ id = null, title, items, work = 40, rest = 20, rounds = 2 }) {
  const list = (store.settings().customWorkouts || []).slice();
  const rec = { id: id || uid('myw'), title: clampText(title, 60), items: (items || []).filter((x) => typeof x === 'string').slice(0, 30), work, rest, rounds };
  const i = list.findIndex((x) => x && x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  store.setSetting('customWorkouts', list);
  return rec.id;
}

export function removeMyWorkout(id) {
  store.setSetting('customWorkouts', (store.settings().customWorkouts || []).filter((x) => x && x.id !== id));
}

/** A workout by id: from the catalogue or the person's own; null when gone. */
export function findWorkout(id) {
  if (!id) return null;
  return WORKOUTS.find((w) => w.id === id) || myWorkouts().find((w) => w.id === id) || null;
}
