/* =========================================================================
   hrzones.js — heart-rate zones. Pure, DOM-free logic (node:test).

   - Classic in % of maximum heart rate (5 zones of 10 % each).
   - Optionally via heart-rate reserve (Karvonen): resting HR + % × (HRmax − resting HR).
     With a high resting HR or well-trained runners, pure %-HRmax zones
     often set the base too low.
   - HRmax from age (Tanaka et al. 2001: 208 − 0.7 × age) – only as a clearly
     marked starting value if no measured HRmax is available. Formerly there were no
     zones at all without input, although the age was known.
   ========================================================================= */

import { t } from './i18n.js';

/** Zone limits in % (HRmax or HR reserve), name (as a function – the text depends on the language) and colour. */
export const ZONE_DEFS = [
  [50, 60, () => t('hrZones.recovery'), '#7fb8ff'],
  [60, 70, () => t('hrZones.base'), '#43c59e'],
  [70, 80, () => t('hrZones.steady'), '#f5c451'],
  [80, 90, () => t('hrZones.threshold'), '#f59145'],
  [90, 100, () => t('hrZones.vo2max'), '#ef5d6c'],
];

/** Name of zone 1–5 in the active language (stored zones carry the name of their origin). */
export function zoneName(zone) {
  const def = ZONE_DEFS[Number(zone) - 1];
  return def ? def[2]() : '';
}

/** Estimated maximum heart rate from age (Tanaka) – null without age. */
export function estimateMaxHr(age) {
  const a = Number(age);
  return Number.isFinite(a) && a > 0 && a < 110 ? Math.round(208 - 0.7 * a) : null;
}

/** Zones in % of the threshold HR (Friel): from performance diagnostics or a 30-minute field test. */
export const LTHR_DEFS = [[65, 85], [85, 90], [90, 95], [95, 100], [100, 106]];

/**
 * Five HR zones. `method`: 'hfmax' (default), 'karvonen' (needs a plausible resting HR
 * below the HRmax, otherwise falls back to %-HRmax) or 'lthr' (from the threshold HR of a test –
 * more accurate than any formula; the HRmax caps zone 5, if known).
 * @returns {Array<{zone, name, minPct, maxPct, min, max, color, basis:'hfmax'|'hfr'|'lthr'}>}
 */
export function hrZonesFrom({ maxHr, restHr = null, method = 'hfmax', lthr = null } = {}) {
  const lt = Number(lthr);
  if (method === 'lthr' && Number.isFinite(lt) && lt >= 100 && lt <= 220) {
    const cap = Number(maxHr) > lt ? Number(maxHr) : null;
    return ZONE_DEFS.map(([, , nameOf, color], i) => {
      const [a, b] = LTHR_DEFS[i];
      const max = Math.round(lt * b / 100);
      return { zone: i + 1, name: nameOf(), minPct: a, maxPct: b, min: Math.round(lt * a / 100), max: i === 4 && cap ? Math.max(cap, max) : max, color, basis: 'lthr' };
    });
  }
  const mh = Number(maxHr);
  if (!Number.isFinite(mh) || mh < 100 || mh > 240) return [];
  const rh = Number(restHr);
  const karvonen = method === 'karvonen' && Number.isFinite(rh) && rh >= 30 && rh < mh - 20;
  const at = (pct) => Math.round(karvonen ? rh + (mh - rh) * pct / 100 : mh * pct / 100);
  return ZONE_DEFS.map(([a, b, nameOf, color], i) => ({
    zone: i + 1, name: nameOf(), minPct: a, maxPct: b, min: at(a), max: at(b), color, basis: karvonen ? 'hfr' : 'hfmax',
  }));
}
