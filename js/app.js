/* =========================================================================
   app.js — entry point: theme, navigation, routes, sync, service worker.
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

// Signal to the inline diagnostics snippet in index.html: the module (including all
// static imports) was loaded AND executed successfully. If this flag is missing,
// the JS delivery did not get through (wrong MIME type / missing file).
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
  // Pick the text colour on the accent and the accent as text, depending on colour and theme,
  // so that they reach >= 4.5:1 (UI-12, UI-32) – previously white up to luminance 0.55 (2.65:1).
  const pal = accentPalette(accent, dark);
  root.setProperty('--accent-contrast', pal.contrast);
  root.setProperty('--accent-text', pal.text);
  root.setProperty('--accent-strong', pal.strong);
  root.setProperty('--accent-hero-end', pal.heroEnd);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0c0f13' : accent);
}

// Light/dark switches (iOS "Automatic"): redraw the view as well – charts
// take their colours when drawn and would otherwise stay in the old theme (FE-14).
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((store.settings().theme || 'system') === 'system') { applyTheme(); refreshSoon(); }
});
// Settings trigger a theme update (decoupled from settings.js).
window.addEventListener('catofit:theme', applyTheme);
// Module enabled/disabled -> rebuild the navigation (sidebar + "More") to show/hide it.
window.addEventListener('catofit:nav', () => { buildBottomNav(); buildSidebar(); highlightNav({ path: router.currentPath() }); });
// Close open sheets on navigation (otherwise they overlay the new view).
window.addEventListener('hashchange', () => closeSheet());
// Fresh weather forecast -> redraw the current view.
window.addEventListener('catofit:weather', () => refreshSoon());
// Device storage full: the last change was rolled back (not silently lost).
window.addEventListener('catofit:storage-full', () => toast(
  t('sync.storageFull'),
  'bad', 7000,
));
// The server rejected family changes (an admin sign-in is required for that).
window.addEventListener('catofit:ops-rejected', (e) => {
  const n = (e && e.detail && e.detail.count) || 1;
  toast(tp('sync.opsRejected', n, { reason: (e.detail && e.detail.reason) || t('sync.opsRejectedReason') }), 'bad', 7000);
  refreshSoon();
});
// The server sign-in has expired: cycle, labs and supplements only sync again
// after the PIN is entered (the app itself stays signed in).
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

// Foreground sync: when the app returns from the background (tab switch,
// reactivation of the installed PWA, bfcache restore), re-sync immediately.
// Otherwise a previously paused instance (e.g. the PWA next to Safari) shows
// a stale state until some other trigger happens to fire – exactly the "different
// data here and there" symptom. syncNow() is a no-op without login/offline; debounced,
// because focus + visibilitychange fire at the same time on a switch.
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
window.addEventListener('pageshow', wakeSync);           // bfcache restore
// Gentle poll while the app is visible: keeps two simultaneously open
// instances (PWA + browser) up to date without causing server load in the background.
setInterval(() => { if (document.visibilityState !== 'hidden') wakeSync(); }, 45000);

/** Refresh the weather if a location is set and the module is active. */
function maybeRefreshWeather() {
  const s = store.settings();
  if (s.weather !== false && s.location && s.location.lat != null) refreshWeather(s.location);
}

/* ----------------------------- Navigation ------------------------------- */
// Menu structure and route -> entry mapping: nav.js. Tab bar (iPhone): Today ·
// Calendar · ＋ Log · Progress · More. Sidebar (iPad/Mac): ＋ Log at the top,
// grouped, sticky footer with the signed-in person, Settings, Help, Sign out.

/** Menu element -> entry, for the active marking after each page change. */
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
  // The footer sticks to the bottom (visible even on an 800 px high laptop): who is signed in, whom one is
  // currently managing, Settings · Help · Sign out (UI-02, UI-16).
  side.appendChild(el('div', { class: 'sidebar__foot', id: 'sidebar-foot' }));
  renderSidebarFoot();
}

/** Back to your own profile (from banner, sidebar, More, Settings). */
async function backToSelf() {
  closeSheet();
  await store.backToSelf();
  goOrRefresh('#/');
}

function openMoreSheet() {
  const path = navPath();
  const body = el('div', { class: 'more-sheet' });
  // Account header: the SIGNED-IN person, when managing "now managing: …" + way back.
  // On the iPhone this is the main access to signing out (no sidebar).
  const acct = accountBlock({ onBack: backToSelf, onLogout: doLogout });
  if (acct) body.appendChild(acct);
  // Two-column tiles per group: all entries fit on the iPhone without scrolling –
  // previously Settings and Help were below the fold (UI-14).
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

/** Mark the active menu entry – also "More" and "Progress" for their subpages. */
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

/** Show/hide the banner when an admin is currently managing another member. */
let _navManaging = null;
function updateManageBanner() {
  const managing = store.isManaging();
  // When the managing status changes, rebuild the nav: private modules (cycle)
  // are hidden while managing other members (navVisible -> areaAllowed).
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
    // Child and youth profile: parent admins should see that no calorie or
    // weight targets are calculated here (age from the member's birth year).
    if (currentEligibility().minor) {
      banner.appendChild(el('span', { class: 'manage-banner__note', title: t('account.minorNote'), text: t('account.minorProfile') }));
    }
    banner.appendChild(el('button', { class: 'manage-banner__back', type: 'button', text: t('account.backToMe'), onclick: backToSelf }));
  } else {
    banner.hidden = true;
    banner.innerHTML = '';
  }
}

/* ----------------------- Sign-in state / menus -------------------------- */
/** Show menus (bottom nav/sidebar) only when signed in; fill the sidebar footer. */
function applyAuthChrome() {
  document.body.classList.toggle('is-anon', !menusVisible(store.activeUserId()));
  renderSidebarFoot();
}

/** Sidebar footer (iPad/Mac): signed-in person, "now managing …" if applicable,
    Settings · Help · Sign out. */
function renderSidebarFoot() {
  const foot = document.getElementById('sidebar-foot');
  if (!foot) return;
  foot.innerHTML = '';
  const acct = accountBlock({ onBack: backToSelf });
  if (!acct) return;                       // signed out -> the sidebar is hidden anyway
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

/** Sign out completely -> back to the login dashboard, hide menus. */
async function doLogout() {
  closeSheet();
  await store.logout();
  await applyLanguage();   // the sign-in screen speaks the instance language
  applyAuthChrome();
  if (location.hash.startsWith('#/login')) router.refresh();
  else navigate('#/login');
}

/* ------------------------------- Routes --------------------------------- */
/**
 * Load rarely used views only on demand (FE-19): Help (60 KB of text), Labs,
 * Reports, Import, Team management and Workout – startup parses roughly 190 KB less.
 * They stay available offline (all modules remain in SHELL_ASSETS). If the
 * page changes before the module is there, it no longer draws into the new view.
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
  // Public demo build only (index.html carries data-demo, see demo-mode.js): every visit starts
  // over, with the API answered in the browser. Normal instances never load the module.
  const demo = document.documentElement.hasAttribute('data-demo') ? await import('./demo-mode.js') : null;
  if (demo) demo.prepareDemo();
  await Promise.all([store.init(), loadLanguages()]);
  await applyLanguage();   // catalogs before the first render
  loadExerciseTexts();     // exercise steps and tips in the background
  loadHelpTexts();         // the in-app help, likewise
  // If a session lacks the effort rating, the load estimates it from the average HR – relative
  // to the max HR of the currently signed-in person.
  useHrReference(() => { const p = store.profile(); return p && Number(p.maxHr) > 0 ? { maxHr: Number(p.maxHr) } : null; });
  applyTheme();
  buildBottomNav();
  buildSidebar();
  registerRoutes();
  // Redraw after saving instead of reloading (UI-10) – an open sheet
  // (e.g. the mood question after logging) stays in place.
  setRefreshHandler(() => router.refresh());
  // Sign-in gate: without a signed-in user only the family/login dashboard is
  // reachable (see session-gate.js). Menus appear only after login.
  router.setGuard((path) => {
    const g = gate(store.activeUserId(), path);
    if (!g.allow) {
      // Remember the deep link (e.g. "Open in the app" from the calendar reminder) – after
      // signing in it goes there instead of "Today" (FE-25).
      if (!store.activeUserId()) {
        const target = safeReturnTo('#' + path);
        try { if (target) sessionStorage.setItem(scopeKey('returnTo'), target); } catch { /* ignore */ }
      }
      navigate(g.redirect);
      return false;
    }
    return true;
  });
  if (demo) await demo.startDemo();   // the demo family exists before the first view
  ensureGenerated();
  maybeRefreshWeather();
  router.onAfterRender(highlightNav);
  router.onAfterRender(updateManageBanner);
  router.onAfterRender(applyAuthChrome);
  // Keyboard and VoiceOver: after a page change the focus sits on the page title
  // (it is announced) instead of the menu entry; on redraw it stays where it was (UI-20).
  let firstRender = true;
  router.onAfterRender((cur, info) => {
    if (firstRender) { firstRender = false; return; }
    if ((info && info.refreshed) || document.getElementById('modal-root').classList.contains('is-open')) return;
    // Not before the person has interacted at all: a redraw at start-up would otherwise put a
    // focus ring on the title nobody asked for.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const title = document.getElementById('header-title');
    if (title) { try { title.focus({ preventScroll: true }); } catch { title.focus(); } }
  });
  const skip = document.getElementById('skip-link');
  if (skip) skip.addEventListener('click', () => document.getElementById('view').focus());
  router.start();
  window.__catofitBooted = true;   // boot complete, first view drawn

  // Background sync -> ensure the plan, update theme/weather & view.
  store.onSync((area, origin) => {
    if (area === 'profile') { applyTheme(); maybeRefreshWeather(); }
    // Sign-in, switching person or a language picked on another device.
    if (area === 'profile' || area === 'family') applyLanguage().then((changed) => { if (changed) { router.refresh(); demo?.showBar(); } });
    if (area === 'events' || area === 'plans') ensureGenerated();
    if (origin === 'sync') refreshSoon();
  });

  // Service worker (app shell available offline) + reliable updates.
  // Problem without this: an app installed as a home-screen PWA kept showing the
  // old version after a new release. Solution:
  //  - updateViaCache:'none' -> the SW script itself is never served
  //    from the HTTP cache, so a new release is detected.
  //  - regular reg.update() -> even long-open PWAs check for updates.
  //  - controllerchange -> the new SW (skipWaiting+claim) takes over; reload the page
  //    ONCE so that the new shell (JS/CSS) runs immediately. Do not reload on the
  //    very first install (there was no controller before).
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      location.reload();
    });
    let swReg = null;
    // When returning to the foreground (tab switch, reactivation of the PWA,
    // bfcache) check for a new release IMMEDIATELY – otherwise a paused
    // PWA shows the old version until the 30-minute timer or a manual close. If
    // update() finds a new SW, it takes over (skipWaiting+claim) and controllerchange
    // reloads once -> fresh shell.
    const checkUpdate = () => { if (document.visibilityState !== 'hidden') swReg?.update?.(); };
    window.addEventListener('load', async () => {
      try {
        swReg = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
        swReg.update?.();
        setInterval(checkUpdate, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', checkUpdate);
        window.addEventListener('focus', checkUpdate);
        window.addEventListener('pageshow', checkUpdate);
      } catch { /* SW is optional – the app also runs without it */ }
    });
  }
}

boot();
