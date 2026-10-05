/* Follow along non-stop (3.23.0): overview, run without tapping until "Done!",
   announcements per section, sound without Web Audio, the coach figure intact in every pose. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { STRENGTH_FOCUS } from '../js/plangen.js';
import { programForUnit, programForWorkout, buildShow } from '../js/show-program.js';
import { findWorkout } from '../js/workouts.js';
import { openShow, voiceLines, cueTones, spokenDose } from '../js/workout-show.js';
import { unlockAudio, tone, speak, keepAwake } from '../js/audio.js';
import { MOTIONS } from '../js/exercise-motions.js';
import { solvePose, introOf, cycleOf, frameAt, keyPose } from '../js/motion-rig.js';
import { coachParts, coachExtent, floorOf } from '../js/coach-figure.js';
import { viewBoxFor } from '../js/motion-figure.js';

beforeEach(() => { globalThis.document.body.childNodes = []; });

const unitProgram = () => programForUnit({ type: 'strength', title: 'Ganzkörper', description: STRENGTH_FOCUS[0].desc });

test('Announcements only at start, rest and side switch – during the exercise tones lead', () => {
  const p = unitProgram();
  const show = buildShow(p);
  const text = (kind) => voiceLines(show.segs.find((s) => s.kind === kind), show).map((l) => l.text).join(' | ');
  assert.match(text('ready'), /Los geht's! Zuerst: Kniebeuge, 12 Wiederholungen\./);
  assert.match(text('rest'), /Pause\. Als Nächstes: Liegestütz, 10 Wiederholungen\./);
  assert.match(text('roundRest'), /Runde 1 geschafft\. Durchatmen\. Gleich Runde 2: Kniebeuge\./);
  // On iOS the speech output interrupts the music – nothing is spoken during the exercise.
  for (const s of show.segs.filter((x) => x.kind === 'work')) assert.deepEqual(voiceLines(s, show), []);
  // Repetitions: the last three tick on their start, a low tone at the end.
  const work = show.segs.find((s) => s.kind === 'work');
  const tw = cueTones(work);
  assert.deepEqual(tw.slice(0, 3).map((c) => Math.round(c.at / work.cyc)), [work.reps - 3, work.reps - 2, work.reps - 1]);
  assert.equal(tw[tw.length - 1].at, work.dur);
  // Timed exercise: double tone at "10 seconds left", the last three seconds tick.
  const plank = show.segs.find((s) => s.kind === 'work' && p.items[s.i].id === 'plank');
  const tp = cueTones(plank).map((c) => Math.round((plank.dur - c.at) * 10) / 10);
  assert.deepEqual(tp, [10, 9.8, 3, 2, 1, 0]);
  // Preview: three count tones before the start, start tone exactly at the start.
  const rest = show.segs.find((s) => s.kind === 'rest');
  const tr = cueTones(rest);
  assert.equal(tr.length, 4);
  assert.equal(tr[3].at, rest.dur);
  assert.ok(tr[0].at < tr[1].at && tr[1].at < tr[2].at && tr[2].at < rest.dur);
  assert.equal(spokenDose(p.items[2], p), '10 Wiederholungen pro Seite');
  const wo = programForWorkout(findWorkout('bauch'));
  const sp = buildShow(wo);
  assert.match(voiceLines(sp.segs.find((s) => s.kind === 'switch'), sp)[0].text, /Seitenwechsel/);
});

test('Session: overview → run without tapping → Done!, counts the exercises and offers "Log as done"', () => {
  store.reset && store.reset();
  let finished = null;
  const p = unitProgram();
  const h = openShow(p, { onFinish: (r) => { finished = r; } });
  const txt = () => h.root.textContent;
  assert.match(txt(), /Durchgehend mitmachen/);
  assert.match(txt(), /Ganzkörper/);
  assert.match(txt(), /Kniebeuge.*12×.*Liegestütz.*10×/s);
  assert.match(txt(), /≈ \d+ min · 5 Übungen · 3 Runden/);
  const run = h.start();
  assert.match(txt(), /Gleich geht’s los/);
  assert.match(txt(), /Kniebeuge/);
  const show = run.show;
  const work = show.segs.find((s) => s.kind === 'work');
  run.tick(work.t0 + work.cyc * 1.5);
  assert.match(txt(), /Jetzt/);
  assert.match(txt(), /2von 12|2 von 12|von 12/);
  assert.match(txt(), /Danach.*Liegestütz/s);
  // Pause stops the time, skipping jumps to the next section.
  run.toggle(); const t = run.time; run.tick(20); assert.equal(run.time, t); run.toggle();
  run.skip(1);
  assert.match(txt(), /Pause · als Nächstes/);
  assert.match(txt(), /Liegestütz/);
  // Right to the end, without tapping anything.
  for (let i = 0; i < 4000 && !run.finished; i++) run.tick(1);
  assert.equal(run.finished, true);
  assert.match(txt(), /Geschafft!/);
  assert.match(txt(), /5 Übungen · 3 Runden/);
  assert.ok((store.exerciseUsage().squat || 0) >= 1, 'exercises counted as done');
  const done = h.root.querySelectorAll('button').find((b) => b.textContent.includes('Als erledigt erfassen'));
  assert.ok(done);
  done.click();
  assert.ok(finished && finished.durationSec > 60 && finished.ids.includes('pushup'));
  assert.equal(document.body.childNodes.includes(h.root), false, 'closed');
});

test('Sound without Web Audio and without speech output: nothing throws; the silent switch is overridden', () => {
  const session = {};
  const nav = globalThis.navigator;
  nav.audioSession = session;
  assert.doesNotThrow(() => unlockAudio());
  assert.equal(session.type, 'playback', 'playback instead of ambient sound – also sounds on "silent"');
  unlockAudio({ mix: true });
  assert.equal(session.type, 'ambient', 'own music keeps playing');
  delete nav.audioSession;
  assert.doesNotThrow(() => { tone(880); speak('Test'); keepAwake(true); keepAwake(false); });
});

test('Coach figure: no invalid values in any pose; the plait never hangs through the floor', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const floor = floorOf(m);
    const sides = m.sides === 'each' || m.sides === 'alternate' ? ['a', 'b'] : ['a'];
    for (const side of sides) {
      for (const key of Object.keys(m.keys)) {
        const S = solvePose(keyPose(m, key, side), m.view);
        const parts = coachParts(S, m, null);
        for (const sh of parts) {
          const s = JSON.stringify(sh);
          assert.ok(!/NaN|null|undefined/.test(s), `${id}/${key}: ${s.slice(0, 80)}`);
        }
        const tail = coachExtent(S, floor)[0][0];
        if (floor !== Infinity) assert.ok(tail[1] <= 0.01, `${id}/${key}: plait below the floor (y=${tail[1].toFixed(1)})`);
      }
      // Follow-through swing over an animation: stays bounded.
      const state = {};
      for (const list of [introOf(m, side), cycleOf(m, side)]) {
        const total = list.reduce((a, ph) => a + ph.dur, 0);
        for (let i = 0; total && i <= 30; i++) coachParts(solvePose(frameAt(m, (i / 30) * total, list).pose, m.view), m, state);
      }
      assert.ok(Math.hypot(...(state.swing || [0, 0])) <= 1.1 + 1e-9, `${id}: plait swings too far`);
    }
  }
});

test('Viewport for the stage: different aspect ratio, flush at the bottom, everything inside', () => {
  for (const id of ['squat', 'pushup', 'jumping_jack', 'hip_flexor_stretch']) {
    const m = MOTIONS[id];
    const tall = viewBoxFor(m, 0.9);
    const wide = viewBoxFor(m, 2);
    assert.ok(Math.abs(tall[2] / tall[3] - 0.9) < 0.01 && Math.abs(wide[2] / wide[3] - 2) < 0.01, id);
    assert.ok(Math.abs(tall[1] + tall[3] - (wide[1] + wide[3])) < 0.2, `${id}: flush at the bottom`);
  }
});

test('Announcements from voice building blocks: every block exists as a file, every announcement is complete', async () => {
  const { existsSync } = await import('node:fs');
  const { EXERCISES } = await import('../js/exercises.js');
  const { voiceTexts, doseKeys } = await import('../js/voice.js');
  const { WORKOUTS, WORKOUT_CATS } = await import('../js/workouts.js');
  const texts = voiceTexts(EXERCISES);
  for (const key of Object.keys(texts)) assert.ok(existsSync(new URL(`../assets/voice/de/${key}.m4a`, import.meta.url)), `Building block missing: ${key}`);
  for (const e of EXERCISES) assert.ok(texts[`ex-${e.id}`], `Name missing: ${e.id}`);
  assert.deepEqual(doseKeys('12×'), ['reps-12']);
  assert.deepEqual(doseKeys('10× je Seite'), ['reps-10', 'per-side']);
  assert.deepEqual(doseKeys('40 s'), ['sec-40']);
  assert.deepEqual(doseKeys('7 s'), [], 'odd seconds: announcement without an amount instead of a wrong number');
  // Every announcement of every session – from the plan and from all workouts – consists only of existing building blocks.
  const programs = [unitProgram(), ...WORKOUTS.map(programForWorkout)];
  for (const p of programs) {
    const show = buildShow(p);
    for (const s of show.segs) for (const line of voiceLines(s, show)) for (const k of line.keys) assert.ok(texts[k], `${p.title}: building block ${k}`);
  }
  // Catalogue: enough workouts, each with a valid filter.
  assert.ok(WORKOUTS.length >= 20);
  const cats = new Set(WORKOUT_CATS.map((c) => c.key));
  for (const w of WORKOUTS) assert.ok(cats.has(w.cat), `${w.id}: filter ${w.cat}`);
});
