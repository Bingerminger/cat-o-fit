/* Tests for the exercise library (js/exercises.js + js/exercise-art.js):
   catalogue integrity, filter/search, meta helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, EX_CATEGORIES, EX_REGIONS, filterExercises, findExercise, categoryMeta, difficultyLabel, exerciseRegions, suggestedExercisesFor, sortByUsage, PREVENTION_IDS, exercisesInText, exercisesForUnit } from '../js/exercises.js';
import { ART_KEYS, exerciseArt } from '../js/exercise-art.js';
import { STRENGTH_FOCUS, HYROX_STRENGTH, generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';

test('Catalogue: every exercise has valid fields + an existing illustration', () => {
  const cats = new Set(EX_CATEGORIES.map((c) => c.key));
  const ids = new Set();
  for (const e of EXERCISES) {
    assert.ok(e.id && !ids.has(e.id), `unique id: ${e.id}`); ids.add(e.id);
    assert.ok(e.name, 'name present');
    assert.ok(cats.has(e.category), `valid category: ${e.category}`);
    assert.ok(ART_KEYS.includes(e.art), `illustration exists: ${e.art}`);
    assert.ok(Array.isArray(e.steps) && e.steps.length >= 2, 'at least 2 steps');
    assert.ok(e.tip && (e.muscles || []).length, 'tip + muscles');
    assert.ok([1, 2, 3].includes(e.difficulty), 'difficulty 1–3');
    assert.ok(exerciseArt(e.art).startsWith('<svg'), 'art is SVG');
  }
  assert.ok(EXERCISES.length >= 12, 'at least 12 exercises');
});

test('filterExercises: category + free text (name/muscle)', () => {
  const strength = filterExercises(EXERCISES, { category: 'strength' });
  assert.ok(strength.length && strength.every((e) => e.category === 'strength'));
  assert.ok(filterExercises(EXERCISES, { query: 'wade' }).some((e) => e.id === 'calf_raise' || e.id === 'calf_stretch'));
  assert.ok(filterExercises(EXERCISES, { query: 'plank' }).some((e) => e.id === 'plank'));
  assert.equal(filterExercises(EXERCISES, { query: 'xyzzy123' }).length, 0);
});

test('findExercise + meta helpers', () => {
  assert.equal(findExercise('squat').name, 'Kniebeuge');
  assert.equal(findExercise('gibtsnicht'), null);
  assert.equal(categoryMeta('mobility').label, 'Beweglichkeit');
  assert.equal(difficultyLabel(3), 'Fortgeschritten');
});

test('Regions: every exercise assigned + region filter (also with category)', () => {
  const valid = new Set(EX_REGIONS.map((r) => r.key));
  for (const e of EXERCISES) {
    const rs = exerciseRegions(e.id);
    assert.ok(rs.length && rs.every((r) => valid.has(r)), `valid regions for ${e.id}: ${rs}`);
  }
  const beine = filterExercises(EXERCISES, { region: 'beine' });
  assert.ok(beine.length && beine.every((e) => exerciseRegions(e.id).includes('beine')));
  assert.ok(beine.some((e) => e.id === 'split_squat'), 'new leg exercise in the region filter');
  const bauch = filterExercises(EXERCISES, { category: 'core', region: 'bauch' });
  assert.ok(bauch.length && bauch.every((e) => e.category === 'core' && exerciseRegions(e.id).includes('bauch')));
});

test('suggestedExercisesFor: strength vs. mobility vs. running', () => {
  const strength = suggestedExercisesFor('strength');
  assert.ok(strength.length && strength.every((e) => e.category === 'strength' || e.category === 'core'));
  const mob = suggestedExercisesFor('mobility');
  assert.ok(mob.length && mob.every((e) => e.category === 'mobility'));
  assert.equal(suggestedExercisesFor('easy').length, 0, 'running sessions do not suggest exercises');
});

test('sortByUsage: descending by frequency', () => {
  const list = ['squat', 'plank', 'crunch'].map(findExercise);
  const sorted = sortByUsage(list, { plank: 5, squat: 2 });
  assert.deepEqual(sorted.map((e) => e.id), ['plank', 'squat', 'crunch']);
  assert.equal(sortByUsage(list, {}).length, 3);
});

test('New exercises (stretching back/hip, strength abs/back/legs) present', () => {
  for (const id of ['split_squat', 'wall_sit', 'step_up', 'crunch', 'leg_raise', 'hollow_hold',
    'superman', 'bird_dog', 'child_pose', 'supine_twist', 'figure_four', 'butterfly_stretch']) {
    assert.ok(findExercise(id), `exercise ${id} missing`);
  }
  assert.ok(EXERCISES.length >= 29, 'catalogue extended to ≥ 29 exercises');
});

test('TRAIN-43: every exercise states caution and progression', () => {
  for (const e of EXERCISES) {
    assert.ok(e.caution && e.caution.length > 15, `caution missing: ${e.id}`);
    assert.ok(e.progression && e.progression.length > 10, `progression missing: ${e.id}`);
  }
});

test('TRAIN-43: prevention exercises for running and football, with graphic and as a suggestion for football', () => {
  for (const id of ['nordic_hamstring', 'copenhagen', 'clamshell', 'monster_walk', 'soleus_raise', 'running_drills', 'pogo_jumps', 'fifa11']) {
    const e = findExercise(id);
    assert.ok(e && e.prevention, `${id} present`);
    assert.ok(ART_KEYS.includes(e.art), `${id}: own graphic`);
  }
  const football = suggestedExercisesFor('cross_football').map((e) => e.id);
  assert.deepEqual(football, PREVENTION_IDS);
  assert.equal(football[0], 'fifa11', 'warm-up per FIFA 11+ first');
  assert.equal(findExercise('side_crunch').name, 'Seitneigung im Stand', 'name matches the movement (not a standing-balance pose)');
  assert.match(findExercise('superman').caution, /Bird Dog/);
  assert.ok(!STRENGTH_FOCUS.some((f) => /Superman/.test(f.desc)), 'trunk strength in the plan without prone extension');
});

test('3.22.0: recognise exercises in the plan text – in order, only at the start of a word', () => {
  const ids = (t) => exercisesInText(t).map((e) => e.id);
  assert.deepEqual(ids(STRENGTH_FOCUS[0].desc), ['squat', 'pushup', 'lunge', 'overhead_press', 'plank']);
  assert.deepEqual(ids(STRENGTH_FOCUS[2].desc), ['plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist']);
  assert.deepEqual(ids(HYROX_STRENGTH[1].desc), ['deadlift', 'row', 'farmers_carry', 'pullup', 'dead_bug']);
  // Every strength focus in the plan names at least four exercises from the library.
  for (const f of [...STRENGTH_FOCUS, ...HYROX_STRENGTH]) assert.ok(exercisesInText(f.desc).length >= 4, f.title);
  // "Sprungkniebeuge" (jump squat) and "Frontkniebeuge" (front squat) are not a squat, "Seitstütz" (side plank) is not a plain support.
  assert.deepEqual(ids('Sprungkniebeugen 3×10'), ['jump_squat']);
  assert.deepEqual(ids('Frontkniebeuge 8×'), ['goblet_squat']);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('lockerer Dauerlauf 8 km'), []);
});

test('3.22.0: exercises of a session – first those named in the plan, then suggestions by usage', () => {
  const unit = { type: 'strength', title: 'Rumpf & Core', description: STRENGTH_FOCUS[2].desc };
  const r = exercisesForUnit(unit, { glute_bridge: 9 });
  assert.deepEqual(r.named.map((e) => e.id), ['plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist']);
  assert.ok(!r.suggested.some((e) => r.named.includes(e)), 'no duplicates');
  assert.equal(r.suggested[0].id, 'glute_bridge', 'most-used suggestion first');
  assert.deepEqual(r.all, [...r.named, ...r.suggested]);
  assert.deepEqual(exercisesForUnit({ type: 'easy', title: 'Lauf', description: '' }).all, []);
  assert.equal(exercisesForUnit({ type: 'mobility', title: 'Mobility' }).named.length, 0);
});

test('3.22.0: strength and mobility sessions from the generator name exercises that the session recognises', () => {
  // Against real plan sessions instead of reconstructed objects – the text is in `description`.
  for (const sport of ['run', 'hyrox']) {
    const event = { id: 'e', name: 'Rennen', date: '2027-01-02', distanceKm: sport === 'hyrox' ? 8 : 21.0975, sport };
    const plan = { id: 'p', eventId: 'e', startDate: '2026-10-05', weeks: 13, phases: makePhases(13), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: weekTemplateFor(sport, 4), commitments: [], sport };
    const units = generatePlanUnits(plan, event, {}).filter((u) => ['strength', 'mobility'].includes(u.type) && /\d+×|\d+ s/.test(u.description || ''));
    assert.ok(units.length > 0, `${sport}: strength/mobility sessions with exercises in the text`);
    for (const u of units) assert.ok(exercisesForUnit(u).named.length >= 3, `${sport}: ${u.title} – ${exercisesForUnit(u).named.length} recognised`);
  }
});
