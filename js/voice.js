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
import { t, tVariants, locale } from './i18n.js';

/** Languages with recorded clips (assets/voice/<lang>/<key>.m4a). Other languages get the
    device voice in their language instead (the show passes the text as fallback). */
export const VOICE_LANGUAGES = ['de'];
const clipLanguage = () => (VOICE_LANGUAGES.includes(locale()) ? locale() : null);

/** Pronunciation help for English names – the German voice reads what it sees (German only). */
const SAY_DE = {
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
  return (locale() === 'de' && SAY_DE[e.id]) || e.name.replace(/\s*\(.*\)\s*$/, '');
}

export const MAX_REPS = 50;
export const SECONDS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5);   // 5 … 180 s

/** Alle Bausteine als { Schlüssel: Text } – für das Erzeugen und für Tests. */
export function voiceTexts(exercises) {
  const out = {
    intro: t('voice.intro'),
    next: t('voice.next'),
    'next-short': t('voice.nextShort'),
    switch: t('voice.switch'),
    done: t('voice.done'),
    'per-side': t('voice.perSide'),
  };
  for (let r = 1; r <= 5; r++) out[`round-${r}`] = t('voice.round', { r, next: r + 1 });
  for (let n = 1; n <= MAX_REPS; n++) out[`reps-${n}`] = n === 1 ? t('voice.oneRep') : t('voice.reps', { n });
  for (const s of SECONDS) out[`sec-${s}`] = t('voice.seconds', { s });
  for (const e of exercises) out[`ex-${e.id}`] = spokenName(e);
  return out;
}

/** Bausteine einer Menge: „12×“ → reps-12, „40 s je Seite“ → sec-40 + per-side. */
export function doseKeys(label) {
  const keys = [];
  const reps = /^(\d+)×/.exec(label);
  const sec = /^(\d+) s/.exec(label);
  if (reps && Number(reps[1]) <= MAX_REPS) keys.push(`reps-${reps[1]}`);
  else if (sec && SECONDS.includes(Number(sec[1]))) keys.push(`sec-${sec[1]}`);
  if (keys.length && [' je Seite', ...tVariants('showProgram.perSide').map((w) => ` ${w}`)].some((w) => label.includes(w))) keys.push('per-side');
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
  const lang = clipLanguage();
  if (!lang) return Promise.resolve(null);
  const id = `${lang}/${key}`;
  if (!cache.has(id)) {
    const c = audioContext();
    cache.set(id, !c || typeof fetch !== 'function' ? Promise.resolve(null)
      : fetch(`assets/voice/${id}.m4a`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? decode(c, b) : null)).catch(() => null));
  }
  return cache.get(id);
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
  let when = Math.max(at != null ? at : c.currentTime + 0.02, c.currentTime + 0.02);
  const start = when;
  for (const b of bufs) {
    const s = c.createBufferSource(); s.buffer = b; s.connect(out); s.start(when);
    when += b.duration + gap;
  }
  return { at: start, dur: when - start - gap };
}
