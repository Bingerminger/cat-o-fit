// The 3D stage (since 4.2): every exercise becomes a body in space and a surface that can be drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS } from '../js/exercise-motions.js';
import { BODY, cycleOf, introOf, frameAt, solvePose } from '../js/motion-rig.js';
import { vec as V, lift, bodyAt, blendBodies, bodyPoints, solveLimb3 } from '../js/body3d.js';
import { createMesh, buildTrainer, buildCat, plaitAnchor, STRIDE, TRAINERS } from '../js/stage-mesh.js';
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

test('Every exercise as a surface: both trainers, numbers only, indices inside the mesh, room to spare', () => {
  const mesh = createMesh();
  for (const [id, m] of Object.entries(MOTIONS)) {
    const list = cycleOf(m);
    const total = sum(list);
    for (const look of Object.keys(TRAINERS)) {
      for (let i = 0; i < 4; i++) {
        const b = bodyAt(m, (i / 4) * total, list);
        const a = plaitAnchor(b);
        mesh.reset();
        buildTrainer(mesh, b, look, new Set(m.focus || []), [a, [a[0], a[1] - 5, a[2]], [a[0], a[1] - 10, a[2]], [a[0], a[1] - 15, a[2]], [a[0], a[1] - 20, a[2]]], { blink: 0.5, breath: 1, smile: 1, mouth: 0.5 });
        assert.ok(mesh.nv > 1000 && mesh.nv * STRIDE <= mesh.v.length * 0.6, `${id}/${look}: ${mesh.nv} vertices`);
        assert.ok(mesh.ni <= mesh.i.length * 0.6, `${id}/${look}: ${mesh.ni} indices`);
        for (let k = 0; k < mesh.nv * STRIDE; k++) if (!Number.isFinite(mesh.v[k])) assert.fail(`${id}/${look}: vertex value ${k} is not a number`);
        for (let k = 0; k < mesh.ni; k++) if (mesh.i[k] >= mesh.nv) assert.fail(`${id}/${look}: index out of the mesh`);
      }
    }
  }
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
