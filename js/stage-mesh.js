/* =========================================================================
   stage-mesh.js — what stands on the 3D stage besides the trainer: the cat and the
   equipment, as triangles for stage-gl.js. Pure arithmetic into typed arrays, no
   DOM, no WebGL – rebuilt every frame (a few thousand vertices). The trainer is a
   real model with a skeleton (stage-model.js).

   Vertex layout (STRIDE floats): position 3, normal 3, colour 3, the glow of the
   muscles an exercise works (0…1), and 1 for skin.
   ========================================================================= */

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

/* ------------------------------ Colours ------------------------------ */

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255].map((x) => x ** 2.2);

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

/* ------------------------------ Equipment ------------------------------ */

const GEAR = { iron: rgb('#2c313c'), grip: rgb('#9aa3b2'), accent: rgb('#ff5d52'), ball: rgb('#3aa7a0'), wood: rgb('#c9a27a'), wall: rgb('#b4aca6'), steel: rgb('#b9c0cc'), band: rgb('#ffc94d') };

/** A box between two corners, with flat sides. */
function box(M, lo, hi, c) {
  const faces = [
    [[1, 0, 0], [hi[0], lo[1], lo[2]], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [lo[0], lo[1], lo[2]], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [lo[0], hi[1], lo[2]], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [lo[0], lo[1], lo[2]], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [lo[0], lo[1], hi[2]], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [lo[0], lo[1], lo[2]], [0, 1, 0], [1, 0, 0]],
  ];
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  for (const [n, o, u, v] of faces) {
    const du = V.mul(u, V.dot(u, size)); const dv = V.mul(v, V.dot(v, size));
    const a = vert(M, o, n, c, 0); const b = vert(M, V.add(o, du), n, c, 0); const d = vert(M, V.add(V.add(o, du), dv), n, c, 0); const e = vert(M, V.add(o, dv), n, c, 0);
    tri(M, a, b, d); tri(M, a, d, e);
  }
}
/** A straight bar from a to b. */
function rod(M, a, b, r, c) {
  const tg = V.norm(V.sub(b, a)); const n = sideOf(tg, [0, 1, 0]); const bn = V.cross(tg, n);
  loft(M, [{ p: a, n, b: bn, a: r, bp: r, bm: r, c }, { p: b, n, b: bn, a: r, bp: r, bm: r, c }], 8, true, true);
}

/** A flat strap through points: `flat` is the direction of its width (unit), the strap is thin across it. */
function strap(M, pts, flat, c, closed = false) {
  const list = closed ? [...pts, pts[0]] : pts;
  const n = list.length;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const before = closed ? list[(i - 1 + n - 1) % (n - 1)] : list[Math.max(0, i - 1)];
    const after = closed ? list[(i + 1) % (n - 1)] : list[Math.min(n - 1, i + 1)];
    const tg = V.norm(V.sub(after, before));
    let across = V.cross(tg, flat);
    across = V.len(across) < 0.05 ? sideOf(tg, [0, 0, 1]) : V.norm(across);
    rings.push({ p: list[i], n: across, b: V.cross(across, tg), a: 0.5, bp: 2.3, bm: 2.3, c });
  }
  loft(M, rings, 8, !closed, !closed);
}

/**
 * The equipment of an exercise. `m` is the motion (hold: what the hands hold – 'db' dumbbell, 'kb' kettlebell, 'ball';
 * props: box [x, top, width], wall x, bar [x, height], band [[from, to]] between two of `hands.points`), `hands` where
 * the hands are: { r, l: { at, along }, points: { rh, lh, rk, lk } } (the grip and the direction of the forearm; the
 * points a band runs between: the hands, the thighs just above the knees – stage units), `lat` the line across the
 * body, `swap` for the other side.
 */
export function buildGear(M, m, hands, lat, swap = false) {
  const hold = m.hold || {};
  const side = (s) => (swap ? (s === 'r' ? 'l' : 'r') : s);
  const dumbbell = (h) => {
    // The handle lies across the forearm and across the body's side line – the way a hand closes round it.
    let axis = V.cross(h.along, lat);
    axis = V.len(axis) < 0.2 ? lat : V.norm(axis);
    const a = V.add(h.at, V.mul(axis, -6.5)); const b = V.add(h.at, V.mul(axis, 6.5));
    rod(M, a, b, 1.1, GEAR.grip);
    for (const end of [a, b]) {
      const n = sideOf(axis, [0, 1, 0]); const bn = V.cross(axis, n);
      loft(M, [-2.2, 2.2].map((k) => ({ p: V.add(end, V.mul(axis, k)), n, b: bn, a: 4.4, bp: 4.4, bm: 4.4, c: GEAR.iron, e: 2.2 })), 12, true, true);
    }
  };
  for (const s of ['r', 'l']) if (hold[s] === 'db') dumbbell(hands[side(s)]);
  if (hold.both) {
    const mid = V.lerp(hands.r.at, hands.l.at, 0.5);
    const along = V.norm(V.add(hands.r.along, hands.l.along));
    if (hold.both === 'db') dumbbell({ at: mid, along });
    if (hold.both === 'ball') ellipsoid(M, V.add(mid, V.mul(along, 4)), [10.5, 0, 0], [0, 10.5, 0], [0, 0, 10.5], GEAR.ball, 0, 10, 14);
    if (hold.both === 'kb') {
      const c = V.add(mid, V.mul(along, 10));
      ellipsoid(M, c, [7.4, 0, 0], [0, 7, 0], [0, 0, 7.4], GEAR.iron, 0, 9, 12);
      // The handle: an arch from the bell up to the hands.
      const up = V.mul(along, -1); const across = sideOf(up, lat);
      const arch = [-1, -0.5, 0, 0.5, 1].map((k) => V.add(V.add(c, V.mul(up, 6 + 5.5 * (1 - k * k))), V.mul(across, k * 5.2)));
      for (let i = 0; i + 1 < arch.length; i++) rod(M, arch[i], arch[i + 1], 1.15, GEAR.iron);
    }
  }
  const props = m.props || {};
  if (props.box) { const [x, top, w] = props.box; box(M, [x, 0, -24], [x + w, -top, 24], GEAR.wood); }
  if (props.wall != null) { const x = props.wall; box(M, [x > 0 ? x : x - 7, 0, -90], [x > 0 ? x + 7 : x, 170, 90], GEAR.wall); }
  if (props.bar) {
    // A bar runs across the body: across the picture in a front view, into it in a side view.
    const [x, y] = props.bar;
    const ends = m.view === 'front' ? [[x - 46, -y, 0], [x + 46, -y, 0]] : [[x, -y, -46], [x, -y, 46]];
    rod(M, ends[0], ends[1], 1.5, GEAR.steel);
    for (const e of ends) rod(M, [e[0], 0, e[2]], e, 1.8, GEAR.iron);
  }
  for (const [from, to] of props.band || []) {
    const a = (hands.points || {})[from]; const b = (hands.points || {})[to];
    if (!a || !b) continue;
    const gap = V.sub(b, a);
    if (V.len(gap) < 1e-3) continue;
    const out = V.norm(gap);
    if (from.endsWith('h')) {
      // Between the hands: one length of band, pulled taut, reaching a little past each grip.
      const flat = Math.abs(out[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      strap(M, [V.add(a, V.mul(out, -3)), V.lerp(a, b, 0.5), V.add(b, V.mul(out, 3))], flat, GEAR.band);
      continue;
    }
    // Round the legs: a loop that lies on the outside of both thighs.
    let fwd = V.cross(out, [0, 1, 0]);
    fwd = V.len(fwd) < 0.05 ? [0, 0, 1] : V.norm(fwd);
    const flat = V.norm(V.cross(fwd, out));
    const r = 6.4;
    const round = (c, o) => [[1, 0], [0.72, 0.72], [0, 1], [-0.72, 0.72], [-1, 0]].map(([f, s]) => V.add(c, V.add(V.mul(fwd, f * r), V.mul(o, s * r))));
    strap(M, [...round(b, out), ...round(a, V.mul(out, -1)).reverse()], flat, GEAR.band, true);
  }
}
