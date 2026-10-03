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

export const PHASE_META = {
  menstruation: { label: 'Menstruation', color: '#ef5d6c', emoji: '🩸' },
  follikel:     { label: 'Follikelphase', color: '#43c59e', emoji: '🌱' },
  ovulation:    { label: 'Ovulation', color: '#f5a623', emoji: '⭐' },
  luteal:       { label: 'Lutealphase', color: '#7c5cff', emoji: '🌙' },
  // Unter hormoneller Verhütung: keine natürlichen Phasen, nur „zwischen den Blutungen“.
  neutral:      { label: 'Zwischen den Blutungen', color: '#9aa7b4', emoji: '○' },
};

/** Ist das Zyklus-Modul aktiv? (Standard an; in den Einstellungen abschaltbar) */
// Zyklus ist beim Verwalten eines Mitglieds (Admin) inaktiv – die Daten bleiben
// privat (kein Phasen-Einfluss auf Dashboard/Badges). In der eigenen Sicht normal.
// Konsistent mit allen Modulen: aktiv, solange nicht ausdrücklich abgewählt.
/** Herkunft importierter Perioden (sonst von Hand erfasst). */
const PERIOD_SOURCE = { 'apple-health': 'aus Apple Health', health: 'aus Apple Health', 'health-connect': 'aus Health Connect' };

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
      title: 'Ruhiger Zyklus-Tag',
      description: 'Auf deinen Wunsch entschärft: 1. Tag deiner Periode. Bewusst locker – trainiere nur, wenn es sich gut anfühlt, sonst ohne Wertung auslassen. Rückgängig über „Zuletzt automatisch angepasst“ auf „Heute“.',
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
      kind: 'cycle', title: 'Zyklus: 1. Tag lockerer',
      reason: `Periodenbeginn am ${fmtDate(startDate)} – auf deinen Wunsch ruhiger trainieren.`,
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
  if (ps && ps.state === 'contraception' && !hormonal) view.appendChild(noteCard('Unter hormoneller Verhütung sind Zyklusphasen und Prognose nicht aussagekräftig – sie dienen hier nur der Orientierung.'));
  if (ps && ps.state === 'untracked') view.appendChild(noteCard('Trag den letzten Periodenbeginn nach, dann stimmen Phasen und Prognose wieder.'));
  if (!hormonal && longCycleCount(periodStarts(store.get('cycle'))) >= 2) {
    view.appendChild(noteCard('Mehrere deiner letzten Zyklen waren länger als 35 Tage. Das kann mit der Energieversorgung zusammenhängen – lass es ärztlich abklären, wenn es neu für dich ist.'));
  }

  // Aktuelle Phase
  if (phase) {
    const pm = PHASE_META[phase.phase];
    // Schrift passend zur PHASENfarbe (nicht zum Akzent) und der Verlauf weg von ihr (UI-12).
    const ink = onAccent(pm.color);
    const end = luminance(ink) < 0.5 ? mix(pm.color, '#ffffff', 0.22) : mix(pm.color, '#000000', 0.22);
    view.appendChild(el('div', { class: 'hero', style: { background: `linear-gradient(140deg, ${pm.color}, ${end})`, color: ink } }, [
      el('div', { class: 'hero__eyebrow', text: `Zyklustag ${phase.cycleDay} · Ø ${phase.cycleLength} Tage${phase.predicted ? ' · Prognose' : ''}` }),
      el('div', { class: 'hero__title', text: `${pm.emoji} ${pm.label}` }),
      el('div', { style: { opacity: '.92', fontSize: '.9rem', position: 'relative' }, text: phaseTip(phase.phase) }),
    ]));
  } else if (hasData && stale) {
    view.appendChild(el('div', { class: 'card', style: { borderLeft: '4px solid var(--warn)' } }, [
      el('div', { style: { fontWeight: '700' }, text: 'Prognose pausiert' }),
      el('div', { class: 'muted', style: { fontSize: '.84rem', marginTop: '2px' }, text: `Dein letzter Eintrag liegt ${diffDays(last, today)} Tage zurück. Ohne neue Einträge rechnet Cat-O-Fit keine Phasen und keine nächste Periode mehr – und schützt auch keine Tage mehr. Trag den letzten Periodenbeginn nach, dann geht es weiter.` }),
    ]));
  } else if (!hasData) {
    view.appendChild(el('div', { class: 'card card--flat', text: hormonal
      ? 'Noch keine Blutung erfasst. Trag den Beginn deiner nächsten Blutung ein, dann markiert Cat-O-Fit die Tage.'
      : 'Noch keine Periode erfasst. Markiere deinen letzten Periodenbeginn, dann berechnet Cat-O-Fit deine Phasen.' }));
  }
  const np = nextPredictedStart();
  if (np) {
    const inDays = diffDays(today, np);
    view.appendChild(el('div', { class: 'card mt-4 row gap-3', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.6rem' }, text: '🩸' }),
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '700' }, text: `${hormonal ? 'Nächste Blutung' : 'Nächste Periode'} ${inDays > 0 ? `in ${inDays} Tagen` : 'könnte heute beginnen'}` }),
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `voraussichtlich ${fmtDate(np)} (Prognose)` }),
      ]),
    ]));
  }

  // Eingabe
  view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => openPeriodSheet(), }, [icon('plus'), 'Periodenbeginn eintragen']));

  // Phasen-Vorschau der nächsten 28 Tage
  if (hasData) {
    view.appendChild(sectionHead('Nächste 4 Wochen'));
    // Mit Tageszahl, Wochentagszeile und Beschreibung je Tag – vorher 28 Farbfelder, die
    // Phase nur über die Farbe kodiert (UI-37, WCAG 1.4.1). Prognose-Tage gestrichelt.
    const head = el('div', { class: 'cycle-strip cycle-strip__head', 'aria-hidden': 'true' });
    for (let i = 0; i < 7; i++) head.appendChild(el('span', { text: fmtWeekday(addDays(today, i)) }));
    view.appendChild(head);
    const strip = el('div', { class: 'cycle-strip', role: 'list', 'aria-label': 'Zyklus-Vorschau der nächsten 4 Wochen' });
    for (let i = 0; i < 28; i++) {
      const d = addDays(today, i);
      const p = cyclePhase(d);
      const meta = p ? PHASE_META[p.phase] : null;
      const desc = `${fmtDate(d)}${i === 0 ? ' (heute)' : ''}: ${meta ? meta.label : 'keine Angabe'}${p && p.predicted ? ', Prognose' : ''}`;
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
    view.appendChild(sectionHead('Erfasste Perioden'));
    const list = el('div', { class: 'list-card' });
    entries().slice().reverse().forEach((e) => list.appendChild(el('div', { class: 'list-item' }, [
      el('span', { style: { fontSize: '1.1rem' }, text: '🩸' }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: fmtDate(e.startDate) }),
        el('div', { class: 'list-item__sub', text: `${e.periodLength || avgPeriodLength()} Tage${PERIOD_SOURCE[e.source] ? ' · ' + PERIOD_SOURCE[e.source] : ''}` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': 'Löschen', onclick: async () => { if (await confirmDialog({ title: 'Eintrag löschen?', confirmLabel: 'Löschen', danger: true })) { store.remove('cycle', e.id); rerender(); } } }, icon('trash')),
    ])));
    view.appendChild(list);
  }

  // Hormonelle Verhütung: blendet die Phasen aus, behält die Blutungstage (HEALTH-32).
  view.appendChild(sectionHead('Verhütung'));
  view.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center', gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { style: { fontWeight: '650', fontSize: '.92rem' }, text: 'Hormonelle Verhütung' }),
        el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '2px' }, text: 'Pille, Hormonspirale, Implantat, Ring … Dann gibt es keine natürlichen Zyklusphasen – Cat-O-Fit zeigt nur deine Blutungstage und fragt bei einer ausbleibenden Blutung nicht nach.' }),
      ]),
      toggle(hormonal, (on) => { store.setSetting('cycleHormonal', !!on); rerender(); }, 'Hormonelle Verhütung'),
    ]),
  ]));

  // Info
  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'An deinen Menstruationstagen kannst du Einheiten ohne Wertung verschieben oder auslassen – sie zählen nicht als verpasst. Wie du dich im Zyklus fühlst, ist sehr individuell; die Studienlage zu Leistungsunterschieden je Phase ist schwach – richte dich nach deinem Befinden. Deine Zyklusdaten sieht nur du – auch Admins nicht; der Server gibt sie nur nach deiner Anmeldung heraus. Das Modul ist in den Einstellungen abschaltbar.' }),
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
    toast(key === 'schwanger' ? 'Gespeichert – Abnehmziele sind jetzt ausgesetzt' : 'Gespeichert', 'good');
    rerender();
  };
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid var(--warn)' } }, [
    el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: 'Periode überfällig?' }),
    el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: `Dein letzter Periodenbeginn liegt ${ps.days} Tage zurück – länger als bei dir üblich. Was trifft zu?` }),
    el('div', { class: 'col gap-2 mt-2' }, PERIOD_ANSWERS.map((a) => el('button', {
      class: 'btn btn--ghost btn--block', style: { justifyContent: 'flex-start', fontSize: '.84rem' }, onclick: () => pick(a.key),
    }, a.label))),
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: 'Deine Antwort bleibt privat im Zyklusbereich. Neue Periodenstarts trägst du wie gewohnt unten ein.' }),
  ]);
}

/** Neutrale, befindensorientierte Tipps je Phase – keine Leistungsversprechen: Die
    Meta-Analyse von McNulty et al. (2020) findet über den Zyklus allenfalls eine
    triviale Leistungsminderung früh in der Follikelphase und hält allgemeine
    phasenbasierte Empfehlungen für nicht ableitbar. */
export function phaseTip(phase) {
  return {
    menstruation: 'Manche fühlen sich an diesen Tagen schlapper, andere trainieren wie gewohnt – beides ist okay. Richte dich nach deinem Befinden.',
    follikel: 'Viele fühlen sich in dieser Phase fit – ob und wie stark, ist sehr individuell. Trainiere nach Plan und nach Gefühl.',
    ovulation: 'Um den Eisprung herum merken manche kaum etwas, andere ein Ziehen. Trainiere nach Gefühl.',
    luteal: 'Vor der Periode berichten manche von mehr Müdigkeit oder Wassereinlagerungen. Merkst du das, achte besonders auf Schlaf und Erholung.',
    neutral: 'Unter hormoneller Verhütung gibt es keine natürlichen Zyklusphasen – Cat-O-Fit zeigt nur deine Blutungstage.',
  }[phase] || '';
}

function legend() {
  const keys = hormonalContraception() ? ['menstruation', 'neutral'] : ['menstruation', 'follikel', 'ovulation', 'luteal'];
  return el('div', { class: 'row wrap gap-3 mt-3', style: { justifyContent: 'center' } }, [
    ...keys.map((k) => PHASE_META[k]).map((m) => el('span', { class: 'zones-legend__item' }, [
      el('span', { class: 'zones-legend__sw', style: { background: m.color } }), m.label,
    ])),
    el('span', { class: 'zones-legend__item dim', text: 'gestrichelt = Prognose' }),
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
  const names = [...new Set(targets.map((u) => `„${u.title}“`))].join(', ');
  const ease = await confirmDialog({
    title: 'Wie geht es dir?',
    message: `${startDate === today ? 'Heute' : 'Morgen'} steht ${names} an. Viele trainieren am ersten Tag ganz normal, manche fühlen sich schlapp – beides ist okay. Möchtest du es lockerer angehen?`,
    confirmLabel: 'Lockerer machen',
    cancelLabel: 'Wie geplant',
  });
  return ease ? applyCycleEasing(startDate) : 0;
}

export function openPeriodSheet() {
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
      el('button', { class: 'btn btn--primary grow', text: 'Speichern', onclick: async () => {
        const start = dateI.value;
        addPeriodStart(start, parseInt(lenI.value) || 5);
        closeSheet();
        rerender();
        // Training am 1. Tag nur auf Wunsch lockerer (#3/TRAIN-30) – protokolliert & rückgängig.
        const eased = await askAboutFirstDay(start);
        toast(eased ? `Gespeichert · Training am 1. Tag lockerer (${eased})` : 'Gespeichert', 'good', eased ? 3600 : undefined);
        if (eased) rerender();
      } }),
    ],
  });
}

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }
