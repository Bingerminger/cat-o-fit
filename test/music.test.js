/* Workout music (3.23.0): tempo matched to the movement, patterns per style and intensity,
   silent stand-in without Web Audio. Listening happens on the device – tools/music-preview.mjs
   renders audio samples including levels. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, styleFor, tempoFor, barEvents, createMusic } from '../js/music.js';
import { MOTIONS } from '../js/exercise-motions.js';
import { cycleDuration } from '../js/motion-rig.js';

test('Style per category', () => {
  assert.equal(styleFor('strength'), 'power');
  assert.equal(styleFor('core'), 'groove');
  assert.equal(styleFor('mobility'), 'flow');
  assert.equal(styleFor('cardio'), 'hiit');
  assert.equal(styleFor('unbekannt'), 'power');
});

test('Tempo: whole beats per repetition, within the range of the style, movement barely stretched', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    if (m.holdS != null) continue;
    const cyc = cycleDuration(m);
    for (const style of Object.keys(STYLES)) {
      const { bpm, beats, speed } = tempoFor(cyc, style);
      const [lo, hi] = STYLES[style].bpm;
      assert.ok(bpm >= lo && bpm <= hi, `${id}/${style}: ${bpm}`);
      assert.ok(Number.isInteger(beats) && beats >= 1, `${id}/${style}: beats`);
      assert.ok(Math.abs(cyc / speed - (beats * 60) / bpm) < 1e-9, `${id}/${style}: cycle = beats`);
      assert.ok(speed > 0.7 && speed < 1.4, `${id}/${style}: stretch ${speed.toFixed(2)}`);
    }
  }
  // The squat (4.4 s) keeps its original speed in the strength style.
  const sq = tempoFor(cycleDuration(MOTIONS.squat), 'power');
  assert.ok(Math.abs(sq.speed - 1) < 0.01);
});

test('Patterns: rest without kick drum, exercise with full beat; steps, notes and velocities valid', () => {
  for (const style of Object.keys(STYLES)) {
    for (const intensity of [0, 1, 2]) {
      for (const bar of [0, 1, 7]) {
        const ev = barEvents(style, intensity, bar);
        assert.ok(ev.length > 0);
        for (const e of ev) {
          assert.ok(Number.isInteger(e.step) && e.step >= 0 && e.step < 16, `${style}: step ${e.step}`);
          assert.ok(e.vel > 0 && e.vel <= 1.2, `${style}: velocity ${e.vel}`);
          for (const n of e.notes || (e.midi != null ? [e.midi] : [])) assert.ok(n >= 24 && n <= 96, `${style}: note ${n}`);
        }
        const kicks = ev.filter((e) => e.inst === 'kick').length;
        if (intensity === 0) assert.equal(kicks, 0, `${style}: rest without kick drum`);
      }
    }
    assert.ok(barEvents(style, 2, 0).length > barEvents(style, 0, 0).length, `${style}: exercise denser than rest`);
  }
  assert.equal(barEvents('power', 2, 0).filter((e) => e.inst === 'kick').length, 4, 'house: four on the floor');
});

test('Without Web Audio: silent music with the same interface', () => {
  const m = createMusic();
  assert.equal(m.running, false);
  for (const fn of ['prepare', 'play', 'oneShot', 'start', 'stop', 'setVolume', 'duck', 'dispose']) assert.doesNotThrow(() => m[fn]({}));
  assert.equal(m.latency, 0);
});
