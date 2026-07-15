/* =========================================================================
   session.js — Trainingssession-View mit drei Zuständen:
     geplant (Soll + "Training starten") · Auswertung (Soll-Ist) · Ruhetag.
   Exportiert zudem die Einheiten-Mutationen, die der Workout-Modus nutzt.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, typeMeta, typeIcon, fmtKm, fmtPace,
  fmtPaceRange, fmtDuration, fmtDate, fmtDateLong, todayStr, parseHms,
  sectionHead, toast, confirmDialog, openSheet, closeSheet, field, input, textarea,
  select, FEELINGS, segmented, TYPE_OPTIONS, effectiveStatus, STATUS_META, isoDow,
} from './ui.js';
import { setHeader } from './router.js';
import { openIcsSheet } from './ics-export.js';
import { openHealthEntry } from './health.js';
import { weatherForDate, weatherHint, wmo } from './weather.js';
import { isProtectedDay, PHASE_META } from './cycle.js';
import { suggestOffsetUnit, weekLoad, rescheduleCheck } from './planflow.js';
import { simulateAdd, simulateMove, impactText } from './whatif.js';
import { suggestedExercisesFor, sortByUsage, openExercise, difficultyLabel } from './exercises.js';
import { exerciseArt } from './exercise-art.js';

/* ===================== Einheiten-Helfer (auch vom Workout-Modus genutzt) ===================== */
export function findUnit(id) {
  for (const plan of store.get('plans')) {
    const unit = (plan.units || []).find((u) => u.id === id);
    if (unit) return { plan, unit };
  }
  return null;
}
export function saveUnitPatch(planId, unitId, patch) {
  const plan = store.find('plans', planId);
  if (!plan) return;
  const units = (plan.units || []).map((u) => (u.id === unitId ? { ...u, ...patch } : u));
  store.patch('plans', plan.id, { units });
}

/** Erstellt aus einer geplanten Einheit eine durchgeführte Session. */
export function completeUnit(plan, unit, data) {
  const session = {
    id: uid('ses'),
    plannedId: unit.id,
    eventId: plan.eventId,
    date: unit.date,
    type: unit.type,
    title: unit.title,
    intensity: unit.intensity ?? null,  // Fußball-Intensität für Belastung/harten Tag (#5)
    distanceKm: data.distanceKm ?? null,
    durationSec: data.durationSec ?? null,
    paceSecPerKm: data.paceSecPerKm ?? (data.distanceKm && data.durationSec ? Math.round(data.durationSec / data.distanceKm) : null),
    avgHr: data.avgHr ?? null,
    maxHr: data.maxHr ?? null,
    rpe: data.rpe ?? null,
    feeling: data.feeling ?? null,
    timeInZones: data.timeInZones ?? null,
    splits: data.splits ?? [],
    source: data.source || 'manual',
    notes: data.notes || '',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.upsert('sessions', session);
  saveUnitPatch(plan.id, unit.id, { status: 'erledigt', executedSessionId: session.id });
  // Für die Einheit ausgewählte Übungen als genutzt zählen (Nutzungszähler).
  if (Array.isArray(unit.exerciseIds) && unit.exerciseIds.length) store.bumpExerciseUsage(unit.exerciseIds);
  return session;
}

/* ===================== View ===================== */
export function render(view, id) {
  // 1) Geplante Einheit?
  const found = findUnit(id);
  // 2) Oder eine frei erfasste, durchgeführte Session?
  const freeSession = !found ? store.find('sessions', id) : null;

  if (!found && !freeSession) {
    setHeader({ title: 'Einheit', back: true });
    view.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty__title', text: 'Einheit nicht gefunden' })]));
    return;
  }

  if (freeSession) return renderEvaluation(view, null, null, freeSession);

  const { plan, unit } = found;
  const executed = unit.executedSessionId ? store.find('sessions', unit.executedSessionId) : null;

  if (unit.type === 'rest') return renderRest(view, unit);
  if (executed || unit.status === 'erledigt') return renderEvaluation(view, plan, unit, executed);
  return renderPlanned(view, plan, unit);
}

/* --------------------------- Geplant (Soll) ----------------------------- */
function renderPlanned(view, plan, unit) {
  const m = typeMeta(unit.type);
  setHeader({
    title: m.label, subtitle: fmtDate(unit.date), back: true,
    actions: [
      { icon: 'edit', label: 'Bearbeiten', onClick: () => openUnitEditor(plan, unit) },
      { icon: 'download', label: 'Kalender', onClick: () => openIcsSheet({ unit, event: store.find('events', plan.eventId) }) },
    ],
  });

  view.appendChild(el('div', { class: 'session-hero' }, [
    typeIcon(unit.type, 'type-icon--lg'),
    el('div', { class: 'session-hero__body' }, [
      el('div', { class: 'session-hero__type', text: m.label }),
      el('div', { class: 'session-hero__title', text: unit.title }),
      el('div', { class: 'session-hero__date', text: fmtDateLong(unit.date) }),
    ]),
  ]));

  const protectedDay = isProtectedDay(unit.date);
  const eff0 = effectiveStatus(unit);
  const eff = (eff0 === 'ueberfaellig' && protectedDay) ? 'geplant' : eff0;
  const sm = STATUS_META[eff] || STATUS_META.geplant;
  view.appendChild(el('span', { class: `session-status session-status--${sm.cls}`, text: sm.label }));
  if (protectedDay) {
    view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start', borderLeft: `3px solid ${PHASE_META.menstruation.color}` } }, [
      el('span', { style: { fontSize: '1.1rem' }, text: '🩸' }),
      el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Dein Tag – diese Einheit kannst du ohne Wertung verschieben oder auslassen. Trainierst du trotzdem, gibt es ein Extra-Abzeichen 🥊.' }),
    ]));
  } else if (eff === 'ueberfaellig') {
    view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: '#f5a623', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: 'Diese Einheit liegt in der Vergangenheit. Du kannst sie noch erfassen, verschieben oder als verpasst markieren.' }),
    ]));
  }

  // Zielwerte
  const targets = [];
  if (unit.targetDistanceKm) targets.push(['Distanz', fmtKm(unit.targetDistanceKm, unit.targetDistanceKm % 1 ? 1 : 0)]);
  if (unit.targetDurationMin) targets.push(['Dauer', `${unit.targetDurationMin} min`]);
  if (unit.targetPaceSecPerKm) targets.push(['Zielpace', fmtPaceRange(unit.targetPaceSecPerKm, unit.targetPaceMaxSecPerKm)]);
  if (unit.targetHrZone) targets.push(['HF-Zone', `Zone ${unit.targetHrZone}`]);
  if (targets.length) {
    view.appendChild(el('div', { class: 'target-grid mt-4' },
      targets.map(([l, v]) => el('div', { class: 'target' }, [el('div', { class: 'target__label', text: l }), el('div', { class: 'target__val', text: v })]))));
  }

  if (unit.description) {
    view.appendChild(sectionHead('Beschreibung'));
    view.appendChild(el('div', { class: 'card card--flat', text: unit.description }));
  }

  // Wetter-Hinweis für den Trainingstag
  const w = weatherForDate(unit.date);
  const wh = w && weatherHint(unit, w);
  if (wh) {
    const color = wh.tone === 'warn' ? '#f5a623' : wh.tone === 'good' ? 'var(--good)' : 'var(--accent)';
    view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-3', style: { alignItems: 'flex-start', borderLeft: `3px solid ${color}` } }, [
      el('span', { style: { fontSize: '1.5rem', lineHeight: '1' }, text: wmo(w.code).emoji }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.9rem' }, text: `${w.tMin}–${w.tMax} °C · ${wmo(w.code).label}` }),
        el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: wh.text }),
      ]),
    ]));
  }

  // Passende Übungen aus der Bibliothek (nur bei Kraft/Mobility/Recovery vorhanden).
  renderUnitExercises(view, plan, unit);

  // Aktionen – Workout-Modus für jede Trainingsart außer dem Ruhetag.
  const isRunnable = typeMeta(unit.type).cat !== 'rest';
  view.appendChild(el('div', { class: 'start-cta col gap-3' }, [
    isRunnable ? el('button', { class: 'btn btn--primary btn--lg btn--block', onclick: () => navigate(`#/workout/${unit.id}`) }, [icon('play'), 'Training starten']) : null,
    el('button', { class: 'btn btn--soft btn--block', onclick: () => openLogSheet(plan, unit) }, [icon('check'), 'Als erledigt erfassen']),
    el('div', { class: 'row gap-2' }, [
      el('button', { class: 'btn btn--ghost grow', onclick: () => openReschedule(plan, unit) }, [icon('calendar'), 'Verschieben']),
      el('button', { class: 'btn btn--ghost grow', onclick: () => markMissed(plan, unit) }, [icon('x'), 'Verpasst']),
    ]),
  ]));

  view.appendChild(el('a', { class: 'btn btn--block mt-4', href: `#/plan/${plan.eventId}`, style: { background: 'transparent', color: 'var(--text-2)' } }, [icon('calendar'), 'Zum Trainingsplan']));
}

/* ---- Übungs-Vorschläge für Kraft-/Mobility-Einheiten (nach Nutzung sortiert) ---- */
function renderUnitExercises(view, plan, unit) {
  const pool = suggestedExercisesFor(unit.type);
  if (!pool.length) return;
  view.appendChild(sectionHead('Übungen für diese Einheit'));
  view.appendChild(el('div', { class: 'muted', style: { fontSize: '.82rem', marginBottom: '6px' }, text: 'Nach deiner Nutzungshäufigkeit sortiert. Hake ab, was du machst – Abgehaktes zählt beim Erledigen der Einheit mit.' }));
  const linkedIds = Array.isArray(unit.exerciseIds) ? [...unit.exerciseIds] : [];
  const usage = store.exerciseUsage();
  const list = el('div', { class: 'col gap-2' });
  view.appendChild(list);

  const paint = () => {
    list.innerHTML = '';
    sortByUsage(pool, usage).forEach((e) => {
      const on = linkedIds.includes(e.id);
      list.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'center', padding: '8px 10px' } }, [
        el('span', { style: { color: 'var(--accent)', flex: '0 0 auto', width: '34px', height: '34px', display: 'inline-flex' }, html: exerciseArt(e.art) }),
        el('button', { class: 'grow', style: { textAlign: 'left', background: 'none', border: '0', padding: '0', font: 'inherit', color: 'inherit', cursor: 'pointer' }, onclick: () => openExercise(e.id) }, [
          el('div', { style: { fontWeight: '600', fontSize: '.9rem' }, text: e.name }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: (usage[e.id] ? `${usage[e.id]}× genutzt` : 'neu') + ' · ' + difficultyLabel(e.difficulty) }),
        ]),
        el('button', {
          class: 'btn ' + (on ? 'btn--primary' : 'btn--ghost'), style: { padding: '4px 12px', flex: '0 0 auto', minWidth: '46px' },
          title: on ? 'Ausgewählt – tippen zum Entfernen' : 'Zur Einheit hinzufügen',
          onclick: () => {
            const i = linkedIds.indexOf(e.id);
            if (i >= 0) linkedIds.splice(i, 1); else linkedIds.push(e.id);
            saveUnitPatch(plan.id, unit.id, { exerciseIds: [...linkedIds] });
            paint();
          },
        }, [on ? '✓' : '+']),
      ]));
    });
  };
  paint();
}

/* ------------------------------ Ruhetag --------------------------------- */
function renderRest(view, unit) {
  setHeader({ title: 'Ruhetag', subtitle: fmtDate(unit.date), back: true });
  view.appendChild(el('div', { class: 'empty', style: { paddingTop: '60px' } }, [
    el('div', { class: 'empty__icon', html: iconSvg('moon') }),
    el('div', { class: 'empty__title', text: 'Ruhetag' }),
    el('div', { class: 'muted', text: 'Erholung ist Teil des Trainings. Gönn dir Regeneration.' }),
  ]));
}

/* --------------------------- Auswertung (Ist) --------------------------- */
function renderEvaluation(view, plan, unit, ex) {
  const type = ex?.type || unit?.type || 'easy';
  const m = typeMeta(type);
  const date = ex?.date || unit?.date;
  setHeader({
    title: 'Auswertung', subtitle: fmtDate(date), back: true,
    actions: ex ? [{ icon: 'edit', label: 'Bearbeiten', onClick: () => openLogSheet(plan, unit, ex) }] : [],
  });

  view.appendChild(el('div', { class: 'session-hero' }, [
    typeIcon(type, 'type-icon--lg'),
    el('div', { class: 'session-hero__body' }, [
      el('div', { class: 'session-hero__type', text: m.label }),
      el('div', { class: 'session-hero__title', text: (ex?.title || unit?.title || m.label) }),
      el('div', { class: 'session-hero__date', text: fmtDateLong(date) }),
    ]),
  ]));
  view.appendChild(el('span', { class: 'session-status session-status--erledigt', text: '✓ Erledigt' }));

  if (!ex) {
    view.appendChild(el('div', { class: 'card mt-4' }, [
      el('p', { class: 'muted mb-4', text: 'Diese Einheit ist als erledigt markiert, es wurden aber keine Messwerte erfasst.' }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => openLogSheet(plan, unit) }, [icon('edit'), 'Werte nachtragen']),
    ]));
    return;
  }

  // Kernzahlen
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    ex.distanceKm != null ? bigStat(fmtKm(ex.distanceKm, 1).replace(' km', ''), 'km') : null,
    ex.durationSec != null ? bigStat(fmtDuration(ex.durationSec), 'Zeit') : null,
    ex.paceSecPerKm != null ? bigStat(fmtPace(ex.paceSecPerKm), 'min/km') : null,
    ex.avgHr != null ? bigStat(String(ex.avgHr), 'Ø HF') : null,
  ].filter(Boolean)));

  // Soll-Ist-Vergleich
  if (unit) {
    const rows = [];
    if (unit.targetDistanceKm && ex.distanceKm != null) rows.push(cmp('Distanz', fmtKm(unit.targetDistanceKm, 1), fmtKm(ex.distanceKm, 1), ex.distanceKm >= unit.targetDistanceKm * 0.97));
    if (unit.targetPaceSecPerKm && ex.paceSecPerKm) rows.push(cmp('Pace', fmtPace(unit.targetPaceSecPerKm), fmtPace(ex.paceSecPerKm), ex.paceSecPerKm <= unit.targetPaceMaxSecPerKm || ex.paceSecPerKm <= unit.targetPaceSecPerKm + 8));
    if (unit.targetHrZone && ex.avgHr) {
      const z = (store.profile().hrZones || []).find((x) => x.zone === unit.targetHrZone);
      if (z) rows.push(cmp('HF-Zone', `Z${unit.targetHrZone}`, `${ex.avgHr}`, ex.avgHr >= z.min - 5 && ex.avgHr <= z.max + 5));
    }
    if (rows.length) {
      const hit = rows.filter((r) => r.ok).length >= Math.ceil(rows.length / 2);
      view.appendChild(el('div', { class: `result-banner ${hit ? 'result-banner--hit' : 'result-banner--miss'} mt-4` }, [
        el('span', { html: iconSvg(hit ? 'check' : 'info'), style: { color: hit ? 'var(--good)' : 'var(--warn)', width: '28px' } }),
        el('div', {}, [
          el('div', { style: { fontWeight: '750' }, text: hit ? 'Ziel im Wesentlichen erreicht' : 'Abweichung vom Soll' }),
          el('div', { class: 'muted', style: { fontSize: '0.82rem' }, text: 'Soll-Ist-Vergleich der Einheit' }),
        ]),
      ]));
      view.appendChild(el('div', { class: 'card' }, rows.map((r) => el('div', { class: 'compare' }, [
        el('div', { class: 'compare__label', text: r.label }),
        el('div', { class: 'compare__plan' }, [el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: 'Soll' }), el('span', { class: 'compare__val', text: r.plan })]),
        el('span', { class: 'compare__arrow', html: iconSvg('arrowRight') }),
        el('div', { class: 'compare__real', style: { color: r.ok ? 'var(--good)' : 'var(--text)' } }, [el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: 'Ist' }), el('span', { class: 'compare__val', text: r.real })]),
      ]))));
    }
  }

  // Zeit in Zonen
  if (ex.timeInZones) view.appendChild(zonesCard(ex.timeInZones));

  // Splits
  if (ex.splits && ex.splits.length) view.appendChild(splitsCard(ex.splits));

  // RPE & Gefühl
  if (ex.rpe || ex.feeling) {
    view.appendChild(sectionHead('Belastung & Gefühl'));
    const f = FEELINGS.find((x) => x.key === ex.feeling);
    view.appendChild(el('div', { class: 'card row row--between' }, [
      ex.rpe ? el('div', {}, [el('div', { class: 'dim', style: { fontSize: '0.72rem' }, text: 'RPE (1–10)' }), el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '800' }, text: String(ex.rpe) })]) : el('span'),
      f ? el('div', { style: { textAlign: 'right' } }, [el('div', { style: { fontSize: '1.8rem' }, text: f.emoji }), el('div', { class: 'dim', style: { fontSize: '0.72rem' }, text: f.label })]) : null,
    ]));
  }

  if (ex.notes) { view.appendChild(sectionHead('Notizen')); view.appendChild(el('div', { class: 'card card--flat', text: ex.notes })); }

  // Körperwerte schnell erfassen
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-6', onclick: () => openHealthEntry({ date }) }, [icon('heart'), 'Körperwerte erfassen']));
  if (unit) view.appendChild(el('a', { class: 'btn btn--block mt-2', href: `#/plan/${plan.eventId}`, style: { background: 'transparent', color: 'var(--text-2)' }, text: 'Zum Trainingsplan' }));
}

/* ------------------------------ Erfassen -------------------------------- */
function openLogSheet(plan, unit, existing = null) {
  const ex = existing || {};
  const distI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: ex.distanceKm ?? unit?.targetDistanceKm ?? '', placeholder: 'km' });
  const minI = input({ type: 'number', inputmode: 'numeric', value: ex.durationSec ? Math.floor(ex.durationSec / 60) : '', placeholder: 'min', style: 'text-align:center' });
  const secI = input({ type: 'number', inputmode: 'numeric', value: ex.durationSec ? ex.durationSec % 60 : '', placeholder: 'sek', style: 'text-align:center' });
  const avgI = input({ type: 'number', inputmode: 'numeric', value: ex.avgHr ?? '', placeholder: 'Ø HF' });
  const maxI = input({ type: 'number', inputmode: 'numeric', value: ex.maxHr ?? '', placeholder: 'max HF' });
  const notesI = textarea({ value: ex.notes ?? '', placeholder: 'Wie lief es?' });

  let rpe = ex.rpe || 0;
  const rpeScale = el('div', { class: 'rpe-scale' });
  for (let i = 1; i <= 10; i++) {
    const d = el('button', { class: `rpe-dot ${i === rpe ? 'is-active' : ''}`, text: String(i), onclick: () => { rpe = i; rpeScale.querySelectorAll('.rpe-dot').forEach((x, j) => x.classList.toggle('is-active', j + 1 === i)); } });
    rpeScale.appendChild(d);
  }

  let feeling = ex.feeling || '';
  const feelRow = el('div', { class: 'feeling-row' });
  FEELINGS.forEach((f) => {
    const opt = el('button', {
      class: `feeling-opt ${f.key === feeling ? 'is-active' : ''}`,
      onclick: () => {
        feeling = f.key;
        feelRow.querySelectorAll('.feeling-opt').forEach((x) => x.classList.remove('is-active'));
        opt.classList.add('is-active');
      },
    }, [document.createTextNode(f.emoji), el('small', { text: f.label })]);
    feelRow.appendChild(opt);
  });

  // Erfassung passt sich dem Einheitstyp an: Distanz nur für Läufe, HF nur für
  // Lauf/Cross. Dauer, Anstrengung, Gefühl und Notizen gelten für alle.
  const cat = typeMeta(unit?.type || ex.type || 'other').cat;
  const isRun = cat === 'run';
  const showHr = isRun || cat === 'cross';
  const rows = [];
  if (isRun) rows.push(field('Distanz (km)', distI));
  rows.push(field('Dauer', el('div', { class: 'row gap-2' }, [minI, el('span', { class: 'dim', text: ':' }), secI])));
  if (showHr) rows.push(el('div', { class: 'field__row' }, [field('Ø Herzfrequenz', avgI), field('Max HF', maxI)]));
  rows.push(field('Anstrengung (RPE)', rpeScale));
  rows.push(field('Gefühl', feelRow));
  rows.push(field('Notizen', notesI));
  const body = el('div', {}, rows);

  openSheet({
    title: 'Einheit erfassen',
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          const dist = isRun ? (parseFloat(distI.value) || null) : null;
          const durationSec = (parseInt(minI.value || 0) * 60 + parseInt(secI.value || 0)) || null;
          const data = {
            distanceKm: dist, durationSec,
            avgHr: parseInt(avgI.value) || null, maxHr: parseInt(maxI.value) || null,
            rpe: rpe || null, feeling: feeling || null, notes: notesI.value.trim(),
            timeInZones: ex.timeInZones || null, splits: ex.splits || [],
            source: ex.source || 'manual',
          };
          if (existing) {
            store.patch('sessions', existing.id, { ...data, paceSecPerKm: dist && durationSec ? Math.round(durationSec / dist) : null });
          } else if (plan && unit) {
            completeUnit(plan, unit, data);
          } else {
            // freie Session
            store.upsert('sessions', { id: uid('ses'), plannedId: null, eventId: null, date: todayStr(), type: 'easy', title: 'Lauf', ...data, paceSecPerKm: dist && durationSec ? Math.round(durationSec / dist) : null });
          }
          closeSheet();
          toast('Gespeichert', 'good');
          setTimeout(() => location.reload(), 60);
        },
      }),
    ],
  });
}

function openReschedule(plan, unit) {
  const dateI = input({ type: 'date', value: unit.date });
  const warnBox = el('div', {});
  // Nicht-blockierender Hinweis: Doppelbelastung / harte Einheit ohne Erholungstag (#3)
  const refresh = () => {
    warnBox.innerHTML = '';
    if (!dateI.value || dateI.value === unit.date) return;
    const units = (store.find('plans', plan.id) || {}).units || [];
    const { sameDay, hardNeighbor } = rescheduleCheck(units, unit.id, dateI.value);
    const hints = [];
    if (sameDay) hints.push(`An diesem Tag liegt bereits „${sameDay.title}" – dann sind es zwei Einheiten am selben Tag.`);
    if (hardNeighbor) hints.push(`${hardNeighbor.dir === 'prev' ? 'Am Vortag' : 'Am Folgetag'} liegt „${hardNeighbor.unit.title}" (fordernd) – plane einen lockeren Tag oder Erholung ein.`);
    hints.forEach((t) => warnBox.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t }),
    ])));
    // What-if (R3): Auswirkung auf die Zielwoche vor dem Verschieben.
    const mv = simulateMove(units, unit.id, dateI.value);
    if (mv && mv.target && mv.target.deltaLoad !== 0) warnBox.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: mv.target.level === 'hoch' ? 'var(--warn)' : 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Auswirkung: ' + impactText(mv.target) }),
    ]));
  };
  dateI.addEventListener('change', refresh);
  openSheet({
    title: 'Einheit verschieben',
    body: el('div', {}, [field('Neues Datum', dateI), warnBox]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: 'Verschieben', onclick: () => { saveUnitPatch(plan.id, unit.id, { date: dateI.value, dow: isoDow(dateI.value), status: 'verschoben' }); closeSheet(); toast('Verschoben', 'good'); setTimeout(() => location.reload(), 60); } }),
    ],
  });
}

const MISSED_REASONS = [
  { key: 'time', emoji: '⏰', label: 'Keine Zeit' },
  { key: 'sick', emoji: '🤒', label: 'Krank' },
  { key: 'injured', emoji: '🩹', label: 'Verletzt' },
  { key: 'other', emoji: '🤷', label: 'Sonstiges' },
];
/** Grund-Label zu einem missedReason-Schlüssel (für die Anzeige). */
export const MISSED_REASON_LABEL = Object.fromEntries(MISSED_REASONS.map((r) => [r.key, r.label]));

function markMissed(plan, unit) {
  const list = el('div', { class: 'col gap-2' });
  MISSED_REASONS.forEach((r) => list.appendChild(el('button', {
    class: 'btn btn--ghost btn--block', style: { justifyContent: 'flex-start', gap: '10px' },
    onclick: () => {
      saveUnitPatch(plan.id, unit.id, { status: 'verpasst', missedReason: r.key });
      closeSheet();
      toast('Als verpasst markiert');
      navigate(`#/plan/${plan.eventId}`);
    },
  }, [el('span', { style: { fontSize: '1.2rem' }, text: r.emoji }), r.label])));
  openSheet({
    title: 'Warum verpasst?',
    body: el('div', {}, [
      el('p', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: `„${unit.title}" – der Grund hilft später, Überlastung zu erkennen.` }),
      list,
    ]),
  });
}

const PACE_KEY_BY_TYPE = { easy: 'easy', long: 'long', tempo: 'threshold', interval: 'vo2', recovery: 'recovery', race: 'race_hm' };
function defaultTargets(type) {
  const z = (store.profile().paceZones || {})[PACE_KEY_BY_TYPE[type]];
  return { pace: z ? z.min : null, hrZone: z ? z.hrZone : null };
}
function parsePaceInput(v) {
  if (v == null || v === '') return null;
  v = String(v).trim();
  if (v.includes(':')) { const [m, s] = v.split(':').map(Number); return (m * 60 + (s || 0)) || null; }
  return parseInt(v) || null;
}

function openUnitEditor(plan, unit) { unitFormSheet(plan, unit, false); }

/** Legt eine neue geplante Einheit für ein Datum an (Plan/Kalender). */
export function openUnitCreator(plan, dateStr) {
  const tpl = {
    id: uid('u'), planId: plan.id, eventId: plan.eventId, date: dateStr || todayStr(),
    type: 'easy', title: typeMeta('easy').label, status: 'geplant', executedSessionId: null,
    targetDistanceKm: null, targetDurationMin: null, targetPaceSecPerKm: null,
    targetPaceMaxSecPerKm: null, targetHrZone: null, description: '', intervals: null,
  };
  unitFormSheet(plan, tpl, true);
}

/** Gemeinsames Formular zum Anlegen/Bearbeiten einer geplanten Einheit. */
function unitFormSheet(plan, unit, isNew) {
  let type = unit.type || 'easy';
  const titleI = input({ value: unit.title || '' });
  const dateI = input({ type: 'date', value: unit.date });
  const distI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: unit.targetDistanceKm ?? '', placeholder: 'km' });
  const durI = input({ type: 'number', inputmode: 'numeric', value: unit.targetDurationMin ?? '', placeholder: 'min' });
  const paceI = input({ value: unit.targetPaceSecPerKm ? fmtPace(unit.targetPaceSecPerKm) : '', placeholder: 'min:sek, z. B. 5:30' });
  const hrSel = select([{ value: '', label: '– keine –' }, ...[1, 2, 3, 4, 5].map((z) => ({ value: String(z), label: `Zone ${z}` }))], unit.targetHrZone ? String(unit.targetHrZone) : '');
  const descI = textarea({ value: unit.description ?? '' });

  const iv = unit.intervals || {};
  const roundsI = input({ type: 'number', inputmode: 'numeric', value: iv.rounds ?? '', placeholder: 'z. B. 6' });
  const workI = input({ type: 'number', inputmode: 'numeric', value: iv.workSec ? Math.round(iv.workSec) : '', placeholder: 'Sek' });
  const restI = input({ type: 'number', inputmode: 'numeric', value: iv.restSec ? Math.round(iv.restSec) : '', placeholder: 'Sek' });
  const intervalBox = el('div', { class: 'card card--flat', hidden: !['interval', 'tempo'].includes(type) }, [
    el('div', { class: 'field__label', text: 'Intervallstruktur (steuert den Workout-Modus)' }),
    el('div', { class: 'field__row' }, [field('Runden', roundsI), field('Belastung (s)', workI), field('Pause (s)', restI)]),
  ]);
  const drinkI = input({ type: 'number', inputmode: 'numeric', value: unit.drinkIntervalMin ?? '', placeholder: 'min · leer = automatisch, 0 = aus' });

  // What-if (R3): Live-Vorschau der Wochen-Auswirkung beim Anlegen.
  const whatIfBox = el('div', {});
  const refreshWhatIf = () => {
    if (!isNew) return;
    whatIfBox.innerHTML = '';
    const draft = { ...unit, type, date: dateI.value, targetDistanceKm: parseFloat(distI.value) || null, targetDurationMin: parseInt(durI.value) || null };
    const sim = simulateAdd((store.find('plans', plan.id) || {}).units || [], draft);
    if (!sim) return;
    whatIfBox.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: sim.level === 'hoch' ? 'var(--warn)' : 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Auswirkung: ' + impactText(sim) }),
    ]));
  };
  dateI.addEventListener('change', refreshWhatIf);
  distI.addEventListener('input', refreshWhatIf);
  durI.addEventListener('input', refreshWhatIf);

  const typeSel = select(TYPE_OPTIONS, type, {
    onchange: (e) => {
      const prevLabel = typeMeta(type).label;
      type = e.target.value;
      intervalBox.hidden = !['interval', 'tempo'].includes(type);
      const d = defaultTargets(type);
      if (!paceI.value && d.pace) paceI.value = fmtPace(d.pace);
      if (!hrSel.value && d.hrZone) hrSel.value = String(d.hrZone);
      if (!titleI.value.trim() || titleI.value.trim() === prevLabel) titleI.value = typeMeta(type).label;
      refreshWhatIf();
    },
  });

  const save = () => {
    const paceSec = parsePaceInput(paceI.value);
    const fields = {
      type, title: titleI.value.trim() || typeMeta(type).label, date: dateI.value, dow: isoDow(dateI.value),
      targetDistanceKm: parseFloat(distI.value) || null,
      targetDurationMin: parseInt(durI.value) || null,
      targetPaceSecPerKm: paceSec,
      targetPaceMaxSecPerKm: paceSec ? paceSec + 10 : null,
      targetHrZone: hrSel.value ? parseInt(hrSel.value) : null,
      description: descI.value.trim(),
      intervals: ['interval', 'tempo'].includes(type) && roundsI.value
        ? { rounds: parseInt(roundsI.value), workSec: parseInt(workI.value) || 180, restSec: parseInt(restI.value) || 90 }
        : null,
      drinkIntervalMin: drinkI.value === '' ? null : Math.max(0, parseInt(drinkI.value) || 0),
    };
    if (isNew) {
      const cur = store.find('plans', plan.id);
      const newUnit = { ...unit, ...fields, createdAt: nowIso(), updatedAt: nowIso() };
      const units = [...(cur.units || []), newUnit];
      store.patch('plans', plan.id, { units });
      closeSheet();
      // Wochenbelastung konstant halten: ähnliche Einheit als Ausgleich anbieten (#2)
      const offset = suggestOffsetUnit(units, newUnit);
      if (offset) { offerOffset(plan, newUnit, offset); return; }
      toast('Einheit hinzugefügt', 'good'); setTimeout(() => location.reload(), 60);
    } else {
      saveUnitPatch(plan.id, unit.id, fields);
      closeSheet(); toast('Gespeichert', 'good'); setTimeout(() => location.reload(), 60);
    }
  };

  if (isNew) refreshWhatIf();
  openSheet({
    title: isNew ? 'Einheit hinzufügen' : 'Einheit bearbeiten',
    body: el('div', {}, [
      el('div', { class: 'field__row' }, [field('Art', typeSel), field('Datum', dateI)]),
      field('Titel', titleI),
      el('div', { class: 'field__row' }, [field('Distanz (km)', distI), field('Dauer (min)', durI)]),
      el('div', { class: 'field__row' }, [field('Zielpace (min/km)', paceI), field('HF-Zone', hrSel)]),
      intervalBox,
      field('Trinkpause alle (min)', drinkI),
      field('Beschreibung', descI),
      isNew ? whatIfBox : null,
    ]),
    footer: [
      !isNew ? el('button', { class: 'btn btn--danger', 'aria-label': 'Löschen', onclick: async () => {
        if (await confirmDialog({ title: 'Einheit löschen?', message: unit.title, confirmLabel: 'Löschen', danger: true })) {
          const cur = store.find('plans', plan.id);
          store.patch('plans', plan.id, { units: (cur.units || []).filter((u) => u.id !== unit.id) });
          closeSheet(); toast('Gelöscht'); navigate(`#/plan/${plan.eventId}`); setTimeout(() => location.reload(), 60);
        }
      } }, icon('trash')) : null,
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: 'Speichern', onclick: save }),
    ],
  });
}

/** Bietet nach dem Hinzufügen an, eine ähnliche Einheit derselben Woche zu entfernen (#2). */
function offerOffset(plan, newUnit, offset) {
  const load = weekLoad((store.find('plans', plan.id).units) || [], newUnit.date);
  const reload = () => { closeSheet(); setTimeout(() => location.reload(), 60); };
  openSheet({
    title: 'Wochenbelastung ausgleichen?',
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.88rem' }, text: `Du hast „${newUnit.title}" am ${fmtDate(newUnit.date)} eingeplant. Diese Woche umfasst damit ${load.count} Einheiten${load.km ? ` (${load.km} km)` : ''}.` }),
      el('p', { class: 'mt-2', style: { fontSize: '.88rem' }, text: 'Damit die Belastung ähnlich bleibt, kannst du eine vergleichbare Einheit aus dem Plan nehmen:' }),
      el('div', { class: 'card card--flat mt-2' }, [
        el('div', { class: 'card__title', text: offset.title }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${fmtDate(offset.date)}${offset.targetDistanceKm ? ' · ' + fmtKm(offset.targetDistanceKm) : ''}` }),
      ]),
      el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: 'Nur ein Vorschlag – du entscheidest. „Beide behalten" lässt alles wie es ist.' }),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Beide behalten', onclick: reload }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Aus Plan nehmen',
        onclick: () => {
          const cur = store.find('plans', plan.id);
          store.patch('plans', plan.id, { units: (cur.units || []).filter((u) => u.id !== offset.id) });
          toast('Ausgeglichen – ähnliche Einheit entfernt', 'good'); reload();
        },
      }),
    ],
  });
}

/* ------------------------------- Bausteine ------------------------------ */
function bigStat(val, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', text: val }), el('div', { class: 'stat__label', text: label })]);
}
function cmp(label, plan, real, ok) { return { label, plan, real, ok }; }

function zonesCard(tiz) {
  const zones = store.profile().hrZones || [];
  const total = Object.values(tiz).reduce((a, b) => a + (b || 0), 0) || 1;
  const bar = el('div', { class: 'zones-bar' });
  const legend = el('div', { class: 'zones-legend' });
  [1, 2, 3, 4, 5].forEach((z) => {
    const sec = tiz[z] || tiz[String(z)] || 0;
    if (sec <= 0) return;
    const zc = zones.find((x) => x.zone === z);
    const color = zc?.color || 'var(--accent)';
    bar.appendChild(el('span', { style: { width: `${(sec / total) * 100}%`, background: color } }));
    legend.appendChild(el('span', { class: 'zones-legend__item' }, [el('span', { class: 'zones-legend__sw', style: { background: color } }), `Z${z} · ${fmtDuration(sec)}`]));
  });
  const wrap = el('div', {}, [sectionHead('Zeit in Herzfrequenz-Zonen'), el('div', { class: 'card' }, [bar, legend])]);
  return wrap;
}

function splitsCard(splits) {
  const max = Math.max(...splits.map((s) => s.sec));
  const min = Math.min(...splits.map((s) => s.sec));
  const tbl = el('table', { class: 'splits' }, [
    el('thead', {}, el('tr', {}, [el('th', { text: 'km' }), el('th', { text: 'Pace' }), el('th', { text: '', style: 'width:45%' })])),
    el('tbody', {}, splits.map((s) => el('tr', {}, [
      el('td', { text: String(s.km) }),
      el('td', { text: fmtPace(s.sec) }),
      el('td', {}, el('div', { class: 'splits__bar' }, el('i', { style: { width: `${max === min ? 100 : 30 + (1 - (s.sec - min) / (max - min)) * 70}%` } }))),
    ]))),
  ]);
  return el('div', {}, [sectionHead('Splits'), el('div', { class: 'card' }, tbl)]);
}
