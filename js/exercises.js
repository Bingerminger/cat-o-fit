/* =========================================================================
   exercises.js — Übungs-Bibliothek: Katalog (Kraft/Rumpf/Beweglichkeit) mit
   symbolhaften Illustrationen, Schritt-für-Schritt-Anleitung und Filter/Suche.

   Der Katalog + die Filterlogik sind DOM-frei und damit testbar; darunter die
   View (#/uebungen). Keine externen Daten, keine Bilder von Dritten.
   ========================================================================= */

import { el, icon, iconSvg, segmented, input, sectionHead, openSheet, toast } from './ui.js';
import { setHeader } from './router.js';
import { exerciseArt } from './exercise-art.js';
import { exerciseUsage, bumpExerciseUsage } from './storage.js';

/** Kategorien (Reihenfolge = Anzeigereihenfolge). */
export const EX_CATEGORIES = [
  { key: 'strength', label: 'Kraft', color: '#7c5cff' },
  { key: 'core', label: 'Rumpf', color: '#19b9c9' },
  { key: 'mobility', label: 'Beweglichkeit', color: '#2bb673' },
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
};
/** Regionen einer Übung (leer, wenn nicht zugeordnet). */
export function exerciseRegions(id) { return REGION_BY_ID[id] || []; }

/** Der Katalog. `art` verweist auf eine Figur in exercise-art.js. */
export const EXERCISES = [
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
    id: 'plank', name: 'Unterarmstütz (Plank)', category: 'core', art: 'plank', difficulty: 1,
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
    id: 'side_plank', name: 'Seitstütz', category: 'core', art: 'side_plank', difficulty: 2,
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
    tip: 'Weckt das oft „schlafende" Gesäß. 3×12–15, gerne einbeinig.',
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
    id: 'side_crunch', name: 'Standwaage seitlich', category: 'core', art: 'side_crunch', difficulty: 2,
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
      'Einatmen: Rücken sanft durchhängen lassen, Blick hoch („Kuh").',
      'Ausatmen: Rücken rund machen, Kinn zur Brust („Katze").',
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
    tip: 'Gegen die nach vorne gezogene „Bildschirm-Haltung". 2×20–30 s.',
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
    id: 'wall_sit', name: 'Wandsitz', category: 'strength', art: 'wall_sit', difficulty: 1,
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
    id: 'hollow_hold', name: 'Hollow Hold', category: 'core', art: 'hollow_hold', difficulty: 2,
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
      'Einen Knöchel über das andere Knie legen (Form einer „4").',
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
];

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
      || (e.muscles || []).some((m) => m.toLowerCase().includes(q))
      || categoryMeta(e.category).label.toLowerCase().includes(q);
  });
}

/** Übungen, die zu einem Einheitstyp passen (für Vorschläge innerhalb der Einheit). */
export function suggestedExercisesFor(type) {
  if (type === 'mobility' || type === 'recovery') return EXERCISES.filter((e) => e.category === 'mobility');
  if (type === 'strength' || type === 'gym') return EXERCISES.filter((e) => e.category === 'strength' || e.category === 'core');
  return [];
}

/** Sortiert eine Übungsliste absteigend nach Nutzungshäufigkeit (usage: { id: count }). */
export function sortByUsage(list, usage = {}) {
  return list.slice().sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name));
}

/* --------------------------------- View --------------------------------- */
let uiState = { category: 'all', region: 'all', query: '' };
function usageLabel(n) { return n > 0 ? `${n}× genutzt` : 'noch nicht genutzt'; }

export function render(view) {
  setHeader({ title: 'Übungs-Bibliothek', subtitle: `${EXERCISES.length} Übungen · Kraft, Rumpf & Beweglichkeit` });
  view.innerHTML = '';

  const search = input({ type: 'search', placeholder: 'Übung oder Muskelgruppe suchen …', value: uiState.query });
  search.addEventListener('input', () => { uiState.query = search.value; drawGrid(); });
  view.appendChild(el('div', { class: 'field mt-2' }, [search]));

  const cats = [{ value: 'all', label: 'Alle' }, ...EX_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))];
  view.appendChild(el('div', { class: 'mt-2' }, [
    segmented(cats, uiState.category, (v) => { uiState.category = v; drawGrid(); }),
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

  view.appendChild(el('p', { class: 'dim center mt-4', style: { fontSize: '.78rem' }, text: 'Symbolische Darstellungen – sie zeigen die Grundbewegung, kein Ersatz für individuelle Anleitung.' }));
}

function exerciseCard(e, count = 0) {
  const cm = categoryMeta(e.category);
  return el('button', { class: 'ex-card', onclick: () => openDetail(e) }, [
    el('div', { class: 'ex-card__art', style: { color: cm.color }, html: exerciseArt(e.art) }),
    el('div', { class: 'ex-card__name', text: e.name }),
    el('div', { class: 'ex-card__meta' }, [
      el('span', { class: 'chip', style: { background: 'var(--surface-2)' }, text: cm.label }),
      el('span', { class: 'dim', style: { fontSize: '.72rem' }, text: difficultyLabel(e.difficulty) }),
      count > 0 ? el('span', { class: 'chip', title: `${count}× genutzt`, style: { background: cm.color, color: '#fff', fontSize: '.72rem' }, text: `${count}×` }) : null,
    ]),
  ]);
}

function openDetail(e) {
  const cm = categoryMeta(e.category);
  const usedEl = el('span', { class: 'chip', style: { background: 'var(--surface-2)' }, text: usageLabel(exerciseUsage()[e.id] || 0) });
  const doneBtn = el('button', {
    class: 'btn btn--soft btn--block mt-3',
    onclick: () => { bumpExerciseUsage([e.id]); usedEl.textContent = usageLabel(exerciseUsage()[e.id] || 0); toast('Als gemacht gezählt', 'good'); },
  }, [icon('check'), 'Gemacht (+1)']);
  const body = el('div', {}, [
    el('div', { class: 'ex-detail__art', style: { color: cm.color }, html: exerciseArt(e.art) }),
    el('div', { class: 'row gap-2', style: { flexWrap: 'wrap', marginTop: '6px' } }, [
      el('span', { class: 'chip', style: { background: cm.color, color: '#fff' }, text: cm.label }),
      el('span', { class: 'chip', text: difficultyLabel(e.difficulty) }),
      el('span', { class: 'chip', text: '🛠 ' + e.equipment }),
      usedEl,
    ]),
    el('div', { class: 'dim mt-3', style: { fontSize: '.82rem' }, text: 'Beansprucht: ' + (e.muscles || []).join(', ') }),
    sectionHead('So geht’s'),
    el('ol', { class: 'ex-steps' }, (e.steps || []).map((s) => el('li', { text: s }))),
    el('div', { class: 'card card--flat mt-3 row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', flex: '0 0 auto', width: '18px' } }),
      el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: e.tip }),
    ]),
    doneBtn,
  ]);
  openSheet({ title: e.name, body });
}

/** Öffnet das Detail-Sheet einer Übung per id (z. B. aus einer Trainingseinheit). */
export function openExercise(id) { const e = findExercise(id); if (e) openDetail(e); }
