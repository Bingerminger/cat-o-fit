/* =========================================================================
   rolling.js — rolling planning: recognises from the actual load when a
   recovery day is advisable, and keeps a transparency log of the automatic
   adjustments (with undo). Pure, DOM-free logic → covered by node:test.

   Basic idea: after too many hard days in a row, with a sharply increased load
   or clear fatigue, a quiet day does good. The signals react only to
   DEVIATIONS from the plan (more load than planned, additional or harder-run
   sessions) – not to the planned structure itself: anyone who follows the plan should
   not hear every week that they ought to drop the key session. Fixed appointments
   (football/games) are left untouched; only the next open, demanding
   RUN/strength session is adjusted.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { isHard, isOpen } from './planflow.js';
import { acwr, formToday, formState, fmtRatio } from './load.js';
import { unitLoad } from './whatif.js';

import { t, tp } from './i18n.js';

/** Was this day "hard" (a completed demanding session or a demanding logged training)? */
export function dayIsHard(units = [], sessions = [], date) {
  if ((units || []).some((u) => u.date === date && u.status === 'erledigt' && isHard(u))) return true;
  return (sessions || []).some((s) => s && !s.deleted && s.date === date
    && (Number(s.rpe) >= 7 || ['tempo', 'interval', 'long', 'race', 'match'].includes(s.type)
      || (s.type === 'cross_football' && s.intensity !== 'leicht')));  // Football is demanding (#5)
}

/** Was the day demanding according to the plan (a planned, not cancelled hard session)? */
function plannedHard(units = [], date) {
  return (units || []).some((u) => u && u.date === date && u.status !== 'verpasst' && isHard(u));
}

/**
 * Hard days in a row ending today OR yesterday (a still untrained
 * "today" does not break the streak), counted from the ACTUAL (completed sessions,
 * logged trainings). `unplanned` = days among them that the plan did not
 * foresee as hard (additional hard session, easy-planned session run hard).
 * @returns {{days:number, unplanned:number}}
 */
export function hardStreakInfo(units = [], sessions = [], today, max = 14) {
  const start = dayIsHard(units, sessions, today) ? 0
    : (dayIsHard(units, sessions, addDays(today, -1)) ? 1 : null);
  if (start === null) return { days: 0, unplanned: 0 };
  let days = 0, unplanned = 0;
  for (let i = start; i < max; i++) {
    const d = addDays(today, -i);
    if (!dayIsHard(units, sessions, d)) break;
    days++;
    if (!plannedHard(units, d)) unplanned++;
  }
  return { days, unplanned };
}

/** Number of hard days in a row (see `hardStreakInfo`). */
export function consecutiveHardDays(units = [], sessions = [], today, max = 14) {
  return hardStreakInfo(units, sessions, today, max).days;
}

/** Turns a demanding session into an active recovery day (patch fields). */
export function recoveryVariant(unit) {
  const km = unit.targetDistanceKm ? Math.min(5, Math.max(3, Math.round(unit.targetDistanceKm * 0.4))) : null;
  return {
    type: 'recovery',
    title: t('rolling.recoveryTitle'),
    targetDistanceKm: km,
    targetDurationMin: km ? null : 30,
    targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null, targetHrZone: 1,
    intervals: null,
    description: t('rolling.recoveryDesc'),
    autoRest: true, originalType: unit.originalType || unit.type,
  };
}

/**
 * Type-aware gentle variant (patch fields), reusable for cycle-aware
 * easing (#3) and full-day recovery (#4): runs/endurance → easy
 * recovery run, strength/functional → quiet mobility. `copy` supplies title/
 * description. Keeps originalType, so that "Undo" restores the original.
 */
export function gentleVariant(unit, copy = {}) {
  const common = {
    intervals: null, targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null,
    deloaded: true, originalType: unit.originalType || unit.type,
    title: copy.title || t('rolling.gentleTitle'), description: copy.description || t('rolling.gentleDesc'),
  };
  if (['strength', 'gym', 'functional'].includes(unit.type)) {
    return { ...common, type: 'mobility', targetDistanceKm: null, targetDurationMin: 15, targetHrZone: null };
  }
  const km = unit.targetDistanceKm ? Math.min(5, Math.max(3, Math.round(unit.targetDistanceKm * 0.5))) : null;
  return { ...common, type: 'recovery', targetDistanceKm: km, targetDurationMin: km ? null : 25, targetHrZone: 1 };
}

/** Planned load (load points) of all sessions of the last 7 days – the target. */
export function plannedWeekLoad(units = [], today) {
  return (units || []).filter((u) => u && u.date <= today && diffDays(u.date, today) < 7)
    .reduce((s, u) => s + unitLoad(u), 0);
}

/**
 * Suggests a recovery day when the ACTUAL load suggests it. Targets
 * the next OPEN, demanding, movable session in [today, today+horizon]
 * (fixed appointments are left out). Default 2 days: if there are easy days anyway before the
 * next hard session, the body recovers there – then no long run is cancelled
 * four days in advance. `units` = all plan sessions (across plans)
 * for target load and planned hard days; default: those of the plan.
 * @returns {{unit, date, reason, acwr, hardStreak}|null}
 */
export function restDaySuggestion({ plan = {}, sessions = [], today, horizon = 2, units: allUnits = null } = {}) {
  const units = plan.units || [];
  const all = allUnits || units;
  const ac = acwr(sessions, today);
  const fs = formState(formToday(sessions, today), ac.historyDays);
  const streak = hardStreakInfo(all, sessions, today);

  // Only deviations from the plan: the actual load of the last 7 days is well above
  // the target (or there is no plan to measure against). Anyone who follows the
  // plan is not confronted with the planned increase as a warning sign.
  const planned = plannedWeekLoad(all, today);
  const overPlan = planned <= 0 || ac.acuteWeek > planned * 1.15;
  // `sparse` = fewer than 28 days of history so far: the ratio is then arithmetically high
  // without anyone having increased too fast. The form only once the fitness curve
  // has settled (`formState.reliable`) – otherwise it would be artificially negative for months.
  const acwrHigh = ac.ratio != null && !ac.sparse && ac.ratio > 1.5 && overPlan;
  const elevatedAndTired = ac.ratio != null && !ac.sparse && ac.ratio > 1.3 && fs.reliable && fs.rel < -0.3 && overPlan;
  const streakHigh = streak.days >= 3 && streak.unplanned >= 1;
  if (!(acwrHigh || elevatedAndTired || streakHigh)) return null;

  const cand = units
    .filter((u) => !u.fixed && isOpen(u) && isHard(u)
      && u.date >= today && diffDays(today, u.date) <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!cand) return null;

  let reason;
  if (acwrHigh) reason = t('rolling.reasonAcwr', { ratio: fmtRatio(ac.ratio) });
  else if (streakHigh) reason = tp('rolling.reasonStreak', streak.days);
  else reason = t('rolling.reasonFatigue', { ratio: fmtRatio(ac.ratio) });
  return { unit: cand, date: cand.date, reason, acwr: ac, hardStreak: streak.days };
}

/**
 * After an ACTUALLY demanding football day (played/trained today or yesterday,
 * not "light") the next open, demanding RUN/strength session in [today, today+2]
 * as a relief candidate (#5). Planned appointments not yet completed do not count –
 * the plan generator already takes the weekly structure into account. Pure function.
 * @returns {{date, unit, when:'heute'|'gestern'}|null}  (when: today | yesterday)
 */
export function footballFollowupEase({ units = [], sessions = [], today } = {}) {
  const hardFb = (x) => x.type === 'match' || (x.type === 'cross_football' && x.intensity !== 'leicht');
  const hardFootballOn = (d) =>
    (units || []).some((u) => u && u.date === d && u.status === 'erledigt' && hardFb(u))
    || (sessions || []).some((s) => s && !s.deleted && s.date === d && hardFb(s));
  const when = hardFootballOn(today) ? 'heute' : (hardFootballOn(addDays(today, -1)) ? 'gestern' : null);
  if (!when) return null;
  const cand = (units || [])
    .filter((u) => !u.fixed && isOpen(u) && isHard(u)
      && u.date >= today && diffDays(today, u.date) <= 2)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return cand ? { date: cand.date, unit: cand, when } : null;
}

/**
 * Prepends a log entry and caps the length. Pure value
 * (no store). `entry` gets id + ts if not set.
 */
export function pushAdaptLog(log = [], entry = {}, max = 25) {
  const e = {
    id: entry.id || `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: entry.ts || new Date().toISOString(),
    ...entry,
  };
  return [e, ...(log || [])].slice(0, max);
}
