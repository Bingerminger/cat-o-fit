/* =========================================================================
   labs-view.js — Ansicht „Labor & Ergänzung“.

   Aufbau von oben nach unten, bewusst in dieser Reihenfolge:
     1. Rote Flaggen (falls vorhanden) – alles andere tritt dann zurück
     2. Energieversorgung (RED-S/LEA) – das häufigste echte Problem
     3. Laborwerte mit Einordnung und Verlauf
     4. Vorschläge zur Ergänzung (nur im Vollmodus, immer „food first“)
     5. Eigener Einnahmeplan mit Abhaken

   Die gesamte Fachlogik liegt in labs.js / supplements.js / redflags.js; hier
   wird nur dargestellt und erfasst.
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
  ANALYTES, ANALYTE_GROUPS, unitsFor, unitFactor, toCanonical, fromCanonical, overview, series,
  refRange, hasOwnRef, latest, migrateLabRecord, implausible, LAB_SCHEMA, labRecordsFromReport,
} from './labs.js';
import { LAB_SOURCES, LAB_SOURCES_TEASER } from './labsources.js';
import {
  recommend, activePlans, takenOn, adherence, adherenceSeries, SUPPLEMENTS, DOPING_NOTE, catalogFor, isDaily,
} from './supplements.js';
import {
  redFlags, energyAvailability, energyAvailabilitySeries, leanMassNow, EA_OPTIMAL, eaLowFor,
} from './redflags.js';
import { currentEligibility, currentEnergyTargets, openGateSheet } from './wellness.js';
import { cycleCheck, avgCycleLength } from './cycle.js';

const TONE_COLOR = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--text-3)' };
/** Dieselben Töne als lesbare Textfarbe (≥ 4,5:1) – die Flächenfarben sind für Schrift zu hell (UI-12). */
const TONE_TEXT = { good: 'var(--good-text)', warn: 'var(--warn-text)', bad: 'var(--bad-text)', neutral: 'var(--text-2)' };
/** Mittel, die meist nur situativ genommen werden – im Plan standardmäßig „bei Bedarf“. */
const AS_NEEDED = ['caffeine', 'beetroot', 'electrolytes'];

export function labsEnabled() {
  return !store.isManaging() && store.settings().modules?.labs !== false;
}

/* --------------------------------- View ---------------------------------- */

export function render(view) {
  setHeader({ title: 'Labor & Ergänzung' });

  // Datenschutz: wie Zyklusdaten ausschließlich für die Person selbst sichtbar.
  if (store.isManaging()) {
    const who = store.activeMember();
    view.appendChild(el('div', { class: 'empty', style: { paddingTop: '48px' } }, [
      el('div', { class: 'empty__icon', html: iconSvg('heart') }),
      el('div', { class: 'empty__title', text: 'Privat' }),
      el('div', { class: 'muted', style: { maxWidth: '340px', margin: '0 auto' }, text: `Laborwerte und Ergänzungen sind private Gesundheitsdaten – nur für ${who ? who.name : 'das Mitglied'} selbst sichtbar, auch für Admins.` }),
    ]));
    return;
  }
  if (!labsEnabled()) { view.appendChild(moduleOff('Labor & Ergänzung')); return; }

  const today = todayStr();
  const profile = store.profile();
  const s = store.settings();
  const labs = store.get('labs');
  const supps = store.get('supplements');
  // Ein Eignungsstatus für die ganze App (Gate + Alter aus dem Geburtsjahr).
  const elig = currentEligibility(today);

  /* --- Ersteinrichtung: Abgrenzung klären ------------------------------- */
  if (!elig.answered) {
    view.appendChild(introCard());
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => openGateSheet({ onSaved: rerender }) }, [icon('check'), 'Einrichten']));
    return;
  }

  /* --- 1. Rote Flaggen --------------------------------------------------- */
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

  /* --- 2. Energieversorgung (RED-S) -------------------------------------- */
  // Kinder- und Jugendprofil: keine Kalorienrechnung (die Schwellen gelten für Erwachsene).
  if (!elig.minor) {
    const health = store.get('health');
    const tg = currentEnergyTargets(today);
    const eaArgs = {
      profile, health, sessions: store.get('sessions'), diary: store.get('diary'), today,
      // Beim Abnehmen ist 30–45 vorübergehend vertretbar – eigener Hinweis statt Alarm.
      lossGoal: !tg.block && !!tg.goalStatus && tg.goalStatus.status === 'abnehmen',
    };
    const ea = energyAvailability(eaArgs);
    if (ea) view.appendChild(elig.hideNumbers ? eaCardPlain(ea) : eaCard(ea, eaArgs));
    else if (!leanMassNow({ profile, health, today }).ffm && hasRecentMeals(eaArgs.diary, today)) {
      view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
        el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
        el('div', {}, [
          el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Für die Einschätzung deiner Energieversorgung fehlt die fettfreie Masse. Trag bei den Körperwerten den Körperfettanteil oder die fettfreie Masse ein (z. B. von der Waage oder aus Apple Health) – ein Wert aus den letzten vier Monaten genügt.' }),
          el('button', { class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' }, onclick: () => { location.hash = '#/health'; } }, [icon('heart'), 'Zu den Körperwerten']),
        ]),
      ]));
    }
  }

  /* --- 3. Laborwerte ----------------------------------------------------- */
  view.appendChild(sectionHead('Deine Werte', { label: '+ Wert erfassen', onClick: () => openValueSheet(elig) }, { help: 'labor' }));

  if (!elig.labsEvaluate) {
    view.appendChild(noteCard('Kinder- und Jugendprofil: Cat-O-Fit dokumentiert deine Werte nur und bewertet sie nicht – die hinterlegten Bereiche gelten für Erwachsene. Die passenden Bereiche für dein Alter stehen auf dem Befund; besprich ihn mit deiner Kinder- und Jugendärztin oder deinem Kinder- und Jugendarzt.'));
  }
  const rows = overview(labs, { sex: profile.sex, today, evaluate: elig.labsEvaluate, pregnant: elig.pregnancy });
  if (!rows.length) {
    view.appendChild(emptyState('flask', 'Noch keine Werte',
      elig.labsEvaluate
        ? 'Trage Werte aus deinem Laborbefund ein – Cat-O-Fit ordnet sie sportbezogen ein und zeigt dir den Verlauf.'
        : 'Trage Werte aus deinem Laborbefund ein – Cat-O-Fit zeigt dir den Verlauf.'));
    view.appendChild(sourcesCard());
  } else {
    view.appendChild(labStats(rows, labs, elig.labsEvaluate));
    const list = el('div', { class: 'list-card' });
    rows.forEach((r, i) => list.appendChild(valueRow(r, i, labs)));
    view.appendChild(list);
    view.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: elig.labsEvaluate ? 'Antippen öffnet den Verlauf mit Referenz- und Sport-Zielbereich.' : 'Antippen öffnet den Verlauf.' }));
  }
  // Ganzer Befund auf einmal statt Wert für Wert (MKT-09).
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openReportSheet() }, [icon('flask'), 'Befund mit mehreren Werten erfassen']));

  /* --- 4. Vorschläge ----------------------------------------------------- */
  view.appendChild(sectionHead('Ergänzung'));
  if (elig.mode === 'documentation') {
    view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: 'Dokumentationsmodus' }),
        el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: elig.minor
          ? `Grund: ${elig.reasons.join(' · ')}. Für Kinder und Jugendliche gibt Cat-O-Fit keine Einnahme-Empfehlungen – Nahrungsergänzung gehört hier in ärztliche Hände. Erfassen und Verlauf ansehen kannst du weiterhin alles.`
          : `Grund: ${elig.reasons.join(' · ')}. Cat-O-Fit richtet sich an gesunde Erwachsene und gibt in diesem Fall bewusst keine Einnahme-Empfehlungen. Erfassen und Verlauf ansehen kannst du weiterhin alles – besprich die Werte mit deiner Ärztin oder deinem Arzt.` }),
        el('button', { class: 'btn btn--ghost mt-2', style: { fontSize: '.8rem' }, onclick: () => openGateSheet({ onSaved: rerender }) }, 'Angaben ändern'),
      ]),
    ]));
  } else if (flags.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Solange ein Wert ärztlich abzuklären ist, gibt Cat-O-Fit keine Empfehlungen zur Ergänzung.' }));
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
      view.appendChild(el('div', { class: 'card card--flat mt-2', text: 'Aus deinen Werten ergibt sich derzeit kein Anlass für eine Ergänzung. Das ist eine gute Nachricht.' }));
    }
    rec.items.forEach((it) => view.appendChild(suggestionCard(it)));
    rec.interactions.forEach((t) => view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: t }),
    ])));
  }

  /* --- 5. Eigener Einnahmeplan ------------------------------------------ */
  view.appendChild(sectionHead('Dein Plan', { label: '+ Hinzufügen', onClick: () => openPlanSheet(null, elig) }));
  const plans = activePlans(supps, today);
  if (!plans.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Noch nichts eingeplant. Was du regelmäßig nimmst, kannst du hier eintragen und täglich abhaken.' }));
  } else {
    const list = el('div', { class: 'list-card' });
    plans.forEach((p, i) => list.appendChild(planRow(p, today, i)));
    view.appendChild(list);
    const ad = adherence(supps, today);
    if (ad) {
      const ser = adherenceSeries(supps, today, 21);
      view.appendChild(el('div', { class: 'card mt-2' }, [
        el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
          el('div', { class: 'card__title', style: { fontSize: '.9rem' }, text: 'Einnahmetreue' }),
          el('div', { class: 'num', style: { fontWeight: '800', color: ad.pct >= 80 ? 'var(--good)' : ad.pct >= 50 ? 'var(--warn)' : 'var(--bad)' }, text: `${ad.pct} %` }),
        ]),
        el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: `${ad.taken} von ${ad.expected} Einnahmen in 14 Tagen · Balken = letzte 21 Tage (volle Höhe = 100 %)${plans.some((p) => !isDaily(p)) ? ' · Mittel „bei Bedarf“ zählen nicht mit' : ''}` }),
        // 100 % als fester Anker: Ohne ihn sah eine durchgehend halbe Einnahme aus wie volle.
        ser.length ? barChart(ser, { height: 90, min: 100, yUnit: '%', label: 'Einnahmetreue je Tag' }) : null,
      ]));
    }
  }

  view.appendChild(el('div', { class: 'card card--flat mt-4 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: 'Dokumentation und allgemeine Information für gesunde Erwachsene – keine Diagnose, keine Therapie, kein Medizinprodukt. Bei Beschwerden oder auffälligen Werten gehört die Beurteilung in ärztliche Hände. Deine Werte sind privat: in der App auch für Admins nicht sichtbar, und der Server gibt sie nur nach deiner PIN-Anmeldung heraus. Wer den Server betreibt, kann die gespeicherten Dateien allerdings lesen.' }),
  ]));
}

/* ------------------------------- Bausteine -------------------------------- */

function introCard() {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card__title', text: 'Labor & Ergänzung' }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: 'Erfasse Werte aus deinem Laborbefund, sieh ihren Verlauf und bekomme eine sportbezogene Einordnung – zum Beispiel, dass ein Ferritin von 25 zwar „normal“ ist, für Ausdauertraining aber knapp.' }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.86rem' }, text: 'Vorher eine kurze Abgrenzung: Cat-O-Fit ist für gesunde Erwachsene gedacht. Wer in ärztlicher Behandlung ist, Medikamente nimmt, schwanger ist oder stillt oder eine Essstörung hat, nutzt das Modul nur zum Dokumentieren – Empfehlungen gibt die App dann bewusst nicht. Die Antworten gelten für die ganze App.' }),
  ]);
}

function noteCard(text) {
  return el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.82rem' }, text }),
  ]);
}

/** Gibt es in den letzten 14 Tagen Mahlzeiten? (Dann lohnt der Hinweis auf fehlendes Körperfett.) */
function hasRecentMeals(diary, today) {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10);
  return (diary || []).some((m) => m && !m.deleted && !m._kind && m.kcal && m.date >= from && m.date <= today);
}

const EA_TONE = { kritisch: 'bad', niedrig: 'warn', unklar: 'neutral', gut: 'good' };

/** Energieversorgung mit Zahl – gerundet und als Spanne, weil alle Eingangsgrößen Schätzungen sind. */
function eaCard(ea, eaArgs) {
  const tone = EA_TONE[ea.level] || 'neutral';
  return el('div', { class: 'card mt-2', style: { borderLeft: `4px solid ${TONE_COLOR[tone]}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: 'Energieversorgung' }),
      infoButton('energieverfuegbarkeit', 'Energieversorgung'),
    ]),
    // Bei unklarer Datenlage keine Zahl in den Vordergrund stellen – sie wäre
    // aus lückenhaften Tagebuch-Einträgen gerechnet und damit irreführend.
    ea.level === 'unklar' ? null : el('div', { class: 'row gap-3 mt-2', style: { alignItems: 'baseline', flexWrap: 'wrap' } }, [
      el('div', { class: 'num', style: { fontSize: '1.6rem', fontWeight: '800', color: TONE_TEXT[tone] }, text: `≈ ${ea.eaRounded}` }),
      el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: `kcal je kg fettfreier Masse (Spanne ${ea.range[0]}–${ea.range[1]}) · Richtwert ${EA_OPTIMAL}` }),
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: ea.hint }),
    ea.level === 'unklar' ? null : el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: `Aus ${ea.confirmedDays} vollständig erfassten Tagen: Ø ${ea.intakeAvg} kcal gegessen, Ø ${ea.trainingAvg} kcal fürs Training (${{ gemessen: 'von der Uhr gemessen', teils: 'teils gemessen, teils geschätzt' }[ea.trainingSource] || 'geschätzt'}), ${fmtDec(ea.ffm)} kg fettfreie Masse (${ea.ffmMeasured ? 'gemessen' : 'aus Gewicht und Körperfett geschätzt'}).` }),
    el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => { location.hash = '#/nutrition'; },
    }, [icon('utensils'), ea.level === 'unklar' ? 'Tage im Ess-Tagebuch bestätigen' : 'Zum Ess-Tagebuch']),
    ea.level === 'unklar' ? null : eaChart(eaArgs),
  ]);
}

/** Energieversorgung ohne Zahlen – für alle, die Kalorienzahlen ausgeblendet haben. */
function eaCardPlain(ea) {
  const tone = EA_TONE[ea.level] || 'neutral';
  const text = {
    kritisch: 'Rechnerisch bleibt für dein Training zu wenig Energie übrig. Iss mehr, statt ein Präparat zu suchen – und sprich mit einer Ärztin oder einem Arzt.',
    niedrig: ea.lossBand
      ? 'Deine Energieversorgung ist knapp – beim Abnehmen vorübergehend vertretbar. Achte auf Schlaf und Regeneration.'
      : 'Deine Energieversorgung ist eher knapp. In harten Trainingsphasen solltest du bewusst mehr essen.',
    gut: 'Deine Energieversorgung passt zum Training.',
    unklar: `Noch zu wenige vollständig erfasste Tage für eine Einschätzung (${ea.confirmedDays} von ${ea.days}). Bestätige in der Ernährung „Tag vollständig“, wenn du alles erfasst hast.`,
  }[ea.level];
  return el('div', { class: 'card mt-2', style: { borderLeft: `4px solid ${TONE_COLOR[tone]}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: 'Energieversorgung' }),
      infoButton('energieverfuegbarkeit', 'Energieversorgung'),
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text }),
    ea.level === 'unklar' ? el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => { location.hash = '#/nutrition'; },
    }, [icon('utensils'), 'Zum Ess-Tagebuch']) : null,
  ]);
}

/** „Woher bekomme ich Werte?“ – aufklappbar, solange noch nichts erfasst ist. */
function sourcesCard() {
  const body = el('div', { hidden: true, style: { marginTop: '6px' } },
    LAB_SOURCES.map((src, i) => el('div', { style: { padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
        el('div', { style: { fontWeight: '650', fontSize: '.86rem' }, text: src.title }),
        src.best ? el('span', { class: 'chip chip--accent', style: { fontSize: '.62rem' }, text: 'passt am besten' }) : null,
      ]),
      el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '2px' }, text: src.what }),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '2px' }, text: `Kosten: ${src.cost}` }),
      el('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '4px' } }, [
        el('strong', { text: 'Tipp: ' }), src.tip,
      ]),
    ])));
  const head = el('button', {
    class: 'btn btn--soft btn--block', style: { fontSize: '.84rem' },
    onclick: () => { body.hidden = !body.hidden; },
  }, [icon('info'), 'Woher bekomme ich Laborwerte?']);
  return el('div', { class: 'card mt-3' }, [
    el('div', { class: 'muted', style: { fontSize: '.84rem', marginBottom: '8px' }, text: LAB_SOURCES_TEASER }),
    head, body,
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '8px' }, text: 'Wichtig: Referenzbereiche sind in Deutschland nicht einheitlich – jedes Labor hat eigene. Trag beim Erfassen den Bereich von deinem Befund mit ein, dann bewertet Cat-O-Fit gegen dein Labor.' }),
  ]);
}

/** Kennzahlen-Zeile über allen Werten: Überblick auf einen Blick. */
function labStats(rows, labs, evaluate = true) {
  const good = rows.filter((r) => r.assessment.status === 'gut').length;
  const attention = rows.filter((r) => ['niedrig', 'hoch', 'grenzwertig'].includes(r.assessment.status)).length;
  const measured = (labs || []).filter((l) => l && !l.deleted).length;
  const dates = [...new Set((labs || []).filter((l) => l && !l.deleted).map((l) => l.date))].sort();
  const last = dates.at(-1);
  const counts = `${measured} Messungen an ${dates.length} Terminen · zuletzt ${last ? fmtDate(last) : '–'}`;
  // Nur dokumentierend (Kinder- und Jugendprofil): keine Ampel, nur der Überblick.
  if (!evaluate) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
        el('span', { class: 'num', style: { fontWeight: '800' }, text: String(rows.length) }),
        el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: rows.length === 1 ? 'Wert dokumentiert' : 'Werte dokumentiert' }),
      ]),
      el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '6px' }, text: counts }),
    ]);
  }

  const seg = [
    { value: good, color: 'var(--good)', label: 'im Zielbereich' },
    { value: attention, color: 'var(--warn)', label: 'beachten' },
    { value: rows.length - good - attention, color: 'var(--text-3)', label: 'ohne Bewertung' },
  ].filter((s) => s.value > 0);

  return el('div', { class: 'card' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('div', { style: { flex: '0 0 auto', width: '96px' } }, [donut(seg, { size: 96, centerValue: String(rows.length), centerLabel: 'Werte', label: 'Laborwerte nach Bewertung' })]),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline' } }, [
          el('span', { class: 'num', style: { fontWeight: '800', color: 'var(--good-text)' }, text: String(good) }),
          el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'im Sport-Zielbereich' }),
        ]),
        el('div', { class: 'row gap-2', style: { alignItems: 'baseline', marginTop: '2px' } }, [
          el('span', { class: 'num', style: { fontWeight: '800', color: attention ? 'var(--warn)' : 'var(--text-3)' }, text: String(attention) }),
          el('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'zum Beobachten' }),
        ]),
        el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '6px' }, text: counts }),
      ]),
    ]),
  ]);
}

const num = fmtDec;
/** Bereich als Text: „15–300“ oder „ab 35“ (ohne Obergrenze). */
const fmtRange = (r) => (r[1] == null ? `ab ${num(r[0])}` : `${num(r[0])}–${num(r[1])}`);
/** Wert so, wie er auf dem Befund stand (Einheit des Befunds), sonst kanonisch. */
function valueText(rec, unit) {
  if (rec && rec.enteredUnit && rec.enteredValue != null) return `${num(rec.enteredValue)} ${rec.enteredUnit}`;
  return `${num(rec ? rec.value : '')} ${unit}`;
}
const monthsText = (days) => `${Math.round(days / 30)} Monate`;

function valueRow(r, i, labs) {
  const a = r.assessment;
  const t = r.trend;
  const arrow = t ? (t.dir === 'up' ? '↑' : t.dir === 'down' ? '↓' : '→') : '';
  const sub = [fmtDate(r.date), a.label];
  if (r.stale) sub.push('älter – neu bestimmen lassen');
  if (t && t.dir !== 'flat') sub.push(`${arrow} ${num(Math.abs(t.perMonth))} ${r.unit}/Monat`);

  // Mini-Verlauf direkt in der Zeile: Trend erkennen, ohne aufzuklappen.
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

/** Verlauf der Energieverfügbarkeit über die letzten Wochen. */
function eaChart(args) {
  const ser = energyAvailabilitySeries(args, { weeks: 10 });
  if (ser.filter((p) => p.value != null).length < 3) return null;
  return el('div', { class: 'mt-2' }, [
    el('div', { class: 'dim', style: { fontSize: '.74rem', marginBottom: '2px' }, text: `Verlauf der letzten Wochen (nur vollständig erfasste Tage) · Linie = Richtwert ${EA_OPTIMAL}, kritisch unter ${eaLowFor(args.profile && args.profile.sex)}` }),
    lineChart(ser, { label: 'Energieversorgung je Woche', height: 120, unit: 'kcal/kg', target: EA_OPTIMAL, targetLabel: 'Richtwert', fmt: (v) => String(Math.round(v)) }),
  ]);
}

function fillDetail(box, r) {
  const labs = store.get('labs');
  const all = series(labs, r.key);
  const pts = all.map((l) => ({ label: fmtDate(l.date), date: l.date, value: Number(l.value) }));
  const a = r.assessment;
  const rec = r.record || latest(labs, r.key);
  // Nur dokumentierend: der Bereich vom eigenen Befund (der ist altersgerecht), keine Bewertung.
  const ownOnly = a.status === 'unbewertet' && hasOwnRef(rec) ? [Number(rec.refLow), Number(rec.refHigh)] : null;
  const ref = a.ref || ownOnly;
  const sportDiffers = a.sport && (!ref || a.sport[0] !== ref[0] || a.sport[1] !== ref[1]);
  if (pts.length >= 2) {
    // Beide Korridore: Referenz als gestrichelter Rahmen, Sport-Zielbereich als Fläche.
    const bands = [];
    if (sportDiffers) bands.push({ lo: a.sport[0], hi: a.sport[1], kind: 'fill', label: 'Sport-Zielbereich' });
    if (ref) bands.push({ lo: ref[0], hi: ref[1], kind: 'frame', label: a.ownRef || ownOnly ? 'Referenz deines Labors' : 'Referenz' });
    box.appendChild(lineChart(pts, { label: `${r.label || 'Laborwert'} im Verlauf`, unit: r.unit, height: 130, bands, color: TONE_COLOR[a.tone] }));
  }
  const ranges = [];
  if (ref) ranges.push(`${a.ownRef || ownOnly ? 'Referenz deines Labors' : 'Referenz (üblich)'} ${fmtRange(ref)} ${r.unit}`);
  if (sportDiffers) ranges.push(`Sport-Zielbereich ${fmtRange(a.sport)} ${r.unit}`);
  if (ranges.length) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: ranges.join(' · ') }));
  if (a.ref && !a.ownRef) {
    box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: 'Jedes Labor hat eigene Referenzbereiche – trag beim Wert den von deinem Befund ein, dann bewertet Cat-O-Fit gegen dein Labor.' }));
  }
  if (rec && rec.enteredUnit) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: `Auf dem Befund: ${num(rec.enteredValue)} ${rec.enteredUnit} = ${num(rec.value)} ${r.unit}` }));
  const ctx = rec ? [rec.exercise48h && 'nach harter Belastung', rec.fasting && 'nüchtern', rec.cycleDay && `Zyklustag ${rec.cycleDay}`, rec.biotin && 'Biotin eingenommen'].filter(Boolean) : [];
  if (ctx.length) box.appendChild(el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: `Blutentnahme: ${ctx.join(' · ')}` }));
  if (a.blocked) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: a.blocked }));
  (a.caveats || []).forEach((c) => box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.8rem', borderLeft: '3px solid var(--warn)', paddingLeft: '8px' }, text: c })));
  if (r.stale) {
    const valid = (ANALYTES[r.key] && ANALYTES[r.key].validDays) || 365;
    box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: `Dieser Wert ist älter als ${monthsText(valid)}${ANALYTES[r.key] && ANALYTES[r.key].seasonal ? ' oder stammt aus einer anderen Jahreszeit' : ''} – für Vorschläge zählt er nicht mehr. Neu bestimmen lassen.` }));
  }
  if (r.hint) box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: r.hint }));
  const t = r.trend;
  if (t && t.daysToLimit != null) {
    const when = t.daysToLimit < 45 ? 'in wenigen Wochen' : `in etwa ${Math.round(t.daysToLimit / 30)} Monaten`;
    box.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.82rem', color: 'var(--warn-text)' }, text: `Tendenz: Bei gleichbleibendem Verlauf wird der günstige Bereich ${when} ${t.limitSide === 'high' ? 'überschritten' : 'unterschritten'} – ein guter Anlass für die nächste Kontrolle.` }));
  }
  if (t && t.dir !== 'flat' && t.seasonal) box.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: 'Vitamin D schwankt mit der Jahreszeit – ein Teil des Verlaufs kann daran liegen.' }));
  if (t && t.dir === 'flat' && all.length >= 3) box.appendChild(el('div', { class: 'dim mt-1', style: { fontSize: '.74rem' }, text: 'Die Messungen schwanken im üblichen Rahmen – daraus lässt sich kein Trend ablesen.' }));
  if (r.note) box.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `Notiz: ${r.note}` }));
  const src = ANALYTES[r.key] && ANALYTES[r.key].source;
  if (src) box.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.72rem' }, text: `Grundlage der Bereiche: ${src}` }));

  // Messungen: bearbeiten (Tippfehler, falsche Einheit) und löschen.
  const list = el('div', { class: 'mt-2', style: { borderTop: '1px solid var(--border)' } });
  all.slice().reverse().forEach((m) => list.appendChild(el('div', { class: 'row row--between', style: { alignItems: 'center', padding: '6px 0', gap: '8px' } }, [
    el('span', { style: { fontSize: '.82rem' }, text: `${fmtDate(m.date)} · ${valueText(m, r.unit)}` }),
    el('span', { class: 'row gap-1' }, [
      el('button', { class: 'icon-btn', 'aria-label': `Messung vom ${fmtDate(m.date)} bearbeiten`, onclick: (e) => { e.stopPropagation(); openValueSheet(currentEligibility(), m); } }, icon('edit')),
      el('button', { class: 'icon-btn', 'aria-label': `Messung vom ${fmtDate(m.date)} löschen`, onclick: async (e) => {
        e.stopPropagation();
        if (await confirmDialog({ title: 'Messung löschen?', message: `${ANALYTES[r.key].label} vom ${fmtDate(m.date)} (${valueText(m, r.unit)}) wird entfernt.`, confirmLabel: 'Löschen', danger: true })) {
          store.remove('labs', m.id); toast('Messung gelöscht', 'good'); rerender();
        }
      } }, icon('trash')),
    ]),
  ])));
  box.appendChild(list);
}

function suggestionCard(it) {
  const badge = { stark: 'gut belegt', mittel: 'belegt', situativ: 'situativ' }[it.evidence] || '';
  return el('div', { class: 'card mt-2' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'center' } }, [
      el('div', { style: { fontWeight: '700' }, text: it.label }),
      badge ? el('span', { class: 'chip', style: { fontSize: '.66rem' }, text: badge }) : null,
    ]),
    el('div', { class: 'dim', style: { fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '2px' }, text: 'Allgemeine Information' }),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Warum: ' }), it.reason,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Zuerst über das Essen: ' }), it.food,
    ]),
    el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' } }, [
      el('strong', { text: 'Vorgehen: ' }), it.action,
    ]),
    it.holdOnly ? null : el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: `Übliche Menge: ${it.typical} · ${it.timing} · ${it.ul}` }),
    it.note ? el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: it.note }) : null,
    !it.holdOnly && it.performance ? el('div', { class: 'dim mt-1', style: { fontSize: '.76rem' }, text: DOPING_NOTE }) : null,
    it.source ? el('div', { class: 'dim mt-1', style: { fontSize: '.72rem' }, text: `Grundlage: ${it.source}` }) : null,
    it.holdOnly ? null : el('button', {
      class: 'btn btn--soft mt-2', style: { fontSize: '.8rem' },
      onclick: () => openPlanSheet(it.key, currentEligibility()),
    }, [icon('plus'), 'In meinen Plan']),
  ]);
}

function planRow(p, today, i) {
  const done = takenOn(store.get('supplements'), p.id, today);
  return el('div', { class: 'list-item', style: { borderTop: i ? '1px solid var(--border)' : 'none' } }, [
    el('button', {
      class: 'icon-btn', 'aria-label': done ? 'Einnahme zurücknehmen' : 'Als eingenommen markieren',
      style: { color: done ? 'var(--good)' : 'var(--text-3)' },
      onclick: () => { toggleIntake(p, today, done); },
    }, icon(done ? 'check' : 'circle')),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: p.name }),
      el('div', { class: 'list-item__sub', text: [p.dose, p.timing, isDaily(p) ? null : 'bei Bedarf'].filter(Boolean).join(' · ') || 'täglich' }),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': 'Entfernen', onclick: async () => {
      if (await confirmDialog({ title: `„${p.name}“ entfernen?`, confirmLabel: 'Entfernen', danger: true })) {
        store.remove('supplements', p.id); rerender();
      }
    } }, icon('trash')),
  ]);
}

/* -------------------------------- Aktionen -------------------------------- */

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

/** Laborwert von außerhalb der Labor-Ansicht erfassen (＋ Erfassen): Ist die Abgrenzung
    noch nicht geklärt, zuerst die kurze Einrichtung, danach direkt das Formular. */
export function openLabEntry() {
  if (!labsEnabled()) return;
  const elig = currentEligibility();
  if (!elig.answered) { openGateSheet({ onSaved: () => openValueSheet(currentEligibility()) }); return; }
  openValueSheet(elig);
}

/**
 * Laborwert erfassen oder bearbeiten (`existing`). Die Einheit steht direkt neben dem Wert;
 * der Referenzbereich des Labors ist nur ein PLATZHALTER (in der gewählten Einheit) –
 * gespeichert wird nur, was jemand vom Befund abtippt. Bis v3.19.0 wurde die Vorbelegung
 * als „dein Labor“ gespeichert und beim Einheitenwechsel sogar falsch umgerechnet.
 */
/** Einen ganzen Befund erfassen: Datum und Umstände einmal, darunter alle Werte mit Einheit und
    dem Referenzbereich des eigenen Labors. Leere Zeilen bleiben unberücksichtigt. */
function openReportSheet() {
  const profile = store.profile();
  const dateI = input({ type: 'date', value: todayStr(), max: todayStr() });
  const noteI = input({ type: 'text', placeholder: 'Labor oder Anlass (optional)' });
  const ctx = { exercise48h: false, fasting: false, biotin: false };
  const cycleI = input({ type: 'number', min: '1', max: '60', step: '1', inputmode: 'numeric', placeholder: 'z. B. 12' });
  const rows = [];
  const list = el('div', { class: 'lab-report' });
  ANALYTE_GROUPS.forEach((g) => {
    const items = Object.entries(ANALYTES).filter(([, a]) => a.group === g);
    if (!items.length) return;
    list.appendChild(el('div', { class: 'field__label mt-3', text: g }));
    items.forEach(([key, a]) => {
      const units = unitsFor(key);
      const valueI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'Wert', 'aria-label': `${a.label}: Messwert` });
      const unitSel = select(units.map((u) => ({ value: u, label: u })), units[0], { 'aria-label': `${a.label}: Einheit` });
      if (units.length < 2) unitSel.disabled = true;
      const loI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'von', 'aria-label': `${a.label}: Referenz von` });
      const hiI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'bis', 'aria-label': `${a.label}: Referenz bis` });
      rows.push({ key, valueI, unitSel, loI, hiI });
      list.appendChild(el('div', { class: 'lab-report__row' }, [
        el('div', { class: 'lab-report__name', text: a.label }),
        el('div', { class: 'lab-report__value' }, [valueI, unitSel]),
        el('div', { class: 'lab-report__ref' }, [el('span', { class: 'dim', text: 'Referenz' }), loI, el('span', { class: 'dim', text: '–' }), hiI]),
      ]));
    });
  });
  const ctxRow = (label, k) => el('div', { class: 'row row--between', style: { padding: '6px 0', gap: '12px', alignItems: 'center' } }, [
    el('span', { style: { fontSize: '.84rem' }, text: label }), toggle(false, (v) => { ctx[k] = v; }, label),
  ]);
  const errBox = el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
  const saveBtn = el('button', { class: 'btn btn--primary btn--block' }, [icon('check'), 'Befund speichern']);
  let confirmed = null;
  list.addEventListener('input', () => { confirmed = null; errBox.hidden = true; saveBtn.lastChild.textContent = 'Befund speichern'; });
  saveBtn.addEventListener('click', () => {
    const res = labRecordsFromReport({
      date: dateI.value || todayStr(), note: noteI.value,
      ctx: { ...ctx, cycleDay: parseInt(cycleI.value, 10) },
      rows: rows.map((r) => ({ key: r.key, value: r.valueI.value, unit: r.unitSel.value, refLow: r.loI.value, refHigh: r.hiI.value })),
    }, { sex: profile.sex });
    if (res.errors.length) { errBox.textContent = res.errors.join(' · '); errBox.hidden = false; return; }
    if (!res.records.length) { toast('Bitte mindestens einen Wert eintragen', 'bad'); return; }
    const msg = res.implausible.length ? `Bitte prüfen: ${res.implausible.join(', ')} – weit außerhalb des Üblichen. Stimmt die Einheit? Auf vielen Befunden steht z. B. CRP in mg/dl statt mg/l.` : null;
    if (msg && confirmed !== msg) { confirmed = msg; errBox.textContent = msg; errBox.hidden = false; saveBtn.lastChild.textContent = 'Trotzdem speichern'; return; }
    const now = nowIso();
    const saved = store.upsertMany('labs', res.records.map((r) => ({ ...r, id: uid('lab'), createdAt: now, updatedAt: now })));
    if (!saved.length) { toast('Speichern fehlgeschlagen – Gerätespeicher voll?', 'bad'); return; }
    closeSheet(); toast(`${saved.length} ${saved.length === 1 ? 'Wert' : 'Werte'} gespeichert`, 'good'); refreshView();
  });
  openSheet({
    title: 'Befund erfassen',
    body: el('div', {}, [
      el('div', { class: 'field__row' }, [field('Datum der Blutentnahme', dateI), field('Notiz', noteI)]),
      el('p', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Trag nur ein, was auf deinem Befund steht – leere Zeilen zählen nicht. Den Referenzbereich deines Labors findest du neben dem Wert; er hat Vorrang vor den Standardbereichen.' }),
      list,
      el('div', { class: 'field__label mt-3', text: 'Umstände der Blutentnahme (gelten für alle Werte)' }),
      ctxRow('Harte Belastung in den 48 Stunden davor', 'exercise48h'),
      ctxRow('Nüchtern', 'fasting'),
      ctxRow('Biotin genommen (auch in Haar- oder Hautpräparaten)', 'biotin'),
      profile.sex === 'm' ? null : field('Zyklustag (optional)', cycleI),
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
  // Kinder- und Jugendprofil: keine Erwachsenen-Bereiche als Platzhalter – der Befund kennt die passenden.
  const suggest = elig.labsEvaluate;
  const inUnit = (v) => (v == null ? '' : String(fromCanonical(key, v, unit)));
  const dateI = input({ type: 'date', value: ex ? ex.date : todayStr() });
  const valueI = input({ type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'Wert', 'aria-label': 'Messwert',
    value: ex ? (ex.enteredUnit === unit && ex.enteredValue != null ? String(ex.enteredValue) : inUnit(ex.value)) : '' });
  const noteI = input({ type: 'text', placeholder: 'Notiz (optional), z. B. Labor oder Anlass', value: ex && ex.note ? ex.note : '' });
  const ownRef = ex && hasOwnRef(ex);
  const refLoI = input({ type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': 'Referenz von', value: ownRef ? inUnit(ex.refLow) : '' });
  const refHiI = input({ type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': 'Referenz bis', value: ownRef ? inUnit(ex.refHigh) : '' });
  const refUnitLbl = el('span', { class: 'muted', style: { alignSelf: 'center', fontSize: '.8rem', whiteSpace: 'nowrap' } });
  // Platzhalter mit sinnvoller Genauigkeit (20 statt 20,032).
  const nice = (v) => {
    const a = Math.abs(v);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return num(Number(v.toFixed(d)));
  };
  const fillPlaceholders = () => {
    const r = suggest ? refRange(key, profile.sex) : null;
    refLoI.placeholder = r ? `z. B. ${nice(fromCanonical(key, r[0], unit))}` : 'von';
    refHiI.placeholder = r && r[1] != null ? `z. B. ${nice(fromCanonical(key, r[1], unit))}` : 'bis';
    refUnitLbl.textContent = unit;
  };

  const unitSel = el('select', { class: 'select', 'aria-label': 'Einheit' });
  const drawUnits = (keep = false) => {
    unitSel.innerHTML = '';
    const opts = unitsFor(key);
    if (!keep || !opts.includes(unit)) unit = opts[0];
    opts.forEach((u) => { const o = el('option', { value: u, text: u }); if (u === unit) o.selected = true; unitSel.appendChild(o); });
    unitSel.disabled = opts.length < 2;
  };
  unitSel.addEventListener('change', () => {
    // Bereits eingetippte Referenzgrenzen mit umrechnen – sonst stünden Zahlen der alten Einheit da.
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

  // Umstände der Blutentnahme (optional) – daraus Kontextregeln (Belastung, Zyklus, Biotin).
  // Bei einem neuen Wert vom selben Tag übernehmen wir die Angaben des anderen Werts.
  const sameDay = !ex && store.get('labs').find((l) => l.date === dateI.value && (l.exercise48h || l.fasting || l.biotin || l.cycleDay));
  const ctxSrc = ex || sameDay || {};
  const ctx = { exercise48h: !!ctxSrc.exercise48h, fasting: !!ctxSrc.fasting, biotin: !!ctxSrc.biotin };
  const cycleI = input({ type: 'number', min: '1', max: '60', step: '1', inputmode: 'numeric', placeholder: 'z. B. 12', value: ctxSrc.cycleDay ? String(ctxSrc.cycleDay) : '' });
  const ctxRow = (label, k) => el('div', { class: 'row row--between', style: { padding: '6px 0', gap: '12px', alignItems: 'center' } }, [
    el('span', { style: { fontSize: '.84rem' }, text: label }), toggle(ctx[k], (v) => { ctx[k] = v; }, label),
  ]);
  const ctxBody = el('div', { hidden: !(ctxSrc.exercise48h || ctxSrc.fasting || ctxSrc.biotin || ctxSrc.cycleDay) }, [
    ctxRow('Harte Belastung in den 48 Stunden davor', 'exercise48h'),
    ctxRow('Nüchtern', 'fasting'),
    ctxRow('Biotin genommen (auch in Haar- oder Hautpräparaten)', 'biotin'),
    profile.sex === 'm' ? null : field('Zyklustag (optional)', cycleI),
  ]);
  const ctxToggle = el('button', { type: 'button', class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.8rem' },
    onclick: () => { ctxBody.hidden = !ctxBody.hidden; } }, 'Umstände der Blutentnahme (optional)');

  // Unplausible Größenordnung: erst Hinweis „Einheit prüfen?“, der zweite Tipp speichert.
  const warnBox = el('div', { class: 'card card--flat mt-2', role: 'alert', hidden: true, style: { borderLeft: '3px solid var(--warn)', fontSize: '.82rem' } });
  const saveBtn = el('button', { class: 'btn btn--primary btn--block' }, [icon('check'), 'Speichern']);
  const confirm = {
    shown: null,
    reset() { this.shown = null; warnBox.hidden = true; saveBtn.lastChild.textContent = 'Speichern'; },
    ok(msg) {
      if (!msg || this.shown === msg) return true;
      this.shown = msg; warnBox.textContent = msg; warnBox.hidden = false; saveBtn.lastChild.textContent = 'Trotzdem speichern';
      return false;
    },
  };
  [valueI, refLoI, refHiI].forEach((i) => i.addEventListener('input', () => confirm.reset()));

  saveBtn.onclick = () => {
    const v = toCanonical(key, valueI.value, unit);
    if (v == null) { toast('Bitte einen gültigen Wert eingeben', 'bad'); return; }
    const hasLo = refLoI.value !== '', hasHi = refHiI.value !== '';
    if (hasLo !== hasHi) { toast('Bitte beide Grenzen des Referenzbereichs eintragen – oder keine.', 'bad'); return; }
    const rLo = hasLo ? toCanonical(key, refLoI.value, unit) : null;
    const rHi = hasHi ? toCanonical(key, refHiI.value, unit) : null;
    if (hasLo && !(rHi > rLo)) { toast('Die obere Grenze muss größer als die untere sein.', 'bad'); return; }
    if (!confirm.ok(implausible(key, v, profile.sex)
      ? `${num(valueI.value)} ${unit} liegt weit außerhalb des Üblichen für ${ANALYTES[key].label}. Stimmt die Einheit? Auf vielen Befunden steht z. B. CRP in mg/dl statt mg/l oder Vitamin D in ng/ml statt nmol/l.`
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
    closeSheet(); toast(ex ? 'Wert geändert' : 'Wert gespeichert', 'good'); rerender();
  };

  openSheet({
    title: ex ? 'Laborwert bearbeiten' : 'Laborwert erfassen',
    body: el('div', {}, [
      field('Wert', analyteSel), hintBox,
      field('Datum', dateI),
      el('div', { class: 'field__row' }, [field('Messwert', valueI), field('Einheit', unitSel)]),
      warnBox,
      el('div', { class: 'field__label', text: 'Referenzbereich deines Labors (optional)' }),
      el('div', { class: 'row gap-2' }, [
        el('div', { class: 'grow' }, [refLoI]),
        el('span', { class: 'muted', style: { alignSelf: 'center' }, text: 'bis' }),
        el('div', { class: 'grow' }, [refHiI]),
        refUnitLbl,
      ]),
      el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: suggest
        ? 'Steht auf deinem Befund neben dem Wert – trag ihn ab, dann bewertet Cat-O-Fit gegen DEIN Labor. Leer gelassen gilt ein üblicher Bereich (grau angedeutet).'
        : 'Steht auf deinem Befund neben dem Wert – dort gilt er für dein Alter. Trag ihn ab, damit du ihn im Verlauf wiederfindest.' }),
      ctxToggle, ctxBody,
      field('Notiz', noteI),
    ]),
    footer: saveBtn,
  });
}

function openPlanSheet(presetKey = null, elig = currentEligibility()) {
  // Minderjährige: keine Leistungspräparate im Katalog.
  const keys = catalogFor(elig);
  const opts = keys.map((k) => ({ value: k, label: SUPPLEMENTS[k].label }));
  let key = presetKey && keys.includes(presetKey) ? presetKey : opts[0].value;
  const sel = select(opts, key);
  const doseI = input({ type: 'text', value: SUPPLEMENTS[key].typical, placeholder: 'Menge' });
  const timingI = input({ type: 'text', value: SUPPLEMENTS[key].timing || '', placeholder: 'Wann' });
  const doping = el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '4px' }, text: DOPING_NOTE, hidden: !SUPPLEMENTS[key].performance });
  // Häufigkeit: Situative Mittel (z. B. vor Wettkämpfen) sind keine tägliche Pflicht.
  const freqFor = (k) => (AS_NEEDED.includes(k) ? 'bedarf' : 'taeglich');
  const freqSel = select([{ value: 'taeglich', label: 'täglich' }, { value: 'bedarf', label: 'bei Bedarf (z. B. vor Wettkämpfen)' }], freqFor(key));
  sel.addEventListener('change', () => {
    key = sel.value;
    doseI.value = SUPPLEMENTS[key].typical;
    timingI.value = SUPPLEMENTS[key].timing || '';
    doping.hidden = !SUPPLEMENTS[key].performance;
    freqSel.value = freqFor(key);
  });
  openSheet({
    title: 'In den Plan aufnehmen',
    body: el('div', {}, [
      field('Mittel', sel),
      field('Menge', doseI),
      field('Zeitpunkt', timingI),
      field('Häufigkeit', freqSel),
      el('div', { class: 'dim', style: { fontSize: '.76rem' }, text: 'Nur was du wirklich nimmst – der Plan dient dir zum Abhaken und zeigt deine Einnahmetreue. Mittel „bei Bedarf“ zählen dort nicht mit.' }),
      doping,
    ]),
    footer: el('button', { class: 'btn btn--primary btn--block', onclick: () => {
      store.upsert('supplements', {
        id: uid('sup'), _kind: 'plan', supplementKey: key, name: SUPPLEMENTS[key].label,
        dose: doseI.value.trim(), timing: timingI.value.trim(), active: true, frequency: freqSel.value,
        from: todayStr(), to: null, createdAt: nowIso(), updatedAt: nowIso(),
      });
      closeSheet(); toast('Zum Plan hinzugefügt', 'good'); rerender();
    } }, [icon('check'), 'Übernehmen']),
  });
}

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }
