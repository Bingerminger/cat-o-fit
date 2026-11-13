/* =========================================================================
   vdot.js — form/performance estimate based on the VDOT idea (Jack Daniels) and
   training paces derived from it. Pure functions without store/DOM → testable.

   From a running performance (distance + time) a VDOT (≈ effective VO₂max)
   is estimated; from it the training ranges (Recovery … VO₂max) can be derived as
   seconds/km – in the same format as `profile.paceZones`.
   Deliberately meant as guidance – not laboratory diagnostics.
   ========================================================================= */

import { diffDays, weekStart } from './ui.js';

import { t } from './i18n.js';

/** VO₂ (ml/kg/min) at running speed v (m/min) – Daniels/Gilbert. */
function vo2AtSpeed(v) { return -4.60 + 0.182258 * v + 0.000104 * v * v; }
/** Fraction of VO₂max that can be sustained for t minutes (drop-off). */
function pctMaxForTime(min) { return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min); }

/** VDOT from a performance (distance in metres, time in seconds). null for nonsense. */
export function vdotFromPerf(distanceM, timeSec) {
  if (!distanceM || !timeSec || distanceM < 400 || timeSec < 60) return null;
  const tMin = timeSec / 60;
  const v = distanceM / tMin;            // m/min
  const vo2 = vo2AtSpeed(v);
  const pct = pctMaxForTime(tMin);
  const vdot = vo2 / pct;
  return (vdot > 20 && vdot < 90) ? Math.round(vdot * 10) / 10 : null;
}

/** Pace (s/km) for a target intensity `pct` (fraction of VDOT). */
export function paceForPct(vdot, pct) {
  const target = vdot * pct;             // desired VO₂
  // 0.000104 v² + 0.182258 v - 4.60 = target  ->  quadratic solution (v>0)
  const a = 0.000104, b = 0.182258, c = -4.60 - target;
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); // m/min
  return Math.round(60000 / v);          // 1000 m at v m/min -> seconds/km
}

/**
 * Equivalent race time (seconds) for a distance at a given VDOT –
 * the inverse of `vdotFromPerf` (Daniels' equivalence times). Solves
 * `vo2AtSpeed(v)/pctMaxForTime(t) = vdot` by bisection; the function is strictly
 * monotonically decreasing in t, hence robust without a starting value.
 */
export function raceTimeFromVdot(vdot, distanceM) {
  if (!vdot || !distanceM || distanceM < 400) return null;
  const f = (tSec) => {
    const tMin = tSec / 60;
    return vo2AtSpeed(distanceM / tMin) / pctMaxForTime(tMin) - vdot;
  };
  let lo = 60, hi = 8 * 3600;              // 1 min … 8 h
  if (f(lo) < 0 || f(hi) > 0) return null; // outside the sensible range
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Intensity ranges per training zone as a fraction of VDOT [fast, slow].
    As in Daniels ("E/L pace"), Easy and Long share one range; the Long
    Run is only slightly calmer at the fast end. Previously the Long zone was above
    the Easy zone – the longest session got the fastest base-training target. */
const ZONE_PCT = {
  recovery:  [0.63, 0.56],
  easy:      [0.74, 0.62],
  long:      [0.72, 0.62],
  threshold: [0.90, 0.86],
  vo2:       [1.00, 0.95],
};
const ZONE_META = {
  recovery:  { get label() { return t('vdot.zoneRecovery'); }, hrZone: 1 },
  easy:      { get label() { return t('vdot.zoneEasy'); }, hrZone: 2 },
  long:      { get label() { return t('vdot.zoneLong'); }, hrZone: 2 },
  marathon:  { get label() { return t('vdot.zoneMarathon'); }, hrZone: 3 },
  race_hm:   { get label() { return t('vdot.zoneHalf'); }, hrZone: 4 },
  threshold: { get label() { return t('vdot.zoneThreshold'); }, hrZone: 4 },
  vo2:       { get label() { return t('vdot.zoneVo2'); }, hrZone: 5 },
};

/** HR zone of race pace per distance (5 km at the limit, marathon well below). */
function raceHrZone(distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km <= 6) return 5;
  if (km <= 25) return 4;
  return 3;
}

/** Race-pace range (±2 %) around a pace in s/km. */
export function raceZone(paceSec, distanceKm, label = t('vdot.racePace')) {
  if (!paceSec) return null;
  return { label, min: Math.round(paceSec * 0.98), max: Math.round(paceSec * 1.02), hrZone: raceHrZone(distanceKm) };
}

/** Race pace for a distance from the VDOT – via the equivalent time, not as a fixed
    fraction of VDOT. A fixed fraction ignores the race duration: for slower runners
    the HM zone was 7–21 s/km too fast, the marathon blocks ran at HM pace. */
export function racePaceFromVdot(vdot, distanceKm) {
  const sec = raceTimeFromVdot(vdot, (Number(distanceKm) || 0) * 1000);
  return sec ? Math.round(sec / distanceKm) : null;
}

/** Middle of the threshold range (86–90 % of VDOT, see ZONE_PCT). */
const THRESHOLD_MID = (ZONE_PCT.threshold[0] + ZONE_PCT.threshold[1]) / 2;

/**
 * VDOT from a threshold pace (s/km) of a performance test – the inverse of the app's own threshold range:
 * the pace sits in the middle of `pacesFromVdot(vdot).threshold`, so the form card shows the tested pace
 * again and not a second, contradicting one. null for nonsense.
 */
export function vdotFromThresholdPace(secPerKm) {
  const sec = Number(secPerKm);
  if (!(sec >= 150 && sec <= 900)) return null;
  const vdot = vo2AtSpeed(60000 / sec) / THRESHOLD_MID;
  return (vdot > 20 && vdot < 90) ? Math.round(vdot * 10) / 10 : null;
}

/**
 * The one set of inputs every form estimate gets (formcards, plan paces, race prediction): the heart rate
 * zones and the dated threshold pace of a performance test. A test without a date never counts – values
 * from before 4.2 (demo profiles) must not move anyone's form.
 */
export function formOptions(profile = {}) {
  const p = profile || {};
  const sec = Number(p.thresholdPaceSecPerKm);
  const date = typeof p.thresholdPaceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.thresholdPaceDate) ? p.thresholdPaceDate : null;
  return { hrZones: p.hrZones || null, perfTest: sec > 0 && date ? { secPerKm: sec, date } : null };
}

/** Days a test counts in the form estimate – the window of the estimate. */
export const FORM_WINDOW = 42;

/** Full pace ranges from a VDOT – format like `profile.paceZones`. */
export function pacesFromVdot(vdot) {
  if (!vdot) return null;
  const out = {};
  for (const [key, [hi, lo]] of Object.entries(ZONE_PCT)) {
    out[key] = { label: ZONE_META[key].label, min: paceForPct(vdot, hi), max: paceForPct(vdot, lo), hrZone: ZONE_META[key].hrZone };
  }
  out.marathon = raceZone(racePaceFromVdot(vdot, 42.195), 42.195, ZONE_META.marathon.label);
  out.race_hm = raceZone(racePaceFromVdot(vdot, 21.0975), 21.0975, ZONE_META.race_hm.label);
  // Order as before (for displays that iterate over the entries).
  const { recovery, easy, long, marathon, race_hm, threshold, vo2 } = out;
  return { recovery, easy, long, marathon, race_hm, threshold, vo2 };
}

/**
 * Paces of a race plan. Training ranges from the SAFER of goal-time and
 * form VDOT, race pace from the goal time (that is the target) – without a goal time from the
 * form. If the goal time is more than 3 VDOT points above the form, it counts as
 * ambitious. Returns null if neither goal time nor form is known.
 * @returns {{zones:object, goalVdot:number|null, formVdot:number|null, trainingVdot:number, ambitious:boolean}|null}
 */
export function planPaces({ distanceKm, targetSec = null, formVdot = null } = {}) {
  const km = Number(distanceKm) || 0;
  if (!km) return null;
  const goalVdot = targetSec ? vdotFromPerf(km * 1000, targetSec) : null;
  const form = formVdot || null;
  const trainingVdot = goalVdot && form ? Math.min(goalVdot, form) : (goalVdot || form);
  if (!trainingVdot) return null;
  const zones = pacesFromVdot(trainingVdot);
  const racePace = goalVdot ? Math.round(targetSec / km) : racePaceFromVdot(trainingVdot, km);
  zones.race = raceZone(racePace, km);
  return {
    zones, goalVdot, formVdot: form, trainingVdot,
    // "More than 3 points" on the tenths both values are shown with (64.4 − 61.4 is 3.0000000000000071).
    ambitious: !!(goalVdot && form && Math.round((goalVdot - form) * 10) > 30),
  };
}

/** Unambiguously hard run types – only they carry the form estimate. */
const HARD_TYPES = ['tempo', 'interval', 'race'];
/** All run types that can enter the estimate at all. */
const RUN_TYPES = ['tempo', 'interval', 'race', 'long', 'easy', 'run', 'recovery'];

/** Hard run: race/tempo/interval, or high effort (RPE ≥ 7), or
    average heart rate from zone 4. Easy runs do not presuppose maximal effort
    and clearly underestimate the form (VDOT formulas assume race effort). */
function isHardRun(s, z4min) {
  if (HARD_TYPES.includes(s.type)) return true;
  if (Number(s.rpe) >= 7) return true;
  return !!(z4min && Number(s.avgHr) >= z4min);
}

/** Median of a list of numbers (empty list → 0). */
function median(xs) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Estimates the current form (VDOT) from the HARD runs of the last `days`
 * (race, tempo, intervals, RPE ≥ 7 or average HR from zone 4) – deliberately SMOOTHED,
 * so that a single training outlier does not make the form jump:
 *
 *   1) Weekly best: per calendar week (as the person counts weeks) the best VDOT; dampens
 *      outliers within a week.
 *   2) Robust outlier capping of the weekly values at median ± 3·MAD
 *      (median absolute deviation – classic robust statistics). A single
 *      faulty/lucky value (e.g. GPS error) is capped this way, genuine improvements
 *      are preserved.
 *   3) Recency-weighted mean of the capped weekly values, exponential with
 *      a half-life of 2 weeks (same EWMA idea as fitness/form in load.js) –
 *      more recent weeks count more, but no single week dominates.
 *
 * Easy runs count only as a lower bound: the VDOT formulas assume maximal
 * effort, a base run underestimates the form by many points.
 * If there is no hard run, the function estimates from the easy runs and
 * flags this (`onlyEasy`) – the display then calls the estimate "rather too
 * low" and does not advise slower paces.
 *
 * With fewer than 3 weeks of data the best single run counts (and is the basis); smoothed, the basis
 * is the best run of the latest week. Returns { vdot, basis, weeks, onlyEasy, hardCount } or null.
 * `hrZones` (optional, profile) makes heart rate usable as a hardness feature.
 */
export function estimateVdot(sessions = [], today, days = FORM_WINDOW, { hrZones = null, perfTest = null } = {}) {
  const z4 = Array.isArray(hrZones) ? hrZones.find((z) => z.zone === 4) : null;
  const hard = [], easy = [];
  // A performance test counts like one hard run on its date (since 4.2): blended into the smoothing,
  // and it drops out after the window like any run – no second pace source beside the estimate.
  if (perfTest && perfTest.date && perfTest.date <= today && diffDays(perfTest.date, today) <= days) {
    const v = vdotFromThresholdPace(perfTest.secPerKm);
    if (v) {
      const week = Math.round(diffDays(weekStart(perfTest.date), weekStart(today)) / 7);
      hard.push({ v, week, date: perfTest.date, distanceKm: null, durationSec: null, type: 'test', paceSecPerKm: Number(perfTest.secPerKm) });
    }
  }
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !s.durationSec || s.distanceKm < 3) return;
    if (!RUN_TYPES.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0 || d > days) return;
    // Hilly runs underestimate form: every metre climbed counts like 6 m on the
    // flat (cautious rule of thumb) once there are more than 5 m per km (TRAIN-49).
    const climb = Number(s.ascentM) > 0 && Number(s.ascentM) / s.distanceKm > 5 ? Number(s.ascentM) : 0;
    const v = vdotFromPerf(s.distanceKm * 1000 + 6 * climb, s.durationSec);
    if (!v) return;
    // Calendar week as the person counts weeks (units().weekStart), 0 = the current one – not a block of
    // 7 days back from today, which put Saturday and Sunday of one week into different "weeks".
    const week = Math.round(diffDays(weekStart(s.date), weekStart(today)) / 7);
    const run = { v, week, date: s.date, distanceKm: s.distanceKm, durationSec: s.durationSec, type: s.type };
    (isHardRun(s, z4 && z4.min) ? hard : easy).push(run);
  });
  if (!hard.length && !easy.length) return null;
  if (!hard.length) return { ...smoothVdot(easy), onlyEasy: true, hardCount: 0 };
  const est = smoothVdot(hard);
  if (easy.length) {
    const floor = smoothVdot(easy).vdot;
    if (floor > est.vdot) est.vdot = floor;
  }
  return { ...est, onlyEasy: false, hardCount: hard.length };
}

/** Weekly best → outlier capping → recency-weighted mean (see above). */
function smoothVdot(runs) {
  // (1) Weekly best – on a tie keep the more recent session as the basis.
  const byWeek = new Map();
  runs.forEach((r) => {
    const cur = byWeek.get(r.week);
    if (!cur || r.v > cur.v || (r.v === cur.v && r.date > cur.date)) byWeek.set(r.week, r);
  });
  const weekly = [...byWeek.values()].sort((a, b) => a.week - b.week); // week 0 (current) first
  const basisOf = (r) => ({ date: r.date, distanceKm: r.distanceKm, durationSec: r.durationSec, type: r.type, ...(r.paceSecPerKm ? { paceSecPerKm: r.paceSecPerKm } : {}) });

  // Too little history → best single run (previous, robust behaviour) – and the basis is that run, the
  // one the number comes from (the card says "estimated from …").
  if (weekly.length < 3) {
    const best = weekly.reduce((a, w) => (w.v > a.v || (w.v === a.v && w.date > a.date) ? w : a));
    return { vdot: Math.round(best.v * 10) / 10, basis: basisOf(best), weeks: weekly.length };
  }
  // Smoothed: the basis is the best run of the latest week that holds one (the card names it as such).
  const basis = basisOf(weekly[0]);

  // (2) Robust capping at median ± 3·MAD (MAD lower bound 1.5 VDOT against over-capping of narrow weeks).
  const vals = weekly.map((w) => w.v);
  const med = median(vals);
  const mad = Math.max(median(vals.map((v) => Math.abs(v - med))), 1.5);
  const clamp = (v) => Math.max(med - 3 * mad, Math.min(med + 3 * mad, v));

  // (3) Recency-weighted mean (exponential, half-life 2 weeks).
  const HALF_LIFE = 2;
  let num = 0, den = 0;
  weekly.forEach((w) => {
    const wt = Math.pow(0.5, w.week / HALF_LIFE);
    num += clamp(w.v) * wt; den += wt;
  });
  const vdot = den ? num / den : med;
  return { vdot: Math.round(vdot * 10) / 10, basis, weeks: weekly.length };
}

/**
 * Compares the form-based paces with the current plan target paces (via the
 * threshold pace). Returns the recommended paces and the deviation in s/km.
 * `deltaSec` > 0: form is faster than the plan (plan too slow) → sharpen.
 */
export function paceAdjustment(currentZones = {}, vdot) {
  const fresh = pacesFromVdot(vdot);
  if (!fresh) return null;
  const cur = currentZones.threshold;
  if (!cur || cur.min == null) return { fresh, deltaSec: null };
  const curMid = (cur.min + cur.max) / 2;
  const freshMid = (fresh.threshold.min + fresh.threshold.max) / 2;
  return { fresh, deltaSec: Math.round(curMid - freshMid) };
}
