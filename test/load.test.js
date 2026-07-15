import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { dailyLoadSeries, acwr, formToday, monotonyStrain, loadSummary, fmtRatio } from '../js/load.js';

const TODAY = '2026-07-04';
// sessionLoad = round((durationSec/60) × rpe); durationSec=durMin×60 => Last = durMin×rpe.
const S = (offset, rpe, durMin = 60) => ({ date: addDays(TODAY, -offset), durationSec: durMin * 60, rpe, type: 'easy' });

test('dailyLoadSeries: lückenlos, chronologisch, sRPE pro Tag summiert', () => {
  const series = dailyLoadSeries([S(0, 5), S(0, 3), S(2, 6)], TODAY, 3);
  assert.equal(series.length, 3);
  assert.equal(series[2].date, TODAY);
  assert.equal(series[2].load, 60 * 5 + 60 * 3);   // heute: zwei Einheiten summiert
  assert.equal(series[1].load, 0);                 // gestern: frei
  assert.equal(series[0].load, 60 * 6);            // vorgestern
});

test('dailyLoadSeries: gelöschte und außerhalb liegende Einheiten ignoriert', () => {
  const series = dailyLoadSeries([{ ...S(0, 5), deleted: true }, S(40, 5)], TODAY, 7);
  assert.equal(series.reduce((a, d) => a + d.load, 0), 0);
});

test('acwr: gleichmäßige Last => Ratio 1 (optimal)', () => {
  const sessions = [];
  for (let i = 0; i < 28; i++) sessions.push(S(i, 5));
  const a = acwr(sessions, TODAY);
  assert.ok(Math.abs(a.ratio - 1) < 1e-9, `ratio ${a.ratio}`);
  assert.equal(a.zone, 'optimal');
  assert.equal(a.tone, 'good');
});

test('acwr: akuter Lastsprung => Ratio hoch (Risiko)', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 2));        // ruhige Basis
  for (let i = 0; i < 7; i++) sessions.push(S(i, 9, 120));    // harte letzte Woche
  const a = acwr(sessions, TODAY);
  assert.ok(a.ratio > 1.5, `ratio ${a.ratio}`);
  assert.equal(a.zone, 'hoch');
  assert.equal(a.tone, 'bad');
});

test('acwr: keine Daten => ratio null, zone unklar', () => {
  const a = acwr([], TODAY);
  assert.equal(a.ratio, null);
  assert.equal(a.zone, 'unklar');
});

test('formToday: lange konstante Last => CTL ≈ ATL, Form ≈ 0', () => {
  const sessions = [];
  for (let i = 0; i < 200; i++) sessions.push(S(i, 5));
  const f = formToday(sessions, TODAY, { days: 1, warmup: 200 });
  const L = 60 * 5;
  assert.ok(Math.abs(f.ctl - L) < L * 0.05, `ctl ${f.ctl} vs ${L}`);
  assert.ok(Math.abs(f.atl - L) < L * 0.02, `atl ${f.atl}`);
  assert.ok(Math.abs(f.form) < L * 0.05, `form ${f.form}`);
});

test('formToday: Ruhe nach Aufbau => positive Form (frisch)', () => {
  const sessions = [];
  for (let i = 8; i < 80; i++) sessions.push(S(i, 6)); // Aufbau bis vor 8 Tagen, letzte 8 Tage frei
  const f = formToday(sessions, TODAY, { days: 1, warmup: 90 });
  assert.ok(f.form > 0, `form ${f.form}`);
  assert.ok(f.ctl > f.atl, `ctl ${f.ctl} atl ${f.atl}`);
});

test('monotonyStrain: jeden Tag gleiche Last => hohe Monotonie (warn)', () => {
  const sessions = [];
  for (let i = 0; i < 7; i++) sessions.push(S(i, 6));
  const m = monotonyStrain(sessions, TODAY);
  assert.ok(m.monotony >= 2, `monotony ${m.monotony}`);
  assert.equal(m.tone, 'warn');
  assert.equal(m.weekLoad, 7 * 60 * 6);
});

test('monotonyStrain: ein Spitzentag + Ruhe => niedrige Monotonie (ok)', () => {
  const m = monotonyStrain([S(3, 9, 120)], TODAY);
  assert.ok(m.monotony < 1, `monotony ${m.monotony}`);
  assert.equal(m.tone, 'good');
});

test('loadSummary: ohne Daten hasData=false', () => {
  const sum = loadSummary([], TODAY);
  assert.equal(sum.hasData, false);
  assert.equal(sum.tone, 'neutral');
});

test('loadSummary: sauberer Aufbau => grüner Bereich + 42er-Serie', () => {
  const sessions = [];
  for (let i = 0; i < 28; i++) sessions.push(S(i, 5));
  const sum = loadSummary(sessions, TODAY);
  assert.equal(sum.hasData, true);
  assert.equal(sum.acwr.zone, 'optimal');
  assert.equal(sum.series.length, 42);
  assert.ok(sum.headline.length > 0);
});

test('fmtRatio: deutsches Dezimalkomma und Fallback', () => {
  assert.equal(fmtRatio(1.239), '1,24');
  assert.equal(fmtRatio(null), '–');
});
