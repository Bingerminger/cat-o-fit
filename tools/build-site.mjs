#!/usr/bin/env node
/* =========================================================================
   build-site.mjs — the project site on GitHub Pages (since 4.2):

     /cat-o-fit/                 start page in English
     /cat-o-fit/de/              start page in German
     /cat-o-fit/demo/            the demo (tools/build-demo.mjs)
     /cat-o-fit/404.html         for every address that does not exist
     /cat-o-fit/service-worker.js  removes a demo worker an earlier version may have left at the old
                                   address (the demo lived at /cat-o-fit/ until 4.1)

   Texts: tools/site/content.mjs, claims: tools/site/claims.md, style: tools/site/style.css.
   Images are copied from docs/assets/ at build time (no copies in the repository).

     node tools/build-site.mjs              # into dist/site
     node tools/build-site.mjs --out /tmp/x
     node tools/build-site.mjs --check      # builds into a temporary folder and checks the rules

   Rules (--check and test/site.test.js):
     S1  nothing is loaded from other servers (src, srcset, stylesheets, icons, url()); the preview
         image (og:image) lies on the site itself
     S2  every local link, anchor and image exists in the built site
     S3  every image has alternative text and its real width and height
     S4  every claim id is in claims.md, every row there is used, English and German back the same ids
     S5  one h1, the language set, both language versions linked (hreflang), a canonical address
     S6  no download, star or user figures; counts of exercises, people and languages match the code
     S7  inline scripts only read the address: no storage, no cookies, no requests
   ========================================================================= */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDemo } from './build-demo.mjs';
import { TEXT, LINKS, PAGE_PATHS, SITE_URL, DOCKER_RUN } from './site/content.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'tools', 'site');
const LANGS = Object.keys(PAGE_PATHS);

/** The app's figures (the modules need the browser shim of the tests). */
async function figures() {
  if (!globalThis.location) await import('../test-setup.js');
  const { EXERCISES } = await import('../js/exercises.js');
  const { MAX_MEMBERS } = await import('../js/storage.js');
  const languages = JSON.parse(readFileSync(join(ROOT, 'locales', 'languages.json'), 'utf8'));
  return { exercises: EXERCISES.length, people: MAX_MEMBERS, languages: Object.keys(languages).length, languageNames: languages };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pngSize(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Where an old address of the demo should go. Until 4.1 the demo lived at /cat-o-fit/: links with a
 * route (#/…) and installed demo apps (./index.html#/) continue in demo/, the German README's
 * ?lang=de lands on the German start page. Runs inline on the English start page.
 */
export function legacyTarget(search, hash) {
  if (/^#\//.test(hash)) return 'demo/' + search + hash;
  const m = /[?&]lang=([^&#]*)/.exec(search);
  if (m && /^de\b/i.test(decodeURIComponent(m[1]))) return 'de/';
  return null;
}

/** Removes the service worker and the caches of a demo that lived at the site root until 4.1. */
export const RETIRE_WORKER = `/* The demo moved to ./demo/ with Cat-O-Fit 4.2. A demo before that may have installed a service
   worker here; this one replaces it, deletes that worker's caches (only those of this address,
   never the demo's under ./demo/) and removes itself. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const scope = new URL('./', self.location.href).pathname;
    for (const key of await caches.keys()) if (key.includes('-' + scope + '-')) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

/* ------------------------------- Pages ------------------------------- */

function renderPage(lang, fig, images) {
  const T = TEXT[lang];
  const L = { ...LINKS.common, ...LINKS[lang] };
  const up = PAGE_PATHS[lang] ? '../' : '';          // from this page to the site root
  const claims = new Set();
  const fill = (t) => t
    .replace(/\{exercises\}/g, fig.exercises).replace(/\{people\}/g, fig.people)
    .replace(/\{languages\}/g, fig.languages)
    .replace(/\{languageList\}/g, Object.values(fig.languageNames).join(', '));
  const said = (tag, item, cls = '') => {
    claims.add(item.c);
    return `<${tag}${cls ? ` class="${cls}"` : ''} data-c="${item.c}">${esc(fill(item.t))}</${tag}>`;
  };
  const img = (file, alt, cls = 'shot') => {
    const src = `assets/${lang}/${file}`;
    images.add(`${lang}/${file}`);
    const size = pngSize(join(ROOT, 'docs', 'assets', lang, file));
    return `<img class="${cls}" src="${up}${src}" width="${size.width}" height="${size.height}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  };
  const other = LANGS.find((l) => l !== lang);
  const demo = `${up}demo/?lang=${lang}`;
  const url = (l) => SITE_URL + PAGE_PATHS[l];
  const banner = pngSize(join(ROOT, 'docs', 'assets', 'promo', T.banner.file));
  const legacy = lang === 'en'
    ? `<script>(function(){var t=(${legacyTarget.toString()})(location.search,location.hash);if(t)location.replace(t);})();</script>\n`
    : '';

  const html = `<!doctype html>
<html lang="${T.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T.title)}</title>
<meta name="description" content="${esc(T.description)}">
<link rel="canonical" href="${url(lang)}">
${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${url('en')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cat-O-Fit">
<meta property="og:title" content="${esc(T.title)}">
<meta property="og:description" content="${esc(T.description)}">
<meta property="og:url" content="${url(lang)}">
<meta property="og:image" content="${SITE_URL}assets/${T.banner.file}">
<meta property="og:image:width" content="${banner.width}">
<meta property="og:image:height" content="${banner.height}">
<meta property="og:image:alt" content="${esc(T.banner.alt)}">
<meta property="og:locale" content="${T.ogLocale}">
<meta property="og:locale:alternate" content="${TEXT[other].ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#18b48a">
<link rel="icon" href="${up}assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${up}assets/icon-180.png">
<link rel="stylesheet" href="${up}assets/style.css">
${legacy}</head>
<body>
<a class="skip" href="#content">${esc(T.skip)}</a>
<header class="top"><div class="wrap">
<a class="brand" href="./"><img src="${up}assets/icon.svg" width="32" height="32" alt="" aria-hidden="true">Cat-O-Fit</a>
<nav aria-label="Cat-O-Fit">
<a href="${demo}">${esc(T.nav.demo)}</a>
<a href="#install">${esc(T.nav.install)}</a>
<a href="${L.docs}">${esc(T.nav.docs)}</a>
<a href="${L.github}">${esc(T.nav.github)}</a>
<a href="${other === 'en' ? '../' : `${PAGE_PATHS[other]}`}" hreflang="${other}" lang="${other}" aria-label="${esc(T.nav.otherLabel)}">${esc(T.nav.other)}</a>
</nav>
</div></header>
<main id="content">
<section class="hero"><div class="wrap">
<div>
<h1>Cat-O-Fit</h1>
${said('p', T.hero.tagline, 'tagline')}
${said('p', T.hero.lead, 'lead')}
<div class="actions">
<a class="button primary" href="${demo}">${esc(T.hero.demo)}</a>
<a class="button" href="#install">${esc(T.hero.install)}</a>
</div>
${said('p', T.hero.demoNote, 'note')}
</div>
${img(T.hero.image.file, T.hero.image.alt)}
</div></section>
<section id="features"><div class="wrap">
<h2>${esc(T.featuresTitle)}</h2>
<div class="features">
${T.features.map((f) => `<article class="feature" id="${f.id}">
<div>
<h3>${esc(f.h)}</h3>
<ul>
${f.points.map((p) => said('li', p)).join('\n')}
</ul>
</div>
${img(f.image.file, f.image.alt)}
</article>`).join('\n')}
</div>
</div></section>
<section class="alt" id="yours"><div class="wrap">
<h2>${esc(T.yours.h)}</h2>
<ul class="points">
${T.yours.points.map((p) => said('li', p)).join('\n')}
</ul>
</div></section>
<section id="install"><div class="wrap">
<h2>${esc(T.install.h)}</h2>
${said('p', T.install.lead)}
<pre><code>${esc(DOCKER_RUN)}</code></pre>
<p>${esc(T.install.after)} <a href="${L.install}">${esc(T.install.guide)}</a></p>
${said('p', T.install.security, 'callout')}
</div></section>
<section class="alt" id="limits"><div class="wrap">
<h2>${esc(T.limits.h)}</h2>
<ul class="points">
${T.limits.points.map((p) => said('li', p)).join('\n')}
</ul>
<p>${esc(T.demoLangs)}</p>
<ul class="langs">
${Object.entries(fig.languageNames).map(([code, name]) => `<li><a href="${up}demo/?lang=${code}" hreflang="${code}" lang="${code}">${esc(name)}</a></li>`).join('\n')}
</ul>
</div></section>
</main>
<footer><div class="wrap">
<ul>
<li><a href="${L.docs}">${esc(T.footer.docs)}</a></li>
<li><a href="${L.roadmap}">${esc(T.footer.roadmap)}</a></li>
<li><a href="${L.changelog}">${esc(T.footer.changelog)}</a></li>
<li><a href="${L.security}">${esc(T.footer.security)}</a></li>
<li><a href="${L.licence}">${esc(T.footer.licence)}</a></li>
<li><a href="${L.support}">${esc(T.footer.support)}</a></li>
</ul>
${said('p', T.footer.privacy)}
</div></footer>
</body>
</html>
`;
  return { html, claims };
}

function render404() {
  const base = new URL(SITE_URL).pathname;   // a 404 page is served at any depth: absolute paths
  const [en, de] = [TEXT.en.notFound, TEXT.de.notFound];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(en.h)} | ${esc(de.h)} – Cat-O-Fit</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${base}assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}assets/style.css">
</head>
<body>
<main id="content"><section><div class="wrap">
<h1>${esc(en.h)}</h1>
<p>${esc(en.text)} <a href="${base}">${esc(en.home)}</a> · <a href="${base}demo/?lang=en">${esc(en.demo)}</a></p>
<p lang="de">${esc(de.text)} <a href="${base}de/">${esc(de.home)}</a> · <a href="${base}demo/?lang=de">${esc(de.demo)}</a></p>
</div></section></main>
</body>
</html>
`;
}

/**
 * Builds the whole site into `out` (emptied first). Returns the pages (path → HTML) and the claim ids
 * per language.
 */
export async function buildSite(out = join(ROOT, 'dist', 'site')) {
  const fig = await figures();
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  buildDemo(join(out, 'demo'));

  const images = new Set();
  const pages = {};
  const claims = {};
  for (const lang of LANGS) {
    const r = renderPage(lang, fig, images);
    pages[`${PAGE_PATHS[lang]}index.html`] = r.html;
    claims[lang] = r.claims;
  }
  pages['404.html'] = render404();
  for (const [file, html] of Object.entries(pages)) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), html);
  }
  writeFileSync(join(out, 'service-worker.js'), RETIRE_WORKER);
  writeFileSync(join(out, '.nojekyll'), '');

  cpSync(join(SITE, 'style.css'), join(out, 'assets', 'style.css'));
  cpSync(join(ROOT, 'assets', 'icons', 'icon.svg'), join(out, 'assets', 'icon.svg'));
  cpSync(join(ROOT, 'assets', 'icons', 'icon-180.png'), join(out, 'assets', 'icon-180.png'));
  for (const lang of LANGS) cpSync(join(ROOT, 'docs', 'assets', 'promo', TEXT[lang].banner.file), join(out, 'assets', TEXT[lang].banner.file));
  for (const rel of images) {
    mkdirSync(dirname(join(out, 'assets', rel)), { recursive: true });
    cpSync(join(ROOT, 'docs', 'assets', rel), join(out, 'assets', rel));
  }
  return { pages, claims, fig };
}

/* ------------------------------- Checks ------------------------------- */

/** Checks a built site; returns the problems (empty = all rules hold). */
export function checkSite(out, { pages, claims, fig }) {
  const problems = [];
  const bad = (rule, msg) => problems.push(`${rule}: ${msg}`);
  const base = new URL(SITE_URL).pathname;
  /** The file in `out` that a reference on page `file` points to (a folder means its index.html). */
  const local = (file, u) => {
    const path = u.replace(/[?#].*$/, '');
    if (path === '') return join(out, file);
    let p;
    if (path.startsWith(base)) p = join(out, path.slice(base.length));
    else if (path.startsWith('/')) p = join(out, '(outside the site)', path);
    else p = resolve(dirname(join(out, file)), path);
    return path.endsWith('/') ? join(p, 'index.html') : p;
  };

  for (const [file, html] of Object.entries(pages)) {
    const attr = (re) => [...html.matchAll(re)].map((m) => m[1]);
    // S1 + S2: what the page loads
    const loaded = [
      ...attr(/<(?:img|script|source|video|audio|iframe)\b[^>]*\ssrc="([^"]+)"/g),
      ...attr(/\ssrcset="([^"]+)"/g).flatMap((s) => s.split(',').map((x) => x.trim().split(/\s+/)[0])),
      ...[...html.matchAll(/<link\b([^>]*)>/g)]
        .filter((m) => /rel="(?:stylesheet|icon|preload|apple-touch-icon|manifest|modulepreload)"/.test(m[1]))
        .map((m) => (m[1].match(/href="([^"]+)"/) || [])[1]),
    ];
    for (const u of loaded) {
      if (!u) continue;
      if (/^(?:[a-z]+:)?\/\//i.test(u) || /^data:/i.test(u)) { bad('S1', `${file} loads from outside: ${u}`); continue; }
      if (!existsSync(local(file, u))) bad('S2', `${file} loads a missing file: ${u}`);
    }
    for (const u of attr(/<meta property="og:image" content="([^"]+)"/g)) {
      if (!u.startsWith(SITE_URL)) bad('S1', `${file}: preview image not on the site: ${u}`);
      else if (!existsSync(join(out, u.slice(SITE_URL.length)))) bad('S2', `${file}: preview image missing: ${u}`);
    }
    // S2: links and anchors
    const ids = new Set(attr(/\sid="([^"]+)"/g));
    for (const u of attr(/<a\b[^>]*\shref="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:)/.test(u)) continue;
      if (u.startsWith('#')) { if (!ids.has(u.slice(1))) bad('S2', `${file}: anchor ${u} missing`); continue; }
      if (!existsSync(local(file, u))) bad('S2', `${file} links a missing page: ${u}`);
    }
    // S3: images
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      const alt = tag.match(/\salt="([^"]*)"/);
      if (!alt || (!alt[1].trim() && !/aria-hidden="true"/.test(tag))) bad('S3', `${file}: image without alternative text: ${tag.slice(0, 90)}`);
      const w = Number((tag.match(/\swidth="(\d+)"/) || [])[1]);
      const h = Number((tag.match(/\sheight="(\d+)"/) || [])[1]);
      if (!w || !h) { bad('S3', `${file}: image without width and height: ${tag.slice(0, 90)}`); continue; }
      const src = (tag.match(/\ssrc="([^"]+)"/) || [])[1];
      if (src && src.endsWith('.png') && existsSync(local(file, src))) {
        const size = pngSize(local(file, src));
        if (size && (size.width !== w || size.height !== h)) bad('S3', `${file}: ${src} is ${size.width}×${size.height}, the page says ${w}×${h}`);
      }
    }
    // S7: inline scripts
    for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\ssrc=/.test(s[1])) continue;
      if (/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|import\(|WebSocket/.test(s[2])) bad('S7', `${file}: an inline script stores, sets cookies or makes requests`);
    }
    if (file === '404.html') continue;
    // S5: structure
    if ((html.match(/<h1\b/g) || []).length !== 1) bad('S5', `${file}: not exactly one h1`);
    if (!/<html lang="[a-z-]+">/.test(html)) bad('S5', `${file}: language missing`);
    for (const l of LANGS) if (!new RegExp(`hreflang="${l}" href="${SITE_URL}${PAGE_PATHS[l]}"`).test(html)) bad('S5', `${file}: language version ${l} not linked`);
    if (!/<link rel="canonical" href="https:\/\//.test(html)) bad('S5', `${file}: canonical address missing`);
    // S6: figures
    const text = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    const crowd = text.match(/\d[\d.,]*\s*(?:downloads?|stars?|Sterne|users?|Nutzer\w*|installs?|Installationen|pulls?)\b/i);
    if (crowd) bad('S6', `${file}: download, star or user figure: ${crowd[0]}`);
    for (const [re, want, what] of [
      [/(?<![\d.,])(\d+) (?:animated exercises|animierte Übungen|exercises|Übungen)\b/g, fig.exercises, 'exercises'],
      [/(?:up to|bis zu) (\d+) (?:people|Personen)/g, fig.people, 'people'],
      [/(?<![\d.,])(\d+) (?:languages|Sprachen)\b/g, fig.languages, 'languages'],
    ]) for (const m of text.matchAll(re)) if (Number(m[1]) !== want) bad('S6', `${file}: "${m[0]}" – the code has ${want} ${what}`);
  }

  // S4: claims
  const register = readFileSync(join(SITE, 'claims.md'), 'utf8');
  const backed = new Set([...register.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
  const used = new Set(Object.values(claims).flatMap((s) => [...s]));
  for (const c of used) if (!backed.has(c)) bad('S4', `claim id without a row in claims.md: ${c}`);
  for (const c of backed) if (!used.has(c)) bad('S4', `row in claims.md that no page uses: ${c}`);
  const [a, b] = LANGS;
  for (const c of claims[a]) if (!claims[b].has(c)) bad('S4', `only ${a} backs ${c}`);
  for (const c of claims[b]) if (!claims[a].has(c)) bad('S4', `only ${b} backs ${c}`);
  return problems;
}

/* ------------------------------- CLI ------------------------------- */

function option(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const out = mkdtempSync(join(tmpdir(), 'catofit-site-'));
    try {
      const problems = checkSite(out, await buildSite(out));
      console.log(problems.length ? `site: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` : 'site: all rules hold');
      process.exitCode = problems.length ? 1 : 0;
    } finally { rmSync(out, { recursive: true, force: true }); }
  } else {
    const out = resolve(option(args, '--out', join(ROOT, 'dist', 'site')));
    const { pages } = await buildSite(out);
    console.log(`Site built in ${out} (${Object.keys(pages).length} pages, demo under demo/).`);
  }
}
