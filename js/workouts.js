/* =========================================================================
   workouts.js — fertige Workouts zum Durchmachen (wie ein Video zum Mitmachen).

   Jedes Workout ist eine Folge von Übungen aus der Bibliothek mit fester
   Arbeits- und Pausenzeit (Intervall), Runden und Musikstil. Einseitige Übungen
   („je Seite“) bekommen ihre Zeit je Seite – deshalb dort oft etwas kürzer.
   Die Dauer rechnet show-program.js aus der tatsächlichen Zeitleiste.
   ========================================================================= */

export const WORKOUTS = [
  {
    id: 'ganzkoerper', cat: 'kraft', title: 'Ganzkörper ohne Geräte', subtitle: 'Kraft für Beine, Po, Oberkörper und Rumpf',
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['squat', 'pushup', 'reverse_lunge', 'glute_bridge', 'shoulder_tap', 'sumo_squat', 'plank', 'mountain_climber'],
  },
  {
    id: 'po-beine', cat: 'kraft', title: 'Po & Beine', subtitle: 'Kniebeugen, Ausfallschritte, Brücke – ohne Geräte',
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['squat', 'reverse_lunge', 'glute_bridge', 'sumo_squat', { id: 'donkey_kick', work: 30 }, { id: 'side_lying_leg_raise', work: 30 }, { id: 'single_leg_bridge', work: 30 }, 'calf_raise'],
  },
  {
    id: 'bauch', cat: 'rumpf', title: 'Bauch & Rumpf', subtitle: 'Stabil in der Mitte – ruhig und kontrolliert',
    style: 'groove', level: 2, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['dead_bug', 'bicycle_crunch', 'plank', 'reverse_crunch', { id: 'side_plank', work: 30 }, 'russian_twist', 'bird_dog', { id: 'hollow_hold', work: 30 }],
  },
  {
    id: 'hiit', cat: 'kondition', title: 'HIIT – kurz und knackig', subtitle: 'Puls hoch: 30 Sekunden Gas, 15 Sekunden Pause',
    style: 'hiit', level: 3, work: 30, rest: 15, rounds: 3, roundRest: 45,
    items: ['jumping_jack', 'high_knees', 'jump_squat', 'mountain_climber', 'skater_jump', 'burpee'],
  },
  {
    id: 'aufwaermen', cat: 'laufen', title: 'Aufwärmen vor dem Lauf', subtitle: 'Gelenke mobil, Puls langsam hoch',
    style: 'power', level: 1, work: 30, rest: 10, rounds: 1,
    items: ['arm_circles', { id: 'leg_swings', work: 20 }, 'high_knees', 'butt_kicks', 'inchworm', 'worlds_greatest_stretch', 'jumping_jack'],
  },
  {
    id: 'laeufer-kraft', cat: 'laufen', title: 'Kraft für Läufer:innen', subtitle: 'Hüfte, Waden und Rumpf – gegen typische Laufbeschwerden',
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: [{ id: 'single_leg_deadlift', work: 30 }, 'calf_raise', { id: 'clamshell', work: 30 }, 'reverse_lunge', { id: 'side_plank', work: 25 }, 'glute_bridge_march', 'tibialis_raise'],
  },
  {
    id: 'mobility-morgen', cat: 'beweglichkeit', title: 'Mobility am Morgen', subtitle: 'Sanft in den Tag – Rücken, Hüfte, Schultern',
    style: 'flow', level: 1, work: 45, rest: 10, rounds: 1,
    items: ['cat_cow', 'child_pose', 'cobra', 'downward_dog', 'worlds_greatest_stretch', 'deep_squat_hold', 'side_bend_stretch'],
  },
  {
    id: 'dehnen-laufen', cat: 'beweglichkeit', title: 'Dehnen nach dem Laufen', subtitle: 'Waden, Oberschenkel, Hüfte – ruhig ausatmen',
    style: 'flow', level: 1, work: 40, rest: 8, rounds: 1,
    items: [{ id: 'calf_stretch', work: 30 }, { id: 'hamstring_stretch', work: 30 }, { id: 'quad_stretch', work: 30 }, { id: 'hip_flexor_stretch', work: 30 }, { id: 'figure_four', work: 30 }, 'butterfly_stretch', 'child_pose'],
  },
  {
    id: 'ruecken', cat: 'beweglichkeit', title: 'Rücken entspannt & stark', subtitle: 'Mobilisieren, stabilisieren, lösen',
    style: 'flow', level: 1, work: 40, rest: 12, rounds: 1,
    items: ['cat_cow', 'bird_dog', 'glute_bridge', 'superman', { id: 'supine_twist', work: 30 }, 'cobra', 'child_pose'],
  },
  // ---- Kraft ----
  {
    id: 'oberkoerper', cat: 'kraft', title: 'Oberkörper ohne Geräte', subtitle: 'Brust, Schultern, Arme – Liegestütz in drei Stufen',
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['incline_pushup', 'pushup', 'bench_dip', 'shoulder_tap', 'superman', 'plank'],
  },
  {
    id: 'hanteln', cat: 'kraft', title: 'Ganzkörper mit Kurzhanteln', subtitle: 'Die Grundübungen mit Gewicht',
    style: 'power', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['goblet_squat', 'deadlift', 'row', 'overhead_press', 'reverse_lunge', 'biceps_curl', 'triceps_extension', 'lateral_raise'],
  },
  {
    id: 'kettlebell', cat: 'kraft', title: 'Kettlebell-Basics', subtitle: 'Schwingen, Kniebeuge, Heben, Tragen',
    style: 'power', level: 3, work: 40, rest: 20, rounds: 3, roundRest: 60,
    items: ['kettlebell_swing', 'goblet_squat', 'deadlift', { id: 'single_leg_deadlift', work: 30 }, 'farmers_carry'],
  },
  {
    id: 'hyrox', cat: 'kraft', title: 'Hyrox-Kraft', subtitle: 'Wall Balls, Swings, Lunges, Burpees, Tragen',
    style: 'hiit', level: 3, work: 45, rest: 15, rounds: 3, roundRest: 60,
    items: ['wall_ball', 'kettlebell_swing', 'lunge', 'burpee', 'farmers_carry', 'thruster'],
  },
  {
    id: 'beine-power', cat: 'kraft', title: 'Bein-Power', subtitle: 'Sprungkraft und stabile Knie',
    style: 'power', level: 3, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['jump_squat', 'reverse_lunge', 'side_lunge', 'cossack_squat', 'wall_sit', 'calf_raise', 'step_up'],
  },
  {
    id: 'po-band', cat: 'kraft', title: 'Po mit Miniband', subtitle: 'Gesäß und Hüfte gezielt kräftigen',
    style: 'power', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['monster_walk', { id: 'clamshell', work: 30 }, 'glute_bridge', { id: 'donkey_kick', work: 30 }, { id: 'side_lying_leg_raise', work: 30 }, 'sumo_squat'],
  },
  // ---- Rumpf ----
  {
    id: 'bauch-7', cat: 'rumpf', title: 'Bauch kurz & knackig', subtitle: 'Sechs Übungen, alles auf der Matte',
    style: 'groove', level: 2, work: 30, rest: 10, rounds: 2, roundRest: 30,
    items: ['crunch', 'bicycle_crunch', 'reverse_crunch', 'flutter_kicks', 'leg_raise', 'plank'],
  },
  {
    id: 'rumpf-sanft', cat: 'rumpf', title: 'Rumpf stabil – sanft', subtitle: 'Kontrolle statt Tempo, rückenfreundlich',
    style: 'groove', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['dead_bug', 'bird_dog', 'glute_bridge_march', 'bear_plank', { id: 'side_plank', work: 25 }, { id: 'hollow_hold', work: 25 }],
  },
  // ---- Kondition ----
  {
    id: 'tabata', cat: 'kondition', title: 'Tabata-Intervalle', subtitle: '20 Sekunden Vollgas, 10 Sekunden Pause',
    style: 'hiit', level: 3, work: 20, rest: 10, rounds: 4, roundRest: 30,
    items: ['jumping_jack', 'mountain_climber', 'jump_squat', 'high_knees'],
  },
  {
    id: 'cardio-leise', cat: 'kondition', title: 'Cardio ohne Springen', subtitle: 'Puls hoch, Nachbarn bleiben entspannt',
    style: 'hiit', level: 2, work: 40, rest: 20, rounds: 2, roundRest: 45,
    items: ['squat', 'reverse_lunge', 'mountain_climber', 'bear_crawl', 'inchworm', 'shoulder_tap', 'side_lunge'],
  },
  // ---- Beweglichkeit ----
  {
    id: 'huefte', cat: 'beweglichkeit', title: 'Hüfte frei', subtitle: 'Für alle, die viel sitzen oder laufen',
    style: 'flow', level: 1, work: 45, rest: 10, rounds: 1,
    items: [{ id: 'hip_flexor_stretch', work: 40 }, { id: 'pigeon_pose', work: 40 }, { id: 'figure_four', work: 40 }, 'butterfly_stretch', 'deep_squat_hold', 'worlds_greatest_stretch'],
  },
  {
    id: 'schulter-nacken', cat: 'beweglichkeit', title: 'Schultern & Nacken', subtitle: 'Gegen den Schreibtisch-Rücken',
    style: 'flow', level: 1, work: 40, rest: 10, rounds: 1,
    items: [{ id: 'neck_stretch', work: 30 }, 'arm_circles', 'chest_opener', 'side_bend_stretch', 'cat_cow', 'child_pose'],
  },
  {
    id: 'abend', cat: 'beweglichkeit', title: 'Abendroutine', subtitle: 'Runterkommen und lang machen',
    style: 'flow', level: 1, work: 50, rest: 10, rounds: 1,
    items: ['cat_cow', 'child_pose', { id: 'supine_twist', work: 40 }, { id: 'figure_four', work: 40 }, 'butterfly_stretch', { id: 'hamstring_stretch', work: 40 }],
  },
  // ---- Laufen & Fußball ----
  {
    id: 'lauf-abc', cat: 'laufen', title: 'Lauf-ABC & Aufwärmen', subtitle: 'Schritte, Fußgelenke, Sprungkraft',
    style: 'power', level: 2, work: 30, rest: 10, rounds: 1,
    items: [{ id: 'leg_swings', work: 20 }, { id: 'ankle_rocks', work: 20 }, 'running_drills', 'high_knees', 'butt_kicks', 'pogo_jumps', 'skater_jump'],
  },
  {
    id: 'fuesse-waden', cat: 'laufen', title: 'Füße & Waden stark', subtitle: 'Achillessehne, Schienbein, Fußgelenk',
    style: 'power', level: 1, work: 40, rest: 15, rounds: 2, roundRest: 45,
    items: ['calf_raise', 'soleus_raise', 'tibialis_raise', { id: 'ankle_rocks', work: 25 }, 'pogo_jumps', { id: 'calf_stretch', work: 30 }],
  },
  {
    id: 'fussball-praevention', cat: 'laufen', title: 'Fußball-Prävention', subtitle: 'Oberschenkelrückseite, Leiste, Hüfte – wie im FIFA 11+',
    style: 'power', level: 3, work: 40, rest: 20, rounds: 2, roundRest: 60,
    items: ['nordic_hamstring', { id: 'copenhagen', work: 25 }, { id: 'clamshell', work: 30 }, 'monster_walk', { id: 'side_plank', work: 25 }, { id: 'single_leg_deadlift', work: 30 }],
  },
];

export function findWorkout(id) { return WORKOUTS.find((w) => w.id === id) || null; }

/** Filter des Workout-Katalogs. */
export const WORKOUT_CATS = [
  { key: 'kraft', label: 'Kraft' },
  { key: 'rumpf', label: 'Rumpf' },
  { key: 'beweglichkeit', label: 'Beweglichkeit' },
  { key: 'kondition', label: 'Kondition' },
  { key: 'laufen', label: 'Laufen & Fußball' },
];

/** Übungs-IDs eines Workouts. */
export function workoutIds(w) { return w.items.map((x) => (typeof x === 'string' ? x : x.id)); }
