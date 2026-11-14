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
   • `bodyFlow()` is the movement as it is meant: sections that carry on in the same
     direction run into each other without a stop.
   • `createFollower()` gives the body weight: it follows its target with the
     middle first and the far ends after, swings out a little and settles.
   • `blendBodies()` crosses two bodies by bone directions – for the way from one
     exercise into the next.

   Space: x to the right of the picture, y up, z towards the viewer of the
   authoring view; the floor is y = 0. Units as in motion-rig.js.
   ========================================================================= */

import { BODY, solvePose, frameAt, keyPose, blendPose } from './motion-rig.js';

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
const STANCE = BODY.hipW * 1.35;
/** Distance below which the two sides of a pair count as "the same place" in a side view (a depth cue of the drawing). */
const TWIN = 5.5;
/**
 * How far a knee or an elbow moves outwards for every unit it leaves the straight line root → end: a knee travels
 * over the toes of a foot that is turned out a little, an elbow leaves the body – more so under a hand that carries.
 */
const TRACK = { knee: 0.13, elbow: 0.2, elbowPlanted: 0.5 };
/** Distance of q from the line a → b in the picture. */
const offLine = (a, b, q) => {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dx, dy);
  return l < 1e-6 ? Math.hypot(q[0] - a[0], q[1] - a[1]) : Math.abs(dx * (q[1] - a[1]) - dy * (q[0] - a[0])) / l;
};

const p3 = (p, z = 0) => [p[0], -p[1], z];

/**
 * A solved pose (motion-rig.js solvePose) in space.
 * @returns {{ view, pelvis, chest, spine, lat, latSh, fwd, head, headUp, headFwd,
 *   legs: { r, l: { hip, knee, ankle, heel, toe } }, arms: { r, l: { sh, elbow, wrist } } }}
 */
export function lift(S, m = {}) {
  if (S.view !== 'front') return liftSide(S, m);
  const b = liftFront(S, m);
  return m.top ? onTheFloor(b) : b;
}

/**
 * A picture drawn from above (an exercise lying on the floor, `top: true`): what the picture shows upright lies down –
 * the picture's "up" runs along the mat, its viewer is the sky.
 */
function onTheFloor(b) {
  const P = (p) => [p[1] - 65, p[2], p[0]];
  const D = (v) => [v[1], v[2], v[0]];
  const out = { ...b, pelvis: P(b.pelvis), chest: P(b.chest), spine: P(b.spine), head: P(b.head), lat: D(b.lat), latSh: D(b.latSh), fwd: D(b.fwd), up: D(b.up), headUp: D(b.headUp), headFwd: D(b.headFwd), legs: {}, arms: {} };
  for (const side of ['r', 'l']) {
    const g = b.legs[side]; const a = b.arms[side];
    out.legs[side] = { hip: P(g.hip), knee: P(g.knee), ankle: P(g.ankle), heel: P(g.heel), toe: P(g.toe) };
    out.arms[side] = { sh: P(a.sh), elbow: P(a.elbow), wrist: P(a.wrist) };
  }
  return aboveFloor(out);
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
  // The closer the two are, the more they are one place – without a jump when they part.
  const twin = (a, b) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const k = clamp((TWIN * 1.5 - d) / (TWIN * 0.9), 0, 1); return k * k * (3 - 2 * k); };
  const meet = (a, b, w) => [[a[0] + (b[0] - a[0]) * w * 0.5, a[1] + (b[1] - a[1]) * w * 0.5], [b[0] + (a[0] - b[0]) * w * 0.5, b[1] + (a[1] - b[1]) * w * 0.5]];
  const pair = (r, l) => {
    const we = twin(r.end, l.end);
    if (we <= 0) return [r, l];
    const [er, el] = meet(r.end, l.end, we);
    const [jr, jl] = meet(r.joint, l.joint, we * twin(r.joint, l.joint));
    return [{ ...r, end: er, joint: jr }, { ...l, end: el, joint: jl }];
  };
  const [legR, legL] = pair(S.legs.r, S.legs.l);
  const [armR, armL] = pair(S.arms.r, S.arms.l);
  const both = !!(m.hold && m.hold.both);
  const legs = {}; const arms = {};
  for (const [side, g, s] of [['r', legR, 1], ['l', legL, -1]]) {
    const hip = V.add(pelvis, V.mul(lat, s * BODY.hipW));
    const ankle = p3(g.end, s * STANCE);
    // The knee stays in the plane of its leg and goes out only as far as it goes forward: over the toes.
    let knee0 = p3(g.joint, s * ((BODY.hipW + STANCE) / 2 + TRACK.knee * offLine(S.hip, g.end, g.joint)));
    // A knee is a hinge that folds one way only: seen from the side, the shin swings back from the line of the thigh,
    // never forward. The flat picture did not always care (a leg in a plank was drawn bent "upwards", a crouch with
    // the knees behind the hips) – where it bends the wrong way, the knee goes to the other side of the leg.
    if ((knee0[0] - hip[0]) * (ankle[1] - knee0[1]) - (knee0[1] - hip[1]) * (ankle[0] - knee0[0]) > 0) {
      const axis = V.norm(V.sub(ankle, hip));
      const off = V.sub(V.sub(knee0, hip), V.mul(axis, V.dot(V.sub(knee0, hip), axis)));
      knee0 = V.sub(knee0, V.mul([off[0], off[1], 0], 2));
    }
    const knee = solveLimb3(hip, ankle, BODY.thigh, BODY.shin, knee0).joint;
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
    const planted = a.end[1] > -7;
    const out = (planted ? TRACK.elbowPlanted : TRACK.elbow) * offLine(S.sh, a.end, a.joint);
    const elbow0 = p3(a.joint, s * ((both ? BODY.shoulderW * 0.95 : BODY.shoulderW + 1) + out));
    const elbow = solveLimb3(sh, wrist, BODY.upper, BODY.fore, elbow0).joint;
    arms[side] = { sh, elbow, wrist };
  }
  const head = p3(S.head);
  const headUp = V.norm([(S.head[0] - S.sh[0]), -(S.head[1] - S.sh[1]), 0]);
  // Face side in the picture: perp of "up" (see coach-figure.js).
  const U = [S.head[0] - S.sh[0], S.head[1] - S.sh[1]]; const hl = Math.hypot(U[0], U[1]) || 1;
  const headFwd = V.norm([-U[1] / hl, -U[0] / hl, 0]);
  return { view: 'side', pelvis, chest, spine, lat, latSh: lat, fwd, up: [up2[0] / ul, -up2[1] / ul, 0], head, headUp, headFwd, legs, arms };
}

/**
 * Depth a segment of length `full` gains when the picture shows only `seen` of it. A few per cent of shortening are
 * drawing tolerance, not depth – and near the full length the root would turn every such trifle into a jerk.
 */
const depthOf = (full, seen) => {
  const c = Math.min(1, seen / full);
  const k = clamp((1 - c) / 0.2, 0, 1);
  return full * Math.sqrt(Math.max(0, 1 - c * c)) * k * k * (3 - 2 * k);
};
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

/* ------------------------------ Natural movement ------------------------------ */

/** Sample spacing of the time blur (s) and the weights of five neighbouring samples. */
const STEP = 0.034;
const BLUR = [0.12, 0.23, 0.3, 0.23, 0.12];
/** How many steps each part follows behind the pelvis: the far ends of the body come last. */
const LAG = { pelvis: 0, chest: 0.6, head: 1.4, knee: 0, ankle: 0, elbow: 1, wrist: 2 };
const MAXLAG = 2;

/**
 * The body at time `t` (seconds) of a section list (cycleOf / introOf, also retimed), natural in its movement.
 * Stateless. `speed` scales the blur for sequences that are played faster or slower than authored; `once` for a
 * list that does not repeat.
 */
export function bodyAt(m, t, list, { speed = 1, once = false } = {}) {
  const dt = STEP * speed;
  // A list that is played once (a way into a position) does not wrap: before its start and after its end the body
  // rests in the first and the last pose instead of being mixed with the other end.
  const end = once ? list.reduce((s, p) => s + p.dur, 0) - 1e-4 : 0;
  const when = (x) => (once ? clamp(x, 0, end) : x);
  // Skeletons at t + i·dt for i = −(2 + MAXLAG) … 2.
  const lo = -(2 + MAXLAG);
  const sk = [];
  for (let i = lo; i <= 2; i++) sk.push(lift(solvePose(frameAt(m, when(t + i * dt), list).pose, m.view), m));
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

/* ------------------------------ Flow ------------------------------ */

const flows = new WeakMap();

/**
 * What a list of sections needs for a flowing movement: how far the body travels in each section and with which
 * speed one section hands over to the next. Where the movement turns round (down → up) or rests, that speed is 0;
 * where it carries on in the same direction (step back → lower), the body does not stop in between.
 */
function flowOf(m, list) {
  const known = flows.get(list);
  if (known && known.m === m) return known;
  const n = list.length;
  const travel = list.map((ph) => {
    if (ph.hold || ph.from === ph.to) return null;
    const a = bodyPoints(lift(solvePose(keyPose(m, ph.from, ph.pass), m.view), m));
    const b = bodyPoints(lift(solvePose(keyPose(m, ph.to, ph.pass), m.view), m));
    const d = a.map((p, i) => V.sub(b[i], p));
    return { d, len: Math.sqrt(d.reduce((s, v) => s + V.dot(v, v), 0)) };
  });
  const join = list.map((ph, i) => {
    const a = travel[i]; const b = travel[(i + 1) % n];
    if (!a || !b || a.len < 1e-3 || b.len < 1e-3) return 0;
    const cos = a.d.reduce((s, v, k) => s + V.dot(v, b.d[k]), 0) / (a.len * b.len);
    return cos < 0.25 ? 0 : cos * 0.5 * (a.len / ph.dur + b.len / list[(i + 1) % n].dur);
  });
  const flow = { m, total: list.reduce((s, p) => s + p.dur, 0) || 1, len: travel.map((x) => (x ? x.len : 0)), join };
  flows.set(list, flow);
  return flow;
}

/**
 * The body at time `t` of a section list as the movement is meant: every section eased, but sections that carry on
 * in the same direction run into each other without a stop. Stateless, exact in the poses (no blur) – the weight
 * of the body comes from `createFollower()`. `once` for a list that does not repeat.
 */
export function bodyFlow(m, t, list, { once = false } = {}) {
  const f = flowOf(m, list);
  const n = list.length;
  const at = once ? clamp(t, 0, f.total - 1e-4) : ((t % f.total) + f.total) % f.total;
  let rest = at; let i = 0;
  while (i < n - 1 && rest >= list[i].dur) { rest -= list[i].dur; i++; }
  const ph = list[i];
  if (ph.hold || ph.from === ph.to || f.len[i] < 1e-3 || ph.dur <= 0) return lift(solvePose(frameAt(m, at, list).pose, m.view), m);
  const k = clamp(rest / ph.dur, 0, 1);
  const vin = once && i === 0 ? 0 : f.join[(i - 1 + n) % n];
  const vout = once && i === n - 1 ? 0 : f.join[i];
  const m0 = Math.min(2.4, (vin * ph.dur) / f.len[i]); const m1 = Math.min(2.4, (vout * ph.dur) / f.len[i]);
  const k2 = k * k; const k3 = k2 * k;
  const w = clamp((k3 - 2 * k2 + k) * m0 + (3 * k2 - 2 * k3) + (k3 - k2) * m1, 0, 1);
  return lift(solvePose(blendPose(keyPose(m, ph.from, ph.pass), keyPose(m, ph.to, ph.pass), w, m.view), m.view), m);
}

/* ------------------------------ A body with weight ------------------------------ */

/** How fast a part follows (rad/s) and how much it is damped (below 1 it swings a little past and settles). */
const FOLLOW = {
  pelvis: [27, 0.9], chest: [20, 0.62], headUp: [16, 0.6], headFwd: [15, 0.75], wrist: [22, 0.6], ankle: [26, 0.72],
};
const SUBSTEP = 1 / 120;
const ramp = (x, a, b) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

/**
 * Where a limb root → end has to bend to: the side on which the target limb (root0 → joint0 → end0) bends. A limb
 * that is nearly straight has no side of its own – it then bends the way such a joint does (`rest`: a knee to the
 * front of the body, an elbow to its back), never by chance to the other one.
 */
export function poleOf(root, end, root0, joint0, end0, rest) {
  const u = V.norm(V.sub(end0, root0));
  const d = V.sub(V.sub(joint0, root0), V.mul(u, V.dot(V.sub(joint0, root0), u)));
  const w = clamp(V.len(d) / 4, 0, 1);
  const r = V.sub(rest, V.mul(u, V.dot(rest, u)));
  const dir = V.add(V.mul(V.len(d) > 1e-6 ? V.norm(d) : [0, 0, 0], w), V.mul(V.len(r) > 1e-6 ? V.norm(r) : [0, 0, 0], 1 - w));
  return V.add(V.lerp(root, end, 0.5), V.mul(V.len(dir) > 1e-6 ? V.norm(dir) : [1, 0, 0], 40));
}

/**
 * Makes a body follow a target body the way a real one moves: the middle leads, the far ends come after and swing
 * out, nothing starts or stops at once. Hands and feet that stand on the floor stay exactly where they are.
 * `step(target, dt)` returns the body for this frame; `reset()` after a jump in time.
 */
export function createFollower() {
  let s = null;
  const part = (p) => ({ p: p.slice(), v: [0, 0, 0] });
  const pull = (st, to, [w, z], h) => {
    for (let k = 0; k < 3; k++) {
      st.v[k] += (w * w * (to[k] - st.p[k]) - 2 * z * w * st.v[k]) * h;
      st.p[k] += st.v[k] * h;
    }
  };
  const dirOf = (a, b) => V.norm(V.sub(b, a));
  function start(T) {
    s = { pelvis: part(T.pelvis), chest: part(dirOf(T.pelvis, T.chest)), headUp: part(T.headUp), headFwd: part(T.headFwd), wrist: {}, ankle: {} };
    for (const side of ['r', 'l']) { s.wrist[side] = part(T.arms[side].wrist); s.ankle[side] = part(T.legs[side].ankle); }
  }
  function step(T, dt) {
    if (!s) start(T);
    let left = clamp(dt, 0, 0.3);
    const chestTo = dirOf(T.pelvis, T.chest);
    while (left > 1e-6) {
      const h = Math.min(left, SUBSTEP); left -= h;
      pull(s.pelvis, T.pelvis, FOLLOW.pelvis, h);
      pull(s.chest, chestTo, FOLLOW.chest, h);
      pull(s.headUp, T.headUp, FOLLOW.headUp, h);
      pull(s.headFwd, T.headFwd, FOLLOW.headFwd, h);
      for (const side of ['r', 'l']) { pull(s.wrist[side], T.arms[side].wrist, FOLLOW.wrist, h); pull(s.ankle[side], T.legs[side].ankle, FOLLOW.ankle, h); }
    }
    // Feet and hands on the floor are where the target has them; the freer they are, the more they follow.
    const ankle = {}; const wrist = {}; const carries = {};
    for (const side of ['r', 'l']) {
      const ta = T.legs[side].ankle; const on = 1 - ramp(ta[1], BODY.ankle + 2.5, BODY.ankle + 9);
      ankle[side] = V.lerp(s.ankle[side].p, ta, on);
      if (on > 0.98) { s.ankle[side].p = ta.slice(); s.ankle[side].v = [0, 0, 0]; }
      const tw = T.arms[side].wrist; const onw = 1 - ramp(tw[1], BODY.wrist + 3, BODY.wrist + 9);
      wrist[side] = V.lerp(s.wrist[side].p, tw, onw);
      carries[side] = onw > 0.5;
      if (onw > 0.98) { s.wrist[side].p = tw.slice(); s.wrist[side].v = [0, 0, 0]; }
    }
    const lat = T.lat; const latSh = T.latSh;
    // The pelvis may not leave a standing foot further behind than the leg is long.
    let pelvis = s.pelvis.p.slice();
    for (const side of ['r', 'l']) {
      const sgn = V.dot(V.sub(T.legs[side].hip, T.pelvis), lat) >= 0 ? 1 : -1;
      const hip = V.add(pelvis, V.mul(lat, sgn * BODY.hipW));
      const d = V.sub(hip, ankle[side]); const l = V.len(d); const max = BODY.thigh + BODY.shin - 0.4;
      if (l > max) pelvis = V.add(pelvis, V.mul(d, (max - l) / l));
    }
    s.pelvis.p = pelvis.slice();
    // Nor may the chest swing further from a carrying hand than the arm is long.
    let up = V.norm(s.chest.p);
    for (let pass = 0; pass < 2; pass++) {
      for (const side of ['r', 'l']) {
        if (!carries[side]) continue;
        const c = V.add(pelvis, V.mul(up, BODY.torso));
        const ssgn = V.dot(V.sub(T.arms[side].sh, T.chest), latSh) >= 0 ? 1 : -1;
        const d = V.sub(V.add(c, V.mul(latSh, ssgn * BODY.shoulderW)), wrist[side]);
        const l = V.len(d); const max = BODY.upper + BODY.fore - 0.3;
        if (l > max) up = V.norm(V.sub(V.add(c, V.mul(d, (max - l) / l)), pelvis));
      }
    }
    s.chest.p = up.slice();
    const chest = V.add(pelvis, V.mul(up, BODY.torso));
    const spine = V.add(V.lerp(pelvis, chest, 0.5), V.sub(T.spine, V.lerp(T.pelvis, T.chest, 0.5)));
    const headUp = V.norm(s.headUp.p); const headFwd = V.norm(s.headFwd.p);
    const head = V.add(chest, V.mul(headUp, BODY.neck + BODY.head));
    const legs = {}; const arms = {};
    for (const side of ['r', 'l']) {
      const g = T.legs[side]; const a = T.arms[side];
      const sgn = V.dot(V.sub(g.hip, T.pelvis), lat) >= 0 ? 1 : -1;
      const hip = V.add(pelvis, V.mul(lat, sgn * BODY.hipW));
      const leg = solveLimb3(hip, ankle[side], BODY.thigh, BODY.shin, poleOf(hip, ankle[side], g.hip, g.knee, g.ankle, T.fwd));
      const shift = V.sub(leg.end, g.ankle);
      legs[side] = { hip, knee: leg.joint, ankle: leg.end, heel: V.add(g.heel, shift), toe: V.add(g.toe, shift) };
      const ssgn = V.dot(V.sub(a.sh, T.chest), latSh) >= 0 ? 1 : -1;
      const sh = V.add(chest, V.mul(latSh, ssgn * BODY.shoulderW));
      const arm = solveLimb3(sh, wrist[side], BODY.upper, BODY.fore, poleOf(sh, wrist[side], a.sh, a.elbow, a.wrist, V.mul(T.fwd, -1)));
      arms[side] = { sh, elbow: arm.joint, wrist: arm.end };
    }
    return { view: T.view, pelvis, chest, spine, lat, latSh, fwd: T.fwd, up, head, headUp, headFwd, legs, arms };
  }
  return { step, reset() { s = null; } };
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
    const thigh = nlerp(dir(A.legs[side].hip, A.legs[side].knee), dir(B.legs[side].hip, B.legs[side].knee), k);
    let shin = nlerp(dir(A.legs[side].knee, A.legs[side].ankle), dir(B.legs[side].knee, B.legs[side].ankle), k);
    // Thigh and shin turn on their own ways – on the way a knee must not fold forward: then the shin takes the
    // same bend on the right side of the thigh.
    if (V.dot(V.cross(thigh, shin), lat) > 0) shin = V.norm(V.sub(V.mul(thigh, 2 * V.dot(thigh, shin)), shin));
    const knee = V.add(hip, V.mul(thigh, BODY.thigh));
    const ankle = V.add(knee, V.mul(shin, BODY.shin));
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

/* ------------------------------ Hinges ------------------------------ */

/**
 * How far each knee and elbow of a body bends the wrong way: 0 = fine, up to 1 = folded backwards (the sine of the
 * wrong-way angle, measured where the joint's hinge lies across the body). A knee folds the shin back, an elbow the
 * forearm forward – never the other way. { kneeR, kneeL, elbowR, elbowL }.
 */
export function hingeOf(b) {
  const out = {};
  const right = b.lat;
  for (const side of ['r', 'l']) {
    const g = b.legs[side]; const a = b.arms[side];
    const knee = V.dot(V.cross(V.norm(V.sub(g.knee, g.hip)), V.norm(V.sub(g.ankle, g.knee))), right);
    const elbow = -V.dot(V.cross(V.norm(V.sub(a.elbow, a.sh)), V.norm(V.sub(a.wrist, a.elbow))), b.latSh);
    out[`knee${side.toUpperCase()}`] = Math.max(0, knee);
    out[`elbow${side.toUpperCase()}`] = Math.max(0, elbow);
  }
  return out;
}

/** All joints of a body as a flat list (bounds, tests). */
export function bodyPoints(b) {
  const out = [b.pelvis, b.chest, b.head];
  for (const side of ['r', 'l']) out.push(b.legs[side].hip, b.legs[side].knee, b.legs[side].ankle, b.legs[side].heel, b.legs[side].toe, b.arms[side].sh, b.arms[side].elbow, b.arms[side].wrist);
  return out;
}
