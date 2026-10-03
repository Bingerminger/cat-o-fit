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

import { parseHms, fmtDuration, todayStr, diffDays, fmtNum, fmtDec } from './ui.js';
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

const RUN_TYPES = ['easy', 'long', 'tempo', 'interval', 'race', 'run', 'recovery'];

/** Laufumfang: Ø Wochen-km der letzten 4 Wochen und längster Lauf der letzten 6 Wochen. */
export function runVolume(sessions = [], today = todayStr()) {
  let km28 = 0, longestKm = 0;
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !RUN_TYPES.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0) return;
    if (d < 28) km28 += s.distanceKm;
    if (d <= 42 && s.distanceKm > longestKm) longestKm = s.distanceKm;
  });
  return { weekKm: Math.round((km28 / 4) * 10) / 10, longestKm };
}

/** Reicht die Vorbereitung für die Äquivalenzzeit? Für Marathon (und abgeschwächt
    Halbmarathon) sagt die Formäquivalenz ohne Umfang zu viel voraus – bei
    Freizeitläufer:innen ist der Wochenumfang ein eigener Prädiktor
    (Vickers & Vertosick 2016). */
export function volumeCaveat(distanceKm, vol) {
  if (!vol) return false;
  if (distanceKm >= 40) return vol.weekKm < 50 || vol.longestKm < 25;
  if (distanceKm >= 20) return vol.weekKm < 30 || vol.longestKm < 15;
  return false;
}

/**
 * Schätzt eine Wettkampfzeit für `distanceKm`.
 * Primär über die geglättete Form (VDOT → Daniels-Äquivalenzzeit), ersatzweise
 * über Riegel aus dem am besten passenden Lauf (begrenzte Extrapolation).
 * `onlyEasy`: nur aus lockeren Läufen geschätzt (eher zu vorsichtig); `caveat`
 * 'volume': für Marathon/Halbmarathon fehlt noch der passende Umfang – die Zeit ist
 * dann nur bei ausreichender Vorbereitung erreichbar (kein „Ziel schärfen“-Rat).
 * @returns {{seconds:number, basis:string, method:'form'|'riegel', onlyEasy:boolean, caveat:string|null, note:string|null}|null}
 */
export function predictRace(sessions, distanceKm, { hrZones = null, today = todayStr() } = {}) {
  if (!distanceKm) return null;
  const caveat = volumeCaveat(distanceKm, runVolume(sessions, today)) ? 'volume' : null;
  const note = caveat ? 'Nur bei ausreichender Vorbereitung erreichbar – dein Wochenumfang bzw. dein längster Lauf ist dafür noch knapp.' : null;

  // 1) Formbasiert (bevorzugt): identische Basis wie Trainingsbereiche & Formkarte.
  const form = estimateVdot(sessions || [], today, 42, { hrZones });
  if (form && form.vdot) {
    const seconds = raceTimeFromVdot(form.vdot, distanceKm * 1000);
    if (seconds) {
      const v = fmtDec(form.vdot);
      const basis = form.onlyEasy
        ? `lockeren Trainingsläufen (VDOT ${v}) – eher zu vorsichtig, ein Wettkampf oder Tempolauf verbessert die Schätzung`
        : form.weeks >= 3
          ? `deiner Form (VDOT ${v}, geglättet über ${form.weeks} Wochen)`
          : `deiner Form (VDOT ${v})`;
      return { seconds: Math.round(seconds), basis, method: 'form', onlyEasy: !!form.onlyEasy, caveat, note };
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
  // wenigsten Extrapolationsfehler – deshalb dieser statt „schnellste Prognose“.
  const best = cand.slice().sort((a, b) =>
    Math.abs(Math.log(a.distanceKm / distanceKm)) - Math.abs(Math.log(b.distanceKm / distanceKm)))[0];
  const pred = riegel(best.durationSec, best.distanceKm, distanceKm);
  if (!pred) return null;
  return {
    seconds: Math.round(pred),
    basis: `${fmtNum(best.distanceKm, 1)} km in ${fmtDuration(best.durationSec)} (Riegel-Schätzung)`,
    method: 'riegel', onlyEasy: false, caveat, note,
  };
}

/** Liefert einen kurzen, freundlichen Trainingstipp (ohne Druck). */
export function trainingTip(ctx) {
  const { todaysUnits = [], streak = 0, weekKm = 0, hasPlan = true } = ctx;
  if (todaysUnits.some((u) => u.type === 'race')) return 'Heute ist Wettkampf – viel Erfolg! 🏁';
  if (todaysUnits.some((u) => u.type === 'long')) return 'Long Run heute: ruhig starten, Verpflegung & Trinken nicht vergessen.';
  if (todaysUnits.some((u) => ['tempo', 'interval'].includes(u.type))) return 'Harte Einheit: gut einlaufen, sauber auslaufen.';
  // Ohne Plan ist nichts „eingeplant“ – kein Ruhetag-Spruch in einer leeren App (UI-13).
  if (todaysUnits.length === 0 && !hasPlan) return 'Noch kein Plan? Ein Ziel oder Programm anlegen – oder einfach ein Training erfassen.';
  if (todaysUnits.length === 0) return 'Ruhetag eingeplant – Erholung ist Teil des Trainings.';
  // `streak` = Wochen-Serie (Wochen mit ≥ 3 Trainingstagen) – Ruhetage gehören dazu.
  if (streak >= 3) return `Schöne Konstanz – ${streak} Wochen in Folge dran. Ruhetage gehören dazu – weiter so, ohne Druck.`;
  return 'Bleib in Bewegung – Konsistenz schlägt einzelne Top-Einheiten.';
}
