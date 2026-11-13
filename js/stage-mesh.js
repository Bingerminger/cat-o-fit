/* =========================================================================
   stage-mesh.js — the trainer (and the cat) as a surface in space: turns a body
   (body3d.js) into triangles for the 3D stage (stage-gl.js). Pure arithmetic into
   typed arrays, no DOM, no WebGL – rebuilt every frame (a few thousand vertices).

   The body is one continuous form, not a jointed doll: every limb is a tube lofted
   along root → joint → end with a rounded bend and the radii of muscle bellies,
   the torso a loft along the spine with a width and a front/back depth per height
   (waist, chest, glutes), the head an ellipsoid with hair, ears and a small face.
   Clothing is colour: leggings to above the ankle and a top, or shorts and a shirt.

   Vertex layout (STRIDE floats): position 3, normal 3, colour 3, glow 1 – `glow`
   marks the muscles an exercise works (they light up in the stage).
   ========================================================================= */

import { BODY } from './motion-rig.js';
import { vec as V } from './body3d.js';

export const STRIDE = 10;

/** A growing vertex/index store, reset per frame. */
export function createMesh(maxVerts = 9000, maxIndex = 48000) {
  return { v: new Float32Array(maxVerts * STRIDE), i: new Uint16Array(maxIndex), nv: 0, ni: 0, reset() { this.nv = 0; this.ni = 0; } };
}

function vert(M, p, n, c, glow) {
  const o = M.nv * STRIDE; const v = M.v;
  v[o] = p[0]; v[o + 1] = p[1]; v[o + 2] = p[2];
  v[o + 3] = n[0]; v[o + 4] = n[1]; v[o + 5] = n[2];
  v[o + 6] = c[0]; v[o + 7] = c[1]; v[o + 8] = c[2];
  v[o + 9] = glow;
  return M.nv++;
}
function tri(M, a, b, c) { const i = M.i; i[M.ni++] = a; i[M.ni++] = b; i[M.ni++] = c; }

/** A vector at right angles to `t`, as close to `ref` as possible. */
function sideOf(t, ref) {
  let n = V.sub(ref, V.mul(t, V.dot(ref, t)));
  if (V.len(n) < 1e-3) n = Math.abs(t[1]) < 0.9 ? V.cross(t, [0, 1, 0]) : [1, 0, 0];
  return V.norm(n);
}

/**
 * Loft through rings. Each ring: { p, n, b, a, bp, bm, c, g } – centre, the two axes across (unit),
 * half-size along n, along +b and along −b, colour, glow. `capA`/`capB` close the ends.
 */
function loft(M, rings, sides, capA = true, capB = true) {
  const start = M.nv;
  const R = rings.length;
  const P = new Float32Array(R * sides * 3);
  for (let k = 0; k < R; k++) {
    const r = rings[k];
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2;
      const u = Math.cos(th) * r.a; const w = Math.sin(th) * (Math.sin(th) >= 0 ? r.bp : r.bm);
      const o = (k * sides + s) * 3;
      P[o] = r.p[0] + r.n[0] * u + r.b[0] * w; P[o + 1] = r.p[1] + r.n[1] * u + r.b[1] * w; P[o + 2] = r.p[2] + r.n[2] * u + r.b[2] * w;
    }
  }
  // Normals from the surface itself (around × along), so that domes and tapers catch the light as what they are.
  const p = [0, 0, 0]; const nr = [0, 0, 0];
  const far = (k, dir) => {
    // The next ring in a direction that is not at the same place (hems are two rings in one spot).
    let j = k + dir;
    while (j > 0 && j < R - 1 && V.dist(rings[j].p, rings[k].p) < 1e-4 && Math.abs(rings[j].a - rings[k].a) < 0.5) j += dir;
    return Math.min(R - 1, Math.max(0, j));
  };
  for (let k = 0; k < R; k++) {
    const r = rings[k];
    const ka = far(k, -1); const kb = far(k, 1);
    for (let s = 0; s < sides; s++) {
      const o = (k * sides + s) * 3;
      const oa = (k * sides + ((s + sides - 1) % sides)) * 3; const ob = (k * sides + ((s + 1) % sides)) * 3;
      const oc = (ka * sides + s) * 3; const od = (kb * sides + s) * 3;
      const ax = P[ob] - P[oa]; const ay = P[ob + 1] - P[oa + 1]; const az = P[ob + 2] - P[oa + 2];
      const bx = P[od] - P[oc]; const by = P[od + 1] - P[oc + 1]; const bz = P[od + 2] - P[oc + 2];
      let nx = ay * bz - az * by; let ny = az * bx - ax * bz; let nz = ax * by - ay * bx;
      p[0] = P[o]; p[1] = P[o + 1]; p[2] = P[o + 2];
      const ox = p[0] - r.p[0]; const oy = p[1] - r.p[1]; const oz = p[2] - r.p[2];
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-6) { nx = ox; ny = oy; nz = oz; l = Math.hypot(nx, ny, nz) || 1; }
      const sign = nx * ox + ny * oy + nz * oz < 0 ? -1 : 1;
      nr[0] = sign * nx / l; nr[1] = sign * ny / l; nr[2] = sign * nz / l;
      vert(M, p, nr, r.c, r.g || 0);
    }
  }
  for (let k = 0; k + 1 < R; k++) {
    for (let s = 0; s < sides; s++) {
      const a = start + k * sides + s; const b = start + k * sides + ((s + 1) % sides);
      const c = a + sides; const d = b + sides;
      tri(M, a, c, b); tri(M, b, c, d);
    }
  }
  const cap = (r, base, dir, flip) => {
    const centre = vert(M, r.p, dir, r.c, r.g || 0);
    for (let s = 0; s < sides; s++) {
      const a = base + s; const b = base + ((s + 1) % sides);
      if (flip) tri(M, centre, b, a); else tri(M, centre, a, b);
    }
  };
  if (capA && R) cap(rings[0], start, V.norm(V.cross(rings[0].b, rings[0].n)), false);
  if (capB && R) cap(rings[R - 1], start + (R - 1) * sides, V.norm(V.cross(rings[R - 1].n, rings[R - 1].b)), true);
}

/** Ellipsoid with the half-axes ax, ay, az (vectors); `paint(dir)` may give a colour per direction (unit, in axis coordinates). */
function ellipsoid(M, c, ax, ay, az, col, glow = 0, rows = 7, cols = 10, paint = null, flatBelow = null, shape = null) {
  const start = M.nv;
  const lx = V.len(ax) || 1; const ly = V.len(ay) || 1; const lz = V.len(az) || 1;
  for (let r = 0; r <= rows; r++) {
    const ph = (r / rows) * Math.PI;
    const y = Math.cos(ph); const s = Math.sin(ph);
    for (let k = 0; k < cols; k++) {
      const th = (k / cols) * Math.PI * 2;
      const x = Math.cos(th) * s; const z = Math.sin(th) * s;
      const yy = flatBelow != null && y < flatBelow ? flatBelow : y;
      // `shape` may move a point of the unit sphere (a chin, a hairline) – the normal stays that of the ellipsoid.
      const q = shape ? shape(x, yy, z) : null;
      const px = q ? q[0] : x; const py = q ? q[1] : yy; const pz = q ? q[2] : z;
      const p = [c[0] + ax[0] * px + ay[0] * py + az[0] * pz, c[1] + ax[1] * px + ay[1] * py + az[1] * pz, c[2] + ax[2] * px + ay[2] * py + az[2] * pz];
      // Normal of an ellipsoid: direction scaled by the inverse squares of the half-axes.
      const n = V.norm([ax[0] * x / (lx * lx) + ay[0] * y / (ly * ly) + az[0] * z / (lz * lz), ax[1] * x / (lx * lx) + ay[1] * y / (ly * ly) + az[1] * z / (lz * lz), ax[2] * x / (lx * lx) + ay[2] * y / (ly * ly) + az[2] * z / (lz * lz)]);
      vert(M, p, flatBelow != null && y < flatBelow ? V.norm(V.mul(ay, -1)) : n, paint ? paint(x, yy, z) : col, glow);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const a = start + r * cols + k; const b = start + r * cols + ((k + 1) % cols);
      const d = a + cols; const e = b + cols;
      tri(M, a, b, d); tri(M, b, e, d);
    }
  }
}

/* ------------------------------ Looks ------------------------------ */

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255].map((x) => x ** 2.2);
const table = (rows) => (t) => {
  if (t <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    if (t <= rows[i][0]) { const [a, va] = rows[i - 1]; const [b, vb] = rows[i]; return va + (vb - va) * ((t - a) / (b - a)); }
  }
  return rows[rows.length - 1][1];
};

/** The two trainers. Colours in linear light; profiles in body units along each part (0 … 1). */
export const TRAINERS = {
  f: {
    skin: rgb('#f0b996'), hair: rgb('#4a2b1e'), top: rgb('#ff6b5e'), legs: rgb('#2f3d7c'), shoe: rgb('#f4f5f8'), sole: rgb('#7a8594'), tie: rgb('#ffd166'),
    lip: rgb('#c9645b'), eye: rgb('#2b1d1a'), blush: rgb('#f39b88'),
    thigh: table([[0, 7.5], [0.3, 7.1], [0.75, 5.2], [1, 4.6]]), shin: table([[0, 4.5], [0.28, 5.0], [0.7, 3.3], [1, 2.6]]),
    upper: table([[0, 3.9], [0.35, 3.6], [1, 2.8]]), fore: table([[0, 2.8], [0.25, 3.0], [0.8, 2.2], [1, 2.0]]),
    width: table([[-0.14, 6], [-0.06, 12.6], [0.04, 14.3], [0.16, 13.4], [0.3, 10.8], [0.44, 9.3], [0.58, 9.9], [0.72, 11.3], [0.84, 12.3], [0.93, 13.0], [1, 13.2], [1.05, 9.6], [1.09, 4.0]]),
    front: table([[-0.14, 3.2], [-0.04, 6.2], [0.1, 6.6], [0.3, 5.8], [0.45, 5.4], [0.6, 6.3], [0.72, 7.8], [0.82, 7.1], [0.93, 5.6], [1, 4.6], [1.05, 3.6], [1.09, 3.0]]),
    back: table([[-0.14, 4.4], [-0.04, 8.4], [0.08, 8.7], [0.22, 6.7], [0.36, 5.4], [0.5, 5.6], [0.7, 6.4], [0.88, 6.6], [1, 5.2], [1.05, 4.0], [1.09, 3.2]]),
    // Clothes along the spine: leggings to `legTop`, a top from `topFrom` to `topTo`; skin between and above.
    legTop: 0.3, topFrom: 0.52, topTo: 0.94, legTo: 0.86, shorts: 0, sleeve: 0, neck: 3.0, plait: true, jaw: 1,
  },
  m: {
    skin: rgb('#e2a77f'), hair: rgb('#2c211c'), top: rgb('#2a9d8f'), legs: rgb('#39404f'), shoe: rgb('#f4f5f8'), sole: rgb('#6f7a88'), tie: rgb('#2a9d8f'),
    lip: rgb('#b8675a'), eye: rgb('#241a17'), blush: rgb('#dd9a7c'),
    thigh: table([[0, 7.6], [0.3, 7.4], [0.75, 5.6], [1, 5.0]]), shin: table([[0, 4.9], [0.28, 5.5], [0.7, 3.7], [1, 2.9]]),
    upper: table([[0, 4.8], [0.35, 4.5], [1, 3.4]]), fore: table([[0, 3.4], [0.25, 3.7], [0.8, 2.7], [1, 2.4]]),
    width: table([[-0.14, 6], [-0.06, 12.0], [0.04, 13.4], [0.16, 12.8], [0.3, 11.4], [0.44, 10.8], [0.58, 11.6], [0.72, 13.0], [0.84, 14.0], [0.93, 14.4], [1, 14.2], [1.05, 10.2], [1.09, 4.6]]),
    front: table([[-0.14, 3.2], [-0.04, 6.0], [0.1, 6.3], [0.3, 6.1], [0.45, 6.0], [0.6, 6.6], [0.75, 7.4], [0.86, 6.8], [0.93, 5.8], [1, 4.8], [1.05, 3.8], [1.09, 3.4]]),
    back: table([[-0.14, 4.2], [-0.04, 7.6], [0.08, 7.8], [0.22, 6.6], [0.36, 6.0], [0.5, 6.4], [0.7, 7.2], [0.88, 7.4], [1, 5.8], [1.05, 4.4], [1.09, 3.6]]),
    legTop: 0.2, topFrom: 0.2, topTo: 1.07, legTo: 0, shorts: 0.6, sleeve: 0.46, neck: 3.7, plait: false, jaw: 1.06,
  },
};

/* ------------------------------ Body ------------------------------ */

/** Rings of a limb root → joint → end with a rounded bend. `colour(part, s)` gives colour and glow per bone position. */
function limbRings(root, joint, end, r1, r2, ref, paint, cuts = [[], []]) {
  const u1 = V.norm(V.sub(joint, root)); const u2 = V.norm(V.sub(end, joint));
  const L1 = V.dist(root, joint); const L2 = V.dist(joint, end);
  const f = Math.min(6, L1 * 0.22, L2 * 0.22);
  const sA = 1 - f / L1; const sC = f / L2;
  const pts = [];
  // A round start: the shoulder and the top of the thigh are domes, not cut tubes.
  const r0 = r1(0);
  for (const [k, sc] of [[0.96, 0.28], [0.8, 0.6], [0.5, 0.87], [0.2, 0.98]]) pts.push({ p: V.sub(root, V.mul(u1, r0 * k)), tg: u1, part: 0, s: 0, r: r0 * sc });
  const along = (part, list, cut, lo, hi) => {
    const all = [...list.map((s) => [s, false]), ...cut.map((s) => [s, true])].filter(([s]) => s > lo && s < hi).sort((a, b) => a[0] - b[0]);
    for (const [s, isCut] of all) {
      const p = part === 0 ? V.add(root, V.mul(u1, L1 * s)) : V.add(joint, V.mul(u2, L2 * s));
      const tg = part === 0 ? u1 : u2;
      // A hem: the same place twice, once in each colour, so the edge is crisp.
      if (isCut) { pts.push({ p, tg, part, s: s - 1e-3 }); pts.push({ p, tg, part, s: s + 1e-3 }); } else pts.push({ p, tg, part, s });
    }
  };
  along(0, [0, 0.16, 0.34, 0.52, 0.68], cuts[0], -1, sA - 0.03);
  pts.push({ p: V.sub(joint, V.mul(u1, f)), tg: u1, part: 0, s: sA });
  // The bend: a short curve through the joint.
  let mid = V.add(u1, u2);
  mid = V.len(mid) < 0.05 ? sideOf(u1, ref) : V.norm(mid);
  pts.push({ p: V.add(V.mul(V.add(V.sub(joint, V.mul(u1, f)), V.add(joint, V.mul(u2, f))), 0.25), V.mul(joint, 0.5)), tg: mid, part: 0, s: 1, r: Math.max(r1(1), r2(0)) });
  pts.push({ p: V.add(joint, V.mul(u2, f)), tg: u2, part: 1, s: sC });
  along(1, [0.3, 0.5, 0.7, 0.86, 1], cuts[1], sC + 0.03, 1.001);
  const rings = [];
  let n = null;
  for (const pt of pts) {
    n = sideOf(pt.tg, n || ref);
    const bn = V.cross(pt.tg, n);
    const look = paint(pt.part, pt.s);
    const r = (pt.r != null ? pt.r : pt.part === 0 ? r1(pt.s) : r2(pt.s)) + (look.grow || 0);
    rings.push({ p: pt.p, n, b: bn, a: r, bp: r, bm: r, c: look.c, g: look.g });
  }
  return rings;
}

/** Point and tangent on the spine (quadratic curve pelvis → control → chest, extended straight beyond the ends). */
function spineAt(body, t) {
  const a = body.pelvis; const c = body.spine; const b = body.chest;
  const tt = Math.min(1, Math.max(0, t));
  const p = V.add(V.add(V.mul(a, (1 - tt) * (1 - tt)), V.mul(c, 2 * (1 - tt) * tt)), V.mul(b, tt * tt));
  const tg = V.norm(V.add(V.mul(V.sub(c, a), 2 * (1 - tt)), V.mul(V.sub(b, c), 2 * tt)));
  return { p: t === tt ? p : V.add(p, V.mul(tg, (t - tt) * BODY.torso)), tg };
}

const TORSO_T = [-0.14, -0.06, 0.04, 0.16, 0.3, 0.44, 0.58, 0.72, 0.84, 0.93, 1, 1.05, 1.09];

/**
 * The trainer for a body. `focus` (Set of 'thigh' | 'shin' | 'foot' | 'upper' | 'fore' | 'torso' | 'hip') glows;
 * `plait` are the points of the hair tail (stage state) or null; `fx`: { blink 0…1, breath −1…1 }.
 */
export function buildTrainer(M, body, look = 'f', focus = new Set(), plait = null, fx = {}) {
  const T = TRAINERS[look] || TRAINERS.f;
  const breath = 1 + 0.018 * (fx.breath || 0);
  const g = (key) => (focus.has(key) ? 1 : 0);

  // Legs: leggings to above the ankle, or shorts over the thigh.
  for (const side of ['r', 'l']) {
    const leg = body.legs[side];
    const paint = (part, s) => {
      if (part === 0) return T.shorts > 0 && s > T.shorts ? { c: T.skin, g: g('thigh') } : { c: T.legs, g: g('thigh'), grow: T.shorts > 0 ? 1.0 : 0 };
      return T.legTo > 0 && s < T.legTo ? { c: T.legs, g: g('shin'), grow: 0.2 } : { c: T.skin, g: T.legTo > 0 ? 0 : g('shin') };
    };
    loft(M, limbRings(leg.hip, leg.knee, leg.ankle, T.thigh, T.shin, body.lat, paint, [T.shorts > 0 ? [T.shorts] : [], T.legTo > 0 ? [T.legTo] : []]), 12, true, true);
    shoe(M, leg, T, g('foot'));
  }

  // Torso: loft along the spine; n = across the body, b = to its front.
  const cloth = (t) => (t < T.legTop ? T.legs : t >= T.topFrom && t <= T.topTo ? T.top : T.skin);
  const ringAt = (t, tc) => {
    const { p, tg } = spineAt(body, t);
    const k = Math.min(1, Math.max(0, t));
    const across = sideOf(tg, V.lerp(body.lat, body.latSh, k));
    let fwd = V.cross(tg, across);
    if (V.dot(fwd, body.fwd) < 0) fwd = V.mul(fwd, -1);
    const chest = t > 0.5 && t < 1 ? breath : 1;
    const c = cloth(tc);
    const grow = c === T.skin ? 0 : 0.3;
    const glow = t < 0.24 ? g('hip') : t < 0.72 ? g('torso') : 0;
    return { p, n: across, b: fwd, a: T.width(t) + grow, bp: T.front(t) * chest + grow, bm: T.back(t) + grow, c, g: glow };
  };
  const cuts = [T.legTop, T.topFrom, T.topTo].filter((t, i, all) => t > -0.1 && t < 1.08 && all.indexOf(t) === i);
  const rings = [];
  for (const t of [...TORSO_T, ...cuts].sort((a, b) => a - b)) {
    if (cuts.includes(t)) { rings.push(ringAt(t, t - 1e-3)); rings.push(ringAt(t, t + 1e-3)); } else rings.push(ringAt(t, t));
  }
  loft(M, rings, 16, true, true);

  // Arms.
  for (const side of ['r', 'l']) {
    const arm = body.arms[side];
    const paint = (part, s) => {
      if (part === 0 && T.sleeve > 0 && s < T.sleeve) return { c: T.top, g: g('upper'), grow: 0.9 };
      return { c: T.skin, g: part === 0 ? g('upper') : g('fore') };
    };
    loft(M, limbRings(arm.sh, arm.elbow, arm.wrist, T.upper, T.fore, body.fwd, paint, [T.sleeve > 0 ? [T.sleeve] : [], []]), 12, true, true);
    hand(M, body, arm, T);
  }

  head(M, body, T, plait, fx);
}

function shoe(M, leg, T, glow) {
  const fd = V.norm(V.sub(leg.toe, leg.heel));
  const shin = V.norm(V.sub(leg.knee, leg.ankle));
  let up = V.sub(shin, V.mul(fd, V.dot(shin, fd)));
  up = V.len(up) < 0.2 ? sideOf(fd, [0, 1, 0]) : V.norm(up);
  const side = V.cross(fd, up);
  const L = V.dist(leg.heel, leg.toe);
  const c = V.add(V.lerp(leg.heel, leg.toe, 0.5), V.mul(up, -0.6));
  // The foot line runs at ankle height: the sole lies BODY.ankle below it.
  ellipsoid(M, c, V.mul(fd, L / 2 + 1.6), V.mul(up, 4.4), V.mul(side, 3.6), T.shoe, glow, 7, 10, (x, y) => (y < -0.62 ? T.sole : T.shoe), -0.78);
}

function hand(M, body, arm, T) {
  const d0 = V.norm(V.sub(arm.wrist, arm.elbow));
  // A hand that carries the body lies flat on the floor, fingers along the body.
  const planted = Math.min(1, Math.max(0, (9 - arm.wrist[1]) / 4)) * Math.min(1, Math.max(0, (-d0[1] - 0.45) / 0.35));
  const along = V.norm([body.up[0], 0, body.up[2]].every((x) => Math.abs(x) < 0.2) ? [body.fwd[0], 0, body.fwd[2]] : [body.up[0], 0, body.up[2]]);
  const d = V.norm(V.lerp(d0, along, planted));
  const side = sideOf(d, V.lerp(body.fwd, body.lat, 0.5 + 0.5 * planted));
  const thick = V.cross(d, side);
  ellipsoid(M, V.add(arm.wrist, V.mul(d, 3.4 - 1.6 * planted)), V.mul(d, 4.6), V.mul(side, 2.8), V.mul(thick, 1.7), T.skin, 0, 5, 8);
}

function head(M, body, T, plait, fx) {
  const r = BODY.head;
  const up = body.headUp;
  let fwd = V.sub(body.headFwd, V.mul(up, V.dot(body.headFwd, up)));
  fwd = V.len(fwd) < 0.1 ? sideOf(up, body.fwd) : V.norm(fwd);
  const side = V.cross(up, fwd);
  const H = body.head;
  // Neck.
  const nb = V.add(body.chest, V.mul(up, 1.5)); const nt = V.add(H, V.mul(up, -r * 0.55));
  const nn = sideOf(V.norm(V.sub(nt, nb)), side); const nbv = V.cross(V.norm(V.sub(nt, nb)), nn);
  loft(M, [{ p: nb, n: nn, b: nbv, a: T.neck + 0.7, bp: T.neck + 0.7, bm: T.neck + 0.7, c: T.skin }, { p: nt, n: nn, b: nbv, a: T.neck, bp: T.neck, bm: T.neck, c: T.skin }], 10, false, false);
  // Head coordinates: f to the face, u up, s to the side – in head radii.
  const at = (f, u, s) => [H[0] + (fwd[0] * f + up[0] * u + side[0] * s) * r, H[1] + (fwd[1] * f + up[1] * u + side[1] * s) * r, H[2] + (fwd[2] * f + up[2] * u + side[2] * s) * r];
  const S = (k) => V.mul(side, k); const U = (k) => V.mul(up, k); const F = (k) => V.mul(fwd, k);
  // Skull: cheeks, a narrower jaw, the chin a little forward.
  const jaw = (x, y, z) => {
    if (y >= 0) return [x, y, z];
    const d = -y;
    return [x * (1 - 0.3 * d ** 1.7) * (y < -0.5 ? T.jaw : 1), y, z * (1 - 0.1 * d * d) + 0.07 * d];
  };
  ellipsoid(M, at(0, 0, 0), S(r * 0.86), U(r), F(r * 0.92), T.skin, 0, 11, 14, null, null, jaw);
  // Hair: a shell around the skull that dives under the skin at the hairline.
  const hairline = (x, y, z) => {
    const face = z > 0.2 && y < 0.56 - 0.42 * Math.abs(x);
    const under = (y < -0.34 && z > -0.42) || y < -0.78;
    return face || under ? [x * 0.72, y * 0.72, z * 0.72] : [x, y, z];
  };
  ellipsoid(M, at(-0.05, 0.04, 0), S(r * 0.93), U(r * 1.07), F(r * 0.99), T.hair, 0, 14, 18, null, null, hairline);
  // A fringe swept to one side.
  ellipsoid(M, at(0.56, 0.7, 0.16), V.add(S(r * 0.62), U(-r * 0.2)), V.add(U(r * 0.3), S(r * 0.1)), F(r * 0.42), T.hair, 0, 7, 12);
  // Ears.
  for (const s of [1, -1]) ellipsoid(M, at(-0.04, -0.1, s * 0.84), S(0.9), U(1.9), F(1.3), T.skin, 0, 4, 6);
  // Eyes with a light in them, brows, cheeks.
  const open = 1 - 0.9 * (fx.blink || 0);
  const white = [1, 1, 1];
  for (const s of [1, -1]) {
    ellipsoid(M, at(0.79, 0.07, s * 0.37), S(1.25), U(1.8 * open + 0.12), F(0.55), T.eye, 0, 5, 8);
    if (open > 0.5) ellipsoid(M, at(0.86, 0.17, s * 0.37 + 0.06), S(0.42), U(0.46), F(0.25), white, 0, 3, 6);
    ellipsoid(M, at(0.82, 0.4 + 0.03 * (fx.smile || 0), s * 0.39), V.add(S(1.55), U(-0.3 * s)), U(0.3), F(0.4), T.hair, 0, 3, 6);
    ellipsoid(M, at(0.7, -0.24, s * 0.55), S(1.5), U(1.0), F(0.45), T.blush, 0, 3, 6);
  }
  ellipsoid(M, at(0.9, -0.13, 0), S(0.7), U(0.7), F(0.75), T.skin, 0, 4, 6);
  // Mouth: an arc that smiles; it opens a little with the effort.
  const smile = fx.smile == null ? 0.6 : fx.smile; const gap = fx.mouth || 0;
  const lips = [];
  for (let i = 0; i <= 6; i++) {
    const k = i / 3 - 1;
    const p = at(0.765 - 0.07 * k * k, -0.5 + 0.13 * smile * k * k - 0.03 * gap, k * 0.3);
    const thick = (0.34 + 0.5 * gap) * (1 - 0.6 * k * k) + 0.08;
    lips.push({ p, n: fwd, b: up, a: 0.3, bp: thick, bm: thick, c: T.lip });
  }
  loft(M, lips, 6, true, true);
  // Hair tail with its tie.
  if (T.plait && plait && plait.length > 1) {
    ellipsoid(M, plait[0], S(2.4), U(2.4), F(2.4), T.tie, 0, 4, 6);
    const pr = [];
    const radii = [2.6, 3.7, 3.5, 2.7, 1.1];
    let n = null;
    for (let i = 0; i < plait.length; i++) {
      const tg = V.norm(V.sub(plait[Math.min(plait.length - 1, i + 1)], plait[Math.max(0, i - 1)]));
      n = sideOf(tg, n || side);
      const rr = radii[Math.min(radii.length - 1, i)];
      pr.push({ p: plait[i], n, b: V.cross(tg, n), a: rr, bp: rr, bm: rr, c: T.hair });
    }
    loft(M, pr, 8, true, true);
  }
}

/** Where the hair tail hangs from (back of the head, upper half). */
export function plaitAnchor(body) {
  const r = BODY.head; const up = body.headUp;
  let fwd = V.sub(body.headFwd, V.mul(up, V.dot(body.headFwd, up)));
  fwd = V.len(fwd) < 0.1 ? sideOf(up, body.fwd) : V.norm(fwd);
  return V.add(V.add(body.head, V.mul(fwd, -r * 0.92)), V.mul(up, r * 0.45));
}

/* ------------------------------ Cat ------------------------------ */

const CAT = { fur: rgb('#f2a65a'), dark: rgb('#c9772f'), belly: rgb('#fbe3c4'), eye: rgb('#2d2a26'), nose: rgb('#e9857a'), ear: rgb('#f7c6a8') };

/**
 * The cat that keeps the trainer company. `at` its place on the floor, `face` the direction it looks (unit, level),
 * `fx`: { tail −1…1 (swish), look [x,y,z] head turn target, sit 0…1 (1 sitting, 0 standing), hop height, stretch 0…1, blink, paw 0…1 }.
 */
export function buildCat(M, at, face, fx = {}) {
  const up = [0, 1, 0];
  const side = V.cross(up, face);
  const hop = fx.hop || 0; const sit = fx.sit == null ? 1 : fx.sit; const stretch = fx.stretch || 0;
  const P = (f, u, s) => [at[0] + face[0] * f + side[0] * s, at[1] + u + hop, at[2] + face[2] * f + side[2] * s];
  // Body: upright when sitting, long when stretching.
  const bodyUp = V.norm([face[0] * (0.25 + 0.9 * stretch), 0.95 * sit + 0.25, face[2] * (0.25 + 0.9 * stretch)]);
  const bodyC = P(-1 - 3 * stretch, 9 + 2 * sit - 3 * stretch, 0);
  const bSide = V.norm(V.cross(bodyUp, face).every((x) => Math.abs(x) < 1e-3) ? side : V.cross(bodyUp, V.cross(side, bodyUp)));
  const bFwd = V.cross(side, bodyUp);
  ellipsoid(M, bodyC, V.mul(side, 6.2), V.mul(bodyUp, 9.5 + 2 * stretch), V.mul(bFwd, 6.8), CAT.fur, 0, 7, 10, (x, y, z) => (z > 0.55 && y < 0.6 ? CAT.belly : CAT.fur));
  // Haunches and paws.
  for (const s of [1, -1]) {
    ellipsoid(M, P(-3.5, 4.4, s * 5), V.mul(side, 3.4), V.mul(up, 4.4), V.mul(face, 5.2), CAT.fur, 0, 5, 8);
    const lift = s > 0 ? (fx.paw || 0) : 0;
    ellipsoid(M, P(5.5 + 2 * stretch, 1.6 + 9 * lift, s * 2.6), V.mul(side, 1.8), V.mul(up, 1.6 + 2.2 * lift), V.mul(face, 2.6), CAT.belly, 0, 4, 6);
    ellipsoid(M, P(3.2 + 2 * stretch, 5 + 4 * lift, s * 2.6), V.mul(side, 1.7), V.mul(up, 4.6), V.mul(face, 1.9), CAT.fur, 0, 4, 6);
  }
  // Head: turns towards what it watches.
  const hc = V.add(bodyC, V.add(V.mul(bodyUp, 10.5 + 2 * stretch), V.mul(face, 2.2)));
  let hf = face;
  if (fx.look) { const d = V.sub(fx.look, hc); const flat = V.norm([d[0], d[1] * 0.5, d[2]]); hf = V.norm(V.lerp(face, flat, 0.7)); }
  const hs = V.norm(V.cross(up, hf)); const hu = V.cross(hf, hs);
  const H = (f, u, s) => [hc[0] + hf[0] * f + hu[0] * u + hs[0] * s, hc[1] + hf[1] * f + hu[1] * u + hs[1] * s, hc[2] + hf[2] * f + hu[2] * u + hs[2] * s];
  ellipsoid(M, hc, V.mul(hs, 6.4), V.mul(hu, 5.4), V.mul(hf, 5.6), CAT.fur, 0, 7, 10, (x, y, z) => (z > 0.45 && y < 0.1 ? CAT.belly : CAT.fur));
  for (const s of [1, -1]) {
    // Ears: small cones.
    const base = H(-0.6, 4.2, s * 3.6); const tip = H(-0.8, 9.4, s * 4.6);
    const tg = V.norm(V.sub(tip, base)); const en = sideOf(tg, hs); const eb = V.cross(tg, en);
    loft(M, [{ p: base, n: en, b: eb, a: 2.6, bp: 1.6, bm: 1.6, c: CAT.fur }, { p: V.lerp(base, tip, 0.6), n: en, b: eb, a: 1.5, bp: 1.0, bm: 1.0, c: CAT.ear }, { p: tip, n: en, b: eb, a: 0.2, bp: 0.2, bm: 0.2, c: CAT.dark }], 7, true, true);
    const open = 1 - 0.9 * (fx.blink || 0);
    ellipsoid(M, H(4.9, 0.9, s * 2.4), V.mul(hs, 1.15), V.mul(hu, 1.5 * open), V.mul(hf, 0.6), CAT.eye, 0, 4, 6);
  }
  ellipsoid(M, H(5.7, -0.9, 0), V.mul(hs, 0.9), V.mul(hu, 0.6), V.mul(hf, 0.6), CAT.nose, 0, 3, 6);
  // Tail: a curve that swishes.
  const sw = fx.tail || 0;
  const tail = [];
  let n = null;
  const pts = [P(-7, 3, 0), P(-12, 3.5, 4 * sw), P(-16, 7, 9 * sw), P(-17, 13, 12 * sw), P(-15, 18, 10 * sw)];
  for (let i = 0; i < pts.length; i++) {
    const tg = V.norm(V.sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    n = sideOf(tg, n || side);
    const rr = [2.0, 1.9, 1.7, 1.5, 1.2][i];
    tail.push({ p: pts[i], n, b: V.cross(tg, n), a: rr, bp: rr, bm: rr, c: i > 3 ? CAT.dark : CAT.fur });
  }
  loft(M, tail, 7, true, true);
}
