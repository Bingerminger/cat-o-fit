// The trainer model (since 4.2): its skeleton, posed in JavaScript, lands where Blender put it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseModel, poseSkeleton, skinMatrices, skinnedVertex, jointsForModel, modelToStage, stageScale, FACE } from '../js/stage-model.js';
import { MOTIONS } from '../js/exercise-motions.js';
import { cycleOf } from '../js/motion-rig.js';
import { bodyFlow } from '../js/body3d.js';
import { retarget } from '../js/stage-rig.js';

const dir = new URL('../assets/trainer/', import.meta.url);
const doc = JSON.parse(readFileSync(new URL('trainer.json', dir), 'utf8'));
const bin = readFileSync(new URL('trainer.bin', dir));
const model = parseModel(doc, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/trainer-pose.json', import.meta.url), 'utf8'));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('The model: a skeleton of 23 bones, meshes whose weights add up and whose indices stay inside', () => {
  assert.equal(model.bones.length, 23);
  assert.equal(doc.bytes, bin.byteLength);
  let total = 0;
  for (const m of model.meshes) {
    const n = m.position.length / 3;
    total += n;
    assert.ok(n > 0 && n <= 65535, `${m.name}: ${n} vertices`);
    for (let i = 0; i < n; i++) {
      const w = m.weight[i * 4] + m.weight[i * 4 + 1] + m.weight[i * 4 + 2] + m.weight[i * 4 + 3];
      if (w !== 255) assert.fail(`${m.name}: the weights of vertex ${i} add up to ${w}`);
      for (let j = 0; j < 4; j++) if (m.bone[i * 4 + j] >= 23) assert.fail(`${m.name}: a bone that does not exist`);
    }
    for (const k of m.indices) if (k >= n) assert.fail(`${m.name}: an index outside the mesh`);
    assert.ok(m.texture, `${m.name} has no texture`);
  }
  assert.ok(total < 30000, `${total} vertices`);
  assert.ok(model.meshes.some((m) => m.kind === 'skin') && model.meshes.some((m) => m.kind === 'hair'));
});

test('Posing: every bone and the skinned surface are where Blender has them, to the millimetre', () => {
  const body = model.meshes.find((m) => m.kind === 'skin');
  assert.ok(fixture.frames.length >= 3);
  for (const fr of fixture.frames) {
    const pose = poseSkeleton(model, fr.input);
    for (const [name, head] of Object.entries(fr.heads)) {
      const d = dist(pose[model.index[name]].t, head);
      assert.ok(d < 0.001, `frame ${fr.frame}: ${name} is ${(d * 1000).toFixed(2)} mm off`);
    }
    const mats = skinMatrices(model, pose);
    fr.pick.forEach((vi, k) => {
      const d = dist(skinnedVertex(body, mats, vi), fr.verts[k]);
      assert.ok(d < 0.001, `frame ${fr.frame}: vertex ${vi} is ${(d * 1000).toFixed(2)} mm off`);
    });
  }
});

test('At rest the skeleton leaves the surface where it is', () => {
  // The body of an exercise that stands upright, arms hanging: feet on the floor, head on top.
  const m = MOTIONS.squat;
  const r = retarget(bodyFlow(m, 0, cycleOf(m)), model.rig);
  const pose = poseSkeleton(model, jointsForModel(r));
  const mats = skinMatrices(model, pose);
  const body = model.meshes.find((x) => x.kind === 'skin');
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < body.position.length / 3; i += 7) { const p = skinnedVertex(body, mats, i); lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
  assert.ok(hi > 1.5 && hi < 1.85, `the head is at ${hi.toFixed(2)} m`);
  assert.ok(lo > -0.05, `something is ${lo.toFixed(2)} m under the floor`);
  // On the stage she is as tall as the figures of motion-rig.js, and model-up is stage-up.
  const k = stageScale(model);
  assert.ok(k > 60 && k < 90);
  const M = modelToStage(model);
  assert.deepEqual([M[8], M[9], M[10]].map((x) => Math.round(x * 1000) / 1000), [0, Math.round(k * 1000) / 1000, 0]);
});

test('Every exercise poses the skeleton with numbers only', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const list = cycleOf(m);
    const total = list.reduce((s, p) => s + p.dur, 0);
    for (let i = 0; i < 5; i++) {
      const pose = poseSkeleton(model, jointsForModel(retarget(bodyFlow(m, (i / 5) * total, list), model.rig)));
      for (const b of pose) for (const x of [...b.r, ...b.t]) if (!Number.isFinite(x)) assert.fail(`${id}: a bone is not a number`);
    }
  }
});

test('The face: eyelids that close and a smile, as small offsets of the skin and of the lashes on it', () => {
  const skin = model.meshes.find((m) => m.kind === 'skin');
  const lashes = model.meshes.find((m) => m.name.startsWith('eyelash'));
  const far = (shape) => { let most = 0; let moved = 0; for (let i = 0; i < shape.length; i += 3) { const d = Math.hypot(shape[i], shape[i + 1], shape[i + 2]); if (d > 0) moved += 1; most = Math.max(most, d); } return { most, moved }; };
  for (const name of FACE) {
    const shape = skin.morphs[name];
    assert.ok(shape && shape.length === skin.position.length, `${name}: one offset per vertex of the skin`);
    const { most, moved } = far(shape);
    // A face shape moves a few hundred vertices by millimetres – not the body, and not by centimetres.
    assert.ok(moved > 100 && moved < skin.position.length / 3 / 8, `${name}: ${moved} vertices move`);
    assert.ok(most > 0.004 && most < 0.02, `${name}: moves up to ${(most * 1000).toFixed(1)} mm`);
  }
  // The lashes sit on the lids: they close with them.
  assert.ok(lashes.morphs.blink && far(lashes.morphs.blink).most > 0.004, 'the lashes follow the lids');
  // What has no face stays out of it.
  for (const m of model.meshes) if (m.kind === 'hair' || m.kind === 'cloth' || m.kind === 'eye') assert.deepEqual(Object.keys(m.morphs), [], `${m.name} has no face shapes`);
});
