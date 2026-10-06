/* =========================================================================
   badges.js — reward system: achievement badges + momentum.
   Philosophy "motivation without pressure": many positive, humorous badges;
   the momentum (a momentum flame) reacts gently to consistency – it
   shrinks when there are gaps, but always words things encouragingly rather than punitively.

   Badges are calculated live from the existing data. The "already seen"
   list sits client-side in LocalStorage (the celebration does not need to sync).
   ========================================================================= */

import { diffDays, todayStr, addDays, typeMeta, el, iconSvg, sectionHead, fmtNum, weekStart, fmtKm } from './ui.js';
import { kmToShown, distanceUnit } from './units.js';
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

/** Training days: date of every session and of every completed plan session. */
function activeDateSet(sessions = [], plans = []) {
  const active = new Set((sessions || []).filter((s) => s && !s.deleted && s.date).map((s) => s.date));
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => { if (u && u.status === 'erledigt') active.add(u.date); }));
  return active;
}

/** Days with a health-related absence (ill, injured) in the last `days` days –
    gaps of up to 3 days between two such absences count too (the illness
    continues on days without a planned session as well). */
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
 * Weekly streak: consecutive calendar weeks (the person's week, units().weekStart) with at least `minDays`
 * training days. The current week counts as soon as it reaches the goal – while
 * it is still running, it does not break the streak. Rest days preserve the streak: what is
 * rewarded is regularity, not training without a break (previously "days in a row" counted, and the
 * highest badges demanded 60 days without a rest day). Weeks with an illness- or
 * injury-related absence pause the streak instead of breaking it.
 */
export function weekStreak({ sessions = [], plans = [] } = {}, today = todayStr(), minDays = 3) {
  const active = activeDateSet(sessions, plans);
  const sick = new Set();
  (plans || []).forEach((p) => ((p && p.units) || []).forEach((u) => { if (isHealthMiss(u)) sick.add(u.date); }));
  const count = (ws) => { let n = 0; for (let i = 0; i < 7; i++) if (active.has(addDays(ws, i))) n++; return n; };
  const hasSick = (ws) => { for (let i = 0; i < 7; i++) if (sick.has(addDays(ws, i))) return true; return false; };
  let ws = weekStart(today);
  let streak = count(ws) >= minDays ? 1 : 0;
  for (let guard = 0; guard < 520; guard++) {
    ws = addDays(ws, -7);
    if (count(ws) >= minDays) streak++;
    else if (!hasSick(ws)) break;
  }
  return streak;
}


/* ------------------------- Metrics from the existing data ------------------- */
/**
 * Metrics for badges and momentum. `data.isProtectedDay` (optional) replaces the
 * cycle rule of the signed-in person – the team dashboard passes `() => false`,
 * because there is no cycle data for other members (and there must not be).
 * `data.cycle` (optional, own view only) counts the logged period starts.
 */
export function computeStats(data = {}, today = todayStr()) {
  const { sessions = [], plans = [], health = [], events = [], profile = {}, cycle = [] } = data;
  const protectedDay = typeof data.isProtectedDay === 'function' ? data.isProtectedDay : isProtectedDay;
  const run = sessions.filter((s) => !s.deleted);
  const totalSessions = run.length;
  // "km collected": all sports with a distance. The longest RUN counts only runs –
  // otherwise a 40 km bike ride would unlock "A run over 21 km".
  const totalKm = run.reduce((a, s) => a + (s.distanceKm || 0), 0);
  const longestRun = run.filter(isRunSession).reduce((m, s) => Math.max(m, s.distanceKm || 0), 0);
  const intervalCount = run.filter((s) => s.type === 'interval').length;
  const qualityCount = run.filter((s) => ['tempo', 'interval'].includes(s.type)).length;

  // Weekly streak (calendar weeks with ≥ 3 training days); rest days preserve the streak.
  const streak = weekStreak({ sessions: run, plans }, today);

  // Plan adherence – same definition as statistics, race page and monthly report.
  const adherence = planAdherence(plans, { today, isProtectedDay: protectedDay }).pct ?? 0;

  // Cycle logged (neutral: rewards logging, not training despite a period).
  const cycleStarts = periodStarts(cycle).length;

  // Perfect week: any past plan week fully completed.
  let perfectWeek = false;
  plans.forEach((p) => {
    const byWeek = {};
    // Derive the week from the date (not from u.week): otherwise manually
    // created sessions without a `week` field land together in the "undefined" bucket and
    // could wrongly trigger a "Perfect week".
    (p.units || []).forEach((u) => {
      if (u.type === 'rest') return;
      const wk = weekOfDate(p, u.date) ?? u.week;
      (byWeek[wk] ||= []).push(u);
    });
    Object.values(byWeek).forEach((list) => {
      if (list.length && list.every((u) => u.date < today) && list.every((u) => u.status === 'erledigt')) perfectWeek = true;
    });
  });

  // Weight: has the target weight ever been reached?
  const target = profile.targetWeightKg;
  const minWeight = health.filter((h) => h.weight != null).reduce((m, h) => Math.min(m, h.weight), Infinity);
  const weightReached = target != null && minWeight <= target;

  // Race finished.
  const raceFinished = run.some((s) => s.type === 'race') || events.some((e) => e.status === 'abgeschlossen');

  // Sleep streak: 7 of the latest entries ≥ 7 h.
  const sleepStreak = health.filter((h) => h.sleepHours != null).sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7).filter((h) => h.sleepHours >= 7).length;

  const soberStreak = alcoholFreeStreak(health, today) || 0;

  // Sport counters (per training type) + variety
  const byType = {};
  run.forEach((s) => { if (s.type) byType[s.type] = (byType[s.type] || 0) + 1; });
  const cnt = (type) => byType[type] || 0;
  const distinctTypes = Object.keys(byType).filter((type) => type !== 'rest').length;
  const distinctCats = new Set(run.map((s) => typeMeta(s.type).cat).filter((c) => c && c !== 'rest')).size;
  const marathonRun = longestRun >= 42;

  // Event/race types (completed events)
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
    // Sports
    byType, distinctTypes, distinctCats, marathonRun,
    swimCount: cnt('swim'), hikeCount: cnt('hike'), rowingCount: cnt('rowing'),
    bikeCount: cnt('cross_bike') + cnt('spinning'), strengthCount: cnt('strength') + cnt('gym'),
    racketCount: cnt('tennis') + cnt('badminton') + cnt('squash') + cnt('tabletennis'),
    walkCount: cnt('walk'),
    // Event types
    racesFinishedCount, programsDone, distinctDistances, hyroxDone, triathlonDone,
  };
}

/* ------------------------------- Badges --------------------------------- */
/** A run length for the badge texts: whole km, miles to a tenth (15 km = 9.3 mi). */
const runKm = (km) => fmtKm(km, distanceUnit() === 'mi' ? 1 : 0);
// Each badge: emoji, name, desc, category and a progress function (`km`: progress in kilometres).
// tier = effort/difficulty: 4 Legendary · 3 Epic · 2 Advanced · 1 Beginner.
export const TIERS = [
  { tier: 4, get label() { return t('badges.tiers.legendary'); }, color: '#f5a623' },
  { tier: 3, get label() { return t('badges.tiers.epic'); }, color: '#7c5cff' },
  { tier: 2, get label() { return t('badges.tiers.advanced'); }, color: '#3d8bff' },
  { tier: 1, get label() { return t('badges.tiers.beginner'); }, color: '#43c59e' },
];

export const BADGES = [
  /* ---- Getting started & consistency ---- */
  { id: 'first', tier: 1, emoji: '🌱', get name() { return t('badges.items.first.name'); }, cat: 'Start', get desc() { return t('badges.items.first.desc'); }, p: (s) => [s.totalSessions, 1] },
  // Consistency in weeks (≥ 3 training days per week) – rest days are part of it.
  { id: 'weeks3', tier: 1, emoji: '🔥', get name() { return t('badges.items.weeks3.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks3.desc'); }, p: (s) => [s.streak, 3] },
  { id: 'weeks6', tier: 2, emoji: '💪', get name() { return t('badges.items.weeks6.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks6.desc'); }, p: (s) => [s.streak, 6] },
  { id: 'weeks12', tier: 3, emoji: '⚡', get name() { return t('badges.items.weeks12.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks12.desc'); }, p: (s) => [s.streak, 12] },
  { id: 'weeks26', tier: 4, emoji: '🏔️', get name() { return t('badges.items.weeks26.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks26.desc'); }, p: (s) => [s.streak, 26] },
  { id: 'weeks52', tier: 4, emoji: '❄️', get name() { return t('badges.items.weeks52.name'); }, cat: 'Konstanz', get desc() { return t('badges.items.weeks52.desc'); }, p: (s) => [s.streak, 52] },

  /* ---- Volume (trainings) ---- */
  { id: 'count10', tier: 1, emoji: '📦', get name() { return t('badges.items.count10.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count10.desc'); }, p: (s) => [s.totalSessions, 10] },
  { id: 'count50', tier: 3, emoji: '🎯', get name() { return t('badges.items.count50.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count50.desc'); }, p: (s) => [s.totalSessions, 50] },
  { id: 'count100', tier: 4, emoji: '👑', get name() { return t('badges.items.count100.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count100.desc'); }, p: (s) => [s.totalSessions, 100] },
  { id: 'count200', tier: 4, emoji: '🏛️', get name() { return t('badges.items.count200.name'); }, cat: 'Umfang', get desc() { return t('badges.items.count200.desc'); }, p: (s) => [s.totalSessions, 200] },

  /* ---- Distance (km; thresholds stay metric, the texts show the person's unit) ---- */
  { id: 'km100', tier: 2, emoji: '🛣️', get name() { return t('badges.items.km100.name', { distance: fmtKm(100, 0) }); }, cat: 'Distanz', get desc() { return t('badges.items.km100.desc', { distance: fmtKm(100, 0) }); }, p: (s) => [s.totalKm, 100], km: true },
  { id: 'km500', tier: 3, emoji: '🚀', get name() { return t('badges.items.km500.name', { distance: fmtKm(500, 0) }); }, cat: 'Distanz', get desc() { return t('badges.items.km500.desc', { distance: fmtKm(500, 0) }); }, p: (s) => [s.totalKm, 500], km: true },
  { id: 'km1000', tier: 4, emoji: '🌍', get name() { return t('badges.items.km1000.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km1000.desc', { distance: fmtKm(1000, 0) }); }, p: (s) => [s.totalKm, 1000], km: true },
  { id: 'km2000', tier: 4, emoji: '✈️', get name() { return t('badges.items.km2000.name'); }, cat: 'Distanz', get desc() { return t('badges.items.km2000.desc', { distance: fmtKm(2000, 0) }); }, p: (s) => [s.totalKm, 2000], km: true },

  /* ---- Long Run & Tempo ---- */
  { id: 'long15', tier: 2, emoji: '🦵', get name() { return t('badges.items.long15.name'); }, cat: 'Long Run', get desc() { return t('badges.items.long15.desc', { distance: runKm(15) }); }, p: (s) => [s.longestRun, 15], km: true },
  { id: 'long21', tier: 3, emoji: '🏃‍♀️', get name() { return t('badges.items.long21.name'); }, cat: 'Long Run', get desc() { return t('badges.items.long21.desc', { distance: runKm(21) }); }, p: (s) => [s.longestRun, 21], km: true },
  { id: 'marathon', tier: 4, emoji: '🏁', get name() { return t('badges.items.marathon.name'); }, cat: 'Long Run', get desc() { return t('badges.items.marathon.desc', { distance: runKm(42) }); }, p: (s) => [s.longestRun, 42], km: true },
  { id: 'quality1', tier: 1, emoji: '🌶️', get name() { return t('badges.items.quality1.name'); }, cat: 'Tempo', get desc() { return t('badges.items.quality1.desc'); }, p: (s) => [s.qualityCount, 1] },
  { id: 'interval10', tier: 3, emoji: '🎡', get name() { return t('badges.items.interval10.name'); }, cat: 'Tempo', get desc() { return t('badges.items.interval10.desc'); }, p: (s) => [s.intervalCount, 10] },

  /* ---- Sports: swimming ---- */
  { id: 'swim1', tier: 1, emoji: '🏊', get name() { return t('badges.items.swim1.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim1.desc'); }, p: (s) => [s.swimCount, 1] },
  { id: 'swim10', tier: 2, emoji: '🌊', get name() { return t('badges.items.swim10.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim10.desc'); }, p: (s) => [s.swimCount, 10] },
  { id: 'swim25', tier: 3, emoji: '🐬', get name() { return t('badges.items.swim25.name'); }, cat: 'Schwimmen', get desc() { return t('badges.items.swim25.desc'); }, p: (s) => [s.swimCount, 25] },

  /* ---- Sports: hiking & walking ---- */
  { id: 'hike1', tier: 1, emoji: '🥾', get name() { return t('badges.items.hike1.name'); }, cat: 'Wandern', get desc() { return t('badges.items.hike1.desc'); }, p: (s) => [s.hikeCount, 1] },
  { id: 'hike10', tier: 3, emoji: '⛰️', get name() { return t('badges.items.hike10.name'); }, cat: 'Wandern', get desc() { return t('badges.items.hike10.desc'); }, p: (s) => [s.hikeCount, 10] },
  { id: 'walk10', tier: 1, emoji: '🚶', get name() { return t('badges.items.walk10.name'); }, cat: 'Gehen', get desc() { return t('badges.items.walk10.desc'); }, p: (s) => [s.walkCount, 10] },

  /* ---- Sports: rowing ---- */
  { id: 'row1', tier: 1, emoji: '🚣', get name() { return t('badges.items.row1.name'); }, cat: 'Rudern', get desc() { return t('badges.items.row1.desc'); }, p: (s) => [s.rowingCount, 1] },
  { id: 'row10', tier: 3, emoji: '🛶', get name() { return t('badges.items.row10.name'); }, cat: 'Rudern', get desc() { return t('badges.items.row10.desc'); }, p: (s) => [s.rowingCount, 10] },

  /* ---- Sports: setback, cycling, strength ---- */
  { id: 'racket1', tier: 1, emoji: '🎾', get name() { return t('badges.items.racket1.name'); }, cat: 'Rückschlag', get desc() { return t('badges.items.racket1.desc'); }, p: (s) => [s.racketCount, 1] },
  { id: 'racket10', tier: 2, emoji: '🏓', get name() { return t('badges.items.racket10.name'); }, cat: 'Rückschlag', get desc() { return t('badges.items.racket10.desc'); }, p: (s) => [s.racketCount, 10] },
  { id: 'bike10', tier: 2, emoji: '🚴', get name() { return t('badges.items.bike10.name'); }, cat: 'Radsport', get desc() { return t('badges.items.bike10.desc'); }, p: (s) => [s.bikeCount, 10] },
  { id: 'strength10', tier: 2, emoji: '🏋️', get name() { return t('badges.items.strength10.name'); }, cat: 'Kraft', get desc() { return t('badges.items.strength10.desc'); }, p: (s) => [s.strengthCount, 10] },
  { id: 'strength50', tier: 4, emoji: '🦾', get name() { return t('badges.items.strength50.name'); }, cat: 'Kraft', get desc() { return t('badges.items.strength50.desc'); }, p: (s) => [s.strengthCount, 50] },

  /* ---- Variety ---- */
  { id: 'variety5', tier: 2, emoji: '🎨', get name() { return t('badges.items.variety5.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.variety5.desc'); }, p: (s) => [s.distinctTypes, 5] },
  { id: 'cats4', tier: 3, emoji: '🤹', get name() { return t('badges.items.cats4.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.cats4.desc'); }, p: (s) => [s.distinctCats, 4] },
  { id: 'variety10', tier: 4, emoji: '🌈', get name() { return t('badges.items.variety10.name'); }, cat: 'Vielfalt', get desc() { return t('badges.items.variety10.desc'); }, p: (s) => [s.distinctTypes, 10] },

  /* ---- Event types / races ---- */
  { id: 'race', tier: 3, emoji: '🏅', get name() { return t('badges.items.race.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.race.desc'); }, p: (s) => [s.racesFinishedCount, 1] },
  { id: 'races3', tier: 4, emoji: '🥇', get name() { return t('badges.items.races3.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.races3.desc'); }, p: (s) => [s.racesFinishedCount, 3] },
  { id: 'dist3', tier: 3, emoji: '🎽', get name() { return t('badges.items.dist3.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.dist3.desc'); }, p: (s) => [s.distinctDistances, 3] },
  { id: 'hyrox', tier: 4, emoji: '🤸', get name() { return t('badges.items.hyrox.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.hyrox.desc'); }, p: (s) => [s.hyroxDone ? 1 : 0, 1] },
  { id: 'triathlon', tier: 4, emoji: '🔱', get name() { return t('badges.items.triathlon.name'); }, cat: 'Wettkampf', get desc() { return t('badges.items.triathlon.desc'); }, p: (s) => [s.triathlonDone ? 1 : 0, 1] },
  { id: 'program1', tier: 2, emoji: '📋', get name() { return t('badges.items.program1.name'); }, cat: 'Programm', get desc() { return t('badges.items.program1.desc'); }, p: (s) => [s.programsDone, 1] },
  { id: 'program3', tier: 4, emoji: '🎖️', get name() { return t('badges.items.program3.name'); }, cat: 'Programm', get desc() { return t('badges.items.program3.desc'); }, p: (s) => [s.programsDone, 3] },

  /* ---- Plan & health ---- */
  { id: 'perfectweek', tier: 2, emoji: '📅', get name() { return t('badges.items.perfectweek.name'); }, cat: 'Plan', get desc() { return t('badges.items.perfectweek.desc'); }, p: (s) => [s.perfectWeek ? 1 : 0, 1] },
  { id: 'adherence90', tier: 3, emoji: '🤝', get name() { return t('badges.items.adherence90.name'); }, cat: 'Plan', get desc() { return t('badges.items.adherence90.desc'); }, p: (s) => [s.adherence, 90] },
  { id: 'weight', tier: 3, emoji: '⚖️', get name() { return t('badges.items.weight.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.weight.desc'); }, p: (s) => [s.weightReached ? 1 : 0, 1] },
  { id: 'sleep7', tier: 2, emoji: '😴', get name() { return t('badges.items.sleep7.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sleep7.desc'); }, p: (s) => [s.sleepStreak, 7] },
  { id: 'sober7', tier: 2, emoji: '🌿', get name() { return t('badges.items.sober7.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sober7.desc'); }, p: (s) => [s.soberStreak, 7] },
  { id: 'sober30', tier: 4, emoji: '💎', get name() { return t('badges.items.sober30.name'); }, cat: 'Gesundheit', get desc() { return t('badges.items.sober30.desc'); }, p: (s) => [s.soberStreak, 30] },
  { id: 'cycle3', tier: 1, emoji: '🌙', get name() { return t('badges.items.cycle3.name'); }, cat: 'Zyklus', get desc() { return t('badges.items.cycle3.desc'); }, p: (s) => [s.cycleStarts, 3] },
];

/** Badges that arise only from training data – the team dashboard counts only
    these (it never sees health and cycle data of other members). */
export const TRAINING_BADGE_CATS = new Set(['Start', 'Konstanz', 'Umfang', 'Distanz', 'Long Run', 'Tempo',
  'Schwimmen', 'Wandern', 'Gehen', 'Rudern', 'Rückschlag', 'Radsport', 'Kraft', 'Vielfalt', 'Wettkampf', 'Programm', 'Plan']);

/** Evaluates all badges against the current metrics. */
export function evaluateBadges(data, today = todayStr()) {
  const stats = computeStats(data, today);
  return BADGES.map((b) => {
    const [cur, target] = b.p(stats);
    const progress = Math.max(0, Math.min(1, cur / target));
    return { ...b, cur, target, progress, unlocked: cur >= target };
  });
}

/* ------------------------------ Momentum -------------------------------- */
/** At most this many training days per calendar week raise the momentum – more
    training without a rest day brings no additional momentum. */
const MOMENTUM_DAYS_PER_WEEK = 5;

/**
 * Momentum value (0–100) from the training days of the last 15 days, open gaps and
 * the weekly streak. Health-related absences pause the momentum: they deduct
 * nothing, and the illness days drop out of the window (it reaches further
 * back for that) – anyone who is ill loses no momentum.
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
    const ws = weekStart(d);   // capped per week as the person counts weeks, like the streak
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

/* --------------------------- "Newly unlocked" ----------------------- */
function loadSeen() { try { return new Set(JSON.parse(lsGet('seenBadges') || '[]')); } catch { return new Set(); } }

/** Returns badges newly reached since the last call and remembers them. */
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
/** Mark all currently reached badges as seen (e.g. after they have been shown). */
export function markAllSeen(data, today = todayStr()) {
  markSeen(evaluateBadges(data, today).filter((b) => b.unlocked).map((b) => b.id));
}

/* ------------------------------- View -------------------------------- */
/** Data basis for badges and momentum of the signed-in person (own view:
    with cycle entries, provided the module is active). Dashboard and achievements page
    use the same source – so the toast celebrates exactly what the page shows. */
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

  // Badges – grouped by effort, the most demanding tier first.
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
    // unlocked ones first within the tier (motivating), otherwise definition order
    group.slice().sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0)).forEach((b) => grid.appendChild(badgeCard(b)));
    view.appendChild(grid);
  });

  view.appendChild(el('p', { class: 'dim center mt-6', style: { fontSize: '.78rem' }, text: t('badges.footnote') }));

  // Mark reached ones as "seen" (no renewed celebration).
  markAllSeen(data, today);
}

// Soft hyphen (U+00AD) before the head noun of German compound nouns:
// long names wrap there – WITH a hyphen ("Tausend-/sassa"), only when needed.
// The zero-width space wrapped without a hyphen and read like an error (UI-42).
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
    // Distance badges count kilometres; a person on miles sees the progress in miles.
    const miles = b.km && distanceUnit() === 'mi';
    const cur = Math.min(b.cur, b.target);
    card.appendChild(el('div', { class: 'badge-card__prog', text: miles
      ? `${fmtNum(kmToShown(cur), 1)} / ${fmtNum(kmToShown(b.target), 0)}`
      : `${fmtNum(cur, b.cur % 1 ? 1 : 0)} / ${b.target}` }));
  }
  return card;
}
