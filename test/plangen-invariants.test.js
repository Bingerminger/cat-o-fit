/* Invariants of the generated race plans (since 4.2), checked over a fixed matrix of plans:
   distance × level × run days × training history, and nine patterns of fixed commitments.
   What the documentation promises about the plan must hold for the sessions the person sees,
   not only for the weekly targets behind them:
   - V  volume: the sum of a week's runs stays at its target, rises by at most the level's step
        over the last full week, a deload week is easier, the taper shrinks; the long run keeps
        its share of the actual week; the quality session is never longer than the long run;
   - P  placement: no quality session or long run on, or directly next to, a demanding fixed
        commitment (the long run only the day before, and only when no calm day is left); two
        demanding sessions the plan builds never fall on consecutive days;
   - R  race week: the day before is a short shakeout, two days before is free;
   - M  a standard marathon plan reaches the volume the race prediction asks for;
   - C  fixed commitments do not stall the plan: when a commitment takes the day of a run, the runs
        that remain carry the week – the plan gets as far as one built for that many run days; and when
        they push the long run next to another run, that day carries the shortest easy run of the week;
   - W  one week built alone equals that week of the whole plan;
   - B  side races (B/C, since 4.2): one race session each, a B race with shakeout and a free day
        before, nothing demanding the day before or in the recovery days after, a C race instead of
        the week's quality session, no strength in the short taper; weeks around them keep W, and
        the other weeks keep V.
   Every violation is counted; the message lists the first ones. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  planWindow, racePlanPhases, weekTemplateFor, generatePlanUnits, buildWeekUnits, volumeConfig, weekVolumes, PLAN_GEN,
  sideRacesOf, SIDE_RACE_MAX_KM,
} from '../js/plangen.js';
import { mkCommit } from '../js/commitments.js';
import { planPaces } from '../js/vdot.js';
import { volumeCaveat } from '../js/suggestions.js';
import { isHard } from '../js/planflow.js';
import { addDays, diffDays } from '../js/ui.js';
import { setUnits, METRIC } from '../js/units.js';

after(() => setUnits(METRIC));

const TODAY = '2027-01-04';   // a Monday: new plans start on 2027-01-11
const RUN = new Set(['easy', 'long', 'tempo', 'interval', 'recovery', 'run']);
const DIST = { '5k': [5, 8], '10k': [10, 10], hm: [21.0975, 12], marathon: [42.195, 16] };   // km, weeks
const TARGET = {   // target times (s) per distance and level, for realistic paces
  '5k': { einsteiger: 1950, fortgeschritten: 1500, leistung: 1170 },
  '10k': { einsteiger: 4080, fortgeschritten: 3150, leistung: 2460 },
  hm: { einsteiger: 9000, fortgeschritten: 6900, leistung: 5460 },
  marathon: { einsteiger: 18000, fortgeschritten: 14400, leistung: 11400 },
};
const LEVELS = ['einsteiger', 'fortgeschritten', 'leistung'];
const DAYS = [3, 4, 5, 6];
const HISTORY = [{}, { weekKm: 10, longKm: 6 }, { weekKm: 25, longKm: 12 }, { weekKm: 60, longKm: 22 }];
const fb = (dow, intensity = 'normal') => mkCommit('cross_football', dow, { id: `c-fb-${dow}-${intensity}`, intensity });
const match = (dow) => mkCommit('match', dow, { id: `c-m-${dow}` });
const MASKS = {
  none: [],
  'football Tue+Thu': [fb(2), fb(4)],
  'football Fri': [fb(5)],
  'match Fri': [match(5)],
  'football Mon+Wed': [fb(1), fb(3)],
  'match Sun': [match(7)],
  'football Sat': [fb(6)],
  'football Tue': [fb(2)],
  'light football Tue+Thu': [fb(2, 'leicht'), fb(4, 'leicht')],
  'football Mon+Wed, match Sun': [fb(1), fb(3), match(7)],
};

/** A plan as createPlanForEvent builds it – without the store. */
function makePlan({ key, level, days, hist = {}, commitments = [], weeks = DIST[key][1], raceDow = 7 }) {
  const [km] = DIST[key];
  const start0 = planWindow(addDays(TODAY, 7 * weeks), TODAY).start;
  const raceDate = addDays(start0, (weeks - 1) * 7 + (raceDow - 1));
  const event = { id: 'e-1', name: 'Race', date: raceDate, distanceKm: km, sport: 'run' };
  const { start, weeks: w } = planWindow(raceDate, TODAY);
  const pp = planPaces({ distanceKm: km, targetSec: TARGET[key][level] });
  const plan = {
    id: 'p-1', eventId: 'e-1', startDate: start, endDate: raceDate, weeks: w, level, daysPerWeek: days,
    baseWeekKm: hist.weekKm ?? null, baseLongKm: hist.longKm ?? null, paces: pp ? pp.zones : null,
    phases: racePlanPhases(w, start, raceDate, true), weekTemplate: weekTemplateFor('run', days),
    raceDayJoinsTaper: true, commitments, sport: 'run', gen: PLAN_GEN,
  };
  return { plan, event, units: generatePlanUnits(plan, event, {}) };
}

/** Run-walk sessions follow their own steps (RUN_WALK_STEPS); their distance includes the walking. */
const runWalk = (u) => !!(u.intervals && (u.intervals.segments || []).some((s) => s.walk));
const runKm = (list) => list.filter((u) => RUN.has(u.type) && !u.fixed && !runWalk(u)).reduce((a, u) => a + (Number(u.targetDistanceKm) || 0), 0);
const byWeek = (units, weeks) => Array.from({ length: weeks + 1 }, (_, w) => units.filter((u) => u.week === w));
const isKey = (u) => !u.fixed && u.type !== 'race' && (u.type === 'long' || isHard(u));
const hardCommitDates = (units) => new Set(units.filter((u) => u.fixed && isHard(u)).map((u) => u.date));

function report(name, violations) {
  // PLAN_INVARIANTS_ALL=1 lists every violation (for working on the generator).
  if (process.env.PLAN_INVARIANTS_ALL) violations.forEach((v) => console.log(`[${name}] ${v}`));
  assert.equal(violations.length, 0, `${name}: ${violations.length} violation(s), e.g.\n  ${violations.slice(0, 12).join('\n  ')}`);
}

/* ---------------- V: volume ---------------- */
test('PLAN-V: the sessions of a week keep the volume rules', () => {
  const bad = [];
  for (const key of Object.keys(DIST)) for (const level of LEVELS) for (const days of DAYS) for (const hist of HISTORY) {
    const { plan, event, units } = makePlan({ key, level, days, hist });
    const cfg = volumeConfig(plan, event, plan.paces || {});
    const targets = weekVolumes(plan, cfg);
    const weeks = byWeek(units, plan.weeks);
    const tag = `${key}/${level}/${days}d/hist ${hist.weekKm || 0}`;
    let lastFull = null; let maxBuild = 0;
    for (let w = 1; w <= plan.weeks; w++) {
      const list = weeks[w];
      const sum = runKm(list);
      const info = targets[w] || {};
      const raceWeek = list.some((u) => u.type === 'race');
      const walking = w <= cfg.runWalkWeeks + 1;
      if (!raceWeek && !walking && info.km && sum > info.km * 1.05 + 1) bad.push(`${tag} W${w}: ${sum} km of sessions, target ${info.km}`);
      // …and not far below it either (a plan that silently shrinks is as wrong as one that jumps).
      if (!raceWeek && !walking && info.km >= 15 && sum < info.km * 0.8) bad.push(`${tag} W${w}: only ${sum} km of sessions, target ${info.km}`);
      if (!info.taper && !info.deload && !walking && lastFull && sum > lastFull * (1 + cfg.step) + 1.5) {
        bad.push(`${tag} W${w}: ${lastFull} → ${sum} km (+${Math.round((sum / lastFull - 1) * 100)} %, step ${Math.round(cfg.step * 100)} %)`);
      }
      if (info.deload && lastFull != null && sum > lastFull + 0.5) bad.push(`${tag} W${w}: deload ${sum} km after ${lastFull}`);
      if (info.taper && !raceWeek && maxBuild && sum > maxBuild + 0.5) bad.push(`${tag} W${w}: taper ${sum} km above the build peak ${maxBuild}`);
      if (!info.taper && !info.deload && !walking) { lastFull = sum; maxBuild = Math.max(maxBuild, sum); }
      const long = list.find((u) => u.type === 'long');
      if (long && sum >= 15 && !raceWeek && long.targetDistanceKm > cfg.longShare * sum + 1) {
        bad.push(`${tag} W${w}: long run ${long.targetDistanceKm} of ${sum} km (share ${Math.round(cfg.longShare * 100)} %)`);
      }
      const q = list.find((u) => (u.type === 'tempo' || u.type === 'interval') && !u.fixed);
      // Below 15 km every run of the week is 3–4 km long; the order of the runs means nothing there.
      if (q && long && sum >= 15 && !info.taper && !raceWeek && q.targetDistanceKm > long.targetDistanceKm + 0.5) {
        bad.push(`${tag} W${w}: quality ${q.targetDistanceKm} km longer than the long run ${long.targetDistanceKm} km`);
      }
    }
  }
  report('volume', bad);
});

/* ---------------- P: placement next to fixed commitments ---------------- */
function placementViolations(units, plan, event, tag) {
  const bad = [];
  const hard = hardCommitDates(units);
  const raceDate = event.date;
  const keys = units.filter(isKey).sort((a, b) => a.date.localeCompare(b.date));
  for (const u of keys) {
    const dtr = diffDays(u.date, raceDate);
    if (dtr <= 6) continue;   // race week: own rules (R)
    if (hard.has(u.date)) { bad.push(`${tag}: ${u.type} on the day of a fixed commitment (${u.date})`); continue; }
    const before = hard.has(addDays(u.date, 1)); const afterHard = hard.has(addDays(u.date, -1));
    if (u.type !== 'long' && (before || afterHard)) bad.push(`${tag}: ${u.type} next to a fixed commitment (${u.date})`);
    if (u.type === 'long' && afterHard) bad.push(`${tag}: long run the day after a fixed commitment (${u.date})`);
    if (u.type === 'long' && before) {
      // Allowed only when the week holds no calm day for it.
      const ws = addDays(plan.startDate, (u.week - 1) * 7);
      const calm = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).some((d) => d >= plan.startDate && !hard.has(d)
        && !hard.has(addDays(d, -1)) && !hard.has(addDays(d, 1)) && diffDays(d, raceDate) > 2);
      if (calm) bad.push(`${tag}: long run the day before a fixed commitment although a calm day was free (${u.date})`);
    }
  }
  // Two demanding sessions of the plan on consecutive days (also across a week boundary).
  const demanding = units.filter((u) => !u.fixed && u.type !== 'race' && isHard(u));
  const hardAll = units.filter((u) => isHard(u) && u.type !== 'race');
  for (const u of demanding) {
    if (diffDays(u.date, raceDate) <= 6) continue;
    const n = hardAll.find((x) => x !== u && x.date === addDays(u.date, 1) && !(x.fixed && u.fixed));
    if (n && !(n.fixed && n.downgradedFrom)) bad.push(`${tag}: ${u.type} (${u.date}) and ${n.fixed ? 'fixed ' : ''}${n.type} the next day`);
  }
  return bad;
}

test('PLAN-P: quality sessions and long runs keep their distance to fixed commitments and to each other', () => {
  const bad = [];
  for (const key of Object.keys(DIST)) for (const level of LEVELS) for (const days of DAYS) for (const [mask, commitments] of Object.entries(MASKS)) {
    const { plan, event, units } = makePlan({ key, level, days, commitments });
    bad.push(...placementViolations(units, plan, event, `${key}/${level}/${days}d/${mask}`));
  }
  report('placement', bad);
});

test('PLAN-P: also when the person\'s week starts on Sunday, and for a race on Saturday', () => {
  setUnits({ ...METRIC, weekStart: 0 });
  const bad = [];
  try {
    for (const key of ['10k', 'hm']) for (const days of DAYS) for (const [mask, commitments] of Object.entries(MASKS)) {
      for (const raceDow of [6, 7]) {
        const { plan, event, units } = makePlan({ key, level: 'fortgeschritten', days, commitments, raceDow });
        bad.push(...placementViolations(units, plan, event, `${key}/${days}d/${mask}/race dow ${raceDow}/week from Sunday`));
      }
    }
  } finally { setUnits(METRIC); }
  report('placement (Sunday weeks)', bad);
});

test('PLAN-P: another plan\'s fixed commitments count as the person\'s own', () => {
  // Plan A (10 km) carries football Tue+Thu; plan B (half marathon) knows it only through coveredFixed.
  const a = makePlan({ key: '10k', level: 'fortgeschritten', days: 4, commitments: MASKS['football Tue+Thu'] });
  const covered = new Set(a.units.filter((u) => u.fixed).map((u) => `${u.type}|${u.date}`));
  const b = makePlan({ key: 'hm', level: 'fortgeschritten', days: 4 });
  const units = generatePlanUnits(b.plan, b.event, {}, { coveredFixed: covered });
  const both = [...units, ...a.units.filter((u) => u.fixed && u.date <= b.event.date)];
  report('placement across plans', placementViolations(both, b.plan, b.event, 'hm with the 10 km plan\'s football'));
});

/* ---------------- R: race week ---------------- */
test('PLAN-R: the day before every race is a short shakeout, two days before is free', () => {
  const bad = [];
  for (const key of Object.keys(DIST)) for (const level of LEVELS) for (const days of DAYS) for (const raceDow of [1, 2, 3, 4, 5, 6, 7]) {
    const { event, units } = makePlan({ key, level, days, raceDow });
    const tag = `${key}/${level}/${days}d/race dow ${raceDow}`;
    const d1 = units.filter((u) => u.date === addDays(event.date, -1));
    const d2 = units.filter((u) => u.date === addDays(event.date, -2) && !u.fixed);
    if (!d1.some((u) => u.type === 'recovery' && (u.targetDistanceKm || 0) <= 4)) bad.push(`${tag}: no shakeout the day before (${d1.map((u) => u.type).join(', ') || 'nothing'})`);
    if (d1.some((u) => u.type !== 'recovery')) bad.push(`${tag}: more than a shakeout the day before (${d1.map((u) => u.type).join(', ')})`);
    if (d2.length) bad.push(`${tag}: ${d2.map((u) => u.type).join(', ')} two days before`);
  }
  report('race week', bad);
});

/* ---------------- M: marathon volume ---------------- */
test('PLAN-M: a standard marathon plan reaches the volume behind the race prediction', () => {
  // The thresholds come from the prediction itself (suggestions.js volumeCaveat), not typed here.
  let longNeeded = 0; while (volumeCaveat(42.195, { weekKm: 999, longestKm: longNeeded })) longNeeded += 0.5;
  let weekNeeded = 0; while (volumeCaveat(42.195, { weekKm: weekNeeded, longestKm: 999 })) weekNeeded += 0.5;
  const bad = [];
  for (const level of ['fortgeschritten', 'leistung']) for (const days of [4, 5, 6]) {
    const { plan, units } = makePlan({ key: 'marathon', level, days });
    const weeks = byWeek(units, plan.weeks).map(runKm);
    const longest = Math.max(...units.filter((u) => u.type === 'long').map((u) => u.targetDistanceKm || 0));
    let best4 = 0;
    for (let w = 4; w <= plan.weeks; w++) best4 = Math.max(best4, (weeks[w] + weeks[w - 1] + weeks[w - 2] + weeks[w - 3]) / 4);
    if (longest < longNeeded) bad.push(`marathon/${level}/${days}d: longest run ${longest} km, the prediction asks for ${longNeeded}`);
    if (best4 < weekNeeded) bad.push(`marathon/${level}/${days}d: best four weeks ${best4.toFixed(1)} km/week, the prediction asks for ${weekNeeded}`);
  }
  report('marathon', bad);
});

/* ---------------- C: fixed commitments do not stall the plan ---------------- */
test('PLAN-C: when a commitment takes the day of a run, the runs that remain carry the week', () => {
  // Long plans from a small start: the weeks have room to grow, so a plan that stops growing shows.
  const LONG = { hm: 24, marathon: 30 };
  const hist = { weekKm: 10, longKm: 6 };
  const full = (plan, event) => { const t = weekVolumes(plan, volumeConfig(plan, event, plan.paces || {})); return (w) => t[w] && !t[w].deload && !t[w].taper; };
  const bad = [];
  for (const key of Object.keys(LONG)) for (const level of LEVELS) for (const days of [4, 5, 6]) for (const mask of Object.keys(MASKS)) {
    if (mask === 'none') continue;
    const { plan, event, units } = makePlan({ key, level, days, hist, commitments: MASKS[mask], weeks: LONG[key] });
    const isFull = full(plan, event);
    const weeks = byWeek(units, plan.weeks);
    const runsOf = (list) => list.filter((u) => RUN.has(u.type) && !u.fixed && !runWalk(u)).length;
    let peak = 0; let fewest = 9;
    for (let w = 2; w <= plan.weeks; w++) {
      if (!isFull(w) || weeks[w].some((u) => u.type === 'race')) continue;
      peak = Math.max(peak, runKm(weeks[w]));
      fewest = Math.min(fewest, runsOf(weeks[w]));
      // The day before the long run carries the week's shortest easy run (the templates keep it free).
      const long = weeks[w].find((u) => u.type === 'long' && !u.fixed);
      const easy = weeks[w].filter((u) => !u.fixed && (u.type === 'easy' || u.type === 'recovery') && !isHard(u) && u.targetDistanceKm > 0 && diffDays(u.date, event.date) > 6);
      const eve = long && easy.find((u) => u.date === addDays(long.date, -1));
      if (eve && easy.some((u) => u.targetDistanceKm < eve.targetDistanceKm)) bad.push(`${key}/${level}/${days}d/${mask} W${w}: ${eve.targetDistanceKm} km the day before the long run although a shorter easy run is in the week`);
    }
    // The same plan for a person who runs on that many days and has no commitments.
    const ref = makePlan({ key, level, days: Math.max(3, Math.min(days, fewest)), hist, weeks: LONG[key] });
    const refFull = full(ref.plan, ref.event);
    const refPeak = Math.max(...byWeek(ref.units, ref.plan.weeks).map((list, w) => (w >= 2 && refFull(w) ? runKm(list) : 0)));
    if (peak < refPeak * 0.8) bad.push(`${key}/${level}/${days}d/${mask}: peaks at ${peak} km a week in ${fewest} runs – a plan for that many run days reaches ${refPeak}`);
  }
  report('commitments', bad);
});

/* ---------------- S: strength that follows the plan phase ---------------- */
test('PLAN-S: strength in run plans follows the phase, never next to a demanding day, never a fourth demanding session', () => {
  const bad = [];
  const S_MASKS = ['none', 'football Tue+Thu', 'football Fri', 'football Mon+Wed', 'match Sun'];
  for (const key of ['10k', 'hm', 'marathon']) for (const days of DAYS) for (const mask of S_MASKS) for (const strengthDays of [1, 2]) {
    const { plan, event, units } = makePlan({ key, level: 'fortgeschritten', days, commitments: MASKS[mask] });
    const withS = generatePlanUnits({ ...plan, strengthDays }, event, {});
    const tag = `${key}/${days}d/${mask}/strength ${strengthDays}`;
    bad.push(...placementViolations(withS, plan, event, tag));
    for (let w = 1; w <= plan.weeks; w++) {
      const list = withS.filter((u) => u.week === w || (u.fixed && u.week === w));
      const str = list.filter((u) => u.type === 'strength');
      const phase = plan.phases.find((p) => w >= p.startWeek && w <= p.endWeek).key;
      const target = weekVolumes(plan, volumeConfig(plan, event, plan.paces || {}))[w] || {};
      const max = target.taper || phase === 'taper' ? 0 : phase === 'base' && !target.deload ? strengthDays : 1;
      if (str.length > max) bad.push(`${tag} W${w} (${phase}): ${str.length} strength sessions, at most ${max}`);
      if (str.some((s) => diffDays(s.date, event.date) <= 6)) bad.push(`${tag} W${w}: strength in the race week`);
      const hardWithout = units.filter((u) => u.week === w && isHard(u)).length;
      const hardWith = list.filter(isHard).length;
      if (str.length && hardWith > Math.max(3, hardWithout)) bad.push(`${tag} W${w}: strength makes ${hardWith} demanding sessions`);
      if (mask === 'none' && days >= 4 && !target.deload && !target.taper && phase !== 'taper' && str.length < max) {
        bad.push(`${tag} W${w} (${phase}): only ${str.length} of ${max} strength sessions although the week has room`);
      }
      // The run sessions do not change.
      const runs = (l) => l.filter((u) => u.type !== 'strength').map((u) => `${u.date}|${u.type}|${u.targetDistanceKm}`).sort().join();
      if (runs(list.filter((u) => u.week === w)) !== runs(units.filter((u) => u.week === w))) bad.push(`${tag} W${w}: the runs changed`);
    }
  }
  report('strength', bad);
});

/* ---------------- W: one week alone equals the whole plan ---------------- */
test('PLAN-W: a week built alone equals that week of the whole plan', () => {
  const bad = [];
  const shape = (u) => `${u.date}|${u.type}|${u.targetDistanceKm ?? ''}|${u.targetDurationMin ?? ''}|${u.relocatedFrom || ''}`;
  for (const [mask, commitments] of Object.entries(MASKS)) for (const days of DAYS) for (const strengthDays of [0, 2]) {
    const made = makePlan({ key: 'hm', level: 'fortgeschritten', days, commitments });
    const plan = { ...made.plan, strengthDays };
    const units = strengthDays ? generatePlanUnits(plan, made.event, {}) : made.units;
    for (let w = 1; w <= plan.weeks; w++) {
      const alone = buildWeekUnits(plan, made.event, {}, w).map(shape).sort().join('\n');
      const inPlan = units.filter((u) => u.week === w).map(shape).sort().join('\n');
      if (alone !== inPlan) bad.push(`hm/${days}d/${mask}/strength ${strengthDays} W${w}`);
    }
  }
  report('single week', bad);
});

/* ---------------- B: side races of the season ---------------- */
/** Weeks that a side race's window reaches (lighter by design, never a reference). */
function touchedWeeks(plan, sides) {
  const out = new Set();
  for (const r of sides) {
    for (let d = addDays(r.date, -Math.max(1, r.taper)); d <= addDays(r.date, r.recovery); d = addDays(d, 1)) {
      out.add(Math.floor(diffDays(plan.startDate, d) / 7) + 1);
    }
  }
  return out;
}

function sideViolations(plan, event, units, tag, baseUnits) {
  const bad = [];
  const targets = weekVolumes(plan, volumeConfig(plan, event, plan.paces || {}));
  const sides = sideRacesOf(plan, targets);
  for (const raw of plan.sideRaces) {
    const r = sides.find((s) => s.eventId === raw.eventId);
    const races = units.filter((u) => u.type === 'race' && u.eventId === raw.eventId);
    if (!r) { if (races.length) bad.push(`${tag}: ${raw.priority} ${raw.distanceKm} km on ${raw.date} built in although outside the rules`); continue; }
    if (races.length !== 1 || races[0].date !== r.date || races[0].sideRace !== r.priority) bad.push(`${tag}: ${races.length} race sessions for the side race`);
    for (const u of units) {
      if (u.fixed || u.type === 'race') continue;
      const n = diffDays(u.date, r.date);   // days before the race (negative: after)
      if (n <= 1 && n >= -r.recovery && isHard(u)) bad.push(`${tag}: ${u.type} on ${u.date}, ${n > 0 ? 'the day before' : `${-n} day(s) after`} the ${r.priority} race`);
      if (r.priority === 'B' && n === 1 && !(u.type === 'recovery' && (u.targetDistanceKm || 0) <= 4)) bad.push(`${tag}: ${u.type} the day before the B race`);
      if (r.priority === 'B' && n === 2) bad.push(`${tag}: ${u.type} two days before the B race`);
      if (u.type === 'strength' && n >= -r.recovery && n <= (r.priority === 'B' ? r.taper + 1 : 2)) bad.push(`${tag}: strength ${n} day(s) before the ${r.priority} race`);
      if (r.priority === 'C' && (u.type === 'tempo' || u.type === 'interval') && u.week === Math.floor(diffDays(plan.startDate, r.date) / 7) + 1) bad.push(`${tag}: quality session in the C race's week`);
    }
  }
  if (units.filter((u) => u.type === 'race' && u.date === event.date).length !== 1) bad.push(`${tag}: the main race is missing`);
  // The weeks around the side races, built alone, equal the whole plan.
  const shape = (u) => `${u.date}|${u.type}|${u.targetDistanceKm ?? ''}|${u.targetDurationMin ?? ''}|${u.relocatedFrom || ''}|${u.eventId}`;
  for (const w of touchedWeeks(plan, sides)) {
    if (w < 1 || w > plan.weeks) continue;
    const alone = buildWeekUnits(plan, event, {}, w).map(shape).sort().join('\n');
    const inPlan = units.filter((u) => u.week === w).map(shape).sort().join('\n');
    if (alone !== inPlan) bad.push(`${tag}: week ${w} built alone differs`);
  }
  // Outside the side races' weeks the plan is the plan without them: a side race leaves no lasting
  // dent in the build (its weeks are skipped as a reference, the build goes on meanwhile).
  const touched = touchedWeeks(plan, sides);
  const cfg = volumeConfig(plan, event, plan.paces || {});
  const weeks = byWeek(units, plan.weeks);
  const baseWeeks = byWeek(baseUnits, plan.weeks);
  let lastFull = null, gap = 0;
  for (let w = 1; w <= plan.weeks; w++) {
    const info = targets[w] || {};
    if (info.deload || info.taper) continue;
    if (touched.has(w)) { gap++; continue; }
    const sum = runKm(weeks[w]), base = runKm(baseWeeks[w]);
    if (sum < base - 1) bad.push(`${tag} W${w}: ${sum} km, without the side race ${base} km`);
    if (w > cfg.runWalkWeeks + 1 && lastFull && sum > lastFull * (1 + cfg.step) ** (1 + gap) + 1.5) {
      bad.push(`${tag} W${w}: ${lastFull} → ${sum} km over ${1 + gap} week(s), step ${Math.round(cfg.step * 100)} %`);
    }
    if (w > cfg.runWalkWeeks) { lastFull = sum; gap = 0; }
  }
  return bad;
}

test('PLAN-B: side races are built in with a short taper and recovery, the plan around them keeps its rules', () => {
  const bad = [];
  let built = 0;
  const cases = [
    ...['10k', 'hm', 'marathon'].map((key) => ({ key, level: 'fortgeschritten', hist: { weekKm: 25, longKm: 12 } })),
    { key: '5k', level: 'einsteiger', hist: {} },
  ];
  for (const { key, level, hist } of cases) for (const days of [3, 4, 5]) for (const mask of ['none', 'football Mon+Wed', 'match Sun']) {
    const base = makePlan({ key, level, days, hist, commitments: MASKS[mask] });
    const targets = weekVolumes(base.plan, volumeConfig(base.plan, base.event, base.plan.paces || {}));
    const lastBuild = Math.max(...targets.map((t, w) => (t && !t.taper ? w : 0)));
    const deload = targets.findIndex((t) => t && t.deload);
    for (const week of [...new Set([2, deload > 0 ? deload : 3, lastBuild, lastBuild + 1])]) for (const dow of [6, 7]) for (const priority of ['B', 'C']) for (const km of [5, 10, 21.1]) {
      const date = addDays(base.plan.startDate, (week - 1) * 7 + dow - 1);
      const plan = { ...base.plan, strengthDays: 1, sideRaces: [{ eventId: 'e-side', date, priority, name: 'Side race', distanceKm: km }] };
      const units = generatePlanUnits(plan, base.event, {});
      if (units.some((u) => u.sideRace)) built++;
      const tag = `${key}/${days}d/${mask}/${priority} ${km} km W${week} dow ${dow}`;
      bad.push(...sideViolations(plan, base.event, units, tag, generatePlanUnits({ ...base.plan, strengthDays: 1 }, base.event, {})));
      bad.push(...placementViolations(units, plan, base.event, tag));
    }
  }
  assert.ok(built > 500, `only ${built} plans built a side race in`);
  report('side races', bad);
});

test('PLAN-B: two side races within three days – only one is built in, the B race before the C race', () => {
  const base = makePlan({ key: 'hm', level: 'fortgeschritten', days: 4, hist: { weekKm: 25, longKm: 12 } });
  const sat = addDays(base.plan.startDate, 4 * 7 + 5);
  const plan = { ...base.plan, sideRaces: [
    { eventId: 'e-c', date: sat, priority: 'C', name: 'C', distanceKm: 5 },
    { eventId: 'e-b', date: addDays(sat, 1), priority: 'B', name: 'B', distanceKm: 10 },
  ] };
  const units = generatePlanUnits(plan, base.event, {});
  assert.deepEqual(units.filter((u) => u.sideRace).map((u) => u.eventId), ['e-b']);
  report('side races close together', sideViolations(plan, base.event, units, 'C Sat + B Sun', generatePlanUnits(base.plan, base.event, {})));
  const two = { ...base.plan, sideRaces: [{ ...plan.sideRaces[0] }, { ...plan.sideRaces[0], eventId: 'e-c2', date: addDays(sat, 3) }] };
  assert.deepEqual(generatePlanUnits(two, base.event, {}).filter((u) => u.sideRace).map((u) => u.eventId), ['e-c'], 'two C races: the earlier');
});

test('PLAN-B: longer than 25 km, in the taper, on or after the main race – not built in, the plan stays as it was', () => {
  const base = makePlan({ key: 'hm', level: 'fortgeschritten', days: 4, hist: { weekKm: 25, longKm: 12 } });
  const shape = (list) => list.map((u) => `${u.date}|${u.type}|${u.targetDistanceKm ?? ''}`).join();
  for (const side of [
    { date: addDays(base.plan.startDate, 5 * 7 + 6), distanceKm: SIDE_RACE_MAX_KM + 17 },   // a marathon
    { date: addDays(base.event.date, -6), distanceKm: 10 },                                 // taper
    { date: base.event.date, distanceKm: 10 },
    { date: addDays(base.plan.startDate, 5 * 7 + 6), distanceKm: 10, priority: 'A' },
  ]) {
    const plan = { ...base.plan, sideRaces: [{ eventId: 'e-side', name: 'x', priority: 'B', ...side }] };
    assert.equal(shape(generatePlanUnits(plan, base.event, {})), shape(base.units), JSON.stringify(side));
  }
});
