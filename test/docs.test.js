/* Doku-Aussagen mit Tests absichern (DOC-12, DOC-13, DOC-21, DOC-27):
   - Jeder relative Link und jedes Bild in den Markdown-Dateien zeigt auf eine vorhandene Datei,
     jeder Anker auf eine vorhandene Überschrift (GitHub-Schreibweise).
   - Keine byte-gleichen Doppel unter den Doku-Bildern.
   - Zahlen im Text stimmen mit dem Code überein (Übungen, Rezepte, Laborwerte, Personen, Tests).
   - Version: js/version.js = package.json = oberster CHANGELOG-Eintrag.
   - Menüpfade („Mehr → …“, „Fortschritt → …“, „Einstellungen → …“) gibt es wirklich.
   - Deutsche Anführungszeichen schließen oben („…“), nicht mit dem geraden Zeichen.
   Vor v3.21.0 prüfte nichts davon die Doku – Zahlen, Pfade und Bilder drifteten unbemerkt. */
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

/** Markdown ohne Code-Blöcke und Inline-Code (dort sind „Links“ nur Beispiele). */
function prose(md) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub-Anker einer Überschrift. */
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

test('DOC-12: alle relativen Links und Bilder der Doku zeigen auf vorhandene Dateien und Anker', () => {
  assert.ok(mdFiles.length >= 25, `nur ${mdFiles.length} Markdown-Dateien gefunden`);
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

test('DOC-13: keine byte-gleichen Doppel unter den Doku-Bildern', () => {
  const imgs = walk(join(ROOT, 'docs', 'assets'), (p) => /\.(png|jpe?g|webp)$/i.test(p));
  const byHash = new Map();
  for (const p of imgs) {
    const h = createHash('md5').update(readFileSync(p)).digest('hex');
    byHash.set(h, [...(byHash.get(h) || []), rel(p)]);
  }
  const dups = [...byHash.values()].filter((l) => l.length > 1);
  assert.deepEqual(dups, []);
});

test('DOC-12: Zahlen in der Doku stimmen mit dem Code', async () => {
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

test('DOC-27: die Testzahl im README ist eine Untergrenze, die stimmt', () => {
  const count = walk(join(ROOT, 'test'), (p) => p.endsWith('.test.js'))
    .reduce((n, f) => n + (read(f).match(/^\s*test\(/gm) || []).length, 0);
  const en = read(join(ROOT, 'README.md')).match(/(\d+)\+ automated tests/);
  const de = read(join(ROOT, 'README.de.md')).match(/über (\d+) automatisierte Tests/);
  assert.ok(en && de, 'README nennt die Testzahl');
  assert.ok(count >= Number(en[1]) && count >= Number(de[1]), `${count} Tests, README verspricht ${en[1]}+ / über ${de[1]}`);
  assert.doesNotMatch(read(join(ROOT, 'README.md')), /badge\/Tests-\d+/, 'kein statisches Test-Badge mehr');
});

test('DOC-12: Version in version.js, package.json und oberstem CHANGELOG-Eintrag gleich', async () => {
  const { APP_VERSION } = await import('../js/version.js');
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const top = read(join(ROOT, 'CHANGELOG.md')).match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(top && top[1], APP_VERSION);
  assert.match(read(join(ROOT, 'service-worker.js')), /const VERSION = 'catofit-v\d+';/);
});

test('DOC-12: Menüpfade in Doku und Hilfe gibt es wirklich', async () => {
  const { MORE_GROUPS, PROGRESS_TABS } = await import('../js/nav.js');
  const more = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.label));
  const progress = PROGRESS_TABS.map((t) => t.label);
  const settings = [...read(join(ROOT, 'js', 'settings.js')).matchAll(/sectionHead\('([^']+)'/g)].map((m) => m[1]);
  const files = [...mdFiles.filter((f) => /docs[\\/](nutzung|betrieb|wissen)|APPLE-HEALTH|README/.test(f)), join(ROOT, 'js', 'helpcontent.js')];
  const bad = [];
  const check = (text, name, re, allowed, what) => {
    for (const m of text.matchAll(re)) {
      const seg = m[1].replace(/[*„“"]/g, '').trim();
      if (!allowed.some((a) => seg.startsWith(a))) bad.push(`${name}: ${what} → „${seg}“`);
    }
  };
  for (const f of files) {
    // Zeilenumbrüche im Fließtext (Markdown) und Einrückungen wie ein Leerzeichen behandeln.
    const text = read(f).replace(/\*\*/g, '').replace(/\s*\n\s*(?:>\s*)?/g, ' ');
    check(text, rel(f), /(?<![\w-])Mehr → „?([^„“,.;)]+)/g, [...more, 'Abmelden'], 'Mehr');
    check(text, rel(f), /(?<![\w-])Fortschritt → „?([A-ZÄÖÜ][^„“,.;)→]*)/g, progress, 'Fortschritt');
    // „iOS-Einstellungen → …“ meint die Systemeinstellungen des iPhones, nicht die App.
    check(text, rel(f), /(?<![\w-])Einstellungen → „?([A-ZÄÖÜ][^„“,.;)→]*)/g, settings, 'Einstellungen');
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('DOC-21: deutsche Anführungszeichen schließen oben (keine „…" mit geradem Zeichen)', () => {
  const files = [...mdFiles, ...walk(join(ROOT, 'js'), (p) => p.endsWith('.js')), join(ROOT, 'index.html')];
  const bad = [];
  for (const f of files) {
    const text = read(f);
    text.split('\n').forEach((line, i) => {
      if (/„[^“"\n]{0,120}"/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
    });
    // Im Fließtext umbrochene Zitate („… Zeilenende / Rest …") – nur Markdown, ohne Code-Blöcke.
    if (f.endsWith('.md')) {
      for (const m of prose(text).matchAll(/„[^“"\n]{0,160}\n[^“"\n]{0,160}"/g)) bad.push(`${rel(f)}: „${m[0].slice(1, 40).replace(/\n/g, ' ')}…`);
    }
  }
  assert.deepEqual(bad.slice(0, 40), [], `${bad.length} Stellen, z. B.:\n${bad.slice(0, 40).join('\n')}`);
});
