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

const VERSION = 'catofit-v100';
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
  './css/style.css',
  './css/cards.css',
  './css/dashboard.css',
  './css/calendar.css',
  './css/session.css',
  './css/workout-mode.css',
  './css/family.css',
  './css/report.css',
  './css/responsive.css',
  './js/app.js',
  './js/api-client.js',
  './js/storage.js',
  './js/router.js',
  './js/session-gate.js',
  './js/login.js',
  './js/demo.js',
  './js/teamstats.js',
  './js/env.js',
  './js/ui.js',
  './js/charts.js',
  './js/dashboard.js',
  './js/adapt.js',
  './js/events.js',
  './js/plans.js',
  './js/commitments.js',
  './js/program.js',
  './js/calendar.js',
  './js/session.js',
  './js/settings.js',
  './js/workout-mode.js',
  './js/health.js',
  './js/health-import.js',
  './js/gpx.js',
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
  './js/adaptive.js',
  './js/badges.js',
  './js/exercises.js',
  './js/exercise-art.js',
  './js/goals.js',
  './js/report.js',
  './js/reports.js',
  './js/weather.js',
  './js/cycle.js',
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
    caches.open(SHELL_CACHE).then((cache) =>
      // Einzeln hinzufügen, damit ein fehlendes Asset den Install nicht killt.
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
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
  event.respondWith(
    fetch(req)
      .then((response) => {
        // Erfolgreiche Antworten im Hintergrund auffrischen.
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        // NUR aus dem eigenen Cache lesen (nicht caches.match über alle Caches),
        // sonst könnte offline die Shell der anderen Umgebung ausgeliefert werden.
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        // Navigationsanfragen offline auf die App-Shell zurückfallen lassen.
        if (request.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
