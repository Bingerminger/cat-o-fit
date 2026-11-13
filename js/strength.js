/* =========================================================================
   strength.js — logging strength training: sets with repetitions and
   (optionally) weight per exercise, "last time" and a simple progression
   hint. Pure, DOM-free logic → covered by node:test.

   Stored on the session as
     strengthSets: [{ exerciseId, sets: [{ reps, kg }] }]
   Double progression: whoever reaches the top end of the repetition
   range in all sets in two sessions in a row takes about 5 % more weight
   (ACSM 2009: 2–10 %), on the smallest step there is – otherwise increase
   the repetitions first. Since 4.2 also an estimated one-repetition maximum
   (Brzycki), personal records per exercise and a plate calculator.
   Deliberately small: no 1000-exercise database.
   ========================================================================= */

import { fmtDec, fmtWeightDec } from './ui.js';
import { kgToShown, weightUnit } from './units.js';

import { t } from './i18n.js';

/** Top end of the repetition range (8–12) for the progression hint. */
export const REP_TOP = 12;

/** Valid set? Repetitions 1–100, weight optional 0–500 kg on the 0.25 kg grid – for people who log in
    pounds to 0.01 kg, so a typed 45 lb comes back as 45 lb and not as 45.2 lb. */
export function cleanSet(s) {
  const reps = Math.round(Number(s && s.reps));
  if (!Number.isFinite(reps) || reps < 1 || reps > 100) return null;
  const kgRaw = s && s.kg != null && s.kg !== '' ? Number(String(s.kg).replace(',', '.')) : null;
  const kg = kgRaw != null && Number.isFinite(kgRaw) && kgRaw >= 0 && kgRaw <= 500 ? (weightUnit() === 'lb' ? Math.round(kgRaw * 100) / 100 : Math.round(kgRaw * 4) / 4) : null;
  return { reps, kg };
}

/** "12 × 20 kg" (or "12 × 44.1 lb") or "12 reps" without weight. */
export function fmtSet(s) {
  if (!s) return '';
  return s.kg != null ? `${s.reps} × ${fmtWeightDec(s.kg)}` : t('strength.reps', { n: s.reps });
}

/** Training volume (Σ repetitions × kg) – a set without weight does not count. */
export function volume(sets = []) {
  return Math.round((sets || []).reduce((a, s) => a + (s && s.kg != null ? s.reps * s.kg : 0), 0));
}

/** Turn the workout log { exerciseId: [sets] } into the session list (leave out empty ones). */
export function toStrengthSets(log = {}) {
  return Object.entries(log || {})
    .map(([exerciseId, sets]) => ({ exerciseId, sets: (sets || []).map(cleanSet).filter(Boolean) }))
    .filter((x) => x.sets.length);
}

/**
 * Last sets of an exercise before `beforeDate` (ISO): { date, sets } or null.
 * Searches all sessions with `strengthSets`, most recent first.
 */
export function lastSetsFor(sessions = [], exerciseId, beforeDate = null) {
  let best = null;
  for (const s of sessions || []) {
    if (!s || s.deleted || !s.date || !Array.isArray(s.strengthSets)) continue;
    if (beforeDate && s.date >= beforeDate) continue;
    const hit = s.strengthSets.find((x) => x && x.exerciseId === exerciseId && Array.isArray(x.sets) && x.sets.length);
    if (hit && (!best || s.date > best.date)) best = { date: s.date, sets: hit.sets };
  }
  return best;
}

/**
 * The last `n` logged sessions of an exercise before `beforeDate`, most recent first: [{ date, sets }].
 */
export function recentSetsFor(sessions = [], exerciseId, beforeDate = null, n = 2) {
  const out = [];
  for (const s of sessions || []) {
    if (!s || s.deleted || !s.date || !Array.isArray(s.strengthSets)) continue;
    if (beforeDate && s.date >= beforeDate) continue;
    const hit = s.strengthSets.find((x) => x && x.exerciseId === exerciseId && Array.isArray(x.sets) && x.sets.length);
    if (hit) out.push({ date: s.date, sets: hit.sets });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}

/** Repetitions to aim for first when the next weight step would be too big (light dumbbells). */
export const REP_TOP_SMALL_STEP = 15;
/** Largest step ACSM recommends (10 %); the app aims at about 5 %. */
const MAX_STEP = 0.10;
const STEP = 0.05;

/**
 * Progression hint from the last sets (double progression, Ratamess et al. 2009, ACSM):
 *   all sets ≥ REP_TOP repetitions in the last AND the session before → about 5 % more weight, on the
 *   smallest step there is (1 kg below 25 kg, 2.5 kg above; 2.5/5 lb); if that smallest step is more than
 *   10 %, first more repetitions (up to REP_TOP_SMALL_STEP) or a set more;
 *   all sets ≥ REP_TOP only once → "once more, then more weight";
 *   otherwise → "increase repetitions". Without weight: repetitions or a heavier variant.
 * @param {Array} sets the last session's sets
 * @param {Array|null} before the sets of the session before (null: none)
 * @returns {string|null}
 */
export function progressionHint(sets = [], before = null) {
  const list = (sets || []).map(cleanSet).filter(Boolean);
  if (!list.length) return null;
  const top = (l) => l.length > 0 && l.every((s) => s.reps >= REP_TOP);
  const allTop = top(list);
  const kgs = list.map((s) => s.kg).filter((k) => k != null);
  if (!kgs.length) {
    return allTop
      ? t('strength.hintHarder', { top: REP_TOP })
      : t('strength.hintMoreReps', { top: REP_TOP });
  }
  if (!allTop) return t('strength.hintSameWeight', { top: REP_TOP });
  const heaviest = Math.max(...kgs);
  // The session before must have reached the top at this weight too (or a heavier one).
  const prev = (before || []).map(cleanSet).filter(Boolean);
  const prevKg = Math.max(0, ...prev.map((s) => s.kg ?? 0));
  if (!top(prev) || prevKg < heaviest) return t('strength.hintOnceMore', { top: REP_TOP });
  const next = nextWeight(heaviest);
  return next.pct > MAX_STEP
    ? t('strength.hintSmallStep', { top: REP_TOP, weight: next.text, more: REP_TOP_SMALL_STEP })
    : t('strength.hintMoreWeight', { top: REP_TOP, weight: next.text });
}

/** The next weight up: about 5 % on the smallest step there is – 1 kg below 25 kg (dumbbells), 2.5 kg
    above (a pair of 1.25 kg plates); in pounds 2.5 lb below 50 lb, 5 lb above. `pct` = the step's share. */
export function nextWeight(topKg) {
  const lb = weightUnit() === 'lb';
  const shown = lb ? kgToShown(topKg) : topKg;
  const inc = lb ? (shown < 50 ? 2.5 : 5) : (shown < 25 ? 1 : 2.5);
  const step = Math.max(inc, Math.round((shown * STEP) / inc) * inc);
  const value = lb ? Math.round((shown + step) * 2) / 2 : shown + step;
  return { text: `${fmtDec(value)} ${lb ? 'lb' : 'kg'}`, pct: step / shown };
}

/* ------------------------------- Rest between sets ------------------------------- */

/** Rest after a set to choose per exercise (s) – ACSM 2009: 1–2 min for most, 2–3 min for heavy lifts. */
export const REST_CHOICES = [60, 90, 120, 180];
export const DEFAULT_REST_SEC = 90;

/* ----------------------- One-repetition maximum and records ----------------------- */

/** Repetitions up to which the estimate holds; beyond that it gets unreliable (Brzycki 1993). */
export const ONE_RM_MAX_REPS = 10;

/** Estimated one-repetition maximum of a set in kg (Brzycki 1993: weight × 36 / (37 − reps)), to 0.1 kg;
    null without a weight or above ONE_RM_MAX_REPS repetitions. */
export function estimateOneRm(set) {
  const reps = Number(set && set.reps);
  const kg = set && set.kg != null && set.kg !== '' ? Number(set.kg) : NaN;
  if (!Number.isInteger(reps) || reps < 1 || reps > ONE_RM_MAX_REPS || !(kg > 0)) return null;
  return reps === 1 ? kg : Math.round(((kg * 36) / (37 - reps)) * 10) / 10;
}

/** Key of an exercise in a session: the library id, or the name of one from another app. */
export function exerciseKey(x) {
  if (!x) return null;
  if (x.exerciseId) return x.exerciseId;
  return x.name ? `name:${String(x.name).trim().toLowerCase()}` : null;
}

/**
 * Best values of an exercise over the sessions given (each value with its date):
 *   oneRm: the highest estimated 1RM, weight: the heaviest weight (any repetitions),
 *   reps: the most repetitions in a set without weight. Missing values are null.
 */
export function exerciseRecords(sessions = [], key, { beforeDate = null, excludeId = null } = {}) {
  const rec = { oneRm: null, weight: null, reps: null };
  const better = (cur, value) => value != null && (!cur || value > cur.value);
  for (const s of sessions || []) {
    if (!s || s.deleted || !s.date || !Array.isArray(s.strengthSets)) continue;
    if ((beforeDate && s.date >= beforeDate) || (excludeId && s.id === excludeId)) continue;
    for (const x of s.strengthSets) {
      if (exerciseKey(x) !== key || !Array.isArray(x.sets)) continue;
      for (const set of x.sets) {
        const orm = estimateOneRm(set);
        if (better(rec.oneRm, orm)) rec.oneRm = { value: orm, date: s.date, set };
        if (set && set.kg != null && better(rec.weight, Number(set.kg))) rec.weight = { value: Number(set.kg), date: s.date, reps: set.reps };
        if (set && set.kg == null && better(rec.reps, Number(set.reps))) rec.reps = { value: Number(set.reps), date: s.date };
      }
    }
  }
  return rec;
}

/**
 * What `sets` improve over the earlier records `prev` (exerciseRecords): { oneRm, weight, reps } with the new
 * value, or null each. A first time is no record – only beating an earlier value counts.
 */
export function newRecords(prev, sets = []) {
  const now = exerciseRecords([{ date: '9999-12-31', strengthSets: [{ exerciseId: 'x', sets }] }], 'x');
  const beats = (k) => (prev && prev[k] && now[k] && now[k].value > prev[k].value ? now[k].value : null);
  return { oneRm: beats('oneRm'), weight: beats('weight'), reps: beats('reps') };
}

/* ------------------------------- Plate calculator ------------------------------- */

/** Plates per side as in most gyms, heaviest first; bars to choose from. In the shown unit. */
export const PLATES = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
export const BARS = { kg: [20, 15, 10], lb: [45, 35, 15] };

/**
 * Plates per side for a total weight on a bar (both in the shown unit): { plates, rest, under }.
 * `rest` is what the plates cannot make up (total, both sides) – 0 when exact; `under` when the total is
 * lighter than the bar.
 */
export function platesPerSide(total, bar, plates = PLATES.kg) {
  const t0 = Number(total), b = Number(bar);
  if (!(t0 > 0) || !(b >= 0)) return { plates: [], rest: 0, under: false };
  if (t0 < b) return { plates: [], rest: 0, under: true };
  let side = (t0 - b) / 2;
  const out = [];
  for (const p of plates) {
    while (side >= p - 1e-9) { out.push(p); side -= p; }
  }
  return { plates: out, rest: Math.round(side * 2 * 100) / 100, under: false };
}
