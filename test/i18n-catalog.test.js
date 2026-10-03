// Guards the translation catalogs in locales/: every language has the same keys as
// English, the same placeholders and all plural forms it needs; every key the code
// uses exists, no catalog key goes unused, and translated modules stay free of
// hard-coded German text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { LAZY_AREAS, SOURCE_LANGUAGE } from '../js/i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const LANGS = Object.keys(JSON.parse(read('locales/languages.json')));
const AREAS = readdirSync(new URL(`locales/${SOURCE_LANGUAGE}/`, ROOT)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Modules whose user-facing text lives in the catalogs; P1 adds every module it converts. */
const TRANSLATED_MODULES = ['js/i18n.js', 'js/format.js', 'js/language.js'];
/** Key prefixes the code builds at run time (e.g. `format.${x}`); listed here so they count as used. */
const DYNAMIC_PREFIXES = ['format.'];   // format.js picks names and patterns via variables

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}
const catalog = (lang, area) => flatten(JSON.parse(read(`locales/${lang}/${area}.json`)));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const pluralBase = (key) => { const i = key.lastIndexOf('.'); return PLURAL.includes(key.slice(i + 1)) ? key.slice(0, i) : null; };

test('every language has a catalog for every area', () => {
  assert.deepEqual(LANGS[0], SOURCE_LANGUAGE);
  for (const lang of LANGS) {
    for (const area of AREAS) assert.ok(existsSync(new URL(`locales/${lang}/${area}.json`, ROOT)), `${lang}/${area}.json is missing`);
  }
});

test('same keys, same placeholders, non-empty texts, lists of equal length', () => {
  for (const area of AREAS) {
    const en = catalog(SOURCE_LANGUAGE, area);
    for (const lang of LANGS) {
      const cat = catalog(lang, area);
      const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      for (const [key, v] of en) {
        const base = pluralBase(key);
        if (base && !cat.has(key) && key.endsWith('.one') && !cats.includes('one')) continue;
        assert.ok(cat.has(key), `${lang}/${area}: ${key} is missing`);
        const w = cat.get(key);
        if (Array.isArray(v)) {
          assert.ok(Array.isArray(w) && w.length === v.length, `${lang}/${area}: ${key} must be a list of ${v.length} entries`);
          assert.ok(w.every((x) => typeof x === 'string' && x.trim()), `${lang}/${area}: ${key} has empty entries`);
        } else {
          assert.ok(typeof w === 'string' && w.trim(), `${lang}/${area}: ${key} is empty`);
          const ref = base ? en.get(`${base}.other`) : v;
          assert.equal(placeholders(w), placeholders(ref), `${lang}/${area}: ${key} has different placeholders`);
        }
      }
      for (const key of cat.keys()) {
        if (en.has(key)) continue;
        const base = pluralBase(key);
        const form = key.slice(key.lastIndexOf('.') + 1);
        assert.ok(base && en.has(`${base}.other`) && cats.includes(form), `${lang}/${area}: ${key} does not exist in English`);
      }
    }
  }
});

test('ui sections never use the name of a lazily loaded area', () => {
  const top = Object.keys(JSON.parse(read(`locales/${SOURCE_LANGUAGE}/ui.json`)));
  for (const name of top) assert.ok(!LAZY_AREAS.includes(name), `ui.json: section "${name}" clashes with an area name`);
});

// Keys used in code: literal first arguments of t(), tp(), tList() and has() in modules
// that import i18n.js.
function jsFiles(dir = 'js/') {
  return readdirSync(new URL(dir, ROOT), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? jsFiles(`${dir}${d.name}/`) : d.name.endsWith('.js') ? [`${dir}${d.name}`] : []);
}
function usedKeys() {
  const used = new Map();
  for (const file of jsFiles()) {
    const src = read(file);
    if (!/from '\.\/i18n\.js'/.test(src) && file !== 'js/i18n.js') continue;
    for (const m of src.matchAll(/\b(t|tp|tList|has)\(\s*'([A-Za-z0-9_.]+)'/g)) {
      used.set(m[1] === 'tp' ? `${m[2]}.other` : m[2], file);
    }
  }
  return used;
}
function enKeys() {
  const all = new Map();
  for (const area of AREAS) {
    for (const [k, v] of catalog(SOURCE_LANGUAGE, area)) all.set(area === 'ui' ? k : `${area}.${k}`, v);
  }
  return all;
}

test('every key the code uses exists in the English catalog', () => {
  const en = enKeys();
  for (const [key, file] of usedKeys()) assert.ok(en.has(key), `${file}: key ${key} is missing in locales/en`);
});

test('no catalog key goes unused', () => {
  const used = usedKeys();
  for (const key of enKeys().keys()) {
    const base = pluralBase(key);
    const k = base ? `${base}.other` : key;
    assert.ok(used.has(k) || DYNAMIC_PREFIXES.some((p) => key.startsWith(p)), `locales/en: ${key} is never used`);
  }
});

test('translated modules contain no hard-coded German text', () => {
  for (const file of TRANSLATED_MODULES) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const literals = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
    const german = literals.filter((s) => /[äöüÄÖÜß]/.test(s));
    assert.deepEqual(german, [], `${file}: German text belongs in locales/de`);
  }
});
