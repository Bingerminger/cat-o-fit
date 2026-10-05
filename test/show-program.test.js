/* Follow along continuously (3.23.0): reading the plan text, building programmes and the timeline
   in time with the music – every exercise starts on the "one", pauses are whole bars. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRENGTH_FOCUS, HYROX_STRENGTH, generatePlanUnits, makePhases, weekTemplateFor } from '../js/plangen.js';
import { doseOf, dosesFromText, programForUnit, programForWorkout, buildShow, showStateAt, clipAt, nextWorkAfter, doseLabel, hasProgram, beatPlan } from '../js/show-program.js';
import { cycleOf } from '../js/motion-rig.js';
import { WORKOUTS } from '../js/workouts.js';
import { STYLES } from '../js/music.js';
import { MOTIONS } from '../js/exercise-motions.js';

const MOB = 'Ruhige Beweglichkeit, 10–15 min, besonders rückenfreundlich: Katze-Kuh 10× · Hüftbeuger-Dehnung 45 s/Seite · Beinrückseite sanft 45 s/Seite · Waden an der Wand 45 s/Seite · Brustöffner & Wirbelsäulen-Rotation 8×/Seite · Kindhaltung 60 s. Nichts ruckartig – in jede Position locker hineinatmen.';
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('Dose from the text snippet: repetitions, holds, seconds, minutes, per side, no distance', () => {
  assert.deepEqual(doseOf('Kniebeugen 12×'), { reps: 12, holdS: null, perSide: false });
  assert.deepEqual(doseOf('Liegestütz 8–12× (ggf. auf Knien)'), { reps: 10, holdS: null, perSide: false });
  assert.deepEqual(doseOf('Ausfallschritte 10×/Bein'), { reps: 10, holdS: null, perSide: true });
  assert.deepEqual(doseOf('Plank 30–45 s'), { reps: null, holdS: 40, perSide: false });
  assert.deepEqual(doseOf('Seitstütz 30 s/Seite'), { reps: null, holdS: 30, perSide: true });
  assert.deepEqual(doseOf('Kindhaltung 2 min'), { reps: null, holdS: 120, perSide: false });
  assert.equal(doseOf('Farmers Walk 2×30 m schwer').reps, null, '2×30 m is a distance');
});

test('Plan text: exercises in order, rounds, rest between rounds, "&" splits the dose', () => {
  const g = dosesFromText(STRENGTH_FOCUS[0].desc);
  assert.deepEqual(g.items.map((x) => x.id), ['squat', 'pushup', 'lunge', 'overhead_press', 'plank']);
  assert.equal(g.rounds, 3);
  assert.equal(g.roundRest, 60);
  assert.equal(g.items.find((x) => x.id === 'plank').holdS, 40);
  const m = dosesFromText(MOB);
  assert.equal(m.rounds, null);
  const chest = m.items.find((x) => x.id === 'chest_opener');
  assert.deepEqual([chest.reps, chest.perSide], [8, true], 'chest opener & spine rotation 8×/side');
  assert.equal(m.items.find((x) => x.id === 'child_pose').holdS, 60);
  assert.equal(dosesFromText(HYROX_STRENGTH[0].desc).roundRest, 90);
});

test('Programme of a unit: plan exercises with dose, then those appended via "+"; calm style for mobility', () => {
  const p = programForUnit({ type: 'strength', title: 'Ganzkörper', description: STRENGTH_FOCUS[0].desc, exerciseIds: ['glute_bridge', 'squat'] });
  assert.deepEqual(p.items.map((x) => x.id), ['squat', 'pushup', 'lunge', 'overhead_press', 'plank', 'glute_bridge']);
  assert.equal(p.rounds, 3);
  assert.equal(p.style, 'power');
  assert.equal(doseLabel(p.items[2], p), '10× je Seite');
  assert.equal(doseLabel(p.items[4], p), '40 s');
  const mob = programForUnit({ type: 'mobility', title: 'Mobility & Dehnen', description: MOB });
  assert.equal(mob.style, 'flow');
  assert.equal(mob.rounds, 1);
  assert.equal(doseLabel(mob.items.find((x) => x.id === 'hip_flexor_stretch'), mob), '45 s je Seite');
  assert.equal(programForUnit({ type: 'easy', title: 'Lockerer Lauf', description: '8 km locker' }), null);
  assert.equal(hasProgram({ type: 'easy', title: 'Lauf', description: '' }), false);
  assert.equal(hasProgram({ type: 'strength', title: 'Kraft', exerciseIds: ['squat'] }), true);
});

test('Every strength and mobility unit from the generator can be followed along continuously', () => {
  for (const sport of ['run', 'hyrox']) {
    const event = { id: 'e', name: 'Rennen', date: '2027-01-02', distanceKm: sport === 'hyrox' ? 8 : 21.0975, sport };
    const plan = { id: 'p', eventId: 'e', startDate: '2026-10-05', weeks: 13, phases: makePhases(13), level: 'fortgeschritten', daysPerWeek: 4, weekTemplate: weekTemplateFor(sport, 4), commitments: [], sport };
    const units = generatePlanUnits(plan, event, {}).filter((u) => ['strength', 'mobility'].includes(u.type) && /\d+×|\d+ s/.test(u.description || ''));
    for (const u of units) {
      const p = programForUnit(u);
      assert.ok(p && p.items.length >= 3, `${u.title}`);
      const show = buildShow(p);
      assert.ok(show.total > 4 * 60 && show.total < 60 * 60, `${u.title}: ${Math.round(show.total / 60)} min`);
    }
  }
});

test('Finished workouts: valid exercises, duration between 4 and 30 minutes', () => {
  const ids = new Set();
  for (const w of WORKOUTS) {
    assert.ok(!ids.has(w.id), `duplicate: ${w.id}`); ids.add(w.id);
    assert.ok(STYLES[w.style], `${w.id}: style`);
    for (const x of w.items) assert.ok(MOTIONS[typeof x === 'string' ? x : x.id], `${w.id}: ${JSON.stringify(x)}`);
    const p = programForWorkout(w);
    assert.equal(p.items.length, w.items.length);
    const min = buildShow(p).total / 60;
    assert.ok(min >= 4 && min <= 30, `${w.id}: ${min.toFixed(1)} min`);
  }
});

test('Timeline: gapless, start first, side switch for "per side", pauses on whole bars, tempo within the style', () => {
  const programs = [
    programForUnit({ type: 'strength', title: 'Ganzkörper', description: STRENGTH_FOCUS[0].desc }),
    programForUnit({ type: 'strength', title: 'Rumpf', description: STRENGTH_FOCUS[2].desc }),
    programForUnit({ type: 'mobility', title: 'Mobility', description: MOB }),
    ...WORKOUTS.map(programForWorkout),
  ];
  for (const p of programs) {
    const show = buildShow(p);
    assert.equal(show.segs[0].kind, 'ready', p.title);
    let t = 0;
    for (const s of show.segs) {
      assert.ok(near(s.t0, t), `${p.title}: gap at ${s.kind}`);
      assert.ok(s.dur > 0, `${p.title}: duration`);
      const [lo, hi] = STYLES[s.style].bpm;
      assert.ok(s.bpm >= lo - 1e-9 && s.bpm <= hi + 1e-9, `${p.title}: ${s.bpm} BPM outside ${lo}–${hi}`);
      if (s.kind !== 'work') {
        const bars = s.dur / ((4 * 60) / s.bpm);
        assert.ok(near(bars, Math.round(bars), 1e-6) && bars >= 2, `${p.title}: ${s.kind} not on whole bars (${bars})`);
      } else if (s.reps) {
        assert.ok(near(s.dur, s.reps * s.cyc), `${p.title}: repetitions × cycle`);
        // Each repetition lasts a whole number of beats.
        const beats = s.cyc / (60 / s.bpm);
        assert.ok(near(beats, Math.round(beats), 1e-3), `${p.title}: ${beats} beats per repetition`);
      }
      t += s.dur;
    }
    assert.ok(near(show.total, t));
    p.items.forEach((it, i) => {
      if (it.m.sides !== 'each') return;
      const sw = show.segs.filter((s) => s.i === i && s.kind === 'switch');
      assert.equal(sw.length, p.rounds, `${p.title}: side switch ${it.id}`);
    });
  }
});

test('Movement in time: every phase on half (fast ones on quarter) beats, every repetition on whole ones', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    for (const style of Object.keys(STYLES)) {
      const cyc = cycleOf(m);
      const p = beatPlan(cyc, style);
      const [lo, hi] = STYLES[style].bpm;
      assert.ok(p.bpm >= lo && p.bpm <= hi, `${id}/${style}: ${p.bpm}`);
      assert.ok(Number.isInteger(p.beats) || (p.beats === 0.5 && cyc.reduce((a, x) => a + x.dur, 0) <= 0.6), `${id}/${style}: ${p.beats} beats`);
      p.q.forEach((q, i) => {
        assert.ok(Number.isInteger(q * 4), `${id}: phase ${i} = ${q} beats`);
        if (!cyc[i].hold) assert.ok(q >= 0.25, `${id}: movement without time`);
      });
      // The movement stays recognisable: at most a good third faster or slower.
      const raw = cyc.reduce((a, x) => a + x.dur, 0);
      assert.ok(p.cyc / raw > 0.65 && p.cyc / raw < 1.6, `${id}/${style}: ${raw.toFixed(2)} → ${p.cyc.toFixed(2)} s`);
    }
  }
});

test('State at any point in time: repetition, remaining time, preview, end', () => {
  const p = programForUnit({ type: 'strength', title: 'Ganzkörper', description: STRENGTH_FOCUS[0].desc });
  const show = buildShow(p);
  const work = show.segs.find((s) => s.kind === 'work');
  const st = showStateAt(show, work.t0 + work.cyc * 2.5);
  assert.equal(st.seg, work);
  assert.equal(st.rep, 3);
  assert.ok(near(st.left, work.dur - work.cyc * 2.5));
  assert.equal(st.anim.list, work.clips[0].list);
  const rest = show.segs.find((s) => s.kind === 'rest');
  const r = showStateAt(show, rest.t0 + 0.5);
  assert.equal(p.items[r.seg.i].id, 'pushup', 'rest shows the next exercise');
  assert.equal(nextWorkAfter(show, show.segs.indexOf(work)).i, 1);
  assert.equal(showStateAt(show, show.total + 1).done, true);
  // A one-off image sequence (intro) stays at the end instead of starting over.
  const list = [{ dur: 2 }, { dur: 1 }];
  assert.ok(clipAt([{ at: 0, dur: 10, list, speed: 1, once: true }], 9).t < 3);
});
