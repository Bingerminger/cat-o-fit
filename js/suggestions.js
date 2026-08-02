/* =========================================================================
   suggestions.js — abgeleitete Werte: Zielpace, Wettkampfprognose,
   einfache Trainingstipps. Alles als Orientierung, keine Versprechen.

   Die Prognose nutzt seit v3.16.0 dieselbe GEGLÄTTETE Formbasis wie die
   Trainingsbereiche (`vdot.js estimateVdot`): Wochenbestwerte, Ausreißer-
   Kappung, rezenzgewichtetes Mittel. Vorher wurde schlicht die schnellste
   Riegel-Hochrechnung aus allen Läufen genommen – systematisch zu optimistisch
   (ein einzelner zügiger 5er ließ die Marathonprognose purzeln) und im
   Widerspruch zur Formkarte auf dem Dashboard.
   ========================================================================= */

import { parseHms, fmtDuration, todayStr, diffDays } from './ui.js';
import { estimateVdot, raceTimeFromVdot } from './vdot.js';

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

/** Höchster vertretbarer Extrapolationsfaktor für Riegel (Fallback-Pfad).
    Eine Hochrechnung von 4 km auf 42,2 km (Faktor 10) ist grob unzuverlässig. */
const MAX_EXTRAPOLATION = 4;

/**
 * Schätzt eine Wettkampfzeit für `distanceKm`.
 * Primär über die geglättete Form (VDOT → Daniels-Äquivalenzzeit), ersatzweise
 * über Riegel aus dem am besten passenden Lauf (begrenzte Extrapolation).
 * @returns {{seconds:number, basis:string, method:'form'|'riegel'}|null}
 */
export function predictRace(sessions, distanceKm) {
  const today = todayStr();
  if (!distanceKm) return null;

  // 1) Formbasiert (bevorzugt): identische Basis wie Trainingsbereiche & Formkarte.
  const form = estimateVdot(sessions || [], today);
  if (form && form.vdot) {
    const seconds = raceTimeFromVdot(form.vdot, distanceKm * 1000);
    if (seconds) {
      const basis = form.weeks >= 3
        ? `deiner Form (VDOT ${form.vdot}, geglättet über ${form.weeks} Wochen)`
        : `deiner Form (VDOT ${form.vdot})`;
      return { seconds: Math.round(seconds), basis, method: 'form' };
    }
  }

  // 2) Fallback Riegel – nur aus Läufen mit vertretbarem Extrapolationsabstand.
  const cand = (sessions || []).filter((s) =>
    s && !s.deleted && s.distanceKm >= 4 && s.durationSec > 0 &&
    ['easy', 'tempo', 'long', 'interval', 'race', 'run'].includes(s.type) &&
    diffDays(s.date, today) <= 50 && diffDays(s.date, today) >= 0 &&
    Math.max(distanceKm / s.distanceKm, s.distanceKm / distanceKm) <= MAX_EXTRAPOLATION);
  if (!cand.length) return null;

  // Der Lauf, dessen Distanz der Zieldistanz am nächsten kommt, trägt am
  // wenigsten Extrapolationsfehler – deshalb dieser statt „schnellste Prognose".
  const best = cand.slice().sort((a, b) =>
    Math.abs(Math.log(a.distanceKm / distanceKm)) - Math.abs(Math.log(b.distanceKm / distanceKm)))[0];
  const pred = riegel(best.durationSec, best.distanceKm, distanceKm);
  if (!pred) return null;
  return {
    seconds: Math.round(pred),
    basis: `${best.distanceKm.toFixed(1).replace('.', ',')} km in ${fmtDuration(best.durationSec)} (Riegel-Schätzung)`,
    method: 'riegel',
  };
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
