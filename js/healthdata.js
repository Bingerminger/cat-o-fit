/* =========================================================================
   healthdata.js — body values: read migration and measurement-method helpers.
   Pure, DOM-free logic → covered by node:test.

   - Fat-free mass: Apple Health "Lean Body Mass" ended up in the field
     `muscleMass` up to v3.19.0 and then appeared as "Muscle mass" (≈ 55 kg) next to scale values
     (≈ 28 kg). Since v3.20.0 there is the separate field `leanMass`; older Apple values
     are reinterpreted there when reading (nothing is stored). Manually
     entered muscle mass (`muscleMassManual`) stays muscle mass – even on days
     that also carry Apple values; otherwise the energy availability calculation used it
     as fat-free mass.
   - HRV: Apple stores SDNN, many watches and rings show RMSSD. The numbers are
     not comparable – that is why every value carries its measurement method (`hrvMethod`), and
     trends, goals and readiness only compare within one method.
   ========================================================================= */

import { todayStr, addDays } from './ui.js';

/** Sources that come from Apple Health (auto export and full import). */
export const APPLE_SOURCES = ['apple-health', 'health'];
export const HRV_METHODS = { sdnn: 'SDNN', rmssd: 'RMSSD' };

const memo = new WeakMap();
const isApple = (h) => APPLE_SOURCES.includes(h && h.source);

/** Reinterprets an older body-value record when reading (idempotent, without writing). */
export function migrateHealthRecord(h) {
  if (!h || typeof h !== 'object' || !isApple(h)) return h;
  const needsLean = h.muscleMass != null && !h.muscleMassManual;
  const needsHrv = h.hrv != null && !h.hrvMethod;
  if (!needsLean && !needsHrv) return h;
  const cached = memo.get(h);
  if (cached) return cached;
  const out = { ...h };
  if (needsLean) {
    if (out.leanMass == null) out.leanMass = h.muscleMass;
    delete out.muscleMass;              // Apple has no muscle mass – that was the fat-free mass
  }
  if (needsHrv) out.hrvMethod = 'sdnn';
  memo.set(h, out);
  return out;
}

/** Reinterprets the whole list when reading. */
export function migrateHealth(list = []) {
  return (list || []).map(migrateHealthRecord);
}

/** Measurement method of an HRV value ('sdnn' | 'rmssd' | 'unbekannt'). */
export function hrvMethodOf(h) {
  if (!h || h.hrv == null) return null;
  if (h.hrvMethod === 'sdnn' || h.hrvMethod === 'rmssd') return h.hrvMethod;
  return isApple(h) ? 'sdnn' : 'unbekannt';
}

/** Measurement method of the latest HRV value – display and comparison follow it. */
export function currentHrvMethod(health = []) {
  let best = null;
  for (const h of health || []) {
    if (!h || h.deleted || h.hrv == null || !h.date) continue;
    if (!best || h.date > best.date) best = h;
  }
  return best ? hrvMethodOf(best) : null;
}

/** Only the HRV values of one method (records without HRV are kept, their HRV is dropped). */
export function withHrvMethod(health = [], method) {
  return (health || []).map((h) => {
    if (!h || h.hrv == null || hrvMethodOf(h) === method) return h;
    const { hrv, ...rest } = h;
    return rest;
  });
}

/** Label "HRV (SDNN)" or similar. */
export function hrvLabel(method) {
  return method && HRV_METHODS[method] ? `HRV (${HRV_METHODS[method]})` : 'HRV';
}

/* (moved here from badges.js so that health.js does not have to import badges.js – FE-18) */
/** Alcohol-free days in a row up to today (null if no alcohol day was ever recorded). */
export function alcoholFreeStreak(health, today = todayStr()) {
  const drinkDays = new Set((health || []).filter((h) => h && !h.deleted && h.alcohol === true).map((h) => h.date));
  if (!drinkDays.size) return null;
  let streak = 0; let d = today;
  while (!drinkDays.has(d) && streak <= 3650) { streak++; d = addDays(d, -1); }
  return streak;
}
