/* =========================================================================
   stage-model.js — the trainer model: a real body with a skeleton (since 4.2).

   The model (assets/trainer/: trainer.json, trainer.bin, textures) is a human
   from MakeHuman – meshes with skin weights and 23 bones. This module reads it
   and poses its skeleton from the joints of an exercise (stage-rig.js retarget):
   torso and head get their orientation from the lines of hips, shoulders and
   spine, limbs swing the shortest way from where their parent carries them
   (no twist added), feet stay within what an ankle allows, a carrying hand lies
   flat. Pure arithmetic, DOM-free; the drawing is stage-gl.js.

   The model lives in its own space (metres; x to her left, y to her back, z up).
   `MODEL_TO_STAGE` puts it onto the stage (body3d.js: x her front in a side view,
   y up, z her right; units of motion-rig.js).
   ========================================================================= */

import { BODY } from './motion-rig.js';

/* ------------------------------ Small algebra ------------------------------ */
/* Vectors are [x, y, z]; rotations are 3×3 as columns [x0,x1,x2, y0,y1,y2, z0,z1,z2]. */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const cols = (x, y, z) => [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
const col = (m, i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
const mv = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const mm = (a, b) => cols(mv(a, col(b, 0)), mv(a, col(b, 1)), mv(a, col(b, 2)));
const tr = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

function quatOf(m) {
  const t = m[0] + m[4] + m[8];
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(m[5] - m[7]) / s, (m[6] - m[2]) / s, (m[1] - m[3]) / s, s / 4]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; q = [s / 4, (m[3] + m[1]) / s, (m[6] + m[2]) / s, (m[5] - m[7]) / s]; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; q = [(m[3] + m[1]) / s, s / 4, (m[7] + m[5]) / s, (m[6] - m[2]) / s]; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; q = [(m[6] + m[2]) / s, (m[7] + m[5]) / s, s / 4, (m[1] - m[3]) / s]; }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function rotOf([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}
/** Between two rotations, the short way round. */
function slerp(A, B, k) {
  const a = quatOf(A); let b = quatOf(B);
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  let ka = 1 - k; let kb = k;
  if (d < 0.9995) { const th = Math.acos(d); const s = Math.sin(th); ka = Math.sin((1 - k) * th) / s; kb = Math.sin(k * th) / s; }
  const q = [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return rotOf([q[0] / l, q[1] / l, q[2] / l, q[3] / l]);
}
/** The rotation that turns direction `from` into `to` the shortest way. */
function arc(from, to) {
  const a = norm(from); const b = norm(to);
  const d = dot(a, b);
  if (d > 1 - 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let axis = cross(a, b);
  if (d < -1 + 1e-9) axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  axis = norm(axis);
  const h = Math.acos(Math.max(-1, Math.min(1, d))) / 2; const s = Math.sin(h);
  return rotOf([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]);
}

/** Rotation taking the resting body (left +x, back +y, up +z) to one that faces `fwd` with `up` above. */
function frameFwdUp(fwd, up) {
  const y = norm(mul(fwd, -1));
  let z = sub(up, mul(y, dot(up, y)));
  if (len(z) < 1e-5) z = sub([0, 0, 1], mul(y, y[2]));
  z = norm(z);
  return cols(cross(y, z), y, z);
}
/** The same from the line of the hips or shoulders (to her left) and the direction of the spine. */
function frameLeftUp(left, up) {
  const z = norm(up);
  const x = norm(sub(left, mul(z, dot(left, z))));
  return cols(x, cross(z, x), z);
}
/** Two bones from root to end with lengths a and b, bent towards `pole`: [joint, end pulled into reach]. */
function solve(root, end, a, b, pole) {
  const d = sub(end, root); let L = len(d);
  const u = L > 1e-8 ? mul(d, 1 / L) : [0, 0, -1];
  L = Math.max(Math.abs(a - b) + 1e-5, Math.min(a + b - 1e-5, L));
  const cosA = Math.max(-1, Math.min(1, (a * a + L * L - b * b) / (2 * a * L)));
  const h = a * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  let p = sub(sub(pole, root), mul(u, dot(sub(pole, root), u)));
  if (len(p) < 1e-6) p = sub([0, -1, 0], mul(u, u[1]));
  p = norm(p);
  return [add(add(root, mul(u, a * cosA)), mul(p, h)), add(root, mul(u, L))];
}

/* ------------------------------ Model ------------------------------ */

/**
 * The model from its two files: `doc` (trainer.json) and `buffer` (trainer.bin as ArrayBuffer).
 * Returns { bones, index, rest, local, hipMid, rig, meshes: [{ name, kind, texture, hsv, position, normal, uv, bone, weight, indices }] }.
 */
export function parseModel(doc, buffer) {
  const index = {};
  doc.bones.forEach((b, i) => { index[b.name] = i; });
  // Rest of every bone in the model's space: rotation and place.
  const rest = doc.bones.map((b) => ({ r: [b.rest[0], b.rest[1], b.rest[2], b.rest[4], b.rest[5], b.rest[6], b.rest[8], b.rest[9], b.rest[10]], t: [b.rest[12], b.rest[13], b.rest[14]] }));
  // … and relative to its parent.
  const local = doc.bones.map((b, i) => {
    if (b.parent < 0) return rest[i];
    const p = rest[b.parent]; const inv = tr(p.r);
    return { r: mm(inv, rest[i].r), t: mv(inv, sub(rest[i].t, p.t)) };
  });
  const meshes = doc.meshes.map((m) => ({
    name: m.name, kind: m.kind, texture: m.texture, hsv: m.hsv || null,
    position: new Float32Array(buffer, m.position, m.vertices * 3), normal: new Float32Array(buffer, m.normal, m.vertices * 3),
    uv: new Float32Array(buffer, m.uv, m.vertices * 2), bone: new Uint8Array(buffer, m.bone, m.vertices * 4),
    weight: new Uint8Array(buffer, m.weight, m.vertices * 4), indices: new Uint16Array(buffer, m.index, m.indices),
  }));
  return { bones: doc.bones, index, rest, local, hipMid: doc.hipMid, rig: doc.rig, meshes };
}

/** Stage space (body3d.js) → model space (metres): x_model = −z, y_model = −x, z_model = y. */
const toModel = (p, s) => [-p[2] * s, -p[0] * s, p[1] * s];

/**
 * The joints of a retargeted body (stage-rig.js, metres in stage axes) as the model's skeleton reads them.
 */
export function jointsForModel(r) {
  const B = (p) => toModel(p, 1);
  const out = { pelvis: B(r.pelvis), chest: B(r.chest), up: B(r.up), lat: B(r.lat), latSh: B(r.latSh), fwd: B(r.fwd), headUp: B(r.headUp), headFwd: B(r.headFwd), legs: {}, arms: {} };
  for (const side of ['r', 'l']) {
    const g = r.legs[side]; const a = r.arms[side];
    out.legs[side] = { hip: B(g.hip), knee: B(g.knee), ankle: B(g.ankle), foot: B(g.foot), on: g.on };
    out.arms[side] = { sh: B(a.sh), elbow: B(a.elbow), wrist: B(a.wrist), on: a.on };
  }
  return out;
}

/**
 * Poses the skeleton for joints in model space (`jointsForModel`). Returns the pose of every bone
 * [{ r (rotation), t (place of its head) }] in the model's space.
 */
export function poseSkeleton(model, f) {
  const { index, rest, local, bones, rig } = model;
  const pose = new Array(bones.length);
  const base = (i) => {
    const p = bones[i].parent;
    if (p < 0) return local[i];
    const P = pose[p]; const L = local[i];
    return { r: mm(P.r, L.r), t: add(mv(P.r, L.t), P.t) };
  };
  const place = (name, r, head = null) => { const i = index[name]; pose[i] = { r, t: head || base(i).t }; };
  const headOf = (name) => base(index[name]).t;
  /** The bone turned from where its parent carries it to `direction`, the shortest way. */
  const swing = (name, direction) => {
    const i = index[name]; const p = bones[i].parent;
    const carried = mm(mm(pose[p].r, tr(rest[p].r)), rest[i].r);
    return mm(arc(col(carried, 1), direction), carried);
  };
  const R = (name) => rest[index[name]].r;
  const neg = (v) => mul(v, -1);

  const pelvisR = frameLeftUp(neg(f.lat), f.up);
  const chestR = frameLeftUp(neg(f.latSh), f.up);
  place('Root', R('Root'));
  place('pelvis', mm(pelvisR, R('pelvis')), sub(f.pelvis, mv(pelvisR, sub(model.hipMid, rest[index.pelvis].t))));
  place('spine_01', mm(slerp(pelvisR, chestR, 0.3), R('spine_01')));
  place('spine_02', mm(slerp(pelvisR, chestR, 0.65), R('spine_02')));
  place('spine_03', mm(chestR, R('spine_03')));
  const headR = frameFwdUp(f.headFwd, f.headUp);
  place('neck_01', mm(slerp(chestR, headR, 0.5), R('neck_01')));
  place('head', mm(headR, R('head')));

  for (const s of ['l', 'r']) {
    const g = f.legs[s]; const a = f.arms[s];
    // Leg: from where the hip really is to the ankle it was given, bent towards the knee it was given.
    const hip = headOf(`thigh_${s}`);
    const [knee, ankle] = solve(hip, g.ankle, rig.thigh, rig.calf, g.knee);
    place(`thigh_${s}`, swing(`thigh_${s}`, sub(knee, hip)));
    place(`calf_${s}`, swing(`calf_${s}`, sub(ankle, knee)));
    const shin = norm(sub(knee, ankle));
    let footUp = sub(shin, mul(g.foot, dot(shin, g.foot)));
    if (len(footUp) < 0.2) footUp = [0, 0, 1];
    const footR = frameFwdUp(g.foot, footUp);
    place(`foot_${s}`, mm(footR, R(`foot_${s}`)));
    // On tiptoe the toes stay flat on the floor.
    const flat = [g.foot[0], g.foot[1], 0];
    const tip = Math.max(0, Math.min(1, (-g.foot[2] - 0.25) / 0.35)) * g.on;
    place(`ball_${s}`, mm(slerp(footR, frameFwdUp(len(flat) > 0.1 ? flat : g.foot, [0, 0, 1]), tip), R(`ball_${s}`)));

    place(`clavicle_${s}`, mm(chestR, R(`clavicle_${s}`)));
    const sh = headOf(`upperarm_${s}`);
    const [elbow, wrist] = solve(sh, a.wrist, rig.upper, rig.lower, a.elbow);
    place(`upperarm_${s}`, swing(`upperarm_${s}`, sub(elbow, sh)));
    place(`lowerarm_${s}`, swing(`lowerarm_${s}`, sub(wrist, elbow)));
    // Hand: with the forearm; carrying, flat on the floor with the fingers towards the head.
    const lower = index[`lowerarm_${s}`];
    const carried = mm(mm(pose[lower].r, tr(rest[lower].r)), R(`hand_${s}`));
    let along = [f.up[0], f.up[1], 0];
    if (len(along) < 0.2) along = [f.fwd[0], f.fwd[1], 0];
    along = norm(along);
    const down = [0, 0, -1];
    place(`hand_${s}`, slerp(carried, cols(cross(along, down), along, down), a.on));
  }
  return pose;
}

/**
 * The matrices that carry every vertex from its rest place to the pose (pose · rest⁻¹), as 4×4 columns in one
 * Float32Array – what the skinning shader takes.
 */
export function skinMatrices(model, pose, out = new Float32Array(model.bones.length * 16)) {
  for (let i = 0; i < pose.length; i++) {
    const r = mm(pose[i].r, tr(model.rest[i].r));
    const t = sub(pose[i].t, mv(r, model.rest[i].t));
    const o = i * 16;
    out[o] = r[0]; out[o + 1] = r[1]; out[o + 2] = r[2]; out[o + 3] = 0;
    out[o + 4] = r[3]; out[o + 5] = r[4]; out[o + 6] = r[5]; out[o + 7] = 0;
    out[o + 8] = r[6]; out[o + 9] = r[7]; out[o + 10] = r[8]; out[o + 11] = 0;
    out[o + 12] = t[0]; out[o + 13] = t[1]; out[o + 14] = t[2]; out[o + 15] = 1;
  }
  return out;
}

/** Where a vertex of a mesh is in the pose (what the shader computes; for checks). */
export function skinnedVertex(mesh, matrices, vi) {
  const p = [mesh.position[vi * 3], mesh.position[vi * 3 + 1], mesh.position[vi * 3 + 2]];
  const out = [0, 0, 0];
  for (let j = 0; j < 4; j++) {
    const w = mesh.weight[vi * 4 + j] / 255;
    if (!w) continue;
    const o = mesh.bone[vi * 4 + j] * 16;
    for (let k = 0; k < 3; k++) out[k] += w * (matrices[o + k] * p[0] + matrices[o + 4 + k] * p[1] + matrices[o + 8 + k] * p[2] + matrices[o + 12 + k]);
  }
  return out;
}

/** How large the model is in stage units: metres → the units of motion-rig.js (by the height of the hips). */
export const stageScale = (model) => (BODY.thigh + BODY.shin + BODY.ankle) / model.rig.hip;

/**
 * Model space → stage space as a 4×4 (columns): x_stage = −y_model, y_stage = z_model, z_stage = −x_model, scaled.
 */
export function modelToStage(model) {
  const k = stageScale(model);
  return new Float32Array([0, 0, -k, 0, -k, 0, 0, 0, 0, k, 0, 0, 0, 0, 0, 1]);
}

/* ------------------------------ Loading ------------------------------ */

let loading = null;

/**
 * Loads the model and its textures once (the files are small, but they are files: call it when the session's
 * overview opens, so that the stage has them when it starts). Resolves to { model, images: { file name → image } }.
 */
export function loadTrainer(base = './assets/trainer/') {
  if (!loading) {
    loading = (async () => {
      const get = async (name) => { const r = await fetch(`${base}${name}`); if (!r.ok) throw new Error(`${name}: ${r.status}`); return r; };
      const doc = await (await get('trainer.json')).json();
      const model = parseModel(doc, await (await get('trainer.bin')).arrayBuffer());
      const images = {};
      await Promise.all([...new Set(model.meshes.map((m) => m.texture))].map((name) => new Promise((done, fail) => {
        const img = new Image();
        img.onload = () => { images[name] = img; done(); };
        img.onerror = () => fail(new Error(`texture ${name}`));
        img.src = `${base}${name}`;
      })));
      return { model, images };
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}
