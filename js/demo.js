/* =========================================================================
   demo.js — Demodaten-Builder für die Ersteinrichtung (DOM-frei, testbar).

   Liefert deterministisch (relativ zu `today`) ein VOLLSTÄNDIGES Beispiel-Set –
   in jeder Kategorie sind Daten enthalten, damit nach „Mit Demodaten starten"
   überall etwas zu sehen ist:
     • Admin (Nora): angereichertes Profil (HF-/Pace-Zonen, Ziele), Standort
       Dresden (Wetter), Zyklus-Modul, Wettkampf, ~9 Wochen Trainingshistorie,
       LANGE realistische Körper-/Fitness-Zeitreihe (alle Metriken), Zyklus-
       Historie, Wochen-Speiseplan, Ess-Tagebuch, Einkaufsliste, Checkliste.
     • Gemeinsames Familien-Lager (`pantry`).
     • 9 Demo-Mitglieder mit VOLLSTÄNDIGEN Stammdaten (Profil: Größe/Gewicht/Alter/
       Geschlecht/HF-/Pace-Zonen, Standort, Module, Wochenziele) + Trainings-/
       Körper-/Ernährungshistorie (Team-Dashboard/-Badges).

   Den **Trainingsplan** baut `storage.seedDemo()` über den echten Generator
   (`createPlanForEvent`/`generatePlanUnits`) inkl. fester Termine. Zyklusdaten hat
   der Admin selbst UND jedes weibliche Mitglied – jeweils die EIGENEN, privaten
   Daten (`PRIVATE_AREAS` schützt sie beim Verwalten fremder Mitglieder).
   ========================================================================= */
import { addDays } from './ui.js';
import { pacesFromVdot } from './vdot.js';

const TITLE = { easy: 'Lockerer Lauf', tempo: 'Tempolauf', long: 'Long Run', interval: 'Intervalle', recovery: 'Regeneration' };
// Session-Durchschnitts-Paces (s/km). Wichtig: konsistent mit den Plan-Zielpaces (DEMO_PACE_ZONES
// ≈ VDOT 39–40, passend zum 1:55-HM-Ziel). Die Intervalle sind als VO₂max-Schlüsselreiz der schnellste
// Wert und ergeben eine „aktuelle Form" von ~VDOT 42 – ein realistischer, sichtbarer Vorsprung von
// ~18 s/km, an dem sich die Pace-Anpassung nachvollziehbar zeigen lässt (früher: 4:10/km ⇒ VDOT 48,8,
// ein absurder 51-s/km-Sprung).
const PACE = { easy: 360, tempo: 305, long: 372, interval: 285, recovery: 396 };
const HR = { easy: 138, tempo: 162, long: 146, interval: 172, recovery: 128 };

const R1 = (v) => Math.round(v * 10) / 10;
const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Deterministischer Pseudo-Zufall (reproduzierbar – kein Math.random, damit die
// Demodaten und die Tests stabil bleiben).
const NZ = (i, amp) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return ((x - Math.floor(x)) - 0.5) * 2 * amp; };

/**
 * Lange, realistische Körper-/Fitness-Zeitreihe (ALLE Metriken) über `days` Tage,
 * ein Messpunkt alle `step` Tage. Trends: Gewicht/Körperfett/Viszeralfett/Ruhepuls
 * fallen, Muskelmasse/HRV/VO₂max steigen; Schlaf/Energie/Stimmung schwanken.
 */
export function demoHealthSeries(today, opts = {}) {
  const { days = 84, step = 2, w0 = 75, dw = 3, bf0 = 28, rhr0 = 56, mm0 = 27.3, seed = 0 } = opts;
  const n = Math.floor(days / step);
  const out = [];
  for (let k = n; k >= 0; k--) {
    const date = addDays(today, -k * step);
    const t = 1 - k / n; // 0 = ältester Punkt … 1 = heute (Fortschritt)
    const s = seed;
    out.push({
      id: `demo-h-${s}-${date}`, date, source: 'demo', notes: '',
      weight: R1(w0 - dw * t + NZ(k + s, 0.35)),
      bodyFat: R1(bf0 - 3.2 * t + NZ(k + s + 7, 0.4)),
      muscleMass: R1(mm0 + 0.9 * t + NZ(k + s + 3, 0.15)),
      visceralFat: Math.round(CLAMP(8 - 2 * t + NZ(k + s + 11, 0.5), 4, 12)),
      restingHr: Math.round(CLAMP(rhr0 - 6 * t + NZ(k + s + 5, 1.6), 40, 68)),
      hrv: Math.round(CLAMP(52 + 11 * t + NZ(k + s + 2, 3.5), 40, 90)),
      sleepHours: R1(CLAMP(7.2 + 0.25 * Math.sin(k / 3) + NZ(k + s + 4, 0.9), 5, 9)),
      energy: CLAMP(Math.round(6.3 + 1.3 * t + NZ(k + s + 6, 1.6)), 1, 10),
      mood: CLAMP(Math.round(6.4 + 1.1 * t + NZ(k + s + 8, 1.5)), 1, 10),
      vo2max: (k % 3 === 0) ? R1(44 + 4 * t + NZ(k + s + 9, 0.4)) : null, // wird seltener gemessen
    });
  }
  return out;
}

/** Kompakter Datensatz eines Team-Mitglieds (volle Datenfülle: Läufe, lange
    Werte-Reihe, optional Wettkampf) – deterministisch je `seed`. */
/* ---- Mitglieder-Stammdaten (individuelles Profil + Einstellungen) ---- */
const CITIES = {
  Dresden: { lat: 51.0504, lon: 13.7373 }, Leipzig: { lat: 51.3397, lon: 12.3731 },
  Meißen: { lat: 51.1642, lon: 13.4736 }, Berlin: { lat: 52.52, lon: 13.405 },
  Radebeul: { lat: 51.1064, lon: 13.6603 },
};
/** HF-Zonen (5) aus der maximalen Herzfrequenz (wie settings.recalcZones). */
function memberHrZones(maxHr) {
  const defs = [[50, 60, 'Regeneration', '#7fb8ff'], [60, 70, 'Grundlage (GA1)', '#43c59e'], [70, 80, 'Tempo (GA2)', '#f5c451'], [80, 90, 'Schwelle', '#f59145'], [90, 100, 'VO2max', '#ef5d6c']];
  return defs.map(([a, b, name, color], i) => ({ zone: i + 1, name, minPct: a, maxPct: b, min: Math.round(maxHr * a / 100), max: Math.round(maxHr * b / 100), color }));
}
/** Vollständiges, individuelles Mitglieder-Profil inkl. Einstellungen (Standort, Module …). */
function demoMemberProfile(spec, today) {
  const female = spec.sex === 'w';
  const vdot = spec.level === 'high' ? 48 : spec.level === 'low' ? 36 : 42;
  const maxHr = 220 - spec.age;
  const restHr = spec.level === 'high' ? 50 : spec.level === 'low' ? 62 : 56;
  const pz = pacesFromVdot(vdot);
  const loc = CITIES[spec.city] || CITIES.Dresden;
  return {
    heightCm: female ? 164 + (spec.age % 9) : 178 + (spec.age % 11),
    weightKg: spec.w0, targetWeightKg: Math.round(spec.w0 - (spec.level === 'low' ? 4 : 2)),
    birthYear: (+today.slice(0, 4)) - spec.age, sex: spec.sex,
    maxHr, restHr, thresholdPaceSecPerKm: pz.threshold.min,
    hrZones: memberHrZones(maxHr), paceZones: pz,
    goals: female ? ['Regelmäßig laufen', 'Fit & gesund bleiben'] : ['Ausdauer aufbauen', 'Gewicht halten'],
    settings: {
      theme: 'system', accent: spec.color, weekStart: 1, units: 'metric', weather: true,
      location: { name: spec.city, country: 'DE', ...loc },
      modules: { cycle: female, nutrition: true, shopping: true, checklist: true, strength: true },
      metricsEnabled: { weight: true, bodyFat: true, muscleMass: true, visceralFat: true, restingHr: true, hrv: true, vo2max: true, sleepHours: true, energy: true, mood: true },
      weeklyGoals: { activeMinutes: spec.level === 'high' ? 300 : spec.level === 'low' ? 150 : 210, trainingDays: spec.level === 'high' ? 5 : spec.level === 'low' ? 3 : 4 },
    },
  };
}

export function demoMemberData(prefix, today, { w0 = 78, seed = 1, level = 'mid', raceOffset = null, sex = 'm' } = {}) {
  const D = (n) => addDays(today, n);
  const mul = level === 'high' ? 1.2 : level === 'low' ? 0.72 : 1;
  const sessions = [];
  let i = 0;
  const add = (off, type, km, rpe) => sessions.push({
    id: `${prefix}-s${++i}`, date: D(off), type, title: TITLE[type],
    distanceKm: R1(km * mul), durationSec: Math.round(km * mul * PACE[type]),
    paceSecPerKm: PACE[type], avgHr: HR[type], rpe, status: 'erledigt', source: 'demo',
  });
  for (let w = 8; w >= 1; w--) {
    const base = -(w * 7);
    add(base + 1, 'easy', 6, 4);
    add(base + 4, w % 2 ? 'tempo' : 'long', w % 2 ? 6 : 11 + (8 - w) * 0.6, w % 2 ? 7 : 6);
    if (w % 2 === 0) add(base + 6, 'recovery', 4, 2);
  }
  const health = demoHealthSeries(today, { days: 60, step: 3, w0, seed, rhr0: 54 + (seed % 5), bf0: sex === 'w' ? 27 : 19 });
  const events = raceOffset
    ? [{ id: `${prefix}-e1`, name: `${level === 'high' ? '10-km-Wettkampf' : 'Volkslauf'} · ${prefix}`, kind: 'race', date: D(raceOffset), distanceType: '10k', distanceKm: 10, targetTime: '00:50:00', priority: 'B', status: 'geplant' }]
    : [];
  const nutrition = [
    { id: `${prefix}-n1`, category: 'mittag', title: `Protein-Bowl · ${prefix}`, kcal: 560, protein: 38, tags: ['proteinreich', 'meal-prep'], ingredients: ['150 g Hähnchen', '80 g Reis', '200 g Gemüse'], plannedServings: 2 },
    { id: `${prefix}-n2`, category: 'snack', title: `Skyr & Beeren · ${prefix}`, kcal: 180, protein: 18, tags: ['proteinreich', 'schnell'], ingredients: ['150 g Skyr', '100 g Beeren'], plannedServings: 3 },
  ];
  return { sessions, health, events, nutrition, plans: [] };
}

/** Zyklus-Historie (~alle 28 Tage) über die letzten `n` Zyklen. */
export function demoCycle(today, n = 6) {
  const out = [];
  for (let k = n; k >= 1; k--) {
    const start = addDays(today, -(k * 28) + 3);
    out.push({ id: 'demo-cyc' + k, startDate: start, periodLength: 5, createdAt: start });
  }
  return out;
}

/** HF-Zonen (aus Max-/Ruhepuls) – realistische Demo-Werte. */
const DEMO_HR_ZONES = [
  { zone: 1, name: 'Regeneration', minPct: 50, maxPct: 60, min: 95, max: 114, color: '#7fb8ff' },
  { zone: 2, name: 'Grundlage (GA1)', minPct: 60, maxPct: 70, min: 114, max: 133, color: '#43c59e' },
  { zone: 3, name: 'Tempo (GA2)', minPct: 70, maxPct: 80, min: 133, max: 152, color: '#f5c451' },
  { zone: 4, name: 'Schwelle', minPct: 80, maxPct: 90, min: 152, max: 171, color: '#f59145' },
  { zone: 5, name: 'VO2max', minPct: 90, maxPct: 100, min: 171, max: 190, color: '#ef5d6c' },
];
const DEMO_PACE_ZONES = {
  recovery:   { label: 'Regeneration', min: 390, max: 410, hrZone: 1 },
  easy:       { label: 'Locker / Easy', min: 360, max: 385, hrZone: 2 },
  long:       { label: 'Long Run', min: 350, max: 375, hrZone: 2 },
  marathon:   { label: 'Marathon-Pace', min: 335, max: 345, hrZone: 3 },
  race_hm:    { label: 'HM-Wettkampf', min: 324, max: 330, hrZone: 3 },
  threshold:  { label: 'Schwelle / Tempo', min: 305, max: 318, hrZone: 4 },
  vo2:        { label: 'Intervalle (VO2max)', min: 282, max: 300, hrZone: 5 },
  repetition: { label: 'Wiederholungen', min: 268, max: 282, hrZone: 5 },
};

/** Baut das komplette Demo-Set relativ zum heutigen Datum. */
export function buildDemo(today) {
  const D = (n) => addDays(today, n);

  /* ---- Admin: 9 Wochen Trainingshistorie (easy · Tempo/Intervalle · Long · alle 3 Wo. Regeneration) ---- */
  const sessions = [];
  let sid = 0;
  const addS = (off, type, km, rpe) => sessions.push({
    id: 'demo-s' + (++sid), date: D(off), type, title: TITLE[type],
    distanceKm: Math.round(km * 10) / 10, durationSec: Math.round(km * PACE[type]),
    paceSecPerKm: PACE[type], avgHr: HR[type], rpe, status: 'erledigt', source: 'demo',
  });
  for (let w = 9; w >= 1; w--) {
    const base = -(w * 7);
    addS(base + 1, 'easy', 8, 4);
    addS(base + 3, w % 2 === 0 ? 'tempo' : 'interval', 8, 7); // abwechselnd Tempo/Intervalle
    addS(base + 5, 'long', 11 + Math.round((9 - w) * 0.8), 6);
    if (w % 3 === 0) addS(base + 6, 'recovery', 4, 2);        // alle 3 Wochen ein Regenerationslauf
  }
  // Diese Woche bereits ein fordernder Block (zusammen mit dem Long Run vor 2 Tagen
  // mehrere harte Tage in Folge) – so werden Belastungs- & Erholungssteuerung sichtbar.
  addS(-1, 'tempo', 9, 8);
  addS(-3, 'interval', 8, 8);

  /* ---- Lange, realistische Körper-/Fitness-Zeitreihe (alle Metriken) ---- */
  const health = demoHealthSeries(today);

  /* ---- Wettkampf (mit Stadt für das Wetter) ---- */
  const events = [{
    id: 'demo-e1', name: 'Stadtlauf Halbmarathon', kind: 'race', date: D(70),
    distanceType: 'HM', distanceKm: 21.0975, targetTime: '01:55:00',
    priority: 'A', location: 'Dresden, Altstadt', status: 'geplant', createdAt: D(-42),
  }];

  // Angereichertes Profil: HF-/Pace-Zonen + Ziele; birthYear + sex speisen den
  // Grundumsatz (Kalorienbilanz). Zielgewicht bewusst unter dem aktuellen Wert
  // (Zeitreihe endet ~72 kg) → Abnehm-Ziel „in Arbeit" fürs Dual-Goal-Cockpit.
  const profile = {
    heightCm: 179, weightKg: 72, targetWeightKg: 69, birthYear: 1990, sex: 'w',
    maxHr: 190, restHr: 52, thresholdPaceSecPerKm: 312,
    goals: ['Körperfett reduzieren', 'Muskelmasse erhöhen', 'Halbmarathon unter 1:55 h'],
    hrZones: DEMO_HR_ZONES, paceZones: DEMO_PACE_ZONES,
  };
  // Standort (Dresden) für die Wettervorhersage, aktive Module (inkl. Zyklus!),
  // sichtbare Metriken und Gesundheitsziele (Fortschritt auf „Heute").
  const settings = {
    theme: 'system', accent: '#18b48a', weekStart: 1, units: 'metric', weather: true,
    location: { name: 'Dresden', country: 'DE', lat: 51.0504, lon: 13.7373 },
    modules: { cycle: true, nutrition: true, shopping: true, checklist: true, strength: true },
    metricsEnabled: {
      weight: true, bodyFat: true, muscleMass: true, visceralFat: true, restingHr: true,
      hrv: true, vo2max: true, sleepHours: true, energy: true, mood: true,
    },
    weeklyGoals: { activeMinutes: 240, trainingDays: 4 },
    healthGoals: [
      { id: 'demo-g1', metric: 'weight', target: 69, start: 75, deadline: D(70) },
      { id: 'demo-g2', metric: 'bodyFat', target: 24, start: 28, deadline: D(70) },
      { id: 'demo-g3', metric: 'restingHr', target: 50, start: 56, deadline: D(70) },
    ],
    // Übungs-Nutzungszähler (v3.11.0): realistische Historie über alte UND neue Übungen,
    // damit im Katalog die „×N"-Zähler und in den Einheiten die nach Häufigkeit sortierten
    // Vorschläge sofort sichtbar sind.
    exerciseUsage: {
      plank: 11, glute_bridge: 9, hip_flexor_stretch: 8, cat_cow: 8, hamstring_stretch: 7,
      calf_stretch: 6, child_pose: 5, dead_bug: 4, squat: 4, side_plank: 3, superman: 3,
      bird_dog: 2, figure_four: 2, lunge: 2, supine_twist: 1,
    },
  };

  /* ---- Wochen-Speiseplan des Admins (geplante Gerichte → Einkaufsliste) ---- */
  const nutrition = [
    { id: 'demo-n1', category: 'fruehstueck', title: 'Overnight Oats mit Beeren', kcal: 420, protein: 22, tags: ['proteinreich', 'vegetarisch', 'meal-prep'], ingredients: ['60 g Haferflocken', '150 g Skyr', '150 ml Milch', '100 g Beeren', '1 EL Honig'], plannedServings: 3 },
    { id: 'demo-n2', category: 'fruehstueck', title: 'Protein-Porridge mit Banane', kcal: 450, protein: 30, tags: ['proteinreich', 'vegetarisch'], ingredients: ['60 g Haferflocken', '30 g Proteinpulver', '250 ml Milch', '1 Banane'], plannedServings: 2 },
    { id: 'demo-n3', category: 'mittag', title: 'Hähnchen-Reis-Bowl mit Brokkoli', kcal: 620, protein: 45, tags: ['proteinreich', 'meal-prep'], ingredients: ['150 g Hähnchen', '80 g Reis', '200 g Brokkoli', '1 EL Öl'], plannedServings: 4 },
    { id: 'demo-n4', category: 'mittag', title: 'Lachs mit Süßkartoffel & Spinat', kcal: 580, protein: 38, tags: ['proteinreich', 'omega-3'], ingredients: ['150 g Lachs', '250 g Süßkartoffel', 'Spinat', '1 EL Öl'], plannedServings: 2 },
    { id: 'demo-n5', category: 'abend', title: 'Omelett mit Feta & Tomaten', kcal: 410, protein: 30, tags: ['proteinreich', 'vegetarisch', 'low-carb'], ingredients: ['3 Eier', '50 g Feta', '200 g Tomaten', 'Spinat'], plannedServings: 3 },
    { id: 'demo-n6', category: 'snack', title: 'Skyr mit Beeren', kcal: 180, protein: 18, tags: ['proteinreich', 'vegetarisch', 'schnell'], ingredients: ['150 g Skyr', '100 g Beeren'], plannedServings: 4 },
  ];

  /* ---- Ess-Tagebuch: die letzten Tage (für Kalorienbilanz/Defizit-Verlauf) ---- */
  const diary = [];
  const dayMeals = [
    { title: 'Overnight Oats mit Beeren', kcal: 420, protein: 22 },
    { title: 'Hähnchen-Reis-Bowl mit Brokkoli', kcal: 620, protein: 45 },
    { title: 'Omelett mit Feta & Tomaten', kcal: 410, protein: 30 },
    { title: 'Skyr mit Beeren', kcal: 180, protein: 18 },
  ];
  for (let off = 0; off >= -6; off--) {
    dayMeals.forEach((m, i) => diary.push({ id: `demo-d${-off}-${i}`, date: D(off), title: m.title, kcal: m.kcal, protein: m.protein, source: 'cooked' }));
  }

  /* ---- Gemeinsames Familien-Lager (Vorräte) – reduziert den Einkaufsbedarf ---- */
  const pantry = [
    { id: 'demo-p1', name: 'Haferflocken', unit: 'g', amount: 500, category: 'Trockenwaren' },
    { id: 'demo-p2', name: 'Reis', unit: 'g', amount: 1000, category: 'Trockenwaren' },
    { id: 'demo-p3', name: 'Milch', unit: 'ml', amount: 1000, category: 'Milchprodukte' },
    { id: 'demo-p4', name: 'Eier', unit: 'Stück', amount: 10, category: 'Milchprodukte' },
    { id: 'demo-p5', name: 'Skyr', unit: 'g', amount: 500, category: 'Milchprodukte' },
    { id: 'demo-p6', name: 'Olivenöl', unit: 'ml', amount: 500, category: 'Sonstiges' },
  ];

  /* ---- Einkaufsliste (manuelle Positionen; die App ergänzt Zutaten aus dem Plan) ---- */
  const shopping = [
    { id: 'demo-sh1', name: 'Bananen', category: 'Obst & Gemüse', qty: '6 Stück', checked: false },
    { id: 'demo-sh2', name: 'Beeren (TK)', category: 'Obst & Gemüse', qty: '500 g', checked: false },
    { id: 'demo-sh3', name: 'Hähnchenbrust', category: 'Fleisch & Fisch', qty: '600 g', checked: false },
    { id: 'demo-sh4', name: 'Lachsfilet', category: 'Fleisch & Fisch', qty: '300 g', checked: false },
    { id: 'demo-sh5', name: 'Kaffee', category: 'Getränke', qty: '500 g', checked: true },
    { id: 'demo-sh6', name: 'Proteinpulver', category: 'Sonstiges', qty: '1 Dose', checked: false },
  ];

  /* ---- Zyklusdaten des Admins (eigene, strikt private Daten) ---- */
  const cycle = demoCycle(today);

  /* ---- Checkliste & Erinnerungen (Routinen + Termine) ---- */
  const checklist = [
    { id: 'demo-cl1', text: 'Dehnen & Faszienrolle nach dem Lauf', recurring: true, category: 'training', checked: false },
    { id: 'demo-cl2', text: '2 Liter Wasser trinken', recurring: true, category: 'health', checked: true },
    { id: 'demo-cl3', text: 'Mind. 7 Stunden Schlaf', recurring: true, category: 'health', checked: false },
    { id: 'demo-cl4', text: 'Neue Laufschuhe einlaufen', dueDate: D(4), category: 'training' },
    { id: 'demo-cl5', text: 'Startunterlagen Halbmarathon abholen', dueDate: D(68), time: '17:00', category: 'appointment' },
  ];

  /* ---- 9 Demo-Mitglieder mit voller Datenfülle (Läufe, lange Werte-Reihe, Wettkämpfe) ---- */
  const MEMBER_SPECS = [
    { name: 'Max', role: 'admin', emoji: '🚴', color: '#3d8bff', w0: 82, level: 'high', race: 45, sex: 'm', age: 34, city: 'Dresden' },
    { name: 'Lea', role: 'user', emoji: '🌟', color: '#ff5d8f', w0: 63, level: 'low', race: null, sex: 'w', age: 27, city: 'Leipzig' },
    { name: 'Henriette', role: 'admin', emoji: '🏃‍♀️', color: '#7c5cff', w0: 66, level: 'high', race: 30, sex: 'w', age: 41, city: 'Dresden' },
    { name: 'Horst', role: 'user', emoji: '🧔', color: '#ff8a3d', w0: 88, level: 'low', race: null, sex: 'm', age: 52, city: 'Meißen' },
    { name: 'Bjarne', role: 'user', emoji: '⚡', color: '#19b9c9', w0: 79, level: 'mid', race: 60, sex: 'm', age: 29, city: 'Dresden' },
    { name: 'Carla', role: 'user', emoji: '👧', color: '#f5b300', w0: 61, level: 'mid', race: null, sex: 'w', age: 24, city: 'Berlin' },
    { name: 'Deniz', role: 'admin', emoji: '🔥', color: '#18b48a', w0: 74, level: 'high', race: 20, sex: 'w', age: 36, city: 'Dresden' },
    { name: 'Elif', role: 'user', emoji: '👩', color: '#43c59e', w0: 64, level: 'mid', race: 52, sex: 'w', age: 31, city: 'Radebeul' },
    { name: 'Frido', role: 'user', emoji: '🐶', color: '#5b8def', w0: 85, level: 'low', race: null, sex: 'm', age: 45, city: 'Dresden' },
  ];
  const members = MEMBER_SPECS.map((spec, idx) => {
    const data = demoMemberData(`dm${idx}`, today, { w0: spec.w0, seed: idx + 1, level: spec.level, raceOffset: spec.race, sex: spec.sex });
    // Weibliche Mitglieder haben ihre EIGENEN, privaten Zyklusdaten (eindeutige IDs je Mitglied).
    if (spec.sex === 'w') data.cycle = demoCycle(today, 5).map((c, i) => ({ ...c, id: `dm${idx}-cyc${i + 1}` }));
    return { name: spec.name, role: spec.role, emoji: spec.emoji, color: spec.color, sex: spec.sex, profile: demoMemberProfile(spec, today), data };
  });

  // 3 Teams à 3 (Basis). Henriette ist zusätzlich im 2. Team (Mehrfach-Mitgliedschaft),
  // Horst bleibt ohne Team. '__self__' = die angemeldete Admin-Person (in der Demo: Nora).
  // Admins insgesamt: Nora + Max + Henriette + Deniz = 4.
  const teams = [
    { name: 'Team Rot', emoji: '🔴', color: '#ff5d5d', memberNames: ['__self__', 'Max', 'Bjarne'] },
    { name: 'Team Blau', emoji: '🔵', color: '#3d8bff', memberNames: ['Lea', 'Carla', 'Deniz', 'Henriette'] },
    { name: 'Team Grün', emoji: '🟢', color: '#43c59e', memberNames: ['Henriette', 'Elif', 'Frido'] },
  ];

  return { profile, settings, pantry, teams, self: { events, sessions, health, nutrition, diary, cycle, checklist, shopping }, members };
}
