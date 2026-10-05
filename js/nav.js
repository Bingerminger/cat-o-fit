/* =========================================================================
   nav.js — menu structure of the app (tab bar, structured "More", sidebar)
   and the mapping route → menu entry for the active marker.

   The daily things up front: Today · Calendar · ＋ Log · Progress · More.
   "Progress" bundles statistics, body values, achievements and reports as tabs;
   "Goals & plans" sits one level deeper (also reachable via the race card
   on "Today" and the plan link of each session). The old routes remain valid –
   deep links from calendar subscriptions, manual and bookmarks keep working.
   ========================================================================= */

import * as store from './storage.js';
import { el, icon, iconSvg, safeAccent } from './ui.js';

import { t } from './i18n.js';

/** Tab bar (iPhone). `action`: not a link but a button (Log, More). */
export const TAB_ITEMS = [
  { key: 'heute', icon: 'home', get label() { return t('nav.today'); }, hash: '#/' },
  { key: 'kalender', icon: 'calendar', get label() { return t('nav.calendar'); }, hash: '#/calendar' },
  { key: 'erfassen', icon: 'plus', get label() { return t('nav.capture'); }, action: 'capture' },
  { key: 'fortschritt', icon: 'chart', get label() { return t('nav.progress'); }, hash: '#/stats', match: ['#/stats', '#/health', '#/badges', '#/reports', '#/report/', '#/import'] },
  { key: 'mehr', icon: 'more', get label() { return t('nav.more'); }, action: 'more' },
];

/** Tabs within "Progress" – each is its own (existing) route. */
export const PROGRESS_TABS = [
  { get label() { return t('nav.tabs.training'); }, hash: '#/stats' },
  { get label() { return t('nav.tabs.body'); }, hash: '#/health', match: ['#/health', '#/import'] },
  { get label() { return t('nav.tabs.badges'); }, hash: '#/badges' },
  { get label() { return t('nav.tabs.reports'); }, hash: '#/reports', match: ['#/reports', '#/report/'] },
];

/** Second level, structured by way of thinking. `module`: only with the module active,
    `admin`: only for administrators, `self`: not when managing other profiles. */
export const MORE_GROUPS = [
  { id: 'training', get title() { return t('nav.groups.training'); }, items: [
    { icon: 'flag', get label() { return t('nav.goalsPlans'); }, hash: '#/events', match: ['#/events', '#/event/', '#/plan/'] },
    { icon: 'dumbbell', get label() { return t('nav.exercises'); }, hash: '#/uebungen' },
  ] },
  { id: 'health', get title() { return t('nav.groups.health'); }, items: [
    { icon: 'moon', get label() { return t('nav.cycle'); }, hash: '#/zyklus', module: 'cycle' },
    { icon: 'flask', get label() { return t('nav.labs'); }, hash: '#/labor', module: 'labs' },
  ] },
  { id: 'household', get title() { return t('nav.groups.household'); }, items: [
    { icon: 'utensils', get label() { return t('nav.nutrition'); }, hash: '#/nutrition', module: 'nutrition' },
    { icon: 'cart', get label() { return t('nav.shopping'); }, hash: '#/shopping', module: 'shopping' },
    { icon: 'list', get label() { return t('nav.checklist'); }, hash: '#/checklist', module: 'checklist' },
  ] },
  { id: 'team', get title() { return t('nav.groups.team'); }, items: [
    { icon: 'grid', get label() { return t('nav.family'); }, hash: '#/family' },
    { icon: 'user', get label() { return t('nav.manageTeam'); }, hash: '#/familie-verwalten', admin: true },
  ] },
  { id: 'system', get title() { return t('nav.groups.system'); }, items: [
    { icon: 'settings', get label() { return t('nav.settings'); }, hash: '#/settings' },
    { icon: 'info', get label() { return t('nav.help'); }, get short() { return t('nav.helpShort'); }, hash: '#/hilfe' },
  ] },
];

/** Does the route (`#/plan/e1`) belong to this entry? Prefixes with a trailing "/" match
    sub-pages, all others exactly or with a further path segment. */
export function navMatches(item, path) {
  const list = item.match || (item.hash ? [item.hash] : []);
  return list.some((h) => {
    if (h === '#/') return path === '#/';
    if (h.endsWith('/')) return path.startsWith(h);
    return path === h || path.startsWith(h + '/');
  });
}

/** Is an entry visible for the current view? Modules are on by default and can be switched off in
    the settings; private modules (cycle, lab) are taboo when managing other
    profiles (areaAllowed); "Manage team" only for administrators. */
export function navVisible(item) {
  if (item.admin && !store.isAdmin()) return false;
  return !item.module || (store.settings().modules?.[item.module] !== false && store.areaAllowed(item.module));
}

/** Visible groups/entries – `isVisible(item)` decides on module, role etc. */
export function visibleGroups(isVisible = navVisible) {
  return MORE_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => isVisible(it)) }))
    .filter((g) => g.items.length);
}

/** Is the route in "More" (so that the More tab can be marked active)? */
export function inMore(path, isVisible = navVisible) {
  return visibleGroups(isVisible).some((g) => g.items.some((it) => navMatches(it, path)));
}

/** Tabs "Training · Body · Badges · Reports" at the top of the progress views. */
export function progressTabs(activeHash) {
  const path = activeHash || (typeof location !== 'undefined' ? location.hash : '');
  return el('nav', { class: 'progress-tabs segmented', 'aria-label': t('nav.progressAria') },
    PROGRESS_TABS.map((tab) => {
      const active = navMatches(tab, path);
      return el('a', {
        class: `segmented__opt ${active ? 'is-active' : ''}`, href: tab.hash,
        ...(active ? { 'aria-current': 'page' } : {}),
      }, tab.label);
    }));
}

/** Small helper block: menu entry as a link with an icon (sidebar/More sheet).
    `short`: short label (sidebar footer), the full name remains as a tooltip. */
export function navLink(item, { cls = 'sidebar__item', path = '', onClick = null, short = false } = {}) {
  const active = navMatches(item, path);
  const text = short && item.short ? item.short : item.label;
  return el('a', {
    class: `${cls} ${active ? 'is-active' : ''}`, href: item.hash, dataset: { hash: item.hash },
    ...(text !== item.label ? { title: item.label, 'aria-label': item.label } : {}),
    ...(active ? { 'aria-current': 'page' } : {}), ...(onClick ? { onclick: onClick } : {}),
  }, [el('span', { class: 'nav-ico', 'aria-hidden': 'true', html: iconSvg(item.icon) }), el('span', { text })]);
}

/**
 * Account header for sidebar and "More": always the SIGNED-IN person (UI-02) – when
 * managing another profile additionally "now managing: Lea" with the way back.
 * Formerly the managed member was shown here as "signed in"; on the shared iPad
 * people then thought they were signed in as Lea and entered values into the wrong profile.
 */
export function accountBlock({ onBack = null, onLogout = null } = {}) {
  const me = store.identityMember();
  if (!me) return null;
  const managed = store.isManaging() ? store.activeMember() : null;
  const color = safeAccent(me.color, '');
  return el('div', { class: `account ${managed ? 'account--managing' : ''}` }, [
    el('div', { class: 'account__row' }, [
      el('span', {
        class: 'account__avatar', 'aria-hidden': 'true', text: me.emoji || '🏃',
        style: color ? { background: color + '22', color } : {},
      }),
      el('div', { class: 'account__meta' }, [
        el('div', { class: 'account__name', text: me.name || t('account.member') }),
        el('div', { class: 'account__role', text: me.role === 'admin' ? t('account.signedInAdmin') : t('account.signedInMember') }),
      ]),
      onLogout ? el('button', { class: 'btn btn--ghost account__logout', type: 'button', onclick: onLogout }, [icon('arrowLeft'), t('account.signOut')]) : null,
    ]),
    managed ? el('div', { class: 'account__managing', role: 'status' }, [
      el('span', { class: 'account__managing-text', text: t('account.managing', { name: managed.name || t('account.aMember') }) }),
      onBack ? el('button', { class: 'btn btn--soft account__back', type: 'button', onclick: onBack }, t('account.backToMe')) : null,
    ]) : null,
  ]);
}
