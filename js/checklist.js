/* =========================================================================
   checklist.js — Checkliste & Erinnerungen.

   Zwei Arten von Punkten:
   - Tägliche Routine (recurring): abhakbar, per „Zurücksetzen“ wieder offen.
   - Termin mit Datum/Uhrzeit: einmalige Erinnerung, als .ics in den Kalender
     exportierbar (clientseitig erzeugt, kein Server nötig).
   Dazu Kategorien, Gruppierung (überfällig/heute/demnächst/Routinen) und
   Vorlagen (z. B. Wettkampf-Vorbereitung).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, uid, emptyState, toast, toastUndo, saveFile, openSheet, closeSheet,
  field, input, select, segmented, sectionHead, todayStr, fmtDate,
  rerenderView,
} from './ui.js';
import { lsGet, lsSet } from './env.js';
import { setHeader } from './router.js';
import { moduleOff } from './nutrition.js';
import { progressRing } from './charts.js';

import { t, tList } from './i18n.js';

const CATEGORIES = {
  routine:    { get label() { return t('checklist.category.routine'); },    icon: 'refresh',  color: '#43c59e' },
  training:   { get label() { return t('checklist.category.training'); },   icon: 'activity', color: '#3d8bff' },
  health:     { get label() { return t('checklist.category.health'); }, icon: 'heart',    color: '#ff5d8f' },
  errand:     { get label() { return t('checklist.category.errand'); },  icon: 'cart',     color: '#f5a623' },
  appointment:{ get label() { return t('checklist.category.appointment'); },     icon: 'calendar', color: '#7c5cff' },
};
export function catMeta(c) { return CATEGORIES[c] || CATEGORIES.routine; }

/** Termine (Einträge mit Datum) für einen Tag – für die Kalender-Anzeige.
 *  Nach Uhrzeit sortiert; Einträge ohne Uhrzeit ans Ende. */
export function datedItems(dateStr) {
  return store.get('checklist')
    .filter((i) => i.dueDate === dateStr)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/* ---- Vorlagen (mehrere Punkte auf einmal) -------------------------------- */
const TEMPLATES = {
  race_prep: {
    get label() { return t('checklist.templates.racePrep.label'); },
    get items() { return tList('checklist.templates.racePrep.items') || []; },
  },
  race_bag: {
    get label() { return t('checklist.templates.raceBag.label'); },
    get items() { return tList('checklist.templates.raceBag.items') || []; },
  },
  recovery: {
    get label() { return t('checklist.templates.recovery.label'); },
    get items() { return tList('checklist.templates.recovery.items') || []; },
  },
};

export function render(view) {
  setHeader({
    title: t('nav.checklist'),
    subtitle: t('checklist.subtitle'),
    actions: [
      { icon: 'grid', label: t('checklist.template'), onClick: () => openTemplates() },
      { icon: 'refresh', label: t('checklist.resetRoutines'), onClick: () => resetAll() },
      { icon: 'plus', label: t('checklist.add'), onClick: () => openForm() },
    ],
  });

  if (store.settings().modules?.checklist === false) { view.appendChild(moduleOff(t('nav.checklist'))); return; }

  const items = store.get('checklist');
  if (!items.length) {
    view.appendChild(emptyState('list', t('checklist.emptyTitle'), t('checklist.emptyText')));
    view.appendChild(el('div', { class: 'col gap-2 mt-4' }, [
      el('button', { class: 'btn btn--primary btn--block', onclick: () => openForm() }, [icon('plus'), t('checklist.addItem')]),
      el('button', { class: 'btn btn--soft btn--block', onclick: () => openTemplates() }, [icon('grid'), t('checklist.useTemplate')]),
    ]));
    return;
  }

  const today = todayStr();
  const routines = items.filter((i) => !i.dueDate);
  const dated = items.filter((i) => i.dueDate).sort((a, b) => (a.dueDate + (a.time || '')).localeCompare(b.dueDate + (b.time || '')));
  const todays = dated.filter((i) => i.dueDate === today);
  const overdue = dated.filter((i) => !i.checked && i.dueDate < today);
  const upcoming = dated.filter((i) => i.dueDate > today);

  // Fortschritt (Routinen + heutige Termine zählen als „heute“)
  const todayScope = [...routines, ...todays];
  if (todayScope.length) {
    const done = todayScope.filter((i) => i.checked).length;
    const pct = Math.round((done / todayScope.length) * 100);
    view.appendChild(el('div', { class: 'card row gap-4', style: { alignItems: 'center' } }, [
      el('div', { class: 'ring-wrap' }, [progressRing(done / todayScope.length, { size: 84 }), el('div', { class: 'ring-wrap__center' }, [el('div', { class: 'ring-wrap__val', text: `${pct}%` })])]),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '750', fontSize: '1.1rem' }, text: t('checklist.doneToday', { done, total: todayScope.length }) }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: pct === 100 ? t('checklist.allDone') : t('checklist.stepByStep') }),
      ]),
    ]));
  }

  if (overdue.length) { view.appendChild(sectionHead(t('status.ueberfaellig'))); appendList(view, overdue, true); }
  if (todays.length) { view.appendChild(sectionHead(t('checklist.dueToday'))); appendList(view, todays); }
  if (upcoming.length) { view.appendChild(sectionHead(t('checklist.upcoming'))); appendList(view, upcoming); }
  if (routines.length) { view.appendChild(sectionHead(t('checklist.dailyRoutines'))); appendList(view, routines); }

  // Häufig genutzte Punkte (gelernt) – Schnell-Hinzufügen
  const onList = items.map((i) => i.text.toLowerCase());
  const freq = frequentChecks(onList);
  if (freq.length) {
    view.appendChild(sectionHead(t('checklist.frequent')));
    const chips = el('div', { class: 'row wrap gap-2' });
    freq.forEach((f) => chips.appendChild(el('button', { class: 'chip chip--accent', text: `+ ${f.text}`, onclick: () => { bumpFreq(f.text); store.upsert('checklist', { id: uid('c'), text: f.text, checked: false, recurring: true, category: 'routine' }); rerender(); } })));
    view.appendChild(chips);
  }
}

function appendList(view, list, danger = false) {
  const card = el('div', { class: 'list-card mt-2' });
  list.forEach((i) => card.appendChild(row(i, danger)));
  view.appendChild(card);
}

function row(i, danger = false) {
  const cm = catMeta(i.category);
  const sub = [];
  if (i.dueDate) sub.push(`${fmtDate(i.dueDate)}${i.time ? ' · ' + i.time : ''}`);
  sub.push(cm.label);
  // Abhaken als echte Checkbox (Kreis/Haken, Name = Eintrag); der Eintrag selbst ist ein
  // Knopf – per Tastatur erreichbar. Vorher „offen, Taste“ und ein klickbares div (UI-41).
  return el('div', { class: 'list-item' }, [
    el('button', {
      class: 'icon-btn check-toggle', type: 'button', role: 'checkbox', 'aria-checked': i.checked ? 'true' : 'false',
      'aria-label': i.text, title: i.checked ? t('checklist.markOpen') : t('checklist.tick'),
      style: { color: i.checked ? 'var(--good-text)' : (danger ? 'var(--bad-text)' : 'var(--text-3)') },
      onclick: () => { store.patch('checklist', i.id, { checked: !i.checked }); rerender(); },
    }, icon(i.checked ? 'checkCircle' : 'circle')),
    el('button', { class: 'list-item__body list-item__btn', type: 'button', onclick: () => openForm(i), 'aria-label': t('checklist.editItem', { text: i.text }) }, [
      el('div', { class: 'list-item__title', style: i.checked ? { textDecoration: 'line-through', color: 'var(--text-2)' } : {}, text: i.text }),
      el('div', { class: 'list-item__sub', style: danger ? { color: 'var(--bad-text)' } : {}, text: sub.join(' · ') }),
    ]),
    i.dueDate ? el('button', { class: 'icon-btn', 'aria-label': t('checklist.addToCalendar'), title: t('checklist.addToCalendar'), onclick: () => exportIcs(i) }, icon('calendar')) : null,
    el('button', { class: 'icon-btn', 'aria-label': t('checklist.deleteItem', { text: i.text }), title: t('checklist.delete'), onclick: () => {
      // Löschen mit „Rückgängig“ statt endgültig per Fehltipp (UI-30).
      const prev = { ...i };
      store.remove('checklist', i.id); rerender();
      toastUndo(t('checklist.deleted'), () => { store.upsert('checklist', { ...prev, deleted: undefined }); rerender(); });
    } }, icon('trash')),
  ]);
}

/* ------------------------------ Formular -------------------------------- */
export function openForm(existing = null) {
  const e = existing || { category: 'routine', recurring: true };
  let kind = e.dueDate ? 'termin' : 'routine';
  let category = e.category || (kind === 'termin' ? 'appointment' : 'routine');

  const textI = input({ value: e.text || '', placeholder: t('checklist.taskPlaceholder') });
  const dateI = input({ type: 'date', value: e.dueDate || todayStr() });
  const timeI = input({ type: 'time', value: e.time || '' });
  const catSel = select(Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.label })), category, { onchange: (ev) => { category = ev.target.value; } });

  const dateRow = el('div', { class: 'field__row' }, [field(t('checklist.date'), dateI), field(t('checklist.timeOptional'), timeI)]);
  dateRow.style.display = kind === 'termin' ? 'flex' : 'none';

  const kindCtl = segmented(
    [{ value: 'routine', label: t('checklist.kindRoutine') }, { value: 'termin', label: t('checklist.kindDated') }],
    kind, (v) => { kind = v; dateRow.style.display = v === 'termin' ? 'flex' : 'none'; },
  );

  openSheet({
    title: existing ? t('checklist.editTitle') : t('checklist.newTitle'),
    body: el('div', {}, [
      field(t('checklist.task'), textI),
      field(t('checklist.kind'), kindCtl),
      dateRow,
      field(t('checklist.categoryField'), catSel),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: existing ? t('checklist.save') : t('checklist.add'),
        onclick: () => {
          const entry = textI.value.trim(); if (!entry) { toast(t('checklist.enterTask'), 'bad'); return; }
          bumpFreq(entry);
          const rec = {
            ...e, id: e.id || uid('c'), text: entry,
            checked: e.checked || false,
            recurring: kind === 'routine',
            dueDate: kind === 'termin' ? dateI.value : null,
            time: kind === 'termin' ? (timeI.value || null) : null,
            category,
          };
          store.upsert('checklist', rec);
          closeSheet(); toast(existing ? t('checklist.saved') : t('checklist.added'), 'good'); rerender();
        },
      }),
    ],
  });
}

/* ------------------------------ Vorlagen -------------------------------- */
function openTemplates() {
  const body = el('div', { class: 'col gap-2' }, Object.entries(TEMPLATES).map(([k, tpl]) => el('button', {
    class: 'card card--link', style: { textAlign: 'left', width: '100%' },
    onclick: () => {
      tpl.items.forEach((text) => store.upsert('checklist', { id: uid('c'), text, checked: false, recurring: false, category: 'training', dueDate: null }));
      closeSheet(); toast(t('checklist.templateAdded', { label: tpl.label, n: tpl.items.length }), 'good'); rerender();
    },
  }, [
    el('div', { class: 'card__title', text: tpl.label }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: tpl.items.slice(0, 3).join(' · ') + (tpl.items.length > 3 ? ' …' : '') }),
  ])));
  openSheet({ title: t('checklist.useTemplate'), body });
}

/* ----------------------- .ics-Export (clientseitig) --------------------- */
function pad(n) { return String(n).padStart(2, '0'); }
function icsStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
/** RFC-5545-Zeilenfaltung: max. 75 Oktette/Zeile, nie in einem UTF-8-Zeichen. */
function foldIcs(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  let out = '', count = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (count + b > 73) { out += '\r\n '; count = 1; }
    out += ch; count += b;
  }
  return out;
}
function exportIcs(item) {
  const esc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const date = item.dueDate;
  let dtstart, allDay = false;
  if (item.time) {
    const [h, m] = item.time.split(':').map(Number);
    const local = new Date(`${date}T${pad(h)}:${pad(m)}:00`);
    dtstart = `DTSTART:${icsStamp(local)}`;
  } else {
    dtstart = `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`;
    allDay = true;
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cat-O-Fit//Checkliste//DE', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${item.id}@catofit`, `DTSTAMP:${icsStamp(new Date())}`,
    dtstart, `SUMMARY:${esc(item.text)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(item.text)}`,
    allDay ? 'TRIGGER:-PT12H' : 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.map(foldIcs).join('\r\n') + '\r\n'], { type: 'text/calendar' });
  saveFile(t('checklist.icsFile', { date }), blob).then((res) => {
    if (res !== 'cancelled') toast(t('checklist.icsReady'), 'good');
  });
}

function resetAll() {
  // Nur Routinen zurücksetzen; erledigte Termine bleiben erledigt.
  store.get('checklist').forEach((i) => { if (i.checked && !i.dueDate) store.patch('checklist', i.id, { checked: false }); });
  toast(t('checklist.routinesReset'), 'good'); rerender();
}

/* --------------- Häufig genutzte Punkte lernen (clientseitig) ----------- */
function loadFreq() { try { return JSON.parse(lsGet('freqChecklist') || '{}'); } catch { return {}; } }
function bumpFreq(text) {
  const f = loadFreq(); const k = text.toLowerCase();
  f[k] = { text, count: ((f[k] && f[k].count) || 0) + 1 };
  try { lsSet('freqChecklist', JSON.stringify(f)); } catch { /* voll */ }
}
function frequentChecks(excludeLower) {
  return Object.values(loadFreq())
    .filter((x) => x.count >= 2 && !excludeLower.includes(x.text.toLowerCase()))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }
