import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import {
  dailyLoadSeries, acwr, formToday, monotonyStrain, loadSummary, fmtRatio, formState, FORM_MIN_DAYS,
  sessionLoad, sessionRpe, loadMinutes, RPE_BY_TYPE,
} from '../js/load.js';

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

test('monotonyStrain: jeden Tag gleiche, gestiegene Last => hohe Monotonie (warn)', () => {
  const sessions = [];
  for (let i = 0; i < 7; i++) sessions.push(S(i, 6));
  for (let i = 7; i < 28; i += 2) sessions.push(S(i, 5, 45));   // ruhigere drei Wochen davor
  const m = monotonyStrain(sessions, TODAY);
  assert.ok(m.monotony >= 2, `monotony ${m.monotony}`);
  assert.equal(m.tone, 'warn');
  assert.equal(m.weekLoad, 7 * 60 * 6);
  assert.ok(m.weekLoad >= m.chronicWeek * 1.1);
});

test('TRAIN-11: tägliches Spazierengehen ist keine „gleichförmig hohe Last“', () => {
  // 35 Tage je 30 min Gehen (RPE-Standard 2) – früher: „Training sehr gleichförmig … Übertrainingsrisiko“.
  const walks = Array.from({ length: 35 }, (_, i) => ({ date: addDays(TODAY, -i), durationSec: 1800, type: 'walk' }));
  const m = monotonyStrain(walks, TODAY);
  assert.equal(m.tone, 'good');
  const sum = loadSummary(walks, TODAY);
  assert.notEqual(sum.headline, 'Training sehr gleichförmig');
  // Gleichförmiges Training auf dem eigenen üblichen Niveau warnt ebenfalls nicht.
  const steady = Array.from({ length: 35 }, (_, i) => S(i, 5, 40));
  assert.equal(monotonyStrain(steady, TODAY).tone, 'good');
});

test('TRAIN-24: Lastverhältnis entkoppelt – letzte 7 Tage gegen die 21 Tage davor', () => {
  const sessions = [];
  for (let i = 7; i < 28; i++) sessions.push(S(i, 5));           // Tag 8–28: 300 AU/Tag
  for (let i = 0; i < 7; i++) sessions.push(S(i, 5, 78));        // letzte 7 Tage: 390 AU/Tag
  const a = acwr(sessions, TODAY);
  assert.equal(a.chronic, 300);
  assert.equal(a.acute, 390);
  assert.ok(Math.abs(a.ratio - 1.3) < 1e-9, `ratio ${a.ratio}`);  // gekoppelt wären es 1,22
  assert.equal(a.acuteWeek, 390 * 7);
  assert.equal(a.chronicWeek, 300 * 7);
});

test('TRAIN-24: Texte ohne Verletzungs- oder Schutzversprechen', () => {
  const sessions = [];
  for (let i = 7; i < 28; i += 2) sessions.push(S(i, 2));
  for (let i = 0; i < 7; i++) sessions.push(S(i, 9, 120));
  const sum = loadSummary(sessions, TODAY);
  assert.equal(sum.acwr.zone, 'hoch');
  assert.doesNotMatch(`${sum.headline} ${sum.advice}`, /Verletzungsrisiko|sicheren Bereich|schützt|Übertraining|Sweet Spot/);
});

test('TRAIN-33: Form relativ zur Fitness – ein lockerer Tag ist noch nicht „frisch“', () => {
  assert.equal(formState({ ctl: 300, atl: 280, form: 20 }, 200).key, 'ausgeglichen');   // +6,7 %
  assert.equal(formState({ ctl: 300, atl: 260, form: 40 }, 200).key, 'frisch');         // +13 %
  assert.equal(formState({ ctl: 300, atl: 360, form: -60 }, 200).key, 'training');      // −20 %
  assert.equal(formState({ ctl: 300, atl: 420, form: -120 }, 200).key, 'ermuedet');     // −40 %
  assert.equal(formState({ ctl: 300, atl: 420, form: -120 }, 200).label, 'deutlich ermüdet');
});

test('TRAIN-18: Form erst ab ~3 Monaten Historie bewertet (Fitnesskurve schwingt ein)', () => {
  const young = Array.from({ length: 40 }, (_, i) => S(i, 5));
  const fs = formState(formToday(young, TODAY), 40);
  assert.equal(fs.reliable, false);
  assert.equal(fs.key, 'einschwingen');
  const sum = loadSummary(young, TODAY);
  assert.match(sum.formNote, /schwingt noch ein/);
  assert.ok(FORM_MIN_DAYS >= 84);
});

test('TRAIN-42: Belastung mit Plausibilitätsgrenzen (RPE 1–10, Dauer ≥ 0, Sportarten)', () => {
  const base = { date: TODAY, durationSec: 3600, type: 'easy' };
  assert.equal(sessionLoad({ ...base, rpe: 15 }), 600);          // auf 10 geklemmt
  assert.equal(sessionLoad({ ...base, rpe: -3 }), 240);          // ungültig -> Typ-Standard 4
  assert.ok(sessionLoad({ ...base, durationSec: -600, rpe: 5 }) >= 0);
  assert.equal(sessionLoad({ date: TODAY, type: 'easy', durationSec: 999999, rpe: 5 }), 24 * 60 * 5);
  for (const t of ['tennis', 'spinning', 'swim', 'hike', 'rowing', 'gym', 'squash', 'badminton', 'tabletennis', 'elliptical']) {
    assert.ok(RPE_BY_TYPE[t] > 0, `RPE-Vorgabe für ${t}`);
  }
  assert.ok(sessionRpe({ type: 'spinning' }) > sessionRpe({ type: 'easy' }), 'Indoor-Cycling zählt nicht wie ein lockerer Lauf');
});

test('TRAIN-23: ohne erfasste Dauer zählt die geplante Dauer, erst dann 30 min', () => {
  const football = { date: TODAY, type: 'cross_football', intensity: 'normal' };
  assert.equal(sessionLoad(football), 30 * 7);                               // Pauschale
  assert.equal(sessionLoad({ ...football, plannedDurationMin: 90 }), 90 * 7);  // Soll-Dauer
  assert.equal(loadMinutes({ ...football, plannedDurationMin: 90 }).source, 'geplant');
  assert.equal(loadMinutes(football).source, 'pauschal');
  // Strecke ohne Dauer: Rad schneller als Laufen
  assert.ok(loadMinutes({ type: 'cross_bike', distanceKm: 40 }).min < loadMinutes({ type: 'easy', distanceKm: 40 }).min);
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
