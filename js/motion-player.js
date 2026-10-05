/* =========================================================================
   motion-player.js — follow-along player of an exercise.

   Two modes: the preview shows the sequence in a loop (with reduced motion
   only on button press). "Follow along" leads through a block of sets with
   repetitions or seconds, side change and rest – in real time with the beat, with phase,
   short hint, breathing and optionally a beat tone.

   The scheduling (`buildPlan`, `stateAt`) is pure logic and tested; the display
   runs via requestAnimationFrame only while the image is attached to the document and the
   page is visible.
   ========================================================================= */

import { el, icon, segmented } from './ui.js';
import { mountFigure, motionSVG, thumbKeys } from './motion-figure.js';
import { cycleOf, introOf } from './motion-rig.js';
import { tone, unlockAudio, keepAwake } from './audio.js';

import { t, tp } from './i18n.js';

const sum = (list) => list.reduce((a, p) => a + p.dur, 0);
const mmss = (s) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** Default for "Follow along" per exercise and category. */
export function defaultsFor(m, category = 'strength') {
  const time = m.holdS != null;
  return {
    reps: time ? null : (m.reps || 10),
    holdS: time ? m.holdS : null,
    sets: category === 'mobility' ? 2 : 3,
    rest: category === 'mobility' ? 15 : category === 'cardio' ? 30 : 60,
  };
}

/**
 * Schedule of a training block: sections { kind, set, side, list, dur, t0 }.
 * kind: intro (way into the position) · reps · time · switch (side change) · rest.
 */
export function buildPlan(m, { reps = null, holdS = null, sets = 3, rest = 60, switchS = 4 } = {}) {
  const segs = [];
  const sides = m.sides === 'each' ? ['a', 'b'] : ['a'];
  for (let s = 1; s <= sets; s++) {
    sides.forEach((side, i) => {
      const intro = introOf(m, side);
      if (intro.length) segs.push({ kind: 'intro', set: s, side, list: intro, dur: sum(intro) });
      const list = cycleOf(m, side);
      const cyc = sum(list);
      if (holdS != null) segs.push({ kind: 'time', set: s, side, list, cyc, dur: holdS });
      else segs.push({ kind: 'reps', set: s, side, list, cyc, reps, dur: reps * cyc });
      if (i < sides.length - 1) segs.push({ kind: 'switch', set: s, side: sides[i + 1], list: cycleOf(m, sides[i + 1]), dur: switchS });
    });
    if (s < sets) segs.push({ kind: 'rest', set: s, side: 'a', list: cycleOf(m, 'a'), dur: rest });
  }
  let at = 0;
  for (const g of segs) { g.t0 = at; at += g.dur; }
  return { segs, total: at, sets, reps, holdS };
}

/** State at time t (seconds) in the plan: section, set, repetition, remaining time. */
export function stateAt(plan, time) {
  const last = plan.segs[plan.segs.length - 1];
  if (time >= plan.total) return { done: true, seg: last, set: plan.sets, side: last.side, local: last.dur, left: 0 };
  let i = 0;
  while (i < plan.segs.length - 1 && time >= plan.segs[i].t0 + plan.segs[i].dur) i++;
  const seg = plan.segs[i];
  const local = Math.max(0, time - seg.t0);
  const out = { done: false, seg, index: i, local, set: seg.set, side: seg.side, left: seg.dur - local };
  if (seg.kind === 'reps') out.rep = Math.min(seg.reps, Math.floor(local / seg.cyc) + 1);
  return out;
}

/** Label of the side (pass a/b): the moved side is the right one in the poses. */
export function sideLabel(m, pass) {
  if (!m.sides) return '';
  const labels = m.sideLabels || ['rechts', 'links'];
  return pass === 'b' ? labels[1] : labels[0];
}

/* ------------------------------ Beat tone ------------------------------ */

/** Signal tone via audio.js (unlocked there so that iPhone/iPad also sound on "silent"). */
const beep = (freq = 880, ms = 110, gain = 0.28) => tone(freq, { ms, gain });

/* ------------------------------ Display ------------------------------ */

/**
 * Builds the player in `host`. `ex` = catalogue entry, `m` = movement sequence.
 * Returns { stop, tick } – `tick(dt)` advances without animation (tests).
 */
export function mountPlayer(host, ex, m, { color = '', category = ex.category, onDone = null } = {}) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cfg = defaultsFor(m, category);
  let mode = 'preview';         // preview | train | paused | done
  let speed = 1;
  let sound = false;
  let clock = 0;                // time in the current mode (seconds, with tempo)
  let plan = null;
  let lastPhaseKey = '';
  let lastBeepSec = -1;
  let lastCue = '';
  let raf = 0; let last = 0;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('motion.animationOf', { name: ex.name }));
  const fig = mountFigure(svg, m, { color });
  const still = el('div', { class: 'mp-still', html: motionSVG(m, { ...thumbKeys(m), color }) });
  const phaseChip = el('span', { class: 'mp-chip mp-chip--phase' });
  const sideChip = el('span', { class: 'mp-chip mp-chip--side' });
  const stage = el('div', { class: 'mp-stage' }, [svg, still, el('div', { class: 'mp-chips' }, [phaseChip, sideChip])]);
  // Reduced motion: still image, tapping plays the sequence.
  still.addEventListener('click', () => { if (mode === 'preview') { showMotion(true); loop(); } });
  const barFill = el('span', { class: 'mp-bar__fill' });
  const bar = el('div', { class: 'mp-bar', 'aria-hidden': 'true' }, [barFill]);
  const count = el('div', { class: 'mp-count', 'aria-live': 'polite' });
  const cue = el('div', { class: 'mp-cue' });
  const breath = el('span', { class: 'mp-breath' });

  // Settings for "Follow along": repetitions or seconds and sets.
  const stepper = (label, get, set, step, min, max, unit) => {
    const val = el('span', { class: 'mp-step__val' });
    const paint = () => { val.textContent = `${get()}${unit}`; };
    const btn = (d, txt, aria) => el('button', { class: 'icon-btn mp-step__btn', type: 'button', 'aria-label': aria, onclick: () => { set(Math.min(max, Math.max(min, get() + d))); paint(); } }, txt);
    paint();
    return el('div', { class: 'mp-step' }, [el('span', { class: 'mp-step__label', text: label }), btn(-step, '−', t('motion.less', { label })), val, btn(step, '+', t('motion.more', { label }))]);
  };
  const steppers = el('div', { class: 'mp-steps' }, [
    cfg.holdS != null
      ? stepper(t('motion.time'), () => cfg.holdS, (v) => { cfg.holdS = v; }, 5, 10, 180, ' s')
      : stepper(m.sides ? t('motion.repsEachSide') : t('motion.reps'), () => cfg.reps, (v) => { cfg.reps = v; }, 1, 1, 50, ''),
    stepper(t('motion.sets'), () => cfg.sets, (v) => { cfg.sets = v; }, 1, 1, 6, ''),
  ]);

  const mainBtn = el('button', { class: 'btn btn--primary grow', type: 'button', onclick: () => onMain() });
  const resetBtn = el('button', { class: 'btn btn--ghost', type: 'button', 'aria-label': t('motion.restart'), title: t('motion.restart'), onclick: () => reset() }, [icon('refresh')]);
  const soundBtn = el('button', { class: 'btn btn--ghost', type: 'button', 'aria-pressed': 'false', title: t('motion.beatTone'), onclick: () => {
    sound = !sound; soundBtn.setAttribute('aria-pressed', String(sound)); soundBtn.classList.toggle('is-on', sound);
    if (sound) { unlockAudio(); beep(660, 120, 0.3); }
  } }, [icon('bell'), el('span', { text: t('motion.sound') })]);
  const tempo = segmented([{ value: '1', label: t('motion.normal') }, { value: '0.6', label: t('motion.slow') }], '1', (v) => { speed = Number(v); }, { label: t('motion.tempo') });

  host.appendChild(el('div', { class: 'mp' }, [
    stage, bar, count,
    el('div', { class: 'mp-cue-row' }, [cue, breath]),
    steppers,
    el('div', { class: 'mp-controls' }, [mainBtn, resetBtn, soundBtn]),
    el('div', { class: 'mp-tempo' }, [el('span', { class: 'mp-tempo__label', text: t('motion.tempo') }), tempo]),
  ]));

  function paintButton() {
    mainBtn.innerHTML = '';
    const set = (ic, txt) => { mainBtn.appendChild(icon(ic)); mainBtn.appendChild(el('span', { text: txt })); };
    if (mode === 'train') set('pause', t('motion.pause'));
    else if (mode === 'paused') set('play', t('motion.resume'));
    else if (mode === 'done') set('refresh', t('motion.again'));
    else set('play', t('motion.followAlong'));
    steppers.hidden = mode === 'train' || mode === 'paused';
  }

  const setText = (node, txt) => { if (node.textContent !== txt) node.textContent = txt; };

  /** Draw a frame and set the caption. */
  function render() {
    let fr = null; let label = ''; let status = ''; let progress = 0; let pass = 'a';
    if (mode === 'preview') {
      const intro = introOf(m, 'a');
      const introDur = sum(intro);
      fr = clock < introDur ? fig.update(clock, intro) : fig.update(clock - introDur, cycleOf(m, 'a'));
      label = fr.phase.label; pass = fr.phase.pass;
      status = cfg.holdS != null ? t('motion.previewHold', { s: cfg.holdS })
        : m.sides ? t('motion.previewRepsEachSide', { n: cfg.reps }) : t('motion.previewReps', { n: cfg.reps });
      progress = fr.k;
    } else {
      const st = stateAt(plan, clock);
      const seg = st.seg;
      if (st.done) {
        fr = fig.update(0, seg.list); label = t('motion.done'); status = tp('motion.doneSets', plan.sets); progress = 1;
        if (mode !== 'done') finish();
      } else if (seg.kind === 'rest' || seg.kind === 'switch') {
        fr = fig.update(0, seg.list);
        label = seg.kind === 'rest' ? t('motion.rest') : t('motion.switchSides');
        status = seg.kind === 'rest' ? t('motion.restStatus', { time: mmss(st.left), set: seg.set + 1, sets: plan.sets }) : t('motion.switchStatus', { time: mmss(st.left) });
        progress = st.local / seg.dur;
        pass = seg.side;
        countdownBeep(st.left);
      } else {
        fr = fig.update(st.local, seg.list);
        label = fr.phase.label; pass = fr.phase.pass === 'b' || seg.side === 'b' ? 'b' : 'a';
        const setTxt = t('motion.setOf', { set: seg.set, sets: plan.sets });
        if (seg.kind === 'intro') status = t('motion.getInPosition', { set: setTxt });
        else if (seg.kind === 'time') status = `${setTxt} · ${mmss(st.left)}`;
        else status = m.sides === 'alternate' ? t('motion.repOfEachSide', { set: setTxt, rep: st.rep, reps: seg.reps }) : t('motion.repOf', { set: setTxt, rep: st.rep, reps: seg.reps });
        progress = fr.k;
        const key = `${st.index}:${fr.index}:${Math.floor(st.local / (seg.cyc || 1e9))}`;
        if (key !== lastPhaseKey) {
          lastPhaseKey = key;
          if (sound && fr.phase.dur >= 0.4) beep(fr.phase.hold ? 660 : 880);
        }
      }
    }
    setText(phaseChip, label);
    const sl = sideLabel(m, pass);
    setText(sideChip, sl);
    sideChip.hidden = !sl;
    setText(count, status);
    // The last hint stays until a phase brings a new one – no flicker.
    if (fr && fr.phase.cue) lastCue = fr.phase.cue;
    setText(cue, lastCue);
    const b = fr && fr.phase.breath ? t(`motion.breath.${fr.phase.breath}`) : '';
    setText(breath, b);
    breath.hidden = !b;
    barFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  function countdownBeep(left) {
    const s = Math.ceil(left);
    if (!sound || s > 3 || s === lastBeepSec) return;
    lastBeepSec = s;
    beep(s === 1 ? 990 : 520, 160, 0.34);
  }

  function finish() {
    mode = 'done';
    keepAwake(false);
    if (sound) { beep(660, 160, 0.34); tone(990, { ms: 260, gain: 0.34, when: 0.18 }); }
    paintButton();
    if (onDone) onDone();
  }

  function onMain() {
    if (mode === 'preview' || mode === 'done') {
      plan = buildPlan(m, { reps: cfg.reps, holdS: cfg.holdS, sets: cfg.sets, rest: defaultsFor(m, category).rest });
      clock = 0; lastPhaseKey = ''; lastBeepSec = -1; lastCue = '';
      mode = 'train';
      showMotion(true);
      keepAwake(true);
      if (sound) { unlockAudio(); beep(880, 140, 0.3); }
    } else if (mode === 'train') {
      mode = 'paused'; keepAwake(false);
    } else if (mode === 'paused') {
      mode = 'train'; keepAwake(true);
    }
    paintButton();
    render();
    loop();
  }

  function reset() {
    mode = 'preview'; clock = 0; plan = null; lastCue = ''; keepAwake(false);
    showMotion(!reduced);
    paintButton();
    render();
    loop();
  }

  /** Moving image or still image (reduced motion, as long as nothing is running). */
  function showMotion(on) {
    svg.style.display = on ? '' : 'none';
    still.hidden = on;
  }

  function tick(dt) {
    if (mode === 'preview' && !(reduced && svg.style.display === 'none')) clock += dt * speed;
    else if (mode === 'train') clock += dt * speed;
    render();
  }

  function frame(now) {
    raf = 0;
    if (svg.isConnected !== true) { keepAwake(false); return; }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!document.hidden) tick(dt);
    const running = mode === 'train' || (mode === 'preview' && svg.style.display !== 'none');
    if (running) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function loop() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

  showMotion(!reduced);
  paintButton();
  render();
  if (!reduced) loop();

  return {
    tick,
    get mode() { return mode; },
    stop() { if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); raf = 0; keepAwake(false); },
    start: () => onMain(),
  };
}
