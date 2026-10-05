/* =========================================================================
   coach.js — ONE daily recommendation for "Today". Pure, DOM-free logic.

   Previously seven places decided independently which card "Today"
   shows – with two RPE windows, their own thresholds and no knowledge of each other.
   Result: "load high" next to "ready for more", "recovery day" next to "a
   demanding session is fine today". `coachDecision` collects all
   candidates and picks EXACTLY ONE recommendation by fixed priority:

     1. Warning signals – careful return after illness/injury →
        recovery day (more load than planned) → readiness low today →
        easier after football → effort very high for weeks (deload)
     2. Plan upkeep – unstack two sessions on one day → make up a key session
        → compensate weekly volume (both never after illness/injury)
     3. Progression – increase the coming week: only without a warning signal, with a reliable
        data basis, load in the usual range and not during a return.

   Everything else that would also have fitted is listed as "deferred" in the reasoning.
   No recommendation touches fixed commitments; protected cycle days are left alone too.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { acwr, formToday, formState } from './load.js';
import {
  isOpen, isHard, missedKeyUnits, findMakeupDay, weekVolumeBalance, weekDeloadCandidates,
  softenSuggestion, rpeProgression,
} from './planflow.js';
import { restDaySuggestion, footballFollowupEase, dayIsHard } from './rolling.js';
import { destackSuggestion } from './triage.js';

import { t, tp } from './i18n.js';

/** For this long after an absence due to illness/injury there is no progression. */
export const RETURN_DAYS = 14;
/** For this long the return hint is shown (as long as there has been no hard training yet). */
export const RETURN_HINT_DAYS = 10;

/** Short labels – for "deferred: …" in the reasoning. */
export const COACH_LABELS = {
  get return() { return t('coach.labels.return'); },
  get rest() { return t('coach.labels.rest'); },
  get soften() { return t('coach.labels.soften'); },
  get football() { return t('coach.labels.football'); },
  get deload() { return t('coach.labels.deload'); },
  get destack() { return t('coach.labels.destack'); },
  get makeup() { return t('coach.labels.makeup'); },
  get volume() { return t('coach.labels.volume'); },
  get boost() { return t('coach.labels.boost'); },
};
/** Recommendations that are a warning signal – as long as one of them applies, no progression. */
export const WARNING_KINDS = new Set(['return', 'rest', 'soften', 'football', 'deload']);

/**
 * Most recent absence due to illness or injury within the last `days` days.
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
 * The one daily recommendation. `readiness` = result of `adaptive.readinessScore`
 * (or null). Sessions must carry `planId` if the UI is to change them.
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

  // 1) Warning signals
  if (ret && ret.daysAgo <= RETURN_HINT_DAYS) {
    // Trained hard again (after the absence)? Then the hint is done –
    // the progression block still applies until RETURN_DAYS.
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

  // 2) Plan upkeep
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

  // 3) Progression – only if nothing speaks against it
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

/** Reasoning "why this card, why no other" – one sentence for the UI. */
export function coachWhy(decision) {
  if (!decision || !decision.primary) return '';
  const p = decision.primary;
  const rank = WARNING_KINDS.has(p.kind) ? t('coach.why.warning')
    : p.kind === 'boost' ? t('coach.why.boost')
      : t('coach.why.plan');
  const rest = decision.suppressed.length
    ? ` ${t('coach.why.suppressed', { labels: decision.suppressed.map((s) => s.label).join(', ') })}`
    : '';
  const lock = decision.ret && p.kind !== 'return' && !WARNING_KINDS.has(p.kind)
    ? ` ${tp('coach.why.returnLock', RETURN_DAYS)}`
    : '';
  return `${rank}${rest}${lock}`;
}
