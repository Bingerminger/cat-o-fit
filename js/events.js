/* =========================================================================
   events.js — Ziele (Wettkämpfe und Programme): Liste, Detail, Anlegen/Bearbeiten.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, fmtDate, fmtDateLong, fmtKm, fmtPace,
  diffDays, addDays, todayStr, sectionHead, emptyState, toast, confirmDialog, openSheet, closeSheet,
  field, input, select, textarea, segmented, PRIORITIES, fieldError,
} from './ui.js';
import { setHeader } from './router.js';
import { openPlanSetup } from './plans.js';
import { PROGRAM_TYPES, programMeta, programPlanName, createProgramPlan, buildProgramUnits, programPhases } from './program.js';
import { mergeFromDate } from './planflow.js';
import { targetPaceSecPerKm, predictRace } from './suggestions.js';
import { openIcsSheet } from './ics-export.js';
import { currentEligibility } from './wellness.js';
import { adherence } from './fitness.js';
import { isProtectedDay } from './cycle.js';

const DISTANCES = {
  '5k': { label: '5 km', km: 5 },
  '10k': { label: '10 km', km: 10 },
  'HM': { label: 'Halbmarathon', km: 21.0975 },
  'M': { label: 'Marathon', km: 42.195 },
  // `beta`: Pläne für diese Formate sind noch jung (keine Rad-/Schwimmzonen,
  // Stationen ohne Laststeuerung) – das Auswahlfeld sagt das ehrlich.
  'tri-sprint': { label: 'Triathlon (Sprint)', km: 5, sport: 'triathlon', beta: true },
  'tri-olympic': { label: 'Triathlon (Olympisch)', km: 10, sport: 'triathlon', beta: true },
  'hyrox': { label: 'Hyrox', km: 8, sport: 'hyrox', beta: true },
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

  // Eckdaten. Laufstrecken als Zahl („21,1 km“, darunter „Halbmarathon“) – der Name allein
  // passte auf dem iPhone nicht in die Kachel. Triathlon und Hyrox nennen ihr Format.
  const distKm = e.distanceKm || dist.km;
  const distStat = !dist.sport && distKm
    ? miniStat(fmtKm(distKm, distKm % 1 ? 1 : 0), dist.label && !/km$/.test(dist.label) && e.distanceType !== 'custom' ? dist.label : 'Distanz')
    : miniStat(dist.label || '–', dist.sport ? 'Format' : 'Distanz');
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    distStat,
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
    // Dieselbe Definition wie Statistik und Monatsbericht (heute, Krankheit/Verletzung
    // und geschützte Zyklustage zählen nicht gegen dich).
    const adh = adherence([plan], { today: todayStr(), isProtectedDay }).pct;
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
        adh != null ? el('span', { class: 'chip chip--accent', text: `${adh}% Plan-Einhaltung` }) : null,
      ]),
    ]));
  } else if (e.date <= todayStr()) {
    // Kein leerer Plan für ein Rennen heute oder in der Vergangenheit.
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted', text: e.date === todayStr()
        ? 'Heute ist Wettkampf – für einen Trainingsplan ist es zu spät. Viel Erfolg!'
        : 'Der Wettkampf liegt in der Vergangenheit – dafür lässt sich kein Plan mehr erstellen. Stimmt das Datum?' }),
    ]));
  } else {
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted mb-4', text: 'Für diesen Wettkampf gibt es noch keinen Plan. Erstelle einen periodisierten Trainingsplan bis zum Wettkampftag – passend zu deinem Niveau und deinen Lauftagen.' }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => doCreatePlan(e) }, [icon('sparkles'), 'Plan erstellen']),
    ]));
  }

  // Wettkampfprognose (Schätzung)
  const pred = predictRace(store.get('sessions'), e.distanceKm, { hrZones: store.profile().hrZones });
  if (pred) {
    view.appendChild(sectionHead('Prognose', null, { help: 'vdot' }));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: fmtSecs(pred.seconds) }),
          el('div', { class: 'muted', style: { fontSize: '0.8rem' }, text: `geschätzt aus ${pred.basis}` }),
        ]),
      ]),
      pred.note ? el('div', { class: 'muted mt-2', style: { fontSize: '0.8rem' }, text: pred.note }) : null,
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
      if (await confirmDialog({ title: 'Wettkampf löschen?', message: 'Wettkampf und zugehöriger Plan werden entfernt.', confirmLabel: 'Löschen', danger: true })) {
        const p = store.get('plans').find((pl) => pl.eventId === e.id);
        if (p) store.remove('plans', p.id);
        store.remove('events', e.id);
        toast('Wettkampf gelöscht', 'good');
        navigate('#/events');
      }
    },
  }, [icon('trash'), 'Wettkampf löschen']));
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
    const adh = adherence([plan], { today, isProtectedDay }).pct;
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
        adh != null ? el('span', { class: 'chip chip--accent', text: `${adh}% dabei` }) : null,
      ]),
    ]));
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-3', onclick: async () => {
      const ok = await confirmDialog({
        title: 'Plan ab heute neu berechnen?',
        message: 'Die Einheiten ab heute werden neu erzeugt. Vergangene, erledigte und verpasste Einheiten bleiben erhalten.',
        confirmLabel: 'Neu berechnen',
      });
      if (ok) doCreateProgramPlan(e);
    } }, [icon('refresh'), 'Plan ab heute neu berechnen']));
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
  openPlanSetup(e);
}

/* ------------------------------- Formular ------------------------------- */
/** Bedeutung der Prioritäten – direkt im Formular sichtbar (UI-35). */
const PRIORITY_HINT = {
  A: 'A – Saisonhöhepunkt: Der Plan läuft auf diesen Tag zu.',
  B: 'B – wichtiger Wettkampf: ernsthaft laufen, ohne ganzen Plan davor.',
  C: 'C – Vorbereitungs- oder Spaßrennen: als Trainingsreiz mitnehmen.',
};

function openEventForm(existing = null) {
  // Datum bewusst leer (UI-35): „heute“ war fast nie gemeint und wurde leicht übersehen.
  const e = existing || { distanceType: 'HM', priority: 'A', status: 'geplant', date: '' };
  let distType = e.distanceType || 'HM';
  // Robustheit: Alt-/Importdaten könnten das LABEL statt des Schlüssels tragen
  // (z. B. „Halbmarathon“ statt „HM“) – sonst crasht das Speichern (DISTANCES[distType].km).
  // Auf einen gültigen Schlüssel mappen (per Label oder per Distanz), sonst „custom“.
  if (!DISTANCES[distType]) {
    distType = Object.keys(DISTANCES).find((k) => DISTANCES[k].label === e.distanceType)
      || Object.keys(DISTANCES).find((k) => DISTANCES[k].km && Math.abs(DISTANCES[k].km - (e.distanceKm ?? -1)) < 0.5)
      || 'custom';
  }

  const nameI = input({ value: e.name || '', placeholder: 'z. B. Dresden Halbmarathon', required: '' });
  const dateI = input({ type: 'date', value: e.date || '', required: '', min: existing ? '' : todayStr() });
  const locI = input({ value: e.location || '', placeholder: 'Ort' });
  // Standard-Tastatur (kein inputmode:'numeric') – sonst fehlt auf iOS der Doppelpunkt
  // und die Zielzeit „hh:mm:ss“ lässt sich nicht eingeben. Punkt und Komma gehen auch.
  const timeI = input({ value: e.targetTime || '', placeholder: 'h:mm:ss, z. B. 1:55:00', autocomplete: 'off' });
  const notesI = textarea({ value: e.notes || '', placeholder: 'Notizen …' });
  const kmI = input({ type: 'number', step: '0.1', value: e.distanceKm || '', placeholder: 'km' });
  const kmField = field('Distanz (km)', kmI);
  kmField.style.display = distType === 'custom' ? 'block' : 'none';

  const distSel = select(Object.entries(DISTANCES).map(([k, v]) => ({ value: k, label: v.beta ? `${v.label} – Beta` : v.label })), distType, {
    onchange: (ev) => { distType = ev.target.value; kmField.style.display = distType === 'custom' ? 'block' : 'none'; },
  });

  let priority = e.priority || 'A';
  let status = e.status || 'geplant';
  const prioHint = el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '6px' }, text: PRIORITY_HINT[priority] || '' });
  const prioControl = segmented(
    [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }], priority,
    (v) => { priority = v; prioHint.textContent = PRIORITY_HINT[v] || ''; });

  const body = el('div', {}, [
    field('Name', nameI),
    el('div', { class: 'field__row' }, [field('Datum', dateI), field('Distanz', distSel)]),
    kmField,
    el('div', { class: 'field__row' }, [field('Ort', locI), field('Zielzeit', timeI)]),
    field('Priorität', prioControl),
    prioHint,
    field('Notizen', notesI),
  ]);

  openSheet({
    title: existing ? 'Wettkampf bearbeiten' : 'Neuer Wettkampf',
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          // Fehler direkt am Feld (UI-35) statt nur als Toast.
          if (!nameI.value.trim()) { fieldError(nameI, 'Bitte einen Namen eingeben.'); return; }
          if (!dateI.value) { fieldError(dateI, 'Bitte das Datum des Wettkampfs wählen.'); return; }
          if (timeI.value.trim() && !parseTargetTime(timeI.value)) { fieldError(timeI, 'Zielzeit bitte als h:mm:ss, z. B. 1:55:00 (oder mm:ss).'); return; }
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
          // Zielzeit- oder Datumsänderung: der vorhandene Plan merkt sich die Zielzeit;
          // Paces und Einheiten ändern sich nicht still – das übernimmt „Plan ab heute
          // neu berechnen" im Plan.
          const plan = existing ? store.get('plans').find((p) => p.eventId === rec.id && p.kind !== 'program') : null;
          const planAffected = plan && (rec.targetTime !== e.targetTime || rec.date !== e.date || rec.distanceKm !== e.distanceKm);
          if (plan && rec.targetTime !== e.targetTime) store.patch('plans', plan.id, { goalTime: rec.targetTime });
          closeSheet();
          toast(planAffected
            ? 'Wettkampf aktualisiert – im Plan übernimmt „Plan ab heute neu berechnen“ die Änderung'
            : (existing ? 'Wettkampf aktualisiert' : 'Wettkampf angelegt'), 'good', planAffected ? 4200 : undefined);
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
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: currentEligibility().noWeightGoals
              ? 'Fitness, Kraft oder Beweglichkeit – wiederkehrender Wochenplan ganz ohne Wettkampf.'
              : 'Fitness, Kraft, Abnehmen oder Beweglichkeit – wiederkehrender Wochenplan ganz ohne Wettkampf.' }),
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

  // Neuer Name aus dem Schwerpunkt vorbelegt (UI-35) – solange niemand ihn selbst ändert.
  const nameI = input({ value: e.name || (existing ? '' : programMeta(type).label), placeholder: 'z. B. Mein Fitness-Start', required: '' });
  let nameTouched = !!existing;
  nameI.addEventListener('input', () => { nameTouched = true; });
  const descLine = el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '.4rem' } });
  const setDesc = () => {
    descLine.textContent = programMeta(type).desc;
    if (!nameTouched) nameI.value = programMeta(type).label;
  };
  setDesc();

  // Kinder, Schwangerschaft/Stillzeit, Essstörung: kein Abnehmprogramm (eligibility.js).
  // Ein bestehendes bleibt bearbeitbar, damit es sich umstellen lässt.
  const noWeightGoals = currentEligibility().noWeightGoals;
  const typeSel = select(
    Object.entries(PROGRAM_TYPES)
      .filter(([k]) => !(noWeightGoals && k === 'weightloss' && type !== 'weightloss'))
      .map(([k, v]) => ({ value: k, label: `${v.emoji} ${v.label}` })),
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
          if (!nameI.value.trim()) { fieldError(nameI, 'Bitte einen Namen eingeben.'); return; }
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
  const today = todayStr();
  // Laufendes Programm (Start liegt zurück): ab heute neu, Vergangenes bleibt –
  // sonst gingen erledigte Einheiten und die „% dabei“-Statistik verloren.
  if (old && old.startDate && old.startDate <= today) {
    const weeks = Math.max(1, e.weeks | 0);
    const daysPerWeek = e.daysPerWeek || programMeta(e.programType).defaultDays;
    const fresh = buildProgramUnits({ programType: e.programType, weeks, daysPerWeek }, old.id, old.startDate);
    store.patch('plans', old.id, {
      programType: e.programType, daysPerWeek, weeks, phases: programPhases(weeks),
      endDate: addDays(old.startDate, weeks * 7 - 1),
      name: programPlanName(e),
      units: mergeFromDate(old.units || [], fresh, today), generated: true,
    });
    toast('Programm ab heute aktualisiert – Vergangenes bleibt erhalten', 'good');
    navigate(`#/plan/${e.id}`);
    return;
  }
  if (old) store.remove('plans', old.id);
  const plan = createProgramPlan(e, today);
  store.upsert('plans', plan);
  toast('Programm-Plan erstellt 🎉', 'good');
  navigate(`#/plan/${e.id}`);
}

/* ------------------------------- Helfer --------------------------------- */
function miniStat(val, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', style: { fontSize: '1.1rem' }, text: val }), el('div', { class: 'stat__label', text: label })]);
}
/** Zielzeit „h:mm:ss“ oder „mm:ss“ (auch mit Punkt oder Komma getrennt) → „hh:mm:ss“;
    unlesbar → null. „75:30“ wird zu 01:15:30 (vorher entstand „00:75:30“). */
export function parseTargetTime(v) {
  const p = String(v || '').trim().split(/[:.,]/).map((x) => x.trim());
  if (p.length < 2 || p.length > 3 || !p.every((x) => /^\d{1,3}$/.test(x))) return null;
  const n = p.map(Number);
  const [h, m, s] = p.length === 3 ? n : [0, n[0], n[1]];
  if (s > 59 || (p.length === 3 && m > 59)) return null;
  const secs = h * 3600 + m * 60 + s;
  if (!secs) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}
function normalizeTime(v) {
  if (!v || !String(v).trim()) return '';
  return parseTargetTime(v) || String(v).trim();
}
function fmtSecs(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
