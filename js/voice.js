/* =========================================================================
   voice.js — announcements from ready-made speech building blocks (assets/voice/*.m4a).

   On iPhone and iPad the device's speech output (speechSynthesis) interrupts
   the music or stays silent alongside it. That is why the session plays announcements as
   recordings over the same audio path as the music: building blocks such as
   "Pause. Als Nächstes:" + "Liegestütz" + "10 Wiederholungen" (German clip texts: "Break. Next up:"
   + "Push-up" + "10 repetitions") are laid onto the audio clock one after the other. Generated
   with tools/voice-clips.py (Piper, one voice per language – see CREDITS.md);
   \`voiceTexts()\` is the list of all building blocks.
   ========================================================================= */

import { audioContext } from './audio.js';
import { t, tVariants, locale } from './i18n.js';

/** Languages with recorded clips (assets/voice/<lang>/<key>.m4a). A language without clips gets the
    device voice in its language instead (the show passes the text as fallback). */
export const VOICE_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl'];
const clipLanguage = () => (VOICE_LANGUAGES.includes(locale()) ? locale() : null);

/** Pronunciation help for English names – the German voice reads what it sees. */
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

/** The same for the other recorded voices, but only for names a voice obviously cannot read (English
    loanwords it would spell out or break up); everything else is left to the voice. */
const SAY_FR = { step_up: 'Step-eup', v_up: 'Vi-eup' };
const SAY_ES = {
  dead_bug: 'Ded Bag', hollow_hold: 'Jólou Jóuld', wall_ball: 'Uol Bol', jumping_jack: 'Yámping Yak',
  burpee: 'Búrpi', worlds_greatest_stretch: 'Uérlds Gréitest Estrech',
};
const SAY_IT = { dead_bug: 'Ded Bag', hollow_hold: 'Olou Ould', bear_plank: 'Ber Plank', bear_crawl: 'Ber Crol', worlds_greatest_stretch: 'Uorlds Greitest Stretch' };
const SAY = { de: SAY_DE, fr: SAY_FR, es: SAY_ES, it: SAY_IT };

/** Name for speaking: without the parenthetical, difficult names phonetically (per language). */
export function spokenName(e) {
  return (SAY[locale()] || {})[e.id] || e.name.replace(/\s*\(.*\)\s*$/, '');
}

export const MAX_REPS = 50;
export const SECONDS = Array.from({ length: 36 }, (_, i) => (i + 1) * 5);   // 5 … 180 s

/** All building blocks as { key: text } – for generating and for tests. */
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

/** Building blocks of a quantity: "12×" → reps-12, "40 s je Seite" (40 s per side) → sec-40 + per-side. */
export function doseKeys(label) {
  const keys = [];
  const reps = /^(\d+)×/.exec(label);
  const sec = /^(\d+) s/.exec(label);
  if (reps && Number(reps[1]) <= MAX_REPS) keys.push(`reps-${reps[1]}`);
  else if (sec && SECONDS.includes(Number(sec[1]))) keys.push(`sec-${sec[1]}`);
  if (keys.length && [' je Seite', ...tVariants('showProgram.perSide').map((w) => ` ${w}`)].some((w) => label.includes(w))) keys.push('per-side');
  return keys;
}

/* ------------------------------ Playback ------------------------------ */

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

/** Loads a building block (once; afterwards from memory). */
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

/** Loads building blocks in advance (when a session starts). */
export function preloadClips(keys) { for (const k of new Set(keys)) loadClip(k); }

/**
 * Plays the building blocks one after another from audio time `at`. Returns { at, dur } – or
 * null if a building block is missing (then the announcement stays off).
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
