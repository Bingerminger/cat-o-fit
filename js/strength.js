/* =========================================================================
   strength.js — logging strength training: sets with repetitions and
   (optionally) weight per exercise, "last time" and a simple progression
   hint. Pure, DOM-free logic → covered by node:test.

   Stored on the session as
     strengthSets: [{ exerciseId, sets: [{ reps, kg }] }]
   Double progression: whoever reaches the top end of the repetition
   range in all sets may take a little more weight next time – otherwise
   increase the repetitions first. Deliberately small: no 1000-exercise database.
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
 * Progression hint from the last sets (double progression):
 *   all sets ≥ REP_TOP repetitions → "more weight" (+2.5 kg, or +1 kg with light dumbbells),
 *   otherwise → "increase repetitions". Without weight: repetitions or a heavier variant.
 * @returns {string|null}
 */
export function progressionHint(sets = []) {
  const list = (sets || []).map(cleanSet).filter(Boolean);
  if (!list.length) return null;
  const allTop = list.every((s) => s.reps >= REP_TOP);
  const kgs = list.map((s) => s.kg).filter((k) => k != null);
  if (!kgs.length) {
    return allTop
      ? t('strength.hintHarder', { top: REP_TOP })
      : t('strength.hintMoreReps', { top: REP_TOP });
  }
  const top = Math.max(...kgs);
  return allTop
    ? t('strength.hintMoreWeight', { top: REP_TOP, weight: nextWeight(top) })
    : t('strength.hintSameWeight', { top: REP_TOP });
}

/** The next weight up: +2.5 kg (+1 kg below 10 kg); in pounds the usual +5 lb (+2.5 lb), whole. */
function nextWeight(topKg) {
  if (weightUnit() !== 'lb') return `${fmtDec(topKg + (topKg < 10 ? 1 : 2.5))} kg`;
  return `${fmtDec(Math.round(kgToShown(topKg) + (topKg < 10 ? 2.5 : 5)))} lb`;
}
