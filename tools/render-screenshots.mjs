#!/usr/bin/env node
/* =========================================================================
   render-screenshots.mjs — re-renders the images of the docs (docs/assets),
   reproducibly rather than by hand.

   Every run builds the same state: fresh instance (app and API in a
   temp directory with an empty data/, its own `php -S`), fixed day, fixed
   persona ("Alex", demo data), fixed weather data. The app runs under
   the example domain https://fit.example.org – the browser sends every
   request to the local server, everything else stays blocked. Nothing
   leaves the machine, real data is never touched.

     node tools/render-screenshots.mjs                  # all images to docs/assets
     node tools/render-screenshots.mjs --only 05,16     # only these images (prefix)
     node tools/render-screenshots.mjs --out /tmp/images

   Prerequisites: PHP 8.1 or later and Playwright – once
   `npm install --no-save playwright`; Google Chrome serves as the browser, otherwise
   `npx playwright install chromium`. If Playwright is installed elsewhere:
   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs.

   If a view changes, update the flow here and re-render the affected
   images. The promo banner (docs/assets/promo) is built from
   promo.html and social-preview.html and embeds some of the images –
   hence last. Two places in the docs quote values from the images
   and have to be proofread afterwards: "Current form" in
   docs/nutzung/coach-und-belastung.md and the ferritin example in
   docs/nutzung/labor.md.
   ========================================================================= */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://fit.example.org';
/** Fixed demo day: Saturday, 18 July 2026, 9:30 in Berlin – long-run day in the demo plan. */
const DAY = '2026-07-18T09:30:00+02:00';
const PERSONA = { name: 'Alex', pin: '2468' };
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 1366 };

/* ------------------------------ Usage ---------------------------------- */

function option(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

export function parseArgs(args = process.argv.slice(2)) {
  const only = (option(args, '--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    out: resolve(option(args, '--out', join(ROOT, 'docs/assets'))),
    only,
    headed: args.includes('--headed'),
  };
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try {
    return await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec);
  } catch {
    console.error('Playwright fehlt. Einmalig: npm install --no-save playwright\n'
      + '(oder PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright/index.mjs setzen)');
    process.exit(2);
  }
}

/* ------------------------- Fresh instance ------------------------------ */

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

/** App + API into a temp directory with an empty data/ – the seeds from the repo never come along. */
function copyApp() {
  const dir = mkdtempSync(join(tmpdir(), 'catofit-render-'));
  for (const f of ['index.html', 'manifest.webmanifest', 'service-worker.js']) cpSync(join(ROOT, f), join(dir, f));
  for (const d of ['api', 'assets', 'css', 'js']) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  mkdirSync(join(dir, 'data'));
  return dir;
}

export async function startServer() {
  const dir = copyApp();
  const port = await freePort();
  const php = spawn(process.env.PHP || 'php', ['-S', `127.0.0.1:${port}`, '-t', dir], {
    stdio: 'ignore',
    env: { ...process.env, TZ: 'Europe/Berlin', CATOFIT_TZ: 'Europe/Berlin' },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/index.html`)).ok) break; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    stop() { php.kill(); rmSync(dir, { recursive: true, force: true }); },
  };
}

/* ------------------------------ Weather ---------------------------------- */

/** 16 days of summer weather from the demo day – always the same, without a real service. */
function forecast() {
  const codes = [1, 2, 3, 61, 2, 0, 1, 80, 2, 3, 1, 0, 2, 61, 1, 0];
  const tMax = [24, 26, 22, 19, 21, 25, 27, 23, 22, 20, 24, 26, 25, 18, 21, 24];
  const time = codes.map((_, i) => {
    const d = new Date(`${DAY.slice(0, 10)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return {
    latitude: 51.05, longitude: 13.74, timezone: 'Europe/Berlin',
    daily: {
      time,
      weather_code: codes,
      temperature_2m_max: tMax,
      temperature_2m_min: tMax.map((t) => t - 9),
      precipitation_probability_max: codes.map((c) => (c >= 61 ? 70 : c === 3 ? 30 : 5)),
      wind_speed_10m_max: codes.map((c, i) => 8 + ((i * 5) % 14)),
    },
  };
}

/* ------------------------------ Browser --------------------------------- */

export async function openBrowser({ base, headed = false }) {
  const { chromium } = await loadPlaywright();
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: !headed }); }
  catch { browser = await chromium.launch({ headless: !headed }); }
  const context = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light',
    reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  await context.clock.setFixedTime(new Date(DAY));
  // Toasts would otherwise cover parts of the image at random.
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '.toast { display: none !important; }';
      document.head.appendChild(s);
    });
  });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN)) {
      const response = await route.fetch({ url: base + url.slice(ORIGIN.length) });
      return route.fulfill({ response });
    }
    if (url.startsWith('https://api.open-meteo.com/')) return route.fulfill({ json: forecast() });
    return route.abort();
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/* ------------------------------ Helpers ---------------------------------- */

export function helpers(page, { out, only }) {
  const wanted = (name) => !only.length || only.some((p) => name.startsWith(p));

  async function settle(ms = 350) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  }

  /** Navigate within the app (hash) without reloading. */
  async function go(hash) {
    await page.mouse.move(0, 0);   // no hover shadow from the last click
    const current = await page.evaluate(() => location.hash);
    if (current === hash) await page.evaluate(() => { location.hash = '#/hilfe'; });
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction((h) => location.hash === h, hash);
    await settle();
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  /** Scrolls so that the element with this text sits directly under the header bar. */
  async function scrollToText(text, selector = 'h2, h3, .card__title, .section-head__title', offset = 10) {
    const ok = await page.evaluate(({ text, selector, offset }) => {
      const header = document.getElementById('app-header');
      const hh = header ? header.getBoundingClientRect().height : 0;
      const node = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text));
      if (!node) return false;
      window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - hh - offset);
      return true;
    }, { text, selector, offset });
    if (!ok) throw new Error(`„${text}“ nicht gefunden`);
    await page.waitForTimeout(250);
  }

  async function shot(name, { element = null, clip = null, fullPage = false, keepFocus = false } = {}) {
    if (!wanted(name)) return;
    // Focus jumps to the heading after every change (accessibility) – after
    // a keypress the browser shows the focus ring there. It is distracting in the image.
    if (!keepFocus) await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await settle(250);
    const path = join(out, `${name}.png`);
    const o = { path, scale: 'css', animations: 'disabled', caret: 'hide' };
    if (element) await element.screenshot(o);
    else await page.screenshot({ ...o, clip: clip || undefined, fullPage });
    console.log(`✓ ${name}`);
  }

  /** Runs fn(store, arg) with the real app store (same module instance as the app).
      Pass it as an expression – the app's CSP forbids new Function/eval in the page script. */
  function withStore(fn, arg = null) {
    return page.evaluate(`(async () => {
      const store = await import('/js/storage.js');
      return (${fn.toString()})(store, ${JSON.stringify(arg)});
    })()`);
  }

  return { wanted, settle, go, scrollToText, shot, withStore };
}

/* ------------------------------ Flow ---------------------------------- */

export async function onboarding(page, h) {
  await page.goto(`${ORIGIN}/`);
  await page.getByPlaceholder('Dein Name').waitFor();
  await page.getByPlaceholder('Dein Name').fill(PERSONA.name);
  await page.getByPlaceholder('4 bis 8 Ziffern').fill(PERSONA.pin);
  await page.getByPlaceholder('PIN wiederholen').fill(PERSONA.pin);
  await h.shot('50-ersteinrichtung', { keepFocus: true });
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByText('Mit Demodaten starten').click();
  await page.waitForSelector('.section-head__title', { timeout: 30000 });
  await h.settle(800);
}

/** ID of the plan session on the demo day (or the first matching one after it). */
function unitId(h, type) {
  return h.withStore((store, a) => {
    const plan = store.get('plans').find((p) => p.eventId === 'demo-e1');
    const u = (plan.units || []).filter((x) => x.date >= a.day && x.type === a.type).sort((x, y) => x.date.localeCompare(y.date))[0];
    return u ? u.id : null;
  }, { day: DAY.slice(0, 10), type });
}

/** Send Apple Health data to the instance's endpoint the way "Health Auto Export" does. */
async function ingestAppleHealth(h, base) {
  const { token, user } = await h.withStore((store) => ({ token: store.profile().healthToken, user: store.activeUserId() }));
  const day = (k) => {
    const d = new Date(`${DAY.slice(0, 10)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - k);
    return d.toISOString().slice(0, 10);
  };
  // The demo has its own scale values every second day – those days keep their origin,
  // the "Recently imported" overview shows the rest.
  const series = (name, units, values) => ({ name, units, data: values.map((qty, k) => ({ date: `${day(k)} 07:00:00 +0200`, qty })) });
  const payload = {
    data: {
      metrics: [
        series('weight_&_body_mass', 'kg', [71.9, 72.1, 72.0, 72.3, 72.2, 72.4, 72.3, 72.6]),
        series('body_fat_percentage', '%', [24.6, 24.7, 24.7, 24.8, 24.8, 24.9, 24.9, 25.0]),
        series('resting_heart_rate', 'bpm', [50, 51, 50, 52, 51, 52, 51, 53]),
        series('heart_rate_variability', 'ms', [58, 55, 61, 54, 57, 52, 56, 53]),
        series('vo2_max', 'ml/(kg·min)', [48.3, 48.3, 48.2, 48.2, 48.1, 48.1, 48.0, 48.0]),
        series('step_count', 'count', [4210, 11850, 9020, 12430, 8760, 10120, 7340, 11980]),
        { name: 'sleep_analysis', units: 'hr', data: [7.6, 7.1, 6.8, 7.9, 7.4, 7.2, 6.9, 7.7].map((totalSleep, k) => ({ date: `${day(k)} 07:00:00 +0200`, totalSleep })) },
      ],
      workouts: [
        { id: 'DEMO-RUN-1', name: 'Running', start: `${day(2)} 18:10:00 +0200`, duration: 3300, distance: { qty: 9.2, units: 'km' }, activeEnergyBurned: { qty: 640, units: 'kcal' }, avgHeartRate: { qty: 147, units: 'bpm' }, maxHeartRate: { qty: 166, units: 'bpm' } },
        { id: 'DEMO-BIKE-1', name: 'Cycling', start: `${day(3)} 17:30:00 +0200`, duration: 2700, distance: { qty: 18.5, units: 'km' }, activeEnergyBurned: { qty: 420, units: 'kcal' }, avgHeartRate: { qty: 128, units: 'bpm' } },
      ],
    },
  };
  const r = await fetch(`${base}/api/api.php?action=health-ingest&user=${encodeURIComponent(user)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Catofit-Token': token },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Health-Import: HTTP ${r.status} ${await r.text()}`);
  await h.withStore((store) => store.syncNow());
}

/** Promo banner and social preview from their HTML templates – with the freshly rendered images. */
async function renderPromo(browser, { out, only }) {
  const jobs = [
    { name: 'banner', html: 'promo.html', size: { width: 1200, height: 630 } },
    { name: 'social-preview', html: 'social-preview.html', size: { width: 1280, height: 640 } },
  ].filter((j) => !only.length || only.some((p) => `promo/${j.name}`.startsWith(p) || p === 'promo'));
  if (!jobs.length) return;
  const src = join(ROOT, 'docs/assets/promo');
  const tmp = mkdtempSync(join(tmpdir(), 'catofit-promo-'));
  const pick = (file) => {
    const fresh = join(out, file);
    return existsSync(fresh) ? fresh : join(ROOT, 'docs/assets', file);
  };
  const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'dark' });
  try {
    for (const j of jobs) {
      const html = readFileSync(join(src, j.html), 'utf8')
        .replace(/src="\.\.\/([\w-]+\.png)"/g, (_, f) => `src="${pathToFileURL(pick(f)).href}"`)
        .replace(/src="\.\.\/\.\.\/\.\.\/(assets\/[^"]+)"/g, (_, f) => `src="${pathToFileURL(join(ROOT, f)).href}"`);
      const file = join(tmp, j.html);
      writeFileSync(file, html);
      const page = await context.newPage();
      await page.setViewportSize(j.size);
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      mkdirSync(join(out, 'promo'), { recursive: true });
      await page.screenshot({ path: join(out, 'promo', `${j.name}.png`), scale: 'css' });
      await page.close();
      console.log(`✓ promo/${j.name}`);
    }
  } finally {
    await context.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });
  // Banner only: without running through the app, using the existing images.
  if (opts.only.length && opts.only.every((p) => p.startsWith('promo'))) { await renderPromoStandalone(opts); return; }
  const server = await startServer();
  const { browser, page } = await openBrowser({ base: server.base, headed: opts.headed });
  const h = helpers(page, opts);
  const click = (text) => page.getByText(text, { exact: true }).first().click();
  try {
    await onboarding(page, h);

    // ---- "Today" ----
    await h.go('#/');
    await h.shot('01-dashboard');
    await h.scrollToText('Heute', '.section-head__title');
    await h.shot('13-dashboard-coach');
    await page.getByText(/^Weitere Hinweise/).first().click();
    await h.scrollToText('Dein Coach', '.section-head__title');
    await h.shot('43-coach-rpe');
    await h.go('#/');
    await h.scrollToText('Belastung & Form', '.section-head__title');
    await h.shot('45-belastung-form');
    await h.scrollToText('Wochenziele', '.card__title');
    await h.shot('42-gesundheitsziele-coach');

    // ---- Race, plan, session, workout ----
    await h.go('#/event/demo-e1');
    await h.shot('03-event-detail');
    await h.go('#/plan/demo-e1');
    await h.shot('04-plan');
    const longRun = await unitId(h, 'long');
    await h.go(`#/session/${longRun}`);
    await h.shot('06-session');
    await page.getByRole('button', { name: 'Bearbeiten' }).first().click();
    await h.settle();
    await h.shot('14-einheit-bearbeiten');
    await page.keyboard.press('Escape');
    // Let the workout continue shortly before the first drinking break (long run: every 20 min).
    await page.evaluate(async (id) => {
      const { lsSet } = await import('/js/env.js');
      lsSet('workout', JSON.stringify({ id, elapsed: 20 * 60 * 1000 - 1200, phase: 0, phaseElapsed: 0, counters: {}, done: false, drinkCount: 0, ts: Date.now() }));
    }, longRun);
    await h.go(`#/workout/${longRun}`);
    await page.getByRole('button', { name: /Start|Weiter/ }).first().click();
    await page.locator('.workout__drink.is-visible').waitFor({ timeout: 10000 });
    await h.shot('07-workout-trinkpause');
    await page.evaluate(async () => { const { lsRemove } = await import('/js/env.js'); lsRemove('workout'); });

    // ---- Calendar ----
    await h.go('#/calendar');
    await h.shot('16-kalender-wetter', { clip: await calendarClip(page) });
    await click('Woche');
    await h.settle();
    await h.shot('05-kalender');
    await click('Monat');

    // ---- Progress ----
    await h.go('#/stats');
    await h.shot('09-statistik');
    await h.scrollToText('Form & Trainingsbereiche', '.section-head__title');
    await h.shot('44-aktuelle-form');
    await h.go('#/health');
    const chart = page.locator('.chart-wrap').first();
    const box = await chart.boundingBox();
    if (box) await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
    await h.shot('08-koerperwerte');
    await h.go('#/badges');
    await h.shot('12-erfolge');
    await h.go('#/reports');
    await page.getByRole('button', { name: 'Bericht erstellen' }).first().click();
    await page.getByRole('button', { name: 'Monatsbericht erstellen' }).click();
    await page.getByRole('button', { name: 'Bericht speichern' }).click();   // after the preview
    await page.waitForFunction(() => location.hash.startsWith('#/report/'));
    await h.settle();
    await h.shot('26-monatsbericht');
    await h.go('#/reports');
    await page.getByRole('button', { name: 'Bericht erstellen' }).first().click();
    await click('Urkunde');
    await page.getByPlaceholder('z. B. Zielgewicht erreicht').fill('14 Wochen am Stück dabei');
    await page.getByPlaceholder('z. B. von 72 auf 65 kg (optional)').fill('jede Woche trainiert – starke Konstanz auf dem Weg zum Halbmarathon');
    await page.getByRole('button', { name: 'Urkunde erstellen' }).click();
    await page.getByRole('button', { name: 'Urkunde speichern' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/report/'));
    await h.settle();
    await h.shot('25-urkunde');

    // ---- Health, labs, Apple Health ----
    await h.go('#/zyklus');
    await h.shot('18-zyklus');
    await h.go('#/labor');
    await h.shot('60-labor');
    await page.getByText('Ferritin', { exact: true }).first().click();
    await h.settle();
    await h.scrollToText('Ferritin', '.list-item__title, .lab-row__name, div');
    await h.shot('61-labor-detail');
    await h.go('#/import');
    await page.getByRole('button', { name: 'Auto-Import aktivieren' }).click();
    await h.settle();
    const ingestCard = page.locator('.card', { hasText: 'Auto-Import aktiv' }).first();
    await h.shot('apple-health-settings', { element: ingestCard });
    await ingestAppleHealth(h, server.base);
    await h.go('#/import');
    await h.scrollToText('Zuletzt importiert', '.section-head__title');
    await h.shot('apple-health-import');

    // ---- Nutrition, shopping, family ----
    await h.go('#/nutrition');
    await h.scrollToText('Markiere Lieblingsgerichte', 'div', 90);
    await h.shot('15-ernaehrung-lernen');
    await h.go('#/shopping');
    await h.shot('32-einkauf-familie');
    await h.go('#/family');
    await h.shot('51-team-dashboard');
    await h.go('#/familie-verwalten');
    await h.shot('31-familie-verwalten');

    // ---- Exercises, settings, help ----
    await h.go('#/uebungen');
    await h.shot('40-uebungen');
    await page.getByText('Kniebeuge', { exact: true }).first().click();
    await h.settle();
    await h.shot('41-uebung-detail');
    await page.keyboard.press('Escape');
    await h.go('#/settings');
    await h.shot('10-einstellungen');
    await h.scrollToText('Daten & Sicherung', '.section-head__title');
    await h.shot('35-backup-recovery');
    await h.go('#/hilfe');
    await h.shot('11-hilfe');

    // ---- iPad ----
    await page.setViewportSize(TABLET);
    for (const [name, hash] of [['ipad-01-dashboard', '#/'], ['ipad-40-uebungen', '#/uebungen'],
      ['ipad-45-sidebar-abmelden', '#/settings'], ['ipad-50-team-dashboard', '#/family'], ['ipad-60-labor', '#/labor']]) {
      await h.go(hash);
      await h.shot(name);
    }
    // Follow along non-stop, landscape on the iPad: paused in the middle of the first squat.
    await page.setViewportSize({ width: TABLET.height, height: TABLET.width });
    if (h.wanted('ipad-42-durchgehend')) {
      await page.evaluate(`(async () => {
        const [{ openShow }, { programForWorkout }, { findWorkout }] = await Promise.all([import('/js/workout-show.js'), import('/js/show-program.js'), import('/js/workouts.js')]);
        const s = document.createElement('style'); s.textContent = '.show__paused { display: none !important; }'; document.head.appendChild(s);
        const run = openShow(programForWorkout(findWorkout('ganzkoerper'))).start();
        run.toggle();
        const work = run.show.segs.find((x) => x.kind === 'work');
        run.seek(work.t0 + 2.6);
      })()`);
      await h.settle(500);
      await h.shot('ipad-42-durchgehend');
      await page.evaluate(() => document.querySelector('.show__ctl[aria-label="Beenden"]').click());
    }
    await page.setViewportSize(PHONE);

    // ---- Programme last: it brings its own sessions into the calendar and "Today" ----
    await h.go('#/events');
    await page.getByRole('button', { name: 'Neues Ziel' }).click();
    await page.getByText('Trainingsprogramm', { exact: true }).click();
    await page.locator('select').first().selectOption('strength');
    await page.getByRole('button', { name: 'Speichern & Plan erstellen' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/plan/'));
    const programId = await page.evaluate(() => location.hash.split('/').pop());
    await h.go('#/events');
    await h.shot('02-events');
    await h.go(`#/event/${programId}`);
    await h.shot('34-programm');
  } finally {
    await browser.close();
    server.stop();
  }
  await renderPromoStandalone(opts);
}

/** Detail of the month calendar: from the month row to below the grid. */
async function calendarClip(page) {
  return page.evaluate(() => {
    const top = Math.max(0, document.querySelector('.cal-toolbar').getBoundingClientRect().top - 8);
    const bottom = document.querySelector('.cal-grid').getBoundingClientRect().bottom + 12;
    return { x: 0, y: top, width: window.innerWidth, height: bottom - top };
  });
}

async function renderPromoStandalone(opts) {
  const { chromium } = await loadPlaywright();
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
  try { await renderPromo(browser, opts); } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
