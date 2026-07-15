/* =========================================================================
   suggestions.js — abgeleitete Werte: Zielpace, Wettkampfprognose (Riegel),
   einfache Trainingstipps. Alles als Orientierung, keine Versprechen.
   ========================================================================= */

import { parseHms, fmtDuration, todayStr, diffDays } from './ui.js';

/** Zielpace (Sek/km) aus Zielzeit "HH:MM:SS" und Distanz (km). */
export function targetPaceSecPerKm(targetTime, distanceKm) {
  const sec = parseHms(targetTime);
  if (!sec || !distanceKm) return null;
  return Math.round(sec / distanceKm);
}

/** Riegel-Prognose: t2 = t1 * (d2/d1)^exp. */
export function riegel(knownSec, knownKm, targetKm, exp = 1.06) {
  if (!knownSec || !knownKm || !targetKm) return null;
  return knownSec * (targetKm / knownKm) ** exp;
}

/**
 * Schätzt eine Wettkampfzeit aus den besten jüngeren Läufen (≥ 4 km, letzte 50 Tage).
 * @returns {{seconds:number, basis:string}|null}
 */
export function predictRace(sessions, distanceKm) {
  const today = todayStr();
  const cand = (sessions || []).filter((s) =>
    !s.deleted && s.distanceKm >= 4 && s.durationSec > 0 &&
    ['easy', 'tempo', 'long', 'interval', 'race', 'run'].includes(s.type) &&
    diffDays(s.date, today) <= 50 && diffDays(s.date, today) >= 0);
  if (!cand.length) return null;

  let best = null;
  cand.forEach((s) => {
    const pred = riegel(s.durationSec, s.distanceKm, distanceKm);
    if (pred && (!best || pred < best.seconds)) {
      best = { seconds: pred, basis: `${s.distanceKm.toFixed(1).replace('.', ',')} km in ${fmtDuration(s.durationSec)}` };
    }
  });
  return best;
}

/** Liefert einen kurzen, freundlichen Trainingstipp (ohne Druck). */
export function trainingTip(ctx) {
  const { todaysUnits = [], streak = 0, weekKm = 0 } = ctx;
  if (todaysUnits.some((u) => u.type === 'race')) return 'Heute ist Wettkampf – viel Erfolg! 🏁';
  if (todaysUnits.some((u) => u.type === 'long')) return 'Long Run heute: ruhig starten, Verpflegung & Trinken nicht vergessen.';
  if (todaysUnits.some((u) => ['tempo', 'interval'].includes(u.type))) return 'Harte Einheit: gut einlaufen, sauber auslaufen.';
  if (todaysUnits.length === 0) return 'Ruhetag eingeplant – Erholung ist Teil des Trainings.';
  if (streak >= 3) return `Schöne Konstanz – ${streak} Tage in Folge aktiv. Weiter so, ohne Druck.`;
  return 'Bleib in Bewegung – Konsistenz schlägt einzelne Top-Einheiten.';
}
