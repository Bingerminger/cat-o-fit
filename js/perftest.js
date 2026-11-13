/* =========================================================================
   perftest.js — values from a performance test (since 4.2), pure and DOM-free:
     · threshold pace (running) – enters the form estimate as one hard performance on its date
       (vdot.js formOptions/estimateVdot), so there is no second pace source beside it;
     · FTP (cycling) – power targets for bike sessions, derived when shown from the session's zone;
     · CSS, critical swim speed (swimming) – the reference pace per 100 m for swim sessions.
   Stored as flat profile fields, each with its date (the profile merges field by field):
   thresholdPaceSecPerKm + thresholdPaceDate, ftpW + ftpDate, cssSecPer100m + cssDate.
   ========================================================================= */

import { addDays, diffDays } from './ui.js';
import { FORM_WINDOW } from './vdot.js';

/** Power zones in % of FTP (Allen & Coggan, levels 1–5): active recovery, endurance, tempo, threshold, VO₂max. */
export const POWER_ZONES = [[0, 55], [56, 75], [76, 90], [91, 105], [106, 120]];

/** Power zones in watts for an FTP; [] without a sensible FTP. */
export function powerZones(ftpW) {
  const ftp = Number(ftpW);
  if (!(ftp >= 50 && ftp <= 600)) return [];
  return POWER_ZONES.map(([a, b], i) => ({ zone: i + 1, min: Math.round(ftp * a / 100), max: Math.round(ftp * b / 100) }));
}

/** Watt range of a session's heart rate zone (1–5) – null without FTP or zone. */
export function powerForZone(ftpW, zone) {
  const z = powerZones(ftpW)[Number(zone) - 1];
  return z || null;
}

/** "m:ss" or whole seconds → seconds; null when empty or no time. */
export function parseMinSec(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    const total = m * 60 + (sec || 0);
    return Number.isFinite(total) && total > 0 && (sec || 0) < 60 ? total : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Until when a test of `date` counts in the form estimate (its window), and whether it still does on
 * `today`. null without a date.
 * @returns {{until:string, counts:boolean}|null}
 */
export function testValidity(date, today) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const until = addDays(date, FORM_WINDOW);
  return { until, counts: date <= today && diffDays(date, today) <= FORM_WINDOW };
}
