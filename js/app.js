/* =========================================================================
   app.js — Einstiegspunkt: Theme, Navigation, Routen, Sync, Service Worker.
   ========================================================================= */

import * as store from './storage.js';
import * as router from './router.js';
import { el, icon, iconSvg, navigate, openSheet, closeSheet, debounce } from './ui.js';

import { render as renderDashboard } from './dashboard.js';
import { renderList as renderEvents, renderDetail as renderEvent } from './events.js';
import { render as renderPlan } from './plans.js';
import { render as renderCalendar } from './calendar.js';
import { render as renderSession } from './session.js';
import { render as renderWorkout } from './workout-mode.js';
import { render as renderHealth } from './health.js';
import { render as renderImport } from './health-import.js';
import { render as renderNutrition } from './nutrition.js';
import { render as renderShopping } from './shopping.js';
import { render as renderChecklist } from './checklist.js';
import { render as renderStats } from './statistics.js';
import { render as renderSettings } from './settings.js';
import { render as renderHelp } from './help.js';
import { render as renderBadges } from './badges.js';
import { render as renderReports, renderDetail as renderReportDetail } from './reports.js';
import { render as renderCycle } from './cycle.js';
import { render as renderExercises } from './exercises.js';
import { render as renderFamily } from './family.js';
import { render as renderFamilyAdmin } from './family-admin.js';
import { render as renderLogin } from './login.js';
import { ensureGenerated } from './plans.js';
import { refreshWeather } from './weather.js';
import { APP_VERSION } from './version.js';
import { gate, menusVisible } from './session-gate.js';

// Signal an den Inline-Diagnose-Schnipsel in index.html: Das Modul (samt aller
// statischen Imports) wurde erfolgreich geladen UND ausgeführt. Fehlt dieses Flag,
// kam die JS-Auslieferung nicht durch (falscher MIME-Typ / fehlende Datei).
window.__catofitModuleLoaded = true;

/* ------------------------------- Theme ---------------------------------- */
function relLuminance(hex) {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(n.slice(0, 2), 16) / 255, g = parseInt(n.slice(2, 4), 16) / 255, b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function applyTheme() {
  const s = store.settings();
  const theme = s.theme || 'system';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  const accent = s.accent || '#18b48a';
  document.documentElement.style.setProperty('--accent', accent);
  // Kontrastfarbe auf dem Akzent automatisch wählen.
  document.documentElement.style.setProperty('--accent-contrast', relLuminance(accent) > 0.55 ? '#10231c' : '#ffffff');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0c0f13' : accent);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((store.settings().theme || 'system') === 'system') applyTheme();
});
// Einstellungen lösen Theme-Aktualisierung aus (entkoppelt von settings.js).
window.addEventListener('catofit:theme', applyTheme);
// Modul an-/abgewählt -> Navigation (Sidebar + „Mehr") neu aufbauen (ein-/ausblenden).
window.addEventListener('catofit:nav', () => { buildBottomNav(); buildSidebar(); renderSidebarFoot(); });
// Offene Sheets bei Navigation schließen (sonst überlagern sie die neue Ansicht).
window.addEventListener('hashchange', () => closeSheet());
// Frischer Wetter-Forecast -> aktuelle Ansicht neu zeichnen.
window.addEventListener('catofit:weather', () => refreshSoon());

// Vordergrund-Abgleich: Kehrt die App aus dem Hintergrund zurück (Tab-Wechsel,
// Reaktivierung der installierten PWA, bfcache-Restore), sofort neu synchronisieren.
// Sonst zeigt eine zuvor pausierte Instanz (z. B. die PWA neben Safari) einen
// veralteten Stand, bis zufällig ein anderer Trigger feuert – genau das „mal hier,
// mal dort andere Daten". syncNow() ist ein No-Op ohne Login/offline; entprellt,
// weil focus + visibilitychange beim Wechsel gleichzeitig feuern.
let lastWakeSync = 0;
function wakeSync() {
  if (document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (now - lastWakeSync < 4000) return;
  lastWakeSync = now;
  store.syncNow().catch(() => {});
}
document.addEventListener('visibilitychange', wakeSync);
window.addEventListener('focus', wakeSync);
window.addEventListener('pageshow', wakeSync);           // bfcache-Wiederherstellung
// Sanfter Poll, solange die App sichtbar ist: hält zwei gleichzeitig geöffnete
// Instanzen (PWA + Browser) aktuell, ohne im Hintergrund Server-Last zu erzeugen.
setInterval(() => { if (document.visibilityState !== 'hidden') wakeSync(); }, 45000);

/** Wetter aktualisieren, wenn ein Standort hinterlegt und das Modul aktiv ist. */
function maybeRefreshWeather() {
  const s = store.settings();
  if (s.weather !== false && s.location && s.location.lat != null) refreshWeather(s.location);
}

/* ----------------------------- Navigation ------------------------------- */
const PRIMARY_NAV = [
  { icon: 'home', label: 'Heute', hash: '#/' },
  { icon: 'calendar', label: 'Kalender', hash: '#/calendar' },
  { icon: 'flag', label: 'Ziele', hash: '#/events' },
  { icon: 'heart', label: 'Werte', hash: '#/health' },
];
const MORE_NAV = [
  { icon: 'grid', label: 'Team/Familie', hash: '#/family' },
  { icon: 'trophy', label: 'Erfolge & Momentum', hash: '#/badges' },
  { icon: 'dumbbell', label: 'Übungs-Bibliothek', hash: '#/uebungen' },
  { icon: 'moon', label: 'Zyklus', hash: '#/zyklus', module: 'cycle' },
  { icon: 'chart', label: 'Statistik', hash: '#/stats' },
  { icon: 'trophy', label: 'Berichte & Urkunden', hash: '#/reports' },
  { icon: 'utensils', label: 'Ernährung', hash: '#/nutrition', module: 'nutrition' },
  { icon: 'cart', label: 'Einkaufsliste', hash: '#/shopping', module: 'shopping' },
  { icon: 'list', label: 'Checkliste & Erinnerungen', hash: '#/checklist', module: 'checklist' },
  { icon: 'upload', label: 'Health-Import', hash: '#/import' },
  { icon: 'settings', label: 'Einstellungen', hash: '#/settings' },
  { icon: 'info', label: 'Hilfe & Wissen', hash: '#/hilfe' },
];

/** Ist ein (modulgebundener) Nav-Eintrag aktuell sichtbar? Module sind Standard an,
    in den Einstellungen abschaltbar. Nicht-modulare Einträge sind immer sichtbar. */
function navVisible(item) {
  // Private Module (Zyklus) sind beim Verwalten fremder Mitglieder tabu (areaAllowed).
  return !item.module || (store.settings().modules?.[item.module] !== false && store.areaAllowed(item.module));
}

const hex = (c) => (typeof c === 'string' && c[0] === '#' ? c : 'var(--accent)');

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = '';
  PRIMARY_NAV.forEach((item) => {
    const a = el('a', { class: 'bottom-nav__item', href: item.hash, dataset: { hash: item.hash } }, [
      icon(item.icon), el('span', { text: item.label }),
    ]);
    nav.appendChild(a);
  });
  const more = el('button', { class: 'bottom-nav__item', onclick: openMoreSheet }, [
    icon('more'), el('span', { text: 'Mehr' }),
  ]);
  more.dataset.more = '1';
  nav.appendChild(more);
}

function buildSidebar() {
  const side = document.getElementById('sidebar');
  side.innerHTML = '';
  side.appendChild(el('div', { class: 'sidebar__brand' }, [
    el('span', { html: iconSvg('activity'), style: { width: '26px', color: 'var(--accent)' } }),
    el('span', { text: 'Cat-O-Fit' }),
    el('span', { class: 'sidebar__version', text: `v${APP_VERSION}` }),
  ]));
  const all = [...PRIMARY_NAV, { sep: true }, ...MORE_NAV.filter(navVisible)];
  all.forEach((item) => {
    if (item.sep) { side.appendChild(el('div', { class: 'sidebar__sep' })); return; }
    side.appendChild(el('a', { class: 'sidebar__item', href: item.hash, dataset: { hash: item.hash } }, [
      icon(item.icon), el('span', { text: item.label }),
    ]));
  });
  // Fuß: drückt das angemeldete Mitglied + Abmelden ans untere Ende.
  side.appendChild(el('div', { class: 'sidebar__spacer' }));
  side.appendChild(el('div', { class: 'sidebar__foot', id: 'sidebar-foot' }));
}

function openMoreSheet() {
  const body = el('div');

  // Konto-Kopf: wer ist angemeldet + Abmelden. Auf dem iPhone der Hauptzugang
  // zum Abmelden, da dort keine Sidebar sichtbar ist.
  const me = store.activeMember();
  if (me) {
    body.appendChild(el('div', { class: 'sheet-account' }, [
      el('span', { class: 'sheet-account__avatar', style: { background: hex(me.color) + '22', color: hex(me.color) }, text: me.emoji || '🏃' }),
      el('div', { class: 'grow', style: { minWidth: '0' } }, [
        el('div', { class: 'sheet-account__name', text: me.name || 'Mitglied' }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: me.role === 'admin' ? 'Administrator:in · angemeldet' : 'angemeldet' }),
      ]),
      el('button', { class: 'btn btn--ghost', style: { flex: '0 0 auto' }, onclick: doLogout }, [icon('arrowLeft'), 'Abmelden']),
    ]));
  }

  const list = el('div', { class: 'list' });
  MORE_NAV.filter(navVisible).forEach((item) => {
    list.appendChild(el('a', {
      class: 'list-item', href: item.hash,
      onclick: () => closeSheet(),
    }, [
      el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg(item.icon) }),
      el('div', { class: 'list-item__body' }, el('div', { class: 'list-item__title', text: item.label })),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]));
  });
  body.appendChild(list);
  openSheet({ title: 'Mehr', body });
}

/** Aktiven Navigationseintrag markieren. */
function highlightNav(route) {
  const path = '#' + (route.path || '/');
  document.querySelectorAll('[data-hash]').forEach((a) => {
    const h = a.dataset.hash;
    const active = h === path || (h === '#/' && path === '#/') ||
      (h !== '#/' && path.startsWith(h));
    a.classList.toggle('is-active', active);
  });
}

/** Banner ein-/ausblenden, wenn ein Admin gerade ein anderes Mitglied verwaltet. */
let _navManaging = null;
function updateManageBanner() {
  const managing = store.isManaging();
  // Bei Wechsel des Verwaltungs-Status die Nav neu bauen: private Module (Zyklus)
  // werden beim Verwalten fremder Mitglieder ausgeblendet (navVisible → areaAllowed).
  if (managing !== _navManaging) { _navManaging = managing; window.dispatchEvent(new Event('catofit:nav')); }
  const banner = document.getElementById('manage-banner');
  if (!banner) return;
  if (managing) {
    const who = store.activeMember();
    banner.hidden = false;
    banner.innerHTML = '';
    banner.appendChild(el('span', { html: iconSvg('user'), style: { width: '16px', flex: '0 0 auto' } }));
    banner.appendChild(el('span', { text: `Du verwaltest ${who ? who.name : 'ein Mitglied'}` }));
    banner.appendChild(el('button', { class: 'manage-banner__back', text: 'Zurück zu dir', onclick: async () => { await store.backToSelf(); navigate('#/'); } }));
  } else {
    banner.hidden = true;
    banner.innerHTML = '';
  }
}

/* ----------------------- Anmeldestatus / Menüs -------------------------- */
/** Menüs (Bottom-Nav/Sidebar) nur im angemeldeten Zustand zeigen; Sidebar-Fuß füllen. */
function applyAuthChrome() {
  document.body.classList.toggle('is-anon', !menusVisible(store.activeUserId()));
  renderSidebarFoot();
}

/** Fuß der Sidebar (iPad/Desktop): angemeldetes Mitglied + Abmelden. */
function renderSidebarFoot() {
  const foot = document.getElementById('sidebar-foot');
  if (!foot) return;
  foot.innerHTML = '';
  const m = store.activeMember();
  if (!m) return;                          // abgemeldet -> Sidebar ist ohnehin ausgeblendet
  foot.appendChild(el('div', { class: 'sidebar__user' }, [
    el('span', { class: 'sidebar__avatar', style: { background: hex(m.color) + '22', color: hex(m.color) }, text: m.emoji || '🏃' }),
    el('div', { class: 'sidebar__user-meta' }, [
      el('div', { class: 'sidebar__user-name', text: m.name || 'Mitglied' }),
      el('div', { class: 'sidebar__user-role', text: m.role === 'admin' ? 'Administrator:in' : 'Mitglied' }),
    ]),
  ]));
  foot.appendChild(el('button', { class: 'btn btn--ghost btn--block', onclick: doLogout }, [icon('arrowLeft'), 'Abmelden']));
}

/** Vollständig abmelden -> zurück zum Login-Dashboard, Menüs ausblenden. */
async function doLogout() {
  closeSheet();
  await store.logout();
  applyAuthChrome();
  if (location.hash.startsWith('#/login')) router.refresh();
  else navigate('#/login');
}

/* ------------------------------- Routen --------------------------------- */
function registerRoutes() {
  router.register('/', renderDashboard);
  router.register('/login', renderLogin);
  router.register('/family', renderFamily);
  router.register('/familie-verwalten', renderFamilyAdmin);
  router.register('/calendar', renderCalendar);
  router.register('/events', renderEvents);
  router.register('/event/:id', (v, p) => renderEvent(v, p.id));
  router.register('/plan/:eventId', (v, p) => renderPlan(v, p.eventId));
  router.register('/session/:id', (v, p) => renderSession(v, p.id));
  router.register('/workout/:id', (v, p) => renderWorkout(v, p.id));
  router.register('/health', renderHealth);
  router.register('/stats', renderStats);
  router.register('/nutrition', renderNutrition);
  router.register('/shopping', renderShopping);
  router.register('/checklist', renderChecklist);
  router.register('/import', renderImport);
  router.register('/settings', renderSettings);
  router.register('/hilfe', renderHelp);
  router.register('/badges', renderBadges);
  router.register('/reports', renderReports);
  router.register('/report/:id', (v, p) => renderReportDetail(v, p.id));
  router.register('/zyklus', renderCycle);
  router.register('/uebungen', renderExercises);
  router.setNotFound((v) => navigate('#/'));
}

/* -------------------------------- Boot ---------------------------------- */
const refreshSoon = debounce(() => {
  const modalOpen = document.getElementById('modal-root').classList.contains('is-open');
  const inWorkout = location.hash.startsWith('#/workout/');
  if (!modalOpen && !inWorkout) router.refresh();
}, 180);

async function boot() {
  await store.init();
  applyTheme();
  buildBottomNav();
  buildSidebar();
  registerRoutes();
  // Anmelde-Gate: Ohne angemeldeten Nutzer ist nur das Familien-/Login-Dashboard
  // erreichbar (siehe session-gate.js). Menüs erscheinen erst nach dem Login.
  router.setGuard((path) => {
    const g = gate(store.activeUserId(), path);
    if (!g.allow) { navigate(g.redirect); return false; }
    return true;
  });
  ensureGenerated();
  maybeRefreshWeather();
  router.onAfterRender(highlightNav);
  router.onAfterRender(updateManageBanner);
  router.onAfterRender(applyAuthChrome);
  router.start();
  window.__catofitBooted = true;   // Boot vollständig, erste Ansicht gezeichnet

  // Hintergrund-Sync -> Plan sicherstellen, Theme/Wetter & Ansicht aktualisieren.
  store.onSync((area, origin) => {
    if (area === 'profile') { applyTheme(); maybeRefreshWeather(); }
    if (area === 'events' || area === 'plans') ensureGenerated();
    if (origin === 'sync') refreshSoon();
  });

  // Service Worker (App-Shell offline-fähig) + zuverlässige Updates.
  // Problem ohne das hier: Eine als Homescreen-PWA installierte App zeigte nach
  // einem neuen Release weiter die alte Version. Lösung:
  //  - updateViaCache:'none' -> das SW-Skript selbst wird nie aus dem HTTP-Cache
  //    geliefert, ein neues Release wird also erkannt.
  //  - regelmäßig reg.update() -> auch lang offene PWAs prüfen auf Updates.
  //  - controllerchange -> der neue SW (skipWaiting+claim) übernimmt; die Seite
  //    EINMAL neu laden, damit sofort die neue Shell (JS/CSS) läuft. Nicht beim
  //    allerersten Installieren neu laden (da gab es vorher keinen Controller).
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      location.reload();
    });
    let swReg = null;
    // Beim Zurückkehren in den Vordergrund (Tab-Wechsel, Reaktivierung der PWA,
    // bfcache) SOFORT auf ein neues Release prüfen – sonst zeigt eine pausierte
    // PWA bis zum 30-min-Timer bzw. manuellen Schließen die alte Version. Findet
    // update() einen neuen SW, übernimmt er (skipWaiting+claim) und controllerchange
    // lädt einmal neu -> frische Shell.
    const checkUpdate = () => { if (document.visibilityState !== 'hidden') swReg?.update?.(); };
    window.addEventListener('load', async () => {
      try {
        swReg = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
        swReg.update?.();
        setInterval(checkUpdate, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', checkUpdate);
        window.addEventListener('focus', checkUpdate);
        window.addEventListener('pageshow', checkUpdate);
      } catch { /* SW ist optional – App läuft auch ohne */ }
    });
  }
}

boot();
