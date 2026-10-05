/* =========================================================================
   capture.js — "＋ Log": one fixed place for everything you enter quickly.
   Before, the routes were scattered across five modules (unplanned training
   only via Goals & plans, meal via More → Nutrition …).

   The forms themselves still belong to their modules; after saving they redraw the
   CURRENTLY open view via the router (refreshView) – an entry made from "Today"
   therefore leaves "Today" in place. Module-bound entries appear only when the module is active,
   private ones (cycle, labs) not when managing other profiles (navVisible).
   ========================================================================= */

import { el, iconSvg, openSheet, closeSheet } from './ui.js';
import { navVisible } from './nav.js';
import { openActivitySheet } from './session.js';
import { openHealthEntry } from './health.js';
import { openQuickEaten } from './nutrition.js';
import { openPeriodSheet } from './cycle.js';
import { openForm as openChecklistForm } from './checklist.js';

import { t } from './i18n.js';

export const CAPTURE_ITEMS = [
  { key: 'training', icon: 'activity', get label() { return t('capture.training'); }, get hint() { return t('capture.trainingHint'); }, open: () => openActivitySheet() },
  { key: 'koerper', icon: 'heart', get label() { return t('capture.body'); }, get hint() { return t('capture.bodyHint'); }, open: () => openHealthEntry() },
  { key: 'mahlzeit', icon: 'utensils', get label() { return t('capture.meal'); }, get hint() { return t('capture.mealHint'); }, module: 'nutrition', open: () => openQuickEaten() },
  { key: 'labor', icon: 'flask', get label() { return t('capture.lab'); }, get hint() { return t('capture.labHint'); }, module: 'labs', open: () => import('./labs-view.js').then((m) => m.openLabEntry()) },
  { key: 'periode', icon: 'moon', get label() { return t('capture.period'); }, get hint() { return t('capture.periodHint'); }, module: 'cycle', open: () => openPeriodSheet() },
  { key: 'checkliste', icon: 'list', get label() { return t('capture.checklist'); }, get hint() { return t('capture.checklistHint'); }, module: 'checklist', open: () => openChecklistForm() },
];

/** The entries that apply to the current view. */
export function captureItems(isVisible = navVisible) {
  return CAPTURE_ITEMS.filter((it) => isVisible(it));
}

/** Picker sheet "Log": one tap opens the matching form directly. */
export function openCaptureSheet(isVisible = navVisible) {
  const grid = el('div', { class: 'capture-grid' }, captureItems(isVisible).map((it) => el('button', {
    class: 'capture-tile', type: 'button', dataset: { capture: it.key },
    onclick: () => { closeSheet(); it.open(); },
  }, [
    el('span', { class: 'capture-tile__icon', 'aria-hidden': 'true', html: iconSvg(it.icon) }),
    el('span', { class: 'capture-tile__label', text: it.label }),
    el('span', { class: 'capture-tile__hint', text: it.hint }),
  ])));
  openSheet({ title: t('nav.capture'), body: grid });
}
