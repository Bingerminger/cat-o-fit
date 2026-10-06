/* =========================================================================
   plans.js — training plan per event: setting up, updating and view.

   The generator itself (periodisation, weekly volume, sessions) lives purely and
   testably in plangen.js. Here the store, training history and paces are added:
   target paces from the target time (or from the current form), level and run days from the
   setup, fixed appointments only on explicit request. Recalculation always happens
   only from today – the past stays as it is.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, typeMeta, typeIcon, fmtKm, fmtPace,
  fmtPaceRange, fmtDate, fmtDayMonth, addDays, diffDays, todayStr, parseHms, fmtNum, fmtInt,
  sectionHead, emptyState, toast, confirmDialog, openSheet, closeSheet,
  effectiveStatus, STATUS_META, input, field, segmented,
  goOrRefresh, actionSheet, localizeUnits, fmtKmAuto,
} from './ui.js';
import { kmToShown, distanceUnit } from './units.js';
import { setHeader } from './router.js';
import { openIcsSheet } from './ics-export.js';
import { onAccent } from './contrast.js';
import { openUnitCreator } from './session.js';
import { MISSED_REASON_LABEL } from './unit-actions.js';
import { mergeFromDate, clampWeek, weekOfDate } from './planflow.js';
import { buildProgramUnits } from './program.js';
import { commitmentsSummary, mkCommit, dowLabel, FOOTBALL_INTENSITY } from './commitments.js';
import { weekTriage } from './triage.js';
import { estimateVdot, planPaces } from './vdot.js';
import {
  PLAN_GEN, PLAN_LEVELS, RUN_DAYS, weekTemplateFor, planCommitments, generatePlanUnits, buildWeekUnits,
  trainingHistory, suggestLevel, levelOf, planWindow, planReadiness, makePhases, coveredFixed, clampDays,
  phaseForWeek,
} from './plangen.js';

import { t, tp } from './i18n.js';

// Public generator interface remains reachable via plans.js.
export {
  PLAN_GEN, PLAN_LEVELS, DEFAULT_WEEK_TEMPLATE, RUN_TEMPLATES, TRIATHLON_TEMPLATE, HYROX_TEMPLATE,
  STRENGTH_FOCUS, makePhases, longRunPeak, supportRunKm, pyramidSegments, alternatingSegments,
  distanceEmphasis, buildWeekUnits, generatePlanUnits, planCommitments, planReadiness,
  weekVolumes, volumeConfig, trainingHistory, suggestLevel,
} from './plangen.js';

/* ===================== Creating & updating ===================== */

export function ensureGenerated() {
  const plans = store.get('plans');
  plans.forEach((plan) => {
    if (plan.generated) return;
    const event = store.find('events', plan.eventId);
    if (!event) return;
    const units = generatePlanUnits(plan, event, store.profile(), { coveredFixed: coveredFixed(plans, plan.id) });
    store.patch('plans', plan.id, { units, generated: true });
  });
}

/** Paces for a race plan: target time and form (hard runs only). For triathlon
    and Hyrox the target time is not a pure running performance – there only the form counts. */
export function planPacesFor(event, { sessions = store.get('sessions'), today = todayStr(), profile = store.profile() } = {}) {
  const est = estimateVdot(sessions, today, 42, { hrZones: profile.hrZones });
  const formVdot = est && !est.onlyEasy ? est.vdot : null;
  const isRun = (event.sport || 'run') === 'run';
  return planPaces({ distanceKm: event.distanceKm, targetSec: isRun ? (parseHms(event.targetTime) || null) : null, formVdot });
}

function paceInfoOf(pp) {
  return pp ? { goalVdot: pp.goalVdot, formVdot: pp.formVdot, trainingVdot: pp.trainingVdot, ambitious: pp.ambitious } : null;
}

/** Planned running km of the previous week (for the update when no runs are logged). */
function plannedLastWeekKm(units = [], today) {
  const ws = addDays(today, -7);
  let km = 0;
  units.forEach((u) => {
    if (!u || u.date < ws || u.date >= today || u.status === 'verpasst') return;
    if (typeMeta(u.type).cat === 'run' && u.type !== 'race') km += Number(u.targetDistanceKm) || 0;
  });
  return km ? Math.round(km * 2) / 2 : null;
}

/** Creates a plan for an event and generates the sessions. For a race today
    or in the past no (empty) plan is created – returns null.
    `options`: { level, daysPerWeek, commitments, today } */
export function createPlanForEvent(event, options = {}) {
  const today = options.today || todayStr();
  if (!event || !event.date || event.date <= today) return null;
  const sessions = store.get('sessions');
  const profile = store.profile();
  const hist = trainingHistory(sessions, today);
  const sport = event.sport || 'run';
  const level = PLAN_LEVELS[options.level] ? options.level : suggestLevel(hist);
  const daysPerWeek = sport === 'run' ? clampDays(options.daysPerWeek || 4) : null;
  const { start, weeks } = planWindow(event.date, today);
  const pp = planPacesFor(event, { sessions, today, profile });
  const plan = {
    id: uid('plan'), eventId: event.id, name: t('plans.planName', { name: event.name }),
    goalTime: event.targetTime, startDate: start, endDate: event.date, weeks,
    level, daysPerWeek, baseLongKm: hist.longKm, baseWeekKm: hist.weekKm,
    paces: pp ? pp.zones : null, paceInfo: paceInfoOf(pp),
    phases: makePhases(weeks), weekTemplate: weekTemplateFor(sport, daysPerWeek),
    // No default appointments: fixed appointments only if they are chosen on creation.
    commitments: Array.isArray(options.commitments) ? options.commitments : [],
    sport, gen: PLAN_GEN,
    units: [], generated: false, createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.upsert('plans', plan);
  const units = generatePlanUnits(plan, event, profile, { coveredFixed: coveredFixed(store.get('plans'), plan.id) });
  store.patch('plans', plan.id, { units, generated: true });
  return store.find('plans', plan.id);
}

/**
 * Recalculates an existing plan from today with the current plan logic
 * (race session, paces, volume by level and run days). Everything before today stays
 * unchanged. The volume starts from the current state (history of the last four
 * weeks, otherwise the most recently planned weekly volume).
 * `options`: { level, daysPerWeek, commitments, today }
 */
export function updatePlanFromToday(plan, event, options = {}) {
  const today = options.today || todayStr();
  const sessions = store.get('sessions');
  const profile = store.profile();
  const hist = trainingHistory(sessions, today);
  const sport = event.sport || plan.sport || 'run';
  const incomplete = !Array.isArray(plan.phases) || !plan.phases.length || !plan.weeks || !plan.startDate;
  const startDate = plan.startDate || planWindow(event.date, today).start;
  let { weeks, phases } = plan;
  if (incomplete || plan.endDate !== event.date) {
    weeks = Math.max(1, Math.ceil((diffDays(startDate, event.date) + 1) / 7));
    phases = makePhases(weeks);
  }
  const level = PLAN_LEVELS[options.level] ? options.level : levelOf(plan);
  const daysPerWeek = sport === 'run' ? clampDays(options.daysPerWeek || plan.daysPerWeek || 4) : null;
  const pp = planPacesFor(event, { sessions, today, profile });
  const running = startDate <= today;
  const currentWeek = Math.max(1, Math.min(weeks, Math.floor(diffDays(startDate, today) / 7) + 1));
  const next = {
    ...plan, startDate, endDate: event.date, weeks, phases, level, daysPerWeek, sport,
    weekTemplate: weekTemplateFor(sport, daysPerWeek),
    commitments: Array.isArray(options.commitments) ? options.commitments : planCommitments(plan),
    baseWeekKm: hist.weekKm ?? (running ? plannedLastWeekKm(plan.units, today) : null) ?? plan.baseWeekKm ?? null,
    baseLongKm: hist.longKm ?? plan.baseLongKm ?? null,
    anchorWeek: running ? currentWeek : 1,
    paces: pp ? pp.zones : (plan.paces || null),
    paceInfo: pp ? paceInfoOf(pp) : (plan.paceInfo || null),
    goalTime: event.targetTime, gen: PLAN_GEN,
  };
  const fresh = generatePlanUnits(next, event, profile, { coveredFixed: coveredFixed(store.get('plans'), plan.id) });
  const units = mergeFromDate(plan.units || [], fresh, today);
  const { id, units: _old, ...fields } = next;
  store.patch('plans', plan.id, { ...fields, units, generated: true });
  return store.find('plans', plan.id);
}

/* ===================== Setup (sheet) ===================== */

function noteBox(text, tone = 'info') {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--accent)';
  return el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start', borderLeft: `3px solid ${color}` } }, [
    el('span', { html: iconSvg('info'), style: { color, width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text }),
  ]);
}

/** Describes the paces of a plan in one sentence. */
export function paceText(info, zones, targetTime) {
  if (!zones || !zones.easy) return t('plans.paceNone');
  const race = zones.race && zones.race.min ? t('plans.paceRace', { pace: fmtPaceRange(zones.race.min, zones.race.max) }) : '';
  const base = t('plans.paceBase', { easy: fmtPaceRange(zones.easy.min, zones.easy.max), threshold: fmtPaceRange(zones.threshold.min, zones.threshold.max), race });
  if (info && info.ambitious) {
    return t('plans.paceAmbitious', { time: targetTime, goal: fmtNum(info.goalVdot), form: fmtNum(info.formVdot), base });
  }
  if (info && info.goalVdot && info.formVdot) return t('plans.paceFromGoalAndForm', { vdot: fmtNum(info.trainingVdot), base });
  if (info && info.goalVdot) return t('plans.paceFromGoal', { time: targetTime, vdot: fmtNum(info.goalVdot), base });
  if (info && info.formVdot) return t('plans.paceFromForm', { vdot: fmtNum(info.formVdot), base });
  return t('plans.paceFromZones', { base });
}

/**
 * Setup of a race plan (new) or "Recalculate plan from today" (with
 * `plan`): level, run days, fixed appointments, paces and an honest look at the
 * preparation time. Nothing is changed silently – only the button creates the plan.
 */
export function openPlanSetup(event, { plan = null } = {}) {
  const today = todayStr();
  const update = !!plan;
  const sessions = store.get('sessions');
  const hist = trainingHistory(sessions, today);
  const sport = event.sport || 'run';
  const readiness0 = planReadiness(event, { today, hist });
  if (readiness0.status === 'past' || readiness0.status === 'today') {
    openSheet({
      title: update ? t('plans.updatePlan') : t('plans.trainingPlan'),
      body: noteBox(readiness0.text, 'warn'),
      footer: [el('button', { class: 'btn btn--primary btn--block', text: t('plans.gotIt'), onclick: () => closeSheet() })],
    });
    return;
  }

  let level = update ? levelOf(plan) : suggestLevel(hist);
  let days = sport === 'run' ? clampDays((plan && plan.daysPerWeek) || 4) : null;
  const others = store.get('plans').filter((p) => p.id !== (plan && plan.id) && p.kind !== 'program'
    && (p.endDate || '') >= today && planCommitments(p).length);
  let commitChoice = 'none';

  const readinessBox = el('div', {});
  const refreshReadiness = () => {
    readinessBox.innerHTML = '';
    const r = planReadiness(event, { today, level, hist });
    if (r.status === 'short') readinessBox.appendChild(noteBox(r.text, 'warn'));
  };
  refreshReadiness();

  const levelHint = el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '-4px' }, text: PLAN_LEVELS[level].hint });
  const histText = hist.weekKm || hist.longKm
    ? t('plans.history', {
      week: hist.weekKm ? t('plans.historyWeekKm', { km: fmtKm(hist.weekKm) }) : t('plans.historyFewRuns'),
      longest: hist.longKm ? t('plans.historyLongest', { km: fmtKm(hist.longKm) }) : '',
    })
    : t('plans.historyNone');

  const pp = planPacesFor(event, { sessions, today });
  const body = el('div', {}, [
    el('p', { class: 'muted mb-2', style: { fontSize: '.86rem' }, text: update
      ? t('plans.updateIntro')
      : t('plans.setupIntro') }),
    readinessBox,
    field(t('plans.level'), segmented(Object.entries(PLAN_LEVELS).map(([k, v]) => ({ value: k, label: v.label })), level,
      (v) => { level = v; levelHint.textContent = PLAN_LEVELS[v].hint; refreshReadiness(); })),
    levelHint,
    el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: histText }),
    sport === 'run'
      ? field(t('plans.runDaysPerWeek'), segmented(RUN_DAYS.map((n) => ({ value: String(n), label: `${n}×` })), String(days), (v) => { days = parseInt(v, 10); }))
      : noteBox(sport === 'triathlon'
        ? t('plans.triathlonNote')
        : t('plans.hyroxNote')),
    sectionHead(t('plans.targetPaces')),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: paceText(paceInfoOf(pp), pp && pp.zones, event.targetTime) }),
  ]);

  if (!update) {
    const opts = [{ value: 'none', label: t('plans.none') }];
    if (others.length) opts.push({ value: 'copy', label: t('plans.commitCopy') });
    opts.push({ value: 'edit', label: t('plans.commitEnter') });
    const commitHint = el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '-4px' } });
    const setHint = () => {
      const summary = others.length ? commitmentsSummary(planCommitments(others[0])) : '';
      commitHint.textContent = commitChoice === 'copy'
        ? t('plans.commitCopyHint', { name: others[0].name, summary: summary.endsWith('.') ? summary : `${summary}.` })
        : commitChoice === 'edit' ? t('plans.commitEditHint') : t('plans.commitNoneHint');
    };
    setHint();
    body.appendChild(sectionHead(t('plans.fixedCommitments')));
    body.appendChild(el('div', { class: 'muted', style: { fontSize: '.84rem', marginBottom: '6px' }, text: t('plans.commitQuestion') }));
    body.appendChild(segmented(opts, commitChoice, (v) => { commitChoice = v; setHint(); }));
    body.appendChild(commitHint);
  } else {
    body.appendChild(sectionHead(t('plans.fixedCommitments')));
    body.appendChild(el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('plans.commitChangeHint', { summary: commitmentsSummary(planCommitments(plan)) }) }));
  }

  const footer = el('button', {
    class: 'btn btn--primary btn--block',
    onclick: () => {
      if (update) {
        updatePlanFromToday(plan, event, { level, daysPerWeek: days });
        closeSheet();
        toast(t('plans.updatedFromToday'), 'good');
        goOrRefresh(`#/plan/${event.id}`);
        return;
      }
      const commitments = commitChoice === 'copy' && others.length
        ? planCommitments(others[0]).map(({ id, ...c }) => mkCommit(c.type, c.dow, c))
        : [];
      const created = createPlanForEvent(event, { level, daysPerWeek: days, commitments });
      closeSheet();
      if (!created) { toast(t('plans.cannotCreate'), 'bad'); return; }
      toast(t('plans.created'), 'good');
      navigate(`#/plan/${event.id}`);
      if (commitChoice === 'edit') setTimeout(() => openCommitmentsEditor(store.find('plans', created.id), event), 350);
    },
  }, [icon(update ? 'refresh' : 'sparkles'), update ? t('plans.recalcFromToday') : t('plans.createPlan')]);

  openSheet({ title: update ? t('plans.recalcPlanFromToday') : t('plans.setupTitle'), body, footer });
}

/* ===================== Plan view ===================== */

export function render(view, eventId) {
  const event = store.find('events', eventId);
  const plan = store.get('plans').find((p) => p.eventId === eventId);
  const isProgram = (plan && plan.kind === 'program') || (event && event.kind === 'program');

  setHeader({
    title: isProgram ? t('plans.weekPlan') : t('plans.trainingPlan'),
    subtitle: event ? event.name : '',
    back: `#/event/${eventId}`,
    // Only "+" as an icon; rare actions with text in the "…" menu. Previously four icons:
    // the calendar icon led to "Fixed commitments", the circular arrow overwrote the plan,
    // and on the iPhone SE only "Trainin…" was left of the title (UI-34).
    actions: plan ? [
      { icon: 'plus', label: t('plans.addSession'), onClick: () => openUnitCreator(plan, todayStr()) },
      { icon: 'more', label: t('plans.moreActions'), onClick: () => actionSheet(t('plans.plan'), [
        (!isProgram && event) ? { icon: 'calendar', label: t('plans.fixedCommitments'), hint: t('plans.commitActionHint'), onClick: () => openCommitmentsEditor(plan, event) } : null,
        { icon: 'download', label: t('plans.toCalendar'), hint: t('plans.toCalendarHint'), onClick: () => openIcsSheet({ scope: 'event', id: eventId, event }) },
        { icon: 'refresh', label: t('plans.recalcPlanFromToday'), hint: t('plans.recalcHint'), onClick: () => regenerate(plan, event) },
      ]) },
    ] : [],
  });

  if (!plan) {
    view.appendChild(emptyState('calendar', t('plans.noPlan'), t('plans.noPlanText')));
    return;
  }

  // Robustness: incomplete plans (e.g. from an old backup or import)
  // have no phase structure. Offer regenerating instead of crashing.
  if (!Array.isArray(plan.phases) || !plan.phases.length || !plan.weeks) {
    view.appendChild(emptyState('calendar', t('plans.incomplete'),
      t('plans.incompleteText')));
    if (event) view.appendChild(el('button', {
      class: 'btn btn--primary btn--block mt-3', onclick: () => regenerate(plan, event),
    }, [icon('refresh'), t('plans.recalcPlan')]));
    return;
  }

  const units = (plan.units || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();
  const daysToRace = (event && !isProgram) ? diffDays(today, event.date) : null;
  const currentWeek = clampWeek(plan, today);

  // Phase timeline
  const timeline = el('div', { class: 'card' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: t('plans.weekOf', { week: currentWeek, weeks: plan.weeks }) }),
      daysToRace != null ? el('span', { class: 'chip chip--accent', text: daysToRace > 0 ? tp('plans.daysToGo', daysToRace) : t('plans.raceDay') }) : null,
    ]),
    phaseTimeline(plan, currentWeek),
  ]);
  view.appendChild(timeline);

  // Legacy plan: new plan logic as an offer – never silently.
  if (!isProgram && event && plan.gen !== PLAN_GEN && (plan.endDate || '') >= today) {
    view.appendChild(el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--accent)' } }, [
      el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: t('plans.newLogic') }),
      el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: t('plans.newLogicText') }),
      el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openPlanSetup(event, { plan }) }, [icon('refresh'), t('plans.recalcPlanFromToday')]),
    ]));
  }

  // Fixed appointments (football/games) – configurable, the plan fits around them.
  if (!isProgram && event) view.appendChild(commitmentsCard(plan, event));

  // Week check: collisions of the current week transparently prioritised (R3 triage)
  if (!isProgram) { const tc = triageCard(plan); if (tc) view.appendChild(tc); }

  // Key figures
  const done = units.filter((u) => u.status === 'erledigt').length;
  const planRun = units.filter((u) => typeMeta(u.type).cat === 'run');
  const totalKm = planRun.reduce((a, u) => a + (u.targetDistanceKm || 0), 0);
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    stat(fmtInt(Math.round(kmToShown(totalKm))), t('plans.statRunKm', { unit: distanceUnit() })),   // the label names the unit
    stat(`${units.length}`, t('plans.statSessions')),
    stat(`${done}`, t('plans.statDone')),
  ]));

  // Key facts of the plan: level, run days, paces
  if (!isProgram && event) {
    const lines = [];
    if (plan.gen === PLAN_GEN) {
      const lv = PLAN_LEVELS[levelOf(plan)].label;
      lines.push(t('plans.levelLine', {
        level: lv,
        days: plan.daysPerWeek ? t('plans.levelLineDays', { days: plan.daysPerWeek }) : '',
        base: plan.baseWeekKm ? t('plans.levelLineBase', { km: fmtKm(plan.baseWeekKm) }) : '',
      }));
      lines.push(paceText(plan.paceInfo, plan.paces, event.targetTime));
    } else if (plan.baseLongKm) {
      lines.push(t('plans.adaptedToForm', { km: fmtKmAuto(plan.baseLongKm) }));
    }
    if (lines.length) {
      view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg('activity'), style: { color: plan.paceInfo && plan.paceInfo.ambitious ? 'var(--warn)' : 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' } }, lines.map((line) => el('div', { text: line }))),
      ]));
    }
  }

  // Week accordion
  view.appendChild(sectionHead(t('plans.weekOverview')));
  const byWeek = new Map();
  units.forEach((u) => {
    // Derive the week from the (authoritative) date instead of from u.week: for generated
    // sessions clampWeek returns the same value, but manually created or
    // imported sessions often have no `week` field. Without this derivation
    // a "Wundefined" section (week prefix + "undefined") with a "NaN" date would otherwise appear (e.g. for a
    // manual session before the plan start). Side effect: rescheduled sessions
    // are correctly assigned to the week of their new date.
    const wk = weekOfDate(plan, u.date) ?? u.week ?? 1;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(u);
  });

  [...byWeek.keys()].sort((a, b) => a - b).forEach((w) => {
    const wUnits = byWeek.get(w);
    const phase = phaseForWeek(plan, w);
    const wkm = wUnits.filter((u) => typeMeta(u.type).cat === 'run').reduce((a, u) => a + (u.targetDistanceKm || 0), 0);
    const open = w === currentWeek;
    const weekEnd = addDays(plan.startDate, w * 7 - 1);

    const body = el('div', { class: 'cal-day__units', hidden: !open });
    wUnits.forEach((u) => body.appendChild(planUnitRow(u)));
    // Past weeks stay as they are – recalculating only for current/upcoming ones.
    if (event && !isProgram && weekEnd >= today) body.appendChild(el('button', {
      class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.8rem' },
      onclick: () => regenerateWeek(plan, event, w),
    }, [icon('refresh'), t('plans.recalcWeek')]));

    const head = el('button', {
      class: 'cal-day__head', style: { width: '100%' },
      onclick: () => { body.hidden = !body.hidden; },
    }, [
      el('span', { class: 'phase-pill', style: { background: phase.color, color: onAccent(phase.color) }, text: t('plans.weekShort', { week: w }) }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'cal-day__dow', text: phase.name }),
        el('div', { class: 'cal-day__date', text: `${fmtDayMonth(addDays(plan.startDate, (w - 1) * 7))} · ${fmtKm(wkm, 0)}` }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronDown') }),
    ]);
    view.appendChild(el('div', { class: 'cal-day', style: { marginBottom: '8px' } }, [head, body]));
  });

  // Create your own session – prominently at the end (in addition to the "+" in the header row).
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-4', onclick: () => openUnitCreator(plan, today) }, [icon('plus'), t('plans.addOwnSession')]));
}

/** Editor for fixed appointments: football training days + optional games. On
    saving, the plan is recalculated from today (it fits around the fixed appointments). */
export function openCommitmentsEditor(plan, event) {
  const current = planCommitments(plan).map((c) => ({ ...c }));
  const footballDays = new Set(current.filter((c) => c.type === 'cross_football').map((c) => c.dow));
  let footballDur = (current.find((c) => c.type === 'cross_football') || {}).durationMin || 90;
  let footballIntensity = (current.find((c) => c.type === 'cross_football') || {}).intensity || 'normal';
  const matchC = current.find((c) => c.type === 'match');
  let matchOn = !!matchC;
  const matchDow = matchC ? matchC.dow : 7;
  let matchFrom = matchC ? (matchC.fromDate || '') : '';
  let matchDur = matchC ? matchC.durationMin : 120;

  const dayRow = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  for (let d = 1; d <= 7; d++) {
    const chip = el('button', {
      class: `chip ${footballDays.has(d) ? 'chip--accent' : ''}`, type: 'button',
      style: { cursor: 'pointer', minWidth: '40px' }, text: dowLabel(d),
      onclick: () => {
        if (footballDays.has(d)) { footballDays.delete(d); chip.classList.remove('chip--accent'); }
        else { footballDays.add(d); chip.classList.add('chip--accent'); }
      },
    });
    dayRow.appendChild(chip);
  }
  const durI = input({ type: 'number', min: '15', step: '5', value: String(footballDur) });
  durI.addEventListener('input', () => { footballDur = parseInt(durI.value, 10) || 90; });
  const intensitySeg = segmented(
    FOOTBALL_INTENSITY.map((i) => ({ value: i.key, label: i.label })),
    footballIntensity,
    (v) => { footballIntensity = v; },
  );

  const matchFromI = input({ type: 'date', value: matchFrom });
  matchFromI.addEventListener('input', () => { matchFrom = matchFromI.value; });
  const matchDurI = input({ type: 'number', min: '30', step: '10', value: String(matchDur) });
  matchDurI.addEventListener('input', () => { matchDur = parseInt(matchDurI.value, 10) || 120; });
  const matchBox = el('div', { hidden: !matchOn }, [
    field(t('plans.matchesFrom'), matchFromI),
    field(t('plans.matchDuration'), matchDurI),
  ]);
  const matchToggle = segmented(
    [{ value: 'off', label: t('plans.none') }, { value: 'on', label: t('plans.sundays') }],
    matchOn ? 'on' : 'off',
    (v) => { matchOn = v === 'on'; matchBox.hidden = !matchOn; },
  );

  const body = el('div', {}, [
    el('div', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: t('plans.commitEditorIntro') }),
    sectionHead(t('commitments.footballTraining')),
    el('label', { class: 'field__label', text: t('plans.weekdays') }), dayRow,
    field(t('plans.durationMin'), durI),
    field(t('plans.intensity'), intensitySeg),
    el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '-4px' }, text: t('plans.footballIntensityHint') }),
    sectionHead(t('plans.footballMatches')),
    field(t('plans.planMatches'), matchToggle),
    matchBox,
  ]);

  const footer = el('button', { class: 'btn btn--primary btn--block', onclick: async () => {
    const commitments = [];
    [...footballDays].sort((a, b) => a - b).forEach((d) => commitments.push(mkCommit('cross_football', d, { durationMin: footballDur, intensity: footballIntensity })));
    if (matchOn) commitments.push(mkCommit('match', matchDow, { fromDate: matchFrom || null, durationMin: matchDur }));
    closeSheet();
    await saveCommitments(plan, event, commitments);
  } }, [icon('check'), t('plans.applyAndCalc')]);

  openSheet({ title: t('plans.fixedCommitments'), body, footer });
}

/** Week check (R3): collisions of the current week + transparent prioritisation. */
function triageCard(plan) {
  const tri = weekTriage(plan.units || [], todayStr());
  if (!tri.collisions.length) return null;
  const items = tri.collisions.slice(0, 4).map((c) => el('div', { style: { padding: '6px 0 4px', borderTop: '1px solid var(--border)' } }, [
    el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: c.text }),
    el('div', { class: 'muted', style: { fontSize: '.78rem', marginTop: '2px' } }, [
      el('span', { html: iconSvg('arrowRight'), style: { display: 'inline-block', width: '13px', color: 'var(--accent-text)', verticalAlign: '-2px' } }),
      ' ' + c.suggest,
    ]),
  ]));
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '2px' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#e8a13a', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: tp('plans.weekCheck', tri.collisions.length) }),
    ]),
    el('div', { class: 'muted', style: { fontSize: '.76rem', marginBottom: '2px' }, text: t('plans.triagePriority') }),
    ...items,
  ]);
}

/** Overview card of the fixed appointments with "Adjust". */
function commitmentsCard(plan, event) {
  const commitments = planCommitments(plan);
  return el('div', { class: 'card card--flat mt-2 row row--between', style: { alignItems: 'center', gap: '10px' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('calendar'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto', marginTop: '2px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.86rem' }, text: t('plans.fixedCommitments') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: commitmentsSummary(commitments) }),
      ]),
    ]),
    el('button', { class: 'btn btn--ghost', style: { fontSize: '.8rem', flex: '0 0 auto' }, onclick: () => openCommitmentsEditor(plan, event) }, [icon('edit'), commitments.length ? t('plans.adjust') : t('plans.commitEnter')]),
  ]);
}

/** Save fixed appointments and recalculate the plan from today. Past and
    completed sessions are retained. */
async function saveCommitments(plan, event, commitments) {
  updatePlanFromToday(store.find('plans', plan.id) || plan, event, { commitments });
  toast(t('plans.commitsSaved'), 'good');
  goOrRefresh(`#/plan/${event.id}`);
}

function planUnitRow(u) {
  const meta = [];
  const dur = u.targetDurationMin ?? u.dur ?? null;   // Programmes from older versions: `dur`
  if (u.targetDistanceKm) meta.push(fmtKmAuto(u.targetDistanceKm));
  if (dur && !u.targetDistanceKm) meta.push(`${dur} min`);
  if (u.targetPaceSecPerKm) meta.push(fmtPace(u.targetPaceSecPerKm));
  const eff = effectiveStatus(u);
  const missedTxt = (eff === 'verpasst' && u.missedReason && MISSED_REASON_LABEL[u.missedReason]) ? ` · ${MISSED_REASON_LABEL[u.missedReason]}` : '';
  const tag = ['ueberfaellig', 'verpasst', 'verschoben'].includes(eff)
    ? el('span', { class: `chip chip--${eff === 'verpasst' ? 'bad' : 'warn'}`, style: { fontSize: '0.62rem', marginLeft: '6px' }, text: STATUS_META[eff].label + missedTxt })
    : null;
  return el('a', {
    class: `cal-unit ${eff === 'erledigt' ? 'cal-unit--done' : ''} ${eff === 'verpasst' ? 'cal-unit--missed' : ''} ${eff === 'ueberfaellig' ? 'cal-unit--overdue' : ''}`,
    href: `#/session/${u.id}`,
  }, [
    typeIcon(u.type, 'type-icon--sm'),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title' }, [localizeUnits(u.title), tag]),
      el('div', { class: 'cal-unit__meta', text: `${fmtDate(u.date)}${meta.length ? ' · ' + meta.join(' · ') : ''}` }),
    ]),
    el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
  ]);
}

function phaseTimeline(plan, currentWeek) {
  const wrap = el('div', { class: 'row', style: { gap: '3px', marginTop: '4px' } });
  if (!Array.isArray(plan.phases)) return wrap;
  plan.phases.forEach((p) => {
    const span = p.endWeek - p.startWeek + 1;
    const active = currentWeek >= p.startWeek && currentWeek <= p.endWeek;
    wrap.appendChild(el('div', {
      style: { flex: String(span), textAlign: 'center' },
    }, [
      el('div', { style: { height: '8px', borderRadius: '4px', background: p.color, opacity: active ? '1' : '0.4' } }),
      el('div', { class: 'dim', style: { fontSize: '0.64rem', marginTop: '4px', fontWeight: active ? '700' : '500', color: active ? p.color : 'var(--text-3)' }, text: p.name }),
    ]));
  });
  return wrap;
}


function stat(val, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__val num', text: val }),
    el('div', { class: 'stat__label', text: label }),
  ]);
}

/** "Recalculate plan from today": race plans via the setup (with level and
    run days), programmes directly. In both cases everything before today stays unchanged. */
async function regenerate(plan, event) {
  if (plan.kind === 'program' || (event && event.kind === 'program')) {
    const ok = await confirmDialog({
      title: t('plans.regenProgramTitle'),
      message: t('plans.regenProgramText'),
      confirmLabel: t('plans.recalc'),
    });
    if (!ok) return;
    const fresh = buildProgramUnits(
      { programType: plan.programType || event.programType, weeks: plan.weeks, daysPerWeek: plan.daysPerWeek },
      plan.id, plan.startDate,
    );
    store.patch('plans', plan.id, { units: mergeFromDate(plan.units || [], fresh, todayStr()), generated: true });
    toast(t('plans.regenProgramDone'), 'good');
    goOrRefresh(`#/plan/${event.id}`);
    return;
  }
  if (!event) return;
  openPlanSetup(event, { plan });
}

/** Recalculate only a single week (#10) – e.g. after the season start in the middle of the plan.
    In the current week everything before today stays unchanged. */
async function regenerateWeek(plan, event, week) {
  const ws = addDays(plan.startDate, (week - 1) * 7);
  const we = addDays(ws, 6);
  const today = todayStr();
  const from = today > ws ? today : ws;
  const all = (store.find('plans', plan.id).units) || [];
  const inWeek = all.filter((u) => u.date >= ws && u.date <= we);
  const doneCount = inWeek.filter((u) => u.status === 'erledigt').length;
  const ok = await confirmDialog({
    title: t('plans.regenWeekTitle', { week }),
    message: [
      from > ws ? t('plans.regenWeekFreshFromToday') : t('plans.regenWeekFresh'),
      doneCount ? tp('plans.regenWeekKept', doneCount) : '',
      t('plans.regenWeekLost'),
    ].filter(Boolean).join(' '),
    confirmLabel: t('plans.recalc'), danger: true,
  });
  if (!ok) return;
  const fresh = buildWeekUnits(plan, event, store.profile(), week, { coveredFixed: coveredFixed(store.get('plans'), plan.id) });
  const others = all.filter((u) => u.date < ws || u.date > we);
  const units = [...others, ...mergeFromDate(inWeek, fresh, from)].sort((a, b) => a.date.localeCompare(b.date));
  store.patch('plans', plan.id, { units });
  toast(t('plans.regenWeekDone', { week }), 'good');
  goOrRefresh(`#/plan/${event.id}`);
}
