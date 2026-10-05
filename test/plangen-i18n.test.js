// Plans generated in English must give the follow-along player the same exercises and doses as
// the German ones: the player reads them from the unit text (js/show-program.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../js/i18n.js';
import { addDays } from '../js/ui.js';
import { generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';
import { buildProgramUnits, PROGRAM_TYPES } from '../js/program.js';
import { dosesFromText } from '../js/show-program.js';

const START = '2026-10-05';
function raceUnits(key, sport) {
  const km = { hm: 21.0975, hyrox: 8, tri_olympic: 10 }[key];
  const distanceType = key === 'tri_olympic' ? 'tri-olympic' : null;
  const event = { id: 'e', name: 'Race', date: addDays(START, 11 * 7 + 5), distanceKm: km, sport, distanceType };
  const plan = { id: 'p', eventId: 'e', startDate: START, weeks: 12, phases: makePhases(12), level: 'fortgeschritten', daysPerWeek: 5,
    weekTemplate: weekTemplateFor(sport, 5), commitments: [], paces: null, sport };
  return generatePlanUnits(plan, event, {});
}
const programUnits = () => Object.keys(PROGRAM_TYPES).flatMap((type) =>
  buildProgramUnits({ type, weeks: 8, daysPerWeek: 4 }, 'p', START));
const doses = (units) => units.filter((u) => ['strength', 'mobility', 'gym'].includes(u.type)).map((u) => {
  const d = dosesFromText(`${u.title || ''} · ${u.description || ''}`);
  return { rounds: d.rounds, roundRest: d.roundRest, items: d.items.map(({ id, reps, holdS, perSide }) => ({ id, reps, holdS, perSide })) };
});

for (const [name, make] of [['run (HM)', () => raceUnits('hm', 'run')], ['Hyrox', () => raceUnits('hyrox', 'hyrox')],
  ['triathlon', () => raceUnits('tri_olympic', 'triathlon')], ['programmes', programUnits]]) {
  test(`${name}: English plan texts carry the same exercises and doses as German`, async () => {
    const de = doses(make());
    assert.ok(de.some((d) => d.items.length), 'the German plan names exercises');
    await setLocale('en');
    try { assert.deepEqual(doses(make()), de); } finally { await setLocale('de'); }
  });
}
