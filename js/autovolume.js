/* =========================================================================
   autovolume.js — automatic volume adjustment of the running plan week.
   Pure, DOM-free logic; the apply step lives in adapt.js (log + undo).

   Until 4.1 the app only suggested easing off (coach card) and left the plan as
   it was. Since 4.2 a small reduction happens by itself – once per plan week and
   only downwards:

     · load ratio (acute:chronic) above 1.3 → −10 %, above 1.5 → −15 %   ┐ only when the last 7 days
     · form "tired" (fatigue clearly above fitness) → −10 %                ┘ were > 115 % of the plan
     · effort of the last three weeks consistently very high (RPE trend 'ease') → −10 %
     · last plan week: more than 30 % of the planned running km missed → −10 %, more than half → −15 %
       (counted once every run of that week is settled – done or missed)

   Several signals multiply, the floor is −15 %. Only the easy volume shrinks
   (easy, long, recovery runs): quality sessions keep their stimulus, fixed
   commitments, races and the person's own sessions stay untouched. Weeks that
   are already lighter by plan (deload, taper, race week) are left alone, and so
   is the first plan week. Increases stay a suggestion (coach card "boost") –
   more volume needs the person's yes.
   ========================================================================= */

import { addDays, diffDays, typeMeta } from './ui.js';
import { fmtNum } from './format.js';
import { acwr, formToday, formState, loadMinutes, sessionRpe } from './load.js';
import { isOpen, rpeProgression, weekOfDate, isAddedSession } from './planflow.js';

/** Never more than this: −15 % of a session's volume. */
export const AUTO_VOLUME_FLOOR = 0.85;
/** Session types whose volume the automation may shorten (the easy running volume). */
export const AUTO_VOLUME_TYPES = ['easy', 'long', 'recovery', 'run'];
/** Shortest run after an adjustment. */
const MIN_KM = 3;
const MIN_MIN = 20;

const r05 = (x) => Math.round(x * 2) / 2;
const kmText = (km) => `${fmtNum(km, km % 1 ? 1 : 0)} km`;

/** Planned runs of a date range with a distance (without races and fixed commitments). */
function plannedRuns(units, from, to) {
  return (units || []).filter((u) => u && u.date >= from && u.date <= to && !u.fixed && u.type !== 'race'
    && typeMeta(u.type).cat === 'run' && Number(u.targetDistanceKm) > 0);
}
const kmOf = (units) => units.reduce((n, u) => n + Number(u.targetDistanceKm), 0);
function plannedRunKm(units, from, to) { return kmOf(plannedRuns(units, from, to)); }

/** Minutes per km the person actually runs: runs of the last 28 days with distance and duration
    (6 min/km without them) – so a planned 10 km costs a slow runner more than a fast one. */
export function ownMinPerKm(sessions = [], today) {
  let km = 0, sec = 0;
  for (const s of sessions || []) {
    if (!s || s.deleted || s.date > today || diffDays(s.date, today) >= 28 || typeMeta(s.type).cat !== 'run') continue;
    const d = Number(s.distanceKm) || 0, t = Number(s.durationSec) || 0;
    if (d > 0 && t > 0) { km += d; sec += t; }
  }
  const v = km >= 5 ? sec / 60 / km : 6;
  return Math.min(12, Math.max(3, v));
}

/** Load the plan intended for the last 7 days (today included), in the same points as the actual
    load: duration × the type's effort; runs given as a distance at the person's own pace. */
export function plannedAcuteLoad(units = [], today, minPerKm = 6) {
  return (units || []).reduce((sum, u) => {
    if (!u || u.type === 'rest' || u.date > today || diffDays(u.date, today) >= 7) return sum;
    const km = Number(u.targetDistanceKm) || 0;
    const min = Number(u.targetDurationMin)
      || (km ? (typeMeta(u.type).cat === 'run' ? km * minPerKm : loadMinutes({ type: u.type, distanceKm: km }).min) : 40);
    return sum + min * sessionRpe({ type: u.type, intensity: u.intensity }, null);
  }, 0);
}

/**
 * The signals that speak for less volume this week, each with its factor. Load ratio and form
 * count only when the last 7 days were clearly MORE than planned (as for the coach's recovery
 * day): following a plan that builds up is not a warning sign, even though the ratio rises
 * and the form turns "tired" by the plan's own design.
 * `allUnits` = the sessions of all plans (two goals) for the planned load; default: this plan's.
 * @returns {Array<{key:'load'|'effort'|'fatigue'|'completion', factor:number, value?:number}>}
 */
export function autoVolumeSignals({ plan, sessions = [], today, weekStart, allUnits = null }) {
  const out = [];
  const ac = acwr(sessions, today);
  const planned = plannedAcuteLoad(allUnits || (plan && plan.units) || [], today, ownMinPerKm(sessions, today));
  const overPlan = planned <= 0 || ac.acuteWeek > planned * 1.15;
  if (overPlan && ac.ratio != null && !ac.sparse && ac.ratio > 1.3) {
    out.push({ key: 'load', factor: ac.ratio > 1.5 ? 0.85 : 0.9, value: Math.round(ac.ratio * 100) / 100 });
  }
  const prog = rpeProgression(sessions, today);
  if (prog && prog.trend === 'ease') out.push({ key: 'effort', factor: 0.9, value: prog.avgRpe });
  const fs = formState(formToday(sessions, today), ac.historyDays);
  if (overPlan && fs.key === 'ermuedet') out.push({ key: 'fatigue', factor: 0.9 });
  const done = lastWeekShare(plan, weekStart);
  if (done != null && done < 0.7) out.push({ key: 'completion', factor: done < 0.5 ? 0.85 : 0.9, value: Math.round(done * 100) });
  return out;
}

/** Share of last plan week's planned running km that was not missed (0–1) – null while a run
    of that week is still open: a Sunday run that arrives with Monday's import must not look
    like a missed one. Below 10 planned km the share says little. */
export function lastWeekShare(plan, weekStart) {
  const prevFrom = addDays(weekStart, -7), prevTo = addDays(weekStart, -1);
  if (!plan || !plan.startDate || prevFrom < plan.startDate) return null;
  const runs = plannedRuns(plan.units, prevFrom, prevTo);
  const planned = kmOf(runs);
  if (planned < 10 || runs.some(isOpen)) return null;
  return 1 - kmOf(runs.filter((u) => u.status === 'verpasst')) / planned;
}

/** Combined factor of the signals: they multiply, never below the floor, in 5 % steps. */
export function combineFactors(signals = []) {
  const f = signals.reduce((a, s) => a * s.factor, 1);
  return Math.round(Math.max(AUTO_VOLUME_FLOOR, f) * 20) / 20;
}

/** The shortened session (patch fields). Distance in half kilometres, never below 3 km
    (or 20 min); a distance in the title follows the new value. */
export function autoVolumeVariant(unit, factor) {
  const patch = { autoVolume: factor };
  const km = Number(unit.targetDistanceKm) || 0;
  if (km) {
    const next = Math.min(km, Math.max(MIN_KM, r05(km * factor)));
    patch.targetDistanceKm = next;
    if (next !== km && typeof unit.title === 'string' && unit.title.includes(kmText(km))) {
      patch.title = unit.title.replace(kmText(km), kmText(next));
    }
    return patch;
  }
  const min = Number(unit.targetDurationMin) || 0;
  if (min) patch.targetDurationMin = Math.min(min, Math.max(MIN_MIN, Math.round(min * factor / 5) * 5));
  return patch;
}

/** Would the variant change anything at all? */
function shortens(unit, factor) {
  const p = autoVolumeVariant(unit, factor);
  return ('targetDistanceKm' in p && p.targetDistanceKm < unit.targetDistanceKm)
    || ('targetDurationMin' in p && p.targetDurationMin < unit.targetDurationMin);
}

/**
 * Decision for ONE plan on `today`: shorten the remaining easy runs of the current
 * plan week – or not (null). Programmes, the first plan week, weeks that are lighter
 * by plan and weeks that were already adjusted stay as they are.
 * @returns {{week:number, weekStart:string, factor:number, signals:Array, unitIds:string[],
 *   beforeKm:number, afterKm:number}|null}
 */
export function autoVolumeDecision({ plan, sessions = [], today, allUnits = null }) {
  if (!plan || plan.deleted || plan.kind === 'program' || !plan.startDate || !plan.endDate) return null;
  if (today < plan.startDate || today > plan.endDate) return null;
  const week = weekOfDate(plan, today);
  if (!week || week < 2) return null;
  if (plan.autoVolume && plan.autoVolume.week === week) return null;   // once per plan week
  const weekStart = addDays(plan.startDate, (week - 1) * 7);
  const weekEnd = addDays(weekStart, 6);
  const units = plan.units || [];
  const inWeek = units.filter((u) => u && u.date >= weekStart && u.date <= weekEnd);
  // Race week and taper: the plan already holds back, freshness comes first.
  if (inWeek.some((u) => u.type === 'race' || u.phase === 'taper')) return null;
  // Already lighter by plan (deload week): no second reduction on top.
  const thisKm = plannedRunKm(units, weekStart, weekEnd);
  const prevKm = plannedRunKm(units, addDays(weekStart, -7), addDays(weekStart, -1));
  if (prevKm > 0 && thisKm < prevKm * 0.9) return null;

  const signals = autoVolumeSignals({ plan, sessions, today, weekStart, allUnits });
  if (!signals.length) return null;
  const factor = combineFactors(signals);
  if (factor >= 1) return null;

  const tagged = units.some((u) => u && u.phase);
  const targets = inWeek.filter((u) => u.date >= today && isOpen(u) && !u.fixed
    && AUTO_VOLUME_TYPES.includes(u.type) && !isAddedSession(u, tagged)
    && !u.deloaded && !u.autoVolume && shortens(u, factor));
  if (!targets.length) return null;
  const beforeKm = targets.reduce((n, u) => n + (Number(u.targetDistanceKm) || 0), 0);
  const afterKm = targets.reduce((n, u) => n + (Number(autoVolumeVariant(u, factor).targetDistanceKm) || 0), 0);
  return { week, weekStart, factor, signals, unitIds: targets.map((u) => u.id), beforeKm: r05(beforeKm), afterKm: r05(afterKm) };
}
