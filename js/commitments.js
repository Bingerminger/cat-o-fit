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
import { weekdayNames } from './format.js';

import { t } from './i18n.js';

/** Verpflichtungs-Vorlagen: Anzeigename, Einheitentyp und Standarddauer. */
export const COMMIT_TYPES = {
  cross_football: {
    get label() { return t('commitments.footballTraining'); }, unitType: 'cross_football', durationMin: 90,
    get desc() { return t('commitments.footballTrainingDesc'); },
  },
  match: {
    get label() { return t('commitments.match'); }, unitType: 'match', durationMin: 120,
    get desc() { return t('commitments.matchDesc'); },
  },
};

export function commitMeta(type) { return COMMIT_TYPES[type] || COMMIT_TYPES.cross_football; }

/** Wählbare Fußball-Intensitäten – steuern Belastung (RPE) und Plan-Entlastung (#5). */
export const FOOTBALL_INTENSITY = [
  { key: 'leicht', get label() { return t('commitments.intensityLight'); } },
  { key: 'normal', get label() { return t('commitments.intensityNormal'); } },
  { key: 'intensiv', get label() { return t('commitments.intensityIntense'); } },
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
    // Fußball-Intensität (leicht/normal/intensiv); Default „normal“. Nur für Training relevant.
    intensity: type === 'cross_football' ? (extra.intensity || 'normal') : null,
    fromDate: extra.fromDate || null,
    untilDate: extra.untilDate || null,
    desc: extra.desc || meta.desc,
  };
}

/** Fußballtraining Mo + Mi (90 min). KEIN Standard für neue Pläne mehr – neue Pläne
    fragen beim Anlegen nach festen Terminen. Genutzt von der Demo und als
    Lese-Migration für Pläne aus Versionen vor v3.7.0 (siehe plangen.planCommitments). */
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

/** Short weekday name for an ISO weekday (1 = Monday … 7 = Sunday); weekdayNames() starts on Sunday. */
export function dowLabel(dow) {
  const i = Number(dow);
  return Number.isInteger(i) && i >= 1 && i <= 7 ? weekdayNames()[i % 7] : '';
}

/** Kurzbeschreibung fürs UI, z. B. „Fußball Mo, Mi · Spiele So ab 19.08.“. */
export function commitmentsSummary(commitments = []) {
  if (!commitments.length) return t('commitments.none');
  const footballCs = commitments.filter((c) => c.type === 'cross_football').sort((a, b) => a.dow - b.dow);
  const training = footballCs.map((c) => dowLabel(c.dow));
  const parts = [];
  if (training.length) {
    const intensity = footballCs[0].intensity;
    const days = training.join(', ');
    const label = (FOOTBALL_INTENSITY.find((i) => i.key === intensity) || {}).label || intensity;
    parts.push(intensity && intensity !== 'normal'
      ? t('commitments.summaryFootballIntensity', { days, intensity: label })
      : t('commitments.summaryFootball', { days }));
  }
  commitments.filter((c) => c.type === 'match').forEach((m) => {
    parts.push(m.fromDate
      ? t('commitments.summaryMatchesFrom', { day: dowLabel(m.dow), dd: m.fromDate.slice(8, 10), mm: m.fromDate.slice(5, 7) })
      : t('commitments.summaryMatches', { day: dowLabel(m.dow) }));
  });
  return parts.join(' · ');
}
