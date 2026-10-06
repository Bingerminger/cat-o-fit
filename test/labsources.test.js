/* Where to get lab values: the routes describe Germany (insurers, fee schedule, prices in euros).
   They apply when the person's place is in Germany or – without a place – when the app speaks
   German; everywhere else the labs view and the help give a general note instead. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { inGermany, labSourcesTeaser } from '../js/labsources.js';
import { setLocale } from '../js/i18n.js';

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Robin', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
});

test('German detail: German without a place, a place in Germany in any language', async () => {
  assert.equal(inGermany(), true, 'German, no place');
  await setLocale('en');
  try {
    assert.equal(inGermany(), false, 'English, no place');
    assert.match(labSourcesTeaser(), /depends on your country/);
    store.setSetting('location', { name: 'Leipzig', country: 'DE', lat: 51.34, lon: 12.37 });
    assert.equal(inGermany(), true, 'English, place in Germany');
  } finally {
    await setLocale('de');
  }
  store.setSetting('location', { name: 'Wien', country: 'AT', lat: 48.21, lon: 16.37 });
  assert.equal(inGermany(), false, 'German, place in Austria');
});
