/* =========================================================================
   events.js — Event-Verwaltung ("Backend"): Liste, Detail, Anlegen/Bearbeiten.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, fmtDate, fmtDateLong, fmtKm, fmtPace,
  diffDays, todayStr, sectionHead, emptyState, toast, confirmDialog, openSheet, closeSheet,
  field, input, select, textarea, segmented, PRIORITIES,
} from './ui.js';
import { setHeader } from './router.js';
import { createPlanForEvent } from './plans.js';
import { PROGRAM_TYPES, programMeta, createProgramPlan } from './program.js';
import { targetPaceSecPerKm, predictRace } from './suggestions.js';
import { openIcsSheet } from './ics-export.js';

const DISTANCES = {
  '5k': { label: '5 km', km: 5 },
  '10k': { label: '10 km', km: 10 },
  'HM': { label: 'Halbmarathon', km: 21.0975 },
  'M': { label: 'Marathon', km: 42.195 },
  'tri-sprint': { label: 'Triathlon (Sprint)', km: 5, sport: 'triathlon' },
  'tri-olympic': { label: 'Triathlon (Olympisch)', km: 10, sport: 'triathlon' },
  'hyrox': { label: 'Hyrox', km: 8, sport: 'hyrox' },
  'custom': { label: 'Individuell', km: null },
};

/* ------------------------------- Liste ---------------------------------- */
export function renderList(view) {
  setHeader({ title: 'Ziele', actions: [{ icon: 'plus', label: 'Neues Ziel', onClick: () => openAddChooser() }] });

  const all = store.get('events').slice();
  const today = todayStr();
  const programs = all.filter((e) => e.kind === 'program');
  const races = all.filter((e) => e.kind !== 'program').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcoming = races.filter((e) => e.status !== 'abgeschlossen' && e.date >= today);
  const past = races.filter((e) => e.status === 'abgeschlossen' || e.date < today);
  const activePrograms = programs.filter((e) => e.status !== 'abgeschlossen');
  const donePrograms = programs.filter((e) => e.status === 'abgeschlossen');

  if (!all.length) {
    view.appendChild(emptyState('flag', 'Noch kein Ziel',
      'Trainiere auf einen Wettkampf hin – oder starte ein Fitness-/Gesundheits-Programm ganz ohne Wettkampf.'));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openAddChooser() }, [icon('plus'), 'Ziel anlegen']));
    return;
  }

  if (activePrograms.length) {
    view.appendChild(sectionHead('Trainingsprogramme'));
    activePrograms.forEach((e) => view.appendChild(programCard(e)));
  }
  if (upcoming.length) {
    view.appendChild(sectionHead('Kommende Wettkämpfe'));
    upcoming.forEach((e) => view.appendChild(eventCard(e)));
  }
  if (past.length || donePrograms.length) {
    view.appendChild(sectionHead('Abgeschlossen'));
    past.forEach((e) => view.appendChild(eventCard(e, true)));
    donePrograms.forEach((e) => view.appendChild(programCard(e, true)));
  }
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-6', onclick: () => openAddChooser() }, [icon('plus'), 'Weiteres Ziel']));
}

/** Karte für ein Trainingsprogramm (ohne Wettkampf-Countdown). */
function programCard(e, dim = false) {
  const meta = programMeta(e.programType);
  const plan = store.get('plans').find((p) => p.eventId === e.id);
  return el('a', { class: 'card card--link', href: `#/event/${e.id}`, style: dim ? { opacity: '0.7' } : {} }, [
    el('div', { class: 'row gap-3' }, [
      el('span', { style: { fontSize: '1.6rem', lineHeight: '1' }, text: meta.emoji }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: e.name }),
        el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: meta.label }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2 wrap' }, [
      el('span', { class: 'chip', text: `${e.daysPerWeek || meta.defaultDays}×/Woche` }),
      plan ? el('span', { class: 'chip chip--accent', text: `Plan · ${plan.weeks} Wo.` }) : el('span', { class: 'chip', text: 'Kein Plan' }),
      el('span', { class: 'chip', text: e.status }),
    ]),
  ]);
}

function eventCard(e, dim = false) {
  const days = diffDays(todayStr(), e.date);
  const dist = DISTANCES[e.distanceType]?.label || (e.distanceKm ? fmtKm(e.distanceKm, 1) : '');
  const plan = store.get('plans').find((p) => p.eventId === e.id);
  return el('a', { class: 'card card--link', href: `#/event/${e.id}`, style: dim ? { opacity: '0.7' } : {} }, [
    el('div', { class: 'row gap-3' }, [
      el('span', { class: `tag-prio tag-prio--${e.priority || 'C'}`, text: e.priority || '–' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'card__title', text: e.name }),
        el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: `${fmtDate(e.date)} · ${dist}${e.location ? ' · ' + e.location : ''}` }),
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.1rem', color: days >= 0 ? 'var(--accent)' : 'var(--text-3)' }, text: days > 0 ? `${days}` : (days === 0 ? 'Heute' : '–') }),
        el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: days > 0 ? 'Tage' : '' }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2 wrap' }, [
      e.targetTime ? el('span', { class: 'chip', text: `Ziel ${e.targetTime}` }) : null,
      plan ? el('span', { class: 'chip chip--accent', text: `Plan · ${plan.weeks} Wo.` }) : el('span', { class: 'chip', text: 'Kein Plan' }),
      el('span', { class: 'chip', text: e.status }),
    ]),
  ]);
}

/* ------------------------------- Detail --------------------------------- */
export function renderDetail(view, id) {
  const e = store.find('events', id);
  if (!e) { navigate('#/events'); return; }
  if (e.kind === 'program') { renderProgramDetail(view, e); return; }

  setHeader({
    title: e.name, subtitle: fmtDate(e.date), back: '#/events',
    actions: [
      { icon: 'edit', label: 'Bearbeiten', onClick: () => openEventForm(e) },
      { icon: 'download', label: 'Export', onClick: () => openIcsSheet({ event: e }) },
    ],
  });

  const days = diffDays(todayStr(), e.date);
  const dist = DISTANCES[e.distanceType] || { label: fmtKm(e.distanceKm, 1), km: e.distanceKm };
  const tp = targetPaceSecPerKm(e.targetTime, e.distanceKm);

  // Countdown-Hero
  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: PRIORITIES[e.priority] || 'Wettkampf' }),
    el('div', { class: 'hero__title', text: e.name }),
    el('div', { class: 'hero__row' }, [
      el('div', {}, [
        el('div', { class: 'num', style: { fontSize: '2.4rem', fontWeight: '800', lineHeight: '1' }, text: days > 0 ? `${days}` : (days === 0 ? '🏁' : '✓') }),
        el('div', { style: { opacity: '0.85', fontSize: '0.84rem' }, text: days > 0 ? `Tage bis ${fmtDate(e.date)}` : (days === 0 ? 'Heute ist es soweit!' : 'vergangen') }),
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        e.targetTime ? el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '800' }, text: e.targetTime }) : null,
        e.targetTime ? el('div', { style: { opacity: '0.85', fontSize: '0.78rem' }, text: 'Zielzeit' }) : null,
      ]),
    ]),
  ]));

  // Eckdaten
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    miniStat(dist.label, 'Distanz'),
    tp ? miniStat(`${fmtPace(tp)}`, 'Zielpace min/km') : null,
    miniStat(e.location || '–', 'Ort'),
  ].filter(Boolean)));

  if (e.notes) view.appendChild(el('div', { class: 'card card--flat mt-4', text: e.notes }));

  // Plan-Bereich
  const plan = store.get('plans').find((p) => p.eventId === e.id);
  view.appendChild(sectionHead('Trainingsplan'));
  if (plan) {
    const units = plan.units || [];
    const done = units.filter((u) => u.status === 'erledigt').length;
    const due = units.filter((u) => u.date <= todayStr() && u.type !== 'rest');
    const adherence = due.length ? Math.round((due.filter((u) => u.status === 'erledigt').length / due.length) * 100) : null;
    view.appendChild(el('a', { class: 'card card--link', href: `#/plan/${e.id}` }, [
      el('div', { class: 'row row--between' }, [
        el('div', {}, [
          el('div', { class: 'card__title', text: plan.name }),
          el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: `${plan.weeks} Wochen · ${units.length} Einheiten` }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
      el('div', { class: 'row gap-2 mt-2 wrap' }, [
        el('span', { class: 'chip chip--good', text: `${done} erledigt` }),
        adherence != null ? el('span', { class: 'chip chip--accent', text: `${adherence}% Plan-Einhaltung` }) : null,
      ]),
    ]));
  } else {
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted mb-4', text: 'Für dieses Event gibt es noch keinen Plan. Erstelle einen periodisierten Trainingsplan bis zum Wettkampftag.' }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => doCreatePlan(e) }, [icon('sparkles'), 'Plan erstellen']),
    ]));
  }

  // Wettkampfprognose (Schätzung)
  const pred = predictRace(store.get('sessions'), e.distanceKm);
  if (pred) {
    view.appendChild(sectionHead('Prognose'));
    const hit = e.targetTime && pred.seconds <= (parsHms(e.targetTime) + 1);
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: fmtSecs(pred.seconds) }),
          el('div', { class: 'muted', style: { fontSize: '0.8rem' }, text: `geschätzt aus ${pred.basis} (Riegel-Formel)` }),
        ]),
      ]),
      el('div', { class: 'dim mt-2', style: { fontSize: '0.76rem' }, text: 'Nur eine grobe Näherung – Tagesform, Strecke und Wetter zählen am Renntag.' }),
    ]));
  }

  // Status / Löschen
  view.appendChild(sectionHead('Verwaltung'));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { padding: '4px 0' } }, [
      el('span', { text: 'Status' }),
      segmented(
        [{ value: 'geplant', label: 'Geplant' }, { value: 'abgeschlossen', label: 'Abgeschlossen' }],
        e.status === 'abgeschlossen' ? 'abgeschlossen' : 'geplant',
        (v) => { store.patch('events', e.id, { status: v }); toast('Status aktualisiert'); },
      ),
    ]),
  ]));
  view.appendChild(el('button', {
    class: 'btn btn--danger btn--block mt-4',
    onclick: async () => {
      if (await confirmDialog({ title: 'Event löschen?', message: 'Event und zugehöriger Plan werden entfernt.', confirmLabel: 'Löschen', danger: true })) {
        const p = store.get('plans').find((pl) => pl.eventId === e.id);
        if (p) store.remove('plans', p.id);
        store.remove('events', e.id);
        toast('Event gelöscht', 'good');
        navigate('#/events');
      }
    },
  }, [icon('trash'), 'Event löschen']));
}

/* --------------------------- Programm-Detail ---------------------------- */
function renderProgramDetail(view, e) {
  const meta = programMeta(e.programType);
  setHeader({
    title: e.name, subtitle: meta.label, back: '#/events',
    actions: [
      { icon: 'edit', label: 'Bearbeiten', onClick: () => openProgramForm(e) },
      { icon: 'download', label: 'Export', onClick: () => openIcsSheet({ event: e }) },
    ],
  });

  const plan = store.get('plans').find((p) => p.eventId === e.id);
  const units = plan ? (plan.units || []) : [];
  const done = units.filter((u) => u.status === 'erledigt').length;
  const today = todayStr();

  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: 'Trainingsprogramm' }),
    el('div', { class: 'hero__title', text: `${meta.emoji} ${e.name}` }),
    el('div', { style: { opacity: '0.9', fontSize: '0.86rem', marginTop: '0.3rem' }, text: meta.focus }),
  ]));

  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    miniStat(`${e.daysPerWeek || meta.defaultDays}×`, 'pro Woche'),
    miniStat(`${e.weeks || (plan ? plan.weeks : '–')}`, 'Wochen'),
    miniStat(`${done}`, 'erledigt'),
  ]));

  view.appendChild(el('div', { class: 'card card--flat mt-4', text: meta.desc }));

  view.appendChild(sectionHead('Wochenplan'));
  if (plan) {
    const due = units.filter((u) => u.date <= today && u.type !== 'rest');
    const adherence = due.length ? Math.round((due.filter((u) => u.status === 'erledigt').length / due.length) * 100) : null;
    view.appendChild(el('a', { class: 'card card--link', href: `#/plan/${e.id}` }, [
      el('div', { class: 'row row--between' }, [
        el('div', {}, [
          el('div', { class: 'card__title', text: plan.name }),
          el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: `${plan.weeks} Wochen · ${units.length} Einheiten` }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
      el('div', { class: 'row gap-2 mt-2 wrap' }, [
        el('span', { class: 'chip chip--good', text: `${done} erledigt` }),
        adherence != null ? el('span', { class: 'chip chip--accent', text: `${adherence}% dabei` }) : null,
      ]),
    ]));
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-3', onclick: async () => {
      const ok = await confirmDialog({
        title: 'Plan neu erstellen?',
        message: 'Der bestehende Wochenplan wird ersetzt – bereits als erledigt markierte Einheiten gehen dabei verloren.',
        confirmLabel: 'Neu erstellen', danger: true,
      });
      if (ok) doCreateProgramPlan(e);
    } }, [icon('refresh'), 'Plan neu erstellen']));
  } else {
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted mb-4', text: 'Für dieses Programm gibt es noch keinen Wochenplan.' }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => doCreateProgramPlan(e) }, [icon('sparkles'), 'Plan erstellen']),
    ]));
  }

  view.appendChild(sectionHead('Verwaltung'));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { padding: '4px 0' } }, [
      el('span', { text: 'Status' }),
      segmented(
        [{ value: 'aktiv', label: 'Aktiv' }, { value: 'abgeschlossen', label: 'Abgeschlossen' }],
        e.status === 'abgeschlossen' ? 'abgeschlossen' : 'aktiv',
        (v) => { store.patch('events', e.id, { status: v }); toast('Status aktualisiert'); },
      ),
    ]),
  ]));
  view.appendChild(el('button', {
    class: 'btn btn--danger btn--block mt-4',
    onclick: async () => {
      if (await confirmDialog({ title: 'Programm löschen?', message: 'Programm und zugehöriger Plan werden entfernt.', confirmLabel: 'Löschen', danger: true })) {
        const p = store.get('plans').find((pl) => pl.eventId === e.id);
        if (p) store.remove('plans', p.id);
        store.remove('events', e.id);
        toast('Programm gelöscht', 'good');
        navigate('#/events');
      }
    },
  }, [icon('trash'), 'Programm löschen']));
}

function doCreatePlan(e) {
  createPlanForEvent(e);
  toast('Plan erstellt 🎉', 'good');
  navigate(`#/plan/${e.id}`);
}

/* ------------------------------- Formular ------------------------------- */
function openEventForm(existing = null) {
  const e = existing || { distanceType: 'HM', priority: 'A', status: 'geplant', date: todayStr() };
  let distType = e.distanceType || 'HM';
  // Robustheit: Alt-/Importdaten könnten das LABEL statt des Schlüssels tragen
  // (z. B. „Halbmarathon" statt „HM") – sonst crasht das Speichern (DISTANCES[distType].km).
  // Auf einen gültigen Schlüssel mappen (per Label oder per Distanz), sonst „custom".
  if (!DISTANCES[distType]) {
    distType = Object.keys(DISTANCES).find((k) => DISTANCES[k].label === e.distanceType)
      || Object.keys(DISTANCES).find((k) => DISTANCES[k].km && Math.abs(DISTANCES[k].km - (e.distanceKm ?? -1)) < 0.5)
      || 'custom';
  }

  const nameI = input({ value: e.name || '', placeholder: 'z. B. Dresden Halbmarathon' });
  const dateI = input({ type: 'date', value: e.date || todayStr() });
  const locI = input({ value: e.location || '', placeholder: 'Ort' });
  // Standard-Tastatur (kein inputmode:'numeric') – sonst fehlt auf iOS der Doppelpunkt
  // und die Zielzeit „hh:mm:ss" lässt sich nicht eingeben.
  const timeI = input({ value: e.targetTime || '', placeholder: 'z. B. 1:55:00' });
  const notesI = textarea({ value: e.notes || '', placeholder: 'Notizen …' });
  const kmI = input({ type: 'number', step: '0.1', value: e.distanceKm || '', placeholder: 'km' });
  const kmField = field('Distanz (km)', kmI);
  kmField.style.display = distType === 'custom' ? 'block' : 'none';

  const distSel = select(Object.entries(DISTANCES).map(([k, v]) => ({ value: k, label: v.label })), distType, {
    onchange: (ev) => { distType = ev.target.value; kmField.style.display = distType === 'custom' ? 'block' : 'none'; },
  });

  let priority = e.priority || 'A';
  let status = e.status || 'geplant';

  const body = el('div', {}, [
    field('Name', nameI),
    el('div', { class: 'field__row' }, [field('Datum', dateI), field('Distanz', distSel)]),
    kmField,
    el('div', { class: 'field__row' }, [field('Ort', locI), field('Zielzeit', timeI)]),
    field('Priorität', segmented(
      [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }], priority, (v) => { priority = v; })),
    field('Notizen', notesI),
  ]);

  openSheet({
    title: existing ? 'Event bearbeiten' : 'Neues Event',
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          if (!nameI.value.trim()) { toast('Bitte einen Namen eingeben', 'bad'); return; }
          const km = distType === 'custom' ? (parseFloat(kmI.value) || null) : (DISTANCES[distType]?.km ?? (e.distanceKm || null));
          const rec = {
            ...e,
            id: e.id || uid('evt'),
            name: nameI.value.trim(),
            date: dateI.value,
            distanceType: distType,
            distanceKm: km,
            sport: DISTANCES[distType]?.sport || 'run',
            location: locI.value.trim(),
            targetTime: normalizeTime(timeI.value),
            priority, status,
            notes: notesI.value.trim(),
          };
          store.upsert('events', rec);
          // Zielzeit-Änderung in den vorhandenen Plan übernehmen (goalTime), damit
          // Prognose & Anzeige die neue Zielzeit widerspiegeln.
          if (existing && rec.targetTime !== e.targetTime) {
            const plan = store.get('plans').find((p) => p.eventId === rec.id);
            if (plan) store.patch('plans', plan.id, { goalTime: rec.targetTime });
          }
          closeSheet();
          toast(existing ? 'Event aktualisiert' : 'Event angelegt', 'good');
          navigate(`#/event/${rec.id}`);
        },
      }),
    ],
  });
}

/* ---------------------- Auswahl: Wettkampf oder Programm ----------------- */
function openAddChooser() {
  openSheet({
    title: 'Was möchtest du anlegen?',
    body: el('div', { class: 'col gap-3' }, [
      el('button', { class: 'card card--link', style: { textAlign: 'left', width: '100%' }, onclick: () => { closeSheet(); openEventForm(); } }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { style: { fontSize: '1.6rem' }, text: '🏁' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card__title', text: 'Wettkampf' }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Lauf, Triathlon oder Hyrox mit Datum und Zielzeit – periodisierter Plan bis zum Wettkampftag.' }),
          ]),
        ]),
      ]),
      el('button', { class: 'card card--link', style: { textAlign: 'left', width: '100%' }, onclick: () => { closeSheet(); openProgramForm(); } }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { style: { fontSize: '1.6rem' }, text: '💪' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card__title', text: 'Trainingsprogramm' }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Fitness, Kraft, Abnehmen oder Beweglichkeit – wiederkehrender Wochenplan ganz ohne Wettkampf.' }),
          ]),
        ]),
      ]),
    ]),
  });
}

/* ---------------------- Programm-Formular -------------------------------- */
function openProgramForm(existing = null) {
  const e = existing || { programType: 'fitness', status: 'aktiv' };
  let type = e.programType || 'fitness';
  let days = e.daysPerWeek || programMeta(type).defaultDays;
  let weeks = e.weeks || 8;

  const nameI = input({ value: e.name || '', placeholder: 'z. B. Mein Fitness-Start' });
  const descLine = el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '.4rem' } });
  const setDesc = () => { descLine.textContent = programMeta(type).desc; };
  setDesc();

  const typeSel = select(
    Object.entries(PROGRAM_TYPES).map(([k, v]) => ({ value: k, label: `${v.emoji} ${v.label}` })),
    type, { onchange: (ev) => { type = ev.target.value; setDesc(); } },
  );

  const body = el('div', {}, [
    field('Name', nameI),
    field('Schwerpunkt', typeSel),
    descLine,
    field('Trainingstage pro Woche', segmented(
      [3, 4, 5].map((n) => ({ value: String(n), label: `${n}×` })), String(days), (v) => { days = parseInt(v, 10); })),
    field('Dauer', segmented(
      [{ value: '4', label: '4 Wochen' }, { value: '8', label: '8 Wochen' }, { value: '12', label: '12 Wochen' }],
      String(weeks), (v) => { weeks = parseInt(v, 10); })),
  ]);

  openSheet({
    title: existing ? 'Programm bearbeiten' : 'Neues Trainingsprogramm',
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern & Plan erstellen',
        onclick: () => {
          if (!nameI.value.trim()) { toast('Bitte einen Namen eingeben', 'bad'); return; }
          const rec = {
            ...e,
            id: e.id || uid('prog'),
            kind: 'program',
            name: nameI.value.trim(),
            programType: type,
            daysPerWeek: days,
            weeks,
            status: e.status || 'aktiv',
            createdAt: e.createdAt || nowIso(),
          };
          store.upsert('events', rec);
          closeSheet();
          doCreateProgramPlan(rec);
        },
      }),
    ],
  });
}

function doCreateProgramPlan(e) {
  const old = store.get('plans').find((p) => p.eventId === e.id);
  if (old) store.remove('plans', old.id);
  const plan = createProgramPlan(e, todayStr());
  store.upsert('plans', plan);
  toast('Programm-Plan erstellt 🎉', 'good');
  navigate(`#/plan/${e.id}`);
}

/* ------------------------------- Helfer --------------------------------- */
function miniStat(val, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', style: { fontSize: '1.1rem' }, text: val }), el('div', { class: 'stat__label', text: label })]);
}
function normalizeTime(v) {
  if (!v) return '';
  const p = v.split(':').map((x) => x.trim());
  if (p.length === 2) return `00:${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}`;
  if (p.length === 3) return `${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}:${p[2].padStart(2, '0')}`;
  return v;
}
function parsHms(t) { const p = (t || '0:0:0').split(':').map(Number); while (p.length < 3) p.unshift(0); return p[0] * 3600 + p[1] * 60 + p[2]; }
function fmtSecs(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
