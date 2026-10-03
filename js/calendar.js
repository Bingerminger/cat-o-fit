/* =========================================================================
   calendar.js — Monats-/Wochenansicht mit Touch-tauglichem Drag & Drop.
   Jede Einheit verlinkt per Deep-Link auf ihre Session (#/session/:id).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, typeIcon, fmtKm, fmtPace, fmtWeekday,
  todayStr, addDays, parseDate, toDateStr, monthName, weekStartMonday, isoDow,
  segmented, toast, effectiveStatus, confirmDialog,
} from './ui.js';
import { setHeader } from './router.js';
import { openActivitySheet, openReschedule } from './session.js';
import { saveUnitPatch } from './unit-actions.js';
import { rescheduleCheck } from './planflow.js';
import { weatherBadge } from './weather.js';
import { cyclePhase, isProtectedDay, PHASE_META } from './cycle.js';
import { datedItems, catMeta } from './checklist.js';

/** Termine (datierte Checklisten-Punkte) für einen Tag – nur wenn das Modul an ist. */
function termineOn(dateStr) {
  if (store.settings().modules?.checklist === false) return [];
  return datedItems(dateStr);
}

let viewMode = 'month';
let cursor = todayStr();
let viewRef = null;

function unitsOn(dateStr) {
  const out = [];
  store.get('plans').forEach((p) => (p.units || []).forEach((u) => { if (u.date === dateStr) out.push(u); }));
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
/** Freie Trainings (ohne Plan, z. B. importiert oder spontan erfasst) an einem Tag. */
function freeSessionsOn(dateStr) {
  return store.get('sessions').filter((s) => s && s.date === dateStr && !s.plannedId);
}
function firstOfMonth(dateStr) { const d = parseDate(dateStr); return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1)); }
function addMonths(dateStr, n) { const d = parseDate(dateStr); return toDateStr(new Date(d.getFullYear(), d.getMonth() + n, 1)); }

export function render(view) {
  viewRef = view;
  if (cursor === undefined) cursor = todayStr();
  draw();
}

function draw() {
  const view = viewRef;
  view.innerHTML = '';
  setHeader({
    title: 'Kalender',
    actions: [{ icon: 'target', label: 'Heute', onClick: () => { cursor = todayStr(); draw(); } }],
  });

  // Umschalter
  view.appendChild(el('div', { class: 'row row--between mb-4' }, [
    segmented([{ value: 'month', label: 'Monat' }, { value: 'week', label: 'Woche' }], viewMode, (v) => { viewMode = v; draw(); }),
  ]));

  // Navigationsleiste
  const label = viewMode === 'month'
    ? `${monthName(parseDate(cursor).getMonth())} ${parseDate(cursor).getFullYear()}`
    : weekLabel(cursor);
  view.appendChild(el('div', { class: 'cal-toolbar' }, [
    el('button', { class: 'icon-btn', 'aria-label': 'zurück', onclick: () => step(-1) }, icon('chevronLeft')),
    el('div', { class: 'cal-toolbar__label', text: label }),
    el('button', { class: 'icon-btn', 'aria-label': 'vor', onclick: () => step(1) }, icon('chevronRight')),
  ]));

  if (viewMode === 'month') drawMonth(view); else drawWeek(view);
}

function step(dir) {
  cursor = viewMode === 'month' ? addMonths(cursor, dir) : addDays(cursor, dir * 7);
  draw();
}

function weekLabel(dateStr) {
  const start = weekStartMonday(dateStr), end = addDays(start, 6);
  const s = parseDate(start), e = parseDate(end);
  return `${s.getDate()}.–${e.getDate()}. ${monthName(e.getMonth(), false)}`;
}

/* ------------------------------- Monat ---------------------------------- */
function drawMonth(view) {
  const grid = el('div', { class: 'cal-grid' });
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((d) => grid.appendChild(el('div', { class: 'cal-grid__dow', text: d })));

  const first = firstOfMonth(cursor);
  const gridStart = weekStartMonday(first);
  const month = parseDate(cursor).getMonth();
  const today = todayStr();

  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const d = parseDate(date);
    const inMonth = d.getMonth() === month;
    if (i >= 35 && inMonth === false && date > addDays(firstOfMonth(addMonths(cursor, 1)), -1)) { /* trailing */ }
    const units = unitsOn(date).filter((u) => u.type !== 'rest');
    const free = freeSessionsOn(date);
    const isRace = units.some((u) => u.type === 'race');
    // Kurztitel („Long 14 km“) – ab 820 px Breite sichtbar statt nur farbiger Punkte (UI-17);
    // für Screenreader nennt die Zelle Datum und Einheiten.
    const titles = [...units.map((u) => `${typeMeta(u.type).short}${u.targetDistanceKm ? ` ${fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0)}` : ''}`),
      ...free.map((s) => `${typeMeta(s.type).short}${s.distanceKm ? ` ${fmtKm(s.distanceKm, 0)}` : ''} ✓`)];
    const cell = el('button', {
      class: `cal-cell ${inMonth ? '' : 'cal-cell--out'} ${date === today ? 'cal-cell--today' : ''} ${isRace ? 'cal-cell--race' : ''}`,
      type: 'button',
      'aria-label': `${fmtWeekday(date, true)}, ${d.getDate()}. ${monthName(d.getMonth(), false)}${date === today ? ' (heute)' : ''}: ${titles.length ? titles.join(', ') : 'nichts geplant'}`,
      onclick: () => { viewMode = 'week'; cursor = date; draw(); },
    }, [
      el('div', { class: 'row row--between cal-cell__head', style: { gap: '2px' } }, [
        el('span', { class: 'cal-cell__num', text: String(d.getDate()) }),
        weatherCell(date),
      ]),
      titles.length ? el('div', { class: 'cal-cell__titles', 'aria-hidden': 'true' }, [
        ...titles.slice(0, 2).map((t) => el('span', { class: 'cal-cell__title', text: t })),
        titles.length > 2 ? el('span', { class: 'cal-cell__title dim', text: `+${titles.length - 2}` }) : null,
      ]) : null,
      el('div', { class: 'cal-cell__dots' }, [
        cycleDot(date),
        ...units.slice(0, 4).map((u) => el('span', { class: 'cal-dot', style: { background: typeMeta(u.type).color } })),
        // Freie Trainings: Punkt mit Rand (erledigt, ohne Plan).
        ...free.slice(0, 2).map((s) => el('span', { class: 'cal-dot cal-dot--free', style: { background: typeMeta(s.type).color }, title: s.title || typeMeta(s.type).label })),
        // Termine als eckige Punkte (zur Unterscheidung von runden Trainings-Punkten).
        ...termineOn(date).slice(0, 3).map((t) => el('span', { class: 'cal-dot cal-dot--task', style: { background: catMeta(t.category).color }, title: t.text })),
      ]),
    ]);
    grid.appendChild(cell);
  }
  view.appendChild(grid);
  view.appendChild(legend());
}

function legend() {
  const types = ['easy', 'long', 'tempo', 'interval', 'strength', 'cross_football', 'race'];
  const items = types.map((t) => el('span', { class: 'zones-legend__item' }, [
    el('span', { class: 'zones-legend__sw', style: { background: typeMeta(t).color } }),
    typeMeta(t).short,
  ]));
  // Termine (eckiger Punkt) nur erwähnen, wenn das Checklisten-Modul aktiv ist.
  if (store.settings().modules?.checklist !== false) {
    items.push(el('span', { class: 'zones-legend__item' }, [
      el('span', { class: 'zones-legend__sw', style: { background: 'var(--text-3)', borderRadius: '2px' } }),
      'Termin',
    ]));
  }
  return el('div', { class: 'row wrap gap-3 mt-4', style: { justifyContent: 'center' } }, items);
}

/* ------------------------------- Woche ---------------------------------- */
function drawWeek(view) {
  const start = weekStartMonday(cursor);
  const today = todayStr();
  const wrap = el('div', { class: 'cal-week' });

  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const units = unitsOn(date);
    const runUnits = units.filter((u) => u.type !== 'rest');
    const free = freeSessionsOn(date);
    const termine = termineOn(date);
    const counts = [];
    if (runUnits.length) counts.push(`${runUnits.length} Einheit${runUnits.length > 1 ? 'en' : ''}`);
    if (free.length) counts.push(`${free.length} Training${free.length > 1 ? 's' : ''}`);
    if (termine.length) counts.push(`${termine.length} Termin${termine.length > 1 ? 'e' : ''}`);
    const day = el('div', { class: 'cal-day', dataset: { date } });
    day.appendChild(el('div', { class: `cal-day__head ${date === today ? 'is-today' : ''}` }, [
      el('span', { class: 'cal-day__dow', text: fmtWeekday(date, true) }),
      el('span', { class: 'cal-day__date', text: `${parseDate(date).getDate()}. ${monthName(parseDate(date).getMonth(), false)}` }),
      cycleDayTag(date),
      weatherDay(date),
      el('span', { class: 'cal-day__count', text: counts.join(' · ') }),
      date <= today ? el('button', { class: 'icon-btn cal-day__add', 'aria-label': `Training am ${fmtWeekday(date, true)} erfassen`, title: 'Training erfassen', onclick: () => openActivitySheet({ date }) }, icon('plus')) : null,
    ]));

    if (!runUnits.length && !termine.length && !free.length) {
      day.appendChild(el('div', { class: 'cal-day__rest', text: 'Ruhetag' }));
    } else {
      const ul = el('div', { class: 'cal-day__units' });
      runUnits.forEach((u) => ul.appendChild(weekUnit(u)));
      free.forEach((s) => ul.appendChild(freeRow(s)));
      termine.forEach((t) => ul.appendChild(termineRow(t)));
      day.appendChild(ul);
    }
    wrap.appendChild(day);
  }
  view.appendChild(wrap);
  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: 'Tipp: Einheit am Griff ⠿ auf einen anderen Tag ziehen – oder den Griff antippen und ein Datum wählen.' }));
}

function weekUnit(u) {
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0));
  if (u.targetPaceSecPerKm) meta.push(`${fmtPace(u.targetPaceSecPerKm)}/km`);
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);

  // Griff als Knopf: ziehen verschiebt, antippen (oder Enter) öffnet den Verschieben-Dialog.
  const handle = el('button', { class: 'cal-unit__handle', type: 'button', 'aria-label': `„${u.title}“ verschieben`, title: 'Ziehen oder antippen zum Verschieben', html: iconSvg('grip') });
  attachDrag(handle, u);

  const eff0 = effectiveStatus(u);
  // Schadfrei: an geschützten (Menstruations-)Tagen kein „überfällig“.
  const eff = (eff0 === 'ueberfaellig' && isProtectedDay(u.date)) ? 'geplant' : eff0;
  const row = el('div', { class: `cal-unit ${eff === 'erledigt' ? 'cal-unit--done' : ''} ${eff === 'verpasst' ? 'cal-unit--missed' : ''} ${eff === 'ueberfaellig' ? 'cal-unit--overdue' : ''}` }, [
    handle,
    typeIcon(u.type, 'type-icon--sm'),
    el('a', { class: 'cal-unit__body', href: `#/session/${u.id}`, style: { textDecoration: 'none' } }, [
      el('div', { class: 'cal-unit__title', text: u.title }),
      el('div', { class: 'cal-unit__meta', text: meta.join(' · ') || typeMeta(u.type).label }),
    ]),
  ]);
  return row;
}

/** Zeile für ein freies Training (ohne Plan) – verlinkt auf die Auswertung, dort
    lässt es sich bearbeiten und löschen. */
function freeRow(s) {
  const meta = [];
  if (s.distanceKm) meta.push(fmtKm(s.distanceKm, s.distanceKm % 1 ? 1 : 0));
  if (s.durationSec) meta.push(`${Math.round(s.durationSec / 60)} min`);
  meta.push(s.source === 'apple-health' || s.source === 'health' ? 'Apple Health' : s.source === 'health-connect' ? 'Health Connect' : s.source === 'gpx' ? 'Datei-Import' : 'ohne Plan');
  return el('a', { class: 'cal-unit cal-unit--done', href: `#/session/${s.id}`, style: { textDecoration: 'none' } }, [
    typeIcon(s.type, 'type-icon--sm'),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title', text: s.title || typeMeta(s.type).label }),
      el('div', { class: 'cal-unit__meta', text: meta.join(' · ') }),
    ]),
  ]);
}

/** Termin-Zeile (datierter Checklisten-Punkt). Verlinkt in die Checkliste zum
 *  Bearbeiten/Abhaken. Kein Drag – das Datum ändert man im Checklisten-Formular. */
function termineRow(t) {
  const cm = catMeta(t.category);
  const meta = [t.time, cm.label].filter(Boolean).join(' · ');
  return el('a', {
    class: 'cal-unit cal-unit--task', href: '#/checklist', style: { textDecoration: 'none' },
  }, [
    el('span', { class: 'cal-task__icon', style: { color: t.checked ? 'var(--good)' : cm.color }, html: iconSvg(t.checked ? 'check' : cm.icon) }),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title', style: t.checked ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {}, text: t.text }),
      el('div', { class: 'cal-unit__meta', text: meta }),
    ]),
  ]);
}

/* --------------------------- Drag & Drop (Pointer) ---------------------- */
const EDGE = 72;   // px am oberen/unteren Rand, ab denen beim Ziehen gescrollt wird
function attachDrag(handle, unit) {
  // Tastatur und Antippen ohne Ziehen: Verschieben-Dialog (mit Kollisionsprüfung).
  handle.addEventListener('click', () => { if (!handle.dataset.dragged) openRescheduleFor(unit); delete handle.dataset.dragged; });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ghost = el('div', { class: 'drag-ghost', text: unit.title });
    let moved = false;
    let lastY = e.clientY;
    let lastX = e.clientX;
    let raf = 0;
    // Auto-Scroll: Ziele außerhalb des Bildschirms (Sonntag unten) bleiben erreichbar.
    const scrollTick = () => {
      const h = window.innerHeight;
      const dy = lastY < EDGE ? -14 : lastY > h - EDGE ? 14 : 0;
      if (dy) { window.scrollBy(0, dy); mark(lastX, lastY); }
      raf = requestAnimationFrame(scrollTick);
    };
    const mark = (x, y) => {
      const tgt = document.elementFromPoint(x, y)?.closest('.cal-day');
      document.querySelectorAll('.cal-day.drag-over').forEach((n) => n.classList.remove('drag-over'));
      if (tgt) tgt.classList.add('drag-over');
      return tgt;
    };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;   // Zittern ≠ Ziehen
      if (!moved) { moved = true; raf = requestAnimationFrame(scrollTick); }
      lastX = ev.clientX; lastY = ev.clientY;
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 14}px`;
      if (!ghost.parentNode) document.body.appendChild(ghost);
      mark(ev.clientX, ev.clientY);
    };
    const finish = (ev, cancelled) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cancelAnimationFrame(raf);
      ghost.remove();
      document.querySelectorAll('.cal-day.drag-over').forEach((x) => x.classList.remove('drag-over'));
      if (!moved) return;
      handle.dataset.dragged = '1';          // der folgende click öffnet keinen Dialog
      setTimeout(() => { delete handle.dataset.dragged; }, 400);
      if (cancelled) return;                 // System hat die Geste abgebrochen (Scrollen, Anruf …)
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cal-day');
      if (tgt && tgt.dataset.date && tgt.dataset.date !== unit.date) reschedule(unit, tgt.dataset.date);
    };
    const up = (ev) => finish(ev, false);
    const cancel = (ev) => finish(ev, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
}

function openRescheduleFor(unit) {
  const plan = store.get('plans').find((p) => p.id === unit.planId);
  if (plan) openReschedule(plan, unit);
}

/**
 * Verschieben per Ziehen: dieselbe Prüfung wie im Dialog (zwei Einheiten am selben Tag,
 * harte Einheit ohne Erholungstag) – bei einem Konflikt erst nachfragen – und danach
 * „Rückgängig“. Vorher speicherte das Ablegen sofort und ohne Warnung (UI-23).
 */
export async function reschedule(unit, newDate) {
  const plan = store.get('plans').find((p) => p.id === unit.planId);
  const { sameDay, hardNeighbor } = rescheduleCheck((plan && plan.units) || [], unit.id, newDate);
  const hints = [];
  if (sameDay) hints.push(`An diesem Tag liegt bereits „${sameDay.title}“.`);
  if (hardNeighbor) hints.push(`${hardNeighbor.dir === 'prev' ? 'Am Vortag' : 'Am Folgetag'} liegt „${hardNeighbor.unit.title}“ (fordernd).`);
  if (hints.length && !(await confirmDialog({
    title: `Auf ${fmtWeekday(newDate, true)} verschieben?`, message: hints.join(' '),
    confirmLabel: 'Trotzdem verschieben', cancelLabel: 'Abbrechen',
  }))) return;
  const before = { date: unit.date, dow: unit.dow, status: unit.status, movedFrom: unit.movedFrom ?? null };
  // Status bleibt „geplant“ (die Einheit findet statt, nur an einem anderen Tag);
  // die Verschiebung merkt sich `movedFrom`. Siehe session.js openReschedule.
  saveUnitPatch(unit.planId, unit.id, {
    date: newDate, dow: isoDow(newDate),
    status: unit.status === 'erledigt' ? 'erledigt' : 'geplant',
    movedFrom: unit.movedFrom || unit.date,
  });
  toast(`Verschoben auf ${fmtWeekday(newDate, true)}`, 'good', 6000, {
    label: 'Rückgängig', onClick: () => { saveUnitPatch(unit.planId, unit.id, before); draw(); },
  });
  draw();
}

/* ------------------------------- Wetter --------------------------------- */
function weatherCell(date) {
  const wb = weatherBadge(date);
  if (!wb) return null;
  return el('span', { class: 'cal-weather', title: `${wb.label} ${wb.tMin}–${wb.tMax}°`, text: `${wb.emoji}${wb.tMax}°` });
}
function weatherDay(date) {
  const wb = weatherBadge(date);
  if (!wb) return null;
  return el('span', { class: 'cal-day__weather', title: wb.label, text: `${wb.emoji} ${wb.tMin}–${wb.tMax}°` });
}

/* ------------------------------- Zyklus --------------------------------- */
function cycleDayTag(date) {
  const p = cyclePhase(date);
  // Unter hormoneller Verhütung nur die Blutungstage markieren (keine Phasen).
  if (!p || p.phase === 'neutral') return null;
  const m = PHASE_META[p.phase];
  return el('span', { class: 'cycle-tag', style: { background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color }, title: `${m.label}${p.predicted ? ' (Prognose)' : ''}`, text: `${m.emoji} ${m.label}` });
}
function cycleDot(date) {
  const p = cyclePhase(date);
  if (!p || p.phase !== 'menstruation') return null;
  return el('span', { class: 'cal-cycle-dot', style: { background: PHASE_META.menstruation.color }, title: 'Menstruation' + (p.predicted ? ' (Prognose)' : '') });
}
