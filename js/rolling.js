/* =========================================================================
   rolling.js — rollierende Planung: erkennt aus der tatsächlichen Belastung,
   wann ein Erholungstag ratsam ist, und führt ein Transparenz-Protokoll der
   automatischen Anpassungen (mit Rückgängig). Reine, DOM-freie Logik → per
   node:test abgedeckt.

   Grundgedanke: Nach zu vielen harten Tagen in Folge, bei stark gestiegener Last
   oder deutlicher Ermüdung tut ein ruhiger Tag gut. Die Signale reagieren nur auf
   ABWEICHUNGEN vom Plan (mehr Last als geplant, zusätzliche oder härter gelaufene
   Einheiten) – nicht auf die geplante Struktur selbst: Wer den Plan befolgt, soll
   nicht jede Woche hören, er möge die Schlüsseleinheit streichen. Feste Termine
   (Fußball/Spiele) bleiben unangetastet; angepasst wird nur die nächste offene,
   fordernde LAUF-/Krafteinheit.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { isHard, isOpen } from './planflow.js';
import { acwr, formToday, formState, fmtRatio } from './load.js';
import { unitLoad } from './whatif.js';

/** War dieser Tag „hart“ (erledigte fordernde Einheit oder fordernde Session)? */
export function dayIsHard(units = [], sessions = [], date) {
  if ((units || []).some((u) => u.date === date && u.status === 'erledigt' && isHard(u))) return true;
  return (sessions || []).some((s) => s && !s.deleted && s.date === date
    && (Number(s.rpe) >= 7 || ['tempo', 'interval', 'long', 'race', 'match'].includes(s.type)
      || (s.type === 'cross_football' && s.intensity !== 'leicht')));  // Fußball ist fordernd (#5)
}

/** War der Tag laut Plan fordernd (geplante, nicht ausgefallene harte Einheit)? */
function plannedHard(units = [], date) {
  return (units || []).some((u) => u && u.date === date && u.status !== 'verpasst' && isHard(u));
}

/**
 * Harte Tage in Folge, die auf heute ODER gestern enden (ein noch untrainierter
 * „heute“ bricht die Serie nicht ab), gezählt aus dem IST (erledigte Einheiten,
 * erfasste Trainings). `unplanned` = Tage darunter, die der Plan nicht als hart
 * vorsah (zusätzliche harte Session, locker geplante Einheit hart gelaufen).
 * @returns {{days:number, unplanned:number}}
 */
export function hardStreakInfo(units = [], sessions = [], today, max = 14) {
  const start = dayIsHard(units, sessions, today) ? 0
    : (dayIsHard(units, sessions, addDays(today, -1)) ? 1 : null);
  if (start === null) return { days: 0, unplanned: 0 };
  let days = 0, unplanned = 0;
  for (let i = start; i < max; i++) {
    const d = addDays(today, -i);
    if (!dayIsHard(units, sessions, d)) break;
    days++;
    if (!plannedHard(units, d)) unplanned++;
  }
  return { days, unplanned };
}

/** Anzahl harter Tage in Folge (siehe `hardStreakInfo`). */
export function consecutiveHardDays(units = [], sessions = [], today, max = 14) {
  return hardStreakInfo(units, sessions, today, max).days;
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
 * Beschreibung. Behält originalType, damit „Rückgängig“ das Original wiederherstellt.
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

/** Geplante Last (Belastungspunkte) aller Einheiten der letzten 7 Tage – das Soll. */
export function plannedWeekLoad(units = [], today) {
  return (units || []).filter((u) => u && u.date <= today && diffDays(u.date, today) < 7)
    .reduce((s, u) => s + unitLoad(u), 0);
}

/**
 * Schlägt einen Erholungstag vor, wenn die TATSÄCHLICHE Belastung es nahelegt. Zielt
 * auf die nächste OFFENE, fordernde, verschiebbare Einheit in [today, today+horizon]
 * (feste Termine bleiben außen vor). Standard 2 Tage: Liegen bis zur nächsten harten
 * Einheit ohnehin lockere Tage, erholt sich der Körper dort – dann wird kein Long Run
 * vier Tage im Voraus gestrichen. `units` = alle Plan-Einheiten (planübergreifend)
 * für Soll-Last und geplante harte Tage; Standard: die des Plans.
 * @returns {{unit, date, reason, acwr, hardStreak}|null}
 */
export function restDaySuggestion({ plan = {}, sessions = [], today, horizon = 2, units: allUnits = null } = {}) {
  const units = plan.units || [];
  const all = allUnits || units;
  const ac = acwr(sessions, today);
  const fs = formState(formToday(sessions, today), ac.historyDays);
  const streak = hardStreakInfo(all, sessions, today);

  // Nur Abweichungen vom Plan: Die Ist-Last der letzten 7 Tage liegt deutlich über
  // dem Soll (oder es gibt keinen Plan, an dem man sich messen könnte). Wer den
  // Plan befolgt, bekommt die geplante Steigerung nicht als Warnsignal vorgehalten.
  const planned = plannedWeekLoad(all, today);
  const overPlan = planned <= 0 || ac.acuteWeek > planned * 1.15;
  // `sparse` = noch keine 28 Tage Historie: Das Verhältnis ist dann rechnerisch hoch,
  // ohne dass jemand zu schnell gesteigert hätte. Die Form erst mit eingeschwungener
  // Fitnesskurve (`formState.reliable`) – sonst wäre sie monatelang künstlich negativ.
  const acwrHigh = ac.ratio != null && !ac.sparse && ac.ratio > 1.5 && overPlan;
  const elevatedAndTired = ac.ratio != null && !ac.sparse && ac.ratio > 1.3 && fs.reliable && fs.rel < -0.3 && overPlan;
  const streakHigh = streak.days >= 3 && streak.unplanned >= 1;
  if (!(acwrHigh || elevatedAndTired || streakHigh)) return null;

  const cand = units
    .filter((u) => !u.fixed && isOpen(u) && isHard(u)
      && u.date >= today && diffDays(today, u.date) <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!cand) return null;

  let reason;
  if (acwrHigh) reason = `Deine letzten 7 Tage waren deutlich fordernder als geplant und als dein Schnitt der Wochen davor (Verhältnis ${fmtRatio(ac.ratio)}).`;
  else if (streakHigh) reason = `${streak.days} fordernde Tage in Folge, mehr als geplant – ein ruhiger Tag gibt dem Körper Zeit, sich anzupassen.`;
  else reason = `Mehr Last als geplant (Verhältnis ${fmtRatio(ac.ratio)}) und deutlich ermüdet – deine Ermüdung liegt klar über deiner Fitness.`;
  return { unit: cand, date: cand.date, reason, acwr: ac, hardStreak: streak.days };
}

/**
 * Nach einem TATSÄCHLICH fordernden Fußballtag (heute oder gestern gespielt/trainiert,
 * nicht „leicht“) die nächste offene, fordernde LAUF-/Krafteinheit in [today, today+2]
 * als Entlastungs-Kandidat (#5). Geplante, noch nicht absolvierte Termine zählen nicht –
 * die Wochenstruktur berücksichtigt der Plan-Generator schon. Reine Funktion.
 * @returns {{date, unit, when:'heute'|'gestern'}|null}
 */
export function footballFollowupEase({ units = [], sessions = [], today } = {}) {
  const hardFb = (x) => x.type === 'match' || (x.type === 'cross_football' && x.intensity !== 'leicht');
  const hardFootballOn = (d) =>
    (units || []).some((u) => u && u.date === d && u.status === 'erledigt' && hardFb(u))
    || (sessions || []).some((s) => s && !s.deleted && s.date === d && hardFb(s));
  const when = hardFootballOn(today) ? 'heute' : (hardFootballOn(addDays(today, -1)) ? 'gestern' : null);
  if (!when) return null;
  const cand = (units || [])
    .filter((u) => !u.fixed && isOpen(u) && isHard(u)
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
