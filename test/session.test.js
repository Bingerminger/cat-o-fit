/* =========================================================================
   session.test.js — the unit mutations from session.js that workout mode also uses:
   findUnit (lookup across all plans), saveUnitPatch (targeted patching) and
   completeUnit (planned unit -> executed session + done linking). This is the
   environment in which whatif applies.
   ========================================================================= */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { findUnit, saveUnitPatch, completeUnit } from '../js/session.js';
import { sessionLoad } from '../js/load.js';

beforeEach(async () => {
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Nora', role: 'admin', emoji: '🏃', color: '#18b48a' }], settings: {} });
  await store.login('u-1', '');
});

function seedPlan() {
  store.upsert('plans', {
    id: 'p1', eventId: 'e1',
    units: [
      { id: 'u-a', date: '2026-07-06', type: 'easy', title: 'Lockerer Lauf', status: 'geplant' },
      { id: 'u-b', date: '2026-07-08', type: 'mobility', title: 'Mobility', status: 'geplant' },
    ],
  });
}

test('findUnit: finds the unit + its plan; otherwise null', () => {
  seedPlan();
  const hit = findUnit('u-b');
  assert.ok(hit, 'unit found');
  assert.equal(hit.plan.id, 'p1');
  assert.equal(hit.unit.title, 'Mobility');
  assert.equal(findUnit('gibt-es-nicht'), null);
});

test('saveUnitPatch: patches exactly one unit, others untouched', () => {
  seedPlan();
  saveUnitPatch('p1', 'u-a', { status: 'verpasst', reason: 'krank' });
  assert.equal(findUnit('u-a').unit.status, 'verpasst');
  assert.equal(findUnit('u-a').unit.reason, 'krank');
  assert.equal(findUnit('u-b').unit.status, 'geplant', 'second unit unchanged');
});

test('completeUnit: creates a session, calculates pace, marks the unit done + links it', () => {
  seedPlan();
  const { plan, unit } = findUnit('u-a');
  const session = completeUnit(plan, unit, { distanceKm: 10, durationSec: 3000, rpe: 6 });

  assert.ok(session.id.startsWith('ses'), 'session ID');
  assert.equal(session.plannedId, 'u-a');
  assert.equal(session.eventId, 'e1');
  assert.equal(session.distanceKm, 10);
  assert.equal(session.paceSecPerKm, 300, 'pace = durationSec/distanceKm (3000/10)');
  assert.ok(store.get('sessions').some((s) => s.id === session.id), 'stored in sessions');

  const after = findUnit('u-a').unit;
  assert.equal(after.status, 'erledigt');
  assert.equal(after.executedSessionId, session.id, 'unit links to the session');
});

test('completeUnit: pace stays null without a distance', () => {
  seedPlan();
  const { plan, unit } = findUnit('u-b');
  const s = completeUnit(plan, unit, { durationSec: 900 });
  assert.equal(s.distanceKm, null);
  assert.equal(s.paceSecPerKm, null);
});

test('TRAIN-23: completed football without a duration counts with the planned duration, not with 30 min', () => {
  store.upsert('plans', { id: 'p2', eventId: 'e1', units: [
    { id: 'fb', date: '2026-07-06', type: 'cross_football', title: 'Fußballtraining', status: 'geplant', fixed: true, intensity: 'normal', targetDurationMin: 90 },
  ] });
  const { plan, unit } = findUnit('fb');
  const s = completeUnit(plan, unit, { rpe: null });   // only "done", no values
  assert.equal(s.plannedDurationMin, 90);
  assert.equal(sessionLoad(s), 90 * 7);                 // previously 30 × 7 = 210
});
