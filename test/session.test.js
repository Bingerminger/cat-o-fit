/* =========================================================================
   session.test.js — die Einheiten-Mutationen aus session.js, die auch der
   Workout-Modus nutzt: findUnit (Lookup über alle Pläne), saveUnitPatch
   (gezieltes Patchen) und completeUnit (geplante Einheit -> durchgeführte
   Session + Erledigt-Verlinkung). Das ist das Umfeld, in dem whatif greift.
   ========================================================================= */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { findUnit, saveUnitPatch, completeUnit } from '../js/session.js';

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

test('findUnit: findet Einheit + zugehörigen Plan; sonst null', () => {
  seedPlan();
  const hit = findUnit('u-b');
  assert.ok(hit, 'Einheit gefunden');
  assert.equal(hit.plan.id, 'p1');
  assert.equal(hit.unit.title, 'Mobility');
  assert.equal(findUnit('gibt-es-nicht'), null);
});

test('saveUnitPatch: patcht genau eine Einheit, andere unberührt', () => {
  seedPlan();
  saveUnitPatch('p1', 'u-a', { status: 'verpasst', reason: 'krank' });
  assert.equal(findUnit('u-a').unit.status, 'verpasst');
  assert.equal(findUnit('u-a').unit.reason, 'krank');
  assert.equal(findUnit('u-b').unit.status, 'geplant', 'zweite Einheit unverändert');
});

test('completeUnit: erzeugt Session, berechnet Pace, markiert Einheit erledigt + verlinkt', () => {
  seedPlan();
  const { plan, unit } = findUnit('u-a');
  const session = completeUnit(plan, unit, { distanceKm: 10, durationSec: 3000, rpe: 6 });

  assert.ok(session.id.startsWith('ses'), 'Session-ID');
  assert.equal(session.plannedId, 'u-a');
  assert.equal(session.eventId, 'e1');
  assert.equal(session.distanceKm, 10);
  assert.equal(session.paceSecPerKm, 300, 'Pace = durationSec/distanceKm (3000/10)');
  assert.ok(store.get('sessions').some((s) => s.id === session.id), 'in sessions gespeichert');

  const after = findUnit('u-a').unit;
  assert.equal(after.status, 'erledigt');
  assert.equal(after.executedSessionId, session.id, 'Einheit verlinkt auf die Session');
});

test('completeUnit: Pace bleibt null ohne Distanz', () => {
  seedPlan();
  const { plan, unit } = findUnit('u-b');
  const s = completeUnit(plan, unit, { durationSec: 900 });
  assert.equal(s.distanceKm, null);
  assert.equal(s.paceSecPerKm, null);
});
