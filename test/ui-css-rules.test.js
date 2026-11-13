/* Two CSS rules that protect usability (4.2): a toast never swallows a tap on what lies below (only its
   own button takes taps), and a badge not yet earned keeps readable texts (no opacity on the card). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL(`../css/${f}`, import.meta.url), 'utf8');
const block = (text, selector) => {
  const i = text.indexOf(`${selector} {`);
  assert.ok(i >= 0, `${selector} not found`);
  return text.slice(i, text.indexOf('}', i));
};

test('toast: taps go through, only its action button takes them', () => {
  const s = css('style.css');
  assert.match(block(s, '.toast'), /pointer-events:\s*none/);
  assert.match(block(s, '.toast__action'), /pointer-events:\s*auto/);
});

test('locked badge: no opacity on the card – the picture fades, the texts stay readable', () => {
  const c = css('cards.css');
  assert.doesNotMatch(block(c, '.badge-card'), /opacity/);
  assert.match(block(c, '.badge-card:not(.is-unlocked) .badge-card__emoji'), /opacity/);
});
