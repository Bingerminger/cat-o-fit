/* =========================================================================
   healthgoals.js — Wochen-Gesundheitsziele mit Fortschritt.

   Unabhängig von Wettkampf-Plänen: misst die tatsächliche Aktivität der
   laufenden Woche (aus allen Sessions, auch Kraft/Programme) gegen
   konfigurierbare Wochenziele – plus optional den Gewichtsfortschritt.

   Reine, DOM-freie Logik -> per node:test abgedeckt.
   ========================================================================= */

import { weekStartMonday, addDays } from './ui.js';
import { sessionMinutes } from './fitness.js';
import { weightNow, weightGoalStatus } from './energy.js';

// An den WHO-Bewegungsempfehlungen orientiert (≥150 min/Woche, mehrere Tage aktiv).
export const DEFAULT_GOALS = { activeMinutes: 150, trainingDays: 3 };

/** Konfigurierte Wochenziele (mit Defaults). */
export function weeklyGoals(profile = {}) {
  const g = (profile.settings && profile.settings.weeklyGoals) || {};
  const num = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
  return {
    activeMinutes: num(g.activeMinutes, DEFAULT_GOALS.activeMinutes),
    trainingDays: num(g.trainingDays, DEFAULT_GOALS.trainingDays),
  };
}

/** Aktive Minuten und Trainingstage der laufenden Woche (Mo–So um `today`). */
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

/** Jüngster Gewichtswert aus den Körperwerten (oder null). Nur echte Zahlen zählen –
    ein Eintrag aus einer fremden Quelle (API, Backup-Datei) kann sonst Text enthalten. */
export function latestWeight(health = []) {
  let best = null;
  for (const h of health) {
    if (!h || h.deleted || h.weight == null || h.weight === '' || !h.date || !Number.isFinite(Number(h.weight))) continue;
    if (!best || h.date > best.date) best = h;
  }
  return best ? Number(best.weight) : null;
}

/**
 * Wochenfortschritt gegen die Ziele. Liefert Ringe für Minuten und Tage sowie
 * – falls Zielgewicht und ein Gewichtswert vorliegen – die Gewichtsdifferenz.
 */
export function goalProgress({ profile = {}, sessions = [], health = [], today } = {}) {
  const goals = weeklyGoals(profile);
  const act = weekActivity(sessions, today);
  const minutes = { value: act.activeMinutes, goal: goals.activeMinutes, pct: pct(act.activeMinutes, goals.activeMinutes) };
  const days = { value: act.trainingDays, goal: goals.trainingDays, pct: pct(act.trainingDays, goals.trainingDays) };

  // Gewicht: geglätteter Wert (7-Tage-Median) und dieselbe Zieldefinition wie Ernährung
  // und Cockpit (energy.js weightGoalStatus) – früher galt hier „erreicht“ nur bei ±0,05 kg.
  let weight = null;
  const target = profile.targetWeightKg;
  const current = latestWeight(health) != null ? weightNow(health, {}, today) : null;
  if (Number.isFinite(target) && current != null) {
    const gs = weightGoalStatus({ current, target, start: profile.targetWeightStartKg != null ? profile.targetWeightStartKg : profile.weightKg });
    weight = {
      current, target, deltaKg: gs.gap, reached: gs.reached, status: gs.status,
      remaining: gs.remaining, beyond: gs.beyond,
      direction: gs.direction, // Zielrichtung (down = abnehmen, up = zunehmen)
    };
  }

  const bothMet = minutes.pct >= 100 && days.pct >= 100;
  return { goals, minutes, days, weight, allMet: bothMet };
}
