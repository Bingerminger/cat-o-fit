/* =========================================================================
   health.js — body values (health log): trends, charts, recording.
   Presentation deliberately non-judgemental (trend, no rigid targets). Metrics
   can be switched off individually (profile settings).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, fmtNum, fmtDayMonth, todayStr, sectionHead,
  emptyState, toast, openSheet, closeSheet, field, input, textarea, navigate, toggle,
  refreshView, segmented, addDays, weekStartMonday, fmtWeight, fmtWeightDec,
} from './ui.js';
import { kgToShown, weightUnit, toInput, fromInput } from './units.js';
import { setHeader } from './router.js';
import { progressTabs } from './nav.js';
import { lineChart } from './charts.js';
import { alcoholFreeStreak } from './healthdata.js';
import { smoothedChange } from './fitness.js';
import { weightNow, weightGoalStatus } from './energy.js';
import { currentEligibility } from './wellness.js';
import { currentHrvMethod, withHrvMethod, hrvLabel, HRV_METHODS } from './healthdata.js';

import { t, tp } from './i18n.js';

function metricsDef() {
  const p = store.profile();
  const elig = currentEligibility();
  // Weight: "better" is the direction towards the target weight (lose OR gain) – without a goal,
  // at the goal or without weight goals (children, pregnancy, eating disorder) the colour stays neutral.
  const target = elig.noWeightGoals ? null : p.targetWeightKg;
  const gs = target != null
    ? weightGoalStatus({ current: weightNow(store.get('health'), p), target, start: p.targetWeightStartKg != null ? p.targetWeightStartKg : p.weightKg })
    : null;
  const weightToward = gs && gs.status !== 'halten' && gs.direction !== 'hold' ? gs.direction : null;
  // HRV: label by the measurement method of the most recent value (SDNN from Apple, RMSSD from many watches).
  const hrvMethod = currentHrvMethod(store.get('health'));
  // `unit` is the stored unit; `mass` values are shown and typed in kg or lb.
  return {
    weight: { label: t('healthView.metricWeight'), unit: 'kg', mass: true, icon: 'scale', digits: 1, target, toward: weightToward },
    bodyFat: { label: t('healthView.metricBodyFat'), unit: '%', icon: 'drop', digits: 1, toward: null },
    muscleMass: { label: t('healthView.metricMuscleMass'), unit: 'kg', mass: true, icon: 'dumbbell', digits: 1, toward: 'up' },
    leanMass: { label: t('healthView.metricLeanMass'), unit: 'kg', mass: true, icon: 'dumbbell', digits: 1, toward: null },
    visceralFat: { label: t('healthView.metricVisceralFat'), unit: '', icon: 'info', digits: 0, toward: 'down' },
    restingHr: { label: t('healthView.metricRestingHr'), unit: 'bpm', icon: 'heart', digits: 0, toward: 'down' },
    hrv: { label: hrvLabel(hrvMethod), unit: 'ms', icon: 'activity', digits: 0, toward: 'up', method: hrvMethod },
    vo2max: { label: 'VO₂max', unit: '', icon: 'gauge', digits: 1, toward: 'up' },
    sleepHours: { label: t('healthView.metricSleep'), unit: 'h', icon: 'bed', digits: 1, toward: 'up' },
    energy: { label: t('healthView.metricEnergy'), unit: '/10', icon: 'sun', digits: 0, toward: 'up' },
    mood: { label: t('healthView.metricMood'), unit: '/10', icon: 'sparkles', digits: 0, toward: 'up' },
  };
}

/** Value and unit as shown: masses in the person's unit (kg or lb), everything else as stored. */
const shownVal = (d, v) => (d.mass && v != null ? kgToShown(Number(v)) : v);
const shownUnit = (d) => (d.mass ? weightUnit() : d.unit);
/** A stored value for the entry form: masses in kg or lb, everything else as stored. */
const fieldValue = (d, v) => (d.mass ? toInput(v, 'weight') : (v ?? ''));

function sortedHealth() {
  return store.get('health').slice().sort((a, b) => a.date.localeCompare(b.date));
}

/** Time range of the trends; is kept across redraws. */
const RANGES = [
  { value: '3m', get label() { return t('healthView.range3m'); }, days: 92 },
  { value: '1y', get label() { return t('healthView.range1y'); }, days: 366 },
  { value: 'all', get label() { return t('healthView.rangeAll'); }, days: null },
];
const uiState = { range: '1y' };

/** Median per calendar week (Monday as the date) – for long trends (FE-09). */
export function weeklyMedian(points) {
  const byWeek = new Map();
  points.forEach((p) => {
    const w = weekStartMonday(p.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(p.value);
  });
  return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([w, vals]) => {
    const v = vals.slice().sort((x, y) => x - y);
    const m = Math.floor(v.length / 2);
    return { date: w, label: fmtDayMonth(w), value: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2 };
  });
}

export function render(view) {
  setHeader({
    title: t('nav.progress'),
    actions: [
      { icon: 'upload', label: t('healthView.import'), onClick: () => navigate('#/import') },
      { icon: 'plus', label: t('healthView.logValues'), onClick: () => openHealthEntry({}) },
    ],
  });
  view.appendChild(progressTabs('#/health'));

  const data = sortedHealth();
  const enabled = store.settings().metricsEnabled || {};
  const defs = metricsDef();

  if (!data.length) {
    view.appendChild(emptyState('heart', t('healthView.emptyTitle'), t('healthView.emptyText')));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openHealthEntry({}) }, [icon('plus'), t('healthView.logButton')]));
    return;
  }

  // Alcohol-free days in a row – only if an alcohol day was recorded at all.
  const sober = alcoholFreeStreak(store.get('health'));
  if (sober != null) view.appendChild(soberCard(sober));

  // Tile overview of the current values (muscle mass from the scale, otherwise fat-free mass)
  const grid = el('div', { class: 'stat-grid stat-grid--pairs' });
  let anyDelta = false;
  const hasData = (k) => enabled[k] !== false && data.some((d) => d[k] != null);
  const tiles = ['weight', 'bodyFat', hasData('muscleMass') ? 'muscleMass' : 'leanMass', 'restingHr'];
  tiles.forEach((key) => {
    if (enabled[key] === false) return;
    const series = data.filter((d) => d[key] != null);
    if (!series.length) return;
    // Shown: the most recently measured value. Change: smoothed trend (7-day median),
    // so that daily fluctuations do not appear as progress or regression.
    const last = series.at(-1)[key];
    const d = defs[key];
    const ch = smoothedChange(data, key);
    const delta = ch && ch.delta != null ? ch.delta : null;
    if (delta != null) anyDelta = true;
    grid.appendChild(el('div', { class: 'metric-tile' }, [
      el('div', { class: 'metric-tile__top' }, [
        el('span', { class: 'metric-tile__name', text: d.label }),
        el('span', { html: iconSvg(d.icon), style: { width: '16px', color: 'var(--text-3)' } }),
      ]),
      el('div', { class: 'metric-tile__val num', text: `${fmtNum(shownVal(d, last), d.digits)}${shownUnit(d) ? ' ' + shownUnit(d) : ''}` }),
      delta != null
        ? el('div', { class: 'metric-tile__delta', title: t('healthView.weekAverageSince', { date: fmtDayMonth(ch.since) }), style: { color: deltaColor(d, delta) }, text: `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${fmtNum(Math.abs(shownVal(d, delta)), d.digits)}` })
        : el('div', { class: 'metric-tile__delta dim', text: '—' }),
    ]));
  });
  view.appendChild(grid);
  if (anyDelta) view.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.72rem' }, text: t('healthView.deltaNote') }));

  // Time range of the trends (stays when redrawing): 10 years of Apple Health weight
  // used to be a single band with no readable time range (FE-09).
  const range = RANGES.find((r) => r.value === uiState.range) || RANGES[1];
  const from = range.days ? addDays(todayStr(), -range.days) : null;
  view.appendChild(el('div', { class: 'row row--between mt-4', style: { flexWrap: 'wrap', gap: '8px' } }, [
    el('h2', { class: 'section-head__title', text: t('healthView.trends') }),
    segmented(RANGES, range.value, (v) => { uiState.range = v; refreshView(); }, { label: t('healthView.rangeLabel') }),
  ]));

  // Charts per enabled metric with a trend (HRV only within one measurement method – SDNN and
  // RMSSD are different quantities, a device change would otherwise look like a slump).
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const series = (key === 'hrv' ? withHrvMethod(data, d.method) : data)
      .filter((x) => x[key] != null && (!from || x.date >= from));
    if (series.length < 2) return;
    const raw = series.map((x) => ({ label: fmtDayMonth(x.date), date: x.date, value: shownVal(d, x[key]) }));
    // Long series as weekly means (median per calendar week) – daily values would be mere noise.
    const points = raw.length > 150 ? weeklyMedian(raw) : raw;
    // "HRV (RMSSD)" + unit → "HRV (RMSSD, ms)" instead of double parentheses.
    const unit = shownUnit(d);
    const head = !unit ? d.label : d.label.endsWith(')') ? `${d.label.slice(0, -1)}, ${unit})` : `${d.label} (${unit})`;
    view.appendChild(sectionHead(head));
    const card = el('div', { class: 'card' });
    card.appendChild(lineChart(points, {
      label: head,
      target: key === 'weight' && d.target != null ? shownVal(d, d.target) : null,
      targetLabel: key === 'weight' && d.target != null ? t('healthView.targetKg', { target: fmtWeightDec(d.target) }) : '',
      unit,
      fmt: (v) => fmtNum(v, d.digits),
    }));
    view.appendChild(card);
  });

  // Latest entries
  view.appendChild(sectionHead(t('healthView.entries')));
  const list = el('div', { class: 'list-card' });
  data.slice().reverse().slice(0, 12).forEach((entry) => {
    const parts = [];
    if (entry.weight != null) parts.push(fmtWeight(entry.weight));
    if (entry.restingHr != null) parts.push(`${entry.restingHr} bpm`);
    if (entry.sleepHours != null) parts.push(`${fmtNum(entry.sleepHours, 1)} h`);
    list.appendChild(el('button', { class: 'list-item', style: { width: '100%', textAlign: 'left' }, onclick: () => openHealthEntry(entry) }, [
      el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('heart') }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: fmtDayMonth(entry.date) }),
        el('div', { class: 'list-item__sub', text: parts.join(' · ') || t('healthView.entry') }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('edit') }),
    ]));
  });
  view.appendChild(list);
}

function deltaColor(d, delta) {
  if (delta === 0) return 'var(--text-3)';
  if (!d.toward) return 'var(--text-2)';   // neutral without a target direction
  const improving = (d.toward === 'down' && delta < 0) || (d.toward === 'up' && delta > 0);
  return improving ? 'var(--good)' : 'var(--text-2)'; // neutral: no "red"
}

/* ----------------------------- Recording -------------------------------- */
function soberCard(streak) {
  const medal = streak >= 100 ? '🏆' : streak >= 30 ? '💎' : streak >= 7 ? '🌿' : '🫧';
  const msg = streak >= 30 ? t('healthView.soberStrong') : streak >= 7 ? t('healthView.soberWeek') : t('healthView.soberKeepGoing');
  return el('div', { class: 'card mb-3', style: { borderLeft: '3px solid var(--good)' } }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.9rem', lineHeight: '1' }, text: medal }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '750' }, text: tp('healthView.alcoholFreeDays', streak) }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: msg }),
      ]),
    ]),
  ]);
}

export function openHealthEntry(existing = {}) {
  const enabled = store.settings().metricsEnabled || {};
  const defs = metricsDef();
  const date = existing.date || todayStr();
  // One entry per date. The fields ALWAYS show the entry of the selected day –
  // also after a date change in the dialog. Previously the entry of the opening day
  // stayed bound and was moved to the new date on saving (data loss).
  const entryFor = (d) => store.get('health').find((h) => h.date === d)
    || (existing.id && existing.date === d ? existing : {});
  let current = entryFor(date);

  const dateI = input({ type: 'date', value: date });
  const inputs = {};
  const fields = [field(t('healthView.date'), dateI)];
  // HRV measurement method: Apple supplies SDNN, many watches and rings RMSSD – not comparable.
  const methodSel = el('select', { class: 'select', 'aria-label': t('healthView.hrvMethodLabel') },
    Object.entries(HRV_METHODS).map(([v, l]) => el('option', { value: v, text: v === 'sdnn' ? t('healthView.methodApple', { method: l }) : t('healthView.methodWatch', { method: l }) })));
  const defaultMethod = () => current.hrvMethod || (defs.hrv.method && defs.hrv.method !== 'unbekannt' ? defs.hrv.method : 'rmssd');
  methodSel.value = defaultMethod();
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const inp = input({ type: 'number', step: d.digits ? '0.1' : '1', inputmode: 'decimal', value: fieldValue(d, current[key]), placeholder: shownUnit(d) || '' });
    inputs[key] = inp;
    if (key === 'hrv') {
      fields.push(el('div', { class: 'field__row' }, [field('HRV (ms)', inp), field(t('healthView.method'), methodSel)]));
    } else {
      fields.push(field(`${d.label}${shownUnit(d) ? ' (' + shownUnit(d) + ')' : ''}`, inp));
    }
  });
  const notesI = textarea({ value: current.notes ?? '', placeholder: t('healthView.notesPlaceholder') });
  let alcohol = !!current.alcohol;
  const alcoholToggle = toggle(alcohol, (v) => { alcohol = v; }, t('healthView.alcohol'));
  const alcoholInput = alcoholToggle.querySelector('input');
  // The toggle belongs in its own row (label left, switch right) – not in
  // a block `field`, otherwise the switch covers the label.
  fields.push(el('div', { class: 'row row--between', style: { marginBottom: 'var(--sp-4)' } }, [
    el('span', { class: 'field__label', style: { marginBottom: '0' }, text: t('healthView.alcohol') }),
    alcoholToggle,
  ]));
  fields.push(field(t('healthView.notes'), notesI));

  // Date changed -> load the values of this day (or clear them if there are none yet).
  const loadDay = () => {
    current = entryFor(dateI.value || date);
    Object.entries(inputs).forEach(([k, inp]) => { inp.value = fieldValue(defs[k], current[k]); });
    methodSel.value = defaultMethod();
    notesI.value = current.notes ?? '';
    alcohol = !!current.alcohol;
    if (alcoholInput) alcoholInput.checked = alcohol;
  };
  dateI.addEventListener('change', loadDay);
  dateI.addEventListener('input', loadDay);

  openSheet({
    title: t('healthView.logValues'),
    body: el('div', {}, fields),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('healthView.save'),
        onclick: () => {
          const d = dateI.value || date;
          // Always write the record of the SELECTED day (or create a new one) –
          // the entry of the opening day stays unchanged.
          const base = entryFor(d);
          const rec = { ...base, id: base.id || uid('h'), date: d, source: base.source || 'manual', notes: notesI.value.trim() };
          Object.entries(inputs).forEach(([k, inp]) => {
            // Masses typed in kg or lb are stored in kg (unchanged fields keep the stored value).
            if (defs[k].mass) { rec[k] = fromInput(inp.value, 'weight', base[k]); return; }
            const v = inp.value === '' ? null : parseFloat(inp.value);
            rec[k] = Number.isNaN(v) ? null : v;
          });
          rec.hrvMethod = rec.hrv != null ? methodSel.value : null;
          // Muscle mass entered by hand is real muscle mass (scale) – also on a day
          // with Apple values whose old "muscle mass" is read as fat-free mass.
          if (rec.muscleMass != null) rec.muscleMassManual = true; else delete rec.muscleMassManual;
          rec.alcohol = alcohol;
          store.upsert('health', rec);
          closeSheet();
          toast(t('healthView.saved'), 'good');
          refreshView();
        },
      }),
    ],
  });
}
