/* Securing documentation statements with tests (DOC-12, DOC-13, DOC-21, DOC-27):
   - Every relative link and image in the Markdown files points to an existing file,
     every anchor to an existing heading (GitHub spelling).
   - No byte-identical duplicates among the documentation images.
   - Numbers in the text match the code (exercises, recipes, lab values, people, tests).
   - Version: js/version.js = package.json = topmost CHANGELOG entry.
   - Menu paths ("More → …", "Progress → …", "Settings → …") really exist.
   - German quotation marks close at the top („…“), not with the straight character.
   Before v3.21.0 nothing checked the documentation – numbers, paths and images drifted unnoticed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.claude', 'node_modules', 'graphify-out', 'scratch', '.understand-anything', '.playwright-mcp', 'seed']);

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
const mdFiles = walk(ROOT, (p) => p.endsWith('.md') && !p.includes(`${join('docs', 'assets')}`));
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p);

/** Markdown without code blocks and inline code (there, "links" are only examples). */
function prose(md) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub anchor of a heading. */
function slug(text) {
  return text.trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  const set = new Set();
  for (const line of read(file).replace(/```[\s\S]*?```/g, '').split('\n')) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) || 0;
    set.add(n ? `${base}-${n}` : base);
    seen.set(base, n + 1);
  }
  for (const m of read(file).matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) set.add(m[1]);
  anchorCache.set(file, set);
  return set;
}

function linksOf(md) {
  const out = [];
  const text = prose(md);
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) out.push(m[1]);
  return out.filter((t) => !/^(https?:|mailto:|webcal:|data:)/.test(t));
}

test('DOC-12: all relative links and images in the documentation point to existing files and anchors', () => {
  assert.ok(mdFiles.length >= 25, `only ${mdFiles.length} Markdown files found`);
  const broken = [];
  for (const file of mdFiles) {
    for (const target of linksOf(read(file))) {
      const [path, anchor] = target.split('#');
      const dest = path ? join(dirname(file), decodeURIComponent(path)) : file;
      if (!existsSync(dest)) { broken.push(`${rel(file)} → ${target} (Datei fehlt)`); continue; }
      if (anchor && dest.endsWith('.md') && !anchorsOf(dest).has(decodeURIComponent(anchor))) {
        broken.push(`${rel(file)} → ${target} (Anker fehlt)`);
      }
    }
  }
  assert.deepEqual(broken, [], broken.join('\n'));
});

test('DOC-13: no byte-identical duplicates among the documentation images', () => {
  const imgs = walk(join(ROOT, 'docs', 'assets'), (p) => /\.(png|jpe?g|webp)$/i.test(p));
  const byHash = new Map();
  for (const p of imgs) {
    const h = createHash('md5').update(readFileSync(p)).digest('hex');
    byHash.set(h, [...(byHash.get(h) || []), rel(p)]);
  }
  const dups = [...byHash.values()].filter((l) => l.length > 1);
  assert.deepEqual(dups, []);
});

test('DOC-12: numbers in the documentation match the code', async () => {
  const { EXERCISES } = await import('../js/exercises.js');
  const { SUGGESTED_MEALS } = await import('../js/nutrition.js');
  const { ANALYTES } = await import('../js/labs.js');
  const { MAX_MEMBERS } = await import('../js/storage.js');
  const sources = [...mdFiles.filter((f) => !f.endsWith('CHANGELOG.md')), join(ROOT, 'js', 'helpcontent.js')].map((f) => [rel(f), read(f)]);
  const wrong = [];
  const expect = (re, actual, what) => {
    for (const [name, text] of sources) {
      for (const m of text.matchAll(re)) if (Number(m[1]) !== actual) wrong.push(`${name}: „${m[0]}“ – im Code ${actual} ${what}`);
    }
  };
  expect(/(\d+) Übungen/g, EXERCISES.length, 'Übungen');
  expect(/(\d+) (?:Rezepte|Gerichte)\b/g, SUGGESTED_MEALS.length, 'Rezepte');
  expect(/(\d+) sportrelevante/g, Object.keys(ANALYTES).length, 'Analyte');
  expect(/bis zu (\d+) Personen/g, MAX_MEMBERS, 'Personen');
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

test('DOC-27: the test count in the README is a lower bound that is correct', () => {
  const count = walk(join(ROOT, 'test'), (p) => p.endsWith('.test.js'))
    .reduce((n, f) => n + (read(f).match(/^\s*test\(/gm) || []).length, 0);
  const en = read(join(ROOT, 'README.md')).match(/(\d+)\+ automated tests/);
  const de = read(join(ROOT, 'README.de.md')).match(/über (\d+) automatisierte Tests/);
  assert.ok(en && de, 'README states the test count');
  assert.ok(count >= Number(en[1]) && count >= Number(de[1]), `${count} tests, README promises ${en[1]}+ / more than ${de[1]}`);
  assert.doesNotMatch(read(join(ROOT, 'README.md')), /badge\/Tests-\d+/, 'no static test badge any more');
});

test('DOC-12: version identical in version.js, package.json and topmost CHANGELOG entry', async () => {
  const { APP_VERSION } = await import('../js/version.js');
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const top = read(join(ROOT, 'CHANGELOG.md')).match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(top && top[1], APP_VERSION);
  assert.match(read(join(ROOT, 'service-worker.js')), /const VERSION = 'catofit-v\d+';/);
});

test('DOC-12: menu paths in the documentation and help really exist', async () => {
  const { MORE_GROUPS, PROGRESS_TABS } = await import('../js/nav.js');
  const more = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.label));
  const progress = PROGRESS_TABS.map((t) => t.label);
  // Settings section headings: keys in settings.js, German text from the catalog.
  const deUi = JSON.parse(read(join(ROOT, 'locales', 'de', 'ui.json')));
  const heading = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), deUi);
  const settings = [...read(join(ROOT, 'js', 'settings.js')).matchAll(/sectionHead\(t\('([\w.]+)'\)/g)].map((m) => heading(m[1])).filter(Boolean);
  // The German help texts live in the catalog since v4.0.0.
  const files = [...mdFiles.filter((f) => /docs[\\/](nutzung|betrieb|wissen)|APPLE-HEALTH|README/.test(f)), join(ROOT, 'locales', 'de', 'help.json')];
  const bad = [];
  const check = (text, name, re, allowed, what) => {
    for (const m of text.matchAll(re)) {
      const seg = m[1].replace(/[*„“"]/g, '').trim();
      if (!allowed.some((a) => seg.startsWith(a))) bad.push(`${name}: ${what} → „${seg}“`);
    }
  };
  for (const f of files) {
    // Treat line breaks in running text (Markdown) and indentation like a single space.
    const text = read(f).replace(/\*\*/g, '').replace(/\s*\n\s*(?:>\s*)?/g, ' ');
    check(text, rel(f), /(?<![\w-])Mehr → „?([^„“,.;)]+)/g, [...more, 'Abmelden'], 'Mehr');
    check(text, rel(f), /(?<![\w-])Fortschritt → „?([A-ZÄÖÜ][^„“,.;)→]*)/g, progress, 'Fortschritt');
    // "iOS Settings → …" means the iPhone system settings, not the app.
    check(text, rel(f), /(?<![\w-])Einstellungen → „?([A-ZÄÖÜ][^„“,.;)→]*)/g, settings, 'Einstellungen');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('DOC-21: German quotation marks close at the top (no „…" with a straight character)', () => {
  const files = [...mdFiles, ...walk(join(ROOT, 'js'), (p) => p.endsWith('.js')), join(ROOT, 'index.html')];
  const bad = [];
  for (const f of files) {
    const text = read(f);
    text.split('\n').forEach((line, i) => {
      if (/„[^“"\n]{0,120}"/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
    });
    // Quotes wrapped inside running text („… line end / rest …") – Markdown only, without code blocks.
    if (f.endsWith('.md')) {
      for (const m of prose(text).matchAll(/„[^“"\n]{0,160}\n[^“"\n]{0,160}"/g)) bad.push(`${rel(f)}: „${m[0].slice(1, 40).replace(/\n/g, ' ')}…`);
    }
  }
  assert.deepEqual(bad.slice(0, 40), [], `${bad.length} places, e.g.:\n${bad.slice(0, 40).join('\n')}`);
});
