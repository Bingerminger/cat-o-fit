/* =========================================================================
   music.js — Trainingsmusik, live erzeugt (Web Audio, ohne Dateien).

   Vier Stile passend zur Kategorie: „power“ (Kraft, House), „groove“ (Rumpf,
   ruhiger Beat), „flow“ (Beweglichkeit, Klangflächen) und „hiit“ (Kondition,
   treibend). Drei Stärken: 0 = Pause (nur Fläche, gedämpft), 1 = Anlauf (Beat
   kommt), 2 = Übung (alles).

   Takt und Bewegung gehören zusammen: `tempoFor()` wählt das Tempo so, dass eine
   Wiederholung genau eine ganze Zahl Schläge dauert – jede Wiederholung beginnt
   auf dem Beat. Die Muster (`barEvents`) sind reine Daten und getestet.

   Abgespielt wird seit 3.23.0 nicht mehr Note für Note in Echtzeit (auf dem iPad
   brachte jedes Ruckeln der Seite die Musik aus dem Tritt), sondern als nahtlose
   Schleife: `renderLoop()` rechnet vier Takte vorab (OfflineAudioContext), der
   Player startet sie phasengenau zum Abschnitt und blendet über.
   ========================================================================= */

import { audioContext } from './audio.js';

/* ------------------------------ Stile ------------------------------ */

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
    chords: [[50, 54, 57, 61], [47, 50, 54, 57], [43, 47, 50, 54], [45, 49, 52, 57]],   // Dmaj7 – Hm7 – Gmaj7 – A
    bass: [38, 35, 31, 33],
  },
  hiit: {
    bpm: [128, 140],
    chords: [[52, 55, 59], [48, 52, 55], [50, 55, 59], [50, 54, 57]],      // Em – C – G – D
    bass: [40, 36, 43, 38],
  },
};

/** Stil je Übungskategorie. */
export function styleFor(category) {
  return { strength: 'power', core: 'groove', mobility: 'flow', cardio: 'hiit' }[category] || 'power';
}

/**
 * Tempo für eine Bewegung mit Zykluslänge `cycleSec`: ganze Schläge je Wiederholung
 * im Tempobereich des Stils. Liefert { bpm, beats, speed } – `speed` (nahe 1) streckt
 * die Animation so, dass ein Zyklus genau `beats` Schläge dauert.
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
    // Bevorzugt: Tempo im Bereich, Bewegung kaum gestreckt, gerade Schlagzahl.
    const cost = Math.abs(Math.log(speed)) * 4 + Math.abs(clamped - mid) / (hi - lo) + (beats % 2 ? 0.15 : 0);
    if (!best || cost < best.cost) best = { bpm: Math.round(clamped * 10) / 10, beats, speed, cost };
  }
  const speed = cycleSec / ((60 * best.beats) / best.bpm);
  return { bpm: best.bpm, beats: best.beats, speed };
}

/* ------------------------------ Muster ------------------------------ */

/**
 * Ereignisse eines Takts (16 Schritte) für Stil, Stärke und Taktnummer:
 * { step, inst, vel, notes?, midi?, len? }. len in Schritten.
 */
export function barEvents(style, intensity, bar = 0) {
  const S = STYLES[style] || STYLES.power;
  const chord = S.chords[bar % 4];
  const root = S.bass[bar % 4];
  const ev = [];
  const add = (step, inst, vel, extra = {}) => ev.push({ step, inst, vel, ...extra });
  const fill = bar % 4 === 3;   // letzter Takt der Schleife

  // Fläche immer – in der Pause ist sie die Musik.
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
    // Helle Glockentöne: Flächen und Bass allein gibt ein iPad-Lautsprecher kaum wieder.
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

/* ------------------------------ Klang ------------------------------ */

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const noiseCache = new WeakMap();

/** Instrumente auf einem (Offline-)Kontext; `drums` und `duck` sind die Busse (Seitenkette). */
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

/** Rendert einen Offline-Kontext – Promise (heute) oder oncomplete (älteres Safari). */
function renderOffline(oc) {
  return new Promise((resolve, reject) => {
    oc.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = oc.startRendering();
    if (p && p.then) p.then(resolve, reject);
  });
}

const LOW = { 0: 2200, 1: 5500, 2: 18000 };   // Klangfilter je Stärke: Pause gedämpft, Übung offen
const LOUD = { 0: 0.09, 1: 0.13, 2: 0.16 };    // Ziel-Lautheit (RMS) je Stärke – alle Stile gleich laut

/**
 * Rechnet `bars` Takte eines Stils als nahtlose Schleife (mono): Was über das Ende
 * hinausklingt, wird vorn wieder eingemischt. Liefert ein AudioBuffer (oder null).
 */
export async function renderLoop({ style, bpm, intensity, bars = 4, sampleRate = 44100, target = null }) {
  const OAC = OfflineCtx();
  if (!OAC) return null;
  const stepDur = 60 / bpm / 4;
  const loopLen = Math.round(bars * 16 * stepDur * sampleRate);
  const tail = Math.round(1.6 * sampleRate);
  const oc = new OAC(1, loopLen + tail, sampleRate);
  const out = oc.createGain(); out.gain.value = 0.8;   // Reserve für Signaltöne und Ansagen
  const comp = oc.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.2;
  const tone = oc.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = LOW[intensity] || 18000; tone.Q.value = 0.6;
  const drums = oc.createGain(); drums.gain.value = 0.9;
  const duck = oc.createGain(); duck.gain.value = 1;
  drums.connect(tone); duck.connect(tone); tone.connect(comp); comp.connect(out); out.connect(oc.destination);
  const { I } = instrumentsFor(oc, drums, duck);
  for (let bar = 0; bar < bars; bar++) {
    for (const ev of barEvents(style, intensity, bar)) {
      try { I[ev.inst]((bar * 16 + ev.step) * stepDur, ev.vel, ev, stepDur); } catch { /* einzelner Ton fällt aus */ }
    }
  }
  const rendered = await renderOffline(oc);
  const d = rendered.getChannelData(0);
  const make = target && target.createBuffer ? target : oc;
  const buf = make.createBuffer(1, loopLen, sampleRate);
  const o = buf.getChannelData(0);
  for (let i = 0; i < loopLen; i++) o[i] = d[i] + (i < tail && loopLen + i < d.length ? d[loopLen + i] : 0);
  // Auf eine feste Lautheit bringen (Spitze höchstens 0,85): jeder Stil gleich gut hörbar.
  let sum = 0; let peak = 0;
  for (let i = 0; i < loopLen; i++) { const v = o[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(sum / loopLen) || 1;
  const k = Math.min((LOUD[intensity] || 0.14) / rms, 0.85 / (peak || 1));
  for (let i = 0; i < loopLen; i++) o[i] *= k;
  return buf;
}

/** Einzelklänge: Rauschen, das 2 s lang anschwillt (Anlauf), und ein Becken (Einsatz). */
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
 * Musik-Player: spielt je Abschnitt eine vorab gerechnete Schleife, phasengenau zum
 * Takt der Anzeige. Ohne Web Audio eine stille Attrappe mit derselben Schnittstelle.
 *
 *   prepare(spec)              Schleife im Hintergrund rechnen (spec: { style, bpm, intensity })
 *   play(spec, { at, phaseAt }) ab Audio-Zeit `at`; Taktanfang der Schleife liegt bei `phaseAt`
 *   oneShot('riser'|'crash', at)
 *   start() · stop(fade) · setVolume(v) · duck(on) · dispose()
 */
export function createMusic() {
  const c = audioContext();
  const silent = { prepare() {}, play() {}, oneShot() {}, start() {}, stop() {}, setVolume() {}, duck() {}, duckFor() {}, dispose() {}, get running() { return false; }, get latency() { return 0; }, get ready() { return false; } };
  if (!c || !OfflineCtx()) return silent;

  const master = c.createGain(); master.gain.value = 0; master.connect(c.destination);
  const loops = new Map();        // Schlüssel → Promise<AudioBuffer>
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
    } catch { /* schon gestoppt */ }
  }

  /** Startet die Schleife `spec` ab `at`; ihr Taktanfang liegt bei `phaseAt` (beide Audio-Zeit). */
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
    /** Leiser für die Dauer einer Ansage (Audio-Zeit `at`, Dauer `dur`). */
    duckFor(at, dur) {
      if (!running) return;
      master.gain.setTargetAtTime(volume * 0.3, Math.max(c.currentTime, at - 0.08), 0.04);
      master.gain.setTargetAtTime(level(), at + dur + 0.05, 0.3);
    },
    /** Leiser, solange die Sprachausgabe des Geräts spricht (Rückfall ohne Aufnahmen). */
    duck(on) {
      if (on === ducked) return;
      ducked = on;
      if (running) master.gain.setTargetAtTime(level(), c.currentTime, on ? 0.06 : 0.25);
    },
    dispose() { this.stop(0.1); },
    get running() { return running; },
    /** Ausgabeverzögerung (Lautsprecher/Bluetooth): Töne entsprechend früher planen. */
    get latency() { return Math.min(0.4, (c.outputLatency || 0) + (c.baseLatency || 0)); },
  };
}
