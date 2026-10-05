/* =========================================================================
   suggestions.js — derived values: target pace, race forecast,
   simple training tips. All as guidance, no promises.

   Since v3.16.0 the forecast uses the same SMOOTHED form basis as the
   training ranges (`vdot.js estimateVdot`): weekly bests, outlier
   capping, recency-weighted mean. Before, simply the fastest
   Riegel extrapolation from all runs was taken – systematically too optimistic
   (a single brisk 5k made the marathon forecast tumble) and in
   contradiction to the form card on the dashboard.
   ========================================================================= */

import { parseHms, fmtDuration, todayStr, diffDays, fmtNum, fmtDec } from './ui.js';
import { estimateVdot, raceTimeFromVdot } from './vdot.js';

import { t } from './i18n.js';

/** Target pace (s/km) from target time "HH:MM:SS" and distance (km). */
export function targetPaceSecPerKm(targetTime, distanceKm) {
  const sec = parseHms(targetTime);
  if (!sec || !distanceKm) return null;
  return Math.round(sec / distanceKm);
}

/** Riegel-Prognose: t2 = t1 * (d2/d1)^exp. */
export function riegel(knownSec, knownKm, targetKm, exp = 1.06) {
  if (!knownSec || !knownKm || !targetKm) return null;
  return knownSec * (targetKm / knownKm) ** exp;
}

/** Highest tolerable extrapolation factor for Riegel (fallback path).
    An extrapolation from 4 km to 42.2 km (factor 10) is highly unreliable. */
const MAX_EXTRAPOLATION = 4;

const RUN_TYPES = ['easy', 'long', 'tempo', 'interval', 'race', 'run', 'recovery'];

/** Running volume: average weekly km of the last 4 weeks and longest run of the last 6 weeks. */
export function runVolume(sessions = [], today = todayStr()) {
  let km28 = 0, longestKm = 0;
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !RUN_TYPES.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0) return;
    if (d < 28) km28 += s.distanceKm;
    if (d <= 42 && s.distanceKm > longestKm) longestKm = s.distanceKm;
  });
  return { weekKm: Math.round((km28 / 4) * 10) / 10, longestKm };
}

/** Is the preparation sufficient for the equivalent time? For the marathon (and, to a lesser
    degree, the half marathon) form equivalence predicts too much without volume – for
    recreational runners the weekly volume is a predictor in its own right
    (Vickers & Vertosick 2016). */
export function volumeCaveat(distanceKm, vol) {
  if (!vol) return false;
  if (distanceKm >= 40) return vol.weekKm < 50 || vol.longestKm < 25;
  if (distanceKm >= 20) return vol.weekKm < 30 || vol.longestKm < 15;
  return false;
}

/**
 * Estimates a race time for `distanceKm`.
 * Primarily via the smoothed form (VDOT → Daniels equivalence time), alternatively
 * via Riegel from the best-matching run (limited extrapolation).
 * `onlyEasy`: estimated only from easy runs (rather too cautious); `caveat`
 * 'volume': for marathon/half marathon the matching volume is still missing – the time is
 * then only achievable with sufficient preparation (no "sharpen the goal" advice).
 * @returns {{seconds:number, basis:string, method:'form'|'riegel', onlyEasy:boolean, caveat:string|null, note:string|null}|null}
 */
export function predictRace(sessions, distanceKm, { hrZones = null, today = todayStr() } = {}) {
  if (!distanceKm) return null;
  const caveat = volumeCaveat(distanceKm, runVolume(sessions, today)) ? 'volume' : null;
  const note = caveat ? t('suggestions.volumeNote') : null;

  // 1) Form-based (preferred): identical basis as training ranges & form card.
  const form = estimateVdot(sessions || [], today, 42, { hrZones });
  if (form && form.vdot) {
    const seconds = raceTimeFromVdot(form.vdot, distanceKm * 1000);
    if (seconds) {
      const v = fmtDec(form.vdot);
      const basis = form.onlyEasy
        ? t('suggestions.basisEasy', { v })
        : form.weeks >= 3
          ? t('suggestions.basisFormSmoothed', { v, weeks: form.weeks })
          : t('suggestions.basisForm', { v });
      return { seconds: Math.round(seconds), basis, method: 'form', onlyEasy: !!form.onlyEasy, caveat, note };
    }
  }

  // 2) Fallback Riegel – only from runs with a tolerable extrapolation distance.
  const cand = (sessions || []).filter((s) =>
    s && !s.deleted && s.distanceKm >= 4 && s.durationSec > 0 &&
    ['easy', 'tempo', 'long', 'interval', 'race', 'run'].includes(s.type) &&
    diffDays(s.date, today) <= 50 && diffDays(s.date, today) >= 0 &&
    Math.max(distanceKm / s.distanceKm, s.distanceKm / distanceKm) <= MAX_EXTRAPOLATION);
  if (!cand.length) return null;

  // The run whose distance is closest to the target distance carries the
  // least extrapolation error – hence this one instead of the "fastest forecast".
  const best = cand.slice().sort((a, b) =>
    Math.abs(Math.log(a.distanceKm / distanceKm)) - Math.abs(Math.log(b.distanceKm / distanceKm)))[0];
  const pred = riegel(best.durationSec, best.distanceKm, distanceKm);
  if (!pred) return null;
  return {
    seconds: Math.round(pred),
    basis: t('suggestions.basisRiegel', { km: fmtNum(best.distanceKm, 1), time: fmtDuration(best.durationSec) }),
    method: 'riegel', onlyEasy: false, caveat, note,
  };
}

/** Returns a short, friendly training tip (without pressure). */
export function trainingTip(ctx) {
  const { todaysUnits = [], streak = 0, weekKm = 0, hasPlan = true } = ctx;
  if (todaysUnits.some((u) => u.type === 'race')) return t('suggestions.tipRace');
  if (todaysUnits.some((u) => u.type === 'long')) return t('suggestions.tipLong');
  if (todaysUnits.some((u) => ['tempo', 'interval'].includes(u.type))) return t('suggestions.tipHard');
  // Without a plan nothing is "scheduled" – no rest-day line in an empty app (UI-13).
  if (todaysUnits.length === 0 && !hasPlan) return t('suggestions.tipNoPlan');
  if (todaysUnits.length === 0) return t('suggestions.tipRest');
  // `streak` = weekly streak (weeks with ≥ 3 training days) – rest days count towards it.
  if (streak >= 3) return t('suggestions.tipStreak', { weeks: streak });
  return t('suggestions.tipDefault');
}
