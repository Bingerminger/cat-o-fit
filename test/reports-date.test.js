/* The day a report or certificate was created is the device's calendar day, not the UTC day. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createdDay } from '../js/reports.js';

function inZone(tz, fn) {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
}

test('report date: local day around midnight, in summer time and west of UTC', () => {
  assert.equal(inZone('Europe/Berlin', () => createdDay('2026-12-31T23:30:00.000Z')), '2027-01-01', 'New Year at 0:30 in Berlin');
  assert.equal(inZone('Europe/Berlin', () => createdDay('2026-10-24T23:30:00.000Z')), '2026-10-25', 'summer time, 1:30');
  assert.equal(inZone('America/New_York', () => createdDay('2026-11-08T01:30:00.000Z')), '2026-11-07', 'Saturday evening in New York');
  assert.equal(inZone('Europe/Berlin', () => createdDay('2026-06-15T10:00:00.000Z')), '2026-06-15');
  assert.equal(createdDay(''), '');
});
