/* =========================================================================
   motion-rig.js — articulated figure of the animated exercises (pure logic, DOM-free).

   A figure has pelvis, torso, head, two legs and two arms. A pose fixes
   the pelvis (`hip`), the torso lean (`torso`) and, per limb, either a target
   (`at`: ankle or wrist, solved by two-segment IK) or absolute angles
   (`a`). Between two poses, planted hands and feet stay put:
   if both poses have a target, the target moves and the IK follows – otherwise the
   angles are cross-faded.

   Coordinates: SVG units, ground at y = 0, upwards negative.
   Side view: looking at the right side of the body, the figure faces +x.
   Front view: the figure faces the viewer; its right side is on the left.
   Limbs are named anatomically `r`/`l` – in the side view `r` is the near side.
   `curl` rounds the back (positive, cat-back) or arches it (negative, hollow back).
   `fs` foreshortens a limb pointing towards the viewer (0…1, per segment).
   Angles in degrees from "straight down" (0), positive in the viewing
   direction (90 = horizontally forward, 180 = up, −90 = backward). In the
   front view 90 points to the right (+x).
   ========================================================================= */

import { t as tr } from './i18n.js';

export const BODY = Object.freeze({
  torso: 38, thigh: 32, shin: 31, upper: 23, fore: 21,
  foot: 12, heel: 3, head: 9, neck: 8, ankle: 4, wrist: 3.5,
  hipW: 7, shoulderW: 12,
});
/** Pelvis height when standing upright. */
export const STAND_HIP = -(BODY.ankle + BODY.shin + BODY.thigh);

const RAD = Math.PI / 180;
export const dir = (a) => [Math.sin(a * RAD), Math.cos(a * RAD)];
export const angOf = (v) => Math.atan2(v[0], v[1]) / RAD;
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
export const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const lerp = (a, b, k) => a + (b - a) * k;
const lerpP = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
export function lerpAng(a, b, k) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * k;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Smooth movement: slow in, slow out. */
export const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(k, 0, 1));

/** Direction pelvis → shoulder. `torso` 0 = upright, + = forward (side) or to the right (front). */
export const torsoDir = (t) => dir(180 - t);
/** Front of the body (only meaningful in the side view). */
const bodyFront = (t) => dir(90 - t);

/** Preferred bend direction of a limb as a world vector. */
function bendVector(bend, pose, view, kind, side) {
  const t = pose.torso || 0;
  if (Array.isArray(bend)) return bend;
  switch (bend) {
    case 'front': return bodyFront(t);
    case 'back': return mul(bodyFront(t), -1);
    case 'up': return [0, -1];
    case 'down': return [0, 1];
    case 'left': return [-1, 0];
    case 'right': return [1, 0];
    case 'out': return side === 'r' ? [-1, 0] : [1, 0];
    case 'in': return side === 'r' ? [1, 0] : [-1, 0];
    default: break;
  }
  if (view === 'front') return side === 'r' ? [-1, 0] : [1, 0];
  return kind === 'leg' ? bodyFront(t) : mul(bodyFront(t), -1);
}

/** Two-segment IK: joint (knee/elbow) and end point. Unreachable targets stay stretched in the target direction. */
export function ik(root, target, a, b, pref) {
  const d = sub(target, root);
  const len = Math.hypot(d[0], d[1]);
  const u = len > 1e-9 ? mul(d, 1 / len) : [0, 1];
  const reach = clamp(len, Math.abs(a - b) + 1e-6, a + b - 1e-6);
  const cosA = clamp((a * a + reach * reach - b * b) / (2 * a * reach), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const base = add(root, mul(u, a * cosA));
  const n = [-u[1], u[0]];
  const side = dot(n, pref) >= 0 ? 1 : -1;
  const joint = add(base, mul(n, side * a * sinA));
  return { joint, end: add(root, mul(u, reach)) };
}

/** Roots (hip and shoulder joints) of a pose. */
function roots(pose, view) {
  const t = pose.torso || 0;
  const u = torsoDir(t);
  const hip = pose.hip;
  const sh = add(hip, mul(u, BODY.torso));
  if (view !== 'front') return { hip, sh, hipR: hip, hipL: hip, shR: sh, shL: sh, u };
  const n = [-u[1], u[0]];            // Transverse axis: points to +x with an upright torso (viewer's right)
  // The pelvis tilts with the torso (lying, side plank) – unless `pelvis` fixes it (side lean while standing).
  const up = pose.pelvis != null ? torsoDir(pose.pelvis) : u;
  const np = [-up[1], up[0]];
  return {
    hip, sh, u,
    hipR: add(hip, mul(np, -BODY.hipW)), hipL: add(hip, mul(np, BODY.hipW)),
    shR: add(sh, mul(n, -BODY.shoulderW)), shL: add(sh, mul(n, BODY.shoulderW)),
  };
}

/** Foreshortening of a limb (if it points towards the viewer it looks shorter): [upper segment, lower segment]. */
const fsOf = (spec) => (spec && spec.fs != null ? (Array.isArray(spec.fs) ? spec.fs : [spec.fs, spec.fs]) : [1, 1]);

/** Solve one limb: { root, joint, end }. */
function solveLimb(root, spec, a0, b0, pose, view, kind, side) {
  const fs = fsOf(spec);
  const a = a0 * fs[0]; const b = b0 * fs[1];
  if (spec && spec.at) {
    const r = ik(root, spec.at, a, b, bendVector(spec.bend, pose, view, kind, side));
    return { root, joint: r.joint, end: r.end };
  }
  const ang = (spec && spec.a) || (kind === 'leg' ? [0, 0] : [6, 8]);
  const joint = add(root, mul(dir(ang[0]), a));
  return { root, joint, end: add(joint, mul(dir(ang[1]), b)) };
}

/** Foot direction: explicit, otherwise flat forward (on the ground) or at right angles to the shin. */
function footAngle(spec, leg, view, side) {
  if (spec && spec.foot != null) return spec.foot;
  if (view === 'front') return side === 'r' ? -90 : 90;
  if (leg.end[1] >= -BODY.ankle - 2) return 90;
  return angOf(sub(leg.end, leg.joint)) + 90;
}

/**
 * Solves a pose into joint points:
 * { view, hip, sh, head, legs: { r, l }, arms: { r, l } } – per limb { root, joint, end, foot? }.
 */
export function solvePose(pose, view = 'side') {
  const R = roots(pose, view);
  const t = pose.torso || 0;
  const head = add(R.sh, mul(torsoDir(t + (pose.head || 0)), BODY.neck + BODY.head));
  const legs = {}; const arms = {};
  for (const side of ['r', 'l']) {
    const ls = (pose.legs || {})[side];
    const leg = solveLimb(side === 'r' ? R.hipR : R.hipL, ls, BODY.thigh, BODY.shin, pose, view, 'leg', side);
    const fa = footAngle(ls, leg, view, side);
    // From the front the foot is a short crossbar at the ankle (at right angles to the shin).
    const across = view === 'front' && !(ls && ls.foot != null) ? angOf(sub(leg.end, leg.joint)) + 90 : fa;
    leg.foot = view === 'front'
      ? [add(leg.end, mul(dir(across), 3.5)), add(leg.end, mul(dir(across), -3.5))]
      : [add(leg.end, mul(dir(fa), -BODY.heel)), add(leg.end, mul(dir(fa), BODY.foot - BODY.heel))];
    legs[side] = leg;
    const as = (pose.arms || {})[side];
    arms[side] = solveLimb(side === 'r' ? R.shR : R.shL, as, BODY.upper, BODY.fore, pose, view, 'arm', side);
  }
  return { view, hip: R.hip, sh: R.sh, hipR: R.hipR, hipL: R.hipL, shR: R.shR, shL: R.shL, head, torso: t, curl: pose.curl || 0, legs, arms };
}

/** Absolute angles of a solved limb. */
function limbAngles(limb) {
  return [angOf(sub(limb.joint, limb.root)), angOf(sub(limb.end, limb.joint))];
}

/**
 * Cross-fades two poses (k = 0…1, already eased).
 * Targets stay targets (contact stays planted), otherwise angles.
 */
export function blendPose(A, B, k, view = 'side') {
  const out = {
    hip: lerpP(A.hip, B.hip, k),
    torso: lerp(A.torso || 0, B.torso || 0, k),
    head: lerp(A.head || 0, B.head || 0, k),
    curl: lerp(A.curl || 0, B.curl || 0, k),
    legs: {}, arms: {},
    ...(A.pelvis != null || B.pelvis != null
      ? { pelvis: lerp(A.pelvis != null ? A.pelvis : (A.torso || 0), B.pelvis != null ? B.pelvis : (B.torso || 0), k) } : {}),
    hold: k < 0.5 ? A.hold : B.hold,
  };
  let SA = null; let SB = null;
  const solved = () => { if (!SA) { SA = solvePose(A, view); SB = solvePose(B, view); } };
  for (const group of ['legs', 'arms']) {
    for (const side of ['r', 'l']) {
      const a = (A[group] || {})[side] || {};
      const b = (B[group] || {})[side] || {};
      const spec = {};
      if (a.at && b.at) {
        spec.at = lerpP(a.at, b.at, k);
        spec.bend = k < 0.5 ? a.bend : b.bend;
      } else {
        solved();
        const la = limbAngles(SA[group][side]);
        const lb = limbAngles(SB[group][side]);
        spec.a = [lerpAng(la[0], lb[0], k), lerpAng(la[1], lb[1], k)];
      }
      if (a.fs != null || b.fs != null) {
        const fa = fsOf(a); const fb = fsOf(b);
        spec.fs = [lerp(fa[0], fb[0], k), lerp(fa[1], fb[1], k)];
      }
      if (group === 'legs' && (a.foot != null || b.foot != null)) {
        solved();
        const fa = a.foot != null ? a.foot : angOf(sub(SA.legs[side].foot[1], SA.legs[side].foot[0]));
        const fb = b.foot != null ? b.foot : angOf(sub(SB.legs[side].foot[1], SB.legs[side].foot[0]));
        spec.foot = lerpAng(fa, fb, k);
      }
      out[group][side] = spec;
    }
  }
  return out;
}

/* ------------------------------ Side change ------------------------------ */

const FLIP_BEND = { left: 'right', right: 'left' };
function mirrorPoint(p, cx) { return [2 * cx - p[0], p[1]]; }

/** Mirrors a pose for the other side of the body (side: swap limbs; front: mirror at cx). */
export function otherSide(pose, view = 'side', cx = 0) {
  const swap = (g) => ({ r: (g || {}).l, l: (g || {}).r });
  if (view !== 'front') {
    return { ...pose, legs: swap(pose.legs), arms: swap(pose.arms), hold: pose.hold ? { r: pose.hold.l, l: pose.hold.r } : pose.hold };
  }
  const m = (spec) => {
    if (!spec) return spec;
    const o = { ...spec };
    if (o.at) o.at = mirrorPoint(o.at, cx);
    if (o.a) o.a = o.a.map((x) => -x);
    if (o.foot != null) o.foot = -o.foot;
    if (typeof o.bend === 'string' && FLIP_BEND[o.bend]) o.bend = FLIP_BEND[o.bend];
    if (Array.isArray(o.bend)) o.bend = [-o.bend[0], o.bend[1]];
    return o;
  };
  const g = (grp) => ({ r: m((grp || {}).l), l: m((grp || {}).r) });
  return {
    ...pose,
    hip: mirrorPoint(pose.hip, cx),
    torso: -(pose.torso || 0),
    head: -(pose.head || 0),
    ...(pose.pelvis != null ? { pelvis: -pose.pelvis } : {}),
    legs: g(pose.legs), arms: g(pose.arms),
    hold: pose.hold ? { r: pose.hold.l, l: pose.hold.r } : pose.hold,
  };
}

/* ------------------------------ Movement sequence ------------------------------ */

/**
 * One pass (one repetition; with `sides: 'alternate'` both sides) as a
 * list of sections: { from, to, dur, label, cue, breath, side, hold }.
 */
export function cycleOf(m, side = 'a') {
  const passes = m.sides === 'alternate' ? ['a', 'b'] : [side];
  const out = [];
  for (const pass of passes) phasesOf(m.seq, m.start, pass, out);
  return out;
}

/** One-off path into the starting position (`intro`) as a section list – empty if there is none. */
export function introOf(m, side = 'a') {
  return m.intro ? phasesOf(m.intro.seq, m.intro.from, side, []) : [];
}

function phasesOf(seq, from, pass, out) {
  let cur = from;
  for (const ph of seq) {
    const to = ph.to || cur;
    out.push({
      from: cur, to, pass,
      dur: ph.hold != null ? ph.hold : ph.s,
      hold: ph.hold != null,
      label: ph.label || (ph.hold != null ? tr('motionRig.hold') : ''),
      cue: ph.cue || '', breath: ph.breath || '',
    });
    cur = to;
  }
  return out;
}

/** Duration of one pass in seconds. */
export function cycleDuration(m) { return cycleOf(m).reduce((s, p) => s + p.dur, 0); }

/** Pose of a key for one pass (side b = mirrored). */
export function keyPose(m, key, pass = 'a') {
  const p = m.keys[key];
  if (!p) throw new Error(`Pose “${key}” is missing`);
  return pass === 'b' ? otherSide(p, m.view, m.cx || 0) : p;
}

/**
 * State at time `t` (seconds) within one pass:
 * { pose, phase, index, k } – `k` is the progress within the section (0…1).
 */
export function frameAt(m, t, cycle = cycleOf(m)) {
  const total = cycle.reduce((s, p) => s + p.dur, 0) || 1;
  let rest = ((t % total) + total) % total;
  for (let i = 0; i < cycle.length; i++) {
    const ph = cycle[i];
    if (rest < ph.dur || i === cycle.length - 1) {
      const k = ph.dur > 0 ? clamp(rest / ph.dur, 0, 1) : 1;
      const A = keyPose(m, ph.from, ph.pass);
      const pose = ph.hold || ph.from === ph.to ? breathe(A, m, rest) : blendPose(A, keyPose(m, ph.to, ph.pass), ease(k), m.view);
      return { pose, phase: ph, index: i, k };
    }
    rest -= ph.dur;
  }
  return { pose: keyPose(m, m.start), phase: cycle[0], index: 0, k: 0 };
}

/** Barely visible breathing in hold phases so that the figure "lives". */
function breathe(pose, m, t) {
  if (m.still) return pose;
  const s = Math.sin((t / 4) * 2 * Math.PI);
  return { ...pose, torso: (pose.torso || 0) + s * 0.8, head: (pose.head || 0) + s * 1.2 };
}

/* ------------------------------ Bounds ------------------------------ */

/** All drawn points of a solved pose (for the frame and tests). */
export function posePoints(S) {
  const pts = [S.hip, S.sh, S.head];
  for (const side of ['r', 'l']) {
    const g = S.legs[side]; const a = S.arms[side];
    pts.push(g.root, g.joint, g.end, g.foot[0], g.foot[1], a.root, a.joint, a.end);
  }
  return pts;
}
