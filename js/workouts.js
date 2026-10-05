import { t } from './i18n.js';
/* =========================================================================
   workouts.js — ready-made workouts to go through (like a video to follow along).

   Each workout is a sequence of exercises from the library with fixed
   work and rest time (interval), rounds and music style. One-sided exercises
   ("per side") get their time per side – hence often somewhat shorter there.
   The duration is computed by show-program.js from the actual timeline.
   ========================================================================= */

export const WORKOUTS = [
  {
    id: 'ganzkoerper', cat: 'kraft', get title() { return t('workoutCatalog.ganzkoerper.title'); }, get subtitle() { return t('workoutCatalog.ganzkoerper.subtitle'); },
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['squat', 'pushup', 'reverse_lunge', 'glute_bridge', 'shoulder_tap', 'sumo_squat', 'plank', 'mountain_climber'],
  },
  {
    id: 'po-beine', cat: 'kraft', get title() { return t('workoutCatalog.po-beine.title'); }, get subtitle() { return t('workoutCatalog.po-beine.subtitle'); },
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['squat', 'reverse_lunge', 'glute_bridge', 'sumo_squat', { id: 'donkey_kick', work: 30 }, { id: 'side_lying_leg_raise', work: 30 }, { id: 'single_leg_bridge', work: 30 }, 'calf_raise'],
  },
  {
    id: 'bauch', cat: 'rumpf', get title() { return t('workoutCatalog.bauch.title'); }, get subtitle() { return t('workoutCatalog.bauch.subtitle'); },
    style: 'groove', level: 2, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['dead_bug', 'bicycle_crunch', 'plank', 'reverse_crunch', { id: 'side_plank', work: 30 }, 'russian_twist', 'bird_dog', { id: 'hollow_hold', work: 30 }],
  },
  {
    id: 'hiit', cat: 'kondition', get title() { return t('workoutCatalog.hiit.title'); }, get subtitle() { return t('workoutCatalog.hiit.subtitle'); },
    style: 'hiit', level: 3, work: 30, rest: 15, rounds: 3, roundRest: 45,
    items: ['jumping_jack', 'high_knees', 'jump_squat', 'mountain_climber', 'skater_jump', 'burpee'],
  },
  {
    id: 'aufwaermen', cat: 'laufen', get title() { return t('workoutCatalog.aufwaermen.title'); }, get subtitle() { return t('workoutCatalog.aufwaermen.subtitle'); },
    style: 'power', level: 1, work: 30, rest: 10, rounds: 1,
    items: ['arm_circles', { id: 'leg_swings', work: 20 }, 'high_knees', 'butt_kicks', 'inchworm', 'worlds_greatest_stretch', 'jumping_jack'],
  },
  {
    id: 'laeufer-kraft', cat: 'laufen', get title() { return t('workoutCatalog.laeufer-kraft.title'); }, get subtitle() { return t('workoutCatalog.laeufer-kraft.subtitle'); },
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: [{ id: 'single_leg_deadlift', work: 30 }, 'calf_raise', { id: 'clamshell', work: 30 }, 'reverse_lunge', { id: 'side_plank', work: 25 }, 'glute_bridge_march', 'tibialis_raise'],
  },
  {
    id: 'mobility-morgen', cat: 'beweglichkeit', get title() { return t('workoutCatalog.mobility-morgen.title'); }, get subtitle() { return t('workoutCatalog.mobility-morgen.subtitle'); },
    style: 'flow', level: 1, work: 45, rest: 10, rounds: 1,
    items: ['cat_cow', 'child_pose', 'cobra', 'downward_dog', 'worlds_greatest_stretch', 'deep_squat_hold', 'side_bend_stretch'],
  },
  {
    id: 'dehnen-laufen', cat: 'beweglichkeit', get title() { return t('workoutCatalog.dehnen-laufen.title'); }, get subtitle() { return t('workoutCatalog.dehnen-laufen.subtitle'); },
    style: 'flow', level: 1, work: 40, rest: 8, rounds: 1,
    items: [{ id: 'calf_stretch', work: 30 }, { id: 'hamstring_stretch', work: 30 }, { id: 'quad_stretch', work: 30 }, { id: 'hip_flexor_stretch', work: 30 }, { id: 'figure_four', work: 30 }, 'butterfly_stretch', 'child_pose'],
  },
  {
    id: 'ruecken', cat: 'beweglichkeit', get title() { return t('workoutCatalog.ruecken.title'); }, get subtitle() { return t('workoutCatalog.ruecken.subtitle'); },
    style: 'flow', level: 1, work: 40, rest: 12, rounds: 1,
    items: ['cat_cow', 'bird_dog', 'glute_bridge', 'superman', { id: 'supine_twist', work: 30 }, 'cobra', 'child_pose'],
  },
  // ---- Strength ----
  {
    id: 'oberkoerper', cat: 'kraft', get title() { return t('workoutCatalog.oberkoerper.title'); }, get subtitle() { return t('workoutCatalog.oberkoerper.subtitle'); },
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['incline_pushup', 'pushup', 'bench_dip', 'shoulder_tap', 'superman', 'plank'],
  },
  {
    id: 'hanteln', cat: 'kraft', get title() { return t('workoutCatalog.hanteln.title'); }, get subtitle() { return t('workoutCatalog.hanteln.subtitle'); },
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['goblet_squat', 'deadlift', 'row', 'overhead_press', 'reverse_lunge', 'biceps_curl', 'triceps_extension', 'lateral_raise'],
  },
  {
    id: 'kettlebell', cat: 'kraft', get title() { return t('workoutCatalog.kettlebell.title'); }, get subtitle() { return t('workoutCatalog.kettlebell.subtitle'); },
    style: 'power', level: 3, work: 40, rest: 20, rounds: 3, roundRest: 60,
    items: ['kettlebell_swing', 'goblet_squat', 'deadlift', { id: 'single_leg_deadlift', work: 30 }, 'farmers_carry'],
  },
  {
    id: 'hyrox', cat: 'kraft', get title() { return t('workoutCatalog.hyrox.title'); }, get subtitle() { return t('workoutCatalog.hyrox.subtitle'); },
    style: 'hiit', level: 3, work: 45, rest: 15, rounds: 3, roundRest: 60,
    items: ['wall_ball', 'kettlebell_swing', 'lunge', 'burpee', 'farmers_carry', 'thruster'],
  },
  {
    id: 'beine-power', cat: 'kraft', get title() { return t('workoutCatalog.beine-power.title'); }, get subtitle() { return t('workoutCatalog.beine-power.subtitle'); },
    style: 'power', level: 3, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['jump_squat', 'reverse_lunge', 'side_lunge', 'cossack_squat', 'wall_sit', 'calf_raise', 'step_up'],
  },
  {
    id: 'po-band', cat: 'kraft', get title() { return t('workoutCatalog.po-band.title'); }, get subtitle() { return t('workoutCatalog.po-band.subtitle'); },
    style: 'power', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['monster_walk', { id: 'clamshell', work: 30 }, 'glute_bridge', { id: 'donkey_kick', work: 30 }, { id: 'side_lying_leg_raise', work: 30 }, 'sumo_squat'],
  },
  // ---- Core ----
  {
    id: 'bauch-7', cat: 'rumpf', get title() { return t('workoutCatalog.bauch-7.title'); }, get subtitle() { return t('workoutCatalog.bauch-7.subtitle'); },
    style: 'groove', level: 2, work: 30, rest: 10, rounds: 2, roundRest: 30,
    items: ['crunch', 'bicycle_crunch', 'reverse_crunch', 'flutter_kicks', 'leg_raise', 'plank'],
  },
  {
    id: 'rumpf-sanft', cat: 'rumpf', get title() { return t('workoutCatalog.rumpf-sanft.title'); }, get subtitle() { return t('workoutCatalog.rumpf-sanft.subtitle'); },
    style: 'groove', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['dead_bug', 'bird_dog', 'glute_bridge_march', 'bear_plank', { id: 'side_plank', work: 25 }, { id: 'hollow_hold', work: 25 }],
  },
  // ---- Conditioning ----
  {
    id: 'tabata', cat: 'kondition', get title() { return t('workoutCatalog.tabata.title'); }, get subtitle() { return t('workoutCatalog.tabata.subtitle'); },
    style: 'hiit', level: 3, work: 20, rest: 10, rounds: 4, roundRest: 30,
    items: ['jumping_jack', 'mountain_climber', 'jump_squat', 'high_knees'],
  },
  {
    id: 'cardio-leise', cat: 'kondition', get title() { return t('workoutCatalog.cardio-leise.title'); }, get subtitle() { return t('workoutCatalog.cardio-leise.subtitle'); },
    style: 'hiit', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 45,
    items: ['squat', 'reverse_lunge', 'mountain_climber', 'bear_crawl', 'inchworm', 'shoulder_tap', 'side_lunge'],
  },
  // ---- Mobility ----
  {
    id: 'huefte', cat: 'beweglichkeit', get title() { return t('workoutCatalog.huefte.title'); }, get subtitle() { return t('workoutCatalog.huefte.subtitle'); },
    style: 'flow', level: 1, work: 45, rest: 10, rounds: 1,
    items: [{ id: 'hip_flexor_stretch', work: 40 }, { id: 'pigeon_pose', work: 40 }, { id: 'figure_four', work: 40 }, 'butterfly_stretch', 'deep_squat_hold', 'worlds_greatest_stretch'],
  },
  {
    id: 'schulter-nacken', cat: 'beweglichkeit', get title() { return t('workoutCatalog.schulter-nacken.title'); }, get subtitle() { return t('workoutCatalog.schulter-nacken.subtitle'); },
    style: 'flow', level: 1, work: 40, rest: 10, rounds: 1,
    items: [{ id: 'neck_stretch', work: 30 }, 'arm_circles', 'chest_opener', 'side_bend_stretch', 'cat_cow', 'child_pose'],
  },
  {
    id: 'abend', cat: 'beweglichkeit', get title() { return t('workoutCatalog.abend.title'); }, get subtitle() { return t('workoutCatalog.abend.subtitle'); },
    style: 'flow', level: 1, work: 50, rest: 10, rounds: 1,
    items: ['cat_cow', 'child_pose', { id: 'supine_twist', work: 40 }, { id: 'figure_four', work: 40 }, 'butterfly_stretch', { id: 'hamstring_stretch', work: 40 }],
  },
  // ---- Running & football ----
  {
    id: 'lauf-abc', cat: 'laufen', get title() { return t('workoutCatalog.lauf-abc.title'); }, get subtitle() { return t('workoutCatalog.lauf-abc.subtitle'); },
    style: 'power', level: 2, work: 30, rest: 10, rounds: 1,
    items: [{ id: 'leg_swings', work: 20 }, { id: 'ankle_rocks', work: 20 }, 'running_drills', 'high_knees', 'butt_kicks', 'pogo_jumps', 'skater_jump'],
  },
  {
    id: 'fuesse-waden', cat: 'laufen', get title() { return t('workoutCatalog.fuesse-waden.title'); }, get subtitle() { return t('workoutCatalog.fuesse-waden.subtitle'); },
    style: 'power', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['calf_raise', 'soleus_raise', 'tibialis_raise', { id: 'ankle_rocks', work: 25 }, 'pogo_jumps', { id: 'calf_stretch', work: 30 }],
  },
  {
    id: 'fussball-praevention', cat: 'laufen', get title() { return t('workoutCatalog.fussball-praevention.title'); }, get subtitle() { return t('workoutCatalog.fussball-praevention.subtitle'); },
    style: 'power', level: 3, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['nordic_hamstring', { id: 'copenhagen', work: 25 }, { id: 'clamshell', work: 30 }, 'monster_walk', { id: 'side_plank', work: 25 }, { id: 'single_leg_deadlift', work: 30 }],
  },
];

export function findWorkout(id) { return WORKOUTS.find((w) => w.id === id) || null; }

/** Filter of the workout catalogue. */
export const WORKOUT_CATS = [
  { key: 'kraft', get label() { return t('workoutCatalog.cats.kraft'); } },
  { key: 'rumpf', get label() { return t('workoutCatalog.cats.rumpf'); } },
  { key: 'beweglichkeit', get label() { return t('workoutCatalog.cats.beweglichkeit'); } },
  { key: 'kondition', get label() { return t('workoutCatalog.cats.kondition'); } },
  { key: 'laufen', get label() { return t('workoutCatalog.cats.laufen'); } },
];

/** Exercise IDs of a workout. */
export function workoutIds(w) { return w.items.map((x) => (typeof x === 'string' ? x : x.id)); }
