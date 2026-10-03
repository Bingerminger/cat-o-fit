/* =========================================================================
   exercise-art.js — Standbilder der Übungen für Kacheln und Listen.

   Seit 3.22.0 aus derselben Gelenkfigur wie die Animationen (motion-figure.js):
   die Startpose blass, die kennzeichnende Pose kräftig – so zeigt ein einziges
   Bild Anfang und Ziel der Bewegung. Die beanspruchten Muskeln tragen die
   Kategoriefarbe (`color`), der Körper die Textfarbe der Umgebung.
   ========================================================================= */

import { MOTIONS } from './exercise-motions.js';
import { motionSVG, thumbKeys } from './motion-figure.js';

const cache = new Map();

/** Liefert das SVG-Standbild einer Übung (oder der Kniebeuge als Rückfall). */
export function exerciseArt(key, { color = '' } = {}) {
  const id = MOTIONS[key] ? key : 'squat';
  const k = `${id}|${color}`;
  if (!cache.has(k)) cache.set(k, motionSVG(MOTIONS[id], { ...thumbKeys(MOTIONS[id]), color }));
  return cache.get(k);
}

export const ART_KEYS = Object.keys(MOTIONS);
