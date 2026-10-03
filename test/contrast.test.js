/* =========================================================================
   contrast.test.js — UI-12/UI-32: Text auf und aus Akzent- und Statusfarben
   erreicht WCAG AA (≥ 4,5:1) – für alle wählbaren Akzente, hell und dunkel.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, luminance, mix, onAccent, textOn, accentPalette } from '../js/contrast.js';

const ACCENTS = ['#18b48a', '#2bb673', '#19b9c9', '#3d8bff', '#7c5cff', '#ff5d8f', '#ff8a3d', '#f5b300'];
const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
/** Token-Wert aus einem Theme-Block von style.css lesen. */
function token(block, name) {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : null;
}
const LIGHT = ':root, [data-theme="light"] {';
const DARK = '[data-theme="dark"] {';

test('Formeln: Luminanz und Kontrast wie WCAG (Schwarz/Weiß 21:1)', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  // Messwert aus dem Befund: Weiß auf dem Standardgrün nur 2,65:1.
  assert.ok(Math.abs(contrast('#ffffff', '#18b48a') - 2.65) < 0.02);
});

test('UI-12: Schrift auf jeder wählbaren Akzentfläche ≥ 4,5:1', () => {
  for (const a of ACCENTS) {
    const c = contrast(onAccent(a), a);
    assert.ok(c >= 4.5, `${a}: ${c.toFixed(2)}`);
  }
});

test('UI-12/UI-32: Akzent als Text ≥ 4,5:1 – hell auf Seite und Soft-Grund, dunkel auf allen Flächen', () => {
  for (const a of ACCENTS) {
    const light = accentPalette(a, false);
    const dark = accentPalette(a, true);
    for (const bg of ['#eef1f5', '#ffffff', mix('#eef1f5', a, 0.14)]) {
      assert.ok(contrast(light.text, bg) >= 4.5, `hell ${a} auf ${bg}: ${contrast(light.text, bg).toFixed(2)}`);
    }
    for (const bg of ['#0c0f13', '#161b22', '#1d242c', mix('#1d242c', a, 0.14)]) {
      assert.ok(contrast(dark.text, bg) >= 4.5, `dunkel ${a} auf ${bg}: ${contrast(dark.text, bg).toFixed(2)}`);
    }
    // Hero-Verlauf: die Schrift hält an beiden Enden 4,5:1.
    assert.ok(contrast(light.contrast, a) >= 4.5 && contrast(light.contrast, light.heroEnd) >= 4.5, `Hero ${a}`);
  }
});

test('UI-12: Status- und Nebentextfarben in style.css erreichen 4,5:1', () => {
  const pairs = [
    [LIGHT, ['good-text', 'warn-text', 'bad-text', 'info-text', 'text-2', 'text-3'], ['#eef1f5', '#ffffff', '#f1f4f7']],
    [DARK, ['good-text', 'warn-text', 'bad-text', 'info-text', 'text-2', 'text-3'], ['#0c0f13', '#161b22', '#1d242c']],
  ];
  for (const [block, names, bgs] of pairs) {
    for (const n of names) {
      const v = token(block, n);
      assert.ok(v, `${n} fehlt in ${block}`);
      for (const bg of bgs) assert.ok(contrast(v, bg) >= 4.5, `${n} ${v} auf ${bg}: ${contrast(v, bg).toFixed(2)}`);
    }
  }
  // Weiße Schrift auf Erfolgs-/Fehler-Toasts
  for (const n of ['good-strong', 'bad-strong']) {
    const v = token(':root {', n);
    assert.ok(v && contrast('#ffffff', v) >= 4.5, `${n}: ${v}`);
  }
});

test('textOn verändert eine schon lesbare Farbe nicht', () => {
  assert.equal(textOn('#000000', '#ffffff'), '#000000');
  assert.equal(textOn('#123456', '#ffffff'), '#123456');
});
