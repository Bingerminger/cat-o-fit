/* Recipes in every language: each ingredient line of the suggested recipes must parse to the same
   unit and amount, land in the same food category and give the same kcal/protein estimate as the
   German original. This guards the per-language vocabularies in js/food.js and js/energy.js – a
   catalog edit that renames "c. à s." or "colher de sopa" would otherwise silently change the
   shopping list and the calorie estimate. Runs with the language switched, as in the app. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIngredient, guessCategory } from '../js/food.js';
import { estimateNutrition } from '../js/energy.js';
import { setLocale } from '../js/i18n.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const LANGS = Object.keys(read('locales/languages.json')).filter((l) => l !== 'de');
const de = read('locales/de/recipes.json');
const close = (a, b) => (a == null || b == null ? a === b : Math.abs(a - b) <= Math.abs(b) * 0.001 + 1e-9);

function shape(lines) {
  return lines.map((line) => {
    const p = parseIngredient(line);
    return { unit: p.unit, amount: p.amount, category: guessCategory(p.name) };
  });
}

for (const lang of LANGS) {
  test(`recipes: ${lang} ingredients parse like German (unit, amount, category, kcal, protein)`, async () => {
    const own = read(`locales/${lang}/recipes.json`);
    const german = Object.fromEntries(Object.entries(de).map(([id, r]) => [id, { lines: shape(r.ingredients), sum: estimateNutrition(r.ingredients) }]));
    await setLocale(lang);
    try {
      const diffs = [];
      for (const [id, r] of Object.entries(de)) {
        const lines = own[id]?.ingredients || [];
        assert.equal(lines.length, r.ingredients.length, `${lang} ${id}: number of ingredient lines`);
        shape(lines).forEach((got, i) => {
          const want = german[id].lines[i];
          if (got.unit !== want.unit || !close(got.amount, want.amount) || got.category !== want.category) {
            diffs.push(`${id}: "${r.ingredients[i]}" ${JSON.stringify(want)} ≠ "${lines[i]}" ${JSON.stringify(got)}`);
          }
        });
        const sum = estimateNutrition(lines), want = german[id].sum;
        if (!close(sum.kcal, want.kcal) || !close(sum.protein, want.protein)) {
          diffs.push(`${id}: ${want.kcal} kcal / ${want.protein} g ≠ ${sum.kcal} kcal / ${sum.protein} g`);
        }
      }
      assert.deepEqual(diffs, [], diffs.join('\n'));
    } finally {
      await setLocale('de');
    }
  });
}
