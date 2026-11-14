/* Following along non-stop does what the plan text says (4.2): every exercise of the round is recognised
   (wall push-ups, on all fours, rows, sit-to-stand), a sentence before the list ("heavier variants: …
   instead of …") adds none, and a hold exercise the plan gives in repetitions keeps them. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgramUnits } from '../js/program.js';
import { programForUnit, doseLabel, dosesFromText } from '../js/show-program.js';
import { setLocale } from '../js/i18n.js';

after(() => setLocale('de'));

const unitsOf = (type) => buildProgramUnits({ programType: type, weeks: 12, daysPerWeek: 4 }, 'p', '2026-11-16');
const ids = (u) => programForUnit(u).items.map((it) => it.id);

for (const lang of ['de', 'en', 'fr', 'es', 'it', 'pt-BR', 'nl']) {
  test(`${lang}: the round of each programme strength session, nothing more`, async () => {
    await setLocale(lang);
    const gentle = unitsOf('mobility').find((u) => u.type === 'strength');
    assert.deepEqual(ids(gentle), ['box_squat', 'wall_pushup', 'glute_bridge', 'calf_raise', 'bird_dog'], 'gentle strength');
    const strength = unitsOf('strength').filter((u) => u.type === 'strength');
    const upper = strength.find((u) => ids(u).includes('dead_bug'));
    assert.deepEqual(ids(upper), ['pushup', 'row', 'overhead_press', 'plank', 'side_plank', 'dead_bug'], 'upper body with rows');
    const lowerLate = strength.filter((u) => u.phase === 'consolidate' && ids(u).includes('step_up'))[0];
    assert.deepEqual(ids(lowerLate), ['squat', 'deadlift', 'step_up', 'calf_raise', 'glute_bridge'], 'the "instead of" variant is not part of the round');
    const fullLate = strength.find((u) => u.phase === 'consolidate' && ids(u)[0] === 'squat' && ids(u).includes('lunge'));
    const prog = programForUnit(fullLate);
    assert.deepEqual(prog.items.map((it) => it.id), ['squat', 'pushup', 'lunge', 'overhead_press', 'plank'], 'in the order of the round');
    assert.equal(doseLabel(prog.items[4], prog), '40 s', 'the plank of the round, not the 60 s of the heavier variant');
  });
}

test('a hold exercise given in repetitions keeps them', async () => {
  await setLocale('de');
  const prog = programForUnit({ type: 'mobility', title: 'Mobility', description: 'Katze-Kuh 10× · Brustöffner 8×/Seite · Kindhaltung 60 s' });
  const chest = prog.items.find((it) => it.id === 'chest_opener');
  assert.match(doseLabel(chest, prog), /^8×/);
  assert.equal(doseLabel(prog.items.find((it) => it.id === 'child_pose'), prog), '60 s');
  // Without a list after the colon the whole text counts.
  assert.equal(dosesFromText('4× (1 km + eine Station: SkiErg, Wall Balls). Danach locker.').items.length >= 1, true);
});
