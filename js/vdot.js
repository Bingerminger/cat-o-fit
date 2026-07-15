/* =========================================================================
   vdot.js — Form-/Leistungsschätzung nach der VDOT-Idee (Jack Daniels) und
   daraus abgeleitete Trainings-Paces. Reine Funktionen ohne Store/DOM → testbar.

   Aus einer Lauf-Leistung (Distanz + Zeit) wird ein VDOT (≈ effektives VO₂max)
   geschätzt; daraus lassen sich die Trainingsbereiche (Recovery … VO₂max) als
   Sekunden/km ableiten – im selben Format wie `profile.paceZones`.
   Bewusst als Orientierung gedacht – keine Labordiagnostik.
   ========================================================================= */

import { diffDays } from './ui.js';

/** VO₂ (ml/kg/min) bei Laufgeschwindigkeit v (m/min) – Daniels/Gilbert. */
function vo2AtSpeed(v) { return -4.60 + 0.182258 * v + 0.000104 * v * v; }
/** Anteil von VO₂max, der über t Minuten gehalten werden kann (Drop-off). */
function pctMaxForTime(t) { return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); }

/** VDOT aus einer Leistung (Distanz in Metern, Zeit in Sekunden). null bei Unsinn. */
export function vdotFromPerf(distanceM, timeSec) {
  if (!distanceM || !timeSec || distanceM < 400 || timeSec < 60) return null;
  const tMin = timeSec / 60;
  const v = distanceM / tMin;            // m/min
  const vo2 = vo2AtSpeed(v);
  const pct = pctMaxForTime(tMin);
  const vdot = vo2 / pct;
  return (vdot > 20 && vdot < 90) ? Math.round(vdot * 10) / 10 : null;
}

/** Pace (Sek./km) für eine Zielintensität `pct` (Anteil von VDOT). */
export function paceForPct(vdot, pct) {
  const target = vdot * pct;             // gewünschtes VO₂
  // 0.000104 v² + 0.182258 v - 4.60 = target  ->  quadratische Lösung (v>0)
  const a = 0.000104, b = 0.182258, c = -4.60 - target;
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); // m/min
  return Math.round(60000 / v);          // 1000 m bei v m/min -> Sekunden/km
}

/** Intensitätsbereiche je Trainingszone als Anteil von VDOT [schnell, langsam]. */
const ZONE_PCT = {
  recovery:  [0.66, 0.62],
  easy:      [0.74, 0.68],
  long:      [0.76, 0.70],
  marathon:  [0.84, 0.79],
  race_hm:   [0.89, 0.85],
  threshold: [0.90, 0.86],
  vo2:       [1.00, 0.95],
};
const ZONE_META = {
  recovery:  { label: 'Regeneration', hrZone: 1 },
  easy:      { label: 'Locker / Easy', hrZone: 2 },
  long:      { label: 'Long Run', hrZone: 2 },
  marathon:  { label: 'Marathon-Pace', hrZone: 3 },
  race_hm:   { label: 'HM-Wettkampf', hrZone: 3 },
  threshold: { label: 'Schwelle / Tempo', hrZone: 4 },
  vo2:       { label: 'Intervalle (VO2max)', hrZone: 5 },
};

/** Vollständige Pace-Bereiche aus einem VDOT – Format wie `profile.paceZones`. */
export function pacesFromVdot(vdot) {
  if (!vdot) return null;
  const out = {};
  for (const [key, [hi, lo]] of Object.entries(ZONE_PCT)) {
    out[key] = { label: ZONE_META[key].label, min: paceForPct(vdot, hi), max: paceForPct(vdot, lo), hrZone: ZONE_META[key].hrZone };
  }
  return out;
}

const HARD = ['tempo', 'interval', 'race', 'long', 'easy', 'run'];

/** Median einer Zahlenliste (leere Liste → 0). */
function median(xs) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Schätzt die aktuelle Form (VDOT) aus den harten Läufen der letzten `days` –
 * bewusst GEGLÄTTET, damit ein einzelner Trainingsausreißer die Form nicht
 * springen lässt (Best-Practice-Robustifizierung statt „ein Lauf zählt"):
 *
 *   1) Wochenbestwert: je Kalenderwoche der beste VDOT. Das filtert lockere
 *      Läufe heraus (nur der Qualitäts-Peak je Woche zählt) und dämpft bereits
 *      Ausreißer innerhalb einer Woche.
 *   2) Robuste Ausreißer-Kappung der Wochenwerte auf Median ± 3·MAD
 *      (Median Absolute Deviation – klassische robuste Statistik). Ein einzelner
 *      Fehl-/Glückswert (z. B. GPS-Fehler) wird so gekappt, echte Steigerungen
 *      bleiben erhalten.
 *   3) Rezenzgewichtetes Mittel der gekappten Wochenwerte, exponentiell mit
 *      Halbwertszeit 2 Wochen (gleiche EWMA-Idee wie Fitness/Form in load.js) –
 *      jüngere Wochen zählen mehr, aber keine einzelne Woche dominiert.
 *
 * Bei weniger als 3 Wochen mit Daten fällt sie auf den besten Einzellauf zurück
 * (mit der jüngsten Einheit als Basis). Liefert { vdot, basis, weeks } oder null.
 */
export function estimateVdot(sessions = [], today, days = 42) {
  const runs = [];
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !s.durationSec || s.distanceKm < 3) return;
    if (!HARD.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0 || d > days) return;
    const v = vdotFromPerf(s.distanceKm * 1000, s.durationSec);
    if (v) runs.push({ v, week: Math.floor(d / 7), date: s.date, distanceKm: s.distanceKm, durationSec: s.durationSec, type: s.type });
  });
  if (!runs.length) return null;

  // (1) Wochenbestwert – bei Gleichstand die jüngere Einheit als Basis behalten.
  const byWeek = new Map();
  runs.forEach((r) => {
    const cur = byWeek.get(r.week);
    if (!cur || r.v > cur.v || (r.v === cur.v && r.date > cur.date)) byWeek.set(r.week, r);
  });
  const weekly = [...byWeek.values()].sort((a, b) => a.week - b.week); // Woche 0 (aktuell) zuerst
  const b0 = weekly[0];
  const basis = { date: b0.date, distanceKm: b0.distanceKm, durationSec: b0.durationSec, type: b0.type };

  // Zu wenig Historie → bester Einzellauf (bisheriges, robustes Verhalten).
  if (weekly.length < 3) {
    const best = Math.max(...weekly.map((w) => w.v));
    return { vdot: Math.round(best * 10) / 10, basis, weeks: weekly.length };
  }

  // (2) Robuste Kappung auf Median ± 3·MAD (MAD-Untergrenze 1,5 VDOT gegen Überkappung enger Wochen).
  const vals = weekly.map((w) => w.v);
  const med = median(vals);
  const mad = Math.max(median(vals.map((v) => Math.abs(v - med))), 1.5);
  const clamp = (v) => Math.max(med - 3 * mad, Math.min(med + 3 * mad, v));

  // (3) Rezenzgewichtetes Mittel (exponentiell, Halbwertszeit 2 Wochen).
  const HALF_LIFE = 2;
  let num = 0, den = 0;
  weekly.forEach((w) => {
    const wt = Math.pow(0.5, w.week / HALF_LIFE);
    num += clamp(w.v) * wt; den += wt;
  });
  const vdot = den ? num / den : med;
  return { vdot: Math.round(vdot * 10) / 10, basis, weeks: weekly.length };
}

/**
 * Vergleicht die formbasierten Paces mit den aktuellen Plan-Zielpaces (über die
 * Schwellenpace). Liefert die empfohlenen Paces und die Abweichung in Sek./km.
 * `deltaSec` > 0: Form ist schneller als der Plan (Plan zu langsam) → schärfen.
 */
export function paceAdjustment(currentZones = {}, vdot) {
  const fresh = pacesFromVdot(vdot);
  if (!fresh) return null;
  const cur = currentZones.threshold;
  if (!cur || cur.min == null) return { fresh, deltaSec: null };
  const curMid = (cur.min + cur.max) / 2;
  const freshMid = (fresh.threshold.min + fresh.threshold.max) / 2;
  return { fresh, deltaSec: Math.round(curMid - freshMid) };
}
