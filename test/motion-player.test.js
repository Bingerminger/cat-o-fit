/* Follow-along player (3.22.0): schedule built from sets, repetitions or seconds, sides
   and rests; state at any point in time; display in the mini DOM without an endless loop. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS } from '../js/exercise-motions.js';
import { findExercise } from '../js/exercises.js';
import { buildPlan, stateAt, defaultsFor, sideLabel, mountPlayer } from '../js/motion-player.js';
import { cycleDuration } from '../js/motion-rig.js';

beforeEach(() => { globalThis.document.body.childNodes = []; });

test('Plan with repetitions: sets × repetitions × tempo, rests in between', () => {
  const m = MOTIONS.squat;
  const cyc = cycleDuration(m);
  const plan = buildPlan(m, { reps: 10, sets: 3, rest: 60 });
  assert.deepEqual(plan.segs.map((s) => s.kind), ['reps', 'rest', 'reps', 'rest', 'reps']);
  assert.ok(Math.abs(plan.total - (3 * 10 * cyc + 2 * 60)) < 1e-9);
  const st = stateAt(plan, cyc * 2.5);
  assert.equal(st.set, 1); assert.equal(st.rep, 3);
  const rest = stateAt(plan, 10 * cyc + 5);
  assert.equal(rest.seg.kind, 'rest'); assert.ok(Math.abs(rest.left - 55) < 1e-9);
  assert.equal(stateAt(plan, plan.total + 1).done, true);
});

test('Plan with seconds, intro and "per side": side change between the sides', () => {
  const m = MOTIONS.hip_flexor_stretch;
  const plan = buildPlan(m, { holdS: 30, sets: 1, rest: 15 });
  assert.deepEqual(plan.segs.map((s) => `${s.kind}:${s.side}`), ['intro:a', 'time:a', 'switch:b', 'intro:b', 'time:b']);
  const hold = plan.segs[1];
  assert.equal(hold.dur, 30);
  assert.equal(stateAt(plan, hold.t0 + 10).seg.kind, 'time');
});

test('Presets per category and side label', () => {
  assert.deepEqual(defaultsFor(MOTIONS.squat, 'strength'), { reps: 12, holdS: null, sets: 3, rest: 60 });
  assert.deepEqual(defaultsFor(MOTIONS.plank, 'core'), { reps: null, holdS: 30, sets: 3, rest: 60 });
  assert.equal(defaultsFor(MOTIONS.child_pose, 'mobility').sets, 2);
  assert.equal(defaultsFor(MOTIONS.jumping_jack, 'cardio').rest, 30);
  assert.equal(sideLabel(MOTIONS.lunge, 'a'), 'rechts');
  assert.equal(sideLabel(MOTIONS.lunge, 'b'), 'links');
  assert.equal(sideLabel(MOTIONS.squat, 'a'), '');
});

test('Player in the DOM: preview, follow along, set and repetition, completion message at the end', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let done = 0;
  const p = mountPlayer(host, findExercise('squat'), MOTIONS.squat, { onDone: () => { done += 1; } });
  const text = () => host.textContent;
  assert.match(text(), /Vorschau · 12 Wdh\./);
  assert.match(text(), /Mitmachen/);
  p.tick(1);
  assert.equal(p.mode, 'preview');
  p.start();
  assert.equal(p.mode, 'train');
  assert.match(text(), /Satz 1 von 3 · Wdh\. 1 von 12/);
  assert.match(text(), /Einatmen|Ausatmen/);
  const cyc = cycleDuration(MOTIONS.squat);
  for (let i = 0; i < 3; i++) p.tick(cyc);
  assert.match(text(), /Wdh\. 4 von 12/);
  // Pausing stops the clock.
  p.start(); assert.equal(p.mode, 'paused');
  const before = text(); p.tick(30); assert.equal(text(), before);
  p.start(); assert.equal(p.mode, 'train');
  // To the end: 3 sets, 2 rests.
  for (let i = 0; i < 400; i++) p.tick(1);
  assert.equal(p.mode, 'done');
  assert.match(text(), /Geschafft – 3 Sätze/);
  assert.equal(done, 1, 'onDone exactly once');
  p.stop();
});

test('Player: hold exercise counts seconds down, cue stays visible', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const p = mountPlayer(host, findExercise('plank'), MOTIONS.plank);
  p.start();
  p.tick(10);
  assert.match(host.textContent, /Satz 1 von 3 · 0:20/);
  assert.match(host.textContent, /Bauch fest, Po nicht hochschieben/);
  p.stop();
});
