/* =========================================================================
   events.js — goals (races and programmes): list, detail, create/edit.
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

import { t, tp } from './i18n.js';

const DISTANCES = {
  '5k': { label: '5 km', km: 5 },
  '10k': { label: '10 km', km: 10 },
  'HM': { get label() { return t('events.distances.halfMarathon'); }, km: 21.0975 },
  'M': { get label() { return t('events.distances.marathon'); }, km: 42.195 },
  // `beta`: plans for these formats are still young (no bike/swim zones,
  // stations without load control) – the selection field says so honestly.
  'tri-sprint': { get label() { return t('events.distances.triSprint'); }, km: 5, sport: 'triathlon', beta: true },
  'tri-olympic': { get label() { return t('events.distances.triOlympic'); }, km: 10, sport: 'triathlon', beta: true },
  'hyrox': { label: 'Hyrox', km: 8, sport: 'hyrox', beta: true },
  'custom': { get label() { return t('events.distances.custom'); }, km: null },
};

/* ------------------------------- List ----------------------------------- */
export function renderList(view) {
  setHeader({ title: t('events.title'), actions: [{ icon: 'plus', label: t('events.newGoal'), onClick: () => openAddChooser() }] });

  const all = store.get('events').slice();
  const today = todayStr();
  const programs = all.filter((e) => e.kind === 'program');
  const races = all.filter((e) => e.kind !== 'program').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcoming = races.filter((e) => e.status !== 'abgeschlossen' && e.date >= today);
  const past = races.filter((e) => e.status === 'abgeschlossen' || e.date < today);
  const activePrograms = programs.filter((e) => e.status !== 'abgeschlossen');
  const donePrograms = programs.filter((e) => e.status === 'abgeschlossen');

  if (!all.length) {
    view.appendChild(emptyState('flag', t('events.emptyTitle'),
      t('events.emptyText')));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openAddChooser() }, [icon('plus'), t('events.addGoal')]));
    return;
  }

  if (activePrograms.length) {
    view.appendChild(sectionHead(t('events.programmes')));
    activePrograms.forEach((e) => view.appendChild(programCard(e)));
  }
  if (upcoming.length) {
    view.appendChild(sectionHead(t('events.upcomingRaces')));
    upcoming.forEach((e) => view.appendChild(eventCard(e)));
  }
  if (past.length || donePrograms.length) {
    view.appendChild(sectionHead(t('events.completed')));
    past.forEach((e) => view.appendChild(eventCard(e, true)));
    donePrograms.forEach((e) => view.appendChild(programCard(e, true)));
  }
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-6', onclick: () => openAddChooser() }, [icon('plus'), t('events.anotherGoal')]));
}

/** Card for a training programme (without race countdown). */
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
      el('span', { class: 'chip', text: t('events.timesPerWeek', { n: e.daysPerWeek || meta.defaultDays }) }),
      plan ? el('span', { class: 'chip chip--accent', text: tp('events.planWeeksShort', plan.weeks) }) : el('span', { class: 'chip', text: t('events.noPlan') }),
      el('span', { class: 'chip', text: statusChip(e.status) }),
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
        el('div', { class: 'num', style: { fontWeight: '800', fontSize: '1.1rem', color: days >= 0 ? 'var(--accent)' : 'var(--text-3)' }, text: days > 0 ? `${days}` : (days === 0 ? t('events.today') : '–') }),
        el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: days > 0 ? tp('events.daysUnit', days) : '' }),
      ]),
    ]),
    el('div', { class: 'row gap-2 mt-2 wrap' }, [
      e.targetTime ? el('span', { class: 'chip', text: t('events.targetChip', { time: e.targetTime }) }) : null,
      plan ? el('span', { class: 'chip chip--accent', text: tp('events.planWeeksShort', plan.weeks) }) : el('span', { class: 'chip', text: t('events.noPlan') }),
      el('span', { class: 'chip', text: statusChip(e.status) }),
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
      { icon: 'edit', label: t('events.edit'), onClick: () => openEventForm(e) },
      { icon: 'download', label: t('events.export'), onClick: () => openIcsSheet({ event: e }) },
    ],
  });

  const days = diffDays(todayStr(), e.date);
  const dist = DISTANCES[e.distanceType] || { label: fmtKm(e.distanceKm, 1), km: e.distanceKm };
  const paceSec = targetPaceSecPerKm(e.targetTime, e.distanceKm);

  // Countdown hero
  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: PRIORITIES[e.priority] || t('events.race') }),
    el('div', { class: 'hero__title', text: e.name }),
    el('div', { class: 'hero__row' }, [
      el('div', {}, [
        el('div', { class: 'num', style: { fontSize: '2.4rem', fontWeight: '800', lineHeight: '1' }, text: days > 0 ? `${days}` : (days === 0 ? '🏁' : '✓') }),
        el('div', { style: { opacity: '0.85', fontSize: '0.84rem' }, text: days > 0 ? tp('events.daysUntil', days, { date: fmtDate(e.date) }) : (days === 0 ? t('events.raceDayHere') : t('events.past')) }),
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        e.targetTime ? el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '800' }, text: e.targetTime }) : null,
        e.targetTime ? el('div', { style: { opacity: '0.85', fontSize: '0.78rem' }, text: t('events.targetTime') }) : null,
      ]),
    ]),
  ]));

  // Key facts. Running distances as a number ("21.1 km", with "Half marathon" below) – the name alone
  // did not fit into the tile on the iPhone. Triathlon and Hyrox name their format.
  const distKm = e.distanceKm || dist.km;
  const distStat = !dist.sport && distKm
    ? miniStat(fmtKm(distKm, distKm % 1 ? 1 : 0), dist.label && !/km$/.test(dist.label) && e.distanceType !== 'custom' ? dist.label : t('events.distance'))
    : miniStat(dist.label || '–', dist.sport ? t('events.format') : t('events.distance'));
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    distStat,
    paceSec ? miniStat(`${fmtPace(paceSec)}`, t('events.targetPace')) : null,
    miniStat(e.location || '–', t('events.location')),
  ].filter(Boolean)));

  if (e.notes) view.appendChild(el('div', { class: 'card card--flat mt-4', text: e.notes }));

  // Plan section
  const plan = store.get('plans').find((p) => p.eventId === e.id);
  view.appendChild(sectionHead(t('events.trainingPlan')));
  if (plan) {
    const units = plan.units || [];
    const done = units.filter((u) => u.status === 'erledigt').length;
    // Same definition as statistics and the monthly report (today, illness/injury
    // and protected cycle days do not count against you).
    const adh = adherence([plan], { today: todayStr(), isProtectedDay }).pct;
    view.appendChild(el('a', { class: 'card card--link', href: `#/plan/${e.id}` }, [
      el('div', { class: 'row row--between' }, [
        el('div', {}, [
          el('div', { class: 'card__title', text: plan.name }),
          el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: `${tp('events.weeksCount', plan.weeks)} · ${tp('events.sessionsCount', units.length)}` }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
      el('div', { class: 'row gap-2 mt-2 wrap' }, [
        el('span', { class: 'chip chip--good', text: t('events.doneChip', { n: done }) }),
        adh != null ? el('span', { class: 'chip chip--accent', text: t('events.adherenceChip', { pct: adh }) }) : null,
      ]),
    ]));
  } else if (e.date <= todayStr()) {
    // No empty plan for a race today or in the past.
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted', text: e.date === todayStr()
        ? t('events.raceTodayNoPlan')
        : t('events.racePastNoPlan') }),
    ]));
  } else {
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted mb-4', text: t('events.noPlanYet') }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => doCreatePlan(e) }, [icon('sparkles'), t('events.createPlan')]),
    ]));
  }

  // Race prediction (estimate)
  const pred = predictRace(store.get('sessions'), e.distanceKm, { hrZones: store.profile().hrZones });
  if (pred) {
    view.appendChild(sectionHead(t('events.prediction'), null, { help: 'vdot' }));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'type-icon', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('target') }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'num', style: { fontSize: '1.5rem', fontWeight: '800' }, text: fmtSecs(pred.seconds) }),
          el('div', { class: 'muted', style: { fontSize: '0.8rem' }, text: t('events.estimatedFrom', { basis: pred.basis }) }),
        ]),
      ]),
      pred.note ? el('div', { class: 'muted mt-2', style: { fontSize: '0.8rem' }, text: pred.note }) : null,
      el('div', { class: 'dim mt-2', style: { fontSize: '0.76rem' }, text: t('events.predictionNote') }),
    ]));
  }

  // Status / delete
  view.appendChild(sectionHead(t('events.manage')));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { padding: '4px 0' } }, [
      el('span', { text: t('events.status') }),
      segmented(
        [{ value: 'geplant', label: t('status.geplant') }, { value: 'abgeschlossen', label: t('events.completed') }],
        e.status === 'abgeschlossen' ? 'abgeschlossen' : 'geplant',
        (v) => { store.patch('events', e.id, { status: v }); toast(t('events.statusUpdated')); },
      ),
    ]),
  ]));
  view.appendChild(el('button', {
    class: 'btn btn--danger btn--block mt-4',
    onclick: async () => {
      if (await confirmDialog({ title: t('events.deleteRaceQ'), message: t('events.deleteRaceText'), confirmLabel: t('events.delete'), danger: true })) {
        const p = store.get('plans').find((pl) => pl.eventId === e.id);
        if (p) store.remove('plans', p.id);
        store.remove('events', e.id);
        toast(t('events.raceDeleted'), 'good');
        navigate('#/events');
      }
    },
  }, [icon('trash'), t('events.deleteRace')]));
}

/* --------------------------- Programme detail --------------------------- */
function renderProgramDetail(view, e) {
  const meta = programMeta(e.programType);
  setHeader({
    title: e.name, subtitle: meta.label, back: '#/events',
    actions: [
      { icon: 'edit', label: t('events.edit'), onClick: () => openProgramForm(e) },
      { icon: 'download', label: t('events.export'), onClick: () => openIcsSheet({ event: e }) },
    ],
  });

  const plan = store.get('plans').find((p) => p.eventId === e.id);
  const units = plan ? (plan.units || []) : [];
  const done = units.filter((u) => u.status === 'erledigt').length;
  const today = todayStr();

  view.appendChild(el('div', { class: 'hero' }, [
    el('div', { class: 'hero__eyebrow', text: t('events.programme') }),
    el('div', { class: 'hero__title', text: `${meta.emoji} ${e.name}` }),
    el('div', { style: { opacity: '0.9', fontSize: '0.86rem', marginTop: '0.3rem' }, text: meta.focus }),
  ]));

  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    miniStat(`${e.daysPerWeek || meta.defaultDays}×`, t('events.perWeek')),
    miniStat(`${e.weeks || (plan ? plan.weeks : '–')}`, t('events.weeks')),
    miniStat(`${done}`, t('events.done')),
  ]));

  view.appendChild(el('div', { class: 'card card--flat mt-4', text: meta.desc }));

  view.appendChild(sectionHead(t('events.weeklyPlan')));
  if (plan) {
    const adh = adherence([plan], { today, isProtectedDay }).pct;
    view.appendChild(el('a', { class: 'card card--link', href: `#/plan/${e.id}` }, [
      el('div', { class: 'row row--between' }, [
        el('div', {}, [
          el('div', { class: 'card__title', text: plan.name }),
          el('div', { class: 'muted', style: { fontSize: '0.84rem' }, text: `${tp('events.weeksCount', plan.weeks)} · ${tp('events.sessionsCount', units.length)}` }),
        ]),
        el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
      ]),
      el('div', { class: 'row gap-2 mt-2 wrap' }, [
        el('span', { class: 'chip chip--good', text: t('events.doneChip', { n: done }) }),
        adh != null ? el('span', { class: 'chip chip--accent', text: t('events.attendanceChip', { pct: adh }) }) : null,
      ]),
    ]));
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-3', onclick: async () => {
      const ok = await confirmDialog({
        title: t('events.recalcQ'),
        message: t('events.recalcText'),
        confirmLabel: t('events.recalc'),
      });
      if (ok) doCreateProgramPlan(e);
    } }, [icon('refresh'), t('events.recalcFromToday')]));
  } else {
    view.appendChild(el('div', { class: 'card' }, [
      el('p', { class: 'muted mb-4', text: t('events.noWeeklyPlan') }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => doCreateProgramPlan(e) }, [icon('sparkles'), t('events.createPlan')]),
    ]));
  }

  view.appendChild(sectionHead(t('events.manage')));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { padding: '4px 0' } }, [
      el('span', { text: t('events.status') }),
      segmented(
        [{ value: 'aktiv', label: t('events.active') }, { value: 'abgeschlossen', label: t('events.completed') }],
        e.status === 'abgeschlossen' ? 'abgeschlossen' : 'aktiv',
        (v) => { store.patch('events', e.id, { status: v }); toast(t('events.statusUpdated')); },
      ),
    ]),
  ]));
  view.appendChild(el('button', {
    class: 'btn btn--danger btn--block mt-4',
    onclick: async () => {
      if (await confirmDialog({ title: t('events.deleteProgrammeQ'), message: t('events.deleteProgrammeText'), confirmLabel: t('events.delete'), danger: true })) {
        const p = store.get('plans').find((pl) => pl.eventId === e.id);
        if (p) store.remove('plans', p.id);
        store.remove('events', e.id);
        toast(t('events.programmeDeleted'), 'good');
        navigate('#/events');
      }
    },
  }, [icon('trash'), t('events.deleteProgramme')]));
}

function doCreatePlan(e) {
  openPlanSetup(e);
}

/* ------------------------------- Form ----------------------------------- */
/** Meaning of the priorities – visible right in the form (UI-35). */
const PRIORITY_HINT = {
  get A() { return t('events.priorityHint.A'); },
  get B() { return t('events.priorityHint.B'); },
  get C() { return t('events.priorityHint.C'); },
};

function openEventForm(existing = null) {
  // Date deliberately empty (UI-35): "today" was almost never meant and was easily overlooked.
  const e = existing || { distanceType: 'HM', priority: 'A', status: 'geplant', date: '' };
  let distType = e.distanceType || 'HM';
  // Robustness: legacy/import data could carry the LABEL instead of the key
  // (e.g. the German label "Halbmarathon" instead of "HM") – otherwise saving crashes (DISTANCES[distType].km).
  // Map to a valid key (by label or by distance), otherwise "custom".
  if (!DISTANCES[distType]) {
    distType = Object.keys(DISTANCES).find((k) => DISTANCES[k].label === e.distanceType)
      || Object.keys(DISTANCES).find((k) => DISTANCES[k].km && Math.abs(DISTANCES[k].km - (e.distanceKm ?? -1)) < 0.5)
      || 'custom';
  }

  const nameI = input({ value: e.name || '', placeholder: t('events.namePlaceholder'), required: '' });
  const dateI = input({ type: 'date', value: e.date || '', required: '', min: existing ? '' : todayStr() });
  const locI = input({ value: e.location || '', placeholder: t('events.location') });
  // Default keyboard (no inputmode:'numeric') – otherwise iOS lacks the colon
  // and the target time "hh:mm:ss" cannot be entered. Dot and comma work too.
  const timeI = input({ value: e.targetTime || '', placeholder: t('events.timePlaceholder'), autocomplete: 'off' });
  const notesI = textarea({ value: e.notes || '', placeholder: t('events.notesPlaceholder') });
  const kmI = input({ type: 'number', step: '0.1', value: e.distanceKm || '', placeholder: 'km' });
  const kmField = field(t('events.distanceKm'), kmI);
  kmField.style.display = distType === 'custom' ? 'block' : 'none';

  const distSel = select(Object.entries(DISTANCES).map(([k, v]) => ({ value: k, label: v.beta ? t('events.betaLabel', { label: v.label }) : v.label })), distType, {
    onchange: (ev) => { distType = ev.target.value; kmField.style.display = distType === 'custom' ? 'block' : 'none'; },
  });

  let priority = e.priority || 'A';
  let status = e.status || 'geplant';
  const prioHint = el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '6px' }, text: PRIORITY_HINT[priority] || '' });
  const prioControl = segmented(
    [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }], priority,
    (v) => { priority = v; prioHint.textContent = PRIORITY_HINT[v] || ''; });

  const body = el('div', {}, [
    field(t('events.name'), nameI),
    el('div', { class: 'field__row' }, [field(t('events.date'), dateI), field(t('events.distance'), distSel)]),
    kmField,
    el('div', { class: 'field__row' }, [field(t('events.location'), locI), field(t('events.targetTime'), timeI)]),
    field(t('events.priority'), prioControl),
    prioHint,
    field(t('events.notes'), notesI),
  ]);

  openSheet({
    title: existing ? t('events.editRace') : t('events.newRace'),
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('events.save'),
        onclick: () => {
          // Error directly at the field (UI-35) instead of only as a toast.
          if (!nameI.value.trim()) { fieldError(nameI, t('events.nameMissing')); return; }
          if (!dateI.value) { fieldError(dateI, t('events.dateMissing')); return; }
          if (timeI.value.trim() && !parseTargetTime(timeI.value)) { fieldError(timeI, t('events.timeInvalid')); return; }
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
          // Target time or date change: the existing plan remembers the target time;
          // paces and sessions do not change silently – that is done by "Recalculate plan
          // from today" in the plan.
          const plan = existing ? store.get('plans').find((p) => p.eventId === rec.id && p.kind !== 'program') : null;
          const planAffected = plan && (rec.targetTime !== e.targetTime || rec.date !== e.date || rec.distanceKm !== e.distanceKm);
          if (plan && rec.targetTime !== e.targetTime) store.patch('plans', plan.id, { goalTime: rec.targetTime });
          closeSheet();
          toast(planAffected
            ? t('events.updatedRecalc', { action: t('events.recalcFromToday') })
            : (existing ? t('events.raceUpdated') : t('events.raceCreated')), 'good', planAffected ? 4200 : undefined);
          navigate(`#/event/${rec.id}`);
        },
      }),
    ],
  });
}

/* ---------------------- Choice: race or programme ----------------------- */
function openAddChooser() {
  openSheet({
    title: t('events.chooserTitle'),
    body: el('div', { class: 'col gap-3' }, [
      el('button', { class: 'card card--link', style: { textAlign: 'left', width: '100%' }, onclick: () => { closeSheet(); openEventForm(); } }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { style: { fontSize: '1.6rem' }, text: '🏁' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card__title', text: t('events.race') }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('events.chooserRace') }),
          ]),
        ]),
      ]),
      el('button', { class: 'card card--link', style: { textAlign: 'left', width: '100%' }, onclick: () => { closeSheet(); openProgramForm(); } }, [
        el('div', { class: 'row gap-3' }, [
          el('span', { style: { fontSize: '1.6rem' }, text: '💪' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'card__title', text: t('events.programme') }),
            el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: currentEligibility().noWeightGoals
              ? t('events.chooserProgramme')
              : t('events.chooserProgrammeWeight') }),
          ]),
        ]),
      ]),
    ]),
  });
}

/* ---------------------- Programme form ----------------------------------- */
function openProgramForm(existing = null) {
  const e = existing || { programType: 'fitness', status: 'aktiv' };
  let type = e.programType || 'fitness';
  let days = e.daysPerWeek || programMeta(type).defaultDays;
  let weeks = e.weeks || 8;

  // New name prefilled from the focus (UI-35) – as long as nobody changes it themselves.
  const nameI = input({ value: e.name || (existing ? '' : programMeta(type).label), placeholder: t('events.programmePlaceholder'), required: '' });
  let nameTouched = !!existing;
  nameI.addEventListener('input', () => { nameTouched = true; });
  const descLine = el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '.4rem' } });
  const setDesc = () => {
    descLine.textContent = programMeta(type).desc;
    if (!nameTouched) nameI.value = programMeta(type).label;
  };
  setDesc();

  // Children, pregnancy/breastfeeding, eating disorder: no weight-loss programme (eligibility.js).
  // An existing one stays editable so that it can be switched over.
  const noWeightGoals = currentEligibility().noWeightGoals;
  const typeSel = select(
    Object.entries(PROGRAM_TYPES)
      .filter(([k]) => !(noWeightGoals && k === 'weightloss' && type !== 'weightloss'))
      .map(([k, v]) => ({ value: k, label: `${v.emoji} ${v.label}` })),
    type, { onchange: (ev) => { type = ev.target.value; setDesc(); } },
  );

  const body = el('div', {}, [
    field(t('events.name'), nameI),
    field(t('events.focus'), typeSel),
    descLine,
    field(t('events.daysPerWeek'), segmented(
      [3, 4, 5].map((n) => ({ value: String(n), label: `${n}×` })), String(days), (v) => { days = parseInt(v, 10); })),
    field(t('events.duration'), segmented(
      [4, 8, 12].map((n) => ({ value: String(n), label: tp('events.weeksCount', n) })),
      String(weeks), (v) => { weeks = parseInt(v, 10); })),
  ]);

  openSheet({
    title: existing ? t('events.editProgramme') : t('events.newProgramme'),
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('events.saveAndCreate'),
        onclick: () => {
          if (!nameI.value.trim()) { fieldError(nameI, t('events.nameMissing')); return; }
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
  // Running programme (start lies in the past): recalculate from today, the past stays –
  // otherwise completed sessions and the "% attendance" statistic would be lost.
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
    toast(t('events.programmeUpdated'), 'good');
    navigate(`#/plan/${e.id}`);
    return;
  }
  if (old) store.remove('plans', old.id);
  const plan = createProgramPlan(e, today);
  store.upsert('plans', plan);
  toast(t('events.programmePlanCreated'), 'good');
  navigate(`#/plan/${e.id}`);
}

/* ------------------------------- Helpers -------------------------------- */
/** Status chip: the stored status (geplant/aktiv/abgeschlossen) in the active language. */
function statusChip(s) {
  if (s === 'geplant') return t('events.statusChip.planned');
  if (s === 'aktiv') return t('events.statusChip.active');
  if (s === 'abgeschlossen') return t('events.statusChip.completed');
  return s;
}
function miniStat(val, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', style: { fontSize: '1.1rem' }, text: val }), el('div', { class: 'stat__label', text: label })]);
}
/** Target time "h:mm:ss" or "mm:ss" (also separated by dot or comma) → "hh:mm:ss";
    unreadable → null. "75:30" becomes 01:15:30 (previously "00:75:30" resulted). */
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
