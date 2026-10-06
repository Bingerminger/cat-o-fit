/* =========================================================================
   cycle.js — cycle calendar (cycle-aware, considerate training planning).
   - The user marks period starts; from these the cycle length, current
     phase and the forecast of the next period are calculated.
   - Menstruation days are "protected": sessions can be moved/skipped there
     without harm (no adherence/momentum penalty).
   - Phase tips are deliberately neutral: the evidence on performance differences
     across the cycle is weak (McNulty et al. 2020) – how you feel is what counts.
   - Hormonal contraception (setting): no natural phases, only bleeding days.
   - Without a new entry for ~3 months there are no phases and no forecast any more.
   - Sensitive data stays local; the module can be switched off in the settings.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, todayStr, addDays, diffDays,
  fmtDate, fmtDateLong, sectionHead, toast, openSheet, closeSheet, field, input, confirmDialog, toggle,
  fmtWeekday, localizeUnits,
  rerenderView,
} from './ui.js';
import { setHeader } from './router.js';
import { onAccent, mix, luminance } from './contrast.js';
import { moduleOff } from './nutrition.js';
import { gentleVariant } from './rolling.js';
import { isOpen } from './planflow.js';
import { applyAdapt } from './adapt.js';
import { periodStarts, typicalCycleLength, longCycleCount, periodSignal, PERIOD_ANSWERS } from './cyclecalc.js';
import { periodFlag } from './redflags.js';

import { t, tp } from './i18n.js';

export const PHASE_META = {
  menstruation: { get label() { return t('cycle.phaseMenstruation'); }, color: '#ef5d6c', emoji: '🩸' },
  follikel:     { get label() { return t('cycle.phaseFollicular'); }, color: '#43c59e', emoji: '🌱' },
  ovulation:    { get label() { return t('cycle.phaseOvulation'); }, color: '#f5a623', emoji: '⭐' },
  luteal:       { get label() { return t('cycle.phaseLuteal'); }, color: '#7c5cff', emoji: '🌙' },
  // Under hormonal contraception: no natural phases, only "between the bleeds".
  neutral:      { get label() { return t('cycle.phaseNeutral'); }, color: '#9aa7b4', emoji: '○' },
};

/** Is the cycle module active? (default on; can be switched off in the settings) */
// The cycle is inactive while an admin manages a member – the data stays
// private (no phase influence on dashboard/badges). Normal in one's own view.
// Consistent with all modules: active unless explicitly deselected.
/** Origin of imported periods (otherwise entered by hand). */
const PERIOD_SOURCE = {
  get 'apple-health'() { return t('cycle.fromAppleHealth'); },
  get health() { return t('cycle.fromAppleHealth'); },
  get 'health-connect'() { return t('cycle.fromHealthConnect'); },
};

export function cycleEnabled() { return !store.isManaging() && store.settings().modules?.cycle !== false; }

/** Hormonal contraception (pill, hormonal coil, implant …): cycle phases are then
    not meaningful (IOC 2023) – the app shows only the bleeding days. */
export function hormonalContraception() { return store.settings().cycleHormonal === true; }

// Period starts; helper records in the same area (e.g. the answer to
// "Period overdue?", `_kind: 'check'`) do not count.
function entries() {
  return store.get('cycle').filter((c) => c && !c._kind && c.startDate).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Average cycle length from the intervals between period starts. Long cycles
    (up to 90 days) count – they used to be discarded and the app then silently
    calculated with 28 days. Only probably forgotten entries are left out. */
export function avgCycleLength() {
  return typicalCycleLength(periodStarts(store.get('cycle')), store.settings().cycleLength || 28);
}

/** Stored answer to "Period overdue?" (or null). */
export function cycleCheck() {
  return store.get('cycle').find((c) => c && c._kind === 'check') || null;
}

/** State around an overdue period (see cyclecalc.periodSignal) – or null. */
export function periodState(today = todayStr()) {
  if (!cycleEnabled()) return null;
  const starts = periodStarts(store.get('cycle'));
  // Under hormonal contraception a missed bleed is not a warning sign of
  // energy deficiency (IOC 2023) – like the answer "Hormonal contraception" to the question.
  const check = hormonalContraception() && starts.length
    ? { for: starts.at(-1), answer: 'verhuetung' } : cycleCheck();
  return periodSignal({
    starts, today, avgLen: avgCycleLength(), gate: store.settings().labsGate || {}, check,
  });
}

/** Save the answer to "Period overdue?" (private, in the cycle area). */
export function answerPeriodCheck(answer, today = todayStr()) {
  const s = periodState(today);
  if (!s) return;
  store.upsert('cycle', { id: 'cycle-check', _kind: 'check', for: s.lastStart, answer, at: nowIso() });
  if (answer === 'schwanger') {
    // Pregnancy/breastfeeding then also applies to nutrition and goals (no weight-loss goals).
    store.setSetting('labsGate', { ...(store.settings().labsGate || {}), pregnancy: true });
  }
}
export function avgPeriodLength() {
  const ps = entries().map((x) => x.periodLength).filter(Boolean);
  return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : (store.settings().periodLength || 5);
}
function lastStart() { const e = entries(); return e.length ? e.at(-1).startDate : null; }

/** Next forecast period start after `today` (injectable for tests).
    null if it would lie more than PREDICTION_MAX_AGE_DAYS after the last real entry –
    "Next period in X days" would then be a claim without basis. */
export function nextPredictedStart(today = todayStr()) {
  const last = lastStart();
  if (!last) return null;
  const cl = avgCycleLength();
  let s = last;
  while (s <= today) s = addDays(s, cl);
  return diffDays(last, s) > PREDICTION_MAX_AGE_DAYS ? null : s;
}

/** Relevant cycle start (real or forecast) <= date. */
function cycleStartFor(dateStr) {
  const e = entries();
  if (!e.length) return null;
  const cl = avgCycleLength();
  let best = null;
  for (const x of e) if (x.startDate <= dateStr) best = x.startDate;
  if (best) { while (addDays(best, cl) <= dateStr) best = addDays(best, cl); return best; }
  // Date before all entries -> forecast backwards.
  let s = e[0].startDate;
  while (s > dateStr) s = addDays(s, -cl);
  return s;
}

/** How long a forecast without a new real entry is still considered reliable (days). */
export const PREDICTION_MAX_AGE_DAYS = 92; // ~3 months

/**
 * Phase of a date. Forecast days exist only up to PREDICTION_MAX_AGE_DAYS
 * after the last real entry – after that neither phase nor protection (before, the
 * cycle page still showed phases months later but no longer protected). Under
 * hormonal contraception all days except the bleeding days are `neutral`.
 * @returns {{phase,cycleDay,cycleLength,periodLength,predicted}|null}
 */
export function cyclePhase(dateStr) {
  if (!cycleEnabled()) return null;
  const start = cycleStartFor(dateStr);
  if (!start) return null;
  const cl = avgCycleLength(), pl = avgPeriodLength();
  const day = diffDays(start, dateStr);
  if (day < 0 || day >= cl + 3) return null;
  const isReal = entries().some((x) => x.startDate === start);
  const last = lastStart();
  if (!isReal && last && diffDays(last, dateStr) > PREDICTION_MAX_AGE_DAYS) return null;
  let phase;
  if (day < pl) phase = 'menstruation';
  else if (hormonalContraception()) phase = 'neutral';
  else if (day >= cl - 15 && day <= cl - 13) phase = 'ovulation';
  else if (day < cl - 14) phase = 'follikel';
  else phase = 'luteal';
  return { phase, cycleDay: day + 1, cycleLength: cl, periodLength: pl, predicted: !isReal, start };
}

/**
 * Protected day = menstruation day.
 *
 * Real (self-entered) periods always protect. A pure FORECAST counts
 * only as long as the last real entry is at most ~3 months back: after that
 * it is no longer reliable (cycle length changes, entries are missing), and
 * protected days would silently flatter plan adherence.
 */
export function isProtectedDay(dateStr) {
  const p = cyclePhase(dateStr);
  if (!p || p.phase !== 'menstruation') return false;
  if (!p.predicted) return true;              // real entry -> always protected
  const last = lastStart();
  if (!last) return false;
  return diffDays(last, dateStr) <= PREDICTION_MAX_AGE_DAYS;
}

/* ------------------------------ Input --------------------------------- */
function addPeriodStart(dateStr, periodLength) {
  store.upsert('cycle', { id: uid('cyc'), startDate: dateStr, periodLength: periodLength || avgPeriodLength(), createdAt: nowIso() });
}

/* ---------------- Easing on period day 1 – on request only (#3) --------------- */
// Previously every open session on day 1 was eased AUTOMATICALLY – even for
// athletes without symptoms. Now the app asks how they feel and only adjusts
// if the user chooses "take it easier today" (TRAIN-30).
// These types stay untouched: already easy/rest – or a race. Fixed
// appointments (football/games) are excluded separately via `!u.fixed`.
const CYCLE_SKIP_TYPES = ['rest', 'recovery', 'mobility', 'walk', 'race'];

/**
 * Sessions on period day 1 that qualify for the automatic easing:
 * open (planned), not a fixed appointment, not already easy/rest/race. Pure
 * function (testable) over the sessions of ONE plan.
 */
export function cycleSoftenTargets(units = [], startDate) {
  return (units || []).filter((u) => u && u.date === startDate && !u.fixed
    && isOpen(u)
    && !CYCLE_SKIP_TYPES.includes(u.type));
}

/** Cycle easing of a session (patch fields) – easier day with a marker. */
export function cycleEaseVariant(unit) {
  return {
    ...gentleVariant(unit, {
      title: t('cycle.easeTitle'),
      description: t('cycle.easeDescription'),
    }),
    cycleEased: true,
  };
}

/** Open, easeable sessions on day `startDate` across all plans. */
function easeTargets(startDate) {
  return store.get('plans').flatMap((plan) => cycleSoftenTargets(plan.units || [], startDate));
}

/**
 * Eases the training on day 1 – only after an explicit choice ("Take it easier"),
 * across plans, logged per plan and undoable via the snapshot (#3).
 * @returns {number} Number of sessions eased.
 */
function applyCycleEasing(startDate) {
  if (!cycleEnabled()) return 0;
  let n = 0;
  store.get('plans').forEach((plan) => {
    const targets = cycleSoftenTargets(plan.units || [], startDate);
    if (!targets.length) return;
    applyAdapt(plan.id, targets.map((u) => u.id), (u) => cycleEaseVariant(u), {
      kind: 'cycle', title: t('cycle.easeLogTitle'),
      reason: t('cycle.easeReason', { date: fmtDate(startDate) }),
    });
    n += targets.length;
  });
  return n;
}

/* ------------------------------- View -------------------------------- */
export function render(view) {
  setHeader({ title: t('nav.cycle') });

  // Privacy: cycle data is visible exclusively to the person themselves.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: t('cycle.privateTitle') }),
      el('div', { class: 'muted', style: { maxWidth: '320px', margin: '0 auto' }, text: who ? t('cycle.privateFor', { name: who.name }) : t('cycle.privateForMember') }),
    ]));
    return;
  }

  // Module deselected (Settings → Modules): shown as deactivated, like all modules.
  if (!cycleEnabled()) {
    view.appendChild(moduleOff(t('cycle.moduleName')));
    return;
  }

  const today = todayStr();
  const hasData = entries().length > 0;
  const phase = cyclePhase(today);
  const last = lastStart();
  const hormonal = hormonalContraception();
  // Without a new entry for ~3 months there is no forecast any more (phases, next
  // period, protection) – only the question of what applies.
  const stale = !!(last && diffDays(last, today) > PREDICTION_MAX_AGE_DAYS);

  // Overdue period: ask first, then (on "missed" or more than 90 days
  // without an answer) point to medical clarification – no false alarm for pregnancy,
  // hormonal contraception or merely missing entries.
  const ps = periodState(today);
  if (ps && ps.flag) view.appendChild(periodFlagCard(periodFlag(ps)));
  if (ps && ps.state === 'ask') view.appendChild(periodQuestionCard(ps));
  if (ps && ps.state === 'contraception' && !hormonal) view.appendChild(noteCard(t('cycle.noteContraception')));
  if (ps && ps.state === 'untracked') view.appendChild(noteCard(t('cycle.noteUntracked')));
  if (!hormonal && longCycleCount(periodStarts(store.get('cycle'))) >= 2) {
    view.appendChild(noteCard(t('cycle.noteLongCycles')));
  }

  // Current phase
  if (phase) {
    const pm = PHASE_META[phase.phase];
    // Text colour matching the PHASE colour (not the accent) and the gradient away from it (UI-12).
    const ink = onAccent(pm.color);
    const end = luminance(ink) < 0.5 ? mix(pm.color, '#ffffff', 0.22) : mix(pm.color, '#000000', 0.22);
    view.appendChild(el('div', { class: 'hero', style: { background: `linear-gradient(140deg, ${pm.color}, ${end})`, color: ink } }, [
      el('div', { class: 'hero__eyebrow', text: `${t('cycle.dayAverage', { day: phase.cycleDay, length: phase.cycleLength })}${phase.predicted ? ` · ${t('cycle.forecast')}` : ''}` }),
      el('div', { class: 'hero__title', text: `${pm.emoji} ${pm.label}` }),
      el('div', { style: { opacity: '.92', fontSize: '.9rem', position: 'relative' }, text: phaseTip(phase.phase) }),
    ]));
  } else if (hasData && stale) {
    view.appendChild(el('div', { class: 'card', style: { borderLeft: '4px solid var(--warn)' } }, [
      el('div', { style: { fontWeight: '700' }, text: t('cycle.stalePaused') }),
      el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: t('cycle.staleText', { days: diffDays(last, today) }) }),
    ]));
  } else if (!hasData) {
    view.appendChild(el('div', { class: 'card card--flat', text: hormonal
      ? t('cycle.noBleedYet')
      : t('cycle.noPeriodYet') }));
  }
  const np = nextPredictedStart();
  if (np) {
    const inDays = diffDays(today, np);
    view.appendChild(el('div', { class: 'card mt-4 row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.6rem' }, text: '🩸' }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: inDays > 0 ? (hormonal ? tp('cycle.nextBleedIn', inDays) : tp('cycle.nextPeriodIn', inDays)) : (hormonal ? t('cycle.nextBleedToday') : t('cycle.nextPeriodToday')) }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('cycle.expectedOn', { date: fmtDate(np) }) }),
      ]),
    ]));
  }

  // Input
  view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openPeriodSheet(), }, [icon('plus'), t('cycle.logPeriodStart')]));

  // Phase preview of the next 28 days
  if (hasData) {
    view.appendChild(sectionHead(t('cycle.next4Weeks')));
    // With day number, weekday row and description per day – previously 28 colour boxes that
    // encoded the phase only by colour (UI-37, WCAG 1.4.1). Forecast days dashed.
    const head = el('div', { class: 'cycle-strip cycle-strip__head', 'aria-hidden': 'true' });
    for (let i = 0; i < 7; i++) head.appendChild(el('span', { text: fmtWeekday(addDays(today, i)) }));
    view.appendChild(head);
    const strip = el('div', { class: 'cycle-strip', role: 'list', 'aria-label': t('cycle.stripLabel') });
    for (let i = 0; i < 28; i++) {
      const d = addDays(today, i);
      const p = cyclePhase(d);
      const meta = p ? PHASE_META[p.phase] : null;
      const desc = `${fmtDate(d)}${i === 0 ? ` (${t('common.today')})` : ''}: ${meta ? meta.label : t('cycle.noInfo')}${p && p.predicted ? `, ${t('cycle.forecast')}` : ''}`;
      strip.appendChild(el('span', {
        class: `cycle-strip__day ${i === 0 ? 'is-today' : ''} ${p && p.predicted ? 'is-predicted' : ''}`,
        role: 'listitem', 'aria-label': desc, title: desc,
        style: meta ? { background: meta.color, color: onAccent(meta.color) } : { background: 'var(--surface-3)', color: 'var(--text-2)' },
        text: String(Number(d.slice(8, 10))),
      }));
    }
    view.appendChild(strip);
    view.appendChild(legend());
  }

  // Entries
  if (hasData) {
    view.appendChild(sectionHead(t('cycle.loggedPeriods')));
    const list = el('div', { class: 'list-card' });
    entries().slice().reverse().forEach((e) => list.appendChild(el('div', { class: 'list-item' }, [
      el('span', { style: { fontSize: '1.1rem' }, text: '🩸' }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: fmtDate(e.startDate) }),
        el('div', { class: 'list-item__sub', text: `${tp('cycle.periodDays', e.periodLength || avgPeriodLength())}${PERIOD_SOURCE[e.source] ? ' · ' + PERIOD_SOURCE[e.source] : ''}` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': t('cycle.delete'), onclick: async () => { if (await confirmDialog({ title: t('cycle.deleteEntryTitle'), confirmLabel: t('cycle.delete'), danger: true })) { store.remove('cycle', e.id); rerender(); } } }, icon('trash')),
    ])));
    view.appendChild(list);
  }

  // Hormonal contraception: hides the phases, keeps the bleeding days (HEALTH-32).
  view.appendChild(sectionHead(t('cycle.contraceptionHeading')));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center', gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.92rem' }, text: t('cycle.hormonalContraception') }),
        el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '2px' }, text: t('cycle.hormonalHint') }),
      ]),
      toggle(hormonal, (on) => { store.setSetting('cycleHormonal', !!on); rerender(); }, t('cycle.hormonalContraception')),
    ]),
  ]));

  // Info
  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('cycle.infoText') }),
  ]));
}

/** Doctor's note for a missed period (same text in Cycle, Labs and "Today"). */
export function periodFlagCard(f) {
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--bad)' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--bad-text)', width: '18px', flex: '0 0 auto', marginTop: '2px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: f.text }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: f.advice }),
      ]),
    ]),
  ]);
}

function noteCard(text) {
  return el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text }),
  ]);
}

/** "Period overdue?" – asks instead of presuming an energy deficiency. */
function periodQuestionCard(ps) {
  const pick = (key) => {
    answerPeriodCheck(key);
    toast(key === 'schwanger' ? t('cycle.savedPaused') : t('cycle.saved'), 'good');
    rerender();
  };
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--warn)' } }, [
    el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: t('cycle.overdueTitle') }),
    el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: t('cycle.overdueText', { days: ps.days }) }),
    el('div', { class: 'col gap-2 mt-2' }, PERIOD_ANSWERS.map((a) => el('button', {
      class: 'btn btn--ghost btn--block', style: { justifyContent: 'flex-start', fontSize: '.84rem' }, onclick: () => pick(a.key),
    }, a.label))),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('cycle.answerPrivate') }),
  ]);
}

/** Neutral, feeling-oriented tips per phase – no performance promises: the
    meta-analysis by McNulty et al. (2020) finds at most a trivial performance
    reduction early in the follicular phase over the cycle and considers general
    phase-based recommendations not derivable. */
export function phaseTip(phase) {
  return {
    menstruation: t('cycle.tipMenstruation'),
    follikel: t('cycle.tipFollicular'),
    ovulation: t('cycle.tipOvulation'),
    luteal: t('cycle.tipLuteal'),
    neutral: t('cycle.tipNeutral'),
  }[phase] || '';
}

function legend() {
  const keys = hormonalContraception() ? ['menstruation', 'neutral'] : ['menstruation', 'follikel', 'ovulation', 'luteal'];
  return el('div', { class: 'row wrap gap-3 mt-3', style: { justifyContent: 'center' } }, [
    ...keys.map((k) => PHASE_META[k]).map((m) => el('span', { class: 'zones-legend__item' }, [
      el('span', { class: 'zones-legend__sw', style: { background: m.color } }), m.label,
    ])),
    el('span', { class: 'zones-legend__item dim', text: t('cycle.legendForecast') }),
  ]);
}

/**
 * After logging a period start: short how-are-you-feeling question instead of
 * easing the training automatically. Only for today or tomorrow and only if there is
 * an easeable session.
 */
async function askAboutFirstDay(startDate) {
  const today = todayStr();
  if (startDate < today || diffDays(today, startDate) > 1) return 0;
  const targets = easeTargets(startDate);
  if (!targets.length) return 0;
  const names = [...new Set(targets.map((u) => t('cycle.quotedTitle', { title: localizeUnits(u.title) })))].join(', ');
  const ease = await confirmDialog({
    title: t('cycle.askTitle'),
    message: startDate === today ? t('cycle.easeToday', { names }) : t('cycle.easeTomorrow', { names }),
    confirmLabel: t('cycle.easeConfirm'),
    cancelLabel: t('cycle.easeDecline'),
  });
  return ease ? applyCycleEasing(startDate) : 0;
}

export function openPeriodSheet() {
  const dateI = input({ type: 'date', value: todayStr() });
  const lenI = input({ type: 'number', inputmode: 'numeric', value: avgPeriodLength(), min: '1', max: '10' });
  openSheet({
    title: t('cycle.logPeriodStart'),
    body: el('div', {}, [
      field(t('cycle.sheetFirstDay'), dateI),
      field(t('cycle.sheetLength'), lenI),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: t('cycle.save'), onclick: async () => {
        const start = dateI.value;
        addPeriodStart(start, parseInt(lenI.value) || 5);
        closeSheet();
        rerender();
        // Training on day 1 easier only on request (#3/TRAIN-30) – logged & undoable.
        const eased = await askAboutFirstDay(start);
        toast(eased ? t('cycle.savedEased', { n: eased }) : t('cycle.saved'), 'good', eased ? 3600 : undefined);
        if (eased) rerender();
      } }),
    ],
  });
}

// Redraw via the router (scroll position stays, even if the form was opened from
// another view); without the app shell (tests) directly.
function rerender() { rerenderView(render); }
