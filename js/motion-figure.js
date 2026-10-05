/* =========================================================================
   motion-figure.js — draws the joint figure (motion-rig.js) as SVG.

   Since 3.23.0 the coach figure (coach-figure.js: body with volume, clothing,
   ponytail, shadow) draws by default. `style: 'line'` yields the earlier line
   figure: round "capsule" limbs instead of strokes. The body is neutral (text
   colour), the muscles in use glow in the category colour (`--mf-hi`), the arm
   and leg of the far side are paler (depth). Equipment (mat, bench, wall,
   dumbbell …) sits discreetly beside it.

   Two routes with the same geometry: `motionSVG()`/`frameSVG()` return an image as
   text (tiles, reduced motion, check sheets, tests), `mountFigure()` builds the
   elements once and `update()` only sets coordinates per frame.
   ========================================================================= */

import { BODY, solvePose, posePoints, frameAt, cycleOf, introOf, keyPose, torsoDir } from './motion-rig.js';
import { coachParts, coachExtent, shadowOf, floorOf } from './coach-figure.js';

const W = { torso: 13, thigh: 10, shin: 8.5, foot: 6, upper: 8, fore: 7 };
const f1 = (n) => Math.round(n * 10) / 10;

/** Shapes of a solved pose in drawing order: { id, k, … , cls }. */
export function figureParts(S, m) {
  const focus = new Set(m.focus || []);
  const tone = (seg, far) => `${focus.has(seg) ? 'mf-hi' : 'mf-ink'}${far ? ' mf-far' : ''}`;
  const parts = [];
  const line = (id, p, q, w, cls) => parts.push({ id, k: 'line', p, q, w, cls });
  const leg = (side, far) => {
    const g = S.legs[side];
    line(`${side}-thigh`, g.root, g.joint, W.thigh, tone('thigh', far));
    line(`${side}-shin`, g.joint, g.end, W.shin, tone('shin', far));
    line(`${side}-foot`, g.foot[0], g.foot[1], W.foot, tone('foot', far));
  };
  const arm = (side, far) => {
    const a = S.arms[side];
    line(`${side}-upper`, a.root, a.joint, W.upper, tone('upper', far));
    line(`${side}-fore`, a.joint, a.end, W.fore, tone('fore', far));
  };
  const held = (side) => {
    const h = (m.hold || {})[side];
    if (h) parts.push({ id: `${side}-hold`, k: 'hold', what: h, at: S.arms[side].end, view: S.view });
  };
  const both = () => {
    const h = (m.hold || {}).both;
    if (!h) return;
    const a = S.arms.r.end; const b = S.arms.l.end;
    parts.push({ id: 'both-hold', k: 'hold', what: h, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: S.view });
  };
  const glute = () => {
    // From the front the point would lie in the crotch – there the colouring of the thighs shows enough.
    if (!focus.has('hip') || S.view === 'front') return;
    // The buttock sits behind the pelvis; torsoDir(t + 90) points to the front of the body.
    const front = torsoDir((S.torso || 0) + 90);
    parts.push({ id: 'glute', k: 'dot', c: [S.hip[0] - front[0] * 3, S.hip[1] - front[1] * 3], r: 7, cls: 'mf-hi mf-fill' });
  };
  const torso = () => {
    if (S.view === 'front') {
      parts.push({ id: 'torso', k: 'poly', pts: [S.hipR, S.hipL, S.shL, S.shR], cls: `${tone('torso')} mf-fill`, w: 7 });
      return;
    }
    // Always as a curve so that the element stays the same during playback; `curl` pushes the
    // control point towards the back (hump) or towards the belly (hollow back).
    const front = torsoDir((S.torso || 0) + 90);
    const mid = [(S.hip[0] + S.sh[0]) / 2, (S.hip[1] + S.sh[1]) / 2];
    const c = [mid[0] - front[0] * (S.curl || 0), mid[1] - front[1] * (S.curl || 0)];
    parts.push({ id: 'torso', k: 'curve', p: S.hip, c, q: S.sh, w: W.torso, cls: tone('torso') });
  };
  const head = () => parts.push({ id: 'head', k: 'dot', c: S.head, r: BODY.head, cls: 'mf-ink mf-fill' });

  if (S.view === 'front') {
    leg('r'); leg('l'); torso(); arm('r'); arm('l'); held('r'); held('l'); both(); head();
  } else {
    arm('l', true); held('l'); leg('l', true); torso(); glute(); leg('r'); head(); arm('r'); held('r'); both();
  }
  return parts;
}

/* ---------------------------------- Equipment ---------------------------------- */

/**
 * Equipment for one side. Exercises mirrored from the front ("per side") also mirror
 * bench, wall & co. on the second side – otherwise the leg would hang in the air.
 */
export function propsOf(m, side = 'a') {
  const P = m.props || {};
  if (side !== 'b' || m.view !== 'front' || m.sides !== 'each') return P;
  const cx = m.cx || 0;
  const mx = (x) => 2 * cx - x;
  const out = { ...P };
  if (P.mat) out.mat = [mx(P.mat[1]), mx(P.mat[0])];
  if (P.box) out.box = [mx(P.box[0] + P.box[2]), P.box[1], P.box[2]];
  if (P.wall != null) out.wall = mx(P.wall);
  if (P.bar) out.bar = [mx(P.bar[0]), P.bar[1]];
  if (P.ball) out.ball = [mx(P.ball[0]), P.ball[1], P.ball[2]];
  return out;
}

/** Static equipment (behind the figure). */
function propParts(m, vb, side = 'a') {
  const P = propsOf(m, side);
  const parts = [];
  if (P.topMat) { const [x, y, w, h] = P.topMat; parts.push({ id: 'topmat', k: 'rect', x, y, w, h, rx: 8, cls: 'mf-mat' }); }
  if (P.mat) parts.push({ id: 'mat', k: 'rect', x: P.mat[0], y: -2.2, w: P.mat[1] - P.mat[0], h: 2.6, rx: 1.3, cls: 'mf-mat' });
  if (P.box) {
    const [x, top, w] = P.box;
    parts.push({ id: 'box', k: 'rect', x, y: top, w, h: -top, rx: 2, cls: 'mf-prop mf-prop-soft' });
  }
  if (P.wall != null) parts.push({ id: 'wall', k: 'line', p: [P.wall, 2], q: [P.wall, vb[1] + 2], w: 3, cls: 'mf-prop' });
  if (P.bar) {
    if (m.view === 'front') {
      parts.push({ id: 'bar', k: 'line', p: [P.bar[0] - 42, P.bar[1]], q: [P.bar[0] + 42, P.bar[1]], w: 3.5, cls: 'mf-prop' });
    } else {
      // Bar from the side: cross-section plus posts down to the floor.
      parts.push({ id: 'post', k: 'line', p: [P.bar[0] - 7, P.bar[1] + 2], q: [P.bar[0] - 7, 0], w: 2.4, cls: 'mf-prop' });
      parts.push({ id: 'bar', k: 'dot', c: P.bar, r: 4.6, cls: 'mf-prop mf-prop-fill' });
    }
  }
  if (P.ball) parts.push({ id: 'ball', k: 'dot', c: [P.ball[0], P.ball[1]], r: P.ball[2] || 7, cls: 'mf-prop mf-prop-soft' });
  return parts;
}

/** Bands between body points (dynamic). */
function bandParts(m, S) {
  const pt = (ref) => {
    if (Array.isArray(ref)) return ref;
    const side = ref[0] === 'r' ? 'r' : 'l';
    const what = ref.slice(1);
    if (what === 'h') return S.arms[side].end;
    if (what === 'k') return S.legs[side].joint;
    if (what === 'a') return S.legs[side].end;
    return S.hip;
  };
  return ((m.props || {}).band || []).map((b, i) => ({ id: `band${i}`, k: 'line', p: pt(b[0]), q: pt(b[1]), w: 2.4, cls: 'mf-band' }));
}

/** Held equipment as simple shapes. */
function holdShapes(part) {
  const [x, y] = part.at;
  switch (part.what) {
    case 'db':
      return part.view === 'front'
        ? [{ k: 'line', p: [x - 8, y], q: [x + 8, y], w: 3, cls: 'mf-prop' },
          { k: 'dot', c: [x - 8, y], r: 4.4, cls: 'mf-prop mf-prop-fill' }, { k: 'dot', c: [x + 8, y], r: 4.4, cls: 'mf-prop mf-prop-fill' }]
        : [{ k: 'dot', c: [x, y], r: 5.6, cls: 'mf-prop mf-prop-fill' }];
    case 'kb':
      return [{ k: 'dot', c: [x, y + 8.5], r: 7.5, cls: 'mf-prop mf-prop-fill' }, { k: 'ring', c: [x, y + 2], r: 3.6, cls: 'mf-prop' }];
    case 'ball':
      return [{ k: 'dot', c: [x, y - 2], r: 9.5, cls: 'mf-prop mf-prop-soft' }];
    default:
      return [];
  }
}

/** All shapes of a frame (figure, equipment in the hand, bands). `state` holds the ponytail's follow-through. */
function shapesOf(m, pose, style = 'coach', state = null) {
  const S = solvePose(pose, m.view);
  const out = [];
  if (style === 'coach' && showFloor(m)) out.push(shadowOf(S));
  const figure = style === 'coach' ? coachHolds(S, m, coachParts(S, m, state)) : figureParts(S, m);
  for (const part of [...figure, ...bandParts(m, S)]) {
    if (part.k === 'hold') holdShapes(part).forEach((s) => out.push(s));
    else out.push(part);
  }
  return out;
}

/** Equipment held by the coach figure: in front of the hand of the respective side. */
function coachHolds(S, m, parts) {
  const h = m.hold || {};
  const out = [...parts];
  for (const side of ['l', 'r']) if (h[side]) out.push({ k: 'hold', what: h[side], at: S.arms[side].end, view: S.view });
  if (h.both) {
    const a = S.arms.r.end; const b = S.arms.l.end;
    out.push({ k: 'hold', what: h.both, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: S.view });
  }
  return out;
}

/* ---------------------------------- Frame ---------------------------------- */

const vbCache = new WeakMap();
const boundsCache = new WeakMap();
/**
 * ViewBox that fits all frames of the exercise (3:2). `crop` (y value) shows only the
 * upper body – for arm-only exercises the figure becomes much larger this way.
 */
export function viewBoxOf(m) {
  if (vbCache.has(m)) return vbCache.get(m);
  const vb = fitBox(boundsOf(m), 1.5);
  vbCache.set(m, vb);
  return vb;
}

/** ViewBox for a different aspect ratio (e.g. the session stage), flush at the bottom. */
export function viewBoxFor(m, aspect = 1.5) {
  return aspect > 0 && Number.isFinite(aspect) ? fitBox(boundsOf(m), aspect) : viewBoxOf(m);
}

/** Extends [x0, y0, x1, y1] to the aspect ratio – horizontally centred, upwards. */
function fitBox([x0, y0, x1, y1], aspect) {
  let w = x1 - x0; let h = y1 - y0;
  if (w / h < aspect) { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / aspect; y0 -= nh - h; h = nh; }
  return [f1(x0), f1(y0), f1(w), f1(h)];
}

/** Bounds of all frames of the exercise including margin: [x0, y0, x1, y1]. */
function boundsOf(m) {
  if (boundsCache.has(m)) return boundsCache.get(m);
  const limit = m.crop != null ? m.crop : Infinity;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity;
  let y1 = m.crop != null ? m.crop : (m.floor === false ? -Infinity : 4);
  const take = (p, pad = 8) => {
    if (p[1] - pad > limit) return;
    x0 = Math.min(x0, p[0] - pad); x1 = Math.max(x1, p[0] + pad); y0 = Math.min(y0, p[1] - pad);
    if (m.crop == null) y1 = Math.max(y1, p[1] + pad);
  };
  // Sample everything that can be shown: intro and cycle, for "per side" both sides.
  const sides = m.sides === 'each' ? ['a', 'b'] : ['a'];
  for (const side of sides) {
    for (const list of [introOf(m, side), cycleOf(m, side)]) {
      const total = list.reduce((s, p) => s + p.dur, 0);
      if (!total) continue;
      for (let i = 0; i <= 48; i++) {
        const S = solvePose(frameAt(m, Math.min(total - 1e-6, (i / 48) * total), list).pose, m.view);
        posePoints(S).forEach((p) => take(p));
        take(S.head, BODY.head + 3);
        coachExtent(S, floorOf(m)).forEach(([p, pad]) => take(p, pad));
      }
    }
    const P = propsOf(m, side);
    if (P.mat) { take([P.mat[0], 0], 2); take([P.mat[1], 0], 2); }
    if (P.topMat) { take([P.topMat[0], P.topMat[1]], 2); take([P.topMat[0] + P.topMat[2], P.topMat[1] + P.topMat[3]], 2); }
    if (P.box) { take([P.box[0], P.box[1]], 2); take([P.box[0] + P.box[2], 0], 2); }
    if (P.wall != null) take([P.wall, -10], 4);
    if (P.bar) take(P.bar, m.view === 'front' ? 6 : 7);
    if (P.ball) take([P.ball[0], P.ball[1]], (P.ball[2] || 7) + 3);
  }
  if (m.hold) { x0 -= 8; x1 += 8; }
  // Margin; the aspect ratio is set by fitBox (flush at the bottom: floor or cut edge).
  x0 -= 6; x1 += 6; y0 -= 6;
  const b = [x0, y0, x1, y1];
  boundsCache.set(m, b);
  return b;
}

/** Floor visible? (not for a crop, top-down view or hanging exercises) */
const showFloor = (m) => m.floor !== false && m.crop == null;

/** Which poses the still image shows: start pale (`ghost`), target pose strong (`solid`). */
export function thumbKeys(m) {
  const cyc = cycleOf(m);
  const peak = m.thumb || (cyc.find((p) => !p.hold && p.to !== m.start) || {}).to || m.start;
  const ghost = peak !== m.start ? m.start : (m.intro ? m.intro.from : null);
  return { ghost: ghost && ghost !== peak ? ghost : null, solid: peak };
}

/* ---------------------------------- Text output ---------------------------------- */

function attrsOf(s) {
  switch (s.k) {
    case 'line': return `<line x1="${f1(s.p[0])}" y1="${f1(s.p[1])}" x2="${f1(s.q[0])}" y2="${f1(s.q[1])}" stroke-width="${s.w}" class="${s.cls}"/>`;
    case 'dot': return `<circle cx="${f1(s.c[0])}" cy="${f1(s.c[1])}" r="${s.r}" class="${s.cls}"/>`;
    case 'ring': return `<circle cx="${f1(s.c[0])}" cy="${f1(s.c[1])}" r="${s.r}" stroke-width="2.6" class="${s.cls}"/>`;
    case 'rect': return `<rect x="${f1(s.x)}" y="${f1(s.y)}" width="${f1(s.w)}" height="${f1(s.h)}" rx="${s.rx || 0}" class="${s.cls}"/>`;
    case 'curve': return `<path d="M${f1(s.p[0])} ${f1(s.p[1])} Q${f1(s.c[0])} ${f1(s.c[1])} ${f1(s.q[0])} ${f1(s.q[1])}" stroke-width="${s.w}" class="${s.cls}"/>`;
    case 'poly': return `<polygon points="${s.pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')}" stroke-width="${s.w}" class="${s.cls}"/>`;
    case 'path': return `<path d="${s.d}" class="${s.cls}"/>`;
    case 'circle': return `<circle cx="${f1(s.c[0])}" cy="${f1(s.c[1])}" r="${f1(s.r)}" class="${s.cls}"/>`;
    case 'ellipse': return `<ellipse cx="${f1(s.c[0])}" cy="${f1(s.c[1])}" rx="${f1(s.rx)}" ry="${f1(s.ry)}" class="${s.cls}"/>`;
    default: return '';
  }
}

function frameOpen(m, { color = '', label = '', side = 'a', style: look = 'coach' } = {}) {
  const vb = viewBoxOf(m);
  const style = color ? ` style="--mf-hi:${color}"` : '';
  const aria = label ? ` role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : ' aria-hidden="true"';
  const ground = showFloor(m) ? `<line x1="${f1(vb[0] + 4)}" y1="1.5" x2="${f1(vb[0] + vb[2] - 4)}" y2="1.5" stroke-width="2.4" class="mf-ground"/>` : '';
  return `<svg class="mf${look === 'coach' ? ' mf--coach' : ''}" viewBox="${vb.join(' ')}"${style}${aria}>${ground}${propParts(m, vb, side).map(attrsOf).join('')}`;
}

/**
 * Still image as SVG text: `solid` strong, `ghost` (optional) pale behind it –
 * so one image shows the start and the goal of the movement.
 */
export function motionSVG(m, { solid = null, ghost = null, color = '', label = '', side = 'a', style = 'coach' } = {}) {
  // The pale start state without a shadow – otherwise two shadows would stand on the floor.
  const g = ghost ? `<g class="mf-ghost">${shapesOf(m, keyPose(m, ghost, side), style).filter((x) => x.cls !== 'cf-shadow').map(attrsOf).join('')}</g>` : '';
  const s = shapesOf(m, keyPose(m, solid || m.start, side), style).map(attrsOf).join('');
  return `${frameOpen(m, { color, label, side, style })}${g}<g>${s}</g></svg>`;
}

/** Any frame of the sequence (t in seconds) as SVG text – for check sheets and tests. */
export function frameSVG(m, t, { color = '', list = null, side = 'a', style = 'coach' } = {}) {
  const fr = frameAt(m, t, list || cycleOf(m, side));
  return `${frameOpen(m, { color, side, style })}<g>${shapesOf(m, fr.pose, style).map(attrsOf).join('')}</g></svg>`;
}

/* ---------------------------------- Animation (DOM) ---------------------------------- */

const SVGNS = 'http://www.w3.org/2000/svg';
const TAG = { line: 'line', dot: 'circle', ring: 'circle', rect: 'rect', poly: 'polygon', curve: 'path', path: 'path', circle: 'circle', ellipse: 'ellipse' };

/**
 * Builds the figure once as DOM. `update(t, list)` draws the frame at time t
 * (seconds) within a section list (intro or cycle) and returns the
 * section; `setSide()` switches the mirrored equipment.
 */
export function mountFigure(svg, m, { color = '', side = 'a', style = 'coach', aspect = null } = {}) {
  const vb = aspect ? viewBoxFor(m, aspect) : viewBoxOf(m);
  const doc = svg.ownerDocument || document;
  const state = {};   // ponytail follow-through across the frames
  svg.setAttribute('viewBox', vb.join(' '));
  svg.setAttribute('class', style === 'coach' ? 'mf mf--coach' : 'mf');
  if (color) svg.setAttribute('style', `--mf-hi:${color}`);
  svg.innerHTML = '';
  const make = (tag, attrs) => {
    const e = doc.createElementNS ? doc.createElementNS(SVGNS, tag) : doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  if (showFloor(m)) svg.appendChild(make('line', { x1: f1(vb[0] + 4), y1: 1.5, x2: f1(vb[0] + vb[2] - 4), y2: 1.5, 'stroke-width': 2.4, class: 'mf-ground' }));
  const staticHost = make('g', {}); svg.appendChild(staticHost);
  const host = make('g', {}); svg.appendChild(host);
  let els = null;
  const setSide = (s) => { staticHost.innerHTML = propParts(m, vb, s).map(attrsOf).join(''); };
  setSide(side);

  function update(t, list = cycleOf(m)) {
    const fr = frameAt(m, t, list);
    const shapes = shapesOf(m, fr.pose, style, state);
    if (!els || els.length !== shapes.length) {
      host.innerHTML = '';
      els = shapes.map((s) => {
        const e = make(TAG[s.k], { class: s.cls });
        if (s.k === 'ring') e.setAttribute('stroke-width', 2.6);
        else if (s.w) e.setAttribute('stroke-width', s.w);
        host.appendChild(e);
        return e;
      });
    }
    shapes.forEach((s, i) => {
      const e = els[i];
      if (s.k === 'line') { e.setAttribute('x1', f1(s.p[0])); e.setAttribute('y1', f1(s.p[1])); e.setAttribute('x2', f1(s.q[0])); e.setAttribute('y2', f1(s.q[1])); }
      else if (s.k === 'dot' || s.k === 'ring') { e.setAttribute('cx', f1(s.c[0])); e.setAttribute('cy', f1(s.c[1])); e.setAttribute('r', s.r); }
      else if (s.k === 'curve') e.setAttribute('d', `M${f1(s.p[0])} ${f1(s.p[1])} Q${f1(s.c[0])} ${f1(s.c[1])} ${f1(s.q[0])} ${f1(s.q[1])}`);
      else if (s.k === 'poly') e.setAttribute('points', s.pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' '));
      else if (s.k === 'path') e.setAttribute('d', s.d);
      else if (s.k === 'circle') { e.setAttribute('cx', f1(s.c[0])); e.setAttribute('cy', f1(s.c[1])); e.setAttribute('r', f1(s.r)); }
      else if (s.k === 'ellipse') { e.setAttribute('cx', f1(s.c[0])); e.setAttribute('cy', f1(s.c[1])); e.setAttribute('rx', f1(s.rx)); e.setAttribute('ry', f1(s.ry)); }
    });
    return fr;
  }
  return { update, setSide };
}
