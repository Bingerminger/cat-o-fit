/* =========================================================================
   rolling.js — rollierende Planung: erkennt aus der tatsächlichen Belastung,
   wann ein Erholungstag ratsam ist, und führt ein Transparenz-Protokoll der
   automatischen Anpassungen (mit Rückgängig). Reine, DOM-freie Logik → per
   node:test abgedeckt.

   Grundgedanke (Belastungssteuerung, Profisport): Nach zu vielen harten Tagen
   in Folge, bei stark gestiegener Akutlast (ACWR) oder deutlich negativer Form
   braucht der Körper Erholung – sonst steigt das Verletzungs-/Übertrainings-
   risiko. Feste Termine (Fußball/Spiele) bleiben dabei unangetastet; angepasst
   wird nur die nächste offene, fordernde LAUF-/Krafteinheit.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { isHard } from './planflow.js';
import { acwr, formToday, fmtRatio } from './load.js';

/** War dieser Tag „hart" (erledigte fordernde Einheit oder fordernde Session)? */
export function dayIsHard(units = [], sessions = [], date) {
  if ((units || []).some((u) => u.date === date && u.status === 'erledigt' && isHard(u))) return true;
  return (sessions || []).some((s) => s && !s.deleted && s.date === date
    && (Number(s.rpe) >= 7 || ['tempo', 'interval', 'long', 'race', 'match'].includes(s.type)
      || (s.type === 'cross_football' && s.intensity !== 'leicht')));  // Fußball ist fordernd (#5)
}

/** Anzahl harter Tage in Folge, die auf heute ODER gestern enden (ein noch
    untrainierter „heute" bricht die Serie also nicht ab – realistischer). */
export function consecutiveHardDays(units = [], sessions = [], today, max = 14) {
  const start = dayIsHard(units, sessions, today) ? 0
    : (dayIsHard(units, sessions, addDays(today, -1)) ? 1 : null);
  if (start === null) return 0;
  let n = 0;
  for (let i = start; i < max; i++) {
    if (dayIsHard(units, sessions, addDays(today, -i))) n++; else break;
  }
  return n;
}

/** Wandelt eine fordernde Einheit in einen aktiven Erholungstag (Patch-Felder). */
export function recoveryVariant(unit) {
  const km = unit.targetDistanceKm ? Math.min(5, Math.max(3, Math.round(unit.targetDistanceKm * 0.4))) : null;
  return {
    type: 'recovery',
    title: 'Erholungstag (automatisch)',
    targetDistanceKm: km,
    targetDurationMin: km ? null : 30,
    targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null, targetHrZone: 1,
    intervals: null,
    description: 'Bewusst locker – dein Körper braucht heute Erholung, nicht Reiz. Ganz ruhig in Z1 oder ein Spaziergang. Die fordernde Einheit holst du erholter nach.',
    autoRest: true, originalType: unit.originalType || unit.type,
  };
}

/**
 * Type-bewusste sanfte Variante (Patch-Felder), wiederverwendbar für zyklusbewusste
 * Entschärfung (#3) und ganztägige Erholung (#4): Läufe/Ausdauer → lockerer
 * Regenerationslauf, Kraft/Funktionell → ruhige Mobility. `copy` liefert Titel/
 * Beschreibung. Behält originalType, damit „Rückgängig" das Original wiederherstellt.
 */
export function gentleVariant(unit, copy = {}) {
  const common = {
    intervals: null, targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null,
    deloaded: true, originalType: unit.originalType || unit.type,
    title: copy.title || 'Locker', description: copy.description || 'Bewusst ruhig – Erholung statt Reiz.',
  };
  if (['strength', 'gym', 'functional'].includes(unit.type)) {
    return { ...common, type: 'mobility', targetDistanceKm: null, targetDurationMin: 15, targetHrZone: null };
  }
  const km = unit.targetDistanceKm ? Math.min(5, Math.max(3, Math.round(unit.targetDistanceKm * 0.5))) : null;
  return { ...common, type: 'recovery', targetDistanceKm: km, targetDurationMin: km ? null : 25, targetHrZone: 1 };
}

/**
 * Schlägt einen Erholungstag vor, wenn die Belastung es nahelegt. Zielt auf die
 * nächste OFFENE, fordernde, verschiebbare Einheit in [today, today+horizon]
 * (feste Termine bleiben außen vor).
 * @returns {{unit, date, reason, acwr, hardStreak}|null}
 */
export function restDaySuggestion({ plan = {}, sessions = [], today, horizon = 4 } = {}) {
  const units = plan.units || [];
  const ac = acwr(sessions, today);
  const form = formToday(sessions, today);
  const hardStreak = consecutiveHardDays(units, sessions, today);

  // Signale (klar & robust): akuter Lastsprung, viele harte Tage in Folge, oder
  // erhöhte Last MIT deutlich negativer Form. Die Form-Bedingung ist bewusst an
  // eine erhöhte ACWR gekoppelt – sonst triggert schon das Einschwingen der
  // CTL-Kurve (Ramp-up-Artefakt) bei ruhiger, gleichmäßiger Belastung.
  const acwrHigh = ac.ratio != null && ac.ratio > 1.5;
  const elevatedAndTired = ac.ratio != null && ac.ratio > 1.3 && form.ctl > 0 && form.form < -0.3 * form.ctl;
  if (!(acwrHigh || elevatedAndTired || hardStreak >= 3)) return null;

  const cand = units
    .filter((u) => !u.fixed && (u.status === 'geplant' || u.status == null) && isHard(u)
      && u.date >= today && diffDays(today, u.date) <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!cand) return null;

  let reason;
  if (acwrHigh) reason = `Deine Akutlast ist zuletzt stark gestiegen (ACWR ${fmtRatio(ac.ratio)} – über dem sicheren Bereich).`;
  else if (hardStreak >= 3) reason = `${hardStreak} fordernde Tage in Folge – Erholung schützt vor Verletzungen.`;
  else reason = `Erhöhte Last (ACWR ${fmtRatio(ac.ratio)}) bei deutlich negativer Form – deine Ermüdung liegt über deiner Fitness.`;
  return { unit: cand, date: cand.date, reason, acwr: ac, hardStreak };
}

/**
 * Nach einem fordernden Fußballtag (Termin heute oder gestern, nicht „leicht") die
 * nächste offene, fordernde LAUF-/Krafteinheit in [today, today+2] als Entlastungs-
 * Kandidat – so beeinflusst die hohe Fußball-Last den Plan spürbar (#5). Reine Funktion.
 * @returns {{date, unit, when:'heute'|'gestern'}|null}
 */
export function footballFollowupEase({ units = [], sessions = [], today } = {}) {
  const hardFootballOn = (d) =>
    (units || []).some((u) => u.date === d && u.type === 'cross_football' && u.intensity !== 'leicht')
    || (sessions || []).some((s) => s && !s.deleted && s.date === d && s.type === 'cross_football' && s.intensity !== 'leicht');
  const when = hardFootballOn(today) ? 'heute' : (hardFootballOn(addDays(today, -1)) ? 'gestern' : null);
  if (!when) return null;
  const cand = (units || [])
    .filter((u) => !u.fixed && (u.status === 'geplant' || u.status == null) && isHard(u)
      && u.date >= today && diffDays(today, u.date) <= 2)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return cand ? { date: cand.date, unit: cand, when } : null;
}

/**
 * Fügt einen Protokolleintrag vorne an und deckelt die Länge. Reiner Wert
 * (kein Store). `entry` bekommt id + ts, falls nicht gesetzt.
 */
export function pushAdaptLog(log = [], entry = {}, max = 25) {
  const e = {
    id: entry.id || `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: entry.ts || new Date().toISOString(),
    ...entry,
  };
  return [e, ...(log || [])].slice(0, max);
}
