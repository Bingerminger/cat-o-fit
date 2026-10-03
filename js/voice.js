/* =========================================================================
   voice.js — Ansagen aus fertigen Sprachbausteinen (assets/voice/*.m4a).

   Auf iPhone und iPad unterbricht die Sprachausgabe des Geräts (speechSynthesis)
   die Musik oder bleibt neben ihr stumm. Deshalb spielt die Session Ansagen als
   Aufnahmen über denselben Audio-Weg wie die Musik: Bausteine wie „Pause. Als
   Nächstes:“ + „Liegestütz“ + „10 Wiederholungen“ werden nacheinander auf die
   Audio-Uhr gelegt. Erzeugt mit tools/voice-clips.py (Piper, Stimme „Thorsten“,
   Datensatz CC0); \`voiceTexts()\` ist die Liste aller Bausteine.
   ========================================================================= */

import { audioContext } from './audio.js';

/** Aussprachehilfen für englische Namen – die deutsche Stimme liest, was sie sieht. */
const SAY = {
  dead_bug: 'Dedd Bagg', split_squat: 'Bulgarischer Splitt Skwott', step_up: 'Stepp-app', crunch: 'Krantsch',
  hollow_hold: 'Hollo Hould', superman: 'Supermän', bird_dog: 'Börd Dogg', nordic_hamstring: 'Nordik Hämstring Körl',
  copenhagen: 'Kopenhagen-Seitstütz', clamshell: 'Klämschell', monster_walk: 'Monster Wook', goblet_squat: 'Goblett Skwott',
  hip_thrust: 'Hipp Thrast an der Bank', kettlebell_swing: 'Kettelbell-Swing', good_morning: 'Gudd Morning',
  step_down: 'Stepp-daun', farmers_carry: 'Farmers Wook', wall_ball: 'Wohl Bohl', thruster: 'Thraster',
  pike_pushup: 'Peik Pusch-app', biceps_curl: 'Bizeps-Körl', donkey_kick: 'Donkie Kick', russian_twist: 'Raschen Twist',
  reverse_crunch: 'Riwörs Krantsch', bicycle_crunch: 'Fahrrad-Krantsch', v_up: 'Wie-App', flutter_kicks: 'Flatter Kicks',
  worlds_greatest_stretch: 'Wörlds Greitest Stretsch', inchworm: 'Intschwörm', burpee: 'Börpie', mountain_climber: 'Mauntn Klaimer',
};

/** Name zum Sprechen: ohne Klammerzusatz, englische Namen lautgerecht. */
export function spokenName(e) {
  return SAY[e.id] || e.name.replace(/\s*\(.*\)\s*$/, '');
}

export const MAX_REPS = 50;
export const SECONDS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5);   // 5 … 180 s

/** Alle Bausteine als { Schlüssel: Text } – für das Erzeugen und für Tests. */
export function voiceTexts(exercises) {
  const t = {
    intro: 'Los geht\'s! Zuerst:',
    next: 'Pause. Als Nächstes:',
    'next-short': 'Als Nächstes:',
    switch: 'Seitenwechsel.',
    done: 'Geschafft! Stark gemacht.',
    'per-side': 'pro Seite',
  };
  for (let r = 1; r <= 5; r++) t[`round-${r}`] = `Runde ${r} geschafft. Durchatmen. Gleich Runde ${r + 1}:`;
  for (let n = 1; n <= MAX_REPS; n++) t[`reps-${n}`] = n === 1 ? 'eine Wiederholung' : `${n} Wiederholungen`;
  for (const s of SECONDS) t[`sec-${s}`] = `${s} Sekunden`;
  for (const e of exercises) t[`ex-${e.id}`] = spokenName(e);
  return t;
}

/** Bausteine einer Menge: „12×“ → reps-12, „40 s je Seite“ → sec-40 + per-side. */
export function doseKeys(label) {
  const keys = [];
  const reps = /^(\d+)×/.exec(label);
  const sec = /^(\d+) s/.exec(label);
  if (reps && Number(reps[1]) <= MAX_REPS) keys.push(`reps-${reps[1]}`);
  else if (sec && SECONDS.includes(Number(sec[1]))) keys.push(`sec-${sec[1]}`);
  if (keys.length && / je Seite/.test(label)) keys.push('per-side');
  return keys;
}

/* ------------------------------ Abspielen ------------------------------ */

const cache = new Map();
let out = null;

function decode(c, data) {
  return new Promise((resolve) => {
    try {
      const p = c.decodeAudioData(data, resolve, () => resolve(null));
      if (p && p.then) p.then(resolve, () => resolve(null));
    } catch { resolve(null); }
  });
}

/** Lädt einen Baustein (einmal; danach aus dem Speicher). */
export function loadClip(key) {
  if (!cache.has(key)) {
    const c = audioContext();
    cache.set(key, !c || typeof fetch !== 'function' ? Promise.resolve(null)
      : fetch(`assets/voice/${key}.m4a`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? decode(c, b) : null)).catch(() => null));
  }
  return cache.get(key);
}

/** Lädt Bausteine im Voraus (beim Start einer Session). */
export function preloadClips(keys) { for (const k of new Set(keys)) loadClip(k); }

/**
 * Spielt die Bausteine nacheinander ab Audio-Zeit `at`. Liefert { at, dur } – oder
 * null, wenn ein Baustein fehlt (dann bleibt die Ansage aus).
 */
export async function sayClips(keys, { at = null, gap = 0.1, gain = 1 } = {}) {
  const c = audioContext();
  if (!c || !keys.length) return null;
  const bufs = await Promise.all(keys.map(loadClip));
  if (bufs.some((b) => !b)) return null;
  if (!out) { out = c.createGain(); out.connect(c.destination); }
  out.gain.value = gain;
  let t = Math.max(at != null ? at : c.currentTime + 0.02, c.currentTime + 0.02);
  const start = t;
  for (const b of bufs) {
    const s = c.createBufferSource(); s.buffer = b; s.connect(out); s.start(t);
    t += b.duration + gap;
  }
  return { at: start, dur: t - start - gap };
}
