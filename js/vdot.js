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

/**
 * Äquivalente Wettkampfzeit (Sekunden) für eine Distanz bei gegebenem VDOT –
 * die Umkehrung von `vdotFromPerf` (Daniels' Äquivalenz-Zeiten). Löst
 * `vo2AtSpeed(v)/pctMaxForTime(t) = vdot` per Bisektion; die Funktion ist in t
 * streng monoton fallend, daher robust ohne Startwert.
 */
export function raceTimeFromVdot(vdot, distanceM) {
  if (!vdot || !distanceM || distanceM < 400) return null;
  const f = (tSec) => {
    const tMin = tSec / 60;
    return vo2AtSpeed(distanceM / tMin) / pctMaxForTime(tMin) - vdot;
  };
  let lo = 60, hi = 8 * 3600;              // 1 min … 8 h
  if (f(lo) < 0 || f(hi) > 0) return null; // außerhalb des sinnvollen Bereichs
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Intensitätsbereiche je Trainingszone als Anteil von VDOT [schnell, langsam].
    Easy und Long teilen sich wie bei Daniels („E/L-Pace“) einen Bereich; der Long
    Run beginnt nur am schnellen Ende etwas ruhiger. Früher lag die Long-Zone über
    der Easy-Zone – die längste Einheit bekam die schnellste Grundlagenvorgabe. */
const ZONE_PCT = {
  recovery:  [0.63, 0.56],
  easy:      [0.74, 0.62],
  long:      [0.72, 0.62],
  threshold: [0.90, 0.86],
  vo2:       [1.00, 0.95],
};
const ZONE_META = {
  recovery:  { label: 'Regeneration', hrZone: 1 },
  easy:      { label: 'Locker / Easy', hrZone: 2 },
  long:      { label: 'Long Run', hrZone: 2 },
  marathon:  { label: 'Marathon-Renntempo', hrZone: 3 },
  race_hm:   { label: 'HM-Renntempo', hrZone: 4 },
  threshold: { label: 'Schwelle / Tempo', hrZone: 4 },
  vo2:       { label: 'Intervalle (VO2max)', hrZone: 5 },
};

/** HF-Zone des Renntempos je Distanz (5 km am Limit, Marathon deutlich darunter). */
function raceHrZone(distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km <= 6) return 5;
  if (km <= 25) return 4;
  return 3;
}

/** Renntempo-Bereich (±2 %) um eine Pace in Sek./km. */
export function raceZone(paceSec, distanceKm, label = 'Renntempo') {
  if (!paceSec) return null;
  return { label, min: Math.round(paceSec * 0.98), max: Math.round(paceSec * 1.02), hrZone: raceHrZone(distanceKm) };
}

/** Renntempo für eine Distanz aus dem VDOT – über die Äquivalenzzeit, nicht als fester
    VDOT-Anteil. Ein fester Anteil ignoriert die Renndauer: Für langsamere Läufer:innen
    war die HM-Zone 7–21 s/km zu schnell, die Marathon-Blöcke liefen im HM-Tempo. */
export function racePaceFromVdot(vdot, distanceKm) {
  const sec = raceTimeFromVdot(vdot, (Number(distanceKm) || 0) * 1000);
  return sec ? Math.round(sec / distanceKm) : null;
}

/** Vollständige Pace-Bereiche aus einem VDOT – Format wie `profile.paceZones`. */
export function pacesFromVdot(vdot) {
  if (!vdot) return null;
  const out = {};
  for (const [key, [hi, lo]] of Object.entries(ZONE_PCT)) {
    out[key] = { label: ZONE_META[key].label, min: paceForPct(vdot, hi), max: paceForPct(vdot, lo), hrZone: ZONE_META[key].hrZone };
  }
  out.marathon = raceZone(racePaceFromVdot(vdot, 42.195), 42.195, ZONE_META.marathon.label);
  out.race_hm = raceZone(racePaceFromVdot(vdot, 21.0975), 21.0975, ZONE_META.race_hm.label);
  // Reihenfolge wie früher (für Anzeigen, die über die Einträge laufen).
  const { recovery, easy, long, marathon, race_hm, threshold, vo2 } = out;
  return { recovery, easy, long, marathon, race_hm, threshold, vo2 };
}

/**
 * Paces eines Wettkampfplans. Trainingsbereiche aus dem SICHEREREN von Zielzeit- und
 * Form-VDOT, das Renntempo aus der Zielzeit (das ist das Ziel) – ohne Zielzeit aus der
 * Form. Liegt die Zielzeit mehr als 3 VDOT-Punkte über der Form, gilt sie als
 * ambitioniert. Liefert null, wenn weder Zielzeit noch Form bekannt sind.
 * @returns {{zones:object, goalVdot:number|null, formVdot:number|null, trainingVdot:number, ambitious:boolean}|null}
 */
export function planPaces({ distanceKm, targetSec = null, formVdot = null } = {}) {
  const km = Number(distanceKm) || 0;
  if (!km) return null;
  const goalVdot = targetSec ? vdotFromPerf(km * 1000, targetSec) : null;
  const form = formVdot || null;
  const trainingVdot = goalVdot && form ? Math.min(goalVdot, form) : (goalVdot || form);
  if (!trainingVdot) return null;
  const zones = pacesFromVdot(trainingVdot);
  const racePace = goalVdot ? Math.round(targetSec / km) : racePaceFromVdot(trainingVdot, km);
  zones.race = raceZone(racePace, km);
  return {
    zones, goalVdot, formVdot: form, trainingVdot,
    ambitious: !!(goalVdot && form && goalVdot - form > 3),
  };
}

/** Eindeutig harte Laufarten – nur sie tragen die Formschätzung. */
const HARD_TYPES = ['tempo', 'interval', 'race'];
/** Alle Laufarten, die überhaupt in die Schätzung eingehen können. */
const RUN_TYPES = ['tempo', 'interval', 'race', 'long', 'easy', 'run', 'recovery'];

/** Harter Lauf: Wettkampf/Tempo/Intervall, oder hohe Anstrengung (RPE ≥ 7), oder
    Ø-Herzfrequenz ab Zone 4. Lockere Läufe setzen keine maximale Anstrengung voraus
    und unterschätzen die Form deutlich (VDOT-Formeln rechnen mit Wettkampfeinsatz). */
function isHardRun(s, z4min) {
  if (HARD_TYPES.includes(s.type)) return true;
  if (Number(s.rpe) >= 7) return true;
  return !!(z4min && Number(s.avgHr) >= z4min);
}

/** Median einer Zahlenliste (leere Liste → 0). */
function median(xs) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Schätzt die aktuelle Form (VDOT) aus den HARTEN Läufen der letzten `days`
 * (Wettkampf, Tempo, Intervalle, RPE ≥ 7 oder Ø-HF ab Zone 4) – bewusst GEGLÄTTET,
 * damit ein einzelner Trainingsausreißer die Form nicht springen lässt:
 *
 *   1) Wochenbestwert: je Kalenderwoche der beste VDOT; dämpft Ausreißer
 *      innerhalb einer Woche.
 *   2) Robuste Ausreißer-Kappung der Wochenwerte auf Median ± 3·MAD
 *      (Median Absolute Deviation – klassische robuste Statistik). Ein einzelner
 *      Fehl-/Glückswert (z. B. GPS-Fehler) wird so gekappt, echte Steigerungen
 *      bleiben erhalten.
 *   3) Rezenzgewichtetes Mittel der gekappten Wochenwerte, exponentiell mit
 *      Halbwertszeit 2 Wochen (gleiche EWMA-Idee wie Fitness/Form in load.js) –
 *      jüngere Wochen zählen mehr, aber keine einzelne Woche dominiert.
 *
 * Lockere Läufe zählen nur als Untergrenze: Die VDOT-Formeln setzen maximale
 * Anstrengung voraus, ein Grundlagenlauf unterschätzt die Form um viele Punkte.
 * Gibt es keinen harten Lauf, schätzt die Funktion aus den lockeren Läufen und
 * kennzeichnet das (`onlyEasy`) – die Anzeige nennt die Schätzung dann „eher zu
 * niedrig" und rät nicht zu langsameren Paces.
 *
 * Bei weniger als 3 Wochen mit Daten zählt der beste Einzellauf (mit der jüngsten
 * Einheit als Basis). Liefert { vdot, basis, weeks, onlyEasy, hardCount } oder null.
 * `hrZones` (optional, Profil) macht die Herzfrequenz als Härte-Merkmal nutzbar.
 */
export function estimateVdot(sessions = [], today, days = 42, { hrZones = null } = {}) {
  const z4 = Array.isArray(hrZones) ? hrZones.find((z) => z.zone === 4) : null;
  const hard = [], easy = [];
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !s.durationSec || s.distanceKm < 3) return;
    if (!RUN_TYPES.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0 || d > days) return;
    // Hügelige Läufe unterschätzen die Form: Jeder Höhenmeter bergauf zählt wie 6 m in der
    // Ebene (vorsichtige Faustregel), sobald es mehr als 5 m je km sind (TRAIN-49).
    const climb = Number(s.ascentM) > 0 && Number(s.ascentM) / s.distanceKm > 5 ? Number(s.ascentM) : 0;
    const v = vdotFromPerf(s.distanceKm * 1000 + 6 * climb, s.durationSec);
    if (!v) return;
    const run = { v, week: Math.floor(d / 7), date: s.date, distanceKm: s.distanceKm, durationSec: s.durationSec, type: s.type };
    (isHardRun(s, z4 && z4.min) ? hard : easy).push(run);
  });
  if (!hard.length && !easy.length) return null;
  if (!hard.length) return { ...smoothVdot(easy), onlyEasy: true, hardCount: 0 };
  const est = smoothVdot(hard);
  if (easy.length) {
    const floor = smoothVdot(easy).vdot;
    if (floor > est.vdot) est.vdot = floor;
  }
  return { ...est, onlyEasy: false, hardCount: hard.length };
}

/** Wochenbestwert → Ausreißer-Kappung → rezenzgewichtetes Mittel (siehe oben). */
function smoothVdot(runs) {
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
