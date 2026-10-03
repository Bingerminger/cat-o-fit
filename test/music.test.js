/* Trainingsmusik (3.23.0): Tempo passend zur Bewegung, Muster je Stil und Stärke,
   stille Attrappe ohne Web Audio. Gehört wird auf dem Gerät – tools/music-preview.mjs
   rendert Hörproben samt Pegel. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, styleFor, tempoFor, barEvents, createMusic } from '../js/music.js';
import { MOTIONS } from '../js/exercise-motions.js';
import { cycleDuration } from '../js/motion-rig.js';

test('Stil je Kategorie', () => {
  assert.equal(styleFor('strength'), 'power');
  assert.equal(styleFor('core'), 'groove');
  assert.equal(styleFor('mobility'), 'flow');
  assert.equal(styleFor('cardio'), 'hiit');
  assert.equal(styleFor('unbekannt'), 'power');
});

test('Tempo: ganze Schläge je Wiederholung, im Bereich des Stils, Bewegung kaum gestreckt', () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    if (m.holdS != null) continue;
    const cyc = cycleDuration(m);
    for (const style of Object.keys(STYLES)) {
      const { bpm, beats, speed } = tempoFor(cyc, style);
      const [lo, hi] = STYLES[style].bpm;
      assert.ok(bpm >= lo && bpm <= hi, `${id}/${style}: ${bpm}`);
      assert.ok(Number.isInteger(beats) && beats >= 1, `${id}/${style}: Schläge`);
      assert.ok(Math.abs(cyc / speed - (beats * 60) / bpm) < 1e-9, `${id}/${style}: Zyklus = Schläge`);
      assert.ok(speed > 0.7 && speed < 1.4, `${id}/${style}: Streckung ${speed.toFixed(2)}`);
    }
  }
  // Die Kniebeuge (4,4 s) bleibt im Kraft-Stil unverändert schnell.
  const sq = tempoFor(cycleDuration(MOTIONS.squat), 'power');
  assert.ok(Math.abs(sq.speed - 1) < 0.01);
});

test('Muster: Pause ohne Bassdrum, Übung mit vollem Beat; Schritte, Töne und Stärken gültig', () => {
  for (const style of Object.keys(STYLES)) {
    for (const intensity of [0, 1, 2]) {
      for (const bar of [0, 1, 7]) {
        const ev = barEvents(style, intensity, bar);
        assert.ok(ev.length > 0);
        for (const e of ev) {
          assert.ok(Number.isInteger(e.step) && e.step >= 0 && e.step < 16, `${style}: Schritt ${e.step}`);
          assert.ok(e.vel > 0 && e.vel <= 1.2, `${style}: Stärke ${e.vel}`);
          for (const n of e.notes || (e.midi != null ? [e.midi] : [])) assert.ok(n >= 24 && n <= 96, `${style}: Ton ${n}`);
        }
        const kicks = ev.filter((e) => e.inst === 'kick').length;
        if (intensity === 0) assert.equal(kicks, 0, `${style}: Pause ohne Bassdrum`);
      }
    }
    assert.ok(barEvents(style, 2, 0).length > barEvents(style, 0, 0).length, `${style}: Übung dichter als Pause`);
  }
  assert.equal(barEvents('power', 2, 0).filter((e) => e.inst === 'kick').length, 4, 'House: vier auf den Boden');
});

test('Ohne Web Audio: stille Musik mit derselben Schnittstelle', () => {
  const m = createMusic();
  assert.equal(m.running, false);
  for (const fn of ['prepare', 'play', 'oneShot', 'start', 'stop', 'setVolume', 'duck', 'dispose']) assert.doesNotThrow(() => m[fn]({}));
  assert.equal(m.latency, 0);
});
