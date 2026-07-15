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

import { diffDays, fmtKm, fmtDuration, fmtDate, typeMeta, parseHms } from './ui.js';
import { evaluateBadges, momentum } from './badges.js';

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

/** Aggregiert eine Session-Liste zu Kennzahlen. */
export function aggregateSessions(sessions) {
  let km = 0, dur = 0; const days = new Set(); const byType = {};
  for (const s of sessions) {
    km += s.distanceKm || 0;
    dur += s.durationSec || 0;
    if (s.date) days.add(s.date);
    const label = typeMeta(s.type).label;
    byType[label] = (byType[label] || 0) + 1;
  }
  return { count: sessions.length, km, durationSec: dur, activeDays: days.size, byType };
}

/** Plan-Einhaltung im Zeitfenster: fällige (nicht-Ruhetag) vs. erledigte Einheiten. */
function adherenceInRange(plans, from, to) {
  let due = 0, done = 0;
  live(plans).forEach((p) => (p.units || []).forEach((u) => {
    if (!u.date || u.date < from || u.date > to || u.type === 'rest') return;
    due++; if (u.status === 'erledigt') done++;
  }));
  return { due, done, pct: due ? Math.round((done / due) * 100) : null };
}

function weightDelta(health, from, to) {
  const hs = inRange(health, 'date', from, to).filter((h) => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  if (hs.length < 1) return null;
  const start = hs[0].weight, end = hs[hs.length - 1].weight;
  return { start, end, delta: Math.round((end - start) * 10) / 10 };
}

function unlockedBadges(data, asOf) {
  return evaluateBadges(data, asOf).filter((b) => b.unlocked).map((b) => `${b.emoji} ${b.name}`);
}

/* ----------------------------- Monatsbericht ---------------------------- */
export function buildMonthReport({ profile = {}, sessions = [], plans = [], health = [], events = [], monthStr, today } = {}) {
  const { from, to, label } = monthRange(monthStr);
  const inMonth = inRange(sessions, 'date', from, to);
  const agg = aggregateSessions(inMonth);
  const adh = adherenceInRange(plans, from, to);
  const w = weightDelta(health, from, to);
  const mom = momentum({ sessions, plans, health, events, profile }, to);

  const training = [
    { label: 'Trainingseinheiten', value: String(agg.count) },
    { label: 'Aktive Tage', value: String(agg.activeDays) },
    { label: 'Gelaufene Kilometer', value: fmtKm(agg.km, 0) },
    { label: 'Trainingszeit', value: fmtDuration(agg.durationSec) },
  ];
  if (adh.pct != null) training.push({ label: 'Plan-Einhaltung', value: `${adh.pct} % (${adh.done}/${adh.due})` });

  const verteilung = Object.entries(agg.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: String(v) }));

  const sections = [{ heading: 'Training', items: training }];
  if (verteilung.length) sections.push({ heading: 'Einheiten-Verteilung', items: verteilung });
  if (w) sections.push({ heading: 'Körpergewicht', items: [
    { label: 'Zu Monatsbeginn', value: `${w.start} kg` },
    { label: 'Zu Monatsende', value: `${w.end} kg` },
    { label: 'Veränderung', value: `${w.delta > 0 ? '+' : ''}${w.delta} kg` },
  ] });

  const verdict = agg.count === 0
    ? 'In diesem Monat wurde kein Training erfasst.'
    : `${agg.count} Einheiten an ${agg.activeDays} Tagen, ${fmtKm(agg.km, 0)} – Momentum „${mom.level}". Weiter dranbleiben!`;

  return {
    type: 'month',
    title: `Monatsbericht ${label}`,
    subtitle: profile.name ? `für ${profile.name}` : '',
    subject: { name: profile.name || '' },
    period: { label, from, to },
    sections,
    highlights: unlockedBadges({ sessions, plans, health, events, profile }, to),
    verdict,
  };
}

/* --------------------------- Wettkampf-/Eventbericht -------------------- */
export function buildEventReport({ profile = {}, event = {}, plan = null, sessions = [], health = [], today } = {}) {
  const start = plan?.startDate || null;
  const end = event.date;
  const prepSessions = start ? live(sessions).filter((s) => s.date >= start && s.date <= end) : [];
  const agg = aggregateSessions(prepSessions);
  const adh = start ? adherenceInRange(plan ? [plan] : [], start, end) : { due: 0, done: 0, pct: null };

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
    { label: 'Gesamt-Kilometer', value: fmtKm(agg.km, 0) },
  ];
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
    highlights: unlockedBadges({ sessions, plans: plan ? [plan] : [], health, events: [event], profile }, end),
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
    verdict: `${profile.name || 'Du'} hat ein selbst gestecktes Ziel erreicht: ${goalTitle || ''}${goalDetail ? ' – ' + goalDetail : ''}. Großartige Leistung!`,
    certificate: true,
  };
}
