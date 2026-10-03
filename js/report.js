/* =========================================================================
   report.js — erzeugt unveränderliche Report-/Urkunden-Snapshots.

   Reine, DOM-freie Logik: aus den Roh-Daten (Profil, Sessions, Pläne, Werte,
   Events) wird ein eingefrorener Datensatz gebaut, der später nur noch
   angezeigt/gedruckt wird. Drei Typen:
   - month: Monatsbericht (Training, Einhaltung, Werte, Erfolge)
   - event: Wettkampf-/Event-Bericht (Vorbereitung + Ergebnis + Fazit)
   - goal:  Urkunde für ein erreichtes Ziel

   Keine externen Quellen. Per node:test abgedeckt.
   ========================================================================= */

import { diffDays, fmtKm, fmtDuration, fmtDate, typeMeta, parseHms, fmtDec } from './ui.js';
import { evaluateBadges, momentum } from './badges.js';
import { adherence, isRunSession } from './fitness.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function pad2(n) { return String(n).padStart(2, '0'); }
function hms(sec) {
  if (sec == null) return '–';
  const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
}
function live(arr) { return (arr || []).filter((r) => r && !r.deleted); }

/** {from,to,label} für 'YYYY-MM'. */
export function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${pad2(last)}`, label: `${MONTHS[m - 1]} ${y}` };
}

function inRange(items, key, from, to) { return live(items).filter((s) => s[key] >= from && s[key] <= to); }

/** Aggregiert eine Session-Liste zu Kennzahlen. `km` = gelaufene Kilometer (wie
    „Lauf-km“ in Statistik und auf „Heute“); die Strecken von Rad, Gehen, Wandern
    und Schwimmen stehen getrennt in `otherKm`. */
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

/** Stichtag eines Berichts: Fensterende, höchstens heute – künftige Einheiten sind
    noch nicht fällig (ein vor Monatsende versiegelter Bericht hielte sonst eine zu
    niedrige Einhaltung dauerhaft fest). */
function asOfDate(to, today) { return today && today < to ? today : to; }

/** Median einer Zahlenliste (auf 0,1 gerundet). */
function median(vals) {
  const v = vals.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 10) / 10;
}

/**
 * Gewicht zu Monatsbeginn und -ende als 7-Tage-Median (erste bzw. letzte Messwoche im Monat).
 * Zwei Einzelmessungen zu vergleichen hätte Tagesschwankungen von ± 1 kg im versiegelten
 * Bericht festgeschrieben.
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

/* ----------------------------- Monatsbericht ---------------------------- */
export function buildMonthReport({ profile = {}, sessions = [], plans = [], health = [], events = [], monthStr, today, showWeight = true, isProtectedDay = () => false } = {}) {
  const { from, to, label } = monthRange(monthStr);
  const asOf = asOfDate(to, today);
  const inMonth = inRange(sessions, 'date', from, to);
  const agg = aggregateSessions(inMonth);
  const adh = adherence(live(plans), { from, to: asOf, today: asOf, isProtectedDay });
  const w = showWeight ? weightDelta(health, from, to) : null;
  const mom = momentum({ sessions, plans, health, events, profile, isProtectedDay }, asOf);

  const training = [
    { label: 'Trainingseinheiten', value: String(agg.count) },
    { label: 'Aktive Tage', value: String(agg.activeDays) },
    { label: 'Gelaufene Kilometer', value: fmtKm(agg.km, 0) },
  ];
  if (agg.otherKm > 0) training.push({ label: 'Weitere Kilometer (Rad, Gehen, Schwimmen …)', value: fmtKm(agg.otherKm, 0) });
  training.push({ label: 'Trainingszeit', value: fmtDuration(agg.durationSec) });
  if (adh.pct != null) training.push({ label: 'Plan-Einhaltung', value: `${adh.pct} % (${adh.done}/${adh.due})` });

  const verteilung = Object.entries(agg.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: String(v) }));

  const sections = [{ heading: 'Training', items: training }];
  if (verteilung.length) sections.push({ heading: 'Einheiten-Verteilung', items: verteilung });
  const kg = (v) => `${fmtDec(v)} kg`;
  if (w) sections.push({ heading: 'Körpergewicht', items: [
    { label: 'Zu Monatsbeginn (Wochenmittel)', value: kg(w.start) },
    { label: 'Zu Monatsende (Wochenmittel)', value: kg(w.end) },
    { label: 'Veränderung', value: `${w.delta > 0 ? '+' : ''}${kg(w.delta)}` },
  ] });

  const verdict = agg.count === 0
    ? 'In diesem Monat wurde kein Training erfasst.'
    : `${agg.count} Einheiten an ${agg.activeDays} Tagen${agg.km > 0 ? `, ${fmtKm(agg.km, 0)} gelaufen` : ''} – Momentum „${mom.level}“. Weiter dranbleiben!`;

  return {
    type: 'month',
    title: `Monatsbericht ${label}`,
    subtitle: profile.name ? `für ${profile.name}` : '',
    subject: { name: profile.name || '' },
    // Laufender Monat: der Stand steht im (versiegelten) Bericht – sonst sah ein Bericht vom
    // 28. wie ein vollständiger Monat aus (UI-39).
    period: { label, from, to, ...(asOf < to ? { asOf } : {}) },
    sections,
    highlights: unlockedBadges({ sessions, plans, health, events, profile, isProtectedDay }, asOf),
    verdict,
  };
}

/* --------------------------- Wettkampf-/Eventbericht -------------------- */
export function buildEventReport({ profile = {}, event = {}, plan = null, sessions = [], health = [], today, isProtectedDay = () => false } = {}) {
  const start = plan?.startDate || null;
  const end = event.date;
  const prepSessions = start ? live(sessions).filter((s) => s.date >= start && s.date <= end) : [];
  const agg = aggregateSessions(prepSessions);
  const asOf = asOfDate(end, today);
  const adh = start ? adherence(plan ? [plan] : [], { from: start, to: asOf, today: asOf, isProtectedDay }) : { due: 0, done: 0, pct: null };

  // Ergebnis: erledigte Wettkampf-Einheit -> verknüpfte Session, sonst Session am Eventtag
  const raceUnit = plan ? (plan.units || []).find((u) => u.type === 'race') : null;
  let result = raceUnit && raceUnit.executedSessionId ? live(sessions).find((s) => s.id === raceUnit.executedSessionId) : null;
  if (!result) result = live(sessions).find((s) => s.date === end && (s.type === 'race' || s.eventId === event.id));

  const targetSec = event.targetTime ? parseHms(event.targetTime) : null;
  const resultSec = result ? result.durationSec : null;
  const hit = targetSec != null && resultSec != null ? resultSec <= targetSec + 1 : null;

  const stamm = [
    { label: 'Wettkampf', value: event.name || '–' },
    { label: 'Datum', value: event.date ? fmtDate(event.date) : '–' },
  ];
  if (event.distanceKm) stamm.push({ label: 'Distanz', value: fmtKm(event.distanceKm, event.distanceKm % 1 ? 1 : 0) });
  if (event.targetTime) stamm.push({ label: 'Zielzeit', value: event.targetTime });

  const vorbereitung = [
    { label: 'Trainingszeitraum', value: start ? `${fmtDate(start)} – ${fmtDate(end)}` : '–' },
    { label: 'Einheiten absolviert', value: String(agg.count) },
    { label: 'Gelaufene Kilometer', value: fmtKm(agg.km, 0) },
  ];
  if (agg.otherKm > 0) vorbereitung.push({ label: 'Weitere Kilometer (Rad, Schwimmen, Gehen …)', value: fmtKm(agg.otherKm, 0) });
  if (adh.pct != null) vorbereitung.push({ label: 'Plan-Einhaltung', value: `${adh.pct} % (${adh.done}/${adh.due})` });

  const sections = [{ heading: 'Eckdaten', items: stamm }, { heading: 'Vorbereitung', items: vorbereitung }];

  if (result) {
    const items = [{ label: 'Ergebniszeit', value: hms(resultSec) }];
    if (result.distanceKm) items.push({ label: 'Distanz', value: fmtKm(result.distanceKm, 1) });
    if (result.avgHr) items.push({ label: 'Ø Herzfrequenz', value: `${result.avgHr} bpm` });
    if (hit != null) items.push({ label: 'Zielzeit', value: hit ? 'erreicht ✓' : 'knapp verpasst' });
    sections.push({ heading: 'Wettkampf-Ergebnis', items });
  }

  let verdict;
  if (!result) {
    verdict = `Eine Vorbereitung über ${agg.count} Einheiten und ${fmtKm(agg.km, 0)}. Das Ergebnis kann nach dem Wettkampf ergänzt werden.`;
  } else if (hit === true) {
    verdict = `Ziel erreicht! Mit ${hms(resultSec)} unter der Zielzeit – die ${agg.count} Vorbereitungseinheiten haben sich ausgezahlt.`;
  } else if (hit === false) {
    verdict = `${hms(resultSec)} im Ziel – knapp an der Zielzeit vorbei, aber eine starke Leistung nach ${agg.count} Einheiten. Die Erfahrung zählt für das nächste Mal.`;
  } else {
    verdict = `Geschafft: ${hms(resultSec)} nach ${agg.count} Vorbereitungseinheiten.`;
  }

  return {
    type: 'event',
    title: `Wettkampf-Bericht`,
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

/* -------------------------------- Urkunde ------------------------------- */
export function buildGoalReport({ profile = {}, goalTitle, goalDetail = '', date } = {}) {
  return {
    type: 'goal',
    title: 'Urkunde',
    subtitle: goalTitle || 'Ziel erreicht',
    subject: { name: profile.name || '' },
    period: { label: date ? fmtDate(date) : '' },
    sections: goalDetail ? [{ heading: 'Erreicht', items: [{ label: goalTitle || 'Ziel', value: goalDetail }] }] : [],
    highlights: [],
    verdict: `${profile.name || 'Du'} hat ein selbst gestecktes Ziel erreicht: ${sentenceEnd(`${goalTitle || ''}${goalDetail ? ' – ' + goalDetail : ''}`)} Großartige Leistung!`,
    certificate: true,
  };
}

/** Satzende ohne doppelten Punkt (vorher „… Halbmarathon.. Großartige Leistung!“). */
function sentenceEnd(s) {
  const x = String(s || '').trim();
  return /[.!?…]$/.test(x) ? x : `${x}.`;
}
