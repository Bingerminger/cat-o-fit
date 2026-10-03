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
  select, FEELINGS, segmented, TYPE_OPTIONS, effectiveStatus, STATUS_META, isoDow, fmtInt,
  rpeScale, feelingPicker, durationFields, addDays, fmtWeekday,
  refreshView, goOrRefresh,
  fmtDec,
} from './ui.js';
import { sessionLoad, sessionRpeInfo, loadMinutes } from './load.js';
import { findUnit, saveUnitPatch, completeUnit, linkSession, nextFreeDay, MISSED_REASONS } from './unit-actions.js';
import { setHeader } from './router.js';
import { openIcsSheet } from './ics-export.js';
import { openHealthEntry } from './health.js';
import { weatherForDate, weatherHint, wmo } from './weather.js';
import { isProtectedDay, PHASE_META } from './cycle.js';
import { suggestOffsetUnit, weekLoad, rescheduleCheck, findPlannedMatch } from './planflow.js';
import { compareToPlan, splitBarPct } from './sollist.js';
import { simulateAdd, simulateMove, impactText } from './whatif.js';
import { exercisesForUnit, openExercise, difficultyLabel, findExercise } from './exercises.js';
import { fmtSet, volume } from './strength.js';
import { exerciseArt } from './exercise-art.js';
import { programForUnit, buildShow } from './show-program.js';
import { routeMap } from './charts.js';
import { decodePolyline } from './gpx.js';

import { t, tp } from './i18n.js';

/** Herkunft der Anstrengung in der Belastungszeile (ohne erfasste RPE ist sie geschätzt). */
const RPE_SOURCE_TEXT = {
  erfasst: '',
  get herzfrequenz() { return ` (${t('session.rpeFromHr')})`; },
  get typ() { return ` (${t('session.rpeFromType')})`; },
};

// Weitergereicht für bestehende Importe (Tests, ältere Module).
export { findUnit, saveUnitPatch, completeUnit, linkSession, nextFreeDay, MISSED_REASON_LABEL } from './unit-actions.js';

/* ===================== View ===================== */
export function render(view, id) {
  // 1) Geplante Einheit?
  const found = findUnit(id);
  // 2) Oder eine frei erfasste, durchgeführte Session?
  const freeSession = !found ? store.find('sessions', id) : null;

  if (!found && !freeSession) {
    setHeader({ title: t('session.unit'), back: true });
    view.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'empty__title', text: t('session.notFound') })]));
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
      { icon: 'edit', label: t('session.edit'), onClick: () => openUnitEditor(plan, unit) },
      { icon: 'download', label: t('session.addToCalendar'), onClick: () => openIcsSheet({ unit, event: store.find('events', plan.eventId) }) },
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
      el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: t('session.protectedDay') }),
    ]));
  } else if (eff === 'ueberfaellig') {
    view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: '#f5a623', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.86rem' }, text: t('session.overdue') }),
    ]));
  }

  // Zielwerte
  const targets = [];
  if (unit.targetDistanceKm) targets.push([t('session.distance'), fmtKm(unit.targetDistanceKm, unit.targetDistanceKm % 1 ? 1 : 0)]);
  if (unit.targetDurationMin) targets.push([t('session.duration'), `${unit.targetDurationMin} min`]);
  if (unit.targetPaceSecPerKm) targets.push([t('session.targetPace'), fmtPaceRange(unit.targetPaceSecPerKm, unit.targetPaceMaxSecPerKm)]);
  if (unit.targetHrZone) targets.push([t('session.hrZone'), t('session.zone', { zone: unit.targetHrZone })]);
  if (targets.length) {
    view.appendChild(el('div', { class: 'target-grid mt-4' },
      targets.map(([l, v]) => el('div', { class: 'target' }, [el('div', { class: 'target__label', text: l }), el('div', { class: 'target__val', text: v })]))));
  }

  if (unit.description) {
    view.appendChild(sectionHead(t('session.description')));
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

  // Nebenaktionen im Fluss …
  view.appendChild(el('div', { class: 'start-cta row gap-2' }, [
    el('button', { class: 'btn btn--ghost grow', onclick: () => openReschedule(plan, unit) }, [icon('calendar'), t('session.reschedule')]),
    el('button', { class: 'btn btn--ghost grow', onclick: () => markMissed(plan, unit) }, [icon('x'), t('session.markMissed')]),
  ]));
  view.appendChild(el('a', { class: 'btn btn--block mt-4', href: `#/plan/${plan.eventId}`, style: { background: 'transparent', color: 'var(--text-2)' } }, [icon('calendar'), t('session.toPlan')]));

  // … die Hauptaktionen in einer klebenden Leiste über der Tab-Leiste: „Training starten“
  // lag vorher 1,8 Bildschirme tief hinter Beschreibung und Übungsvorschlägen (UI-09).
  const isRunnable = typeMeta(unit.type).cat !== 'rest';
  view.appendChild(el('div', { class: 'action-bar' }, [
    isRunnable ? el('button', { class: 'btn btn--primary grow', onclick: () => navigate(`#/workout/${unit.id}`) }, [icon('play'), t('session.start')]) : null,
    el('button', { class: `btn ${isRunnable ? 'btn--soft' : 'btn--primary'} grow`, onclick: () => openLogSheet(plan, unit) }, [icon('check'), t('session.logDone')]),
  ]));
}

/* ---- Übungs-Vorschläge für Kraft-/Mobility-Einheiten (nach Nutzung sortiert) ---- */
function renderUnitExercises(view, plan, unit) {
  const usage = store.exerciseUsage();
  // Zuerst, was die Beschreibung der Einheit nennt („im Plan“), dann die Vorschläge nach Nutzung.
  const { named, all: pool } = exercisesForUnit(unit, usage);
  if (!pool.length) return;
  const namedIds = new Set(named.map((e) => e.id));
  const linkedIds = Array.isArray(unit.exerciseIds) ? [...unit.exerciseIds] : [];
  const list = el('div', { class: 'col gap-2' });
  const intro = el('div', { class: 'muted', style: { fontSize: '.82rem', marginBottom: '6px' }, text: named.length ? t('session.exercisesIntroPlan') : t('session.exercisesIntroUsage') });
  // Alle Übungen der Einheit am Stück, mit Musik und Ansagen (workout-show.js).
  const cta = el('div', { class: 'show-cta-slot' });
  const paintCta = () => {
    cta.innerHTML = '';
    const current = () => programForUnit({ ...unit, exerciseIds: [...linkedIds] });
    const prog = current();
    if (!prog) return;
    const min = Math.max(1, Math.round(buildShow(prog).total / 60));
    cta.appendChild(el('button', { class: 'btn btn--primary btn--block show-cta', type: 'button', onclick: async () => {
      const { openShow } = await import('./workout-show.js');
      openShow(current(), { onFinish: ({ durationSec }) => openLogSheet(plan, unit, null, { durationSec }) });
    } }, [icon('play'), t('session.followAlong', { min })]));
  };
  // Bei Läufen sind die Dehn-/Kraftvorschläge Beiwerk: eingeklappt, damit der Weg zum
  // Start kurz bleibt (UI-09). Bei Kraft/Mobility sind sie der Inhalt – offen.
  if (typeMeta(unit.type).cat === 'run') {
    view.appendChild(el('details', { class: 'unit-exercises mt-4' }, [
      el('summary', { class: 'section-head__title', text: t('session.unitExercisesCount', { n: pool.length }) }),
      intro, cta, list,
    ]));
  } else {
    view.appendChild(sectionHead(t('session.unitExercises')));
    view.appendChild(intro);
    view.appendChild(cta);
    view.appendChild(list);
  }

  const paint = () => {
    list.innerHTML = '';
    paintCta();
    pool.forEach((e) => {
      const on = linkedIds.includes(e.id);
      list.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'center', padding: '8px 10px' } }, [
        el('span', { style: { flex: '0 0 auto', width: '48px', height: '32px', display: 'inline-flex' }, html: exerciseArt(e.art) }),
        el('button', { class: 'grow', style: { textAlign: 'left', background: 'none', border: '0', padding: '0', font: 'inherit', color: 'inherit', cursor: 'pointer' }, onclick: () => openExercise(e.id) }, [
          el('div', { style: { fontWeight: '600', fontSize: '.9rem' }, text: e.name }),
          el('div', { class: 'dim', style: { fontSize: '.74rem' }, text: (namedIds.has(e.id) ? `${t('session.inPlan')} · ` : '') + (usage[e.id] ? t('session.usedTimes', { n: usage[e.id] }) : t('session.new')) + ' · ' + difficultyLabel(e.difficulty) }),
        ]),
        el('button', {
          class: 'btn ' + (on ? 'btn--primary' : 'btn--ghost'), style: { padding: '4px 12px', flex: '0 0 auto', minWidth: '46px' },
          title: on ? t('session.selectedTapToRemove') : t('session.addToUnit'),
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
  setHeader({ title: t('sessionTypes.rest.label'), subtitle: fmtDate(unit.date), back: true });
  view.appendChild(el('div', { class: 'empty', style: { paddingTop: '60px' } }, [
    el('div', { class: 'empty__icon', html: iconSvg('moon') }),
    el('div', { class: 'empty__title', text: t('sessionTypes.rest.label') }),
    el('div', { class: 'muted', text: t('session.restText') }),
  ]));
}

/* --------------------------- Auswertung (Ist) --------------------------- */
function renderEvaluation(view, plan, unit, ex) {
  const type = ex?.type || unit?.type || 'easy';
  const m = typeMeta(type);
  const date = ex?.date || unit?.date;
  setHeader({
    title: t('session.review'), subtitle: fmtDate(date), back: true,
    // Freie Trainings (ohne Plan) lassen sich komplett bearbeiten – auch Sportart und Datum – und löschen.
    actions: ex ? [{ icon: 'edit', label: t('session.edit'), onClick: () => (unit ? openLogSheet(plan, unit, ex) : openActivitySheet({ existing: ex })) }] : [],
  });

  view.appendChild(el('div', { class: 'session-hero' }, [
    typeIcon(type, 'type-icon--lg'),
    el('div', { class: 'session-hero__body' }, [
      el('div', { class: 'session-hero__type', text: m.label }),
      el('div', { class: 'session-hero__title', text: (ex?.title || unit?.title || m.label) }),
      el('div', { class: 'session-hero__date', text: fmtDateLong(date) }),
    ]),
  ]));
  view.appendChild(el('span', { class: 'session-status session-status--erledigt', text: t('session.doneBadge') }));

  if (!ex) {
    view.appendChild(el('div', { class: 'card mt-4' }, [
      el('p', { class: 'muted mb-4', text: t('session.noData') }),
      el('button', { class: 'btn btn--primary btn--block', onclick: () => openLogSheet(plan, unit) }, [icon('edit'), t('session.addData')]),
    ]));
    return;
  }

  // Kernzahlen
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    ex.distanceKm != null ? bigStat(fmtKm(ex.distanceKm, 1).replace(' km', ''), 'km') : null,
    ex.durationSec != null ? bigStat(fmtDuration(ex.durationSec), t('session.time')) : null,
    ex.paceSecPerKm != null ? bigStat(fmtPace(ex.paceSecPerKm), 'min/km') : null,
    ex.avgHr != null ? bigStat(String(ex.avgHr), t('session.avgHrShort')) : null,
  ].filter(Boolean)));

  // Soll-Ist-Vergleich (zweiseitig für Lockeres, ohne Pace-Urteil für Intervalle)
  if (unit) {
    const cmpRes = compareToPlan(unit, ex, { hrZones: store.profile().hrZones || [] });
    const fmtPlan = (r) => (r.key === 'distance' ? fmtKm(r.plan, 1) : r.key === 'duration' ? fmtDuration(r.plan)
      : r.key === 'pace' ? `${fmtPace(r.plan[0])}–${fmtPace(r.plan[1])}` : `Z${r.plan}`);
    const fmtReal = (r) => (r.key === 'distance' ? fmtKm(r.real, 1) : r.key === 'duration' ? fmtDuration(r.real)
      : r.key === 'pace' ? fmtPace(r.real) : `${r.real}`);
    if (cmpRes.rows.length) {
      const hit = cmpRes.hit;
      const title = hit ? t('session.targetHit') : cmpRes.tooFast ? t('session.tooFastEasy') : t('session.offTarget');
      view.appendChild(el('div', { class: `result-banner ${hit ? 'result-banner--hit' : 'result-banner--miss'} mt-4` }, [
        el('span', { html: iconSvg(hit ? 'check' : 'info'), style: { color: hit ? 'var(--good)' : 'var(--warn)', width: '28px' } }),
        el('div', {}, [
          el('div', { style: { fontWeight: '750' }, text: title }),
          el('div', { class: 'muted', style: { fontSize: '0.82rem' }, text: t('session.compareSub') }),
        ]),
      ]));
      view.appendChild(el('div', { class: 'card' }, cmpRes.rows.map((r) => el('div', { class: 'compare' }, [
        el('div', { class: 'compare__label', text: r.label }),
        el('div', { class: 'compare__plan' }, [el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: t('session.planned') }), el('span', { class: 'compare__val', text: fmtPlan(r) })]),
        el('span', { class: 'compare__arrow', html: iconSvg('arrowRight') }),
        el('div', { class: 'compare__real', style: { color: r.ok ? 'var(--good)' : 'var(--text)' } }, [
          el('div', { class: 'dim', style: { fontSize: '0.66rem' }, text: r.verdict ? `${t('session.actual')} · ${r.verdict}` : t('session.actual') }),
          el('span', { class: 'compare__val', text: fmtReal(r) }),
        ]),
      ]))));
    }
    if (cmpRes.note) {
      view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg('info'), style: { color: cmpRes.tooFast ? 'var(--warn)' : 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: cmpRes.note }),
      ]));
    }
  }

  // Zeit in Zonen
  if (ex.timeInZones) view.appendChild(zonesCard(ex.timeInZones));

  // Splits
  // Kraft: erfasste Sätze je Übung (aus dem Workout-Modus) mit Volumen.
  if (Array.isArray(ex.strengthSets) && ex.strengthSets.length) {
    view.appendChild(sectionHead(t('session.sets')));
    const list = el('div', { class: 'list-card' });
    ex.strengthSets.forEach((x) => {
      const e = findExercise(x.exerciseId);
      const vol = volume(x.sets);
      list.appendChild(el('button', { class: 'list-item', type: 'button', style: { width: '100%', textAlign: 'left' }, onclick: () => e && openExercise(e.id) }, [
        el('div', { class: 'list-item__body' }, [
          el('div', { class: 'list-item__title', text: e ? e.name : x.exerciseId }),
          el('div', { class: 'list-item__sub', style: { whiteSpace: 'normal' }, text: `${x.sets.map(fmtSet).join(' · ')}${vol ? ` · ${t('session.volumeMoved', { kg: fmtInt(vol) })}` : ''}` }),
        ]),
      ]));
    });
    view.appendChild(list);
  }
  // Strecke aus der Datei – als Linie ohne Kartendienst, dazu das Höhenprofil.
  if (ex.route && ex.route.poly) {
    view.appendChild(sectionHead(t('session.route')));
    view.appendChild(el('div', { class: 'card' }, [
      routeMap(ex.route, { distanceKm: ex.distanceKm, ascentM: ex.ascentM, decode: decodePolyline }),
      el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `${ex.ascentM ? `${t('session.ascent', { m: ex.ascentM })} · ` : ''}${t('session.routeNoMap')}` }),
    ]));
  }
  if (ex.splits && ex.splits.length) view.appendChild(splitsCard(ex.splits));

  // Belastung, RPE & Gefühl – die Belastungspunkte immer mit ihrer Herleitung, damit
  // sichtbar ist, wenn die Dauer geschätzt wurde (geplant, aus der Strecke, Pauschale).
  view.appendChild(sectionHead(t('session.loadFeeling')));
  const f = FEELINGS.find((x) => x.key === ex.feeling);
  const lm = loadMinutes(ex);
  const rpeInfo = sessionRpeInfo(ex);
  const loadSrc = { erfasst: '', strecke: ` · ${t('session.loadSrcRoute')}`, geplant: ` · ${t('session.loadSrcPlanned')}`, pauschal: ` · ${t('session.loadSrcFlat')}` }[lm.source];
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between' }, [
      el('div', {}, [el('div', { class: 'dim', style: { fontSize: '0.72rem' }, text: t('session.loadPoints') }), el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '800' }, text: fmtInt(sessionLoad(ex)) })]),
      ex.rpe ? el('div', {}, [el('div', { class: 'dim', style: { fontSize: '0.72rem' }, text: 'RPE (1–10)' }), el('div', { class: 'num', style: { fontSize: '1.4rem', fontWeight: '800' }, text: String(ex.rpe) })]) : null,
      f ? el('div', { style: { textAlign: 'right' } }, [el('div', { style: { fontSize: '1.8rem' }, text: f.emoji }), el('div', { class: 'dim', style: { fontSize: '0.72rem' }, text: f.label })]) : null,
    ]),
    el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `${t('session.loadFormula', { min: Math.round(lm.min), rpe: fmtDec(Math.round(rpeInfo.rpe * 10) / 10) })}${RPE_SOURCE_TEXT[rpeInfo.source]}${loadSrc}` }),
  ]));

  if (ex.notes) { view.appendChild(sectionHead(t('session.notes'))); view.appendChild(el('div', { class: 'card card--flat', text: ex.notes })); }

  // Körperwerte schnell erfassen
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-6', onclick: () => openHealthEntry({ date }) }, [icon('heart'), t('session.logBody')]));
  if (unit) view.appendChild(el('a', { class: 'btn btn--block mt-2', href: `#/plan/${plan.eventId}`, style: { background: 'transparent', color: 'var(--text-2)' }, text: t('session.toPlan') }));
}

/* ------------------------------ Erfassen -------------------------------- */
function openLogSheet(plan, unit, existing = null, prefill = null) {
  const ex = existing || {};
  // Nach einer durchgehenden Session (workout-show.js) steht die tatsächliche Dauer schon fest.
  const pre = !existing && prefill && Number(prefill.durationSec) > 0 ? Number(prefill.durationSec) : 0;
  const distI = input({ type: 'number', step: '0.1', min: '0', inputmode: 'decimal', value: ex.distanceKm ?? unit?.targetDistanceKm ?? '', placeholder: 'km' });
  // Neue Erfassung: Dauer mit der geplanten Dauer vorbelegt – ohne Dauer zählte jede
  // Einheit mit 30 Minuten in die Belastung (90 min Fußball also nur zu einem Drittel).
  const plannedMin = !existing && Number(unit?.targetDurationMin) > 0 ? Number(unit.targetDurationMin) : '';
  const dur = durationFields({ min: ex.durationSec ? Math.floor(ex.durationSec / 60) : pre ? Math.floor(pre / 60) : plannedMin, sec: ex.durationSec ? ex.durationSec % 60 : pre ? pre % 60 : '' });
  const { minI, secI } = dur;
  const avgI = input({ type: 'number', min: '30', max: '230', inputmode: 'numeric', value: ex.avgHr ?? '', placeholder: t('session.avgHrShort') });
  const maxI = input({ type: 'number', min: '30', max: '230', inputmode: 'numeric', value: ex.maxHr ?? '', placeholder: t('session.maxHrPlaceholder') });
  const notesI = textarea({ value: ex.notes ?? '', placeholder: t('session.howDidItGo') });

  let rpe = ex.rpe || 0;
  const rpeEl = rpeScale(rpe, (v) => { rpe = v; });
  let feeling = ex.feeling || '';
  const feelRow = feelingPicker(feeling, (v) => { feeling = v; });

  // Erfassung passt sich dem Einheitstyp an: Distanz nur für Läufe, HF nur für
  // Lauf/Cross. Dauer, Anstrengung, Gefühl und Notizen gelten für alle.
  const cat = typeMeta(unit?.type || ex.type || 'other').cat;
  const isRun = cat === 'run';
  const showHr = isRun || cat === 'cross';
  const rows = [];
  if (isRun) rows.push(field(t('session.distanceKm'), distI));
  rows.push(field(t('session.duration'), dur.node));
  if (showHr) rows.push(el('div', { class: 'field__row' }, [field(t('session.avgHr'), avgI), field(t('session.maxHr'), maxI)]));
  rows.push(field(t('session.effortRpe'), rpeEl));
  rows.push(field(t('session.feeling'), feelRow));
  rows.push(field(t('session.notes'), notesI));
  const body = el('div', {}, rows);

  openSheet({
    title: t('session.logUnit'),
    body,
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('session.save'),
        onclick: () => {
          // Plausibel halten: keine negativen Werte, Sekunden 0–59, HF 30–230.
          const dist = isRun ? (Math.max(0, parseFloat(String(distI.value).replace(',', '.'))) || null) : null;
          const durationSec = (Math.max(0, parseInt(minI.value || 0, 10) || 0) * 60 + Math.max(0, Math.min(59, parseInt(secI.value || 0, 10) || 0))) || null;
          const hr = (v) => { const n = parseInt(v, 10); return n >= 30 && n <= 230 ? n : null; };
          const data = {
            distanceKm: dist, durationSec,
            avgHr: hr(avgI.value), maxHr: hr(maxI.value),
            rpe: rpe || null, feeling: feeling || null, notes: notesI.value.trim(),
            timeInZones: ex.timeInZones || null, splits: ex.splits || [],
            source: ex.source || 'manual',
          };
          if (existing) {
            store.patch('sessions', existing.id, { ...data, paceSecPerKm: dist && durationSec ? Math.round(durationSec / dist) : null });
          } else {
            completeUnit(plan, unit, data);
          }
          closeSheet();
          toast(t('session.saved'), 'good');
          refreshView();
        },
      }),
    ],
  });
}

/** Sportarten für freie Trainings (ohne Ruhetag und Wettkampf-Sonderfälle). */
const ACTIVITY_TYPES = TYPE_OPTIONS.filter((o) => !['rest', 'camp'].includes(o.value));
/** Kategorien mit Strecke. */
const DISTANCE_CATS = new Set(['run', 'bike', 'walk', 'swim']);
const distanceCat = (type) => {
  if (typeMeta(type).cat === 'run') return 'run';
  if (['cross_bike', 'spinning'].includes(type)) return 'bike';
  if (['walk', 'hike'].includes(type)) return 'walk';
  if (type === 'swim') return 'swim';
  return null;
};

/**
 * „Training erfassen“ – auch ohne Plan (spontane Radtour, Lauf am Ruhetag, Training
 * ohne Ziel). Passt eine offene geplante Einheit desselben Tages, lässt sich das
 * Training ihr zuordnen (Voreinstellung); sonst entsteht ein freies Training, das im
 * Kalender und unter „Freie Trainings“ erscheint. Mit `existing` bearbeiten/löschen.
 */
export function openActivitySheet({ date = todayStr(), existing = null } = {}) {
  const ex = existing || {};
  let type = ex.type || 'easy';
  const typeSel = select(ACTIVITY_TYPES, type);
  const dateI = input({ type: 'date', value: ex.date || date });
  const titleI = input({ value: ex.title || '', placeholder: t('session.titlePlaceholder') });
  const distI = input({ type: 'number', step: '0.1', min: '0', inputmode: 'decimal', value: ex.distanceKm ?? '', placeholder: 'km' });
  const dur = durationFields({ min: ex.durationSec ? Math.floor(ex.durationSec / 60) : '', sec: ex.durationSec ? ex.durationSec % 60 : '' });
  const { minI, secI } = dur;
  const avgI = input({ type: 'number', min: '30', max: '230', inputmode: 'numeric', value: ex.avgHr ?? '', placeholder: t('session.avgHrShort') });
  const notesI = textarea({ value: ex.notes ?? '', placeholder: t('session.howDidItGo') });

  let rpe = ex.rpe || 0;
  const rpeEl = rpeScale(rpe, (v) => { rpe = v; });

  const distField = field(t('session.distanceKm'), distI);
  const matchBox = el('div', {});
  let linkTo = null;
  let linkOn = true;
  const refresh = () => {
    type = typeSel.value;
    distField.hidden = !DISTANCE_CATS.has(distanceCat(type));
    matchBox.innerHTML = '';
    linkTo = existing ? null : findPlannedMatch(store.get('plans'), { date: dateI.value, type });
    if (linkTo) {
      const cb = el('input', { type: 'checkbox', checked: linkOn, onchange: (e) => { linkOn = e.target.checked; } });
      matchBox.appendChild(el('label', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'center', cursor: 'pointer' } }, [
        cb,
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('session.linkToPlanned', { title: linkTo.unit.title }) }),
      ]));
    }
  };
  typeSel.addEventListener('change', refresh);
  dateI.addEventListener('change', refresh);
  refresh();

  const save = () => {
    if (!dateI.value) { toast(t('session.pickDate'), 'bad'); return; }
    const km = distField.hidden ? null : (Math.max(0, parseFloat(String(distI.value).replace(',', '.'))) || null);
    const durationSec = (Math.max(0, parseInt(minI.value || 0, 10) || 0) * 60 + Math.max(0, Math.min(59, parseInt(secI.value || 0, 10) || 0))) || null;
    if (!durationSec && !km) { toast(t('session.needDurationOrDistance'), 'bad'); return; }
    const hr = parseInt(avgI.value, 10);
    const data = {
      distanceKm: km, durationSec,
      paceSecPerKm: km && durationSec && distanceCat(type) === 'run' ? Math.round(durationSec / km) : null,
      avgHr: hr >= 30 && hr <= 230 ? hr : null, rpe: rpe || null, notes: notesI.value.trim(),
    };
    if (existing) {
      store.patch('sessions', existing.id, { ...data, type, date: dateI.value, title: titleI.value.trim() || typeMeta(type).label });
    } else if (linkTo && linkOn) {
      completeUnit(linkTo.plan, linkTo.unit, { ...data, source: 'manual' });
    } else {
      store.upsert('sessions', {
        id: uid('ses'), plannedId: null, eventId: null, date: dateI.value, type,
        title: titleI.value.trim() || typeMeta(type).label, source: 'manual',
        maxHr: null, feeling: null, timeInZones: null, splits: [], ...data,
        createdAt: nowIso(), updatedAt: nowIso(),
      });
    }
    closeSheet();
    toast(existing ? t('session.saved') : t('session.trainingLogged'), 'good');
    refreshView();
  };

  openSheet({
    title: existing ? t('session.editTraining') : t('session.logTraining'),
    body: el('div', {}, [
      el('div', { class: 'field__row' }, [field(t('session.sport'), typeSel), field(t('session.date'), dateI)]),
      field(t('session.titleLabel'), titleI),
      el('div', { class: 'field__row' }, [
        field(t('session.duration'), dur.node),
        distField,
      ]),
      field(t('session.avgHr'), avgI),
      field(t('session.effortRpe'), rpeEl),
      field(t('session.notes'), notesI),
      matchBox,
    ]),
    footer: [
      existing ? el('button', { class: 'btn btn--danger', 'aria-label': t('session.delete'), onclick: async () => {
        if (await confirmDialog({ title: t('session.deleteTraining'), message: existing.title || typeMeta(existing.type).label, confirmLabel: t('session.delete'), danger: true })) {
          store.remove('sessions', existing.id);
          closeSheet(); toast(t('session.deleted')); goOrRefresh('#/calendar');
        }
      } }, icon('trash')) : null,
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: t('session.save'), onclick: save }),
    ],
  });
}

export function openReschedule(plan, unit) {
  const dateI = input({ type: 'date', value: unit.date });
  const warnBox = el('div', {});
  // Nicht-blockierender Hinweis: Doppelbelastung / harte Einheit ohne Erholungstag (#3)
  const refresh = () => {
    warnBox.innerHTML = '';
    if (!dateI.value || dateI.value === unit.date) return;
    const units = (store.find('plans', plan.id) || {}).units || [];
    const { sameDay, hardNeighbor } = rescheduleCheck(units, unit.id, dateI.value);
    const hints = [];
    if (sameDay) hints.push(t('session.sameDayHint', { title: sameDay.title }));
    if (hardNeighbor) hints.push(hardNeighbor.dir === 'prev' ? t('session.hardBefore', { title: hardNeighbor.unit.title }) : t('session.hardAfter', { title: hardNeighbor.unit.title }));
    hints.forEach((hint) => warnBox.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: hint }),
    ])));
    // What-if (R3): Auswirkung auf die Zielwoche vor dem Verschieben.
    // Auch bei gleicher Wochenlast zeigen, wenn ein neuer harter Folgetag entsteht.
    const mv = simulateMove(units, unit.id, dateI.value);
    if (mv && mv.target && (mv.target.deltaLoad !== 0 || mv.target.level !== 'ok')) warnBox.appendChild(el('div', { class: 'card card--flat row gap-2 mt-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: mv.target.level === 'hoch' ? 'var(--warn)' : 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('session.impact', { text: impactText(mv.target) }) }),
    ]));
  };
  dateI.addEventListener('change', refresh);
  // Schnellwahl für den häufigsten Fall – vorher nur der Datumsdialog (UI-29).
  const today = todayStr();
  const planUnits = (store.find('plans', plan.id) || {}).units || [];
  const free = nextFreeDay(planUnits, unit.id, addDays(today, 1));
  const quick = [
    { label: t('session.tomorrow'), date: addDays(today, 1) },
    { label: t('session.dayAfterTomorrow'), date: addDays(today, 2) },
    free ? { label: t('session.nextFreeDay', { day: fmtWeekday(free) }), date: free } : null,
  ].filter((q) => q && q.date !== unit.date);
  const chips = el('div', { class: 'row wrap gap-2 mb-3', role: 'group', 'aria-label': t('session.quickPick') }, quick.map((q) => el('button', {
    class: 'chip chip--accent chip--btn', type: 'button', text: q.label,
    onclick: () => { dateI.value = q.date; refresh(); },
  })));
  openSheet({
    title: t('session.rescheduleTitle'),
    body: el('div', {}, [chips, field(t('session.newDate'), dateI), warnBox]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      // WICHTIG: Der Status bleibt „geplant“ – die Einheit findet ja statt, nur an
      // einem anderen Tag. Die Verschiebung merkt sich `movedFrom` (Anzeige-Chip).
      // Ein Status „verschoben“ würde die Einheit aus Wochenlast, Ziel-Triage,
      // What-if und Erholungsvorschlägen herausfallen lassen.
      el('button', { class: 'btn btn--primary grow', text: t('session.reschedule'), onclick: () => { saveUnitPatch(plan.id, unit.id, { date: dateI.value, dow: isoDow(dateI.value), status: unit.status === 'erledigt' ? 'erledigt' : 'geplant', movedFrom: unit.movedFrom || unit.date }); closeSheet(); toast(t('session.rescheduled'), 'good'); refreshView(); } }),
    ],
  });
}

function markMissed(plan, unit) {
  const list = el('div', { class: 'col gap-2' });
  MISSED_REASONS.forEach((r) => list.appendChild(el('button', {
    class: 'btn btn--ghost btn--block', style: { justifyContent: 'flex-start', gap: '10px' },
    onclick: () => {
      saveUnitPatch(plan.id, unit.id, { status: 'verpasst', missedReason: r.key });
      closeSheet();
      toast(t('session.markedMissed'));
      navigate(`#/plan/${plan.eventId}`);
    },
  }, [el('span', { style: { fontSize: '1.2rem' }, text: r.emoji }), r.label])));
  openSheet({
    title: t('session.whyMissed'),
    body: el('div', {}, [
      el('p', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: t('session.missedHint', { title: unit.title }) }),
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
  const paceI = input({ value: unit.targetPaceSecPerKm ? fmtPace(unit.targetPaceSecPerKm) : '', placeholder: t('session.pacePlaceholder') });
  const hrSel = select([{ value: '', label: t('session.noneOption') }, ...[1, 2, 3, 4, 5].map((z) => ({ value: String(z), label: t('session.zone', { zone: z }) }))], unit.targetHrZone ? String(unit.targetHrZone) : '');
  const descI = textarea({ value: unit.description ?? '' });

  const iv = unit.intervals || {};
  const roundsI = input({ type: 'number', inputmode: 'numeric', value: iv.rounds ?? '', placeholder: t('session.roundsPlaceholder') });
  const workI = input({ type: 'number', inputmode: 'numeric', value: iv.workSec ? Math.round(iv.workSec) : '', placeholder: t('session.secShort') });
  const restI = input({ type: 'number', inputmode: 'numeric', value: iv.restSec ? Math.round(iv.restSec) : '', placeholder: t('session.secShort') });
  const intervalBox = el('div', { class: 'card card--flat', hidden: !['interval', 'tempo'].includes(type) }, [
    el('div', { class: 'field__label', text: t('session.intervalStructure') }),
    el('div', { class: 'field__row' }, [field(t('session.rounds'), roundsI), field(t('session.workSec'), workI), field(t('session.restSec'), restI)]),
  ]);
  const drinkI = input({ type: 'number', inputmode: 'numeric', value: unit.drinkIntervalMin ?? '', placeholder: t('session.drinkPlaceholder') });

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
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t('session.impact', { text: impactText(sim) }) }),
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
      toast(t('session.unitAdded'), 'good'); refreshView();
    } else {
      saveUnitPatch(plan.id, unit.id, fields);
      closeSheet(); toast(t('session.saved'), 'good'); refreshView();
    }
  };

  if (isNew) refreshWhatIf();
  openSheet({
    title: isNew ? t('session.addUnit') : t('session.editUnit'),
    body: el('div', {}, [
      el('div', { class: 'field__row' }, [field(t('session.type'), typeSel), field(t('session.date'), dateI)]),
      field(t('session.titleLabel'), titleI),
      el('div', { class: 'field__row' }, [field(t('session.distanceKm'), distI), field(t('session.durationMin'), durI)]),
      el('div', { class: 'field__row' }, [field(t('session.targetPaceMinKm'), paceI), field(t('session.hrZone'), hrSel)]),
      intervalBox,
      field(t('session.drinkEvery'), drinkI),
      field(t('session.description'), descI),
      isNew ? whatIfBox : null,
    ]),
    footer: [
      !isNew ? el('button', { class: 'btn btn--danger', 'aria-label': t('session.delete'), onclick: async () => {
        if (await confirmDialog({ title: t('session.deleteUnit'), message: unit.title, confirmLabel: t('session.delete'), danger: true })) {
          const cur = store.find('plans', plan.id);
          store.patch('plans', plan.id, { units: (cur.units || []).filter((u) => u.id !== unit.id) });
          closeSheet(); toast(t('session.deleted')); goOrRefresh(`#/plan/${plan.eventId}`);
        }
      } }, icon('trash')) : null,
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', { class: 'btn btn--primary grow', text: t('session.save'), onclick: save }),
    ],
  });
}

/** Bietet nach dem Hinzufügen an, eine ähnliche Einheit derselben Woche zu entfernen (#2). */
function offerOffset(plan, newUnit, offset) {
  const load = weekLoad((store.find('plans', plan.id).units) || [], newUnit.date);
  const reload = () => { closeSheet(); refreshView(); };
  openSheet({
    title: t('session.balanceTitle'),
    body: el('div', {}, [
      el('p', { class: 'muted', style: { fontSize: '.88rem' }, text: `${t('session.offsetPlanned', { title: newUnit.title, date: fmtDate(newUnit.date) })} ${load.km ? tp('session.offsetWeekKm', load.count, { km: load.km }) : tp('session.offsetWeek', load.count)}` }),
      el('p', { class: 'mt-2', style: { fontSize: '.88rem' }, text: t('session.balanceText') }),
      el('div', { class: 'card card--flat mt-2' }, [
        el('div', { class: 'card__title', text: offset.title }),
        el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `${fmtDate(offset.date)}${offset.targetDistanceKm ? ' · ' + fmtKm(offset.targetDistanceKm) : ''}` }),
      ]),
      el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('session.balanceNote') }),
    ]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('session.keepBoth'), onclick: reload }),
      el('button', {
        class: 'btn btn--primary grow', text: t('session.removeFromPlan'),
        onclick: () => {
          const cur = store.find('plans', plan.id);
          store.patch('plans', plan.id, { units: (cur.units || []).filter((u) => u.id !== offset.id) });
          toast(t('session.balanced'), 'good'); reload();
        },
      }),
    ],
  });
}

/* ------------------------------- Bausteine ------------------------------ */
function bigStat(val, label) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat__val num', text: val }), el('div', { class: 'stat__label', text: label })]);
}

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
  const wrap = el('div', {}, [sectionHead(t('session.timeInZones')), el('div', { class: 'card' }, [bar, legend])]);
  return wrap;
}

function splitsCard(splits) {
  const tbl = el('table', { class: 'splits' }, [
    el('thead', {}, el('tr', {}, [el('th', { text: 'km' }), el('th', { text: t('session.pace') }), el('th', { text: '', style: 'width:45%' })])),
    el('tbody', {}, splits.map((s) => el('tr', {}, [
      el('td', { text: String(s.km) }),
      el('td', { text: fmtPace(s.sec) }),
      el('td', {}, el('div', { class: 'splits__bar' }, el('i', { style: { width: `${splitBarPct(s.sec, splits)}%` } }))),
    ]))),
  ]);
  return el('div', {}, [sectionHead(t('session.splits')), el('div', { class: 'card', title: t('session.splitsBarHint') }, tbl)]);
}
