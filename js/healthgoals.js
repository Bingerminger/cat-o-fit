/* =========================================================================
   healthgoals.js — Wochen-Gesundheitsziele mit Fortschritt.

   Unabhängig von Wettkampf-Plänen: misst die tatsächliche Aktivität der
   laufenden Woche (aus allen Sessions, auch Kraft/Programme) gegen
   konfigurierbare Wochenziele – plus optional den Gewichtsfortschritt.

   Reine, DOM-freie Logik -> per node:test abgedeckt.
   ========================================================================= */

import { weekStartMonday, addDays } from './ui.js';
import { sessionMinutes } from './fitness.js';

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

/** Jüngster Gewichtswert aus den Körperwerten (oder null). */
export function latestWeight(health = []) {
  let best = null;
  for (const h of health) {
    if (!h || h.deleted || h.weight == null || !h.date) continue;
    if (!best || h.date > best.date) best = h;
  }
  return best ? best.weight : null;
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

  let weight = null;
  const target = profile.targetWeightKg;
  const current = latestWeight(health);
  if (Number.isFinite(target) && current != null) {
    const deltaKg = Math.round((current - target) * 10) / 10;
    weight = {
      current, target, deltaKg,
      reached: Math.abs(deltaKg) < 0.05,
      direction: deltaKg > 0 ? 'down' : (deltaKg < 0 ? 'up' : 'hold'), // wohin es noch gehen muss
    };
  }

  const bothMet = minutes.pct >= 100 && days.pct >= 100;
  return { goals, minutes, days, weight, allMet: bothMet };
}
