/* =========================================================================
   exercises.js — exercise library: catalogue (strength/core/mobility/conditioning)
   with animated figures to follow along (exercise-motions.js, motion-player.js),
   step-by-step instructions and filter/search.

   The catalogue + the filter logic are DOM-free and therefore testable; below
   them the view (#/uebungen). No external data, no third-party images.
   ========================================================================= */

import { el, icon, iconSvg, segmented, input, sectionHead, openSheet, toast } from './ui.js';
import { setHeader } from './router.js';
import { exerciseArt } from './exercise-art.js';
import { onAccent } from './contrast.js';
import { exerciseUsage, bumpExerciseUsage } from './storage.js';
import { MOTIONS, motionFor } from './exercise-motions.js';
import { mountPlayer } from './motion-player.js';
import { WORKOUTS, WORKOUT_CATS, workoutIds } from './workouts.js';
import { t, tp, tList, has, hasArea, loadArea } from './i18n.js';
import { DE_TERMS } from './exercise-terms-de.js';

/** Categories (order = display order). */
export const EX_CATEGORIES = [
  { key: 'strength', get label() { return t('exerciseLib.cat.strength'); }, color: '#7c5cff' },
  { key: 'core', get label() { return t('exerciseLib.cat.core'); }, color: '#19b9c9' },
  { key: 'mobility', get label() { return t('exerciseLib.cat.mobility'); }, color: '#2bb673' },
  { key: 'cardio', get label() { return t('exerciseLib.cat.cardio'); }, color: '#f0802a' },
];
export function categoryMeta(key) { return EX_CATEGORIES.find((c) => c.key === key) || EX_CATEGORIES[0]; }
const DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'advanced' };
export function difficultyLabel(n) { return t(`exerciseLib.level.${DIFF[n] || DIFF[1]}`); }

/** Body regions for the additional filter (an exercise can hit several). */
export const EX_REGIONS = [
  { key: 'ruecken', get label() { return t('exerciseLib.region.back'); } },
  { key: 'huefte', get label() { return t('exerciseLib.region.hips'); } },
  { key: 'bauch', get label() { return t('exerciseLib.region.abs'); } },
  { key: 'beine', get label() { return t('exerciseLib.region.legs'); } },
  { key: 'oberkoerper', get label() { return t('exerciseLib.region.upperBody'); } },
];
// Assignment exercise → regions (single source, derived from the muscles worked).
const REGION_BY_ID = {
  squat: ['beine'], lunge: ['beine'], pushup: ['oberkoerper'], deadlift: ['beine', 'ruecken'],
  row: ['ruecken'], overhead_press: ['oberkoerper'], calf_raise: ['beine'],
  plank: ['bauch', 'ruecken'], side_plank: ['bauch'], glute_bridge: ['huefte', 'beine'],
  dead_bug: ['bauch'], side_crunch: ['bauch'],
  hip_flexor_stretch: ['huefte'], hamstring_stretch: ['beine', 'ruecken'], calf_stretch: ['beine'],
  cat_cow: ['ruecken'], chest_opener: ['oberkoerper'],
  split_squat: ['beine'], wall_sit: ['beine'], step_up: ['beine'],
  crunch: ['bauch'], leg_raise: ['bauch'], hollow_hold: ['bauch'],
  superman: ['ruecken'], bird_dog: ['ruecken', 'bauch'],
  child_pose: ['ruecken', 'huefte'], supine_twist: ['ruecken', 'huefte'],
  figure_four: ['huefte'], butterfly_stretch: ['huefte'],
  nordic_hamstring: ['beine'], copenhagen: ['huefte', 'beine'], clamshell: ['huefte'],
  monster_walk: ['huefte', 'beine'], soleus_raise: ['beine'], running_drills: ['beine', 'huefte'],
  pogo_jumps: ['beine'], fifa11: ['beine', 'huefte'],
  // since 3.22.0
  goblet_squat: ['beine'], sumo_squat: ['beine', 'huefte'], reverse_lunge: ['beine'], side_lunge: ['beine', 'huefte'],
  single_leg_deadlift: ['beine', 'ruecken'], hip_thrust: ['huefte', 'beine'], single_leg_bridge: ['huefte', 'beine'],
  kettlebell_swing: ['huefte', 'beine', 'ruecken'], jump_squat: ['beine'], good_morning: ['ruecken', 'huefte'],
  tibialis_raise: ['beine'], step_down: ['beine'], cossack_squat: ['beine', 'huefte'], farmers_carry: ['oberkoerper', 'bauch'],
  wall_ball: ['beine', 'oberkoerper'], thruster: ['beine', 'oberkoerper'], incline_pushup: ['oberkoerper'],
  knee_pushup: ['oberkoerper'], pike_pushup: ['oberkoerper'], bench_dip: ['oberkoerper'], biceps_curl: ['oberkoerper'],
  triceps_extension: ['oberkoerper'], lateral_raise: ['oberkoerper'], band_pull_apart: ['oberkoerper', 'ruecken'],
  pullup: ['oberkoerper', 'ruecken'], inverted_row: ['oberkoerper', 'ruecken'], single_arm_row: ['oberkoerper', 'ruecken'],
  side_lying_leg_raise: ['huefte'], donkey_kick: ['huefte'],
  bicycle_crunch: ['bauch'], russian_twist: ['bauch'], reverse_crunch: ['bauch'], shoulder_tap: ['bauch', 'oberkoerper'],
  bear_plank: ['bauch'], v_up: ['bauch'], flutter_kicks: ['bauch'], glute_bridge_march: ['huefte', 'bauch'],
  worlds_greatest_stretch: ['huefte', 'ruecken'], downward_dog: ['beine', 'ruecken'], cobra: ['ruecken', 'bauch'],
  quad_stretch: ['beine', 'huefte'], pigeon_pose: ['huefte'], leg_swings: ['huefte', 'beine'], arm_circles: ['oberkoerper'],
  ankle_rocks: ['beine'], neck_stretch: ['oberkoerper'], side_bend_stretch: ['ruecken', 'bauch'],
  inchworm: ['beine', 'bauch', 'oberkoerper'], deep_squat_hold: ['huefte', 'beine'],
  jumping_jack: ['beine'], high_knees: ['beine'], butt_kicks: ['beine'], burpee: ['beine', 'oberkoerper', 'bauch'],
  mountain_climber: ['bauch', 'beine'], skater_jump: ['beine', 'huefte'], bear_crawl: ['bauch', 'oberkoerper'],
};

/** Prevention exercises for running and football (hamstrings, adductors, hips,
    calf/Achilles, ankle) – suggestions for football appointments. */
export const PREVENTION_IDS = ['fifa11', 'nordic_hamstring', 'copenhagen', 'clamshell', 'monster_walk', 'soleus_raise', 'running_drills', 'pogo_jumps'];

/** Regions of an exercise (empty if not assigned). */
export function exerciseRegions(id) { return REGION_BY_ID[id] || []; }

/* The catalogue. Language-neutral data live here, the texts in the catalogs:
   name and search terms in ui.json (exerciseNames.<id>, exerciseAliases.<id> as "a|b"),
   muscles, equipment, steps, tip, caution and progression in the lazily loaded area
   locales/<lang>/exercises.json – call loadExerciseTexts() before showing those.
   Row: [id, category, difficulty, flags] – 'h': counts time instead of reps although the
   motion has no hold, 'p': prevention exercise. `art` (figure in exercise-art.js) = id. */
const ROWS = [
  ['squat', 'strength', 1],
  ['lunge', 'strength', 2],
  ['pushup', 'strength', 2],
  ['deadlift', 'strength', 3],
  ['row', 'strength', 2],
  ['overhead_press', 'strength', 2],
  ['calf_raise', 'strength', 1],
  ['plank', 'core', 1],
  ['side_plank', 'core', 2],
  ['glute_bridge', 'core', 1],
  ['dead_bug', 'core', 2],
  ['side_crunch', 'core', 2],
  ['hip_flexor_stretch', 'mobility', 1],
  ['hamstring_stretch', 'mobility', 1],
  ['calf_stretch', 'mobility', 1],
  ['cat_cow', 'mobility', 1],
  ['chest_opener', 'mobility', 1],
  ['split_squat', 'strength', 3],
  ['wall_sit', 'strength', 1],
  ['step_up', 'strength', 2],
  ['crunch', 'core', 1],
  ['leg_raise', 'core', 2],
  ['hollow_hold', 'core', 2],
  ['superman', 'core', 1],
  ['bird_dog', 'core', 1],
  ['child_pose', 'mobility', 1],
  ['supine_twist', 'mobility', 1],
  ['figure_four', 'mobility', 1],
  ['butterfly_stretch', 'mobility', 1],
  ['fifa11', 'mobility', 1, 'p'],
  ['nordic_hamstring', 'strength', 3, 'p'],
  ['copenhagen', 'core', 3, 'p'],
  ['clamshell', 'strength', 1, 'p'],
  ['monster_walk', 'strength', 2, 'p'],
  ['soleus_raise', 'strength', 2, 'p'],
  ['running_drills', 'mobility', 2, 'p'],
  ['pogo_jumps', 'strength', 2, 'p'],
  ['goblet_squat', 'strength', 2],
  ['sumo_squat', 'strength', 1],
  ['reverse_lunge', 'strength', 1],
  ['side_lunge', 'strength', 2],
  ['single_leg_deadlift', 'strength', 3],
  ['hip_thrust', 'strength', 2],
  ['single_leg_bridge', 'strength', 2],
  ['kettlebell_swing', 'strength', 3],
  ['jump_squat', 'strength', 2],
  ['good_morning', 'strength', 2],
  ['tibialis_raise', 'strength', 1, 'p'],
  ['step_down', 'strength', 2, 'p'],
  ['cossack_squat', 'strength', 3],
  ['farmers_carry', 'strength', 2],
  ['wall_ball', 'strength', 3],
  ['thruster', 'strength', 3],
  ['incline_pushup', 'strength', 1],
  ['knee_pushup', 'strength', 1],
  ['pike_pushup', 'strength', 3],
  ['bench_dip', 'strength', 2],
  ['biceps_curl', 'strength', 1],
  ['triceps_extension', 'strength', 2],
  ['lateral_raise', 'strength', 1],
  ['band_pull_apart', 'strength', 1],
  ['pullup', 'strength', 3],
  ['inverted_row', 'strength', 2],
  ['single_arm_row', 'strength', 2],
  ['side_lying_leg_raise', 'strength', 1, 'p'],
  ['donkey_kick', 'strength', 1],
  ['bicycle_crunch', 'core', 2],
  ['russian_twist', 'core', 2],
  ['reverse_crunch', 'core', 2],
  ['shoulder_tap', 'core', 2],
  ['bear_plank', 'core', 2],
  ['v_up', 'core', 3],
  ['flutter_kicks', 'core', 2],
  ['glute_bridge_march', 'core', 2],
  ['worlds_greatest_stretch', 'mobility', 2],
  ['downward_dog', 'mobility', 1],
  ['cobra', 'mobility', 1],
  ['quad_stretch', 'mobility', 1],
  ['pigeon_pose', 'mobility', 2],
  ['leg_swings', 'mobility', 1],
  ['arm_circles', 'mobility', 1],
  ['ankle_rocks', 'mobility', 1, 'p'],
  ['neck_stretch', 'mobility', 1],
  ['side_bend_stretch', 'mobility', 1],
  ['inchworm', 'mobility', 2],
  ['deep_squat_hold', 'mobility', 2],
  ['jumping_jack', 'cardio', 1],
  ['high_knees', 'cardio', 2],
  ['butt_kicks', 'cardio', 1],
  ['burpee', 'cardio', 3],
  ['mountain_climber', 'cardio', 2],
  ['skater_jump', 'cardio', 2],
  ['bear_crawl', 'cardio', 2],
];

const textOr = (key, fallback) => (has(key) ? t(key) : fallback);
function exerciseOf([id, category, difficulty, flags = '']) {
  const m = MOTIONS[id];
  const base = `exercises.${id}`;
  return {
    id, category, difficulty, art: id,
    hold: flags.includes('h') || !!(m && m.holdS != null),
    ...(flags.includes('p') ? { prevention: true } : {}),
    get name() { return t(`exerciseNames.${id}`); },
    get aliases() { return has(`exerciseAliases.${id}`) ? t(`exerciseAliases.${id}`).split('|') : []; },
    get muscles() { return tList(`${base}.muscles`) || []; },
    get equipment() { return textOr(`${base}.equipment`, ''); },
    get steps() { return tList(`${base}.steps`) || []; },
    get tip() { return textOr(`${base}.tip`, ''); },
    get caution() { return textOr(`${base}.caution`, ''); },
    get progression() { return textOr(`${base}.progression`, ''); },
    /** Short equipment name for workout cards; empty when none is needed. */
    get gear() { return textOr(`${base}.gear`, ''); },
  };
}
export const EXERCISES = ROWS.map(exerciseOf);

/** Loads muscles, equipment, steps and tips of all exercises (lazy catalog area). */
let textsLoading = null;
export function loadExerciseTexts() { return (textsLoading ||= loadArea('exercises')); }

/** Find an exercise by id. */
export function findExercise(id) { return EXERCISES.find((e) => e.id === id) || null; }

/** Filters by category, body region ('all' = all) and free text (name/muscles). */
export function filterExercises(list = EXERCISES, { category = 'all', region = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter((e) => {
    if (category !== 'all' && e.category !== category) return false;
    if (region !== 'all' && !exerciseRegions(e.id).includes(region)) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q)
      || (e.aliases || []).some((a) => a.toLowerCase().includes(q))
      || (e.muscles || []).some((m) => m.toLowerCase().includes(q))
      || categoryMeta(e.category).label.toLowerCase().includes(q);
  });
}

/** Terms under which an exercise can occur in a text (name without the parenthetical + aliases). */
function termsOf(e) {
  return [...new Set([e.name.replace(/\s*\(.*\)\s*$/, ''), ...(e.aliases || []), ...(DE_TERMS[e.id] || [])])].filter((s) => s.length >= 4);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exercises that a text mentions (e.g. the description of a strength session), in the
 * order of their appearance. A term only counts at the start of a word – "Sprungkniebeuge"
 * (jump squat) is not a "Kniebeuge" (squat).
 */
export function exercisesInText(text = '') {
  return exerciseMentions(text).map((h) => h.e);
}

/** Like exercisesInText, with the position of the match: [{ e, first }] – first = index of the first mention. */
export function exerciseMentions(text = '') {
  const hay = String(text || '');
  if (!hay.trim()) return [];
  const spans = [];
  for (const e of EXERCISES) {
    for (const term of termsOf(e)) {
      for (const m of hay.matchAll(new RegExp(`(?<![\\p{L}])${escapeRe(term)}`, 'giu'))) {
        spans.push({ e, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  // A term inside a longer term of another exercise does not count: "squat" in "Front squat",
  // "Kreuzheben" (deadlift) in "einbeiniges Kreuzheben" (single-leg deadlift).
  const kept = spans.filter((s) => !spans.some((o) => o.e !== s.e && o.start <= s.start && o.end >= s.end
    && o.end - o.start > s.end - s.start));
  const firstOf = new Map();
  for (const s of kept) if (!firstOf.has(s.e) || s.start < firstOf.get(s.e)) firstOf.set(s.e, s.start);
  const hits = EXERCISES.filter((e) => firstOf.has(e)).map((e) => ({ e, first: firstOf.get(e) }));
  // With the same match position ("Rumänisches Kreuzheben" vs. "Kreuzheben", i.e. Romanian deadlift
  // vs. deadlift) the first one in the catalogue wins.
  return hits.sort((x, y) => x.first - y.first);
}

/** Exercises that fit a session type (for suggestions within the session).
    Football appointments get the FIFA 11+ warm-up and the prevention exercises. */
export function suggestedExercisesFor(type) {
  if (type === 'cross_football' || type === 'match') return PREVENTION_IDS.map(findExercise).filter(Boolean);
  if (type === 'mobility' || type === 'recovery') return MOBILITY_CORE.map(findExercise).filter(Boolean);
  if (type === 'strength' || type === 'gym') return STRENGTH_CORE.map(findExercise).filter(Boolean);
  return [];
}

/* Since the large catalogue (3.22.0) a session no longer suggests everything but a selection of
   the basic exercises – plus whatever its description mentions (exercisesInText). */
const STRENGTH_CORE = ['squat', 'lunge', 'pushup', 'deadlift', 'row', 'overhead_press', 'calf_raise', 'glute_bridge',
  'step_up', 'split_squat', 'single_leg_deadlift', 'plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist'];
const MOBILITY_CORE = ['cat_cow', 'hip_flexor_stretch', 'hamstring_stretch', 'calf_stretch', 'chest_opener', 'child_pose',
  'supine_twist', 'figure_four', 'quad_stretch', 'worlds_greatest_stretch', 'downward_dog', 'pigeon_pose'];

/**
 * Exercises for a session: first what its description mentions, then the suggestions
 * for the session type (sorted by usage). Without duplicates.
 */
export function exercisesForUnit(unit = {}, usage = {}) {
  const named = exercisesInText(`${unit.title || ''} · ${unit.description || ''}`);
  const seen = new Set(named.map((e) => e.id));
  const rest = sortByUsage(suggestedExercisesFor(unit.type), usage).filter((e) => !seen.has(e.id));
  return { named, suggested: rest, all: [...named, ...rest] };
}

/** Sorts an exercise list in descending order of usage frequency (usage: { id: count }). */
export function sortByUsage(list, usage = {}) {
  return list.slice().sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name));
}

/* --------------------------------- View --------------------------------- */

/** Equipment of a workout from its exercises ("no equipment" if none is needed). */
function workoutGear(w) {
  const gear = new Set();
  for (const id of workoutIds(w)) {
    const eq = (findExercise(id) || {}).gear;
    if (eq) gear.add(eq);
  }
  const list = [...gear];
  return list.length ? list.slice(0, 2).join(' · ') + (list.length > 2 ? ' …' : '') : t('exerciseLib.noGear');
}

/** Cover image per workout: the first exercise that no other workout shows yet. */
let covers = null;
function coverOf(w) {
  if (!covers) {
    covers = new Map();
    const used = new Set();
    for (const x of WORKOUTS) {
      const ids = workoutIds(x);
      const id = ids.find((i) => !used.has(i)) || ids[0];
      used.add(id); covers.set(x.id, id);
    }
  }
  return covers.get(w.id) || workoutIds(w)[0];
}

/** Workouts as a catalogue: search, filters, tiles; tapping opens the session (workout-show.js). */
function renderWorkouts(view) {
  const search = input({ type: 'search', placeholder: t('exerciseLib.searchWorkouts'), 'aria-label': t('exerciseLib.searchWorkoutsAria'), value: uiState.woQuery });
  search.addEventListener('input', () => { uiState.woQuery = search.value; draw(); });
  view.appendChild(el('div', { class: 'field mt-2' }, [search]));
  const chips = el('div', { class: 'mt-2', style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' } });
  const paintChips = () => {
    chips.innerHTML = '';
    for (const c of [{ key: 'all', label: t('common.all') }, ...WORKOUT_CATS]) {
      chips.appendChild(el('button', {
        class: 'chip' + (uiState.woCat === c.key ? ' chip--accent' : ''), style: { flex: '0 0 auto', cursor: 'pointer' }, text: c.label,
        onclick: () => { uiState.woCat = c.key; paintChips(); draw(); },
      }));
    }
  };
  paintChips();
  view.appendChild(chips);
  const grid = el('div', { class: 'wo-grid mt-4' });
  view.appendChild(grid);
  const minutes = new Map();
  function draw() {
    grid.innerHTML = '';
    const q = uiState.woQuery.trim().toLowerCase();
    const list = WORKOUTS.filter((w) => (uiState.woCat === 'all' || w.cat === uiState.woCat)
      && (!q || [w.title, w.subtitle, ...workoutIds(w).map((id) => (findExercise(id) || {}).name || '')].some((s) => s.toLowerCase().includes(q))));
    if (!list.length) { grid.appendChild(el('div', { class: 'empty', text: t('exerciseLib.noWorkoutMatch') })); return; }
    for (const w of list) {
      const first = coverOf(w);
      const cm = categoryMeta((findExercise(first) || {}).category);
      const min = el('span', { class: 'wo-card__min', text: minutes.get(w.id) || '' });
      grid.appendChild(el('button', { class: `wo-card wo-card--${w.style}`, type: 'button', dataset: { id: w.id }, onclick: () => playWorkout(w) }, [
        el('span', { class: 'wo-card__art', html: exerciseArt(first, { color: cm.color }) }),
        el('span', { class: 'wo-card__title', text: w.title }),
        el('span', { class: 'wo-card__sub', text: w.subtitle }),
        el('span', { class: 'wo-card__meta' }, [icon('play'), min, el('span', { text: ` · ${tp('exerciseLib.exerciseCount', w.items.length)} · ${difficultyLabel(w.level)}` })]),
        el('span', { class: 'wo-card__gear', text: workoutGear(w) }),
      ]));
    }
  }
  draw();
  // Duration from the real timeline – loaded afterwards, show-program.js needs this catalogue.
  import('./show-program.js').then(({ programForWorkout, buildShow }) => {
    for (const w of WORKOUTS) minutes.set(w.id, `≈ ${Math.max(1, Math.round(buildShow(programForWorkout(w)).total / 60))} min`);
    draw();
  }).catch(() => {});
}

async function playWorkout(w) {
  const [{ programForWorkout }, { openShow }] = await Promise.all([import('./show-program.js'), import('./workout-show.js')]);
  openShow(programForWorkout(w));
}
let uiState = { tab: 'exercises', category: 'all', region: 'all', query: '', woCat: 'all', woQuery: '' };
function usageLabel(n) { return n > 0 ? t('exerciseLib.usedTimes', { n }) : t('exerciseLib.notUsedYet'); }

export function render(view) {
  setHeader({ title: t('nav.exercises'), subtitle: t('exerciseLib.subtitle', { n: EXERCISES.length, w: WORKOUTS.length }) });
  view.innerHTML = '';
  // Muscles, equipment and steps come with the exercises area; draw again once it is there.
  if (!hasArea('exercises')) {
    loadExerciseTexts().then(() => { if (hasArea('exercises') && view.isConnected !== false && /^#\/uebungen/.test(location.hash)) render(view); });
  }
  // Two catalogues: single exercises and ready-made workouts (in one go, with music).
  view.appendChild(el('div', { class: 'mt-2' }, [segmented([{ value: 'exercises', label: t('exerciseLib.tabExercises', { n: EXERCISES.length }) }, { value: 'workouts', label: t('exerciseLib.tabWorkouts', { n: WORKOUTS.length }) }],
    uiState.tab, (v) => { uiState.tab = v; render(view); }, { label: t('exerciseLib.catalog') })]));
  if (uiState.tab === 'workouts') { renderWorkouts(view); return; }

  const search = input({ type: 'search', placeholder: t('exerciseLib.searchExercises'), 'aria-label': t('exerciseLib.searchExercisesAria'), value: uiState.query });
  search.addEventListener('input', () => { uiState.query = search.value; drawGrid(); });
  view.appendChild(el('div', { class: 'field mt-2' }, [search]));

  const cats = [{ value: 'all', label: t('common.all') }, ...EX_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))];
  // Five categories do not fit side by side on narrow phones – the bar then scrolls sideways.
  view.appendChild(el('div', { class: 'mt-2', style: { overflowX: 'auto', paddingBottom: '2px' } }, [
    segmented(cats, uiState.category, (v) => { uiState.category = v; drawGrid(); }, { label: t('exerciseLib.category') }),
  ]));

  // Additional body-region filter (chips, horizontally scrollable).
  const regionRow = el('div', { class: 'mt-2', style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' } });
  const regionChips = [{ key: 'all', label: t('exerciseLib.allRegions') }, ...EX_REGIONS];
  const paintRegions = () => {
    regionRow.innerHTML = '';
    regionChips.forEach((r) => {
      regionRow.appendChild(el('button', {
        class: 'chip' + (uiState.region === r.key ? ' chip--accent' : ''),
        style: { flex: '0 0 auto', cursor: 'pointer' }, text: r.label,
        onclick: () => { uiState.region = r.key; paintRegions(); drawGrid(); },
      }));
    });
  };
  paintRegions();
  view.appendChild(regionRow);

  const grid = el('div', { class: 'ex-grid mt-4' });
  view.appendChild(grid);

  function drawGrid() {
    grid.innerHTML = '';
    const usage = exerciseUsage();
    const list = filterExercises(EXERCISES, uiState);
    if (!list.length) { grid.appendChild(el('p', { class: 'dim center', text: t('exerciseLib.noExerciseMatch') })); return; }
    list.forEach((e) => grid.appendChild(exerciseCard(e, usage[e.id] || 0)));
  }
  drawGrid();

  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: t('exerciseLib.disclaimer') }));
}

function exerciseCard(e, count = 0) {
  const cm = categoryMeta(e.category);
  return el('button', { class: 'ex-card', onclick: () => openDetail(e) }, [
    el('div', { class: 'ex-card__art', html: exerciseArt(e.art, { color: cm.color }) }),
    el('div', { class: 'ex-card__name', text: e.name }),
    el('div', { class: 'ex-card__meta' }, [
      el('span', { class: 'chip', style: { background: 'var(--surface-2)' }, text: cm.label }),
      el('span', { class: 'dim', style: { fontSize: '.72rem' }, text: difficultyLabel(e.difficulty) }),
      count > 0 ? el('span', { class: 'chip', title: t('exerciseLib.usedTimes', { n: count }), style: { background: cm.color, color: onAccent(cm.color), fontSize: '.72rem' }, text: `${count}×` }) : null,
    ]),
  ]);
}

function openDetail(e) {
  const cm = categoryMeta(e.category);
  const m = motionFor(e.id);
  const usedEl = el('span', { class: 'chip', style: { background: 'var(--surface-2)' }, text: usageLabel(exerciseUsage()[e.id] || 0) });
  const count = () => { bumpExerciseUsage([e.id]); usedEl.textContent = usageLabel(exerciseUsage()[e.id] || 0); };
  const doneBtn = el('button', {
    class: 'btn btn--soft btn--block mt-3',
    onclick: () => { count(); toast(t('exerciseLib.countedDone'), 'good'); },
  }, [icon('check'), t('exerciseLib.done')]);
  // Follow-along player: preview in a loop, "Follow along" leads through sets, repetitions and breaks.
  const playerHost = el('div', { class: 'ex-detail__player' });
  const body = el('div', {}, [
    m ? playerHost : el('div', { class: 'ex-detail__art', html: exerciseArt(e.art, { color: cm.color }) }),
    el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', marginTop: '6px' } }, [
      el('span', { class: 'chip', style: { background: cm.color, color: onAccent(cm.color) }, text: cm.label }),
      el('span', { class: 'chip', text: difficultyLabel(e.difficulty) }),
      el('span', { class: 'chip', text: '🛠 ' + e.equipment }),
      usedEl,
    ]),
    el('div', { class: 'dim mt-3', style: { fontSize: '.82rem' }, text: t('exerciseLib.muscles', { list: (e.muscles || []).join(', ') }) }),
    sectionHead(t('exerciseLib.howTo')),
    el('ol', { class: 'ex-steps' }, (e.steps || []).map((s) => el('li', { text: s }))),
    el('div', { class: 'card card--flat mt-3 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: e.tip }),
    ]),
    e.progression ? el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('arrowRight'), style: { color: 'var(--good-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('exerciseLib.progression', { text: e.progression }) }),
    ]) : null,
    e.caution ? el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start', borderLeft: '3px solid var(--warn)' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('exerciseLib.caution', { text: e.caution }) }),
    ]) : null,
    doneBtn,
  ]);
  const player = m ? mountPlayer(playerHost, e, m, { color: cm.color, onDone: () => { count(); toast(t('exerciseLib.finishedCounted'), 'good'); } }) : null;
  openSheet({ title: e.name, body, onClose: () => { if (player) player.stop(); } });
}

/** Opens the detail sheet of an exercise by id (e.g. from a training session). */
export function openExercise(id) { const e = findExercise(id); if (e) loadExerciseTexts().then(() => openDetail(e)); }
