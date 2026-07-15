/* =========================================================================
   commitments.js — feste Termine / Verpflichtungen (Fußballtraining, Spiele).
   Reine, DOM-freie Logik -> per node:test abgedeckt.

   Eine Verpflichtung ist ein wiederkehrender fester Termin, um den herum der
   Trainingsplan gebaut wird – statt ihn (wie früher) fest ins Wochengerüst zu
   verdrahten. So sind die Tage konfigurierbar und editierbar:
     - wöchentlich an einem Wochentag (z. B. Mo+Mi Fußballtraining),
     - optional mit Gültigkeitszeitraum (z. B. Sonntagsspiele ab 19.08.).
   ========================================================================= */

import { uid, isoDow, addDays } from './ui.js';

/** Verpflichtungs-Vorlagen: Anzeigename, Einheitentyp und Standarddauer. */
export const COMMIT_TYPES = {
  cross_football: {
    label: 'Fußballtraining', unitType: 'cross_football', durationMin: 90,
    desc: 'Mannschaftstraining – zählt als Cross-Training (Antritte, Schnelligkeit, Spielfreude). Gut aufwärmen, danach 5–10 min locker auslaufen. War es intensiv, die nächste Laufeinheit etwas lockerer angehen.',
  },
  match: {
    label: 'Fußballspiel', unitType: 'match', durationMin: 120,
    desc: 'Pflicht-/Punktspiel – hohe, wettkampfnahe Belastung. Am Tag danach bewusst locker oder Ruhe; die Trainingswoche ist darauf abgestimmt.',
  },
};

export function commitMeta(type) { return COMMIT_TYPES[type] || COMMIT_TYPES.cross_football; }

/** Wählbare Fußball-Intensitäten – steuern Belastung (RPE) und Plan-Entlastung (#5). */
export const FOOTBALL_INTENSITY = [
  { key: 'leicht', label: 'leicht' },
  { key: 'normal', label: 'normal' },
  { key: 'intensiv', label: 'intensiv' },
];

/** Baut eine Verpflichtung. `dow` = ISO-Wochentag (1=Mo … 7=So). */
export function mkCommit(type, dow, extra = {}) {
  const meta = commitMeta(type);
  return {
    id: extra.id || uid('c'),
    type,
    label: extra.label || meta.label,
    dow,
    durationMin: extra.durationMin != null ? extra.durationMin : meta.durationMin,
    // Fußball-Intensität (leicht/normal/intensiv); Default „normal". Nur für Training relevant.
    intensity: type === 'cross_football' ? (extra.intensity || 'normal') : null,
    fromDate: extra.fromDate || null,
    untilDate: extra.untilDate || null,
    desc: extra.desc || meta.desc,
  };
}

/** Standard-Verpflichtungen: Mo + Mi 90-min-Fußballtraining. */
export function defaultCommitments() {
  return [mkCommit('cross_football', 1), mkCommit('cross_football', 3)];
}

/** Gilt die Verpflichtung an diesem Datum (Wochentag + Datumsbereich)? */
export function commitmentActiveOn(c, dateStr) {
  if (!c || !dateStr) return false;
  if (isoDow(dateStr) !== c.dow) return false;
  if (c.fromDate && dateStr < c.fromDate) return false;
  if (c.untilDate && dateStr > c.untilDate) return false;
  return true;
}

/** Alle aktiven Verpflichtungs-Termine in [fromDate, toDate], chronologisch. */
export function commitmentDates(commitments = [], fromDate, toDate) {
  const out = [];
  if (!fromDate || !toDate || fromDate > toDate) return out;
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    for (const c of commitments) {
      if (commitmentActiveOn(c, d)) out.push({ date: d, commitment: c });
    }
  }
  return out;
}

const DOW_LABELS = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export function dowLabel(dow) { return DOW_LABELS[dow] || ''; }

/** Kurzbeschreibung fürs UI, z. B. „Fußball Mo, Mi · Spiele So ab 19.08.". */
export function commitmentsSummary(commitments = []) {
  if (!commitments.length) return 'Keine festen Termine';
  const footballCs = commitments.filter((c) => c.type === 'cross_football').sort((a, b) => a.dow - b.dow);
  const training = footballCs.map((c) => dowLabel(c.dow));
  const parts = [];
  if (training.length) {
    const intensity = footballCs[0].intensity;
    const suffix = intensity && intensity !== 'normal' ? ` (${intensity})` : '';
    parts.push(`Fußball ${training.join(', ')}${suffix}`);
  }
  commitments.filter((c) => c.type === 'match').forEach((m) => {
    const from = m.fromDate ? ` ab ${m.fromDate.slice(8, 10)}.${m.fromDate.slice(5, 7)}.` : '';
    parts.push(`Spiele ${dowLabel(m.dow)}${from}`);
  });
  return parts.join(' · ');
}
