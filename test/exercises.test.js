/* Tests für die Übungs-Bibliothek (js/exercises.js + js/exercise-art.js):
   Katalog-Integrität, Filter/Suche, Meta-Helfer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, EX_CATEGORIES, EX_REGIONS, filterExercises, findExercise, categoryMeta, difficultyLabel, exerciseRegions, suggestedExercisesFor, sortByUsage } from '../js/exercises.js';
import { ART_KEYS, exerciseArt } from '../js/exercise-art.js';

test('Katalog: jede Übung hat gültige Felder + existierende Illustration', () => {
  const cats = new Set(EX_CATEGORIES.map((c) => c.key));
  const ids = new Set();
  for (const e of EXERCISES) {
    assert.ok(e.id && !ids.has(e.id), `eindeutige id: ${e.id}`); ids.add(e.id);
    assert.ok(e.name, 'Name vorhanden');
    assert.ok(cats.has(e.category), `gültige Kategorie: ${e.category}`);
    assert.ok(ART_KEYS.includes(e.art), `Illustration existiert: ${e.art}`);
    assert.ok(Array.isArray(e.steps) && e.steps.length >= 2, 'mind. 2 Schritte');
    assert.ok(e.tip && (e.muscles || []).length, 'Tipp + Muskeln');
    assert.ok([1, 2, 3].includes(e.difficulty), 'Schwierigkeit 1–3');
    assert.ok(exerciseArt(e.art).startsWith('<svg'), 'Art ist SVG');
  }
  assert.ok(EXERCISES.length >= 12, 'mindestens 12 Übungen');
});

test('filterExercises: Kategorie + Freitext (Name/Muskel)', () => {
  const strength = filterExercises(EXERCISES, { category: 'strength' });
  assert.ok(strength.length && strength.every((e) => e.category === 'strength'));
  assert.ok(filterExercises(EXERCISES, { query: 'wade' }).some((e) => e.id === 'calf_raise' || e.id === 'calf_stretch'));
  assert.ok(filterExercises(EXERCISES, { query: 'plank' }).some((e) => e.id === 'plank'));
  assert.equal(filterExercises(EXERCISES, { query: 'xyzzy123' }).length, 0);
});

test('findExercise + Meta-Helfer', () => {
  assert.equal(findExercise('squat').name, 'Kniebeuge');
  assert.equal(findExercise('gibtsnicht'), null);
  assert.equal(categoryMeta('mobility').label, 'Beweglichkeit');
  assert.equal(difficultyLabel(3), 'Fortgeschritten');
});

test('Regionen: jede Übung zugeordnet + Region-Filter (auch mit Kategorie)', () => {
  const valid = new Set(EX_REGIONS.map((r) => r.key));
  for (const e of EXERCISES) {
    const rs = exerciseRegions(e.id);
    assert.ok(rs.length && rs.every((r) => valid.has(r)), `gültige Regionen für ${e.id}: ${rs}`);
  }
  const beine = filterExercises(EXERCISES, { region: 'beine' });
  assert.ok(beine.length && beine.every((e) => exerciseRegions(e.id).includes('beine')));
  assert.ok(beine.some((e) => e.id === 'split_squat'), 'neue Bein-Übung im Region-Filter');
  const bauch = filterExercises(EXERCISES, { category: 'core', region: 'bauch' });
  assert.ok(bauch.length && bauch.every((e) => e.category === 'core' && exerciseRegions(e.id).includes('bauch')));
});

test('suggestedExercisesFor: Kraft vs. Mobility vs. Lauf', () => {
  const strength = suggestedExercisesFor('strength');
  assert.ok(strength.length && strength.every((e) => e.category === 'strength' || e.category === 'core'));
  const mob = suggestedExercisesFor('mobility');
  assert.ok(mob.length && mob.every((e) => e.category === 'mobility'));
  assert.equal(suggestedExercisesFor('easy').length, 0, 'Laufeinheiten schlagen keine Übungen vor');
});

test('sortByUsage: absteigend nach Häufigkeit', () => {
  const list = ['squat', 'plank', 'crunch'].map(findExercise);
  const sorted = sortByUsage(list, { plank: 5, squat: 2 });
  assert.deepEqual(sorted.map((e) => e.id), ['plank', 'squat', 'crunch']);
  assert.equal(sortByUsage(list, {}).length, 3);
});

test('Neue Übungen (Dehnung Rücken/Hüfte, Kraft Bauch/Rücken/Bein) vorhanden', () => {
  for (const id of ['split_squat', 'wall_sit', 'step_up', 'crunch', 'leg_raise', 'hollow_hold',
    'superman', 'bird_dog', 'child_pose', 'supine_twist', 'figure_four', 'butterfly_stretch']) {
    assert.ok(findExercise(id), `Übung ${id} fehlt`);
  }
  assert.ok(EXERCISES.length >= 29, 'Katalog auf ≥ 29 Übungen erweitert');
});
