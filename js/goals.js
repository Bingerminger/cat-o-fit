/* =========================================================================
   goals.js — dedicated health/weight goals with progress.

   A goal is a target value of a body/health metric
   (e.g. "65 kg", "resting HR 50", "VO₂max 45"). Progress is calculated against the
   start value (recorded at creation) and the most recent measured value.
   DOM-free and thus testable; stored in `profile.settings.healthGoals`.
   Complements the weekly activity goals (healthgoals.js), which refer to
   minutes/training days per week.
   ========================================================================= */

import { weightNow, weightGoalStatus } from './energy.js';
import { withHrvMethod } from './healthdata.js';

import { t } from './i18n.js';

/** Supported metrics (from the body values). */
export const GOAL_METRICS = [
  { key: 'weight', get label() { return t('goals.weight'); }, unit: 'kg', field: 'weight', digits: 1, get hint() { return t('goals.hintDownOrUp'); } },
  { key: 'bodyFat', get label() { return t('goals.bodyFat'); }, unit: '%', field: 'bodyFat', digits: 1, get hint() { return t('goals.hintUsuallyDown'); } },
  { key: 'restingHr', get label() { return t('goals.restingHr'); }, unit: 'bpm', field: 'restingHr', digits: 0, get hint() { return t('goals.hintUsuallyDown'); } },
  { key: 'hrv', label: 'HRV', unit: 'ms', field: 'hrv', digits: 0, get hint() { return t('goals.hintUsuallyUp'); } },
  { key: 'vo2max', label: 'VO₂max', unit: '', field: 'vo2max', digits: 0, get hint() { return t('goals.hintUp'); } },
];
export function metricMeta(key) { return GOAL_METRICS.find((m) => m.key === key) || null; }

/** Most recent recorded value of a metric (from health; weight alternatively from the profile).
    HRV: only values of the measurement method `hrvMethod` (SDNN and RMSSD are not comparable). */
export function latestMetric(key, { profile = {}, health = [], hrvMethod = null } = {}) {
  const m = metricMeta(key);
  if (!m) return null;
  const vals = (key === 'hrv' && hrvMethod ? withHrvMethod(health, hrvMethod) : (health || []))
    .filter((h) => h && !h.deleted && h[m.field] != null && h[m.field] !== '')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (vals.length) return Number(vals[0][m.field]);
  if (key === 'weight' && profile.weightKg != null) return Number(profile.weightKg);
  return null;
}

/** Days until the deadline (or null). */
function daysUntil(deadline, today) {
  if (!deadline || !today) return null;
  const d = (Date.parse(deadline) - Date.parse(today)) / 86400000;
  return Number.isNaN(d) ? null : Math.round(d);
}

/** Progress of a single goal. Weight uses the smoothed value (7-day median)
    and the same goal definition as nutrition, cockpit and weekly goals (energy.js). */
export function goalProgress(goal, ctx = {}) {
  const m = metricMeta(goal.metric);
  const isWeight = goal.metric === 'weight';
  const measured = latestMetric(goal.metric, { ...ctx, hrvMethod: goal.hrvMethod || null });
  const current = isWeight && measured != null ? (weightNow(ctx.health || [], ctx.profile || {}, ctx.today) ?? measured) : measured;
  const start = goal.start != null ? Number(goal.start) : current;
  const target = Number(goal.target);
  const down = (start != null ? start : target) > target;   // target value smaller than start => "down"
  let pct = 0;
  let reached = false;
  if (current != null && start != null) {
    if (start === target) { pct = 1; reached = true; }
    else {
      pct = down ? (start - current) / (start - target) : (current - start) / (target - start);
      pct = Math.max(0, Math.min(1, pct));
      reached = down ? current <= target : current >= target;
    }
  }
  if (isWeight && current != null) {
    const gs = weightGoalStatus({ current, target, start });
    if (gs) reached = gs.reached;
  }
  const remaining = current != null ? (reached ? 0 : Math.round(Math.abs(current - target) * 10) / 10) : null;
  return {
    metric: m, current, start, target, down, reached,
    pct: reached ? 1 : pct,
    remaining,
    daysLeft: daysUntil(goal.deadline, ctx.today),
  };
}

/** Progress of all goals stored in the profile. `noWeightGoals` (children, pregnancy,
    eating disorder – eligibility.js) hides weight and body-fat goals; they remain stored. */
export function goalsProgress({ profile = {}, health = [], today, noWeightGoals = false } = {}) {
  const goals = ((profile.settings && profile.settings.healthGoals) || [])
    .filter((g) => !(noWeightGoals && (g.metric === 'weight' || g.metric === 'bodyFat')));
  return goals.map((g) => ({ goal: g, ...goalProgress(g, { profile, health, today }) }));
}
