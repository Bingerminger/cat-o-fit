/* =========================================================================
   capture.js — „＋ Erfassen“: ein fester Platz für alles, was man schnell
   einträgt. Vorher lagen die Wege in fünf Modulen verstreut (ungeplantes Training
   nur über Ziel → Plan, Mahlzeit über Mehr → Ernährung …).

   Die Formulare selbst gehören weiter ihren Modulen; nach dem Speichern zeichnen sie
   über den Router die GERADE offene Ansicht neu (refreshView) – ein Eintrag aus „Heute“
   lässt also „Heute“ stehen. Modulgebundene Einträge erscheinen nur bei aktivem Modul,
   private (Zyklus, Labor) nicht beim Verwalten fremder Profile (navVisible).
   ========================================================================= */

import { el, iconSvg, openSheet, closeSheet } from './ui.js';
import { navVisible } from './nav.js';
import { openActivitySheet } from './session.js';
import { openHealthEntry } from './health.js';
import { openQuickEaten } from './nutrition.js';
import { openPeriodSheet } from './cycle.js';
import { openForm as openChecklistForm } from './checklist.js';

export const CAPTURE_ITEMS = [
  { key: 'training', icon: 'activity', label: 'Training', hint: 'Lauf, Radtour, Kraft – auch ohne Plan', open: () => openActivitySheet() },
  { key: 'koerper', icon: 'heart', label: 'Körperwerte', hint: 'Gewicht, Schlaf, Ruhepuls …', open: () => openHealthEntry() },
  { key: 'mahlzeit', icon: 'utensils', label: 'Mahlzeit', hint: 'Gegessenes nachtragen', module: 'nutrition', open: () => openQuickEaten() },
  { key: 'labor', icon: 'flask', label: 'Laborwert', hint: 'Wert vom Befund abtippen', module: 'labs', open: () => import('./labs-view.js').then((m) => m.openLabEntry()) },
  { key: 'periode', icon: 'moon', label: 'Periode', hint: 'Beginn eintragen', module: 'cycle', open: () => openPeriodSheet() },
  { key: 'checkliste', icon: 'list', label: 'Checklisten-Punkt', hint: 'Routine oder Termin', module: 'checklist', open: () => openChecklistForm() },
];

/** Die Einträge, die für die aktuelle Sicht gelten. */
export function captureItems(isVisible = navVisible) {
  return CAPTURE_ITEMS.filter((it) => isVisible(it));
}

/** Auswahl-Sheet „Erfassen“: ein Tipp öffnet direkt das passende Formular. */
export function openCaptureSheet(isVisible = navVisible) {
  const grid = el('div', { class: 'capture-grid' }, captureItems(isVisible).map((it) => el('button', {
    class: 'capture-tile', type: 'button', dataset: { capture: it.key },
    onclick: () => { closeSheet(); it.open(); },
  }, [
    el('span', { class: 'capture-tile__icon', 'aria-hidden': 'true', html: iconSvg(it.icon) }),
    el('span', { class: 'capture-tile__label', text: it.label }),
    el('span', { class: 'capture-tile__hint', text: it.hint }),
  ])));
  openSheet({ title: 'Erfassen', body: grid });
}
