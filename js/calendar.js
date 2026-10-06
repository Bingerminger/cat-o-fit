/* =========================================================================
   calendar.js — month/week view with touch-friendly drag & drop.
   Every session links via deep link to its session page (#/session/:id).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, typeIcon, fmtKm, fmtPace, fmtWeekday,
  todayStr, addDays, parseDate, toDateStr, monthName, weekStartMonday, isoDow,
  segmented, toast, effectiveStatus, confirmDialog, fmtDayMonth, localizeUnits, fmtKmAuto,
} from './ui.js';
import { distanceUnit } from './units.js';
import { setHeader } from './router.js';
import { openActivitySheet, openReschedule } from './session.js';
import { saveUnitPatch } from './unit-actions.js';
import { rescheduleCheck } from './planflow.js';
import { weatherBadge } from './weather.js';
import { cyclePhase, isProtectedDay, PHASE_META } from './cycle.js';
import { datedItems, catMeta } from './checklist.js';
import { weekdayNames } from './format.js';

import { t, tp } from './i18n.js';

/** Appointments (dated checklist items) for a day – only when the module is on. */
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
/** Free trainings (without a plan, e.g. imported or logged spontaneously) on a day. */
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
    title: t('nav.calendar'),
    actions: [{ icon: 'target', label: t('calendar.goToday'), onClick: () => { cursor = todayStr(); draw(); } }],
  });

  // Switcher
  view.appendChild(el('div', { class: 'row row--between mb-4' }, [
    segmented([{ value: 'month', label: t('calendar.month') }, { value: 'week', label: t('calendar.week') }], viewMode, (v) => { viewMode = v; draw(); }),
  ]));

  // Navigation bar
  const label = viewMode === 'month'
    ? `${monthName(parseDate(cursor).getMonth())} ${parseDate(cursor).getFullYear()}`
    : weekLabel(cursor);
  view.appendChild(el('div', { class: 'cal-toolbar' }, [
    el('button', { class: 'icon-btn', 'aria-label': t('calendar.prev'), onclick: () => step(-1) }, icon('chevronLeft')),
    el('div', { class: 'cal-toolbar__label', text: label }),
    el('button', { class: 'icon-btn', 'aria-label': t('calendar.next'), onclick: () => step(1) }, icon('chevronRight')),
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
  return t('calendar.weekRange', { from: s.getDate(), to: e.getDate(), month: monthName(e.getMonth(), false) });
}

/* ------------------------------- Month ---------------------------------- */
function drawMonth(view) {
  const grid = el('div', { class: 'cal-grid' });
  const dows = weekdayNames();   // Sunday first; the grid starts on Monday
  [1, 2, 3, 4, 5, 6, 0].forEach((i) => grid.appendChild(el('div', { class: 'cal-grid__dow', text: dows[i] })));

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
    // Short title ("Long 14 km") – visible from 820 px width instead of only coloured dots (UI-17);
    // for screen readers the cell announces the date and sessions.
    const titles = [...units.map((u) => `${typeMeta(u.type).short}${u.targetDistanceKm ? ` ${fmtKmAuto(u.targetDistanceKm)}` : ''}`),
      ...free.map((s) => `${typeMeta(s.type).short}${s.distanceKm ? ` ${fmtKm(s.distanceKm, 0)}` : ''} ✓`)];
    const aria = { weekday: fmtWeekday(date, true), date: fmtDayMonth(date), items: titles.length ? titles.join(', ') : t('calendar.nothingPlanned') };
    const cell = el('button', {
      class: `cal-cell ${inMonth ? '' : 'cal-cell--out'} ${date === today ? 'cal-cell--today' : ''} ${isRace ? 'cal-cell--race' : ''}`,
      type: 'button',
      'aria-label': date === today ? t('calendar.cellAriaToday', aria) : t('calendar.cellAria', aria),
      onclick: () => { viewMode = 'week'; cursor = date; draw(); },
    }, [
      el('div', { class: 'row row--between cal-cell__head', style: { gap: '2px' } }, [
        el('span', { class: 'cal-cell__num', text: String(d.getDate()) }),
        weatherCell(date),
      ]),
      titles.length ? el('div', { class: 'cal-cell__titles', 'aria-hidden': 'true' }, [
        ...titles.slice(0, 2).map((title) => el('span', { class: 'cal-cell__title', text: title })),
        titles.length > 2 ? el('span', { class: 'cal-cell__title dim', text: `+${titles.length - 2}` }) : null,
      ]) : null,
      el('div', { class: 'cal-cell__dots' }, [
        cycleDot(date),
        ...units.slice(0, 4).map((u) => el('span', { class: 'cal-dot', style: { background: typeMeta(u.type).color } })),
        // Free trainings: dot with a border (done, without a plan).
        ...free.slice(0, 2).map((s) => el('span', { class: 'cal-dot cal-dot--free', style: { background: typeMeta(s.type).color }, title: localizeUnits(s.title) || typeMeta(s.type).label })),
        // Appointments as square dots (to distinguish them from round training dots).
        ...termineOn(date).slice(0, 3).map((task) => el('span', { class: 'cal-dot cal-dot--task', style: { background: catMeta(task.category).color }, title: task.text })),
      ]),
    ]);
    grid.appendChild(cell);
  }
  view.appendChild(grid);
  view.appendChild(legend());
}

function legend() {
  const types = ['easy', 'long', 'tempo', 'interval', 'strength', 'cross_football', 'race'];
  const items = types.map((type) => el('span', { class: 'zones-legend__item' }, [
    el('span', { class: 'zones-legend__sw', style: { background: typeMeta(type).color } }),
    typeMeta(type).short,
  ]));
  // Mention appointments (square dot) only when the checklist module is active.
  if (store.settings().modules?.checklist !== false) {
    items.push(el('span', { class: 'zones-legend__item' }, [
      el('span', { class: 'zones-legend__sw', style: { background: 'var(--text-3)', borderRadius: '2px' } }),
      t('calendar.appointment'),
    ]));
  }
  return el('div', { class: 'row wrap gap-3 mt-4', style: { justifyContent: 'center' } }, items);
}

/* ------------------------------- Week ---------------------------------- */
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
    if (runUnits.length) counts.push(tp('calendar.sessionCount', runUnits.length));
    if (free.length) counts.push(tp('calendar.activityCount', free.length));
    if (termine.length) counts.push(tp('calendar.appointmentCount', termine.length));
    const day = el('div', { class: 'cal-day', dataset: { date } });
    day.appendChild(el('div', { class: `cal-day__head ${date === today ? 'is-today' : ''}` }, [
      el('span', { class: 'cal-day__dow', text: fmtWeekday(date, true) }),
      el('span', { class: 'cal-day__date', text: fmtDayMonth(date) }),
      cycleDayTag(date),
      weatherDay(date),
      el('span', { class: 'cal-day__count', text: counts.join(' · ') }),
      date <= today ? el('button', { class: 'icon-btn cal-day__add', 'aria-label': t('calendar.logOnDay', { weekday: fmtWeekday(date, true) }), title: t('calendar.logActivity'), onclick: () => openActivitySheet({ date }) }, icon('plus')) : null,
    ]));

    if (!runUnits.length && !termine.length && !free.length) {
      day.appendChild(el('div', { class: 'cal-day__rest', text: t('calendar.restDay') }));
    } else {
      const ul = el('div', { class: 'cal-day__units' });
      runUnits.forEach((u) => ul.appendChild(weekUnit(u)));
      free.forEach((s) => ul.appendChild(freeRow(s)));
      termine.forEach((task) => ul.appendChild(termineRow(task)));
      day.appendChild(ul);
    }
    wrap.appendChild(day);
  }
  view.appendChild(wrap);
  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: t('calendar.dragTip') }));
}

function weekUnit(u) {
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKmAuto(u.targetDistanceKm));
  if (u.targetPaceSecPerKm) meta.push(`${fmtPace(u.targetPaceSecPerKm)}/${distanceUnit()}`);
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);
  const title = localizeUnits(u.title);

  // Handle as a button: dragging moves, tapping (or Enter) opens the reschedule dialog.
  const handle = el('button', { class: 'cal-unit__handle', type: 'button', 'aria-label': t('calendar.moveUnit', { title }), title: t('calendar.dragOrTap'), html: iconSvg('grip') });
  attachDrag(handle, u);

  const eff0 = effectiveStatus(u);
  // No penalty: on protected (menstruation) days no "overdue".
  const eff = (eff0 === 'ueberfaellig' && isProtectedDay(u.date)) ? 'geplant' : eff0;
  const row = el('div', { class: `cal-unit ${eff === 'erledigt' ? 'cal-unit--done' : ''} ${eff === 'verpasst' ? 'cal-unit--missed' : ''} ${eff === 'ueberfaellig' ? 'cal-unit--overdue' : ''}` }, [
    handle,
    typeIcon(u.type, 'type-icon--sm'),
    el('a', { class: 'cal-unit__body', href: `#/session/${u.id}`, style: { textDecoration: 'none' } }, [
      el('div', { class: 'cal-unit__title', text: title }),
      el('div', { class: 'cal-unit__meta', text: meta.join(' · ') || typeMeta(u.type).label }),
    ]),
  ]);
  return row;
}

/** Row for a free training (without a plan) – links to the analysis, where it
    can be edited and deleted. */
function freeRow(s) {
  const meta = [];
  if (s.distanceKm) meta.push(fmtKmAuto(s.distanceKm));
  if (s.durationSec) meta.push(`${Math.round(s.durationSec / 60)} min`);
  meta.push(s.source === 'apple-health' || s.source === 'health' ? 'Apple Health' : s.source === 'health-connect' ? 'Health Connect' : s.source === 'gpx' ? t('calendar.fileImport') : t('calendar.noPlan'));
  return el('a', { class: 'cal-unit cal-unit--done', href: `#/session/${s.id}`, style: { textDecoration: 'none' } }, [
    typeIcon(s.type, 'type-icon--sm'),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title', text: localizeUnits(s.title) || typeMeta(s.type).label }),
      el('div', { class: 'cal-unit__meta', text: meta.join(' · ') }),
    ]),
  ]);
}

/** Appointment row (dated checklist item). Links into the checklist for
 *  editing/ticking off. No drag – the date is changed in the checklist form. */
function termineRow(task) {
  const cm = catMeta(task.category);
  const meta = [task.time, cm.label].filter(Boolean).join(' · ');
  return el('a', {
    class: 'cal-unit cal-unit--task', href: '#/checklist', style: { textDecoration: 'none' },
  }, [
    el('span', { class: 'cal-task__icon', style: { color: task.checked ? 'var(--good)' : cm.color }, html: iconSvg(task.checked ? 'check' : cm.icon) }),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title', style: task.checked ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {}, text: task.text }),
      el('div', { class: 'cal-unit__meta', text: meta }),
    ]),
  ]);
}

/* --------------------------- Drag & Drop (Pointer) ---------------------- */
const EDGE = 72;   // px at the top/bottom edge from which the view scrolls while dragging
function attachDrag(handle, unit) {
  // Keyboard and tap without dragging: reschedule dialog (with collision check).
  handle.addEventListener('click', () => { if (!handle.dataset.dragged) openRescheduleFor(unit); delete handle.dataset.dragged; });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ghost = el('div', { class: 'drag-ghost', text: localizeUnits(unit.title) });
    let moved = false;
    let lastY = e.clientY;
    let lastX = e.clientX;
    let raf = 0;
    // Auto-scroll: targets off-screen (Sunday at the bottom) stay reachable.
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
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;   // jitter ≠ drag
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
      handle.dataset.dragged = '1';          // the following click does not open a dialog
      setTimeout(() => { delete handle.dataset.dragged; }, 400);
      if (cancelled) return;                 // the system cancelled the gesture (scrolling, a call …)
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
 * Rescheduling by dragging: the same check as in the dialog (two sessions on the same day,
 * hard session without a recovery day) – ask first on a conflict – and afterwards
 * "Undo". Previously dropping saved immediately and without a warning (UI-23).
 */
export async function reschedule(unit, newDate) {
  const plan = store.get('plans').find((p) => p.id === unit.planId);
  const { sameDay, hardNeighbor } = rescheduleCheck((plan && plan.units) || [], unit.id, newDate);
  const hints = [];
  if (sameDay) hints.push(t('calendar.sameDay', { title: localizeUnits(sameDay.title) }));
  if (hardNeighbor) {
    hints.push(hardNeighbor.dir === 'prev'
      ? t('calendar.hardBefore', { title: localizeUnits(hardNeighbor.unit.title) })
      : t('calendar.hardAfter', { title: localizeUnits(hardNeighbor.unit.title) }));
  }
  if (hints.length && !(await confirmDialog({
    title: t('calendar.moveTo', { weekday: fmtWeekday(newDate, true) }), message: hints.join(' '),
    confirmLabel: t('calendar.moveAnyway'), cancelLabel: t('common.cancel'),
  }))) return;
  const before = { date: unit.date, dow: unit.dow, status: unit.status, movedFrom: unit.movedFrom ?? null };
  // Status stays "geplant" (planned; the session still takes place, just on another day);
  // the move is remembered in `movedFrom`. See session.js openReschedule.
  saveUnitPatch(unit.planId, unit.id, {
    date: newDate, dow: isoDow(newDate),
    status: unit.status === 'erledigt' ? 'erledigt' : 'geplant',
    movedFrom: unit.movedFrom || unit.date,
  });
  toast(t('calendar.movedTo', { weekday: fmtWeekday(newDate, true) }), 'good', 6000, {
    label: t('common.undo'), onClick: () => { saveUnitPatch(unit.planId, unit.id, before); draw(); },
  });
  draw();
}

/* ------------------------------- Weather --------------------------------- */
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

/* ------------------------------- Cycle --------------------------------- */
function cycleDayTag(date) {
  const p = cyclePhase(date);
  // Under hormonal contraception only mark the bleeding days (no phases).
  if (!p || p.phase === 'neutral') return null;
  const m = PHASE_META[p.phase];
  return el('span', { class: 'cycle-tag', style: { background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color }, title: p.predicted ? t('calendar.predicted', { label: m.label }) : m.label, text: `${m.emoji} ${m.label}` });
}
function cycleDot(date) {
  const p = cyclePhase(date);
  if (!p || p.phase !== 'menstruation') return null;
  return el('span', { class: 'cal-cycle-dot', style: { background: PHASE_META.menstruation.color }, title: p.predicted ? t('calendar.predicted', { label: t('calendar.period') }) : t('calendar.period') });
}
