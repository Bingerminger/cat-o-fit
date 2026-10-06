/* =========================================================================
   program.js — fitness/health programmes WITHOUT a race.

   While js/plans.js generates periodised plans towards a race date,
   this module builds training weeks for general goals (fitness, strength,
   weight loss, mobility). The result is *plan-compatible* (same
   unit fields as race plans: `targetDurationMin`, `description`, planId),
   so that the calendar, session, workout and statistics views show it without a
   special case.

   Orientation: WHO 2020 – 150–300 min of moderate endurance per week (brisk
   walking counts) plus strength on at least two days (Bull et al. 2020); for
   weight loss rather 225–250 min (ACSM, Donnelly et al. 2009). The endurance
   minutes rise by ~8 % per week, every 4th week is lighter; strength progresses
   through rounds, repetitions and variants.

   Pure, DOM-free logic -> covered by node:test.
   ========================================================================= */

import { uid, addDays, isoDow, nowIso, nextWeekStart, dateOfDow } from './ui.js';

import { t } from './i18n.js';

/* ---- Programme templates ------------------------------------------------
   `cardio`: endurance minutes per week [start, goal]; `strengthDays`: strength days
   (function of the training days); `walkDays`: how many endurance days are brisk
   walking; `mobility`: mobility as its own day ('primary') or as a short
   addition ('extra'). */
export const PROGRAM_TYPES = {
  fitness: {
    get label() { return t('program.types.fitness.label'); },
    emoji: '💪',
    get focus() { return t('program.types.fitness.focus'); },
    get desc() { return t('program.types.fitness.desc'); },
    cardio: [120, 180], strengthDays: () => 2, walkDays: (d) => (d >= 5 ? 1 : 0), mobility: 'extra',
    defaultDays: 4,
  },
  strength: {
    get label() { return t('program.types.strength.label'); },
    emoji: '🏋️',
    get focus() { return t('program.types.strength.focus'); },
    get desc() { return t('program.types.strength.desc'); },
    cardio: [60, 100], strengthDays: (d) => (d >= 4 ? 3 : 2), walkDays: (d) => (d >= 5 ? 1 : 0), mobility: 'extra',
    defaultDays: 4,
  },
  weightloss: {
    get label() { return t('program.types.weightloss.label'); },
    emoji: '⚖️',
    get focus() { return t('program.types.weightloss.focus'); },
    get desc() { return t('program.types.weightloss.desc'); },
    cardio: [150, 240], strengthDays: () => 2, walkDays: (d) => (d >= 5 ? 2 : d >= 4 ? 1 : 0), mobility: null,
    defaultDays: 4,
  },
  mobility: {
    get label() { return t('program.types.mobility.label'); },
    emoji: '🧘',
    get focus() { return t('program.types.mobility.focus'); },
    get desc() { return t('program.types.mobility.desc'); },
    cardio: [90, 150], strengthDays: () => 2, walkDays: (d) => (d >= 4 ? 2 : 1), mobility: 'primary', gentle: true,
    defaultDays: 3,
  },
};

export function programMeta(type) { return PROGRAM_TYPES[type] || PROGRAM_TYPES.fitness; }

/** Plan name of a programme – without duplication when the name is the focus itself
    (the form prefills it that way): "General fitness" instead of "… · General fitness". */
export function programPlanName(program) {
  const label = programMeta(program.programType).label;
  const name = String(program.name || '').trim();
  return !name || name === label ? label : `${label} · ${name}`;
}

/* ---- Strength rotation (full-body split over the weeks) ----------------- */
const STRENGTH_ROTATION = [
  { get title() { return t('program.rotation.fullBody.title'); }, get moves() { return t('program.rotation.fullBody.moves'); }, get harder() { return t('program.rotation.fullBody.harder'); } },
  { get title() { return t('program.rotation.lowerBody.title'); }, get moves() { return t('program.rotation.lowerBody.moves'); }, get harder() { return t('program.rotation.lowerBody.harder'); } },
  { get title() { return t('program.rotation.upperBody.title'); }, get moves() { return t('program.rotation.upperBody.moves'); }, get harder() { return t('program.rotation.upperBody.harder'); } },
];
const GENTLE_STRENGTH = { get title() { return t('program.gentle.title'); }, get moves() { return t('program.gentle.moves'); }, get harder() { return t('program.gentle.harder'); } };

/* ---- Phases ---------------------------------------------------------------
   Familiarisation (technique, 2 rounds) → build-up (3 rounds, progress) → from 8 weeks
   consolidation (heavier variants). */
export function programPhases(weeks) {
  const w = Math.max(1, weeks | 0);
  if (w <= 2) return [{ key: 'build', name: t('program.phases.build.name'), color: '#3d8bff', focus: t('program.phases.build.focusShort'), startWeek: 1, endWeek: w }];
  const intro = Math.min(2, Math.max(1, Math.round(w * 0.25)));
  if (w < 8) {
    return [
      { key: 'intro', name: t('program.phases.intro.name'), color: '#43c59e', focus: t('program.phases.intro.focus'), startWeek: 1, endWeek: intro },
      { key: 'build', name: t('program.phases.build.name'), color: '#3d8bff', focus: t('program.phases.build.focus'), startWeek: intro + 1, endWeek: w },
    ];
  }
  const consolidate = Math.max(2, Math.round(w * 0.25));
  return [
    { key: 'intro', name: t('program.phases.intro.name'), color: '#43c59e', focus: t('program.phases.intro.focus'), startWeek: 1, endWeek: intro },
    { key: 'build', name: t('program.phases.build.name'), color: '#3d8bff', focus: t('program.phases.build.focus'), startWeek: intro + 1, endWeek: w - consolidate },
    { key: 'consolidate', name: t('program.phases.consolidate.name'), color: '#b079e6', focus: t('program.phases.consolidate.focus'), startWeek: w - consolidate + 1, endWeek: w },
  ];
}
function phaseKeyAt(weeks, week) {
  const p = programPhases(weeks).find((x) => week >= x.startWeek && week <= x.endWeek);
  return p ? p.key : 'build';
}

/** Lighter week? Every 4th week, not in the last week. */
export function isEasyWeek(week, weeks) { return week % 4 === 0 && week < weeks; }

/** Endurance minutes per week (incl. brisk walking): +8 % per week up to the goal,
    every 4th week −20 %, afterwards back to the level before it. Index 1..weeks. */
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

/* ---- Weekday distribution (even, with rest days) ------------------------ */
const DAY_SPREAD = {
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 6],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

/** Weekdays (ISO 1=Mon..7=Sun) for a desired number of training days. */
export function spreadDays(daysPerWeek) {
  const n = Math.max(2, Math.min(6, daysPerWeek | 0));
  return DAY_SPREAD[n];
}

/**
 * The building blocks of a training week (without dates): one main block per day
 * (`block`) and, where applicable, additions on the same day (`extra`, e.g. strength after endurance).
 * Strength days are placed as far apart as possible.
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
  // Brisk walking instead of endurance on the last pure endurance days.
  let walks = meta.walkDays(n);
  for (let i = plan.length - 1; i >= 0 && walks > 0; i--) {
    if (plan[i].block === 'cardio' && !plan[i].extra.length) { plan[i].block = 'walk'; walks--; }
  }
  // Mobility: its own day (gentle programme) or a short addition on the last day.
  if (meta.mobility === 'primary') {
    const i = plan.findIndex((d) => !d.extra.length && d.block !== 'strength');
    if (i >= 0) { plan[i].extra.push(plan[i].block); plan[i].block = 'mobility'; }
  } else if (meta.mobility === 'extra') {
    const last = plan[plan.length - 1];
    if (!last.extra.includes('mobility')) last.extra.push('mobility');
  }
  return plan;
}

/* ---- Building block -> concrete session --------------------------------- */
function r5(v) { return Math.max(5, Math.round(v / 5) * 5); }

function strengthUnit(meta, week, weeks) {
  const s = meta.gentle ? GENTLE_STRENGTH : STRENGTH_ROTATION[(week - 1) % STRENGTH_ROTATION.length];
  const phase = phaseKeyAt(weeks, week);
  const easy = isEasyWeek(week, weeks);
  let rounds, dur, how;
  if (easy) { rounds = 2; dur = 25; how = t('program.strength.howEasy'); }
  else if (phase === 'intro') { rounds = 2; dur = 25; how = t('program.strength.howIntro'); }
  else if (phase === 'consolidate') { rounds = meta.gentle ? 3 : 4; dur = meta.gentle ? 35 : 45; how = t('program.strength.howConsolidate', { rounds: meta.gentle ? 3 : 4, harder: s.harder }); }
  else { rounds = 3; dur = meta.gentle ? 30 : 35; how = t('program.strength.howBuild'); }
  return {
    type: 'strength', dur, title: s.title,
    desc: t('program.strength.desc', { how, moves: s.moves }),
    rounds,
  };
}

function blockUnit(block, ctx) {
  const { meta, week, weeks, cardioMin, weekCardio } = ctx;
  const total = t('program.block.total', { minutes: weekCardio });
  switch (block) {
    case 'strength':
      return strengthUnit(meta, week, weeks);
    case 'cardio':
      return { type: 'cross', dur: cardioMin, title: t('program.block.cardioTitle', { min: cardioMin }), desc: t('program.block.cardioDesc', { total }) };
    case 'walk':
      return { type: 'walk', dur: cardioMin, title: t('program.block.walkTitle', { min: cardioMin }), desc: t('program.block.walkDesc', { total }) };
    case 'mobility':
      return { type: 'mobility', dur: meta.mobility === 'primary' ? 25 : 15, title: t('program.block.mobilityTitle'), desc: t('program.block.mobilityDesc') };
    default:
      return { type: 'cross', dur: 30, title: t('program.block.otherTitle'), desc: t('program.block.otherDesc') };
  }
}

/* ---- Dated sessions over the whole programme duration ------------------- */
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
      const date = dateOfDow(weekStart, dow);   // ISO weekday inside this 7-day week, from any first day
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

/* ---- Read migration ------------------------------------------------------
   Programme sessions from earlier versions carried `dur`/`desc` instead of the
   plan fields `targetDurationMin`/`description` – session view, calendar,
   Today and .ics therefore showed neither duration nor instructions. When reading, the
   fields are added; nothing is saved in the process. */
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

/**
 * Creates a plan-compatible programme record including sessions. A new programme begins on the
 * person's coming first day of the week (Monday by default); a running one keeps its startDate.
 * `program`: { id, name, programType, weeks, daysPerWeek }
 */
export function createProgramPlan(program, today) {
  const start = nextWeekStart(today);
  const weeks = Math.max(1, program.weeks | 0);
  const planId = uid('plan');
  const units = buildProgramUnits(program, planId, start);
  return {
    id: planId,
    eventId: program.id,        // refers to the goal/programme (not a race)
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
