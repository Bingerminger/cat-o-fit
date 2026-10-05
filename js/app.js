/* =========================================================================
   app.js — Einstiegspunkt: Theme, Navigation, Routen, Sync, Service Worker.
   ========================================================================= */

import * as store from './storage.js';
import * as router from './router.js';
import { el, icon, iconSvg, navigate, openSheet, closeSheet, debounce, toast, safeAccent, setRefreshHandler, goOrRefresh, scopeKey } from './ui.js';
import { TAB_ITEMS, MORE_GROUPS, navMatches, visibleGroups, inMore, navLink, accountBlock } from './nav.js';
import { openCaptureSheet } from './capture.js';
import { accentPalette } from './contrast.js';
import { useHrReference } from './load.js';
import { applyLanguage } from './language.js';
import { loadLanguages, t, tp } from './i18n.js';

import { render as renderDashboard } from './dashboard.js';
import { renderList as renderEvents, renderDetail as renderEvent } from './events.js';
import { render as renderPlan } from './plans.js';
import { render as renderCalendar } from './calendar.js';
import { render as renderSession } from './session.js';
import { render as renderHealth } from './health.js';
import { render as renderNutrition } from './nutrition.js';
import { render as renderShopping } from './shopping.js';
import { render as renderChecklist } from './checklist.js';
import { render as renderStats } from './statistics.js';
import { render as renderSettings } from './settings.js';
import { render as renderBadges } from './badges.js';
import { render as renderCycle } from './cycle.js';
import { render as renderExercises, loadExerciseTexts } from './exercises.js';
import { loadHelpTexts } from './helpcontent.js';
import { render as renderFamily } from './family.js';
import { render as renderLogin } from './login.js';
import { ensureGenerated } from './plans.js';
import { refreshWeather } from './weather.js';
import { APP_VERSION } from './version.js';
import { gate, menusVisible, safeReturnTo } from './session-gate.js';
import { currentEligibility } from './wellness.js';

// Signal an den Inline-Diagnose-Schnipsel in index.html: Das Modul (samt aller
// statischen Imports) wurde erfolgreich geladen UND ausgeführt. Fehlt dieses Flag,
// kam die JS-Auslieferung nicht durch (falscher MIME-Typ / fehlende Datei).
window.__catofitModuleLoaded = true;

/* ------------------------------- Theme ---------------------------------- */
function applyTheme() {
  const s = store.settings();
  const theme = s.theme || 'system';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  const accent = safeAccent(s.accent);
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  // Schrift auf dem Akzent und Akzent als Text je nach Farbe und Theme so wählen, dass
  // sie ≥ 4,5:1 erreichen (UI-12, UI-32) – vorher Weiß bis Luminanz 0,55 (2,65:1).
  const pal = accentPalette(accent, dark);
  root.setProperty('--accent-contrast', pal.contrast);
  root.setProperty('--accent-text', pal.text);
  root.setProperty('--accent-strong', pal.strong);
  root.setProperty('--accent-hero-end', pal.heroEnd);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0c0f13' : accent);
}

// Hell/Dunkel wechselt (iOS „Automatisch“): auch die Ansicht neu zeichnen – Diagramme
// übernehmen ihre Farben beim Zeichnen und blieben sonst im alten Theme stehen (FE-14).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((store.settings().theme || 'system') === 'system') { applyTheme(); refreshSoon(); }
});
// Einstellungen lösen Theme-Aktualisierung aus (entkoppelt von settings.js).
window.addEventListener('catofit:theme', applyTheme);
// Modul an-/abgewählt -> Navigation (Sidebar + „Mehr“) neu aufbauen (ein-/ausblenden).
window.addEventListener('catofit:nav', () => { buildBottomNav(); buildSidebar(); highlightNav({ path: router.currentPath() }); });
// Offene Sheets bei Navigation schließen (sonst überlagern sie die neue Ansicht).
window.addEventListener('hashchange', () => closeSheet());
// Frischer Wetter-Forecast -> aktuelle Ansicht neu zeichnen.
window.addEventListener('catofit:weather', () => refreshSoon());
// Gerätespeicher voll: Die letzte Änderung wurde zurückgenommen (nicht still verloren).
window.addEventListener('catofit:storage-full', () => toast(
  t('sync.storageFull'),
  'bad', 7000,
));
// Der Server hat Familien-Änderungen abgelehnt (dafür braucht es eine Admin-Anmeldung).
window.addEventListener('catofit:ops-rejected', (e) => {
  const n = (e && e.detail && e.detail.count) || 1;
  toast(tp('sync.opsRejected', n, { reason: (e.detail && e.detail.reason) || t('sync.opsRejectedReason') }), 'bad', 7000);
  refreshSoon();
});
// Die Server-Anmeldung ist abgelaufen: Zyklus, Labor und Ergänzungen synchronisieren erst
// wieder nach Eingabe der PIN (die App selbst bleibt angemeldet).
let reauthOpen = false;
window.addEventListener('catofit:session-required', () => {
  if (reauthOpen || !store.identityId()) return;
  const me = store.identityMember();
  if (!me) return;
  if (!store.memberHasPin(me.id)) { store.reauth(''); return; }
  reauthOpen = true;
  const inp = el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '••••', 'aria-label': 'PIN' });
  const err = el('div', { class: 'pin-err', role: 'alert', hidden: true });
  const submit = async () => {
    if (await store.reauth(inp.value)) { closeSheet(); toast(t('reauth.reconnected'), 'good'); return; }
    const e = store.lastLoginError();
    err.textContent = (e && e.message) || t('reauth.wrongPin'); err.hidden = false; inp.value = ''; inp.focus();
  };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  openSheet({
    title: t('reauth.title'),
    body: el('div', { class: 'pin-dialog' }, [
      el('div', { class: 'muted', style: { fontSize: '.86rem', textAlign: 'center' }, text: t('reauth.text') }),
      inp, err,
      el('button', { class: 'btn btn--primary btn--block', onclick: submit }, [icon('check'), t('common.confirm')]),
      el('button', { class: 'btn btn--ghost btn--block', onclick: () => closeSheet() }, t('common.later')),
    ]),
    onClose: () => { reauthOpen = false; },
  });
  setTimeout(() => inp.focus(), 120);
});

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
// Menüstruktur und Zuordnung Route → Eintrag: nav.js. Tab-Leiste (iPhone): Heute ·
// Kalender · ＋ Erfassen · Fortschritt · Mehr. Seitenleiste (iPad/Mac): ＋ Erfassen oben,
// gegliedert, klebender Fuß mit der angemeldeten Person, Einstellungen, Hilfe, Abmelden.

/** Menüelement → Eintrag, für die aktive Markierung nach jedem Seitenwechsel. */
const navItemOf = new WeakMap();
function track(node, item) { navItemOf.set(node, item); node.dataset.nav = item.key || item.hash || ''; return node; }
function navPath() { return '#' + (router.currentPath() || '/'); }

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = '';
  TAB_ITEMS.forEach((item) => {
    if (item.action === 'capture') {
      nav.appendChild(track(el('button', {
        class: 'bottom-nav__item bottom-nav__item--capture', type: 'button', 'aria-haspopup': 'dialog',
        onclick: () => openCaptureSheet(),
      }, [el('span', { class: 'bottom-nav__plus', 'aria-hidden': 'true', html: iconSvg('plus') }), el('span', { text: item.label })]), item));
    } else if (item.action === 'more') {
      nav.appendChild(track(el('button', {
        class: 'bottom-nav__item', type: 'button', 'aria-haspopup': 'dialog', onclick: openMoreSheet,
      }, [icon(item.icon), el('span', { text: item.label })]), item));
    } else {
      nav.appendChild(track(el('a', { class: 'bottom-nav__item', href: item.hash }, [
        icon(item.icon), el('span', { text: item.label }),
      ]), item));
    }
  });
}

function buildSidebar() {
  const side = document.getElementById('sidebar');
  side.innerHTML = '';
  const path = navPath();
  side.appendChild(el('div', { class: 'sidebar__brand' }, [
    el('span', { html: iconSvg('activity'), style: { width: '26px', color: 'var(--accent-text)' } }),
    el('span', { text: 'Cat-O-Fit' }),
    el('span', { class: 'sidebar__version', text: `v${APP_VERSION}` }),
  ]));
  side.appendChild(el('button', {
    class: 'btn btn--primary btn--block sidebar__capture', type: 'button', 'aria-haspopup': 'dialog',
    onclick: () => openCaptureSheet(),
  }, [icon('plus'), t('nav.capture')]));
  const list = el('div', { class: 'sidebar__list' });
  TAB_ITEMS.filter((item) => item.hash).forEach((item) => list.appendChild(track(navLink(item, { path }), item)));
  visibleGroups().filter((g) => g.id !== 'system').forEach((g) => {
    list.appendChild(el('div', { class: 'sidebar__group', text: g.title }));
    g.items.forEach((it) => list.appendChild(track(navLink(it, { path }), it)));
  });
  side.appendChild(list);
  // Fuß klebt unten (auch am 800 px hohen Laptop sichtbar): wer angemeldet ist, wen man
  // gerade verwaltet, Einstellungen · Hilfe · Abmelden (UI-02, UI-16).
  side.appendChild(el('div', { class: 'sidebar__foot', id: 'sidebar-foot' }));
  renderSidebarFoot();
}

/** Zurück ins eigene Profil (aus Banner, Seitenleiste, Mehr, Einstellungen). */
async function backToSelf() {
  closeSheet();
  await store.backToSelf();
  goOrRefresh('#/');
}

function openMoreSheet() {
  const path = navPath();
  const body = el('div', { class: 'more-sheet' });
  // Konto-Kopf: die ANGEMELDETE Person, beim Verwalten „verwaltet gerade: …“ + Rückweg.
  // Auf dem iPhone der Hauptzugang zum Abmelden (keine Seitenleiste).
  const acct = accountBlock({ onBack: backToSelf, onLogout: doLogout });
  if (acct) body.appendChild(acct);
  // Zweispaltige Kacheln je Gruppe: alle Einträge passen ohne Scrollen aufs iPhone –
  // vorher lagen Einstellungen und Hilfe unter dem Falz (UI-14).
  visibleGroups().forEach((g) => {
    body.appendChild(el('div', { class: 'more-group__title', text: g.title }));
    const grid = el('div', { class: 'more-grid' });
    g.items.forEach((item) => {
      const active = navMatches(item, path);
      grid.appendChild(el('a', {
        class: `more-tile ${active ? 'is-active' : ''}`, href: item.hash,
        ...(active ? { 'aria-current': 'page' } : {}),
        onclick: () => closeSheet(),
      }, [
        el('span', { class: 'more-tile__icon', 'aria-hidden': 'true', html: iconSvg(item.icon) }),
        el('span', { class: 'more-tile__label', text: item.label }),
      ]));
    });
    body.appendChild(grid);
  });
  openSheet({ title: t('nav.more'), body });
}

/** Aktiven Menüeintrag markieren – auch „Mehr“ und „Fortschritt“ für ihre Unterseiten. */
function highlightNav(route) {
  const path = '#' + ((route && route.path) || '/');
  document.querySelectorAll('[data-nav]').forEach((node) => {
    const item = navItemOf.get(node);
    if (!item) return;
    const active = item.action === 'more' ? inMore(path) : (!item.action && navMatches(item, path));
    node.classList.toggle('is-active', active);
    if (active && !item.action) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
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
  document.body.classList.toggle('is-managing', managing);
  if (managing) {
    const who = store.activeMember();
    banner.hidden = false;
    banner.innerHTML = '';
    banner.appendChild(el('span', { html: iconSvg('user'), 'aria-hidden': 'true', style: { width: '16px', flex: '0 0 auto' } }));
    banner.appendChild(el('span', { text: t('account.managingBanner', { name: who ? who.name : t('account.aMember') }) }));
    // Kinder- und Jugendprofil: Eltern-Admins sollen sehen, dass hier keine Kalorien- und
    // Gewichtsziele gerechnet werden (Alter aus dem Geburtsjahr des Mitglieds).
    if (currentEligibility().minor) {
      banner.appendChild(el('span', { class: 'manage-banner__note', title: t('account.minorNote'), text: t('account.minorProfile') }));
    }
    banner.appendChild(el('button', { class: 'manage-banner__back', type: 'button', text: t('account.backToMe'), onclick: backToSelf }));
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

/** Fuß der Seitenleiste (iPad/Mac): angemeldete Person, ggf. „verwaltet gerade …“,
    Einstellungen · Hilfe · Abmelden. */
function renderSidebarFoot() {
  const foot = document.getElementById('sidebar-foot');
  if (!foot) return;
  foot.innerHTML = '';
  const acct = accountBlock({ onBack: backToSelf });
  if (!acct) return;                       // abgemeldet -> Sidebar ist ohnehin ausgeblendet
  foot.appendChild(acct);
  const path = navPath();
  const system = (MORE_GROUPS.find((g) => g.id === 'system') || { items: [] }).items;
  foot.appendChild(el('div', { class: 'sidebar__sys' }, [
    ...system.map((it) => track(navLink(it, { cls: 'sidebar__sys-item', path, short: true }), it)),
    el('button', { class: 'sidebar__sys-item', type: 'button', onclick: doLogout }, [
      el('span', { class: 'nav-ico', 'aria-hidden': 'true', html: iconSvg('arrowLeft') }), el('span', { text: t('account.signOut') }),
    ]),
  ]));
}

/** Vollständig abmelden -> zurück zum Login-Dashboard, Menüs ausblenden. */
async function doLogout() {
  closeSheet();
  await store.logout();
  await applyLanguage();   // the sign-in screen speaks the instance language
  applyAuthChrome();
  if (location.hash.startsWith('#/login')) router.refresh();
  else navigate('#/login');
}

/* ------------------------------- Routen --------------------------------- */
/**
 * Selten genutzte Ansichten erst bei Bedarf laden (FE-19): Hilfe (60 KB Text), Labor,
 * Berichte, Import, Team-Verwaltung und Workout – der Start parst so rund 190 KB weniger.
 * Offline bleiben sie verfügbar (alle Module stehen weiter in SHELL_ASSETS). Wechselt die
 * Seite, bevor das Modul da ist, zeichnet es nicht mehr in die neue Ansicht.
 */
const lazy = (load, pick = (m, v) => m.render(v)) => (v, p) => {
  const at = location.hash;
  return load().then((m) => { if (location.hash === at) return pick(m, v, p); });
};

function registerRoutes() {
  router.register('/', renderDashboard);
  router.register('/login', renderLogin);
  router.register('/family', renderFamily);
  router.register('/familie-verwalten', lazy(() => import('./family-admin.js')));
  router.register('/calendar', renderCalendar);
  router.register('/events', renderEvents);
  router.register('/event/:id', (v, p) => renderEvent(v, p.id));
  router.register('/plan/:eventId', (v, p) => renderPlan(v, p.eventId));
  router.register('/session/:id', (v, p) => renderSession(v, p.id));
  router.register('/workout/:id', lazy(() => import('./workout-mode.js'), (m, v, p) => m.render(v, p.id)));
  router.register('/health', renderHealth);
  router.register('/stats', renderStats);
  router.register('/nutrition', renderNutrition);
  router.register('/shopping', renderShopping);
  router.register('/checklist', renderChecklist);
  router.register('/import', lazy(() => import('./health-import.js')));
  router.register('/settings', renderSettings);
  router.register('/hilfe', lazy(() => import('./help.js')));
  router.register('/hilfe/:id', lazy(() => import('./help.js'), (m, v, p) => m.render(v, p.id)));
  router.register('/badges', renderBadges);
  router.register('/reports', lazy(() => import('./reports.js')));
  router.register('/report/:id', lazy(() => import('./reports.js'), (m, v, p) => m.renderDetail(v, p.id)));
  router.register('/zyklus', renderCycle);
  router.register('/labor', lazy(() => import('./labs-view.js')));
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
  await Promise.all([store.init(), loadLanguages()]);
  await applyLanguage();   // catalogs before the first render
  loadExerciseTexts();     // exercise steps and tips in the background
  loadHelpTexts();         // the in-app help, likewise
  // Fehlt einer Einheit die Anstrengung, schätzt die Belastung sie aus der Ø-HF – bezogen
  // auf die Max-HF der gerade angemeldeten Person.
  useHrReference(() => { const p = store.profile(); return p && Number(p.maxHr) > 0 ? { maxHr: Number(p.maxHr) } : null; });
  applyTheme();
  buildBottomNav();
  buildSidebar();
  registerRoutes();
  // Nach dem Speichern neu zeichnen statt neu zu laden (UI-10) – ein offenes Sheet
  // (etwa die Befindlichkeitsfrage nach dem Eintragen) bleibt dabei stehen.
  setRefreshHandler(() => router.refresh());
  // Anmelde-Gate: Ohne angemeldeten Nutzer ist nur das Familien-/Login-Dashboard
  // erreichbar (siehe session-gate.js). Menüs erscheinen erst nach dem Login.
  router.setGuard((path) => {
    const g = gate(store.activeUserId(), path);
    if (!g.allow) {
      // Deep-Link (z. B. „In der App öffnen“ aus der Kalender-Erinnerung) merken – nach
      // der Anmeldung geht es dorthin statt auf „Heute“ (FE-25).
      if (!store.activeUserId()) {
        const target = safeReturnTo('#' + path);
        try { if (target) sessionStorage.setItem(scopeKey('returnTo'), target); } catch { /* egal */ }
      }
      navigate(g.redirect);
      return false;
    }
    return true;
  });
  ensureGenerated();
  maybeRefreshWeather();
  router.onAfterRender(highlightNav);
  router.onAfterRender(updateManageBanner);
  router.onAfterRender(applyAuthChrome);
  // Tastatur und VoiceOver: Nach einem Seitenwechsel steht der Fokus auf dem Seitentitel
  // (wird angesagt) statt auf dem Menüeintrag; beim Neuzeichnen bleibt er, wo er war (UI-20).
  let firstRender = true;
  router.onAfterRender((cur, info) => {
    if (firstRender) { firstRender = false; return; }
    if ((info && info.refreshed) || document.getElementById('modal-root').classList.contains('is-open')) return;
    const title = document.getElementById('header-title');
    if (title) { try { title.focus({ preventScroll: true }); } catch { title.focus(); } }
  });
  const skip = document.getElementById('skip-link');
  if (skip) skip.addEventListener('click', () => document.getElementById('view').focus());
  router.start();
  window.__catofitBooted = true;   // Boot vollständig, erste Ansicht gezeichnet

  // Hintergrund-Sync -> Plan sicherstellen, Theme/Wetter & Ansicht aktualisieren.
  store.onSync((area, origin) => {
    if (area === 'profile') { applyTheme(); maybeRefreshWeather(); }
    // Sign-in, switching person or a language picked on another device.
    if (area === 'profile' || area === 'family') applyLanguage().then((changed) => { if (changed) router.refresh(); });
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
