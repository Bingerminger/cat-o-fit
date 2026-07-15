/* =========================================================================
   workout-mode.js — Vollbild-Modus während des Trainings.
   - Große, einhändig erreichbare Bedienelemente.
   - Stoppuhr für Dauerläufe; Intervall-Engine (Arbeit/Pause) mit Ton+Vibration;
     Satz-Zähler + Pausentimer für Kraft.
   - Bildschirm wach halten (Wake Lock), Zwischenstand lokal sichern.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, fmtClock, fmtKm, stepper, toast,
  openSheet, closeSheet, field, input, textarea, FEELINGS,
} from './ui.js';
import { lsGet, lsSet, lsRemove } from './env.js';
import { findUnit, completeUnit, saveUnitPatch } from './session.js';
import { suggestedExercisesFor, sortByUsage, openExercise, difficultyLabel } from './exercises.js';
import { exerciseArt } from './exercise-art.js';

let current = null;

function teardown() { if (current) { current.cleanup(); current = null; } }
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/workout/')) teardown(); });

/* ------------------------------- Ton/Haptik ----------------------------- */
let actx = null;
function beep(freq = 880, dur = 0.18, times = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.connect(g); g.connect(actx.destination); o.type = 'sine'; o.frequency.value = freq;
      const t = actx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    }
  } catch { /* Audio nicht verfügbar */ }
  if (navigator.vibrate) navigator.vibrate(times > 1 ? [120, 80, 120] : 140);
}

/* ------------------------------- Wake Lock ------------------------------ */
let wakeLock = null;
async function requestWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* egal */ } }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch { /* egal */ } wakeLock = null; }

/* ================================ Render ================================ */
export function render(view, id) {
  teardown();
  const found = findUnit(id);
  if (!found) { navigate(`#/session/${id}`); return; }
  const { plan, unit } = found;
  const type = unit.type;

  // Trinkpausen-Erinnerung: bei langen Einheiten regelmäßig ans Trinken erinnern
  // (Sekunden-Intervall je Trainingstyp; 0 = keine Erinnerung). Pro Einheit
  // über `drinkIntervalMin` überschreibbar (auch ausschaltbar mit 0).
  const DRINK_INTERVALS = { long: 20 * 60, race: 25 * 60, cross_bike: 25 * 60, hike: 30 * 60, spinning: 25 * 60, rowing: 20 * 60, elliptical: 25 * 60 };
  const drinkInterval = unit.drinkIntervalMin != null ? Math.max(0, Math.round(unit.drinkIntervalMin) * 60) : (DRINK_INTERVALS[type] || 0);
  // Satz-Zähler & Pausentimer gibt es bei Kraft und Gerätetraining (Gym).
  const isSetBased = type === 'strength' || type === 'gym';

  // Controller-State
  const st = {
    elapsed: 0, running: false, lastTs: 0, tick: null, counters: {},
    phase: 0, phaseElapsed: 0, phases: buildPhases(unit), done: false,
    drinkInterval, drinkCount: 0,
  };
  restore(st, id);

  // ---- DOM-Aufbau ----
  const root = el('div', { class: 'workout' });
  const phaseLabel = el('div', { class: 'workout__phase' });
  const timeEl = el('div', { class: 'workout__time num' });
  const subEl = el('div', { class: 'workout__sub' });
  const stepsEl = el('div', { class: 'workout__steps' });
  const middle = el('div', { class: 'workout__clock' }, [phaseLabel, timeEl, subEl]);
  const controls = el('div', { class: 'workout__controls' });
  const hint = el('div', { class: 'workout__hint' });
  if (st.drinkInterval) hint.textContent = `💧 Trink-Erinnerung alle ${Math.round(st.drinkInterval / 60)} min`;

  root.appendChild(el('div', { class: 'workout__top' }, [
    el('div', { class: 'workout__title', text: unit.title }),
    el('button', { class: 'icon-btn workout__close', 'aria-label': 'Schließen', onclick: () => askQuit() }, icon('x')),
  ]));
  // Trinkpausen-Banner (blendet sich bei Erinnerungen kurz ein).
  const drinkBanner = el('button', {
    class: 'workout__drink', 'aria-label': 'Trinkpause bestätigen',
    onclick: () => hideDrink(),
  }, [el('span', { class: 'workout__drink-emoji', text: '💧' }), el('span', { text: 'Trinkpause – kurz schluckweise trinken' })]);
  root.appendChild(drinkBanner);
  root.appendChild(middle);
  if (st.phases) root.appendChild(stepsEl);
  const counterWrap = el('div', { class: 'workout__counters' });
  if (isSetBased) root.appendChild(counterWrap);
  root.appendChild(controls);
  // Übungen zur Einheit – auch WÄHREND des Trainings erreichbar (#1). Für Kraft/
  // Gerätetraining/Mobility oder jede Einheit mit manuell verknüpften Übungen.
  const exPanel = el('div', { class: 'workout__ex-panel' });
  root.appendChild(exPanel);
  renderWorkoutExercises(exPanel, plan, unit);
  root.appendChild(hint);
  view.appendChild(root);

  /* ---------------- Timer ---------------- */
  function startTimer() {
    if (st.running) return;
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
    const now = performance.now();
    st.elapsed += now - st.lastTs; st.lastTs = now;
    if (st.phases) advancePhases();
    checkDrink();
    updateDisplay(); persist();
  }

  /* --------------- Trinkpausen-Erinnerung --------------- */
  let drinkTimer = null;
  function checkDrink() {
    if (!st.drinkInterval) return;
    const due = Math.floor((st.elapsed / 1000) / st.drinkInterval);
    if (due > st.drinkCount) { st.drinkCount = due; showDrink(); }
  }
  function showDrink() {
    beep(700, 0.16, 2);            // freundlicher Doppelton + Vibration
    drinkBanner.classList.add('is-visible');
    clearTimeout(drinkTimer);
    drinkTimer = setTimeout(hideDrink, 8000);
  }
  function hideDrink() { drinkBanner.classList.remove('is-visible'); clearTimeout(drinkTimer); }

  /* --------------- Intervall-Phasen --------------- */
  function advancePhases() {
    st.phaseElapsed += 0.2;
    const cur = st.phases[st.phase];
    if (!cur) return;
    const remain = cur.sec - st.phaseElapsed;
    if (remain <= 3 && remain > 3 - 0.2) beep(660, 0.1); // Countdown-Tick
    if (remain <= 2 && remain > 2 - 0.2) beep(660, 0.1);
    if (remain <= 1 && remain > 1 - 0.2) beep(660, 0.1);
    if (st.phaseElapsed >= cur.sec) {
      st.phase++; st.phaseElapsed = 0;
      if (st.phase >= st.phases.length) { beep(990, 0.4, 2); st.done = true; pauseTimer(); }
      else { beep(st.phases[st.phase].kind === 'work' ? 990 : 520, 0.3, st.phases[st.phase].kind === 'work' ? 2 : 1); root.classList.toggle('workout--rest', st.phases[st.phase].kind === 'rest'); }
    }
  }

  /* --------------- Anzeige --------------- */
  function updateDisplay() {
    if (st.phases) {
      const cur = st.phases[st.phase];
      if (st.done || !cur) {
        phaseLabel.textContent = 'Geschafft';
        timeEl.textContent = fmtClock(st.elapsed / 1000);
        timeEl.classList.remove('workout__time--rest');
        subEl.textContent = 'Auslaufen nicht vergessen';
      } else {
        const remain = Math.ceil(cur.sec - st.phaseElapsed);
        phaseLabel.textContent = cur.label;
        timeEl.textContent = fmtClock(remain);
        timeEl.classList.toggle('workout__time--rest', cur.kind === 'rest');
        subEl.textContent = `Gesamt ${fmtClock(st.elapsed / 1000)}`;
      }
      // Schritt-Punkte
      stepsEl.innerHTML = '';
      st.phases.forEach((p, i) => {
        if (p.kind !== 'work') return;
        const cls = i < st.phase ? 'is-done' : (i === st.phase ? 'is-current' : '');
        stepsEl.appendChild(el('span', { class: `workout__step ${cls}` }));
      });
    } else {
      phaseLabel.textContent = typeMeta(type).label;
      timeEl.textContent = fmtClock(st.elapsed / 1000);
      subEl.textContent = st.running ? 'läuft …' : (st.elapsed > 0 ? 'pausiert' : 'bereit');
    }
  }

  /* --------------- Steuerung --------------- */
  function renderControls() {
    controls.innerHTML = '';
    const mainBtn = el('button', {
      class: 'btn workout__btn-main ' + (st.running ? 'btn--soft' : 'btn--primary'),
      onclick: () => (st.running ? pauseTimer() : startTimer()),
    }, [icon(st.running ? 'pause' : 'play'), st.running ? 'Pause' : (st.elapsed > 0 ? 'Weiter' : 'Start')]);

    controls.appendChild(mainBtn);

    if (st.phases) {
      controls.appendChild(el('button', { class: 'btn btn--soft', onclick: () => skipPhase() }, [icon('skip'), 'Phase überspringen']));
    }
    // „Beenden" bewusst klar tippbar (gefüllt), nicht als ausgegrauter Ghost-Button (#2).
    // Ohne Phasen-Button (z. B. Kraft) spannt es über die ganze Breite.
    controls.appendChild(el('button', {
      class: 'btn workout__btn-finish' + (st.phases ? '' : ' workout__btn-finish--wide'),
      onclick: () => finish(),
    }, [icon('check'), 'Training beenden']));
    updateCounters();
  }

  function skipPhase() {
    if (!st.phases) return;
    st.phase++; st.phaseElapsed = 0;
    if (st.phase >= st.phases.length) { st.done = true; pauseTimer(); }
    else root.classList.toggle('workout--rest', st.phases[st.phase].kind === 'rest');
    updateDisplay(); persist();
  }

  // Kraft: Satz-Zähler + Pausentimer
  function updateCounters() {
    if (!isSetBased) return;
    counterWrap.innerHTML = '';
    st.counters.sets = st.counters.sets || 0;
    counterWrap.appendChild(el('div', { class: 'workout__counter' }, [
      el('div', { class: 'workout__counter-label', text: 'Absolvierte Runden / Übungen' }),
      stepper(st.counters.sets, { min: 0, max: 50, onChange: (v) => { st.counters.sets = v; persist(); } }),
    ]));
    counterWrap.appendChild(el('div', { class: 'workout__counter' }, [
      el('div', { class: 'workout__counter-label', text: 'Satzpause' }),
      el('div', { class: 'row gap-2' }, [
        el('button', { class: 'btn btn--soft', onclick: () => restTimer(60) }, '60s'),
        el('button', { class: 'btn btn--soft', onclick: () => restTimer(90) }, '90s'),
      ]),
    ]));
  }
  function restTimer(sec) {
    toast(`${sec}s Pause läuft`);
    let left = sec;
    const h = setInterval(() => { left--; if (left <= 0) { clearInterval(h); beep(880, 0.3, 2); toast('Pause vorbei – nächster Satz', 'good'); } }, 1000);
  }

  /* --------------- Abschluss --------------- */
  function finish() {
    pauseTimer();
    const elapsedSec = Math.round(st.elapsed / 1000);
    openFinishSheet(plan, unit, { durationSec: elapsedSec, sets: st.counters.sets }, () => {
      lsRemove('workout');
      teardown();
    });
  }

  function askQuit() {
    if (st.elapsed < 3000 && !st.running) { lsRemove('workout'); teardown(); navigate(`#/session/${unit.id}`); return; }
    openSheet({
      title: 'Workout beenden?',
      body: el('p', { class: 'muted', text: 'Möchtest du das Training abschließen und erfassen oder ohne Speichern verlassen?' }),
      footer: [
        el('button', { class: 'btn btn--ghost grow', text: 'Verwerfen', onclick: () => { closeSheet(); lsRemove('workout'); teardown(); navigate(`#/session/${unit.id}`); } }),
        el('button', { class: 'btn btn--primary grow', text: 'Erfassen', onclick: () => { closeSheet(); finish(); } }),
      ],
    });
  }

  /* --------------- Persistenz --------------- */
  function persist() {
    lsSet('workout', JSON.stringify({ id, elapsed: st.elapsed, phase: st.phase, phaseElapsed: st.phaseElapsed, counters: st.counters, done: st.done, drinkCount: st.drinkCount, ts: Date.now() }));
  }

  current = {
    cleanup() {
      if (st.tick) clearInterval(st.tick);
      releaseWake();
      st.running = false;
    },
  };

  renderControls();
  updateDisplay();
}

/* ------------------------- Phasen aus Einheit ableiten ------------------ */
function buildPhases(unit) {
  if (!['interval', 'tempo'].includes(unit.type)) return null;
  // Variable Segmente (Pyramide/Wechsel) haben Vorrang vor uniformen Runden.
  const segs = unit.intervals && Array.isArray(unit.intervals.segments) ? unit.intervals.segments : null;
  if (segs && segs.length) {
    const phases = [];
    segs.forEach((s, i) => {
      phases.push({ kind: 'work', sec: s.workSec, label: `Belastung ${s.label || `${i + 1}/${segs.length}`}` });
      if (s.restSec && i < segs.length - 1) phases.push({ kind: 'rest', sec: s.restSec, label: s.floatRest ? 'Locker weiter' : `Trabpause ${i + 1}` });
    });
    return phases;
  }
  let rounds = 6, work = 180, rest = 90;
  if (unit.type === 'tempo') { rounds = 3; work = 360; rest = 120; }
  if (unit.intervals && unit.intervals.rounds) {
    // Vom Nutzer gepflegte Struktur hat Vorrang.
    rounds = unit.intervals.rounds;
    work = unit.intervals.workSec || work;
    rest = unit.intervals.restSec || rest;
  } else {
    // Heuristik: aus dem Titel grob ableiten (z. B. „6×800 m").
    const m = /(\d+)\s*[×x]\s*(\d+)/.exec(unit.title || '');
    if (m) { rounds = parseInt(m[1]); if (unit.type === 'tempo') work = parseInt(m[2]) * 60; }
  }
  const phases = [];
  for (let i = 0; i < rounds; i++) {
    phases.push({ kind: 'work', sec: work, label: `Belastung ${i + 1}/${rounds}` });
    if (i < rounds - 1) phases.push({ kind: 'rest', sec: rest, label: `Trabpause ${i + 1}` });
  }
  return phases;
}

function restore(st, id) {
  try {
    const raw = JSON.parse(lsGet('workout') || 'null');
    if (raw && raw.id === id && (Date.now() - raw.ts) < 6 * 3600 * 1000) {
      st.elapsed = raw.elapsed || 0; st.phase = raw.phase || 0;
      st.phaseElapsed = raw.phaseElapsed || 0; st.counters = raw.counters || {}; st.done = raw.done || false;
      st.drinkCount = raw.drinkCount || 0;
      toast('Workout fortgesetzt');
    }
  } catch { /* ignore */ }
}

/* --------------------- Übungen im Workout-Modus (#1) -------------------- */
/**
 * Zeigt die Übungen zur Einheit auch im Vollbild-Workout – bislang waren sie nur
 * auf dem Vor-Start-Screen sichtbar. Verknüpfte Übungen zuerst, dann Vorschläge
 * (nach Nutzung sortiert). Antippen öffnet die Anleitung; „+/✓" hängt eine Übung
 * an die Einheit (zählt beim Erledigen mit). Ein-/ausklappbar, um den Timer frei
 * zu halten – standardmäßig offen, damit die Übungen sofort sichtbar sind.
 */
function renderWorkoutExercises(host, plan, unit) {
  const pool = suggestedExercisesFor(unit.type);
  const linked = Array.isArray(unit.exerciseIds) ? [...unit.exerciseIds] : [];
  // Nur zeigen, wo Übungen sinnvoll sind (Kraft/Gym/Mobility) oder manuell verknüpft.
  if (!pool.length && !linked.length) return;

  let open = true;
  const list = el('div', { class: 'workout__ex-list' });
  const chev = el('span', { class: 'workout__ex-chev', html: iconSvg('chevronDown') });
  const head = el('button', { class: 'workout__ex-head', onclick: () => { open = !open; list.hidden = !open; head.classList.toggle('is-open', open); } }, [
    el('span', { html: iconSvg('dumbbell'), style: { width: '18px', flex: '0 0 auto' } }),
    el('span', { class: 'grow', text: `Übungen für diese Einheit${pool.length ? ` (${pool.length})` : ''}` }),
    chev,
  ]);
  head.classList.add('is-open');
  host.appendChild(head);
  host.appendChild(list);

  const paint = () => {
    list.innerHTML = '';
    const usage = store.exerciseUsage();
    // Verknüpfte zuerst, darunter die restlichen Vorschläge nach Nutzung.
    const ordered = sortByUsage(pool, usage)
      .slice()
      .sort((a, b) => (linked.includes(b.id) ? 1 : 0) - (linked.includes(a.id) ? 1 : 0));
    if (!ordered.length) { list.appendChild(el('div', { class: 'workout__ex-empty', text: 'Keine Vorschläge – über „+" auf dem Übungs-Screen hinzufügen.' })); return; }
    ordered.forEach((e) => {
      const on = linked.includes(e.id);
      list.appendChild(el('div', { class: 'workout__ex' + (on ? ' is-on' : '') }, [
        el('button', { class: 'workout__ex-main', onclick: () => openExercise(e.id) }, [
          el('span', { class: 'workout__ex-art', html: exerciseArt(e.art) }),
          el('span', { class: 'grow' }, [
            el('span', { class: 'workout__ex-name', text: e.name }),
            el('span', { class: 'workout__ex-diff', text: (usage[e.id] ? `${usage[e.id]}× · ` : '') + difficultyLabel(e.difficulty) }),
          ]),
        ]),
        el('button', {
          class: 'workout__ex-toggle' + (on ? ' is-on' : ''),
          'aria-label': on ? 'Von der Einheit entfernen' : 'Zur Einheit hinzufügen',
          onclick: () => {
            const i = linked.indexOf(e.id);
            if (i >= 0) linked.splice(i, 1); else linked.push(e.id);
            saveUnitPatch(plan.id, unit.id, { exerciseIds: [...linked] });
            paint();
          },
        }, on ? '✓' : '+'),
      ]));
    });
  };
  paint();
}

/* --------------------------- Abschluss-Sheet ---------------------------- */
function openFinishSheet(plan, unit, pre, onDone) {
  const isRun = ['easy', 'long', 'recovery', 'tempo', 'interval', 'race', 'cross_bike'].includes(unit.type);
  const distI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: unit.targetDistanceKm ?? '', placeholder: 'km' });
  const mins = Math.floor((pre.durationSec || 0) / 60), secs = (pre.durationSec || 0) % 60;
  const minI = input({ type: 'number', inputmode: 'numeric', value: mins || '', style: 'text-align:center' });
  const secI = input({ type: 'number', inputmode: 'numeric', value: secs || '', style: 'text-align:center' });
  const notesI = textarea({ placeholder: 'Notiz …' });

  let rpe = 0;
  const rpeScale = el('div', { class: 'rpe-scale' });
  for (let i = 1; i <= 10; i++) { const d = el('button', { class: 'rpe-dot', text: String(i), onclick: () => { rpe = i; rpeScale.querySelectorAll('.rpe-dot').forEach((x, j) => x.classList.toggle('is-active', j + 1 === i)); } }); rpeScale.appendChild(d); }
  let feeling = '';
  const feelRow = el('div', { class: 'feeling-row' });
  FEELINGS.forEach((f) => { const o = el('button', { class: 'feeling-opt', onclick: () => { feeling = f.key; feelRow.querySelectorAll('.feeling-opt').forEach((x) => x.classList.remove('is-active')); o.classList.add('is-active'); } }, [document.createTextNode(f.emoji), el('small', { text: f.label })]); feelRow.appendChild(o); });

  openSheet({
    title: 'Training abschließen',
    body: el('div', {}, [
      isRun ? field('Distanz (km)', distI) : null,
      field('Dauer', el('div', { class: 'row gap-2' }, [minI, el('span', { class: 'dim', text: ':' }), secI])),
      field('Anstrengung (RPE)', rpeScale),
      field('Gefühl', feelRow),
      field('Notizen', notesI),
    ]),
    footer: [
      el('button', {
        class: 'btn btn--primary btn--block', text: 'Speichern & abschließen',
        onclick: () => {
          const dist = parseFloat(distI.value) || null;
          const durationSec = (parseInt(minI.value || 0) * 60 + parseInt(secI.value || 0)) || pre.durationSec || null;
          completeUnit(plan, unit, {
            distanceKm: dist, durationSec,
            rpe: rpe || null, feeling: feeling || null, notes: notesI.value.trim(), source: 'workout',
          });
          closeSheet();
          if (onDone) onDone();
          toast('Stark gemacht! 💪', 'good');
          navigate(`#/session/${unit.id}`);
        },
      }),
    ],
    onClose: () => { /* Sheet kann erneut über Beenden geöffnet werden */ },
  });
}
