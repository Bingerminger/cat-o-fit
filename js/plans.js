/* =========================================================================
   plans.js — Trainingsplan pro Event: Generator (Periodisierung) + Ansicht.

   Best Practices: Grundlage -> Aufbau -> Spitze -> Tapering, Long-Run-
   Progression mit Deload-Wochen, Zielpaces aus den Profil-Pacebereichen,
   Renntempo-Anteile in der Spitze. Alles editierbar.
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, nowIso, navigate, typeMeta, typeIcon, fmtKm, fmtPace,
  fmtPaceRange, fmtDate, fmtDayMonth, addDays, isoDow, diffDays, todayStr, toDateStr,
  sectionHead, emptyState, toast, confirmDialog, openSheet, closeSheet,
  effectiveStatus, STATUS_META, input, field, segmented,
} from './ui.js';
import { setHeader } from './router.js';
import { openIcsSheet } from './ics-export.js';
import { openUnitCreator, MISSED_REASON_LABEL } from './session.js';
import { mergeRegeneratedWeek } from './planflow.js';
import { recentLongRunKm } from './fitness.js';
import { buildProgramUnits } from './program.js';
import { defaultCommitments, commitmentDates, commitMeta, commitmentsSummary, mkCommit, dowLabel, FOOTBALL_INTENSITY } from './commitments.js';
import { weekTriage } from './triage.js';

/* ===================== Plan-Generierung ===================== */

export function ensureGenerated() {
  const plans = store.get('plans');
  plans.forEach((plan) => {
    if (plan.generated) return;
    const event = store.find('events', plan.eventId);
    if (!event) return;
    const units = generatePlanUnits(plan, event, store.profile());
    store.patch('plans', plan.id, { units, generated: true });
  });
}

/** Standard-Wochengerüst (Trainingsgerüst). Mo + Mi (Fußball) kommen jetzt aus
    den festen Terminen (`plan.commitments`), damit die Tage konfigurierbar und
    editierbar sind (siehe commitments.js: `defaultCommitments` = Mo/Mi Fußball). */
export const DEFAULT_WEEK_TEMPLATE = [
  { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
  { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
  // Fr trägt kein fixes Training (frei vor dem Long Run). Kraft wird NICHT mehr im
  // Wettkampfplan vorgegeben – sie lässt sich über ein eigenes Ziel/Programm steuern.
  { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
  { dow: 7, label: 'So', units: [{ role: 'recovery' }, { role: 'mobility' }] },
];

/** Ist das ein Lauf-Wochengerüst (kein Triathlon/Hyrox)? Dann gelten – solange
    der Plan keine eigenen festen Termine trägt – die Fußball-Standardtermine. */
function isRunTemplate(tpl) {
  const roles = new Set((tpl || []).flatMap((r) => (r.units || []).map((u) => u.role)));
  return !roles.has('swim') && !roles.has('bike') && !roles.has('long_bike') && !roles.has('functional');
}

/** Feste Termine eines Plans (mit Rückfall auf die Standardtermine bei Lauf-Plänen). */
function planCommitments(plan) {
  if (plan.commitments != null) return plan.commitments;
  return isRunTemplate(plan.weekTemplate) ? defaultCommitments() : [];
}

/** Baut die Einheit für einen festen Termin (Fußball/Spiel) an einem Datum. */
function mkCommitUnit(plan, date, c, week, phase) {
  const type = commitMeta(c.type).unitType || 'cross_football';
  return {
    id: uid('u'), planId: plan.id, eventId: plan.eventId,
    date, dow: isoDow(date), week, phase: phase.key,
    type, title: c.label || typeMeta(type).label,
    targetDistanceKm: null, targetDurationMin: c.durationMin || null,
    targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null, targetHrZone: null,
    description: c.desc || '', time: null, intervals: null,
    status: 'geplant', executedSessionId: null,
    commitmentId: c.id, fixed: true, intensity: c.intensity || null,  // Fußball-Intensität (#5)
    createdAt: nowIso(), updatedAt: nowIso(),
  };
}

/** Wochengerüst für Triathlon (Schwimmen/Rad/Lauf + Kraft). */
export const TRIATHLON_TEMPLATE = [
  { dow: 1, label: 'Mo', units: [{ role: 'swim' }] },
  { dow: 2, label: 'Di', units: [{ role: 'quality' }, { role: 'strength' }] },
  { dow: 3, label: 'Mi', units: [{ role: 'bike' }] },
  { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
  { dow: 5, label: 'Fr', units: [{ role: 'swim' }] },
  { dow: 6, label: 'Sa', units: [{ role: 'long_bike' }] },
  { dow: 7, label: 'So', units: [{ role: 'recovery' }, { role: 'mobility' }] },
];

/** Wochengerüst für Hyrox (Laufen + funktionelle Stationen + Kraft). */
export const HYROX_TEMPLATE = [
  { dow: 1, label: 'Mo', units: [{ role: 'functional' }] },
  { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
  { dow: 3, label: 'Mi', units: [{ role: 'strength' }] },
  { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
  { dow: 5, label: 'Fr', units: [{ role: 'functional' }] },
  { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
  { dow: 7, label: 'So', units: [{ role: 'recovery' }, { role: 'mobility' }] },
];

/** Wochengerüst nach Sportart. */
function weekTemplateFor(sport) {
  if (sport === 'triathlon') return TRIATHLON_TEMPLATE;
  if (sport === 'hyrox') return HYROX_TEMPLATE;
  return DEFAULT_WEEK_TEMPLATE;
}

/** Rotierende Kraft-Schwerpunkte – Eigengewicht oder mit Geräten, ohne Video-Zwang. */
export const STRENGTH_FOCUS = [
  { title: 'Ganzkörper', desc: 'Ganzkörper, 3 Runden (Eigengewicht oder mit Hanteln/Kettlebell): Kniebeugen 12× · Liegestütz 8–12× (ggf. auf Knien) · Ausfallschritte 10×/Bein · Schulterdrücken 12× · Plank 30–45 s. Saubere Technik vor Gewicht, 60–90 s Pause zwischen den Runden. Wer mag, nutzt weiter die Growingannanas-Videos.' },
  { title: 'Beine & Po', desc: 'Beinkraft für eine stabile Lauftechnik, 3 Runden: Kniebeugen 15× · Rumänisches Kreuzheben (Hantel/Kettlebell oder einbeinig) 10× · Step-ups auf Bank/Stufe 10×/Bein · Wadenheben 20× · Glute Bridge 15×. Mit Gewicht etwas weniger Wiederholungen, 60–90 s Pause.' },
  { title: 'Rumpf & Core', desc: 'Rumpfstabilität für aufrechte Haltung beim Laufen, 3 Runden: Plank 40 s · Seitstütz 30 s/Seite · Dead Bug 10×/Seite · Superman 12× (rückenfreundlich) · Russian Twist 20×. Langsam und kontrolliert, bewusst Körperspannung halten.' },
];

/** Verteilt die Gesamtwochen auf die vier Trainingsphasen. */
export function makePhases(weeks) {
  const defs = [
    { key: 'base', name: 'Grundlage', color: '#43c59e', focus: 'Umfang & aerobe Basis', frac: 0.40 },
    { key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Schwelle & Tempohärte', frac: 0.32 },
    { key: 'peak', name: 'Spitze', color: '#f5a623', focus: 'VO2max & Wettkampftempo', frac: 0.16 },
    { key: 'taper', name: 'Tapering', color: '#b079e6', focus: 'Erholung & Schärfe', frac: 0.12 },
  ];
  if (weeks <= 1) return [{ ...defs[3], startWeek: 1, endWeek: weeks }];
  const counts = defs.map((d) => Math.max(weeks >= 4 ? 1 : 0, Math.round(d.frac * weeks)));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum > weeks) { counts[counts.indexOf(Math.max(...counts))]--; sum--; }
  while (sum < weeks) { counts[0]++; sum++; }
  const phases = []; let wk = 1;
  defs.forEach((d, i) => { if (counts[i] <= 0) return; phases.push({ key: d.key, name: d.name, color: d.color, focus: d.focus, startWeek: wk, endWeek: wk + counts[i] - 1 }); wk += counts[i]; });
  return phases;
}

/** Legt für ein Event einen Plan an und generiert die Einheiten. */
export function createPlanForEvent(event, options = {}) {
  const today = todayStr();
  let start = today;
  const dow = isoDow(today);
  if (dow !== 1) start = addDays(today, 8 - dow); // kommender Montag
  if (start >= event.date) start = today;
  const weeks = Math.max(1, Math.ceil((diffDays(start, event.date) + 1) / 7));
  // Trainingshistorie als Startpunkt: aktueller Long-Run-Stand hebt den Aufbau-Beginn an.
  const histLong = recentLongRunKm(store.get('sessions'), today);
  const baseLongKm = histLong >= 8 ? histLong : null;
  const weekTemplate = weekTemplateFor(event.sport);
  const commitments = options.commitments != null ? options.commitments
    : (isRunTemplate(weekTemplate) ? defaultCommitments() : []);
  const plan = {
    id: uid('plan'), eventId: event.id, name: `Trainingsplan · ${event.name}`,
    goalTime: event.targetTime, startDate: start, endDate: event.date, weeks, baseLongKm,
    phases: makePhases(weeks), weekTemplate, commitments, sport: event.sport || 'run',
    units: [], generated: false, createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.upsert('plans', plan);
  const units = generatePlanUnits(plan, event, store.profile());
  store.patch('plans', plan.id, { units, generated: true });
  return plan;
}

function phaseForWeek(plan, week) {
  return plan.phases.find((p) => week >= p.startWeek && week <= p.endWeek) || plan.phases.at(-1);
}

/** Progressive Long-Run-Distanz relativ zur Renndistanz, mit Deload & Taper.
    `baseKm` (aus der Trainingshistorie) hebt den Startpunkt, wenn schon längere
    Läufe vorliegen – gedeckelt, damit der Aufbau nicht zu aggressiv wird. */
/** Distanz-bewusste Long-Run-Spitzendistanz (km). Kurze Distanzen brauchen
    relativ längere Grundlagen-Läufe, der Marathon wird bei ~32 km gedeckelt. */
export function longRunPeak(raceKm) {
  if (raceKm <= 6) return 15;                              // 5 km -> Grundlagen-Long
  if (raceKm <= 12) return 19;                             // 10 km
  if (raceKm <= 25) return Math.round(Math.min(raceKm * 0.9, 20)); // Halbmarathon
  return Math.round(Math.min(raceKm * 0.76, 32));          // Marathon (gedeckelt)
}

function longRunKm(week, weeks, raceKm, baseKm) {
  const peak = longRunPeak(raceKm);
  const startKm = Math.min(peak, Math.max(8, raceKm * 0.5, baseKm || 0));
  const buildEnd = weeks - 2;
  let km;
  if (week >= buildEnd) {
    km = (week === buildEnd) ? peak * 0.72 : peak * 0.5; // Taper
  } else {
    const prog = (week - 1) / Math.max(1, buildEnd - 1);
    km = startKm + (peak - startKm) * prog;
    if (week % 4 === 0) km *= 0.82; // Entlastungswoche
  }
  return Math.round(km * 2) / 2;
}

function pace(pz, key) {
  const z = pz[key];
  return z ? { min: z.min, max: z.max, hrZone: z.hrZone } : null;
}

/** Pyramiden-Intervalle: aufsteigend bis `peakSec`, dann absteigend; je `restSec` Trabpause.
    Liefert variable Segmente für den Workout-Modus (feinere Struktur als uniforme Runden). */
export function pyramidSegments(peakSec = 240, stepSec = 60, restSec = 90) {
  const up = [];
  for (let s = stepSec; s <= peakSec; s += stepSec) up.push(s);
  const seq = [...up, ...up.slice(0, -1).reverse()];
  return seq.map((workSec, i) => ({ workSec, restSec, label: `${Math.round(workSec / 60 * 10) / 10} min` }));
}

/** Wechselintervalle (Fahrtspiel): `rounds`× schnell/locker im Wechsel – die „Pause"
    ist hier lockeres Weiterlaufen (Float), kein Stopp. */
export function alternatingSegments(rounds = 6, fastSec = 60, floatSec = 60) {
  return Array.from({ length: rounds }, () => ({ workSec: fastSec, restSec: floatSec, label: 'schnell', floatRest: true }));
}

/** Wandelt eine Vorlagen-"Rolle" in eine konkrete Einheit (phasenabhängig). */
/** Schwerpunkt der Schlüsseleinheiten je Wettkampfdistanz (distanzspezifisch). */
export function distanceEmphasis(raceKm = 21.1) {
  const km = Number(raceKm) || 21.1;
  if (km <= 6) return { key: '5k', short: true, marathon: false, focus: 'VO₂max & Schärfe' };
  if (km <= 12) return { key: '10k', short: true, marathon: false, focus: 'VO₂max & Schwelle' };
  if (km <= 25) return { key: 'hm', short: false, marathon: false, focus: 'Schwelle & Tempohärte' };
  return { key: 'marathon', short: false, marathon: true, focus: 'Schwelle & Marathon-Renntempo' };
}

function resolveRole(role, ctx) {
  const { plan, date, week, phase, weeks, raceKm, pz, isLast } = ctx;
  const mk = (type, extra = {}) => ({
    id: uid('u'), planId: plan.id, eventId: plan.eventId,
    date, dow: isoDow(date), week, phase: phase.key,
    type, title: extra.title || typeMeta(type).label,
    targetDistanceKm: extra.dist ?? null,
    targetDurationMin: extra.dur ?? null,
    targetPaceSecPerKm: extra.pace?.min ?? null,
    targetPaceMaxSecPerKm: extra.pace?.max ?? null,
    targetHrZone: extra.pace?.hrZone ?? extra.hrZone ?? null,
    description: extra.desc || '', time: extra.time || null,
    intervals: extra.intervals ?? null,
    status: 'geplant', executedSessionId: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  });

  switch (role) {
    case 'cross_football':
      return mk('cross_football', { dur: 90, title: 'Fußball', desc: 'Mannschaftstraining – zählt als Cross-Training (Antritte, Schnelligkeit, Spielfreude). Gut aufwärmen, danach 5–10 min locker auslaufen. War es intensiv, die nächste Laufeinheit etwas lockerer angehen.' });

    case 'strength': {
      if (isLast) return null; // Wettkampfwoche: kein schweres Kraft
      const f = STRENGTH_FOCUS[(week - 1) % STRENGTH_FOCUS.length];
      return mk('strength', { dur: phase.key === 'taper' ? 30 : 40, title: `Kraft – ${f.title}`, desc: f.desc });
    }

    case 'mobility':
      return mk('mobility', { dur: 15, title: 'Mobility & Dehnen', desc: 'Ruhige Beweglichkeit, 10–15 min, besonders rückenfreundlich: Katze-Kuh 10× · Hüftbeuger-Dehnung 45 s/Seite · Beinrückseite sanft 45 s/Seite · Waden an der Wand 45 s/Seite · Brustöffner & Wirbelsäulen-Rotation 8×/Seite · Kindhaltung 60 s. Nichts ruckartig – in jede Position locker hineinatmen.' });

    case 'recovery':
      if (isLast) return mk('recovery', { dist: 4, pace: pace(pz, 'recovery'), title: 'Locker auslaufen', desc: 'Ganz locker, Beine frei machen.' });
      return mk('recovery', { dist: 5, pace: pace(pz, 'recovery'), title: 'Regenerationslauf', desc: 'Sehr locker in Z1–Z2, spürbar langsamer als der Dauerlauf – wenn es sich „fast zu leicht" anfühlt, ist es genau richtig. Die Beine sollen sich erholen, das Tempo ist Nebensache. Alternativ rückenschonend als lockere Radrunde.' });

    case 'endurance': { // Donnerstag – zweite Laufeinheit (Umfang)
      if (isLast) return mk('easy', { dist: 4, pace: pace(pz, 'easy'), title: 'Lockerer Lauf (kurz)', desc: 'Locker, frisch bleiben vor dem Wettkampf.' });
      const dist = phase.key === 'base' ? Math.min(9, 7 + Math.floor(week / 3)) : 8;
      return mk('easy', { dist, pace: pace(pz, 'easy'), title: 'Lockerer Dauerlauf', desc: 'Gleichmäßig im Grundlagenbereich (Z2), Plaudertempo – du solltest dich nebenbei unterhalten können. Lieber etwas zu langsam als zu schnell; hier zählt der Umfang, nicht das Tempo. Bei Rückenbeschwerden alternativ als gleichmäßige Radrunde (Z2).' });
    }

    case 'quality': { // Dienstag – Schlüsselreiz, phasenabhängig
      if (isLast) return mk('tempo', { dist: 5, pace: pace(pz, 'race_hm'), title: 'Aktivierung', desc: '2 km locker, 3×2 min im Renntempo, 4 Steigerungen. Scharf, aber kurz.' });
      if (phase.key === 'base')
        return mk('easy', { dist: 7 + Math.min(2, Math.floor(week / 2)), pace: pace(pz, 'easy'), title: 'Dauerlauf mit Steigerungen', desc: 'Lockerer Dauerlauf in Z2 (Plaudertempo). In den letzten 1–2 km dann 5–6 Steigerungsläufe à ~80–100 m: locker antraben, über ~20 m zügig auf ca. 90 % beschleunigen (schnell, aber nicht sprinten), dann auslaufen lassen. Dazwischen 60–90 s locker gehen/traben. Die Herzfrequenz ist hier nebensächlich – es geht um Spritzigkeit und saubere Technik.' });
      const em = distanceEmphasis(raceKm);   // distanzspezifischer Schwerpunkt
      if (phase.key === 'build') {
        if (em.marathon) // Marathon: schwellendominant, lange ruhige Reize
          return mk('tempo', { dist: 11, pace: pace(pz, 'threshold'), title: `Schwellenlauf ${2 + (week % 2)}×12 min`, desc: `Marathon-spezifisch: 2–3 km locker einlaufen. Dann ${2 + (week % 2)}×12 min an der Schwelle (Z4, „angenehm hart") mit je 3 min lockerem Traben – lange, gleichmäßige Reize statt kurzer Spitzen. 2 km auslaufen. Beim Marathon zählt die Ausdauer im oberen Tempobereich.` });
        if (week % 2 === 0) // Abwechslung: Fahrtspiel mit fließenden Wechseln statt Schwellenlauf
          return mk('tempo', { dist: 9, pace: pace(pz, 'threshold'), title: 'Fahrtspiel 8×(1 min schnell / 1 min locker)', intervals: { segments: alternatingSegments(8, 60, 60) }, desc: '2 km locker einlaufen. Dann 8×1 min zügig (Z4, „angenehm hart"), dazwischen je 1 min ganz locker **weiterlaufen** (nicht stehen bleiben) – ein fließendes Fahrtspiel. Tempo halten, ohne zu sprinten. 2 km auslaufen.' });
        return mk('tempo', { dist: 9, pace: pace(pz, 'threshold'), title: `Schwellenlauf ${3 + (week % 2)}×6 min`, desc: `2 km locker einlaufen (Z2). Dann ${3 + (week % 2)}×6 min an der Schwelle (Z4, „angenehm hart" – du könntest noch kurze Sätze sprechen) in der Zielpace unten; dazwischen je 2 min ganz lockeres Traben. Zum Schluss 2 km auslaufen. Gleichmäßig bleiben, nicht das erste Intervall überziehen.` });
      }
      if (phase.key === 'peak') {
        if (em.marathon) { // Marathon: Renntempo & lange Schwelle statt VO₂max
          if (week % 2 === 0)
            return mk('tempo', { dist: 14, pace: pace(pz, 'race_hm'), title: 'Marathon-Renntempo 3×4 km', desc: 'Renntempo-spezifisch: 2 km locker, dann 3×4 km im angestrebten Marathon-Tempo (kontrolliert zügig, etwas langsamer als Halbmarathon-Tempo) mit je 3 min lockerem Traben. 2 km auslaufen. Verpflegung & Trinken wie im Wettkampf üben.' });
          return mk('tempo', { dist: 11, pace: pace(pz, 'threshold'), title: 'Schwellenlauf 4×8 min', desc: '2 km locker, 4×8 min an der Schwelle (Z4) mit 2 min Trabpause, 2 km auslaufen. Hält die Tempohärte, ohne die Beine wie bei VO₂max-Intervallen zu leeren.' });
        }
        if (em.key === '5k') { // 5 km: kurze, schnelle VO₂max-Reize
          if (week % 2 === 0)
            return mk('interval', { dist: 8, pace: pace(pz, 'vo2'), title: 'VO2max 8×400 m', desc: '2 km einlaufen. Dann 8×400 m schnell (Z5) in der 5-km-Renntempo-Region, dazwischen 200 m sehr locker traben. 2 km auslaufen. Kurz, knackig, sauber – die Spritzigkeit fürs 5-km-Rennen.' });
          return mk('interval', { dist: 8, pace: pace(pz, 'vo2'), title: 'VO2max 5×1000 m', desc: '2 km einlaufen. 5×1000 m hart (Z5) im 5–10-km-Tempo, dazwischen 400 m locker traben. 2 km auslaufen. Gleichmäßig durchhalten.' });
        }
        if (week % 2 === 0) // 10 km / HM: Pyramide statt uniformer Intervalle
          return mk('interval', { dist: 9, pace: pace(pz, 'vo2'), title: 'VO2max-Pyramide 1-2-3-4-3-2-1 min', intervals: { segments: pyramidSegments(240, 60, 90) }, desc: '2 km einlaufen. Dann eine Pyramide: 1 – 2 – 3 – 4 – 3 – 2 – 1 min hart (Z5) mit je 90 s ganz lockerer Trabpause. Die 4-Minuten-Stufe in der Mitte ist der Höhepunkt – dort gleichmäßig durchhalten, nicht überziehen. 2 km auslaufen.' });
        return mk('interval', { dist: 9, pace: pace(pz, 'vo2'), title: 'VO2max-Intervalle 6×800 m', desc: '2 km einlaufen. Dann 6×800 m hart (Z5 – nur noch einzelne Wörter möglich) in der Zielpace, dazwischen 400 m sehr locker traben (~2–3 min Pause). 2 km auslaufen. Alle Intervalle möglichst gleich schnell – lieber gleichmäßig als das erste zu schnell.' });
      }
      // taper
      return mk('tempo', { dist: 7, pace: pace(pz, 'threshold'), title: 'Tempo kurz 2×6 min', desc: '2 km einlaufen, 2×6 min an der Schwelle (Z4) mit langer 3-min-Pause, 2 km auslaufen. Reiz halten, Umfang bewusst runter – die Spritzigkeit kommt jetzt aus der Erholung.' });
    }

    case 'long': {
      const km = longRunKm(week, weeks, raceKm, plan.baseLongKm);
      if (isLast) return mk('recovery', { dist: 3, pace: pace(pz, 'recovery'), title: 'Shakeout 3 km', desc: 'Ganz locker mit ein paar Steigerungen. Beine wecken vor dem Wettkampf.' });
      const withRace = phase.key === 'peak';
      return mk('long', {
        dist: km,
        pace: pace(pz, withRace ? 'long' : 'long'),
        title: `Long Run ${fmtKm(km, km % 1 ? 1 : 0)}`,
        desc: withRace
          ? `${fmtKm(km, km % 1 ? 1 : 0)} gesamt: locker in Z2 starten, in der Mitte ${Math.round(km * 0.4)} km im HM-Renntempo (Z3) am Stück, danach wieder locker auslaufen. Verpflegung & Trinken wie im Wettkampf üben. Rad-Alternative: ~1,5–2,5 h gleichmäßig (Z2) – dann aber heute keine zusätzliche Radtour.`
          : `Ruhiger langer Lauf durchgehend in Z2, gleichmäßig – Fettstoffwechsel & Grundlagenausdauer. Alle 20 min ein paar Schluck trinken. Rad-Alternative (auch rückenschonend): ~${Math.round(km * 4)}–${Math.round(km * 5)} km bzw. 1,5–2,5 h locker in Z2 statt des Laufs.`,
      });
    }
    case 'swim':
      return mk('cross', { dur: 45, title: 'Schwimmen', desc: 'Technik & Ausdauer im Wasser: 200 m einschwimmen, dann 8–10×100 m zügig mit ~20 s Pause, 200 m locker ausschwimmen. Auf einen ruhigen, langen Zug und sauberes Atmen achten – lieber technisch als hektisch.' });
    case 'bike':
      return mk('cross_bike', { dur: 60, title: 'Radtraining', desc: 'Gleichmäßige Grundlage in Z2 (~60 min). In der Aufbauphase 4–5×4 min an der Schwelle (Z4), dazwischen 3 min locker rollen. Trittfrequenz ~85–95 – rund treten, nicht stampfen.' });
    case 'long_bike':
      return mk('cross_bike', { dur: 120, title: 'Lange Radeinheit + Koppel', desc: 'Lange, ruhige Radeinheit (Z2, ~90–120 min), gut essen & trinken. Optional als Koppeltraining: direkt im Anschluss 10–15 min locker laufen, um sich an das „schwere-Beine"-Gefühl im Wettkampf zu gewöhnen.' });
    case 'functional':
      return mk('strength', { dur: 50, title: 'Hyrox-Stationen', desc: 'Funktionelles Zirkeltraining im Wettkampfformat: 4–5 Runden je 1 km locker laufen + eine Station – z. B. Wall Balls 20×, Burpee Broad Jumps 10×, Sled Push/Pull (oder Kniebeugen mit Gewicht), Rudergerät 250 m, Farmer-Carry 2×20 m. Zügiges Tempo, kurze Pausen – Laufen unter Belastung üben.' });
    default:
      return null;
  }
}

function makeRaceUnit(plan, event, date, week, phase) {
  return {
    id: uid('u'), planId: plan.id, eventId: plan.eventId,
    date, dow: isoDow(date), week, phase: phase.key,
    type: 'race', title: event.name,
    targetDistanceKm: event.distanceKm,
    targetDurationMin: null,
    targetPaceSecPerKm: store.profile().paceZones?.race_hm?.min ?? null,
    targetPaceMaxSecPerKm: store.profile().paceZones?.race_hm?.max ?? null,
    targetHrZone: 4, time: '10:00',
    description: `Wettkampf! Zielzeit ${event.targetTime}. Gleichmäßig anlaufen, ab km 15 alles geben.`,
    status: 'geplant', executedSessionId: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
}

/** Erzeugt die Einheiten genau einer Plan-Woche (1-basiert) – Basis für die
    selektive Wochen-Neuberechnung (#10). */
export function buildWeekUnits(plan, event, profile, week) {
  const pz = profile.paceZones || {};
  const raceKm = event?.distanceKm || 21.0975;
  const weeks = plan.weeks;
  const phase = phaseForWeek(plan, week);
  const weekStart = addDays(plan.startDate, (week - 1) * 7);
  const weekEnd = addDays(weekStart, 6);
  const isLast = week === weeks;

  // Feste Termine dieser Woche einsammeln (Wettkampftag hat immer Vorrang).
  const commitByDate = new Map();
  for (const { date, commitment } of commitmentDates(planCommitments(plan), weekStart, weekEnd)) {
    if (event && (date > event.date || date === event.date)) continue;
    if (!commitByDate.has(date)) commitByDate.set(date, []);
    commitByDate.get(date).push(commitment);
  }

  const out = [];
  for (const tpl of plan.weekTemplate) {
    const date = addDays(weekStart, tpl.dow - 1);
    if (event && date > event.date) continue;
    if (event && date === event.date) { out.push(makeRaceUnit(plan, event, date, week, phase)); continue; }
    if (commitByDate.has(date)) continue;   // fester Termin an dem Tag -> Trainingseinheit entfällt
    for (const u of tpl.units) {
      const unit = resolveRole(u.role, { plan, event, date, week, phase, weeks, raceKm, pz, isLast });
      if (unit) out.push(unit);
    }
  }
  // Feste Termine als Einheiten einfügen – der Plan wurde um sie herum gebaut.
  for (const [date, cs] of commitByDate) {
    for (const c of cs) out.push(mkCommitUnit(plan, date, c, week, phase));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function generatePlanUnits(plan, event, profile) {
  const units = [];
  for (let w = 1; w <= plan.weeks; w++) units.push(...buildWeekUnits(plan, event, profile, w));
  units.sort((a, b) => a.date.localeCompare(b.date));
  return units;
}

/* ===================== Plan-Ansicht ===================== */

export function render(view, eventId) {
  const event = store.find('events', eventId);
  const plan = store.get('plans').find((p) => p.eventId === eventId);
  const isProgram = (plan && plan.kind === 'program') || (event && event.kind === 'program');

  setHeader({
    title: isProgram ? 'Wochenplan' : 'Trainingsplan',
    subtitle: event ? event.name : '',
    back: `#/event/${eventId}`,
    actions: plan ? [
      { icon: 'plus', label: 'Einheit hinzufügen', onClick: () => openUnitCreator(plan, todayStr()) },
      (!isProgram && event) ? { icon: 'calendar', label: 'Feste Termine', onClick: () => openCommitmentsEditor(plan, event) } : null,
      { icon: 'download', label: 'Kalender-Export', onClick: () => openIcsSheet({ scope: 'event', id: eventId, event }) },
      { icon: 'refresh', label: 'Neu generieren', onClick: () => regenerate(plan, event) },
    ].filter(Boolean) : [],
  });

  if (!plan) {
    view.appendChild(emptyState('calendar', 'Noch kein Plan', 'Für dieses Event existiert kein Trainingsplan.'));
    return;
  }

  // Robustheit: unvollständige Pläne (z. B. aus einem alten Backup oder Import)
  // haben keine Phasenstruktur. Statt zu crashen ein Neu-Generieren anbieten.
  if (!Array.isArray(plan.phases) || !plan.phases.length || !plan.weeks) {
    view.appendChild(emptyState('calendar', 'Plan unvollständig',
      'Diesem Trainingsplan fehlt die Phasenstruktur (etwa aus einem älteren Backup).'));
    if (event) view.appendChild(el('button', {
      class: 'btn btn--primary btn--block mt-3', onclick: () => regenerate(plan, event),
    }, [icon('refresh'), 'Plan neu generieren']));
    return;
  }

  const units = (plan.units || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();
  const daysToRace = (event && !isProgram) ? diffDays(today, event.date) : null;
  const currentWeek = clampWeek(plan, today);

  // Phasen-Timeline
  const timeline = el('div', { class: 'card' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: `Woche ${currentWeek} von ${plan.weeks}` }),
      daysToRace != null ? el('span', { class: 'chip chip--accent', text: daysToRace > 0 ? `noch ${daysToRace} Tage` : 'Wettkampf!' }) : null,
    ]),
    phaseTimeline(plan, currentWeek),
  ]);
  view.appendChild(timeline);

  // Feste Termine (Fußball/Spiele) – konfigurierbar, der Plan liegt sich drumherum.
  if (!isProgram && event) view.appendChild(commitmentsCard(plan, event));

  // Wochen-Check: Kollisionen der laufenden Woche transparent priorisiert (R3-Triage)
  if (!isProgram) { const tc = triageCard(plan); if (tc) view.appendChild(tc); }

  // Kennzahlen
  const done = units.filter((u) => u.status === 'erledigt').length;
  const planRun = units.filter((u) => typeMeta(u.type).cat === 'run');
  const totalKm = planRun.reduce((a, u) => a + (u.targetDistanceKm || 0), 0);
  view.appendChild(el('div', { class: 'stat-grid mt-4' }, [
    stat(fmtKm(totalKm, 0), 'Geplante Lauf-km'),
    stat(`${units.length}`, 'Einheiten'),
    stat(`${done}`, 'Erledigt'),
  ]));

  // Hinweis: Plan an die Trainingshistorie angepasst (Adaptiv 4)
  if (plan.baseLongKm) {
    view.appendChild(el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('activity'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'muted', style: { fontSize: '.82rem' }, text: `An deine Form angepasst: Der Aufbau startet bei deinem aktuellen Long-Run-Niveau von ${fmtKm(plan.baseLongKm, plan.baseLongKm % 1 ? 1 : 0)}.` }),
    ]));
  }

  // Wochen-Akkordeon
  view.appendChild(sectionHead('Wochenübersicht'));
  const byWeek = new Map();
  units.forEach((u) => {
    // Woche aus dem (autoritativen) Datum ableiten statt aus u.week: Für generierte
    // Einheiten liefert clampWeek denselben Wert, aber manuell angelegte oder
    // importierte Einheiten haben oft kein `week`-Feld. Ohne diese Ableitung
    // entstünde sonst eine „Wundefined"-Sektion mit „NaN"-Datum (z. B. bei einer
    // manuellen Einheit vor dem Planstart). Nebeneffekt: verschobene Einheiten
    // werden korrekt der Woche ihres neuen Datums zugeordnet.
    const wk = weekOfDate(plan, u.date) ?? u.week ?? 1;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(u);
  });

  [...byWeek.keys()].sort((a, b) => a - b).forEach((w) => {
    const wUnits = byWeek.get(w);
    const phase = phaseForWeek(plan, w);
    const wkm = wUnits.filter((u) => typeMeta(u.type).cat === 'run').reduce((a, u) => a + (u.targetDistanceKm || 0), 0);
    const open = w === currentWeek;

    const body = el('div', { class: 'cal-day__units', hidden: !open });
    wUnits.forEach((u) => body.appendChild(planUnitRow(u)));
    if (event && !isProgram) body.appendChild(el('button', {
      class: 'btn btn--ghost btn--block mt-2', style: { fontSize: '.8rem' },
      onclick: () => regenerateWeek(plan, event, w),
    }, [icon('refresh'), 'Diese Woche neu berechnen']));

    const head = el('button', {
      class: 'cal-day__head', style: { width: '100%' },
      onclick: () => { body.hidden = !body.hidden; },
    }, [
      el('span', { class: 'phase-pill', style: { background: phase.color }, text: `W${w}` }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'cal-day__dow', text: phase.name }),
        el('div', { class: 'cal-day__date', text: `${fmtDayMonth(addDays(plan.startDate, (w - 1) * 7))} · ${fmtKm(wkm, 0)}` }),
      ]),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronDown') }),
    ]);
    view.appendChild(el('div', { class: 'cal-day', style: { marginBottom: '8px' } }, [head, body]));
  });

  // Eigene Einheit anlegen – prominent am Ende (zusätzlich zum „+" in der Kopfzeile).
  view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-4', onclick: () => openUnitCreator(plan, today) }, [icon('plus'), 'Eigene Einheit hinzufügen']));
}

/** Editor für feste Termine: Fußball-Trainingstage + optionale Spiele. Beim
    Speichern wird der Plan neu berechnet (er legt sich um die festen Termine). */
export function openCommitmentsEditor(plan, event) {
  const current = (plan.commitments != null ? plan.commitments : defaultCommitments()).map((c) => ({ ...c }));
  const footballDays = new Set(current.filter((c) => c.type === 'cross_football').map((c) => c.dow));
  let footballDur = (current.find((c) => c.type === 'cross_football') || {}).durationMin || 90;
  let footballIntensity = (current.find((c) => c.type === 'cross_football') || {}).intensity || 'normal';
  const matchC = current.find((c) => c.type === 'match');
  let matchOn = !!matchC;
  const matchDow = matchC ? matchC.dow : 7;
  let matchFrom = matchC ? (matchC.fromDate || '') : '';
  let matchDur = matchC ? matchC.durationMin : 120;

  const dayRow = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } });
  for (let d = 1; d <= 7; d++) {
    const chip = el('button', {
      class: `chip ${footballDays.has(d) ? 'chip--accent' : ''}`, type: 'button',
      style: { cursor: 'pointer', minWidth: '40px' }, text: dowLabel(d),
      onclick: () => {
        if (footballDays.has(d)) { footballDays.delete(d); chip.classList.remove('chip--accent'); }
        else { footballDays.add(d); chip.classList.add('chip--accent'); }
      },
    });
    dayRow.appendChild(chip);
  }
  const durI = input({ type: 'number', min: '15', step: '5', value: String(footballDur) });
  durI.addEventListener('input', () => { footballDur = parseInt(durI.value, 10) || 90; });
  const intensitySeg = segmented(
    FOOTBALL_INTENSITY.map((i) => ({ value: i.key, label: i.label })),
    footballIntensity,
    (v) => { footballIntensity = v; },
  );

  const matchFromI = input({ type: 'date', value: matchFrom });
  matchFromI.addEventListener('input', () => { matchFrom = matchFromI.value; });
  const matchDurI = input({ type: 'number', min: '30', step: '10', value: String(matchDur) });
  matchDurI.addEventListener('input', () => { matchDur = parseInt(matchDurI.value, 10) || 120; });
  const matchBox = el('div', { hidden: !matchOn }, [
    field('Spiele ab (Datum)', matchFromI),
    field('Dauer je Spiel (min)', matchDurI),
  ]);
  const matchToggle = segmented(
    [{ value: 'off', label: 'Keine' }, { value: 'on', label: 'Sonntags' }],
    matchOn ? 'on' : 'off',
    (v) => { matchOn = v === 'on'; matchBox.hidden = !matchOn; },
  );

  const body = el('div', {}, [
    el('div', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: 'Feste Termine (z. B. Fußball) werden fix eingeplant – der Trainingsplan legt sich darum herum. Beim Speichern wird der Plan neu berechnet.' }),
    sectionHead('Fußballtraining'),
    el('label', { class: 'field__label', text: 'Wochentage' }), dayRow,
    field('Dauer (min)', durI),
    field('Intensität', intensitySeg),
    el('div', { class: 'dim', style: { fontSize: '.76rem', marginTop: '-4px' }, text: 'Fußball ist besonders fordernd – die Intensität steuert, wie stark der Termin in Belastung & Form zählt und ob der Coach den Folgetag lockerer vorschlägt.' }),
    sectionHead('Fußballspiele'),
    field('Spiele einplanen', matchToggle),
    matchBox,
  ]);

  const footer = el('button', { class: 'btn btn--primary btn--block', onclick: async () => {
    const commitments = [];
    [...footballDays].sort((a, b) => a - b).forEach((d) => commitments.push(mkCommit('cross_football', d, { durationMin: footballDur, intensity: footballIntensity })));
    if (matchOn) commitments.push(mkCommit('match', matchDow, { fromDate: matchFrom || null, durationMin: matchDur }));
    closeSheet();
    await saveCommitments(plan, event, commitments);
  } }, [icon('check'), 'Übernehmen & Plan berechnen']);

  openSheet({ title: 'Feste Termine', body, footer });
}

/** Wochen-Check (R3): Kollisionen der laufenden Woche + transparente Priorisierung. */
function triageCard(plan) {
  const t = weekTriage(plan.units || [], todayStr());
  if (!t.collisions.length) return null;
  const items = t.collisions.slice(0, 4).map((c) => el('div', { style: { padding: '6px 0 4px', borderTop: '1px solid var(--border)' } }, [
    el('div', { style: { fontWeight: '650', fontSize: '.82rem' }, text: c.text }),
    el('div', { class: 'muted', style: { fontSize: '.78rem', marginTop: '2px' } }, [
      el('span', { html: iconSvg('arrowRight'), style: { display: 'inline-block', width: '13px', color: 'var(--accent)', verticalAlign: '-2px' } }),
      ' ' + c.suggest,
    ]),
  ]));
  return el('div', { class: 'card mt-2', style: { borderLeft: '4px solid #e8a13a' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'center', marginBottom: '2px' } }, [
      el('span', { html: iconSvg('activity'), style: { color: '#e8a13a', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'card__title', style: { fontSize: '.92rem' }, text: `Wochen-Check · ${t.collisions.length} Hinweis${t.collisions.length === 1 ? '' : 'e'}` }),
    ]),
    el('div', { class: 'muted', style: { fontSize: '.76rem', marginBottom: '2px' }, text: 'Bei Kollisionen priorisiert die App so: feste Termine → Schlüssel-Laufeinheiten (Zeitziel) → Kraft → lockerer Umfang.' }),
    ...items,
  ]);
}

/** Übersichtskarte der festen Termine mit „Anpassen". */
function commitmentsCard(plan, event) {
  const commitments = plan.commitments != null ? plan.commitments : defaultCommitments();
  return el('div', { class: 'card card--flat mt-2 row row--between', style: { alignItems: 'center', gap: '10px' } }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('calendar'), style: { color: 'var(--accent)', width: '18px', flex: '0 0 auto', marginTop: '2px' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '700', fontSize: '.86rem' }, text: 'Feste Termine' }),
        el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: commitmentsSummary(commitments) }),
      ]),
    ]),
    el('button', { class: 'btn btn--ghost', style: { fontSize: '.8rem', flex: '0 0 auto' }, onclick: () => openCommitmentsEditor(plan, event) }, [icon('edit'), 'Anpassen']),
  ]);
}

/** Feste Termine speichern und den Plan neu berechnen. Bereits erledigte
    Einheiten (Historie) bleiben erhalten – nur das Offene wird neu geplant. */
async function saveCommitments(plan, event, commitments) {
  store.patch('plans', plan.id, { commitments });
  const fresh = store.find('plans', plan.id);
  const regenerated = generatePlanUnits(fresh, event, store.profile());
  const units = mergeRegeneratedWeek(fresh.units || [], regenerated)
    .sort((a, b) => a.date.localeCompare(b.date));
  store.patch('plans', plan.id, { units, generated: true });
  toast('Feste Termine übernommen', 'good');
  navigate(`#/plan/${event.id}`);
  setTimeout(() => location.reload(), 50);
}

function planUnitRow(u) {
  const m = typeMeta(u.type);
  const meta = [];
  if (u.targetDistanceKm) meta.push(fmtKm(u.targetDistanceKm, u.targetDistanceKm % 1 ? 1 : 0));
  if (u.targetDurationMin && !u.targetDistanceKm) meta.push(`${u.targetDurationMin} min`);
  if (u.targetPaceSecPerKm) meta.push(fmtPace(u.targetPaceSecPerKm));
  const eff = effectiveStatus(u);
  const missedTxt = (eff === 'verpasst' && u.missedReason && MISSED_REASON_LABEL[u.missedReason]) ? ` · ${MISSED_REASON_LABEL[u.missedReason]}` : '';
  const tag = ['ueberfaellig', 'verpasst', 'verschoben'].includes(eff)
    ? el('span', { class: `chip chip--${eff === 'verpasst' ? 'bad' : 'warn'}`, style: { fontSize: '0.62rem', marginLeft: '6px' }, text: STATUS_META[eff].label + missedTxt })
    : null;
  return el('a', {
    class: `cal-unit ${eff === 'erledigt' ? 'cal-unit--done' : ''} ${eff === 'verpasst' ? 'cal-unit--missed' : ''} ${eff === 'ueberfaellig' ? 'cal-unit--overdue' : ''}`,
    href: `#/session/${u.id}`,
  }, [
    typeIcon(u.type, 'type-icon--sm'),
    el('div', { class: 'cal-unit__body' }, [
      el('div', { class: 'cal-unit__title' }, [u.title, tag]),
      el('div', { class: 'cal-unit__meta', text: `${fmtDate(u.date)}${meta.length ? ' · ' + meta.join(' · ') : ''}` }),
    ]),
    el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
  ]);
}

function phaseTimeline(plan, currentWeek) {
  const wrap = el('div', { class: 'row', style: { gap: '3px', marginTop: '4px' } });
  if (!Array.isArray(plan.phases)) return wrap;
  plan.phases.forEach((p) => {
    const span = p.endWeek - p.startWeek + 1;
    const active = currentWeek >= p.startWeek && currentWeek <= p.endWeek;
    wrap.appendChild(el('div', {
      style: { flex: String(span), textAlign: 'center' },
    }, [
      el('div', { style: { height: '8px', borderRadius: '4px', background: p.color, opacity: active ? '1' : '0.4' } }),
      el('div', { class: 'dim', style: { fontSize: '0.64rem', marginTop: '4px', fontWeight: active ? '700' : '500', color: active ? p.color : 'var(--text-3)' }, text: p.name }),
    ]));
  });
  return wrap;
}

function clampWeek(plan, dateStr) {
  if (dateStr < plan.startDate) return 1;
  if (dateStr > plan.endDate) return plan.weeks;
  return Math.min(plan.weeks, Math.floor(diffDays(plan.startDate, dateStr) / 7) + 1);
}

/** Robuste, öffentliche Wochenzuordnung eines Datums im Plan (1..plan.weeks).
 *  Zentrale Quelle, damit Ansichten die Woche aus dem AUTORITATIVEN Datum ableiten,
 *  statt sich auf ein gespeichertes `week`-Feld zu verlassen (manuell angelegte oder
 *  importierte Einheiten haben oft keines). Liefert null bei unvollständigem Plan. */
export function weekOfDate(plan, dateStr) {
  if (!plan || !plan.startDate || !plan.endDate || !plan.weeks || !dateStr) return null;
  return clampWeek(plan, dateStr);
}

function stat(val, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__val num', text: val }),
    el('div', { class: 'stat__label', text: label }),
  ]);
}

async function regenerate(plan, event) {
  const ok = await confirmDialog({
    title: 'Plan neu generieren?',
    message: 'Alle geplanten Einheiten werden neu erzeugt. Bereits absolvierte Trainings bleiben erhalten, aber Verschiebungen und manuelle Änderungen am Plan gehen verloren.',
    confirmLabel: 'Neu generieren', danger: true,
  });
  if (!ok) return;
  if (plan.kind === 'program' || (event && event.kind === 'program')) {
    // Programm: Einheiten wiederkehrend aus der Programm-Vorlage erzeugen.
    const units = buildProgramUnits(
      { programType: plan.programType || event.programType, weeks: plan.weeks, daysPerWeek: plan.daysPerWeek },
      plan.id, plan.startDate,
    );
    store.patch('plans', plan.id, { units, generated: true });
    toast('Plan neu generiert', 'good');
    navigate(`#/plan/${event.id}`);
    setTimeout(() => location.reload(), 50);
    return;
  }
  const histLong = recentLongRunKm(store.get('sessions'), todayStr());
  const baseLongKm = histLong >= 8 ? histLong : null;
  const units = generatePlanUnits({ ...plan, baseLongKm }, event, store.profile());
  store.patch('plans', plan.id, { units, baseLongKm, generated: true });
  toast('Plan neu generiert', 'good');
  navigate(`#/plan/${event.id}`);
  setTimeout(() => location.reload(), 50);
}

/** Nur eine einzelne Woche neu berechnen (#10) – z. B. nach Saisonstart mitten im Plan. */
async function regenerateWeek(plan, event, week) {
  const ws = addDays(plan.startDate, (week - 1) * 7);
  const we = addDays(ws, 6);
  const all = (store.find('plans', plan.id).units) || [];
  const inWeek = all.filter((u) => u.date >= ws && u.date <= we);
  const doneCount = inWeek.filter((u) => u.status === 'erledigt').length;
  const ok = await confirmDialog({
    title: `Woche ${week} neu berechnen?`,
    message: `Die geplanten Einheiten dieser Woche werden frisch erzeugt.${doneCount ? ` ${doneCount} bereits erledigte Einheit${doneCount === 1 ? '' : 'en'} b${doneCount === 1 ? 'leibt' : 'leiben'} erhalten.` : ''} Verschiebungen und manuelle Änderungen dieser Woche gehen verloren.`,
    confirmLabel: 'Neu berechnen', danger: true,
  });
  if (!ok) return;
  const fresh = buildWeekUnits(plan, event, store.profile(), week);
  const others = all.filter((u) => u.date < ws || u.date > we);
  const units = [...others, ...mergeRegeneratedWeek(inWeek, fresh)].sort((a, b) => a.date.localeCompare(b.date));
  store.patch('plans', plan.id, { units });
  toast(`Woche ${week} neu berechnet`, 'good');
  navigate(`#/plan/${event.id}`);
  setTimeout(() => location.reload(), 50);
}
