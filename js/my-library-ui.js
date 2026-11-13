/* =========================================================================
   my-library-ui.js — sheets for the person's own exercises and workouts (since 4.2): create, edit,
   delete, and pick a workout for a planned session. The data live in my-library.js.
   ========================================================================= */

import {
  el, icon, input, textarea, select, field, segmented, toggle, openSheet, closeSheet, toast, confirmDialog,
} from './ui.js';
import { EXERCISES, EX_CATEGORIES } from './exercises.js';
import { MOTIONS } from './exercise-motions.js';
import { WORKOUTS } from './workouts.js';
import {
  saveMyExercise, removeMyExercise, saveMyWorkout, removeMyWorkout, myWorkouts,
  MY_CATEGORIES, WORK_CHOICES, REST_CHOICES_WO, ROUND_CHOICES,
} from './my-library.js';

import { t } from './i18n.js';

const byName = (a, b) => a.name.localeCompare(b.name);

/** Create or edit an own exercise; `onSaved()` afterwards. */
export function openMyExerciseSheet(existing = null, { onSaved = () => {} } = {}) {
  const ex = existing || {};
  const nameI = input({ value: ex.name || '', maxlength: '60', 'aria-label': t('myLibrary.name') });
  let category = ex.category || 'strength';
  let hold = !!ex.hold;
  const gearI = input({ value: ex.gear || '', maxlength: '60', placeholder: t('myLibrary.gearPlaceholder') });
  const notesI = textarea({ rows: '4', maxlength: '1000', placeholder: t('myLibrary.notesPlaceholder') });
  notesI.value = ex.notesText || '';
  const lookSel = select([{ value: '', label: t('myLibrary.lookDefault') }, ...EXERCISES.slice().sort(byName).map((e) => ({ value: e.id, label: e.name }))], ex.look || '');
  const cats = EX_CATEGORIES.filter((c) => MY_CATEGORIES.includes(c.key)).map((c) => ({ value: c.key, label: c.label }));
  const save = () => {
    const name = nameI.value.trim();
    if (!name) { toast(t('myLibrary.nameMissing'), 'bad'); return; }
    saveMyExercise({ id: ex.id || null, name, category, hold, gear: gearI.value, notes: notesI.value, art: lookSel.value || null });
    closeSheet();
    toast(t('myLibrary.saved'), 'good');
    onSaved();
  };
  openSheet({
    title: existing ? t('myLibrary.editExercise') : t('myLibrary.newExercise'),
    body: el('div', {}, [
      field(t('myLibrary.name'), nameI),
      field(t('myLibrary.category'), segmented(cats, category, (v) => { category = v; }, { label: t('myLibrary.category') })),
      el('div', { class: 'row mt-2', style: { justifyContent: 'space-between', alignItems: 'center' } }, [
        el('span', { text: t('myLibrary.countsByTime') }),
        toggle(hold, (v) => { hold = v; }, t('myLibrary.countsByTime')),
      ]),
      field(t('myLibrary.gear'), gearI),
      field(t('myLibrary.notes'), notesI),
      field(t('myLibrary.look'), lookSel),
      el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: t('myLibrary.noAnimation') }),
    ]),
    footer: [
      existing ? el('button', { class: 'btn btn--ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: t('myLibrary.deleteQ', { name: ex.name }), message: t('myLibrary.deleteExerciseHint'), confirmLabel: t('myLibrary.delete'), danger: true }))) return;
        removeMyExercise(ex.id); closeSheet(); onSaved();
      } }, [icon('trash')]) : null,
      el('button', { class: 'btn btn--primary grow', type: 'button', onclick: save }, t('myLibrary.save')),
    ].filter(Boolean),
  });
}

/** Exercises that can be followed along (they have an animation), by name. */
function followable() { return EXERCISES.filter((e) => MOTIONS[e.id]).sort(byName); }

/** Create or edit an own workout; `onSaved()` afterwards. */
export function openMyWorkoutSheet(existing = null, { onSaved = () => {} } = {}) {
  const w = existing || {};
  const titleI = input({ value: w.title || '', maxlength: '60', 'aria-label': t('myLibrary.workoutName') });
  let work = w.work || 40, rest = w.rest || 20, rounds = w.rounds || 2;
  const items = Array.isArray(w.items) ? w.items.slice() : [];
  const list = el('div', { class: 'col gap-1 mt-1' });
  const nameOf = (id) => (EXERCISES.find((e) => e.id === id) || { name: id }).name;
  const paint = () => {
    list.innerHTML = '';
    if (!items.length) list.appendChild(el('div', { class: 'dim', style: { fontSize: '.84rem' }, text: t('myLibrary.noExerciseYet') }));
    items.forEach((id, i) => list.appendChild(el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
      el('span', { class: 'grow', text: `${i + 1}. ${nameOf(id)}` }),
      i > 0 ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('myLibrary.moveUp'), onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; paint(); } }, el('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, icon('chevronDown'))) : null,
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('myLibrary.removeExercise', { name: nameOf(id) }), onclick: () => { items.splice(i, 1); paint(); } }, icon('x')),
    ])));
  };
  const addSel = select([{ value: '', label: t('myLibrary.addPick') }, ...followable().map((e) => ({ value: e.id, label: e.name }))], '', {
    onchange: () => { const v = addSel.value; if (v && items.length < 30) { items.push(v); paint(); } addSel.value = ''; },
    'aria-label': t('myLibrary.addPick'),
  });
  paint();
  const seg = (choices, value, set, label) => segmented(choices.map((n) => ({ value: String(n), label: `${n} s` })), String(value), (v) => set(Number(v)), { label });
  openSheet({
    title: existing ? t('myLibrary.editWorkout') : t('myLibrary.newWorkout'),
    body: el('div', {}, [
      field(t('myLibrary.workoutName'), titleI),
      field(t('myLibrary.work'), seg(WORK_CHOICES, work, (v) => { work = v; }, t('myLibrary.work'))),
      field(t('myLibrary.rest'), seg(REST_CHOICES_WO, rest, (v) => { rest = v; }, t('myLibrary.rest'))),
      field(t('myLibrary.rounds'), segmented(ROUND_CHOICES.map((n) => ({ value: String(n), label: `${n}×` })), String(rounds), (v) => { rounds = Number(v); }, { label: t('myLibrary.rounds') })),
      el('div', { class: 'muted mt-3', style: { fontSize: '.86rem', fontWeight: '600' }, text: t('myLibrary.exercises') }),
      list,
      el('div', { class: 'mt-2' }, [addSel]),
    ]),
    footer: [
      existing ? el('button', { class: 'btn btn--ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: t('myLibrary.deleteQ', { name: w.title }), message: t('myLibrary.deleteWorkoutHint'), confirmLabel: t('myLibrary.delete'), danger: true }))) return;
        removeMyWorkout(w.id); closeSheet(); onSaved();
      } }, [icon('trash')]) : null,
      el('button', { class: 'btn btn--primary grow', type: 'button', onclick: () => {
        const title = titleI.value.trim();
        if (!title) { toast(t('myLibrary.nameMissing'), 'bad'); return; }
        if (!items.length) { toast(t('myLibrary.noExercise'), 'bad'); return; }
        saveMyWorkout({ id: w.id || null, title, items, work, rest, rounds });
        closeSheet(); toast(t('myLibrary.saved'), 'good'); onSaved();
      } }, t('myLibrary.save')),
    ].filter(Boolean),
  });
}

/** Pick a workout (own first, then the catalogue) – `onPick(id)`; `current` is marked. */
export function openWorkoutPicker({ current = null, onPick }) {
  const row = (w) => el('button', { class: 'list-item', type: 'button', style: { width: '100%', textAlign: 'left' }, onclick: () => { closeSheet(); onPick(w.id); } }, [
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: `${w.id === current ? '✓ ' : ''}${w.title}` }),
      w.subtitle ? el('div', { class: 'list-item__sub', text: w.subtitle }) : null,
    ]),
  ]);
  const own = myWorkouts();
  openSheet({
    title: t('myLibrary.pickTitle'),
    body: el('div', {}, [
      own.length ? el('div', { class: 'muted', style: { fontSize: '.82rem', fontWeight: '600' }, text: t('myLibrary.pickOwn') }) : null,
      own.length ? el('div', { class: 'list-card mt-1' }, own.map(row)) : null,
      el('div', { class: 'muted mt-3', style: { fontSize: '.82rem', fontWeight: '600' }, text: t('myLibrary.pickCatalog') }),
      el('div', { class: 'list-card mt-1' }, WORKOUTS.map(row)),
    ]),
  });
}
