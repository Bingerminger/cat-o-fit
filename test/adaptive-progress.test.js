/* Tests für den automatischen Wochenumfang-Ausgleich und die RPE-gesteuerte
   Progression (js/planflow.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekVolumeBalance, rpeProgression } from '../js/planflow.js';

test('weekVolumeBalance: verpasste km -> gedeckelter Vorschlag auf nächste lockere Einheit', () => {
  const today = '2026-06-24'; // Mi; Woche Mo–So 22.–28.
  const units = [
    { id: 'a', date: '2026-06-22', type: 'easy', targetDistanceKm: 8, status: 'erledigt' },
    { id: 'b', date: '2026-06-23', type: 'tempo', targetDistanceKm: 9, status: 'verpasst' },
    { id: 'c', date: '2026-06-25', type: 'easy', targetDistanceKm: 7, status: 'geplant' },
    { id: 'd', date: '2026-06-27', type: 'long', targetDistanceKm: 15, status: 'geplant' },
  ];
  const r = weekVolumeBalance(units, today);
  assert.equal(r.planned, 39);
  assert.equal(r.done, 8);
  assert.equal(r.missedKm, 9);
  assert.ok(r.suggestion && r.suggestion.kind === 'add');
  assert.equal(r.suggestion.unit.id, 'c');        // nächste offene lockere Einheit
  assert.equal(r.suggestion.addKm, 3);            // min(round(9*0.5)=5, max(2,round(7*0.4)=3)) = 3
  assert.equal(r.suggestion.newKm, 10);
});

test('weekVolumeBalance: Kennzahlen (planned/done/missed) korrekt', () => {
  const today = '2026-06-28'; // So
  const units = [
    { id: 'a', date: '2026-06-22', type: 'easy', targetDistanceKm: 10, status: 'erledigt' },
    { id: 'b', date: '2026-06-24', type: 'easy', targetDistanceKm: 10, status: 'erledigt' },
    { id: 'c', date: '2026-06-26', type: 'tempo', targetDistanceKm: 5, status: 'geplant' },
  ];
  const r = weekVolumeBalance(units, today);
  assert.equal(r.planned, 25);
  assert.equal(r.done, 20);
  assert.ok(Math.abs(r.pctDone - 0.8) < 0.001);
});

test('weekVolumeBalance: nichts zu tun -> kein Vorschlag; zu wenig Lauf-km -> null', () => {
  const today = '2026-06-24';
  const onTrack = weekVolumeBalance([
    { id: 'a', date: '2026-06-25', type: 'easy', targetDistanceKm: 8, status: 'geplant' },
    { id: 'b', date: '2026-06-27', type: 'long', targetDistanceKm: 14, status: 'geplant' },
  ], today);
  assert.equal(onTrack.suggestion, null);
  assert.equal(weekVolumeBalance([{ id: 'x', date: '2026-06-25', type: 'strength', status: 'geplant' }], today), null);
});

test('rpeProgression: locker -> steigern, hart -> lockern, mittel -> halten', () => {
  const today = '2026-06-30';
  const easy = [4, 5, 5, 4].map((rpe, i) => ({ id: 'e' + i, date: '2026-06-2' + (i + 1), rpe }));
  assert.equal(rpeProgression(easy, today).trend, 'progress');
  const hard = [9, 8, 9, 8].map((rpe, i) => ({ id: 'h' + i, date: '2026-06-2' + (i + 1), rpe }));
  assert.equal(rpeProgression(hard, today).trend, 'ease');
  const mid = [6, 7, 6, 7].map((rpe, i) => ({ id: 'm' + i, date: '2026-06-2' + (i + 1), rpe }));
  assert.equal(rpeProgression(mid, today).trend, 'hold');
});

test('rpeProgression: zu wenig Daten oder außerhalb des Fensters -> null', () => {
  const today = '2026-06-30';
  assert.equal(rpeProgression([{ id: 'a', date: '2026-06-29', rpe: 5 }], today), null);
  // alle älter als 21 Tage
  assert.equal(rpeProgression([
    { id: 'a', date: '2026-05-01', rpe: 5 }, { id: 'b', date: '2026-05-02', rpe: 5 }, { id: 'c', date: '2026-05-03', rpe: 5 },
  ], today), null);
});
