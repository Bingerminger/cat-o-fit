/* =========================================================================
   i18n.js — translations without a library.

   Catalogs live in locales/<lang>/<area>.json: nested objects, dot keys,
   placeholders as {name}, plurals as key.one / key.other (plus the other
   Intl.PluralRules categories where a language needs them). English is the
   source language; lookup order is active language → English → the key itself.

   'ui' is loaded at start. Bigger areas (help, exercises, …) are loaded on
   demand with loadArea(); a key whose first segment names such an area is
   looked up there ('help.loadForm.title' → help.json, key 'loadForm.title').
   Every other key lives in ui.json, whose top-level sections therefore never
   use an area name (test/i18n-catalog.test.js checks that).

   The list of languages is locales/languages.json (code → endonym), so a new
   language needs a catalog folder and one entry there, no code.
   ========================================================================= */

export const SOURCE_LANGUAGE = 'en';
/** Areas loaded on demand; their name is the first segment of their keys. */
export const LAZY_AREAS = ['help', 'exercises', 'workouts', 'recipes', 'health'];

let languageNames = { en: 'English' };   // replaced by locales/languages.json
const catalogs = Object.create(null);    // lang -> area -> object
const listeners = new Set();
const pluralRules = new Map();
const countFormats = new Map();
let current = SOURCE_LANGUAGE;

/** Reads a file below locales/ (e.g. 'de/ui.json'). Tests swap it for a file-system reader. */
let loader = async (path) => {
  const res = await fetch(`locales/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for locales/${path}`);
  return res.json();
};
export function setLoader(fn) { loader = fn; }

/** Loads locales/languages.json; keeps the built-in list when it is unreachable. */
export async function loadLanguages() {
  try {
    const list = await loader('languages.json');
    if (list && typeof list === 'object' && Object.keys(list).length) languageNames = list;
  } catch { /* offline and not cached: English only */ }
  return languages();
}
/** Supported languages as { code: endonym }, in display order. */
export function languages() { return { ...languageNames }; }
export function locale() { return current; }
export function register(lang, area, data) { (catalogs[lang] ||= Object.create(null))[area] = data; }

/** Best supported language for one or more BCP-47 tags (e.g. navigator.languages); null if none fits. */
export function matchLanguage(tags) {
  const codes = Object.keys(languageNames);
  for (const raw of [].concat(tags || [])) {
    const tag = String(raw || '').trim().replace('_', '-').toLowerCase();
    if (!tag) continue;
    const exact = codes.find((c) => c.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split('-')[0];
    const byBase = codes.find((c) => c.split('-')[0].toLowerCase() === base);
    if (byBase) return byBase;
  }
  return null;
}

/**
 * Language to show: the person's choice, else the instance default, else German for
 * instances set up before v4.0.0 (they were German-only), else the browser language.
 */
export function resolveLanguage({ person, instance, legacy = false, browser } = {}) {
  return matchLanguage(person) || matchLanguage(instance) || (legacy ? matchLanguage('de') : null)
    || matchLanguage(browser) || SOURCE_LANGUAGE;
}

async function ensure(lang, area) {
  if (catalogs[lang] && catalogs[lang][area]) return true;
  try { register(lang, area, await loader(`${lang}/${area}.json`)); return true; }
  catch { return false; }   // offline or missing: English steps in
}

/** Loads an area for the active language and for English (the fallback). */
export async function loadArea(area) {
  await Promise.all([ensure(current, area), ensure(SOURCE_LANGUAGE, area)]);
}

/** Switches the language and loads 'ui' plus every area loaded so far; true if it changed. */
export async function setLocale(lang) {
  const next = matchLanguage(lang) || SOURCE_LANGUAGE;
  const areas = new Set(['ui']);
  for (const l in catalogs) for (const a in catalogs[l]) areas.add(a);
  await Promise.all([...areas].flatMap((a) => [ensure(next, a), ensure(SOURCE_LANGUAGE, a)]));
  const changed = next !== current;
  current = next;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = next;
  if (changed) listeners.forEach((fn) => { try { fn(next); } catch { /* keep notifying */ } });
  return changed;
}
export function onLocaleChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function lookup(lang, key) {
  const parts = String(key).split('.');
  const area = LAZY_AREAS.includes(parts[0]) ? parts.shift() : 'ui';
  let node = catalogs[lang] && catalogs[lang][area];
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[p];
  }
  return node;
}
function value(key) {
  // Looked up before any catalog is loaded – i.e. at import time. Recorded for the guard in
  // test/i18n-catalog.test.js; in the browser such a text would show its key.
  if (!catalogs[current] && !catalogs[SOURCE_LANGUAGE]) (globalThis.__i18nEarly ||= []).push(String(key));
  const v = lookup(current, key);
  return v === undefined && current !== SOURCE_LANGUAGE ? lookup(SOURCE_LANGUAGE, key) : v;
}
function fill(str, params) {
  if (!params || !str.includes('{')) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));
}

/** Text for a key; params fill its {placeholders}. An unknown key comes back unchanged. */
export function t(key, params) {
  const v = value(key);
  return typeof v === 'string' ? fill(v, params) : key;
}

/** Plural form for count (Intl.PluralRules); {count} is the number, formatted for the language. */
export function tp(key, count, params = {}) {
  let rules = pluralRules.get(current);
  if (!rules) { try { rules = new Intl.PluralRules(current); } catch { rules = null; } pluralRules.set(current, rules); }
  const cat = rules ? rules.select(Number(count)) : 'other';
  const k = typeof value(`${key}.${cat}`) === 'string' ? `${key}.${cat}` : `${key}.other`;
  return t(k, { count: formatCount(count), ...params });
}
function formatCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  let f = countFormats.get(current);
  if (!f) { try { f = new Intl.NumberFormat(current); } catch { f = null; } countFormats.set(current, f); }
  return f ? f.format(n) : String(n);
}

/** A list from the catalog (e.g. weekday names); null if it is missing. */
export function tList(key) {
  const v = value(key);
  return Array.isArray(v) ? v : null;
}

/** True if the key exists in the active language or in English. */
export function has(key) { return value(key) !== undefined; }
