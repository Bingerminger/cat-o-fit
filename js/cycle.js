/* =========================================================================
   cycle.js — Zykluskalender (zyklusbewusste, rücksichtsvolle Trainingsplanung).
   - Nutzerin markiert Periodenstarts; daraus werden Zykluslänge, aktuelle
     Phase und die Prognose der nächsten Periode berechnet.
   - Menstruationstage sind „geschützt": Einheiten lassen sich dort schadfrei
     verschieben/auslassen (kein Adherence-/Momentum-Malus). Wer trotzdem
     trainiert, erhält das Badge „Harte Kämpferin".
   - Sensible Daten bleiben lokal; das Modul ist opt-in (Einstellungen).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, todayStr, addDays, diffDays,
  fmtDate, fmtDateLong, sectionHead, toast, openSheet, closeSheet, field, input, confirmDialog,
} from './ui.js';
import { setHeader } from './router.js';
import { moduleOff } from './nutrition.js';
import { gentleVariant } from './rolling.js';
import { applyAdapt } from './adapt.js';

export const PHASE_META = {
  menstruation: { label: 'Menstruation', color: '#ef5d6c', emoji: '🩸' },
  follikel:     { label: 'Follikelphase', color: '#43c59e', emoji: '🌱' },
  ovulation:    { label: 'Ovulation', color: '#f5a623', emoji: '⭐' },
  luteal:       { label: 'Lutealphase', color: '#7c5cff', emoji: '🌙' },
};

/** Ist das Zyklus-Modul aktiv? (Standard an; in den Einstellungen abschaltbar) */
// Zyklus ist beim Verwalten eines Mitglieds (Admin) inaktiv – die Daten bleiben
// privat (kein Phasen-Einfluss auf Dashboard/Badges). In der eigenen Sicht normal.
// Konsistent mit allen Modulen: aktiv, solange nicht ausdrücklich abgewählt.
export function cycleEnabled() { return !store.isManaging() && store.settings().modules?.cycle !== false; }

function entries() { return store.get('cycle').slice().sort((a, b) => a.startDate.localeCompare(b.startDate)); }

/** Durchschnittliche Zykluslänge aus den Abständen der Periodenstarts. */
export function avgCycleLength() {
  const e = entries();
  const fallback = store.settings().cycleLength || 28;
  if (e.length < 2) return fallback;
  const diffs = [];
  for (let i = 1; i < e.length; i++) diffs.push(diffDays(e[i - 1].startDate, e[i].startDate));
  const valid = diffs.filter((d) => d >= 18 && d <= 40);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : fallback;
}
export function avgPeriodLength() {
  const ps = entries().map((x) => x.periodLength).filter(Boolean);
  return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : (store.settings().periodLength || 5);
}
function lastStart() { const e = entries(); return e.length ? e.at(-1).startDate : null; }

export function nextPredictedStart() {
  const last = lastStart();
  if (!last) return null;
  const cl = avgCycleLength();
  let s = last;
  const today = todayStr();
  while (s <= today) s = addDays(s, cl);
  return s;
}

/** Relevanter Zyklusstart (echt oder prognostiziert) <= Datum. */
function cycleStartFor(dateStr) {
  const e = entries();
  if (!e.length) return null;
  const cl = avgCycleLength();
  let best = null;
  for (const x of e) if (x.startDate <= dateStr) best = x.startDate;
  if (best) { while (addDays(best, cl) <= dateStr) best = addDays(best, cl); return best; }
  // Datum vor allen Einträgen -> rückwärts prognostizieren.
  let s = e[0].startDate;
  while (s > dateStr) s = addDays(s, -cl);
  return s;
}

/** Phase eines Datums. @returns {{phase,cycleDay,cycleLength,periodLength,predicted}|null} */
export function cyclePhase(dateStr) {
  if (!cycleEnabled()) return null;
  const start = cycleStartFor(dateStr);
  if (!start) return null;
  const cl = avgCycleLength(), pl = avgPeriodLength();
  const day = diffDays(start, dateStr);
  if (day < 0 || day >= cl + 3) return null;
  const isReal = entries().some((x) => x.startDate === start);
  let phase;
  if (day < pl) phase = 'menstruation';
  else if (day >= cl - 15 && day <= cl - 13) phase = 'ovulation';
  else if (day < cl - 14) phase = 'follikel';
  else phase = 'luteal';
  return { phase, cycleDay: day + 1, cycleLength: cl, periodLength: pl, predicted: !isReal, start };
}

/** Geschützter Tag = Menstruation (echt oder prognostiziert). */
export function isProtectedDay(dateStr) {
  const p = cyclePhase(dateStr);
  return !!(p && p.phase === 'menstruation');
}

/* ------------------------------ Eingabe --------------------------------- */
function addPeriodStart(dateStr, periodLength) {
  store.upsert('cycle', { id: uid('cyc'), startDate: dateStr, periodLength: periodLength || avgPeriodLength(), createdAt: nowIso() });
}

/* ---------------- Automatische Entschärfung am 1. Periodentag (#3) --------------- */
// Diese Typen bleiben unangetastet: schon locker/Ruhe – oder ein Wettkampf (nie
// automatisch entschärfen). Feste Termine (Fußball/Spiele) werden separat über
// `!u.fixed` ausgeschlossen.
const CYCLE_SKIP_TYPES = ['rest', 'recovery', 'mobility', 'walk', 'race'];

/**
 * Einheiten am 1. Periodentag, die für die automatische Entschärfung infrage kommen:
 * offen (geplant), kein fester Termin, nicht ohnehin locker/Ruhe/Wettkampf. Reine
 * Funktion (testbar) über die Einheiten EINES Plans.
 */
export function cycleSoftenTargets(units = [], startDate) {
  return (units || []).filter((u) => u && u.date === startDate && !u.fixed
    && (u.status === 'geplant' || u.status == null)
    && !CYCLE_SKIP_TYPES.includes(u.type));
}

/** Zyklus-Entschärfung einer Einheit (Patch-Felder) – lockerer Tag mit Markierung. */
export function cycleEaseVariant(unit) {
  return {
    ...gentleVariant(unit, {
      title: 'Ruhiger Zyklus-Tag',
      description: 'Automatisch entschärft: 1. Tag deiner Periode. Bewusst locker – trainiere nur, wenn es sich gut anfühlt, sonst ohne Wertung auslassen. Die ursprüngliche Einheit holst du erholter nach. Rückgängig über „Zuletzt automatisch angepasst" auf „Heute".',
    }),
    cycleEased: true,
  };
}

/**
 * Entschärft beim Eintragen eines Periodenbeginns automatisch das Training am 1. Tag
 * – planübergreifend, protokolliert je Plan und über den Snapshot rückgängig (#3).
 * @returns {number} Anzahl entschärfter Einheiten.
 */
function applyCycleEasing(startDate) {
  if (!cycleEnabled()) return 0;
  let n = 0;
  store.get('plans').forEach((plan) => {
    const targets = cycleSoftenTargets(plan.units || [], startDate);
    if (!targets.length) return;
    applyAdapt(plan.id, targets.map((u) => u.id), (u) => cycleEaseVariant(u), {
      kind: 'cycle', title: 'Zyklus: 1. Tag entschärft',
      reason: `Periodenbeginn am ${fmtDate(startDate)} – Training am 1. Tag automatisch ruhiger.`,
    });
    n += targets.length;
  });
  return n;
}

/* ------------------------------- Ansicht -------------------------------- */
export function render(view) {
  setHeader({ title: 'Zyklus' });

  // Datenschutz: Zyklusdaten sind ausschließlich für die Person selbst sichtbar.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: 'Privat' }),
      el('div', { class: 'muted', style: { maxWidth: '320px', margin: '0 auto' }, text: `Zyklusdaten sind privat und nur für ${who ? who.name : 'das Mitglied'} selbst sichtbar – auch für Admins.` }),
    ]));
    return;
  }

  // Modul abgewählt (Einstellungen → Module): wie alle Module deaktiviert anzeigen.
  if (!cycleEnabled()) {
    view.appendChild(moduleOff('Zykluskalender'));
    return;
  }

  const today = todayStr();
  const hasData = entries().length > 0;
  const phase = cyclePhase(today);

  // Aktuelle Phase
  if (phase) {
    const pm = PHASE_META[phase.phase];
    view.appendChild(el('div', { class: 'hero', style: { background: `linear-gradient(140deg, ${pm.color}, color-mix(in srgb, ${pm.color} 70%, #000))` } }, [
      el('div', { class: 'hero__eyebrow', text: `Zyklustag ${phase.cycleDay} · Ø ${phase.cycleLength} Tage` }),
      el('div', { class: 'hero__title', text: `${pm.emoji} ${pm.label}` }),
      el('div', { style: { opacity: '.92', fontSize: '.9rem', position: 'relative' }, text: phaseTip(phase.phase) }),
    ]));
    const np = nextPredictedStart();
    if (np) {
      const inDays = diffDays(today, np);
      view.appendChild(el('div', { class: 'card mt-4 row gap-3', style: { alignItems: 'center' } }, [
        el('span', { style: { fontSize: '1.6rem' }, text: '🩸' }),
        el('div', { class: 'grow' }, [
          el('div', { style: { fontWeight: '700' }, text: inDays > 0 ? `Nächste Periode in ${inDays} Tagen` : 'Periode könnte heute beginnen' }),
          el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `voraussichtlich ${fmtDate(np)} (Prognose)` }),
        ]),
      ]));
    }
  } else {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Noch keine Periode erfasst. Markiere deinen letzten Periodenbeginn, dann berechnet Cat-O-Fit deine Phasen.' }));
  }

  // Eingabe
  view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openPeriodSheet(), }, [icon('plus'), 'Periodenbeginn eintragen']));

  // Phasen-Vorschau der nächsten 28 Tage
  if (hasData) {
    view.appendChild(sectionHead('Nächste 4 Wochen'));
    const strip = el('div', { class: 'cycle-strip' });
    for (let i = 0; i < 28; i++) {
      const d = addDays(today, i);
      const p = cyclePhase(d);
      const c = p ? PHASE_META[p.phase].color : 'var(--surface-3)';
      strip.appendChild(el('span', { class: `cycle-strip__day ${i === 0 ? 'is-today' : ''}`, style: { background: c, opacity: p && p.predicted ? '0.55' : '1' }, title: p ? `${fmtDate(d)} · ${PHASE_META[p.phase].label}` : fmtDate(d) }));
    }
    view.appendChild(strip);
    view.appendChild(legend());
  }

  // Einträge
  if (hasData) {
    view.appendChild(sectionHead('Erfasste Perioden'));
    const list = el('div', { class: 'list-card' });
    entries().slice().reverse().forEach((e) => list.appendChild(el('div', { class: 'list-item' }, [
      el('span', { style: { fontSize: '1.1rem' }, text: '🩸' }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: fmtDate(e.startDate) }),
        el('div', { class: 'list-item__sub', text: `${e.periodLength || avgPeriodLength()} Tage` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': 'Löschen', onclick: async () => { if (await confirmDialog({ title: 'Eintrag löschen?', confirmLabel: 'Löschen', danger: true })) { store.remove('cycle', e.id); rerender(); } } }, icon('trash')),
    ])));
    view.appendChild(list);
  }

  // Info
  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'An deinen Menstruationstagen kannst du Einheiten ohne Wertung verschieben oder auslassen – sie zählen nicht als verpasst. Trainierst du trotzdem, gibt es ein Extra-Abzeichen. Alle Daten bleiben lokal und das Modul ist in den Einstellungen abschaltbar.' }),
  ]));
}

function phaseTip(phase) {
  return {
    menstruation: 'Hör auf deinen Körper – lockere Einheiten oder Pause sind völlig okay.',
    follikel: 'Energie steigt – gute Zeit für intensivere Einheiten.',
    ovulation: 'Oft Leistungshoch – ideal für Tempo und Wettkampftempo.',
    luteal: 'Etwas ruhiger angehen, auf Erholung und Schlaf achten.',
  }[phase] || '';
}

function legend() {
  return el('div', { class: 'row wrap gap-3 mt-3', style: { justifyContent: 'center' } },
    Object.values(PHASE_META).map((m) => el('span', { class: 'zones-legend__item' }, [
      el('span', { class: 'zones-legend__sw', style: { background: m.color } }), m.label,
    ])));
}

function openPeriodSheet() {
  const dateI = input({ type: 'date', value: todayStr() });
  const lenI = input({ type: 'number', inputmode: 'numeric', value: avgPeriodLength(), min: '1', max: '10' });
  openSheet({
    title: 'Periodenbeginn eintragen',
    body: el('div', {}, [
      field('Erster Tag der Periode', dateI),
      field('Dauer (Tage)', lenI),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: 'Speichern', onclick: () => {
        addPeriodStart(dateI.value, parseInt(lenI.value) || 5);
        // Training am 1. Periodentag automatisch entschärfen (#3) – protokolliert & rückgängig.
        const eased = applyCycleEasing(dateI.value);
        closeSheet();
        toast(eased ? `Gespeichert · Training am 1. Tag entschärft (${eased})` : 'Gespeichert', 'good', eased ? 3600 : undefined);
        rerender();
      } }),
    ],
  });
}

function rerender() { const v = document.getElementById('view'); v.innerHTML = ''; render(v); }
