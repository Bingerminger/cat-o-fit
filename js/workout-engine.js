/* =========================================================================
   workout-engine.js — Phasen und Zeitrechnung des Workout-Modus. Rein (ohne
   DOM, Audio oder Store) und damit per node:test prüfbar.

   - Phasen aus der Einheit: Einlaufen, Belastungen, Pausen, Auslaufen.
     Strecken-Intervalle (400 m, 1 km …) werden über die Zielpace der Einheit in
     Zeit umgerechnet – früher liefen „8×400 m“ als 8 × 3 Minuten.
   - Fortschritt nach echter Zeit: `advance(state, phases, dt)` rechnet mit der
     tatsächlich vergangenen Zeit weiter, auch über mehrere Phasen hinweg (nach
     gesperrtem Bildschirm oder gedrosseltem Hintergrund-Tab). Früher zählte jeder
     Timer-Tick fest 0,2 s – nach einer Pause liefen Belastungen zu lang.
   ========================================================================= */

import { fmtDec } from './ui.js';

import { t } from './i18n.js';

/** Ein-/Auslauftempo aus der Zielpace (deutlich ruhiger), ohne Pace 6:30 min/km. */
function easyPaceOf(unit) {
  const mid = paceMid(unit);
  return mid ? Math.round(mid * 1.25) : 390;
}
function paceMid(unit) {
  if (!unit || !unit.targetPaceSecPerKm) return null;
  return (unit.targetPaceSecPerKm + (unit.targetPaceMaxSecPerKm || unit.targetPaceSecPerKm)) / 2;
}
function kmLabel(km) { return `${fmtDec(km)} km`; }

/** Zielvorgabe einer Belastungsphase (Pace-Bereich, HF-Zone). */
export function unitTarget(unit) {
  if (!unit) return null;
  const pace = unit.targetPaceSecPerKm ? [unit.targetPaceSecPerKm, unit.targetPaceMaxSecPerKm || unit.targetPaceSecPerKm] : null;
  const hrZone = unit.targetHrZone || null;
  return pace || hrZone ? { pace, hrZone } : null;
}

/**
 * Struktur aus Titel/Beschreibung älterer Einheiten ohne Segmente, z. B.
 * „VO2max 6×800 m“, „Schwellenlauf 3×6 min“ oder „3×2 min im Renntempo“.
 * @returns {{rounds:number, workM?:number, workMin?:number}|null}
 */
export function parseStructure(text = '') {
  const m = /(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(km|m|min)\b/i.exec(String(text || ''));
  if (!m) return null;
  const rounds = parseInt(m[1], 10);
  const val = parseFloat(m[2].replace(',', '.'));
  const unit = m[3].toLowerCase();
  if (!rounds || !val) return null;
  if (unit === 'min') return { rounds, workMin: val };
  return { rounds, workM: unit === 'km' ? val * 1000 : val };
}

/**
 * Phasen einer Einheit oder null (Dauerlauf ohne Struktur → Stoppuhr).
 * Segmente (`intervals.segments`) haben Vorrang, dann eine gepflegte Runden-
 * Struktur (`intervals.rounds`), dann Titel/Beschreibung.
 */
export function buildPhases(unit) {
  if (!unit) return null;
  const iv = unit.intervals || null;
  const segs = iv && Array.isArray(iv.segments) && iv.segments.length ? iv.segments : null;
  const structuredType = ['interval', 'tempo'].includes(unit.type);
  if (!segs && !(iv && iv.rounds) && !structuredType) return null;

  const mid = paceMid(unit);
  const easy = easyPaceOf(unit);
  const target = unitTarget(unit);
  const phases = [];
  const workSecOf = (s) => {
    if (s.workM) return Math.round((s.workM / 1000) * (mid || (s.workSec ? (s.workSec * 1000) / s.workM : 300)));
    return s.workSec || 60;
  };

  let warmSec = 0, coolSec = 0, warmLabel = t('workoutEngine.warmup'), coolLabel = t('workoutEngine.cooldown'), warmWalk = false, coolWalk = false;
  if (iv && (iv.warmupSec || iv.warmupKm)) {
    warmSec = iv.warmupSec || Math.round(iv.warmupKm * easy);
    warmWalk = !iv.warmupKm;
    warmLabel = iv.warmupKm ? t('workoutEngine.warmupKm', { distance: kmLabel(iv.warmupKm) }) : t('workoutEngine.warmupWalk');
  }
  if (iv && (iv.cooldownSec || iv.cooldownKm)) {
    coolSec = iv.cooldownSec || Math.round(iv.cooldownKm * easy);
    coolWalk = !iv.cooldownKm;
    coolLabel = iv.cooldownKm ? t('workoutEngine.cooldownKm', { distance: kmLabel(iv.cooldownKm) }) : t('workoutEngine.cooldownWalk');
  }

  let work = [];
  if (segs) {
    work = segs.map((s, i) => ({
      sec: workSecOf(s), restSec: s.restSec || 0,
      label: s.phaseLabel || t('workoutEngine.work', { label: s.label || `${i + 1}/${segs.length}` }),
      restLabel: s.restLabel || (s.floatRest ? t('workoutEngine.floatRest') : t('workoutEngine.jogRest', { n: i + 1 })),
      restHint: s.walk || s.restLabel === 'Gehen' ? t('workoutEngine.hintWalk') : s.floatRest ? t('workoutEngine.hintKeepEasy') : t('workoutEngine.hintEasyJog'),
      distanceM: s.workM || null,
    }));
  } else {
    // Ältere Einheiten: gepflegte Runden oder die Struktur aus Titel/Beschreibung.
    let rounds = unit.type === 'tempo' ? 3 : 6, sec = unit.type === 'tempo' ? 360 : 180, rest = unit.type === 'tempo' ? 120 : 90, distanceM = null;
    if (iv && iv.rounds) {
      rounds = iv.rounds; sec = iv.workSec || sec; rest = iv.restSec || rest;
    } else {
      const st = parseStructure(unit.title) || parseStructure(unit.description);
      if (st) {
        rounds = st.rounds;
        if (st.workMin) sec = Math.round(st.workMin * 60);
        if (st.workM) { distanceM = st.workM; sec = Math.round((st.workM / 1000) * (mid || 300)); }
      }
      // Ohne gespeicherte Struktur: mit einem kurzen Einlaufen und Auslaufen rahmen.
      if (!warmSec) { warmSec = 600; warmLabel = t('workoutEngine.warmupDefault'); }
      if (!coolSec) { coolSec = 600; coolLabel = t('workoutEngine.cooldownDefault'); }
    }
    const lbl = distanceM ? (distanceM >= 1000 ? kmLabel(distanceM / 1000) : `${distanceM} m`) : null;
    work = Array.from({ length: rounds }, (_, i) => ({
      sec, restSec: rest, label: t('workoutEngine.work', { label: `${lbl ? `${lbl} · ` : ''}${i + 1}/${rounds}` }),
      restLabel: t('workoutEngine.jogRest', { n: i + 1 }), restHint: t('workoutEngine.hintEasyJog'), distanceM,
    }));
  }

  if (warmSec > 0) phases.push({ kind: 'warmup', sec: warmSec, label: warmLabel, hint: warmWalk ? t('workoutEngine.hintBriskWalk') : t('workoutEngine.hintEasyZones') });
  work.forEach((w, i) => {
    phases.push({ kind: 'work', sec: w.sec, label: w.label, distanceM: w.distanceM, target });
    if (w.restSec && i < work.length - 1) phases.push({ kind: 'rest', sec: w.restSec, label: w.restLabel, hint: w.restHint });
  });
  if (coolSec > 0) phases.push({ kind: 'cooldown', sec: coolSec, label: coolLabel, hint: coolWalk ? t('workoutEngine.hintEasyWalk') : t('workoutEngine.hintEasyCooldown') });
  return phases;
}

/**
 * Rechnet die Phasen um `dtSec` echte Sekunden weiter – auch über mehrere Phasen.
 * Liefert den neuen Stand und Ereignisse: `count` (3-2-1 vor dem Wechsel, nur im
 * normalen Takt, nicht beim Aufholen), `phase` (neue Phase begonnen), `done`.
 * @returns {{phase:number, phaseElapsed:number, done:boolean, events:Array}}
 */
export function advance(state, phases, dtSec) {
  let phase = state.phase || 0;
  let phaseElapsed = state.phaseElapsed || 0;
  const events = [];
  let left = Math.max(0, Number(dtSec) || 0);
  const live = left < 5;   // größere Sprünge = Aufholen nach Sperre/Hintergrund
  while (left > 1e-9 && phases && phase < phases.length) {
    const cur = phases[phase];
    const remainBefore = cur.sec - phaseElapsed;
    const step = Math.min(left, remainBefore);
    const remainAfter = remainBefore - step;
    if (live) for (const k of [3, 2, 1]) if (remainBefore > k && remainAfter <= k) events.push({ type: 'count', k });
    phaseElapsed += step;
    left -= step;
    if (phaseElapsed >= cur.sec - 1e-9) {
      phase += 1;
      phaseElapsed = 0;
      events.push(phase < phases.length ? { type: 'phase', index: phase } : { type: 'done' });
    }
  }
  return { phase, phaseElapsed, done: !!phases && phase >= phases.length, events };
}

/** Restzeit der aktuellen Phase (Sek., aufgerundet). */
export function phaseRemaining(state, phases) {
  const cur = phases && phases[state.phase];
  return cur ? Math.max(0, Math.ceil(cur.sec - (state.phaseElapsed || 0))) : 0;
}
