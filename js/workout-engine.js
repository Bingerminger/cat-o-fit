/* =========================================================================
   workout-engine.js — phases and timing of the workout mode. Pure (no
   DOM, audio or store) and therefore testable with node:test.

   - Phases from the session: warm-up, work intervals, rests, cool-down.
     Distance intervals (400 m, 1 km …) are converted into time via the session's
     target pace – previously "8×400 m" ran as 8 × 3 minutes.
   - Progress by real time: `advance(state, phases, dt)` carries on with the
     time that has actually elapsed, even across several phases (after a locked
     screen or a throttled background tab). Previously every timer tick counted
     a fixed 0.2 s – after a pause the work intervals ran too long.
   ========================================================================= */

import { fmtDec } from './ui.js';

import { t } from './i18n.js';

/** Warm-up/cool-down pace derived from the target pace (clearly easier); without a pace 6:30 min/km. */
function easyPaceOf(unit) {
  const mid = paceMid(unit);
  return mid ? Math.round(mid * 1.25) : 390;
}
function paceMid(unit) {
  if (!unit || !unit.targetPaceSecPerKm) return null;
  return (unit.targetPaceSecPerKm + (unit.targetPaceMaxSecPerKm || unit.targetPaceSecPerKm)) / 2;
}
function kmLabel(km) { return `${fmtDec(km)} km`; }

/** Target for a work phase (pace range, HR zone). */
export function unitTarget(unit) {
  if (!unit) return null;
  const pace = unit.targetPaceSecPerKm ? [unit.targetPaceSecPerKm, unit.targetPaceMaxSecPerKm || unit.targetPaceSecPerKm] : null;
  const hrZone = unit.targetHrZone || null;
  return pace || hrZone ? { pace, hrZone } : null;
}

/**
 * Structure from the title/description of older sessions without segments, e.g.
 * "VO2max 6×800 m", "Threshold run 3×6 min" or "3×2 min at race pace".
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
 * Phases of a session, or null (continuous run without structure → stopwatch).
 * Segments (`intervals.segments`) take precedence, then a maintained rounds
 * structure (`intervals.rounds`), then title/description.
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
    // Older sessions: maintained rounds, or the structure from title/description.
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
      // Without a stored structure: frame it with a short warm-up and cool-down.
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
 * Carries the phases forward by `dtSec` real seconds – also across several phases.
 * Returns the new state and events: `count` (3-2-1 before the change, only in the
 * normal tick, not when catching up), `phase` (new phase started), `done`.
 * @returns {{phase:number, phaseElapsed:number, done:boolean, events:Array}}
 */
export function advance(state, phases, dtSec) {
  let phase = state.phase || 0;
  let phaseElapsed = state.phaseElapsed || 0;
  const events = [];
  let left = Math.max(0, Number(dtSec) || 0);
  const live = left < 5;   // larger jumps = catching up after a lock/background
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

/** Time remaining in the current phase (seconds, rounded up). */
export function phaseRemaining(state, phases) {
  const cur = phases && phases[state.phase];
  return cur ? Math.max(0, Math.ceil(cur.sec - (state.phaseElapsed || 0))) : 0;
}
