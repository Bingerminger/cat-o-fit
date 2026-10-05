/* =========================================================================
   cyclecalc.js — pure cycle calculations (without store/DOM, via node:test).

   • Typical cycle length: intervals between 18 and 90 days count – long
     cycles too (oligomenorrhoea, > 35 days) are real cycles and must not silently
     fall back to 28 days. An interval that is roughly a multiple of the usual
     length, on the other hand, counts as a forgotten entry.
   • Missed period: ask first ("missed? pregnant? contraception? just not
     logged?"), then warn – no false alarm for pregnancy,
     hormonal contraception or ended tracking.
   ========================================================================= */

import { t } from './i18n.js';

const DAY = 86400000;
const dayNum = (d) => Math.round(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / DAY);
const gap = (a, b) => dayNum(b) - dayNum(a);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Sorted, unique period starts (ISO) from the cycle records. */
export function periodStarts(cycle = []) {
  return [...new Set((cycle || [])
    .filter((c) => c && !c.deleted && !c._kind && c.startDate)
    .map((c) => String(c.startDate).slice(0, 10)))].sort();
}

/**
 * Intervals that count as real cycles: 18–90 days, without presumably forgotten
 * entries (interval ≈ 2× or 3× the median of the others, ±5 days).
 */
export function cycleGaps(starts = []) {
  const all = [];
  for (let i = 1; i < starts.length; i++) all.push(gap(starts[i - 1], starts[i]));
  const inRange = all.filter((d) => d >= 18 && d <= 90);
  const typical = inRange.filter((d) => d <= 40);
  if (typical.length < 2) return inRange;
  const m = median(typical);
  return inRange.filter((d) => d <= 40 || ![2, 3].some((k) => Math.abs(d - k * m) <= 5));
}

/** Average cycle length (days) – `fallback` as long as there are not two starts. */
export function typicalCycleLength(starts = [], fallback = 28) {
  const g = cycleGaps(starts);
  return g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : fallback;
}

/** How many of the last `lastN` cycles were longer than 35 days. */
export function longCycleCount(starts = [], lastN = 6) {
  return cycleGaps(starts).slice(-lastN).filter((d) => d > 35).length;
}

/** Answers to "Period missed?". */
export const PERIOD_ANSWERS = [
  { key: 'ausgeblieben', get label() { return t('cycle.answerMissed'); } },
  { key: 'schwanger', get label() { return t('cycle.answerPregnant'); } },
  { key: 'verhuetung', get label() { return t('cycle.answerContraception'); } },
  { key: 'nicht-eingetragen', get label() { return t('cycle.answerUntracked'); } },
];

/**
 * State around an overdue period.
 * @param {{starts:string[], today:string, avgLen?:number, gate?:object, check?:object}} p
 *   `check` = stored answer {for: lastStart, answer}
 * @returns {null|{state:'ask'|'missed'|'pregnancy'|'contraception'|'untracked', flag:boolean, days:number, lastStart:string}}
 *   `flag` = show a medical hint (missed confirmed or > 90 days without an answer).
 */
export function periodSignal({ starts = [], today = null, avgLen = null, gate = {}, check = null } = {}) {
  if (!starts.length || !today) return null;
  const last = starts.at(-1);
  const days = gap(last, today);
  const len = avgLen || typicalCycleLength(starts);
  if (days <= len + 7) return null;                     // still within the usual range
  const base = { days, lastStart: last };
  if (gate && gate.pregnancy === true) return { ...base, state: 'pregnancy', flag: false };
  const answer = check && check.for === last ? check.answer : null;
  if (answer === 'ausgeblieben') return { ...base, state: 'missed', flag: true };
  if (answer === 'schwanger') return { ...base, state: 'pregnancy', flag: false };
  if (answer === 'verhuetung') return { ...base, state: 'contraception', flag: false };
  if (answer === 'nicht-eingetragen') return { ...base, state: 'untracked', flag: false };
  return { ...base, state: 'ask', flag: days > 90 };
}
