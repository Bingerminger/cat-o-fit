/* =========================================================================
   planflow.js — adaptive plan adjustments around manual interventions
   (from practical feedback). Pure functions without store/DOM → testable.

   Idea: if you add a session yourself or move one, the weekly load should not
   grow unnoticed. The app then suggests a similar, still open session of the
   same week as a compensation.
   ========================================================================= */

import { weekStartMonday, addDays, diffDays } from './ui.js';

import { t } from './i18n.js';

/** Load class of a session type (for "similar intensity"). */
export function loadClass(type) {
  if (['tempo', 'interval', 'race', 'match', 'camp'].includes(type)) return 'quality';
  if (['easy', 'long', 'run', 'cross', 'cross_bike', 'cross_football'].includes(type)) return 'endurance';
  if (['recovery', 'mobility', 'walk'].includes(type)) return 'recovery';
  if (type === 'strength') return 'strength';
  return 'other';
}

/** Session counts towards the weekly load (not missed, not a rest day).
    Note: since v3.16.0 moved sessions carry the status 'geplant' again
    (origin in `movedFrom`). The legacy status 'verschoben' from earlier versions
    deliberately counts here too – the session does stand in the plan on the new day. */
function countsToLoad(u) {
  return u.type !== 'rest' && u.status !== 'verpasst';
}
/** Still open, changeable session (neither done nor missed).
    Central source for ALL modules (rolling, triage, cycle): this way the
    legacy status 'verschoben' is handled in exactly one place. */
export function isOpen(u) {
  return !!u && u.type !== 'rest'
    && (u.status === 'geplant' || u.status === 'verschoben' || u.status == null);
}

/** Mon–Sun window of a date. */
export function weekRange(dateStr) {
  const ws = weekStartMonday(dateStr);
  return { ws, we: addDays(ws, 6) };
}

/** Sessions of the same calendar week (Mon–Sun) as dateStr that count towards the load. */
export function unitsInWeek(units = [], dateStr) {
  const { ws, we } = weekRange(dateStr);
  return units.filter((u) => u.date >= ws && u.date <= we && countsToLoad(u));
}

/** Open, load-relevant, movable sessions of ONE day (usable across plans):
    candidates for a full-day recovery (#4). Fixed commitments are left out. */
export function dayLoadUnits(units = [], date) {
  return (units || []).filter((u) => u && u.date === date && !u.fixed
    && isOpen(u) && countsToLoad(u));
}

/** Load overview of the week: number of sessions and planned/completed km. */
export function weekLoad(units = [], dateStr) {
  const list = unitsInWeek(units, dateStr);
  const km = list.reduce((a, u) => a + (u.targetDistanceKm || u.distanceKm || 0), 0);
  return { count: list.length, km: Math.round(km) };
}

/**
 * Suggests a similar, still open session of the same week as compensation for
 * a newly added session. null if there is nothing comparable.
 */
export function suggestOffsetUnit(units = [], newUnit) {
  if (!newUnit || !newUnit.date) return null;
  const { ws, we } = weekRange(newUnit.date);
  const cls = loadClass(newUnit.type);
  const candidates = units.filter((u) =>
    u.id !== newUnit.id && u.date >= ws && u.date <= we && isOpen(u) && loadClass(u.type) === cls);
  if (!candidates.length) return null;
  // Prefers a session of another day, chronologically the first.
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates.find((u) => u.date !== newUnit.date) || candidates[0];
}

/**
 * Reassembles a plan week (#10): sessions that are already **done** stay
 * on their days, all others (open/missed/moved/manual) are replaced by the
 * freshly generated ones. Nothing new is added on days with a done session
 * (no duplicates). Pure function over the sessions of **one** week.
 */
export function mergeRegeneratedWeek(existing = [], fresh = []) {
  const kept = existing.filter((u) => u.status === 'erledigt');
  const keptDates = new Set(kept.map((u) => u.date));
  const added = fresh.filter((u) => !keptDates.has(u.date));
  return [...kept, ...added];
}

/**
 * Regenerate from a cut-off date (usually today): everything BEFORE `fromDate` stays
 * exactly as it is – done, missed (with reason), moved, manually
 * created. From the cut-off date on, the weekly rule of `mergeRegeneratedWeek` applies,
 * and sessions already marked as missed stay there too. Previously,
 * regenerating also rebuilt the past: reasons for absence were lost and
 * past days suddenly became overdue.
 */
export function mergeFromDate(existing = [], fresh = [], fromDate) {
  const past = existing.filter((u) => u.date < fromDate);
  const current = existing.filter((u) => u.date >= fromDate);
  const kept = current.filter((u) => u.status === 'erledigt' || u.status === 'verpasst');
  const keptDates = new Set(kept.map((u) => u.date));
  const added = fresh.filter((u) => u.date >= fromDate && !keptDates.has(u.date));
  return [...past, ...kept, ...added].sort((a, b) => a.date.localeCompare(b.date));
}

/** Category for matching a workout ↔ planned session (running, cycling, swimming,
    walking, strength, football …). A bike import never matches a planned run. */
export function matchCategory(type) {
  if (['easy', 'long', 'tempo', 'interval', 'race', 'recovery', 'run'].includes(type)) return 'run';
  if (['cross_bike', 'spinning'].includes(type)) return 'bike';
  if (['walk', 'hike'].includes(type)) return 'walk';
  if (['strength', 'gym'].includes(type)) return 'strength';
  if (['cross_football', 'match'].includes(type)) return 'football';
  return type || 'other';
}

/** Open planned session on day `date` in the same category as `type` – the first
    in plan order that does not yet carry a session. `exclude`: session IDs that are
    already taken. */
export function findPlannedMatch(plans = [], { date, type }, exclude = new Set()) {
  const cat = matchCategory(type);
  for (const p of plans || []) {
    for (const u of (p && p.units) || []) {
      if (!u || u.date !== date || exclude.has(u.id) || u.executedSessionId || !isOpen(u)) continue;
      if (matchCategory(u.type) === cat) return { plan: p, unit: u };
    }
  }
  return null;
}

/** Links past, completed plan sessions with workouts of the same day and
    the same sport (demo data) – fixed commitments too, with the football training of
    the day. Returns new lists, changes nothing. */
export function linkDemoSessions(units = [], sessions = [], today, eventId = null) {
  const us = units.map((u) => ({ ...u }));
  const ss = sessions.map((s) => ({ ...s }));
  for (const s of ss) {
    // `extra`: explicitly trained in addition to the plan – belongs to no session.
    if (s.plannedId || s.extra || s.date >= today) continue;
    const u = us.find((x) => x.date === s.date && x.date < today && !x.executedSessionId
      && matchCategory(x.type) === matchCategory(s.type));
    if (u) { u.executedSessionId = s.id; u.status = 'erledigt'; s.plannedId = u.id; s.eventId = eventId; }
  }
  return { units: us, sessions: ss };
}

/** Sources of automatically imported workouts / workouts imported from files. */
export const IMPORT_SOURCES = ['apple-health', 'health', 'health-connect', 'gpx'];

/**
 * Imported workouts of the last `days` days without a plan link that match an open
 * planned session of the same day – candidates for "Assign?". Each session
 * is suggested at most once; dismissed suggestions (`matchDismissed`) are not shown again.
 * @returns {Array<{session, plan, unit}>}
 */
export function importedMatches(plans = [], sessions = [], today, days = 7) {
  const used = new Set();
  const out = [];
  (sessions || [])
    .filter((s) => s && !s.deleted && !s.plannedId && !s.matchDismissed && IMPORT_SOURCES.includes(s.source)
      && s.date <= today && diffDays(s.date, today) <= days)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((s) => {
      const m = findPlannedMatch(plans, s, used);
      if (m) { used.add(m.unit.id); out.push({ session: s, ...m }); }
    });
  return out;
}

/** Without asking: walking and mobility are easy anyway, football has its intensity. */
const NO_RPE_ASK = new Set(['walk', 'mobility', 'cross_football']);
/**
 * Imported workouts of the last `days` days without a recorded effort – for the prompt
 * "How hard was it?" on "Today". Without an answer the load estimates it from the
 * heart rate; an entry by the person is still more accurate.
 */
export function rpeAskList(sessions = [], today, days = 3) {
  return (sessions || [])
    .filter((s) => s && !s.deleted && IMPORT_SOURCES.includes(s.source) && !(Number(s.rpe) > 0) && !s.rpeDismissed
      && !NO_RPE_ASK.has(s.type) && s.date && s.date <= today && diffDays(s.date, today) < days)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Zone key of a session: stored (`paceKey`) or – for sessions from
    older versions – derived from the type. */
export function paceKeyOf(unit) {
  if (!unit) return null;
  if (unit.paceKey) return unit.paceKey;
  return ({ race: 'race', tempo: 'threshold', interval: 'vo2', easy: 'easy', long: 'long', recovery: 'recovery' })[unit.type] || null;
}

/**
 * Carries the target paces of open, future run sessions over to new training zones
 * – via the zone key, not via the HR zone. Race sessions (`race`)
 * only get a new pace if `race` is passed (without a target time the race pace
 * follows the current form, with a target time it stays the target). Pure function.
 * @returns {{units:object[], changed:boolean}}
 */
export function repaceUnits(units = [], zones = {}, { today, race = null } = {}) {
  let changed = false;
  const out = units.map((u) => {
    if (!u || u.date < today || u.status === 'erledigt' || u.fixed) return u;
    const key = paceKeyOf(u);
    if (!key) return u;
    const z = key === 'race' ? race : zones[key];
    if (!z) return u;
    changed = true;
    return { ...u, targetPaceSecPerKm: z.min, targetPaceMaxSecPerKm: z.max, targetHrZone: z.hrZone ?? u.targetHrZone ?? null, paceKey: key };
  });
  return { units: out, changed };
}

/** Demanding session (eats into recovery): quality, strength, long run – and
    football (sprints/match intensity), unless the appointment is explicitly "light" (#5). */
export function isHard(unit) {
  if (unit.type === 'cross_football') return unit.intensity !== 'leicht';
  const c = loadClass(unit.type);
  return c === 'quality' || c === 'strength' || unit.type === 'long';
}

/**
 * Suggests making today easier when readiness is low and
 * a demanding session is due. `readiness` = { score } from adaptive.js.
 * @returns {{unit:object, score:number}|null}
 */
export function softenSuggestion(todaysUnits = [], readiness) {
  if (!readiness || typeof readiness.score !== 'number' || readiness.score >= 55) return null;
  // Do not suggest fixed commitments (football/matches) for "Make today easier" – they are fixed.
  const hard = todaysUnits.find((u) => isHard(u) && !u.fixed && isOpen(u));
  return hard ? { unit: hard, score: readiness.score } : null;
}

/** Open, load-relevant sessions of the next `horizon` days – candidates for a
    deload or an increase. Fixed commitments (club training, matches) are taboo for all
    automations: previously football became "Easy (deload)". */
export function weekDeloadCandidates(units = [], today, horizon = 7) {
  const end = addDays(today, horizon);
  return units.filter((u) => isOpen(u) && !u.fixed && countsToLoad(u) && u.date >= today && u.date <= end);
}

/** Absence due to illness or injury – never make up, never compensate. */
function healthMiss(u) {
  return !!u && u.status === 'verpasst' && (u.missedReason === 'sick' || u.missedReason === 'injured');
}

/** Progression variant: volume up ~12 % (type stays) – if there are still reserves. */
export function progressVariant(unit) {
  const km = unit.targetDistanceKm ? Math.round(unit.targetDistanceKm * 1.12 * 2) / 2 : null;
  const min = !km && unit.targetDurationMin ? Math.round(unit.targetDurationMin * 1.1) : null;
  return { targetDistanceKm: km, targetDurationMin: min, boosted: true };
}

/** Deload variant of a session: volume down ~25 %, intensity stays.
    Quality sessions lose a third of their repetitions instead of being
    turned into an easy run – deload means less volume, not
    "no stimulus" (Bosquet et al. 2007). The type of the session never changes. */
export function deloadVariant(unit) {
  const km = unit.targetDistanceKm ? Math.max(3, Math.round(unit.targetDistanceKm * 0.75 * 2) / 2) : null;
  const min = unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.75) : null;
  const patch = { targetDistanceKm: km, targetDurationMin: km ? null : min, deloaded: true };
  const iv = unit.intervals;
  if (iv && Array.isArray(iv.segments) && iv.segments.length > 2) {
    patch.intervals = { ...iv, segments: iv.segments.slice(0, Math.max(2, Math.round(iv.segments.length * 2 / 3))) };
  } else if (iv && iv.rounds > 2) {
    patch.intervals = { ...iv, rounds: Math.max(2, Math.round(iv.rounds * 2 / 3)) };
  }
  if (patch.intervals) patch.title = t('planflow.shortened', { title: unit.title });
  return patch;
}

/** Missed key sessions (demanding) of the last `days` days, most recent first (#replanning).
    Absences due to illness or injury do not count: afterwards the rule is to ease
    back in gently, not to make up the hard session within days. Fixed commitments
    do not count either – a missed club training cannot be moved. */
export function missedKeyUnits(plans = [], today, days = 10) {
  const out = [];
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.status !== 'verpasst' || !isHard(u) || u.fixed || healthMiss(u)) return;
    const d = diffDays(u.date, today);
    if (d >= 0 && d <= days) out.push(u);
  }));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Finds a suitable make-up day in [today+1, today+horizon]: a day without a
 * load-relevant session and without a demanding session on the previous/next day (recovery).
 * @returns {string|null} Date or null.
 */
export function findMakeupDay(units = [], missedUnit, today, horizon = 7) {
  const others = units.filter((u) => u.id !== (missedUnit && missedUnit.id));
  for (let i = 1; i <= horizon; i++) {
    const date = addDays(today, i);
    if (others.some((u) => u.date === date && countsToLoad(u))) continue; // day taken
    const prev = addDays(date, -1), next = addDays(date, 1);
    if (others.some((u) => isHard(u) && (u.date === prev || u.date === next))) continue; // if (others.some((u) => isHard(u) && (u.date === prev || u.date === next))) continue; // hard neighbour
    return date;
  }
  return null;
}

/** Turns a session into an easy variant (patch fields), keeps the original. */
export function easierVariant(unit, easyPace) {
  const km = unit.targetDistanceKm ? Math.max(4, Math.round(unit.targetDistanceKm * 0.6)) : null;
  return {
    type: 'easy',
    title: t('planflow.easierTitle'),
    targetDistanceKm: km,
    targetDurationMin: km ? null : (unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.7) : null),
    targetPaceSecPerKm: easyPace?.min ?? null,
    targetPaceMaxSecPerKm: easyPace?.max ?? null,
    targetHrZone: easyPace?.hrZone ?? 2,
    intervals: null,
    description: t('planflow.easierDescription'),
    softened: true,
    originalType: unit.originalType || unit.type,
  };
}

/**
 * Checks moving a session to newDate (#3): is there already a session
 * there, and does a hard session follow without a recovery day? Pure facts – the
 * UI formulates the hints from them.
 * @returns {{sameDay: object|null, hardNeighbor: {unit:object, dir:'prev'|'next'}|null}}
 */
export function rescheduleCheck(units = [], unitId, newDate) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return { sameDay: null, hardNeighbor: null };
  const others = units.filter((u) => u.id !== unitId && countsToLoad(u));
  const sameDay = others.find((u) => u.date === newDate) || null;
  let hardNeighbor = null;
  if (isHard(unit)) {
    const prev = addDays(newDate, -1), next = addDays(newDate, 1);
    const n = others.find((u) => isHard(u) && (u.date === prev || u.date === next));
    if (n) hardNeighbor = { unit: n, dir: n.date < newDate ? 'prev' : 'next' };
  }
  return { sameDay, hardNeighbor };
}

/**
 * Automatic weekly volume compensation: compares planned vs. completed run km
 * of the week. If something was left over, it suggests putting A PART of it,
 * carefully (capped), on the next open EASY session – never everything
 * at once, never on a hard session. Returns null if there is nothing to do.
 */
export function weekVolumeBalance(units = [], today) {
  const km = (u) => Number(u.targetDistanceKm) || 0;
  const { ws, we } = weekRange(today);
  const run = units.filter((u) => u && !u.deleted && u.date >= ws && u.date <= we && km(u) > 0 && u.type !== 'rest');
  if (run.length < 2) return null;
  const planned = run.reduce((s, u) => s + km(u), 0);
  const done = run.filter((u) => u.status === 'erledigt').reduce((s, u) => s + km(u), 0);
  // Absences due to illness/injury are never "compensated" (no extra volume afterwards).
  const missedKm = run.filter((u) => u.status !== 'erledigt' && u.date < today && !healthMiss(u)).reduce((s, u) => s + km(u), 0);
  const openEasy = run
    .filter((u) => isOpen(u) && u.date >= today && (u.type === 'easy' || u.type === 'recovery'))
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  let suggestion = null;
  if (missedKm >= 2 && openEasy) {
    const addKm = Math.min(Math.round(missedKm * 0.5), Math.max(2, Math.round(km(openEasy) * 0.4)));
    if (addKm >= 1) suggestion = { kind: 'add', unit: openEasy, addKm, newKm: km(openEasy) + addKm };
  }
  return {
    planned: Math.round(planned), done: Math.round(done), missedKm: Math.round(missedKm),
    pctDone: planned ? done / planned : 0, suggestion,
  };
}

/** The ONE window for the effort (RPE) – previously there were two (14 and 21 days)
    with different thresholds, and "Today" showed contradictory cards. */
export const RPE_WINDOW_DAYS = 21;

/**
 * Effort trend of the last sessions (recorded RPE): consistently easy →
 * `progress`, consistently very demanding → `ease`, otherwise `hold`. Only a signal for the
 * central coach decision (`coach.js`) – no verdict on the load, which
 * comes solely from `load.js`. null with too little data (< 4 rated sessions).
 */
export function rpeProgression(sessions = [], today, days = RPE_WINDOW_DAYS) {
  const since = addDays(today, -days);
  const rated = (sessions || []).filter((s) => s && !s.deleted && Number(s.rpe) > 0 && s.date >= since && s.date <= today);
  if (rated.length < 4) return null;
  const avg = rated.reduce((a, s) => a + Math.min(10, Number(s.rpe)), 0) / rated.length;
  const trend = avg <= 4.5 ? 'progress' : avg >= 7.5 ? 'ease' : 'hold';
  return { trend, avgRpe: Math.round(avg * 10) / 10, count: rated.length, days };
}

/* ------------------------ Week assignment in the plan ------------------------ */
/* (moved here from plans.js: badges.js needed it and thereby pulled plans → session → health
   → badges into an import cycle, FE-18) */
export function clampWeek(plan, dateStr) {
  if (dateStr < plan.startDate) return 1;
  if (dateStr > plan.endDate) return plan.weeks;
  return Math.min(plan.weeks, Math.floor(diffDays(plan.startDate, dateStr) / 7) + 1);
}

/** Robust, public week assignment of a date in the plan (1..plan.weeks).
 *  Central source so that views derive the week from the AUTHORITATIVE date
 *  instead of relying on a stored `week` field (manually created or
 *  imported sessions often have none). Returns null for an incomplete plan. */
export function weekOfDate(plan, dateStr) {
  if (!plan || !plan.startDate || !plan.endDate || !plan.weeks || !dateStr) return null;
  return clampWeek(plan, dateStr);
}
