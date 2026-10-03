/* =========================================================================
   exercises.js — Übungs-Bibliothek: Katalog (Kraft/Rumpf/Beweglichkeit/Kondition)
   mit animierten Figuren zum Mitmachen (exercise-motions.js, motion-player.js),
   Schritt-für-Schritt-Anleitung und Filter/Suche.

   Der Katalog + die Filterlogik sind DOM-frei und damit testbar; darunter die
   View (#/uebungen). Keine externen Daten, keine Bilder von Dritten.
   ========================================================================= */

import { el, icon, iconSvg, segmented, input, sectionHead, openSheet, toast } from './ui.js';
import { setHeader } from './router.js';
import { exerciseArt } from './exercise-art.js';
import { onAccent } from './contrast.js';
import { exerciseUsage, bumpExerciseUsage } from './storage.js';
import { MOTIONS, motionFor } from './exercise-motions.js';
import { mountPlayer } from './motion-player.js';
import { WORKOUTS, WORKOUT_CATS, workoutIds } from './workouts.js';

/** Kategorien (Reihenfolge = Anzeigereihenfolge). */
export const EX_CATEGORIES = [
  { key: 'strength', label: 'Kraft', color: '#7c5cff' },
  { key: 'core', label: 'Rumpf', color: '#19b9c9' },
  { key: 'mobility', label: 'Beweglichkeit', color: '#2bb673' },
  { key: 'cardio', label: 'Kondition', color: '#f0802a' },
];
export function categoryMeta(key) { return EX_CATEGORIES.find((c) => c.key === key) || EX_CATEGORIES[0]; }
const DIFF = { 1: 'Einsteiger', 2: 'Mittel', 3: 'Fortgeschritten' };
export function difficultyLabel(n) { return DIFF[n] || DIFF[1]; }

/** Körperregionen für den zusätzlichen Filter (eine Übung kann mehrere treffen). */
export const EX_REGIONS = [
  { key: 'ruecken', label: 'Rücken' },
  { key: 'huefte', label: 'Hüfte' },
  { key: 'bauch', label: 'Bauch' },
  { key: 'beine', label: 'Beine' },
  { key: 'oberkoerper', label: 'Oberkörper' },
];
// Zuordnung Übung → Regionen (Einzelquelle, abgeleitet aus den beanspruchten Muskeln).
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
  // seit 3.22.0
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

/** Weitere Namen je Übung – für die Suche und um Übungen im Text einer Planeinheit zu erkennen. */
const ALIASES = {
  squat: ['Kniebeugen', 'Kniebeuge'], lunge: ['Ausfallschritte', 'Ausfallschritt', 'Lunges'], pushup: ['Liegestütz'],
  deadlift: ['Kreuzheben', 'Rumänisches Kreuzheben'], row: ['Rudern vorgebeugt', 'Vorgebeugtes Rudern'],
  overhead_press: ['Schulterdrücken'], calf_raise: ['Wadenheben'], plank: ['Plank', 'Unterarmstütz'], side_plank: ['Seitstütz'],
  glute_bridge: ['Glute Bridge', 'Hüftheben'], dead_bug: ['Dead Bug'], side_crunch: ['Seitneigung'],
  hip_flexor_stretch: ['Hüftbeuger-Dehnung'], hamstring_stretch: ['Beinrückseite'], calf_stretch: ['Waden an der Wand', 'Wadendehnung'],
  cat_cow: ['Katze-Kuh', 'Katze–Kuh'], chest_opener: ['Brustöffner'], split_squat: ['Split Squat', 'Bulgarian'], wall_sit: ['Wandsitz'],
  step_up: ['Step-ups', 'Step-up'], crunch: ['Crunch'], leg_raise: ['Beinheben'], hollow_hold: ['Hollow'], superman: ['Superman'],
  bird_dog: ['Bird Dog'], child_pose: ['Kindhaltung'], supine_twist: ['Wirbelsäulen-Rotation'], figure_four: ['Gesäßdehnung'],
  butterfly_stretch: ['Schmetterling'], nordic_hamstring: ['Nordic Hamstrings'], copenhagen: ['Copenhagen'], clamshell: ['Clamshell', 'Muschel'],
  monster_walk: ['Monster Walk'], soleus_raise: ['Soleus'], running_drills: ['Lauf-ABC', 'Skippings'], pogo_jumps: ['Pogo'], fifa11: ['FIFA 11+'],
  goblet_squat: ['Goblet', 'Frontkniebeuge'], sumo_squat: ['Sumo'], reverse_lunge: ['Reverse Lunge'], side_lunge: ['Side Lunge', 'seitlicher Ausfallschritt'],
  single_leg_deadlift: ['einbeiniges Kreuzheben'], hip_thrust: ['Hip Thrust'], kettlebell_swing: ['Kettlebell-Swings', 'Kettlebell-Swing'],
  jump_squat: ['Sprungkniebeugen', 'Jump Squat'], good_morning: ['Good Morning'], tibialis_raise: ['Tibialis'], step_down: ['Step-down'],
  cossack_squat: ['Cossack'], farmers_carry: ['Farmers Walk', 'Farmers Carry'], wall_ball: ['Wall Balls', 'Wall Ball'], thruster: ['Thruster'],
  pike_pushup: ['Pike'], bench_dip: ['Dips'], biceps_curl: ['Bizeps'], triceps_extension: ['Trizeps'], lateral_raise: ['Seitheben'],
  band_pull_apart: ['Pull-Apart'], pullup: ['Klimmzug', 'Klimmzüge', 'Latzug'], inverted_row: ['umgekehrtes Rudern'],
  single_arm_row: ['einarmiges Rudern'], donkey_kick: ['Donkey Kick'], bicycle_crunch: ['Fahrrad-Crunch', 'Bicycle'], russian_twist: ['Russian Twist'],
  reverse_crunch: ['Reverse Crunch'], shoulder_tap: ['Schultertippen', 'Shoulder Tap'], bear_plank: ['Bärenstand', 'Bear Hold'], v_up: ['V-Up', 'Klappmesser'],
  flutter_kicks: ['Flutter Kicks', 'Beinschlag'], worlds_greatest_stretch: ['Greatest Stretch'], downward_dog: ['Herabschauender Hund'],
  cobra: ['Kobra'], quad_stretch: ['Quadrizeps'], pigeon_pose: ['Taube'], leg_swings: ['Beinpendel', 'Leg Swings'], arm_circles: ['Armkreisen'],
  ankle_rocks: ['Knie zur Wand'], neck_stretch: ['Nackendehnung'], inchworm: ['Inchworm'], deep_squat_hold: ['tiefe Hocke'],
  jumping_jack: ['Hampelmann', 'Hampelmänner', 'Jumping Jacks'], high_knees: ['Kniehebelauf', 'High Knees'], butt_kicks: ['Anfersen'],
  burpee: ['Burpees', 'Burpee'], mountain_climber: ['Mountain Climber', 'Bergsteiger'], skater_jump: ['Skater'], bear_crawl: ['Bärengang', 'Bear Crawl'],
};

/** Präventionsübungen für Laufen und Fußball (Oberschenkelrückseite, Adduktoren,
    Hüfte, Wade/Achillessehne, Sprunggelenk) – Vorschläge für Fußballtermine. */
export const PREVENTION_IDS = ['fifa11', 'nordic_hamstring', 'copenhagen', 'clamshell', 'monster_walk', 'soleus_raise', 'running_drills', 'pogo_jumps'];

/** Vorsicht (Kontraindikationen) und Steigerung je Übung – Einzelquelle, wird unten
    in den Katalog übernommen. */
const DETAIL_BY_ID = {
  squat: { caution: 'Bei Knie- oder Hüftschmerzen nur so tief, wie es schmerzfrei geht.', progression: 'Mehr Wiederholungen, dann Gewicht (Kurzhantel/Kettlebell), später Pausen-Kniebeugen.' },
  lunge: { caution: 'Bei Knieproblemen kürzere Schritte und das vordere Knie nicht über die Zehen schieben.', progression: 'Mit Gewicht, rückwärts oder im Gehen (Walking Lunges).' },
  pushup: { caution: 'Bei Schulter- oder Handgelenksbeschwerden erhöht an einer Bank oder auf Fäusten.', progression: 'Von der Wand über die Bank zu Knien und vollem Liegestütz; später Füße erhöht.' },
  deadlift: { caution: 'Rücken neutral halten – bei akuten Rückenschmerzen weglassen und abklären.', progression: 'Mehr Gewicht in kleinen Schritten, dann einbeinig.' },
  row: { caution: 'Rücken gerade, nicht ruckartig ziehen.', progression: 'Schwerere Hantel oder stärkeres Band, langsam absenken (3 s).' },
  overhead_press: { caution: 'Bei Schulterschmerzen nicht über Kopf – dann lieber im Sitzen mit leichterem Gewicht oder weglassen.', progression: 'Mehr Gewicht oder einarmig (mehr Rumpf).' },
  calf_raise: { caution: 'Bei gereizter Achillessehne langsam und ohne Nachwippen.', progression: 'Einbeinig, dann an einer Stufe mit Absenken unter Stufenniveau, dann mit Gewicht.' },
  plank: { caution: 'Kein Hohlkreuz – bei Rückenschmerzen auf den Knien beginnen.', progression: 'Länger halten, dann Arm oder Bein abheben.' },
  side_plank: { caution: 'Bei Schulterbeschwerden auf dem Knie abstützen.', progression: 'Oberes Bein abheben oder Hüfte heben und senken.' },
  glute_bridge: { caution: 'Nicht ins Hohlkreuz drücken – die Kraft kommt aus dem Gesäß.', progression: 'Einbeinig, dann Füße erhöht oder mit Gewicht auf der Hüfte.' },
  dead_bug: { caution: 'Der untere Rücken bleibt am Boden – sonst kleinere Bewegung.', progression: 'Langsamer, Arme/Beine gestreckt, später mit leichtem Gewicht.' },
  side_crunch: { caution: 'Nur zur Seite neigen, nicht nach vorn beugen oder drehen.', progression: 'Mit Kurzhantel in der Hand der Gegenseite.' },
  hip_flexor_stretch: { caution: 'Knie weich polstern; nicht ins Hohlkreuz ausweichen.', progression: 'Den Arm der hinteren Seite über den Kopf strecken.' },
  hamstring_stretch: { caution: 'Nur leichter Zug – nie ruckartig und nicht bei frischer Zerrung.', progression: 'Länger halten, Rücken bewusst lang.' },
  calf_stretch: { caution: 'Bei gereizter Achillessehne sanft und nicht auf Schmerz dehnen.', progression: 'Auch mit gebeugtem Knie (tiefe Wadenmuskulatur).' },
  cat_cow: { caution: 'Im schmerzfreien Bereich bleiben.', progression: 'Langsamer, mit bewusster Atmung.' },
  chest_opener: { caution: 'Nicht bei Schulterinstabilität in die Endposition ziehen.', progression: 'Länger halten, Arme etwas höher.' },
  split_squat: { caution: 'Bei Knieproblemen nicht so tief.', progression: 'Bulgarian Split Squat (hinterer Fuß erhöht), dann mit Gewicht.' },
  wall_sit: { caution: 'Bei Kniescheibenbeschwerden höher sitzen (Winkel über 90°).', progression: 'Länger halten, dann einbeinig abwechselnd.' },
  step_up: { caution: 'Kniestabil bleiben – das Knie nicht nach innen kippen lassen.', progression: 'Höhere Stufe, dann mit Gewicht.' },
  crunch: { caution: 'Nacken nicht mit den Händen ziehen.', progression: 'Langsamer, dann mit leichtem Gewicht auf der Brust.' },
  leg_raise: { caution: 'Bei Rückenschmerzen Knie gebeugt lassen.', progression: 'Gestreckte Beine, langsam absenken.' },
  hollow_hold: { caution: 'Der untere Rücken darf sich nicht lösen – sonst Knie anziehen.', progression: 'Arme über den Kopf, länger halten.' },
  superman: { caution: 'Die Bauchlage-Streckung belastet die Lendenwirbelsäule stärker – bei Rückenbeschwerden lieber Bird Dog.', progression: 'Länger halten, abwechselnd Arm und Bein.' },
  bird_dog: { caution: 'Becken waagerecht halten, nicht ins Hohlkreuz.', progression: 'Kurz halten, dann Ellbogen und Knie unter dem Körper zusammenführen.' },
  child_pose: { caution: 'Bei Kniebeschwerden ein Kissen zwischen Gesäß und Fersen.', progression: 'Hände zur Seite wandern lassen (seitliche Dehnung).' },
  supine_twist: { caution: 'Schultern bleiben am Boden, nicht erzwingen.', progression: 'Länger halten, oberes Bein strecken.' },
  figure_four: { caution: 'Bei Hüft- oder Knieschmerzen weniger weit ziehen.', progression: 'Im Sitzen auf einem Stuhl mit Vorbeuge.' },
  butterfly_stretch: { caution: 'Nicht auf die Knie drücken oder federn.', progression: 'Fersen näher heran, länger halten.' },
};

/** Übernimmt Vorsicht/Steigerung aus DETAIL_BY_ID, Suchbegriffe und Bewegungsablauf in den Katalog.
    `hold` (Zeit statt Wiederholungen) folgt dem Ablauf: wer `holdS` hat, zählt nach Sekunden. */
function withDetails(list) {
  return list.map((e) => {
    const m = MOTIONS[e.id];
    return { ...e, ...(DETAIL_BY_ID[e.id] || {}), art: e.art || e.id, aliases: ALIASES[e.id] || [], hold: !!(e.hold || (m && m.holdS != null)) };
  });
}
/** Regionen einer Übung (leer, wenn nicht zugeordnet). */
export function exerciseRegions(id) { return REGION_BY_ID[id] || []; }

/** Der Katalog. `art` verweist auf eine Figur in exercise-art.js. */
export const EXERCISES = withDetails([
  {
    id: 'squat', name: 'Kniebeuge', category: 'strength', art: 'squat', difficulty: 1,
    muscles: ['Oberschenkel', 'Gesäß', 'Rumpf'], equipment: 'ohne (optional Gewicht)',
    steps: [
      'Schulterbreiter Stand, Fußspitzen leicht nach außen.',
      'Hüfte nach hinten schieben und beugen, als würdest du dich setzen.',
      'Knie zeigen über die Fußspitzen, Rücken bleibt lang, Brust auf.',
      'Bis die Oberschenkel etwa waagerecht sind, dann kraftvoll hochdrücken.',
    ],
    tip: 'Gewicht auf der ganzen Fußsohle, Fersen bleiben am Boden. 3×10–15 Wiederholungen.',
  },
  {
    id: 'lunge', name: 'Ausfallschritt', category: 'strength', art: 'lunge', difficulty: 2,
    muscles: ['Oberschenkel', 'Gesäß', 'Balance'], equipment: 'ohne',
    steps: [
      'Aus dem Stand einen großen Schritt nach vorne.',
      'Beide Knie ~90° beugen, hinteres Knie sinkt Richtung Boden.',
      'Vorderes Knie bleibt über dem Fußgelenk, Oberkörper aufrecht.',
      'Über die vordere Ferse zurück in den Stand drücken, Seite wechseln.',
    ],
    tip: 'Für Läufer:innen ideal gegen einseitige Schwächen. 3×8–10 je Seite.',
  },
  {
    id: 'pushup', name: 'Liegestütz', category: 'strength', art: 'pushup', difficulty: 2,
    muscles: ['Brust', 'Schultern', 'Trizeps', 'Rumpf'], equipment: 'ohne',
    steps: [
      'Hände etwas weiter als schulterbreit, Körper bildet eine gerade Linie.',
      'Rumpf fest anspannen (kein Durchhängen der Hüfte).',
      'Ellbogen nach hinten beugen, Brust Richtung Boden senken.',
      'Kraftvoll wieder hochdrücken.',
    ],
    tip: 'Zu schwer? Knie ablegen oder Hände erhöht (Tisch/Wand). 3×6–12.',
  },
  {
    id: 'deadlift', name: 'Kreuzheben (Hüft-Hinge)', category: 'strength', art: 'deadlift', difficulty: 3,
    muscles: ['Gesäß', 'hintere Oberschenkel', 'unterer Rücken'], equipment: 'Hantel/Kettlebell',
    steps: [
      'Hüftbreiter Stand, Gewicht vor den Schienbeinen.',
      'Hüfte nach hinten schieben, Knie nur leicht beugen, Rücken bleibt gerade.',
      'Gewicht nah am Körper führen, bis kurz unter die Knie.',
      'Über die Hüfte aufrichten, Gesäß fest anspannen.',
    ],
    tip: 'Bewegung kommt aus der Hüfte, nicht aus dem Rücken. Erst Technik, dann Gewicht. 3×8.',
  },
  {
    id: 'row', name: 'Vorgebeugtes Rudern', category: 'strength', art: 'row', difficulty: 2,
    muscles: ['oberer Rücken', 'Bizeps', 'hintere Schulter'], equipment: 'Hantel/Kettlebell',
    steps: [
      'Hüft-Hinge wie beim Kreuzheben, Oberkörper ~45° vorgebeugt.',
      'Arme hängen lang, Schulterblätter locker.',
      'Gewicht zur unteren Rippe ziehen, Ellbogen eng am Körper.',
      'Kontrolliert ablassen, Rücken bleibt stabil.',
    ],
    tip: 'Gleicht die laufdominante Vorderseite aus. 3×10–12.',
  },
  {
    id: 'overhead_press', name: 'Schulterdrücken', category: 'strength', art: 'overhead_press', difficulty: 2,
    muscles: ['Schultern', 'Trizeps', 'Rumpf'], equipment: 'Hanteln',
    steps: [
      'Aufrechter Stand, Gewichte auf Schulterhöhe.',
      'Rumpf anspannen, Rippen nicht aufklappen.',
      'Gewichte gerade über den Kopf drücken, bis die Arme fast gestreckt sind.',
      'Kontrolliert zurück auf Schulterhöhe.',
    ],
    tip: 'Kein Hohlkreuz – Bauch fest. 3×8–10.',
  },
  {
    id: 'calf_raise', name: 'Wadenheben', category: 'strength', art: 'calf_raise', difficulty: 1,
    muscles: ['Waden', 'Achillessehne'], equipment: 'ohne (optional Stufe)',
    steps: [
      'Aufrechter Stand, evtl. mit den Fußballen auf einer Stufe.',
      'Langsam auf die Zehenspitzen heben, kurz halten.',
      'Kontrolliert tief absenken (auf der Stufe unter Stufenhöhe).',
    ],
    tip: 'Beugt Achilles-/Wadenproblemen vor. 3×15–20, gerne einbeinig steigern.',
  },
  {
    id: 'plank', name: 'Unterarmstütz (Plank)', category: 'core', art: 'plank', difficulty: 1, hold: true,
    muscles: ['Rumpf', 'Schultern', 'Gesäß'], equipment: 'ohne',
    steps: [
      'Unterarme schulterbreit am Boden, Ellbogen unter den Schultern.',
      'Körper bildet eine gerade Linie von Kopf bis Ferse.',
      'Bauch und Gesäß anspannen, Becken leicht einrollen.',
      'Ruhig weiteratmen, Position halten.',
    ],
    tip: 'Lieber kurz & sauber als lang & durchhängend. 3×20–45 s.',
  },
  {
    id: 'side_plank', name: 'Seitstütz', category: 'core', art: 'side_plank', difficulty: 2, hold: true,
    muscles: ['seitlicher Rumpf', 'Hüfte', 'Schulter'], equipment: 'ohne',
    steps: [
      'Seitlage, Unterarm unter der Schulter, Beine gestapelt.',
      'Hüfte anheben, bis der Körper eine gerade Linie bildet.',
      'Oberen Arm zur Decke strecken oder in die Hüfte.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Stabilisiert die Hüfte beim Laufen. 3×15–30 s je Seite.',
  },
  {
    id: 'glute_bridge', name: 'Hüftheben (Glute Bridge)', category: 'core', art: 'glute_bridge', difficulty: 1,
    muscles: ['Gesäß', 'hintere Oberschenkel', 'Rumpf'], equipment: 'ohne',
    steps: [
      'Rückenlage, Füße hüftbreit aufgestellt, Arme neben dem Körper.',
      'Gesäß anspannen und Hüfte nach oben drücken.',
      'Oberschenkel und Rumpf bilden eine Linie, kurz halten.',
      'Kontrolliert absenken, ohne ganz abzulegen.',
    ],
    tip: 'Weckt das oft „schlafende“ Gesäß. 3×12–15, gerne einbeinig.',
  },
  {
    id: 'dead_bug', name: 'Dead Bug (Käfer)', category: 'core', art: 'dead_bug', difficulty: 2,
    muscles: ['tiefe Rumpfmuskeln', 'Koordination'], equipment: 'ohne',
    steps: [
      'Rückenlage, Arme zur Decke, Hüfte und Knie 90° angehoben.',
      'Unteren Rücken sanft zum Boden drücken (Bauch fest).',
      'Gegengleich rechtes Bein und linken Arm langziehen, ohne Hohlkreuz.',
      'Zurück zur Mitte, andere Seite.',
    ],
    tip: 'Rumpfstabilität ohne Belastung der Wirbelsäule. 3×8 je Seite, langsam.',
  },
  {
    id: 'side_crunch', name: 'Seitneigung im Stand', category: 'core', art: 'side_crunch', difficulty: 2,
    muscles: ['seitlicher Rumpf', 'Balance'], equipment: 'ohne',
    steps: [
      'Aufrechter, stabiler Stand, Bauch fest.',
      'Oberkörper kontrolliert zur Seite neigen, Hand am Oberschenkel führen.',
      'Über die seitliche Bauchmuskulatur wieder aufrichten.',
    ],
    tip: 'Kleine, kontrollierte Bewegung. 3×12 je Seite.',
  },
  {
    id: 'hip_flexor_stretch', name: 'Hüftbeuger-Dehnung', category: 'mobility', art: 'hip_flexor_stretch', difficulty: 1,
    muscles: ['Hüftbeuger', 'vorderer Oberschenkel'], equipment: 'ohne',
    steps: [
      'Tiefer Ausfallschritt, hinteres Knie am Boden (z. B. auf einem Kissen).',
      'Becken leicht einrollen, Po anspannen.',
      'Hüfte sanft nach vorne schieben, bis es vorne in der Hüfte zieht.',
      'Ruhig halten, nicht wippen.',
    ],
    tip: 'Wichtig fürs viele Sitzen + Laufen. 2×30 s je Seite.',
  },
  {
    id: 'hamstring_stretch', name: 'Oberschenkelrückseite dehnen', category: 'mobility', art: 'hamstring_stretch', difficulty: 1,
    muscles: ['hintere Oberschenkel', 'unterer Rücken'], equipment: 'ohne',
    steps: [
      'Ein Bein leicht vorstellen, Ferse am Boden, Zehen hoch.',
      'Hüfte nach hinten schieben und mit geradem Rücken nach vorne neigen.',
      'Hände Richtung Schienbein, bis es hinten leicht zieht.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Rücken lang lassen – nicht rund einrollen. 2×30 s je Seite.',
  },
  {
    id: 'calf_stretch', name: 'Wadendehnung an der Wand', category: 'mobility', art: 'calf_stretch', difficulty: 1,
    muscles: ['Waden', 'Achillessehne'], equipment: 'Wand',
    steps: [
      'Mit beiden Händen an die Wand lehnen.',
      'Ein Bein gestreckt nach hinten, Ferse bleibt am Boden.',
      'Hüfte nach vorne schieben, bis es in der Wade zieht.',
      'Für die tiefe Wade hinteres Knie leicht beugen.',
    ],
    tip: 'Nach dem Laufen wohltuend. 2×30 s je Seite.',
  },
  {
    id: 'cat_cow', name: 'Katze–Kuh', category: 'mobility', art: 'cat_cow', difficulty: 1,
    muscles: ['Wirbelsäule', 'Rumpf'], equipment: 'ohne',
    steps: [
      'Vierfüßlerstand, Hände unter den Schultern, Knie unter der Hüfte.',
      'Einatmen: Rücken sanft durchhängen lassen, Blick hoch („Kuh“).',
      'Ausatmen: Rücken rund machen, Kinn zur Brust („Katze“).',
      'Mehrmals fließend im Atemrhythmus wechseln.',
    ],
    tip: 'Sanfte Mobilisation für Rücken & Nacken. 8–10 ruhige Wechsel.',
  },
  {
    id: 'chest_opener', name: 'Brustöffner', category: 'mobility', art: 'chest_opener', difficulty: 1,
    muscles: ['Brust', 'vordere Schulter'], equipment: 'ohne',
    steps: [
      'Aufrechter Stand, Bauch leicht fest.',
      'Arme nach hinten öffnen, Hände hinter dem Rücken locker fassen.',
      'Brustbein anheben, Schultern nach hinten/unten.',
      'Ruhig atmen, sanft halten.',
    ],
    tip: 'Gegen die nach vorne gezogene „Bildschirm-Haltung“. 2×20–30 s.',
  },

  // ---- Kraft: Beine ----
  {
    id: 'split_squat', name: 'Bulgarischer Split Squat', category: 'strength', art: 'split_squat', difficulty: 3,
    muscles: ['Oberschenkel', 'Gesäß', 'Balance'], equipment: 'Erhöhung (Stuhl/Bank)',
    steps: [
      'Ein Fuß vorne am Boden, der hintere Spann liegt erhöht auf Stuhl oder Bank.',
      'Oberkörper aufrecht, vorderes Knie beugen und den Körper gerade absenken.',
      'Vorderes Knie bleibt über dem Fuß, hinteres Knie senkt Richtung Boden.',
      'Über die vordere Ferse kontrolliert hochdrücken.',
    ],
    tip: 'Sehr wirksam für einbeinige Kraft und Stabilität. 3×8–10 je Seite.',
  },
  {
    id: 'wall_sit', name: 'Wandsitz', category: 'strength', art: 'wall_sit', difficulty: 1, hold: true,
    muscles: ['Oberschenkel', 'Gesäß'], equipment: 'Wand',
    steps: [
      'Mit dem Rücken flach an der Wand stehen, Füße etwa 40 cm davor.',
      'An der Wand hinunterrutschen, bis die Oberschenkel waagerecht sind.',
      'Knie über den Knöcheln, Rücken bleibt an der Wand.',
      'Position ruhig atmend halten.',
    ],
    tip: 'Statische Ausdauerkraft für die Beine – ideal ohne Geräte. 3×30–45 s.',
  },
  {
    id: 'step_up', name: 'Step-up (Aufsteiger)', category: 'strength', art: 'step_up', difficulty: 2,
    muscles: ['Oberschenkel', 'Gesäß', 'Balance'], equipment: 'stabile Stufe/Bank',
    steps: [
      'Vor eine kniehohe, stabile Stufe stellen.',
      'Mit einem Fuß ganz aufsteigen, Kraft aus der Ferse.',
      'Oben kurz stabil stehen, dann kontrolliert wieder absenken.',
      'Nicht mit dem hinteren Bein abdrücken – die Arbeit macht das obere Bein.',
    ],
    tip: 'Läuferfreundlich (einbeinig, alltagsnah). 3×10 je Seite.',
  },

  // ---- Rumpf: Bauch ----
  {
    id: 'crunch', name: 'Crunch (Bauchpresse)', category: 'core', art: 'crunch', difficulty: 1,
    muscles: ['gerade Bauchmuskeln'], equipment: 'ohne',
    steps: [
      'Auf den Rücken, Knie angewinkelt, Füße hüftbreit am Boden.',
      'Hände locker an den Schläfen (nicht am Kopf ziehen).',
      'Oberkörper mit dem Bauch einrollen, Schulterblätter heben leicht ab.',
      'Kurz halten, langsam wieder ablegen.',
    ],
    tip: 'Bewegung kommt aus dem Bauch, nicht aus dem Nacken. 3×12–20.',
  },
  {
    id: 'leg_raise', name: 'Beinheben', category: 'core', art: 'leg_raise', difficulty: 2,
    muscles: ['untere Bauchmuskeln', 'Hüftbeuger'], equipment: 'ohne',
    steps: [
      'Auf den Rücken, Beine gestreckt, Hände neben oder unter dem Gesäß.',
      'Unteren Rücken bewusst am Boden lassen.',
      'Gestreckte Beine langsam bis ~90° anheben.',
      'Kontrolliert absenken, ohne die Fersen ganz abzulegen.',
    ],
    tip: 'Bei Rückenzwicken die Knie leicht beugen. 3×10–15.',
  },
  {
    id: 'hollow_hold', name: 'Hollow Hold', category: 'core', art: 'hollow_hold', difficulty: 2, hold: true,
    muscles: ['tiefe Bauchmuskeln', 'Rumpf'], equipment: 'ohne',
    steps: [
      'Auf den Rücken, Arme über den Kopf, Beine gestreckt.',
      'Unteren Rücken fest an den Boden pressen (Bauch anspannen).',
      'Schultern und Beine leicht anheben – der Körper wird zur flachen Schale.',
      'Ruhig weiteratmen und halten.',
    ],
    tip: 'Der untere Rücken darf sich NICHT vom Boden lösen. 3×15–30 s.',
  },

  // ---- Rumpf: Rücken ----
  {
    id: 'superman', name: 'Superman (Rückenstrecker)', category: 'core', art: 'superman', difficulty: 1,
    muscles: ['unterer Rücken', 'Gesäß', 'hintere Schulter'], equipment: 'ohne',
    steps: [
      'Bäuchlings hinlegen, Arme nach vorne gestreckt.',
      'Arme, Brust und Beine gleichzeitig leicht vom Boden abheben.',
      'Blick zum Boden, Nacken lang – nicht in den Nacken drücken.',
      'Kurz halten, sanft ablegen.',
    ],
    tip: 'Kräftigt die oft vernachlässigte Rückenkette. 3×10 oder 3×20 s halten.',
  },
  {
    id: 'bird_dog', name: 'Bird Dog (Vierfüßler diagonal)', category: 'core', art: 'bird_dog', difficulty: 1,
    muscles: ['Rumpf', 'unterer Rücken', 'Gesäß', 'Koordination'], equipment: 'ohne',
    steps: [
      'Vierfüßlerstand, Hände unter den Schultern, Knie unter der Hüfte.',
      'Rechten Arm und linkes Bein gleichzeitig lang ausstrecken.',
      'Hüfte und Schultern bleiben waagerecht (nicht verdrehen).',
      'Zurückführen und Seite wechseln.',
    ],
    tip: 'Stabilität statt Schwung – langsam und kontrolliert. 3×8–10 je Seite.',
  },

  // ---- Beweglichkeit: Rücken & Hüfte ----
  {
    id: 'child_pose', name: 'Kindhaltung', category: 'mobility', art: 'child_pose', difficulty: 1,
    muscles: ['unterer Rücken', 'Hüfte', 'Schultern'], equipment: 'ohne (Matte)',
    steps: [
      'Aus dem Kniestand das Gesäß Richtung Fersen setzen.',
      'Oberkörper nach vorne ablegen, Arme lang nach vorne strecken.',
      'Stirn ruht am Boden, Schultern locker.',
      'Tief in den unteren Rücken atmen.',
    ],
    tip: 'Sanfte Entlastung für den ganzen Rücken. 3×30–45 s.',
  },
  {
    id: 'supine_twist', name: 'Wirbelsäulen-Rotation (liegend)', category: 'mobility', art: 'supine_twist', difficulty: 1,
    muscles: ['Wirbelsäule', 'unterer Rücken', 'Gesäß'], equipment: 'ohne (Matte)',
    steps: [
      'Auf den Rücken, Arme seitlich ausgebreitet (T-Form).',
      'Beide Knie anwinkeln und gemeinsam zu einer Seite ablegen.',
      'Kopf optional zur Gegenseite drehen, beide Schultern am Boden halten.',
      'Ruhig atmen, dann Seite wechseln.',
    ],
    tip: 'Löst den unteren Rücken nach dem Laufen. 2×30 s je Seite.',
  },
  {
    id: 'figure_four', name: 'Gesäßdehnung (Vierer)', category: 'mobility', art: 'figure_four', difficulty: 1,
    muscles: ['Gesäß', 'Piriformis', 'Hüfte'], equipment: 'ohne (Matte)',
    steps: [
      'Auf den Rücken, beide Knie angewinkelt.',
      'Einen Knöchel über das andere Knie legen (Form einer „4“).',
      'Das untere Bein Richtung Brust ziehen, bis es im Gesäß zieht.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Klassiker gegen festes Gesäß/Ischias-Gefühl bei Läufern. 2×30 s je Seite.',
  },
  {
    id: 'butterfly_stretch', name: 'Schmetterling (Adduktoren)', category: 'mobility', art: 'butterfly_stretch', difficulty: 1,
    muscles: ['Innenschenkel', 'Hüfte'], equipment: 'ohne (Matte)',
    steps: [
      'Aufrecht sitzen, Fußsohlen vor dem Körper zusammenlegen.',
      'Fersen locker heranziehen, Knie sinken zur Seite.',
      'Aufrecht bleiben, Oberkörper leicht nach vorne neigen.',
      'Nicht federn – ruhig halten.',
    ],
    tip: 'Öffnet die Hüfte und die Innenschenkel. 2×30–45 s.',
  },

  // ---- Prävention für Laufen und Fußball ----
  {
    id: 'fifa11', name: 'Fußball-Aufwärmen (FIFA 11+)', category: 'mobility', art: 'fifa11', difficulty: 1, prevention: true,
    muscles: ['ganzer Körper', 'Koordination', 'Sprunggelenk', 'Knie'], equipment: 'ohne (Hütchen oder Markierungen)',
    steps: [
      'Teil 1 (ca. 8 min): lockeres Laufen mit Hüfte auf/zu, Seitgalopp, Schulterkontakt mit Partner, kurze Antritte vor und zurück.',
      'Teil 2 (ca. 10 min): Kraft und Balance – Unterarmstütz, Seitstütz, Nordic Hamstrings, Einbeinstand mit Ball, Kniebeugen, Sprünge.',
      'Teil 3 (ca. 2 min): Laufen – über das Feld mit zunehmendem Tempo, Richtungswechsel mit sauberer Landung.',
      'Knie zeigen bei jeder Landung und Kniebeuge über die Fußspitzen, nicht nach innen.',
    ],
    tip: 'Rund 20 Minuten vor Training oder Spiel, zwei- bis dreimal pro Woche. In Studien sank damit die Verletzungsrate im Jugendfußball deutlich (Soligard et al. 2008).',
    caution: 'Nach Verletzungen zuerst mit der leichtesten Stufe beginnen und bei Schmerz abbrechen.',
    progression: 'Drei Stufen je Übung: leicht, mittel, schwer – erst steigern, wenn die leichtere sauber gelingt.',
  },
  {
    id: 'nordic_hamstring', name: 'Nordic Hamstring Curl', category: 'strength', art: 'nordic_hamstring', difficulty: 3, prevention: true,
    muscles: ['hintere Oberschenkel', 'Gesäß'], equipment: 'Partner oder feste Fußhalterung, Matte',
    steps: [
      'Kniestand auf einer weichen Unterlage, Fersen werden festgehalten oder unter einem Sofa fixiert.',
      'Körper von Knie bis Kopf gerade, Hüfte gestreckt.',
      'Langsam nach vorne sinken lassen und mit der Oberschenkelrückseite so lange wie möglich bremsen.',
      'Mit den Händen abfangen und mit einem kleinen Stoß wieder hochkommen.',
    ],
    tip: 'Die bekannteste Übung gegen Zerrungen der Oberschenkelrückseite: Einbindung in Präventionsprogramme etwa halbierte die Rate (van Dyk et al. 2019). Anfangs 2×4–5, langsam steigern.',
    caution: 'Nicht bei frischer Zerrung. Die ersten Male gibt es kräftigen Muskelkater – mit wenigen Wiederholungen beginnen, nicht am Tag vor einem Spiel.',
    progression: 'Erst den Weg nach unten verlängern, dann Wiederholungen (bis 3×8), später langsamer.',
  },
  {
    id: 'copenhagen', name: 'Copenhagen-Seitstütz (Adduktoren)', category: 'core', art: 'copenhagen', difficulty: 3, prevention: true,
    muscles: ['Innenschenkel (Adduktoren)', 'seitlicher Rumpf'], equipment: 'Bank oder Partner',
    steps: [
      'Seitstütz auf dem Unterarm, das obere Bein liegt auf einer Bank (anfangs mit dem Knie, später mit dem Fuß).',
      'Das untere Bein hängt frei unter der Bank.',
      'Hüfte anheben, bis der Körper eine Linie bildet – die Innenseite des oberen Beins trägt.',
      'Kurz halten, kontrolliert absenken, Seite wechseln.',
    ],
    tip: 'Kräftigt die Adduktoren – im Fußball eine häufige Verletzungsstelle (Leiste). 2×6–8 je Seite.',
    caution: 'Bei Leistenschmerzen nicht belasten und abklären lassen.',
    progression: 'Vom Knie auf der Bank zum Fuß auf der Bank (längerer Hebel), dann das untere Bein zur Bank führen.',
  },
  {
    id: 'clamshell', name: 'Clamshell (Muschel)', category: 'strength', art: 'clamshell', difficulty: 1, prevention: true,
    muscles: ['seitliches Gesäß (Hüftabduktoren)'], equipment: 'ohne (optional Miniband)',
    steps: [
      'Seitenlage, Hüfte und Knie etwa 45° gebeugt, Füße aufeinander.',
      'Becken bleibt senkrecht, das obere Knie öffnet sich wie eine Muschel.',
      'Die Füße bleiben zusammen.',
      'Langsam wieder schließen.',
    ],
    tip: 'Stabilisiert Becken und Knie beim Laufen (weniger „Einknicken“). 3×15 je Seite.',
    caution: 'Nicht nach hinten aufdrehen – die Bewegung kommt aus der Hüfte.',
    progression: 'Mit Miniband über den Knien, dann oben kurz halten.',
  },
  {
    id: 'monster_walk', name: 'Monster Walk (Miniband)', category: 'strength', art: 'monster_walk', difficulty: 2, prevention: true,
    muscles: ['seitliches Gesäß', 'Oberschenkel'], equipment: 'Miniband',
    steps: [
      'Miniband über den Knien oder Fußgelenken, leicht in die Knie gehen.',
      'Mit Spannung im Band seitlich oder schräg vorwärts gehen.',
      'Knie zeigen nach vorn, der Oberkörper bleibt ruhig.',
      'Gleich viele Schritte in beide Richtungen.',
    ],
    tip: 'Gutes Aufwärmen vor Lauf oder Spiel. 2–3×10 Schritte je Richtung.',
    caution: 'Knie nicht nach innen fallen lassen.',
    progression: 'Stärkeres Band oder Band an den Fußgelenken.',
  },
  {
    id: 'soleus_raise', name: 'Wadenheben mit gebeugtem Knie (Soleus)', category: 'strength', art: 'soleus_raise', difficulty: 2, prevention: true,
    muscles: ['tiefe Wadenmuskulatur (Soleus)', 'Achillessehne'], equipment: 'Stufe, optional Gewicht',
    steps: [
      'An einer Stufe oder Wand stehen, Knie etwa 30–45° gebeugt.',
      'Die Knie bleiben gebeugt, die Fersen heben sich so hoch wie möglich.',
      'Oben kurz halten.',
      'Langsam absenken (3 Sekunden).',
    ],
    tip: 'Der Soleus trägt beim Laufen ein Vielfaches des Körpergewichts – wichtig für Achillessehne und Wade. 3×15–20.',
    caution: 'Bei gereizter Achillessehne schmerzarm und langsam arbeiten.',
    progression: 'Einbeinig, dann mit Gewicht (Rucksack, Kurzhantel).',
  },
  {
    id: 'running_drills', name: 'Lauf-ABC (Skippings, Anfersen)', category: 'mobility', art: 'running_drills', difficulty: 2, prevention: true,
    muscles: ['Fußgelenk', 'Hüftbeuger', 'Koordination'], equipment: 'ohne (20–30 m freie Strecke)',
    steps: [
      'Fußgelenksarbeit: kurze, schnelle Schritte über den Vorfuß, 20 m.',
      'Skippings: Knie im schnellen Wechsel bis etwa Hüfthöhe, aufrechter Oberkörper, 20 m.',
      'Anfersen: Fersen Richtung Gesäß, schnelle Frequenz, 20 m.',
      'Dazwischen locker zurücktraben; zum Schluss 2–3 Steigerungen.',
    ],
    tip: 'Verbessert Laufökonomie und Koordination – ideal nach dem Einlaufen vor Tempoeinheiten. 2 Durchgänge.',
    caution: 'Nur aufgewärmt, auf ebenem Untergrund.',
    progression: 'Höhere Frequenz, dann Hopserlauf und Sprunglauf.',
  },
  {
    id: 'pogo_jumps', name: 'Fußgelenksprünge (Pogo Jumps)', category: 'strength', art: 'pogo_jumps', difficulty: 2, prevention: true, hold: true,
    muscles: ['Wade', 'Achillessehne', 'Sprunggelenk'], equipment: 'ohne',
    steps: [
      'Hüftbreiter Stand, Knie fast gestreckt.',
      'Kleine, schnelle Sprünge nur aus dem Fußgelenk – der Boden ist „heiß“.',
      'Leise landen, kurze Bodenkontakte.',
      '20–30 Sekunden, dann Pause.',
    ],
    tip: 'Einfache Plyometrie: macht Sehnen belastbarer und den Schritt federnder. 3×20 s.',
    caution: 'Nicht bei Achillessehnen- oder Schienbeinschmerzen; erst nach einigen Wochen Kraftarbeit für die Wade.',
    progression: 'Länger, dann einbeinig oder seitlich über eine Linie.',
  },

  /* ---------- seit 3.22.0: weitere Kraftübungen ---------- */
  {
    id: 'goblet_squat', name: 'Goblet Squat (Kniebeuge mit Gewicht)', category: 'strength', difficulty: 2,
    muscles: ['Oberschenkel', 'Gesäß', 'Rumpf'], equipment: 'Kettlebell oder Kurzhantel',
    steps: [
      'Gewicht mit beiden Händen vor der Brust halten, Ellbogen zeigen nach unten.',
      'Schulterbreiter Stand, Fußspitzen leicht nach außen.',
      'Aufrecht tief in die Hocke, Ellbogen zwischen die Knie.',
      'Durch die ganze Fußsohle wieder hochdrücken.',
    ],
    tip: 'Das Gewicht vor der Brust hält den Oberkörper aufrecht – ideal, um die Kniebeuge sauber zu lernen. 3×8–12.',
    caution: 'Rücken bleibt gerade; bei Knieschmerzen nur so tief, wie es schmerzfrei geht.',
    progression: 'Schwereres Gewicht, dann unten 2 s Pause.',
  },
  {
    id: 'sumo_squat', name: 'Sumo-Kniebeuge', category: 'strength', difficulty: 1,
    muscles: ['Innenschenkel', 'Gesäß', 'Oberschenkel'], equipment: 'ohne (optional Kettlebell)',
    steps: [
      'Breiter Stand, Fußspitzen deutlich nach außen.',
      'Hände vor der Brust, Oberkörper aufrecht.',
      'Hüfte gerade nach unten sinken lassen, Knie schieben über die Fußspitzen nach außen.',
      'Über die Fersen hochdrücken, oben den Po anspannen.',
    ],
    tip: 'Betont Innenschenkel und Gesäß. 3×12–15.',
    caution: 'Knie folgen der Fußrichtung – nicht nach innen fallen lassen.',
    progression: 'Mit Kettlebell zwischen den Beinen, dann langsamer absenken.',
  },
  {
    id: 'reverse_lunge', name: 'Ausfallschritt rückwärts', category: 'strength', difficulty: 1,
    muscles: ['Oberschenkel', 'Gesäß', 'Balance'], equipment: 'ohne',
    steps: [
      'Aufrechter Stand, Hände an der Hüfte oder locker.',
      'Mit einem Bein einen großen Schritt nach hinten.',
      'Beide Knie beugen, das hintere Knie sinkt Richtung Boden.',
      'Über die vordere Ferse zurück in den Stand, Seite wechseln.',
    ],
    tip: 'Knieschonender als der Schritt nach vorn – guter Einstieg. 3×8–10 je Seite.',
    caution: 'Vorderes Knie bleibt über dem Fuß; bei Gleichgewichtsproblemen an der Wand festhalten.',
    progression: 'Mit Kurzhanteln, dann von einer Stufe nach hinten (Defizit).',
  },
  {
    id: 'side_lunge', name: 'Seitliche Kniebeuge (Side Lunge)', category: 'strength', difficulty: 2,
    muscles: ['Innenschenkel', 'Oberschenkel', 'Gesäß'], equipment: 'ohne',
    steps: [
      'Breiter Stand, Fußspitzen zeigen nach vorn.',
      'Gewicht zu einer Seite verlagern und das Knie beugen, Hüfte nach hinten.',
      'Das andere Bein bleibt gestreckt, beide Fersen am Boden.',
      'Zur Mitte zurückdrücken und die Seite wechseln.',
    ],
    tip: 'Kräftigt die Beine seitlich – wichtig für Richtungswechsel im Fußball. 3×8 je Seite.',
    caution: 'Nur so tief, wie die Fersen am Boden bleiben; das Knie zeigt über den Fuß.',
    progression: 'Tiefer, dann mit Gewicht vor der Brust.',
  },
  {
    id: 'single_leg_deadlift', name: 'Einbeiniges Kreuzheben', category: 'strength', difficulty: 3,
    muscles: ['Gesäß', 'hintere Oberschenkel', 'Balance'], equipment: 'ohne (optional Kurzhantel)',
    steps: [
      'Auf einem Bein stehen, Knie leicht gebeugt.',
      'Oberkörper nach vorn kippen, das freie Bein nach hinten anheben.',
      'Rücken und hinteres Bein bilden eine Linie, das Becken bleibt waagerecht.',
      'Über das Gesäß langsam aufrichten.',
    ],
    tip: 'Kräftigt Gesäß und Gleichgewicht – sehr laufnah. 3×8 je Seite.',
    caution: 'Becken nicht aufdrehen; bei Rückenschmerzen nur bis zur Waagerechten.',
    progression: 'Mit Kurzhantel in der Hand der Gegenseite.',
  },
  {
    id: 'hip_thrust', name: 'Hip Thrust an der Bank', category: 'strength', difficulty: 2,
    muscles: ['Gesäß', 'hintere Oberschenkel'], equipment: 'Bank oder Sofa',
    steps: [
      'Mit den Schulterblättern an eine Bank lehnen, Füße hüftbreit aufstellen.',
      'Becken heben, bis Knie, Hüfte und Schultern eine Linie bilden.',
      'Oben den Po fest anspannen, Kinn leicht zur Brust.',
      'Kontrolliert absenken, ohne ganz abzulegen.',
    ],
    tip: 'Die kräftigste Übung fürs Gesäß. 3×10–12.',
    caution: 'Kein Hohlkreuz oben – die Kraft kommt aus dem Gesäß.',
    progression: 'Einbeinig, dann mit Gewicht auf der Hüfte.',
  },
  {
    id: 'single_leg_bridge', name: 'Einbeiniges Hüftheben', category: 'strength', difficulty: 2,
    muscles: ['Gesäß', 'hintere Oberschenkel', 'Rumpf'], equipment: 'Matte',
    steps: [
      'Rückenlage, ein Fuß aufgestellt, das andere Bein gestreckt in der Luft.',
      'Über die Ferse das Becken heben.',
      'Das Becken bleibt waagerecht, oben kurz halten.',
      'Langsam absenken, Seite wechseln.',
    ],
    tip: 'Zeigt schnell Seitenunterschiede. 3×10 je Seite.',
    caution: 'Becken nicht seitlich absinken lassen; bei Krampf in der Rückseite den Fuß näher ans Gesäß.',
    progression: 'Länger oben halten, dann Fuß erhöht.',
  },
  {
    id: 'kettlebell_swing', name: 'Kettlebell-Swing', category: 'strength', difficulty: 3,
    muscles: ['Gesäß', 'hintere Oberschenkel', 'Rumpf'], equipment: 'Kettlebell',
    steps: [
      'Etwas mehr als hüftbreit stehen, Kettlebell mit beiden Händen.',
      'Hüfte nach hinten schieben, die Kettlebell zwischen den Beinen nach hinten schwingen.',
      'Hüfte explosiv nach vorn strecken – die Arme sind nur Seile.',
      'Die Kettlebell schwebt bis Brusthöhe und fällt zurück in den nächsten Schwung.',
    ],
    tip: 'Kraft und Kondition in einem – fester Bestandteil im Hyrox-Training. 3×15.',
    caution: 'Rücken bleibt gerade, nicht aus den Armen ziehen; erst die Hüftbeuge sicher können.',
    progression: 'Schwerere Kettlebell, dann einarmig.',
  },
  {
    id: 'jump_squat', name: 'Sprungkniebeuge', category: 'strength', difficulty: 2,
    muscles: ['Oberschenkel', 'Gesäß', 'Waden'], equipment: 'ohne',
    steps: [
      'Halbe Kniebeuge, Arme hinten.',
      'Explosiv nach oben springen, die Arme schwingen mit.',
      'Weich auf dem Vorfuß landen und direkt in die nächste Kniebeuge.',
      'Die Knie zeigen bei der Landung über die Füße.',
    ],
    tip: 'Schnellkraft für Antritte und Sprünge. 3×8–10.',
    caution: 'Nur mit gesunden Knien und auf festem, rutschfestem Boden; leise landen.',
    progression: 'Mehr Wiederholungen, dann Sprünge auf eine Kiste.',
  },
  {
    id: 'good_morning', name: 'Good Morning (Hüftbeuge)', category: 'strength', difficulty: 2,
    muscles: ['hintere Oberschenkel', 'Gesäß', 'unterer Rücken'], equipment: 'ohne (optional Stab)',
    steps: [
      'Hüftbreiter Stand, Hände hinter dem Kopf.',
      'Knie leicht beugen, Hüfte nach hinten schieben und den geraden Oberkörper vorneigen.',
      'Bis etwa zur Waagerechten oder bis es hinten zieht.',
      'Über die Hüfte wieder aufrichten.',
    ],
    tip: 'Lernt die Hüftbeuge ohne Gewicht – gute Vorbereitung fürs Kreuzheben. 3×10–12.',
    caution: 'Der Rücken bleibt gerade, nicht rund werden; bei Rückenschmerzen weglassen.',
    progression: 'Mit Stab oder leichtem Gewicht auf den Schultern.',
  },
  {
    id: 'tibialis_raise', name: 'Schienbeinheben an der Wand', category: 'strength', difficulty: 1, prevention: true,
    muscles: ['Schienbeinmuskel (vorderer Unterschenkel)'], equipment: 'Wand',
    steps: [
      'Mit dem Rücken an die Wand lehnen, die Füße etwa eine Fußlänge davor.',
      'Die Fersen bleiben am Boden, die Zehen kräftig Richtung Schienbein ziehen.',
      'Oben kurz halten.',
      'Langsam wieder absenken.',
    ],
    tip: 'Stärkt die Vorderseite des Unterschenkels – hilft gegen Schienbeinkantenschmerzen. 3×15–20.',
    caution: 'Bei akuten Schienbeinschmerzen nur schmerzfrei üben und abklären lassen.',
    progression: 'Füße weiter vor die Wand, dann einbeinig.',
  },
  {
    id: 'step_down', name: 'Step-down (langsames Absenken)', category: 'strength', difficulty: 2, prevention: true,
    muscles: ['Oberschenkel', 'Gesäß', 'Kniestabilität'], equipment: 'Stufe oder Treppe',
    steps: [
      'Auf einem Bein auf einer Stufe stehen, das andere Bein hängt vor der Kante.',
      'Langsam in die Knie gehen, bis die Ferse des freien Beins den Boden antippt.',
      'Das Knie bleibt über dem Fuß, das Becken waagerecht.',
      'Über die Ferse des Standbeins wieder hochdrücken.',
    ],
    tip: 'Schult die Kniestabilität beim Bergablaufen. 3×8 je Seite, langsam (3 s runter).',
    caution: 'Das Knie darf nicht nach innen kippen; bei Kniescheibenschmerzen eine niedrigere Stufe.',
    progression: 'Höhere Stufe, dann mit Gewicht in der Gegenhand.',
  },
  {
    id: 'cossack_squat', name: 'Kosaken-Kniebeuge', category: 'strength', difficulty: 3,
    muscles: ['Innenschenkel', 'Oberschenkel', 'Hüftbeweglichkeit'], equipment: 'ohne',
    steps: [
      'Sehr breiter Stand, Fußspitzen leicht nach außen.',
      'Gewicht auf eine Seite und tief in diese Kniebeuge sinken.',
      'Das andere Bein bleibt gestreckt, die Zehen dürfen nach oben zeigen.',
      'Über die Mitte zur anderen Seite wechseln.',
    ],
    tip: 'Kraft und Beweglichkeit der Hüfte in einem. 3×6 je Seite.',
    caution: 'Nur so tief, wie die Ferse am Boden bleibt; nicht ruckartig.',
    progression: 'Tiefer, dann mit leichtem Gewicht vor der Brust.',
  },
  {
    id: 'farmers_carry', name: 'Farmers Walk (Tragen)', category: 'strength', difficulty: 2,
    muscles: ['Griffkraft', 'Schultern', 'Rumpf'], equipment: 'zwei schwere Kurzhanteln oder Kettlebells',
    steps: [
      'Zwei schwere Gewichte seitlich greifen und aufrecht hinstellen.',
      'Schultern tief und zurück, Bauch fest.',
      'Mit kurzen, ruhigen Schritten gehen – der Oberkörper schwankt nicht.',
      '30 bis 40 Meter oder 30 Sekunden, dann ablegen.',
    ],
    tip: 'Griffkraft und Rumpfstabilität – eine Hyrox-Station. 3×30 s.',
    caution: 'Gewichte mit geradem Rücken aufheben und ablegen.',
    progression: 'Schwerer, dann länger oder einseitig (Koffer-Tragen).',
  },
  {
    id: 'wall_ball', name: 'Wall Ball', category: 'strength', difficulty: 3,
    muscles: ['Oberschenkel', 'Gesäß', 'Schultern'], equipment: 'Medizinball und Wand',
    steps: [
      'Etwa eine Armlänge vor der Wand stehen, Ball vor der Brust.',
      'Tief in die Kniebeuge.',
      'Explosiv strecken und den Ball an ein Ziel hoch an der Wand werfen.',
      'Ball fangen und direkt in die nächste Kniebeuge.',
    ],
    tip: 'Ganzkörper und Kondition – eine Hyrox-Station. 3×15.',
    caution: 'Rücken gerade, Knie über den Füßen; zum Lernen ein leichter Ball.',
    progression: 'Schwerer Ball, höheres Ziel, mehr Wiederholungen.',
  },
  {
    id: 'thruster', name: 'Thruster', category: 'strength', difficulty: 3,
    muscles: ['Oberschenkel', 'Gesäß', 'Schultern'], equipment: 'zwei Kurzhanteln',
    steps: [
      'Hanteln auf den Schultern, schulterbreiter Stand.',
      'In die Kniebeuge, die Ellbogen zeigen nach vorn.',
      'Aus den Beinen hochdrücken und die Hanteln in einem Zug über den Kopf.',
      'Zurück auf die Schultern und direkt in die nächste Kniebeuge.',
    ],
    tip: 'Kraft aus den Beinen auf die Arme übertragen – fordert auch die Ausdauer. 3×10.',
    caution: 'Kein Hohlkreuz über Kopf; bei Schulterschmerzen weglassen.',
    progression: 'Schwerere Hanteln, dann mehr Runden.',
  },
  {
    id: 'incline_pushup', name: 'Liegestütz an der Bank', category: 'strength', difficulty: 1,
    muscles: ['Brust', 'Schultern', 'Trizeps'], equipment: 'Bank, Tisch oder Fensterbank',
    steps: [
      'Hände etwas weiter als schulterbreit auf eine stabile Kante.',
      'Der Körper bildet von Kopf bis Fuß eine Linie.',
      'Brust zur Kante senken, Ellbogen schräg nach hinten.',
      'Kraftvoll hochdrücken.',
    ],
    tip: 'Der leichte Einstieg in den Liegestütz – je höher die Kante, desto leichter. 3×10–15.',
    caution: 'Die Kante muss rutschfest sein; die Hüfte nicht durchhängen lassen.',
    progression: 'Niedrigere Kante, dann Knie-Liegestütz, dann voller Liegestütz.',
  },
  {
    id: 'knee_pushup', name: 'Knie-Liegestütz', category: 'strength', difficulty: 1,
    muscles: ['Brust', 'Schultern', 'Trizeps', 'Rumpf'], equipment: 'Matte',
    steps: [
      'Knie auf der Matte, Hände etwas weiter als schulterbreit.',
      'Von Knie bis Kopf eine gerade Linie.',
      'Brust kontrolliert zum Boden senken.',
      'Hochdrücken, ohne in der Hüfte abzuknicken.',
    ],
    tip: 'Zwischenstufe zum vollen Liegestütz. 3×8–12.',
    caution: 'Knie polstern; die Hüfte bleibt in Linie und wird nicht nach oben geschoben.',
    progression: 'Mehr Wiederholungen, dann einzelne volle Liegestütze.',
  },
  {
    id: 'pike_pushup', name: 'Pike Push-up (Schulter-Liegestütz)', category: 'strength', difficulty: 3,
    muscles: ['Schultern', 'Trizeps'], equipment: 'ohne',
    steps: [
      'Aus dem Liegestütz die Hüfte hoch schieben – ein umgekehrtes V.',
      'Hände schulterbreit, der Kopf zwischen den Armen.',
      'Ellbogen beugen und den Kopf Richtung Boden vor die Hände senken.',
      'Kraftvoll zurückdrücken.',
    ],
    tip: 'Schulterkraft ohne Hanteln. 3×6–8.',
    caution: 'Nicht bei Schulter- oder Nackenschmerzen; langsam absenken.',
    progression: 'Füße erhöht, dann tiefer.',
  },
  {
    id: 'bench_dip', name: 'Dips an der Bank', category: 'strength', difficulty: 2,
    muscles: ['Trizeps', 'Schultern', 'Brust'], equipment: 'Bank oder stabiler Stuhl',
    steps: [
      'Hände schulterbreit auf die Kante hinter dir, die Finger zeigen nach vorn.',
      'Beine nach vorn, das Gesäß knapp vor der Kante.',
      'Ellbogen nach hinten beugen und den Körper absenken.',
      'Über die Arme hochdrücken.',
    ],
    tip: 'Trizeps mit dem eigenen Körpergewicht. 3×8–12.',
    caution: 'Nicht tiefer, als die Oberarme waagerecht sind; bei Schulterschmerzen weglassen.',
    progression: 'Beine weiter strecken, dann Füße erhöht.',
  },
  {
    id: 'biceps_curl', name: 'Bizeps-Curl', category: 'strength', difficulty: 1,
    muscles: ['Bizeps', 'Unterarme'], equipment: 'Kurzhanteln oder Theraband',
    steps: [
      'Aufrecht stehen, Hanteln mit nach vorn zeigenden Handflächen.',
      'Die Ellbogen bleiben seitlich am Körper.',
      'Hanteln zur Schulter beugen.',
      'Langsam wieder strecken.',
    ],
    tip: 'Einfach und gut dosierbar. 3×10–12.',
    caution: 'Nicht mit Schwung aus dem Rücken arbeiten.',
    progression: 'Schwerere Hanteln, dann langsamer absenken (3 s).',
  },
  {
    id: 'triceps_extension', name: 'Trizepsdrücken über Kopf', category: 'strength', difficulty: 2,
    muscles: ['Trizeps'], equipment: 'eine Kurzhantel',
    steps: [
      'Aufrecht stehen, eine Hantel mit beiden Händen über dem Kopf.',
      'Die Oberarme bleiben neben dem Kopf.',
      'Die Hantel hinter den Kopf senken.',
      'Arme wieder strecken.',
    ],
    tip: 'Kräftigt die Rückseite der Oberarme. 3×10–12.',
    caution: 'Kein Hohlkreuz, Bauch fest; bei Schulterschmerzen leichter oder weglassen.',
    progression: 'Schwerere Hantel, dann einarmig.',
  },
  {
    id: 'lateral_raise', name: 'Seitheben', category: 'strength', difficulty: 1,
    muscles: ['seitliche Schulter'], equipment: 'leichte Kurzhanteln',
    steps: [
      'Aufrecht stehen, Hanteln seitlich, Ellbogen leicht gebeugt.',
      'Die Arme seitlich bis Schulterhöhe heben.',
      'Die Schultern bleiben tief und werden nicht hochgezogen.',
      'Langsam absenken.',
    ],
    tip: 'Leichtes Gewicht reicht – die Technik zählt. 3×12–15.',
    caution: 'Nicht über Schulterhöhe und ohne Schwung; bei Schulterschmerzen weglassen.',
    progression: 'Etwas schwerer, dann oben 1 s halten.',
  },
  {
    id: 'band_pull_apart', name: 'Band auseinanderziehen (Pull-Apart)', category: 'strength', difficulty: 1,
    muscles: ['oberer Rücken', 'hintere Schulter'], equipment: 'Theraband',
    steps: [
      'Band schulterbreit greifen, Arme vor der Brust ausgestreckt.',
      'Das Band auseinanderziehen, bis die Arme seitlich ausgebreitet sind.',
      'Schulterblätter zusammen, Schultern tief.',
      'Langsam zurückführen.',
    ],
    tip: 'Gegen die runde Schreibtischhaltung – geht auch zwischendurch. 3×15.',
    caution: 'Nicht ins Hohlkreuz ausweichen, das Band nicht zurückschnellen lassen.',
    progression: 'Stärkeres Band, dann oben 2 s halten.',
  },
  {
    id: 'pullup', name: 'Klimmzug', category: 'strength', difficulty: 3,
    muscles: ['breiter Rückenmuskel', 'Bizeps', 'Griffkraft'], equipment: 'Klimmzugstange',
    steps: [
      'Die Stange etwas weiter als schulterbreit greifen und hängen.',
      'Die Schultern aktiv nach unten ziehen.',
      'Brust zur Stange ziehen, bis das Kinn darüber ist.',
      'Langsam wieder ablassen.',
    ],
    tip: 'Anfangs mit einem Band als Hilfe oder nur das langsame Ablassen üben. 3×3–8.',
    caution: 'Nicht mit Schwung; bei Schulterschmerzen weglassen.',
    progression: 'Vom langsamen Ablassen zum ersten ganzen Klimmzug, dann mehr Wiederholungen.',
  },
  {
    id: 'inverted_row', name: 'Rudern am Tisch (umgekehrtes Rudern)', category: 'strength', difficulty: 2,
    muscles: ['oberer Rücken', 'Bizeps', 'Rumpf'], equipment: 'stabiler Tisch oder Stange',
    steps: [
      'Unter einen stabilen Tisch oder eine tiefe Stange legen, die Kante greifen.',
      'Die Fersen bleiben am Boden, der Körper bildet eine Linie.',
      'Brust zur Kante ziehen, Schulterblätter zusammen.',
      'Langsam ablassen.',
    ],
    tip: 'Zug-Übung ohne Geräte – gleicht Liegestütze aus. 3×8–12.',
    caution: 'Vorher prüfen, dass Tisch oder Stange sicher tragen.',
    progression: 'Füße weiter vorn bzw. erhöht.',
  },
  {
    id: 'single_arm_row', name: 'Einarmiges Rudern an der Bank', category: 'strength', difficulty: 2,
    muscles: ['oberer Rücken', 'Bizeps', 'hintere Schulter'], equipment: 'Kurzhantel und Bank',
    steps: [
      'Ein Knie und dieselbe Hand auf die Bank, der Rücken waagerecht.',
      'Die Hantel hängt in der freien Hand.',
      'Den Ellbogen nah am Körper Richtung Hüfte ziehen.',
      'Langsam ablassen, Seite wechseln.',
    ],
    tip: 'Rückenkraft mit sicher abgestütztem Rücken. 3×10 je Seite.',
    caution: 'Der Rücken bleibt gerade und dreht nicht auf.',
    progression: 'Schwerere Hantel, dann oben 1 s halten.',
  },
  {
    id: 'side_lying_leg_raise', name: 'Seitliches Beinheben (liegend)', category: 'strength', difficulty: 1, prevention: true,
    muscles: ['seitliches Gesäß', 'Hüftabduktoren'], equipment: 'Matte (optional Miniband)',
    steps: [
      'Seitenlage, der Kopf liegt auf dem unteren Arm, Beine gestreckt.',
      'Das obere Bein gestreckt anheben, die Zehen zeigen nach vorn.',
      'Das Becken kippt nicht nach hinten.',
      'Langsam absenken, Seite wechseln.',
    ],
    tip: 'Stabilisiert Becken und Knie beim Laufen. 3×15 je Seite.',
    caution: 'Nur so hoch, wie das Becken ruhig bleibt.',
    progression: 'Mit Miniband, dann oben 2 s halten.',
  },
  {
    id: 'donkey_kick', name: 'Donkey Kick (Vierfüßler)', category: 'strength', difficulty: 1,
    muscles: ['Gesäß'], equipment: 'Matte',
    steps: [
      'Vierfüßlerstand, Knie unter der Hüfte.',
      'Ein Bein angewinkelt lassen und die Ferse Richtung Decke drücken.',
      'Kein Hohlkreuz, das Becken bleibt gerade.',
      'Langsam zurück, Seite wechseln.',
    ],
    tip: 'Gezielt fürs Gesäß, schont den Rücken. 3×12 je Seite.',
    caution: 'Nur so hoch, wie der Rücken gerade bleibt.',
    progression: 'Mit Miniband über den Knien oder Gewichtsmanschette.',
  },

  /* ---------- seit 3.22.0: weitere Rumpfübungen ---------- */
  {
    id: 'bicycle_crunch', name: 'Fahrrad-Crunch', category: 'core', difficulty: 2,
    muscles: ['seitliche und gerade Bauchmuskeln'], equipment: 'Matte',
    steps: [
      'Rückenlage, Hände locker hinter dem Kopf, Schultern leicht angehoben.',
      'Ein Knie zur Brust ziehen, das andere Bein strecken.',
      'Den Gegenellbogen Richtung angezogenes Knie drehen.',
      'Fließend die Seite wechseln.',
    ],
    tip: 'Langsam ist wirksamer als schnell. 3×10 je Seite.',
    caution: 'Nicht am Kopf ziehen; bei Rückenschmerzen das gestreckte Bein höher halten.',
    progression: 'Langsamer, das gestreckte Bein tiefer.',
  },
  {
    id: 'russian_twist', name: 'Russian Twist', category: 'core', difficulty: 2,
    muscles: ['seitliche Bauchmuskeln', 'Rumpf'], equipment: 'ohne (optional Gewicht)',
    steps: [
      'Aufrecht sitzen, Knie gebeugt, Oberkörper leicht zurückgelehnt.',
      'Hände vor der Brust zusammen.',
      'Den Oberkörper zu einer Seite drehen, Hände Richtung Boden neben der Hüfte.',
      'Zur anderen Seite drehen, der Rücken bleibt lang.',
    ],
    tip: 'Aus dem Rumpf drehen, nicht nur die Arme schwingen. 3×10 je Seite.',
    caution: 'Bei Rückenschmerzen die Füße am Boden lassen und weniger weit drehen.',
    progression: 'Füße anheben, dann mit Gewicht.',
  },
  {
    id: 'reverse_crunch', name: 'Reverse Crunch', category: 'core', difficulty: 2,
    muscles: ['untere Bauchmuskeln'], equipment: 'Matte',
    steps: [
      'Rückenlage, Arme neben dem Körper, Knie über der Hüfte angewinkelt.',
      'Das Becken einrollen und die Knie Richtung Brust ziehen.',
      'Ohne Schwung, der Kopf bleibt liegen.',
      'Langsam ablegen.',
    ],
    tip: 'Kräftigt den unteren Bauch rückenfreundlich. 3×10–12.',
    caution: 'Keine Schwungbewegung; bei Nackenbeschwerden den Kopf bewusst liegen lassen.',
    progression: 'Langsamer, oben 1 s halten.',
  },
  {
    id: 'shoulder_tap', name: 'Liegestütz mit Schultertippen', category: 'core', difficulty: 2,
    muscles: ['Rumpf', 'Schultern'], equipment: 'ohne',
    steps: [
      'Hoher Liegestütz, Füße etwas weiter als hüftbreit.',
      'Eine Hand tippt die gegenüberliegende Schulter an.',
      'Die Hüfte bleibt ruhig und schaukelt nicht.',
      'Abwechselnd weiter.',
    ],
    tip: 'Gegen das Verdrehen – für einen stabilen Rumpf. 3×10 je Seite.',
    caution: 'Bei Handgelenksbeschwerden auf Fäusten oder erhöht üben.',
    progression: 'Füße enger, dann langsamer.',
  },
  {
    id: 'bear_plank', name: 'Bärenstand (Bear Hold)', category: 'core', difficulty: 2,
    muscles: ['Rumpf', 'Oberschenkel', 'Schultern'], equipment: 'ohne',
    steps: [
      'Vierfüßlerstand, Zehen aufgestellt.',
      'Die Knie wenige Zentimeter vom Boden abheben.',
      'Der Rücken bleibt flach wie ein Tisch.',
      'Ruhig atmend halten.',
    ],
    tip: 'Rumpfspannung, die schnell spürbar wird. 3×20–40 s.',
    caution: 'Die Knie nur knapp anheben, den Rücken nicht rund machen.',
    progression: 'Länger halten, dann im Bärengang vorwärts.',
  },
  {
    id: 'v_up', name: 'V-Up (Klappmesser)', category: 'core', difficulty: 3,
    muscles: ['gerade Bauchmuskeln', 'Hüftbeuger'], equipment: 'Matte',
    steps: [
      'Rückenlage, Arme über dem Kopf, Beine gestreckt.',
      'Arme und Beine gleichzeitig heben – die Hände greifen Richtung Füße.',
      'Oben kurz das V halten.',
      'Langsam ablegen.',
    ],
    tip: 'Anspruchsvoll – erst Crunch und Beinheben sicher können. 3×8–10.',
    caution: 'Nicht bei Rückenschmerzen; ohne Schwung.',
    progression: 'Langsamer, oben 1 s halten.',
  },
  {
    id: 'flutter_kicks', name: 'Flutter Kicks (Beinschlag)', category: 'core', difficulty: 2,
    muscles: ['untere Bauchmuskeln', 'Hüftbeuger'], equipment: 'Matte',
    steps: [
      'Rückenlage, Hände neben oder unter dem Gesäß.',
      'Die Beine gestreckt knapp über dem Boden.',
      'Kleine, schnelle Auf- und Abschläge im Wechsel.',
      'Der untere Rücken bleibt am Boden.',
    ],
    tip: 'Kurz und sauber statt lang und im Hohlkreuz. 3×20–30 s.',
    caution: 'Hebt sich der untere Rücken, die Beine höher halten.',
    progression: 'Beine tiefer, dann länger.',
  },
  {
    id: 'glute_bridge_march', name: 'Hüftheben mit Marschieren', category: 'core', difficulty: 2,
    muscles: ['Gesäß', 'Rumpf'], equipment: 'Matte',
    steps: [
      'Aus der Rückenlage das Becken in die Brücke heben.',
      'Abwechselnd ein Knie anheben, als würdest du marschieren.',
      'Das Becken bleibt oben und gerade.',
      'Nach den Wiederholungen langsam ablegen.',
    ],
    tip: 'Verbindet Gesäßkraft und Beckenstabilität. 3×8 je Seite.',
    caution: 'Das Becken nicht seitlich absinken lassen; die Bewegung langsam.',
    progression: 'Länger halten, Füße weiter weg.',
  },

  /* ---------- seit 3.22.0: weitere Beweglichkeit ---------- */
  {
    id: 'worlds_greatest_stretch', name: 'World’s Greatest Stretch', category: 'mobility', difficulty: 2,
    muscles: ['Hüfte', 'Brustwirbelsäule', 'hintere Oberschenkel'], equipment: 'ohne',
    steps: [
      'Tiefer Ausfallschritt, beide Hände innen neben dem vorderen Fuß.',
      'Den inneren Ellbogen Richtung vorderen Fuß senken.',
      'Den Arm dann zur Decke drehen, der Blick folgt.',
      'Zurück und die Seite wechseln.',
    ],
    tip: 'Mobilisiert Hüfte und Rücken in einem – ideal zum Aufwärmen. 4–5 je Seite.',
    caution: 'Nur im schmerzfreien Bereich; das hintere Knie bei Bedarf ablegen.',
    progression: 'In jeder Position länger atmen.',
  },
  {
    id: 'downward_dog', name: 'Herabschauender Hund', category: 'mobility', difficulty: 1,
    muscles: ['Waden', 'hintere Oberschenkel', 'Schultern'], equipment: 'Matte',
    steps: [
      'Aus dem Vierfüßlerstand die Zehen aufstellen.',
      'Die Hüfte nach oben und hinten schieben – ein umgekehrtes V.',
      'Rücken lang, die Fersen sinken Richtung Boden, die Knie dürfen gebeugt sein.',
      'Ruhig atmend halten.',
    ],
    tip: 'Dehnt die ganze Körperrückseite. 3×30 s.',
    caution: 'Bei Handgelenks- oder Schulterbeschwerden auf den Unterarmen üben.',
    progression: 'Länger halten, abwechselnd die Fersen senken.',
  },
  {
    id: 'cobra', name: 'Kobra', category: 'mobility', difficulty: 1,
    muscles: ['Bauch', 'Wirbelsäule', 'Hüftbeuger'], equipment: 'Matte',
    steps: [
      'Bauchlage, Hände neben den Schultern.',
      'Die Brust langsam anheben, das Becken bleibt am Boden.',
      'Schultern tief, Blick nach vorn.',
      'Kurz halten und ablegen.',
    ],
    tip: 'Sanfte Streckung nach langem Sitzen. 6–8 Wiederholungen.',
    caution: 'Nur so weit, wie es im unteren Rücken angenehm bleibt.',
    progression: 'Länger halten, die Arme weiter strecken.',
  },
  {
    id: 'quad_stretch', name: 'Oberschenkel-Vorderseite dehnen', category: 'mobility', difficulty: 1,
    muscles: ['vorderer Oberschenkel', 'Hüftbeuger'], equipment: 'ohne (optional Wand)',
    steps: [
      'Aufrecht auf einem Bein stehen, bei Bedarf an der Wand festhalten.',
      'Die Ferse des anderen Beins zum Gesäß ziehen.',
      'Das Knie zeigt nach unten, die Hüfte leicht nach vorn.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Der Klassiker nach dem Laufen. 2×30 s je Seite.',
    caution: 'Nicht ins Hohlkreuz ausweichen; bei Kniebeschwerden mit Handtuch um den Fuß.',
    progression: 'Länger halten, das Becken bewusst einrollen.',
  },
  {
    id: 'pigeon_pose', name: 'Taube (Hüftöffner)', category: 'mobility', difficulty: 2,
    muscles: ['Gesäß', 'Hüfte'], equipment: 'Matte',
    steps: [
      'Aus dem Vierfüßlerstand ein Knie nach vorn zwischen die Hände bringen, der Unterschenkel liegt quer.',
      'Das hintere Bein lang nach hinten strecken.',
      'Die Hüfte sinkt Richtung Boden, der Oberkörper aufrecht oder nach vorn abgelegt.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Tiefe Gesäßdehnung – angenehm nach langen Läufen. 2×30–45 s je Seite.',
    caution: 'Bei Knieschmerzen den Unterschenkel weniger quer legen oder die Vierer-Dehnung nehmen.',
    progression: 'Oberkörper weiter vorn ablegen, länger halten.',
  },
  {
    id: 'leg_swings', name: 'Beinpendel', category: 'mobility', difficulty: 1,
    muscles: ['Hüfte', 'hintere Oberschenkel'], equipment: 'ohne (Wand zum Festhalten)',
    steps: [
      'Seitlich an eine Wand stellen und festhalten.',
      'Das äußere Bein locker nach vorn und hinten pendeln.',
      'Der Oberkörper bleibt ruhig und aufrecht.',
      'Schwung langsam steigern, dann Seite wechseln.',
    ],
    tip: 'Dynamisches Aufwärmen vor dem Laufen. 10–15 je Seite.',
    caution: 'Kontrolliert pendeln, nicht reißen.',
    progression: 'Größerer Bewegungsradius, auch seitlich vor dem Körper.',
  },
  {
    id: 'arm_circles', name: 'Armkreisen', category: 'mobility', difficulty: 1,
    muscles: ['Schultern', 'oberer Rücken'], equipment: 'ohne',
    steps: [
      'Aufrecht stehen, Arme lang.',
      'Große, langsame Kreise nach vorn.',
      'Dann die Richtung wechseln.',
      'Die Schultern bleiben locker.',
    ],
    tip: 'Lockert die Schultern vor dem Training. 10 je Richtung.',
    caution: 'Im schmerzfreien Bereich bleiben.',
    progression: 'Größere Kreise, auch einarmig.',
  },
  {
    id: 'ankle_rocks', name: 'Sprunggelenk an der Wand (Knie zur Wand)', category: 'mobility', difficulty: 1, prevention: true,
    muscles: ['Sprunggelenk', 'Wade'], equipment: 'Wand',
    steps: [
      'Halbknien vor einer Wand, der vordere Fuß etwa eine Handbreit davor.',
      'Das Knie Richtung Wand schieben, die Ferse bleibt am Boden.',
      'Kurz halten und zurück.',
      'Den Abstand langsam vergrößern, Seite wechseln.',
    ],
    tip: 'Mehr Beweglichkeit im Sprunggelenk für tiefe Kniebeugen und einen runden Laufschritt. 10 je Seite.',
    caution: 'Die Ferse bleibt unten; bei Schmerzen vorn im Gelenk weniger weit.',
    progression: 'Den Fuß weiter von der Wand weg.',
  },
  {
    id: 'neck_stretch', name: 'Nackendehnung', category: 'mobility', difficulty: 1,
    muscles: ['Nacken', 'obere Schulter'], equipment: 'ohne',
    steps: [
      'Aufrecht stehen oder sitzen, Schultern locker.',
      'Ein Ohr Richtung Schulter neigen.',
      'Die Hand derselben Seite liegt sanft auf dem Kopf – nicht ziehen.',
      'Halten, dann Seite wechseln.',
    ],
    tip: 'Entspannt nach langem Sitzen. 2×20 s je Seite.',
    caution: 'Nur sanft; bei Kribbeln in den Armen sofort lösen.',
    progression: 'Die Gegenschulter aktiv nach unten schieben.',
  },
  {
    id: 'side_bend_stretch', name: 'Seitliche Rumpfdehnung', category: 'mobility', difficulty: 1,
    muscles: ['seitlicher Rumpf', 'breiter Rückenmuskel'], equipment: 'ohne',
    steps: [
      'Hüftbreiter Stand, eine Hand an der Hüfte.',
      'Den anderen Arm über den Kopf strecken.',
      'Zur Seite neigen, ohne nach vorn zu kippen.',
      'Kurz halten, aufrichten, Seite wechseln.',
    ],
    tip: 'Macht die Flanken lang – gut nach dem Sitzen. 4 je Seite.',
    caution: 'Nicht ins Hohlkreuz, das Becken bleibt mittig.',
    progression: 'Länger halten, den Arm weiter über den Kopf.',
  },
  {
    id: 'inchworm', name: 'Inchworm (Raupe)', category: 'mobility', difficulty: 2,
    muscles: ['hintere Oberschenkel', 'Schultern', 'Rumpf'], equipment: 'ohne',
    steps: [
      'Aus dem Stand nach vorn beugen, Hände auf den Boden.',
      'Mit den Händen nach vorn laufen bis in den Liegestütz.',
      'Kurz halten, dann mit den Händen zurücklaufen.',
      'Langsam aufrollen.',
    ],
    tip: 'Aufwärmen für den ganzen Körper. 5 Wiederholungen.',
    caution: 'Die Knie dürfen gebeugt sein; nicht bei akuten Rückenschmerzen.',
    progression: 'Im Liegestütz einen Liegestütz einbauen.',
  },
  {
    id: 'deep_squat_hold', name: 'Tiefe Hocke halten', category: 'mobility', difficulty: 2,
    muscles: ['Hüfte', 'Sprunggelenk', 'Rücken'], equipment: 'ohne',
    steps: [
      'Schulterbreiter Stand, Fußspitzen leicht nach außen.',
      'Tief in die Hocke sinken, die Fersen bleiben am Boden.',
      'Die Ellbogen drücken die Knie sanft nach außen, Brust offen.',
      'Ruhig atmend halten.',
    ],
    tip: 'Holt verlorene Beweglichkeit zurück. 3×30 s.',
    caution: 'Bei Knieschmerzen weniger tief, die Fersen bei Bedarf unterlegen.',
    progression: 'Länger halten, das Gewicht von Seite zu Seite verlagern.',
  },

  /* ---------- seit 3.22.0: Kondition ---------- */
  {
    id: 'jumping_jack', name: 'Hampelmann', category: 'cardio', difficulty: 1,
    muscles: ['Waden', 'Schultern', 'Kondition'], equipment: 'ohne',
    steps: [
      'Aufrecht stehen, Arme seitlich.',
      'Beine grätschen und gleichzeitig die Arme über den Kopf.',
      'Zurückspringen in die Ausgangsstellung.',
      'Leicht und federnd im Takt.',
    ],
    tip: 'Bringt den Kreislauf in Schwung. 3×20–30.',
    caution: 'Auf weichem Untergrund; bei Knie- oder Beckenbodenbeschwerden ohne Sprung (Schritt zur Seite).',
    progression: 'Schneller, dann länger.',
  },
  {
    id: 'high_knees', name: 'Kniehebelauf (High Knees)', category: 'cardio', difficulty: 2,
    muscles: ['Hüftbeuger', 'Waden', 'Kondition'], equipment: 'ohne',
    steps: [
      'Auf der Stelle laufen.',
      'Die Knie im schnellen Wechsel bis Hüfthöhe ziehen.',
      'Auf dem Vorfuß landen, die Arme schwingen mit.',
      'Der Oberkörper bleibt aufrecht.',
    ],
    tip: 'Kurz und intensiv – ideal im Intervall. 3×20 s.',
    caution: 'Nur aufgewärmt und auf rutschfestem Boden.',
    progression: 'Länger, dann schneller.',
  },
  {
    id: 'butt_kicks', name: 'Anfersen', category: 'cardio', difficulty: 1,
    muscles: ['hintere Oberschenkel', 'Waden', 'Kondition'], equipment: 'ohne',
    steps: [
      'Auf der Stelle laufen.',
      'Die Fersen im Wechsel Richtung Gesäß führen.',
      'Kurze, schnelle Bodenkontakte.',
      'Oberkörper aufrecht, die Arme schwingen locker.',
    ],
    tip: 'Lauf-ABC auf der Stelle. 3×20 s.',
    caution: 'Nur aufgewärmt und auf rutschfestem Boden.',
    progression: 'Höhere Frequenz, dann vorwärts.',
  },
  {
    id: 'burpee', name: 'Burpee', category: 'cardio', difficulty: 3,
    muscles: ['Ganzkörper', 'Kondition'], equipment: 'ohne',
    steps: [
      'Aus dem Stand in die Hocke, Hände auf den Boden.',
      'Die Füße nach hinten in den Liegestütz springen.',
      'Die Füße wieder heranspringen.',
      'Strecksprung mit den Armen nach oben, weich landen.',
    ],
    tip: 'Ganzkörper-Kondition – Bestandteil im Hyrox-Training. 3×8–10.',
    caution: 'Erst ohne Sprung lernen (Füße zurücksetzen); der Rücken bleibt im Liegestütz gerade.',
    progression: 'Mit Liegestütz am Boden, dann Burpee mit Weitsprung.',
  },
  {
    id: 'mountain_climber', name: 'Mountain Climber (Bergsteiger)', category: 'cardio', difficulty: 2,
    muscles: ['Rumpf', 'Hüftbeuger', 'Kondition'], equipment: 'ohne',
    steps: [
      'Hoher Liegestütz, Hände unter den Schultern.',
      'Ein Knie zur Brust ziehen.',
      'Im schnellen Wechsel die Beine tauschen.',
      'Die Hüfte bleibt tief und ruhig.',
    ],
    tip: 'Rumpf und Kondition in einem. 3×20–30 s.',
    caution: 'Bei Handgelenksbeschwerden erhöht an einer Bank üben.',
    progression: 'Schneller, dann länger.',
  },
  {
    id: 'skater_jump', name: 'Eisschnellläufer-Sprünge (Skater)', category: 'cardio', difficulty: 2,
    muscles: ['Gesäß', 'Oberschenkel', 'Balance'], equipment: 'ohne',
    steps: [
      'Auf einem Bein stehen, leicht gebeugt.',
      'Seitlich auf das andere Bein springen.',
      'Weich landen, das freie Bein schwingt hinter dem Standbein.',
      'Im Rhythmus hin und her.',
    ],
    tip: 'Seitliche Sprungkraft und Stabilität – gut für Fußball. 3×20–30 s.',
    caution: 'Das Knie zeigt bei der Landung über den Fuß, nicht nach innen.',
    progression: 'Weiter springen, bei der Landung kurz halten.',
  },
  {
    id: 'bear_crawl', name: 'Bärengang', category: 'cardio', difficulty: 2,
    muscles: ['Rumpf', 'Schultern', 'Oberschenkel'], equipment: 'ohne',
    steps: [
      'Bärenstand: Die Knie schweben knapp über dem Boden.',
      'Gegengleich Hand und Fuß ein kleines Stück vorsetzen.',
      'Der Rücken bleibt flach, die Hüfte ruhig.',
      'Vorwärts und zurück krabbeln.',
    ],
    tip: 'Koordination und Rumpfkraft – macht auch Kindern Spaß. 3×20–30 s.',
    caution: 'Kleine Schritte, die Knie knapp über dem Boden.',
    progression: 'Länger, dann rückwärts oder seitwärts.',
  },
]);

/** Übung per id finden. */
export function findExercise(id) { return EXERCISES.find((e) => e.id === id) || null; }

/** Filtert nach Kategorie, Körperregion ('all' = alle) und Freitext (Name/Muskeln). */
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

/** Begriffe, unter denen eine Übung in Text vorkommen kann (Name ohne Klammerzusatz + Aliasse). */
function termsOf(e) {
  return [e.name.replace(/\s*\(.*\)\s*$/, ''), ...(e.aliases || [])].filter((t) => t.length >= 4);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Übungen, die ein Text nennt (z. B. die Beschreibung einer Krafteinheit), in der
 * Reihenfolge ihres Auftretens. Ein Begriff zählt nur am Wortanfang – „Sprungkniebeuge“
 * ist keine „Kniebeuge“.
 */
export function exercisesInText(text = '') {
  return exerciseMentions(text).map((h) => h.e);
}

/** Wie exercisesInText, mit Fundstelle: [{ e, first }] – first = Index der ersten Nennung. */
export function exerciseMentions(text = '') {
  const hay = String(text || '');
  if (!hay.trim()) return [];
  const hits = [];
  for (const e of EXERCISES) {
    let first = Infinity;
    for (const term of termsOf(e)) {
      const m = new RegExp(`(?<![\\p{L}])${escapeRe(term)}`, 'iu').exec(hay);
      if (m && m.index < first) first = m.index;
    }
    if (first < Infinity) hits.push({ e, first });
  }
  // Bei gleicher Fundstelle („Rumänisches Kreuzheben“ vs. „Kreuzheben“) gewinnt die erste im Katalog.
  return hits.sort((x, y) => x.first - y.first);
}

/** Übungen, die zu einem Einheitstyp passen (für Vorschläge innerhalb der Einheit).
    Fußballtermine bekommen das Aufwärmen nach FIFA 11+ und die Präventionsübungen. */
export function suggestedExercisesFor(type) {
  if (type === 'cross_football' || type === 'match') return PREVENTION_IDS.map(findExercise).filter(Boolean);
  if (type === 'mobility' || type === 'recovery') return MOBILITY_CORE.map(findExercise).filter(Boolean);
  if (type === 'strength' || type === 'gym') return STRENGTH_CORE.map(findExercise).filter(Boolean);
  return [];
}

/* Seit dem großen Katalog (3.22.0) schlägt eine Einheit nicht mehr alles vor, sondern eine
   Auswahl der Grundübungen – dazu kommt, was ihre Beschreibung nennt (exercisesInText). */
const STRENGTH_CORE = ['squat', 'lunge', 'pushup', 'deadlift', 'row', 'overhead_press', 'calf_raise', 'glute_bridge',
  'step_up', 'split_squat', 'single_leg_deadlift', 'plank', 'side_plank', 'dead_bug', 'bird_dog', 'russian_twist'];
const MOBILITY_CORE = ['cat_cow', 'hip_flexor_stretch', 'hamstring_stretch', 'calf_stretch', 'chest_opener', 'child_pose',
  'supine_twist', 'figure_four', 'quad_stretch', 'worlds_greatest_stretch', 'downward_dog', 'pigeon_pose'];

/**
 * Übungen für eine Einheit: zuerst, was ihre Beschreibung nennt, dann die Vorschläge
 * zum Einheitstyp (nach Nutzung sortiert). Ohne Doppelte.
 */
export function exercisesForUnit(unit = {}, usage = {}) {
  const named = exercisesInText(`${unit.title || ''} · ${unit.description || ''}`);
  const seen = new Set(named.map((e) => e.id));
  const rest = sortByUsage(suggestedExercisesFor(unit.type), usage).filter((e) => !seen.has(e.id));
  return { named, suggested: rest, all: [...named, ...rest] };
}

/** Sortiert eine Übungsliste absteigend nach Nutzungshäufigkeit (usage: { id: count }). */
export function sortByUsage(list, usage = {}) {
  return list.slice().sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name));
}

/* --------------------------------- View --------------------------------- */

/** Geräte eines Workouts aus seinen Übungen („ohne Geräte“, wenn keine nötig sind). */
function workoutGear(w) {
  const gear = new Set();
  for (const id of workoutIds(w)) {
    const eq = String((findExercise(id) || {}).equipment || '');
    if (!eq || /^ohne|^Matte/i.test(eq)) continue;
    gear.add(eq.split(/ oder |,|\(/)[0].trim());
  }
  const list = [...gear];
  return list.length ? list.slice(0, 2).join(' · ') + (list.length > 2 ? ' …' : '') : 'ohne Geräte';
}

/** Titelbild je Workout: die erste Übung, die noch kein anderes Workout zeigt. */
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

/** Workouts als Katalog: Suche, Filter, Kacheln; Antippen öffnet die Session (workout-show.js). */
function renderWorkouts(view) {
  const search = input({ type: 'search', placeholder: 'Workout oder Übung suchen …', 'aria-label': 'Workouts durchsuchen', value: uiState.woQuery });
  search.addEventListener('input', () => { uiState.woQuery = search.value; draw(); });
  view.appendChild(el('div', { class: 'field mt-2' }, [search]));
  const chips = el('div', { class: 'mt-2', style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' } });
  const paintChips = () => {
    chips.innerHTML = '';
    for (const c of [{ key: 'all', label: 'Alle' }, ...WORKOUT_CATS]) {
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
      && (!q || [w.title, w.subtitle, ...workoutIds(w).map((id) => (findExercise(id) || {}).name || '')].some((t) => t.toLowerCase().includes(q))));
    if (!list.length) { grid.appendChild(el('div', { class: 'empty', text: 'Kein Workout passt zu dieser Suche.' })); return; }
    for (const w of list) {
      const first = coverOf(w);
      const cm = categoryMeta((findExercise(first) || {}).category);
      const min = el('span', { class: 'wo-card__min', text: minutes.get(w.id) || '' });
      grid.appendChild(el('button', { class: `wo-card wo-card--${w.style}`, type: 'button', dataset: { id: w.id }, onclick: () => playWorkout(w) }, [
        el('span', { class: 'wo-card__art', html: exerciseArt(first, { color: cm.color }) }),
        el('span', { class: 'wo-card__title', text: w.title }),
        el('span', { class: 'wo-card__sub', text: w.subtitle }),
        el('span', { class: 'wo-card__meta' }, [icon('play'), min, el('span', { text: ` · ${w.items.length} Übungen · ${difficultyLabel(w.level)}` })]),
        el('span', { class: 'wo-card__gear', text: workoutGear(w) }),
      ]));
    }
  }
  draw();
  // Dauer aus der echten Zeitleiste – nachgeladen, show-program.js braucht diesen Katalog.
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
function usageLabel(n) { return n > 0 ? `${n}× genutzt` : 'noch nicht genutzt'; }

export function render(view) {
  setHeader({ title: 'Übungs-Bibliothek', subtitle: `${EXERCISES.length} Übungen · ${WORKOUTS.length} Workouts zum Mitmachen` });
  view.innerHTML = '';
  // Zwei Kataloge: einzelne Übungen und fertige Workouts (am Stück, mit Musik).
  view.appendChild(el('div', { class: 'mt-2' }, [segmented([{ value: 'exercises', label: `Übungen (${EXERCISES.length})` }, { value: 'workouts', label: `Workouts (${WORKOUTS.length})` }],
    uiState.tab, (v) => { uiState.tab = v; render(view); }, { label: 'Katalog' })]));
  if (uiState.tab === 'workouts') { renderWorkouts(view); return; }

  const search = input({ type: 'search', placeholder: 'Übung oder Muskelgruppe suchen …', 'aria-label': 'Übungen durchsuchen', value: uiState.query });
  search.addEventListener('input', () => { uiState.query = search.value; drawGrid(); });
  view.appendChild(el('div', { class: 'field mt-2' }, [search]));

  const cats = [{ value: 'all', label: 'Alle' }, ...EX_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))];
  // Fünf Kategorien passen auf schmalen Handys nicht nebeneinander – die Leiste scrollt dann seitlich.
  view.appendChild(el('div', { class: 'mt-2', style: { overflowX: 'auto', paddingBottom: '2px' } }, [
    segmented(cats, uiState.category, (v) => { uiState.category = v; drawGrid(); }, { label: 'Kategorie' }),
  ]));

  // Zusätzlicher Körperregion-Filter (Chips, horizontal scrollbar).
  const regionRow = el('div', { class: 'mt-2', style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' } });
  const regionChips = [{ key: 'all', label: 'Alle Regionen' }, ...EX_REGIONS];
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
    if (!list.length) { grid.appendChild(el('p', { class: 'dim center', text: 'Keine Übung gefunden.' })); return; }
    list.forEach((e) => grid.appendChild(exerciseCard(e, usage[e.id] || 0)));
  }
  drawGrid();

  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: 'Symbolische Animationen – sie zeigen Grundbewegung und Takt, kein Ersatz für individuelle Anleitung.' }));
}

function exerciseCard(e, count = 0) {
  const cm = categoryMeta(e.category);
  return el('button', { class: 'ex-card', onclick: () => openDetail(e) }, [
    el('div', { class: 'ex-card__art', html: exerciseArt(e.art, { color: cm.color }) }),
    el('div', { class: 'ex-card__name', text: e.name }),
    el('div', { class: 'ex-card__meta' }, [
      el('span', { class: 'chip', style: { background: 'var(--surface-2)' }, text: cm.label }),
      el('span', { class: 'dim', style: { fontSize: '.72rem' }, text: difficultyLabel(e.difficulty) }),
      count > 0 ? el('span', { class: 'chip', title: `${count}× genutzt`, style: { background: cm.color, color: onAccent(cm.color), fontSize: '.72rem' }, text: `${count}×` }) : null,
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
    onclick: () => { count(); toast('Als gemacht gezählt', 'good'); },
  }, [icon('check'), 'Gemacht (+1)']);
  // Mitmach-Player: Vorschau in Schleife, „Mitmachen“ führt durch Sätze, Wiederholungen und Pausen.
  const playerHost = el('div', { class: 'ex-detail__player' });
  const body = el('div', {}, [
    m ? playerHost : el('div', { class: 'ex-detail__art', html: exerciseArt(e.art, { color: cm.color }) }),
    el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', marginTop: '6px' } }, [
      el('span', { class: 'chip', style: { background: cm.color, color: onAccent(cm.color) }, text: cm.label }),
      el('span', { class: 'chip', text: difficultyLabel(e.difficulty) }),
      el('span', { class: 'chip', text: '🛠 ' + e.equipment }),
      usedEl,
    ]),
    el('div', { class: 'dim mt-3', style: { fontSize: '.82rem' }, text: 'Beansprucht: ' + (e.muscles || []).join(', ') }),
    sectionHead('So geht’s'),
    el('ol', { class: 'ex-steps' }, (e.steps || []).map((s) => el('li', { text: s }))),
    el('div', { class: 'card card--flat mt-3 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: e.tip }),
    ]),
    e.progression ? el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('arrowRight'), style: { color: 'var(--good-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `Steigern: ${e.progression}` }),
    ]) : null,
    e.caution ? el('div', { class: 'card card--flat mt-2 row gap-2', style: { alignItems: 'flex-start', borderLeft: '3px solid var(--warn)' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--warn-text)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: `Vorsicht: ${e.caution}` }),
    ]) : null,
    doneBtn,
  ]);
  const player = m ? mountPlayer(playerHost, e, m, { color: cm.color, onDone: () => { count(); toast('Geschafft – als gemacht gezählt', 'good'); } }) : null;
  openSheet({ title: e.name, body, onClose: () => { if (player) player.stop(); } });
}

/** Öffnet das Detail-Sheet einer Übung per id (z. B. aus einer Trainingseinheit). */
export function openExercise(id) { const e = findExercise(id); if (e) openDetail(e); }
