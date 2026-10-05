/* =========================================================================
   badges.js — Belohnungssystem: Erfolgs-Badges + Momentum.
   Philosophie „Motivation ohne Druck“: viele positive, humorvolle Abzeichen;
   das Momentum (eine Schwung-Flamme) reagiert sanft auf Konsistenz – es
   schrumpft bei Lücken, formuliert aber immer aktivierend statt strafend.

   Badges werden live aus den vorhandenen Daten berechnet. Die „schon gesehen“-
   Liste liegt clientseitig im LocalStorage (das Feier-Erlebnis muss nicht syncen).
   ========================================================================= */

import { diffDays, todayStr, addDays, typeMeta, el, iconSvg, sectionHead, fmtNum, weekStartMonday } from './ui.js';
import { lsGet, lsSet } from './env.js';
import { locale, t, tp } from './i18n.js';
import * as store from './storage.js';
import { setHeader } from './router.js';
import { progressTabs } from './nav.js';
import { isProtectedDay, cycleEnabled } from './cycle.js';
import { weekOfDate } from './planflow.js';
import { alcoholFreeStreak } from './healthdata.js';

export { alcoholFreeStreak };
import { adherence as planAdherence, isHealthMiss, isRunSession } from './fitness.js';
import { periodStarts } from './cyclecalc.js';

/** Trainingstage: Datum jeder Session und jeder erledigten Plan-Einheit. */
function activeDateSet(sessions = [], plans = []) {
  const active = new Set((sessions || []).filter((s) => s && !s.deleted && s.date).map((s) => s.date));
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => { if (u && u.status === 'erledigt') active.add(u.date); }));
  return active;
}

/** Tage mit gesundheitsbedingtem Ausfall (krank, verletzt) der letzten `days` Tage –
    Lücken bis 3 Tage zwischen zwei solchen Ausfällen zählen mit (die Krankheit dauert
    ja auch an Tagen ohne geplante Einheit). */
export function illnessDays(plans = [], today, days = 60) {
  const dates = [];
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => {
    if (isHealthMiss(u) && u.date <= today && diffDays(u.date, today) <= days) dates.push(u.date);
  }));
  const sorted = [...new Set(dates)].sort();
  const out = new Set(sorted);
  for (let i = 1; i < sorted.length; i++) {
    const gap = diffDays(sorted[i - 1], sorted[i]);
    if (gap > 1 && gap <= 4) for (let k = 1; k < gap; k++) out.add(addDays(sorted[i - 1], k));
  }
  return out;
}

/**
 * Wochen-Serie: aufeinanderfolgende Kalenderwochen (Mo–So) mit mindestens `minDays`
 * Trainingstagen. Die laufende Woche zählt, sobald sie das Ziel erreicht – solange
 * sie läuft, bricht sie die Serie nicht. Ruhetage erhalten die Serie: belohnt wird
 * Regelmäßigkeit, nicht Training ohne Pause (früher zählten „Tage in Folge“, und die
 * höchsten Abzeichen verlangten 60 Tage ohne Ruhetag). Wochen mit krankheits- oder
 * verletzungsbedingtem Ausfall pausieren die Serie, statt sie zu brechen.
 */
export function weekStreak({ sessions = [], plans = [] } = {}, today = todayStr(), minDays = 3) {
  const active = activeDateSet(sessions, plans);
  const sick = new Set();
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => { if (isHealthMiss(u)) sick.add(u.date); }));
  const count = (ws) => { let n = 0; for (let i = 0; i < 7; i++) if (active.has(addDays(ws, i))) n++; return n; };
  const hasSick = (ws) => { for (let i = 0; i < 7; i++) if (sick.has(addDays(ws, i))) return true; return false; };
  let ws = weekStartMonday(today);
  let streak = count(ws) >= minDays ? 1 : 0;
  for (let guard = 0; guard < 520; guard++) {
    ws = addDays(ws, -7);
    if (count(ws) >= minDays) streak++;
    else if (!hasSick(ws)) break;
  }
  return streak;
}


/* ------------------------- Kennzahlen aus dem Bestand ------------------- */
/**
 * Kennzahlen für Abzeichen und Momentum. `data.isProtectedDay` (optional) ersetzt die
 * Zyklus-Regel der angemeldeten Person – das Team-Dashboard übergibt `() => false`,
 * weil es für andere Mitglieder keine Zyklusdaten gibt (und nicht geben darf).
 * `data.cycle` (optional, nur in der eigenen Sicht) zählt die eingetragenen Periodenstarts.
 */
export function computeStats(data = {}, today = todayStr()) {
  const { sessions = [], plans = [], health = [], events = [], profile = {}, cycle = [] } = data;
  const protectedDay = typeof data.isProtectedDay === 'function' ? data.isProtectedDay : isProtectedDay;
  const run = sessions.filter((s) => !s.deleted);
  const totalSessions = run.length;
  // „km gesammelt“: alle Sportarten mit Strecke. Der längste LAUF zählt nur Läufe –
  // sonst schaltete eine 40-km-Radtour „Ein Lauf über 21 km“ frei.
  const totalKm = run.reduce((a, s) => a + (s.distanceKm || 0), 0);
  const longestRun = run.filter(isRunSession).reduce((m, s) => Math.max(m, s.distanceKm || 0), 0);
  const intervalCount = run.filter((s) => s.type === 'interval').length;
  const qualityCount = run.filter((s) => ['tempo', 'interval'].includes(s.type)).length;

  // Wochen-Serie (Kalenderwochen mit ≥ 3 Trainingstagen); Ruhetage erhalten die Serie.
  const streak = weekStreak({ sessions: run, plans }, today);

  // Plan-Einhaltung – dieselbe Definition wie Statistik, Wettkampfseite und Monatsbericht.
  const adherence = planAdherence(plans, { today, isProtectedDay: protectedDay }).pct ?? 0;

  // Zyklus protokolliert (neutral: belohnt das Eintragen, nicht Training trotz Periode).
  const cycleStarts = periodStarts(cycle).length;

  // Perfekte Woche: irgendeine vergangene Plan-Woche komplett erledigt.
  let perfectWeek = false;
  plans.forEach((p) => {
    const byWeek = {};
    // Woche aus dem Datum ableiten (nicht aus u.week): sonst landen manuell
    // angelegte Einheiten ohne `week`-Feld gemeinsam im „undefined“-Eimer und
    // könnten eine „Perfekte Woche“ fälschlich auslösen.
    (p.units || []).forEach((u) => {
      if (u.type === 'rest') return;
      const wk = weekOfDate(p, u.date) ?? u.week;
      (byWeek[wk] ||= []).push(u);
    });
    Object.values(byWeek).forEach((list) => {
      if (list.length && list.every((u) => u.date < today) && list.every((u) => u.status === 'erledigt')) perfectWeek = true;
    });
  });

  // Gewicht: jemals Zielgewicht erreicht?
  const target = profile.targetWeightKg;
  const minWeight = health.filter((h) => h.weight != null).reduce((m, h) => Math.min(m, h.weight), Infinity);
  const weightReached = target != null && minWeight <= target;

  // Wettkampf gefinisht.
  const raceFinished = run.some((s) => s.type === 'race') || events.some((e) => e.status === 'abgeschlossen');

  // Schlaf-Serie: 7 der letzten Einträge ≥ 7 h.
  const sleepStreak = health.filter((h) => h.sleepHours != null).sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7).filter((h) => h.sleepHours >= 7).length;

  const soberStreak = alcoholFreeStreak(health, today) || 0;

  // Sportart-Zähler (je Trainingsart) + Vielfalt
  const byType = {};
  run.forEach((s) => { if (s.type) byType[s.type] = (byType[s.type] || 0) + 1; });
  const cnt = (type) => byType[type] || 0;
  const distinctTypes = Object.keys(byType).filter((type) => type !== 'rest').length;
  const distinctCats = new Set(run.map((s) => typeMeta(s.type).cat).filter((c) => c && c !== 'rest')).size;
  const marathonRun = longestRun >= 42;

  // Event-/Wettkampfarten (abgeschlossene Events)
  const doneEvents = events.filter((e) => !e.deleted && e.status === 'abgeschlossen');
  const racesFinishedCount = Math.max(
    doneEvents.filter((e) => e.kind !== 'program').length,
    run.filter((s) => s.type === 'race').length,
  );
  const programsDone = doneEvents.filter((e) => e.kind === 'program').length;
  const distinctDistances = new Set(doneEvents.filter((e) => e.kind !== 'program' && e.distanceType).map((e) => e.distanceType)).size;
  const hyroxDone = doneEvents.some((e) => e.sport === 'hyrox' || /hyrox/i.test(e.name || ''));
  const triathlonDone = doneEvents.some((e) => e.sport === 'triathlon' || /triathlon/i.test(e.name || ''));

  return {
    totalSessions, totalKm, longestRun, intervalCount, qualityCount, streak, adherence, perfectWeek,
    weightReached, raceFinished, sleepStreak, cycleStarts, soberStreak,
    // Sportarten
    byType, distinctTypes, distinctCats, marathonRun,
    swimCount: cnt('swim'), hikeCount: cnt('hike'), rowingCount: cnt('rowing'),
    bikeCount: cnt('cross_bike') + cnt('spinning'), strengthCount: cnt('strength') + cnt('gym'),
    racketCount: cnt('tennis') + cnt('badminton') + cnt('squash') + cnt('tabletennis'),
    walkCount: cnt('walk'),
    // Eventarten
    racesFinishedCount, programsDone, distinctDistances, hyroxDone, triathlonDone,
  };
}

/* ------------------------------- Badges --------------------------------- */
// Jeder Badge: emoji, name, desc, Kategorie und eine Fortschrittsfunktion.
// tier = Aufwand/Schwierigkeit: 4 Legendär · 3 Episch · 2 Fortgeschritten · 1 Einsteiger.
export const TIERS = [
  { tier: 4, get label() { return t('badges.tiers.legendary'); }, color: '#f5a623' },
  { tier: 3, get label() { return t('badges.tiers.epic'); }, color: '#7c5cff' },
  { tier: 2, get label() { return t('badges.tiers.advanced'); }, color: '#3d8bff' },
  { tier: 1, get label() { return t('badges.tiers.beginner'); }, color: '#43c59e' },
];

export const BADGES = [
  /* ---- Einstieg & Konstanz ---- */
  { id: 'first', tier: 1, emoji: '🌱', get name() { return t('badges.items.first.name'); }, cat: 'Start', get desc() { return t('badges.items.first.desc'); }, p: (s) => [s.totalSessions, 1] },
  // Konstanz in Wochen (≥ 3 Trainingstage je Woche) – Ruhetage gehören dazu.
  { id: 'weeks3', tier: 1, emoji: '🔥', get name() { return t('badges.items.weeks3.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks3.desc'); }, p: (s) => [s.streak, 3] },
  { id: 'weeks6', tier: 2, emoji: '💪', get name() { return t('badges.items.weeks6.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks6.desc'); }, p: (s) => [s.streak, 6] },
  { id: 'weeks12', tier: 3, emoji: '⚡', get name() { return t('badges.items.weeks12.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks12.desc'); }, p: (s) => [s.streak, 12] },
  { id: 'weeks26', tier: 4, emoji: '🏔️', get name() { return t('badges.items.weeks26.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks26.desc'); }, p: (s) => [s.streak, 26] },
  { id: 'weeks52', tier: 4, emoji: '❄️', get name() { return t('badges.items.weeks52.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks52.desc'); }, p: (s) => [s.streak, 52] },

  /* ---- Umfang (Trainings) ---- */
  { id: 'count10', tier: 1, emoji: '📦', get name() { return t('badges.items.count10.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count10.desc'); }, p: (s) => [s.totalSessions, 10] },
  { id: 'count50', tier: 3, emoji: '🎯', get name() { return t('badges.items.count50.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count50.desc'); }, p: (s) => [s.totalSessions, 50] },
  { id: 'count100', tier: 4, emoji: '👑', get name() { return t('badges.items.count100.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count100.desc'); }, p: (s) => [s.totalSessions, 100] },
  { id: 'count200', tier: 4, emoji: '🏛️', get name() { return t('badges.items.count200.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count200.desc'); }, p: (s) => [s.totalSessions, 200] },

  /* ---- Distanz (km) ---- */
  { id: 'km100', tier: 2, emoji: '🛣️', get name() { return t('badges.items.km100.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km100.desc'); }, p: (s) => [s.totalKm, 100] },
  { id: 'km500', tier: 3, emoji: '🚀', get name() { return t('badges.items.km500.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km500.desc'); }, p: (s) => [s.totalKm, 500] },
  { id: 'km1000', tier: 4, emoji: '🌍', get name() { return t('badges.items.km1000.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km1000.desc'); }, p: (s) => [s.totalKm, 1000] },
  { id: 'km2000', tier: 4, emoji: '✈️', get name() { return t('badges.items.km2000.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km2000.desc'); }, p: (s) => [s.totalKm, 2000] },

  /* ---- Long Run & Tempo ---- */
  { id: 'long15', tier: 2, emoji: '🦵', get name() { return t('badges.items.long15.name'); }, cat: 'Long Run', get desc() { return t('badges.items.long15.desc'); }, p: (s) => [s.longestRun, 15] },
  { id: 'long21', tier: 3, emoji: '🏃‍♀️', get name() { return t('badges.items.long21.name'); }, cat: 'Long Run', get desc() { return t('badges.items.long21.desc'); }, p: (s) => [s.longestRun, 21] },
  { id: 'marathon', tier: 4, emoji: '🏁', get name() { return t('badges.items.marathon.name'); }, cat: 'Long Run', get desc() { return t('badges.items.marathon.desc'); }, p: (s) => [s.longestRun, 42] },
  { id: 'quality1', tier: 1, emoji: '🌶️', get name() { return t('badges.items.quality1.name'); }, cat: 'Tempo', get desc() { return t('badges.items.quality1.desc'); }, p: (s) => [s.qualityCount, 1] },
  { id: 'interval10', tier: 3, emoji: '🎡', get name() { return t('badges.items.interval10.name'); }, cat: 'Tempo', get desc() { return t('badges.items.interval10.desc'); }, p: (s) => [s.intervalCount, 10] },

  /* ---- Sportarten: Schwimmen ---- */
  { id: 'swim1', tier: 1, emoji: '🏊', get name() { return t('badges.items.swim1.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim1.desc'); }, p: (s) => [s.swimCount, 1] },
  { id: 'swim10', tier: 2, emoji: '🌊', get name() { return t('badges.items.swim10.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim10.desc'); }, p: (s) => [s.swimCount, 10] },
  { id: 'swim25', tier: 3, emoji: '🐬', get name() { return t('badges.items.swim25.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim25.desc'); }, p: (s) => [s.swimCount, 25] },

  /* ---- Sportarten: Wandern & Gehen ---- */
  { id: 'hike1', tier: 1, emoji: '🥾', get name() { return t('badges.items.hike1.name'); }, cat: 'Wandern', get desc() { return t('badges.items.hike1.desc'); }, p: (s) => [s.hikeCount, 1] },
  { id: 'hike10', tier: 3, emoji: '⛰️', get name() { return t('badges.items.hike10.name'); }, cat: 'Wandern', get desc() { return t('badges.items.hike10.desc'); }, p: (s) => [s.hikeCount, 10] },
  { id: 'walk10', tier: 1, emoji: '🚶', get name() { return t('badges.items.walk10.name'); }, cat: 'Gehen', get desc() { return t('badges.items.walk10.desc'); }, p: (s) => [s.walkCount, 10] },

  /* ---- Sportarten: Rudern ---- */
  { id: 'row1', tier: 1, emoji: '🚣', get name() { return t('badges.items.row1.name'); }, cat: 'Rudern', get desc() { return t('badges.items.row1.desc'); }, p: (s) => [s.rowingCount, 1] },
  { id: 'row10', tier: 3, emoji: '🛶', get name() { return t('badges.items.row10.name'); }, cat: 'Rudern', get desc() { return t('badges.items.row10.desc'); }, p: (s) => [s.rowingCount, 10] },

  /* ---- Sportarten: Rückschlag, Rad, Kraft ---- */
  { id: 'racket1', tier: 1, emoji: '🎾', get name() { return t('badges.items.racket1.name'); }, cat: 'Rückschlag', get desc() { return t('badges.items.racket1.desc'); }, p: (s) => [s.racketCount, 1] },
  { id: 'racket10', tier: 2, emoji: '🏓', get name() { return t('badges.items.racket10.name'); }, cat: 'Rückschlag', get desc() { return t('badges.items.racket10.desc'); }, p: (s) => [s.racketCount, 10] },
  { id: 'bike10', tier: 2, emoji: '🚴', get name() { return t('badges.items.bike10.name'); }, cat: 'Radsport', get desc() { return t('badges.items.bike10.desc'); }, p: (s) => [s.bikeCount, 10] },
  { id: 'strength10', tier: 2, emoji: '🏋️', get name() { return t('badges.items.strength10.name'); }, cat: 'Kraft', get desc() { return t('badges.items.strength10.desc'); }, p: (s) => [s.strengthCount, 10] },
  { id: 'strength50', tier: 4, emoji: '🦾', get name() { return t('badges.items.strength50.name'); }, cat: 'Kraft', get desc() { return t('badges.items.strength50.desc'); }, p: (s) => [s.strengthCount, 50] },

  /* ---- Vielfalt ---- */
  { id: 'variety5', tier: 2, emoji: '🎨', get name() { return t('badges.items.variety5.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.variety5.desc'); }, p: (s) => [s.distinctTypes, 5] },
  { id: 'cats4', tier: 3, emoji: '🤹', get name() { return t('badges.items.cats4.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.cats4.desc'); }, p: (s) => [s.distinctCats, 4] },
  { id: 'variety10', tier: 4, emoji: '🌈', get name() { return t('badges.items.variety10.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.variety10.desc'); }, p: (s) => [s.distinctTypes, 10] },

  /* ---- Eventarten / Wettkämpfe ---- */
  { id: 'race', tier: 3, emoji: '🏅', get name() { return t('badges.items.race.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.race.desc'); }, p: (s) => [s.racesFinishedCount, 1] },
  { id: 'races3', tier: 4, emoji: '🥇', get name() { return t('badges.items.races3.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.races3.desc'); }, p: (s) => [s.racesFinishedCount, 3] },
  { id: 'dist3', tier: 3, emoji: '🎽', get name() { return t('badges.items.dist3.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.dist3.desc'); }, p: (s) => [s.distinctDistances, 3] },
  { id: 'hyrox', tier: 4, emoji: '🤸', get name() { return t('badges.items.hyrox.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.hyrox.desc'); }, p: (s) => [s.hyroxDone ? 1 : 0, 1] },
  { id: 'triathlon', tier: 4, emoji: '🔱', get name() { return t('badges.items.triathlon.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.triathlon.desc'); }, p: (s) => [s.triathlonDone ? 1 : 0, 1] },
  { id: 'program1', tier: 2, emoji: '📋', get name() { return t('badges.items.program1.name'); }, cat: 'Programm', get desc() { return t('badges.items.program1.desc'); }, p: (s) => [s.programsDone, 1] },
  { id: 'program3', tier: 4, emoji: '🎖️', get name() { return t('badges.items.program3.name'); }, cat: 'Programm', get desc() { return t('badges.items.program3.desc'); }, p: (s) => [s.programsDone, 3] },

  /* ---- Plan & Gesundheit ---- */
  { id: 'perfectweek', tier: 2, emoji: '📅', get name() { return t('badges.items.perfectweek.name'); }, cat: 'Plan', get desc() { return t('badges.items.perfectweek.desc'); }, p: (s) => [s.perfectWeek ? 1 : 0, 1] },
  { id: 'adherence90', tier: 3, emoji: '🤝', get name() { return t('badges.items.adherence90.name'); }, cat: 'Plan', get desc() { return t('badges.items.adherence90.desc'); }, p: (s) => [s.adherence, 90] },
  { id: 'weight', tier: 3, emoji: '⚖️', get name() { return t('badges.items.weight.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.weight.desc'); }, p: (s) => [s.weightReached ? 1 : 0, 1] },
  { id: 'sleep7', tier: 2, emoji: '😴', get name() { return t('badges.items.sleep7.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sleep7.desc'); }, p: (s) => [s.sleepStreak, 7] },
  { id: 'sober7', tier: 2, emoji: '🌿', get name() { return t('badges.items.sober7.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sober7.desc'); }, p: (s) => [s.soberStreak, 7] },
  { id: 'sober30', tier: 4, emoji: '💎', get name() { return t('badges.items.sober30.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sober30.desc'); }, p: (s) => [s.soberStreak, 30] },
  { id: 'cycle3', tier: 1, emoji: '🌙', get name() { return t('badges.items.cycle3.name'); }, cat: 'Zyklus', get desc() { return t('badges.items.cycle3.desc'); }, p: (s) => [s.cycleStarts, 3] },
];

/** Abzeichen, die nur aus Trainingsdaten entstehen – das Team-Dashboard zählt nur
    diese (Gesundheits- und Zyklusdaten anderer Mitglieder sieht es nie). */
export const TRAINING_BADGE_CATS = new Set(['Start', 'Konstanz', 'Umfang', 'Distanz', 'Long Run', 'Tempo',
  'Schwimmen', 'Wandern', 'Gehen', 'Rudern', 'Rückschlag', 'Radsport', 'Kraft', 'Vielfalt', 'Wettkampf', 'Programm', 'Plan']);

/** Bewertet alle Badges gegen die aktuellen Kennzahlen. */
export function evaluateBadges(data, today = todayStr()) {
  const stats = computeStats(data, today);
  return BADGES.map((b) => {
    const [cur, target] = b.p(stats);
    const progress = Math.max(0, Math.min(1, cur / target));
    return { ...b, cur, target, progress, unlocked: cur >= target };
  });
}

/* ------------------------------ Momentum -------------------------------- */
/** Höchstens so viele Trainingstage je Kalenderwoche heben das Momentum – mehr
    Training ohne Ruhetag bringt keinen zusätzlichen Schwung. */
const MOMENTUM_DAYS_PER_WEEK = 5;

/**
 * Schwung-Wert (0–100) aus den Trainingstagen der letzten 15 Tage, offenen Lücken und
 * der Wochen-Serie. Gesundheitsbedingte Ausfälle pausieren das Momentum: Sie ziehen
 * nichts ab, und die Krankheitstage fallen aus dem Fenster (es reicht dafür weiter
 * zurück) – wer krank ist, verliert keinen Schwung.
 */
export function momentum(data, today = todayStr()) {
  const { sessions = [], plans = [] } = data;
  const protectedDay = typeof data.isProtectedDay === 'function' ? data.isProtectedDay : isProtectedDay;
  const stats = computeStats(data, today);
  const ill = illnessDays(plans, today, 60);

  const windowDays = new Set();
  for (let i = 0, d = today; windowDays.size < 15 && i < 60; i++, d = addDays(d, -1)) if (!ill.has(d)) windowDays.add(d);

  const perWeek = new Map();
  activeDateSet(sessions, plans).forEach((d) => {
    if (!windowDays.has(d)) return;
    const ws = weekStartMonday(d);
    perWeek.set(ws, (perWeek.get(ws) || 0) + 1);
  });
  let activeDays = 0;
  perWeek.forEach((n) => { activeDays += Math.min(MOMENTUM_DAYS_PER_WEEK, n); });

  let missed = 0;
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (!u || !windowDays.has(u.date) || u.type === 'rest' || protectedDay(u.date) || isHealthMiss(u)) return;
    if (u.status === 'verpasst' || (u.date < today && u.status !== 'erledigt')) missed++;
  }));

  let score = 42 + activeDays * 6 - missed * 8 + Math.min(stats.streak, 10) * 2;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const paused = (ill.has(today) || ill.has(addDays(today, -1)))
    && !(sessions || []).some((s) => s && !s.deleted && s.date === today);

  const level = score >= 75 ? t('badges.level.blazing') : score >= 50 ? t('badges.level.rolling') : score >= 25 ? t('badges.level.spark') : t('badges.level.embers');
  const flames = score >= 75 ? '🔥🔥🔥' : score >= 50 ? '🔥🔥' : score >= 25 ? '🔥' : '✨';
  const weeks = stats.streak;
  const message = paused
    ? t('badges.message.paused')
    : score >= 75
      ? (weeks ? tp('badges.messageBlazingWeeks', weeks) : t('badges.messageBlazing'))
      : score >= 50
        ? t('badges.message.good')
        : score >= 25
          ? t('badges.message.spark')
          : missed > 0
            ? t('badges.message.fading')
            : t('badges.message.start');
  return { score, level, flames, missed, activeDays, done14: activeDays, streak: weeks, paused, message };
}

/* --------------------------- „Neu freigeschaltet“ ----------------------- */
function loadSeen() { try { return new Set(JSON.parse(lsGet('seenBadges') || '[]')); } catch { return new Set(); } }

/** Liefert neu erreichte Badges seit dem letzten Aufruf und merkt sie vor. */
export function newlyUnlocked(data, today = todayStr()) {
  const seen = loadSeen();
  const unlocked = evaluateBadges(data, today).filter((b) => b.unlocked);
  const fresh = unlocked.filter((b) => !seen.has(b.id));
  return fresh;
}
export function markSeen(ids) {
  const seen = loadSeen();
  ids.forEach((id) => seen.add(id));
  lsSet('seenBadges', JSON.stringify([...seen]));
}
/** Alle aktuell erreichten Badges als gesehen markieren (z. B. nach Anzeige). */
export function markAllSeen(data, today = todayStr()) {
  markSeen(evaluateBadges(data, today).filter((b) => b.unlocked).map((b) => b.id));
}

/* ------------------------------- Ansicht -------------------------------- */
/** Datenbasis für Abzeichen und Momentum der angemeldeten Person (eigene Sicht:
    mit Zyklus-Einträgen, sofern das Modul aktiv ist). Dashboard und Erfolgsseite
    nutzen dieselbe Quelle – so feiert der Toast genau, was die Seite zeigt. */
export function badgeData() {
  return {
    sessions: store.get('sessions'), plans: store.get('plans'), health: store.get('health'), events: store.get('events'),
    profile: store.profile(), cycle: cycleEnabled() ? store.get('cycle') : [],
  };
}

export function render(view) {
  setHeader({ title: t('nav.progress') });
  view.appendChild(progressTabs('#/badges'));
  const data = badgeData();
  const today = todayStr();
  const m = momentum(data, today);
  const badges = evaluateBadges(data, today);
  const unlockedCount = badges.filter((b) => b.unlocked).length;

  // Momentum-Hero
  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: t('badges.hero.eyebrow') }),
    el('div', { class: 'hero__row', style: { alignItems: 'center', marginTop: '6px' } }, [
      el('div', {}, [
        el('div', { style: { fontSize: '2.4rem', lineHeight: '1' }, text: m.flames }),
        el('div', { style: { fontWeight: '800', fontSize: '1.25rem', marginTop: '4px' }, text: m.level }),
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        el('div', { class: 'num', style: { fontSize: '2.6rem', fontWeight: '800', lineHeight: '1' }, text: String(m.score) }),
        el('div', { style: { opacity: '.85', fontSize: '.72rem' }, text: t('badges.hero.momentum') }),
      ]),
    ]),
    el('div', { style: { marginTop: '10px', opacity: '.95', fontSize: '.9rem', position: 'relative' }, text: m.message }),
  ]));

  // Abzeichen – nach Aufwand gruppiert, die anspruchsvollste Stufe zuerst.
  view.appendChild(sectionHead(t('badges.heading', { got: unlockedCount, total: badges.length })));
  TIERS.forEach(({ tier, label, color }) => {
    const group = badges.filter((b) => (b.tier || 1) === tier);
    if (!group.length) return;
    const got = group.filter((b) => b.unlocked).length;
    view.appendChild(el('div', { class: `badge-tier-head badge-tier-head--t${tier}` }, [
      el('span', { class: 'badge-tier-dot', style: { background: color } }),
      el('span', { class: 'badge-tier-label', text: label }),
      el('span', { class: 'badge-tier-count', text: `${got}/${group.length}` }),
    ]));
    const grid = el('div', { class: 'badge-grid' });
    // freigeschaltete innerhalb der Stufe zuerst (motivierend), sonst Definitionsreihenfolge
    group.slice().sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0)).forEach((b) => grid.appendChild(badgeCard(b)));
    view.appendChild(grid);
  });

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.78rem' }, text: t('badges.footnote') }));

  // Erreichte als „gesehen“ markieren (keine erneute Feier).
  markAllSeen(data, today);
}

// Weiches Trennzeichen (U+00AD) vor dem Hauptwort zusammengesetzter Substantive:
// Lange Namen brechen dort um – MIT Trennstrich („Tausend-/sassa“), nur wenn nötig.
// Das Null-Breiten-Leerzeichen brach ohne Strich um und las sich wie ein Fehler (UI-42).
const WRAP_PARTS = [
  'bummler', 'meister', 'st\u00fcrmer', 'sammler', 'champion', 'sieger', 'ratte',
  'paket', 'k\u00e4mpfer', 'fahrer', 'geher', 'probe', 'liebe', 'sassa', 'rounder', 'held',
];
export function softWrap(text) {
  if (locale() !== 'de') return text;   // the word parts below are German
  let out = text;
  for (const p of WRAP_PARTS) out = out.replace(new RegExp(`(.)(${p})`, 'g'), `$1\u00ad$2`);
  return out;
}

function badgeCard(b) {
  const card = el('div', { class: `badge-card badge-card--t${b.tier || 1} ${b.unlocked ? 'is-unlocked' : ''}` }, [
    el('div', { class: 'badge-card__emoji', text: b.emoji }),
    el('div', { class: 'badge-card__name', text: softWrap(b.name) }),
    el('div', { class: 'badge-card__desc', text: softWrap(b.desc) }),
  ]);
  if (b.unlocked) {
    card.appendChild(el('div', { class: 'badge-card__check', text: t('badges.earned') }));
  } else if (b.target > 1) {
    card.appendChild(el('div', { class: 'badge-progress' }, el('i', { style: { width: `${Math.round(b.progress * 100)}%` } })));
    card.appendChild(el('div', { class: 'badge-card__prog', text: `${fmtNum(Math.min(b.cur, b.target), b.cur % 1 ? 1 : 0)} / ${b.target}` }));
  }
  return card;
}
