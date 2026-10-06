/* =========================================================================
   whatif.js — "What happens if I change this?". Pure, DOM-free logic.

   Guiding principle: "When the athlete changes something in their plan or sessions, they
   should know before the change what effects it is supposed to have." This module
   simulates adding/moving a session and returns before/after
   of the affected week (planned load, hard sessions, hard consecutive days)
   plus a classification. The UI shows this as a preview before it is confirmed.

   What is classified is the CHANGE, not the state of the week: a week with
   two football dates, tempo and long run already has four hard sessions – earlier
   every trifle there (15 min mobility) reported "clearly more demanding".
   ========================================================================= */

import { weekStart, addDays } from './ui.js';
import { sessionRpe, loadMinutes } from './load.js';
import { isHard } from './planflow.js';

import { t } from './i18n.js';

/** Estimated load points of a planned session – by the same rules as
    the recorded load (`load.js`): football by intensity, distance by sport. */
export function unitLoad(u) {
  if (!u || u.type === 'rest') return 0;
  // `dur`: programme sessions from earlier versions (read fallback).
  const planned = Number(u.targetDurationMin) || Number(u.dur) || 0;
  const min = planned > 0 ? planned
    : (Number(u.targetDistanceKm) > 0 ? loadMinutes({ type: u.type, distanceKm: Number(u.targetDistanceKm) }).min : 40);
  return Math.round(min * sessionRpe({ type: u.type, intensity: u.intensity }));
}

/** Load-relevant sessions (not missed, not a rest day) in the date window. */
function relevant(units, from, to) {
  // Moved sessions count too – they load the target week (since v3.16.0).
  return (units || []).filter((u) => u && !u.deleted && u.date >= from && u.date <= to
    && u.type !== 'rest' && u.status !== 'verpasst');
}

/** Pairs of hard days directly after each other that touch the week – including
    the day before and the day after (game on Sunday → training on Monday). */
function hardPairs(units, ws, we) {
  const hardDays = new Set(relevant(units, addDays(ws, -1), addDays(we, 1)).filter(isHard).map((u) => u.date));
  let n = 0;
  for (let d = addDays(ws, -1); d < addDays(we, 1); d = addDays(d, 1)) {
    if (hardDays.has(d) && hardDays.has(addDays(d, 1))) n++;
  }
  return n;
}

/** Planned figures of the week of dateStr: load, hard sessions,
    count, hard consecutive days (across the week boundary). The person's week (units().weekStart),
    like planflow.weekRange – the preview says "this week" in the same sheet as the load offset. */
export function weekPlan(units = [], dateStr) {
  const ws = weekStart(dateStr), we = addDays(ws, 6);
  const list = relevant(units, ws, we);
  return {
    load: list.reduce((s, u) => s + unitLoad(u), 0),
    hard: list.filter(isHard).length,
    count: list.length,
    b2b: hardPairs(units, ws, we),
  };
}

/**
 * Classification from the change: relative load change, additional hard session,
 * new hard consecutive day. "hoch" = clearly more load (> 25 %) or a new hard
 * consecutive day; "erhöht" = noticeably more (> 8 %) or one more hard session.
 */
function classify(before, after) {
  const rel = before.load > 0 ? (after.load - before.load) / before.load : (after.load > 0 ? 1 : 0);
  if (rel > 0.25 || (after.b2b || 0) > (before.b2b || 0)) return 'hoch';
  if (rel > 0.08 || after.hard > before.hard) return 'erhöht';
  return 'ok';
}

/** Simulates ADDING a session → before/after of the affected week. */
export function simulateAdd(units = [], newUnit) {
  if (!newUnit || !newUnit.date) return null;
  const before = weekPlan(units, newUnit.date);
  const after = weekPlan([...(units || []), newUnit], newUnit.date);
  return { date: newUnit.date, before, after, deltaLoad: after.load - before.load, level: classify(before, after) };
}

/** Simulates MOVING a session → effect on the old AND new week. */
export function simulateMove(units = [], unitId, newDate) {
  const u = (units || []).find((x) => x.id === unitId);
  if (!u || !newDate) return null;
  const moved = units.map((x) => (x.id === unitId ? { ...x, date: newDate } : x));
  const sameWeek = weekStart(u.date) === weekStart(newDate);
  const target = { date: newDate, before: weekPlan(units, newDate), after: weekPlan(moved, newDate) };
  target.deltaLoad = target.after.load - target.before.load;
  target.level = classify(target.before, target.after);
  if (sameWeek) return { target, source: null };
  const source = { date: u.date, before: weekPlan(units, u.date), after: weekPlan(moved, u.date) };
  source.deltaLoad = source.after.load - source.before.load;
  source.level = classify(source.after, source.before); // source gets lighter → informational
  return { target, source };
}

/** Short plain-language sentence on the effect (for the preview). */
export function impactText(sim) {
  if (!sim) return '';
  const b = sim.before, a = sim.after;
  const pct = b.load > 0 ? Math.round(((a.load - b.load) / b.load) * 100) : null;
  const loadTxt = pct != null && pct !== 0
    ? t('whatif.loadChangePct', { before: b.load, after: a.load, pct: `${pct > 0 ? '+' : ''}${pct}` })
    : t('whatif.loadChange', { before: b.load, after: a.load });
  const hardTxt = a.hard !== b.hard ? ` ${t('whatif.hardChange', { before: b.hard, after: a.hard })}` : '';
  const b2bTxt = (a.b2b || 0) > (b.b2b || 0) ? ` ${t('whatif.b2b')}` : '';
  if (sim.level === 'hoch' && a.load <= b.load) {
    // Same load, but a new hard consecutive day (typical: moving within the same week).
    return t('whatif.sameLoadB2b', { load: b.load });
  }
  if (sim.level === 'hoch') return `${t('whatif.muchHarder', { load: loadTxt })}${hardTxt}${b2bTxt} ${t('whatif.mindRecovery')}`;
  if (sim.level === 'erhöht') return `${t('whatif.bitHarder', { load: loadTxt })}${hardTxt}`;
  return t('whatif.littleEffect', { load: loadTxt });
}
