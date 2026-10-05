/* =========================================================================
   report.js — creates immutable report/certificate snapshots.

   Pure, DOM-free logic: from the raw data (profile, sessions, plans, values,
   events) a frozen record is built that is afterwards only
   displayed/printed. Three types:
   - month: monthly report (training, adherence, values, achievements)
   - event: race/event report (preparation + result + conclusion)
   - goal:  certificate for an achieved goal

   No external sources. Covered by node:test.
   ========================================================================= */

import { diffDays, fmtKm, fmtDuration, fmtDate, typeMeta, parseHms, fmtDec, monthName } from './ui.js';
import { evaluateBadges, momentum } from './badges.js';
import { adherence, isRunSession } from './fitness.js';

import { t, tp } from './i18n.js';

function pad2(n) { return String(n).padStart(2, '0'); }
function hms(sec) {
  if (sec == null) return '–';
  const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
}
function live(arr) { return (arr || []).filter((r) => r && !r.deleted); }

/** {from,to,label} for 'YYYY-MM'. */
export function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${pad2(last)}`, label: `${monthName(m - 1)} ${y}` };
}

function inRange(items, key, from, to) { return live(items).filter((s) => s[key] >= from && s[key] <= to); }

/** Aggregates a session list into figures. `km` = kilometres run (like
    "running km" in statistics and on "Today"); the distances of cycling, walking, hiking
    and swimming are listed separately in `otherKm`. */
export function aggregateSessions(sessions) {
  let km = 0, otherKm = 0, dur = 0; const days = new Set(); const byType = {};
  for (const s of sessions) {
    if (isRunSession(s)) km += Number(s.distanceKm) || 0;
    else otherKm += Number(s.distanceKm) || 0;
    dur += s.durationSec || 0;
    if (s.date) days.add(s.date);
    const label = typeMeta(s.type).label;
    byType[label] = (byType[label] || 0) + 1;
  }
  return { count: sessions.length, km, otherKm, durationSec: dur, activeDays: days.size, byType };
}

/** Reference date of a report: end of the window, at most today – future sessions are
    not yet due (a report sealed before the end of the month would otherwise lock in too
    low an adherence permanently). */
function asOfDate(to, today) { return today && today < to ? today : to; }

/** Median of a list of numbers (rounded to 0.1). */
function median(vals) {
  const v = vals.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 10) / 10;
}

/**
 * Weight at the start and end of the month as a 7-day median (first and last measurement week of the month).
 * Comparing two single measurements would have locked day-to-day fluctuations of ± 1 kg into the sealed
 * report.
 */
function weightDelta(health, from, to) {
  const hs = inRange(health, 'date', from, to)
    .filter((h) => h.weight != null && h.weight !== '' && Number.isFinite(Number(h.weight)))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (hs.length < 1) return null;
  const first = hs[0].date, last = hs[hs.length - 1].date;
  const start = median(hs.filter((h) => diffDays(first, h.date) < 7).map((h) => Number(h.weight)));
  const end = median(hs.filter((h) => diffDays(h.date, last) < 7).map((h) => Number(h.weight)));
  return { start, end, delta: Math.round((end - start) * 10) / 10 };
}

function unlockedBadges(data, asOf) {
  return evaluateBadges(data, asOf).filter((b) => b.unlocked).map((b) => `${b.emoji} ${b.name}`);
}

/* ----------------------------- Monthly report ---------------------------- */
export function buildMonthReport({ profile = {}, sessions = [], plans = [], health = [], events = [], monthStr, today, showWeight = true, isProtectedDay = () => false } = {}) {
  const { from, to, label } = monthRange(monthStr);
  const asOf = asOfDate(to, today);
  const inMonth = inRange(sessions, 'date', from, to);
  const agg = aggregateSessions(inMonth);
  const adh = adherence(live(plans), { from, to: asOf, today: asOf, isProtectedDay });
  const w = showWeight ? weightDelta(health, from, to) : null;
  const mom = momentum({ sessions, plans, health, events, profile, isProtectedDay }, asOf);

  const training = [
    { label: t('report.trainingSessions'), value: String(agg.count) },
    { label: t('report.activeDays'), value: String(agg.activeDays) },
    { label: t('report.kmRunLabel'), value: fmtKm(agg.km, 0) },
  ];
  if (agg.otherKm > 0) training.push({ label: t('report.otherKmMonth'), value: fmtKm(agg.otherKm, 0) });
  training.push({ label: t('report.trainingTime'), value: fmtDuration(agg.durationSec) });
  if (adh.pct != null) training.push({ label: t('report.planAdherence'), value: t('report.adherenceValue', { pct: adh.pct, done: adh.done, due: adh.due }) });

  const verteilung = Object.entries(agg.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: String(v) }));

  const sections = [{ heading: t('report.headingTraining'), items: training }];
  if (verteilung.length) sections.push({ heading: t('report.headingMix'), items: verteilung });
  const kg = (v) => `${fmtDec(v)} kg`;
  if (w) sections.push({ heading: t('report.headingWeight'), items: [
    { label: t('report.weightStart'), value: kg(w.start) },
    { label: t('report.weightEnd'), value: kg(w.end) },
    { label: t('report.weightChange'), value: `${w.delta > 0 ? '+' : ''}${kg(w.delta)}` },
  ] });

  const verdict = agg.count === 0
    ? t('report.verdictEmpty')
    : t('report.verdictMonth', {
      sessions: tp('report.sessionsCount', agg.count), days: tp('report.onDays', agg.activeDays),
      km: agg.km > 0 ? t('report.kmRun', { km: fmtKm(agg.km, 0) }) : '', level: mom.level,
    });

  return {
    type: 'month',
    title: t('report.titleMonth', { label }),
    subtitle: profile.name ? t('report.forName', { name: profile.name }) : '',
    subject: { name: profile.name || '' },
    // Current month: the state as of now is in the (sealed) report – otherwise a report from the
    // 28th looked like a complete month (UI-39).
    period: { label, from, to, ...(asOf < to ? { asOf } : {}) },
    sections,
    highlights: unlockedBadges({ sessions, plans, health, events, profile, isProtectedDay }, asOf),
    verdict,
  };
}

/* --------------------------- Race/event report -------------------- */
export function buildEventReport({ profile = {}, event = {}, plan = null, sessions = [], health = [], today, isProtectedDay = () => false } = {}) {
  const start = plan?.startDate || null;
  const end = event.date;
  const prepSessions = start ? live(sessions).filter((s) => s.date >= start && s.date <= end) : [];
  const agg = aggregateSessions(prepSessions);
  const asOf = asOfDate(end, today);
  const adh = start ? adherence(plan ? [plan] : [], { from: start, to: asOf, today: asOf, isProtectedDay }) : { due: 0, done: 0, pct: null };

  // Result: completed race session -> linked session, otherwise session on the event day
  const raceUnit = plan ? (plan.units || []).find((u) => u.type === 'race') : null;
  let result = raceUnit && raceUnit.executedSessionId ? live(sessions).find((s) => s.id === raceUnit.executedSessionId) : null;
  if (!result) result = live(sessions).find((s) => s.date === end && (s.type === 'race' || s.eventId === event.id));

  const targetSec = event.targetTime ? parseHms(event.targetTime) : null;
  const resultSec = result ? result.durationSec : null;
  const hit = targetSec != null && resultSec != null ? resultSec <= targetSec + 1 : null;

  const stamm = [
    { label: t('report.race'), value: event.name || '–' },
    { label: t('report.date'), value: event.date ? fmtDate(event.date) : '–' },
  ];
  if (event.distanceKm) stamm.push({ label: t('report.distance'), value: fmtKm(event.distanceKm, event.distanceKm % 1 ? 1 : 0) });
  if (event.targetTime) stamm.push({ label: t('report.targetTime'), value: event.targetTime });

  const vorbereitung = [
    { label: t('report.trainingPeriod'), value: start ? `${fmtDate(start)} – ${fmtDate(end)}` : '–' },
    { label: t('report.sessionsDone'), value: String(agg.count) },
    { label: t('report.kmRunLabel'), value: fmtKm(agg.km, 0) },
  ];
  if (agg.otherKm > 0) vorbereitung.push({ label: t('report.otherKmEvent'), value: fmtKm(agg.otherKm, 0) });
  if (adh.pct != null) vorbereitung.push({ label: t('report.planAdherence'), value: t('report.adherenceValue', { pct: adh.pct, done: adh.done, due: adh.due }) });

  const sections = [{ heading: t('report.headingFacts'), items: stamm }, { heading: t('report.headingPrep'), items: vorbereitung }];

  if (result) {
    const items = [{ label: t('report.finishTime'), value: hms(resultSec) }];
    if (result.distanceKm) items.push({ label: t('report.distance'), value: fmtKm(result.distanceKm, 1) });
    if (result.avgHr) items.push({ label: t('report.avgHr'), value: `${result.avgHr} bpm` });
    if (hit != null) items.push({ label: t('report.targetTime'), value: hit ? t('report.targetHit') : t('report.targetMissed') });
    sections.push({ heading: t('report.headingResult'), items });
  }

  let verdict;
  if (!result) {
    verdict = tp('report.verdictNoResult', agg.count, { km: fmtKm(agg.km, 0) });
  } else if (hit === true) {
    verdict = tp('report.verdictHit', agg.count, { time: hms(resultSec) });
  } else if (hit === false) {
    verdict = tp('report.verdictMiss', agg.count, { time: hms(resultSec) });
  } else {
    verdict = tp('report.verdictDone', agg.count, { time: hms(resultSec) });
  }

  return {
    type: 'event',
    title: t('report.titleEvent'),
    subtitle: event.name || '',
    subject: { name: profile.name || '' },
    period: { label: event.date ? fmtDate(event.date) : '', from: start, to: end },
    eventId: event.id || null,
    sections,
    highlights: unlockedBadges({ sessions, plans: plan ? [plan] : [], health, events: [event], profile, isProtectedDay }, asOf),
    verdict,
    result: result ? { timeSec: resultSec, hit } : null,
  };
}

/* -------------------------------- Certificate ------------------------------- */
export function buildGoalReport({ profile = {}, goalTitle, goalDetail = '', date } = {}) {
  const goal = sentenceEnd(`${goalTitle || ''}${goalDetail ? ' – ' + goalDetail : ''}`);
  return {
    type: 'goal',
    title: t('report.titleGoal'),
    subtitle: goalTitle || t('report.goalReached'),
    subject: { name: profile.name || '' },
    period: { label: date ? fmtDate(date) : '' },
    sections: goalDetail ? [{ heading: t('report.headingAchieved'), items: [{ label: goalTitle || t('report.goal'), value: goalDetail }] }] : [],
    highlights: [],
    verdict: profile.name ? t('report.goalVerdictNamed', { name: profile.name, goal }) : t('report.goalVerdict', { goal }),
    certificate: true,
  };
}

/** Sentence end without a double full stop (previously "… half marathon.. Great performance!"). */
function sentenceEnd(s) {
  const x = String(s || '').trim();
  return /[.!?…]$/.test(x) ? x : `${x}.`;
}
