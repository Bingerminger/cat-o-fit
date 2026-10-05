/* =========================================================================
   load.js — load management. Pure, DOM-free logic -> covered by
   node:test. The ONLY source for load judgements in the app: sRPE load
   (duration × effort, Foster) and the metrics derived from it:

     - Load ratio (ACWR): last 7 days against the 21 days before – decoupled,
       because otherwise the acute days sit in their own denominator (spurious correlation,
       Lolli et al. 2019). The limits 0.8 / 1.3 / 1.5 are guidance drawn from
       observational data, not an injury barometer (Impellizzeri et al. 2020).
     - Fitness / fatigue / form (CTL / ATL / TSB) as impulse-response smoothing
       after Banister – in load points (AU), form relative to fitness.
     - Monotony & strain (Foster) – flag only for uniform load that is ALSO above
       one's own average.

   All of it is meant as guidance – approximations, not laboratory diagnostics. `today`
   is always passed in (no dependence on the device clock).
   ========================================================================= */

import { addDays, diffDays, fmtDec } from './ui.js';

import { t, tp } from './i18n.js';

const r1 = (v) => Math.round(v * 10) / 10;
/** Number with a German decimal comma (e.g. 1,24). */
export function fmtRatio(v) {
  return fmtDec(v == null ? null : Math.round(v * 100) / 100);
}

/* --------------------------- Load per session --------------------------- */

/** Estimated perceived exertion per session type, if no RPE was recorded. */
export const RPE_BY_TYPE = {
  recovery: 3, easy: 4, long: 6, tempo: 7, interval: 8, race: 9, run: 5,
  // Football is HIIT-like (sprints, match intensity) and is weighted higher than
  // an easy run; the default 7 corresponds to "normal" (see FOOTBALL_RPE).
  strength: 5, mobility: 2, cross: 5, cross_bike: 5, cross_football: 7, match: 8, camp: 7, walk: 2, other: 4,
  // Remaining sports of the logging form – without an entry, indoor cycling counted like an easy run.
  swim: 5, hike: 4, rowing: 6, tennis: 6, badminton: 6, squash: 7, tabletennis: 5, spinning: 6, elliptical: 5, gym: 5,
};
/** Football intensity → RPE. Adjustable per appointment (light/normal/intense) so that
    the load feeds realistically into ACWR/form and the plan relief (#5). */
export const FOOTBALL_RPE = { leicht: 5, normal: 7, intensiv: 8.5 };
export function footballRpe(intensity) { return FOOTBALL_RPE[intensity] || FOOTBALL_RPE.normal; }

/* Watch data: if the effort is missing, the average heart rate estimates it – relative to
   the person's max HR. The load stays sRPE (duration × effort); the HR only supplies
   the input value. Without this estimate every imported session counted as "easy"
   (an interval session from the watch with effort 4 instead of ~7). */
let hrReference = () => null;
/** Supplies the max HR of the active person (`{ maxHr }`); the app registers it once. */
export function useHrReference(fn) { hrReference = typeof fn === 'function' ? fn : () => null; }

/** Anchor points avg HR in % of max HR → effort (matching the HR zones 50/60/70/80/90 %). */
const HR_RPE = [[0.5, 1.5], [0.6, 2.5], [0.7, 4], [0.8, 6], [0.9, 8], [1, 10]];
/** Effort (1–10, one decimal place) from avg HR and max HR; null without usable values. */
export function rpeFromHr(avgHr, maxHr) {
  const a = Number(avgHr), m = Number(maxHr);
  if (!(a >= 60) || !(m >= 120 && m <= 230) || a > m * 1.05) return null;
  const pct = a / m;
  if (pct <= HR_RPE[0][0]) return HR_RPE[0][1];
  for (let i = 1; i < HR_RPE.length; i++) {
    const [x0, y0] = HR_RPE[i - 1], [x1, y1] = HR_RPE[i];
    if (pct <= x1) return Math.round((y0 + ((y1 - y0) * (pct - x0)) / (x1 - x0)) * 10) / 10;
  }
  return 10;
}

/** Hard sessions: avg HR underestimates intervals (the rests count towards it) – there
    the value of the type remains the lower bound. */
const HARD_TYPES = new Set(['tempo', 'interval', 'race', 'match']);

/**
 * Effort of a session (1–10) including its origin: recorded (clamped) → football intensity →
 * estimated from heart rate → default of the type. RPE 0, negative or invalid
 * values count as "not recorded".
 * @returns {{rpe:number, source:'erfasst'|'herzfrequenz'|'typ'}}
 */
export function sessionRpeInfo(s, ref = hrReference()) {
  const r = Number(s && s.rpe);
  if (Number.isFinite(r) && r > 0) return { rpe: Math.min(10, Math.max(1, r)), source: 'erfasst' };
  if (s && s.type === 'cross_football') return { rpe: footballRpe(s.intensity), source: 'typ' };
  const typeRpe = RPE_BY_TYPE[s && s.type] || 4;
  const hr = ref ? rpeFromHr(s && s.avgHr, ref.maxHr) : null;
  if (hr != null) return { rpe: HARD_TYPES.has(s.type) ? Math.max(hr, typeRpe) : hr, source: 'herzfrequenz' };
  return { rpe: typeRpe, source: 'typ' };
}

/** Effort of a session on the 1–10 scale (see `sessionRpeInfo`). */
export function sessionRpe(s, ref) {
  return sessionRpeInfo(s, ref === undefined ? hrReference() : ref).rpe;
}

/** Minutes per km when only the distance is known (running 6, cycling much faster …). */
const MIN_PER_KM = { cross_bike: 2.5, spinning: 2.5, walk: 12, hike: 15, swim: 25, rowing: 5 };
/** Upper limit for a single session – a typo (3000 instead of 30 min) must not distort the
    load for weeks. */
const MAX_MIN = 24 * 60;

/**
 * Duration (min) with which a session enters the load – including its origin:
 * recorded → from the distance → planned duration of the session → 30-min flat rate.
 * @returns {{min:number, source:'erfasst'|'strecke'|'geplant'|'pauschal'}}
 */
export function loadMinutes(s) {
  const sec = Number(s && s.durationSec);
  if (Number.isFinite(sec) && sec > 0) return { min: Math.min(sec / 60, MAX_MIN), source: 'erfasst' };
  const km = Number(s && s.distanceKm);
  if (Number.isFinite(km) && km > 0) return { min: Math.min(km * (MIN_PER_KM[s.type] || 6), MAX_MIN), source: 'strecke' };
  const planned = Number(s && s.plannedDurationMin);
  if (Number.isFinite(planned) && planned > 0) return { min: Math.min(planned, MAX_MIN), source: 'geplant' };
  return { min: 30, source: 'pauschal' };
}

/** Load points (AU) of a session = duration (min) × effort (RPE 1–10) –
    session-RPE method. Never negative, never above 24 h × 10. `ref` ({ maxHr } or null) applies to
    the HR estimate; if omitted, the signed-in person. */
export function sessionLoad(s, ref) {
  return Math.round(loadMinutes(s).min * sessionRpe(s, ref));
}

/**
 * Total load (all sports) of the last `days` days – sum of the load points.
 * Unlike the km load, it also covers strength, football, swimming, cycling, friendly matches.
 */
export function trainingLoad(sessions = [], today, days = 7, ref) {
  return (sessions || []).reduce((a, s) => {
    if (!s || s.deleted) return a;
    const d = diffDays(s.date, today);
    return d >= 0 && d < days ? a + sessionLoad(s, ref) : a;
  }, 0);
}

/* ------------------------------ Time series --------------------------------- */

/**
 * Daily load total (sRPE) over [today-days+1 .. today], chronological.
 * Returns: [{date, load}] of length `days` – including training-free days (load 0),
 * so the series can be used gap-free for ACWR/smoothing/monotony.
 */
export function dailyLoadSeries(sessions = [], today, days = 42, ref) {
  const start = addDays(today, -(days - 1));
  const byDate = new Map();
  for (const s of sessions || []) {
    if (!s || s.deleted || !s.date) continue;
    if (s.date < start || s.date > today) continue;
    byDate.set(s.date, (byDate.get(s.date) || 0) + sessionLoad(s, ref));
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, load: Math.round(byDate.get(date) || 0) });
  }
  return out;
}

/** Days since the first recorded session (including today); 0 without data. */
export function historyDays(sessions = [], today) {
  const first = (sessions || [])
    .filter((s) => s && !s.deleted && s.date && s.date <= today)
    .map((s) => s.date).sort()[0] || null;
  return first ? diffDays(first, today) + 1 : 0;
}

/** From this much history on, the form (CTL − ATL) is meaningful: the fitness curve
    (τ 42 days) starts at 0 with the first entry and needs about three months until
    it has settled – before that the form would be artificially negative. */
export const FORM_MIN_DAYS = 90;

/**
 * Load ratio (Acute:Chronic Workload Ratio), decoupled: acute = mean
 * daily load of the last `acute` days, chronic = mean daily load of the days
 * BEFORE that up to day `chronic` (default: day 8–28). Values read directly: 1.3 =
 * the last week was 30 % more demanding than your average of the three weeks before.
 * @returns {{acute:number, chronic:number, acuteWeek:number, chronicWeek:number,
 *   ratio:number|null, zone:string, tone:string, sparse:boolean, historyDays:number}}
 */
export function acwr(sessions = [], today, { acute = 7, chronic = 28, ref } = {}) {
  const series = dailyLoadSeries(sessions, today, chronic, ref);
  const sum = (arr) => arr.reduce((a, d) => a + d.load, 0);
  const a = sum(series.slice(-acute)) / acute;
  const c = sum(series.slice(0, chronic - acute)) / (chronic - acute);
  const ratio = c > 0 ? a / c : null;

  // Does the HISTORY suffice for a reliable chronic average? Someone who has only
  // just started (or has not entered old data) has nothing but zero days in the
  // denominator – the ratio then shoots up arithmetically without anyone having
  // increased too fast. Such cases are flagged as "aufbau".
  const hist = historyDays(sessions, today);
  const sparse = hist < chronic;

  let zone = 'unklar', tone = 'neutral';
  // Young history: stage "aufbau" – even if days 8–28 still hold nothing at all.
  if (hist > 0 && sparse) zone = 'aufbau';
  else if (ratio != null) {
    if (ratio < 0.8) { zone = 'niedrig'; tone = 'neutral'; }
    else if (ratio <= 1.3) { zone = 'optimal'; tone = 'good'; }
    else if (ratio <= 1.5) { zone = 'erhöht'; tone = 'warn'; }
    else { zone = 'hoch'; tone = 'bad'; }
  }
  return {
    acute: Math.round(a), chronic: Math.round(c),
    acuteWeek: Math.round(a * 7), chronicWeek: Math.round(c * 7),
    ratio, zone, tone, sparse, historyDays: hist,
  };
}

const CTL_TAU = 42;   // Fitness: slow smoothing (~6 weeks)
const ATL_TAU = 7;    // Fatigue: fast smoothing (~1 week)

/** Impulse-response smoothing (Banister): x_t = x_{t-1} + (load_t − x_{t-1})·(1 − e^(−1/τ)). */
function ewma(daily, tau) {
  const k = 1 - Math.exp(-1 / tau);
  let x = 0;
  return daily.map((d) => (x += (d.load - x) * k));
}

/**
 * Fitness (CTL), fatigue (ATL) and form (TSB = CTL − ATL) as a time series of the
 * last `days` days. `warmup` additional days before the visible window
 * let the smoothing settle (otherwise the curve starts artificially at 0).
 *
 * The warmup must be a multiple of CTL_TAU: after only 42 days the
 * fitness would stand at only ~63 % of its equilibrium, while the fatigue (τ 7) is long since at
 * 100 % – the displayed form (CTL − ATL) would be permanently, artificially negative.
 * 180 days ≈ 4·τ let the fitness curve settle practically completely.
 * That only helps if there is data in the lead-in – hence `FORM_MIN_DAYS`.
 * @returns {Array<{date, ctl, atl, form}>}
 */
export function formSeries(sessions = [], today, { days = 42, warmup = 180 } = {}) {
  const total = days + warmup;
  const daily = dailyLoadSeries(sessions, today, total);
  const ctl = ewma(daily, CTL_TAU);
  const atl = ewma(daily, ATL_TAU);
  const out = [];
  for (let i = warmup; i < total; i++) {
    out.push({ date: daily[i].date, ctl: r1(ctl[i]), atl: r1(atl[i]), form: r1(ctl[i] - atl[i]) });
  }
  return out;
}

/** Current state of fitness/fatigue/form (last point of the series). */
export function formToday(sessions = [], today, opts = {}) {
  const series = formSeries(sessions, today, opts);
  return series.at(-1) || { date: today, ctl: 0, atl: 0, form: 0 };
}

/**
 * Form relative to fitness (TSB as % of CTL) with a verbal classification. The curves
 * run in load points (minutes × RPE) – an absolute threshold such as "form > 5"
 * would be practically "form > 0" there. Before `FORM_MIN_DAYS` of history: no rating.
 * @returns {{key:'einschwingen'|'frisch'|'ausgeglichen'|'training'|'ermuedet', label:string, rel:number|null, reliable:boolean}}
 */
export function formState(form = {}, hist = 0) {
  const rel = form.ctl > 0 ? form.form / form.ctl : null;
  if (hist < FORM_MIN_DAYS || rel == null) return { key: 'einschwingen', label: t('load.formSettling'), rel, reliable: false };
  if (rel >= 0.1) return { key: 'frisch', label: t('load.formFresh'), rel, reliable: true };
  if (rel >= -0.1) return { key: 'ausgeglichen', label: t('load.formBalanced'), rel, reliable: true };
  if (rel >= -0.3) return { key: 'training', label: t('load.formTraining'), rel, reliable: true };
  return { key: 'ermuedet', label: t('load.formTired'), rel, reliable: true };
}

/**
 * Monotony & strain after Foster over the last `win` days.
 * Monotony = mean / standard deviation of the daily load (high = same every day);
 * Strain = weekly load × monotony. Foster describes the risk of sustained
 * HEAVY, uniform training: very light activity (RPE ≤ 3 – walking,
 * mobility, recovery) therefore does not count, and a flag appears only if
 * the week is at the same time clearly above one's own weekly load of the three weeks before.
 */
export function monotonyStrain(sessions = [], today, { win = 7, chronic = 28 } = {}) {
  const relevant = (sessions || []).filter((s) => s && sessionRpe(s) > 3);
  const series = dailyLoadSeries(relevant, today, chronic);
  const daily = series.slice(-win).map((d) => d.load);
  const n = daily.length || 1;
  const weekLoad = daily.reduce((a, b) => a + b, 0);
  const mean = weekLoad / n;
  // Sample variance (n−1), as in Foster's original work – with n the
  // monotony values would be systematically ~8 % too high and the warning threshold 2 too strict.
  const variance = daily.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const sd = Math.sqrt(variance);
  // sd = 0 (exactly the same every day) -> maximally monotonous; without load -> 0.
  const monotony = sd > 0 ? mean / sd : (mean > 0 ? n : 0);
  const strain = Math.round(weekLoad * monotony);
  const before = series.slice(0, chronic - win).reduce((a, d) => a + d.load, 0);
  const chronicWeek = (chronic - win) > 0 ? (before / (chronic - win)) * win : 0;
  const tone = (monotony >= 2 && weekLoad > 0 && chronicWeek > 0 && weekLoad >= chronicWeek * 1.1) ? 'warn' : 'good';
  return { monotony: Math.round(monotony * 100) / 100, strain, weekLoad: Math.round(weekLoad), chronicWeek: Math.round(chronicWeek), tone };
}

/**
 * Condenses load ratio, form and monotony into one understandable statement
 * for the dashboard – including the time series for the curve. `hasData` only becomes true once a
 * reliable 28-day basis exists; the form is rated only from `FORM_MIN_DAYS`
 * on. The texts promise no injury protection – the metric shows
 * how much the load has risen compared with your own average, nothing more.
 */
export function loadSummary(sessions = [], today) {
  const ac = acwr(sessions, today);
  const series = formSeries(sessions, today, { days: 42 });
  const form = series.at(-1) || { ctl: 0, atl: 0, form: 0 };
  const fstate = formState(form, ac.historyDays);
  const mono = monotonyStrain(sessions, today);
  // Reliable only with the full 28-day history: otherwise nothing but zero days would sit in the
  // chronic denominator and the card would report "increased too fast" although only
  // the data basis is missing (typical in the first weeks after setup).
  const hasData = ac.chronic > 0 && !ac.sparse;
  const r = fmtRatio(ac.ratio);

  let headline, tone, advice;
  if (!hasData) {
    tone = 'neutral';
    if (!ac.historyDays) {
      headline = t('load.headlineNoData');
      advice = t('load.adviceNoData');
    } else if (ac.sparse) {
      headline = t('load.headlineSparse');
      advice = t('load.adviceSparse', { days: tp('load.days', ac.historyDays) });
    } else {
      headline = t('load.headlineReturn');
      advice = t('load.adviceReturn');
    }
  } else if (ac.zone === 'hoch') {
    headline = t('load.headlineHigh');
    tone = 'bad';
    advice = t('load.adviceHigh', { ratio: r });
  } else if (ac.zone === 'erhöht') {
    headline = t('load.headlineRaised');
    tone = 'warn';
    advice = t('load.adviceRaised', { ratio: r });
  } else if (mono.tone === 'warn') {
    headline = t('load.headlineUniform');
    tone = 'warn';
    advice = t('load.adviceUniform');
  } else if (fstate.key === 'ermuedet') {
    headline = t('load.headlineTired');
    tone = 'warn';
    advice = t('load.adviceTired', { pct: Math.round(fstate.rel * 100) });
  } else if (fstate.key === 'frisch') {
    headline = t('load.headlineFresh');
    tone = 'good';
    advice = t('load.adviceFresh');
  } else if (ac.zone === 'niedrig') {
    headline = t('load.headlineLow');
    tone = 'neutral';
    advice = t('load.adviceLow', { ratio: r });
  } else {
    headline = t('load.headlineOptimal');
    tone = 'good';
    advice = t('load.adviceOptimal', { ratio: r });
  }
  const formNote = fstate.reliable ? null
    : t('load.formNote', { days: tp('load.days', ac.historyDays) });
  return { acwr: ac, form, formState: fstate, formNote, mono, series, headline, tone, advice, hasData };
}
