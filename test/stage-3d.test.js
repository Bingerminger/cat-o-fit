// The 3D stage (since 4.2): every exercise becomes a body in space and a surface that can be drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS } from '../js/exercise-motions.js';
import { BODY, cycleOf, introOf, frameAt, solvePose } from '../js/motion-rig.js';
import { vec as V, lift, bodyAt, bodyFlow, createFollower, blendBodies, bodyPoints, solveLimb3 } from '../js/body3d.js';
import { buildShow, programForWorkout } from '../js/show-program.js';
import { WORKOUTS } from '../js/workouts.js';
import { createMesh, buildCat, buildGear, STRIDE } from '../js/stage-mesh.js';
import { cameraOf, projectPoint } from '../js/stage-gl.js';

const sum = (list) => list.reduce((s, p) => s + p.dur, 0);
const sidesOf = (m) => (m.sides === 'each' ? ['a', 'b'] : ['a']);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('Every exercise, every side: a body with whole bones at every moment of its cycle and its way in', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    for (const side of sidesOf(m)) {
      for (const [list, once] of [[cycleOf(m, side), false], [introOf(m, side), true]]) {
        if (!list.length) continue;
        const total = sum(list);
        for (let i = 0; i < 9; i++) {
          const b = bodyAt(m, (i / 9) * total, list, { once });
          for (const p of bodyPoints(b)) for (const x of p) assert.ok(Number.isFinite(x), `${id}/${side}: a joint is not a number`);
          for (const s of ['r', 'l']) {
            near(V.dist(b.legs[s].hip, b.legs[s].knee), BODY.thigh, 0.05, `${id}/${side} thigh`);
            near(V.dist(b.legs[s].knee, b.legs[s].ankle), BODY.shin, 0.05, `${id}/${side} shin`);
            near(V.dist(b.arms[s].sh, b.arms[s].elbow), BODY.upper, 0.05, `${id}/${side} upper arm`);
            near(V.dist(b.arms[s].elbow, b.arms[s].wrist), BODY.fore, 0.05, `${id}/${side} forearm`);
          }
          near(V.dist(b.pelvis, b.chest), BODY.torso, 0.05, `${id}/${side} torso`);
        }
      }
    }
  }
});

test('Equipment: every exercise that names some gets a surface – numbers only, indices inside the mesh', () => {
  const mesh = createMesh(6000, 30000);
  const seen = new Set();
  for (const [id, m] of Object.entries(MOTIONS)) {
    const list = cycleOf(m);
    const total = sum(list);
    const kinds = [...Object.values(m.hold || {}), ...Object.keys(m.props || {}).filter((k) => !/mat/i.test(k))];
    for (let i = 0; i < 4; i++) {
      const b = bodyAt(m, (i / 4) * total, list);
      const hands = {};
      for (const s of ['r', 'l']) hands[s] = { at: b.arms[s].wrist, along: V.norm(V.sub(b.arms[s].wrist, b.arms[s].elbow)) };
      hands.points = { rh: hands.r.at, lh: hands.l.at, rk: V.lerp(b.legs.r.knee, b.legs.r.hip, 0.16), lk: V.lerp(b.legs.l.knee, b.legs.l.hip, 0.16) };
      for (const swap of [false, true]) {
        mesh.reset();
        buildGear(mesh, m, hands, b.lat, swap);
        assert.equal(mesh.nv > 0, kinds.length > 0, `${id}: ${kinds.join(', ') || 'no equipment'} but ${mesh.nv} vertices`);
        assert.ok(mesh.nv * STRIDE <= mesh.v.length * 0.7 && mesh.ni <= mesh.i.length * 0.7, `${id}: ${mesh.nv} vertices, ${mesh.ni} indices`);
        for (let k = 0; k < mesh.nv * STRIDE; k++) if (!Number.isFinite(mesh.v[k])) assert.fail(`${id}: vertex value ${k} is not a number`);
        for (let k = 0; k < mesh.ni; k++) if (mesh.i[k] >= mesh.nv) assert.fail(`${id}: index out of the mesh`);
      }
    }
    for (const k of kinds) seen.add(k);
  }
  for (const k of ['db', 'kb', 'ball', 'box', 'wall', 'bar', 'band']) assert.ok(seen.has(k), `no exercise with ${k} – the check would prove nothing`);
});

test('A way in that is played once rests in its first and last pose – the other end is not mixed in', () => {
  let bites = 0;
  for (const [id, m] of Object.entries(MOTIONS)) {
    const list = introOf(m);
    if (!list.length) continue;
    const total = sum(list);
    for (const t of [0, total - 1e-4]) {
      const still = lift(solvePose(frameAt(m, t, list).pose, m.view), m);
      const held = bodyAt(m, t, list, { once: true });
      const wrapped = bodyAt(m, t, list);
      for (const s of ['r', 'l']) {
        near(V.dist(held.arms[s].wrist, still.arms[s].wrist), 0, 0.6, `${id}: wrist of the held pose`);
        near(V.dist(held.legs[s].ankle, still.legs[s].ankle), 0, 0.6, `${id}: ankle of the held pose`);
        if (V.dist(wrapped.arms[s].wrist, still.arms[s].wrist) > 2 || V.dist(wrapped.legs[s].ankle, still.legs[s].ankle) > 2) bites += 1;
      }
    }
  }
  // Without `once` the two ends are mixed: this is what the option is for.
  assert.ok(bites > 0, 'no way in whose ends differ – the check would prove nothing');
});

test('Crossing two bodies keeps every bone whole and nothing below the floor', () => {
  const stand = bodyAt(MOTIONS.squat, 0, cycleOf(MOTIONS.squat));
  const plank = bodyAt(MOTIONS.pushup, 0, cycleOf(MOTIONS.pushup));
  for (let i = 0; i <= 10; i++) {
    const b = blendBodies(stand, plank, i / 10);
    for (const s of ['r', 'l']) {
      near(V.dist(b.legs[s].hip, b.legs[s].knee), BODY.thigh, 1e-6, 'thigh');
      near(V.dist(b.arms[s].elbow, b.arms[s].wrist), BODY.fore, 1e-6, 'forearm');
      assert.ok(b.legs[s].ankle[1] >= BODY.ankle - 1e-6 && b.arms[s].wrist[1] >= BODY.wrist - 1e-6, `below the floor at ${i / 10}`);
    }
  }
});

test('A limb out of reach is pulled in, a limb in reach ends where it should', () => {
  const far = solveLimb3([0, 0, 0], [100, 0, 0], 30, 30, [0, 10, 0]);
  near(V.len(far.end), 60, 1e-3, 'reach');
  const ok = solveLimb3([0, 0, 0], [40, 0, 0], 30, 30, [0, 10, 0]);
  near(V.dist(ok.end, [40, 0, 0]), 0, 1e-9, 'end');
  near(V.dist(ok.joint, [0, 0, 0]), 30, 1e-9, 'first bone');
  assert.ok(ok.joint[1] > 0, 'the joint bends to the side of the pole');
});

test('Camera: the target lands in the middle of the picture, or where the picture is shifted to', () => {
  const cam = { eye: [120, 80, 300], target: [5, 60, -10], fov: 33 };
  const mid = projectPoint(cameraOf(cam, 4 / 3).vp, cam.target);
  near(mid.x, 0.5, 1e-6, 'x'); near(mid.y, 0.5, 1e-6, 'y'); assert.ok(mid.front);
  const off = projectPoint(cameraOf({ ...cam, shift: [-0.3, 0.2] }, 4 / 3).vp, cam.target);
  near(off.x, 0.35, 1e-6, 'shifted x'); near(off.y, 0.4, 1e-6, 'shifted y');
  assert.equal(projectPoint(cameraOf(cam, 4 / 3).vp, [240, 100, 620]).front, false, 'a point behind the camera');
});

test('The cat is a surface too', () => {
  const mesh = createMesh(3000, 15000);
  buildCat(mesh, [90, 0, 60], [-0.6, 0, 0.8], { tail: 0.5, look: [0, 110, 0], hop: 4, paw: 1, stretch: 1, blink: 1 });
  assert.ok(mesh.nv > 300 && mesh.nv * STRIDE < mesh.v.length * 0.7);
  for (let k = 0; k < mesh.nv * STRIDE; k++) if (!Number.isFinite(mesh.v[k])) assert.fail('cat vertex is not a number');
});

test('The flowing movement: exact in the poses at the ends of a section, without a stop where it carries on', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const list = cycleOf(m);
    let t = 0;
    for (const ph of list) {
      // At the start of every section the body is in that section's first pose.
      const want = lift(solvePose(frameAt(m, t + 1e-6, list).pose, m.view), m);
      const got = bodyFlow(m, t + 1e-6, list);
      for (const s of ['r', 'l']) near(V.dist(got.arms[s].wrist, want.arms[s].wrist), 0, 0.2, `${id}: wrist at the start of a section`);
      near(V.dist(got.pelvis, want.pelvis), 0, 0.2, `${id}: pelvis at the start of a section`);
      t += ph.dur;
    }
  }
  // A reverse lunge steps back and lowers in one go: at the join the pelvis keeps moving (eased sections stop there).
  const m = MOTIONS.reverse_lunge; const list = cycleOf(m);
  const join = list[0].dur;
  const speed = (fn) => V.dist(fn(join + 0.02), fn(join - 0.02)) / 0.04;
  const flowing = speed((t) => bodyFlow(m, t, list).legs.l.ankle) + speed((t) => bodyFlow(m, t, list).legs.r.ankle) + speed((t) => bodyFlow(m, t, list).pelvis);
  const eased = speed((t) => lift(solvePose(frameAt(m, t, list).pose, m.view), m).pelvis) + speed((t) => lift(solvePose(frameAt(m, t, list).pose, m.view), m).legs.l.ankle) + speed((t) => lift(solvePose(frameAt(m, t, list).pose, m.view), m).legs.r.ankle);
  assert.ok(flowing > eased + 3, `the join flows: ${flowing.toFixed(1)} against ${eased.toFixed(1)} units per second`);
});

test('A body with weight: bones whole, standing feet and carrying hands exactly in place, and it arrives', () => {
  for (const id of ['squat', 'pushup', 'jumping_jack', 'mountain_climber', 'glute_bridge', 'lateral_raise']) {
    const m = MOTIONS[id]; const list = cycleOf(m);
    const total = sum(list);
    const f = createFollower();
    let far = 0;
    for (let t = 0; t < 2 * total; t += 1 / 60) {
      // As on the stage: the body aims a moment ahead of the clock, so that it is on time.
      const T = bodyFlow(m, t + 0.07, list);
      const now = bodyFlow(m, t, list);
      const b = f.step(T, 1 / 60);
      for (const p of bodyPoints(b)) for (const x of p) assert.ok(Number.isFinite(x), `${id}: not a number`);
      for (const s of ['r', 'l']) {
        near(V.dist(b.legs[s].hip, b.legs[s].knee), BODY.thigh, 0.05, `${id} thigh`);
        near(V.dist(b.arms[s].elbow, b.arms[s].wrist), BODY.fore, 0.05, `${id} forearm`);
        if (T.legs[s].ankle[1] < BODY.ankle + 1.5) near(V.dist(b.legs[s].ankle, T.legs[s].ankle), 0, 0.3, `${id}: a standing foot slides`);
        if (T.arms[s].wrist[1] < BODY.wrist + 1.5) near(V.dist(b.arms[s].wrist, T.arms[s].wrist), 0, 0.3, `${id}: a carrying hand slides`);
        if (t > 0.5) far = Math.max(far, V.dist(b.arms[s].wrist, now.arms[s].wrist));
      }
      if (t > 0.5) far = Math.max(far, V.dist(b.pelvis, now.pelvis));
    }
    // It runs behind, but not away.
    assert.ok(far < 12, `${id}: the body is ${far.toFixed(1)} units away from its movement`);
    // Held still, it comes to rest in the pose.
    const still = bodyFlow(m, 0, list);
    let b = null;
    for (let i = 0; i < 180; i++) b = f.step(still, 1 / 60);
    near(V.dist(b.pelvis, still.pelvis), 0, 0.05, `${id}: pelvis at rest`);
    near(V.dist(b.arms.r.wrist, still.arms.r.wrist), 0, 0.1, `${id}: wrist at rest`);
  }
});

test('Pace: a brisk session moves quicker than written, and still on the beat', () => {
  const w = WORKOUTS[0];
  const calm = buildShow(programForWorkout(w));
  const brisk = buildShow({ ...programForWorkout(w), pace: 1.4 });
  const cyc = (show, i) => show.segs.find((s) => s.kind === 'work' && s.i === i).cyc;
  let quicker = 0;
  programForWorkout(w).items.forEach((it, i) => {
    assert.ok(cyc(brisk, i) <= cyc(calm, i) + 1e-9, `${it.id}: brisk is slower than calm`);
    if (cyc(brisk, i) < cyc(calm, i) * 0.85) quicker += 1;
  });
  assert.ok(quicker >= 3, `only ${quicker} exercises got clearly quicker`);
  for (const s of brisk.segs) {
    if (s.kind !== 'work' || !s.cyc) continue;
    const beats = s.cyc / (60 / s.bpm);
    near(beats * 2, Math.round(beats * 2), 1e-6, 'a repetition lasts whole or half beats');
  }
});

test('The cat changes sides round the end of the mat – never across it, and it arrives', async () => {
  const { catWay } = await import('../js/stage-show.js');
  const onMat = (p) => Math.abs(p[0]) <= 104 && Math.abs(p[2]) <= 38;
  const walk = (from, to, way = catWay) => {
    let at = [...from]; let crossed = false;
    for (let i = 0; i < 4000; i++) {
      const aim = way(at, to); const d = [aim[0] - at[0], 0, aim[2] - at[2]]; const far = Math.hypot(d[0], d[2]);
      if (far < 0.5 && aim === to) return { arrived: true, crossed };
      const step = Math.min(far, 75 / 60);
      if (far > 1e-9) at = [at[0] + (d[0] * step) / far, 0, at[2] + (d[2] * step) / far];
      if (onMat(at)) crossed = true;
    }
    return { arrived: false, crossed };
  };
  for (const [from, to] of [[[34, 0, -80], [34, 0, 80]], [[74, 0, -44], [34, 0, 80]], [[34, 0, 80], [74, 0, -44]], [[74, 0, 44], [74, 0, -44]]]) {
    const r = walk(from, to);
    assert.ok(r.arrived, `from ${from} to ${to}: it never gets there`);
    assert.ok(!r.crossed, `from ${from} to ${to}: it walks over the mat`);
  }
  // On the same side it goes straight.
  assert.deepEqual(catWay([34, 0, -80], [74, 0, -44]), [74, 0, -44]);
  // The straight line it would take otherwise does cross the mat: this is what the detour is for.
  assert.ok(walk([34, 0, -80], [34, 0, 80], (at, to) => to).crossed, 'a straight line would not cross – the check would prove nothing');
});
