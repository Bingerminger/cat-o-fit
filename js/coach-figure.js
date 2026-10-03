/* =========================================================================
   coach-figure.js — die Vorturnerin: zeichnet eine gelöste Pose (motion-rig.js)
   als illustrierte Figur statt als Strichmännchen.

   Körper mit Volumen (Oberschenkel, Wade, Oberarm, Rumpf mit Taille), Kleidung
   (Top, Leggings, Schuhe), Kopf mit Haaren und Zopf. Der Zopf hängt der
   Schwerkraft nach und schwingt beim Abspielen nach (`state`). Die Glieder der
   abgewandten Seite sind dunkler (Tiefe), die beanspruchten Muskeln leuchten in
   der Kategoriefarbe (`--mf-hi`).

   Liefert nur Formen ({ k: 'path' | 'circle', … , cls }) – gezeichnet wird in
   motion-figure.js, als Text (Kacheln) oder als DOM (Animation).
   ========================================================================= */

import { BODY, torsoDir } from './motion-rig.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (u) => [-u[1], u[0]];
const lerpP = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const r1 = (n) => Math.round(n * 10) / 10;
/** Punkt in einem lokalen System: Ursprung o, Achsen x und y. */
const at = (o, x, y, a, b) => add(o, add(mul(x, a), mul(y, b)));

/** Geschlossene, weiche Kontur durch die Punkte (Catmull-Rom als kubische Bézier-Kurven). */
export function smoothClosed(pts) {
  const n = pts.length;
  const P = (i) => pts[(i + n) % n];
  let d = `M${r1(P(0)[0])} ${r1(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * Umriss eines Glieds von p nach q: Radius ra → rb, `bulge` wölbt die Seite +n bzw. −n
 * (Muskelbauch bei `at`, Anteil der Länge). Die Enden sind rund.
 */
function limbPts(p, q, ra, rb, { plus = 0, minus = 0, at: m = 0.4 } = {}) {
  const u = norm(sub(q, p));
  const n = perp(u);
  const rm = ra + (rb - ra) * m;
  const mid = lerpP(p, q, m);
  return [
    add(p, mul(n, ra)),
    add(mid, mul(n, rm + plus)),
    add(q, mul(n, rb)),
    add(q, mul(u, rb * 0.95)),
    add(q, mul(n, -rb)),
    add(mid, mul(n, -(rm + minus))),
    add(p, mul(n, -ra)),
    add(p, mul(u, -ra * 0.95)),
  ];
}

/* ------------------------------ Maße ------------------------------ */

const R = {
  thigh: [8.2, 4.7], shin: [4.2, 2.5], ankle: 2.2, upper: [4.3, 3.3], fore: [3.3, 2.5],
  hand: 3.1, neck: [3.3, 3.0], head: BODY.head,
};
/** Halbe Rumpfbreite vorn/hinten entlang der Wirbelsäule (t = 0 Becken … 1 Schulter), Seitenansicht. */
const SIDE_FRONT = [[0, 6.6], [0.16, 6.0], [0.36, 5.2], [0.56, 6.0], [0.72, 7.6], [0.88, 7.0], [1, 5.6]];
const SIDE_BACK = [[0, 8.6], [0.16, 7.2], [0.36, 5.8], [0.56, 6.2], [0.72, 6.8], [0.88, 7.0], [1, 6.0]];
/** Halbe Rumpfbreite von vorn. */
const FRONT_W = [[-0.08, 9.6], [0, 11.8], [0.16, 11.4], [0.4, 9.0], [0.66, 10.4], [0.86, 12.6], [1, 11.6]];
const TOP_FROM = 0.2;   // ab hier trägt der Rumpf das Top, darunter Leggings

function profile(table, t) {
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const [a, wa] = table[i - 1]; const [b, wb] = table[i];
      return wa + (wb - wa) * ((t - a) / (b - a));
    }
  }
  return table[table.length - 1][1];
}

/* ------------------------------ Rumpf ------------------------------ */

/** Wirbelsäule als quadratische Kurve wie in der Linienfigur (Becken → Schulter, `curl`). */
function spineOf(S) {
  const front = torsoDir((S.torso || 0) + 90);
  const mid = lerpP(S.hip, S.sh, 0.5);
  const c = sub(mid, mul(front, S.curl || 0));
  const point = (t) => add(add(mul(S.hip, (1 - t) * (1 - t)), mul(c, 2 * (1 - t) * t)), mul(S.sh, t * t));
  const tangent = (t) => norm(add(mul(sub(c, S.hip), 2 * (1 - t)), mul(sub(S.sh, c), 2 * t)));
  return { point, tangent, front };
}

/** Rumpfumriss der Seitenansicht zwischen t0 und t1 (Becken: hinten mit Po). */
function sideTorsoPts(S, t0, t1, grow = 0) {
  const sp = spineOf(S);
  const steps = [];
  for (const [t] of SIDE_FRONT) if (t > t0 && t < t1) steps.push(t);
  const ts = [t0, ...steps, t1];
  const nOf = (t) => { const n = perp(sp.tangent(t)); return dot(n, sp.front) >= 0 ? n : mul(n, -1); };
  const front = ts.map((t) => add(sp.point(t), mul(nOf(t), profile(SIDE_FRONT, t) + grow)));
  const back = ts.slice().reverse().map((t) => add(sp.point(t), mul(nOf(t), -(profile(SIDE_BACK, t) + grow))));
  const out = [...front];
  if (t1 >= 1) out.push(add(add(S.sh, mul(sp.tangent(1), 4.2)), mul(nOf(1), 0.4)));
  out.push(...back);
  if (t0 <= 0) out.push(add(add(S.hip, mul(sp.tangent(0), -4.6)), mul(nOf(0), -3.0)));
  return out;
}

/** Rumpfumriss von vorn: Achse Becken → Schulter, Breite nach FRONT_W. */
function frontTorsoPts(S, t0, t1, grow = 0) {
  const axis = sub(S.sh, S.hip);
  const u = norm(axis); const L = len(axis);
  const x = perp(u);
  const ts = [t0, ...FRONT_W.map(([t]) => t).filter((t) => t > t0 && t < t1), t1];
  const pt = (t, s) => add(add(S.hip, mul(u, t * L)), mul(x, s * (profile(FRONT_W, t) + grow)));
  const right = ts.map((t) => pt(t, 1));
  const left = ts.slice().reverse().map((t) => pt(t, -1));
  const out = [...right];
  if (t1 >= 1) { out.push(add(S.sh, add(mul(u, 3.4), mul(x, 5)))); out.push(add(S.sh, add(mul(u, 3.4), mul(x, -5)))); }
  out.push(...left);
  if (t0 < 0) out.push(add(S.hip, mul(u, t0 * L - 2.5)));
  return out;
}

/* ------------------------------ Glieder ------------------------------ */

function legShapes(S, side, far, hi) {
  const g = S.legs[side];
  const tone = far ? ' cf-far' : '';
  const out = [];
  const toe = norm(sub(g.foot[1], g.foot[0]));
  const thighU = norm(sub(g.joint, g.root));
  const shinU = norm(sub(g.end, g.joint));
  const front = S.view === 'front';
  // Seitenansicht: Quadrizeps vorn, Beinbeuger und Wade hinten – Richtung aus Kniebeuge und Fußspitze.
  let thighSide = 1; let calfSide = 1;
  if (!front) {
    const n = perp(thighU);
    thighSide = dot(n, toe) - 2 * dot(n, shinU) >= 0 ? 1 : -1;
    const ns = perp(shinU);
    calfSide = dot(ns, toe) > 0.05 ? -1 : dot(ns, toe) < -0.05 ? 1 : -thighSide;
  }
  const thigh = limbPts(g.root, g.joint, R.thigh[0], R.thigh[1], front ? { plus: 0.8, minus: 0.8 }
    : (thighSide > 0 ? { plus: 1.3, minus: 0.6 } : { plus: 0.6, minus: 1.3 }));
  // Leggings in 7/8-Länge: Sie enden knapp über dem Knöchel, darunter Haut und Schuh.
  const cuff = lerpP(g.joint, g.end, 0.84);
  const shin = limbPts(g.joint, cuff, R.shin[0], R.shin[1], front ? { plus: 0.6, minus: 0.6, at: 0.32 }
    : (calfSide > 0 ? { plus: 1.9, minus: 0.25, at: 0.3 } : { plus: 0.25, minus: 1.9, at: 0.3 }));
  // Beanspruchte Muskeln: dieselbe Form noch einmal, in der Kategoriefarbe lasiert.
  const thighD = smoothClosed(thigh); const shinD = smoothClosed(shin);
  out.push({ k: 'path', d: thighD, cls: `cf-leg${tone}` });
  if (hi.has('thigh')) out.push({ k: 'path', d: thighD, cls: 'cf-hi' });
  out.push({ k: 'path', d: smoothClosed(limbPts(lerpP(g.joint, g.end, 0.74), g.end, R.ankle + 0.2, R.ankle)), cls: `cf-skin${tone}` });
  out.push({ k: 'path', d: shinD, cls: `cf-leg${tone}` });
  if (hi.has('shin')) out.push({ k: 'path', d: shinD, cls: 'cf-hi' });
  out.push(...shoeShapes(S, g, far, hi.has('foot')));
  return out;
}

/** Turnschuh: Schaft mit Ferse, Spann und Kappe, darunter eine dunklere Sohle in Schuhlänge. */
function shoeShapes(S, g, far, hot) {
  const tone = far ? ' cf-far' : '';
  const cls = `cf-shoe${tone}${hot ? ' cf-shoe-hi' : ''}`;
  if (S.view === 'front') {
    const c = norm(sub(g.foot[1], g.foot[0]));
    let n = perp(c);
    if (dot(n, sub(g.end, g.joint)) < 0) n = mul(n, -1);   // n zeigt vom Bein weg (zum Boden)
    const o = g.end;
    const P = (x, y) => at(o, c, n, x, y);
    return [
      { k: 'path', d: smoothClosed([P(-2.5, -1.4), P(2.5, -1.4), P(3.8, 0.6), P(4.0, 2.7), P(0, 3.2), P(-4.0, 2.7), P(-3.8, 0.6)]), cls },
      { k: 'path', d: smoothClosed(limbPts(P(-3.4, 3.3), P(3.4, 3.3), 0.75, 0.75)), cls: `cf-sole${tone}` },
    ];
  }
  const H = g.foot[0]; const T = g.foot[1];
  const L = len(sub(T, H));
  const u = norm(sub(T, H));
  let n = perp(u);
  if (dot(n, sub(g.joint, H)) < 0) n = mul(n, -1);   // n zeigt zum Bein (Oberseite des Schuhs)
  const P = (x, y) => at(H, u, n, x, y);
  // Die Fußlinie liegt auf Knöchelhöhe (BODY.ankle über der Sohle): Sohle darunter, Schaft um den Knöchel.
  const upper = [P(-1.3, -2.9), P(-1.8, -0.9), P(-1.2, 1.8), P(0.6, 2.8), P(2.7, 2.5), P(4.9, 1.0), P(L - 3.4, -0.5), P(L - 0.9, -1.2), P(L + 0.4, -2.2), P(L, -3.1), P(L * 0.45, -3.2)];
  // Sohle als abgerundeter Streifen (ein Vieleck mit Ecken schwingt sonst über).
  const sole = limbPts(P(-1.2, -3.35), P(L + 0.2, -3.35), 0.75, 0.75);
  return [
    { k: 'path', d: smoothClosed(upper), cls },
    { k: 'path', d: smoothClosed(sole), cls: `cf-sole${tone}` },
  ];
}

function armShapes(S, side, far, hi) {
  const a = S.arms[side];
  const tone = far ? ' cf-far' : '';
  const out = [];
  const up = limbPts(a.root, a.joint, R.upper[0], R.upper[1], { plus: 0.7, minus: 0.7, at: 0.35 });
  const fore = limbPts(a.joint, a.end, R.fore[0], R.fore[1], { plus: 0.5, minus: 0.5, at: 0.25 });
  const upD = smoothClosed(up); const foreD = smoothClosed(fore);
  out.push({ k: 'path', d: upD, cls: `cf-skin${tone}` });
  if (hi.has('upper')) out.push({ k: 'path', d: upD, cls: 'cf-hi' });
  out.push({ k: 'path', d: foreD, cls: `cf-skin${tone}` });
  if (hi.has('fore')) out.push({ k: 'path', d: foreD, cls: 'cf-hi' });
  const hand = add(a.end, mul(norm(sub(a.end, a.joint)), 1.6));
  out.push({ k: 'circle', c: hand, r: R.hand, cls: `cf-skin${tone}` });
  return out;
}

/* ------------------------------ Kopf ------------------------------ */

/** Zopfrichtung: Schwerkraft plus nach hinten, dazu der Nachschwung aus `state`. */
function tailDir(back, state) {
  const swing = state && state.swing ? state.swing : [0, 0];
  return norm(add(add([0, 1], mul(back, 0.5)), swing));
}

/** Zopf, der nicht durch den Boden hängt: Liegt die Spitze tiefer als `floorY`, legt er sich flach ab. */
function restOnFloor(anchor, d, L, floorY, fallbackX) {
  if (!(anchor[1] + d[1] * L > floorY)) return d;
  const dy = Math.max(0, floorY - anchor[1]);
  const sx = Math.sign(d[0]) || Math.sign(fallbackX) || 1;
  return norm([sx * Math.sqrt(Math.max(L * L - dy * dy, 1)), dy]);
}

function headShapes(S, state, ponytailOnly = false, floorY = Infinity) {
  const H = S.head; const r = R.head;
  const U = norm(sub(S.head, S.sh));
  const F = perp(U);                 // Gesichtsseite (Seitenansicht); von vorn: Bildachse
  const out = [];
  const front = S.view === 'front';
  // Zopf: Ansatz hinten oben am Kopf, hängt der Schwerkraft nach.
  const anchor = front ? at(H, F, U, 0, r * 0.55) : at(H, F, U, -r * 0.78, r * 0.55);
  const L = 17;
  const d = restOnFloor(anchor, tailDir(front ? [0, 0] : mul(F, -1), state), L, floorY, U[0]);
  const side = perp(d);
  const tail = [
    add(anchor, mul(side, 2.6)), at(anchor, d, side, L * 0.3, 3.9), at(anchor, d, side, L * 0.62, 3.2),
    at(anchor, d, side, L, 0.4), at(anchor, d, side, L * 0.62, -2.6), at(anchor, d, side, L * 0.28, -3.4), add(anchor, mul(side, -2.4)),
  ];
  out.push({ k: 'path', d: smoothClosed(tail), cls: 'cf-hair' });
  out.push({ k: 'circle', c: anchor, r: 2.3, cls: 'cf-tie' });
  if (ponytailOnly) return out;
  out.push({ k: 'circle', c: H, r, cls: 'cf-skin' });
  const hair = front
    ? [[-1.06, 0.15], [-1.0, 0.72], [-0.5, 1.1], [0.5, 1.1], [1.0, 0.72], [1.06, 0.15], [0.86, -0.12], [0.72, 0.42], [0.25, 0.62], [-0.25, 0.62], [-0.72, 0.42], [-0.86, -0.12]]
    : [[0.62, 0.62], [0.2, 1.08], [-0.42, 1.1], [-0.98, 0.66], [-1.1, -0.02], [-0.86, -0.56], [-0.48, -0.42], [-0.34, 0.1], [0.12, 0.46]];
  out.push({ k: 'path', d: smoothClosed(hair.map(([f, u]) => at(H, F, U, f * r * 1.04, u * r * 1.04))), cls: 'cf-hair' });
  if (!front) {
    out.push({ k: 'circle', c: at(H, F, U, -0.12 * r, -0.02 * r), r: 1.9, cls: 'cf-ear' });
    out.push({ k: 'path', d: smoothClosed([at(H, F, U, r * 0.86, r * 0.12), at(H, F, U, r * 1.16, -r * 0.16), at(H, F, U, r * 0.9, -r * 0.3)]), cls: 'cf-skin' });
  }
  return out;
}

function neckShape(S) {
  const U = norm(sub(S.head, S.sh));
  const base = add(S.sh, mul(U, -1));
  const top = add(S.head, mul(U, -R.head * 0.55));
  return { k: 'path', d: smoothClosed(limbPts(base, top, R.neck[0], R.neck[1])), cls: 'cf-skin' };
}

/* ------------------------------ Figur ------------------------------ */

/**
 * Formen der Vorturnerin in Zeichenreihenfolge. `state` (optional, über die Bilder
 * einer Animation erhalten) lässt den Zopf nachschwingen.
 */
export function coachParts(S, m, state = null) {
  const hi = new Set(m.focus || []);
  const out = [];
  const front = S.view === 'front';
  const floorY = floorOf(m);
  if (state) swingStep(S, state);
  const pelvisFill = front
    ? { k: 'path', d: smoothClosed(frontTorsoPts(S, -0.08, TOP_FROM + 0.04)), cls: 'cf-leg' }
    : { k: 'path', d: smoothClosed(sideTorsoPts(S, 0, TOP_FROM + 0.04)), cls: 'cf-leg' };
  const top = front
    ? { k: 'path', d: smoothClosed(frontTorsoPts(S, TOP_FROM, 1, 0.3)), cls: 'cf-top' }
    : { k: 'path', d: smoothClosed(sideTorsoPts(S, TOP_FROM, 1, 0.3)), cls: 'cf-top' };
  const core = () => {
    if (!hi.has('torso')) return;
    if (front) {
      const u = norm(sub(S.sh, S.hip)); const L = len(sub(S.sh, S.hip)); const x = perp(u);
      // Gerade Bauchmuskeln als schmale Zone vom Becken bis unter die Brust.
      const o = add(S.hip, mul(u, L * 0.08));
      out.push({ k: 'path', d: smoothClosed([at(o, x, u, -3.6, 0), at(o, x, u, 3.6, 0), at(o, x, u, 4.4, L * 0.3), at(o, x, u, 3.4, L * 0.5), at(o, x, u, -3.4, L * 0.5), at(o, x, u, -4.4, L * 0.3)]), cls: 'cf-hi' });
    } else {
      const sp = spineOf(S);
      const pts = [];
      for (const t of [0.14, 0.3, 0.46, 0.6]) pts.push(add(sp.point(t), mul(sp.front, profile(SIDE_FRONT, t) - 0.6)));
      for (const t of [0.6, 0.46, 0.3, 0.14]) pts.push(add(sp.point(t), mul(sp.front, 1)));
      out.push({ k: 'path', d: smoothClosed(pts), cls: 'cf-hi' });
    }
  };
  const glute = () => {
    if (front) return;
    const sp = spineOf(S);
    const c = add(add(S.hip, mul(sp.front, -2.8)), mul(sp.tangent(0), -0.4));
    out.push({ k: 'circle', c, r: 7.6, cls: 'cf-leg' });
    if (hi.has('hip')) out.push({ k: 'circle', c, r: 7.6, cls: 'cf-hi' });
  };

  if (front) {
    out.push(...legShapes(S, 'l', false, hi), ...legShapes(S, 'r', false, hi));
    out.push(...headShapes(S, state, true, floorY));
    out.push(pelvisFill, top);
    core();
    out.push(...armShapes(S, 'r', false, hi), ...armShapes(S, 'l', false, hi));
    out.push(neckShape(S));
    out.push(...headShapes(S, state, false, floorY).slice(2));
  } else {
    out.push(...armShapes(S, 'l', true, hi));
    out.push(...legShapes(S, 'l', true, hi));
    glute();
    out.push(pelvisFill, top);
    core();
    out.push(...legShapes(S, 'r', false, hi));
    out.push(neckShape(S));
    out.push(...headShapes(S, state, false, floorY));
    out.push(...armShapes(S, 'r', false, hi));
  }
  return out;
}

/** Nachschwung des Zopfs: folgt verzögert der Kopfbewegung (gedämpfte Feder). */
function swingStep(S, state) {
  const prev = state.prevHead;
  state.prevHead = S.head;
  if (!prev) { state.swing = [0, 0]; state.vel = [0, 0]; return; }
  const v = sub(S.head, prev);
  if (len(v) > 12) { state.swing = [0, 0]; state.vel = [0, 0]; return; }   // Sprung (neuer Abschnitt)
  const target = mul(v, -0.45);
  state.vel = add(mul(state.vel || [0, 0], 0.72), mul(sub(target, state.swing || [0, 0]), 0.22));
  state.swing = add(state.swing || [0, 0], state.vel);
  const l = len(state.swing);
  if (l > 1.1) state.swing = mul(state.swing, 1.1 / l);
}

/** Weicher Schatten am Boden unter der Figur (nur mit Boden). */
export function shadowOf(S) {
  const xs = [S.legs.r.end[0], S.legs.l.end[0], S.hip[0], S.sh[0], S.head[0]];
  const lo = Math.min(...xs); const hi = Math.max(...xs);
  const lift = Math.max(0, -Math.max(S.legs.r.end[1], S.legs.l.end[1]) - 4);
  const k = Math.max(0.35, 1 - lift / 40);
  return { k: 'ellipse', c: [(lo + hi) / 2, 1.2], rx: Math.max(14, (hi - lo) / 2 + 10) * k, ry: 3.2 * k, cls: 'cf-shadow' };
}

/** Höhe, auf der ein liegender Zopf aufliegt (Matte bzw. Boden; ohne Boden nie). */
export function floorOf(m) {
  return m.floor === false ? Infinity : ((m.props || {}).mat || (m.props || {}).topMat ? -2.8 : -1);
}

/** Punkte mit Rand, die der Bildausschnitt zusätzlich fassen muss (Zopf, Po, Schuhe, Haare). */
export function coachExtent(S, floorY = Infinity) {
  const r = R.head;
  const U = norm(sub(S.head, S.sh));
  const F = perp(U);
  const front = S.view === 'front';
  const anchor = front ? at(S.head, F, U, 0, r * 0.55) : at(S.head, F, U, -r * 0.78, r * 0.55);
  const d = restOnFloor(anchor, tailDir(front ? [0, 0] : mul(F, -1), null), 17, floorY, U[0]);
  const out = [[add(anchor, mul(d, 17)), 5], [at(S.head, F, U, 0, r * 1.15), 3]];
  if (!front) {
    const sp = spineOf(S);
    out.push([add(S.hip, mul(sp.front, -3.6)), 10]);
  }
  for (const side of ['r', 'l']) {
    const g = S.legs[side];
    out.push([g.foot[0], 6], [g.foot[1], 4]);
  }
  return out;
}
