/* =========================================================================
   calendar.js — Monats-/Wochenansicht mit Touch-tauglichem Drag & Drop.
   Jede Einheit verlinkt per Deep-Link auf ihre Session (#/session/:id).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, typeMeta, typeIcon, fmtKm, fmtPace, fmtWeekday,
  todayStr, addDays, parseDate, toDateStr, monthName, weekStartMonday, isoDow,
  segmented, toast, effectiveStatus,
} from './ui.js';
import { setHeader } from './router.js';
import { saveUnitPatch } from './session.js';
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
    const isRace = units.some((u) => u.type === 'race');
    const cell = el('button', {
      class: `cal-cell ${inMonth ? '' : 'cal-cell--out'} ${date === today ? 'cal-cell--today' : ''} ${isRace ? 'cal-cell--race' : ''}`,
      onclick: () => { viewMode = 'week'; cursor = date; draw(); },
    }, [
      el('div', { class: 'row row--between', style: { gap: '2px' } }, [
        el('span', { class: 'cal-cell__num', text: String(d.getDate()) }),
        weatherCell(date),
      ]),
      el('div', { class: 'cal-cell__dots' }, [
        cycleDot(date),
        ...units.slice(0, 4).map((u) => el('span', { class: 'cal-dot', style: { background: typeMeta(u.type).color } })),
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
    const termine = termineOn(date);
    const counts = [];
    if (runUnits.length) counts.push(`${runUnits.length} Einheit${runUnits.length > 1 ? 'en' : ''}`);
    if (termine.length) counts.push(`${termine.length} Termin${termine.length > 1 ? 'e' : ''}`);
    const day = el('div', { class: 'cal-day', dataset: { date } });
    day.appendChild(el('div', { class: `cal-day__head ${date === today ? 'is-today' : ''}` }, [
      el('span', { class: 'cal-day__dow', text: fmtWeekday(date, true) }),
      el('span', { class: 'cal-day__date', text: `${parseDate(date).getDate()}. ${monthName(parseDate(date).getMonth(), false)}` }),
      cycleDayTag(date),
      weatherDay(date),
      el('span', { class: 'cal-day__count', text: counts.join(' · ') }),
    ]));

    if (!runUnits.length && !termine.length) {
      day.appendChild(el('div', { class: 'cal-day__rest', text: 'Ruhetag' }));
    } else {
      const ul = el('div', { class: 'cal-day__units' });
      runUnits.forEach((u) => ul.appendChild(weekUnit(u)));
      termine.forEach((t) => ul.appendChild(termineRow(t)));
      day.appendChild(ul);
    }
    wrap.appendChild(day);
  }
  view.appendChild(wrap);
  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: 'Tipp: Einheit am Griff ⠿ gedrückt halten und auf einen anderen Tag ziehen.' }));
}

function weekUnit(u) {
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0));
  if (u.targetPaceSecPerKm) meta.push(`${fmtPace(u.targetPaceSecPerKm)}/km`);
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);

  const handle = el('span', { class: 'cal-unit__handle', 'aria-label': 'Verschieben', html: iconSvg('grip') });
  attachDrag(handle, u);

  const eff0 = effectiveStatus(u);
  // Schadfrei: an geschützten (Menstruations-)Tagen kein „überfällig".
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
function attachDrag(handle, unit) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const ghost = el('div', { class: 'drag-ghost', text: unit.title });
    let moved = false;

    const move = (ev) => {
      moved = true;
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 14}px`;
      if (!ghost.parentNode) document.body.appendChild(ghost);
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cal-day');
      document.querySelectorAll('.cal-day.drag-over').forEach((x) => x.classList.remove('drag-over'));
      if (tgt) tgt.classList.add('drag-over');
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      document.querySelectorAll('.cal-day.drag-over').forEach((x) => x.classList.remove('drag-over'));
      if (!moved) return;
      const tgt = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cal-day');
      if (tgt && tgt.dataset.date && tgt.dataset.date !== unit.date) reschedule(unit, tgt.dataset.date);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function reschedule(unit, newDate) {
  saveUnitPatch(unit.planId, unit.id, { date: newDate, dow: isoDow(newDate), status: unit.status === 'erledigt' ? 'erledigt' : 'verschoben' });
  toast(`Verschoben auf ${fmtWeekday(newDate, true)}`, 'good');
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
  if (!p) return null;
  const m = PHASE_META[p.phase];
  return el('span', { class: 'cycle-tag', style: { background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color }, title: `${m.label}${p.predicted ? ' (Prognose)' : ''}`, text: `${m.emoji} ${m.label}` });
}
function cycleDot(date) {
  const p = cyclePhase(date);
  if (!p || p.phase !== 'menstruation') return null;
  return el('span', { class: 'cal-cycle-dot', style: { background: PHASE_META.menstruation.color }, title: 'Menstruation' + (p.predicted ? ' (Prognose)' : '') });
}
