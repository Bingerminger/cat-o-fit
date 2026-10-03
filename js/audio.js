/* =========================================================================
   audio.js — Ton für Übungen und Workouts: Freischalten, Signaltöne, Ansagen.

   iPhone und iPad: Safari schaltet Web Audio stumm, solange das Gerät auf
   „lautlos“ steht – Videos laufen trotzdem, weil sie als Wiedergabe gelten.
   Deshalb meldet `unlockAudio()` die Audio-Sitzung als Wiedergabe an
   (navigator.audioSession, Safari 17+), auf älteren Geräten hält ein stummes
   <audio>-Element sie offen. Beides muss in einer Nutzergeste passieren
   (Antippen), ebenso das Anlaufen des AudioContext und der Sprachausgabe.

   Mit `mix: true` laufen andere Apps (z. B. eigene Musik) weiter; dann gilt
   wieder der Lautlos-Schalter des Geräts.
   ========================================================================= */

let ctx = null;
let silent = null;

/** Der gemeinsame AudioContext (oder null, wenn der Browser keinen kennt). */
export function audioContext() {
  if (ctx) return ctx;
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (AC) ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

/** In einer Nutzergeste aufrufen: Sitzung anmelden, Kontext starten, Sprachausgabe wecken. */
export function unlockAudio({ mix = false } = {}) {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = mix ? 'ambient' : 'playback';
  } catch { /* ältere Browser */ }
  const c = audioContext();
  if (c) {
    try {
      if (c.state !== 'running' && c.resume) c.resume();
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf; src.connect(c.destination); src.start(0);
    } catch { /* ohne Ton weiter */ }
  }
  holdSession(!mix && !(typeof navigator !== 'undefined' && navigator.audioSession));
  try {
    if (typeof speechSynthesis !== 'undefined' && !speechSynthesis.speaking) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch { /* keine Sprachausgabe */ }
  return c;
}

/** Stummes <audio> in Schleife: hält auf älteren iOS-Versionen die Wiedergabe-Sitzung offen. */
function holdSession(on) {
  try {
    if (on) {
      if (!silent && typeof Audio !== 'undefined') {
        silent = new Audio('assets/audio/silence.wav');
        silent.loop = true;
        silent.setAttribute('playsinline', '');
      }
      const p = silent && silent.play();
      if (p && p.catch) p.catch(() => {});
    } else if (silent) {
      silent.pause();
    }
  } catch { /* egal */ }
}

/** Gibt die Sitzung wieder frei (z. B. wenn ein Workout endet). */
export function releaseAudio() {
  holdSession(false);
  stopSpeaking();
}

/**
 * Kurzer Signalton mit weicher Hüllkurve (ohne Knacken). `when` = Sekunden ab jetzt
 * bzw. absolute Kontextzeit mit `at`.
 */
export function tone(freq = 880, { ms = 140, gain = 0.32, type = 'sine', when = 0, at = null } = {}) {
  const c = audioContext();
  if (!c) return;
  try {
    if (c.state === 'suspended' && c.resume) c.resume();
    const t = at != null ? at : c.currentTime + when;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + ms / 1000 + 0.03);
  } catch { /* ohne Ton weiter */ }
}

/* ------------------------------ Sprachausgabe ------------------------------ */

let voice = null;
function germanVoice() {
  if (voice) return voice;
  try {
    const all = speechSynthesis.getVoices() || [];
    const de = all.filter((v) => /^de(-|_|$)/i.test(v.lang));
    voice = de.find((v) => v.localService && /premium|enhanced|anna|helena|petra|markus/i.test(v.name))
      || de.find((v) => v.localService) || de[0] || null;
  } catch { voice = null; }
  return voice;
}

/** Ob das Gerät vorlesen kann. */
export function canSpeak() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/* Safari verliert Ansagen, deren Objekt niemand mehr hält (sie brechen ab, onend kommt
   nie) – darum bleiben laufende Ansagen hier referenziert. Und direkt nach cancel()
   verschluckt Safari die nächste Ansage; deshalb wartet speak() danach kurz. */
const live = new Set();
let lastCancel = 0;

/** Liest einen Satz auf Deutsch vor (hängt sich an laufende Ansagen an). */
export function speak(text, { rate = 1.0 } = {}) {
  if (!text || !canSpeak()) return;
  const wait = 260 - (Date.now() - lastCancel);
  if (wait > 0) { setTimeout(() => speak(text, { rate }), wait); return; }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const v = germanVoice();
    if (v) u.voice = v;
    u.rate = rate;
    const done = () => { live.delete(u); wakeAudio(); };
    u.onend = done; u.onerror = done;
    live.add(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    // Sicherheitsnetz: ohne onend (iOS) nach spätestens 8 s freigeben.
    setTimeout(() => { if (live.has(u)) done(); }, 8000);
  } catch { /* ohne Ansage weiter */ }
}

/** Ob gerade vorgelesen wird (die Musik wird dann leiser). */
export function speaking() {
  try { return canSpeak() && !!speechSynthesis.speaking; } catch { return false; }
}

/** Bricht alle Ansagen ab (Springen, Pause, Ende). */
export function stopSpeaking() {
  try { if (canSpeak() && (speechSynthesis.speaking || speechSynthesis.pending)) { speechSynthesis.cancel(); lastCancel = Date.now(); } } catch { /* egal */ }
  live.clear();
}

/**
 * Weckt den Ton wieder, falls iOS ihn unterbrochen hat (z. B. durch eine Ansage oder
 * einen Anruf): Der AudioContext steht dann auf „interrupted“/„suspended“.
 */
export function wakeAudio() {
  try { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch { /* egal */ }
}

/* ------------------------------ Bildschirm an ------------------------------ */

let wake = null;
/** Hält den Bildschirm an (Wake Lock), solange `on`. */
export async function keepAwake(on) {
  try {
    if (on && !wake && typeof navigator !== 'undefined' && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen');
    if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
