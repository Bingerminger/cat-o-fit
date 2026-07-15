/* Unit-Tests für den Plan-Generator (js/plans.js): Phasenaufteilung und
   Einheiten-Generierung. makePhases/generatePlanUnits sind rein (Argumente rein). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoDow } from '../js/ui.js';
import { makePhases, generatePlanUnits, DEFAULT_WEEK_TEMPLATE, TRIATHLON_TEMPLATE, HYROX_TEMPLATE, pyramidSegments, alternatingSegments, longRunPeak } from '../js/plans.js';

test('makePhases: Invarianten über viele Planlängen', () => {
  for (let weeks = 4; weeks <= 24; weeks++) {
    const ph = makePhases(weeks);
    assert.ok(ph.length >= 1, `weeks=${weeks}`);
    assert.equal(ph[0].startWeek, 1, `Start bei Woche 1 (weeks=${weeks})`);
    assert.equal(ph.at(-1).endWeek, weeks, `Ende bei Woche ${weeks}`);
    let total = 0;
    for (let i = 0; i < ph.length; i++) {
      assert.ok(ph[i].endWeek >= ph[i].startWeek, `Phase nicht negativ (weeks=${weeks})`);
      total += ph[i].endWeek - ph[i].startWeek + 1;
      if (i > 0) assert.equal(ph[i].startWeek, ph[i - 1].endWeek + 1, `lückenlos (weeks=${weeks})`);
    }
    assert.equal(total, weeks, `Summe der Wochen = ${weeks}`);
  }
});

test('makePhases: typische 12-Wochen-Periodisierung', () => {
  const ph = makePhases(12);
  assert.deepEqual(ph.map((p) => p.key), ['base', 'build', 'peak', 'taper']);
  assert.equal(ph[0].name, 'Grundlage');
});

test('makePhases: sehr kurzer Plan -> nur Tapering', () => {
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

test('generatePlanUnits: Struktur, Sortierung und Race-Tag', () => {
  const startDate = '2026-07-06'; // Montag
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5); // Samstag der letzten Woche
  const event = { id: 'e1', name: 'Halbmarathon', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(weeks, startDate), event, { paceZones: {} });

  assert.ok(units.length > 20, 'erzeugt eine substanzielle Anzahl Einheiten');
  // chronologisch sortiert
  for (let i = 1; i < units.length; i++) assert.ok(units[i - 1].date <= units[i].date, 'sortiert');
  // nichts nach dem Wettkampf
  assert.ok(units.every((u) => u.date <= eventDate), 'keine Einheit nach dem Event');
  // genau eine Wettkampf-Einheit, am Event-Tag
  const races = units.filter((u) => u.type === 'race');
  assert.equal(races.length, 1);
  assert.equal(races[0].date, eventDate);
  assert.equal(races[0].targetDistanceKm, event.distanceKm);
  // jede Einheit kennt ihre Woche, Phase und einen Status
  assert.ok(units.every((u) => u.week >= 1 && u.week <= weeks && u.phase && u.status === 'geplant'));
});

test('longRunPeak: distanz-bewusst – kurze Distanzen relativ länger, Marathon gedeckelt', () => {
  assert.equal(longRunPeak(5), 15);                 // 5 km -> 15 km Grundlagen-Long
  assert.equal(longRunPeak(10), 19);                // 10 km
  assert.ok(longRunPeak(21.0975) >= 18 && longRunPeak(21.0975) <= 20); // HM
  assert.equal(longRunPeak(42.195), 32);            // Marathon gedeckelt
  assert.ok(longRunPeak(5) > 5, 'Long Run länger als 5-km-Renndistanz');
});

test('pyramidSegments: auf- und absteigend, Spitze in der Mitte', () => {
  const segs = pyramidSegments(240, 60, 90);
  assert.deepEqual(segs.map((s) => s.workSec), [60, 120, 180, 240, 180, 120, 60]);
  assert.ok(segs.every((s) => s.restSec === 90));
  assert.equal(segs[3].workSec, 240);
});

test('alternatingSegments: Fahrtspiel – rounds × schnell/locker mit Float-Pause', () => {
  const segs = alternatingSegments(8, 60, 60);
  assert.equal(segs.length, 8);
  assert.ok(segs.every((s) => s.workSec === 60 && s.restSec === 60 && s.floatRest === true));
});

test('generatePlanUnits: baseLongKm aus der Historie hebt den Long-Run-Start (Adaptiv 4)', () => {
  const startDate = '2026-07-06';
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5);
  const event = { id: 'e1', name: 'HM', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const week1Long = (plan) => generatePlanUnits(plan, event, { paceZones: {} }).find((u) => u.type === 'long' && u.week === 1);
  const without = week1Long(buildPlan(weeks, startDate));
  const withBase = week1Long({ ...buildPlan(weeks, startDate), baseLongKm: 15 });
  assert.ok(without, 'Woche 1 hat einen Long Run');
  assert.ok(withBase.targetDistanceKm > without.targetDistanceKm, `mit Historie länger (${withBase.targetDistanceKm} > ${without.targetDistanceKm})`);
  assert.ok(withBase.targetDistanceKm >= 14, 'startet nahe am Historien-Niveau');
});

test('generatePlanUnits: Standard-Laufplan enthält KEIN Krafttraining (separat gesteuert)', () => {
  const startDate = '2026-07-06';
  const weeks = 12;
  const eventDate = addDays(startDate, (weeks - 1) * 7 + 5);
  const event = { id: 'e1', name: 'HM', date: eventDate, distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(weeks, startDate), event, { paceZones: {} });

  assert.equal(units.filter((u) => u.type === 'strength').length, 0, 'Kraft ist NICHT mehr im Wettkampfplan');
  assert.ok(units.some((u) => u.type === 'long'), 'Long Run vorhanden');
  assert.ok(units.some((u) => u.type === 'easy'), 'lockere Läufe vorhanden');
});

test('generatePlanUnits: Triathlon-Plan enthält Schwimmen & Rad', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e1', name: 'Tri', date: addDays(startDate, 11 * 7 + 5), distanceKm: 10, sport: 'triathlon' };
  const plan = { id: 'p1', eventId: 'e1', startDate, weeks: 12, phases: makePhases(12), weekTemplate: TRIATHLON_TEMPLATE };
  const units = generatePlanUnits(plan, event, { paceZones: {} });
  assert.ok(units.some((u) => u.title === 'Schwimmen'), 'Schwimmeinheit vorhanden');
  assert.ok(units.some((u) => u.title.includes('Rad')), 'Radeinheit vorhanden');
});

test('generatePlanUnits: Hyrox-Plan enthält Stationen-Training', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e2', name: 'Hyrox', date: addDays(startDate, 11 * 7 + 5), distanceKm: 8, sport: 'hyrox' };
  const plan = { id: 'p2', eventId: 'e2', startDate, weeks: 12, phases: makePhases(12), weekTemplate: HYROX_TEMPLATE };
  const units = generatePlanUnits(plan, event, { paceZones: {} });
  assert.ok(units.some((u) => u.title.includes('Hyrox')), 'Hyrox-Stationen vorhanden');
});

test('generatePlanUnits: konkrete Beschreibungen (Steigerungen, Rad-Alternative)', () => {
  const startDate = '2026-07-06';
  const event = { id: 'e1', name: 'HM', date: addDays(startDate, 11 * 7 + 5), distanceKm: 21.0975, targetTime: '1:45:00' };
  const units = generatePlanUnits(buildPlan(12, startDate), event, { paceZones: {} });
  assert.ok(units.some((u) => u.description && u.description.includes('Steigerungsläufe à')), 'Steigerungs-Details in der Beschreibung');
  assert.ok(units.some((u) => u.description && u.description.includes('Rad-Alternative')), 'Rad-Alternative beim Long Run');
});
