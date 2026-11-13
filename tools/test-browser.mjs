#!/usr/bin/env node
/* test-browser.mjs — the app in real browsers, as people use it (Chromium and WebKit):
   - every main view in all seven languages on a phone (390×844): no console or page error, no failed
     request, no raw catalog key, no text running out of its box;
   - WebKit (the engine of Safari on iPhone and iPad) on phone and tablet;
   - en-US: no metric figure left on screen (miles, pounds, °F by the region's defaults);
   - the admin's full backup against the PHP server: one request per member, nothing private;
   - the service worker registers and the app starts without network (Chromium);
   - the built project site: the start page (both languages, phone and desktop, light and dark), old
     demo addresses leading on, and the demo under demo/ – every view, nothing leaves the browser
     except the weather service.
   Each language runs against its own fresh instance (empty data/, own `php -S`); the weather
   service is answered with a fixed forecast, every other outside host counts as an error.

     npm install --no-save playwright@1.65.0 && npx playwright install --with-deps chromium webkit
     node tools/test-browser.mjs                    # all
     node tools/test-browser.mjs --only=demo,webkit # parts: langs, webkit, backup, offline, demo

   Exit code 0 = all green. Runs in CI (.github/workflows/ci.yml, job "Browser test"). Without an
   installed WebKit (locally) that part is skipped with a note; in CI it is required. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './render-screenshots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (part) => !ONLY.length || ONLY.includes(part);
const IN_CI = !!process.env.CI;
const LANGS = { en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', 'pt-BR': 'pt-BR', nl: 'nl-NL' };
const ROUTES = ['#/', '#/calendar', '#/events', '#/stats', '#/health', '#/badges', '#/reports', '#/uebungen',
  '#/nutrition', '#/shopping', '#/checklist', '#/family', '#/familie-verwalten', '#/settings', '#/hilfe',
  '#/zyklus', '#/labor', '#/import'];
const WEATHER = /^https:\/\/(api|geocoding-api)\.open-meteo\.com\//;
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try { return await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec); }
  catch { console.error('Playwright is missing: npm install --no-save playwright@1.65.0'); process.exit(2); }
}
const pw = await loadPlaywright();

async function launch(kind) {
  if (kind === 'chromium') {
    try { return await pw.chromium.launch({ channel: 'chrome' }); } catch { return pw.chromium.launch(); }
  }
  try { return await pw.webkit.launch(); }
  catch (e) {
    if (IN_CI) throw e;
    console.log('  (WebKit is not installed here – skipped; CI runs it)');
    return null;
  }
}

/** A context whose requests are watched: the weather gets a fixed answer, other hosts are errors. */
async function watchedContext(browser, where, { locale, viewport, origin, serviceWorkers = 'block' }) {
  const ctx = await browser.newContext({ locale, viewport, timezoneId: 'Europe/Berlin', serviceWorkers });
  const outside = [];
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (WEATHER.test(url)) return route.fulfill({ json: { daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], wind_speed_10m_max: [] }, results: [] } });
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    outside.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) errors.push(`HTTP ${r.status()} ${r.url().slice(origin.length)}`); });
  return { ctx, page, errors, outside, where };
}

const booted = (page) => page.waitForFunction(() => window.__catofitBooted === true, null, { timeout: 20000 });

/** First admin and the demo family, as "Start with demo data" does. */
async function seed(page, base) {
  await page.goto(`${base}/`);
  await booted(page);
  await page.evaluate(async () => {
    const store = await import('./js/storage.js');
    await store.createFirstAdmin({ name: 'Alex', pin: '2468' });
    await store.seedDemo();
  });
  await page.reload();
  await booted(page);
}

/** Visit every route; check errors, raw keys, overflow (and leftover metric figures for en-US). */
async function visitAll(w, base, { metric = false } = {}) {
  for (const r of ROUTES) {
    const before = w.errors.length;
    await w.page.goto(`${base}/${r}`);
    await w.page.waitForTimeout(600);
    const text = await w.page.evaluate(() => document.getElementById('view')?.innerText || '');
    if (w.errors.length > before) fail(`${w.where} ${r}`, w.errors.slice(before).join(' | ').slice(0, 300));
    const keys = (text.match(/\b(?:[a-z]+[A-Za-z]*\.){1,4}[a-z][A-Za-z0-9]+\b/g) || [])
      .filter((k) => !/^(www|cat-o-fit|z\.|e\.g|i\.e|open-meteo|openfoodfacts)/i.test(k) && !/\.(js|json|md|com|org|de|io|app|xml|gz|zip|csv|ics|gpx|tcx|fit)$/.test(k));
    if (keys.length) fail(`${w.where} ${r}`, `raw catalog keys: ${[...new Set(keys)].slice(0, 4).join(', ')}`);
    const overflow = await w.page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('the page scrolls sideways');
      for (const n of document.querySelectorAll('#view *, .bottom-nav *')) {
        if (n.children.length === 0 && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX === 'visible') {
          out.push(`"${(n.textContent || '').trim().slice(0, 30)}"`);
          if (out.length > 3) break;
        }
      }
      return out;
    });
    if (overflow.length) fail(`${w.where} ${r}`, `text runs out of its box: ${overflow.join(', ')}`);
    if (metric) {
      // Proper names may keep their unit ("10 km race"); figures may not.
      const left = (text.match(/\d[\d.,]*\s?(?:km\/h|min\/km|km|kg|cm|°C)(?![\w/])(?!\s+race)/g) || []);
      if (left.length) fail(`${w.where} ${r}`, `metric figures left with imperial units: ${[...new Set(left)].slice(0, 5).join(', ')}`);
    }
  }
  if (w.outside.length) fail(w.where, `requests to other hosts: ${[...new Set(w.outside)].slice(0, 3).join(', ')}`);
}

/* ------------------------------------------------------------------------- */

const chromium = await launch('chromium');

if (want('langs')) {
  for (const [lang, locale] of Object.entries(LANGS)) {
    console.log(`== ${lang} (Chromium, phone)`);
    const srv = await startServer();
    try {
      const w = await watchedContext(chromium, `${lang} phone`, { locale, viewport: { width: 390, height: 844 }, origin: srv.base });
      await seed(w.page, srv.base);
      await visitAll(w, srv.base);
      await w.ctx.close();
    } finally { srv.stop(); }
  }
  console.log('== en-US (Chromium, phone, imperial by region)');
  const srv = await startServer();
  try {
    const w = await watchedContext(chromium, 'en-US phone', { locale: 'en-US', viewport: { width: 390, height: 844 }, origin: srv.base });
    await seed(w.page, srv.base);
    await visitAll(w, srv.base, { metric: true });
    await w.ctx.close();
  } finally { srv.stop(); }
}

if (want('webkit')) {
  const webkit = await launch('webkit');
  if (webkit) {
    for (const [where, viewport] of [['WebKit phone', { width: 390, height: 844 }], ['WebKit tablet', { width: 1024, height: 1366 }]]) {
      console.log(`== ${where}`);
      const srv = await startServer();
      try {
        const w = await watchedContext(webkit, where, { locale: 'en-US', viewport, origin: srv.base });
        await seed(w.page, srv.base);
        await visitAll(w, srv.base, { metric: true });
        await w.ctx.close();
      } finally { srv.stop(); }
    }
    await webkit.close();
  }
}

if (want('backup')) {
  // The admin's full backup against the real PHP server: one changes-all request per member (since 4.2),
  // every member of the demo family in the file, nothing private, no tombstones or revs.
  console.log('== admin full backup against the PHP server (Chromium)');
  const srv = await startServer();
  try {
    const w = await watchedContext(chromium, 'backup', { locale: 'en-GB', viewport: { width: 390, height: 844 }, origin: srv.base });
    await seed(w.page, srv.base);
    // The app's own sync also uses changes-all (with the person's own private areas) – count only the backup.
    await w.page.evaluate(async () => { const store = await import('./js/storage.js'); await store.syncNow(); });
    const bulk = [];
    w.page.on('request', (r) => { if (r.url().includes('action=changes-all')) bulk.push(r.url()); });
    const res = await w.page.evaluate(async () => {
      const store = await import('./js/storage.js');
      const dump = await store.exportFamilyAll();
      const text = JSON.stringify(dump.users);
      return {
        members: store.members().length, users: Object.keys(dump.users).length,
        private: Object.values(dump.users).some((b) => b.cycle || b.labs || b.supplements),
        rev: /"rev":/.test(text), deleted: /"deleted":/.test(text),
        sessions: Object.values(dump.users).reduce((n, b) => n + (b.sessions || []).length, 0),
      };
    });
    if (res.users !== res.members) fail('backup', `${res.users} of ${res.members} members in the file`);
    if (bulk.length !== res.members) fail('backup', `${bulk.length} changes-all requests for ${res.members} members`);
    if (res.private) fail('backup', 'private areas in the file');
    if (res.rev || res.deleted) fail('backup', 'revs or tombstones in the file');
    if (!res.sessions) fail('backup', 'no sessions in the file');
    if (bulk.some((u) => /(?:cycle|labs|supplements)%3A|(?:cycle|labs|supplements):/.test(decodeURIComponent(u)))) fail('backup', 'a private area was asked for');
    if (w.errors.length) fail('backup', w.errors.join(' | ').slice(0, 300));
    await w.ctx.close();
  } finally { srv.stop(); }
}

if (want('offline')) {
  console.log('== service worker and offline start (Chromium)');
  const srv = await startServer();
  try {
    const w = await watchedContext(chromium, 'offline', { locale: 'en-GB', viewport: { width: 390, height: 844 }, origin: srv.base, serviceWorkers: 'allow' });
    await w.page.goto(`${srv.base}/`);
    await booted(w.page);
    const controlled = await w.page.evaluate(async () => {
      for (let t = Date.now(); Date.now() - t < 15000;) {
        if (navigator.serviceWorker.controller) return true;
        await new Promise((ok) => setTimeout(ok, 250));
      }
      return !!navigator.serviceWorker.controller;
    });
    if (!controlled) fail('offline', 'the service worker does not control the page');
    await w.ctx.setOffline(true);
    try {
      await w.page.reload();
      await booted(w.page);
    } catch (e) { fail('offline', `the app does not start without network (${String(e).split('\n')[0]})`); }
    await w.ctx.close();
  } finally { srv.stop(); }
}

if (want('demo')) {
  console.log('== built site: start page and demo (Chromium)');
  // Served under /cat-o-fit/ as on GitHub Pages, so the 404 page's absolute paths are checked too.
  const dir = mkdtempSync(join(tmpdir(), 'catofit-site-'));
  execFileSync(process.execPath, [join(ROOT, 'tools/build-site.mjs'), '--out', join(dir, 'cat-o-fit')], { stdio: 'ignore' });
  const port = 18000 + Math.floor(Math.random() * 2000);
  const php = spawn(process.env.PHP || 'php', ['-S', `127.0.0.1:${port}`, '-t', dir], { stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/cat-o-fit`;
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/index.html`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
    // The start page in both languages, on a phone and on a desktop, light and dark: no error, nothing
    // from other servers, nothing sideways.
    for (const [path, viewport, colorScheme] of [['/', { width: 390, height: 844 }, 'light'], ['/de/', { width: 390, height: 844 }, 'dark'], ['/', { width: 1280, height: 900 }, 'dark'], ['/404.html', { width: 390, height: 844 }, 'light']]) {
      const w = await watchedContext(chromium, `start page ${path} ${viewport.width}`, { locale: 'en-GB', viewport, origin });
      await w.page.emulateMedia({ colorScheme });
      await w.page.goto(`${base}${path}`);
      await w.page.waitForTimeout(300);
      if (w.errors.length) fail(w.where, w.errors.join(' | ').slice(0, 300));
      if (w.outside.length) fail(w.where, `requests to other hosts: ${w.outside.slice(0, 3).join(', ')}`);
      if (await w.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail(w.where, 'the page scrolls sideways');
      // Every link on the site itself leads to a page that exists.
      const own = await w.page.evaluate((o) => [...document.querySelectorAll('a[href]')].map((a) => a.href.split('#')[0]).filter((h) => h.startsWith(o)), origin);
      for (const href of [...new Set(own)]) {
        const r = await fetch(href).catch(() => null);
        if (!r || !r.ok) fail(w.where, `link to ${href.slice(origin.length)} answers ${r ? r.status : 'nothing'}`);
      }
      await w.ctx.close();
    }
    // Old demo addresses (the demo lived at the root until 4.1).
    {
      const w = await watchedContext(chromium, 'old demo addresses', { locale: 'en-GB', viewport: { width: 390, height: 844 }, origin });
      for (const [from, to, lang] of [['/#/calendar', '/demo/#/calendar'], ['/index.html#/', '/demo/#/'], ['/?lang=de', '/de/', 'de'], ['/?lang=en', '/?lang=en', 'en'], ['/?lang=fr', '/?lang=fr', 'en']]) {
        await w.page.goto(`${base}${from}`);
        await w.page.waitForURL((u) => u.href.startsWith(`${base}${to}`), { timeout: 5000 }).catch(() => {});
        await w.page.waitForTimeout(200);
        if (!w.page.url().startsWith(`${base}${to}`)) fail(w.where, `${from} leads to ${w.page.url().slice(base.length)}, not ${to}`);
        else if (lang && await w.page.evaluate(() => document.documentElement.lang) !== lang) fail(w.where, `${from} does not show the ${lang} start page`);
      }
      await w.ctx.close();
    }
    const w = await watchedContext(chromium, 'demo', { locale: 'en-GB', viewport: { width: 390, height: 844 }, origin });
    const api = [];
    w.page.on('request', (r) => { if (r.url().includes('/api/')) api.push(`${r.method()} ${r.url().slice(origin.length)}`); });
    await w.page.goto(`${base}/demo/?lang=en`);
    await booted(w.page);
    await w.page.waitForTimeout(1500);
    await visitAll(w, `${base}/demo`);
    if (api.length) fail('demo', `requests to the API left the browser: ${api.slice(0, 3).join(', ')}`);
    await w.ctx.close();
  } finally { php.kill(); rmSync(dir, { recursive: true, force: true }); }
}

await chromium.close();
console.log(problems.length ? `\nbrowser: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` : '\nbrowser: all green');
process.exit(problems.length ? 1 : 0);
