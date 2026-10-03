/* =========================================================================
   coach.js — EINE Tagesempfehlung für „Heute“. Reine, DOM-freie Logik.

   Früher entschieden sieben Stellen unabhängig voneinander, welche Karte „Heute“
   zeigt – mit zwei RPE-Fenstern, eigenen Schwellen und ohne Kenntnis voneinander.
   Ergebnis: „Belastung hoch“ neben „Bereit für mehr“, „Erholungstag“ neben „ein
   anspruchsvolles Training ist heute gut drin". `coachDecision` sammelt alle
   Kandidaten und wählt nach fester Priorität GENAU EINE Empfehlung:

     1. Warnsignale – behutsamer Wiedereinstieg nach Krankheit/Verletzung →
        Erholungstag (mehr Last als geplant) → Bereitschaft heute niedrig →
        nach Fußball lockerer → Anstrengung seit Wochen sehr hoch (Entlastung)
     2. Plan-Pflege – zwei Einheiten an einem Tag entzerren → Schlüsseleinheit
        nachholen → Wochenumfang ausgleichen (beides nie nach Krankheit/Verletzung)
     3. Progression – kommende Woche steigern: nur ohne Warnsignal, mit belastbarer
        Datenbasis, Last im üblichen Rahmen und nicht im Wiedereinstieg.

   Alles, was sonst noch gepasst hätte, steht als „zurückgestellt“ in der Begründung.
   Feste Termine fasst keine Empfehlung an; geschützte Zyklustage auch nicht.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { acwr, formToday, formState } from './load.js';
import {
  isOpen, isHard, missedKeyUnits, findMakeupDay, weekVolumeBalance, weekDeloadCandidates,
  softenSuggestion, rpeProgression,
} from './planflow.js';
import { restDaySuggestion, footballFollowupEase, dayIsHard } from './rolling.js';
import { destackSuggestion } from './triage.js';

/** So lange nach einem Ausfall wegen Krankheit/Verletzung gibt es keine Steigerung. */
export const RETURN_DAYS = 14;
/** So lange steht der Wiedereinstiegs-Hinweis (solange noch kein hartes Training war). */
export const RETURN_HINT_DAYS = 10;

/** Kurzbezeichnungen – für „zurückgestellt: …“ in der Begründung. */
export const COACH_LABELS = {
  return: 'behutsamer Wiedereinstieg', rest: 'Erholungstag', soften: 'heute lockerer',
  football: 'nach Fußball lockerer', deload: 'Entlastungswoche', destack: 'Tag entzerren',
  makeup: 'Schlüsseleinheit nachholen', volume: 'Wochenumfang ausgleichen', boost: 'kommende Woche steigern',
};
/** Empfehlungen, die ein Warnsignal sind – solange eine davon gilt, keine Steigerung. */
export const WARNING_KINDS = new Set(['return', 'rest', 'soften', 'football', 'deload']);

/**
 * Jüngster Ausfall wegen Krankheit oder Verletzung der letzten `days` Tage.
 * @returns {{date:string, reason:'sick'|'injured', daysAgo:number}|null}
 */
export function returnPhase(plans = [], today, days = RETURN_DAYS) {
  let last = null;
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => {
    if (!u || u.status !== 'verpasst' || (u.missedReason !== 'sick' && u.missedReason !== 'injured')) return;
    if (u.date > today || diffDays(u.date, today) > days) return;
    if (!last || u.date > last.date) last = u;
  }));
  return last ? { date: last.date, reason: last.missedReason, daysAgo: diffDays(last.date, today) } : null;
}

/**
 * Die eine Tagesempfehlung. `readiness` = Ergebnis von `adaptive.readinessScore`
 * (oder null). Einheiten müssen `planId` tragen, wenn die UI sie ändern soll.
 * @returns {{primary: object|null, suppressed: Array<{kind:string,label:string}>, warning: boolean,
 *   ret: object|null, rpe: object|null, load: object}}
 */
export function coachDecision({ plans = [], sessions = [], today, isProtectedDay = () => false, readiness = null } = {}) {
  const livePlans = (plans || []).filter((p) => p && !p.deleted);
  const units = livePlans.flatMap((p) => p.units || []);
  const ok = (date) => !isProtectedDay(date);
  const cands = [];
  const ret = returnPhase(livePlans, today);
  const ac = acwr(sessions, today);
  const fs = formState(formToday(sessions, today), ac.historyDays);
  const prog = rpeProgression(sessions, today);

  // 1) Warnsignale
  if (ret && ret.daysAgo <= RETURN_HINT_DAYS) {
    // Schon wieder hart trainiert (nach dem Ausfall)? Dann ist der Hinweis erledigt –
    // die Steigerungssperre gilt trotzdem bis RETURN_DAYS.
    let backToHard = false;
    for (let d = addDays(ret.date, 1); d <= today; d = addDays(d, 1)) if (dayIsHard(units, sessions, d)) { backToHard = true; break; }
    if (!backToHard) {
      const unit = units.filter((u) => !u.fixed && isOpen(u) && isHard(u) && u.date >= today && diffDays(today, u.date) <= 3 && ok(u.date))
        .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
      cands.push({ kind: 'return', ret, unit });
    }
  }
  for (const plan of livePlans) {
    if (plan.kind === 'program') continue;
    const rd = restDaySuggestion({ plan, sessions, today, units });
    if (rd && ok(rd.date)) { cands.push({ kind: 'rest', rd }); break; }
  }
  const todays = units.filter((u) => u.date === today);
  const soft = softenSuggestion(todays, readiness);
  if (soft && ok(soft.unit.date)) cands.push({ kind: 'soften', soft });
  const fb = footballFollowupEase({ units, sessions, today });
  if (fb && ok(fb.date)) cands.push({ kind: 'football', fb });
  const next = weekDeloadCandidates(units, today).filter((u) => ok(u.date));
  if (prog && prog.trend === 'ease' && next.length >= 2) cands.push({ kind: 'deload', units: next, prog });

  // 2) Plan-Pflege
  const ds = destackSuggestion(units, today);
  if (ds && ok(ds.date)) cands.push({ kind: 'destack', ds });
  if (!ret) {
    const mk = missedKeyUnits(livePlans, today)[0];
    if (mk && ok(mk.date)) {
      const day = findMakeupDay(units, mk, today);
      if (day) cands.push({ kind: 'makeup', unit: mk, day });
    }
    const bal = weekVolumeBalance(units, today);
    if (bal && bal.suggestion && bal.suggestion.kind === 'add' && ok(bal.suggestion.unit.date)) cands.push({ kind: 'volume', bal });
  }

  // 3) Progression – nur, wenn nichts dagegen spricht
  const warning = cands.some((c) => WARNING_KINDS.has(c.kind));
  if (prog && prog.trend === 'progress' && !warning && !ret && next.length >= 2
    && ac.ratio != null && !ac.sparse && ac.ratio <= 1.3 && fs.key !== 'ermuedet'
    && !(readiness && readiness.score < 55)) {
    cands.push({ kind: 'boost', units: next, prog });
  }

  const primary = cands[0] || null;
  return {
    primary,
    suppressed: cands.slice(1).map((c) => ({ kind: c.kind, label: COACH_LABELS[c.kind] })),
    warning: !!primary && WARNING_KINDS.has(primary.kind),
    ret, rpe: prog, load: ac,
  };
}

/** Begründung „warum diese Karte, warum keine andere“ – ein Satz für die UI. */
export function coachWhy(decision) {
  if (!decision || !decision.primary) return '';
  const p = decision.primary;
  const rank = WARNING_KINDS.has(p.kind) ? 'Warnsignale haben Vorrang vor Plan-Pflege und Steigerung.'
    : p.kind === 'boost' ? 'Keine Warnsignale, Last im üblichen Rahmen.'
      : 'Keine Warnsignale – jetzt geht es um deinen Plan.';
  const rest = decision.suppressed.length
    ? ` Zurückgestellt: ${decision.suppressed.map((s) => s.label).join(', ')}.`
    : '';
  const lock = decision.ret && p.kind !== 'return' && !WARNING_KINDS.has(p.kind)
    ? ` Steigerungen pausieren bis ${RETURN_DAYS} Tage nach dem Ausfall.`
    : '';
  return `${rank}${rest}${lock}`;
}
