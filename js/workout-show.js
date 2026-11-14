/* =========================================================================
   workout-show.js — follow along continuously: full-screen session like a video.

   Overview (exercises, rounds, rest, music, voice) → "Let's go" → the
   demonstrator figure does each exercise in time; in between a rest with a preview of
   the next exercise, side change, round break – all without tapping. Large
   enough for the iPad on the floor: name, counter, hint and "Up next".

   Clock: the picture always runs on the screen clock – it never stops, even
   if iOS interrupts the audio. The music (pre-computed loops, music.js)
   locks onto the downbeat of each section; a watchdog wakes the audio
   after interruptions and re-adjusts the beat if it has drifted.
   Announcements exist only in rests (on iOS the speech output interrupts the
   music); during an exercise tones lead: the last three repetitions or seconds,
   "10 seconds to go" as a double tone. Tones are placed on the audio clock
   shortly before their time – pausing and jumping leave nothing ringing on.
   ========================================================================= */

import { el, icon, segmented, toast, localizeUnits } from './ui.js';
import * as store from './storage.js';
import { categoryMeta, loadExerciseTexts } from './exercises.js';
import { exerciseArt } from './exercise-art.js';
import { mountFigure } from './motion-figure.js';
import { frameAt } from './motion-rig.js';
import { mountStage, LOOKS } from './stage-show.js';
import { loadTrainer } from './stage-model.js';
import { stageError } from './stage-gl.js';
import { buildShow, showStateAt, doseLabel, nextWorkAfter } from './show-program.js';
import { createMusic } from './music.js';
import { unlockAudio, releaseAudio, tone, speak, speaking, stopSpeaking, wakeAudio, canSpeak, keepAwake, audioContext } from './audio.js';
import { doseKeys, preloadClips, sayClips } from './voice.js';

import { t, tp } from './i18n.js';

const SVGNS = 'http://www.w3.org/2000/svg';
/** The 3D stage is for devices that can draw it and people who have not asked for less motion. */
const wantsStage = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How much faster than written the exercises run. */
const PACES = { calm: 1, brisk: 1.4, fast: 1.8 };
const mmss = (s) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** "12 min · 5 exercises · 3 rounds" – the rounds only when there is more than one. */
const summaryLine = (time, exercises, rounds) => (rounds > 1
  ? t('workoutShow.summaryRounds', { time, exercises: tp('workoutShow.exercises', exercises), rounds: tp('workoutShow.rounds', rounds) })
  : t('workoutShow.summary', { time, exercises: tp('workoutShow.exercises', exercises) }));

/** Quantity to read aloud: "12 repetitions per side", "40 seconds". */
export function spokenDose(it, program) {
  const label = doseLabel(it, program);
  return label
    .replace(/^(\d+)(×| s)/, (_, n, unit) => (unit === '×' ? tp('workoutShow.spokenReps', Number(n)) : tp('workoutShow.spokenSeconds', Number(n))))
    .replace(` ${t('showProgram.perSide')}`, ` ${t('workoutShow.spokenPerSide')}`);
}

/**
 * Announcements of a section – only at start, rest and side change: [{ at, keys, text }].
 * `keys` are the voice building blocks (voice.js), `text` the wording (fallback, tests).
 */
export function voiceLines(seg, show) {
  const p = show.program;
  const it = p.items[seg.i];
  const name = it.ex.name.replace(/\s*\(.*\)\s*$/, '');
  const ex = `ex-${it.id}`;
  const dose = doseKeys(doseLabel(it, p));
  if (seg.kind === 'ready') return [{ at: 0.6, keys: ['intro', ex, ...dose], text: t('workoutShow.sayReady', { name, dose: spokenDose(it, p) }) }];
  if (seg.kind === 'rest') {
    return [seg.dur >= 7
      ? { at: 0.7, keys: ['next', ex, ...dose], text: t('workoutShow.sayNext', { name, dose: spokenDose(it, p) }) }
      : { at: 0.5, keys: ['next-short', ex], text: t('workoutShow.sayNextShort', { name }) }];
  }
  if (seg.kind === 'roundRest') return [{ at: 0.7, keys: [`round-${Math.min(5, seg.round - 1)}`, ex], text: t('workoutShow.sayRound', { done: seg.round - 1, next: seg.round, name }) }];
  if (seg.kind === 'switch') return [{ at: 0.5, keys: ['switch'], text: t('workoutShow.saySwitch') }];
  return [];
}

/**
 * Signal tones of a section: [{ at, freq, ms, gain }].
 * Preview: three count-in tones before the start, start tone exactly at the start.
 * Exercise: the last three repetitions or seconds tick, for timed exercises from 20 s
 * a double tone at "10 seconds to go", at the end a low tone ("Rest").
 */
export function cueTones(seg) {
  const out = [];
  if (seg.kind !== 'work') {
    const beat = 60 / seg.bpm;
    const step = beat * Math.max(1, Math.ceil(0.62 / beat));
    [3, 2, 1].forEach((k) => out.push({ at: seg.dur - k * step, freq: k === 1 ? 784 : 659, ms: 150, gain: 0.34 }));
    out.push({ at: seg.dur, freq: 1047, ms: 380, gain: 0.36 });
    return out.filter((c) => c.at >= 0.3);
  }
  if (seg.timed) {
    if (seg.dur >= 20) out.push({ at: seg.dur - 10, freq: 740, ms: 110, gain: 0.3 }, { at: seg.dur - 9.8, freq: 740, ms: 110, gain: 0.3 });
    [3, 2, 1].forEach((k) => { if (seg.dur > k + 1) out.push({ at: seg.dur - k, freq: 880, ms: 110, gain: 0.28 }); });
  } else if (seg.reps >= 4) {
    [3, 2, 1].forEach((k) => out.push({ at: (seg.reps - k) * seg.cyc, freq: 880, ms: 90, gain: 0.24 }));
  }
  out.push({ at: seg.dur, freq: 523, ms: 340, gain: 0.32 });
  return out;
}

/**
 * Opens the session above everything. `onFinish({ durationSec, ids })` offers
 * "Log as done" at the end (for a plan session).
 */
export function openShow(program, { onFinish = null } = {}) {
  const prefs = store.settings() || {};
  let musicMode = prefs.showMusic || 'app';            // app · own · off
  let voiceOn = prefs.showVoice !== false && canSpeak();
  let rounds = program.rounds;
  let rest = program.rest;
  // Workouts start brisk, like a video to follow along; a plan session keeps the calm tempo its exercises are written in.
  let pace = PACES[prefs.showPace] ? prefs.showPace : (program.format === 'interval' ? 'brisk' : 'calm');

  const root = el('div', { class: 'show', role: 'dialog', 'aria-modal': 'true', 'aria-label': localizeUnits(program.title) });
  document.body.appendChild(root);
  document.documentElement.classList.add('show-open');

  let run = null;   // running session
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (run && (e.key === ' ' || e.key === 'k')) { e.preventDefault(); run.toggle(); }
    else if (run && e.key === 'ArrowRight') run.skip(1);
    else if (run && e.key === 'ArrowLeft') run.skip(-1);
  };
  const onHash = () => close();
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onHash);

  function close() {
    if (run) run.stop();
    run = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    document.documentElement.classList.remove('show-open');
    root.remove();
  }

  /* ------------------------------ Overview ------------------------------ */
  function overview() {
    root.innerHTML = '';
    // Fetch the trainer model while the overview is read, so the stage has it when the session starts.
    if (wantsStage()) loadTrainer().catch(() => { /* the stage reports it when it starts */ });
    const current = () => ({ ...program, rounds, rest, pace: PACES[pace] });
    const total = el('span', { class: 'show-ov__total' });
    const paint = () => {
      const s = buildShow(current());
      total.textContent = `≈ ${summaryLine(Math.max(1, Math.round(s.total / 60)), program.items.length, rounds)}`;
    };
    const stepper = (label, get, set, step, min, max, unit = '') => {
      const val = el('span', { class: 'show-ov__val' });
      const show = () => { val.textContent = `${get()}${unit}`; paint(); };
      const btn = (d, txt, aria) => el('button', { class: 'show-ov__step', type: 'button', 'aria-label': aria, onclick: () => { set(Math.min(max, Math.max(min, get() + d))); show(); } }, txt);
      show();
      return el('div', { class: 'show-ov__stepper' }, [el('span', { class: 'show-ov__label', text: label }), btn(-step, '−', t('motion.less', { label })), val, btn(step, '+', t('motion.more', { label }))]);
    };
    const list = el('ol', { class: 'show-ov__list' }, program.items.map((it) => el('li', { class: 'show-ov__item' }, [
      el('span', { class: 'show-ov__art', html: exerciseArt(it.id, { color: categoryMeta(it.ex.category).color }) }),
      el('span', { class: 'show-ov__name', text: it.ex.name }),
      el('span', { class: 'show-ov__dose', text: doseLabel(it, program) }),
    ])));
    const music = segmented([{ value: 'app', label: t('workoutShow.music') }, { value: 'own', label: t('workoutShow.ownMusic') }, { value: 'off', label: t('workoutShow.musicOff') }], musicMode,
      (v) => { musicMode = v; store.setSetting('showMusic', v); hint.textContent = musicHint(); }, { label: t('workoutShow.music') });
    const hint = el('p', { class: 'show-ov__hint', text: musicHint() });
    const tempo = el('div', { class: 'show-ov__stepper' }, [
      el('span', { class: 'show-ov__label', text: t('workoutShow.pace') }),
      segmented([{ value: 'calm', label: t('workoutShow.paceCalm') }, { value: 'brisk', label: t('workoutShow.paceBrisk') }, { value: 'fast', label: t('workoutShow.paceFast') }], pace,
        (v) => { pace = v; store.setSetting('showPace', v); paint(); }, { label: t('workoutShow.pace') }),
    ]);
    const voice = el('button', { class: `show-ov__toggle${voiceOn ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(voiceOn), disabled: !canSpeak(), onclick: () => {
      voiceOn = !voiceOn; store.setSetting('showVoice', voiceOn);
      voice.classList.toggle('is-on', voiceOn); voice.setAttribute('aria-pressed', String(voiceOn));
    } }, [icon('mic'), el('span', { text: t('workoutShow.voiceDuringRests') })]);
    const go = el('button', { class: 'show-ov__go', type: 'button', onclick: async () => {
      // In the user gesture: unlock sound and speech output (iPad/iPhone also on "silent").
      // No full screen: Safari puts its own close cross over the stage there.
      unlockAudio({ mix: musicMode === 'own' });
      await loadExerciseTexts();   // the steps are a lazily loaded catalog area
      if (root.isConnected === false || run) return;   // closed meanwhile, or tapped twice
      run = startRun(current());
    } }, [icon('play'), el('span', { text: t('workoutShow.letsGo') })]);
    root.appendChild(el('div', { class: 'show-ov' }, [
      el('div', { class: 'show-ov__head' }, [
        el('div', {}, [el('div', { class: 'show-ov__kicker', text: t('workoutShow.kicker') }), el('h2', { class: 'show-ov__title', text: localizeUnits(program.title) }), total]),
        el('button', { class: 'show__close', type: 'button', 'aria-label': t('common.close'), onclick: close }, [icon('x')]),
      ]),
      el('div', { class: 'show-ov__body' }, [
        list,
        el('div', { class: 'show-ov__side' }, [
          el('div', { class: 'show-ov__steppers' }, [
            stepper(t('workoutShow.roundsLabel'), () => rounds, (v) => { rounds = v; }, 1, 1, 6),
            stepper(t('motion.rest'), () => rest, (v) => { rest = v; }, 5, 5, 90, ' s'),
          ]),
          tempo, music, hint, voice, go,
        ]),
      ]),
    ]));
    paint();
  }

  function musicHint() {
    if (musicMode === 'app') return t('workoutShow.musicHintApp');
    if (musicMode === 'own') return t('workoutShow.musicHintOwn');
    return t('workoutShow.musicHintOff');
  }

  /* ------------------------------ Flow ------------------------------ */
  function startRun(prog) {
    const show = buildShow(prog);
    const n = prog.items.length;
    const ctx = audioContext();
    let music = musicMode === 'app' ? createMusic() : null;
    let T = 0;
    let playing = true;
    let finished = false;
    let raf = 0; let lastNow = null; let errLogged = false;
    let segIndex = -1;
    let fig = null; let figItem = -1; let fitted = false;
    let lastCue = '';
    let cued = -1;          // section whose music is already scheduled
    let phase = null;       // { index, audioAt }: downbeat of the section on the audio clock
    let watchAt = 0;        // next watchdog run (show time)
    let pending = [];       // { t (show time), audio?, fire() } – triggered shortly before t
    let idleTimer = 0;
    const stats = { loops: 0, resyncs: 0, said: 0 };   // for checks: loops, re-adjustments, announcements
    // Load all voice building blocks of the session right away – they are then ready in the rests.
    if (voiceOn) preloadClips(['done', ...show.segs.flatMap((s) => voiceLines(s, show).flatMap((l) => l.keys))]);

    root.innerHTML = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    svg.setAttribute('class', 'mf mf--coach');   // before the first measurement: stage dimensions instead of 300×150
    // The 3D stage (stage-show.js) fills the whole screen behind everything; without WebGL the drawn figure stays.
    const canvas = wantsStage() ? el('canvas', { class: 'show__gl', 'aria-hidden': 'true' }) : null;
    let gl3d = null;
    let lookName = LOOKS[prefs.showLook] ? prefs.showLook : 'natural';
    try { gl3d = canvas && typeof canvas.getContext === 'function' ? mountStage(canvas, show, { style: lookName }) : null; } catch { gl3d = null; }
    // Why the drawn figure is shown instead – said on the stage, so nobody wonders where the 3D stage went.
    const inBrowser = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
    const why = () => { const e = stageError(); return e ? `${t('workoutShow.stageOffDevice')} (${e.slice(0, 90)})` : t('workoutShow.stageOffDevice'); };
    const offNote = el('div', { class: 'show__stage-off', text: !inBrowser || gl3d ? '' : canvas ? why() : t('workoutShow.stageOffMotion') });
    offNote.hidden = !offNote.textContent;
    const kicker = el('div', { class: 'show__kicker' });
    const side = el('span', { class: 'show__side' });
    // The game of it (3D stage only, kept for this session only): points for every repetition and second, more of them
    // with every exercise done in a row without skipping; a word of praise when an exercise is done.
    const game = { score: 0, combo: 0, done: 0, rep: 0, sec: 0 };
    const cheers = [t('workoutShow.cheer1'), t('workoutShow.cheer2'), t('workoutShow.cheer3'), t('workoutShow.cheer4')];
    const scoreNum = el('span', { class: 'show__score-num', text: '0' });
    const comboEl = el('span', { class: 'show__combo' });
    const scoreEl = el('div', { class: 'show__score', 'aria-hidden': 'true' }, [scoreNum, comboEl]);
    const cheerEl = el('div', { class: 'show__cheer', 'aria-hidden': 'true' });
    const again = (node, cls) => { node.classList.remove(cls); if (node.offsetWidth >= 0) node.classList.add(cls); };
    const mult = () => 1 + Math.min(4, game.combo);
    function gain(n) {
      game.score += n * mult();
      scoreNum.textContent = String(game.score);
      again(scoreEl, 'is-pop');
    }
    function paintCombo() { comboEl.textContent = game.combo > 0 ? `${t('workoutShow.comboLabel')} ×${mult()}` : ''; }
    /** An exercise done to its end: bonus, the row grows, praise, confetti. */
    function award() {
      gain(50);
      game.combo += 1; game.done += 1;
      paintCombo();
      cheerEl.textContent = cheers[(game.done - 1) % cheers.length];
      again(cheerEl, 'is-on');
    }
    const stage = el('div', { class: 'show__stage' }, gl3d
      ? [el('div', { class: 'show__chips' }, [kicker, el('span', { class: 'show__chips-end' }, [side, scoreEl])]), cheerEl, offNote]
      : [svg, el('div', { class: 'show__chips' }, [kicker, side]), offNote]);
    const meta = el('div', { class: 'show__meta' });
    const name = el('h1', { class: 'show__name' });
    const dose = el('div', { class: 'show__dose' });
    const ringFill = document.createElementNS(SVGNS, 'circle');
    const ring = document.createElementNS(SVGNS, 'svg');
    ring.setAttribute('viewBox', '0 0 120 120'); ring.setAttribute('class', 'show__ring'); ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<circle cx="60" cy="60" r="52" class="show__ring-bg"/>';
    ringFill.setAttribute('cx', '60'); ringFill.setAttribute('cy', '60'); ringFill.setAttribute('r', '52'); ringFill.setAttribute('class', 'show__ring-fg');
    ring.appendChild(ringFill);
    const big = el('div', { class: 'show__big', 'aria-live': 'off' });
    const unit = el('div', { class: 'show__unit' });
    const counter = el('div', { class: 'show__counter' }, [ring, el('div', { class: 'show__count' }, [big, unit])]);
    const cue = el('div', { class: 'show__cue' });
    const breath = el('span', { class: 'show__breath' });
    const nextName = el('span', { class: 'show__next-name' });
    const nextArt = el('span', { class: 'show__next-art' });
    const next = el('div', { class: 'show__next' }, [nextArt, el('span', {}, [el('span', { class: 'show__next-label', text: t('workoutShow.upNext') }), nextName])]);
    const info = el('div', { class: 'show__info' }, [meta, name, dose, counter, el('div', { class: 'show__cue-row' }, [cue, breath]), next]);
    const chapters = el('div', { class: 'show__chapters' }, show.segs.map((s, k) => el('button', {
      class: `show__chapter show__chapter--${s.kind}`, type: 'button', style: { flexGrow: String(s.dur) }, 'aria-label': t('workoutShow.chapter', { n: k + 1 }),
      onclick: () => seek(s.t0 + 0.001),
    }, [el('span', { class: 'show__chapter-fill' })])));
    const left = el('span', { class: 'show__left' });
    const playBtn = el('button', { class: 'show__ctl show__ctl--main', type: 'button', onclick: () => toggle() });
    const musicBtn = el('button', { class: 'show__ctl', type: 'button', title: t('workoutShow.music'), onclick: () => toggleMusic() }, [icon('music')]);
    const voiceBtn = el('button', { class: 'show__ctl', type: 'button', title: t('workoutShow.voice'), disabled: !canSpeak(), onclick: () => toggleVoice() }, [icon('mic')]);
    // The look of the 3D stage: tap through natural → night arena → drawn.
    const lookLabel = () => ({ natural: t('workoutShow.lookNatural'), night: t('workoutShow.lookNight'), drawn: t('workoutShow.lookDrawn') }[lookName]);
    const lookBtn = el('button', { class: 'show__ctl', type: 'button', title: `${t('workoutShow.look')}: ${lookLabel()}`, 'aria-label': `${t('workoutShow.look')}: ${lookLabel()}`, onclick: () => {
      const names = Object.keys(LOOKS);
      lookName = names[(names.indexOf(lookName) + 1) % names.length];
      if (gl3d) gl3d.setLook(lookName);
      store.setSetting('showLook', lookName);
      lookBtn.title = `${t('workoutShow.look')}: ${lookLabel()}`; lookBtn.setAttribute('aria-label', lookBtn.title);
      toast(lookBtn.title);
    } }, [icon('sparkles')]);
    const controls = el('div', { class: 'show__controls' }, [
      el('button', { class: 'show__ctl', type: 'button', title: t('workoutShow.previous'), 'aria-label': t('workoutShow.previous'), onclick: () => skip(-1) }, [icon('back')]),
      playBtn,
      el('button', { class: 'show__ctl', type: 'button', title: t('common.next'), 'aria-label': t('common.next'), onclick: () => skip(1) }, [icon('skip')]),
      el('span', { class: 'show__spacer' }),
      left, gl3d ? lookBtn : null, musicBtn, voiceBtn,
      el('button', { class: 'show__ctl', type: 'button', title: t('workoutShow.end'), 'aria-label': t('workoutShow.end'), onclick: close }, [icon('x')]),
    ]);
    const paused = el('button', { class: 'show__paused', type: 'button', onclick: () => toggle() }, [icon('play'), el('span', { text: t('workoutShow.pausedResume') })]);
    const runEl = el('div', { class: gl3d ? 'show__run show__run--gl' : 'show__run' }, [gl3d ? canvas : null, stage, info, chapters, controls, paused]);
    /** The part of the screen the figure has to itself (the stage cell of the layout), in shares of the canvas. */
    const freeArea = () => {
      const c = canvas.getBoundingClientRect(); const s = stage.getBoundingClientRect();
      if (!c.width || !c.height || !s.width || !s.height) return { x: 0, y: 0, w: 1, h: 1 };
      return { x: (s.left - c.left) / c.width, y: (s.top - c.top) / c.height, w: s.width / c.width, h: s.height / c.height };
    };
    root.appendChild(runEl);
    root.addEventListener('pointerdown', wake);
    root.addEventListener('pointermove', wake);
    // Rotating or resizing the window: fit the view section to the stage again.
    const onResize = () => { figItem = -1; segIndex = -1; };
    window.addEventListener('resize', onResize);
    // App in the background (lock screen, app switch): pause instead of running on.
    const onVisible = () => { if (document.hidden && playing && !finished) toggle(); };
    document.addEventListener('visibilitychange', onVisible);

    function paintButtons() {
      playBtn.innerHTML = '';
      playBtn.appendChild(icon(playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', playing ? t('motion.pause') : t('motion.resume'));
      const on = musicMode === 'app';
      musicBtn.classList.toggle('is-on', on);
      musicBtn.setAttribute('aria-pressed', String(on));
      voiceBtn.classList.toggle('is-on', voiceOn);
      voiceBtn.setAttribute('aria-pressed', String(voiceOn));
      runEl.classList.toggle('is-paused', !playing);
    }
    function wake() {
      runEl.classList.remove('is-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (playing) runEl.classList.add('is-idle'); }, 3500);
    }

    /* ---- Clock and music ---- */
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const latency = () => (music ? music.latency : 0);
    /** Audio time of a show time – earlier by the output latency so that sound and picture match. */
    const audioAt = (when) => (ctx ? ctx.currentTime + (when - T) - latency() : null);
    const specOf = (s) => ({ style: s.style, bpm: s.bpm, intensity: s.intensity });

    /** Loop of section k – its downbeat lies at the start of the section. */
    function playSeg(k) {
      if (!music || !music.running || !ctx || !playing || k < 0) return;
      const s = show.segs[k];
      const phaseAt = audioAt(s.t0);
      music.play(specOf(s), { at: ctx.currentTime + 0.03, phaseAt });
      phase = { index: k, audioAt: phaseAt };
      stats.loops += 1;
    }

    /** Announcement from voice building blocks; the music gets quieter for its duration. If a
            building block is missing, the device's speech output speaks (fallback). */
    function announce(line, at) {
      sayClips(line.keys, { at }).then((r) => {
        if (r) { stats.said += 1; if (music) music.duckFor(r.at, r.dur); } else if (voiceOn && !finished) speak(line.text);
      });
    }

    /** The 3D stage failed while running: back to the drawn figure, and say so. */
    function dropStage(e) {
      console.warn('Stage:', e);
      try { gl3d.destroy(); } catch { /* already gone */ }
      gl3d = null;
      if (canvas.remove) canvas.remove();
      runEl.classList.remove('show__run--gl');
      stage.insertBefore(svg, stage.firstChild);
      scoreEl.hidden = true; cheerEl.hidden = true;
      offNote.textContent = `${t('workoutShow.stageOffDevice')} (${String((e && e.message) || e).slice(0, 90)})`;
      offNote.hidden = false;
      figItem = -1; segIndex = -1;
    }

    /* ---- Section begins ---- */
    function enter(st) {
      const seg = st.seg;
      const it = prog.items[seg.i];
      const color = categoryMeta(it.ex.category).color;
      if (gl3d) {
        if (figItem !== seg.i) { figItem = seg.i; if (stage.style.setProperty) stage.style.setProperty('--show-hi', color); }
      } else if (figItem !== seg.i) {
        // View section in the aspect ratio of the stage – the figure as large as possible.
        // If the stage has no size yet (just mounted), this follows with the next frame.
        const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { width: 0, height: 0 };
        fitted = r.width > 0 && r.height > 0;
        fig = mountFigure(svg, it.m, { color, side: seg.side, aspect: fitted ? r.width / r.height : null });
        figItem = seg.i;
        if (stage.style.setProperty) stage.style.setProperty('--show-hi', color);
      } else fig.setSide(seg.side);
      runEl.dataset.kind = seg.kind;
      kicker.textContent = {
        ready: t('workoutShow.getReady'), rest: t('workoutShow.restNext'), roundRest: t('workoutShow.roundDone', { round: seg.round - 1 }), switch: t('motion.switchSides'), work: t('workoutShow.now'),
      }[seg.kind];
      const sl = it.m.sides ? (seg.side === 'b' ? t('workoutShow.sideLeft') : t('workoutShow.sideRight')) : '';
      side.textContent = it.m.sides === 'each' ? sl : '';
      side.hidden = it.m.sides !== 'each';
      name.textContent = it.ex.name;
      dose.textContent = doseLabel(it, prog);
      meta.textContent = prog.rounds > 1
        ? t('workoutShow.exerciseOfRound', { i: seg.i + 1, n, round: seg.round, rounds: prog.rounds })
        : t('workoutShow.exerciseOf', { i: seg.i + 1, n });
      const nx = seg.kind === 'work' ? nextWorkAfter(show, st.index) : null;
      next.hidden = seg.kind !== 'work';
      if (nx) {
        const ni = prog.items[nx.i];
        nextName.textContent = ni.ex.name;
        nextArt.innerHTML = exerciseArt(ni.id, { color: categoryMeta(ni.ex.category).color });
      } else { nextName.textContent = t('workoutShow.done'); nextArt.innerHTML = ''; }
      lastCue = '';
      // Music: scheduled shortly before? Otherwise now (start, jumping, resuming).
      if (cued !== st.index) playSeg(st.index);
      cued = st.index;
      if (music) for (const k of [st.index + 1, st.index + 2]) if (show.segs[k]) music.prepare(specOf(show.segs[k]));
      // Announcements, tones, run-up of the music.
      pending = [];
      const t0 = seg.t0;
      if (voiceOn) for (const line of voiceLines(seg, show)) pending.push({ t: t0 + line.at, audio: true, fire: (at) => announce(line, at) });
      for (const c of cueTones(seg)) pending.push({ t: t0 + c.at, audio: true, fire: (at) => tone(c.freq, { ms: c.ms, gain: c.gain, at }) });
      if (music && seg.kind !== 'work' && seg.dur >= 4) pending.push({ t: t0 + seg.dur - 2, audio: true, fire: (at) => music && music.oneShot('riser', at) });
      pending = pending.filter((p) => p.t >= T - 0.05);
    }

    /* ---- Frame ---- */
    function render() {
      const st = showStateAt(show, T);
      if (st.done) { if (gl3d && segIndex === show.segs.length - 1 && playing) award(); finish(); return; }
      if (!gl3d && !fitted && svg.getBoundingClientRect && svg.getBoundingClientRect().width > 0) { figItem = -1; segIndex = -1; }
      if (st.index !== segIndex) {
        // Reached by the clock, not by a jump: the exercise before counts as done.
        if (gl3d && playing && segIndex >= 0 && st.index === segIndex + 1 && show.segs[segIndex].kind === 'work') award();
        segIndex = st.index; enter(st);
        game.rep = 0; game.sec = Math.floor(st.local);
      }
      const seg = st.seg;
      if (gl3d && playing && seg.kind === 'work') {
        if (seg.timed) { const s = Math.floor(st.local); if (s > game.sec) { game.sec = s; gain(2); } }
        else if (st.rep !== game.rep) { if (game.rep > 0 && st.rep === game.rep + 1) { gain(10); again(big, 'is-pop'); } game.rep = st.rep; }
      }
      const fr = gl3d ? frameAt(prog.items[seg.i].m, st.anim.t, st.anim.list) : fig.update(st.anim.t, st.anim.list);
      // The stage is a picture, the session is the clock: a failing stage must never stop counters, music or tones.
      if (gl3d) { try { gl3d.render(T, st, { area: freeArea() }); } catch (e) { dropStage(e); } }
      // Counter
      let bigTxt = ''; let unitTxt = '';
      if (seg.kind === 'work' && !seg.timed) { bigTxt = `${st.rep}`; unitTxt = t('workoutShow.ofReps', { reps: seg.reps }); }
      else { bigTxt = seg.kind === 'work' ? mmss(st.left) : `${Math.ceil(st.left)}`; unitTxt = seg.kind === 'rest' || seg.kind === 'roundRest' ? t('workoutShow.secondsOfRest') : t('workoutShow.seconds'); }
      if (big.textContent !== bigTxt) big.textContent = bigTxt;
      if (unit.textContent !== unitTxt) unit.textContent = unitTxt;
      ringFill.setAttribute('stroke-dasharray', `${(Math.min(1, st.local / seg.dur) * 326.7).toFixed(1)} 326.7`);
      // Hint and breathing from the current phase; in rest and preview the first step of the instructions.
      if (fr.phase.cue) lastCue = fr.phase.cue;
      const c = seg.kind === 'work' ? lastCue : ((prog.items[seg.i].ex.steps || [])[0] || lastCue || '');
      if (cue.textContent !== c) cue.textContent = c;
      const b = seg.kind === 'work' ? (fr.phase.breath === 'ein' ? t('motion.breath.ein') : fr.phase.breath === 'aus' ? t('motion.breath.aus') : '') : '';
      if (breath.textContent !== b) breath.textContent = b;
      breath.hidden = !b;
      // Progress
      const lt = t('workoutShow.timeLeft', { time: mmss(show.total - T) });
      if (left.textContent !== lt) left.textContent = lt;
      chapters.childNodes.forEach((ch, k) => {
        const s = show.segs[k];
        const f = k < st.index ? 1 : k > st.index ? 0 : st.local / s.dur;
        ch.firstChild.style.width = `${Math.round(f * 1000) / 10}%`;
      });
      if (!playing) return;
      // Schedule the music of the next section on the audio clock shortly before.
      const nx = show.segs[st.index + 1];
      if (music && music.running && ctx && nx && cued !== st.index + 1 && nx.t0 - T < 0.35) {
        const at = audioAt(nx.t0);
        music.play(specOf(nx), { at, phaseAt: at });
        phase = { index: st.index + 1, audioAt: at };
        stats.loops += 1;
        if (nx.kind === 'work') music.oneShot('crash', at);
        cued = st.index + 1;
      }
      // Due tones and announcements.
      for (const p of pending) {
        if (p.done || p.t - T > (p.audio ? 0.15 : 0.02)) continue;
        p.done = true;
        if (p.audio) { if (ctx) p.fire(audioAt(p.t)); } else p.fire();
      }
      // Watchdog: wake the audio after interruptions, duck the music under announcements, re-adjust the beat.
      if (T >= watchAt || watchAt - T > 1) {
        watchAt = T + 0.5;
        wakeAudio();
        if (music) music.duck(speaking());
        if (music && music.running && ctx && ctx.state === 'running' && phase && phase.index === st.index) {
          const expect = audioAt(seg.t0);
          if (Math.abs(expect - phase.audioAt) > 0.08) { stats.resyncs += 1; playSeg(st.index); }
        }
      }
    }

    function frame() {
      raf = 0;
      if (!root.isConnected || finished) return;
      const clock = now();
      let dt = lastNow == null ? 0 : clock - lastNow;
      lastNow = clock;
      if (dt < 0 || dt > 1) dt = 0;            // do not jump after an interruption
      if (playing && !document.hidden) T += dt;
      // An error in one frame must never stop the session.
      try { render(); } catch (e) { if (!errLogged) { errLogged = true; console.warn('Session:', e); } }
      if (!finished) raf = requestAnimationFrame(frame);
    }

    function seek(to) {
      T = Math.max(0, Math.min(show.total - 0.01, to));
      segIndex = -1; cued = -1; phase = null; pending = [];
      stopSpeaking();
      lastNow = null;
      render();
    }
    function skip(dir) {
      const st = showStateAt(show, T);
      if (st.done) return;
      // Skipping an exercise ends the row.
      if (dir > 0 && st.seg.kind === 'work') { game.combo = 0; paintCombo(); }
      if (dir > 0) seek(st.seg.t0 + st.seg.dur + 0.001);
      else seek(st.local > 3 || st.index === 0 ? st.seg.t0 + 0.001 : show.segs[st.index - 1].t0 + 0.001);
    }
    function toggle() {
      if (finished) return;
      playing = !playing;
      if (playing) {
        wakeAudio();
        if (musicMode === 'app') { if (!music) music = createMusic(); music.start(); }
        // Re-schedule music and tones of the current section.
        cued = -1; segIndex = -1; phase = null;
        keepAwake(true);
        wake();
      } else {
        if (music) music.stop(0.3);
        stopSpeaking();
        keepAwake(false);
      }
      lastNow = null;
      paintButtons();
    }
    function toggleMusic() {
      if (musicMode === 'app') { if (music) music.stop(0.3); musicMode = 'off'; }
      else {
        musicMode = 'app';
        unlockAudio();
        if (!music) music = createMusic();
        if (playing) { music.start(); playSeg(segIndex); cued = segIndex; }
      }
      store.setSetting('showMusic', musicMode);
      lastNow = null;
      paintButtons();
    }
    function toggleVoice() {
      voiceOn = !voiceOn;
      store.setSetting('showVoice', voiceOn);
      if (!voiceOn) stopSpeaking();
      paintButtons();
    }

    function finish() {
      if (finished) return;
      finished = true;
      if (music) music.stop(2.5);
      keepAwake(false);
      tone(784, { ms: 160, gain: 0.3 }); tone(1047, { ms: 420, gain: 0.32, when: 0.18 });
      if (voiceOn) announce({ keys: ['done'], text: t('workoutShow.sayDone') }, ctx ? ctx.currentTime + 0.5 : null);
      const ids = prog.items.map((it) => it.id);
      try { store.bumpExerciseUsage(ids); } catch { /* counter optional */ }
      const durationSec = Math.round(show.total);
      root.innerHTML = '';
      // The stage stays behind the result: the trainer celebrates.
      if (gl3d) { root.appendChild(canvas); raf = requestAnimationFrame(doneFrame); }
      root.appendChild(el('div', { class: gl3d ? 'show-done show-done--gl' : 'show-done' }, [
        el('div', { class: 'show-done__kicker', text: localizeUnits(prog.title) }),
        el('h2', { class: 'show-done__title', text: t('workoutShow.done') }),
        gl3d ? doneScore() : null,
        el('p', { class: 'show-done__stats', text: summaryLine(mmss(durationSec), n, prog.rounds) }),
        el('div', { class: 'show-done__actions' }, [
          onFinish ? el('button', { class: 'show-ov__go', type: 'button', onclick: () => { close(); onFinish({ durationSec, ids }); } }, [icon('check'), el('span', { text: t('workoutShow.logDone') })]) : null,
          el('button', { class: 'show-done__btn', type: 'button', onclick: () => { stopRun(); run = null; overview(); } }, [icon('refresh'), el('span', { text: t('motion.again') })]),
          el('button', { class: 'show-done__btn', type: 'button', onclick: close }, [icon('x'), el('span', { text: t('common.close') })]),
        ]),
      ]));
      toast(t('workoutShow.counted'), 'good');
    }

    /** Stars for the share of exercises done to their end, and the points. */
    function doneScore() {
      const works = show.segs.filter((s) => s.kind === 'work').length;
      const stars = game.done >= works ? 3 : game.done >= works * 0.6 ? 2 : 1;
      return el('div', { class: 'show-done__game' }, [
        el('div', { class: 'show-done__stars', 'aria-hidden': 'true' }, [1, 2, 3].map((k) => el('span', { class: k <= stars ? 'is-on' : '', text: '★' }))),
        el('p', { class: 'show-done__score', text: `${game.score} ${t('workoutShow.pointsLabel')}` }),
      ]);
    }

    function doneFrame() {
      raf = 0;
      if (!gl3d || !root.isConnected || !canvas.isConnected) return;
      try { gl3d.render(show.total, showStateAt(show, show.total), { area: { x: 0, y: 0.03, w: 1, h: 0.5 } }); } catch { /* the picture behind the result is decoration */ }
      raf = requestAnimationFrame(doneFrame);
    }

    function stopRun() {
      finished = true;
      if (gl3d) { gl3d.destroy(); gl3d = null; }
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(idleTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
      if (music) { music.dispose(); music = null; }
      releaseAudio();
      keepAwake(false);
    }

    // Start
    if (music) music.start();
    keepAwake(true);
    paintButtons();
    wake();
    render();
    raf = requestAnimationFrame(frame);

    return {
      stop: stopRun,
      toggle,
      skip,
      seek,
      /** Advance time without a screen clock (tests). */
      tick(dt) { if (playing && !finished) T += dt; if (!finished) render(); },
      get time() { return T; },
      get playing() { return playing; },
      get finished() { return finished; },
      get stats() { return { ...stats }; },
      show,
    };
  }

  overview();
  return {
    close,
    /** For tests: starts without a user gesture and returns the running session. */
    start() { run = startRun({ ...program, rounds, rest }); return run; },
    get run() { return run; },
    root,
  };
}
