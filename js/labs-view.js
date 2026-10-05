/* =========================================================================
   labs-view.js — the "Labs & supplements" view.

   Structure from top to bottom, deliberately in this order:
     1. Red flags (if any) – everything else then steps back
     2. Energy supply (RED-S/LEA) – the most common real problem
     3. Lab values with classification and trend
     4. Supplement suggestions (full mode only, always "food first")
     5. Own intake plan with check-off

   All the domain logic lives in labs.js / supplements.js / redflags.js; this file
   only presents and records.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, todayStr, fmtDate, sectionHead, emptyState,
  toast, openSheet, closeSheet, field, input, select, confirmDialog, toggle,
  refreshView, infoButton,
  fmtDec,
  rerenderView,
} from './ui.js';
import { setHeader } from './router.js';
import { lineChart, barChart, sparkline, donut } from './charts.js';
import { moduleOff } from './nutrition.js';
import {
  ANALYTES, ANALYTE_GROUPS, groupLabel, unitsFor, unitFactor, toCanonical, fromCanonical, overview, series,
  refRange, hasOwnRef, latest, migrateLabRecord, implausible, LAB_SCHEMA, labRecordsFromReport,
} from './labs.js';
import { LAB_SOURCES, labSourcesTeaser } from './labsources.js';
import {
  recommend, activePlans, takenOn, adherence, adherenceSeries, SUPPLEMENTS, dopingNote, catalogFor, isDaily,
} from './supplements.js';
import {
  redFlags, energyAvailability, energyAvailabilitySeries, leanMassNow, EA_OPTIMAL, eaLowFor,
} from './redflags.js';
import { currentEligibility, currentEnergyTargets, openGateSheet } from './wellness.js';
import { cycleCheck, avgCycleLength } from './cycle.js';

import { t, tp } from './i18n.js';

const TONE_COLOR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--text-3)' };
/** The same tones as a readable text colour (≥ 4.5:1) – the fill colours are too light for text (UI-12). */
const TONE_TEXT = { good: 'var(--good-text)', warn: 'var(--warn-text)', bad: 'var(--bad-text)', neutral: 'var(--text-2)' };
/** Supplements that are usually only taken situationally – in the plan "as needed" by default. */
const AS_NEEDED = ['caffeine', 'beetroot', 'electrolytes'];

export function labsEnabled() {
  return !store.isManaging() && store.settings().modules?.labs !== false;
}

/* --------------------------------- View ---------------------------------- */

export function render(view) {
  setHeader({ title: t('nav.labs') });

  // Privacy: like cycle data, visible only to the person themselves.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: t('labsView.private') }),
      el('div', { class: 'muted', style: { maxWidth: '340px', margin: '0 auto' }, text: t('labsView.privateNote', { name: who ? who.name : t('labsView.thisMember') }) }),
    ]));
    return;
  }
  if (!labsEnabled()) { view.appendChild(moduleOff(t('nav.labs'))); return; }

  const today = todayStr();
  const profile = store.profile();
  const s = store.settings();
  const labs = store.get('labs');
  const supps = store.get('supplements');
  // One eligibility status for the whole app (gate + age from the birth year).
  const elig = currentEligibility(today);

  /* --- Initial setup: clarify eligibility ------------------------------- */
  if (!elig.answered) {
    view.appendChild(introCard());
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => openGateSheet({ onSaved: rerender }) }, [icon('check'), t('labsView.setUp')]));
    return;
  }

/* --- 1. Red flags ------------------------------------------------------ */
  const flags = redFlags({
    labs, cycle: store.get('cycle'), today,
    gate: s.labsGate || {}, cycleCheck: cycleCheck(), avgLen: avgCycleLength(),
  });
  flags.forEach((f) => view.appendChild(el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--bad)' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--bad-text)', width: '18px', flex: '0 0 auto', marginTop: '2px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: f.text }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: f.advice }),
      ]),
    ]),
  ])));

/* --- 2. Energy supply (RED-S) ------------------------------------------ */
  // Child and adolescent profile: no calorie calculation (the thresholds apply to adults).
  if (!elig.minor) {
    const health = store.get('health');
    const tg = currentEnergyTargets(today);
    const eaArgs = {
      profile, health, sessions: store.get('sessions'), diary: store.get('diary'), today,
      // When losing weight, 30–45 is temporarily acceptable – a separate hint instead of an alarm.
      lossGoal: !tg.block && !!tg.goalStatus && tg.goalStatus.status === 'abnehmen',
    };
    const ea = energyAvailability(eaArgs);
    if (ea) view.appendChild(elig.hideNumbers ? eaCardPlain(ea) : eaCard(ea, eaArgs));
    else if (!leanMassNow({ profile, health, today }).ffm && hasRecentMeals(eaArgs.diary, today)) {
      view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
        el('div', {}, [
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('labsView.ffmMissing') }),
          el('button', { class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' }, onclick: () => { location.hash = '#/health'; } }, [icon('heart'), t('labsView.toBodyStats')]),
        ]),
      ]));
    }
  }

/* --- 3. Lab values ----------------------------------------------------- */
  view.appendChild(sectionHead(t('labsView.yourValues'), { label: t('labsView.logValue'), onClick: () => openValueSheet(elig) }, { help: 'labor' }));

  if (!elig.labsEvaluate) {
    view.appendChild(noteCard(t('labsView.minorNote')));
  }
  const rows = overview(labs, { sex: profile.sex, today, evaluate: elig.labsEvaluate, pregnant: elig.pregnancy });
  if (!rows.length) {
    view.appendChild(emptyState('flask', t('labsView.noValuesYet'),
      elig.labsEvaluate
        ? t('labsView.emptyEvaluate')
        : t('labsView.emptyPlain')));
    view.appendChild(sourcesCard());
  } else {
    view.appendChild(labStats(rows, labs, elig.labsEvaluate));
    const list = el('div', { class: 'list-card' });
    rows.forEach((r, i) => list.appendChild(valueRow(r, i, labs)));
    view.appendChild(list);
    view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: elig.labsEvaluate ? t('labsView.tapHintEvaluate') : t('labsView.tapHint') }));
  }
  // Whole report at once instead of value by value (MKT-09).
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openReportSheet() }, [icon('flask'), t('labsView.logReport')]));

  /* --- 4. Suggestions ---------------------------------------------------- */
  view.appendChild(sectionHead(t('labsView.supplements')));
  if (elig.mode === 'documentation') {
    view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: t('labsView.docMode') }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: elig.minor
          ? t('labsView.docModeMinor', { reasons: elig.reasons.join(' · ') })
          : t('labsView.docModeAdult', { reasons: elig.reasons.join(' · ') }) }),
        el('button', { class: 'btn btn--ghost mt-2', style: { fontSize: '.8rem' }, onclick: () => openGateSheet({ onSaved: rerender }) }, t('labsView.changeAnswers')),
      ]),
    ]));
  } else if (flags.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: t('labsView.holdBack') }));
  } else {
    const rec = recommend({
      labs, profile, sessions: store.get('sessions'), today, diet: s.diet || null,
      cycle: store.get('cycle'), diary: store.get('diary'), elig,
    });
    view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('utensils'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: rec.foodFirst }),
    ]));
    if (!rec.items.length) {
      view.appendChild(el('div', { class: 'card card--flat mt-2', text: t('labsView.noSuggestion') }));
    }
    rec.items.forEach((it) => view.appendChild(suggestionCard(it)));
    rec.interactions.forEach((interaction) => view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: interaction }),
    ])));
  }

/* --- 5. Own intake plan ------------------------------------------------ */
  view.appendChild(sectionHead(t('labsView.yourPlan'), { label: t('labsView.add'), onClick: () => openPlanSheet(null, elig) }));
  const plans = activePlans(supps, today);
  if (!plans.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: t('labsView.planEmpty') }));
  } else {
    const list = el('div', { class: 'list-card' });
    plans.forEach((p, i) => list.appendChild(planRow(p, today, i)));
    view.appendChild(list);
    const ad = adherence(supps, today);
    if (ad) {
      const ser = adherenceSeries(supps, today, 21);
      view.appendChild(el('div', { class: 'card mt-2' }, [
        el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
          el('div', { class: 'card__title', style: { fontSize: '.9rem' }, text: t('labsView.adherence') }),
          el('div', { class: 'num', style: { fontWeight: '800', color: ad.pct >= 80 ? 'var(--good)' : ad.pct >= 50 ? 'var(--warn)' : 'var(--bad)' }, text: t('labsView.percent', { pct: ad.pct }) }),
        ]),
        el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: tp('labsView.adherenceCaption', ad.expected, { taken: ad.taken, extra: plans.some((p) => !isDaily(p)) ? ` · ${t('labsView.adherenceAsNeeded')}` : '' }) }),
        // 100 % as a fixed anchor: without it, a consistently halved intake looked like a full one.
        ser.length ? barChart(ser, { height: 90, min: 100, yUnit: '%', label: t('labsView.adherencePerDay') }) : null,
      ]));
    }
  }

  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: t('labsView.disclaimer') }),
  ]));
}

/* ------------------------------- Building blocks ------------------------- */

function introCard() {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: t('nav.labs') }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: t('labsView.introWhat') }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: t('labsView.introGate') }),
  ]);
}

function noteCard(text) {
  return el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text }),
  ]);
}

/** Are there meals in the last 14 days? (Then the hint about missing body fat is worthwhile.) */
function hasRecentMeals(diary, today) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10);
  return (diary || []).some((m) => m && !m.deleted && !m._kind && m.kcal && m.date >= from && m.date <= today);
}

const EA_TONE = { kritisch: 'bad', niedrig: 'warn', unklar: 'neutral', gut: 'good' };

/** Energy supply with a number – rounded and as a range, because all inputs are estimates. */
function eaCard(ea, eaArgs) {
  const tone = EA_TONE[ea.level] || 'neutral';
  return el('div', { class: 'card mt-2', style: { borderLeft: `4px solid ${TONE_COLOR[tone]}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: t('labsView.energyAvailability') }),
      infoButton('energieverfuegbarkeit', t('labsView.energyAvailability')),
    ]),
    // With unclear data, do not put a number in the foreground – it would be
    // calculated from patchy diary entries and thus misleading.
    ea.level === 'unklar' ? null : el('div', { class: 'row gap-3 mt-2', style: { alignItems: 'baseline', flexWrap: 'wrap' } }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '800', color: TONE_TEXT[tone] }, text: `≈ ${ea.eaRounded}` }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: t('labsView.eaRange', { low: ea.range[0], high: ea.range[1], target: EA_OPTIMAL }) }),
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: ea.hint }),
    ea.level === 'unklar' ? null : el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('labsView.eaBasis', {
    days: ea.confirmedDays, intake: ea.intakeAvg, training: ea.trainingAvg,
    trainingSource: ea.trainingSource === 'gemessen' ? t('labsView.eaTrainingMeasured') : ea.trainingSource === 'teils' ? t('labsView.eaTrainingMixed') : t('labsView.eaTrainingEstimated'),
    ffm: fmtDec(ea.ffm), ffmSource: ea.ffmMeasured ? t('labsView.eaFfmMeasured') : t('labsView.eaFfmEstimated'),
  }) }),
    el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => { location.hash = '#/nutrition'; },
    }, [icon('utensils'), ea.level === 'unklar' ? t('labsView.toFoodDiaryConfirm') : t('labsView.toFoodDiary')]),
    ea.level === 'unklar' ? null : eaChart(eaArgs),
  ]);
}

/** Energy supply without numbers – for everyone who has hidden calorie figures. */
function eaCardPlain(ea) {
  const tone = EA_TONE[ea.level] || 'neutral';
  const text = {
    kritisch: t('labsView.eaPlainCritical'),
    niedrig: ea.lossBand
      ? t('labsView.eaPlainLossBand')
      : t('labsView.eaPlainLow'),
    gut: t('labsView.eaPlainGood'),
    unklar: t('labsView.eaPlainUnclear', { days: ea.confirmedDays, total: ea.days }),
  }[ea.level];
  return el('div', { class: 'card mt-2', style: { borderLeft: `4px solid ${TONE_COLOR[tone]}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: t('labsView.energyAvailability') }),
      infoButton('energieverfuegbarkeit', t('labsView.energyAvailability')),
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text }),
    ea.level === 'unklar' ? el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => { location.hash = '#/nutrition'; },
    }, [icon('utensils'), t('labsView.toFoodDiary')]) : null,
  ]);
}

/** "Where do I get lab values?" – collapsible as long as nothing has been recorded yet. */
function sourcesCard() {
  const body = el('div', { hidden: true, style: { marginTop: '6px' } },
    LAB_SOURCES.map((src, i) => el('div', { style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: src.title }),
        src.best ? el('span', { class: 'chip chip--accent', style: { fontSize: '.62rem' }, text: t('labsView.bestFit') }) : null,
      ]),
      el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: src.what }),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '2px' }, text: t('labsView.cost', { cost: src.cost }) }),
      el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '4px' } }, [
        el('strong', { text: t('labsView.tip') }), src.tip,
      ]),
    ])));
  const head = el('button', {
    class: 'btn btn--soft btn--block', style: { fontSize: '.84rem' },
    onclick: () => { body.hidden = !body.hidden; },
  }, [icon('info'), t('labsView.whereToGet')]);
  return el('div', { class: 'card mt-3' }, [
    el('div', { class: 'muted', style: { fontSize: '.84rem', marginBottom: '8px' }, text: labSourcesTeaser() }),
    head, body,
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '8px' }, text: t('labsView.referenceNote') }),
  ]);
}

/** Key-figures row above all values: overview at a glance. */
function labStats(rows, labs, evaluate = true) {
  const good = rows.filter((r) => r.assessment.status === 'gut').length;
  const attention = rows.filter((r) => ['niedrig', 'hoch', 'grenzwertig'].includes(r.assessment.status)).length;
  const measured = (labs || []).filter((l) => l && !l.deleted).length;
  const dates = [...new Set((labs || []).filter((l) => l && !l.deleted).map((l) => l.date))].sort();
  const last = dates.at(-1);
  const counts = t('labsView.counts', { measurements: tp('labsView.measurements', measured), dates: tp('labsView.dates', dates.length), last: last ? fmtDate(last) : '–' });
  // Documenting only (child and adolescent profile): no traffic light, just the overview.
  if (!evaluate) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
        el('span', { class: 'num', style: { fontWeight: '800' }, text: String(rows.length) }),
        el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: tp('labsView.valuesDocumented', rows.length) }),
      ]),
      el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '6px' }, text: counts }),
    ]);
  }

  const seg = [
    { value: good, color: 'var(--good)', label: t('labsView.inTarget') },
    { value: attention, color: 'var(--warn)', label: t('labsView.attention') },
    { value: rows.length - good - attention, color: 'var(--text-3)', label: t('labsView.notAssessed') },
  ].filter((s) => s.value > 0);

  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('div', { style: { flex: '0 0 auto', width: '96px' } }, [donut(seg, { size: 96, centerValue: String(rows.length), centerLabel: t('labsView.valuesCenter'), label: t('labsView.donutLabel') })]),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
          el('span', { class: 'num', style: { fontWeight: '800', color: 'var(--good-text)' }, text: String(good) }),
          el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: t('labsView.inSportTarget') }),
        ]),
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline', marginTop: '2px' } }, [
          el('span', { class: 'num', style: { fontWeight: '800', color: attention ? 'var(--warn)' : 'var(--text-3)' }, text: String(attention) }),
          el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: t('labsView.toWatch') }),
        ]),
        el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '6px' }, text: counts }),
      ]),
    ]),
  ]);
}

const num = fmtDec;
/** Range as text: "15–300" or "from 35" (no upper limit). */
const fmtRange = (r) => (r[1] == null ? t('labsView.rangeFrom', { value: num(r[0]) }) : `${num(r[0])}–${num(r[1])}`);
/** Value as it stood on the report (unit of the report), otherwise canonical. */
function valueText(rec, unit) {
  if (rec && rec.enteredUnit && rec.enteredValue != null) return `${num(rec.enteredValue)} ${rec.enteredUnit}`;
  return `${num(rec ? rec.value : '')} ${unit}`;
}
const monthsText = (days) => tp('labsView.months', Math.round(days / 30));

function valueRow(r, i, labs) {
  const a = r.assessment;
  const trd = r.trend;
  const arrow = trd ? (trd.dir === 'up' ? '↑' : trd.dir === 'down' ? '↓' : '→') : '';
  const sub = [fmtDate(r.date), a.label];
  if (r.stale) sub.push(t('labsView.staleShort'));
  if (trd && trd.dir !== 'flat') sub.push(t('labsView.perMonth', { arrow, value: num(Math.abs(trd.perMonth)), unit: r.unit }));

  // Mini trend right in the row: spot the trend without expanding.
  const pts = series(labs, r.key).map((l) => Number(l.value));
  const spark = pts.length >= 3
    ? el('span', { style: { width: '54px', flex: '0 0 auto', opacity: '.85' } }, [sparkline(pts, { color: TONE_COLOR[a.tone] })])
    : null;

  const detail = el('div', { hidden: true, style: { padding: '4px 0 10px' } });
  const row = el('button', {
    class: 'list-item', style: { width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: i ? '1px solid var(--border)' : 'none' },
    onclick: () => { detail.hidden = !detail.hidden; if (!detail.childElementCount) fillDetail(detail, r); },
  }, [
    el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: TONE_COLOR[a.tone], flex: '0 0 auto' } }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: r.label }),
      el('div', { class: 'list-item__sub', text: sub.join(' · ') }),
    ]),
    spark,
    el('span', { class: 'num', style: { fontWeight: '700' }, text: valueText(r.record, r.unit) }),
  ]);
  return el('div', {}, [row, detail]);
}

/** Trend of energy availability over the last weeks. */
function eaChart(args) {
  const ser = energyAvailabilitySeries(args, { weeks: 10 });
  if (ser.filter((p) => p.value != null).length < 3) return null;
  return el('div', { class: 'mt-2' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '2px' }, text: t('labsView.eaChartCaption', { target: EA_OPTIMAL, critical: eaLowFor(args.profile && args.profile.sex) }) }),
    lineChart(ser, { label: t('labsView.eaPerWeek'), height: 120, unit: 'kcal/kg', target: EA_OPTIMAL, targetLabel: t('labsView.guideline'), fmt: (v) => String(Math.round(v)) }),
  ]);
}

function fillDetail(box, r) {
  const labs = store.get('labs');
  const all = series(labs, r.key);
  const pts = all.map((l) => ({ label: fmtDate(l.date), date: l.date, value: Number(l.value) }));
  const a = r.assessment;
  const rec = r.record || latest(labs, r.key);
  // Documenting only: the range from the person's own report (which is age-appropriate), no rating.
  const ownOnly = a.status === 'unbewertet' && hasOwnRef(rec) ? [Number(rec.refLow), Number(rec.refHigh)] : null;
  const ref = a.ref || ownOnly;
  const sportDiffers = a.sport && (!ref || a.sport[0] !== ref[0] || a.sport[1] !== ref[1]);
  if (pts.length >= 2) {
    // Both corridors: reference as a dashed frame, sport target range as a filled area.
    const bands = [];
    if (sportDiffers) bands.push({ lo: a.sport[0], hi: a.sport[1], kind: 'fill', label: t('labsView.sportRange') });
    if (ref) bands.push({ lo: ref[0], hi: ref[1], kind: 'frame', label: a.ownRef || ownOnly ? t('labsView.refOwnLab') : t('labsView.reference') });
    box.appendChild(lineChart(pts, { label: t('labsView.chartLabel', { label: r.label || t('labsView.labValue') }), unit: r.unit, height: 130, bands, color: TONE_COLOR[a.tone] }));
  }
  const ranges = [];
  if (ref) ranges.push(`${a.ownRef || ownOnly ? t('labsView.refOwnLab') : t('labsView.refTypical')} ${fmtRange(ref)} ${r.unit}`);
  if (sportDiffers) ranges.push(`${t('labsView.sportRange')} ${fmtRange(a.sport)} ${r.unit}`);
  if (ranges.length) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: ranges.join(' · ') }));
  if (a.ref && !a.ownRef) {
    box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: t('labsView.eachLabOwn') }));
  }
  if (rec && rec.enteredUnit) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: t('labsView.onReport', { entered: num(rec.enteredValue), enteredUnit: rec.enteredUnit, value: num(rec.value), unit: r.unit }) }));
  const ctx = rec ? [rec.exercise48h && t('labsView.ctxAfterExercise'), rec.fasting && t('labsView.ctxFasting'), rec.cycleDay && t('labsView.ctxCycleDay', { day: rec.cycleDay }), rec.biotin && t('labsView.ctxBiotin')].filter(Boolean) : [];
  if (ctx.length) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: t('labsView.drawContext', { items: ctx.join(' · ') }) }));
  if (a.blocked) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: a.blocked }));
  (a.caveats || []).forEach((c) => box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.8rem', borderLeft: '3px solid var(--warn)', paddingLeft: '8px' }, text: c })));
  if (r.stale) {
    const valid = (ANALYTES[r.key] && ANALYTES[r.key].validDays) || 365;
    box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: t('labsView.staleLong', { age: monthsText(valid), season: ANALYTES[r.key] && ANALYTES[r.key].seasonal ? ` ${t('labsView.staleSeason')}` : '' }) }));
  }
  if (r.hint) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: r.hint }));
  const trd = r.trend;
  if (trd && trd.daysToLimit != null) {
    const when = trd.daysToLimit < 45 ? t('labsView.inFewWeeks') : tp('labsView.inAboutMonths', Math.round(trd.daysToLimit / 30));
    box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem', color: 'var(--warn-text)' }, text: trd.limitSide === 'high' ? t('labsView.trendAbove', { when }) : t('labsView.trendBelow', { when }) }));
  }
  if (trd && trd.dir !== 'flat' && trd.seasonal) box.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: t('labsView.seasonalNote') }));
  if (trd && trd.dir === 'flat' && all.length >= 3) box.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: t('labsView.noTrend') }));
  if (r.note) box.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('labsView.noteLine', { note: r.note }) }));
  const src = ANALYTES[r.key] && ANALYTES[r.key].source;
  if (src) box.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.72rem' }, text: t('labsView.rangesBasis', { source: src }) }));

  // Measurements: edit (typos, wrong unit) and delete.
  const list = el('div', { class: 'mt-2', style: { borderTop: '1px solid var(--border)' } });
  all.slice().reverse().forEach((m) => list.appendChild(el('div', { class: 'row row--between', style: { alignItems: 'center', padding: '6px 0', gap: '8px' } }, [
    el('span', { style: { fontSize: '.82rem' }, text: `${fmtDate(m.date)} · ${valueText(m, r.unit)}` }),
    el('span', { class: 'row gap-1' }, [
      el('button', { class: 'icon-btn', 'aria-label': t('labsView.editMeasurement', { date: fmtDate(m.date) }), onclick: (e) => { e.stopPropagation(); openValueSheet(currentEligibility(), m); } }, icon('edit')),
      el('button', { class: 'icon-btn', 'aria-label': t('labsView.deleteMeasurement', { date: fmtDate(m.date) }), onclick: async (e) => {
        e.stopPropagation();
        if (await confirmDialog({ title: t('labsView.deleteTitle'), message: t('labsView.deleteBody', { label: ANALYTES[r.key].label, date: fmtDate(m.date), value: valueText(m, r.unit) }), confirmLabel: t('labsView.delete'), danger: true })) {
          store.remove('labs', m.id); toast(t('labsView.deleted'), 'good'); rerender();
        }
      } }, icon('trash')),
    ]),
  ])));
  box.appendChild(list);
}

function suggestionCard(it) {
  const badge = { stark: t('labsView.evidenceStrong'), mittel: t('labsView.evidenceSome'), situativ: t('labsView.evidenceSituational') }[it.evidence] || '';
  return el('div', { class: 'card mt-2' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { style: { fontWeight: '700' }, text: it.label }),
      badge ? el('span', { class: 'chip', style: { fontSize: '.66rem' }, text: badge }) : null,
    ]),
    el('div', { class: 'dim', style: { fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '2px' }, text: t('labsView.generalInfo') }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: t('labsView.why') }), it.reason,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: t('labsView.foodFirst') }), it.food,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: t('labsView.howTo') }), it.action,
    ]),
    it.holdOnly ? null : el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('labsView.usualAmount', { amount: it.typical, timing: it.timing, limit: it.ul }) }),
    it.note ? el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: it.note }) : null,
    !it.holdOnly && it.performance ? el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: dopingNote() }) : null,
    it.source ? el('div', { class: 'dim mt-1', style: { fontSize: '.72rem' }, text: t('labsView.basis', { source: it.source }) }) : null,
    it.holdOnly ? null : el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => openPlanSheet(it.key, currentEligibility()),
    }, [icon('plus'), t('labsView.addToPlan')]),
  ]);
}

function planRow(p, today, i) {
  const done = takenOn(store.get('supplements'), p.id, today);
  const name = p.supplementKey && SUPPLEMENTS[p.supplementKey] ? SUPPLEMENTS[p.supplementKey].label : p.name;
  return el('div', { class: 'list-item', style: { borderTop: i ? '1px solid var(--border)' : 'none' } }, [
    el('button', {
      class: 'icon-btn', 'aria-label': done ? t('labsView.undoIntake') : t('labsView.markTaken'),
      style: { color: done ? 'var(--good)' : 'var(--text-3)' },
      onclick: () => { toggleIntake(p, today, done); },
    }, icon(done ? 'check' : 'circle')),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: name }),
      el('div', { class: 'list-item__sub', text: [p.dose, p.timing, isDaily(p) ? null : t('labsView.asNeeded')].filter(Boolean).join(' · ') || t('labsView.daily') }),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': t('labsView.remove'), onclick: async () => {
      if (await confirmDialog({ title: t('labsView.removeTitle', { name }), confirmLabel: t('labsView.remove'), danger: true })) {
        store.remove('supplements', p.id); rerender();
      }
    } }, icon('trash')),
  ]);
}

/* -------------------------------- Actions -------------------------------- */

function toggleIntake(plan, date, done) {
  const supps = store.get('supplements');
  if (done) {
    const rec = supps.find((s) => s._kind === 'intake' && s.planId === plan.id && s.date === date);
    if (rec) store.remove('supplements', rec.id);
  } else {
    store.upsert('supplements', {
      id: uid('int'), _kind: 'intake', planId: plan.id, date, createdAt: nowIso(),
    });
  }
  rerender();
}

/** Record a lab value from outside the Labs view (the add button): if eligibility
    is not yet clarified, first the short setup, then directly the form. */
export function openLabEntry() {
  if (!labsEnabled()) return;
  const elig = currentEligibility();
  if (!elig.answered) { openGateSheet({ onSaved: () => openValueSheet(currentEligibility()) }); return; }
  openValueSheet(elig);
}

/**
 * Record or edit a lab value (`existing`). The unit sits right next to the value;
 * the lab's reference range is only a PLACEHOLDER (in the chosen unit) –
 * only what someone types in from the report is saved. Up to v3.19.0 the prefill
 * was saved as "your lab" and was even converted wrongly when the unit changed.
 */
/** Record a whole report: date and circumstances once, below them all values with unit and
    the reference range of the person's own lab. Empty rows are ignored. */
function openReportSheet() {
  const profile = store.profile();
  const dateI = input({ type: 'date', value: todayStr(), max: todayStr() });
  const noteI = input({ type: 'text', placeholder: t('labsView.labOrOccasion') });
  const ctx = { exercise48h: false, fasting: false, biotin: false };
  const cycleI = input({ type: 'number', min: '1', max: '60', step: '1', inputmode: 'numeric', placeholder: t('labsView.exampleCycleDay') });
  const rows = [];
  const list = el('div', { class: 'lab-report' });
  ANALYTE_GROUPS.forEach((g) => {
    const items = Object.entries(ANALYTES).filter(([, a]) => a.group === g);
    if (!items.length) return;
    list.appendChild(el('div', { class: 'field__label mt-3', text: groupLabel(g) }));
    items.forEach(([key, a]) => {
      const units = unitsFor(key);
      const valueI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: t('labsView.valuePlaceholder'), 'aria-label': t('labsView.ariaResult', { label: a.label }) });
      const unitSel = select(units.map((u) => ({ value: u, label: u })), units[0], { 'aria-label': t('labsView.ariaUnit', { label: a.label }) });
      if (units.length < 2) unitSel.disabled = true;
      const loI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: t('labsView.from'), 'aria-label': t('labsView.ariaRefFrom', { label: a.label }) });
      const hiI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: t('labsView.to'), 'aria-label': t('labsView.ariaRefTo', { label: a.label }) });
      rows.push({ key, valueI, unitSel, loI, hiI });
      list.appendChild(el('div', { class: 'lab-report__row' }, [
        el('div', { class: 'lab-report__name', text: a.label }),
        el('div', { class: 'lab-report__value' }, [valueI, unitSel]),
        el('div', { class: 'lab-report__ref' }, [el('span', { class: 'dim', text: t('labsView.reference') }), loI, el('span', { class: 'dim', text: '–' }), hiI]),
      ]));
    });
  });
  const ctxRow = (label, k) => el('div', { class: 'row row--between', style: { padding: '6px 0', gap: '12px', alignItems: 'center' } }, [
    el('span', { style: { fontSize: '.84rem' }, text: label }), toggle(false, (v) => { ctx[k] = v; }, label),
  ]);
  const errBox = el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
  const saveBtn = el('button', { class: 'btn btn--primary btn--block' }, [icon('check'), t('labsView.saveReport')]);
  let confirmed = null;
  list.addEventListener('input', () => { confirmed = null; errBox.hidden = true; saveBtn.lastChild.textContent = t('labsView.saveReport'); });
  saveBtn.addEventListener('click', () => {
    const res = labRecordsFromReport({
      date: dateI.value || todayStr(), note: noteI.value,
      ctx: { ...ctx, cycleDay: parseInt(cycleI.value, 10) },
      rows: rows.map((r) => ({ key: r.key, value: r.valueI.value, unit: r.unitSel.value, refLow: r.loI.value, refHigh: r.hiI.value })),
    }, { sex: profile.sex });
    if (res.errors.length) { errBox.textContent = res.errors.join(' · '); errBox.hidden = false; return; }
    if (!res.records.length) { toast(t('labsView.enterOneValue'), 'bad'); return; }
    const msg = res.implausible.length ? t('labsView.implausibleReport', { items: res.implausible.join(', ') }) : null;
    if (msg && confirmed !== msg) { confirmed = msg; errBox.textContent = msg; errBox.hidden = false; saveBtn.lastChild.textContent = t('labsView.saveAnyway'); return; }
    const now = nowIso();
    const saved = store.upsertMany('labs', res.records.map((r) => ({ ...r, id: uid('lab'), createdAt: now, updatedAt: now })));
    if (!saved.length) { toast(t('labsView.saveFailed'), 'bad'); return; }
    closeSheet(); toast(tp('labsView.valuesSaved', saved.length), 'good'); refreshView();
  });
  openSheet({
    title: t('labsView.reportTitle'),
    body: el('div', {}, [
      el('div', { class: 'field__row' }, [field(t('labsView.drawDate'), dateI), field(t('labsView.note'), noteI)]),
      el('p', { class: 'muted', style: { fontSize: '.82rem' }, text: t('labsView.reportIntro') }),
      list,
      el('div', { class: 'field__label mt-3', text: t('labsView.drawCircumstancesAll') }),
      ctxRow(t('labsView.hardExercise48h'), 'exercise48h'),
      ctxRow(t('labsView.fasting'), 'fasting'),
      ctxRow(t('labsView.biotinTaken'), 'biotin'),
      profile.sex === 'm' ? null : field(t('labsView.cycleDayOptional'), cycleI),
      errBox,
    ]),
    footer: [saveBtn],
  });
}

function openValueSheet(elig = currentEligibility(), existing = null) {
  const profile = store.profile();
  const ex = existing ? migrateLabRecord(existing) : null;
  let key = ex && ANALYTES[ex.analyte] ? ex.analyte : 'ferritin';
  let unit = ex && ex.enteredUnit && unitFactor(key, ex.enteredUnit) ? ex.enteredUnit : ANALYTES[key].unit;
  // Child and adolescent profile: no adult ranges as placeholders – the report knows the matching ones.
  const suggest = elig.labsEvaluate;
  const inUnit = (v) => (v == null ? '' : String(fromCanonical(key, v, unit)));
  const dateI = input({ type: 'date', value: ex ? ex.date : todayStr() });
  const valueI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: t('labsView.valuePlaceholder'), 'aria-label': t('labsView.measuredValue'),
    value: ex ? (ex.enteredUnit === unit && ex.enteredValue != null ? String(ex.enteredValue) : inUnit(ex.value)) : '' });
  const noteI = input({ type: 'text', placeholder: t('labsView.noteOptional'), value: ex && ex.note ? ex.note : '' });
  const ownRef = ex && hasOwnRef(ex);
  const refLoI = input({ type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': t('labsView.referenceFrom'), value: ownRef ? inUnit(ex.refLow) : '' });
  const refHiI = input({ type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': t('labsView.referenceTo'), value: ownRef ? inUnit(ex.refHigh) : '' });
  const refUnitLbl = el('span', { class: 'muted', style: { alignSelf: 'center', fontSize: '.8rem', whiteSpace: 'nowrap' } });
  // Placeholder with sensible precision (20 instead of 20.032).
  const nice = (v) => {
    const a = Math.abs(v);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return num(Number(v.toFixed(d)));
  };
  const fillPlaceholders = () => {
    const r = suggest ? refRange(key, profile.sex) : null;
    refLoI.placeholder = r ? t('labsView.exampleValue', { value: nice(fromCanonical(key, r[0], unit)) }) : t('labsView.from');
    refHiI.placeholder = r && r[1] != null ? t('labsView.exampleValue', { value: nice(fromCanonical(key, r[1], unit)) }) : t('labsView.to');
    refUnitLbl.textContent = unit;
  };

  const unitSel = el('select', { class: 'select', 'aria-label': t('labsView.unit') });
  const drawUnits = (keep = false) => {
    unitSel.innerHTML = '';
    const opts = unitsFor(key);
    if (!keep || !opts.includes(unit)) unit = opts[0];
    opts.forEach((u) => { const o = el('option', { value: u, text: u }); if (u === unit) o.selected = true; unitSel.appendChild(o); });
    unitSel.disabled = opts.length < 2;
  };
  unitSel.addEventListener('change', () => {
    // Also convert reference limits that were already typed in – otherwise numbers in the old unit would remain.
    const prev = unit; unit = unitSel.value;
    [refLoI, refHiI].forEach((i) => {
      if (i.value === '') return;
      const c = toCanonical(key, i.value, prev);
      i.value = c == null ? '' : String(fromCanonical(key, c, unit));
    });
    fillPlaceholders(); confirm.reset();
  });

  const groups = ANALYTE_GROUPS.map((g) => ({
    label: g,
    keys: Object.entries(ANALYTES).filter(([, a]) => a.group === g).map(([k, a]) => ({ value: k, label: a.label })),
  })).filter((g) => g.keys.length);
  const analyteSel = select(groups.flatMap((g) => g.keys), key);
  const hintBox = el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '-4px' }, text: ANALYTES[key].hint || '' });
  analyteSel.addEventListener('change', () => {
    key = analyteSel.value; drawUnits(); refLoI.value = ''; refHiI.value = '';
    fillPlaceholders(); hintBox.textContent = ANALYTES[key].hint || ''; confirm.reset();
  });
  drawUnits(true);
  fillPlaceholders();

  // Circumstances of the blood draw (optional) – context rules derive from them (load, cycle, biotin).
  // For a new value from the same day, we adopt the details of the other value.
  const sameDay = !ex && store.get('labs').find((l) => l.date === dateI.value && (l.exercise48h || l.fasting || l.biotin || l.cycleDay));
  const ctxSrc = ex || sameDay || {};
  const ctx = { exercise48h: !!ctxSrc.exercise48h, fasting: !!ctxSrc.fasting, biotin: !!ctxSrc.biotin };
  const cycleI = input({ type: 'number', min: '1', max: '60', step: '1', inputmode: 'numeric', placeholder: t('labsView.exampleCycleDay'), value: ctxSrc.cycleDay ? String(ctxSrc.cycleDay) : '' });
  const ctxRow = (label, k) => el('div', { class: 'row row--between', style: { padding: '6px 0', gap: '12px', alignItems: 'center' } }, [
    el('span', { style: { fontSize: '.84rem' }, text: label }), toggle(ctx[k], (v) => { ctx[k] = v; }, label),
  ]);
  const ctxBody = el('div', { hidden: !(ctxSrc.exercise48h || ctxSrc.fasting || ctxSrc.biotin || ctxSrc.cycleDay) }, [
    ctxRow(t('labsView.hardExercise48h'), 'exercise48h'),
    ctxRow(t('labsView.fasting'), 'fasting'),
    ctxRow(t('labsView.biotinTaken'), 'biotin'),
    profile.sex === 'm' ? null : field(t('labsView.cycleDayOptional'), cycleI),
  ]);
  const ctxToggle = el('button', { type: 'button', class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.8rem' },
    onclick: () => { ctxBody.hidden = !ctxBody.hidden; } }, t('labsView.circumstancesOptional'));

  // Implausible order of magnitude: first a "Check unit?" hint, the second tap saves.
  const warnBox = el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
  const saveBtn = el('button', { class: 'btn btn--primary btn--block' }, [icon('check'), t('labsView.save')]);
  const confirm = {
    shown: null,
    reset() { this.shown = null; warnBox.hidden = true; saveBtn.lastChild.textContent = t('labsView.save'); },
    ok(msg) {
      if (!msg || this.shown === msg) return true;
      this.shown = msg; warnBox.textContent = msg; warnBox.hidden = false; saveBtn.lastChild.textContent = t('labsView.saveAnyway');
      return false;
    },
  };
  [valueI, refLoI, refHiI].forEach((i) => i.addEventListener('input', () => confirm.reset()));

  saveBtn.onclick = () => {
    const v = toCanonical(key, valueI.value, unit);
    if (v == null) { toast(t('labsView.enterValidValue'), 'bad'); return; }
    const hasLo = refLoI.value !== '', hasHi = refHiI.value !== '';
    if (hasLo !== hasHi) { toast(t('labsView.enterBothLimits'), 'bad'); return; }
    const rLo = hasLo ? toCanonical(key, refLoI.value, unit) : null;
    const rHi = hasHi ? toCanonical(key, refHiI.value, unit) : null;
    if (hasLo && !(rHi > rLo)) { toast(t('labsView.upperLimit'), 'bad'); return; }
    if (!confirm.ok(implausible(key, v, profile.sex)
      ? t('labsView.implausibleValue', { value: num(valueI.value), unit, label: ANALYTES[key].label })
      : null)) return;
    const cycleDay = parseInt(cycleI.value, 10);
    const rec = {
      ...(ex || {}),
      id: ex ? ex.id : uid('lab'), analyte: key, value: v, unit: ANALYTES[key].unit,
      date: dateI.value || todayStr(), note: noteI.value.trim() || null,
      refLow: rLo, refHigh: rHi, refSource: hasLo ? 'lab' : null,
      enteredValue: unit !== ANALYTES[key].unit ? Number(valueI.value) : null,
      enteredUnit: unit !== ANALYTES[key].unit ? unit : null,
      exercise48h: ctx.exercise48h || null, fasting: ctx.fasting || null, biotin: ctx.biotin || null,
      cycleDay: Number.isFinite(cycleDay) && cycleDay > 0 ? cycleDay : null,
      schema: LAB_SCHEMA, createdAt: (ex && ex.createdAt) || nowIso(), updatedAt: nowIso(),
    };
    delete rec.migratedFrom;
    store.upsert('labs', rec);
    closeSheet(); toast(ex ? t('labsView.valueChanged') : t('labsView.valueSaved'), 'good'); rerender();
  };

  openSheet({
    title: ex ? t('labsView.editTitle') : t('labsView.addTitle'),
    body: el('div', {}, [
      field(t('labsView.analyte'), analyteSel), hintBox,
      field(t('labsView.date'), dateI),
      el('div', { class: 'field__row' }, [field(t('labsView.measuredValue'), valueI), field(t('labsView.unit'), unitSel)]),
      warnBox,
      el('div', { class: 'field__label', text: t('labsView.refRangeLab') }),
      el('div', { class: 'row gap-2' }, [
        el('div', { class: 'grow' }, [refLoI]),
        el('span', { class: 'muted', style: { alignSelf: 'center' }, text: t('labsView.to') }),
        el('div', { class: 'grow' }, [refHiI]),
        refUnitLbl,
      ]),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: suggest
        ? t('labsView.refHintAdult')
        : t('labsView.refHintMinor') }),
      ctxToggle, ctxBody,
      field(t('labsView.note'), noteI),
    ]),
    footer: saveBtn,
  });
}

function openPlanSheet(presetKey = null, elig = currentEligibility()) {
  // Minors: no performance supplements in the catalogue.
  const keys = catalogFor(elig);
  const opts = keys.map((k) => ({ value: k, label: SUPPLEMENTS[k].label }));
  let key = presetKey && keys.includes(presetKey) ? presetKey : opts[0].value;
  const sel = select(opts, key);
  const doseI = input({ type: 'text', value: SUPPLEMENTS[key].typical, placeholder: t('labsView.amount') });
  const timingI = input({ type: 'text', value: SUPPLEMENTS[key].timing || '', placeholder: t('labsView.when') });
  const doping = el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: dopingNote(), hidden: !SUPPLEMENTS[key].performance });
  // Frequency: situational supplements (e.g. before races) are not a daily obligation.
  const freqFor = (k) => (AS_NEEDED.includes(k) ? 'bedarf' : 'taeglich');
  const freqSel = select([{ value: 'taeglich', label: t('labsView.daily') }, { value: 'bedarf', label: t('labsView.asNeededExample') }], freqFor(key));
  sel.addEventListener('change', () => {
    key = sel.value;
    doseI.value = SUPPLEMENTS[key].typical;
    timingI.value = SUPPLEMENTS[key].timing || '';
    doping.hidden = !SUPPLEMENTS[key].performance;
    freqSel.value = freqFor(key);
  });
  openSheet({
    title: t('labsView.addToPlanTitle'),
    body: el('div', {}, [
      field(t('labsView.supplement'), sel),
      field(t('labsView.amount'), doseI),
      field(t('labsView.timing'), timingI),
      field(t('labsView.frequency'), freqSel),
      el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: t('labsView.planSheetHint') }),
      doping,
    ]),
    footer: el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      store.upsert('supplements', {
        id: uid('sup'), _kind: 'plan', supplementKey: key, name: SUPPLEMENTS[key].label,
        dose: doseI.value.trim(), timing: timingI.value.trim(), active: true, frequency: freqSel.value,
        from: todayStr(), to: null, createdAt: nowIso(), updatedAt: nowIso(),
      });
      closeSheet(); toast(t('labsView.addedToPlan'), 'good'); rerender();
    } }, [icon('check'), t('labsView.apply')]),
  });
}

// Redraw via the router (scroll position stays, even if the form was opened from
// another view); without an app shell (tests) directly.
function rerender() { rerenderView(render); }
