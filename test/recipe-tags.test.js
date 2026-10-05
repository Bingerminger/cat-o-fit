/* Recipe tags are stored as ids ('proteinreich', 'meal-prep', …) – the taste learning compares those.
   The UI shows built-in tags in the active language and maps a typed label back to its id; tags a
   person invents stay exactly as typed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagLabel, tagFromLabel } from '../js/nutrition.js';
import { setLocale } from '../js/i18n.js';

test('recipe tags: built-in tags show in the active language, own tags stay as typed', async () => {
  assert.equal(tagLabel('vor-dem-training'), 'vor dem Training');
  assert.equal(tagLabel('Familienliebling'), 'Familienliebling');
  await setLocale('en');
  try {
    assert.equal(tagLabel('proteinreich'), 'high-protein');
    assert.equal(tagLabel('meal-prep'), 'meal prep');
  } finally {
    await setLocale('de');
  }
});

test('recipe tags: a typed label (any case) or the id maps back to the stored id', async () => {
  await setLocale('en');
  try {
    assert.equal(tagFromLabel(' High-protein '), 'proteinreich');
    assert.equal(tagFromLabel('meal-prep'), 'meal-prep');
    assert.equal(tagFromLabel('family favourite'), 'family favourite');
  } finally {
    await setLocale('de');
  }
  assert.equal(tagFromLabel('Low Carb'), 'low-carb');
});
