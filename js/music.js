/* =========================================================================
   music.js — training music, generated live (Web Audio, no files).

   Four styles matching the category: "power" (strength, house), "groove" (core,
   calm beat), "flow" (mobility, soundscapes) and "hiit" (conditioning,
   driving). Three intensities: 0 = rest (pad only, muffled), 1 = run-up (the beat
   comes in), 2 = exercise (everything).

   Beat and movement belong together: `tempoFor()` chooses the tempo so that one
   repetition lasts exactly a whole number of beats – every repetition begins
   on the beat. The patterns (`barEvents`) are plain data and tested.

   Since 3.23.0 playback is no longer note by note in real time (on the iPad
   every stutter of the page threw the music off beat), but as a seamless
   loop: `renderLoop()` pre-computes four bars (OfflineAudioContext), the
   player starts it phase-exact to the section and crossfades.
   ========================================================================= */

import { audioContext } from './audio.js';

/* ------------------------------ Styles ------------------------------ */

export const STYLES = {
  power: {
    bpm: [116, 128],
    chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],      // Am – F – C – G
    bass: [45, 41, 48, 43],
  },
  groove: {
    bpm: [90, 104],
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],   // Fmaj7 – Em7 – Dm7 – Cmaj7
    bass: [41, 40, 38, 36],
  },
  flow: {
    bpm: [64, 80],
    chords: [[50, 54, 57, 61], [47, 50, 54, 57], [43, 47, 50, 54], [45, 49, 52, 57]],   // Dmaj7 – Bm7 – Gmaj7 – A
    bass: [38, 35, 31, 33],
  },
  hiit: {
    bpm: [128, 140],
    chords: [[52, 55, 59], [48, 52, 55], [50, 55, 59], [50, 54, 57]],      // Em – C – G – D
    bass: [40, 36, 43, 38],
  },
};

/** Style per exercise category. */
export function styleFor(category) {
  return { strength: 'power', core: 'groove', mobility: 'flow', cardio: 'hiit' }[category] || 'power';
}

/**
 * Tempo for a movement with cycle length `cycleSec`: whole beats per repetition
 * within the style's tempo range. Returns { bpm, beats, speed } – `speed` (near 1) stretches
 * the animation so that one cycle lasts exactly `beats` beats.
 */
export function tempoFor(cycleSec, style = 'power') {
  const [lo, hi] = (STYLES[style] || STYLES.power).bpm;
  const mid = (lo + hi) / 2;
  if (!(cycleSec > 0)) return { bpm: Math.round(mid), beats: 0, speed: 1 };
  let best = null;
  for (let beats = 1; beats <= 32; beats++) {
    const bpm = (60 * beats) / cycleSec;
    const clamped = Math.min(hi, Math.max(lo, bpm));
    const speed = cycleSec / ((60 * beats) / clamped);
    // Preferred: tempo within the range, movement barely stretched, even beat count.
    const cost = Math.abs(Math.log(speed)) * 4 + Math.abs(clamped - mid) / (hi - lo) + (beats % 2 ? 0.15 : 0);
    if (!best || cost < best.cost) best = { bpm: Math.round(clamped * 10) / 10, beats, speed, cost };
  }
  const speed = cycleSec / ((60 * best.beats) / best.bpm);
  return { bpm: best.bpm, beats: best.beats, speed };
}

/* ------------------------------ Patterns ------------------------------ */

/**
 * Events of a bar (16 steps) for style, intensity and bar number:
 * { step, inst, vel, notes?, midi?, len? }. len in steps.
 */
export function barEvents(style, intensity, bar = 0) {
  const S = STYLES[style] || STYLES.power;
  const chord = S.chords[bar % 4];
  const root = S.bass[bar % 4];
  const ev = [];
  const add = (step, inst, vel, extra = {}) => ev.push({ step, inst, vel, ...extra });
  const fill = bar % 4 === 3;   // last bar of the loop

  // Pad always – during the rest it is the music.
  add(0, style === 'groove' ? 'keys' : 'pad', intensity === 0 ? 0.8 : 0.6, { notes: chord, len: 16 });

  if (style === 'power') {
    if (intensity >= 1) [0, 4, 8, 12].forEach((s) => add(s, 'kick', 1));
    [2, 6, 10, 14].forEach((s) => add(s, 'hat', intensity === 0 ? 0.35 : 0.7, { open: intensity === 2 && s === 14 && bar % 2 === 1 }));
    if (intensity >= 1) [2, 6, 10, 14].forEach((s) => add(s, 'bass', 0.9, { midi: root, len: 2 }));
    if (intensity === 2) {
      [4, 12].forEach((s) => add(s, 'clap', 0.9));
      [3, 10].forEach((s) => add(s, 'stab', 0.8, { notes: chord.map((n) => n + 12) }));
      if (fill) [13, 14, 15].forEach((s) => add(s, 'clap', 0.5));
    }
  } else if (style === 'groove') {
    if (intensity >= 1) { add(0, 'kick', 1); add(7, 'kick', 0.7); add(10, 'kick', 0.9); }
    for (let s = 0; s < 16; s += 2) add(s, 'hat', (s % 4 === 2 ? 0.55 : 0.35) * (intensity === 0 ? 0.6 : 1));
    if (intensity >= 1) { add(0, 'bass', 1, { midi: root, len: 6 }); add(7, 'bass', 0.8, { midi: root + 12, len: 2 }); add(10, 'bass', 0.9, { midi: root, len: 4 }); }
    if (intensity === 2) {
      [4, 12].forEach((s) => add(s, 'snare', 0.85));
      [0, 3, 6, 8, 11, 14].forEach((s, i) => add(s, 'pluck', 0.55, { midi: chord[i % chord.length] + 12 }));
    }
  } else if (style === 'flow') {
    add(0, 'bass', 0.6, { midi: root + 12, len: 16, soft: true });
    // Bright bell tones: an iPad speaker hardly reproduces pads and bass alone.
    [0, 6, 10].forEach((s, i) => add(s, 'pluck', intensity === 2 ? 0.35 : 0.5, { midi: chord[(i + bar) % chord.length] + 24 }));
    if (intensity >= 1) for (let s = 0; s < 16; s += 2) add(s, 'shaker', s % 4 === 0 ? 0.5 : 0.3);
    if (intensity === 2) {
      const up = [...chord, chord[1] + 12, chord[2] + 12];
      [0, 2, 4, 6, 8, 10, 12, 14].forEach((s, i) => add(s, 'pluck', 0.45, { midi: up[(i < 4 ? i : 7 - i) % up.length] + 12 }));
      add(0, 'kick', 0.45); add(8, 'kick', 0.35);
    }
  } else {   // hiit
    if (intensity >= 1) [0, 4, 8, 12].forEach((s) => add(s, 'kick', 1));
    for (let s = 0; s < 16; s++) if (intensity >= 1 || s % 2 === 0) add(s, 'hat', (s % 4 === 2 ? 0.75 : s % 2 ? 0.3 : 0.45) * (intensity === 0 ? 0.6 : 1), { open: intensity === 2 && s % 4 === 2 });
    if (intensity >= 1) for (let s = 0; s < 16; s++) if (s % 4 !== 0) add(s, 'bass', s % 4 === 2 ? 0.95 : 0.6, { midi: root, len: 1 });
    if (intensity === 2) {
      [4, 12].forEach((s) => add(s, 'clap', 1));
      const arp = [chord[0], chord[1], chord[2], chord[1] + 12];
      for (let s = 0; s < 16; s++) add(s, 'pluck', s % 4 === 0 ? 0.6 : 0.4, { midi: arp[s % 4] + 12 });
      if (fill) [12, 13, 14, 15].forEach((s) => add(s, 'snare', 0.5 + (s - 12) * 0.12));
    }
  }
  return ev;
}

/* ------------------------------ Sound ------------------------------ */

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const noiseCache = new WeakMap();

/** Instruments on an (offline) context; `drums` and `duck` are the buses (sidechain). */
function instrumentsFor(c, drums, duck) {
  const noiseBuf = () => {
    if (noiseCache.has(c)) return noiseCache.get(c);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, nb);
    return nb;
  };
  const env = (g, t, peak, attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseSrc = (t, dur) => { const s = c.createBufferSource(); s.buffer = noiseBuf(); s.start(t, Math.random()); s.stop(t + dur); return s; };

  const I = {
    kick(t, v) {
      const o = c.createOscillator(); const g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
      env(g, t, 0.95 * v, 0.004, 0.36);
      o.connect(g); g.connect(drums); o.start(t); o.stop(t + 0.42);
      duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.35, t); duck.gain.setTargetAtTime(1, t + 0.03, 0.07);
    },
    snare(t, v) {
      const s = noiseSrc(t, 0.25); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
      const g = c.createGain(); env(g, t, 0.45 * v, 0.002, 0.18);
      s.connect(f); f.connect(g); g.connect(drums);
      const o = c.createOscillator(); const og = c.createGain(); o.frequency.value = 185; env(og, t, 0.25 * v, 0.002, 0.09);
      o.connect(og); og.connect(drums); o.start(t); o.stop(t + 0.12);
    },
    clap(t, v) {
      const s = noiseSrc(t, 0.3); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach((d) => { g.gain.setValueAtTime(0.55 * v, t + d); g.gain.exponentialRampToValueAtTime(0.08, t + d + 0.009); });
      g.gain.setValueAtTime(0.5 * v, t + 0.032); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      s.connect(f); f.connect(g); g.connect(drums);
    },
    hat(t, v, ev) {
      const open = ev && ev.open;
      const s = noiseSrc(t, open ? 0.32 : 0.06); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200;
      const g = c.createGain(); env(g, t, (open ? 0.16 : 0.2) * v, 0.002, open ? 0.26 : 0.045);
      s.connect(f); f.connect(g); g.connect(drums);
    },
    shaker(t, v) {
      const s = noiseSrc(t, 0.12); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 6200; f.Q.value = 1.4;
      const g = c.createGain(); env(g, t, 0.13 * v, 0.018, 0.07);
      s.connect(f); f.connect(g); g.connect(drums);
    },
    bass(t, v, ev, stepDur) {
      const dur = Math.max(0.12, (ev.len || 2) * stepDur * 0.92);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = ev.soft ? 0.5 : 5;
      f.frequency.setValueAtTime(ev.soft ? 380 : 950, t); f.frequency.exponentialRampToValueAtTime(ev.soft ? 300 : 240, t + Math.min(dur, 0.25));
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * v, t + (ev.soft ? 0.25 : 0.006));
      g.gain.setValueAtTime(0.24 * v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o = c.createOscillator(); o.type = ev.soft ? 'triangle' : 'sawtooth'; o.frequency.value = mtof(ev.midi);
      const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = mtof(ev.midi - 12);
      const sg = c.createGain(); sg.gain.value = 0.7;
      o.connect(f); f.connect(g); sub.connect(sg); sg.connect(g); g.connect(duck);
      o.start(t); sub.start(t); o.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
    },
    pad(t, v, ev, stepDur) {
      const dur = (ev.len || 16) * stepDur;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + Math.min(0.35, dur * 0.3));
      g.gain.setValueAtTime(0.05 * v, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
      f.connect(g); g.connect(duck);
      for (const n of ev.notes) for (const det of [-8, 7]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.3);
      }
    },
    keys(t, v, ev, stepDur) {
      const dur = (ev.len || 16) * stepDur;
      const g = c.createGain(); env(g, t, 0.09 * v, 0.01, Math.min(2.4, dur));
      const trem = c.createGain(); trem.gain.value = 1;
      const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 4.2; lg.gain.value = 0.18;
      lfo.connect(lg); lg.connect(trem.gain); lfo.start(t); lfo.stop(t + dur + 0.1);
      g.connect(trem); trem.connect(duck);
      for (const n of ev.notes) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(n);
        const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(n + 12);
        const g2 = c.createGain(); g2.gain.value = 0.25;
        o.connect(g); o2.connect(g2); g2.connect(g);
        o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
      }
    },
    stab(t, v, ev) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
      const g = c.createGain(); env(g, t, 0.07 * v, 0.004, 0.18);
      f.connect(g); g.connect(duck);
      for (const n of ev.notes) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(n); o.connect(f); o.start(t); o.stop(t + 0.25); }
    },
    pluck(t, v, ev) {
      const g = c.createGain(); env(g, t, 0.11 * v, 0.003, 0.22);
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(ev.midi);
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(ev.midi + 12);
      const g2 = c.createGain(); g2.gain.value = 0.3;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(duck);
      o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
    },
  };
  return { I, noiseSrc, env };
}

const OfflineCtx = () => (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || null;

/** Renders an offline context – Promise (today) or oncomplete (older Safari). */
function renderOffline(oc) {
  return new Promise((resolve, reject) => {
    oc.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = oc.startRendering();
    if (p && p.then) p.then(resolve, reject);
  });
}

const LOW = { 0: 2200, 1: 5500, 2: 18000 };   // Tone filter per intensity: rest muffled, exercise open
const LOUD = { 0: 0.09, 1: 0.13, 2: 0.16 };    // Target loudness (RMS) per intensity – all styles equally loud

/**
 * Computes `bars` bars of a style as a seamless loop (mono): what rings
 * out past the end is mixed back in at the start. Returns an AudioBuffer (or null).
 */
export async function renderLoop({ style, bpm, intensity, bars = 4, sampleRate = 44100, target = null }) {
  const OAC = OfflineCtx();
  if (!OAC) return null;
  const stepDur = 60 / bpm / 4;
  const loopLen = Math.round(bars * 16 * stepDur * sampleRate);
  const tail = Math.round(1.6 * sampleRate);
  const oc = new OAC(1, loopLen + tail, sampleRate);
  const out = oc.createGain(); out.gain.value = 0.8;   // Headroom for signal tones and announcements
  const comp = oc.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.2;
  const tone = oc.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = LOW[intensity] || 18000; tone.Q.value = 0.6;
  const drums = oc.createGain(); drums.gain.value = 0.9;
  const duck = oc.createGain(); duck.gain.value = 1;
  drums.connect(tone); duck.connect(tone); tone.connect(comp); comp.connect(out); out.connect(oc.destination);
  const { I } = instrumentsFor(oc, drums, duck);
  for (let bar = 0; bar < bars; bar++) {
    for (const ev of barEvents(style, intensity, bar)) {
      try { I[ev.inst]((bar * 16 + ev.step) * stepDur, ev.vel, ev, stepDur); } catch { /* a single note drops out */ }
    }
  }
  const rendered = await renderOffline(oc);
  const d = rendered.getChannelData(0);
  const make = target && target.createBuffer ? target : oc;
  const buf = make.createBuffer(1, loopLen, sampleRate);
  const o = buf.getChannelData(0);
  for (let i = 0; i < loopLen; i++) o[i] = d[i] + (i < tail && loopLen + i < d.length ? d[loopLen + i] : 0);
  // Bring to a fixed loudness (peak at most 0.85): every style equally audible.
  let sum = 0; let peak = 0;
  for (let i = 0; i < loopLen; i++) { const v = o[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(sum / loopLen) || 1;
  const k = Math.min((LOUD[intensity] || 0.14) / rms, 0.85 / (peak || 1));
  for (let i = 0; i < loopLen; i++) o[i] *= k;
  return buf;
}

/** One-off sounds: noise that swells for 2 s (run-up), and a cymbal (entry). */
export async function renderOneShot(kind, { sampleRate = 44100 } = {}) {
  const OAC = OfflineCtx();
  if (!OAC) return null;
  const dur = kind === 'riser' ? 2.1 : 1.5;
  const oc = new OAC(1, Math.round(dur * sampleRate), sampleRate);
  const drums = oc.createGain(); drums.gain.value = 0.9; drums.connect(oc.destination);
  const { noiseSrc, env } = instrumentsFor(oc, drums, drums);
  if (kind === 'riser') {
    const s = noiseSrc(0, 2.05); const f = oc.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(350, 0); f.frequency.exponentialRampToValueAtTime(5500, 2);
    const g = oc.createGain(); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.16, 1.98); g.gain.linearRampToValueAtTime(0.0001, 2.04);
    s.connect(f); f.connect(g); g.connect(drums);
  } else {
    const s = noiseSrc(0, 1.4); const f = oc.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4200;
    const g = oc.createGain(); env(g, 0, 0.22, 0.003, 1.3);
    s.connect(f); f.connect(g); g.connect(drums);
  }
  return renderOffline(oc);
}

/**
 * Music player: plays a pre-computed loop per section, phase-exact to the
 * beat of the display. Without Web Audio a silent dummy with the same interface.
 *
 *   prepare(spec)              render the loop in the background (spec: { style, bpm, intensity })
 *   play(spec, { at, phaseAt }) from audio time `at`; the bar start of the loop lies at `phaseAt`
 *   oneShot('riser'|'crash', at)
 *   start() · stop(fade) · setVolume(v) · duck(on) · dispose()
 */
export function createMusic() {
  const c = audioContext();
  const silent = { prepare() {}, play() {}, oneShot() {}, start() {}, stop() {}, setVolume() {}, duck() {}, duckFor() {}, dispose() {}, get running() { return false; }, get latency() { return 0; }, get ready() { return false; } };
  if (!c || !OfflineCtx()) return silent;

  const master = c.createGain(); master.gain.value = 0; master.connect(c.destination);
  const loops = new Map();        // key → Promise<AudioBuffer>
  const shots = new Map();
  let cur = null;                 // { src, gain }
  let token = 0;
  let running = false;
  let volume = 0.85;
  let ducked = false;
  const keyOf = (s) => `${s.style}|${s.bpm}|${s.intensity}`;
  const level = () => (ducked ? volume * 0.3 : volume);

  function prepare(spec) {
    const k = keyOf(spec);
    if (!loops.has(k)) loops.set(k, renderLoop({ ...spec, sampleRate: c.sampleRate, target: c }).catch(() => null));
    return loops.get(k);
  }
  function shot(kind) {
    if (!shots.has(kind)) shots.set(kind, renderOneShot(kind, { sampleRate: c.sampleRate }).catch(() => null));
    return shots.get(kind);
  }
  shot('riser'); shot('crash');

  function fadeOut(node, at) {
    try {
      node.gain.gain.cancelScheduledValues(at);
      node.gain.gain.setValueAtTime(node.gain.gain.value, Math.max(c.currentTime, at - 0.001));
      node.gain.gain.linearRampToValueAtTime(0, at + 0.06);
      node.src.stop(at + 0.1);
    } catch { /* already stopped */ }
  }

  /** Starts the loop `spec` from `at`; its bar start lies at `phaseAt` (both audio time). */
  function play(spec, { at = c.currentTime + 0.03, phaseAt = at } = {}) {
    const my = ++token;
    prepare(spec).then((buf) => {
      if (!buf || my !== token || !running) return;
      const t = Math.max(at, c.currentTime + 0.02);
      const offset = (((t - phaseAt) % buf.duration) + buf.duration) % buf.duration;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.03);
      src.connect(g); g.connect(master);
      src.start(t, offset);
      if (cur) fadeOut(cur, t);
      cur = { src, gain: g };
    });
  }

  return {
    prepare,
    play,
    oneShot(kind, at) {
      shot(kind).then((buf) => {
        if (!buf || !running || at < c.currentTime - 0.05) return;
        const s = c.createBufferSource(); s.buffer = buf; s.connect(master); s.start(Math.max(at, c.currentTime));
      });
    },
    start() {
      running = true;
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.setTargetAtTime(level(), c.currentTime, 0.12);
    },
    stop(fade = 0.3) {
      running = false; token++;
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.linearRampToValueAtTime(0, c.currentTime + fade);
      if (cur) { fadeOut(cur, c.currentTime + fade); cur = null; }
    },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (running) master.gain.setTargetAtTime(level(), c.currentTime, 0.1); },
    /** Quieter for the duration of an announcement (audio time `at`, duration `dur`). */
    duckFor(at, dur) {
      if (!running) return;
      master.gain.setTargetAtTime(volume * 0.3, Math.max(c.currentTime, at - 0.08), 0.04);
      master.gain.setTargetAtTime(level(), at + dur + 0.05, 0.3);
    },
    /** Quieter while the device's speech output is speaking (fallback without recordings). */
    duck(on) {
      if (on === ducked) return;
      ducked = on;
      if (running) master.gain.setTargetAtTime(level(), c.currentTime, on ? 0.06 : 0.25);
    },
    dispose() { this.stop(0.1); },
    get running() { return running; },
    /** Output latency (speakers/Bluetooth): schedule sounds correspondingly earlier. */
    get latency() { return Math.min(0.4, (c.outputLatency || 0) + (c.baseLatency || 0)); },
  };
}
