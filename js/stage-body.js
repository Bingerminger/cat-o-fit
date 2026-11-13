/* =========================================================================
   stage-body.js — what the trainer's body does at a time of the session (pure
   logic, DOM-free; since 4.2): the exercise of the section, and the way from the
   end of one section into the next.

   Between two exercises she does not jump: bones turn from one pose into the
   other, and between standing and the floor she goes the way a person does –
   through a crouch with the hands down, onto the back and up from it over sitting.
   Stateless: any state of the show (showStateAt) gives its body.
   ========================================================================= */

import { BODY, keyPose, solvePose } from './motion-rig.js';
import { MOTIONS } from './exercise-motions.js';
import { vec as V, bodyFlow, blendBodies, bodyPoints, lift } from './body3d.js';
import { clipAt } from './show-program.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (k) => { const x = clamp(k, 0, 1); return x * x * (3 - 2 * x); };

/** Upright (also in the middle of a squat or a lunge). */
export const standing = (b) => b.chest[1] > 70 && b.chest[1] - b.pelvis[1] > 24;
/** On the floor or propped on it (plank, all fours, lying). */
export const down = (b) => b.pelvis[1] < 50 && b.chest[1] - b.pelvis[1] < 18;
const onBack = (b) => down(b) && b.fwd[1] > 0.5;

/** The poses in between: a crouch with the hands on the floor, and sitting. */
function viaPoses() {
  const crouch = MOTIONS.burpee && MOTIONS.burpee.keys.squat ? lift(solvePose(keyPose(MOTIONS.burpee, 'squat'), 'side'), MOTIONS.burpee) : null;
  const sit = lift(solvePose({ hip: [-6, -9], torso: -16, legs: { r: { at: [38, -BODY.ankle] }, l: { at: [36, -BODY.ankle] } }, arms: { r: { at: [-24, -BODY.wrist], bend: 'back' }, l: { at: [-26, -BODY.wrist], bend: 'back' } } }, 'side'), {});
  return { crouch, sit };
}

/**
 * The body of a show (buildShow): `bodyOf(st)` for a state of showStateAt, `startOf(k)` / `endOf(k)` the poses a
 * section begins and ends in, `motionOf(seg)` its exercise.
 */
export function createBodyDirector(show) {
  const prog = show.program;
  const ends = new Map(); const starts = new Map();
  const { crouch, sit } = viaPoses();
  const motionOf = (seg) => prog.items[seg.i].m;

  /** The poses she passes through on the way from A to B (none when both are standing or both are down). */
  function wayOf(A, B0) {
    if (!crouch) return [];
    if (standing(A) && down(B0)) return onBack(B0) ? [crouch, sit] : [crouch];
    if (down(A) && standing(B0)) return onBack(A) ? [sit, crouch] : [crouch];
    return [];
  }
  /** Body of section k at its local time. */
  function segBody(k, local) {
    const seg = show.segs[k];
    const a = clipAt(seg.clips, local);
    return bodyFlow(motionOf(seg), a.t, a.list, { once: !a.clip.loop });
  }
  function startOf(k) {
    if (!starts.has(k)) starts.set(k, segBody(k, 0));
    return starts.get(k);
  }
  function endOf(k) {
    if (!ends.has(k)) ends.set(k, segBody(k, show.segs[k].dur - 1e-3));
    return ends.get(k);
  }
  const gap = (A, B) => {
    const a = bodyPoints(A); const b = bodyPoints(B);
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, V.dist(a[i], b[i]));
    return d;
  };

  /** The trainer's body at a state of the show: the exercise, flowing in from what came before. */
  function bodyOf(st) {
    const B = segBody(st.index, st.local);
    if (st.index === 0) return B;
    const A = endOf(st.index - 1);
    const B0 = startOf(st.index);
    const d = gap(A, B0);
    if (d < 1.5) return B;
    const way = wayOf(A, B0);
    const dur = Math.min(st.seg.dur * 0.6, way.length ? 1.3 * (way.length + 1) : clamp(0.55 + d / 55, 0.6, 2.4));
    if (st.local >= dur) return B;
    const k = smooth(st.local / dur);
    if (way.length) {
      const stops = [A, ...way, B];
      const x = k * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      return blendBodies(stops[i], stops[i + 1], x - i);
    }
    const low = A.pelvis[1] < 30 && B.pelvis[1] < 30;
    return blendBodies(A, B, k, { rise: low && d > 30 ? 9 : 0 });
  }

  return { bodyOf, startOf, endOf, motionOf };
}
