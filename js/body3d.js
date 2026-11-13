/* =========================================================================
   body3d.js — the exercises as a body in space (pure logic, DOM-free; since 4.2).

   The movement sequences (exercise-motions.js) are authored as poses in a picture
   plane – seen from the side or from the front. This module lifts such a pose
   into three dimensions and makes the movement natural:

   • `lift()` puts the solved joints (motion-rig.js) into space: hips and
     shoulders get their width, knees and elbows flare the way real ones do,
     limbs the picture foreshortens come towards the viewer, and the small
     offsets that only served as depth cues in the drawing are taken out.
   • `bodyAt()` is the body at a time of a sequence – not eased from pose to pose,
     but blurred a little over time (a stop becomes a soft turn) and with the far
     ends of the body following slightly later than its centre (hands after
     shoulders, head after chest). Planted hands and feet stay exactly where they
     are. It holds no state: any time can be asked in any order (pause, jump).
   • `blendBodies()` crosses two bodies by bone directions – for the way from one
     exercise into the next.

   Space: x to the right of the picture, y up, z towards the viewer of the
   authoring view; the floor is y = 0. Units as in motion-rig.js.
   ========================================================================= */

import { BODY, solvePose, frameAt } from './motion-rig.js';

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};
export const vec = V;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;

/** Rotates v around the unit axis k by `ang` radians (Rodrigues). */
function rotate(v, k, ang) {
  const c = Math.cos(ang); const s = Math.sin(ang);
  return V.add(V.add(V.mul(v, c), V.mul(V.cross(k, v), s)), V.mul(k, V.dot(k, v) * (1 - c)));
}

/**
 * Two-bone solve in space: the middle joint between `root` and `end` for the bone lengths a and b, on the
 * side of `pole`. An end out of reach is pulled in along the line (returned as `end`).
 */
export function solveLimb3(root, end, a, b, pole) {
  let d = V.sub(end, root);
  let L = V.len(d);
  const u = L > 1e-6 ? V.mul(d, 1 / L) : [0, -1, 0];
  L = clamp(L, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  d = V.mul(u, L);
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const h = a * Math.sqrt(1 - cosA * cosA);
  let p = V.sub(V.sub(pole, root), V.mul(u, V.dot(V.sub(pole, root), u)));
  if (V.len(p) < 1e-4) p = Math.abs(u[1]) < 0.9 ? V.cross(u, [0, 1, 0]) : [1, 0, 0];
  p = V.norm(p);
  return { joint: V.add(V.add(root, V.mul(u, a * cosA)), V.mul(p, h)), end: V.add(root, d) };
}

/* ------------------------------ Lifting ------------------------------ */

/** Stance: how far the ankles stand apart sideways when the picture shows the body from the side. */
const STANCE = BODY.hipW * 1.25;
/** Distance below which the two sides of a pair count as "the same place" in a side view (a depth cue of the drawing). */
const TWIN = 5.5;
/** How far a bent knee or elbow turns outwards around the line root → end (degrees at full bend). */
const FLARE = { knee: 16, elbow: 14, elbowPlanted: 40 };

const p3 = (p, z = 0) => [p[0], -p[1], z];

/**
 * A solved pose (motion-rig.js solvePose) in space.
 * @returns {{ view, pelvis, chest, spine, lat, latSh, fwd, head, headUp, headFwd,
 *   legs: { r, l: { hip, knee, ankle, heel, toe } }, arms: { r, l: { sh, elbow, wrist } } }}
 */
export function lift(S, m = {}) {
  return S.view === 'front' ? liftFront(S, m) : liftSide(S, m);
}

function liftSide(S, m) {
  // The body faces +x; its right side (the near one in the picture) is towards the viewer (+z).
  const lat = [0, 0, 1];
  const pelvis = p3(S.hip); const chest = p3(S.sh);
  const up2 = [S.sh[0] - S.hip[0], S.sh[1] - S.hip[1]];
  const ul = Math.hypot(up2[0], up2[1]) || 1;
  // Front of the body in the picture: torsoDir(t + 90).
  const t = (S.torso || 0) * RAD;
  const fwd = [Math.cos(t), -Math.sin(t), 0];
  const mid = V.lerp(pelvis, chest, 0.5);
  const spine = V.sub(mid, V.mul(fwd, S.curl || 0));
  // Limbs that the drawing set a little apart (so both stay visible) are one place in space.
  const twin = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < TWIN;
  const pair = (r, l) => {
    if (!twin(r.end, l.end)) return [r, l];
    const end = [(r.end[0] + l.end[0]) / 2, (r.end[1] + l.end[1]) / 2];
    const joint = twin(r.joint, l.joint) ? [(r.joint[0] + l.joint[0]) / 2, (r.joint[1] + l.joint[1]) / 2] : null;
    return [{ ...r, end, joint: joint || r.joint }, { ...l, end, joint: joint || l.joint }];
  };
  const [legR, legL] = pair(S.legs.r, S.legs.l);
  const [armR, armL] = pair(S.arms.r, S.arms.l);
  const both = !!(m.hold && m.hold.both);
  const legs = {}; const arms = {};
  for (const [side, g, s] of [['r', legR, 1], ['l', legL, -1]]) {
    const hip = V.add(pelvis, V.mul(lat, s * BODY.hipW));
    const ankle = p3(g.end, s * STANCE);
    const knee0 = p3(g.joint, s * (BODY.hipW + STANCE) / 2);
    const knee = flare(hip, knee0, ankle, BODY.thigh, BODY.shin, V.mul(lat, s), FLARE.knee);
    const foot = S.legs[side].foot;
    const dx = foot[1][0] - foot[0][0]; const dy = foot[1][1] - foot[0][1];
    // Flat feet turn out a little; a foot on its toes or in the air points where the picture says.
    const flat = Math.abs(dy) < 2 && g.end[1] > -BODY.ankle - 3;
    const out = flat ? s * 0.16 : 0;
    const dirF = V.norm([dx, -dy, out * Math.abs(dx)]);
    const heel = V.add(ankle, V.mul(dirF, -BODY.heel));
    const toe = V.add(ankle, V.mul(dirF, BODY.foot - BODY.heel));
    legs[side] = { hip, knee, ankle, heel, toe };
  }
  for (const [side, a, s] of [['r', armR, 1], ['l', armL, -1]]) {
    const sh = V.add(chest, V.mul(lat, s * BODY.shoulderW));
    // Hands that hold one thing together meet in front of the body; otherwise they stay at shoulder width.
    const wz = both ? s * 3 : s * (BODY.shoulderW + 1.5);
    const wrist = p3(a.end, wz);
    const elbow0 = p3(a.joint, both ? s * BODY.shoulderW * 0.95 : s * (BODY.shoulderW + 1));
    const planted = a.end[1] > -7;
    const elbow = flare(sh, elbow0, wrist, BODY.upper, BODY.fore, V.mul(lat, s), planted ? FLARE.elbowPlanted : FLARE.elbow);
    arms[side] = { sh, elbow, wrist };
  }
  const head = p3(S.head);
  const headUp = V.norm([(S.head[0] - S.sh[0]), -(S.head[1] - S.sh[1]), 0]);
  // Face side in the picture: perp of "up" (see coach-figure.js).
  const U = [S.head[0] - S.sh[0], S.head[1] - S.sh[1]]; const hl = Math.hypot(U[0], U[1]) || 1;
  const headFwd = V.norm([-U[1] / hl, -U[0] / hl, 0]);
  return { view: 'side', pelvis, chest, spine, lat, latSh: lat, fwd, up: [up2[0] / ul, -up2[1] / ul, 0], head, headUp, headFwd, legs, arms };
}

/** Depth a segment of length `full` gains when the picture shows only `seen` of it. */
const depthOf = (full, seen) => Math.sqrt(Math.max(0, full * full - seen * seen));
const len2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function liftFront(S, m) {
  // The body faces the viewer (+z); its right side is on the left of the picture.
  const pelvis = p3(S.hip); const chest = p3(S.sh);
  const lat = V.norm(V.sub(p3(S.hipR), p3(S.hipL)));
  const latSh = V.norm(V.sub(p3(S.shR), p3(S.shL)));
  const up = V.norm(V.sub(chest, pelvis));
  const fwd = [0, 0, 1];
  const spine = V.lerp(pelvis, chest, 0.5);
  const legs = {}; const arms = {};
  for (const [side, s] of [['r', -1], ['l', 1]]) {
    const g = S.legs[side];
    const hip = p3(side === 'r' ? S.hipR : S.hipL);
    // A thigh the picture shortens comes towards the viewer, the shin goes back down from the knee.
    const kz = depthOf(BODY.thigh, len2(g.root, g.joint));
    const az = kz - depthOf(BODY.shin, len2(g.joint, g.end));
    const knee = p3(g.joint, kz);
    const ankle = p3(g.end, az);
    // Toes point to the viewer, turned out a little.
    const dirF = V.norm([s * 0.18, 0, 1]);
    legs[side] = { hip, knee, ankle, heel: V.add(ankle, V.mul(dirF, -BODY.heel)), toe: V.add(ankle, V.mul(dirF, BODY.foot - BODY.heel)) };
    const a = S.arms[side];
    const sh = p3(side === 'r' ? S.shR : S.shL);
    const ez = depthOf(BODY.upper, len2(a.root, a.joint));
    const wz = ez + depthOf(BODY.fore, len2(a.joint, a.end));
    // A hanging arm is not a plank: the elbow sits a little behind the line, the hand a little in front.
    arms[side] = { sh, elbow: p3(a.joint, ez - 1.2), wrist: p3(a.end, wz + 1.5) };
  }
  const head = p3(S.head);
  const headUp = V.norm(V.sub(head, chest));
  return { view: 'front', pelvis, chest, spine, lat, latSh, fwd, up, head, headUp, headFwd: [0, 0, 1], legs, arms };
}

/** Turns the middle joint outwards around the line root → end, the more the limb is bent; lengths stay. */
function flare(root, joint, end, a, b, outward, maxDeg) {
  const axis = V.sub(end, root);
  const L = V.len(axis);
  const bend = clamp((1 - L / (a + b)) * 3, 0, 1);
  const k = L > 1e-6 ? V.mul(axis, 1 / L) : [0, -1, 0];
  // Re-solve first, so that the widened root and end keep the bone lengths.
  const solved = solveLimb3(root, end, a, b, joint).joint;
  if (bend <= 0 || maxDeg <= 0) return solved;
  const base = V.add(root, V.mul(k, V.dot(V.sub(solved, root), k)));
  const d = V.sub(solved, base);
  const ang = maxDeg * RAD * bend;
  const plus = rotate(d, k, ang); const minus = rotate(d, k, -ang);
  return V.add(base, V.dot(plus, outward) >= V.dot(minus, outward) ? plus : minus);
}

/* ------------------------------ Natural movement ------------------------------ */

/** Sample spacing of the time blur (s) and the weights of five neighbouring samples. */
const STEP = 0.034;
const BLUR = [0.12, 0.23, 0.3, 0.23, 0.12];
/** How many steps each part follows behind the pelvis: the far ends of the body come last. */
const LAG = { pelvis: 0, chest: 0.6, head: 1.4, knee: 0, ankle: 0, elbow: 1, wrist: 2 };
const MAXLAG = 2;

/**
 * The body at time `t` (seconds) of a section list (cycleOf / introOf, also retimed), natural in its movement.
 * Stateless. `speed` scales the blur for sequences that are played faster or slower than authored.
 */
export function bodyAt(m, t, list, { speed = 1 } = {}) {
  const dt = STEP * speed;
  // Skeletons at t + i·dt for i = −(2 + MAXLAG) … 2.
  const lo = -(2 + MAXLAG);
  const sk = [];
  for (let i = lo; i <= 2; i++) sk.push(lift(solvePose(frameAt(m, t + i * dt, list).pose, m.view), m));
  const at = (i) => sk[i - lo];
  /** Blurred value of a joint, `lag` steps behind. */
  const blur = (get, lag) => {
    const out = [0, 0, 0];
    const whole = Math.floor(lag); const frac = lag - whole;
    for (let j = -2; j <= 2; j++) {
      const a = get(at(j - whole)); const b = frac > 0 ? get(at(j - whole - 1)) : a;
      const w = BLUR[j + 2];
      out[0] += w * (a[0] + (b[0] - a[0]) * frac); out[1] += w * (a[1] + (b[1] - a[1]) * frac); out[2] += w * (a[2] + (b[2] - a[2]) * frac);
    }
    return out;
  };
  const now = at(0);
  const pelvis = blur((s) => s.pelvis, LAG.pelvis);
  const chest0 = blur((s) => s.chest, LAG.chest);
  // The torso keeps its length: the chest sits on the blurred direction.
  const chest = V.add(pelvis, V.mul(V.norm(V.sub(chest0, pelvis)), BODY.torso));
  const spine = V.add(V.lerp(pelvis, chest, 0.5), V.sub(blur((s) => s.spine, LAG.chest), V.lerp(blur((s) => s.pelvis, LAG.chest), chest0, 0.5)));
  const lat = V.norm(blur((s) => s.lat, 0)); const latSh = V.norm(blur((s) => s.latSh, LAG.chest));
  const headUp = V.norm(blur((s) => s.headUp, LAG.head));
  const headFwd = V.norm(blur((s) => s.headFwd, LAG.head));
  const head = V.add(chest, V.mul(headUp, BODY.neck + BODY.head));
  const legs = {}; const arms = {};
  for (const side of ['r', 'l']) {
    const sgn = V.dot(V.sub(now.legs[side].hip, now.pelvis), now.lat) >= 0 ? 1 : -1;
    const hip = V.add(pelvis, V.mul(lat, sgn * BODY.hipW));
    const ankle0 = blur((s) => s.legs[side].ankle, LAG.ankle);
    const leg = solveLimb3(hip, ankle0, BODY.thigh, BODY.shin, blur((s) => s.legs[side].knee, LAG.knee));
    const shift = V.sub(leg.end, ankle0);
    legs[side] = { hip, knee: leg.joint, ankle: leg.end, heel: V.add(blur((s) => s.legs[side].heel, LAG.ankle), shift), toe: V.add(blur((s) => s.legs[side].toe, LAG.ankle), shift) };
    const ssgn = V.dot(V.sub(now.arms[side].sh, now.chest), now.latSh) >= 0 ? 1 : -1;
    const sh = V.add(chest, V.mul(latSh, ssgn * BODY.shoulderW));
    const arm = solveLimb3(sh, blur((s) => s.arms[side].wrist, LAG.wrist), BODY.upper, BODY.fore, blur((s) => s.arms[side].elbow, LAG.elbow));
    arms[side] = { sh, elbow: arm.joint, wrist: arm.end };
  }
  return { view: now.view, pelvis, chest, spine, lat, latSh, fwd: now.fwd, up: V.norm(V.sub(chest, pelvis)), head, headUp, headFwd, legs, arms };
}

/* ------------------------------ Crossing two bodies ------------------------------ */

const nlerp = (a, b, k) => {
  const v = V.lerp(a, b, k);
  return V.len(v) < 1e-4 ? a : V.norm(v);
};

/**
 * Body between A and B (k = 0…1): the pelvis moves, every bone turns from its direction in A to the one in B –
 * lengths stay, nothing shrinks on the way. `lift` raises the pelvis in the middle (a step, a getting up).
 */
export function blendBodies(A, B, k, { rise = 0 } = {}) {
  const dir = (p, q) => V.norm(V.sub(q, p));
  const pelvis = V.lerp(A.pelvis, B.pelvis, k);
  pelvis[1] += rise * Math.sin(Math.PI * k);
  const up = nlerp(dir(A.pelvis, A.chest), dir(B.pelvis, B.chest), k);
  const chest = V.add(pelvis, V.mul(up, BODY.torso));
  const spine = V.add(V.lerp(pelvis, chest, 0.5), V.lerp(V.sub(A.spine, V.lerp(A.pelvis, A.chest, 0.5)), V.sub(B.spine, V.lerp(B.pelvis, B.chest, 0.5)), k));
  const lat = nlerp(A.lat, B.lat, k); const latSh = nlerp(A.latSh, B.latSh, k);
  const headUp = nlerp(A.headUp, B.headUp, k); const headFwd = nlerp(A.headFwd, B.headFwd, k);
  const head = V.add(chest, V.mul(headUp, BODY.neck + BODY.head));
  const legs = {}; const arms = {};
  for (const side of ['r', 'l']) {
    const sa = V.dot(V.sub(A.legs[side].hip, A.pelvis), A.lat) >= 0 ? 1 : -1;
    const hip = V.add(pelvis, V.mul(lat, sa * BODY.hipW));
    const knee = V.add(hip, V.mul(nlerp(dir(A.legs[side].hip, A.legs[side].knee), dir(B.legs[side].hip, B.legs[side].knee), k), BODY.thigh));
    const ankle = V.add(knee, V.mul(nlerp(dir(A.legs[side].knee, A.legs[side].ankle), dir(B.legs[side].knee, B.legs[side].ankle), k), BODY.shin));
    const fd = nlerp(dir(A.legs[side].heel, A.legs[side].toe), dir(B.legs[side].heel, B.legs[side].toe), k);
    legs[side] = { hip, knee, ankle, heel: V.add(ankle, V.mul(fd, -BODY.heel)), toe: V.add(ankle, V.mul(fd, BODY.foot - BODY.heel)) };
    const sb = V.dot(V.sub(A.arms[side].sh, A.chest), A.latSh) >= 0 ? 1 : -1;
    const sh = V.add(chest, V.mul(latSh, sb * BODY.shoulderW));
    const elbow = V.add(sh, V.mul(nlerp(dir(A.arms[side].sh, A.arms[side].elbow), dir(B.arms[side].sh, B.arms[side].elbow), k), BODY.upper));
    const wrist = V.add(elbow, V.mul(nlerp(dir(A.arms[side].elbow, A.arms[side].wrist), dir(B.arms[side].elbow, B.arms[side].wrist), k), BODY.fore));
    arms[side] = { sh, elbow, wrist };
  }
  const body = { view: k < 0.5 ? A.view : B.view, pelvis, chest, spine, lat, latSh, fwd: nlerp(A.fwd, B.fwd, k), up, head, headUp, headFwd, legs, arms };
  return aboveFloor(body);
}

/** Lifts a body so that nothing of it lies below the floor (feet at ankle height, hands at wrist height). */
export function aboveFloor(body) {
  let low = Infinity;
  for (const side of ['r', 'l']) {
    low = Math.min(low, body.legs[side].ankle[1] - BODY.ankle, body.legs[side].knee[1] - 4, body.arms[side].wrist[1] - BODY.wrist, body.arms[side].elbow[1] - 3);
  }
  low = Math.min(low, body.pelvis[1] - 7, body.chest[1] - 6, body.head[1] - BODY.head);
  if (low >= 0) return body;
  const up = (p) => [p[0], p[1] - low, p[2]];
  const out = { ...body, pelvis: up(body.pelvis), chest: up(body.chest), spine: up(body.spine), head: up(body.head), legs: {}, arms: {} };
  for (const side of ['r', 'l']) {
    const g = body.legs[side]; const a = body.arms[side];
    out.legs[side] = { hip: up(g.hip), knee: up(g.knee), ankle: up(g.ankle), heel: up(g.heel), toe: up(g.toe) };
    out.arms[side] = { sh: up(a.sh), elbow: up(a.elbow), wrist: up(a.wrist) };
  }
  return out;
}

/** All joints of a body as a flat list (bounds, tests). */
export function bodyPoints(b) {
  const out = [b.pelvis, b.chest, b.head];
  for (const side of ['r', 'l']) out.push(b.legs[side].hip, b.legs[side].knee, b.legs[side].ankle, b.legs[side].heel, b.legs[side].toe, b.arms[side].sh, b.arms[side].elbow, b.arms[side].wrist);
  return out;
}
