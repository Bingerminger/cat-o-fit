/* =========================================================================
   dualgoal.js — two goals in one plan: half-marathon performance AND weight loss.
   Pure, DOM-free logic → covered by node:test.

   If both goals are to be pursued "equally", this is only honest with a
   PHASE-DEPENDENT focus (decision: balanced, phase-dependent):
     - Base   → lots of easy volume, moderate deficit (ideal weight-loss block)
     - Build  → hard stimuli need energy, smaller deficit
     - Peak   → performance comes first, small deficit
     - Taper  → fill up instead of losing weight
   Plus the honest stimulus check: rest days alone do not advance any goal
   (supercompensation needs stimulus + recovery).
   ========================================================================= */

import { diffDays, addDays } from './ui.js';

import { t } from './i18n.js';

/** Phase focus: perf/loss ∈ [0,1], recommended daily deficit (kcal, capped). */
export const PHASE_EMPHASIS = {
  base:  { perf: 0.5, loss: 0.9, deficit: 'moderat', kcal: -450, get note() { return t('dualgoal.noteBase'); } },
  build: { perf: 0.7, loss: 0.6, deficit: 'leicht',  kcal: -300, get note() { return t('dualgoal.noteBuild'); } },
  peak:  { perf: 0.9, loss: 0.3, deficit: 'gering',  kcal: -150, get note() { return t('dualgoal.notePeak'); } },
  taper: { perf: 1.0, loss: 0.0, deficit: 'aus',     kcal: 0,    get note() { return t('dualgoal.noteTaper'); } },
};

/** Current plan week (1..weeks) from the date – deliberately local, without a dependency on plans.js. */
function currentWeek(plan, today) {
  if (!plan || !plan.startDate || !plan.weeks) return 1;
  if (today < plan.startDate) return 1;
  if (plan.endDate && today > plan.endDate) return plan.weeks;
  return Math.min(plan.weeks, Math.floor(diffDays(plan.startDate, today) / 7) + 1);
}

/** Current phase key (base|build|peak|taper) or 'build' as a fallback. */
export function currentPhaseKey(plan, today) {
  const w = currentWeek(plan, today);
  const p = (plan && plan.phases || []).find((x) => w >= x.startWeek && w <= x.endWeek) || (plan && plan.phases || []).at(-1);
  return p && PHASE_EMPHASIS[p.key] ? p.key : 'build';
}

/** Phase weighting together with the display name of the phase. */
export function phaseEmphasis(plan, today) {
  const key = currentPhaseKey(plan, today);
  const p = (plan && plan.phases || []).find((x) => x.key === key);
  return { phase: key, phaseName: p ? p.name : '', ...PHASE_EMPHASIS[key] };
}

/** Recommended daily deficit (kcal), phase-dependent & safe. 0 when the target weight is reached. */
export function recommendedDeficit(plan, today, { currentKg, targetKg } = {}) {
  const e = phaseEmphasis(plan, today);
  if (targetKg != null && currentKg != null && currentKg <= targetKg + 0.1) {
    return { ...e, kcal: 0, deficit: 'Ziel erreicht', reached: true };
  }
  return { ...e, reached: false };
}

/**
 * Honest training-stimulus check: is the stimulus enough for progress, or is the
 * goal being "flattered with rest days"? Counts demanding stimuli and active days
 * of the last `days` and compares them with a minimum (≈1 hard/week, ≥3
 * active days/week).
 */
export function stimulusCheck(sessions = [], today, days = 14) {
  const since = addDays(today, -days);
  const recent = (sessions || []).filter((s) => s && !s.deleted && s.date >= since && s.date <= today);
  const hard = recent.filter((s) => Number(s.rpe) >= 7 || ['tempo', 'interval', 'long', 'race', 'match'].includes(s.type)).length;
  const activeDays = new Set(recent.map((s) => s.date)).size;
  const weeks = Math.max(1, Math.round(days / 7));
  const enough = hard >= weeks && activeDays >= weeks * 3;
  return {
    hard, activeDays, enough,
    message: enough
      ? t('dualgoal.stimulusEnough')
      : t('dualgoal.stimulusLow'),
  };
}
