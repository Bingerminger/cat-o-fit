/* Animated exercises (3.22.0): every exercise has a sequence, the sequences are
   consistent in themselves (keys present, loop ends in the start pose, cues short), the
   figure stays intact (no NaN, targets reachable, nothing below the floor) and the
   drawing delivers SVG for tile, still image and animation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../js/exercises.js';
import { MOTIONS, motionFor } from '../js/exercise-motions.js';
import { solvePose, posePoints, cycleOf, introOf, frameAt, keyPose, dist, blendPose, BODY } from '../js/motion-rig.js';
import { motionSVG, frameSVG, thumbKeys, viewBoxOf, mountFigure } from '../js/motion-figure.js';

const FOCUS = new Set(['torso', 'thigh', 'shin', 'foot', 'upper', 'fore', 'hip']);
const sides = (m) => (m.sides === 'each' || m.sides === 'alternate' ? ['a', 'b'] : ['a']);
const frames = (m, list, n = 24) => {
  const total = list.reduce((s, p) => s + p.dur, 0);
  return Array.from({ length: n + 1 }, (_, i) => frameAt(m, Math.min(total - 1e-6, (i / n) * total), list));
};

test('every exercise has a sequence – and every sequence belongs to an exercise', () => {
  const ids = new Set(EXERCISES.map((e) => e.id));
  for (const e of EXERCISES) assert.ok(motionFor(e.id), `sequence missing: ${e.id}`);
  for (const id of Object.keys(MOTIONS)) assert.ok(ids.has(id), `sequence without exercise: ${id}`);
  assert.ok(EXERCISES.length >= 90, `${EXERCISES.length} exercises`);
});

test('Sequences are consistent: keys, loop, tempo, cues, highlighting', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    assert.ok(['side', 'front'].includes(m.view), `${id}: view`);
    assert.ok(m.keys[m.start], `${id}: start pose`);
    assert.ok((m.reps != null) !== (m.holdS != null), `${id}: exactly repetitions OR seconds`);
    assert.ok(m.seq.length > 0, `${id}: sequence empty`);
    let cur = m.start;
    for (const ph of m.seq) {
      if (ph.to) assert.ok(m.keys[ph.to], `${id}: pose ${ph.to}`);
      const dur = ph.hold != null ? ph.hold : ph.s;
      assert.ok(dur > 0 && dur <= 30, `${id}: duration ${dur}`);
      assert.ok(!ph.cue || ph.cue.length <= 44, `${id}: cue too long ("${ph.cue}")`);
      assert.ok(!ph.breath || ['ein', 'aus', 'steady', 'calm'].includes(ph.breath), `${id}: breathing ${ph.breath}`);
      cur = ph.to || cur;
    }
    assert.equal(cur, m.start, `${id}: pass does not end in the start pose`);
    if (m.intro) {
      assert.ok(m.keys[m.intro.from], `${id}: intro without a pose`);
      let c = m.intro.from; for (const ph of m.intro.seq) c = ph.to || c;
      assert.equal(c, m.start, `${id}: intro does not end in the start pose`);
    }
    assert.ok((m.focus || []).every((f) => FOCUS.has(f)), `${id}: highlighting ${m.focus}`);
    assert.ok(!m.sides || ['alternate', 'each'].includes(m.sides), `${id}: sides`);
  }
});

test('Hold exercises in the catalogue = sequences with seconds', () => {
  for (const e of EXERCISES) assert.equal(e.hold, MOTIONS[e.id].holdS != null, e.id);
});

test('Figure stays intact: targets reachable, limbs in length, no NaN, nothing below the floor', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    for (const side of sides(m)) {
      for (const key of Object.keys(m.keys)) {
        const p = keyPose(m, key, side);
        const S = solvePose(p, m.view);
        for (const g of ['legs', 'arms']) {
          for (const s of ['r', 'l']) {
            const spec = (p[g] || {})[s];
            if (spec && spec.at) assert.ok(dist(S[g][s].end, spec.at) < 2, `${id}/${key}/${side}: ${g}.${s} does not reach the target`);
            const [a, b] = g === 'legs' ? [BODY.thigh, BODY.shin] : [BODY.upper, BODY.fore];
            const L = S[g][s];
            assert.ok(dist(L.root, L.joint) <= a + 0.01 && dist(L.joint, L.end) <= b + 0.01, `${id}/${key}: ${g}.${s} too long`);
          }
        }
      }
      for (const list of [introOf(m, side), cycleOf(m, side)]) {
        if (!list.length) continue;
        for (const fr of frames(m, list)) {
          for (const pt of posePoints(solvePose(fr.pose, m.view))) {
            assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]), `${id}: NaN`);
            if (m.floor !== false) assert.ok(pt[1] <= 4, `${id}: point below the floor (y=${pt[1].toFixed(1)})`);
          }
        }
      }
    }
  }
});

test('planted feet and hands stay put during the transition', () => {
  const m = MOTIONS.squat;
  const A = m.keys.up; const B = m.keys.down;
  for (let k = 0; k <= 1; k += 0.1) {
    const S = solvePose(blendPose(A, B, k, 'side'), 'side');
    assert.ok(dist(S.legs.r.end, A.legs.r.at) < 0.01, `foot moves at k=${k.toFixed(1)}`);
  }
  const pu = MOTIONS.pushup;
  for (let k = 0; k <= 1; k += 0.25) {
    const S = solvePose(blendPose(pu.keys.up, pu.keys.down, k, 'side'), 'side');
    assert.ok(dist(S.arms.r.end, pu.keys.up.arms.r.at) < 0.1, 'hand moves during the push-up');
  }
});

test('Side change: "per side" and "alternating" mirror the pose', () => {
  const lunge = MOTIONS.lunge;
  const a = solvePose(keyPose(lunge, 'down', 'a'), 'side');
  const b = solvePose(keyPose(lunge, 'down', 'b'), 'side');
  assert.ok(a.legs.r.end[0] > a.legs.l.end[0], 'side a: right (near) leg in front');
  assert.ok(b.legs.l.end[0] > b.legs.r.end[0], 'side b: left (far) leg in front');
  const cyc = cycleOf(lunge);
  assert.deepEqual([...new Set(cyc.map((p) => p.pass))], ['a', 'b'], 'alternating: both sides in one pass');
  assert.deepEqual([...new Set(cycleOf(MOTIONS.side_plank, 'b').map((p) => p.pass))], ['b']);
});

test('Drawing: still image, single frame and animation deliver SVG in 3:2 aspect ratio', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const vb = viewBoxOf(m);
    assert.ok(vb.every(Number.isFinite), `${id}: viewBox`);
    assert.ok(Math.abs(vb[2] / vb[3] - 1.5) < 0.01, `${id}: 3:2`);
    const svg = motionSVG(m, { ...thumbKeys(m), color: '#7c5cff', label: 'Test' });
    assert.match(svg, /^<svg class="mf mf--coach" viewBox="[^"]+" style="--mf-hi:#7c5cff" role="img" aria-label="Test">/);
    assert.ok(!/NaN|undefined/.test(svg), `${id}: SVG contains NaN/undefined`);
    assert.match(frameSVG(m, 0.5), /^<svg class="mf mf--coach"/);
    const line = frameSVG(m, 0.5, { style: 'line' });
    assert.match(line, /^<svg class="mf"/);
    assert.ok(!/NaN|undefined/.test(line), `${id}: line figure contains NaN/undefined`);
  }
  // Coach figure: clothing, skin, hair, shoes and shadow; the squat glazes
  // thigh and glutes in the category colour.
  const sq = motionSVG(MOTIONS.squat, { solid: 'down' });
  for (const cls of ['cf-top', 'cf-leg', 'cf-skin', 'cf-hair', 'cf-shoe', 'cf-shadow']) assert.ok(sq.includes(`class="${cls}`), cls);
  assert.ok((sq.match(/class="cf-hi"/g) || []).length >= 3, 'thighs of both legs + glutes');
  // The line figure remains available as a style.
  const sqLine = motionSVG(MOTIONS.squat, { solid: 'down', style: 'line' });
  assert.ok((sqLine.match(/class="mf-hi/g) || []).length >= 3);
  assert.ok(/class="mf-ink/.test(sqLine));
});

test('Animation in the DOM: build elements once, set only coordinates per frame', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const fig = mountFigure(svg, MOTIONS.lunge, { color: '#7c5cff' });
  const f1 = fig.update(0.1);
  const n = svg.childNodes[svg.childNodes.length - 1].childNodes.length;
  const f2 = fig.update(2.5);
  assert.equal(svg.childNodes[svg.childNodes.length - 1].childNodes.length, n, 'same elements');
  assert.notEqual(f1.phase.label, f2.phase.label);
  assert.equal(svg.getAttribute('class'), 'mf mf--coach');
});
