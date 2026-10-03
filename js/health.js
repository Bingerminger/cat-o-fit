/* =========================================================================
   health.js — Körperwerte (Health-Log): Trends, Charts, Erfassung.
   Darstellung bewusst wertfrei (Trend, keine starren Vorgaben). Metriken
   einzeln abschaltbar (Profil-Einstellungen).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, fmtNum, fmtDayMonth, todayStr, sectionHead,
  emptyState, toast, openSheet, closeSheet, field, input, textarea, navigate, toggle,
  refreshView, segmented, addDays, weekStartMonday,
} from './ui.js';
import { setHeader } from './router.js';
import { progressTabs } from './nav.js';
import { lineChart } from './charts.js';
import { alcoholFreeStreak } from './healthdata.js';
import { smoothedChange } from './fitness.js';
import { weightNow, weightGoalStatus } from './energy.js';
import { currentEligibility } from './wellness.js';
import { currentHrvMethod, withHrvMethod, hrvLabel, HRV_METHODS } from './healthdata.js';

function metricsDef() {
  const p = store.profile();
  const elig = currentEligibility();
  // Gewicht: „besser“ ist die Richtung zum Zielgewicht (abnehmen ODER zunehmen) – ohne Ziel,
  // am Ziel oder ohne Gewichtsziele (Kinder, Schwangerschaft, Essstörung) bleibt die Farbe neutral.
  const target = elig.noWeightGoals ? null : p.targetWeightKg;
  const gs = target != null
    ? weightGoalStatus({ current: weightNow(store.get('health'), p), target, start: p.targetWeightStartKg != null ? p.targetWeightStartKg : p.weightKg })
    : null;
  const weightToward = gs && gs.status !== 'halten' && gs.direction !== 'hold' ? gs.direction : null;
  // HRV: Beschriftung nach der Messart des jüngsten Werts (SDNN von Apple, RMSSD von vielen Uhren).
  const hrvMethod = currentHrvMethod(store.get('health'));
  return {
    weight: { label: 'Gewicht', unit: 'kg', icon: 'scale', digits: 1, target, toward: weightToward },
    bodyFat: { label: 'Körperfett', unit: '%', icon: 'drop', digits: 1, toward: null },
    muscleMass: { label: 'Muskelmasse', unit: 'kg', icon: 'dumbbell', digits: 1, toward: 'up' },
    leanMass: { label: 'Fettfreie Masse', unit: 'kg', icon: 'dumbbell', digits: 1, toward: null },
    visceralFat: { label: 'Viszeralfett', unit: '', icon: 'info', digits: 0, toward: 'down' },
    restingHr: { label: 'Ruhepuls', unit: 'bpm', icon: 'heart', digits: 0, toward: 'down' },
    hrv: { label: hrvLabel(hrvMethod), unit: 'ms', icon: 'activity', digits: 0, toward: 'up', method: hrvMethod },
    vo2max: { label: 'VO₂max', unit: '', icon: 'gauge', digits: 1, toward: 'up' },
    sleepHours: { label: 'Schlaf', unit: 'h', icon: 'bed', digits: 1, toward: 'up' },
    energy: { label: 'Energie', unit: '/10', icon: 'sun', digits: 0, toward: 'up' },
    mood: { label: 'Stimmung', unit: '/10', icon: 'sparkles', digits: 0, toward: 'up' },
  };
}

function sortedHealth() {
  return store.get('health').slice().sort((a, b) => a.date.localeCompare(b.date));
}

/** Zeitraum der Verläufe; bleibt über das Neuzeichnen hinweg erhalten. */
const RANGES = [{ value: '3m', label: '3 Monate', days: 92 }, { value: '1y', label: '1 Jahr', days: 366 }, { value: 'all', label: 'Alles', days: null }];
const uiState = { range: '1y' };

/** Median je Kalenderwoche (Montag als Datum) – für lange Verläufe (FE-09). */
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
    title: 'Fortschritt',
    actions: [
      { icon: 'upload', label: 'Health-Import', onClick: () => navigate('#/import') },
      { icon: 'plus', label: 'Körperwerte erfassen', onClick: () => openHealthEntry({}) },
    ],
  });
  view.appendChild(progressTabs('#/health'));

  const data = sortedHealth();
  const enabled = store.settings().metricsEnabled || {};
  const defs = metricsDef();

  if (!data.length) {
    view.appendChild(emptyState('heart', 'Noch keine Werte', 'Erfasse deine ersten Körperwerte oder importiere sie aus Apple Health.'));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openHealthEntry({}) }, [icon('plus'), 'Werte erfassen']));
    return;
  }

  // Alkoholfreie Tage in Folge – nur wenn überhaupt ein Alkohol-Tag erfasst wurde.
  const sober = alcoholFreeStreak(store.get('health'));
  if (sober != null) view.appendChild(soberCard(sober));

  // Kachel-Übersicht der aktuellen Werte (Muskelmasse der Waage, sonst fettfreie Masse)
  const grid = el('div', { class: 'stat-grid stat-grid--pairs' });
  let anyDelta = false;
  const hasData = (k) => enabled[k] !== false && data.some((d) => d[k] != null);
  const tiles = ['weight', 'bodyFat', hasData('muscleMass') ? 'muscleMass' : 'leanMass', 'restingHr'];
  tiles.forEach((key) => {
    if (enabled[key] === false) return;
    const series = data.filter((d) => d[key] != null);
    if (!series.length) return;
    // Angezeigt: der zuletzt gemessene Wert. Veränderung: geglätteter Trend (7-Tage-Median),
    // damit Tagesschwankungen nicht als Fortschritt oder Rückschritt erscheinen.
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
      el('div', { class: 'metric-tile__val num', text: `${fmtNum(last, d.digits)}${d.unit ? ' ' + d.unit : ''}` }),
      delta != null
        ? el('div', { class: 'metric-tile__delta', title: `Wochenmittel gegenüber ${fmtDayMonth(ch.since)}`, style: { color: deltaColor(d, delta) }, text: `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${fmtNum(Math.abs(delta), d.digits)}` })
        : el('div', { class: 'metric-tile__delta dim', text: '—' }),
    ]));
  });
  view.appendChild(grid);
  if (anyDelta) view.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.72rem' }, text: '▲▼ = Veränderung des Wochenmittels (Median) gegenüber einer Messung mindestens eine Woche davor – so fallen Tagesschwankungen heraus.' }));

  // Zeitraum der Verläufe (bleibt beim Neuzeichnen stehen): 10 Jahre Apple-Health-Gewicht
  // waren sonst ein einziges Band ohne ablesbaren Zeitraum (FE-09).
  const range = RANGES.find((r) => r.value === uiState.range) || RANGES[1];
  const from = range.days ? addDays(todayStr(), -range.days) : null;
  view.appendChild(el('div', { class: 'row row--between mt-4', style: { flexWrap: 'wrap', gap: '8px' } }, [
    el('h2', { class: 'section-head__title', text: 'Verläufe' }),
    segmented(RANGES, range.value, (v) => { uiState.range = v; refreshView(); }, { label: 'Zeitraum der Verläufe' }),
  ]));

  // Charts je aktivierter Metrik mit Verlauf (HRV nur innerhalb einer Messart – SDNN und
  // RMSSD sind verschiedene Größen, ein Gerätewechsel sähe sonst wie ein Einbruch aus).
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const series = (key === 'hrv' ? withHrvMethod(data, d.method) : data)
      .filter((x) => x[key] != null && (!from || x.date >= from));
    if (series.length < 2) return;
    const raw = series.map((x) => ({ label: fmtDayMonth(x.date), date: x.date, value: x[key] }));
    // Lange Reihen als Wochenmittel (Median je Kalenderwoche) – Tageswerte wären nur Rauschen.
    const points = raw.length > 150 ? weeklyMedian(raw) : raw;
    // „HRV (RMSSD)“ + Einheit → „HRV (RMSSD, ms)“ statt doppelter Klammern.
    const head = !d.unit ? d.label : d.label.endsWith(')') ? `${d.label.slice(0, -1)}, ${d.unit})` : `${d.label} (${d.unit})`;
    view.appendChild(sectionHead(head));
    const card = el('div', { class: 'card' });
    card.appendChild(lineChart(points, {
      label: head,
      target: key === 'weight' && d.target != null ? d.target : null,
      targetLabel: key === 'weight' && d.target != null ? `Ziel ${d.target} kg` : '',
      unit: d.unit,
      fmt: (v) => fmtNum(v, d.digits),
    }));
    view.appendChild(card);
  });

  // Letzte Einträge
  view.appendChild(sectionHead('Einträge'));
  const list = el('div', { class: 'list-card' });
  data.slice().reverse().slice(0, 12).forEach((entry) => {
    const parts = [];
    if (entry.weight != null) parts.push(`${fmtNum(entry.weight, 1)} kg`);
    if (entry.restingHr != null) parts.push(`${entry.restingHr} bpm`);
    if (entry.sleepHours != null) parts.push(`${fmtNum(entry.sleepHours, 1)} h`);
    list.appendChild(el('button', { class: 'list-item', style: { width: '100%', textAlign: 'left' }, onclick: () => openHealthEntry(entry) }, [
      el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('heart') }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: fmtDayMonth(entry.date) }),
        el('div', { class: 'list-item__sub', text: parts.join(' · ') || 'Eintrag' }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('edit') }),
    ]));
  });
  view.appendChild(list);
}

function deltaColor(d, delta) {
  if (delta === 0) return 'var(--text-3)';
  if (!d.toward) return 'var(--text-2)';   // ohne Zielrichtung wertfrei
  const improving = (d.toward === 'down' && delta < 0) || (d.toward === 'up' && delta > 0);
  return improving ? 'var(--good)' : 'var(--text-2)'; // wertfrei: kein „rot“
}

/* ----------------------------- Erfassung -------------------------------- */
function soberCard(streak) {
  const medal = streak >= 100 ? '🏆' : streak >= 30 ? '💎' : streak >= 7 ? '🌿' : '🫧';
  const msg = streak >= 30 ? 'Stark – das tut Schlaf und Regeneration gut!' : streak >= 7 ? 'Schöne klare Woche!' : 'Weiter so – jeder Tag zählt.';
  return el('div', { class: 'card mb-3', style: { borderLeft: '3px solid var(--good)' } }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.9rem', lineHeight: '1' }, text: medal }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '750' }, text: `${streak} ${streak === 1 ? 'Tag' : 'Tage'} alkoholfrei` }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: msg }),
      ]),
    ]),
  ]);
}

export function openHealthEntry(existing = {}) {
  const enabled = store.settings().metricsEnabled || {};
  const defs = metricsDef();
  const date = existing.date || todayStr();
  // Ein Eintrag je Datum. Die Felder zeigen IMMER den Eintrag des gewählten Tages –
  // auch nach einem Datumswechsel im Dialog. Früher blieb der Eintrag des Öffnungstags
  // gebunden und wurde beim Speichern auf das neue Datum verschoben (Datenverlust).
  const entryFor = (d) => store.get('health').find((h) => h.date === d)
    || (existing.id && existing.date === d ? existing : {});
  let current = entryFor(date);

  const dateI = input({ type: 'date', value: date });
  const inputs = {};
  const fields = [field('Datum', dateI)];
  // HRV-Messart: Apple liefert SDNN, viele Uhren und Ringe RMSSD – beides nicht vergleichbar.
  const methodSel = el('select', { class: 'select', 'aria-label': 'HRV-Messart' },
    Object.entries(HRV_METHODS).map(([v, l]) => el('option', { value: v, text: v === 'sdnn' ? `${l} (Apple)` : `${l} (z. B. Garmin, Polar, Oura)` })));
  const defaultMethod = () => current.hrvMethod || (defs.hrv.method && defs.hrv.method !== 'unbekannt' ? defs.hrv.method : 'rmssd');
  methodSel.value = defaultMethod();
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const inp = input({ type: 'number', step: d.digits ? '0.1' : '1', inputmode: 'decimal', value: current[key] ?? '', placeholder: d.unit || '' });
    inputs[key] = inp;
    if (key === 'hrv') {
      fields.push(el('div', { class: 'field__row' }, [field('HRV (ms)', inp), field('Messart', methodSel)]));
    } else {
      fields.push(field(`${d.label}${d.unit ? ' (' + d.unit + ')' : ''}`, inp));
    }
  });
  const notesI = textarea({ value: current.notes ?? '', placeholder: 'Bemerkungen …' });
  let alcohol = !!current.alcohol;
  const alcoholToggle = toggle(alcohol, (v) => { alcohol = v; }, 'Alkohol getrunken');
  const alcoholInput = alcoholToggle.querySelector('input');
  // Toggle gehört in eine eigene Zeile (Label links, Schalter rechts) – nicht in
  // ein block-`field`, sonst überdeckt der Schalter das Label.
  fields.push(el('div', { class: 'row row--between', style: { marginBottom: 'var(--sp-4)' } }, [
    el('span', { class: 'field__label', style: { marginBottom: '0' }, text: 'Alkohol getrunken' }),
    alcoholToggle,
  ]));
  fields.push(field('Bemerkungen', notesI));

  // Datum gewechselt -> Werte dieses Tages laden (oder leeren, wenn es noch keine gibt).
  const loadDay = () => {
    current = entryFor(dateI.value || date);
    Object.entries(inputs).forEach(([k, inp]) => { inp.value = current[k] ?? ''; });
    methodSel.value = defaultMethod();
    notesI.value = current.notes ?? '';
    alcohol = !!current.alcohol;
    if (alcoholInput) alcoholInput.checked = alcohol;
  };
  dateI.addEventListener('change', loadDay);
  dateI.addEventListener('input', loadDay);

  openSheet({
    title: 'Körperwerte erfassen',
    body: el('div', {}, fields),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          const d = dateI.value || date;
          // Immer den Datensatz des GEWÄHLTEN Tages schreiben (oder neu anlegen) –
          // der Eintrag des Öffnungstags bleibt unverändert.
          const base = entryFor(d);
          const rec = { ...base, id: base.id || uid('h'), date: d, source: base.source || 'manual', notes: notesI.value.trim() };
          Object.entries(inputs).forEach(([k, inp]) => {
            const v = inp.value === '' ? null : parseFloat(inp.value);
            rec[k] = Number.isNaN(v) ? null : v;
          });
          rec.hrvMethod = rec.hrv != null ? methodSel.value : null;
          // Von Hand eingetragene Muskelmasse ist echte Muskelmasse (Waage) – auch an einem Tag
          // mit Apple-Werten, deren alte „Muskelmasse“ als fettfreie Masse gelesen wird.
          if (rec.muscleMass != null) rec.muscleMassManual = true; else delete rec.muscleMassManual;
          rec.alcohol = alcohol;
          store.upsert('health', rec);
          closeSheet();
          toast('Werte gespeichert', 'good');
          refreshView();
        },
      }),
    ],
  });
}
