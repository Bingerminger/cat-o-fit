/* =========================================================================
   fitness.js — reine Auswertungslogik für die Statistik: Ampel-Status
   („Bin ich auf Plan?“), Trainingslast, Verpasst-Gründe und Kennzahlen mit
   Zielwerten (aus dem Praxis-Feedback). Bewusst ohne DOM/Store, damit
   alles testbar bleibt — `today` wird immer übergeben.
   ========================================================================= */

import { diffDays, fmtPace, weekStartMonday, addDays, typeMeta, fmtDec } from './ui.js';
import { weightGoalStatus } from './energy.js';
import { acwr, sessionLoad, trainingLoad, loadMinutes, RPE_BY_TYPE, FOOTBALL_RPE, footballRpe } from './load.js';

import { t } from './i18n.js';

// Die Belastung je Einheit lebt in load.js (eine Quelle für alle Belastungsurteile);
// hier für bestehende Importe weitergereicht.
export { sessionLoad, trainingLoad, RPE_BY_TYPE, FOOTBALL_RPE, footballRpe };

const EASY_TYPES = ['easy', 'long', 'recovery'];
const fmt1 = (v) => fmtDec(Math.round(v * 10) / 10);
const fmt0 = (v) => String(Math.round(v));

/** Lauf-Einheit (Kategorie „run“: Easy, Long, Tempo, Intervall, Wettkampf, Regeneration, Lauf). */
export function isRunSession(s) { return !!s && typeMeta(s.type).cat === 'run'; }

/**
 * Lauf-km der Sessions mit Datum in [from, to] (ISO, inklusive) – EINE Quelle für
 * alle Lauf-Kennzahlen (Statistik, Heute, Monatsbericht). Rad, Gehen, Wandern und
 * Schwimmen tragen zwar eine Strecke, zählen hier aber nicht: Früher ergaben 8 km
 * Laufen plus 40 km Rad „48 Lauf-km“.
 */
export function runKm(sessions = [], from, to) {
  return (sessions || []).reduce((a, s) => (s && !s.deleted && s.date && isRunSession(s)
    && (!from || s.date >= from) && (!to || s.date <= to) ? a + (Number(s.distanceKm) || 0) : a), 0);
}

/** Lauf-km im Fenster [from, to) Tage vor `today`. */
function sumKm(sessions, today, from, to) {
  return runKm(sessions, addDays(today, -(to - 1)), addDays(today, -from));
}

/** Gesundheitsbedingter Ausfall (krank, verletzt) – zählt nirgends gegen dich. */
export function isHealthMiss(u) {
  return !!u && u.status === 'verpasst' && (u.missedReason === 'sick' || u.missedReason === 'injured');
}

/**
 * Plan-Einhaltung – EINE Definition für Statistik, Erfolge, Wettkampf-/Programmseite
 * und Monatsbericht. Fällig ist eine Einheit, deren Tag vorbei ist; die heutige zählt
 * erst, wenn sie erledigt ist (morgens sinkt die Quote also nicht). Ruhetage,
 * gesundheitsbedingte Ausfälle und geschützte Zyklustage sind neutral. `from`/`to`
 * begrenzen das Fenster (ISO, inklusive) – im Monatsbericht `to = min(Monatsende, heute)`.
 * @returns {{due:number, done:number, pct:number|null}}
 */
export function adherence(plans = [], { from = null, to = null, today, isProtectedDay = () => false } = {}) {
  let due = 0, done = 0;
  (plans || []).forEach((p) => ((p && !p.deleted && p.units) || []).forEach((u) => {
    if (!u || u.deleted || !u.date || u.type === 'rest') return;
    if ((from && u.date < from) || (to && u.date > to) || u.date > today) return;
    if (u.status === 'erledigt') { due++; done++; return; }
    if (u.date === today || isHealthMiss(u) || isProtectedDay(u.date)) return;
    due++;
  }));
  return { due, done, pct: due ? Math.round((done / due) * 100) : null };
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

/**
 * Trainingslast für die Statistik-Ampel – auf `load.js acwr()` aufgebaut, damit
 * Statistik und „Heute“ nie verschiedene Urteile fällen. In den ersten 28 Tagen
 * (`sparse`) gibt es die Stufe „aufbau“ ohne Farbwertung; vorher meldete die
 * Ampel Einsteigern „Achtung – nachjustieren“, während „Heute“ ehrlich „Datenbasis
 * wächst noch" sagte. Die Lauf-km bleiben für die Anzeige erhalten.
 * @returns {{last7:number, last28:number, ratio:number|null, level:'unklar'|'aufbau'|'niedrig'|'ok'|'hoch', zone:string, sparse:boolean, acute:number, chronic:number}}
 */
export function loadBalance(sessions = [], today) {
  const ac = acwr(sessions, today);
  const level = ac.zone === 'aufbau' ? 'aufbau' : ac.ratio == null ? 'unklar'
    : ac.zone === 'optimal' ? 'ok' : ac.zone === 'niedrig' ? 'niedrig' : 'hoch';
  return {
    last7: sumKm(sessions, today, 0, 7), last28: sumKm(sessions, today, 0, 28),
    ratio: ac.ratio, level, zone: ac.zone, sparse: ac.sparse, acute: ac.acute, chronic: ac.chronic,
  };
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
 * „Bin ich auf Plan?“ — Ampelstatus (#20) aus Plan-Einhaltung, Trainingslast
 * und gesundheitsbedingten Ausfällen. Liefert level (gruen|gelb|rot), einen
 * Titel und nachvollziehbare Gründe.
 * @param {object} a
 * @param {Function} [a.isProtectedDay] geschützte Tage zählen nicht als Malus
 */
export function planStatus({ plans = [], sessions = [], today, isProtectedDay = () => false } = {}) {
  const adh = adherence(plans, { from: addDays(today, -28), to: today, today, isProtectedDay });
  const { due, done } = adh;
  const load = loadBalance(sessions, today);
  const missed = missedBreakdown(plans, today, 28);

  const LEVELS = ['gruen', 'gelb', 'rot'];
  let li = 0;
  const bump = (lvl) => { li = Math.max(li, LEVELS.indexOf(lvl)); };
  const reasons = [];

  if (adh.pct == null) reasons.push({ ok: null, text: t('fitness.noDueSessions') });
  else if (adh.pct >= 80) reasons.push({ ok: true, text: t('fitness.planKept', { pct: adh.pct }) });
  else if (adh.pct >= 50) { reasons.push({ ok: false, text: t('fitness.planKeptSome', { pct: adh.pct }) }); bump('gelb'); }
  else { reasons.push({ ok: false, text: t('fitness.planKeptFew', { pct: adh.pct }) }); bump('rot'); }

  // Dieselben Stufen und Worte wie die Karte „Belastung & Form“ (erhöht / deutlich).
  if (load.level === 'hoch') {
    reasons.push({ ok: false, text: load.zone === 'hoch' ? t('fitness.loadHigh') : t('fitness.loadRaised') });
    bump(load.ratio > 1.5 ? 'rot' : 'gelb');
  }
  else if (load.level === 'niedrig') reasons.push({ ok: null, text: t('fitness.loadQuiet') });
  else if (load.level === 'ok') reasons.push({ ok: true, text: t('fitness.loadOk') });
  else if (load.level === 'aufbau') reasons.push({ ok: null, text: t('fitness.loadBuilding') });

  // Gesundheitsbedingte Ausfälle sind neutral: Sie färben die Ampel nicht und
  // zählen nicht gegen die Einhaltung – nur der Hinweis bleibt.
  if (missed.byReason.injured > 0) reasons.push({ ok: null, text: t('fitness.missedInjured', { n: missed.byReason.injured }) });
  else if (missed.byReason.sick > 0) reasons.push({ ok: null, text: t('fitness.missedSick', { n: missed.byReason.sick }) });

  const level = LEVELS[li];
  const title = level === 'gruen' ? t('fitness.titleGreen') : level === 'gelb' ? t('fitness.titleYellow') : t('fitness.titleRed');
  return { level, title, adherence: adh.pct, due, done, load, missed, reasons };
}

/* ---- Kennzahlen mit Zielwert + halten/verbessern (#19) und Trend-„Vermaschung“ (#22) ---- */

function lastVal(arr, key) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] != null) return arr[i][key];
  return null;
}
/**
 * Median der Werte im Fenster [refDate−win+1 … refDate] – robuste Trendbasis.
 * Gewicht schwankt tagesabhängig um ±1–2 kg (Wasser, Darminhalt, Glykogen), der
 * Ruhepuls ebenso. Zwei EINZELNE Messpunkte zu vergleichen erzeugt deshalb
 * Zufallstrends; der Median über eine Woche glättet das weg (Trendgewicht).
 */
function smoothVal(arr, key, refDate, win = 7) {
  const vals = arr
    .filter((x) => x[key] != null && x.date <= refDate && diffDays(x.date, refDate) < win)
    .map((x) => x[key])
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

/**
 * Veränderung einer Körpermetrik über den geglätteten Trend: 7-Tage-Median am jüngsten
 * Messtag gegen den 7-Tage-Median an der letzten Messung, die mindestens `gapDays` davor
 * liegt (klappt auch bei seltenem Wiegen). Zwei Einzelwerte zu vergleichen zeigte früher
 * Tagesschwankungen als Fortschritt oder Rückschritt.
 * @returns {null|{now:number, before:number|null, delta:number|null, since:string|null, lastDate:string}}
 */
export function smoothedChange(health = [], key, { gapDays = 7, win = 7 } = {}) {
  const arr = (health || [])
    .filter((x) => x && !x.deleted && x.date && x[key] != null && x[key] !== '' && Number.isFinite(Number(x[key])))
    .map((x) => ({ date: x.date, [key]: Number(x[key]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!arr.length) return null;
  const lastDate = arr.at(-1).date;
  const now = smoothVal(arr, key, lastDate, win);
  const prev = [...arr].reverse().find((x) => diffDays(x.date, lastDate) >= gapDays);
  if (!prev) return { now, before: null, delta: null, since: null, lastDate };
  const before = smoothVal(arr, key, prev.date, win);
  return { now, before, delta: Math.round((now - before) * 100) / 100, since: prev.date, lastDate };
}

/** Jüngster Wert, der mindestens `minDaysAgo` Tage zurückliegt (Vergleichsbasis). */
function valBefore(arr, key, today, minDaysAgo) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][key] == null) continue;
    if (diffDays(arr[i].date, today) >= minDaysAgo) return arr[i][key];
  }
  return null;
}
/** Ø-Pace (Sek./km) lockerer Läufe im Fenster [from, to). Mit `maxHr` zählen nur
    Läufe, deren Ø-Herzfrequenz höchstens dort liegt (Grundlagenzone) – schneller ist
    nur dann besser, wenn der Lauf auch locker war. */
function avgPaceSec(sessions, today, from, to, maxHr = null) {
  let dist = 0, sec = 0;
  sessions.forEach((s) => {
    const d = diffDays(s.date, today);
    if (d < from || d >= to || !EASY_TYPES.includes(s.type) || !s.distanceKm || !s.durationSec) return;
    if (maxHr != null && !(Number(s.avgHr) > 0 && Number(s.avgHr) <= maxHr)) return;
    dist += s.distanceKm; sec += s.durationSec;
  });
  return dist > 0 ? sec / dist : null;
}

/**
 * Liste der Leitkennzahlen mit aktuellem Wert, Trendrichtung und Ziel.
 * Jede Kennzahl: { key, label, value, unit, target?, dir, good, goal, hint, fmt }.
 * `dir`: up|down|flat · `good`: true|false|null · `goal`: 'halten'|'verbessern'.
 */
export function keyMetrics({ profile = {}, health = [], sessions = [], today, noWeightGoals = false } = {}) {
  const h = [...health].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  const push = (m) => { if (m && m.value != null) out.push(m); };
  const dirOf = (cur, prev, eps) => (prev == null ? 'flat' : cur > prev + eps ? 'up' : cur < prev - eps ? 'down' : 'flat');
  const goodOf = (dir, better) => (dir === 'flat' ? null : better === 'up' ? dir === 'up' : dir === 'down');

  // Gewicht — Richtung Zielgewicht (halten, wenn nah dran)
  const w = lastVal(h, 'weight') ?? profile.weightKg ?? null;
  // Kinder, Schwangerschaft/Stillzeit, Essstörung: kein Zielgewicht (eligibility.js).
  const target = noWeightGoals ? null : (profile.targetWeightKg ?? null);
  if (w != null) {
    // Angezeigt wird der zuletzt gemessene Wert; BEWERTET wird der geglättete
    // Trend (7-Tage-Median jetzt vs. vor 4 Wochen) – sonst entscheidet der Zufall
    // eines einzelnen Wiegetags über „verbessert/verschlechtert“.
    const cur7 = smoothVal(h, 'weight', today, 7) ?? w;
    const prev = smoothVal(h, 'weight', addDays(today, -28), 10) ?? valBefore(h, 'weight', today, 21);
    const dir = dirOf(cur7, prev, 0.3);
    let good = null, goal = null, hint = t('fitness.currentValue');
    // Dieselbe Zieldefinition wie Ernährung, Cockpit und Wochenziele (energy.js).
    const gs = target != null ? weightGoalStatus({ current: cur7, target, start: profile.targetWeightStartKg != null ? profile.targetWeightStartKg : profile.weightKg }) : null;
    if (gs) {
      goal = gs.status === 'halten' ? 'halten' : 'verbessern';
      if (goal === 'halten') { good = true; hint = gs.beyond ? (gs.gap > 0 ? t('fitness.holdAbove') : t('fitness.holdBelow')) : t('fitness.atTarget'); }
      else { good = prev == null ? null : (gs.direction === 'down' ? dir === 'down' : dir === 'up'); hint = gs.gap > 0 ? t('fitness.kgAbove', { kg: fmt1(gs.remaining) }) : t('fitness.kgBelow', { kg: fmt1(gs.remaining) }); }
    }
    push({ key: 'weight', label: t('fitness.weight'), value: w, unit: 'kg', target, dir, good, goal, hint, fmt: fmt1 });
  }

  // Wochenumfang — Aufbau gilt als Fortschritt
  const km4 = sumKm(sessions, today, 0, 28) / 4;
  if (km4 > 0) {
    const kmPrev = sumKm(sessions, today, 28, 56) / 4;
    const dir = dirOf(km4, kmPrev > 0 ? kmPrev : null, 1);
    push({ key: 'weeklyKm', label: t('fitness.weeklyKm'), value: km4, unit: t('fitness.kmPerWeek'), dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: t('fitness.weeklyKmHint'), fmt: fmt0 });
  }

  // Lockeres Tempo — schneller bei gleicher Lockerheit ist besser. „Gleiche
  // Lockerheit" heißt: Ø-Herzfrequenz in der Grundlagenzone (Z2). Ohne HF-Zonen
  // oder HF-Daten zeigt die Kennzahl nur den Wert, ohne „verbessert“-Urteil –
  // sonst belohnte sie genau das Überziehen der lockeren Läufe.
  const z2 = (profile.hrZones || []).find((z) => z && z.zone === 2);
  const z2Pace = z2 ? avgPaceSec(sessions, today, 0, 28, z2.max) : null;
  if (z2Pace != null) {
    const dir = dirOf(z2Pace, avgPaceSec(sessions, today, 28, 56, z2.max), 3);
    push({ key: 'easyPace', label: t('fitness.easyPace'), value: z2Pace, unit: 'min/km', dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: t('fitness.easyPaceHint'), fmt: fmtPace });
  } else {
    const pace = avgPaceSec(sessions, today, 0, 28);
    if (pace != null) {
      const dir = dirOf(pace, avgPaceSec(sessions, today, 28, 56), 3);
      push({ key: 'easyPace', label: t('fitness.easyPace'), value: pace, unit: 'min/km', dir, good: null, goal: 'verbessern', hint: t('fitness.easyPaceNoHr'), fmt: fmtPace });
    }
  }

  // Ruhepuls — niedriger heißt fitter
  const rhr = lastVal(h, 'restingHr');
  if (rhr != null) {
    const cur7 = smoothVal(h, 'restingHr', today, 7) ?? rhr;
    const prevR = smoothVal(h, 'restingHr', addDays(today, -28), 10) ?? valBefore(h, 'restingHr', today, 21);
    const dir = dirOf(cur7, prevR, 1);
    push({ key: 'restingHr', label: t('fitness.restingHr'), value: rhr, unit: 'bpm', dir, good: goodOf(dir, 'down'), goal: 'verbessern', hint: t('fitness.restingHrHint'), fmt: fmt0 });
  }

  // VO₂max — höher heißt mehr Ausdauerleistung
  const vo2 = lastVal(h, 'vo2max');
  if (vo2 != null) {
    const dir = dirOf(vo2, valBefore(h, 'vo2max', today, 21), 0.5);
    push({ key: 'vo2max', label: 'VO₂max', value: vo2, unit: '', dir, good: goodOf(dir, 'up'), goal: 'verbessern', hint: t('fitness.vo2Hint'), fmt: fmt1 });
  }

  return out;
}

/* ---- Aktivitäts-Heatmap übers Jahr (GitHub-Contributions-Stil) ---- */

/** Trainings-„Minuten“ einer Session – dieselbe Schätzung wie für die Belastung
    (erfasst → aus der Strecke → geplant → 30 min, siehe `load.js loadMinutes`). */
export function sessionMinutes(s) {
  return loadMinutes(s).min;
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
