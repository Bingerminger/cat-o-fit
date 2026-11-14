/* =========================================================================
   stage-show.js — the direction of the 3D stage (since 4.2): what the trainer, the
   camera and the cat do at a time of the session.

   The session clock stays where it is (show-program.js: buildShow / showStateAt) –
   music, voice and counters hang on it. This module only turns a state of that
   clock into a picture:

   • the trainer's body: the exercise of the section (body3d.js bodyAt), flowing
     over from the end of the section before it, alive when she waits (breath,
     a shifting weight, a look to the viewer, blinking), her hair tail swinging;
   • the camera: an opening crane shot, calm wide orbits in the rests, and during
     the work a new angle every few bars – cut on the bar line, drifting between;
   • the cat next to the mat, which watches, bobs along and stretches in the rests;
   • confetti when an exercise is done.

   Everything that depends only on the time is computed from the time (pause and
   jumps just work); the hair and the confetti are small simulations that restart
   after a jump.
   ========================================================================= */

import { BODY, cycleOf } from './motion-rig.js';
import { MOTIONS } from './exercise-motions.js';
import { vec as V, bodyFlow, createFollower, blendBodies, aboveFloor, bodyPoints, solveLimb3 } from './body3d.js';
import { showStateAt } from './show-program.js';
import { createBodyDirector } from './stage-body.js';
import { createMesh, buildTrainer, buildCat, plaitAnchor, STRIDE } from './stage-mesh.js';
import { createStage, projectPoint } from './stage-gl.js';
import { loadTrainer, poseSkeleton, skinMatrices, jointsForModel, modelToStage } from './stage-model.js';
import { retarget } from './stage-rig.js';

/** The looks of the stage: how the trainer is lit and drawn, and the world that goes with it. */
export const LOOKS = { natural: 'beach', night: 'neon', drawn: 'pop' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (k) => { const x = clamp(k, 0, 1); return x * x * (3 - 2 * x); };
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** The mat: centre x, centre z, half length, half width. */
const MAT = [0, 0, 104, 38];
/** The space of the celebration at the end (a body standing, arms up, and the cat). */
const CHEER_SPACE = { c: [14, 70, 10], h: [62, 82, 30], view: 'front' };
/** Where the cat sits: at the head end of the mat, on its far side – it never sits between the camera and the trainer. */
const CAT_AT = [102, 0, -48];

/* ------------------------------ Shots ------------------------------ */

/** Angles for the work, per authoring view: yaw and pitch in degrees, zoom (1 = the body fills the free area), drift of the yaw. */
const SHOTS = {
  side: [[22, 7, 1.0, 9], [-30, 11, 1.06, -9], [50, 6, 0.96, 7], [-10, 19, 1.14, 11], [36, 26, 1.12, -10]],
  front: [[10, 6, 1.0, -11], [-27, 10, 1.02, 9], [30, 13, 1.06, -9], [3, 3, 0.93, 7]],
};
/** How far ahead of the clock the body aims (seconds) – about what its weight makes it run behind. */
const LEAD = 0.07;
/** Bars per camera angle during the work. */
const SHOT_BARS = 4;

function shotAt(seg, local, view) {
  const beat = 60 / (seg.bpm || 110);
  if (seg.kind === 'work') {
    const dur = SHOT_BARS * 4 * beat;
    const n = Math.floor(local / dur);
    const list = SHOTS[view] || SHOTS.side;
    const [yaw, pitch, zoom, drift] = list[(n + seg.i) % list.length];
    const k = (local - n * dur) / dur;
    return { yaw: yaw + drift * (k - 0.5), pitch, zoom: zoom * (1.03 - 0.06 * k) };
  }
  const k = clamp(local / seg.dur, 0, 1);
  if (seg.kind === 'ready') {
    // Opening: from high and far down to the trainer.
    const e = smooth(Math.min(1, local / Math.min(seg.dur, 9)));
    return { yaw: -62 + 78 * e, pitch: 30 - 22 * e, zoom: 2.5 - 1.42 * e };
  }
  if (seg.kind === 'switch') return { yaw: 14 - 20 * k, pitch: 9, zoom: 1.12 };
  // Rests: a wide, slow orbit that shows the place.
  const dirn = seg.i % 2 ? -1 : 1;
  return { yaw: dirn * (-34 + 68 * smooth(k)), pitch: 11 + 3 * Math.sin(k * Math.PI), zoom: 1.34 - 0.12 * k };
}

/* ------------------------------ Stage ------------------------------ */

/**
 * The directed stage on a canvas for a show (buildShow). Returns null without WebGL.
 * `render(T, st, env)`: T show time, st = showStateAt(show, T),
 * env = { area: { x, y, w, h } free part of the canvas in 0…1, playing }.
 */
export function mountStage(canvas, show, { look = 'f', style = 'natural' } = {}) {
  const stage = createStage(canvas);
  if (!stage) return null;
  let lookName = LOOKS[style] ? style : 'natural';
  // The trainer model: loaded once; the stage shows the world until it is there. If it cannot be had, the stage says
  // so by failing – the session then falls back to the drawn figure.
  let fig = null; let failed = null;
  loadTrainer().then(({ model, images }) => {
    if (stage.setModel(model, images)) fig = { model, bones: new Float32Array(model.bones.length * 16), toStage: modelToStage(model) };
    else failed = new Error('model');
  }).catch((e) => { failed = e; });
  const trainer = createMesh(9000, 48000);
  const cat = createMesh(3000, 15000);
  const bits = createMesh(1600, 2400);
  bits.flat = true; bits.noShadow = true;
  let dpr = Math.min(1.6, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  let slow = 0; let lastWall = null; let wallT = 0;
  let lastT = null;
  const plait = []; let plaitPrev = [];
  let confetti = []; let lastIndex = -1; let doneAt = null;
  const follower = createFollower();
  const bounds = new Map();
  const { bodyOf, endOf, motionOf } = createBodyDirector(show);

  /** The space an exercise takes (centre and half extents), from a walk through its cycle. */
  function boundsOf(seg) {
    const key = `${seg.i}:${seg.side}`;
    if (bounds.has(key)) return bounds.get(key);
    const m = motionOf(seg); const list = cycleOf(m, seg.side);
    const total = list.reduce((s, p) => s + p.dur, 0) || 1;
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 10; i++) {
      for (const p of bodyPoints(bodyFlow(m, (i / 10) * total, list))) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    }
    hi[1] += BODY.head + 3; lo[1] = 0;
    const b = { c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], h: [(hi[0] - lo[0]) / 2 + 9, (hi[1] - lo[1]) / 2 + 6, (hi[2] - lo[2]) / 2 + 9], view: m.view === 'front' ? 'front' : 'side' };
    bounds.set(key, b);
    return b;
  }

  function cameraFor(seg, local, area, aspect, time, space = null) {
    const b = space || boundsOf(seg);
    const shot = shotAt(seg, local, b.view);
    const fov = 33;
    const yaw = shot.yaw * RAD; const pitch = shot.pitch * RAD;
    const tan = Math.tan((fov * RAD) / 2);
    // Distance at which the space of the exercise fits into the free area.
    const wide = b.h[0] * Math.abs(Math.cos(yaw)) + b.h[2] * Math.abs(Math.sin(yaw));
    const tall = b.h[1] * Math.cos(pitch) + (b.h[0] + b.h[2]) * 0.5 * Math.sin(pitch);
    const dist = Math.max(tall / (tan * area.h), wide / (tan * aspect * area.w)) * shot.zoom * 1.2 + Math.max(b.h[0], b.h[2]) * 0.5;
    const target = [b.c[0] + 1.2 * Math.sin(time * 0.31), b.c[1] + 0.8 * Math.sin(time * 0.23 + 1), b.c[2]];
    const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, Math.max(7, target[1] + Math.sin(pitch) * dist), target[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
    // The free area is not the middle of the canvas: shift the picture there.
    const shift = [(area.x + area.w / 2) * 2 - 1, 1 - (area.y + area.h / 2) * 2];
    return { eye, target, fov, shift };
  }

  /* ---- What makes her a person ---- */

  /** Moves the upper body (and what hangs on it) sideways – weight from one leg to the other. */
  function sway(body, time, beats) {
    const upright = body.chest[1] - body.pelvis[1] > BODY.torso * 0.8 && body.pelvis[1] > 45;
    if (!upright) return body;
    const s = Math.sin(time * 0.8) * 1.5; const s2 = Math.sin(time * 0.8 - 0.6) * 0.9;
    // Waiting, she keeps the beat in her knees.
    const dip = -1.5 * (0.5 - 0.5 * Math.cos(beats * TAU)) ** 2;
    const dp = V.add(V.mul(body.lat, s), [0, dip, 0]); const dc = V.add(V.mul(body.lat, s2), [0, dip, 0]);
    const add = (p, d) => V.add(p, d);
    const out = { ...body, pelvis: add(body.pelvis, dp), spine: add(body.spine, V.lerp(dp, dc, 0.5)), chest: add(body.chest, dc), head: add(body.head, V.mul(dc, 0.7)), legs: {}, arms: {} };
    for (const side of ['r', 'l']) {
      const g = body.legs[side]; const a = body.arms[side];
      const hip = add(g.hip, dp);
      const leg = solveLimb3(hip, g.ankle, BODY.thigh, BODY.shin, add(g.knee, V.mul(dp, 0.5)));
      out.legs[side] = { ...g, hip, knee: leg.joint };
      out.arms[side] = { sh: add(a.sh, dc), elbow: add(a.elbow, V.mul(dc, 0.9)), wrist: add(a.wrist, V.mul(dc, 0.8)) };
    }
    return out;
  }

  /** Turns the face towards the camera as far as a neck comfortably goes. */
  function faceCamera(body, eye, weight) {
    const to = V.norm(V.sub(eye, body.head));
    const c = V.dot(to, body.headFwd);
    if (c < -0.25 || weight <= 0) return body;
    // Up to about 40° of turn.
    const w = weight * clamp((c + 0.25) / 0.6, 0, 1);
    const f = V.norm(V.lerp(body.headFwd, to, clamp(w, 0, 0.62)));
    return { ...body, headFwd: f };
  }

  function swingPlait(body, dt, reset) {
    const N = 5; const L = 5.6;
    const a = plaitAnchor(body);
    const back = V.mul(body.headFwd, -1);
    if (reset || plait.length !== N || V.dist(plait[0], a) > 40) {
      plait.length = 0;
      for (let i = 0; i < N; i++) plait.push([a[0] + back[0] * i * 1.2, a[1] - i * L * 0.9, a[2] + back[2] * i * 1.2]);
      plaitPrev = plait.map((p) => p.slice());
    }
    const h = clamp(dt, 0.001, 1 / 30);
    plait[0] = a;
    for (let i = 1; i < N; i++) {
      const p = plait[i]; const q = plaitPrev[i];
      const v = [(p[0] - q[0]) * 0.93, (p[1] - q[1]) * 0.93, (p[2] - q[2]) * 0.93];
      plaitPrev[i] = p.slice();
      // Gravity, and a little spring to the back of the head so the tail keeps its shape.
      plait[i] = [p[0] + v[0] + back[0] * 14 * h * h * (N - i), p[1] + v[1] - 620 * h * h, p[2] + v[2] + back[2] * 14 * h * h * (N - i)];
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < N; i++) {
        const d = V.sub(plait[i], plait[i - 1]); const l = V.len(d) || 1;
        plait[i] = V.add(plait[i - 1], V.mul(d, L / l));
        // Not through the head, the neck or the back.
        for (const [c, r] of [[body.head, BODY.head + 2.6], [body.chest, 8.5], [V.lerp(body.chest, body.spine, 0.6), 8.5]]) {
          const o = V.sub(plait[i], c); const ol = V.len(o);
          if (ol < r) plait[i] = V.add(c, V.mul(ol > 1e-4 ? V.mul(o, 1 / ol) : back, r));
        }
        if (plait[i][1] < 1.5) plait[i][1] = 1.5;
      }
    }
    return plait;
  }

  /* ---- Confetti ---- */
  const COLOURS = [[1, 0.42, 0.37], [1, 0.82, 0.25], [0.24, 0.86, 0.6], [0.35, 0.6, 1], [1, 0.5, 0.8], [1, 1, 1]];
  function burst(origin, n = 70, power = 1) {
    for (let i = 0; i < n && confetti.length < 380; i++) {
      const a = Math.random() * TAU; const up = 150 + Math.random() * 190; const out = 30 + Math.random() * 90;
      confetti.push({ p: origin.slice(), v: [Math.cos(a) * out * power, up * power, Math.sin(a) * out * power], c: COLOURS[i % COLOURS.length], spin: Math.random() * TAU, rate: 4 + Math.random() * 9, age: 0, life: 2.2 + Math.random() * 1.4 });
    }
  }
  function stepConfetti(dt, camR, camU) {
    bits.reset();
    const h = clamp(dt, 0, 1 / 20);
    confetti = confetti.filter((q) => q.age < q.life);
    for (const q of confetti) {
      q.age += h; q.spin += q.rate * h;
      q.v[1] -= 240 * h;
      const drag = Math.exp(-1.6 * h);
      q.v[0] *= drag; q.v[2] *= drag; if (q.v[1] < -60) q.v[1] = -60 + 12 * Math.sin(q.spin);
      q.p[0] += q.v[0] * h + Math.sin(q.spin * 0.7) * 10 * h; q.p[1] = Math.max(0.4, q.p[1] + q.v[1] * h); q.p[2] += q.v[2] * h;
      const s = 2.1; const cs = Math.cos(q.spin); const sn = Math.sin(q.spin);
      const ax = [camR[0] * cs + camU[0] * sn, camR[1] * cs + camU[1] * sn, camR[2] * cs + camU[2] * sn];
      const ay = V.mul([camU[0] * cs - camR[0] * sn, camU[1] * cs - camR[1] * sn, camU[2] * cs - camR[2] * sn], Math.cos(q.spin * 1.7));
      const fade = clamp((q.life - q.age) * 2, 0, 1);
      const o = bits.nv * STRIDE; const v = bits.v;
      const corners = [[-s, -s * 0.6], [s, -s * 0.6], [s, s * 0.6], [-s, s * 0.6]];
      for (let k = 0; k < 4; k++) {
        const [cx, cy] = corners[k]; const j = o + k * STRIDE;
        v[j] = q.p[0] + ax[0] * cx + ay[0] * cy * fade; v[j + 1] = q.p[1] + ax[1] * cx + ay[1] * cy * fade; v[j + 2] = q.p[2] + ax[2] * cx + ay[2] * cy * fade;
        v[j + 3] = 0; v[j + 4] = 1; v[j + 5] = 0; v[j + 6] = q.c[0]; v[j + 7] = q.c[1]; v[j + 8] = q.c[2]; v[j + 9] = 0; v[j + 10] = 0;
      }
      const b = bits.nv; bits.nv += 4;
      bits.i[bits.ni++] = b; bits.i[bits.ni++] = b + 1; bits.i[bits.ni++] = b + 2; bits.i[bits.ni++] = b; bits.i[bits.ni++] = b + 2; bits.i[bits.ni++] = b + 3;
    }
  }

  /* ---- A frame ---- */
  function render(T, st, env = {}) {
    if (failed) throw failed;
    const world = LOOKS[lookName];
    const area = env.area || { x: 0, y: 0, w: 1, h: 1 };
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const raw = lastWall == null ? 0 : wall - lastWall;
    const wdt = clamp(raw, 0, 0.1);
    lastWall = wall; wallT += wdt;
    const jumped = lastT == null || Math.abs(T - lastT) > 0.5;
    // The body lives on the time of the session; while that stands still (pause), on the clock on the wall.
    const moved = lastT == null ? 0 : T - lastT;
    lastT = T;
    const W = canvas.clientWidth || canvas.width; const H = canvas.clientHeight || canvas.height;
    stage.resize(W, H, dpr);
    const aspect = W / Math.max(1, H);
    const done = !!st.done;
    const seg = st.seg;
    const local = done ? seg.dur : st.local;
    const beat = 60 / (seg.bpm || 110);

    // Body.
    let body;
    if (done) {
      // Finished: she jumps for joy.
      if (doneAt == null) doneAt = wallT;
      const jj = MOTIONS.jumping_jack || motionOf(seg);
      const list = cycleOf(jj);
      const cheer = bodyFlow(jj, (wallT - doneAt) * 1.1, list);
      body = blendBodies(endOf(show.segs.length - 1), cheer, smooth((wallT - doneAt) / 0.9));
    } else {
      doneAt = null;
      // The body with weight runs a moment behind what it follows: aim that moment ahead, so it stays on the beat.
      const ahead = showStateAt(show, T + LEAD);
      body = bodyOf(ahead.done ? st : ahead);
    }
    const waiting = !done && st.anim && st.anim.clip && st.anim.clip.speed === 0;
    if (waiting) body = sway(body, wallT, local / beat);
    if (jumped) follower.reset();
    const bodyDt = !jumped && moved > 1e-6 ? moved : wdt;
    body = follower.step(body, bodyDt);

    // Camera.
    const camSeg = done ? { ...seg, kind: 'rest' } : seg;
    const cam = cameraFor(camSeg, done ? ((wallT - doneAt) % 24) / 24 * seg.dur : local, area, aspect, wallT, done ? CHEER_SPACE : null);
    const upright = body.headUp[1] > 0.75;
    body = faceCamera(body, cam.eye, upright ? (seg.kind === 'work' && !done ? 0.4 : 0.85) : 0.15);
    body = aboveFloor(body);

    // Life: breath, blink, a smile that grows when it is done.
    const blinkAt = wallT % 3.7;
    const fx = {
      breath: Math.sin(wallT * (seg.kind === 'work' ? 2.7 : 1.9)),
      blink: blinkAt < 0.13 ? Math.sin((blinkAt / 0.13) * Math.PI) : 0,
      smile: done ? 1 : seg.kind === 'work' ? 0.45 : 0.8,
      mouth: 0,
    };
    let glow = 0.22;
    if (!done && seg.kind === 'work' && seg.cyc) {
      const k = (local % seg.cyc) / seg.cyc;
      glow = 0.35 + 0.65 * Math.sin(k * Math.PI) ** 2;
      fx.mouth = 0.5 * Math.sin(k * Math.PI) ** 2;
    }
    const m = motionOf(seg);
    trainer.reset();
    let model = null;
    if (fig) {
      // The model's skeleton takes the pose: contacts stay, her own proportions decide the rest.
      skinMatrices(fig.model, poseSkeleton(fig.model, jointsForModel(retarget(body, fig.model.rig))), fig.bones);
      model = { bones: fig.bones, toStage: fig.toStage, look: lookName };
    }

    // Confetti when an exercise is done, and a lot of it at the end.
    if (!jumped && lastIndex >= 0 && st.index !== lastIndex && show.segs[lastIndex].kind === 'work') burst([body.pelvis[0], 70, body.pelvis[2]], 70);
    if (done && lastIndex !== -2) { burst([body.pelvis[0] - 40, 60, 0], 120, 1.2); burst([body.pelvis[0] + 40, 60, 0], 120, 1.2); }
    lastIndex = done ? -2 : st.index;

    // The cat: watches, bobs with the music, joins in with a paw, stretches in the rests.
    const working = !done && seg.kind === 'work';
    const bob = Math.max(0, Math.sin((local / (beat * 2)) * TAU));
    const restK = !working && !done ? clamp(local / seg.dur, 0, 1) : 0;
    const catFx = {
      tail: Math.sin((wallT / (beat * 4)) * TAU),
      look: body.head,
      blink: (wallT + 1.3) % 4.9 < 0.12 ? 1 : 0,
      hop: done ? 9 * Math.abs(Math.sin(wallT * 5.2)) : working ? 1.6 * bob * bob : 0,
      paw: working && seg.cyc ? Math.max(0, Math.sin((local / seg.cyc) * TAU)) ** 2 : done ? 1 : 0,
      stretch: seg.kind === 'rest' || seg.kind === 'roundRest' ? smooth((restK - 0.25) / 0.15) * (1 - smooth((restK - 0.6) / 0.15)) : 0,
      sit: 1,
    };
    const toTrainer = V.norm([body.pelvis[0] - CAT_AT[0], 0, body.pelvis[2] - CAT_AT[2]]);
    const toCam = V.norm([cam.eye[0] - CAT_AT[0], 0, cam.eye[2] - CAT_AT[2]]);
    cat.reset();
    buildCat(cat, CAT_AT, V.norm(V.lerp(toTrainer, toCam, 0.45)), catFx);

    // Soft shadows where the body meets the floor.
    const blobs = [];
    for (const side of ['r', 'l']) {
      const g = body.legs[side];
      blobs.push([(g.heel[0] + g.toe[0]) / 2, (g.heel[2] + g.toe[2]) / 2, 13, clamp(1 - (g.ankle[1] - BODY.ankle) / 12, 0, 1)]);
    }
    blobs.push([body.pelvis[0], body.pelvis[2], 36, clamp(1.15 - body.pelvis[1] / 34, 0.22, 1)]);
    blobs.push([body.chest[0], body.chest[2], 30, clamp(1 - body.chest[1] / 26, 0, 1)]);
    blobs.push([CAT_AT[0] - 1, CAT_AT[2], 15, clamp(1 - catFx.hop / 8, 0.3, 0.9)]);

    // Floor ring when a repetition is done.
    let pulse = 0;
    if (working && seg.cyc && local > seg.cyc * 0.98) pulse = clamp((local % seg.cyc) / 0.75, 0, 1);

    const frame = { cam, world, time: wallT, beat: 1 - clamp((local % beat) / beat, 0, 1), pulse, pulseAt: [body.pelvis[0], body.pelvis[2]], meshes: [trainer, cat, bits], model, glow, mat: MAT, blobs };
    // Confetti needs the camera axes: one frame late is fine.
    stepConfetti(wdt, lastAxes.r, lastAxes.u);
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const drawn = stage.draw(frame);
    if (drawn) {
      const rl = Math.hypot(drawn.r[0], drawn.r[1], drawn.r[2]) || 1; const ul = Math.hypot(drawn.u[0], drawn.u[1], drawn.u[2]) || 1;
      lastAxes = { r: V.mul(drawn.r, 1 / rl), u: V.mul(drawn.u, 1 / ul) };
    }
    // A device that cannot keep up gets a coarser picture rather than a jerky one.
    if (raw > 0.03 && raw < 0.5) slow += 1; else slow = Math.max(0, slow - 0.25);
    if (slow > 18 && dpr > 0.85) { dpr = Math.max(0.85, dpr - 0.2); slow = 0; }
    return drawn ? { head: projectPoint(drawn.vp, body.head), ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0, dpr } : null;
  }
  let lastAxes = { r: [1, 0, 0], u: [0, 1, 0] };

  return {
    render,
    /** The look of the stage: 'natural' | 'night' | 'drawn'. */
    setLook(name) { if (LOOKS[name]) lookName = name; },
    get look() { return lookName; },
    /** Confetti from outside (a goal reached). */
    cheer(n = 90) { burst([0, 70, 0], n, 1.1); },
    destroy() { stage.destroy(); },
    get lost() { return stage.lost; },
    /** For checks: the body the stage shows at a state. */
    bodyOf,
  };
}
