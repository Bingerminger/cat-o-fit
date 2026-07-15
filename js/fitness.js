/* =========================================================================
   fitness.js — reine Auswertungslogik für die Statistik: Ampel-Status
   („Bin ich auf Plan?"), Trainingslast, Verpasst-Gründe und Kennzahlen mit
   Zielwerten (aus dem Praxis-Feedback). Bewusst ohne DOM/Store, damit
   alles testbar bleibt — `today` wird immer übergeben.
   ========================================================================= */

import { diffDays, fmtPace, weekStartMonday, addDays } from './ui.js';

const EASY_TYPES = ['easy', 'long', 'recovery'];
const fmt1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const fmt0 = (v) => String(Math.round(v));

/** km-Summe der Sessions im Fenster [from, to) Tage vor `today`. */
function sumKm(sessions, today, from, to) {
  return sessions.reduce((a, s) => {
    const d = diffDays(s.date, today);
    return d >= from && d < to ? a + (s.distanceKm || 0) : a;
  }, 0);
}

/** Längster gelaufener Lauf der letzten `days` Tage (km) – aktueller Long-Run-Stand. */
export function recentLongRunKm(sessions = [], today, days = 28) {
  let max = 0;
  sessions.forEach((s) => {
    if (!s || s.deleted || !s.distanceKm) return;
    if (!['easy', 'long', 'race', 'run', 'tempo'].includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d >= 0 && d <= days && s.distanceKm > max) max = s.distanceKm;
  });
  return Math.round(max * 2) / 2;
}

/** Trainingslast: 7-Tage-Umfang gegen den 28-Tage-Schnitt (Acute/Chronic-Idee). */
export function loadBalance(sessions = [], today) {
  const last7 = sumKm(sessions, today, 0, 7);
  const last28 = sumKm(sessions, today, 0, 28);
  const avg7 = last28 / 4;
  const ratio = avg7 > 0 ? last7 / avg7 : 0;
  let level = 'unklar';
  if (ratio > 0) level = ratio > 1.4 ? 'hoch' : ratio < 0.7 ? 'niedrig' : 'ok';
  return { last7, last28, ratio, level };
}

/** Geschätztes Belastungsempfinden je Einheitentyp, falls kein RPE erfasst wurde. */
export const RPE_BY_TYPE = {
  recovery: 3, easy: 4, long: 6, tempo: 7, interval: 8, race: 9, run: 5,
  // Fußball ist HIIT-artig (Antritte, Spielintensität) und wird höher gewichtet als
  // ein lockerer Lauf; der Default 7 entspricht „normal" (siehe FOOTBALL_RPE).
  strength: 5, mobility: 2, cross: 5, cross_bike: 5, cross_football: 7, match: 8, camp: 7, walk: 2, other: 4,
};
/** Fußball-Intensität → RPE. Pro Termin einstellbar (leicht/normal/intensiv), damit
    die Belastung realistisch in ACWR/Form und die Plan-Entlastung einfließt (#5). */
export const FOOTBALL_RPE = { leicht: 5, normal: 7, intensiv: 8.5 };
export function footballRpe(intensity) { return FOOTBALL_RPE[intensity] || FOOTBALL_RPE.normal; }

/** Belastungspunkte einer Einheit = Dauer (min) × Intensität (RPE 1–10) – Session-RPE-Methode.
    Fallbacks: Dauer aus km×6 bzw. 30 min, Intensität aus dem Typ (Fußball: aus der
    gewählten Intensität, falls kein RPE erfasst wurde). */
export function sessionLoad(s) {
  const min = s.durationSec ? s.durationSec / 60 : (s.distanceKm ? s.distanceKm * 6 : 30);
  const rpe = s.rpe || (s.type === 'cross_football' ? footballRpe(s.intensity) : (RPE_BY_TYPE[s.type] || 4));
  return Math.round(min * rpe);
}

/**
 * Gesamtbelastung (alle Sportarten) der letzten `days` Tage – Summe der Belastungspunkte.
 * Erfasst – anders als die km-Last – auch Kraft, Fußball, Schwimmen, Rad, Testspiele.
 */
export function trainingLoad(sessions = [], today, days = 7) {
  return sessions.reduce((a, s) => {
    if (!s || s.deleted) return a;
    const d = diffDays(s.date, today);
    return d >= 0 && d < days ? a + sessionLoad(s) : a;
  }, 0);
}

/** Verpasste Einheiten der letzten `days` Tage, gruppiert nach Grund (#21). */
export function missedBreakdown(plans = [], today, days = 28) {
  const byReason = { time: 0, sick: 0, injured: 0, other: 0 };
  let total = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.status !== 'verpasst') return;
    const d = diffDays(u.date, today);
    if (d < 0 || d > days) return;
    byReason[byReason[u.missedReason] != null ? u.missedReason : 'other']++;
    total++;
  }));
  return { total, byReason };
}

/**
 * „Bin ich auf Plan?" — Ampelstatus (#20) aus Plan-Einhaltung, Trainingslast
 * und gesundheitsbedingten Ausfällen. Liefert level (gruen|gelb|rot), einen
 * Titel und nachvollziehbare Gründe.
 * @param {object} a
 * @param {Function} [a.isProtectedDay] geschützte Tage zählen nicht als Malus
 */
export function planStatus({ plans = [], sessions = [], today, isProtectedDay = () => false } = {}) {
  let due = 0, done = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.type === 'rest' || u.date > today || diffDays(u.date, today) > 28) return;
    if (u.status === 'erledigt') { due++; done++; }
    else if (!isProtectedDay(u.date)) due++;
  }));
  const adherence = due ? Math.round((done / due) * 100) : null;
  const load = loadBalance(sessions, today);
  const missed = missedBreakdown(plans, today, 28);

  const LEVELS = ['gruen', 'gelb', 'rot'];
  let li = 0;
  const bump = (lvl) => { li = Math.max(li, LEVELS.indexOf(lvl)); };
  const reasons = [];

  if (adherence == null) reasons.push({ ok: null, text: 'Noch keine fälligen Einheiten zum Bewerten.' });
  else if (adherence >= 80) reasons.push({ ok: true, text: `Plan zu ${adherence} % eingehalten.` });
  else if (adherence >= 50) { reasons.push({ ok: false, text: `Plan zu ${adherence} % eingehalten – ein paar Einheiten fehlen.` }); bump('gelb'); }
  else { reasons.push({ ok: false, text: `Nur ${adherence} % der fälligen Einheiten erledigt.` }); bump('rot'); }

  if (load.level === 'hoch') { reasons.push({ ok: false, text: 'Trainingslast steigt deutlich – Erholung einplanen.' }); bump(load.ratio > 1.6 ? 'rot' : 'gelb'); }
  else if (load.level === 'niedrig') reasons.push({ ok: null, text: 'Ruhigere Phase – gut zur Regeneration.' });
  else if (load.level === 'ok') reasons.push({ ok: true, text: 'Trainingslast im stabilen Bereich.' });

  if (missed.byReason.injured > 0) { reasons.push({ ok: false, text: `${missed.byReason.injured}× verletzungsbedingt ausgefallen – vorsichtig aufbauen.` }); bump(missed.byReason.injured >= 2 ? 'rot' : 'gelb'); }
  else if (missed.byReason.sick > 0) { reasons.push({ ok: false, text: `${missed.byReason.sick}× krankheitsbedingt ausgefallen.` }); bump('gelb'); }

  const level = LEVELS[li];
  const title = level === 'gruen' ? 'Du bist auf Kurs' : level === 'gelb' ? 'Etwas aus dem Tritt' : 'Achtung – nachjustieren';
  return { level, title, adherence, due, done, load, missed, reasons };
}

/* ---- Kennzahlen mit Zielwert + halten/verbessern (#19) und Trend-„Vermaschung" (#22) ---- */

function lastVal(arr, key) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] != null) return arr[i][key];
  return null;
}
/** Jüngster Wert, der mindestens `minDaysAgo` Tage zurückliegt (Vergleichsbasis). */
function valBefore(arr, key, today, minDaysAgo) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][key] == null) continue;
    if (diffDays(arr[i].date, today) >= minDaysAgo) return arr[i][key];
  }
  return null;
}
/** Ø-Pace (Sek./km) lockerer Läufe im Fenster [from, to). */
function avgPaceSec(sessions, today, from, to) {
  let dist = 0, sec = 0;
  sessions.forEach((s) => {
    const d = diffDays(s.date, today);
    if (d < from || d >= to || !EASY_TYPES.includes(s.type) || !s.distanceKm || !s.durationSec) return;
    dist += s.distanceKm; sec += s.durationSec;
  });
  return dist > 0 ? sec / dist : null;
}

/**
 * Liste der Leitkennzahlen mit aktuellem Wert, Trendrichtung und Ziel.
 * Jede Kennzahl: { key, label, value, unit, target?, dir, good, goal, hint, fmt }.
 * `dir`: up|down|flat · `good`: true|false|null · `goal`: 'halten'|'verbessern'.
 */
export function keyMetrics({ profile = {}, health = [], sessions = [], today } = {}) {
  const h = [...health].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  const push = (m) => { if (m && m.value != null) out.push(m); };
  const dirOf = (cur, prev, eps) => (prev == null ? 'flat' : cur > prev + eps ? 'up' : cur < prev - eps ? 'down' : 'flat');
  const goodOf = (dir, better) => (dir === 'flat' ? null : better === 'up' ? dir === 'up' : dir === 'down');

  // Gewicht — Richtung Zielgewicht (halten, wenn nah dran)
  const w = lastVal(h, 'weight') ?? profile.weightKg ?? null;
  const target = profile.targetWeightKg ?? null;
  if (w != null) {
    const prev = valBefore(h, 'weight', today, 21);
    const dir = dirOf(w, prev, 0.2);
    let good = null, goal = null, hint = 'aktueller Wert';
    if (target != null) {
      const gap = w - target;
      goal = Math.abs(gap) <= 0.5 ? 'halten' : 'verbessern';
      if (goal === 'halten') { good = true; hint = 'am Zielgewicht'; }
      else { good = prev == null ? null : (gap > 0 ? dir === 'down' : dir === 'up'); hint = `${fmt1(Math.abs(gap))} kg ${gap > 0 ? 'über' : 'unter'} Ziel`; }
    }
    push({ key: 'weight', label: 'Gewicht', value: w, unit: 'kg', target, dir, good, goal, hint, fmt: fmt1 });
  }

  // Wochenumfang — Aufbau gilt als Fortschritt
  const km4 = sumKm(sessions, today, 0, 28) / 4;
  if (km4 > 0) {
    const kmPrev = sumKm(sessions, today, 28, 56) / 4;
    const dir = dirOf(km4, kmPrev > 0 ? kmPrev : null, 1);
    push({ key: 'weeklyKm', label: 'Wochenumfang', value: km4, unit: 'km/Wo', dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: 'Ø der letzten 4 Wochen', fmt: fmt0 });
  }

  // Lockeres Tempo — schneller bei gleicher Lockerheit ist besser
  const pace = avgPaceSec(sessions, today, 0, 28);
  if (pace != null) {
    const dir = dirOf(pace, avgPaceSec(sessions, today, 28, 56), 3);
    push({ key: 'easyPace', label: 'Lockeres Tempo', value: pace, unit: 'min/km', dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: 'Ø Grundlagenläufe', fmt: fmtPace });
  }

  // Ruhepuls — niedriger heißt fitter
  const rhr = lastVal(h, 'restingHr');
  if (rhr != null) {
    const dir = dirOf(rhr, valBefore(h, 'restingHr', today, 21), 1);
    push({ key: 'restingHr', label: 'Ruhepuls', value: rhr, unit: 'bpm', dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: 'niedriger ist fitter', fmt: fmt0 });
  }

  // VO₂max — höher heißt mehr Ausdauerleistung
  const vo2 = lastVal(h, 'vo2max');
  if (vo2 != null) {
    const dir = dirOf(vo2, valBefore(h, 'vo2max', today, 21), 0.5);
    push({ key: 'vo2max', label: 'VO₂max', value: vo2, unit: '', dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: 'Ausdauer-Leistung', fmt: fmt1 });
  }

  return out;
}

/* ---- Aktivitäts-Heatmap übers Jahr (GitHub-Contributions-Stil) ---- */

/** Trainings-„Minuten" eines Tages aus einer Session (Fallback: km×6 bzw. 30). */
export function sessionMinutes(s) {
  if (s.durationSec) return s.durationSec / 60;
  if (s.distanceKm) return s.distanceKm * 6;
  return 30;
}
/** Aktivitätsstufe 0–4 nach Tagesminuten (feste, intuitive Schwellen). */
function activityLevel(min) {
  return min <= 0 ? 0 : min < 30 ? 1 : min < 60 ? 2 : min < 90 ? 3 : 4;
}

/**
 * Baut die Wochen-/Wochentag-Matrix der letzten `weeks` Wochen (Mo–So je Spalte).
 * Pro Tag: { date, minutes, level (0–4), future }. Zukünftige Tage: level -1.
 * @returns {{cols: Array<{weekStart:string, days:Array}>, max:number, totalDays:number, activeDays:number}}
 */
export function activityMatrix({ sessions = [], today, weeks = 53 } = {}) {
  const perDay = {};
  sessions.forEach((s) => {
    if (!s || s.deleted || !s.date) return;
    perDay[s.date] = (perDay[s.date] || 0) + sessionMinutes(s);
  });
  const start = addDays(weekStartMonday(today), -(weeks - 1) * 7);
  const cols = [];
  let max = 0, activeDays = 0, totalDays = 0;
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, d);
      const future = date > today;
      const minutes = Math.round(perDay[date] || 0);
      const level = future ? -1 : activityLevel(minutes);
      if (!future) { totalDays++; if (minutes > 0) activeDays++; if (minutes > max) max = minutes; }
      days.push({ date, minutes, level, future });
    }
    cols.push({ weekStart: ws, days });
  }
  return { cols, max, totalDays, activeDays };
}
