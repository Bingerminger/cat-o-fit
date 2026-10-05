// Guards the translation catalogs in locales/: every language has the same keys as
// English, the same placeholders and all plural forms it needs; every key the code
// uses exists, no catalog key goes unused, and translated modules stay free of
// hard-coded German text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LAZY_AREAS, SOURCE_LANGUAGE } from '../js/i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const LANGS = Object.keys(JSON.parse(read('locales/languages.json')));
const AREAS = readdirSync(new URL(`locales/${SOURCE_LANGUAGE}/`, ROOT)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Modules whose user-facing text lives in the catalogs; P1 adds every module it converts. */
const TRANSLATED_MODULES = [
  'js/i18n.js', 'js/format.js', 'js/language.js',
  'js/ui.js', 'js/nav.js', 'js/app.js', 'js/login.js', 'js/api-client.js', 'js/session-gate.js', 'js/router.js',
  'js/calendar.js', 'js/coach.js', 'js/triage.js', 'js/whatif.js', 'js/workout-mode.js', 'js/workout-engine.js',
  'js/events.js', 'js/session.js', 'js/unit-actions.js', 'js/capture.js', 'js/plans.js', 'js/commitments.js',
  'js/rolling.js', 'js/dualgoal.js', 'js/vdot.js', 'js/exercises.js',
  'js/dashboard.js', 'js/dashboard-coach.js', 'js/dashboard-goals.js', 'js/plangen.js', 'js/program.js',
  'js/show-program.js', 'js/motion-player.js', 'js/workouts.js', 'js/helpcontent.js', 'js/checklist.js', 'js/shopping.js',
  'js/badges.js', 'js/report.js', 'js/reports.js', 'js/statistics.js', 'js/charts.js',
  'js/health.js', 'js/health-import.js', 'js/healthdata.js', 'js/cycle.js', 'js/cyclecalc.js', 'js/family.js', 'js/family-admin.js',
  'js/settings.js', 'js/workout-show.js', 'js/load.js', 'js/fitness.js', 'js/adaptive.js', 'js/redflags.js',
  'js/weather.js', 'js/ics-export.js', 'js/suggestions.js', 'js/sollist.js', 'js/help.js', 'js/wellness.js',
  'js/eligibility.js', 'js/strength.js', 'js/hrzones.js', 'js/goals.js', 'js/planflow.js', 'js/formcards.js',
  'js/storage.js', 'js/motion-rig.js', 'js/zip.js', 'js/csv-export.js', 'js/healthgoals.js',
  'js/motion-figure.js', 'js/coach-figure.js', 'js/audio.js',
];
/** Internal values (compared in code, never shown) that happen to be German words. */
const INTERNAL_VALUES = ["'erhöht'", "'Obst & Gemüse'", "'Stück'", "'Rückschlag'", "'geschätzt'", "'Entzündung'", "'Getränke'", "'Meißen'"];
/** Key prefixes the code builds at run time (e.g. `format.${x}`); listed here so they count as used. */
const DYNAMIC_PREFIXES = ['format.', 'sessionTypes.', 'feelings.', 'priorities.', 'status.', 'rpe.',
  'exerciseNames.', 'exerciseAliases.', 'exerciseLib.level.', 'exercises.', 'workoutCatalog.', 'showProgram.parse.', 'motion.breath.', 'plangen.raceLabel.', 'help.sections.', 'help.articles.', 'food.unit.', 'recipes.',
  'server.'];
/** Areas only the server reads (api/i18n.php) – their keys are checked against api/*.php. */
const SERVER_AREAS = ['server'];
/** Key prefixes api/*.php builds at run time (e.g. "import.type.{$type}"). */
const SERVER_DYNAMIC_PREFIXES = ['import.type.', 'import.source.', 'ics.file.'];
/** Languages that must have every key. The others fall back to English until their
    translation pass (package P3); before the v4.0.0 release this list holds all languages. */
const COMPLETE_LANGUAGES = ['en', 'de'];
/** Content whose English source lives in code (the catalogs hold the other languages):
    phase labels and cues of the exercise animations (js/exercise-motions.js). */
const SOURCE_IN_CODE = [{ area: 'exercises', re: /^[^.]+\.(phases|intro)\./ }];

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
        if (!cat.has(key) && !COMPLETE_LANGUAGES.includes(lang)) continue;   // pending translation
        if (!cat.has(key) && SOURCE_IN_CODE.some((s) => s.area === area && s.re.test(key))) continue;
        assert.ok(cat.has(key), `${lang}/${area}: ${key} is missing`);
        const w = cat.get(key);
        if (Array.isArray(v)) {
          assert.ok(Array.isArray(w) && w.length === v.length, `${lang}/${area}: ${key} must be a list of ${v.length} entries`);
          assert.ok(w.every((x) => typeof x === 'string' && x.trim()), `${lang}/${area}: ${key} has empty entries`);
        } else {
          assert.ok(typeof w === 'string' && w.trim(), `${lang}/${area}: ${key} is empty`);
          if (base) {
            // A plural form may leave out {count} ("one change"), but uses no other placeholders.
            const allowed = placeholders(en.get(`${base}.other`)).split(',');
            const own = placeholders(w).split(',').filter(Boolean);
            assert.ok(own.every((p) => allowed.includes(p)), `${lang}/${area}: ${key} has unknown placeholders`);
          } else {
            assert.equal(placeholders(w), placeholders(v), `${lang}/${area}: ${key} has different placeholders`);
          }
        }
      }
      for (const key of cat.keys()) {
        if (en.has(key)) continue;
        if (SOURCE_IN_CODE.some((s) => s.area === area && s.re.test(key))) continue;   // English lives in code
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
    for (const m of src.matchAll(/(?<![.\w])(t|tr|tp|tList|has)\(\s*'([A-Za-z0-9_.]+)'/g)) {
      used.set(m[1] === 'tp' ? `${m[2]}.other` : m[2], file);
    }
  }
  for (const m of read('index.html').matchAll(/data-i18n(?:-aria)?="([A-Za-z0-9_.]+)"/g)) used.set(m[1], 'index.html');
  return used;
}
function enKeys() {
  const all = new Map();
  for (const area of AREAS.filter((a) => !SERVER_AREAS.includes(a))) {
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

test('server catalog: every key api/*.php uses exists in English, none goes unused', () => {
  const en = catalog(SOURCE_LANGUAGE, 'server');
  const used = new Set();
  for (const f of readdirSync(new URL('api/', ROOT)).filter((n) => n.endsWith('.php'))) {
    // server_text($lang, 'key'), server_lookup($lang, 'key') and ics.php's $icsError(<status>, 'key').
    const calls = /(?:server_(?:text|lookup)\(\s*[^,]+|\$icsError\(\s*\d+),\s*'([A-Za-z0-9_.]+)'/g;
    for (const m of read(`api/${f}`).matchAll(calls)) used.add(m[1]);
  }
  // A key ending in a dot is the start of keys built at run time ('ics.file.' . $kind).
  for (const key of used) {
    assert.ok(key.endsWith('.') ? [...en.keys()].some((k) => k.startsWith(key)) : en.has(key), `api: key ${key} is missing in locales/en/server.json`);
  }
  for (const key of en.keys()) {
    assert.ok(used.has(key) || SERVER_DYNAMIC_PREFIXES.some((p) => key.startsWith(p)), `locales/en/server.json: ${key} is never used`);
  }
});

test('no module calls t() while it is being imported (catalogs load later in the browser)', () => {
  // A child process imports every module with empty catalogs; i18n.js records each lookup
  // made before any catalog exists. Tests cannot see this otherwise: test-setup.js loads
  // the catalogs before the first test file imports anything.
  const files = jsFiles().filter((f) => !['js/app.js', 'js/boot-check.js'].includes(f));
  const code = `for (const f of ${JSON.stringify(files)}) await import(new URL(f, ${JSON.stringify(ROOT.href)}).href);
    process.stdout.write(JSON.stringify(globalThis.__i18nEarly || []));`;
  const out = execFileSync(process.execPath, ['--import', './test-setup.js', '--input-type=module', '-e', code], {
    cwd: new URL('.', ROOT), env: { ...process.env, CATOFIT_I18N_SKIP: '1' }, encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)), [], 'keys looked up at import time – move them into a function');
});

test('modules that import t() declare no other variable or parameter called t', () => {
  const found = [];
  for (const file of jsFiles()) {
    const src = read(file);
    const imp = src.match(/import \{([^}]*)\} from '\.\/i18n\.js'/);
    if (!imp || !imp[1].split(',').map((x) => x.trim()).includes('t')) continue;   // imported as t (not "t as …")
    // Comments and quoted strings out, line numbers kept.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    const hits = code.split('\n').map((line, i) => [i + 1, line])
      .filter(([, line]) => /\b(?:let|const|var)\s+t\b|\(\s*t\s*[,)]\s*(?:=>|\{)|function\s+\w*\s*\([^)]*\bt\b(?!\s*\()[^)]*\)|\bt\s*=>|,\s*t\s*\)\s*(?:=>|\{)/.test(line));
    found.push(...hits.map(([n, l]) => `${file}:${n} ${l.trim()}`));
  }
  assert.deepEqual(found, [], 'a local t hides the translation function – rename it');
});

test('translated modules contain no hard-coded German text', () => {
  for (const file of TRANSLATED_MODULES) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const literals = [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
    const german = literals.filter((s) => /[äöüÄÖÜß]/.test(s) && !INTERNAL_VALUES.includes(s));
    assert.deepEqual(german, [], `${file}: German text belongs in locales/de`);
  }
});
