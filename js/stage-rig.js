/* =========================================================================
   stage-rig.js — the body of an exercise in the proportions of the trainer model
   (pure logic, DOM-free; since 4.2).

   The exercises are written for a schematic body (motion-rig.js BODY). The model
   that shows them is a real one: its arms are shorter, its torso too. Turning
   bones alone would lift a carrying hand off the floor or push a standing foot
   through it. `retarget()` therefore keeps what touches the floor where it is and
   lets the rest of the body give way: the pelvis sinks as far as the model's
   limbs need, free limbs keep the direction they were given.

   Space as in body3d.js (x right of the picture, y up, z towards the viewer),
   but in metres. Limbs are solved again by whoever poses the skeleton – from the
   joints given here (knee and elbow are the sides the limbs bend to).
   ========================================================================= */

import { BODY } from './motion-rig.js';
import { vec as V, solveLimb3, poleOf } from './body3d.js';

/** The trainer model's skeleton in metres (MakeHuman, rig "game_engine"; from its rest pose). */
export const TRAINER_RIG = {
  hip: 0.864, hipW: 0.091, thigh: 0.383, calf: 0.42, ankle: 0.067,
  torso: 0.434, shoulderW: 0.158, upper: 0.243, lower: 0.223, wrist: 0.055,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ramp = (x, a, b) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

/**
 * A body (body3d.js) in the proportions of a rig. Returns { pelvis, chest, up, lat, latSh, fwd, headUp, headFwd,
 * legs: { r, l: { hip, knee, ankle, foot (unit, heel → toe), on } }, arms: { r, l: { sh, elbow, wrist, on } } } –
 * `on` 0…1 says how much a foot stands or a hand carries.
 */
export function retarget(b, R = TRAINER_RIG) {
  const s = R.hip / (BODY.thigh + BODY.shin + BODY.ankle);
  const P = (p) => [p[0] * s, p[1] * s, p[2] * s];
  let up = V.norm(V.sub(b.chest, b.pelvis));
  // The model's torso is shorter than the drawing's: hands that carry move that much towards the hips along the body.
  const shorter = BODY.torso * s - R.torso;
  const legSide = (side) => (V.dot(V.sub(b.legs[side].hip, b.pelvis), b.lat) >= 0 ? 1 : -1);
  const armSide = (side) => (V.dot(V.sub(b.arms[side].sh, b.chest), b.latSh) >= 0 ? 1 : -1);

  // Where feet stand and hands carry: the model's ankle and wrist are a little higher over the floor than the drawing's.
  const foot = {}; const hand = {};
  for (const side of ['r', 'l']) {
    const a = b.legs[side].ankle; const on = 1 - ramp(a[1], BODY.ankle + 2.5, BODY.ankle + 9);
    const at = P(a); at[1] += (R.ankle - BODY.ankle * s) * on;
    foot[side] = { on, at };
    const w = b.arms[side].wrist; const onw = 1 - ramp(w[1], BODY.wrist + 3, BODY.wrist + 9);
    const aw = P(w); aw[1] += (R.wrist - BODY.wrist * s) * onw;
    aw[0] -= up[0] * shorter * onw; aw[2] -= up[2] * shorter * onw;
    hand[side] = { on: onw, at: aw };
  }

  // The pelvis gives way until every standing foot and carrying hand is within reach of the model's limbs.
  let pelvis = P(b.pelvis);
  const leg = R.thigh + R.calf - 0.004; const arm = R.upper + R.lower - 0.004;
  const standing = ['r', 'l'].filter((side) => foot[side].on > 0.5);
  const feet = standing.length ? V.mul(standing.reduce((sum, side) => V.add(sum, foot[side].at), [0, 0, 0]), 1 / standing.length) : null;
  for (let pass = 0; pass < 8; pass++) {
    for (const side of standing) {
      const d = V.sub(V.add(pelvis, V.mul(b.lat, legSide(side) * R.hipW)), foot[side].at); const l = V.len(d);
      if (l > leg) pelvis = V.add(pelvis, V.mul(d, (leg - l) / l));
    }
    // What the shoulders have to give so that the carrying hands are in reach …
    let give = [0, 0, 0]; let n = 0;
    for (const side of ['r', 'l']) {
      if (hand[side].on <= 0.5) continue;
      const d = V.sub(V.add(V.add(pelvis, V.mul(up, R.torso)), V.mul(b.latSh, armSide(side) * R.shoulderW)), hand[side].at); const l = V.len(d);
      if (l > arm) { give = V.add(give, V.mul(d, (arm - l) / l)); n += 1; }
    }
    if (!n) continue;
    give = V.mul(give, 1 / n);
    // … the whole body gives by turning about its feet: the hips as much as they are on the way from feet to shoulders.
    const chest0 = V.add(pelvis, V.mul(up, R.torso));
    const share = feet ? clamp(V.dist(pelvis, feet) / Math.max(1e-6, V.dist(chest0, feet)), 0, 1) : 1;
    pelvis = V.add(pelvis, V.mul(give, share));
    up = V.norm(V.sub(V.add(chest0, give), pelvis));
  }
  const chest = V.add(pelvis, V.mul(up, R.torso));

  const dir = (p, q) => V.norm(V.sub(q, p));
  const legs = {}; const arms = {};
  for (const side of ['r', 'l']) {
    const g = b.legs[side];
    const hip = V.add(pelvis, V.mul(b.lat, legSide(side) * R.hipW));
    // Free, a limb keeps its directions; standing or carrying, its end stays in place.
    const free = V.add(V.add(hip, V.mul(dir(g.hip, g.knee), R.thigh)), V.mul(dir(g.knee, g.ankle), R.calf));
    const end = V.lerp(free, foot[side].at, foot[side].on);
    const solved = solveLimb3(hip, end, R.thigh, R.calf, poleOf(hip, end, g.hip, g.knee, g.ankle, b.fwd));
    legs[side] = { hip, knee: solved.joint, ankle: solved.end, foot: dir(g.heel, g.toe), on: foot[side].on };
    const a = b.arms[side];
    const sh = V.add(chest, V.mul(b.latSh, armSide(side) * R.shoulderW));
    const freeW = V.add(V.add(sh, V.mul(dir(a.sh, a.elbow), R.upper)), V.mul(dir(a.elbow, a.wrist), R.lower));
    const endW = V.lerp(freeW, hand[side].at, hand[side].on);
    const sa = solveLimb3(sh, endW, R.upper, R.lower, poleOf(sh, endW, a.sh, a.elbow, a.wrist, V.mul(b.fwd, -1)));
    arms[side] = { sh, elbow: sa.joint, wrist: sa.end, on: hand[side].on };
  }
  return { pelvis, chest, up, lat: b.lat, latSh: b.latSh, fwd: b.fwd, headUp: b.headUp, headFwd: b.headFwd, legs, arms };
}
