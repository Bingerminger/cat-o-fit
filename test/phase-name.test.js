/* Phase names follow the person's language by their key (4.2) – a plan made in German used to show
   "Grundlage · Aufbau" in a French view. Without a known key the stored name stays. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { phaseName } from '../js/planflow.js';
import { setLocale } from '../js/i18n.js';

after(() => setLocale('de'));

test('race plan and programme phases in the language of the view', async () => {
  const race = { kind: 'race' };
  const prog = { kind: 'program' };
  await setLocale('fr');
  const fr = phaseName(race, { key: 'base', name: 'Grundlage' });
  assert.notEqual(fr, 'Grundlage');
  assert.ok(fr.length > 2);
  await setLocale('en');
  assert.equal(phaseName(race, { key: 'taper', name: 'Tapering' }), 'Taper');
  assert.equal(phaseName(prog, { key: 'intro', name: 'Eingewöhnung' }) !== 'Eingewöhnung', true);
  assert.equal(phaseName(race, { key: 'custom', name: 'Meine Phase' }), 'Meine Phase', 'unknown key: as stored');
  assert.equal(phaseName(race, { name: 'Ohne Schlüssel' }), 'Ohne Schlüssel');
  assert.equal(phaseName(race, null), '');
});
