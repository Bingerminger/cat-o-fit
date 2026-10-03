/* Tests für die Übungs-Bibliothek (js/exercises.js + js/exercise-art.js):
   Katalog-Integrität, Filter/Suche, Meta-Helfer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, EX_CATEGORIES, EX_REGIONS, filterExercises, findExercise, categoryMeta, difficultyLabel, exerciseRegions, suggestedExercisesFor, sortByUsage, PREVENTION_IDS, exercisesInText, exercisesForUnit } from '../js/exercises.js';
import { ART_KEYS, exerciseArt } from '../js/exercise-art.js';
import { STRENGTH_FOCUS, HYROX_STRENGTH, generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';

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

test('TRAIN-43: jede Übung nennt Vorsicht und Steigerung', () => {
  for (const e of EXERCISES) {
    assert.ok(e.caution && e.caution.length > 15, `Vorsicht fehlt: ${e.id}`);
    assert.ok(e.progression && e.progression.length > 10, `Steigerung fehlt: ${e.id}`);
  }
});

test('TRAIN-43: Präventionsübungen für Laufen und Fußball, mit Grafik und als Vorschlag beim Fußball', () => {
  for (const id of ['nordic_hamstring', 'copenhagen', 'clamshell', 'monster_walk', 'soleus_raise', 'running_drills', 'pogo_jumps', 'fifa11']) {
    const e = findExercise(id);
    assert.ok(e && e.prevention, `${id} vorhanden`);
    assert.ok(ART_KEYS.includes(e.art), `${id}: eigene Grafik`);
  }
  const football = suggestedExercisesFor('cross_football').map((e) => e.id);
  assert.deepEqual(football, PREVENTION_IDS);
  assert.equal(football[0], 'fifa11', 'Aufwärmen nach FIFA 11+ zuerst');
  assert.equal(findExercise('side_crunch').name, 'Seitneigung im Stand', 'Name passt zur Bewegung (keine Standwaage)');
  assert.match(findExercise('superman').caution, /Bird Dog/);
  assert.ok(!STRENGTH_FOCUS.some((f) => /Superman/.test(f.desc)), 'Rumpf-Kraft im Plan ohne Bauchlage-Streckung');
});

test('3.22.0: Übungen aus dem Plantext erkennen – in Reihenfolge, nur am Wortanfang', () => {
  const ids = (t) => exercisesInText(t).map((e) => e.id);
  assert.deepEqual(ids(STRENGTH_FOCUS[0].desc), ['squat', 'pushup', 'lunge', 'overhead_press', 'plank']);
  assert.deepEqual(ids(STRENGTH_FOCUS[2].desc), ['plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist']);
  assert.deepEqual(ids(HYROX_STRENGTH[1].desc), ['deadlift', 'row', 'farmers_carry', 'pullup', 'dead_bug']);
  // Jeder Kraft-Schwerpunkt im Plan nennt mindestens vier Übungen aus der Bibliothek.
  for (const f of [...STRENGTH_FOCUS, ...HYROX_STRENGTH]) assert.ok(exercisesInText(f.desc).length >= 4, f.title);
  // „Sprungkniebeuge“ und „Frontkniebeuge“ sind keine Kniebeuge, „Seitstütz“ kein Stütz.
  assert.deepEqual(ids('Sprungkniebeugen 3×10'), ['jump_squat']);
  assert.deepEqual(ids('Frontkniebeuge 8×'), ['goblet_squat']);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('lockerer Dauerlauf 8 km'), []);
});

test('3.22.0: Übungen einer Einheit – erst die im Plan genannten, dann Vorschläge nach Nutzung', () => {
  const unit = { type: 'strength', title: 'Rumpf & Core', description: STRENGTH_FOCUS[2].desc };
  const r = exercisesForUnit(unit, { glute_bridge: 9 });
  assert.deepEqual(r.named.map((e) => e.id), ['plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist']);
  assert.ok(!r.suggested.some((e) => r.named.includes(e)), 'keine Doppelten');
  assert.equal(r.suggested[0].id, 'glute_bridge', 'meistgenutzter Vorschlag zuerst');
  assert.deepEqual(r.all, [...r.named, ...r.suggested]);
  assert.deepEqual(exercisesForUnit({ type: 'easy', title: 'Lauf', description: '' }).all, []);
  assert.equal(exercisesForUnit({ type: 'mobility', title: 'Mobility' }).named.length, 0);
});

test('3.22.0: Kraft- und Mobility-Einheiten aus dem Generator nennen Übungen, die die Einheit erkennt', () => {
  // Gegen echte Plan-Einheiten statt nachgebauter Objekte – der Text steht in `description`.
  for (const sport of ['run', 'hyrox']) {
    const event = { id: 'e', name: 'Rennen', date: '2027-01-02', distanceKm: sport === 'hyrox' ? 8 : 21.0975, sport };
    const plan = { id: 'p', eventId: 'e', startDate: '2026-10-05', weeks: 13, phases: makePhases(13), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: weekTemplateFor(sport, 4), commitments: [], sport };
    const units = generatePlanUnits(plan, event, {}).filter((u) => ['strength', 'mobility'].includes(u.type) && /\d+×|\d+ s/.test(u.description || ''));
    assert.ok(units.length > 0, `${sport}: Kraft-/Mobility-Einheiten mit Übungen im Text`);
    for (const u of units) assert.ok(exercisesForUnit(u).named.length >= 3, `${sport}: ${u.title} – ${exercisesForUnit(u).named.length} erkannt`);
  }
});
