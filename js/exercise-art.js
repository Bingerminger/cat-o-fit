/* =========================================================================
   exercise-art.js — still images of the exercises for tiles and lists.

   Since 3.22.0 from the same joint figure as the animations (motion-figure.js):
   the start pose faint, the characteristic pose strong – so a single
   image shows the beginning and the goal of the movement. The muscles worked carry
   the category colour (`color`), the body the text colour of the surroundings.
   ========================================================================= */

import { MOTIONS } from './exercise-motions.js';
import { motionSVG, thumbKeys } from './motion-figure.js';

const cache = new Map();

/** Returns the SVG still image of an exercise (or of the squat as a fallback). */
export function exerciseArt(key, { color = '' } = {}) {
  const id = MOTIONS[key] ? key : 'squat';
  const k = `${id}|${color}`;
  if (!cache.has(k)) cache.set(k, motionSVG(MOTIONS[id], { ...thumbKeys(MOTIONS[id]), color }));
  return cache.get(k);
}

export const ART_KEYS = Object.keys(MOTIONS);
