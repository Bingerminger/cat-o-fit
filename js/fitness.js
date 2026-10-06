/* =========================================================================
   fitness.js — pure evaluation logic for the statistics: traffic-light status
   ("Am I on track?"), training load, reasons for missed sessions and metrics with
   target values (from practical feedback). Deliberately free of DOM/store, so
   everything stays testable — `today` is always passed in.
   ========================================================================= */

import { diffDays, fmtPace, weekStart, addDays, typeMeta, fmtDec } from './ui.js';
import { weightGoalStatus } from './energy.js';
import { acwr, sessionLoad, trainingLoad, loadMinutes, RPE_BY_TYPE, FOOTBALL_RPE, footballRpe } from './load.js';
import { kgToShown, kmToShown, weightUnit, paceUnit, distanceUnit } from './units.js';

import { t } from './i18n.js';

// The load per session lives in load.js (one source for all load verdicts);
// passed on here for existing imports.
export { sessionLoad, trainingLoad, RPE_BY_TYPE, FOOTBALL_RPE, footballRpe };

const EASY_TYPES = ['easy', 'long', 'recovery'];
const fmt1 = (v) => fmtDec(Math.round(v * 10) / 10);
const fmt0 = (v) => String(Math.round(v));
// Values stay metric (trend and target logic); `fmt` shows them in the person's unit.
const fmtKg = (v) => fmt1(kgToShown(v));
const fmtKm0 = (v) => fmt0(kmToShown(v));

/** Running session (category "run": easy, long, tempo, interval, race, recovery, run). */
export function isRunSession(s) { return !!s && typeMeta(s.type).cat === 'run'; }

/**
 * Running km of the sessions dated within [from, to] (ISO, inclusive) – ONE source for
 * all running metrics (statistics, Today, monthly report). Cycling, walking, hiking and
 * swimming do carry a distance but do not count here: previously 8 km of
 * running plus 40 km of cycling gave "48 running km".
 */
export function runKm(sessions = [], from, to) {
  return (sessions || []).reduce((a, s) => (s && !s.deleted && s.date && isRunSession(s)
    && (!from || s.date >= from) && (!to || s.date <= to) ? a + (Number(s.distanceKm) || 0) : a), 0);
}

/** Running km in the window [from, to) days before `today`. */
function sumKm(sessions, today, from, to) {
  return runKm(sessions, addDays(today, -(to - 1)), addDays(today, -from));
}

/** Health-related absence (ill, injured) – never counts against you. */
export function isHealthMiss(u) {
  return !!u && u.status === 'verpasst' && (u.missedReason === 'sick' || u.missedReason === 'injured');
}

/**
 * Plan adherence – ONE definition for statistics, achievements, race/programme page
 * and monthly report. A session is due once its day has passed; today's counts
 * only once it is done (so the rate does not drop in the morning). Rest days,
 * health-related absences and protected cycle days are neutral. `from`/`to`
 * bound the window (ISO, inclusive) – in the monthly report `to = min(end of month, today)`.
 * @returns {{due:number, done:number, pct:number|null}}
 */
export function adherence(plans = [], { from = null, to = null, today, isProtectedDay = () => false } = {}) {
  let due = 0, done = 0;
  (plans || []).forEach((p) => ((p && !p.deleted && p.units) || []).forEach((u) => {
    if (!u || u.deleted || !u.date || u.type === 'rest') return;
    if ((from && u.date < from) || (to && u.date > to) || u.date > today) return;
    if (u.status === 'erledigt') { due++; done++; return; }
    if (u.date === today || isHealthMiss(u) || isProtectedDay(u.date)) return;
    due++;
  }));
  return { due, done, pct: due ? Math.round((done / due) * 100) : null };
}

/** Longest run completed in the last `days` days (km) – current long-run status. */
export function recentLongRunKm(sessions = [], today, days = 28) {
  let max = 0;
  sessions.forEach((s) => {
    if (!s || s.deleted || !s.distanceKm) return;
    if (!['easy', 'long', 'race', 'run', 'tempo'].includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d >= 0 && d <= days && s.distanceKm > max) max = s.distanceKm;
  });
  return Math.round(max * 2) / 2;
}

/**
 * Training load for the statistics traffic light – built on `load.js acwr()`, so that
 * statistics and "Today" never reach different verdicts. In the first 28 days
 * (`sparse`) there is the level "aufbau" (build-up) without a colour rating; previously the
 * traffic light told beginners "Caution – adjust", while "Today" honestly said "Your data
 * is still building up". The running km are retained for display.
 * @returns {{last7:number, last28:number, ratio:number|null, level:'unklar'|'aufbau'|'niedrig'|'ok'|'hoch', zone:string, sparse:boolean, acute:number, chronic:number}}
 */
export function loadBalance(sessions = [], today) {
  const ac = acwr(sessions, today);
  const level = ac.zone === 'aufbau' ? 'aufbau' : ac.ratio == null ? 'unklar'
    : ac.zone === 'optimal' ? 'ok' : ac.zone === 'niedrig' ? 'niedrig' : 'hoch';
  return {
    last7: sumKm(sessions, today, 0, 7), last28: sumKm(sessions, today, 0, 28),
    ratio: ac.ratio, level, zone: ac.zone, sparse: ac.sparse, acute: ac.acute, chronic: ac.chronic,
  };
}

/** Missed sessions of the last `days` days, grouped by reason (#21). */
export function missedBreakdown(plans = [], today, days = 28) {
  const byReason = { time: 0, sick: 0, injured: 0, other: 0 };
  let total = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.status !== 'verpasst') return;
    const d = diffDays(u.date, today);
    if (d < 0 || d > days) return;
    byReason[byReason[u.missedReason] != null ? u.missedReason : 'other']++;
    total++;
  }));
  return { total, byReason };
}

/**
 * "Am I on track?" — traffic-light status (#20) from plan adherence, training load
 * and health-related absences. Returns level (gruen|gelb|rot), a title
 * and traceable reasons.
 * @param {object} a
 * @param {Function} [a.isProtectedDay] protected days do not count as a penalty
 */
export function planStatus({ plans = [], sessions = [], today, isProtectedDay = () => false } = {}) {
  const adh = adherence(plans, { from: addDays(today, -28), to: today, today, isProtectedDay });
  const { due, done } = adh;
  const load = loadBalance(sessions, today);
  const missed = missedBreakdown(plans, today, 28);

  const LEVELS = ['gruen', 'gelb', 'rot'];
  let li = 0;
  const bump = (lvl) => { li = Math.max(li, LEVELS.indexOf(lvl)); };
  const reasons = [];

  if (adh.pct == null) reasons.push({ ok: null, text: t('fitness.noDueSessions') });
  else if (adh.pct >= 80) reasons.push({ ok: true, text: t('fitness.planKept', { pct: adh.pct }) });
  else if (adh.pct >= 50) { reasons.push({ ok: false, text: t('fitness.planKeptSome', { pct: adh.pct }) }); bump('gelb'); }
  else { reasons.push({ ok: false, text: t('fitness.planKeptFew', { pct: adh.pct }) }); bump('rot'); }

  // Same levels and wording as the "Load & form" card (elevated / clearly elevated).
  if (load.level === 'hoch') {
    reasons.push({ ok: false, text: load.zone === 'hoch' ? t('fitness.loadHigh') : t('fitness.loadRaised') });
    bump(load.ratio > 1.5 ? 'rot' : 'gelb');
  }
  else if (load.level === 'niedrig') reasons.push({ ok: null, text: t('fitness.loadQuiet') });
  else if (load.level === 'ok') reasons.push({ ok: true, text: t('fitness.loadOk') });
  else if (load.level === 'aufbau') reasons.push({ ok: null, text: t('fitness.loadBuilding') });

  // Health-related absences are neutral: they do not colour the traffic light and
  // do not count against adherence – only the note remains.
  if (missed.byReason.injured > 0) reasons.push({ ok: null, text: t('fitness.missedInjured', { n: missed.byReason.injured }) });
  else if (missed.byReason.sick > 0) reasons.push({ ok: null, text: t('fitness.missedSick', { n: missed.byReason.sick }) });

  const level = LEVELS[li];
  const title = level === 'gruen' ? t('fitness.titleGreen') : level === 'gelb' ? t('fitness.titleYellow') : t('fitness.titleRed');
  return { level, title, adherence: adh.pct, due, done, load, missed, reasons };
}

/* ---- Metrics with target value + maintain/improve (#19) and trend "cross-linking" (#22) ---- */

function lastVal(arr, key) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] != null) return arr[i][key];
  return null;
}
/**
 * Median of the values in the window [refDate−win+1 … refDate] – a robust trend basis.
 * Weight fluctuates by ±1–2 kg depending on the day (water, gut contents, glycogen), and
 * so does resting heart rate. Comparing two SINGLE data points therefore produces
 * random trends; the median over a week smooths that away (trend weight).
 */
function smoothVal(arr, key, refDate, win = 7) {
  const vals = arr
    .filter((x) => x[key] != null && x.date <= refDate && diffDays(x.date, refDate) < win)
    .map((x) => x[key])
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

/**
 * Change of a body metric via the smoothed trend: 7-day median on the most recent
 * measurement day against the 7-day median at the last measurement that lies at least `gapDays`
 * before it (also works with infrequent weighing). Comparing two single values used to show
 * daily fluctuations as progress or regression.
 * @returns {null|{now:number, before:number|null, delta:number|null, since:string|null, lastDate:string}}
 */
export function smoothedChange(health = [], key, { gapDays = 7, win = 7 } = {}) {
  const arr = (health || [])
    .filter((x) => x && !x.deleted && x.date && x[key] != null && x[key] !== '' && Number.isFinite(Number(x[key])))
    .map((x) => ({ date: x.date, [key]: Number(x[key]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!arr.length) return null;
  const lastDate = arr.at(-1).date;
  const now = smoothVal(arr, key, lastDate, win);
  const prev = [...arr].reverse().find((x) => diffDays(x.date, lastDate) >= gapDays);
  if (!prev) return { now, before: null, delta: null, since: null, lastDate };
  const before = smoothVal(arr, key, prev.date, win);
  return { now, before, delta: Math.round((now - before) * 100) / 100, since: prev.date, lastDate };
}

/** Most recent value that lies at least `minDaysAgo` days back (comparison basis). */
function valBefore(arr, key, today, minDaysAgo) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][key] == null) continue;
    if (diffDays(arr[i].date, today) >= minDaysAgo) return arr[i][key];
  }
  return null;
}
/** Average pace (sec./km) of easy runs in the window [from, to). With `maxHr` only
    runs count whose average heart rate is at most that (base zone) – faster is
    only better if the run was also easy. */
function avgPaceSec(sessions, today, from, to, maxHr = null) {
  let dist = 0, sec = 0;
  sessions.forEach((s) => {
    const d = diffDays(s.date, today);
    if (d < from || d >= to || !EASY_TYPES.includes(s.type) || !s.distanceKm || !s.durationSec) return;
    if (maxHr != null && !(Number(s.avgHr) > 0 && Number(s.avgHr) <= maxHr)) return;
    dist += s.distanceKm; sec += s.durationSec;
  });
  return dist > 0 ? sec / dist : null;
}

/**
 * List of the key metrics with current value, trend direction and target.
 * Each metric: { key, label, value, unit, target?, dir, good, goal, hint, fmt }.
 * `dir`: up|down|flat · `good`: true|false|null · `goal`: 'halten'|'verbessern' (maintain|improve).
 */
export function keyMetrics({ profile = {}, health = [], sessions = [], today, noWeightGoals = false } = {}) {
  const h = [...health].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  const push = (m) => { if (m && m.value != null) out.push(m); };
  const dirOf = (cur, prev, eps) => (prev == null ? 'flat' : cur > prev + eps ? 'up' : cur < prev - eps ? 'down' : 'flat');
  const goodOf = (dir, better) => (dir === 'flat' ? null : better === 'up' ? dir === 'up' : dir === 'down');

  // Weight — towards the target weight (maintain when close)
  const w = lastVal(h, 'weight') ?? profile.weightKg ?? null;
  // Children, pregnancy/breastfeeding, eating disorder: no target weight (eligibility.js).
  const target = noWeightGoals ? null : (profile.targetWeightKg ?? null);
  if (w != null) {
    // The most recently measured value is displayed; what is RATED is the smoothed
    // trend (7-day median now vs. 4 weeks ago) – otherwise the chance of a single weigh-in
    // day would decide between "improved/worsened".
    const cur7 = smoothVal(h, 'weight', today, 7) ?? w;
    const prev = smoothVal(h, 'weight', addDays(today, -28), 10) ?? valBefore(h, 'weight', today, 21);
    const dir = dirOf(cur7, prev, 0.3);
    let good = null, goal = null, hint = t('fitness.currentValue');
    // Same target definition as nutrition, cockpit and weekly goals (energy.js).
    const gs = target != null ? weightGoalStatus({ current: cur7, target, start: profile.targetWeightStartKg != null ? profile.targetWeightStartKg : profile.weightKg }) : null;
    if (gs) {
      goal = gs.status === 'halten' ? 'halten' : 'verbessern';
      if (goal === 'halten') { good = true; hint = gs.beyond ? (gs.gap > 0 ? t('fitness.holdAbove') : t('fitness.holdBelow')) : t('fitness.atTarget'); }
      else { good = prev == null ? null : (gs.direction === 'down' ? dir === 'down' : dir === 'up'); hint = gs.gap > 0 ? t('fitness.kgAbove', { weight: `${fmtKg(gs.remaining)} ${weightUnit()}` }) : t('fitness.kgBelow', { weight: `${fmtKg(gs.remaining)} ${weightUnit()}` }); }
    }
    push({ key: 'weight', label: t('fitness.weight'), value: w, unit: weightUnit(), target, dir, good, goal, hint, fmt: fmtKg });
  }

  // Weekly volume — building up counts as progress
  const km4 = sumKm(sessions, today, 0, 28) / 4;
  if (km4 > 0) {
    const kmPrev = sumKm(sessions, today, 28, 56) / 4;
    const dir = dirOf(km4, kmPrev > 0 ? kmPrev : null, 1);
    push({ key: 'weeklyKm', label: t('fitness.weeklyKm'), value: km4, unit: t('fitness.kmPerWeek', { unit: distanceUnit() }), dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: t('fitness.weeklyKmHint', { unit: distanceUnit() }), fmt: fmtKm0 });
  }

  // Easy pace — faster at the same easiness is better. "Same easiness" means: average
  // heart rate in the base zone (Z2). Without HR zones or HR data the metric shows only
  // the value, without an "improved" verdict – otherwise it would reward exactly the
  // overpacing of the easy runs.
  const z2 = (profile.hrZones || []).find((z) => z && z.zone === 2);
  const z2Pace = z2 ? avgPaceSec(sessions, today, 0, 28, z2.max) : null;
  if (z2Pace != null) {
    const dir = dirOf(z2Pace, avgPaceSec(sessions, today, 28, 56, z2.max), 3);
    push({ key: 'easyPace', label: t('fitness.easyPace'), value: z2Pace, unit: paceUnit(), dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: t('fitness.easyPaceHint'), fmt: fmtPace });
  } else {
    const pace = avgPaceSec(sessions, today, 0, 28);
    if (pace != null) {
      const dir = dirOf(pace, avgPaceSec(sessions, today, 28, 56), 3);
      push({ key: 'easyPace', label: t('fitness.easyPace'), value: pace, unit: paceUnit(), dir, good: null, goal: 'verbessern', hint: t('fitness.easyPaceNoHr'), fmt: fmtPace });
    }
  }

  // Resting heart rate — lower means fitter
  const rhr = lastVal(h, 'restingHr');
  if (rhr != null) {
    const cur7 = smoothVal(h, 'restingHr', today, 7) ?? rhr;
    const prevR = smoothVal(h, 'restingHr', addDays(today, -28), 10) ?? valBefore(h, 'restingHr', today, 21);
    const dir = dirOf(cur7, prevR, 1);
    push({ key: 'restingHr', label: t('fitness.restingHr'), value: rhr, unit: 'bpm', dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: t('fitness.restingHrHint'), fmt: fmt0 });
  }

  // VO₂max — higher means more endurance performance
  const vo2 = lastVal(h, 'vo2max');
  if (vo2 != null) {
    const dir = dirOf(vo2, valBefore(h, 'vo2max', today, 21), 0.5);
    push({ key: 'vo2max', label: 'VO₂max', value: vo2, unit: '', dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: t('fitness.vo2Hint'), fmt: fmt1 });
  }

  return out;
}

/* ---- Activity heatmap over the year (GitHub contributions style) ---- */

/** Training "minutes" of a session – same estimate as for the load
    (logged → from the distance → planned → 30 min, see `load.js loadMinutes`). */
export function sessionMinutes(s) {
  return loadMinutes(s).min;
}
/** Activity level 0–4 by daily minutes (fixed, intuitive thresholds). */
function activityLevel(min) {
  return min <= 0 ? 0 : min < 30 ? 1 : min < 60 ? 2 : min < 90 ? 3 : 4;
}

/**
 * Builds the week/weekday matrix of the last `weeks` weeks (one column per week, from the person's first day of the week).
 * Per day: { date, minutes, level (0–4), future }. Future days: level -1.
 * @returns {{cols: Array<{weekStart:string, days:Array}>, max:number, totalDays:number, activeDays:number}}
 */
export function activityMatrix({ sessions = [], today, weeks = 53 } = {}) {
  const perDay = {};
  sessions.forEach((s) => {
    if (!s || s.deleted || !s.date) return;
    perDay[s.date] = (perDay[s.date] || 0) + sessionMinutes(s);
  });
  const start = addDays(weekStart(today), -(weeks - 1) * 7);
  const cols = [];
  let max = 0, activeDays = 0, totalDays = 0;
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d);
      const future = date > today;
      const minutes = Math.round(perDay[date] || 0);
      const level = future ? -1 : activityLevel(minutes);
      if (!future) { totalDays++; if (minutes > 0) activeDays++; if (minutes > max) max = minutes; }
      days.push({ date, minutes, level, future });
    }
    cols.push({ weekStart: ws, days });
  }
  return { cols, max, totalDays, activeDays };
}
