/* =========================================================================
   hrzones.js — Herzfrequenz-Zonen. Reine, DOM-freie Logik (node:test).

   - Klassisch in % der maximalen Herzfrequenz (5 Zonen à 10 %).
   - Optional über die Herzfrequenzreserve (Karvonen): Ruhepuls + % × (HFmax − Ruhepuls).
     Bei hohem Ruhepuls oder gut trainierten Läufer:innen setzen reine %-HFmax-Zonen
     die Grundlage oft zu niedrig an.
   - HFmax aus dem Alter (Tanaka et al. 2001: 208 − 0,7 × Alter) – nur als klar
     markierter Startwert, wenn keine gemessene HFmax vorliegt. Früher gab es ohne
     Eingabe gar keine Zonen, obwohl das Alter bekannt war.
   ========================================================================= */

import { t } from './i18n.js';

/** Zonen-Grenzen in % (HFmax bzw. HF-Reserve), Name (als Funktion – der Text hängt von der Sprache ab) und Farbe. */
export const ZONE_DEFS = [
  [50, 60, () => t('hrZones.recovery'), '#7fb8ff'],
  [60, 70, () => t('hrZones.base'), '#43c59e'],
  [70, 80, () => t('hrZones.steady'), '#f5c451'],
  [80, 90, () => t('hrZones.threshold'), '#f59145'],
  [90, 100, () => t('hrZones.vo2max'), '#ef5d6c'],
];

/** Name der Zone 1–5 in der aktiven Sprache (gespeicherte Zonen tragen den Namen ihrer Entstehung). */
export function zoneName(zone) {
  const def = ZONE_DEFS[Number(zone) - 1];
  return def ? def[2]() : '';
}

/** Geschätzte maximale Herzfrequenz aus dem Alter (Tanaka) – null ohne Alter. */
export function estimateMaxHr(age) {
  const a = Number(age);
  return Number.isFinite(a) && a > 0 && a < 110 ? Math.round(208 - 0.7 * a) : null;
}

/** Zonen in % der Schwellen-HF (Friel): aus Leistungsdiagnostik oder 30-Minuten-Feldtest. */
export const LTHR_DEFS = [[65, 85], [85, 90], [90, 95], [95, 100], [100, 106]];

/**
 * Fünf HF-Zonen. `method`: 'hfmax' (Standard), 'karvonen' (braucht einen plausiblen Ruhepuls
 * unter der HFmax, sonst Rückfall auf %-HFmax) oder 'lthr' (aus der Schwellen-HF eines Tests –
 * genauer als jede Formel; die HFmax deckelt Zone 5, falls bekannt).
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
