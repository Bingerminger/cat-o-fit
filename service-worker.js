/*
 * service-worker.js — app-shell caching for offline operation.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/icons): "network-first" with cache fallback.
 *     Online you always see the latest version, offline the app keeps running.
 *   - API/data (/api/, /data/): do NOT cache (network-only). The offline
 *     capability of the data comes from LocalStorage in the frontend (local-first).
 *
 * On every version increase the old cache is discarded.
 */

const VERSION = 'catofit-v115';
// Cache name unique per deployment path: production (/cat-o-fit/) and acceptance
// (/cat-o-fit-acc/) live on the SAME origin and would otherwise share the
// CacheStorage – then the app shell of one environment ends up in the other.
const SCOPE_PATH = new URL('./', self.location.href).pathname;
const SHELL_CACHE = `${VERSION}-${SCOPE_PATH}-shell`;

// Relative paths -> the app works in any subdirectory.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/audio/silence.wav',
  './css/style.css',
  './css/cards.css',
  './css/motion.css',
  './css/show.css',
  './css/dashboard.css',
  './css/calendar.css',
  './css/session.css',
  './css/workout-mode.css',
  './css/family.css',
  './css/report.css',
  './css/responsive.css',
  './js/boot-check.js',
  './js/app.js',
  './js/api-client.js',
  './js/storage.js',
  './js/router.js',
  './js/nav.js',
  './js/capture.js',
  './js/contrast.js',
  './js/formcards.js',
  './js/session-gate.js',
  './js/login.js',
  './js/demo.js',
  './js/teamstats.js',
  './js/env.js',
  './js/i18n.js',
  './js/format.js',
  './js/language.js',
  './js/exercise-terms-de.js',
  './locales/languages.json',
  './js/ui.js',
  './js/charts.js',
  './js/dashboard.js',
  './js/dashboard-goals.js',
  './js/dashboard-coach.js',
  './js/adapt.js',
  './js/events.js',
  './js/plans.js',
  './js/plangen.js',
  './js/coach.js',
  './js/hrzones.js',
  './js/commitments.js',
  './js/program.js',
  './js/calendar.js',
  './js/session.js',
  './js/unit-actions.js',
  './js/sollist.js',
  './js/settings.js',
  './js/workout-mode.js',
  './js/workout-engine.js',
  './js/health.js',
  './js/health-import.js',
  './js/gpx.js',
  './js/fit.js',
  './js/zip.js',
  './js/activity-import.js',
  './js/csv-export.js',
  './js/strength.js',
  './js/barcode.js',
  './js/ics-export.js',
  './js/nutrition.js',
  './js/shopping.js',
  './js/checklist.js',
  './js/statistics.js',
  './js/fitness.js',
  './js/load.js',
  './js/healthgoals.js',
  './js/planflow.js',
  './js/rolling.js',
  './js/triage.js',
  './js/whatif.js',
  './js/vdot.js',
  './js/suggestions.js',
  './js/dualgoal.js',
  './js/help.js',
  './js/helpcontent.js',
  './js/adaptive.js',
  './js/badges.js',
  './js/exercises.js',
  './js/exercise-art.js',
  './js/exercise-motions.js',
  './js/motion-rig.js',
  './js/motion-figure.js',
  './js/motion-player.js',
  './js/coach-figure.js',
  './js/audio.js',
  './js/music.js',
  './js/show-program.js',
  './js/workout-show.js',
  './js/workouts.js',
  './js/voice.js',
  './js/goals.js',
  './js/report.js',
  './js/reports.js',
  './js/weather.js',
  './js/cycle.js',
  './js/cyclecalc.js',
  './js/labs.js',
  './js/labsources.js',
  './js/labs-view.js',
  './js/supplements.js',
  './js/redflags.js',
  './js/eligibility.js',
  './js/wellness.js',
  './js/healthdata.js',
  './js/food.js',
  './js/energy.js',
  './js/version.js',
  './js/sha256.js',
  './js/family.js',
  './js/family-admin.js',
  './assets/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Add individually so that a missing asset does not kill the install.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      // The ui catalog of every language, so a language switch also works offline;
      // the list comes from languages.json, so a new language needs no change here.
      try {
        const langs = Object.keys(await (await fetch('./locales/languages.json', { cache: 'no-cache' })).json());
        await Promise.allSettled(langs.flatMap((l) => ['ui', 'exercises', 'help', 'recipes'].map((a) => cache.add(`./locales/${l}/${a}.json`))));
      } catch { /* offline install: catalogs come with the runtime cache */ }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Delete ONLY the own (same-scope) old caches – never those of the
    // other environment on the same origin.
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k.includes(`-${SCOPE_PATH}-`))
        .map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Do not touch foreign origins and dynamic endpoints.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) return;

  // App shell: network-first with revalidation (no-cache), then cache.
  // This way changes arrive online immediately, without the HTTP cache serving a
  // stale file; offline the cache still applies.
  let req = request;
  try { req = new Request(request, { cache: 'no-cache' }); } catch { /* some requests cannot be cloned */ }
  const network = fetch(req).then((response) => {
    // Refresh successful responses in the background.
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  // Read ONLY from the own cache (not caches.match across all caches), otherwise the
  // shell of the other environment could be served offline.
  const fromCache = async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Let navigation requests fall back to the app shell offline.
    if (request.mode === 'navigate') return cache.match('./index.html');
    return null;
  };
  event.respondWith((async () => {
    // If the server does not respond within 3 s (home server asleep, weak network
    // on the go), the app starts from the cache; the late response refreshes it anyway.
    // Previously each of the ~70 shell fetches waited without a time limit (FE-08, UI-43).
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000));
    try {
      const first = await Promise.race([network, timeout]);
      if (first !== 'timeout') return first;
      const cached = await fromCache();
      if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
      return await network;
    } catch {
      return (await fromCache()) || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
