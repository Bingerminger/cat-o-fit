/* =========================================================================
   strength-import.js — workout history from other strength apps: the CSV exports
   of Strong, Hevy and FitNotes become strength sessions with sets (reps × kg).
   DOM-free; health-import.js shows the preview and saves.

   Exercise names are matched exactly – a name or alias in the active language, in
   English or German, without the equipment in brackets, singular and plural alike.
   Everything else stays an exercise of its own under its original name: a
   "Deadlift (Barbell)" is not our Romanian deadlift, and a wrong match would mislead
   the progression hint. Rows without repetitions (cardio, timed holds) are skipped.
   ========================================================================= */

import { EXERCISES } from './exercises.js';
import { DE_TERMS } from './exercise-terms-de.js';
import { tVariants, locale } from './i18n.js';
import { cleanSet } from './strength.js';

const LB = 0.45359237;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const pad = (n) => String(n).padStart(2, '0');

/** CSV text → rows. The separator is whichever of , ; and tab occurs most in the header; quotes as in RFC 4180. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const head = src.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((c) => [c, head.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const headerKey = (h) => String(h).trim().toLowerCase();
const FORMATS = {
  hevy: (h) => h.includes('exercise_title') && h.includes('set_index'),
  strong: (h) => h.includes('exercise name') && h.includes('set order'),
  fitnotes: (h) => h.includes('exercise') && h.includes('reps') && h.some((x) => /^weight \((kgs?|lbs?)\)$/.test(x)),
};
/** Which app wrote the file: 'strong' | 'hevy' | 'fitnotes' | null. */
export function detectFormat(header = []) {
  const h = header.map(headerKey);
  return Object.keys(FORMATS).find((k) => FORMATS[k](h)) || null;
}

/** "2024-01-15 07:30:00", "2024-01-15T07:30", "15 Jan 2024, 07:30" → { date, minutes } or null. */
export function parseWhen(value) {
  const s = String(value || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, minutes: m[4] != null ? Number(m[4]) * 60 + Number(m[5]) : null };
  m = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4}),? *(?:(\d{1,2}):(\d{2}))?/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    return { date: `${m[3]}-${pad(MONTHS[m[2].toLowerCase()] + 1)}-${pad(m[1])}`, minutes: m[4] != null ? Number(m[4]) * 60 + Number(m[5]) : null };
  }
  return null;
}

/** Strong's duration: "1h 5m", "45m", "50s" or plain seconds. */
export function parseDuration(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const part = (unit) => Number((new RegExp(`(\\d+)\\s*${unit}`).exec(s) || [])[1] || 0);
  const sec = part('h') * 3600 + part('m(?!s)') * 60 + part('s');
  return sec || null;
}

const num = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
};

/* ------------------------------ Exercise names ----------------------------- */

/** Comparable form: lower case, no brackets or punctuation, no plural -s. */
export function normaliseName(name) {
  return String(name || '').toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[-–_/]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}
/** Names other apps use for a different exercise than ours with the same word. */
const NOT_OURS = new Set(['deadlift', 'kreuzheben']);   // conventional deadlift ≠ our Romanian deadlift
const indexes = new Map();
function exerciseIndex() {
  const lang = locale();
  if (indexes.has(lang)) return indexes.get(lang);
  const index = new Map();
  for (const e of EXERCISES) {
    const terms = [
      ...tVariants(`exerciseNames.${e.id}`),
      ...tVariants(`exerciseAliases.${e.id}`).flatMap((a) => a.split('|')),
      ...(DE_TERMS[e.id] || []),
    ];
    for (const term of terms) { const k = normaliseName(term); if (k && !index.has(k)) index.set(k, e.id); }
  }
  indexes.set(lang, index);
  return index;
}
/** Our exercise for an imported name, or null (then it stays an exercise of its own). */
export function matchExercise(name) {
  const k = normaliseName(name);
  return k && !NOT_OURS.has(k) ? exerciseIndex().get(k) || null : null;
}

/* --------------------------------- Reading --------------------------------- */

/** One row of a file as a set: { key, date, minutes, title, durationSec, name, reps, kg, rpe } or null. */
function rowReader(format, header, unitOverride) {
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const get = (row, i) => (i >= 0 ? row[i] : '');
  if (format === 'hevy') {
    const c = { title: col('title'), start: col('start_time'), end: col('end_time'), name: col('exercise_title'), kg: col('weight_kg'), lb: col('weight_lbs'), reps: col('reps'), rpe: col('rpe') };
    return (row) => {
      const start = parseWhen(get(row, c.start));
      if (!start) return null;
      const end = parseWhen(get(row, c.end));
      let durationSec = null;
      if (start.minutes != null && end && end.minutes != null) durationSec = ((end.minutes - start.minutes + 1440) % 1440) * 60 || null;
      const kg = c.kg >= 0 ? num(get(row, c.kg)) : (num(get(row, c.lb)) != null ? num(get(row, c.lb)) * LB : null);
      return { key: `${get(row, c.start)}|${get(row, c.title)}`, date: start.date, minutes: start.minutes, title: get(row, c.title).trim(), durationSec, name: get(row, c.name), reps: num(get(row, c.reps)), kg, rpe: num(get(row, c.rpe)) };
    };
  }
  if (format === 'strong') {
    const c = { date: col('date'), title: col('workout name'), duration: col('duration'), name: col('exercise name'), order: col('set order'), weight: col('weight'), unit: col('weight unit'), reps: col('reps'), rpe: col('rpe') };
    return (row) => {
      const when = parseWhen(get(row, c.date));
      if (!when || /rest/i.test(get(row, c.order))) return null;
      const fileUnit = String(get(row, c.unit)).trim().toLowerCase();
      const pounds = fileUnit ? fileUnit.startsWith('lb') : unitOverride === 'lb';
      const w = num(get(row, c.weight));
      return { key: `${get(row, c.date)}|${get(row, c.title)}`, date: when.date, minutes: when.minutes, title: get(row, c.title).trim(), durationSec: parseDuration(get(row, c.duration)), name: get(row, c.name), reps: num(get(row, c.reps)), kg: w != null && pounds ? w * LB : w, rpe: num(get(row, c.rpe)) };
    };
  }
  // FitNotes: one day = one workout, no start time, no duration.
  const c = { date: col('date'), name: col('exercise'), kg: col('weight (kgs)', 'weight (kg)'), lb: col('weight (lbs)', 'weight (lb)'), reps: col('reps') };
  return (row) => {
    const when = parseWhen(get(row, c.date));
    if (!when) return null;
    const kg = c.kg >= 0 ? num(get(row, c.kg)) : (num(get(row, c.lb)) != null ? num(get(row, c.lb)) * LB : null);
    return { key: when.date, date: when.date, minutes: null, title: '', durationSec: null, name: get(row, c.name), reps: num(get(row, c.reps)), kg, rpe: null };
  };
}

/**
 * Reads a CSV export of Strong, Hevy or FitNotes.
 * `unit` ('kg' | 'lb') applies where the file does not say (Strong without a "Weight Unit" column).
 * @returns {{ format: string|null, unitKnown: boolean, skipped: number,
 *   workouts: Array<{ date, title, durationSec, rpe, exercises: Array<{ name, exerciseId, sets }> }> }}
 */
export function readStrengthCsv(text, { unit = 'kg' } = {}) {
  const rows = parseCsv(text);
  const header = (rows[0] || []).map(headerKey);
  const format = detectFormat(header);
  if (!format) return { format: null, unitKnown: true, skipped: 0, workouts: [] };
  const unitKnown = format !== 'strong' || header.includes('weight unit');
  const read = rowReader(format, header, unit);
  const byKey = new Map();
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const r = read(row);
    // Weight 0 is how the apps write a bodyweight set – here that is a set without weight.
    const set = r && String(r.name || '').trim() ? cleanSet({ reps: r.reps, kg: r.kg || null }) : null;
    if (!set) { skipped++; continue; }
    let w = byKey.get(r.key);
    if (!w) {
      w = { date: r.date, minutes: r.minutes, title: r.title, durationSec: r.durationSec, rpes: [], exercises: new Map() };
      byKey.set(r.key, w);
    }
    if (r.rpe != null) w.rpes.push(r.rpe);
    const name = r.name.trim();
    if (!w.exercises.has(name)) w.exercises.set(name, { name, exerciseId: matchExercise(name), sets: [] });
    w.exercises.get(name).sets.push(set);
  }
  const workouts = [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.minutes ?? 0) - (b.minutes ?? 0))
    .map((w) => ({
      date: w.date, title: w.title, durationSec: w.durationSec,
      rpe: w.rpes.length ? Math.round(w.rpes.reduce((a, b) => a + b, 0) / w.rpes.length) : null,
      exercises: [...w.exercises.values()],
    }));
  return { format, unitKnown, skipped, workouts };
}

/** Session record for a workout (without id; the caller adds it). */
export function toSession(workout, source) {
  return {
    date: workout.date, type: 'strength', title: workout.title || null, source,
    durationSec: workout.durationSec || null, rpe: workout.rpe,
    strengthSets: workout.exercises.map((x) => (x.exerciseId ? { exerciseId: x.exerciseId, sets: x.sets } : { exerciseId: null, name: x.name, sets: x.sets })),
  };
}

/** Imported before? Same day, strength, same source – and the same title where the app has one
    (FitNotes has none: one workout per day, saved under a title of ours). */
export function alreadyImported(workout, source, sessions = []) {
  return sessions.some((s) => s && !s.deleted && s.date === workout.date && s.type === 'strength'
    && s.source === source && (!workout.title || s.title === workout.title));
}
