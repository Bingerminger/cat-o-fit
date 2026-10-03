/* =========================================================================
   show-program.js — vom Plan zur durchgehenden Mitmach-Session (rein, ohne DOM).

   1. `dosesFromText()` liest aus einer Einheitsbeschreibung, was der Plan je Übung
      vorgibt („Kniebeugen 12× · Plank 30–45 s · Seitstütz 30 s/Seite“), dazu
      Runden („3 Runden“) und die Pause zwischen den Runden („60–90 s Pause“).
   2. `programForUnit()` / `programForWorkout()` machen daraus ein Programm.
   3. `buildShow()` legt die Zeitleiste an: Start, Übung (je Seite), Seitenwechsel,
      Pause mit Vorschau, Rundenpause – jede Bewegungsphase auf dem Beat
      (`beatPlan`), Pausen auf ganze Takte, damit jede Übung auf „Eins“ beginnt.
   4. `showStateAt()` sagt, was zum Zeitpunkt t zu sehen ist.
   ========================================================================= */

import { findExercise, exerciseMentions, exercisesForUnit } from './exercises.js';
import { MOTIONS } from './exercise-motions.js';
import { cycleOf, introOf } from './motion-rig.js';
import { STYLES, styleFor } from './music.js';

const sum = (list) => list.reduce((a, p) => a + p.dur, 0);
const mid = (a, b) => (b != null ? (Number(a) + Number(b)) / 2 : Number(a));
const round5 = (s) => Math.max(5, Math.round(s / 5) * 5);

/* ------------------------------ Plantext lesen ------------------------------ */

/** Menge aus dem Textstück einer Übung: { reps, holdS, perSide } (fehlende Werte null). */
export function doseOf(snippet = '') {
  const s = String(snippet);
  const perSide = /\/\s*(Bein|Seite|Arm)\b|je Seite|pro Seite/i.test(s);
  // „2×30 m“ ist eine Strecke, keine Wiederholungszahl.
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
 * Was eine Beschreibung vorgibt: Übungen in Reihenfolge mit Menge, Runden und Pause
 * zwischen den Runden. Das Textstück einer Übung reicht bis zum nächsten „·“ bzw.
 * Satzende.
 */
export function dosesFromText(text = '') {
  const t = String(text || '');
  const mentions = exerciseMentions(t);
  const items = mentions.map(({ e, first }, i) => {
    const next = i + 1 < mentions.length ? mentions[i + 1].first : t.length;
    let snippet = t.slice(first, next);
    const cut = snippet.search(/·|;|\.\s|\n/);
    if (cut > 0) snippet = snippet.slice(0, cut);
    // „Brustöffner & Wirbelsäulen-Rotation 8×/Seite“: ohne eigene Zahl gilt die der nächsten.
    return { id: e.id, ...doseOf(snippet), joined: !/\d/.test(snippet) && /(&|\bund|,|\/)\s*$/.test(snippet) };
  });
  for (let i = items.length - 2; i >= 0; i--) {
    if (items[i].joined) { const { reps, holdS, perSide } = items[i + 1]; Object.assign(items[i], { reps, holdS, perSide }); }
  }
  items.forEach((it) => { delete it.joined; });
  const rounds = /(\d+)\s*(?:[–-]\s*\d+)?\s*Runden/.exec(t);
  const pause = /(\d+)\s*(?:[–-]\s*\d+)?\s*s\s*Pause/.exec(t);
  return { items, rounds: rounds ? Number(rounds[1]) : null, roundRest: pause ? Number(pause[1]) : null };
}

/* ------------------------------ Programme ------------------------------ */

/** Hauptstil eines Programms: Beweglichkeit → ruhig, sonst nach den meisten Übungen. */
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
 * Programm einer Plan-Einheit: zuerst die Übungen aus der Beschreibung (mit Menge),
 * dann die per „+“ angehängten. Ohne Übungen → null.
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
    title: unit.title || 'Einheit',
    format: 'plan',
    style: styleOf(items, calm ? 'flow' : null),
    rounds: parsed.rounds || (calm ? 1 : 2),
    rest: calm ? 10 : 20,
    roundRest: parsed.roundRest || (calm ? 20 : 60),
    items,
  };
}

/** Programm eines fertigen Workouts (workouts.js): feste Arbeits- und Pausenzeit. */
export function programForWorkout(w) {
  const items = w.items.map((x) => (typeof x === 'string' ? itemOf(x, { work: w.work }) : itemOf(x.id, { work: x.work || w.work }))).filter(Boolean);
  return { title: w.title, format: 'interval', style: w.style || styleOf(items), rounds: w.rounds || 1, rest: w.rest ?? 15, roundRest: w.roundRest ?? 45, items, workoutId: w.id };
}

/** Was eine Übung im Programm dauert und vorgibt (für Übersicht und Ansage). */
export function doseLabel(it, program) {
  const each = it.m.sides === 'each';
  const side = it.m.sides ? ' je Seite' : '';
  if (program.format === 'interval') return `${it.work || 40} s${each ? ' je Seite' : ''}`;
  if (it.m.holdS != null) return `${it.holdS || it.m.holdS} s${each ? ' je Seite' : ''}`;
  return `${it.reps || it.m.reps || 10}×${side}`;
}

/* ------------------------------ Zeitleiste ------------------------------ */

const barOf = (bpm) => (4 * 60) / bpm;
/** Auf ganze Takte runden (mindestens `minBars`). */
const toBars = (sec, bpm, minBars = 1) => Math.max(minBars, Math.round(sec / barOf(bpm))) * barOf(bpm);

/**
 * Bewegung im Takt: Jede Phase eines Zyklus (runter, halten, hoch …) dauert ganze
 * oder halbe Schläge (sehr schnelle Bewegungen Viertelschläge), eine Wiederholung
 * ganze Schläge – Bewegungswechsel fallen so auf den Beat. Gewählt wird das Tempo im Bereich des Stils, das die Bewegung am
 * wenigsten verbiegt (gerade Schlagzahlen bevorzugt). Liefert { bpm, beat, beats,
 * q (Halbschläge je Phase als Schläge), cyc } – `retime()` legt das auf eine Liste.
 */
export function beatPlan(cycle, style = 'power') {
  const [lo, hi] = (STYLES[style] || STYLES.power).bpm;
  const mid = (lo + hi) / 2;
  const raw = sum(cycle) || 1;
  let best = null;
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += 0.5) {
    const beat = 60 / bpm;
    // Halbe Schläge; sehr schnelle Bewegungen (Sprünge) auf Viertelschläge.
    const q = cycle.map((ph) => {
      // Bewegungen unter einem Schlag auf Viertelschläge, sonst auf halbe. Schneller als
      // geplant (um mehr als 15 %) wird keine Bewegung – mitmachen geht vor Takt.
      const res = ph.dur < beat ? 4 : 2;
      let n = Math.round((ph.dur / beat) * res) / res;
      if (!ph.hold && n * beat < ph.dur * 0.85) n += 1 / res;
      return ph.hold ? n : Math.max(1 / res, n);
    });
    let beats = q.reduce((a, b) => a + b, 0);
    // Eine Wiederholung dauert ganze Schläge – sehr schnelle (Sprünge) einen halben.
    const unit = beats < 0.75 ? 0.5 : 1;
    const missing = Math.ceil(beats / unit - 1e-9) * unit - beats;
    if (missing > 1e-9) {
      // Auf ganze Schläge bringen: eine kurze Haltephase kürzen, sonst die längste verlängern.
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

/** Die Phasen einer Liste auf den Takt legen (Phasen ohne Dauer fallen weg). */
export function retime(list, plan) {
  return list.map((ph, i) => ({ ...ph, dur: plan.q[i] * plan.beat })).filter((ph) => ph.dur > 0);
}

/**
 * Bildfolge einer Vorschau (Pause/Start/Seitenwechsel) auf die nächste Übung: erst ein
 * bis zwei Probe-Wiederholungen im Takt bzw. die Ausgangspose, am Ende der Weg in die
 * Position – er endet genau mit dem Abschnitt in der Startpose.
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
 * Zeitleiste der Session: Abschnitte { kind, i, round, side, dur, t0, bpm, style,
 * intensity, clips, reps?, cyc? } und Gesamtdauer.
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
      // Davor: Start (allererste Übung), Rundenpause oder Pause – mit Vorschau auf diese Übung.
      // Der Start lässt Zeit, vom Gerät zur Matte zu gehen.
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
          // Seitenwechsel: Zeit zum Umdrehen bzw. neu Hinlegen.
          const dur = toBars(Math.max(8, sum(introOf(it.m, side)) + 3), tp.bpm, 2);
          push({ kind: 'switch', i, round: r, side, dur, bpm: tp.bpm, style, intensity: 1, clips: previewClips(it, side, dur, tp) });
        }
        const list = retime(cycleOf(it.m, side), tp);
        if (program.format === 'interval' || it.m.holdS != null) {
          const secs = program.format === 'interval' ? (it.work || 40) : (it.holdS || it.m.holdS);
          // Zeitübungen laufen im Takt weiter; die Dauer endet auf einem ganzen Schlag.
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
 * Zustand zum Zeitpunkt t: Abschnitt, Zeit darin, Restzeit, Wiederholung,
 * Animationszeit (`anim`: { list, t }) und Gesamtfortschritt.
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

/** Animationszeit innerhalb der Bildfolge eines Abschnitts. */
export function clipAt(clips, local) {
  let c = clips[0];
  for (const x of clips) if (local >= x.at - 1e-9 && x.dur > 0) c = x;
  const k = local - c.at;
  const total = sum(c.list) || 1;
  let t = c.speed ? k * c.speed : 0;
  if (c.once) t = Math.min(t, total - 1e-6);
  return { list: c.list, t, clip: c };
}

/** Nächste Übung (Index) ab einem Abschnitt – für „Als Nächstes“. */
export function nextWorkAfter(show, index) {
  for (let k = index + 1; k < show.segs.length; k++) if (show.segs[k].kind === 'work' && show.segs[k].i !== show.segs[index].i) return show.segs[k];
  return null;
}

/** Ein Programm aus einer Einheit – wenn es eins gibt (für Knöpfe „Durchgehend mitmachen“). */
export function hasProgram(unit) {
  if (!unit) return false;
  return exercisesForUnit(unit).named.length > 0 || (Array.isArray(unit.exerciseIds) && unit.exerciseIds.some((id) => MOTIONS[id]));
}
