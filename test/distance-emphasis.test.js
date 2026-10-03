/* Test für die distanzspezifische Schwerpunkt-Klassifikation (js/plans.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceEmphasis } from '../js/plans.js';

test('distanceEmphasis: klassifiziert Schlüsseleinheiten-Schwerpunkt nach Distanz', () => {
  assert.equal(distanceEmphasis(5).key, '5k');
  assert.equal(distanceEmphasis(5).short, true);
  assert.equal(distanceEmphasis(10).key, '10k');
  assert.equal(distanceEmphasis(10).short, true);
  assert.equal(distanceEmphasis(21.1).key, 'hm');
  assert.equal(distanceEmphasis(21.1).marathon, false);
  assert.equal(distanceEmphasis(42.2).key, 'marathon');
  assert.equal(distanceEmphasis(42.2).marathon, true);
  assert.equal(distanceEmphasis().key, 'hm');        // Default = Halbmarathon
  assert.ok(distanceEmphasis(42.2).focus.includes('Marathon'));
});
