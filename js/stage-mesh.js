/* =========================================================================
   stage-mesh.js — the trainer (and the cat) as a surface in space: turns a body
   (body3d.js) into triangles for the 3D stage (stage-gl.js). Pure arithmetic into
   typed arrays, no DOM, no WebGL – rebuilt every frame (a few thousand vertices).

   The body is an athlete's, not a doll's: every limb is lofted along root → joint →
   end with the cross-sections of its muscles (the front of a thigh is not its back,
   a calf sits behind the shin, a shoulder is a cap), the torso along the spine with
   a width, a front and a back per height (hips, waist, ribcage, shoulders), the
   head narrow with a face. Clothing is colour, with crisp hems.

   Vertex layout (STRIDE floats): position 3, normal 3, colour 3, the glow of the
   muscles an exercise works (0…1), and 1 for skin.
   ========================================================================= */

import { BODY } from './motion-rig.js';
import { vec as V } from './body3d.js';

export const STRIDE = 11;
/** Added to a glow value to mark skin (the stage lights skin differently from cloth); `vert()` splits the two again. */
const SKIN = 2;

/** A growing vertex/index store, reset per frame. */
export function createMesh(maxVerts = 12000, maxIndex = 66000) {
  return { v: new Float32Array(maxVerts * STRIDE), i: new Uint16Array(maxIndex), nv: 0, ni: 0, reset() { this.nv = 0; this.ni = 0; } };
}

function vert(M, p, n, c, glow) {
  const o = M.nv * STRIDE; const v = M.v;
  v[o] = p[0]; v[o + 1] = p[1]; v[o + 2] = p[2];
  v[o + 3] = n[0]; v[o + 4] = n[1]; v[o + 5] = n[2];
  v[o + 6] = c[0]; v[o + 7] = c[1]; v[o + 8] = c[2];
  const skin = glow >= 1.5 ? 1 : 0;
  v[o + 9] = glow - SKIN * skin; v[o + 10] = skin;
  return M.nv++;
}
function tri(M, a, b, c) { const i = M.i; i[M.ni++] = a; i[M.ni++] = b; i[M.ni++] = c; }

/** A vector at right angles to `t`, as close to `ref` as possible. */
function sideOf(t, ref) {
  let n = V.sub(ref, V.mul(t, V.dot(ref, t)));
  if (V.len(n) < 1e-3) n = Math.abs(t[1]) < 0.9 ? V.cross(t, [0, 1, 0]) : [1, 0, 0];
  return V.norm(n);
}
const dark = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Loft through rings. Each ring: { p, n, b, a, bp, bm, c, g, skin, e, cf, groove } – centre, the two axes across
 * (unit; b is the front), half-size along n, along +b and along −b, colour, glow, whether it is skin, the squareness
 * of the outline (2 = ellipse, more = boxier), a colour per place on the outline `cf(cos, sin)` (null keeps `c`;
 * such a colour counts as cloth), and a darker line down the front and the back `{ f, b }` (a spine, the middle of
 * a belly).
 */
function loft(M, rings, sides, capA = true, capB = true) {
  const start = M.nv;
  const R = rings.length;
  const P = new Float32Array(R * sides * 3);
  for (let k = 0; k < R; k++) {
    const r = rings[k];
    const pw = r.e ? 2 / r.e : 1;
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * Math.PI * 2;
      let cu = Math.cos(th); let sv = Math.sin(th);
      if (r.e) { cu = Math.sign(cu) * Math.abs(cu) ** pw; sv = Math.sign(sv) * Math.abs(sv) ** pw; }
      const u = cu * r.a; const w = sv * (sv >= 0 ? r.bp : r.bm);
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
  const front = sides / 4; const back = (sides * 3) / 4;
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
      let c = r.c; let skin = r.skin ? SKIN : 0;
      if (r.cf) { const th = (s / sides) * Math.PI * 2; const over = r.cf(Math.cos(th), Math.sin(th)); if (over) { c = over; skin = 0; } }
      if (r.groove) {
        const g = s === front ? r.groove.f : s === back ? r.groove.b : 0;
        if (g) c = dark(c, 1 - g);
      }
      vert(M, p, nr, c, (r.g || 0) + skin);
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
    const centre = vert(M, r.p, dir, r.c, (r.g || 0) + (r.skin ? SKIN : 0));
    for (let s = 0; s < sides; s++) {
      const a = base + s; const b = base + ((s + 1) % sides);
      if (flip) tri(M, centre, b, a); else tri(M, centre, a, b);
    }
  };
  if (capA && R) cap(rings[0], start, V.norm(V.cross(rings[0].b, rings[0].n)), false);
  if (capB && R) cap(rings[R - 1], start + (R - 1) * sides, V.norm(V.cross(rings[R - 1].n, rings[R - 1].b)), true);
}

/**
 * Ellipsoid with the half-axes ax, ay, az (vectors). `glow` goes into the glow channel as it is (add SKIN for skin);
 * `paint(x, y, z)` may give a colour per direction; `flatBelow` cuts the underside flat; `shape(x, y, z)` may move a
 * point of the unit sphere (a chin, a hairline) – the normal stays that of the ellipsoid.
 */
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

/** A smooth curve through points [position, value] (a muscle has no corners). */
const curve = (rows) => (t) => {
  const n = rows.length;
  if (t <= rows[0][0]) return rows[0][1];
  if (t >= rows[n - 1][0]) return rows[n - 1][1];
  let i = 1;
  while (rows[i][0] < t) i++;
  const [x1, y1] = rows[i - 1]; const [x2, y2] = rows[i];
  const h = x2 - x1; const u = (t - x1) / h;
  const m1 = i >= 2 ? (y2 - rows[i - 2][1]) / (x2 - rows[i - 2][0]) : (y2 - y1) / h;
  const m2 = i + 1 < n ? (rows[i + 1][1] - y1) / (rows[i + 1][0] - x1) : (y2 - y1) / h;
  const u2 = u * u; const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y1 + (u3 - 2 * u2 + u) * h * m1 + (-2 * u3 + 3 * u2) * y2 + (u3 - u2) * h * m2;
};
/** The outline of a limb segment along its length: half width, front and back. */
const part = (w, f, b, k = 1) => {
  const cw = curve(w); const cf = curve(f); const cb = curve(b);
  return { w: (s) => cw(s) * k, f: (s) => cf(s) * k, b: (s) => cb(s) * k };
};

const LIMBS = {
  thigh: [[[0, 6.9], [0.2, 7.1], [0.5, 6.2], [0.8, 5.0], [1, 4.5]], [[0, 6.6], [0.25, 7.5], [0.55, 6.7], [0.85, 5.0], [1, 4.7]], [[0, 7.4], [0.2, 6.9], [0.5, 6.1], [0.85, 4.6], [1, 4.3]]],
  shin: [[[0, 4.5], [0.22, 4.9], [0.5, 4.0], [0.8, 2.9], [1, 2.6]], [[0, 4.6], [0.2, 4.0], [0.6, 3.2], [1, 2.6]], [[0, 4.2], [0.24, 5.8], [0.5, 4.7], [0.78, 3.0], [1, 2.7]]],
  upper: [[[0, 4.6], [0.16, 4.8], [0.42, 3.7], [0.8, 3.1], [1, 3.0]], [[0, 4.4], [0.2, 4.3], [0.5, 4.1], [0.8, 3.3], [1, 3.0]], [[0, 4.5], [0.3, 4.1], [0.7, 3.3], [1, 3.1]]],
  fore: [[[0, 3.1], [0.2, 3.5], [0.6, 2.7], [1, 2.3]], [[0, 3.0], [0.22, 3.2], [0.7, 2.3], [1, 1.8]], [[0, 3.1], [0.2, 3.2], [0.7, 2.3], [1, 1.8]]],
};

/** The two trainers. Colours in linear light; outlines in body units. */
export const TRAINERS = {
  f: {
    skin: rgb('#e8ac86'), hair: rgb('#3e2418'), top: rgb('#ff5d52'), legs: rgb('#27356f'), shoe: rgb('#f2f3f6'), sole: rgb('#ffffff'), accent: rgb('#ff5d52'), tie: rgb('#ffd166'),
    lip: rgb('#b9564f'), eye: rgb('#2a1c18'), iris: rgb('#6a4a2c'),
    thigh: part(...LIMBS.thigh), shin: part(...LIMBS.shin), upper: part(...LIMBS.upper), fore: part(...LIMBS.fore),
    width: curve([[-0.15, 5], [-0.08, 12.6], [0, 14.2], [0.1, 13.9], [0.2, 12.5], [0.32, 10.4], [0.44, 9.2], [0.56, 9.6], [0.68, 10.8], [0.8, 12.0], [0.9, 12.8], [0.97, 13.2], [1.02, 12.2], [1.06, 8.6], [1.1, 4.4]]),
    front: curve([[-0.15, 3], [-0.06, 5.8], [0.05, 6.4], [0.18, 6.0], [0.32, 5.3], [0.45, 5.1], [0.56, 5.6], [0.66, 6.8], [0.74, 7.4], [0.82, 6.9], [0.9, 5.7], [0.97, 4.8], [1.03, 4.0], [1.1, 3.2]]),
    back: curve([[-0.15, 4], [-0.06, 6.8], [0.04, 7.2], [0.14, 6.6], [0.26, 5.4], [0.38, 5.0], [0.5, 5.4], [0.64, 6.2], [0.8, 6.8], [0.92, 6.6], [1.0, 5.6], [1.05, 4.4], [1.1, 3.4]]),
    // Clothes along the spine: leggings to `legTop`, a top from `topFrom` to `topTo` (with straps above it); skin between.
    legTop: 0.3, topFrom: 0.6, topTo: 0.95, straps: true, legTo: 0.88, shorts: 0, sleeve: 0, neck: 3.5, plait: true, jaw: 1,
    glute: [5.4, 6.4, 5.0],
  },
  m: {
    skin: rgb('#dca27a'), hair: rgb('#2a1f1a'), top: rgb('#2a9d8f'), legs: rgb('#333a48'), shoe: rgb('#f2f3f6'), sole: rgb('#ffffff'), accent: rgb('#2a9d8f'), tie: rgb('#2a9d8f'),
    lip: rgb('#a8604f'), eye: rgb('#241a17'), iris: rgb('#4a3524'),
    thigh: part(...LIMBS.thigh, 1.07), shin: part(...LIMBS.shin, 1.1), upper: part(...LIMBS.upper, 1.26), fore: part(...LIMBS.fore, 1.2),
    width: curve([[-0.15, 5], [-0.08, 12.6], [0, 14.2], [0.1, 13.9], [0.2, 12.6], [0.32, 11.2], [0.44, 10.6], [0.56, 11.4], [0.68, 12.8], [0.8, 14.0], [0.9, 14.6], [0.97, 14.8], [1.02, 13.4], [1.06, 9.6], [1.1, 5.0]]),
    front: curve([[-0.15, 3], [-0.06, 5.6], [0.05, 6.0], [0.18, 6.0], [0.32, 5.8], [0.45, 5.8], [0.56, 6.2], [0.68, 7.0], [0.78, 7.2], [0.88, 6.4], [0.97, 5.2], [1.03, 4.2], [1.1, 3.6]]),
    back: curve([[-0.15, 4], [-0.06, 6.6], [0.04, 7.0], [0.14, 6.6], [0.26, 5.8], [0.38, 5.6], [0.5, 6.0], [0.64, 6.8], [0.8, 7.4], [0.92, 7.2], [1.0, 6.0], [1.05, 4.8], [1.1, 3.8]]),
    legTop: 0.2, topFrom: 0.2, topTo: 1.07, straps: false, legTo: 0, shorts: 0.6, sleeve: 0.46, neck: 4.3, plait: false, jaw: 1.1,
    glute: [5.0, 6.0, 4.4],
  },
};

/* ------------------------------ Body ------------------------------ */

/**
 * Rings of a limb root → joint → end with a rounded bend. `P1`/`P2` are the outlines of the two segments, `front` the
 * side its muscles face (unit), `paint(part, s)` gives { c, g, grow }, `cuts` the hems per segment.
 */
function limbRings(root, joint, end, P1, P2, front, paint, cuts, skin) {
  const u1 = V.norm(V.sub(joint, root)); const u2 = V.norm(V.sub(end, joint));
  const L1 = V.dist(root, joint); const L2 = V.dist(joint, end);
  const f = Math.min(6, L1 * 0.22, L2 * 0.22);
  const sA = 1 - f / L1; const sC = f / L2;
  const pts = [];
  // A round start: the shoulder and the top of the thigh are domes, not cut tubes.
  // (Flatter than a half ball: a shoulder is a cap, not an epaulette.)
  for (const [k, sc] of [[0.6, 0.08], [0.57, 0.3], [0.48, 0.6], [0.31, 0.87], [0.13, 0.98]]) pts.push({ p: V.sub(root, V.mul(u1, P1.w(0) * k)), tg: u1, part: 0, s: 0, sc });
  const along = (seg, list, cut, lo, hi) => {
    const all = [...list.map((s) => [s, false]), ...cut.map((s) => [s, true])].filter(([s]) => s > lo && s < hi).sort((a, b) => a[0] - b[0]);
    for (const [s, isCut] of all) {
      const p = seg === 0 ? V.add(root, V.mul(u1, L1 * s)) : V.add(joint, V.mul(u2, L2 * s));
      const tg = seg === 0 ? u1 : u2;
      // A hem: the same place twice, once in each colour, so the edge is crisp.
      if (isCut) { pts.push({ p, tg, part: seg, s: s - 1e-3 }); pts.push({ p, tg, part: seg, s: s + 1e-3 }); } else pts.push({ p, tg, part: seg, s });
    }
  };
  along(0, [0, 0.09, 0.19, 0.3, 0.42, 0.54, 0.66, 0.76], cuts[0], -1, sA - 0.03);
  pts.push({ p: V.sub(joint, V.mul(u1, f)), tg: u1, part: 0, s: sA });
  // The bend: a short curve through the joint.
  let mid = V.add(u1, u2);
  mid = V.len(mid) < 0.05 ? sideOf(u1, front) : V.norm(mid);
  pts.push({ p: V.add(V.mul(V.add(V.sub(joint, V.mul(u1, f)), V.add(joint, V.mul(u2, f))), 0.25), V.mul(joint, 0.5)), tg: mid, part: 0, s: 1 });
  pts.push({ p: V.add(joint, V.mul(u2, f)), tg: u2, part: 1, s: sC });
  along(1, [0.24, 0.34, 0.45, 0.56, 0.67, 0.78, 0.9, 1], cuts[1], sC + 0.03, 1.001);
  const rings = [];
  for (const pt of pts) {
    const b = sideOf(pt.tg, front);
    const n = V.cross(pt.tg, b);
    const look = paint(pt.part, pt.s);
    const P = pt.part === 0 ? P1 : P2;
    const k = pt.sc || 1; const grow = look.grow || 0;
    rings.push({ p: pt.p, n, b, a: P.w(pt.s) * k + grow, bp: P.f(pt.s) * k + grow, bm: P.b(pt.s) * k + grow, c: look.c, g: look.g, skin: look.c === skin });
  }
  return rings;
}

/** The side a bent limb's joint points to (or, with sign −1, its opposite), blended into `rest` where the limb is straight. */
function bendSide(root, joint, end, rest, sign = 1) {
  const u = V.norm(V.sub(end, root));
  const d = V.sub(V.sub(joint, root), V.mul(u, V.dot(V.sub(joint, root), u)));
  const w = Math.min(1, V.len(d) / 7);
  let r = V.sub(rest, V.mul(u, V.dot(rest, u)));
  r = V.len(r) < 0.2 ? sideOf(u, [0, 1, 0]) : V.norm(r);
  const out = V.add(V.mul(V.len(d) > 1e-6 ? V.mul(V.norm(d), sign) : r, w), V.mul(r, 1 - w));
  return V.len(out) < 0.1 ? r : V.norm(out);
}

/** Point and tangent on the spine (quadratic curve pelvis → control → chest, extended straight beyond the ends). */
function spineAt(body, t) {
  const a = body.pelvis; const c = body.spine; const b = body.chest;
  const tt = Math.min(1, Math.max(0, t));
  const p = V.add(V.add(V.mul(a, (1 - tt) * (1 - tt)), V.mul(c, 2 * (1 - tt) * tt)), V.mul(b, tt * tt));
  const tg = V.norm(V.add(V.mul(V.sub(c, a), 2 * (1 - tt)), V.mul(V.sub(b, c), 2 * tt)));
  return { p: t === tt ? p : V.add(p, V.mul(tg, (t - tt) * BODY.torso)), tg };
}

const TORSO_T = [-0.15, -0.1, -0.04, 0.03, 0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.89, 0.95, 1.0, 1.04, 1.075, 1.1];

/**
 * The trainer for a body. `focus` (Set of 'thigh' | 'shin' | 'foot' | 'upper' | 'fore' | 'torso' | 'hip') glows;
 * `plait` are the points of the hair tail (stage state) or null; `fx`: { blink 0…1, breath −1…1, smile 0…1, mouth 0…1 }.
 */
export function buildTrainer(M, body, look = 'f', focus = new Set(), plait = null, fx = {}) {
  const T = TRAINERS[look] || TRAINERS.f;
  const breath = 1 + 0.02 * (fx.breath || 0);
  const g = (key) => (focus.has(key) ? 1 : 0);

  // Legs: leggings to above the ankle, or shorts over the thigh. The front of a leg is where its knee points.
  for (const side of ['r', 'l']) {
    const leg = body.legs[side];
    const front = bendSide(leg.hip, leg.knee, leg.ankle, body.fwd, 1);
    const paint = (seg, s) => {
      if (seg === 0) return T.shorts > 0 && s > T.shorts ? { c: T.skin, g: g('thigh') } : { c: T.legs, g: g('thigh'), grow: T.shorts > 0 ? 1.0 : 0.1 };
      return T.legTo > 0 && s < T.legTo ? { c: T.legs, g: g('shin'), grow: 0.15 } : { c: T.skin, g: T.legTo > 0 ? 0 : g('shin') };
    };
    loft(M, limbRings(leg.hip, leg.knee, leg.ankle, T.thigh, T.shin, front, paint, [T.shorts > 0 ? [T.shorts] : [], T.legTo > 0 ? [T.legTo] : []], T.skin), 16, true, true);
    shoe(M, leg, T, g('foot'));
  }

  // Torso: loft along the spine; n = across the body, b = to its front.
  const cloth = (t) => (t < T.legTop ? T.legs : t >= T.topFrom && t <= T.topTo ? T.top : T.skin);
  const frame = (t) => {
    const { p, tg } = spineAt(body, t);
    const across = sideOf(tg, V.lerp(body.lat, body.latSh, Math.min(1, Math.max(0, t))));
    let fwd = V.cross(tg, across);
    if (V.dot(fwd, body.fwd) < 0) fwd = V.mul(fwd, -1);
    return { p, tg, across, fwd };
  };
  const ringAt = (t, tc) => {
    const { p, across, fwd } = frame(t);
    const chest = t > 0.5 && t < 1 ? breath : 1;
    const c = cloth(tc);
    const bare = c === T.skin;
    const grow = bare ? 0 : 0.25;
    const glow = t < 0.24 ? g('hip') : t < 0.72 ? g('torso') : 0;
    const ring = { p, n: across, b: fwd, a: T.width(t) + grow, bp: T.front(t) * chest + grow, bm: T.back(t) + grow, c, g: glow, skin: bare, e: t > 0.2 && t < 1.03 ? 2.45 : 2.15 };
    // The line of the spine down the back, the middle of the belly down the front.
    if (t > 0.22 && t < 1) ring.groove = { f: bare && t < 0.62 ? 0.1 : 0, b: bare ? 0.16 : 0.07 };
    return ring;
  };
  const cuts = [T.legTop, T.topFrom, T.topTo].filter((t, i, all) => t > -0.1 && t < 1.08 && all.indexOf(t) === i);
  const rings = [];
  for (const t of [...TORSO_T, ...cuts].sort((a, b) => a - b)) {
    if (cuts.includes(t)) { rings.push(ringAt(t, t - 1e-3)); rings.push(ringAt(t, t + 1e-3)); } else rings.push(ringAt(t, t));
  }
  loft(M, rings, 24, true, true);
  // Straps: bands that lie on the body, from the top over the shoulder to the back.
  if (T.straps) {
    const X = 6.3;   // how far from the middle a strap runs
    /** The place on the body at height t, X to the side, on its front (+1) or back (−1); 0 = where the body is just X wide. */
    const onBody = (t, s, face) => {
      const { p, across, fwd } = frame(t);
      const e = t > 0.2 && t < 1.03 ? 2.45 : 2.15;
      const k = Math.min(1, X / (T.width(t) + 0.3));
      const deep = (face > 0 ? T.front(t) * breath : T.back(t)) + 0.3;
      return { on: V.add(V.add(p, V.mul(across, s * X)), V.mul(fwd, face * deep * (1 - k ** e) ** (1 / e))), core: V.add(p, V.mul(across, s * X * 0.55)) };
    };
    let top = 1.03;
    while (top < 1.1 && T.width(top) + 0.3 > X) top += 0.004;
    for (const s of [1, -1]) {
      const way = [[T.topTo - 0.03, 1], [0.985, 1], [1.02, 1], [top - 0.012, 1], [top, 0], [top - 0.012, -1], [1.02, -1], [0.985, -1], [T.topTo - 0.03, -1]].map(([t, face]) => onBody(t, s, face));
      const band = way.map((w, i) => {
        const tg = V.norm(V.sub(way[Math.min(way.length - 1, i + 1)].on, way[Math.max(0, i - 1)].on));
        const outw = sideOf(tg, V.sub(w.on, w.core));
        return { p: w.on, n: V.cross(tg, outw), b: outw, a: 1.2, bp: 0.28, bm: 0.28, c: T.top };
      });
      loft(M, band, 8, true, true);
    }
  }
  // What a tube cannot be: the two rounds of the seat.
  const seat = frame(0.02);
  for (const s of [1, -1]) {
    ellipsoid(M, V.add(V.add(seat.p, V.mul(seat.across, s * 4.9)), V.add(V.mul(seat.fwd, -3.4), V.mul(seat.tg, -1.2))), V.mul(seat.across, T.glute[0]), V.mul(seat.tg, T.glute[1]), V.mul(seat.fwd, T.glute[2]), cloth(0.02), g('hip'), 7, 10);
  }

  // Arms: the cap of the shoulder is the round start of the arm; its front is opposite the elbow.
  for (const side of ['r', 'l']) {
    const arm = body.arms[side];
    const front = bendSide(arm.sh, arm.elbow, arm.wrist, body.fwd, -1);
    const sleeve = T.sleeve > 0;
    const paint = (seg, s) => {
      if (seg === 0 && sleeve && s < T.sleeve) return { c: T.top, g: g('upper'), grow: 0.9 };
      return { c: T.skin, g: seg === 0 ? g('upper') : g('fore') };
    };
    loft(M, limbRings(arm.sh, arm.elbow, arm.wrist, T.upper, T.fore, front, paint, [sleeve ? [T.sleeve] : [], []], T.skin), 12, true, true);
    hand(M, body, arm, T);
  }

  head(M, body, T, plait, fx);
}

/** A training shoe: a flat sole, a low toe, a collar round the ankle, a stripe in the colour of the top. */
function shoe(M, leg, T, glow) {
  const fd = V.norm(V.sub(leg.toe, leg.heel));
  const shin = V.norm(V.sub(leg.knee, leg.ankle));
  let up = V.sub(shin, V.mul(fd, V.dot(shin, fd)));
  up = V.len(up) < 0.2 ? sideOf(fd, [0, 1, 0]) : V.norm(up);
  const side = V.cross(fd, up);
  const L = V.dist(leg.heel, leg.toe) + 3.4;
  const from = V.add(leg.heel, V.mul(fd, -1.7));
  // The foot line runs at ankle height: the sole lies BODY.ankle below it. Along the shoe: half width, top over the line.
  const rows = [[0, 1.5, -1.2], [0.05, 2.6, 1.3], [0.2, 3.0, 2.2], [0.36, 3.2, 1.4], [0.55, 3.6, 0.2], [0.75, 3.7, -0.9], [0.9, 3.2, -1.7], [1, 1.9, -2.5]];
  const sole = (cu, sv) => (sv < -0.5 ? T.sole : null);
  const rings = rows.map(([k, w, top], i) => ({
    p: V.add(V.add(from, V.mul(fd, L * k)), V.mul(up, -(BODY.ankle - 1.5))), n: side, b: up, a: w, bp: top + BODY.ankle - 1.5, bm: 1.5,
    c: i === 3 || i === 4 ? T.accent : T.shoe, g: glow, e: 2.5, cf: sole,
  }));
  loft(M, rings, 12, true, true);
}

/** A hand: palm, fingers and a thumb. One that carries the body lies flat on the floor, fingers along the body. */
function hand(M, body, arm, T) {
  const d0 = V.norm(V.sub(arm.wrist, arm.elbow));
  const planted = Math.min(1, Math.max(0, (9 - arm.wrist[1]) / 4)) * Math.min(1, Math.max(0, (-d0[1] - 0.45) / 0.35));
  const flatUp = [body.up[0], 0, body.up[2]];
  const along = V.norm(V.len(flatUp) < 0.2 ? [body.fwd[0], 0, body.fwd[2]] : flatUp);
  const d = V.norm(V.lerp(d0, along, planted));
  // The back of the hand faces sideways when the arm hangs, up when the hand is planted.
  const thick = sideOf(d, V.lerp(body.lat, [0, 1, 0], planted));
  const side = V.cross(d, thick);
  const at = V.add(arm.wrist, V.mul(d, -1.6 * planted));
  ellipsoid(M, V.add(at, V.mul(d, 2.9)), V.mul(d, 3.3), V.mul(side, 2.7), V.mul(thick, 1.25), T.skin, SKIN, 5, 8);
  // Fingers, a little curled.
  const curl = V.norm(V.add(d, V.mul(side, 0)));
  ellipsoid(M, V.add(V.add(at, V.mul(d, 4.6)), V.mul(curl, 1.9)), V.mul(curl, 3.3), V.mul(side, 2.5), V.mul(thick, 1.05), T.skin, SKIN, 5, 8);
  // The thumb on the side that faces the front of the body.
  const ts = V.dot(side, body.fwd) >= 0 ? 1 : -1;
  const td = V.norm(V.add(d, V.mul(side, 0.75 * ts)));
  const tn = sideOf(td, thick);
  ellipsoid(M, V.add(V.add(at, V.mul(d, 2.9)), V.mul(side, 2.2 * ts)), V.mul(td, 2.3), V.mul(tn, 0.95), V.mul(V.cross(td, tn), 0.9), T.skin, SKIN, 4, 6);
}

function head(M, body, T, plait, fx) {
  const r = BODY.head;
  const up = body.headUp;
  let fwd = V.sub(body.headFwd, V.mul(up, V.dot(body.headFwd, up)));
  fwd = V.len(fwd) < 0.1 ? sideOf(up, body.fwd) : V.norm(fwd);
  const side = V.cross(up, fwd);
  const H = body.head;
  const S = (k) => V.mul(side, k); const U = (k) => V.mul(up, k); const F = (k) => V.mul(fwd, k);
  // Head coordinates: f to the face, u up, s to the side – in head radii.
  const at = (f, u, s) => [H[0] + (fwd[0] * f + up[0] * u + side[0] * s) * r, H[1] + (fwd[1] * f + up[1] * u + side[1] * s) * r, H[2] + (fwd[2] * f + up[2] * u + side[2] * s) * r];
  const W = 0.7; const D = 0.86;   // a head is narrower than it is deep, and longer than both

  // Neck: from the slope of the shoulders into the skull.
  const nb = V.add(body.chest, V.mul(up, 0.6)); const nt = V.add(H, V.mul(up, -r * 0.5));
  const ntg = V.norm(V.sub(nt, nb)); const nfw = sideOf(ntg, fwd); const nsd = V.cross(ntg, nfw);
  loft(M, [[0, 1.5], [0.3, 1.08], [0.65, 1], [1, 0.98]].map(([k, sc]) => ({ p: V.lerp(nb, nt, k), n: nsd, b: nfw, a: T.neck * sc, bp: T.neck * sc * 0.92, bm: T.neck * sc, c: T.skin, skin: true })), 12, false, false);

  // Skull: cheekbones, a narrower jaw, the chin a little forward.
  const jaw = (x, y, z) => {
    if (y >= 0) return [x, y, z];
    const d = -y;
    return [x * (1 - 0.34 * d ** 1.6) * (y < -0.45 ? T.jaw : 1), y, z * (1 - 0.16 * d * d) + 0.05 * d];
  };
  ellipsoid(M, at(0, 0, 0), S(r * W), U(r), F(r * D), T.skin, SKIN, 14, 18, null, null, jaw);
  /** How far forward the face is at a place (side s, height u). */
  const face = (s, u) => {
    const d = u < 0 ? -u : 0;
    const x = s / (W * (1 - 0.34 * d ** 1.6));
    return D * (Math.sqrt(Math.max(0, 1 - x * x - u * u)) * (1 - 0.16 * d * d) + 0.05 * d);
  };

  // Hair: a shell around the skull that slides under the skin along the hairline.
  const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const hairline = (x, y, z) => {
    const line = 0.52 - 0.5 * x * x;
    const faceIn = sm(line + 0.07, line - 0.09, y) * sm(0.08, 0.3, z);
    const nape = sm(-0.46, -0.66, y);
    const k = 1 - 0.34 * Math.max(faceIn, nape);
    return [x * k, y * k, z * k];
  };
  ellipsoid(M, at(-0.04, 0.05, 0), S(r * (W + 0.085)), U(r * 1.07), F(r * 1.0), T.hair, 0, 22, 30, null, null, hairline);
  // A fringe swept to one side.
  ellipsoid(M, at(0.58, 0.68, 0.1), V.add(S(r * 0.5), U(-r * 0.15)), V.add(U(r * 0.25), S(r * 0.07)), F(r * 0.36), T.hair, 0, 7, 12);

  // Ears.
  for (const s of [1, -1]) ellipsoid(M, at(-0.05, -0.03, s * (W - 0.01)), S(0.6), U(1.6), F(1.0), T.skin, SKIN, 4, 6);

  // Eyes: white, iris, a light in it, the line of the lid; brows above.
  const open = 1 - 0.92 * (fx.blink || 0);
  const white = [0.92, 0.92, 0.9];
  for (const s of [1, -1]) {
    const es = s * 0.3; const eu = 0.07; const ef = face(es, eu);
    ellipsoid(M, at(ef - 0.03, eu, es), S(1.3), U(0.86 * open + 0.05), F(0.5), white, 0, 5, 8);
    ellipsoid(M, at(ef + 0.012, eu, es), S(0.72), U(0.74 * open + 0.04), F(0.3), T.iris, 0, 5, 8);
    ellipsoid(M, at(ef + 0.03, eu, es), S(0.34), U(0.36 * open + 0.02), F(0.2), T.eye, 0, 4, 6);
    if (open > 0.5) ellipsoid(M, at(ef + 0.05, eu + 0.03, es + 0.02), S(0.19), U(0.19), F(0.1), [1, 1, 1], 0, 3, 5);
    // The lash line follows the upper edge of the eye, a little higher at the outer corner.
    ellipsoid(M, at(ef, eu + 0.1 * open, es), V.add(S(1.42), U(0.1 * s)), U(0.13), F(0.42), T.eye, 0, 3, 8);
    const bu = 0.3 + 0.02 * (fx.smile || 0);
    ellipsoid(M, at(face(es * 1.05, bu) + 0.01, bu, es * 1.05), V.add(S(1.5), U(0.14 * s)), U(0.17), F(0.34), T.hair, 0, 3, 8);
  }
  // Nose: a bridge and a tip.
  ellipsoid(M, at(face(0, -0.02) - 0.02, -0.03, 0), S(0.55), U(1.6), F(0.5), T.skin, SKIN, 5, 6);
  ellipsoid(M, at(face(0, -0.2) + 0.03, -0.2, 0), S(0.82), U(0.56), F(0.62), T.skin, SKIN, 5, 8);
  // Mouth: an arc on the face that smiles; it opens a little with the effort.
  const smile = fx.smile == null ? 0.6 : fx.smile; const gap = fx.mouth || 0;
  const lips = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 4 - 1;
    const u = -0.47 + 0.1 * smile * k * k - 0.02 * gap; const s = k * 0.25;
    const thick = (0.3 + 0.42 * gap) * (1 - 0.7 * k * k) + 0.07;
    lips.push({ p: at(face(s, u) - 0.012, u, s), n: fwd, b: up, a: 0.28, bp: thick, bm: thick * 1.15, c: T.lip });
  }
  loft(M, lips, 6, true, true);

  // Hair tail with its tie.
  if (T.plait && plait && plait.length > 1) {
    ellipsoid(M, plait[0], S(2.3), U(2.3), F(2.3), T.tie, 0, 4, 6);
    const pr = [];
    const radii = [2.4, 3.9, 4.0, 3.2, 1.3];
    let n = null;
    for (let i = 0; i < plait.length; i++) {
      const tg = V.norm(V.sub(plait[Math.min(plait.length - 1, i + 1)], plait[Math.max(0, i - 1)]));
      n = sideOf(tg, n || side);
      const rr = radii[Math.min(radii.length - 1, i)];
      pr.push({ p: plait[i], n, b: V.cross(tg, n), a: rr * 0.8, bp: rr, bm: rr, c: T.hair });
    }
    loft(M, pr, 10, true, true);
  }
}

/** Where the hair tail hangs from (back of the head, upper half). */
export function plaitAnchor(body) {
  const r = BODY.head; const up = body.headUp;
  let fwd = V.sub(body.headFwd, V.mul(up, V.dot(body.headFwd, up)));
  fwd = V.len(fwd) < 0.1 ? sideOf(up, body.fwd) : V.norm(fwd);
  return V.add(V.add(body.head, V.mul(fwd, -r * 0.9)), V.mul(up, r * 0.5));
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
    loft(M, [{ p: base, n: en, b: eb, a: 2.6, bp: 1.6, bm: 1.6, c: CAT.fur }, { p: V.lerp(base, tip, 0.6), n: en, b: eb, a: 1.5, bp: 1.0, bm: 1.0, c: CAT.ear }, { p: tip, n: en, b: eb, a: 0.2, bp: 0.2, bm: 0.2, c: CAT.dark }], 8, true, true);
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
  loft(M, tail, 8, true, true);
}
