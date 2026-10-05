/* =========================================================================
   show-program.js — from the plan to the continuous follow-along session (pure, no DOM).

   1. `dosesFromText()` reads from a session description what the plan prescribes per exercise
      ("Squats 12× · Plank 30–45 s · Side plank 30 s/side"), plus
      rounds ("3 rounds") and the rest between the rounds ("60–90 s rest").
   2. `programForUnit()` / `programForWorkout()` turn that into a programme.
   3. `buildShow()` lays out the timeline: start, exercise (per side), side change,
      rest with preview, round rest – every movement phase on the beat
      (`beatPlan`), rests on whole bars, so that every exercise begins on "one".
   4. `showStateAt()` says what is to be seen at time t.
   ========================================================================= */

import { findExercise, exerciseMentions, exercisesForUnit } from './exercises.js';
import { MOTIONS } from './exercise-motions.js';
import { cycleOf, introOf } from './motion-rig.js';
import { STYLES, styleFor } from './music.js';
import { t as tr, tVariants } from './i18n.js';

/* Words that carry meaning in a plan text ("12×/Bein", "3 Runden", "60 s Pause"). Plan texts
   can be written in the active language, in English, or – before v4.0.0 – in German, so all
   three are understood. Each catalog value lists alternatives separated by "|". */
const LEGACY_DE = { perSide: 'Bein|Seite|Arm', perSidePhrase: 'je Seite|pro Seite', rounds: 'Runden', rest: 'Pause', and: 'und' };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function words(kind) {
  const all = new Set(LEGACY_DE[kind].split('|'));
  for (const v of tVariants(`showProgram.parse.${kind}`)) v.split('|').forEach((w) => { if (w.trim()) all.add(w.trim()); });
  return [...all].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
}
const L = '(?<![\\p{L}])', R = '(?![\\p{L}])';

const sum = (list) => list.reduce((a, p) => a + p.dur, 0);
const mid = (a, b) => (b != null ? (Number(a) + Number(b)) / 2 : Number(a));
const round5 = (s) => Math.max(5, Math.round(s / 5) * 5);

/* ------------------------------ Reading the plan text ------------------------------ */

/** Amount from the text piece of an exercise: { reps, holdS, perSide } (missing values null). */
export function doseOf(snippet = '') {
  const s = String(snippet);
  const perSide = new RegExp(`\\/\\s*(?:${words('perSide')})${R}|${L}(?:${words('perSidePhrase')})${R}`, 'iu').test(s);
  // "2×30 m" is a distance, not a repetition count.
  const reps = /(\d+)\s*(?:[–-]\s*(\d+))?\s*×(?!\s*\d)/.exec(s);
  const min = /(\d+(?:[,.]\d+)?)\s*(?:[–-]\s*(\d+))?\s*min\b/.exec(s);
  const sec = /(\d+)\s*(?:[–-]\s*(\d+))?\s*s\b/.exec(s);
  return {
    reps: reps ? Math.round(mid(reps[1], reps[2])) : null,
    holdS: sec ? round5(mid(sec[1], sec[2])) : min ? round5(mid(String(min[1]).replace(',', '.'), min[2]) * 60) : null,
    perSide,
  };
}

/**
 * What a description prescribes: exercises in order with amount, rounds and rest
 * between the rounds. The text piece of an exercise extends to the next "·" or
 * end of sentence.
 */
export function dosesFromText(text = '') {
  text = String(text || '');
  const mentions = exerciseMentions(text);
  const items = mentions.map(({ e, first }, i) => {
    const next = i + 1 < mentions.length ? mentions[i + 1].first : text.length;
    let snippet = text.slice(first, next);
    const cut = snippet.search(/·|;|\.\s|\n/);
    if (cut > 0) snippet = snippet.slice(0, cut);
    // "Chest opener & spine rotation 8×/side": without a number of its own, that of the next one applies.
    return { id: e.id, ...doseOf(snippet), joined: !/\d/.test(snippet) && new RegExp(`(&|${L}(?:${words('and')})|,|\\/)\\s*$`, 'iu').test(snippet) };
  });
  for (let i = items.length - 2; i >= 0; i--) {
    if (items[i].joined) { const { reps, holdS, perSide } = items[i + 1]; Object.assign(items[i], { reps, holdS, perSide }); }
  }
  items.forEach((it) => { delete it.joined; });
  const rounds = new RegExp(`(\\d+)\\s*(?:[–-]\\s*\\d+)?\\s*(?:${words('rounds')})${R}`, 'iu').exec(text);
  const pause = new RegExp(`(\\d+)\\s*(?:[–-]\\s*\\d+)?\\s*s\\s*(?:${words('rest')})${R}`, 'iu').exec(text);
  return { items, rounds: rounds ? Number(rounds[1]) : null, roundRest: pause ? Number(pause[1]) : null };
}

/* ------------------------------ Programmes ------------------------------ */

/** Main style of a programme: mobility → calm, otherwise by the most exercises. */
function styleOf(items, hint = null) {
  if (hint) return hint;
  const count = {};
  for (const it of items) { const c = it.ex.category; count[c] = (count[c] || 0) + 1; }
  const top = Object.entries(count).sort((a, b) => b[1] - a[1] || (a[0] === 'strength' ? -1 : 1))[0];
  return styleFor(top ? top[0] : 'strength');
}

const itemOf = (id, dose = {}) => {
  const ex = findExercise(id);
  const m = MOTIONS[id];
  if (!ex || !m) return null;
  return { id, ex, m, reps: dose.reps ?? null, holdS: dose.holdS ?? null, work: dose.work ?? null };
};

/**
 * Programme of a plan session: first the exercises from the description (with amount),
 * then those appended via "+". Without exercises → null.
 */
export function programForUnit(unit = {}) {
  const text = `${unit.title || ''} · ${unit.description || ''}`;
  const parsed = dosesFromText(text);
  const seen = new Set();
  const items = [];
  for (const d of parsed.items) { const it = itemOf(d.id, d); if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); } }
  for (const id of Array.isArray(unit.exerciseIds) ? unit.exerciseIds : []) { const it = itemOf(id); if (it && !seen.has(id)) { seen.add(id); items.push(it); } }
  if (!items.length) return null;
  const calm = unit.type === 'mobility' || unit.type === 'recovery';
  return {
    title: unit.title || tr('showProgram.unit'),
    format: 'plan',
    style: styleOf(items, calm ? 'flow' : null),
    rounds: parsed.rounds || (calm ? 1 : 2),
    rest: calm ? 10 : 20,
    roundRest: parsed.roundRest || (calm ? 20 : 60),
    items,
  };
}

/** Programme of a finished workout (workouts.js): fixed work and rest time. */
export function programForWorkout(w) {
  const items = w.items.map((x) => (typeof x === 'string' ? itemOf(x, { work: w.work }) : itemOf(x.id, { work: x.work || w.work }))).filter(Boolean);
  return { title: w.title, format: 'interval', style: w.style || styleOf(items), rounds: w.rounds || 1, rest: w.rest ?? 15, roundRest: w.roundRest ?? 45, items, workoutId: w.id };
}

/** What an exercise lasts in the programme and prescribes (for overview and announcement). */
export function doseLabel(it, program) {
  const each = it.m.sides === 'each';
  const side = it.m.sides ? ` ${tr('showProgram.perSide')}` : '';
  const eachSide = each ? ` ${tr('showProgram.perSide')}` : '';
  if (program.format === 'interval') return `${it.work || 40} s${eachSide}`;
  if (it.m.holdS != null) return `${it.holdS || it.m.holdS} s${eachSide}`;
  return `${it.reps || it.m.reps || 10}×${side}`;
}

/* ------------------------------ Timeline ------------------------------ */

const barOf = (bpm) => (4 * 60) / bpm;
/** Round to whole bars (at least `minBars`). */
const toBars = (sec, bpm, minBars = 1) => Math.max(minBars, Math.round(sec / barOf(bpm))) * barOf(bpm);

/**
 * Movement on the beat: every phase of a cycle (down, hold, up …) lasts whole
 * or half beats (very fast movements quarter beats), one repetition
 * whole beats – so movement changes fall on the beat. The tempo chosen within the style's range is the one that distorts the movement
 * least (even beat counts preferred). Returns { bpm, beat, beats,
 * q (half beats per phase as beats), cyc } – `retime()` lays that onto a list.
 */
export function beatPlan(cycle, style = 'power') {
  const [lo, hi] = (STYLES[style] || STYLES.power).bpm;
  const mid = (lo + hi) / 2;
  const raw = sum(cycle) || 1;
  let best = null;
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += 0.5) {
    const beat = 60 / bpm;
    // Half beats; very fast movements (jumps) to quarter beats.
    const q = cycle.map((ph) => {
      // Movements under one beat to quarter beats, otherwise to half. No movement becomes faster than
      // planned (by more than 15 %) – following along takes priority over the beat.
      const res = ph.dur < beat ? 4 : 2;
      let n = Math.round((ph.dur / beat) * res) / res;
      if (!ph.hold && n * beat < ph.dur * 0.85) n += 1 / res;
      return ph.hold ? n : Math.max(1 / res, n);
    });
    let beats = q.reduce((a, b) => a + b, 0);
    // One repetition lasts whole beats – very fast ones (jumps) half a beat.
    const unit = beats < 0.75 ? 0.5 : 1;
    const missing = Math.ceil(beats / unit - 1e-9) * unit - beats;
    if (missing > 1e-9) {
      // Bring to whole beats: shorten a short hold phase, otherwise lengthen the longest.
      const extra = unit - missing;
      const cut = cycle.findIndex((ph, i) => ph.hold && q[i] >= extra - 1e-9 && beats - extra >= unit);
      if (cut >= 0) { q[cut] -= extra; beats -= extra; } else {
        let k = -1;
        cycle.forEach((ph, i) => { if (ph.hold && (k < 0 || q[i] > q[k])) k = i; });
        q[k >= 0 ? k : q.length - 1] += missing; beats += missing;
      }
    }
    beats = Math.round(beats / unit) * unit;
    if (beats <= 0) continue;
    const err = cycle.reduce((a, ph, i) => a + Math.abs(q[i] * beat - ph.dur), 0) / raw;
    const cost = err * 3 + (beats % 2 ? 0.12 : 0) + (beats % 4 ? 0.05 : 0) + (Math.abs(bpm - mid) / (hi - lo)) * 0.15;
    if (!best || cost < best.cost) best = { bpm, beat, beats, q, cost };
  }
  return { bpm: best.bpm, beat: best.beat, beats: best.beats, q: best.q, cyc: best.beats * best.beat };
}

/** Lay the phases of a list onto the beat (phases without a duration are dropped). */
export function retime(list, plan) {
  return list.map((ph, i) => ({ ...ph, dur: plan.q[i] * plan.beat })).filter((ph) => ph.dur > 0);
}

/**
 * Frame sequence of a preview (rest/start/side change) of the next exercise: first one
 * to two trial repetitions on the beat or the starting pose, at the end the way into the
 * position – it ends exactly with the section in the starting pose.
 */
function previewClips(it, side, dur, plan) {
  const intro = introOf(it.m, side);
  const introDur = sum(intro);
  const cyc = retime(cycleOf(it.m, side), plan);
  if (intro.length) {
    const lead = Math.max(0, dur - introDur);
    return [{ at: 0, dur: lead, list: intro, speed: 0 }, { at: lead, dur: introDur, list: intro, speed: 1, once: true }];
  }
  const reps = it.m.holdS != null ? 0 : Math.max(0, Math.min(2, Math.floor((dur - 2) / plan.cyc)));
  const demo = reps * plan.cyc;
  return [{ at: 0, dur: demo, list: cyc, speed: 1, loop: true }, { at: demo, dur: dur - demo, list: cyc, speed: 0 }];
}

/**
 * Timeline of the session: sections { kind, i, round, side, dur, t0, bpm, style,
 * intensity, clips, reps?, cyc? } and total duration.
 * kind: ready · work · switch · rest · roundRest.
 */
export function buildShow(program) {
  const style = program.style || 'power';
  const segs = [];
  const n = program.items.length;
  const plans = program.items.map((it) => beatPlan(cycleOf(it.m, 'a'), style));
  const push = (seg) => segs.push(seg);

  for (let r = 1; r <= program.rounds; r++) {
    for (let i = 0; i < n; i++) {
      const it = program.items[i];
      const tp = plans[i];
      const sides = it.m.sides === 'each' ? ['a', 'b'] : ['a'];
      const introA = sum(introOf(it.m, 'a'));
      // Before it: start (very first exercise), round rest or rest – with a preview of this exercise.
      // The start leaves time to walk from the device to the mat.
      if (r === 1 && i === 0) {
        const dur = toBars(Math.max(12, introA + 4), tp.bpm, 2);
        push({ kind: 'ready', i, round: r, side: 'a', dur, bpm: tp.bpm, style, intensity: 1, clips: previewClips(it, 'a', dur, tp) });
      } else if (i === 0) {
        const dur = toBars(Math.max(program.roundRest, introA + 4), tp.bpm, 2);
        push({ kind: 'roundRest', i, round: r, side: 'a', dur, bpm: tp.bpm, style, intensity: 0, clips: previewClips(it, 'a', dur, tp) });
      } else {
        const dur = toBars(Math.max(program.rest, introA + 3), tp.bpm, 2);
        push({ kind: 'rest', i, round: r, side: 'a', dur, bpm: tp.bpm, style, intensity: 0, clips: previewClips(it, 'a', dur, tp) });
      }
      sides.forEach((side, k) => {
        if (k > 0) {
          // Side change: time to turn around or lie down again.
          const dur = toBars(Math.max(8, sum(introOf(it.m, side)) + 3), tp.bpm, 2);
          push({ kind: 'switch', i, round: r, side, dur, bpm: tp.bpm, style, intensity: 1, clips: previewClips(it, side, dur, tp) });
        }
        const list = retime(cycleOf(it.m, side), tp);
        if (program.format === 'interval' || it.m.holdS != null) {
          const secs = program.format === 'interval' ? (it.work || 40) : (it.holdS || it.m.holdS);
          // Timed exercises keep running on the beat; the duration ends on a whole beat.
          const dur = Math.max(tp.beat, Math.round(secs / tp.beat) * tp.beat);
          push({ kind: 'work', i, round: r, side, dur, bpm: tp.bpm, style, intensity: 2, timed: true, cyc: tp.cyc, clips: [{ at: 0, dur, list, speed: 1, loop: true }] });
        } else {
          const reps = it.reps || it.m.reps || 10;
          push({ kind: 'work', i, round: r, side, dur: reps * tp.cyc, bpm: tp.bpm, style, intensity: 2, reps, cyc: tp.cyc, clips: [{ at: 0, dur: reps * tp.cyc, list, speed: 1, loop: true }] });
        }
      });
    }
  }
  let t = 0;
  for (const s of segs) { s.t0 = t; t += s.dur; }
  return { program, segs, total: t };
}

/**
 * State at time t: section, time within it, remaining time, repetition,
 * animation time (`anim`: { list, t }) and overall progress.
 */
export function showStateAt(show, t) {
  const segs = show.segs;
  if (!segs.length || t >= show.total) return { done: true, seg: segs[segs.length - 1] || null, index: segs.length - 1, local: 0, left: 0, progress: 1 };
  let i = 0;
  while (i < segs.length - 1 && t >= segs[i].t0 + segs[i].dur) i++;
  const seg = segs[i];
  const local = Math.max(0, t - seg.t0);
  const out = { done: false, seg, index: i, local, left: seg.dur - local, progress: t / show.total };
  if (seg.kind === 'work' && seg.cyc) out.rep = Math.floor(local / seg.cyc) + 1;
  if (seg.reps) out.rep = Math.min(seg.reps, out.rep);
  out.anim = clipAt(seg.clips, local);
  return out;
}

/** Animation time within the frame sequence of a section. */
export function clipAt(clips, local) {
  let c = clips[0];
  for (const x of clips) if (local >= x.at - 1e-9 && x.dur > 0) c = x;
  const k = local - c.at;
  const total = sum(c.list) || 1;
  let t = c.speed ? k * c.speed : 0;
  if (c.once) t = Math.min(t, total - 1e-6);
  return { list: c.list, t, clip: c };
}

/** Next exercise (index) from a section on – for "Up next". */
export function nextWorkAfter(show, index) {
  for (let k = index + 1; k < show.segs.length; k++) if (show.segs[k].kind === 'work' && show.segs[k].i !== show.segs[index].i) return show.segs[k];
  return null;
}

/** A programme from a session – if there is one (for the "Follow along non-stop" buttons). */
export function hasProgram(unit) {
  if (!unit) return false;
  return exercisesForUnit(unit).named.length > 0 || (Array.isArray(unit.exerciseIds) && unit.exerciseIds.some((id) => MOTIONS[id]));
}
