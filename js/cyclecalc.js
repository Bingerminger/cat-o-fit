/* =========================================================================
   cyclecalc.js — reine Zyklus-Rechnungen (ohne Store/DOM, per node:test).

   • Typische Zykluslänge: Abstände zwischen 18 und 90 Tagen zählen – auch lange
     Zyklen (Oligomenorrhoe, > 35 Tage) sind echte Zyklen und dürfen nicht still
     auf 28 Tage zurückfallen. Ein Abstand, der etwa ein Vielfaches der üblichen
     Länge ist, gilt dagegen als vergessener Eintrag.
   • Ausbleibende Periode: Erst fragen („ausgeblieben? schwanger? Verhütung? nur
     nicht eingetragen?"), dann warnen – kein Fehlalarm bei Schwangerschaft,
     hormoneller Verhütung oder beendeter Erfassung.
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

/** Sortierte, eindeutige Periodenstarts (ISO) aus den Zyklus-Datensätzen. */
export function periodStarts(cycle = []) {
  return [...new Set((cycle || [])
    .filter((c) => c && !c.deleted && !c._kind && c.startDate)
    .map((c) => String(c.startDate).slice(0, 10)))].sort();
}

/**
 * Abstände, die als echte Zyklen zählen: 18–90 Tage, ohne vermutlich vergessene
 * Einträge (Abstand ≈ 2× oder 3× des Medians der übrigen, ±5 Tage).
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

/** Durchschnittliche Zykluslänge (Tage) – `fallback`, solange keine zwei Starts vorliegen. */
export function typicalCycleLength(starts = [], fallback = 28) {
  const g = cycleGaps(starts);
  return g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : fallback;
}

/** Wie viele der letzten `lastN` Zyklen länger als 35 Tage waren. */
export function longCycleCount(starts = [], lastN = 6) {
  return cycleGaps(starts).slice(-lastN).filter((d) => d > 35).length;
}

/** Antworten auf „Periode ausgeblieben?“. */
export const PERIOD_ANSWERS = [
  { key: 'ausgeblieben', get label() { return t('cycle.answerMissed'); } },
  { key: 'schwanger', get label() { return t('cycle.answerPregnant'); } },
  { key: 'verhuetung', get label() { return t('cycle.answerContraception'); } },
  { key: 'nicht-eingetragen', get label() { return t('cycle.answerUntracked'); } },
];

/**
 * Zustand rund um eine überfällige Periode.
 * @param {{starts:string[], today:string, avgLen?:number, gate?:object, check?:object}} p
 *   `check` = gespeicherte Antwort {for: letzterStart, answer}
 * @returns {null|{state:'ask'|'missed'|'pregnancy'|'contraception'|'untracked', flag:boolean, days:number, lastStart:string}}
 *   `flag` = ärztlichen Hinweis zeigen (ausgeblieben bestätigt oder > 90 Tage ohne Antwort).
 */
export function periodSignal({ starts = [], today = null, avgLen = null, gate = {}, check = null } = {}) {
  if (!starts.length || !today) return null;
  const last = starts.at(-1);
  const days = gap(last, today);
  const len = avgLen || typicalCycleLength(starts);
  if (days <= len + 7) return null;                     // noch im üblichen Rahmen
  const base = { days, lastStart: last };
  if (gate && gate.pregnancy === true) return { ...base, state: 'pregnancy', flag: false };
  const answer = check && check.for === last ? check.answer : null;
  if (answer === 'ausgeblieben') return { ...base, state: 'missed', flag: true };
  if (answer === 'schwanger') return { ...base, state: 'pregnancy', flag: false };
  if (answer === 'verhuetung') return { ...base, state: 'contraception', flag: false };
  if (answer === 'nicht-eingetragen') return { ...base, state: 'untracked', flag: false };
  return { ...base, state: 'ask', flag: days > 90 };
}
