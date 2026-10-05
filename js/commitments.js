/* =========================================================================
   commitments.js — fixed appointments / commitments (football training, games).
   Pure, DOM-free logic -> covered by node:test.

   A commitment is a recurring fixed appointment around which the
   training plan is built – instead of (as before) hard-wiring it into the weekly
   skeleton. This way the days are configurable and editable:
     - weekly on a weekday (e.g. Mon+Wed football training),
     - optionally with a validity period (e.g. Sunday games from 19 Aug).
   ========================================================================= */

import { uid, isoDow, addDays } from './ui.js';
import { weekdayNames } from './format.js';

import { t } from './i18n.js';

/** Commitment templates: display name, session type and default duration. */
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

/** Selectable football intensities – control load (RPE) and plan relief (#5). */
export const FOOTBALL_INTENSITY = [
  { key: 'leicht', get label() { return t('commitments.intensityLight'); } },
  { key: 'normal', get label() { return t('commitments.intensityNormal'); } },
  { key: 'intensiv', get label() { return t('commitments.intensityIntense'); } },
];

/** Builds a commitment. `dow` = ISO weekday (1=Mon … 7=Sun). */
export function mkCommit(type, dow, extra = {}) {
  const meta = commitMeta(type);
  return {
    id: extra.id || uid('c'),
    type,
    label: extra.label || meta.label,
    dow,
    durationMin: extra.durationMin != null ? extra.durationMin : meta.durationMin,
    // Football intensity (leicht/normal/intensiv); default "normal". Only relevant for training.
    intensity: type === 'cross_football' ? (extra.intensity || 'normal') : null,
    fromDate: extra.fromDate || null,
    untilDate: extra.untilDate || null,
    desc: extra.desc || meta.desc,
  };
}

/** Football training Mon + Wed (90 min). NO LONGER a default for new plans – new plans
    ask for fixed appointments on creation. Used by the demo and as a
    read migration for plans from versions before v3.7.0 (see plangen.planCommitments). */
export function defaultCommitments() {
  return [mkCommit('cross_football', 1), mkCommit('cross_football', 3)];
}

/** Does the commitment apply on this date (weekday + date range)? */
export function commitmentActiveOn(c, dateStr) {
  if (!c || !dateStr) return false;
  if (isoDow(dateStr) !== c.dow) return false;
  if (c.fromDate && dateStr < c.fromDate) return false;
  if (c.untilDate && dateStr > c.untilDate) return false;
  return true;
}

/** All active commitment dates in [fromDate, toDate], chronological. */
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

/** Short description for the UI, e.g. "Football Mon, Wed · Games Sun from 19.08.". */
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
