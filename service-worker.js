/*
 * service-worker.js — App-Shell-Caching für Offline-Betrieb.
 *
 * Strategie:
 *   - App-Shell (HTML/CSS/JS/Icons): "network-first" mit Cache-Fallback.
 *     Online sieht man immer die neueste Version, offline läuft die App weiter.
 *   - API/Daten (/api/, /data/): NICHT cachen (network-only). Die Offline-
 *     Fähigkeit der Daten liefert der LocalStorage im Frontend (local-first).
 *
 * Bei jeder Versionserhöhung wird der alte Cache verworfen.
 */

const VERSION = 'catofit-v115';
// Cache-Name pro Deployment-Pfad eindeutig: Produktion (/cat-o-fit/) und Abnahme
// (/cat-o-fit-acc/) liegen auf DERSELBEN Origin und teilen sich sonst den
// CacheStorage – dann landet die App-Shell der einen Umgebung in der anderen.
const SCOPE_PATH = new URL('./', self.location.href).pathname;
const SHELL_CACHE = `${VERSION}-${SCOPE_PATH}-shell`;

// Relative Pfade -> die App funktioniert in jedem Unterverzeichnis.
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
      // Einzeln hinzufügen, damit ein fehlendes Asset den Install nicht killt.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      // The ui catalog of every language, so a language switch also works offline;
      // the list comes from languages.json, so a new language needs no change here.
      try {
        const langs = Object.keys(await (await fetch('./locales/languages.json', { cache: 'no-cache' })).json());
        await Promise.allSettled(langs.flatMap((l) => ['ui', 'exercises', 'help'].map((a) => cache.add(`./locales/${l}/${a}.json`))));
      } catch { /* offline install: catalogs come with the runtime cache */ }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // NUR die eigenen (scope-gleichen) Alt-Caches löschen – niemals die der
    // anderen Umgebung auf derselben Origin.
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

  // Fremde Origins und dynamische Endpunkte nicht anfassen.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) return;

  // App-Shell: network-first mit Revalidierung (no-cache), dann Cache.
  // So kommen Änderungen online sofort an, ohne dass der HTTP-Cache eine
  // veraltete Datei liefert; offline greift weiterhin der Cache.
  let req = request;
  try { req = new Request(request, { cache: 'no-cache' }); } catch { /* manche Requests sind nicht klonbar */ }
  const network = fetch(req).then((response) => {
    // Erfolgreiche Antworten im Hintergrund auffrischen.
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  // NUR aus dem eigenen Cache lesen (nicht caches.match über alle Caches), sonst könnte
  // offline die Shell der anderen Umgebung ausgeliefert werden.
  const fromCache = async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Navigationsanfragen offline auf die App-Shell zurückfallen lassen.
    if (request.mode === 'navigate') return cache.match('./index.html');
    return null;
  };
  event.respondWith((async () => {
    // Antwortet der Server nicht binnen 3 s (Heimserver im Ruhezustand, schwaches Netz
    // unterwegs), startet die App aus dem Cache; die späte Antwort frischt ihn trotzdem
    // auf. Vorher wartete jeder der ~70 Shell-Abrufe ohne Zeitgrenze (FE-08, UI-43).
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
