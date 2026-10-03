/* =========================================================================
   strength.js — Krafttraining protokollieren: Sätze mit Wiederholungen und
   (optional) Gewicht je Übung, „letztes Mal“ und ein einfacher Progressions-
   hinweis. Reine, DOM-freie Logik → per node:test abgedeckt.

   Gespeichert wird an der Einheit (Session) als
     strengthSets: [{ exerciseId, sets: [{ reps, kg }] }]
   Doppelte Progression: Wer in allen Sätzen das obere Ende des Wiederholungs-
   bereichs schafft, darf beim nächsten Mal etwas mehr Gewicht nehmen – sonst
   erst die Wiederholungen steigern. Bewusst klein: keine 1000er-Übungsdatenbank.
   ========================================================================= */

import { fmtDec } from './ui.js';

/** Oberes Ende des Wiederholungsbereichs (8–12) für den Progressionshinweis. */
export const REP_TOP = 12;

/** Gültiger Satz? Wiederholungen 1–100, Gewicht optional 0–500 kg. */
export function cleanSet(s) {
  const reps = Math.round(Number(s && s.reps));
  if (!Number.isFinite(reps) || reps < 1 || reps > 100) return null;
  const kgRaw = s && s.kg != null && s.kg !== '' ? Number(String(s.kg).replace(',', '.')) : null;
  const kg = kgRaw != null && Number.isFinite(kgRaw) && kgRaw >= 0 && kgRaw <= 500 ? Math.round(kgRaw * 4) / 4 : null;
  return { reps, kg };
}

/** „12 × 20 kg“ bzw. „12 Wdh.“ ohne Gewicht. */
export function fmtSet(s) {
  if (!s) return '';
  return s.kg != null ? `${s.reps} × ${fmtDec(s.kg)} kg` : `${s.reps} Wdh.`;
}

/** Trainingsvolumen (Σ Wiederholungen × kg) – ohne Gewicht zählt der Satz nicht. */
export function volume(sets = []) {
  return Math.round((sets || []).reduce((a, s) => a + (s && s.kg != null ? s.reps * s.kg : 0), 0));
}

/** Aus dem Workout-Protokoll { übungsId: [sätze] } die Session-Liste machen (leere raus). */
export function toStrengthSets(log = {}) {
  return Object.entries(log || {})
    .map(([exerciseId, sets]) => ({ exerciseId, sets: (sets || []).map(cleanSet).filter(Boolean) }))
    .filter((x) => x.sets.length);
}

/**
 * Letzte Sätze einer Übung vor `beforeDate` (ISO): { date, sets } oder null.
 * Durchsucht alle Einheiten mit `strengthSets`, jüngste zuerst.
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
 * Progressionshinweis aus den letzten Sätzen (doppelte Progression):
 *   alle Sätze ≥ REP_TOP Wiederholungen → „mehr Gewicht“ (+2,5 kg bzw. +1 kg bei leichten Hanteln),
 *   sonst → „Wiederholungen steigern“. Ohne Gewicht: Wiederholungen oder schwerere Variante.
 * @returns {string|null}
 */
export function progressionHint(sets = []) {
  const list = (sets || []).map(cleanSet).filter(Boolean);
  if (!list.length) return null;
  const allTop = list.every((s) => s.reps >= REP_TOP);
  const kgs = list.map((s) => s.kg).filter((k) => k != null);
  if (!kgs.length) {
    return allTop
      ? `Alle Sätze mit ${REP_TOP}+ Wiederholungen – Zeit für eine schwerere Variante oder etwas Zusatzgewicht.`
      : `Nächstes Mal ein, zwei Wiederholungen mehr – bis ${REP_TOP} in jedem Satz.`;
  }
  const top = Math.max(...kgs);
  const step = top < 10 ? 1 : 2.5;
  return allTop
    ? `Alle Sätze mit ${REP_TOP}+ Wiederholungen – nächstes Mal etwa ${fmtDec(top + step)} kg.`
    : `Beim selben Gewicht bleiben und die Wiederholungen steigern – bis ${REP_TOP} in jedem Satz.`;
}
