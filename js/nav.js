/* =========================================================================
   nav.js — Menüstruktur der App (Tab-Leiste, gegliedertes „Mehr“, Seitenleiste)
   und die Zuordnung Route → Menüeintrag für die aktive Markierung.

   Das Tägliche nach vorn: Heute · Kalender · ＋ Erfassen · Fortschritt · Mehr.
   „Fortschritt“ bündelt Statistik, Körperwerte, Erfolge und Berichte als Reiter;
   „Ziele & Pläne“ liegt eine Ebene tiefer (erreichbar auch über die Wettkampf-Karte
   auf „Heute“ und den Plan-Link jeder Einheit). Die alten Routen bleiben gültig –
   Deep-Links aus Kalender-Abos, Handbuch und Lesezeichen funktionieren weiter.
   ========================================================================= */

import * as store from './storage.js';
import { el, icon, iconSvg, safeAccent } from './ui.js';

import { t } from './i18n.js';

/** Tab-Leiste (iPhone). `action`: kein Link, sondern ein Knopf (Erfassen, Mehr). */
export const TAB_ITEMS = [
  { key: 'heute', icon: 'home', get label() { return t('nav.today'); }, hash: '#/' },
  { key: 'kalender', icon: 'calendar', get label() { return t('nav.calendar'); }, hash: '#/calendar' },
  { key: 'erfassen', icon: 'plus', get label() { return t('nav.capture'); }, action: 'capture' },
  { key: 'fortschritt', icon: 'chart', get label() { return t('nav.progress'); }, hash: '#/stats', match: ['#/stats', '#/health', '#/badges', '#/reports', '#/report/', '#/import'] },
  { key: 'mehr', icon: 'more', get label() { return t('nav.more'); }, action: 'more' },
];

/** Reiter innerhalb von „Fortschritt“ – jeder ist eine eigene (bestehende) Route. */
export const PROGRESS_TABS = [
  { get label() { return t('nav.tabs.training'); }, hash: '#/stats' },
  { get label() { return t('nav.tabs.body'); }, hash: '#/health', match: ['#/health', '#/import'] },
  { get label() { return t('nav.tabs.badges'); }, hash: '#/badges' },
  { get label() { return t('nav.tabs.reports'); }, hash: '#/reports', match: ['#/reports', '#/report/'] },
];

/** Zweite Ebene, nach Denkweise gegliedert. `module`: nur bei aktivem Modul,
    `admin`: nur für Administrator:innen, `self`: nicht beim Verwalten fremder Profile. */
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

/** Gehört die Route (`#/plan/e1`) zu diesem Eintrag? Präfixe mit „/“ am Ende passen auf
    Unterseiten, alle anderen exakt oder mit weiterem Pfadsegment. */
export function navMatches(item, path) {
  const list = item.match || (item.hash ? [item.hash] : []);
  return list.some((h) => {
    if (h === '#/') return path === '#/';
    if (h.endsWith('/')) return path.startsWith(h);
    return path === h || path.startsWith(h + '/');
  });
}

/** Ist ein Eintrag für die aktuelle Sicht sichtbar? Module sind Standard an und in den
    Einstellungen abschaltbar; private Module (Zyklus, Labor) sind beim Verwalten fremder
    Profile tabu (areaAllowed); „Team verwalten“ nur für Administrator:innen. */
export function navVisible(item) {
  if (item.admin && !store.isAdmin()) return false;
  return !item.module || (store.settings().modules?.[item.module] !== false && store.areaAllowed(item.module));
}

/** Sichtbare Gruppen/Einträge – `isVisible(item)` entscheidet über Modul, Rolle usw. */
export function visibleGroups(isVisible = navVisible) {
  return MORE_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => isVisible(it)) }))
    .filter((g) => g.items.length);
}

/** Liegt die Route in „Mehr“ (damit der Mehr-Tab aktiv markiert werden kann)? */
export function inMore(path, isVisible = navVisible) {
  return visibleGroups(isVisible).some((g) => g.items.some((it) => navMatches(it, path)));
}

/** Reiter „Training · Körper · Erfolge · Berichte“ oben in den Fortschritt-Ansichten. */
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

/** Kleiner Hilfsbaustein: Menüeintrag als Link mit Symbol (Seitenleiste/Mehr-Sheet).
    `short`: Kurzbeschriftung (Seitenleisten-Fuß), der volle Name bleibt als Tooltip. */
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
 * Konto-Kopf für Seitenleiste und „Mehr“: immer die ANGEMELDETE Person (UI-02) – beim
 * Verwalten eines anderen Profils zusätzlich „verwaltet gerade: Lea“ mit dem Weg zurück.
 * Früher stand hier das verwaltete Mitglied als „angemeldet“; am geteilten iPad hielt
 * man sich dann für Lea angemeldet und trug Werte ins falsche Profil ein.
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
