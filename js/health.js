/* =========================================================================
   health.js — Körperwerte (Health-Log): Trends, Charts, Erfassung.
   Darstellung bewusst wertfrei (Trend, keine starren Vorgaben). Metriken
   einzeln abschaltbar (Profil-Einstellungen).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, fmtNum, fmtDayMonth, todayStr, sectionHead,
  emptyState, toast, openSheet, closeSheet, field, input, textarea, navigate, toggle,
} from './ui.js';
import { setHeader } from './router.js';
import { lineChart } from './charts.js';
import { alcoholFreeStreak } from './badges.js';

function metricsDef() {
  const p = store.profile();
  return {
    weight: { label: 'Gewicht', unit: 'kg', icon: 'scale', digits: 1, target: p.targetWeightKg, toward: 'down' },
    bodyFat: { label: 'Körperfett', unit: '%', icon: 'drop', digits: 1, toward: 'down' },
    muscleMass: { label: 'Muskelmasse', unit: 'kg', icon: 'dumbbell', digits: 1, toward: 'up' },
    visceralFat: { label: 'Viszeralfett', unit: '', icon: 'info', digits: 0, toward: 'down' },
    restingHr: { label: 'Ruhepuls', unit: 'bpm', icon: 'heart', digits: 0, toward: 'down' },
    hrv: { label: 'HRV', unit: 'ms', icon: 'activity', digits: 0, toward: 'up' },
    vo2max: { label: 'VO₂max', unit: '', icon: 'gauge', digits: 1, toward: 'up' },
    sleepHours: { label: 'Schlaf', unit: 'h', icon: 'bed', digits: 1, toward: 'up' },
    energy: { label: 'Energie', unit: '/10', icon: 'sun', digits: 0, toward: 'up' },
    mood: { label: 'Stimmung', unit: '/10', icon: 'sparkles', digits: 0, toward: 'up' },
  };
}

function sortedHealth() {
  return store.get('health').slice().sort((a, b) => a.date.localeCompare(b.date));
}

export function render(view) {
  setHeader({
    title: 'Körperwerte',
    actions: [
      { icon: 'upload', label: 'Health-Import', onClick: () => navigate('#/import') },
      { icon: 'plus', label: 'Erfassen', onClick: () => openHealthEntry({}) },
    ],
  });

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

  // Kachel-Übersicht der aktuellen Werte
  const grid = el('div', { class: 'stat-grid' });
  ['weight', 'bodyFat', 'muscleMass', 'restingHr'].forEach((key) => {
    if (enabled[key] === false) return;
    const series = data.filter((d) => d[key] != null);
    if (!series.length) return;
    const last = series.at(-1)[key];
    const prev = series.length > 1 ? series.at(-2)[key] : null;
    const d = defs[key];
    const delta = prev != null ? last - prev : null;
    grid.appendChild(el('div', { class: 'metric-tile' }, [
      el('div', { class: 'metric-tile__top' }, [
        el('span', { class: 'metric-tile__name', text: d.label }),
        el('span', { html: iconSvg(d.icon), style: { width: '16px', color: 'var(--text-3)' } }),
      ]),
      el('div', { class: 'metric-tile__val num', text: `${fmtNum(last, d.digits)}${d.unit ? ' ' + d.unit : ''}` }),
      delta != null ? el('div', { class: 'metric-tile__delta', style: { color: deltaColor(d, delta) }, text: `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${fmtNum(Math.abs(delta), d.digits)}` }) : el('div', { class: 'metric-tile__delta dim', text: '—' }),
    ]));
  });
  view.appendChild(grid);

  // Charts je aktivierter Metrik mit Verlauf
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const series = data.filter((x) => x[key] != null);
    if (series.length < 2) return;
    const points = series.map((x) => ({ label: fmtDayMonth(x.date), value: x[key] }));
    view.appendChild(sectionHead(`${d.label}${d.unit ? ' (' + d.unit + ')' : ''}`));
    const card = el('div', { class: 'card' });
    card.appendChild(lineChart(points, {
      target: key === 'weight' ? d.target : null,
      targetLabel: key === 'weight' ? `Ziel ${d.target} kg` : '',
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
  const improving = (d.toward === 'down' && delta < 0) || (d.toward === 'up' && delta > 0);
  return improving ? 'var(--good)' : 'var(--text-2)'; // wertfrei: kein „rot"
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
  // Existierenden Eintrag des Tages finden (ein Eintrag je Datum).
  const sameDay = store.get('health').find((h) => h.date === date) || existing;

  const dateI = input({ type: 'date', value: date });
  const inputs = {};
  const fields = [field('Datum', dateI)];
  Object.entries(defs).forEach(([key, d]) => {
    if (enabled[key] === false) return;
    const inp = input({ type: 'number', step: d.digits ? '0.1' : '1', inputmode: 'decimal', value: sameDay[key] ?? '', placeholder: d.unit || '' });
    inputs[key] = inp;
    fields.push(field(`${d.label}${d.unit ? ' (' + d.unit + ')' : ''}`, inp));
  });
  const notesI = textarea({ value: sameDay.notes ?? '', placeholder: 'Bemerkungen …' });
  let alcohol = !!sameDay.alcohol;
  // Toggle gehört in eine eigene Zeile (Label links, Schalter rechts) – nicht in
  // ein block-`field`, sonst überdeckt der Schalter das Label.
  fields.push(el('div', { class: 'row row--between', style: { marginBottom: 'var(--sp-4)' } }, [
    el('span', { class: 'field__label', style: { marginBottom: '0' }, text: 'Alkohol getrunken' }),
    toggle(alcohol, (v) => { alcohol = v; }),
  ]));
  fields.push(field('Bemerkungen', notesI));

  openSheet({
    title: 'Körperwerte erfassen',
    body: el('div', {}, fields),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          const d = dateI.value;
          const rec = { ...sameDay, id: sameDay.id || uid('h'), date: d, source: sameDay.source || 'manual', notes: notesI.value.trim() };
          Object.entries(inputs).forEach(([k, inp]) => {
            const v = inp.value === '' ? null : parseFloat(inp.value);
            rec[k] = Number.isNaN(v) ? null : v;
          });
          rec.alcohol = alcohol;
          store.upsert('health', rec);
          closeSheet();
          toast('Werte gespeichert', 'good');
          if (location.hash === '#/health') setTimeout(() => location.reload(), 60);
        },
      }),
    ],
  });
}
