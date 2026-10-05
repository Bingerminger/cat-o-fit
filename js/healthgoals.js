/* =========================================================================
   healthgoals.js — weekly health goals with progress.

   Independent of race plans: measures the actual activity of the
   current week (from all sessions, including strength/programmes) against
   configurable weekly goals – plus optionally the weight progress.

   Pure, DOM-free logic -> covered by node:test.
   ========================================================================= */

import { weekStartMonday, addDays } from './ui.js';
import { sessionMinutes } from './fitness.js';
import { weightNow, weightGoalStatus } from './energy.js';

// Based on the WHO physical-activity recommendations (≥150 min/week, several days active).
export const DEFAULT_GOALS = { activeMinutes: 150, trainingDays: 3 };

/** Configured weekly goals (with defaults). */
export function weeklyGoals(profile = {}) {
  const g = (profile.settings && profile.settings.weeklyGoals) || {};
  const num = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
  return {
    activeMinutes: num(g.activeMinutes, DEFAULT_GOALS.activeMinutes),
    trainingDays: num(g.trainingDays, DEFAULT_GOALS.trainingDays),
  };
}

/** Active minutes and training days of the current week (Mon–Sun around `today`). */
export function weekActivity(sessions = [], today) {
  const ws = weekStartMonday(today);
  const we = addDays(ws, 6);
  let minutes = 0;
  const days = new Set();
  for (const s of sessions) {
    if (!s || s.deleted || !s.date) continue;
    if (s.date < ws || s.date > we) continue;
    minutes += sessionMinutes(s);
    days.add(s.date);
  }
  return { activeMinutes: Math.round(minutes), trainingDays: days.size };
}

function pct(value, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
}

/** Latest weight value from the body values (or null). Only real numbers count –
    an entry from a foreign source (API, backup file) could otherwise contain text. */
export function latestWeight(health = []) {
  let best = null;
  for (const h of health) {
    if (!h || h.deleted || h.weight == null || h.weight === '' || !h.date || !Number.isFinite(Number(h.weight))) continue;
    if (!best || h.date > best.date) best = h;
  }
  return best ? Number(best.weight) : null;
}

/**
 * Weekly progress against the goals. Returns rings for minutes and days and
 * – if a target weight and a weight value exist – the weight difference.
 */
export function goalProgress({ profile = {}, sessions = [], health = [], today } = {}) {
  const goals = weeklyGoals(profile);
  const act = weekActivity(sessions, today);
  const minutes = { value: act.activeMinutes, goal: goals.activeMinutes, pct: pct(act.activeMinutes, goals.activeMinutes) };
  const days = { value: act.trainingDays, goal: goals.trainingDays, pct: pct(act.trainingDays, goals.trainingDays) };

  // Weight: smoothed value (7-day median) and the same goal definition as nutrition
  // and cockpit (energy.js weightGoalStatus) – formerly "reached" only applied here within ±0.05 kg.
  let weight = null;
  const target = profile.targetWeightKg;
  const current = latestWeight(health) != null ? weightNow(health, {}, today) : null;
  if (Number.isFinite(target) && current != null) {
    const gs = weightGoalStatus({ current, target, start: profile.targetWeightStartKg != null ? profile.targetWeightStartKg : profile.weightKg });
    weight = {
      current, target, deltaKg: gs.gap, reached: gs.reached, status: gs.status,
      remaining: gs.remaining, beyond: gs.beyond,
      direction: gs.direction, // goal direction (down = lose, up = gain)
    };
  }

  const bothMet = minutes.pct >= 100 && days.pct >= 100;
  return { goals, minutes, days, weight, allMet: bothMet };
}
