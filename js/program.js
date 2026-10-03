/* =========================================================================
   program.js — Fitness-/Health-Programme OHNE Wettkampf.

   Während js/plans.js periodisierte Pläne auf ein Wettkampfdatum hin erzeugt,
   baut dieses Modul Trainingswochen für allgemeine Ziele (Fitness, Kraft,
   Abnehmen, Beweglichkeit). Das Ergebnis ist *plan-kompatibel* (gleiche
   Unit-Felder wie Wettkampfpläne: `targetDurationMin`, `description`, planId),
   damit Kalender-, Session-, Workout- und Statistik-Ansicht es ohne Sonderfall
   anzeigen.

   Orientierung: WHO 2020 – 150–300 min moderate Ausdauer pro Woche (zügiges
   Gehen zählt) plus Kraft an mindestens zwei Tagen (Bull et al. 2020); zum
   Abnehmen eher 225–250 min (ACSM, Donnelly et al. 2009). Die Ausdauerminuten
   steigen je Woche um ~8 %, jede 4. Woche ist leichter; die Kraft steigert sich
   über Runden, Wiederholungen und Varianten.

   Reine, DOM-freie Logik -> per node:test abgedeckt.
   ========================================================================= */

import { uid, addDays, isoDow, nowIso } from './ui.js';

/* ---- Programm-Vorlagen ---------------------------------------------------
   `cardio`: Ausdauerminuten pro Woche [Start, Ziel]; `strengthDays`: Krafttage
   (Funktion der Trainingstage); `walkDays`: wie viele Ausdauertage zügiges Gehen
   sind; `mobility`: Beweglichkeit als eigener Tag ('primary') oder als kurzer
   Zusatz ('extra'). */
export const PROGRAM_TYPES = {
  fitness: {
    label: 'Allgemeine Fitness',
    emoji: '💪',
    focus: 'Ausgewogen aktiv & gesund bleiben',
    desc: 'Ausdauer, Kraft und Beweglichkeit nach den Bewegungsempfehlungen der WHO: Die Ausdauer steigt von rund 120 auf 150–180 Minuten pro Woche (zügiges Gehen zählt mit), dazu Kraft an zwei Tagen.',
    cardio: [120, 180], strengthDays: () => 2, walkDays: (d) => (d >= 5 ? 1 : 0), mobility: 'extra',
    defaultDays: 4,
  },
  strength: {
    label: 'Kraft & Muskelaufbau',
    emoji: '🏋️',
    focus: 'Kraft und Muskulatur aufbauen',
    desc: 'Schwerpunkt Krafttraining (Ganzkörper im Wechsel, zwei bis drei Krafttage) mit etwas Ausdauer und Mobilität für die Regeneration. Die Kraft steigert sich über Runden, Wiederholungen und schwerere Varianten.',
    cardio: [60, 100], strengthDays: (d) => (d >= 4 ? 3 : 2), walkDays: (d) => (d >= 5 ? 1 : 0), mobility: 'extra',
    defaultDays: 4,
  },
  weightloss: {
    label: 'Abnehmen & Gewicht',
    emoji: '⚖️',
    focus: 'Gewicht reduzieren, Stoffwechsel ankurbeln',
    desc: 'Viel Bewegung (Ausdauer und zügiges Gehen, von rund 150 auf 225–240 Minuten pro Woche) plus Kraft an zwei Tagen für den Stoffwechsel. Wirkt am besten zusammen mit der Kalorienbilanz in der Ernährung.',
    cardio: [150, 240], strengthDays: () => 2, walkDays: (d) => (d >= 5 ? 2 : d >= 4 ? 1 : 0), mobility: null,
    defaultDays: 4,
  },
  mobility: {
    label: 'Beweglichkeit & Gesundheit',
    emoji: '🧘',
    focus: 'Sanft beweglich und gesund bleiben',
    desc: 'Schonender Einstieg: Beweglichkeit, sanfte Kraft an zwei Tagen und Bewegung, die von rund 90 auf 150 Minuten pro Woche wächst – ideal für Einsteiger:innen oder zum Wiedereinstieg.',
    cardio: [90, 150], strengthDays: () => 2, walkDays: (d) => (d >= 4 ? 2 : 1), mobility: 'primary', gentle: true,
    defaultDays: 3,
  },
};

export function programMeta(type) { return PROGRAM_TYPES[type] || PROGRAM_TYPES.fitness; }

/** Planname eines Programms – ohne Dopplung, wenn der Name der Schwerpunkt selbst ist
    (das Formular belegt ihn so vor): „Allgemeine Fitness“ statt „… · Allgemeine Fitness“. */
export function programPlanName(program) {
  const label = programMeta(program.programType).label;
  const name = String(program.name || '').trim();
  return !name || name === label ? label : `${label} · ${name}`;
}

/* ---- Kraft-Rotation (Ganzkörper-Split über die Wochen) ------------------- */
const STRENGTH_ROTATION = [
  { title: 'Kraft – Ganzkörper', moves: 'Kniebeugen 12× · Liegestütz 8–12× (ggf. auf Knien) · Ausfallschritte 10×/Bein · Schulterdrücken 12× · Plank 30–45 s', harder: 'Kniebeugen mit Gewicht, Liegestütz mit Füßen erhöht, Plank 60 s' },
  { title: 'Kraft – Unterkörper', moves: 'Kniebeugen 15× · Rumänisches Kreuzheben (Hantel/Kettlebell oder einbeinig) 10× · Step-ups auf Bank/Stufe 10×/Bein · Wadenheben 20× · Glute Bridge 15×', harder: 'Bulgarian Split Squats statt Step-ups, einbeinige Glute Bridge, mehr Gewicht' },
  { title: 'Kraft – Oberkörper & Rumpf', moves: 'Liegestütz 8–12× · Rudern (Hantel/Band) 12× · Schulterdrücken 12× · Plank 40 s · Seitstütz 30 s/Seite · Dead Bug 10×/Seite', harder: 'engere Liegestütz, stärkeres Band oder schwerere Hantel, Seitstütz mit Beinheben' },
];
const GENTLE_STRENGTH = { title: 'Sanfte Kraft', moves: 'Sitz-Steh-Wechsel vom Stuhl 10× · Wand-Liegestütz 10× · Brücke (Glute Bridge) 12× · Wadenheben am Stuhl 15× · Vierfüßlerstand, Arm und Bein diagonal 8×/Seite', harder: 'langsamer absenken, kurze Halte-Pausen, erst dann mehr Wiederholungen' };

/* ---- Phasen ---------------------------------------------------------------
   Eingewöhnung (Technik, 2 Runden) → Aufbau (3 Runden, steigern) → ab 8 Wochen
   Festigen (schwerere Varianten). */
export function programPhases(weeks) {
  const w = Math.max(1, weeks | 0);
  if (w <= 2) return [{ key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Gewohnheit & Grundlage', startWeek: 1, endWeek: w }];
  const intro = Math.min(2, Math.max(1, Math.round(w * 0.25)));
  if (w < 8) {
    return [
      { key: 'intro', name: 'Eingewöhnung', color: '#43c59e', focus: 'Reinkommen & Technik', startWeek: 1, endWeek: intro },
      { key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Steigern & dranbleiben', startWeek: intro + 1, endWeek: w },
    ];
  }
  const consolidate = Math.max(2, Math.round(w * 0.25));
  return [
    { key: 'intro', name: 'Eingewöhnung', color: '#43c59e', focus: 'Reinkommen & Technik', startWeek: 1, endWeek: intro },
    { key: 'build', name: 'Aufbau', color: '#3d8bff', focus: 'Steigern & dranbleiben', startWeek: intro + 1, endWeek: w - consolidate },
    { key: 'consolidate', name: 'Festigen', color: '#b079e6', focus: 'Schwerere Varianten, Gewohnheit sichern', startWeek: w - consolidate + 1, endWeek: w },
  ];
}
function phaseKeyAt(weeks, week) {
  const p = programPhases(weeks).find((x) => week >= x.startWeek && week <= x.endWeek);
  return p ? p.key : 'build';
}

/** Leichtere Woche? Jede 4. Woche, nicht in der letzten Woche. */
export function isEasyWeek(week, weeks) { return week % 4 === 0 && week < weeks; }

/** Ausdauerminuten pro Woche (inkl. zügigem Gehen): +8 % je Woche bis zum Ziel,
    jede 4. Woche −20 %, danach zurück auf den Stand davor. Index 1..weeks. */
export function weeklyCardioMinutes(type, weeks) {
  const [start, target] = programMeta(type).cardio;
  const out = [0];
  let last = start;
  for (let w = 1; w <= weeks; w++) {
    if (w === 1) { out.push(start); continue; }
    if (isEasyWeek(w, weeks)) { out.push(Math.round(last * 0.8)); continue; }
    if (!isEasyWeek(w - 1, weeks)) last = Math.min(target, last * 1.08);
    out.push(Math.round(last));
  }
  return out;
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

/**
 * Die Bausteine einer Trainingswoche (ohne Datum): je Tag ein Hauptbaustein
 * (`block`) und ggf. Zusätze am selben Tag (`extra`, z. B. Kraft nach der Ausdauer).
 * Krafttage liegen möglichst weit auseinander.
 */
export function programWeekBlocks(type, daysPerWeek) {
  const meta = programMeta(type);
  const days = spreadDays(daysPerWeek);
  const n = days.length;
  const k = Math.min(n, meta.strengthDays(n));
  const strengthIdx = new Set(Array.from({ length: k }, (_, i) => Math.round((i * n) / k)));
  const strengthOnly = type === 'strength';
  const plan = days.map((dow, i) => {
    const strength = strengthIdx.has(i);
    if (strength && strengthOnly) return { dow, block: 'strength', extra: [] };
    return { dow, block: 'cardio', extra: strength ? ['strength'] : [] };
  });
  // Zügiges Gehen statt Ausdauer an den letzten reinen Ausdauertagen.
  let walks = meta.walkDays(n);
  for (let i = plan.length - 1; i >= 0 && walks > 0; i--) {
    if (plan[i].block === 'cardio' && !plan[i].extra.length) { plan[i].block = 'walk'; walks--; }
  }
  // Beweglichkeit: eigener Tag (sanftes Programm) oder kurzer Zusatz am letzten Tag.
  if (meta.mobility === 'primary') {
    const i = plan.findIndex((d) => !d.extra.length && d.block !== 'strength');
    if (i >= 0) { plan[i].extra.push(plan[i].block); plan[i].block = 'mobility'; }
  } else if (meta.mobility === 'extra') {
    const last = plan[plan.length - 1];
    if (!last.extra.includes('mobility')) last.extra.push('mobility');
  }
  return plan;
}

/* ---- Baustein -> konkrete Einheit ---------------------------------------- */
function r5(v) { return Math.max(5, Math.round(v / 5) * 5); }

function strengthUnit(meta, week, weeks) {
  const s = meta.gentle ? GENTLE_STRENGTH : STRENGTH_ROTATION[(week - 1) % STRENGTH_ROTATION.length];
  const phase = phaseKeyAt(weeks, week);
  const easy = isEasyWeek(week, weeks);
  let rounds, dur, how;
  if (easy) { rounds = 2; dur = 25; how = 'Leichtere Woche: 2 Runden mit den gewohnten Übungen, bewusst etwas leichter.'; }
  else if (phase === 'intro') { rounds = 2; dur = 25; how = 'Eingewöhnung: 2 Runden, Technik vor Tempo – lieber ein paar Wiederholungen weniger, dafür sauber.'; }
  else if (phase === 'consolidate') { rounds = meta.gentle ? 3 : 4; dur = meta.gentle ? 35 : 45; how = `Festigen: ${meta.gentle ? 3 : 4} Runden, schwerere Varianten: ${s.harder}.`; }
  else { rounds = 3; dur = meta.gentle ? 30 : 35; how = '3 Runden. Steigere alle ein bis zwei Wochen: 1–2 Wiederholungen mehr oder etwas mehr Gewicht, solange die Technik sauber bleibt.'; }
  return {
    type: 'strength', dur, title: s.title,
    desc: `${how} Übungen je Runde: ${s.moves}. 60–90 s Pause zwischen den Runden.`,
    rounds,
  };
}

function blockUnit(block, ctx) {
  const { meta, week, weeks, cardioMin, weekCardio } = ctx;
  const total = `Diese Woche insgesamt rund ${weekCardio} min Ausdauer inklusive Gehen – die WHO empfiehlt 150–300 min.`;
  switch (block) {
    case 'strength':
      return strengthUnit(meta, week, weeks);
    case 'cardio':
      return { type: 'cross', dur: cardioMin, title: `Ausdauer ${cardioMin} min`, desc: `Gleichmäßiges Ausdauertraining im Plaudertempo (Z2) – Laufen, Rad, Crosstrainer oder Schwimmen, ganz nach Vorliebe. Du solltest dich nebenbei unterhalten können. ${total}` };
    case 'walk':
      return { type: 'walk', dur: cardioMin, title: `Zügiges Gehen ${cardioMin} min`, desc: `Flotter Spaziergang, gerne an der frischen Luft – so zügig, dass du etwas schneller atmest, aber noch reden kannst. Niedrigschwellig und gelenkschonend, zählt voll als Ausdauer. ${total}` };
    case 'mobility':
      return { type: 'mobility', dur: meta.mobility === 'primary' ? 25 : 15, title: 'Beweglichkeit & Dehnen', desc: 'Ruhige Mobility-Einheit: Katze-Kuh 10× · Hüftbeuger-Dehnung 45 s/Seite · Beinrückseite sanft 45 s/Seite · Brustöffner & Wirbelsäulen-Rotation 8×/Seite · Kindhaltung 60 s. In jede Position locker hineinatmen, nichts ruckartig.' };
    default:
      return { type: 'cross', dur: 30, title: 'Training', desc: 'Lockere Bewegungseinheit.' };
  }
}

/* ---- Datierte Einheiten über die gesamte Programmdauer ------------------- */
export function buildProgramUnits(program, planId, startDate) {
  const weeks = Math.max(1, program.weeks | 0);
  const dpw = program.daysPerWeek || programMeta(program.programType).defaultDays;
  const meta = programMeta(program.programType);
  const layout = programWeekBlocks(program.programType, dpw);
  const cardio = weeklyCardioMinutes(program.programType, weeks);
  const cardioBlocks = layout.reduce((n, d) => n + [d.block, ...d.extra].filter((b) => b === 'cardio' || b === 'walk').length, 0) || 1;
  const phases = programPhases(weeks);
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const weekStart = addDays(startDate, (w - 1) * 7);
    const cardioMin = Math.max(20, Math.min(90, r5(cardio[w] / cardioBlocks)));
    const phase = phases.find((p) => w >= p.startWeek && w <= p.endWeek) || phases.at(-1);
    for (const { dow, block, extra } of layout) {
      const date = addDays(weekStart, dow - 1);
      for (const b of [block, ...extra]) {
        const u = blockUnit(b, { meta, week: w, weeks, cardioMin, weekCardio: cardio[w] });
        out.push({
          id: uid('u'), planId, eventId: null,
          date, dow: isoDow(date), week: w, phase: phase.key,
          type: u.type, title: u.title,
          targetDistanceKm: null, targetDurationMin: u.dur,
          targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null, targetHrZone: u.type === 'cross' || u.type === 'walk' ? 2 : null,
          description: u.desc, intervals: null,
          status: 'geplant', executedSessionId: null,
          createdAt: nowIso(), updatedAt: nowIso(),
        });
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/* ---- Lese-Migration ------------------------------------------------------
   Programmeinheiten aus früheren Versionen trugen `dur`/`desc` statt der
   Plan-Felder `targetDurationMin`/`description` – Session-Ansicht, Kalender,
   Heute und .ics zeigten deshalb weder Dauer noch Anleitung. Beim Lesen werden
   die Felder ergänzt; gespeichert wird dabei nichts. */
const planMemo = new WeakMap();
const needsUnitFields = (u) => !!u && ((u.targetDurationMin == null && u.dur != null) || (u.description == null && u.desc != null));

export function migratePlan(plan) {
  if (!plan || plan.kind !== 'program' || !Array.isArray(plan.units) || !plan.units.some(needsUnitFields)) return plan;
  const cached = planMemo.get(plan);
  if (cached) return cached;
  const out = {
    ...plan,
    units: plan.units.map((u) => (needsUnitFields(u)
      ? { ...u, targetDurationMin: u.targetDurationMin ?? u.dur ?? null, description: u.description ?? u.desc ?? '' }
      : u)),
  };
  planMemo.set(plan, out);
  return out;
}

export function migratePlans(list = []) { return (list || []).map(migratePlan); }

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
    name: programPlanName(program),
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
