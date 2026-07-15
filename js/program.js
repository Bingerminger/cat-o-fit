/* =========================================================================
   program.js — Fitness-/Health-Programme OHNE Wettkampf.

   Während js/plans.js periodisierte Pläne auf ein Wettkampfdatum hin erzeugt,
   baut dieses Modul wiederkehrende Trainingswochen für allgemeine Ziele
   (Fitness, Kraft, Abnehmen, Beweglichkeit). Das Ergebnis ist bewusst
   *plan-kompatibel* (gleiche Unit-Felder, planId), damit Kalender-, Session-,
   Workout- und Statistik-Ansicht es ohne Sonderfall anzeigen.

   Reine, DOM-freie Logik -> per node:test abgedeckt.
   ========================================================================= */

import { uid, addDays, isoDow, nowIso } from './ui.js';

/* ---- Programm-Vorlagen ---------------------------------------------------
   `blocks` ist eine nach Wichtigkeit geordnete Wochenstruktur. Die ersten
   `daysPerWeek` Bausteine bilden die Trainingswoche – so skaliert dieselbe
   Vorlage von 2 bis 6 Tagen sinnvoll. */
export const PROGRAM_TYPES = {
  fitness: {
    label: 'Allgemeine Fitness',
    emoji: '💪',
    focus: 'Ausgewogen aktiv & gesund bleiben',
    desc: 'Ein ausgewogener Mix aus Ausdauer, Kraft und Beweglichkeit – an den Bewegungsempfehlungen der WHO orientiert (Ausdauer + 2× Kraft pro Woche).',
    blocks: ['cardio', 'strength', 'mobility', 'cardio', 'strength', 'walk', 'mobility'],
    defaultDays: 4,
  },
  strength: {
    label: 'Kraft & Muskelaufbau',
    emoji: '🏋️',
    focus: 'Kraft und Muskulatur aufbauen',
    desc: 'Schwerpunkt Krafttraining (Ganzkörper im Wechsel) mit etwas Cardio und Mobilität für die Regeneration.',
    blocks: ['strength', 'cardio', 'strength', 'mobility', 'strength', 'walk', 'cardio'],
    defaultDays: 4,
  },
  weightloss: {
    label: 'Abnehmen & Gewicht',
    emoji: '⚖️',
    focus: 'Gewicht reduzieren, Stoffwechsel ankurbeln',
    desc: 'Viel Bewegung (Cardio & zügiges Gehen) plus Kraft für den Stoffwechsel. Wirkt am besten zusammen mit der Kalorienbilanz in der Ernährung.',
    blocks: ['cardio', 'strength', 'walk', 'cardio', 'strength', 'walk', 'cardio'],
    defaultDays: 4,
  },
  mobility: {
    label: 'Beweglichkeit & Gesundheit',
    emoji: '🧘',
    focus: 'Sanft beweglich und gesund bleiben',
    desc: 'Schonender Einstieg: Beweglichkeit, leichtes Cardio und sanfte Kraft. Ideal für Einsteiger:innen oder zum Wiedereinstieg.',
    blocks: ['mobility', 'walk', 'strength', 'mobility', 'cardio', 'walk', 'mobility'],
    defaultDays: 3,
  },
};

export function programMeta(type) { return PROGRAM_TYPES[type] || PROGRAM_TYPES.fitness; }

/* ---- Kraft-Rotation (Ganzkörper-Split über die Wochen) ------------------- */
const STRENGTH_ROTATION = [
  { title: 'Kraft – Ganzkörper', desc: 'Ganzkörper, 3 Runden (Eigengewicht oder mit Hanteln/Kettlebell): Kniebeugen 12× · Liegestütz 8–12× (ggf. auf Knien) · Ausfallschritte 10×/Bein · Schulterdrücken 12× · Plank 30–45 s. Saubere Technik vor Gewicht, 60–90 s Pause zwischen den Runden.' },
  { title: 'Kraft – Unterkörper', desc: 'Beine & Po, 3 Runden: Kniebeugen 15× · Rumänisches Kreuzheben (Hantel/Kettlebell oder einbeinig) 10× · Step-ups auf Bank/Stufe 10×/Bein · Wadenheben 20× · Glute Bridge 15×. Mit Gewicht etwas weniger Wiederholungen, 60–90 s Pause.' },
  { title: 'Kraft – Oberkörper & Rumpf', desc: 'Oberkörper & Core, 3 Runden: Liegestütz 8–12× · Rudern (Hantel/Band) 12× · Schulterdrücken 12× · Plank 40 s · Seitstütz 30 s/Seite · Dead Bug 10×/Seite. Langsam und kontrolliert, bewusst Körperspannung halten.' },
];

/* ---- Baustein -> konkrete Einheit ---------------------------------------- */
function blockUnit(block, week) {
  switch (block) {
    case 'strength': {
      const s = STRENGTH_ROTATION[(week - 1) % STRENGTH_ROTATION.length];
      return { type: 'strength', dur: 40, title: s.title, desc: s.desc };
    }
    case 'cardio':
      return { type: 'easy', dur: 30, title: 'Cardio locker', desc: 'Gleichmäßiges Ausdauertraining ~30 min im Plaudertempo (Z2) – Laufen, Rad, Crosstrainer oder Schwimmen, ganz nach Vorliebe. Du solltest dich nebenbei unterhalten können.' };
    case 'walk':
      return { type: 'walk', dur: 40, title: 'Zügiges Gehen', desc: 'Flotter Spaziergang ~40 min, gerne an der frischen Luft. Niedrigschwellig und gelenkschonend – zählt voll als Bewegung und tut Kopf und Stoffwechsel gut.' };
    case 'mobility':
      return { type: 'mobility', dur: 20, title: 'Beweglichkeit & Dehnen', desc: 'Ruhige Mobility-Einheit ~15–20 min: Katze-Kuh 10× · Hüftbeuger-Dehnung 45 s/Seite · Beinrückseite sanft 45 s/Seite · Brustöffner & Wirbelsäulen-Rotation 8×/Seite · Kindhaltung 60 s. In jede Position locker hineinatmen, nichts ruckartig.' };
    default:
      return { type: 'easy', dur: 30, title: 'Training', desc: 'Lockere Bewegungseinheit.' };
  }
}

/* ---- Wochentags-Verteilung (gleichmäßig, mit Ruhetagen) ------------------ */
const DAY_SPREAD = {
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 6],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

/** Wochentage (ISO 1=Mo..7=So) für eine gewünschte Anzahl Trainingstage. */
export function spreadDays(daysPerWeek) {
  const n = Math.max(2, Math.min(6, daysPerWeek | 0));
  return DAY_SPREAD[n];
}

/** Die Bausteine einer Trainingswoche für `type` und `daysPerWeek` (ohne Datum). */
export function programWeekBlocks(type, daysPerWeek) {
  const meta = programMeta(type);
  const days = spreadDays(daysPerWeek);
  return days.map((dow, i) => ({ dow, block: meta.blocks[i % meta.blocks.length] }));
}

/* ---- Phasen (einfacher als Wettkampf-Periodisierung) --------------------- */
export function programPhases(weeks) {
  const w = Math.max(1, weeks | 0);
  if (w <= 2) return [{ key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Gewohnheit & Grundlage', startWeek: 1, endWeek: w }];
  const intro = Math.min(2, Math.max(1, Math.round(w * 0.25)));
  return [
    { key: 'intro', name: 'Eingewöhnung', color: '#43c59e', focus: 'Reinkommen & Technik', startWeek: 1, endWeek: intro },
    { key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Steigern & dranbleiben', startWeek: intro + 1, endWeek: w },
  ];
}

/* ---- Datierte Einheiten über die gesamte Programmdauer ------------------- */
export function buildProgramUnits(program, planId, startDate) {
  const weeks = Math.max(1, program.weeks | 0);
  const dpw = program.daysPerWeek || programMeta(program.programType).defaultDays;
  const layout = programWeekBlocks(program.programType, dpw);
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const weekStart = addDays(startDate, (w - 1) * 7);
    for (const { dow, block } of layout) {
      const date = addDays(weekStart, dow - 1);
      const u = blockUnit(block, w);
      out.push({
        id: uid('u'), planId, eventId: null,
        date, dow: isoDow(date), week: w,
        type: u.type, title: u.title,
        targetDistanceKm: null, dur: u.dur, pace: null,
        desc: u.desc, intervals: null,
        status: 'geplant', done: false,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Nächsten Montag ab `today` (oder heute, falls Montag). */
function nextMonday(today) {
  const dow = isoDow(today);
  return dow === 1 ? today : addDays(today, 8 - dow);
}

/**
 * Erzeugt einen plan-kompatiblen Programm-Datensatz inkl. Einheiten.
 * `program`: { id, name, programType, weeks, daysPerWeek }
 */
export function createProgramPlan(program, today) {
  const start = nextMonday(today);
  const weeks = Math.max(1, program.weeks | 0);
  const planId = uid('plan');
  const units = buildProgramUnits(program, planId, start);
  return {
    id: planId,
    eventId: program.id,        // verweist auf das Ziel/Programm (kein Wettkampf)
    kind: 'program',
    programType: program.programType,
    name: `${programMeta(program.programType).label} · ${program.name}`,
    startDate: start,
    endDate: addDays(start, weeks * 7 - 1),
    weeks,
    daysPerWeek: program.daysPerWeek || programMeta(program.programType).defaultDays,
    phases: programPhases(weeks),
    weekTemplate: null,
    units,
    generated: true,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
}
