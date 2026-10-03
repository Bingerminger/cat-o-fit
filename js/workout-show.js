/* =========================================================================
   workout-show.js — durchgehend mitmachen: Vollbild-Session wie ein Video.

   Übersicht (Übungen, Runden, Pause, Musik, Stimme) → „Los geht's“ → die
   Vorturnerin macht jede Übung im Takt vor; dazwischen Pause mit Vorschau auf
   die nächste Übung, Seitenwechsel, Rundenpause – alles ohne Antippen. Groß
   genug für das iPad am Boden: Name, Zähler, Hinweis und „Danach“.

   Uhr: Das Bild läuft immer an der Bildschirm-Uhr – es bleibt nie stehen, auch
   wenn iOS den Ton unterbricht. Die Musik (vorab gerechnete Schleifen, music.js)
   rastet zu jedem Abschnitt auf dessen Taktanfang ein; ein Wächter weckt den Ton
   nach Unterbrechungen und zieht den Takt nach, wenn er sich verschoben hat.
   Ansagen gibt es nur in Pausen (auf iOS unterbricht die Sprachausgabe die
   Musik); in der Übung führen Töne: letzte drei Wiederholungen bzw. Sekunden,
   „noch 10 Sekunden“ als Doppelton. Töne werden kurz vor ihrem Zeitpunkt auf die
   Audio-Uhr gelegt – Pausieren und Springen lassen nichts nachklingen.
   ========================================================================= */

import { el, icon, segmented, toast } from './ui.js';
import * as store from './storage.js';
import { categoryMeta } from './exercises.js';
import { exerciseArt } from './exercise-art.js';
import { mountFigure } from './motion-figure.js';
import { buildShow, showStateAt, doseLabel, nextWorkAfter } from './show-program.js';
import { createMusic } from './music.js';
import { unlockAudio, releaseAudio, tone, speak, speaking, stopSpeaking, wakeAudio, canSpeak, keepAwake, audioContext } from './audio.js';
import { doseKeys, preloadClips, sayClips } from './voice.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const mmss = (s) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** Menge zum Vorlesen: „12 Wiederholungen pro Seite“, „40 Sekunden“. */
export function spokenDose(it, program) {
  const label = doseLabel(it, program);
  return label
    .replace(/^(\d+)×/, (_, n) => `${n} Wiederholungen`)
    .replace(/^(\d+) s/, (_, n) => `${n} Sekunden`)
    .replace(' je Seite', ' pro Seite');
}

/**
 * Ansagen eines Abschnitts – nur in Start, Pause und Seitenwechsel: [{ at, keys, text }].
 * `keys` sind die Sprachbausteine (voice.js), `text` der Wortlaut (Rückfall, Tests).
 */
export function voiceLines(seg, show) {
  const p = show.program;
  const it = p.items[seg.i];
  const name = it.ex.name.replace(/\s*\(.*\)\s*$/, '');
  const ex = `ex-${it.id}`;
  const dose = doseKeys(doseLabel(it, p));
  if (seg.kind === 'ready') return [{ at: 0.6, keys: ['intro', ex, ...dose], text: `Los geht's! Zuerst: ${name}, ${spokenDose(it, p)}.` }];
  if (seg.kind === 'rest') {
    return [seg.dur >= 7
      ? { at: 0.7, keys: ['next', ex, ...dose], text: `Pause. Als Nächstes: ${name}, ${spokenDose(it, p)}.` }
      : { at: 0.5, keys: ['next-short', ex], text: `Als Nächstes: ${name}.` }];
  }
  if (seg.kind === 'roundRest') return [{ at: 0.7, keys: [`round-${Math.min(5, seg.round - 1)}`, ex], text: `Runde ${seg.round - 1} geschafft. Durchatmen. Gleich Runde ${seg.round}: ${name}.` }];
  if (seg.kind === 'switch') return [{ at: 0.5, keys: ['switch'], text: 'Seitenwechsel.' }];
  return [];
}

/**
 * Signaltöne eines Abschnitts: [{ at, freq, ms, gain }].
 * Vorschau: drei Zähltöne vor dem Einsatz, Startton genau zum Einsatz.
 * Übung: die letzten drei Wiederholungen bzw. Sekunden ticken, bei Zeitübungen ab 20 s
 * ein Doppelton bei „noch 10 Sekunden“, am Ende ein tiefer Ton („Pause“).
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
 * Öffnet die Session über allem. `onFinish({ durationSec, ids })` bietet am Ende
 * „Als erledigt erfassen“ an (bei einer Plan-Einheit).
 */
export function openShow(program, { onFinish = null } = {}) {
  const prefs = store.settings() || {};
  let musicMode = prefs.showMusic || 'app';            // app · own · off
  let voiceOn = prefs.showVoice !== false && canSpeak();
  let rounds = program.rounds;
  let rest = program.rest;

  const root = el('div', { class: 'show', role: 'dialog', 'aria-modal': 'true', 'aria-label': program.title });
  document.body.appendChild(root);
  document.documentElement.classList.add('show-open');

  let run = null;   // laufende Session
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

  /* ------------------------------ Übersicht ------------------------------ */
  function overview() {
    root.innerHTML = '';
    const current = () => ({ ...program, rounds, rest });
    const total = el('span', { class: 'show-ov__total' });
    const paint = () => {
      const s = buildShow(current());
      total.textContent = `≈ ${Math.max(1, Math.round(s.total / 60))} min · ${program.items.length} Übungen${rounds > 1 ? ` · ${rounds} Runden` : ''}`;
    };
    const stepper = (label, get, set, step, min, max, unit = '') => {
      const val = el('span', { class: 'show-ov__val' });
      const show = () => { val.textContent = `${get()}${unit}`; paint(); };
      const btn = (d, txt, aria) => el('button', { class: 'show-ov__step', type: 'button', 'aria-label': aria, onclick: () => { set(Math.min(max, Math.max(min, get() + d))); show(); } }, txt);
      show();
      return el('div', { class: 'show-ov__stepper' }, [el('span', { class: 'show-ov__label', text: label }), btn(-step, '−', `${label} weniger`), val, btn(step, '+', `${label} mehr`)]);
    };
    const list = el('ol', { class: 'show-ov__list' }, program.items.map((it) => el('li', { class: 'show-ov__item' }, [
      el('span', { class: 'show-ov__art', html: exerciseArt(it.id, { color: categoryMeta(it.ex.category).color }) }),
      el('span', { class: 'show-ov__name', text: it.ex.name }),
      el('span', { class: 'show-ov__dose', text: doseLabel(it, program) }),
    ])));
    const music = segmented([{ value: 'app', label: 'Musik' }, { value: 'own', label: 'Eigene Musik' }, { value: 'off', label: 'Aus' }], musicMode,
      (v) => { musicMode = v; store.setSetting('showMusic', v); hint.textContent = musicHint(); }, { label: 'Musik' });
    const hint = el('p', { class: 'show-ov__hint', text: musicHint() });
    const voice = el('button', { class: `show-ov__toggle${voiceOn ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(voiceOn), disabled: !canSpeak(), onclick: () => {
      voiceOn = !voiceOn; store.setSetting('showVoice', voiceOn);
      voice.classList.toggle('is-on', voiceOn); voice.setAttribute('aria-pressed', String(voiceOn));
    } }, [icon('mic'), el('span', { text: 'Ansagen in den Pausen' })]);
    const go = el('button', { class: 'show-ov__go', type: 'button', onclick: () => {
      // In der Nutzergeste: Ton und Sprachausgabe freischalten (iPad/iPhone auch auf „lautlos“).
      // Kein Vollbild: Safari legt dort ein eigenes Schließen-Kreuz über die Bühne.
      unlockAudio({ mix: musicMode === 'own' });
      run = startRun(current());
    } }, [icon('play'), el('span', { text: 'Los geht’s' })]);
    root.appendChild(el('div', { class: 'show-ov' }, [
      el('div', { class: 'show-ov__head' }, [
        el('div', {}, [el('div', { class: 'show-ov__kicker', text: 'Durchgehend mitmachen' }), el('h2', { class: 'show-ov__title', text: program.title }), total]),
        el('button', { class: 'show__close', type: 'button', 'aria-label': 'Schließen', onclick: close }, [icon('x')]),
      ]),
      el('div', { class: 'show-ov__body' }, [
        list,
        el('div', { class: 'show-ov__side' }, [
          el('div', { class: 'show-ov__steppers' }, [
            stepper('Runden', () => rounds, (v) => { rounds = v; }, 1, 1, 6),
            stepper('Pause', () => rest, (v) => { rest = v; }, 5, 5, 90, ' s'),
          ]),
          music, hint, voice, go,
        ]),
      ]),
    ]));
    paint();
  }

  function musicHint() {
    if (musicMode === 'app') return 'Beat im Takt der Übung – jede Bewegung auf dem Beat. Lauter stellen nicht vergessen.';
    if (musicMode === 'own') return 'Deine Musik (z. B. Spotify) läuft weiter; Ansagen und Zähltöne kommen dazu. Dafür darf das Gerät nicht auf „lautlos“ stehen.';
    return 'Ohne Musik – nur Ansagen und Zähltöne.';
  }

  /* ------------------------------ Ablauf ------------------------------ */
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
    let cued = -1;          // Abschnitt, dessen Musik schon eingeplant ist
    let phase = null;       // { index, audioAt }: Taktanfang des Abschnitts auf der Audio-Uhr
    let watchAt = 0;        // nächster Wächter-Lauf (Show-Zeit)
    let pending = [];       // { t (Show-Zeit), audio?, fire() } – kurz vor t ausgelöst
    let idleTimer = 0;
    const stats = { loops: 0, resyncs: 0, said: 0 };   // für Prüfungen: Schleifen, Nachzieh-Vorgänge, Ansagen
    // Alle Sprachbausteine der Session gleich laden – in den Pausen liegen sie dann bereit.
    if (voiceOn) preloadClips(['done', ...show.segs.flatMap((s) => voiceLines(s, show).flatMap((l) => l.keys))]);

    root.innerHTML = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    svg.setAttribute('class', 'mf mf--coach');   // vor dem ersten Messen: Bühnenmaße statt 300×150
    const kicker = el('div', { class: 'show__kicker' });
    const side = el('span', { class: 'show__side' });
    const stage = el('div', { class: 'show__stage' }, [svg, el('div', { class: 'show__chips' }, [kicker, side])]);
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
    const next = el('div', { class: 'show__next' }, [nextArt, el('span', {}, [el('span', { class: 'show__next-label', text: 'Danach' }), nextName])]);
    const info = el('div', { class: 'show__info' }, [meta, name, dose, counter, el('div', { class: 'show__cue-row' }, [cue, breath]), next]);
    const chapters = el('div', { class: 'show__chapters' }, show.segs.map((s, k) => el('button', {
      class: `show__chapter show__chapter--${s.kind}`, type: 'button', style: { flexGrow: String(s.dur) }, 'aria-label': `Abschnitt ${k + 1}`,
      onclick: () => seek(s.t0 + 0.001),
    }, [el('span', { class: 'show__chapter-fill' })])));
    const left = el('span', { class: 'show__left' });
    const playBtn = el('button', { class: 'show__ctl show__ctl--main', type: 'button', onclick: () => toggle() });
    const musicBtn = el('button', { class: 'show__ctl', type: 'button', title: 'Musik', onclick: () => toggleMusic() }, [icon('music')]);
    const voiceBtn = el('button', { class: 'show__ctl', type: 'button', title: 'Ansagen', disabled: !canSpeak(), onclick: () => toggleVoice() }, [icon('mic')]);
    const controls = el('div', { class: 'show__controls' }, [
      el('button', { class: 'show__ctl', type: 'button', title: 'Zurück', 'aria-label': 'Zurück', onclick: () => skip(-1) }, [icon('back')]),
      playBtn,
      el('button', { class: 'show__ctl', type: 'button', title: 'Weiter', 'aria-label': 'Weiter', onclick: () => skip(1) }, [icon('skip')]),
      el('span', { class: 'show__spacer' }),
      left, musicBtn, voiceBtn,
      el('button', { class: 'show__ctl', type: 'button', title: 'Beenden', 'aria-label': 'Beenden', onclick: close }, [icon('x')]),
    ]);
    const paused = el('button', { class: 'show__paused', type: 'button', onclick: () => toggle() }, [icon('play'), el('span', { text: 'Pausiert – weiter' })]);
    const runEl = el('div', { class: 'show__run' }, [stage, info, chapters, controls, paused]);
    root.appendChild(runEl);
    root.addEventListener('pointerdown', wake);
    root.addEventListener('pointermove', wake);
    // Drehen oder Fenstergröße ändern: Bildausschnitt neu an die Bühne anpassen.
    const onResize = () => { figItem = -1; segIndex = -1; };
    window.addEventListener('resize', onResize);
    // App im Hintergrund (Sperrbildschirm, App-Wechsel): anhalten statt weiterlaufen.
    const onVisible = () => { if (document.hidden && playing && !finished) toggle(); };
    document.addEventListener('visibilitychange', onVisible);

    function paintButtons() {
      playBtn.innerHTML = '';
      playBtn.appendChild(icon(playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Weiter');
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

    /* ---- Uhr und Musik ---- */
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const latency = () => (music ? music.latency : 0);
    /** Audio-Zeit eines Show-Zeitpunkts – um die Ausgabeverzögerung früher, damit Ton und Bild zusammenpassen. */
    const audioAt = (t) => (ctx ? ctx.currentTime + (t - T) - latency() : null);
    const specOf = (s) => ({ style: s.style, bpm: s.bpm, intensity: s.intensity });

    /** Schleife des Abschnitts k – ihr Taktanfang liegt auf dem Beginn des Abschnitts. */
    function playSeg(k) {
      if (!music || !music.running || !ctx || !playing || k < 0) return;
      const s = show.segs[k];
      const phaseAt = audioAt(s.t0);
      music.play(specOf(s), { at: ctx.currentTime + 0.03, phaseAt });
      phase = { index: k, audioAt: phaseAt };
      stats.loops += 1;
    }

    /** Ansage aus Sprachbausteinen; die Musik wird für ihre Dauer leiser. Fehlt ein Baustein,
        spricht die Sprachausgabe des Geräts (Rückfall). */
    function announce(line, at) {
      sayClips(line.keys, { at }).then((r) => {
        if (r) { stats.said += 1; if (music) music.duckFor(r.at, r.dur); } else if (voiceOn && !finished) speak(line.text);
      });
    }

    /* ---- Abschnitt beginnt ---- */
    function enter(st) {
      const seg = st.seg;
      const it = prog.items[seg.i];
      const color = categoryMeta(it.ex.category).color;
      if (figItem !== seg.i) {
        // Bildausschnitt im Seitenverhältnis der Bühne – die Figur so groß wie möglich.
        // Hat die Bühne noch keine Größe (gerade erst eingehängt), folgt das beim nächsten Bild.
        const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { width: 0, height: 0 };
        fitted = r.width > 0 && r.height > 0;
        fig = mountFigure(svg, it.m, { color, side: seg.side, aspect: fitted ? r.width / r.height : null });
        figItem = seg.i;
        if (stage.style.setProperty) stage.style.setProperty('--show-hi', color);
      } else fig.setSide(seg.side);
      runEl.dataset.kind = seg.kind;
      kicker.textContent = {
        ready: 'Gleich geht’s los', rest: 'Pause · als Nächstes', roundRest: `Runde ${seg.round - 1} geschafft`, switch: 'Seitenwechsel', work: 'Jetzt',
      }[seg.kind];
      const sl = it.m.sides ? (seg.side === 'b' ? 'links' : 'rechts') : '';
      side.textContent = it.m.sides === 'each' ? `Seite ${sl}` : '';
      side.hidden = it.m.sides !== 'each';
      name.textContent = it.ex.name;
      dose.textContent = doseLabel(it, prog);
      meta.textContent = `Übung ${seg.i + 1} von ${n}${prog.rounds > 1 ? ` · Runde ${seg.round} von ${prog.rounds}` : ''}`;
      const nx = seg.kind === 'work' ? nextWorkAfter(show, st.index) : null;
      next.hidden = seg.kind !== 'work';
      if (nx) {
        const ni = prog.items[nx.i];
        nextName.textContent = ni.ex.name;
        nextArt.innerHTML = exerciseArt(ni.id, { color: categoryMeta(ni.ex.category).color });
      } else { nextName.textContent = 'Geschafft!'; nextArt.innerHTML = ''; }
      lastCue = '';
      // Musik: kurz vorher eingeplant? Sonst jetzt (Start, Springen, Fortsetzen).
      if (cued !== st.index) playSeg(st.index);
      cued = st.index;
      if (music) for (const k of [st.index + 1, st.index + 2]) if (show.segs[k]) music.prepare(specOf(show.segs[k]));
      // Ansagen, Töne, Anlauf der Musik.
      pending = [];
      const t0 = seg.t0;
      if (voiceOn) for (const line of voiceLines(seg, show)) pending.push({ t: t0 + line.at, audio: true, fire: (at) => announce(line, at) });
      for (const c of cueTones(seg)) pending.push({ t: t0 + c.at, audio: true, fire: (at) => tone(c.freq, { ms: c.ms, gain: c.gain, at }) });
      if (music && seg.kind !== 'work' && seg.dur >= 4) pending.push({ t: t0 + seg.dur - 2, audio: true, fire: (at) => music && music.oneShot('riser', at) });
      pending = pending.filter((p) => p.t >= T - 0.05);
    }

    /* ---- Bild ---- */
    function render() {
      const st = showStateAt(show, T);
      if (st.done) { finish(); return; }
      if (!fitted && svg.getBoundingClientRect && svg.getBoundingClientRect().width > 0) { figItem = -1; segIndex = -1; }
      if (st.index !== segIndex) { segIndex = st.index; enter(st); }
      const seg = st.seg;
      const fr = fig.update(st.anim.t, st.anim.list);
      // Zähler
      let bigTxt = ''; let unitTxt = '';
      if (seg.kind === 'work' && !seg.timed) { bigTxt = `${st.rep}`; unitTxt = `von ${seg.reps}`; }
      else { bigTxt = seg.kind === 'work' ? mmss(st.left) : `${Math.ceil(st.left)}`; unitTxt = seg.kind === 'rest' || seg.kind === 'roundRest' ? 'Sekunden Pause' : 'Sekunden'; }
      if (big.textContent !== bigTxt) big.textContent = bigTxt;
      if (unit.textContent !== unitTxt) unit.textContent = unitTxt;
      ringFill.setAttribute('stroke-dasharray', `${(Math.min(1, st.local / seg.dur) * 326.7).toFixed(1)} 326.7`);
      // Hinweis und Atmung aus der laufenden Phase; in Pause und Vorschau der erste Schritt der Anleitung.
      if (fr.phase.cue) lastCue = fr.phase.cue;
      const c = seg.kind === 'work' ? lastCue : ((prog.items[seg.i].ex.steps || [])[0] || lastCue || '');
      if (cue.textContent !== c) cue.textContent = c;
      const b = seg.kind === 'work' ? ({ ein: 'Einatmen', aus: 'Ausatmen' }[fr.phase.breath] || '') : '';
      if (breath.textContent !== b) breath.textContent = b;
      breath.hidden = !b;
      // Fortschritt
      const lt = `noch ${mmss(show.total - T)}`;
      if (left.textContent !== lt) left.textContent = lt;
      chapters.childNodes.forEach((ch, k) => {
        const s = show.segs[k];
        const f = k < st.index ? 1 : k > st.index ? 0 : st.local / s.dur;
        ch.firstChild.style.width = `${Math.round(f * 1000) / 10}%`;
      });
      if (!playing) return;
      // Musik des nächsten Abschnitts kurz vorher auf die Audio-Uhr legen.
      const nx = show.segs[st.index + 1];
      if (music && music.running && ctx && nx && cued !== st.index + 1 && nx.t0 - T < 0.35) {
        const at = audioAt(nx.t0);
        music.play(specOf(nx), { at, phaseAt: at });
        phase = { index: st.index + 1, audioAt: at };
        stats.loops += 1;
        if (nx.kind === 'work') music.oneShot('crash', at);
        cued = st.index + 1;
      }
      // Fällige Töne und Ansagen.
      for (const p of pending) {
        if (p.done || p.t - T > (p.audio ? 0.15 : 0.02)) continue;
        p.done = true;
        if (p.audio) { if (ctx) p.fire(audioAt(p.t)); } else p.fire();
      }
      // Wächter: Ton nach Unterbrechung wecken, Musik unter Ansagen leiser, Takt nachziehen.
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
      const t = now();
      let dt = lastNow == null ? 0 : t - lastNow;
      lastNow = t;
      if (dt < 0 || dt > 1) dt = 0;            // nach einer Unterbrechung nicht springen
      if (playing && !document.hidden) T += dt;
      // Ein Fehler in einem Bild darf die Session nie anhalten.
      try { render(); } catch (e) { if (!errLogged) { errLogged = true; console.warn('Session:', e); } }
      if (!finished) raf = requestAnimationFrame(frame);
    }

    function seek(t) {
      T = Math.max(0, Math.min(show.total - 0.01, t));
      segIndex = -1; cued = -1; phase = null; pending = [];
      stopSpeaking();
      lastNow = null;
      render();
    }
    function skip(dir) {
      const st = showStateAt(show, T);
      if (st.done) return;
      if (dir > 0) seek(st.seg.t0 + st.seg.dur + 0.001);
      else seek(st.local > 3 || st.index === 0 ? st.seg.t0 + 0.001 : show.segs[st.index - 1].t0 + 0.001);
    }
    function toggle() {
      if (finished) return;
      playing = !playing;
      if (playing) {
        wakeAudio();
        if (musicMode === 'app') { if (!music) music = createMusic(); music.start(); }
        // Musik und Töne des laufenden Abschnitts neu einplanen.
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
      if (voiceOn) announce({ keys: ['done'], text: 'Geschafft! Stark gemacht.' }, ctx ? ctx.currentTime + 0.5 : null);
      const ids = prog.items.map((it) => it.id);
      try { store.bumpExerciseUsage(ids); } catch { /* Zähler optional */ }
      const durationSec = Math.round(show.total);
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'show-done' }, [
        el('div', { class: 'show-done__kicker', text: prog.title }),
        el('h2', { class: 'show-done__title', text: 'Geschafft!' }),
        el('p', { class: 'show-done__stats', text: `${mmss(durationSec)} min · ${n} Übungen${prog.rounds > 1 ? ` · ${prog.rounds} Runden` : ''}` }),
        el('div', { class: 'show-done__actions' }, [
          onFinish ? el('button', { class: 'show-ov__go', type: 'button', onclick: () => { close(); onFinish({ durationSec, ids }); } }, [icon('check'), el('span', { text: 'Als erledigt erfassen' })]) : null,
          el('button', { class: 'show-done__btn', type: 'button', onclick: () => { stopRun(); run = null; overview(); } }, [icon('refresh'), el('span', { text: 'Noch einmal' })]),
          el('button', { class: 'show-done__btn', type: 'button', onclick: close }, [icon('x'), el('span', { text: 'Schließen' })]),
        ]),
      ]));
      toast('Als gemacht gezählt', 'good');
    }

    function stopRun() {
      finished = true;
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
      /** Zeit weiterschalten ohne Bildschirm-Uhr (Tests). */
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
    /** Für Tests: startet ohne Nutzergeste und gibt die laufende Session zurück. */
    start() { run = startRun({ ...program, rounds, rest }); return run; },
    get run() { return run; },
    root,
  };
}
