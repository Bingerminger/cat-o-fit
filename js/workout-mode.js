/* =========================================================================
   workout-mode.js — full-screen mode during training.
   - Large controls that can be reached with one hand.
   - Stopwatch for continuous runs; interval engine (warm-up, work/rest,
     cool-down) on real time with sound (+ vibration where the device can do it);
     target pace and HR zone visible for each phase.
   - Set counter + visible rest countdown for strength.
   - Keep the screen awake (Wake Lock, requested again after returning),
     save the interim state locally.
   The phase logic lives in workout-engine.js, pure and testable.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, fmtClock, fmtPaceRange, stepper, toast,
  openSheet, closeSheet, field, input, textarea, rpeScale, feelingPicker, durationFields,
} from './ui.js';
import { lsGet, lsSet, lsRemove } from './env.js';
import { findUnit, completeUnit, saveUnitPatch } from './unit-actions.js';
import { exercisesForUnit, openExercise, difficultyLabel } from './exercises.js';
import { exerciseArt } from './exercise-art.js';
import { buildPhases, advance, phaseRemaining, unitTarget } from './workout-engine.js';
import { cleanSet, fmtSet, lastSetsFor, progressionHint, toStrengthSets } from './strength.js';
import { tone, unlockAudio } from './audio.js';
import { programForUnit, buildShow } from './show-program.js';

import { t } from './i18n.js';

let current = null;

function teardown() { if (current) { current.cleanup(); current = null; } }
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/workout/')) teardown(); });

/* ------------------------------- Sound/haptics ----------------------------- */
/* Unlocking happens in the start button (user gesture) via audio.js – that is where the audio
   session is registered as playback, otherwise the sound stays muted on iPhone/iPad in silent mode. */
function beep(freq = 880, dur = 0.18, times = 1) {
  for (let i = 0; i < times; i++) tone(freq, { ms: dur * 1000, gain: 0.35, when: i * 0.22 });
  if (navigator.vibrate) navigator.vibrate(times > 1 ? [120, 80, 120] : 140);
}

/* ------------------------------- Wake Lock ------------------------------ */
let wakeLock = null;
async function requestWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

/** Target as short text (e.g. "Target 4:11–4:21 min/km · Zone 5"). */
function targetText(target) {
  if (!target) return '';
  const parts = [];
  if (target.pace) parts.push(fmtPaceRange(target.pace[0], target.pace[1]));
  if (target.hrZone) parts.push(t('workoutMode.zone', { zone: target.hrZone }));
  return parts.length ? t('workoutMode.target', { target: parts.join(' · ') }) : '';
}

/* ================================ Render ================================ */
export function render(view, id) {
  teardown();
  const found = findUnit(id);
  if (!found) { navigate(`#/session/${id}`); return; }
  const { plan, unit } = found;
  const type = unit.type;

  // Drink-break reminder: remind people regularly to drink during long sessions
  // (interval in seconds per training type; 0 = no reminder). Can be overridden per
  // session via `drinkIntervalMin` (can also be switched off with 0).
  const DRINK_INTERVALS = { long: 20 * 60, race: 25 * 60, cross_bike: 25 * 60, hike: 30 * 60, spinning: 25 * 60, rowing: 20 * 60, elliptical: 25 * 60 };
  const drinkInterval = unit.drinkIntervalMin != null ? Math.max(0, Math.round(unit.drinkIntervalMin) * 60) : (DRINK_INTERVALS[type] || 0);
  // Set counter and rest timer exist for strength and gym (machine) training.
  const isSetBased = type === 'strength' || type === 'gym';

  // Controller state
  const st = {
    elapsed: 0, running: false, lastTs: 0, tick: null, counters: {},
    phase: 0, phaseElapsed: 0, phases: buildPhases(unit), done: false,
    drinkInterval, drinkCount: 0,
    restEnd: 0, restTick: null,
  };
  restore(st, id);

  // ---- DOM construction ----
  const root = el('div', { class: 'workout' });
  const phaseLabel = el('div', { class: 'workout__phase' });
  const timeEl = el('div', { class: 'workout__time num' });
  const subEl = el('div', { class: 'workout__sub' });
  const targetEl = el('div', { class: 'workout__target' });
  const stepsEl = el('div', { class: 'workout__steps' });
  const middle = el('div', { class: 'workout__clock' }, [phaseLabel, timeEl, targetEl, subEl]);
  const controls = el('div', { class: 'workout__controls' });
  const hint = el('div', { class: 'workout__hint' });
  const hints = [];
  if (st.drinkInterval) hints.push(t('workoutMode.drinkReminder', { min: Math.round(st.drinkInterval / 60) }));
  if (st.phases || st.drinkInterval) {
    // Be honest about the browser's limits (especially on the iPhone).
    hints.push(t('workoutMode.hintNoLock'));
    if (!('vibrate' in navigator)) hints.push(t('workoutMode.hintNoVibrate'));
    if (!('wakeLock' in navigator)) hints.push(t('workoutMode.hintNoWakeLock'));
  }
  hints.forEach((line) => hint.appendChild(el('div', { text: line })));

  root.appendChild(el('div', { class: 'workout__top' }, [
    el('div', { class: 'workout__title', text: unit.title }),
    el('button', { class: 'icon-btn workout__close', 'aria-label': t('common.close'), onclick: () => askQuit() }, icon('x')),
  ]));
  // Drink-break banner (fades in briefly for reminders).
  const drinkBanner = el('button', {
    class: 'workout__drink', 'aria-label': t('workoutMode.drinkConfirm'),
    onclick: () => hideDrink(),
  }, [el('span', { class: 'workout__drink-emoji', text: '💧' }), el('span', { text: t('workoutMode.drinkBanner') })]);
  root.appendChild(drinkBanner);
  root.appendChild(middle);
  if (st.phases) root.appendChild(stepsEl);
  const counterWrap = el('div', { class: 'workout__counters' });
  if (isSetBased) root.appendChild(counterWrap);
  root.appendChild(controls);
  // Exercises for the session – also reachable DURING training (#1). For strength/
  // gym training/mobility, or any session with manually linked exercises.
  const exPanel = el('div', { class: 'workout__ex-panel' });
  root.appendChild(exPanel);
  // Strength: per linked exercise, sets with repetitions and weight (kept across a reload).
  st.counters.log = st.counters.log || {};
  renderWorkoutExercises(exPanel, plan, unit, isSetBased ? { log: st.counters.log, onChange: () => persist() } : null);
  root.appendChild(hint);
  view.appendChild(root);

  /* ---------------- Timer ---------------- */
  function startTimer() {
    if (st.running) return;
    unlockAudio();   // in the user gesture – otherwise the sound stays off on the iPhone
    st.running = true; st.lastTs = performance.now();
    st.tick = setInterval(onTick, 200);
    requestWake();
    renderControls(); persist();
  }
  function pauseTimer() {
    st.running = false; clearInterval(st.tick); st.tick = null;
    releaseWake(); renderControls(); persist();
  }
  function onTick() {
    if (!st.running) return;
    const now = performance.now();
    const dt = Math.max(0, now - st.lastTs);
    st.elapsed += dt; st.lastTs = now;
    if (st.phases && !st.done) advancePhases(dt / 1000);
    checkDrink();
    updateDisplay(); persist();
  }
  // After returning (screen unlocked, switched app) request the wake lock again
  // and bring the display to the real state immediately.
  const onVisible = () => { if (document.visibilityState === 'visible' && st.running) { requestWake(); onTick(); } };
  document.addEventListener('visibilitychange', onVisible);

  /* --------------- Drink-break reminder --------------- */
  let drinkTimer = null;
  function checkDrink() {
    if (!st.drinkInterval) return;
    const due = Math.floor((st.elapsed / 1000) / st.drinkInterval);
    if (due > st.drinkCount) { st.drinkCount = due; showDrink(); }
  }
  function showDrink() {
    beep(700, 0.16, 2);            // friendly double beep + vibration
    drinkBanner.classList.add('is-visible');
    clearTimeout(drinkTimer);
    drinkTimer = setTimeout(hideDrink, 8000);
  }
  function hideDrink() { drinkBanner.classList.remove('is-visible'); clearTimeout(drinkTimer); }

  /* --------------- Interval phases (on real time) --------------- */
  function advancePhases(dtSec) {
    const r = advance(st, st.phases, dtSec);
    st.phase = r.phase; st.phaseElapsed = r.phaseElapsed;
    let lastPhase = null;
    r.events.forEach((ev) => {
      if (ev.type === 'count') beep(660, 0.1);
      if (ev.type === 'phase') lastPhase = ev.index;
    });
    if (r.done) { beep(990, 0.4, 2); st.done = true; pauseTimer(); return; }
    // When catching up over several phases, signal only once – for the current one.
    if (lastPhase != null) {
      const p = st.phases[lastPhase];
      beep(p.kind === 'work' ? 990 : 520, 0.3, p.kind === 'work' ? 2 : 1);
      root.classList.toggle('workout--rest', p.kind !== 'work');
    }
  }

  /* --------------- Display --------------- */
  function updateDisplay() {
    if (st.restEnd) { showRestCountdown(); return; }
    if (st.phases) {
      const cur = st.phases[st.phase];
      if (st.done || !cur) {
        phaseLabel.textContent = t('workoutMode.done');
        timeEl.textContent = fmtClock(st.elapsed / 1000);
        timeEl.classList.remove('workout__time--rest');
        targetEl.textContent = '';
        subEl.textContent = t('workoutMode.doneSub');
      } else {
        phaseLabel.textContent = cur.label;
        timeEl.textContent = fmtClock(phaseRemaining(st, st.phases));
        timeEl.classList.toggle('workout__time--rest', cur.kind !== 'work');
        targetEl.textContent = cur.kind === 'work' ? targetText(cur.target) : (cur.hint || '');
        const next = st.phases[st.phase + 1];
        subEl.textContent = next
          ? t('workoutMode.totalThen', { time: fmtClock(st.elapsed / 1000), next: next.label })
          : t('workoutMode.total', { time: fmtClock(st.elapsed / 1000) });
      }
      // Step dots (work phases only)
      stepsEl.innerHTML = '';
      st.phases.forEach((p, i) => {
        if (p.kind !== 'work') return;
        const cls = i < st.phase ? 'is-done' : (i === st.phase ? 'is-current' : '');
        stepsEl.appendChild(el('span', { class: `workout__step ${cls}` }));
      });
    } else {
      phaseLabel.textContent = typeMeta(type).label;
      timeEl.textContent = fmtClock(st.elapsed / 1000);
      targetEl.textContent = targetText(unitTarget(unit));
      subEl.textContent = st.running ? t('workoutMode.running') : (st.elapsed > 0 ? t('workoutMode.paused') : t('workoutMode.ready'));
    }
  }

  /* --------------- Controls --------------- */
  function renderControls() {
    controls.innerHTML = '';
    const mainBtn = el('button', {
      class: 'btn workout__btn-main ' + (st.running ? 'btn--soft' : 'btn--primary'),
      onclick: () => (st.running ? pauseTimer() : startTimer()),
    }, [icon(st.running ? 'pause' : 'play'), st.running ? t('workoutMode.pause') : (st.elapsed > 0 ? t('workoutMode.resume') : t('workoutMode.start'))]);

    controls.appendChild(mainBtn);

    if (st.phases) {
      controls.appendChild(el('button', { class: 'btn btn--soft', onclick: () => skipPhase() }, [icon('skip'), t('workoutMode.skipPhase')]));
    }
    // "End workout" deliberately clearly tappable (filled), not a greyed-out ghost button (#2).
    // Without a phase button (e.g. strength) it spans the full width.
    controls.appendChild(el('button', {
      class: 'btn workout__btn-finish' + (st.phases ? '' : ' workout__btn-finish--wide'),
      onclick: () => finish(),
    }, [icon('check'), t('workoutMode.endTraining')]));
    updateCounters();
  }

  function skipPhase() {
    if (!st.phases) return;
    st.phase++; st.phaseElapsed = 0;
    if (st.phase >= st.phases.length) { st.done = true; pauseTimer(); }
    else root.classList.toggle('workout--rest', st.phases[st.phase].kind !== 'work');
    updateDisplay(); persist();
  }

  // Strength: set counter + rest timer
  function updateCounters() {
    if (!isSetBased) return;
    counterWrap.innerHTML = '';
    st.counters.sets = st.counters.sets || 0;
    counterWrap.appendChild(el('div', { class: 'workout__counter' }, [
      el('div', { class: 'workout__counter-label', text: t('workoutMode.roundsDone') }),
      stepper(st.counters.sets, { min: 0, max: 50, onChange: (v) => { st.counters.sets = v; persist(); } }),
    ]));
    counterWrap.appendChild(el('div', { class: 'workout__counter' }, [
      el('div', { class: 'workout__counter-label', text: t('workoutMode.setRest') }),
      el('div', { class: 'row gap-2' }, [
        el('button', { class: 'btn btn--soft', onclick: () => restTimer(60) }, '60s'),
        el('button', { class: 'btn btn--soft', onclick: () => restTimer(90) }, '90s'),
      ]),
    ]));
  }
  /** Rest between sets as a large countdown in the time field. One timer – tapping again restarts it. */
  function restTimer(sec) {
    unlockAudio();
    clearInterval(st.restTick);
    st.restEnd = performance.now() + sec * 1000;
    st.restTick = setInterval(() => {
      if (performance.now() >= st.restEnd) {
        clearInterval(st.restTick); st.restTick = null; st.restEnd = 0;
        beep(880, 0.3, 2);
        toast(t('workoutMode.restOver'), 'good');
      }
      updateDisplay();
    }, 250);
    updateDisplay();
  }
  function showRestCountdown() {
    const left = Math.max(0, Math.ceil((st.restEnd - performance.now()) / 1000));
    phaseLabel.textContent = t('workoutMode.setRest');
    timeEl.textContent = fmtClock(left);
    timeEl.classList.add('workout__time--rest');
    targetEl.textContent = t('workoutMode.restHint');
    subEl.textContent = t('workoutMode.total', { time: fmtClock(st.elapsed / 1000) });
  }

  /* --------------- Finish --------------- */
  function finish() {
    pauseTimer();
    const elapsedSec = Math.round(st.elapsed / 1000);
    openFinishSheet(plan, unit, { durationSec: elapsedSec, sets: st.counters.sets, strengthSets: toStrengthSets(st.counters.log) }, () => {
      lsRemove('workout');
      teardown();
    });
  }

  /** End dialog: logging the workout is the main route; discarding needs a second confirmation. */
  function askQuit() {
    if (st.elapsed < 3000 && !st.running) { lsRemove('workout'); teardown(); navigate(`#/session/${unit.id}`); return; }
    const confirmRow = el('div', { class: 'card card--flat mt-3', hidden: true, style: { borderLeft: '3px solid var(--bad)' } }, [
      el('div', { style: { fontWeight: '650', fontSize: '.88rem' }, text: t('workoutMode.discardSure') }),
      el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: t('workoutMode.discardInfo', { time: fmtClock(st.elapsed / 1000) }) }),
      el('div', { class: 'row gap-2 mt-2' }, [
        el('button', { class: 'btn btn--ghost grow', text: t('common.back'), onclick: () => { confirmRow.hidden = true; } }),
        el('button', { class: 'btn btn--danger grow', text: t('workoutMode.discardYes'), onclick: () => { closeSheet(); lsRemove('workout'); teardown(); navigate(`#/session/${unit.id}`); } }),
      ]),
    ]);
    openSheet({
      title: t('workoutMode.quitTitle'),
      body: el('div', {}, [
        el('p', { class: 'muted', text: t('workoutMode.quitQuestion') }),
        el('button', { class: 'btn mt-2', type: 'button', style: { background: 'transparent', color: 'var(--text-2)', padding: '4px 0', textDecoration: 'underline' }, text: t('workoutMode.leaveWithoutSaving'), onclick: () => { confirmRow.hidden = false; } }),
        confirmRow,
      ]),
      footer: [
        el('button', { class: 'btn btn--ghost grow', text: t('workoutMode.keepTraining'), onclick: () => closeSheet() }),
        el('button', { class: 'btn btn--primary grow', text: t('workoutMode.log'), onclick: () => { closeSheet(); finish(); } }),
      ],
    });
  }

  /* --------------- Persistence --------------- */
  function persist() {
    lsSet('workout', JSON.stringify({ id, elapsed: st.elapsed, phase: st.phase, phaseElapsed: st.phaseElapsed, counters: st.counters, done: st.done, drinkCount: st.drinkCount, ts: Date.now() }));
  }

  current = {
    cleanup() {
      if (st.tick) clearInterval(st.tick);
      if (st.restTick) clearInterval(st.restTick);
      document.removeEventListener('visibilitychange', onVisible);
      releaseWake();
      st.running = false;
    },
  };

  renderControls();
  updateDisplay();
}

function restore(st, id) {
  try {
    const raw = JSON.parse(lsGet('workout') || 'null');
    if (raw && raw.id === id && (Date.now() - raw.ts) < 6 * 3600 * 1000) {
      st.elapsed = raw.elapsed || 0; st.phase = raw.phase || 0;
      st.phaseElapsed = raw.phaseElapsed || 0; st.counters = raw.counters || {}; st.done = raw.done || false;
      st.drinkCount = raw.drinkCount || 0;
      toast(t('workoutMode.resumed'));
    }
  } catch { /* ignore */ }
}

/* --------------------- Exercises in workout mode (#1) -------------------- */
/**
 * Shows the exercises for the session in the full-screen workout too – until now they were
 * only visible on the pre-start screen. Linked exercises first, then suggestions
 * (sorted by usage). Tapping opens the instructions; "+/✓" attaches an exercise
 * to the session (counts when completing it). Collapsible, to keep the timer free –
 * open by default so that the exercises are visible straight away.
 */
function renderWorkoutExercises(host, plan, unit, setLog = null) {
  // What the description names comes first – so the planned session can be followed step by step.
  const { named, all: pool } = exercisesForUnit(unit, store.exerciseUsage());
  const namedIds = new Set(named.map((e) => e.id));
  const linked = Array.isArray(unit.exerciseIds) ? [...unit.exerciseIds] : [];
  // Show only where exercises make sense (strength/gym/mobility) or are manually linked.
  if (!pool.length && !linked.length) return;

  let open = true;
  const list = el('div', { class: 'workout__ex-list' });
  const chev = el('span', { class: 'workout__ex-chev', html: iconSvg('chevronDown') });
  const head = el('button', { class: 'workout__ex-head', onclick: () => { open = !open; list.hidden = !open; head.classList.toggle('is-open', open); } }, [
    el('span', { html: iconSvg('dumbbell'), style: { width: '18px', flex: '0 0 auto' } }),
    el('span', { class: 'grow', text: pool.length ? t('workoutMode.exercisesCount', { n: pool.length }) : t('workoutMode.exercises') }),
    chev,
  ]);
  head.classList.add('is-open');
  host.appendChild(head);
  host.appendChild(list);

  const paint = () => {
    list.innerHTML = '';
    // Do all exercises in one go – the workout's clock keeps running meanwhile.
    const prog = programForUnit({ ...unit, exerciseIds: linked });
    if (prog) {
      const min = Math.max(1, Math.round(buildShow(prog).total / 60));
      list.appendChild(el('button', { class: 'btn btn--primary btn--block show-cta', type: 'button', onclick: async () => {
        const { openShow } = await import('./workout-show.js');
        openShow(programForUnit({ ...unit, exerciseIds: linked }));
      } }, [icon('play'), t('workoutMode.followAlong', { min })]));
    }
    const usage = store.exerciseUsage();
    // Linked ones first, then the exercises from the plan, below them the suggestions by usage.
    const ordered = pool
      .slice()
      .sort((a, b) => (linked.includes(b.id) ? 1 : 0) - (linked.includes(a.id) ? 1 : 0));
    if (!ordered.length) { list.appendChild(el('div', { class: 'workout__ex-empty', text: t('workoutMode.noSuggestions') })); return; }
    ordered.forEach((e) => {
      const on = linked.includes(e.id);
      const row = el('div', { class: 'workout__ex' + (on ? ' is-on' : '') }, [
        el('button', { class: 'workout__ex-main', onclick: () => openExercise(e.id) }, [
          el('span', { class: 'workout__ex-art', html: exerciseArt(e.art) }),
          el('span', { class: 'grow' }, [
            el('span', { class: 'workout__ex-name', text: e.name }),
            el('span', { class: 'workout__ex-diff', text: (namedIds.has(e.id) ? `${t('workoutMode.inPlan')} · ` : '') + (usage[e.id] ? `${usage[e.id]}× · ` : '') + difficultyLabel(e.difficulty) }),
          ]),
        ]),
        el('button', {
          class: 'workout__ex-toggle' + (on ? ' is-on' : ''),
          'aria-label': on ? t('workoutMode.removeFromSession') : t('workoutMode.addToSession'),
          onclick: () => {
            const i = linked.indexOf(e.id);
            if (i >= 0) linked.splice(i, 1); else linked.push(e.id);
            saveUnitPatch(plan.id, unit.id, { exerciseIds: [...linked] });
            paint();
          },
        }, on ? '✓' : '+'),
      ]);
      list.appendChild(row);
      // Sets (repetitions × kg) only for repetition exercises – hold exercises (`hold`) count by time.
      if (on && setLog && !e.hold) list.appendChild(setLogger(e, unit, setLog));
    });
  };
  paint();
}

/**
 * Log the sets of an exercise: repetitions and (optionally) weight, below them the sets
 * already logged and – from earlier sessions – "last time" with a progression hint.
 */
function setLogger(ex, unit, setLog) {
  const box = el('div', { class: 'workout__sets' });
  const draw = () => {
    box.innerHTML = '';
    const sets = setLog.log[ex.id] || [];
    const last = lastSetsFor(store.get('sessions'), ex.id, unit.date);
    if (last) {
      box.appendChild(el('div', { class: 'workout__sets-last', text: t('workoutMode.lastTime', { sets: last.sets.map(fmtSet).join(' · ') }) }));
      const hint = progressionHint(last.sets);
      if (hint) box.appendChild(el('div', { class: 'workout__sets-hint', text: hint }));
    }
    if (sets.length) {
      box.appendChild(el('div', { class: 'workout__sets-done' }, sets.map((x, i) => el('span', { class: 'chip', text: `${i + 1}. ${fmtSet(x)}` }))));
    }
    const prev = sets[sets.length - 1] || (last && last.sets[last.sets.length - 1]) || null;
    const repsI = input({ type: 'number', min: '1', max: '100', inputmode: 'numeric', placeholder: t('workoutMode.repsPlaceholder'), 'aria-label': t('workoutMode.repsAria', { name: ex.name }), value: prev ? String(prev.reps) : '' });
    const kgI = input({ type: 'number', min: '0', max: '500', step: '0.25', inputmode: 'decimal', placeholder: 'kg', 'aria-label': t('workoutMode.weightAria', { name: ex.name }), value: prev && prev.kg != null ? String(prev.kg) : '' });
    box.appendChild(el('div', { class: 'workout__sets-add' }, [
      repsI, kgI,
      el('button', { class: 'btn btn--soft', type: 'button', onclick: () => {
        const clean = cleanSet({ reps: repsI.value, kg: kgI.value });
        if (!clean) { toast(t('workoutMode.enterReps'), 'bad'); return; }
        setLog.log[ex.id] = [...sets, clean];
        setLog.onChange();
        draw();
      } }, t('workoutMode.addSet')),
      sets.length ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('workoutMode.removeLastSet'), onclick: () => {
        setLog.log[ex.id] = sets.slice(0, -1);
        setLog.onChange();
        draw();
      } }, icon('x')) : null,
    ]));
  };
  draw();
  return box;
}

/* --------------------------- Finish sheet ---------------------------- */
function openFinishSheet(plan, unit, pre, onDone) {
  const isRun = ['easy', 'long', 'recovery', 'tempo', 'interval', 'race', 'cross_bike'].includes(unit.type);
  const distI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: unit.targetDistanceKm ?? '', placeholder: 'km' });
  const mins = Math.floor((pre.durationSec || 0) / 60), secs = (pre.durationSec || 0) % 60;
  const dur = durationFields({ min: mins || '', sec: secs || '' });
  const { minI, secI } = dur;
  const notesI = textarea({ placeholder: t('workoutMode.notePlaceholder') });

  let rpe = 0;
  const rpeEl = rpeScale(0, (v) => { rpe = v; });
  let feeling = '';
  const feelRow = feelingPicker('', (v) => { feeling = v; });

  openSheet({
    title: t('workoutMode.finishTitle'),
    body: el('div', {}, [
      isRun ? field(t('workoutMode.distanceKm'), distI) : null,
      field(t('workoutMode.duration'), dur.node),
      field(t('workoutMode.effortRpe'), rpeEl),
      field(t('workoutMode.feeling'), feelRow),
      field(t('workoutMode.notes'), notesI),
    ]),
    footer: [
      el('button', {
        class: 'btn btn--primary btn--block', text: t('workoutMode.saveFinish'),
        onclick: () => {
          const dist = parseFloat(distI.value) || null;
          const durationSec = (parseInt(minI.value || 0) * 60 + parseInt(secI.value || 0)) || pre.durationSec || null;
          completeUnit(plan, unit, {
            distanceKm: dist, durationSec,
            rpe: rpe || null, feeling: feeling || null, notes: notesI.value.trim(), source: 'workout',
            strengthSets: pre.strengthSets || null,
          });
          closeSheet();
          if (onDone) onDone();
          toast(t('workoutMode.wellDone'), 'good');
          navigate(`#/session/${unit.id}`);
        },
      }),
    ],
    onClose: () => { /* the sheet can be opened again via "End workout" */ },
  });
}
