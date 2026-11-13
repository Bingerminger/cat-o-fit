/* The automatic volume adjustment over whole generated plans, day by day: whoever trains exactly
   as planned is never cut back (a plan that builds up raises the load ratio and tires by design –
   that is no warning sign), also not with steady extras besides the plan; a sudden week clearly above
   the plan is noticed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindow, racePlanPhases, weekTemplateFor, generatePlanUnits, PLAN_GEN } from '../js/plangen.js';
import { mkCommit } from '../js/commitments.js';
import { planPaces } from '../js/vdot.js';
import { addDays, diffDays } from '../js/ui.js';
import { RPE_BY_TYPE, footballRpe } from '../js/load.js';
import { autoVolumeDecision } from '../js/autovolume.js';

const TODAY = '2027-01-04';
const DIST = { '5k': [5, 8, 1500], '10k': [10, 10, 3150], hm: [21.0975, 12, 6900], marathon: [42.195, 16, 14400] };
const LEVEL_TIME = { einsteiger: 1.3, fortgeschritten: 1, leistung: 0.8 };
const MASKS = { none: [], 'football Mon+Wed': [1, 3].map((d) => mkCommit('cross_football', d, { id: `c-fb-${d}`, intensity: 'normal' })) };
const HISTORY = [{}, { weekKm: 25, longKm: 12 }];

function makePlan({ key, level, days, hist, commitments, strengthDays, side = null }) {
  const [km, weeks, sec] = DIST[key];
  const start0 = planWindow(addDays(TODAY, 7 * weeks), TODAY).start;
  const raceDate = addDays(start0, (weeks - 1) * 7 + 6);
  const event = { id: 'e-1', name: 'Race', date: raceDate, distanceKm: km, sport: 'run' };
  const { start, weeks: w } = planWindow(raceDate, TODAY);
  const pp = planPaces({ distanceKm: km, targetSec: Math.round(sec * LEVEL_TIME[level]) });
  const plan = {
    id: 'p-1', eventId: 'e-1', startDate: start, endDate: raceDate, weeks: w, level, daysPerWeek: days,
    baseWeekKm: hist.weekKm ?? null, baseLongKm: hist.longKm ?? null, paces: pp ? pp.zones : null,
    phases: racePlanPhases(w, start, raceDate, true), weekTemplate: weekTemplateFor('run', days),
    raceDayJoinsTaper: true, commitments, sport: 'run', gen: PLAN_GEN, strengthDays,
  };
  // Side races: a C race in week 3 (Saturday), a B race in week 5 (Sunday).
  if (side) plan.sideRaces = [
    { eventId: 'e-c', date: addDays(start, 2 * 7 + 5), priority: 'C', name: 'C', distanceKm: side.c },
    { eventId: 'e-b', date: addDays(start, 4 * 7 + 6), priority: 'B', name: 'B', distanceKm: side.b },
  ];
  return { plan, units: generatePlanUnits(plan, event, {}) };
}

const mid = (z) => (z && z.min ? (z.min + (z.max || z.min)) / 2 : null);
/** The session of someone who did the unit as planned (`f` = how much more, `rpePlus` = rated how many
    notches harder), at the plan's paces. */
function asDone(u, plan, i, f, rpePlus = 0) {
  const easy = mid(plan.paces && plan.paces.easy) || 390;
  const pace = mid({ min: u.targetPaceSecPerKm, max: u.targetPaceMaxSecPerKm });
  const km = Number(u.targetDistanceKm) || 0;
  const sec = u.targetDurationMin ? u.targetDurationMin * 60
    : km ? km * (['easy', 'long', 'recovery'].includes(u.type) && pace ? pace : easy) : 40 * 60;
  const rpe = Math.min(10, (u.type === 'cross_football' ? footballRpe(u.intensity) : (RPE_BY_TYPE[u.type] || 4)) + rpePlus);
  return { id: `s${i}`, date: u.date, type: u.type, distanceKm: km ? km * f : null, durationSec: Math.round(sec * f), rpe };
}

/**
 * Days on which the automation would cut back, over the whole plan (from week 2 to race week).
 * `spike` = the last 7 days that much above the plan; `noise` = what people do besides a plan they
 * follow: every session rated a notch harder, a daily walk and football on Thursdays outside the plan.
 */
function hitDays({ plan, units }, hist, days, { spike = 1, noise = false } = {}) {
  const base = [];
  if (hist.weekKm) {
    const easy = mid(plan.paces && plan.paces.easy) || 390;
    for (let d = 42; d >= 1; d--) {
      if (d % 7 >= days) continue;
      base.push({ id: `b${d}`, date: addDays(plan.startDate, -d), type: 'easy', distanceKm: hist.weekKm / days, durationSec: Math.round(hist.weekKm / days * easy), rpe: 4 });
    }
  }
  if (noise) {
    for (let d = addDays(plan.startDate, -42); d <= plan.endDate; d = addDays(d, 1)) {
      base.push({ id: `w${d}`, date: d, type: 'walk', durationSec: 1800, rpe: 2 });
      if (new Date(`${d}T12:00:00`).getDay() === 4) base.push({ id: `f${d}`, date: d, type: 'cross_football', durationSec: 5400, intensity: 'normal' });
    }
  }
  const hits = [];
  for (let day = addDays(plan.startDate, 7); day < plan.endDate; day = addDays(day, 1)) {
    const pastBase = base.filter((s) => s.date < day);
    const sessions = [...pastBase, ...units.filter((u) => u.date < day && u.type !== 'rest')
      .map((u, i) => asDone(u, plan, i, diffDays(u.date, day) <= 7 ? spike : 1, noise ? 1 : 0))];
    const p = { ...plan, units: units.map((u) => (u.date < day ? { ...u, status: 'erledigt' } : u)) };
    const d = autoVolumeDecision({ plan: p, sessions, today: day });
    if (d) hits.push(`${day} ${d.signals.map((s) => s.key).join('+')}`);
  }
  return hits;
}

function matrix(fn, side = null) {
  for (const key of Object.keys(DIST)) for (const level of Object.keys(LEVEL_TIME)) for (const days of [3, 5])
    for (const hist of HISTORY) for (const [mask, commitments] of Object.entries(MASKS)) for (const strengthDays of [0, 2]) {
      fn(`${key}/${level}/${days}d/hist ${hist.weekKm || 0}/${mask}/strength ${strengthDays}`, makePlan({ key, level, days, hist, commitments, strengthDays, side }), hist, days);
    }
}

test('AUTOVOL-SIM: training exactly as planned is never cut back', () => {
  const bad = [];
  matrix((tag, made, hist, days) => { const h = hitDays(made, hist, days); if (h.length) bad.push(`${tag}: ${h.slice(0, 2).join(', ')}`); });
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} plan(s) cut back although followed as planned`);
});

test('AUTOVOL-SIM: what people do steadily besides the plan does not count as more than planned', () => {
  // Every session rated a notch harder, a daily walk and football every Thursday, none of it in the plan:
  // the person's load ratio is compared with the plan's own, so steady extras cancel out.
  const bad = [];
  matrix((tag, made, hist, days) => { const h = hitDays(made, hist, days, { noise: true }); if (h.length) bad.push(`${tag}: ${h.slice(0, 2).join(', ')}`); });
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} plan(s) cut back because of steady extras`);
});

test('AUTOVOL-SIM: also with side races (taper, race, recovery, back to the build) nothing is cut', () => {
  const bad = [];
  let withSide = 0;
  matrix((tag, made, hist, days) => {
    if (made.units.some((u) => u.sideRace)) withSide++;
    const h = hitDays(made, hist, days);
    if (h.length) bad.push(`${tag}: ${h.slice(0, 2).join(', ')}`);
  }, { c: 5, b: 10 });
  assert.ok(withSide > 50, `${withSide} plans with side races`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} plan(s) cut back although followed as planned`);
});

test('AUTOVOL-SIM: a sudden week clearly above the plan (+40 %) is noticed in nearly every plan', () => {
  let plans = 0, noticed = 0;
  matrix((tag, made, hist, days) => { plans++; if (hitDays(made, hist, days, { spike: 1.4 }).length) noticed++; });
  assert.ok(noticed / plans > 0.9, `${noticed} of ${plans}`);
});
