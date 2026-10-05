/* Unit tests for the plan generator (js/plans.js): phase split and
   unit generation. makePhases/generatePlanUnits are pure (everything comes in via arguments). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoDow } from '../js/ui.js';
import { makePhases, generatePlanUnits, DEFAULT_WEEK_TEMPLATE, TRIATHLON_TEMPLATE, HYROX_TEMPLATE, pyramidSegments, alternatingSegments, longRunPeak } from '../js/plans.js';

test('makePhases: invariants across many plan lengths', () => {
  for (let weeks = 4; weeks <= 24; weeks++) {
    const ph = makePhases(weeks);
    assert.ok(ph.length >= 1, `weeks=${weeks}`);
    assert.equal(ph[0].startWeek, 1, `Start at week 1 (weeks=${weeks})`);
    assert.equal(ph.at(-1).endWeek, weeks, `End at week ${weeks}`);
    let total = 0;
    for (let i = 0; i < ph.length; i++) {
      assert.ok(ph[i].endWeek >= ph[i].startWeek, `Phase not negative (weeks=${weeks})`);
      total += ph[i].endWeek - ph[i].startWeek + 1;
      if (i > 0) assert.equal(ph[i].startWeek, ph[i - 1].endWeek + 1, `gap-free (weeks=${weeks})`);
    }
    assert.equal(total, weeks, `Sum of weeks = ${weeks}`);
  }
});

test('makePhases: typical 12-week periodisation', () => {
  const ph = makePhases(12);
  assert.deepEqual(ph.map((p) => p.key), ['base', 'build', 'peak', 'taper']);
  assert.equal(ph[0].name, 'Grundlage');
});

test('makePhases: very short plan -> taper only', () => {
  const ph = makePhases(1);
  assert.equal(ph.length, 1);
  assert.equal(ph[0].key, 'taper');
});

function buildPlan(weeks, startDate) {
  return {
    id: 'p1', eventId: 'e1', startDate, weeks,
    phases: makePhases(weeks), weekTemplate: DEFAULT_WEEK_TEMPLATE,
  };
}

test('generatePlanUnits: structure, sorting and race day', () => {
  const startDate = '2026-07-06'; // Monday
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5); // Saturday of the last week
  const event = { id: 'e1', name: 'Halbmarathon', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(weeks, startDate), event, { paceZones: {} });

  assert.ok(units.length > 20, 'produces a substantial number of units');
  // sorted chronologically
  for (let i = 1; i < units.length; i++) assert.ok(units[i - 1].date <= units[i].date, 'sorted');
  // nothing after the race
  assert.ok(units.every((u) => u.date <= eventDate), 'no unit after the event');
  // exactly one race unit, on the event day
  const races = units.filter((u) => u.type === 'race');
  assert.equal(races.length, 1);
  assert.equal(races[0].date, eventDate);
  assert.equal(races[0].targetDistanceKm, event.distanceKm);
  // every unit knows its week, phase and a status
  assert.ok(units.every((u) => u.week >= 1 && u.week <= weeks && u.phase && u.status === 'geplant'));
});

test('longRunPeak: distance-aware – short distances relatively longer, marathon capped', () => {
  assert.equal(longRunPeak(5), 15);                 // 5 km -> 15 km base long run
  assert.equal(longRunPeak(10), 19);                // 10 km
  assert.ok(longRunPeak(21.0975) >= 18 && longRunPeak(21.0975) <= 20); // HM
  assert.equal(longRunPeak(42.195), 32);            // marathon capped
  assert.ok(longRunPeak(5) > 5, 'long run longer than the 5 km race distance');
});

test('pyramidSegments: ascending and descending, peak in the middle', () => {
  const segs = pyramidSegments(240, 60, 90);
  assert.deepEqual(segs.map((s) => s.workSec), [60, 120, 180, 240, 180, 120, 60]);
  assert.ok(segs.every((s) => s.restSec === 90));
  assert.equal(segs[3].workSec, 240);
});

test('alternatingSegments: fartlek – rounds × fast/easy with float rest', () => {
  const segs = alternatingSegments(8, 60, 60);
  assert.equal(segs.length, 8);
  assert.ok(segs.every((s) => s.workSec === 60 && s.restSec === 60 && s.floatRest === true));
});

test('generatePlanUnits: baseLongKm from the history raises the long-run start (adaptive 4)', () => {
  const startDate = '2026-07-06';
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5);
  const event = { id: 'e1', name: 'HM', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const week1Long = (plan) => generatePlanUnits(plan, event, { paceZones: {} }).find((u) => u.type === 'long' && u.week === 1);
  const without = week1Long(buildPlan(weeks, startDate));
  const withBase = week1Long({ ...buildPlan(weeks, startDate), baseLongKm: 15 });
  assert.ok(without, 'week 1 has a long run');
  assert.ok(withBase.targetDistanceKm > without.targetDistanceKm, `longer with history (${withBase.targetDistanceKm} > ${without.targetDistanceKm})`);
  assert.ok(withBase.targetDistanceKm >= 14, 'starts close to the history level');
});

test('generatePlanUnits: standard running plan contains NO strength training (controlled separately)', () => {
  const startDate = '2026-07-06';
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5);
  const event = { id: 'e1', name: 'HM', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(weeks, startDate), event, { paceZones: {} });

  assert.equal(units.filter((u) => u.type === 'strength').length, 0, 'strength is NO longer part of the race plan');
  assert.ok(units.some((u) => u.type === 'long'), 'long run present');
  assert.ok(units.some((u) => u.type === 'easy'), 'easy runs present');
});

test('generatePlanUnits: triathlon plan contains swimming & cycling', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e1', name: 'Tri', date: addDays(startDate, 11 * 7 + 5), distanceKm: 10, sport: 'triathlon' };
  const plan = { id: 'p1', eventId: 'e1', startDate, weeks: 12, phases: makePhases(12), weekTemplate: TRIATHLON_TEMPLATE };
  const units = generatePlanUnits(plan, event, { paceZones: {} });
  assert.ok(units.some((u) => u.type === 'swim' && u.title.startsWith('Schwimmen')), 'swim session present');
  assert.ok(units.some((u) => u.title.includes('Rad')), 'bike session present');
});

test('generatePlanUnits: Hyrox plan contains station training', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e2', name: 'Hyrox', date: addDays(startDate, 11 * 7 + 5), distanceKm: 8, sport: 'hyrox' };
  const plan = { id: 'p2', eventId: 'e2', startDate, weeks: 12, phases: makePhases(12), weekTemplate: HYROX_TEMPLATE };
  const units = generatePlanUnits(plan, event, { paceZones: {} });
  assert.ok(units.some((u) => u.title.includes('Hyrox')), 'Hyrox stations present');
});

test('generatePlanUnits: concrete descriptions (strides, bike alternative)', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e1', name: 'HM', date: addDays(startDate, 11 * 7 + 5), distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(12, startDate), event, { paceZones: {} });
  assert.ok(units.some((u) => u.description && u.description.includes('Steigerungsläufe à')), 'stride details in the description');
  assert.ok(units.some((u) => u.description && u.description.includes('Rad-Alternative')), 'bike alternative on the long run');
});
