/* Starter programmes (4.2): full body A and B in turn on up to three strength days, the other days
   walking – and in every language the sessions name exercises the library recognises, so that
   "follow along" and the set logging work. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgramUnits, programWeekBlocks, PROGRAM_TYPES } from '../js/program.js';
import { exercisesInText } from '../js/exercises.js';
import { dosesFromText } from '../js/show-program.js';
import { setLocale } from '../js/i18n.js';

after(() => setLocale('de'));

const EXPECT = {
  starterHome: [['squat', 'incline_pushup', 'glute_bridge', 'inverted_row', 'plank'], ['reverse_lunge', 'knee_pushup', 'superman', 'bird_dog', 'side_plank']],
  starterGym: [['goblet_squat', 'single_arm_row', 'overhead_press', 'hip_thrust', 'plank'], ['deadlift', 'pushup', 'row', 'reverse_lunge', 'farmers_carry']],
};

test('week layout: up to three strength days, the rest walking', () => {
  for (const type of ['starterHome', 'starterGym']) {
    assert.deepEqual(programWeekBlocks(type, 3).map((d) => d.block), ['strength', 'strength', 'strength']);
    assert.deepEqual(programWeekBlocks(type, 5).map((d) => d.block).sort(), ['strength', 'strength', 'strength', 'walk', 'walk']);
    assert.ok(PROGRAM_TYPES[type].label);
  }
});

for (const lang of ['de', 'en', 'fr', 'es', 'it', 'pt-BR', 'nl']) {
  test(`${lang}: A and B in turn, each naming its five library exercises with a dose`, async () => {
    await setLocale(lang);
    for (const [type, [a, b]] of Object.entries(EXPECT)) {
      const units = buildProgramUnits({ programType: type, weeks: 2, daysPerWeek: 3 }, 'p', '2026-11-16').filter((u) => u.type === 'strength');
      assert.equal(units.length, 6);
      const ids = (u) => exercisesInText(`${u.title} · ${u.description}`).map((e) => e.id);
      assert.deepEqual(ids(units[0]), a, `${type} A`);
      assert.deepEqual(ids(units[1]), b, `${type} B`);
      assert.deepEqual(ids(units[3]), b, `${type}: week 2 starts with B`);
      for (const u of [units[0], units[1]]) {
        const d = dosesFromText(u.description);
        assert.equal(d.items.length, 5, `${type}: five exercises`);
        assert.ok(d.items.every((it) => it.reps > 0 || it.holdS > 0), `${type}: every exercise with reps or seconds ${JSON.stringify(d.items)}`);
        assert.ok(d.rounds >= 2, `${type}: rounds read`);
      }
      const perSide = dosesFromText(units[1].description).items.find((it) => it.id === 'reverse_lunge');
      assert.equal(perSide.perSide, true, `${type}: lunges per leg`);
    }
  });
}
