/* =========================================================================
   cycle.js — Zykluskalender (zyklusbewusste, rücksichtsvolle Trainingsplanung).
   - Nutzerin markiert Periodenstarts; daraus werden Zykluslänge, aktuelle
     Phase und die Prognose der nächsten Periode berechnet.
   - Menstruationstage sind „geschützt“: Einheiten lassen sich dort schadfrei
     verschieben/auslassen (kein Adherence-/Momentum-Malus).
   - Phasentipps sind bewusst neutral: Die Studienlage zu Leistungsunterschieden
     im Zyklus ist schwach (McNulty et al. 2020) – maßgeblich ist das Befinden.
   - Hormonelle Verhütung (Einstellung): keine natürlichen Phasen, nur Blutungstage.
   - Ohne neuen Eintrag seit ~3 Monaten gibt es keine Phasen und keine Prognose mehr.
   - Sensible Daten bleiben lokal; das Modul ist in den Einstellungen abschaltbar.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, todayStr, addDays, diffDays,
  fmtDate, fmtDateLong, sectionHead, toast, openSheet, closeSheet, field, input, confirmDialog, toggle,
  fmtWeekday,
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
  // Unter hormoneller Verhütung: keine natürlichen Phasen, nur „zwischen den Blutungen“.
  neutral:      { get label() { return t('cycle.phaseNeutral'); }, color: '#9aa7b4', emoji: '○' },
};

/** Ist das Zyklus-Modul aktiv? (Standard an; in den Einstellungen abschaltbar) */
// Zyklus ist beim Verwalten eines Mitglieds (Admin) inaktiv – die Daten bleiben
// privat (kein Phasen-Einfluss auf Dashboard/Badges). In der eigenen Sicht normal.
// Konsistent mit allen Modulen: aktiv, solange nicht ausdrücklich abgewählt.
/** Herkunft importierter Perioden (sonst von Hand erfasst). */
const PERIOD_SOURCE = {
  get 'apple-health'() { return t('cycle.fromAppleHealth'); },
  get health() { return t('cycle.fromAppleHealth'); },
  get 'health-connect'() { return t('cycle.fromHealthConnect'); },
};

export function cycleEnabled() { return !store.isManaging() && store.settings().modules?.cycle !== false; }

/** Hormonelle Verhütung (Pille, Hormonspirale, Implantat …): Zyklusphasen sind dann
    nicht aussagekräftig (IOC 2023) – die App zeigt nur die Blutungstage. */
export function hormonalContraception() { return store.settings().cycleHormonal === true; }

// Periodenstarts; Hilfsdatensätze im selben Bereich (z. B. die Antwort auf
// „Periode ausgeblieben?“, `_kind: 'check'`) zählen nicht mit.
function entries() {
  return store.get('cycle').filter((c) => c && !c._kind && c.startDate).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Durchschnittliche Zykluslänge aus den Abständen der Periodenstarts. Lange Zyklen
    (bis 90 Tage) zählen mit – sie wurden früher verworfen und die App rechnete dann
    still mit 28 Tagen. Nur vermutlich vergessene Einträge bleiben außen vor. */
export function avgCycleLength() {
  return typicalCycleLength(periodStarts(store.get('cycle')), store.settings().cycleLength || 28);
}

/** Gespeicherte Antwort auf „Periode ausgeblieben?“ (oder null). */
export function cycleCheck() {
  return store.get('cycle').find((c) => c && c._kind === 'check') || null;
}

/** Zustand rund um eine überfällige Periode (siehe cyclecalc.periodSignal) – oder null. */
export function periodState(today = todayStr()) {
  if (!cycleEnabled()) return null;
  const starts = periodStarts(store.get('cycle'));
  // Unter hormoneller Verhütung ist eine ausbleibende Blutung kein Warnzeichen für
  // Energiemangel (IOC 2023) – wie die Antwort „Hormonelle Verhütung“ auf die Frage.
  const check = hormonalContraception() && starts.length
    ? { for: starts.at(-1), answer: 'verhuetung' } : cycleCheck();
  return periodSignal({
    starts, today, avgLen: avgCycleLength(), gate: store.settings().labsGate || {}, check,
  });
}

/** Antwort auf „Periode ausgeblieben?“ speichern (privat, im Zyklus-Bereich). */
export function answerPeriodCheck(answer, today = todayStr()) {
  const s = periodState(today);
  if (!s) return;
  store.upsert('cycle', { id: 'cycle-check', _kind: 'check', for: s.lastStart, answer, at: nowIso() });
  if (answer === 'schwanger') {
    // Schwangerschaft/Stillzeit gilt dann auch für Ernährung und Ziele (keine Abnehmziele).
    store.setSetting('labsGate', { ...(store.settings().labsGate || {}), pregnancy: true });
  }
}
export function avgPeriodLength() {
  const ps = entries().map((x) => x.periodLength).filter(Boolean);
  return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : (store.settings().periodLength || 5);
}
function lastStart() { const e = entries(); return e.length ? e.at(-1).startDate : null; }

/** Nächster prognostizierter Periodenstart nach `today` (für Tests injizierbar).
    null, wenn er mehr als PREDICTION_MAX_AGE_DAYS nach dem letzten echten Eintrag
    läge – „Nächste Periode in X Tagen“ wäre dann eine Behauptung ohne Grundlage. */
export function nextPredictedStart(today = todayStr()) {
  const last = lastStart();
  if (!last) return null;
  const cl = avgCycleLength();
  let s = last;
  while (s <= today) s = addDays(s, cl);
  return diffDays(last, s) > PREDICTION_MAX_AGE_DAYS ? null : s;
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

/** Wie lange eine Prognose ohne neuen echten Eintrag noch als belastbar gilt (Tage). */
export const PREDICTION_MAX_AGE_DAYS = 92; // ~3 Monate

/**
 * Phase eines Datums. Prognostizierte Tage gibt es nur bis PREDICTION_MAX_AGE_DAYS
 * nach dem letzten echten Eintrag – danach weder Phase noch Schutz (vorher zeigte
 * die Zyklusseite Monate später noch Phasen, schützte aber nicht mehr). Unter
 * hormoneller Verhütung heißen alle Tage außer den Blutungstagen `neutral`.
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
 * Geschützter Tag = Menstruationstag.
 *
 * Echte (selbst eingetragene) Perioden schützen immer. Eine reine PROGNOSE zählt
 * nur, solange der letzte echte Eintrag höchstens ~3 Monate zurückliegt: Danach
 * ist sie nicht mehr belastbar (Zykluslänge ändert sich, Einträge fehlen), und
 * geschützte Tage würden die Plan-Einhaltung stillschweigend schönen.
 */
export function isProtectedDay(dateStr) {
  const p = cyclePhase(dateStr);
  if (!p || p.phase !== 'menstruation') return false;
  if (!p.predicted) return true;              // echter Eintrag -> immer geschützt
  const last = lastStart();
  if (!last) return false;
  return diffDays(last, dateStr) <= PREDICTION_MAX_AGE_DAYS;
}

/* ------------------------------ Eingabe --------------------------------- */
function addPeriodStart(dateStr, periodLength) {
  store.upsert('cycle', { id: uid('cyc'), startDate: dateStr, periodLength: periodLength || avgPeriodLength(), createdAt: nowIso() });
}

/* ---------------- Entschärfung am 1. Periodentag – nur auf Wunsch (#3) --------------- */
// Früher wurde jede offene Einheit am 1. Tag AUTOMATISCH entschärft – auch bei
// beschwerdefreien Sportlerinnen. Jetzt fragt die App nach dem Befinden und passt nur
// an, wenn die Nutzerin „heute lockerer“ wählt (TRAIN-30).
// Diese Typen bleiben unangetastet: schon locker/Ruhe – oder ein Wettkampf. Feste
// Termine (Fußball/Spiele) werden separat über `!u.fixed` ausgeschlossen.
const CYCLE_SKIP_TYPES = ['rest', 'recovery', 'mobility', 'walk', 'race'];

/**
 * Einheiten am 1. Periodentag, die für die automatische Entschärfung infrage kommen:
 * offen (geplant), kein fester Termin, nicht ohnehin locker/Ruhe/Wettkampf. Reine
 * Funktion (testbar) über die Einheiten EINES Plans.
 */
export function cycleSoftenTargets(units = [], startDate) {
  return (units || []).filter((u) => u && u.date === startDate && !u.fixed
    && isOpen(u)
    && !CYCLE_SKIP_TYPES.includes(u.type));
}

/** Zyklus-Entschärfung einer Einheit (Patch-Felder) – lockerer Tag mit Markierung. */
export function cycleEaseVariant(unit) {
  return {
    ...gentleVariant(unit, {
      title: t('cycle.easeTitle'),
      description: t('cycle.easeDescription'),
    }),
    cycleEased: true,
  };
}

/** Offene, entschärfbare Einheiten am Tag `startDate` über alle Pläne. */
function easeTargets(startDate) {
  return store.get('plans').flatMap((plan) => cycleSoftenTargets(plan.units || [], startDate));
}

/**
 * Entschärft das Training am 1. Tag – nur nach ausdrücklicher Wahl („Heute lockerer“),
 * planübergreifend, protokolliert je Plan und über den Snapshot rückgängig (#3).
 * @returns {number} Anzahl entschärfter Einheiten.
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

/* ------------------------------- Ansicht -------------------------------- */
export function render(view) {
  setHeader({ title: t('nav.cycle') });

  // Datenschutz: Zyklusdaten sind ausschließlich für die Person selbst sichtbar.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: t('cycle.privateTitle') }),
      el('div', { class: 'muted', style: { maxWidth: '320px', margin: '0 auto' }, text: who ? t('cycle.privateFor', { name: who.name }) : t('cycle.privateForMember') }),
    ]));
    return;
  }

  // Modul abgewählt (Einstellungen → Module): wie alle Module deaktiviert anzeigen.
  if (!cycleEnabled()) {
    view.appendChild(moduleOff(t('cycle.moduleName')));
    return;
  }

  const today = todayStr();
  const hasData = entries().length > 0;
  const phase = cyclePhase(today);
  const last = lastStart();
  const hormonal = hormonalContraception();
  // Ohne neuen Eintrag seit ~3 Monaten gibt es keine Prognose mehr (Phasen, nächste
  // Periode, Schutz) – nur noch die Frage, was zutrifft.
  const stale = !!(last && diffDays(last, today) > PREDICTION_MAX_AGE_DAYS);

  // Überfällige Periode: erst fragen, dann (bei „ausgeblieben“ bzw. mehr als 90 Tagen
  // ohne Antwort) auf ärztliche Abklärung hinweisen – kein Fehlalarm bei Schwangerschaft,
  // hormoneller Verhütung oder nur fehlenden Einträgen.
  const ps = periodState(today);
  if (ps && ps.flag) view.appendChild(periodFlagCard(periodFlag(ps)));
  if (ps && ps.state === 'ask') view.appendChild(periodQuestionCard(ps));
  if (ps && ps.state === 'contraception' && !hormonal) view.appendChild(noteCard(t('cycle.noteContraception')));
  if (ps && ps.state === 'untracked') view.appendChild(noteCard(t('cycle.noteUntracked')));
  if (!hormonal && longCycleCount(periodStarts(store.get('cycle'))) >= 2) {
    view.appendChild(noteCard(t('cycle.noteLongCycles')));
  }

  // Aktuelle Phase
  if (phase) {
    const pm = PHASE_META[phase.phase];
    // Schrift passend zur PHASENfarbe (nicht zum Akzent) und der Verlauf weg von ihr (UI-12).
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

  // Eingabe
  view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openPeriodSheet(), }, [icon('plus'), t('cycle.logPeriodStart')]));

  // Phasen-Vorschau der nächsten 28 Tage
  if (hasData) {
    view.appendChild(sectionHead(t('cycle.next4Weeks')));
    // Mit Tageszahl, Wochentagszeile und Beschreibung je Tag – vorher 28 Farbfelder, die
    // Phase nur über die Farbe kodiert (UI-37, WCAG 1.4.1). Prognose-Tage gestrichelt.
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

  // Einträge
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

  // Hormonelle Verhütung: blendet die Phasen aus, behält die Blutungstage (HEALTH-32).
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

/** Arzthinweis bei ausgebliebener Periode (gleicher Text in Zyklus, Labor und „Heute“). */
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

/** „Periode ausgeblieben?“ – fragt nach, statt einen Energiemangel zu unterstellen. */
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

/** Neutrale, befindensorientierte Tipps je Phase – keine Leistungsversprechen: Die
    Meta-Analyse von McNulty et al. (2020) findet über den Zyklus allenfalls eine
    triviale Leistungsminderung früh in der Follikelphase und hält allgemeine
    phasenbasierte Empfehlungen für nicht ableitbar. */
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
 * Nach dem Eintragen eines Periodenbeginns: kurze Befindlichkeitsfrage, statt das
 * Training automatisch zu entschärfen. Nur für heute oder morgen und nur, wenn dort
 * eine entschärfbare Einheit steht.
 */
async function askAboutFirstDay(startDate) {
  const today = todayStr();
  if (startDate < today || diffDays(today, startDate) > 1) return 0;
  const targets = easeTargets(startDate);
  if (!targets.length) return 0;
  const names = [...new Set(targets.map((u) => t('cycle.quotedTitle', { title: u.title })))].join(', ');
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
        // Training am 1. Tag nur auf Wunsch lockerer (#3/TRAIN-30) – protokolliert & rückgängig.
        const eased = await askAboutFirstDay(start);
        toast(eased ? t('cycle.savedEased', { n: eased }) : t('cycle.saved'), 'good', eased ? 3600 : undefined);
        if (eased) rerender();
      } }),
    ],
  });
}

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }
