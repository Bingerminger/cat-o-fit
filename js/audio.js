/* =========================================================================
   audio.js — sound for exercises and workouts: unlocking, beeps, announcements.

   iPhone and iPad: Safari mutes Web Audio while the device is set to
   "silent" – videos still play because they count as media playback.
   `unlockAudio()` therefore registers the audio session as playback
   (navigator.audioSession, Safari 17+); on older devices a silent
   <audio> element keeps it open. Both must happen inside a user gesture
   (a tap), as must starting the AudioContext and speech synthesis.

   With `mix: true` other apps (e.g. your own music) keep playing; the
   device's silent switch then applies again.
   ========================================================================= */

import { locale } from './i18n.js';

let ctx = null;
let silent = null;

/** The shared AudioContext (or null if the browser has none). */
export function audioContext() {
  if (ctx) return ctx;
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (AC) ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

/** Call inside a user gesture: register the session, start the context, wake up speech synthesis. */
export function unlockAudio({ mix = false } = {}) {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = mix ? 'ambient' : 'playback';
  } catch { /* older browsers */ }
  const c = audioContext();
  if (c) {
    try {
      if (c.state !== 'running' && c.resume) c.resume();
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf; src.connect(c.destination); src.start(0);
    } catch { /* carry on without sound */ }
  }
  holdSession(!mix && !(typeof navigator !== 'undefined' && navigator.audioSession));
  try {
    if (typeof speechSynthesis !== 'undefined' && !speechSynthesis.speaking) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch { /* no speech synthesis */ }
  return c;
}

/** Silent looping <audio>: keeps the playback session open on older iOS versions. */
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
  } catch { /* ignore */ }
}

/** Releases the session again (e.g. when a workout ends). */
export function releaseAudio() {
  holdSession(false);
  stopSpeaking();
}

/**
 * Short beep with a soft envelope (no clicking). `when` = seconds from now,
 * or absolute context time with `at`.
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
  } catch { /* carry on without sound */ }
}

/* ------------------------------ Speech output ------------------------------ */

/** BCP-47 tag for speech in the active language. */
const speechLang = () => ({ en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', nl: 'nl-NL' }[locale()] || locale());
const voices = new Map();
/** Best device voice for the active language (premium/enhanced local voices first). */
function deviceVoice() {
  const lang = speechLang();
  if (voices.has(lang)) return voices.get(lang);
  let v = null;
  try {
    const base = lang.split('-')[0];
    const all = (speechSynthesis.getVoices() || []).filter((x) => String(x.lang).replace('_', '-').toLowerCase().startsWith(base));
    const exact = all.filter((x) => String(x.lang).replace('_', '-').toLowerCase() === lang.toLowerCase());
    const pool = exact.length ? exact : all;
    v = pool.find((x) => x.localService && /premium|enhanced|anna|helena|petra|markus/i.test(x.name))
      || pool.find((x) => x.localService) || pool[0] || null;
  } catch { v = null; }
  if (v) voices.set(lang, v);
  return v;
}

/** Whether the device can read aloud. */
export function canSpeak() {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/* Safari loses announcements whose object nobody holds any more (they abort, onend never
   fires) – so running announcements stay referenced here. And straight after cancel()
   Safari swallows the next announcement; that is why speak() waits briefly afterwards. */
const live = new Set();
let lastCancel = 0;

/** Reads a sentence aloud in the active language (queues behind running announcements). */
export function speak(text, { rate = 1.0 } = {}) {
  if (!text || !canSpeak()) return;
  const wait = 260 - (Date.now() - lastCancel);
  if (wait > 0) { setTimeout(() => speak(text, { rate }), wait); return; }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang();
    const v = deviceVoice();
    if (v) u.voice = v;
    u.rate = rate;
    const done = () => { live.delete(u); wakeAudio(); };
    u.onend = done; u.onerror = done;
    live.add(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
    // Safety net: without onend (iOS), release after 8 s at the latest.
    setTimeout(() => { if (live.has(u)) done(); }, 8000);
  } catch { /* carry on without the announcement */ }
}

/** Whether something is currently being read aloud (the music is then turned down). */
export function speaking() {
  try { return canSpeak() && !!speechSynthesis.speaking; } catch { return false; }
}

/** Cancels all announcements (skipping, pause, end). */
export function stopSpeaking() {
  try { if (canSpeak() && (speechSynthesis.speaking || speechSynthesis.pending)) { speechSynthesis.cancel(); lastCancel = Date.now(); } } catch { /* ignore */ }
  live.clear();
}

/**
 * Wakes the sound up again if iOS has interrupted it (e.g. by an announcement or
 * a phone call): the AudioContext is then in the "interrupted"/"suspended" state.
 */
export function wakeAudio() {
  try { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch { /* ignore */ }
}

/* ------------------------------ Screen on ------------------------------ */

let wake = null;
/** Keeps the screen on (Wake Lock) as long as `on`. */
export async function keepAwake(on) {
  try {
    if (on && !wake && typeof navigator !== 'undefined' && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen');
    if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
