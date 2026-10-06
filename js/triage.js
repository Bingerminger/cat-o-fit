/* =========================================================================
   triage.js — detect weekly collisions and prioritise them TRANSPARENTLY.
   Pure, DOM-free logic → covered by node:test.

   Guiding principle: "If the goals need prioritising, it must always be shown
   transparently how you triage between collisions." This module supplies
   the facts (hard back-to-backs, too many hard sessions, no rest day,
   doubly booked days) plus a traceable priority order – the UI
   formulates the hints from them.

   Priority order (fixed > safety/recovery is implicit; here: what keeps
   precedence in a collision): fixed commitments > key run sessions for the
   time goal > strength > easy volume > recovery. Recovery is deliberately NOT
   at the very top – it is the buffer that shrinks first in a collision; safety
   comes from spreading out the hard stimuli (see rolling.js).
   ========================================================================= */

import { blockStart, addDays, isoDow, localizeUnits as lu } from './ui.js';
import { loadClass, isHard, findMakeupDay, isOpen } from './planflow.js';
import { weekdayNames } from './format.js';

import { t } from './i18n.js';

/** Short weekday name; isoDow counts Mon = 1 … Sun = 7, weekdayNames() starts on Sunday. */
export function dowShort(dateStr) { return weekdayNames()[isoDow(dateStr) % 7] || ''; }

/** Load-relevant, non-missed sessions of the week of dateStr.
    Moved sessions count TOO: they stand in the plan on the new day and can
    very well collide there (since v3.16.0, see planflow.js countsToLoad).
    `planStart`: the week is the PLAN week (7 days from plan.startDate) – the generator guarantees a
    rest day and at most three hard sessions per plan week, so the check must use the same window,
    also for an older plan that began on a Monday while the person now starts weeks on Sunday.
    Without it: the person's week. */
export function weekUnits(units = [], dateStr, planStart = null) {
  const ws = blockStart(dateStr, planStart), we = addDays(ws, 6);
  return (units || []).filter((u) => u && !u.deleted && u.date >= ws && u.date <= we
    && u.type !== 'rest' && u.status !== 'verpasst');
}

/** Priority class of a session (higher = keeps precedence in a collision). */
export const PRIORITY_RANK = { fixed: 5, key: 4, strength: 3, endurance: 2, recovery: 1, other: 0 };
export function unitPriority(u) {
  if (u && u.fixed) return 'fixed';
  const c = loadClass(u ? u.type : 'other');
  if (c === 'quality' || (u && (u.type === 'long' || u.type === 'race'))) return 'key';
  if (c === 'strength') return 'strength';
  if (c === 'endurance') return 'endurance';
  if (c === 'recovery') return 'recovery';
  return 'other';
}

/**
 * Detects collisions/risks of a week. Every collision carries a suggestion
 * that touches the lower-priority session (key sessions/fixed commitments stay).
 * @returns {Array<{kind, severity, text, suggest, date?}>}
 */
export function weekCollisions(units = [], dateStr, planStart = null) {
  const list = weekUnits(units, dateStr, planStart).slice().sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  const ws = blockStart(dateStr, planStart), we = addDays(ws, 6);
  const inWeek = (d) => d >= ws && d <= we;

  // 1) Hard sessions on consecutive days (recovery missing between the stimuli) –
  //    including the day before and the day after the week: a match on Sunday → training on Monday
  //    is the most common collision with club football and used to lie "between" two weeks.
  const ext = (units || []).filter((u) => u && !u.deleted && u.date >= addDays(ws, -1) && u.date <= addDays(we, 1)
    && u.type !== 'rest' && u.status !== 'verpasst').sort((a, b) => a.date.localeCompare(b.date));
  const dayLabel = (d) => (d < ws ? t('triage.dayPrevWeek', { day: dowShort(d) })
    : d > we ? t('triage.dayNextWeek', { day: dowShort(d) }) : dowShort(d));
  for (let i = 0; i < ext.length; i++) {
    for (let j = i + 1; j < ext.length; j++) {
      if (ext[j].date === addDays(ext[i].date, 1) && isHard(ext[i]) && isHard(ext[j]) && (inWeek(ext[i].date) || inWeek(ext[j].date))) {
        const lower = PRIORITY_RANK[unitPriority(ext[i])] <= PRIORITY_RANK[unitPriority(ext[j])] ? ext[i] : ext[j];
        out.push({
          kind: 'hard-b2b', severity: 'warn', date: ext[j].date,
          text: t('triage.hardB2b', { first: lu(ext[i].title), firstDay: dayLabel(ext[i].date), second: lu(ext[j].title), secondDay: dayLabel(ext[j].date) }),
          suggest: ext[i].fixed && ext[j].fixed
            ? t('triage.bothFixed')
            : lower.fixed
              ? t('triage.lowerFixed', { title: lu(lower.title) })
              : t('triage.moveLower', { title: lu(lower.title) }),
        });
      }
    }
  }

  // 2) Too many hard sessions in the week
  const hard = list.filter(isHard);
  if (hard.length > 3) {
    const softest = hard.filter((u) => !u.fixed).sort((a, b) => PRIORITY_RANK[unitPriority(a)] - PRIORITY_RANK[unitPriority(b)])[0];
    out.push({
      kind: 'too-many-hard', severity: 'warn',
      text: t('triage.tooManyHard', { count: hard.length }),
      suggest: softest ? t('triage.softenLeast', { title: lu(softest.title) })
        : t('triage.allHardFixed'),
    });
  }

  // 3) No rest day (every weekday occupied)
  const days = new Set(list.map((u) => u.date));
  if (days.size >= 7) {
    out.push({
      kind: 'no-rest', severity: 'warn',
      text: t('triage.noRest'),
      suggest: t('triage.noRestSuggest'),
    });
  }

  // 4) Two hard sessions on the same day
  const byDate = new Map();
  list.forEach((u) => { if (!byDate.has(u.date)) byDate.set(u.date, []); byDate.get(u.date).push(u); });
  byDate.forEach((us, date) => {
    if (us.filter(isHard).length >= 2) {
      out.push({
        kind: 'double-hard', severity: 'warn', date,
        text: t('triage.doubleHard', { day: dowShort(date) }),
        suggest: t('triage.doubleHardSuggest'),
      });
    }
  });

  return out;
}

/**
 * Compact weekly triage: collisions + sessions ordered by priority
 * (transparent, how the app weighs things in a conflict).
 */
export function weekTriage(units = [], dateStr, planStart = null) {
  const list = weekUnits(units, dateStr, planStart);
  const collisions = weekCollisions(units, dateStr, planStart);
  const ranked = list.slice().sort((a, b) =>
    PRIORITY_RANK[unitPriority(b)] - PRIORITY_RANK[unitPriority(a)] || a.date.localeCompare(b.date));
  return { collisions, ranked, ok: collisions.length === 0, hardCount: list.filter(isHard).length };
}

/**
 * "Unstacking" with two goals (#4): looks for the next day in [today, today+horizon]
 * with ≥2 open, load-relevant sessions (typically: two goals overlap) and
 * suggests moving the lowest-priority, movable one of them to a free
 * day – this creates real recovery instead of two half sessions on the same day.
 * Pure function. @returns {{date, move, keep, target}|null}
 */
export function destackSuggestion(units = [], today, horizon = 10) {
  const open = (u) => u && u.date >= today && isOpen(u);
  const byDate = new Map();
  (units || []).forEach((u) => {
    if (!open(u) || addDays(today, horizon) < u.date) return;
    if (!byDate.has(u.date)) byDate.set(u.date, []);
    byDate.get(u.date).push(u);
  });
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date);
    if (day.length < 2) continue;
    if (!day.some(isHard)) continue;  // only unstack genuine load stacks, not two easy sessions
    // The lowest-priority, NOT fixed session is the candidate to move.
    const movable = day.filter((u) => !u.fixed)
      .sort((a, b) => PRIORITY_RANK[unitPriority(a)] - PRIORITY_RANK[unitPriority(b)]);
    if (!movable.length) continue;
    const move = movable[0];
    const target = findMakeupDay(units, move, today, horizon);
    if (!target) continue;
    const keep = day.find((u) => u.id !== move.id) || null;
    return { date, move, keep, target };
  }
  return null;
}
