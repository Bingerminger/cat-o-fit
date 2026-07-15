/* =========================================================================
   dualgoal.js — zwei Ziele in einem Plan: Halbmarathon-Leistung UND Abnehmen.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   Sollen beide Ziele „gleichermaßen" verfolgt werden, geht das ehrlich nur mit
   PHASENABHÄNGIGEM Schwerpunkt (Weiche: ausgewogen, phasenabhängig):
     - Grundlage  → viel lockerer Umfang, moderates Defizit (idealer Abnehm-Block)
     - Aufbau     → harte Reize brauchen Energie, Defizit kleiner
     - Spitze     → Leistung geht vor, Defizit gering
     - Tapering   → auffüllen statt abnehmen
   Dazu der ehrliche Reiz-Check: Ruhetage allein bringen kein Ziel voran
   (Superkompensation braucht Reiz + Erholung).
   ========================================================================= */

import { diffDays, addDays } from './ui.js';

/** Phasen-Schwerpunkt: perf/loss ∈ [0,1], empfohlenes Tagesdefizit (kcal, gedeckelt). */
export const PHASE_EMPHASIS = {
  base:  { perf: 0.5, loss: 0.9, deficit: 'moderat', kcal: -450, note: 'Grundlagenphase – idealer Zeitraum zum Abnehmen: moderates Defizit bei viel lockerem Umfang.' },
  build: { perf: 0.7, loss: 0.6, deficit: 'leicht',  kcal: -300, note: 'Aufbauphase – harte Reize brauchen Energie: kleineres Defizit, Eiweiß hoch, um die Qualität zu sichern.' },
  peak:  { perf: 0.9, loss: 0.3, deficit: 'gering',  kcal: -150, note: 'Spitzenphase – Leistung geht vor: Defizit klein halten, sonst leidet die Qualität der Einheiten.' },
  taper: { perf: 1.0, loss: 0.0, deficit: 'aus',     kcal: 0,    note: 'Tapering – jetzt auffüllen statt abnehmen: iss dich fit für den Wettkampf.' },
};

/** Aktuelle Plan-Woche (1..weeks) aus dem Datum – bewusst lokal, ohne plans.js-Abhängigkeit. */
function currentWeek(plan, today) {
  if (!plan || !plan.startDate || !plan.weeks) return 1;
  if (today < plan.startDate) return 1;
  if (plan.endDate && today > plan.endDate) return plan.weeks;
  return Math.min(plan.weeks, Math.floor(diffDays(plan.startDate, today) / 7) + 1);
}

/** Aktueller Phasenschlüssel (base|build|peak|taper) oder 'build' als Rückfall. */
export function currentPhaseKey(plan, today) {
  const w = currentWeek(plan, today);
  const p = (plan && plan.phases || []).find((x) => w >= x.startWeek && w <= x.endWeek) || (plan && plan.phases || []).at(-1);
  return p && PHASE_EMPHASIS[p.key] ? p.key : 'build';
}

/** Phasen-Gewichtung samt Anzeigename der Phase. */
export function phaseEmphasis(plan, today) {
  const key = currentPhaseKey(plan, today);
  const p = (plan && plan.phases || []).find((x) => x.key === key);
  return { phase: key, phaseName: p ? p.name : '', ...PHASE_EMPHASIS[key] };
}

/** Empfohlenes Tagesdefizit (kcal), phasenabhängig & sicher. Bei erreichtem Zielgewicht 0. */
export function recommendedDeficit(plan, today, { currentKg, targetKg } = {}) {
  const e = phaseEmphasis(plan, today);
  if (targetKg != null && currentKg != null && currentKg <= targetKg + 0.1) {
    return { ...e, kcal: 0, deficit: 'Ziel erreicht', reached: true };
  }
  return { ...e, reached: false };
}

/**
 * Ehrlicher Trainingsreiz-Check: reicht der Reiz für Fortschritt, oder wird das
 * Ziel „mit Ruhetagen schöngerechnet"? Zählt fordernde Reize und aktive Tage
 * der letzten `days` und vergleicht mit einem Mindestmaß (≈1 harte/Woche, ≥3
 * aktive Tage/Woche).
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
      ? 'Dein Training setzt genug Reiz für echten Fortschritt.'
      : 'Zuletzt wenig fordernder Reiz – Ruhetage allein bringen dich dem Ziel nicht näher. Plane wieder Schlüsseleinheiten ein (Reiz + Erholung = Fortschritt).',
  };
}
