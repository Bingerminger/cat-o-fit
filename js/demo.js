/* =========================================================================
   demo.js — Demodaten-Builder für die Ersteinrichtung (DOM-frei, testbar).

   Liefert deterministisch (relativ zu `today`) ein VOLLSTÄNDIGES Beispiel-Set –
   in jeder Kategorie sind Daten enthalten, damit nach „Mit Demodaten starten“
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
import { addDays, isoDow } from './ui.js';
import { pacesFromVdot } from './vdot.js';
import { hrZonesFrom, zoneName } from './hrzones.js';
import { encodePolyline, simplifyRoute, ascentOf, haversineSum } from './gpx.js';
import { t, tList } from './i18n.js';

const TITLE = {
  get easy() { return t('demo.titleEasy'); },
  get tempo() { return t('demo.titleTempo'); },
  get long() { return t('demo.titleLong'); },
  get interval() { return t('demo.titleInterval'); },
  get recovery() { return t('demo.titleRecovery'); },
};
// Session-Durchschnitts-Paces (s/km). Wichtig: konsistent mit den Plan-Zielpaces (DEMO_PACE_ZONES
// ≈ VDOT 39–40, passend zum 1:55-HM-Ziel). Die Intervalle sind als VO₂max-Schlüsselreiz der schnellste
// Wert und ergeben eine „aktuelle Form“ von ~VDOT 42 – ein realistischer, sichtbarer Vorsprung von
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
    const progress = 1 - k / n; // 0 = ältester Punkt … 1 = heute (Fortschritt)
    const s = seed;
    out.push({
      id: `demo-h-${s}-${date}`, date, source: 'demo', notes: '',
      weight: R1(w0 - dw * progress + NZ(k + s, 0.35)),
      bodyFat: R1(bf0 - 3.2 * progress + NZ(k + s + 7, 0.4)),
      muscleMass: R1(mm0 + 0.9 * progress + NZ(k + s + 3, 0.15)),
      visceralFat: Math.round(CLAMP(8 - 2 * progress + NZ(k + s + 11, 0.5), 4, 12)),
      restingHr: Math.round(CLAMP(rhr0 - 6 * progress + NZ(k + s + 5, 1.6), 40, 68)),
      hrv: Math.round(CLAMP(52 + 11 * progress + NZ(k + s + 2, 3.5), 40, 90)), hrvMethod: 'rmssd',   // Uhr (nicht Apple)
      sleepHours: R1(CLAMP(7.2 + 0.25 * Math.sin(k / 3) + NZ(k + s + 4, 0.9), 5, 9)),
      energy: CLAMP(Math.round(6.3 + 1.3 * progress + NZ(k + s + 6, 1.6)), 1, 10),
      mood: CLAMP(Math.round(6.4 + 1.1 * progress + NZ(k + s + 8, 1.5)), 1, 10),
      vo2max: (k % 3 === 0) ? R1(44 + 4 * progress + NZ(k + s + 9, 0.4)) : null, // wird seltener gemessen
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
/** HF-Zonen (5) aus der maximalen Herzfrequenz – dieselbe Rechnung wie in den Einstellungen. */
function memberHrZones(maxHr) {
  return hrZonesFrom({ maxHr });
}
/** Vollständiges, individuelles Mitglieder-Profil inkl. Einstellungen (Standort, Module …). */
function demoMemberProfile(spec, today) {
  const female = spec.sex === 'w';
  const minor = spec.age < 18;
  const vdot = spec.level === 'high' ? 48 : spec.level === 'low' ? 36 : 42;
  const maxHr = 220 - spec.age;
  const restHr = spec.level === 'high' ? 50 : spec.level === 'low' ? 62 : 56;
  const pz = pacesFromVdot(vdot);
  const loc = CITIES[spec.city] || CITIES.Dresden;
  return {
    heightCm: spec.heightCm || (female ? 164 + (spec.age % 9) : 178 + (spec.age % 11)),
    // Kinder- und Jugendprofil: kein Zielgewicht (die App rechnet dafür keine Gewichtsziele).
    weightKg: spec.w0, targetWeightKg: minor ? null : Math.round(spec.w0 - (spec.level === 'low' ? 4 : 2)),
    birthYear: (+today.slice(0, 4)) - spec.age, sex: spec.sex,
    maxHr, restHr, thresholdPaceSecPerKm: pz.threshold.min,
    hrZones: memberHrZones(maxHr), paceZones: pz,
    goals: minor ? [t('demo.goalEnjoyMoving'), t('demo.goalClubSport')]
      : female ? [t('demo.goalRunRegularly'), t('demo.goalFitHealthy')] : [t('demo.goalEndurance'), t('demo.goalKeepWeight')],
    settings: {
      theme: 'system', accent: spec.color, weekStart: 1, units: 'metric', weather: true,
      location: { name: spec.city, country: 'DE', ...loc },
      modules: { cycle: female, nutrition: true, shopping: true, checklist: true, strength: true, labs: true },
      // Abgrenzungs-Fragen beantwortet (alle „nein“) -> Modul im vollen Umfang. Das Alter
      // kennt die App aus dem Geburtsjahr (Kinder- und Jugendprofil automatisch).
      labsGate: { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, minor },
      metricsEnabled: { weight: true, bodyFat: true, muscleMass: true, visceralFat: true, restingHr: true, hrv: true, vo2max: true, sleepHours: true, energy: true, mood: true },
      // Kinder und Jugendliche: WHO-Empfehlung rund 60 Minuten Bewegung am Tag.
      weeklyGoals: minor ? { activeMinutes: 420, trainingDays: 5 }
        : { activeMinutes: spec.level === 'high' ? 300 : spec.level === 'low' ? 150 : 210, trainingDays: spec.level === 'high' ? 5 : spec.level === 'low' ? 3 : 4 },
      // Trainer-Sicht: Wer seine Belastung freigibt, erscheint bei den Admins unter „Belastung im Team“.
      shareLoad: !minor && spec.shareLoad === true,
    },
  };
}

export function demoMemberData(prefix, today, { w0 = 78, seed = 1, level = 'mid', raceOffset = null, sex = 'm', minor = false } = {}) {
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
  // Kinder wachsen: Gewicht und Muskelmasse steigen leicht statt zu fallen.
  const health = minor
    ? demoHealthSeries(today, { days: 60, step: 3, w0, dw: -0.8, seed, rhr0: 66, bf0: 18, mm0: 17 })
    : demoHealthSeries(today, { days: 60, step: 3, w0, seed, rhr0: 54 + (seed % 5), bf0: sex === 'w' ? 27 : 19 });
  const events = raceOffset
    ? [{ id: `${prefix}-e1`, name: level === 'high' ? t('demo.raceTenK') : t('demo.raceFun'), kind: 'race', date: D(raceOffset), distanceType: '10k', distanceKm: 10, targetTime: '00:50:00', priority: 'B', status: 'geplant' }]
    : [];
  const nutrition = [
    { id: `${prefix}-n1`, category: 'mittag', title: t('demo.mealProteinBowl'), kcal: 560, protein: 38, tags: ['proteinreich', 'meal-prep'], ingredients: tList('demo.mealProteinBowlIngredients') || [], plannedServings: 2 },
    { id: `${prefix}-n2`, category: 'snack', title: t('demo.mealSkyrBerries'), kcal: 180, protein: 18, tags: ['proteinreich', 'schnell'], ingredients: tList('demo.mealSkyrIngredients') || [], plannedServings: 3 },
  ];
  return { sessions, health, events, nutrition, plans: [] };
}

/* =========================================================================
   Labor & Ergänzung — Demodaten
   Bewusst als kleine Geschichten angelegt, damit jede Auswertung der App an
   den Demodaten etwas Sinnvolles zeigt:
     • Ferritin fällt über vier Messungen  -> Trendprojektion & Sport-Korridor
     • Vitamin D unter dem Zielbereich     -> saisonale Empfehlung
     • CRP bei einem Mitglied erhöht       -> „nicht beurteilbar“ (Kontext)
     • Magnesium/B12 im Bereich            -> „alles gut“ als Gegenbeispiel
   ========================================================================= */

/** Laborwerte des Admins: vier Messzeitpunkte über ein Jahr, fallender Eisenspeicher. */
export function demoLabs(today) {
  const D = (n) => addDays(today, n);
  const at = [-330, -220, -110, -12];              // vier Befunde übers Jahr
  const ferritin = [88, 72, 58, 47];               // fällt deutlich, noch im Sportkorridor -> Projektion
  const vitD = [98, 74, 52, 46];                   // Sommer -> Winter
  const hb = [13.6, 13.4, 13.2, 13.1];
  const out = [];
  let i = 0;
  const add = (analyte, value, off, note = null) => out.push({
    id: `demo-lab-${analyte}-${++i}`, analyte, value, unit: null,
    date: D(off), note, source: 'demo',
  });
  at.forEach((off, k) => {
    add('ferritin', ferritin[k], off, k === 3 ? t('demo.labFollowUp') : null);
    add('vitaminD', vitD[k], off);
    add('hb', hb[k], off);
    add('crp', k === 3 ? 1.8 : 2.4, off);          // unauffällig -> Ferritin beurteilbar
  });
  // Einzelwerte aus dem jüngsten Befund (zeigen „im Zielbereich“)
  add('b12', 68, -12);
  add('magnesium', 1.45, -12);                     // Vollblut, im Referenzbereich
  add('ft3', 4.6, -12);
  add('zinc', 13.2, -12);
  return out;
}

/** Supplement-Plan des Admins + Einnahmehistorie (für die Einnahmetreue). */
export function demoSupplements(today) {
  const D = (n) => addDays(today, n);
  const plans = [
    { id: 'demo-sup-vd', _kind: 'plan', supplementKey: 'vitaminD', name: t('demo.supVitaminD'), dose: t('demo.supVitaminDDose'), timing: t('demo.supWithBreakfast'), active: true, from: D(-45), to: null, source: 'demo' },
    { id: 'demo-sup-mg', _kind: 'plan', supplementKey: 'magnesium', name: t('demo.supMagnesium'), dose: t('demo.supMagnesiumDose'), timing: t('demo.supEvening'), active: true, from: D(-30), to: null, source: 'demo' },
  ];
  const intakes = [];
  // Realistische Einnahmetreue: Vitamin D fast täglich, Magnesium mit Lücken.
  for (let k = 0; k < 21; k++) {
    if (k % 7 !== 5) intakes.push({ id: `demo-int-vd-${k}`, _kind: 'intake', planId: 'demo-sup-vd', date: D(-k), source: 'demo' });
    if (k % 3 !== 0) intakes.push({ id: `demo-int-mg-${k}`, _kind: 'intake', planId: 'demo-sup-mg', date: D(-k), source: 'demo' });
  }
  return [...plans, ...intakes];
}

/** Laborwerte eines Mitglieds – je nach Typ eine andere, lehrreiche Konstellation. */
export function demoMemberLabs(prefix, today, { sex = 'm', level = 'mid', seed = 1 } = {}) {
  const D = (n) => addDays(today, n);
  const out = [];
  let i = 0;
  const add = (analyte, value, off) => out.push({
    id: `${prefix}-lab-${analyte}-${++i}`, analyte, value, unit: null, date: D(off), source: 'demo',
  });
  // Zwei Befunde: vor einem halben Jahr und aktuell.
  const base = sex === 'w' ? 42 : 120;             // Frauen haben typisch niedrigere Speicher
  const drift = level === 'high' ? -12 : 4;        // viel Training zehrt am Eisen
  add('ferritin', base, -190);
  add('ferritin', Math.max(12, base + drift), -20);
  add('vitaminD', 62 + (seed % 5) * 6, -190);
  add('vitaminD', 48 + (seed % 4) * 7, -20);
  add('hb', sex === 'w' ? 13.2 : 15.1, -20);
  // Ein Mitglied (seed 4) hat einen Infekt: CRP hoch -> Ferritin nicht beurteilbar.
  add('crp', seed === 4 ? 14 : 1.6, -20);
  if (seed % 3 === 0) add('b12', 44 + seed, -20);
  if (seed % 2 === 0) add('magnesium', 1.5, -20);   // Vollblut, unauffällig
  return out;
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
const demoHrZones = () => [
  { zone: 1, name: zoneName(1), minPct: 50, maxPct: 60, min: 95, max: 114, color: '#7fb8ff' },
  { zone: 2, name: zoneName(2), minPct: 60, maxPct: 70, min: 114, max: 133, color: '#43c59e' },
  { zone: 3, name: zoneName(3), minPct: 70, maxPct: 80, min: 133, max: 152, color: '#f5c451' },
  { zone: 4, name: zoneName(4), minPct: 80, maxPct: 90, min: 152, max: 171, color: '#f59145' },
  { zone: 5, name: zoneName(5), minPct: 90, maxPct: 100, min: 171, max: 190, color: '#ef5d6c' },
];
const demoPaceZones = () => ({
  recovery:   { label: t('vdot.zoneRecovery'), min: 390, max: 410, hrZone: 1 },
  easy:       { label: t('vdot.zoneEasy'), min: 360, max: 385, hrZone: 2 },
  long:       { label: t('vdot.zoneLong'), min: 350, max: 375, hrZone: 2 },
  marathon:   { label: t('demo.zoneMarathon'), min: 335, max: 345, hrZone: 3 },
  race_hm:    { label: t('demo.zoneHalfRace'), min: 324, max: 330, hrZone: 3 },
  threshold:  { label: t('vdot.zoneThreshold'), min: 305, max: 318, hrZone: 4 },
  vo2:        { label: t('vdot.zoneVo2'), min: 282, max: 300, hrZone: 5 },
  repetition: { label: t('demo.zoneRepetition'), min: 268, max: 282, hrZone: 5 },
});

/**
 * Trainings der Demo-Historie im Planzeitraum [planStart, today): Die alte Lauf-Routine
 * endet mit dem Planstart (sonst liefe die Demo-Person Plan UND Routine – doppelte
 * Last, „deutlich ermüdet“). Fußball und ausdrücklich zusätzliche Einheiten (`extra`)
 * bleiben. Liefert eine neue Liste.
 */
export function planPeriodSessions(sessions = [], planStart, today) {
  return (sessions || []).filter((s) => !(s && s.source === 'demo' && !s.extra && s.type !== 'cross_football'
    && s.date >= planStart && s.date < today));
}

/** Anstrengung (RPE) je Einheitentyp für Demo-Trainings aus dem Plan. */
const DEMO_RPE = { easy: 4, recovery: 3, long: 6, tempo: 7, interval: 8, race: 9, strength: 5, mobility: 2, walk: 2, cross_bike: 5 };

/** Übungen der Demo-Krafteinheiten – im Workout-Modus mit Satz-Erfassung und „Letztes Mal“. */
export const DEMO_STRENGTH_IDS = ['squat', 'lunge', 'glute_bridge'];

/** Kraftsätze der k-ten erledigten Demo-Krafteinheit (0 = älteste): das Gewicht steigt behutsam. */
export function demoStrengthSets(k = 0) {
  const kg = 12 + 2 * Math.min(k, 3);
  return [
    { exerciseId: 'squat', sets: [{ reps: 12, kg }, { reps: 12, kg }, { reps: 10, kg }] },
    { exerciseId: 'lunge', sets: [{ reps: 10, kg: 6 }, { reps: 10, kg: 6 }] },
    { exerciseId: 'glute_bridge', sets: [{ reps: 15, kg: null }, { reps: 15, kg: null }] },
  ];
}

/**
 * Beispielstrecke: eine Runde um den Großen Garten in Dresden (ungefähr `km` lang) mit
 * sanftem Höhenprofil – die Demo zeigt „Strecke“ und Höhenmeter wie nach einem Datei-Import.
 * Unter 5 Hm je km, damit die Form-Schätzung der Demo unverändert bleibt.
 * @returns {{route:{poly:string, ele:number[]}, ascentM:number}}
 */
export function demoRoute(km) {
  const lat0 = 51.0375, lon0 = 13.763, N = 240;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const shape = (r) => Array.from({ length: N + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / N;
    const rr = r * (1 + 0.12 * Math.sin(3 * angle) + 0.05 * Math.sin(7 * angle + 1));
    return [lat0 + (rr * 0.8 * Math.sin(angle)) / 111.32, lon0 + (rr * 1.25 * Math.cos(angle)) / (111.32 * cosLat)];
  });
  const perKm = haversineSum(shape(1)) / 1000;           // Länge der Form bei r = 1 km
  const coords = shape(km / perKm);
  const eles = coords.map((_, i) => { const angle = (2 * Math.PI * i) / N; return 116 + 9 * Math.sin(2 * angle) + 3 * Math.sin(9 * angle); });
  const ele = Array.from({ length: 60 }, (_, k) => Math.round(eles[Math.round((k * N) / 59)]));
  return { route: { poly: encodePolyline(simplifyRoute(coords)), ele }, ascentM: ascentOf(eles) };
}

/**
 * Ergänzt jede vergangene, erledigte Plan-Einheit ohne Training um ein passendes
 * Demo-Training (Strecke, Dauer, Anstrengung, HF aus den Zielwerten; Fußball und
 * Spiele mit geplanter Dauer und Intensität) und verknüpft beide. Vorher zeigte jede
 * dieser Einheiten „als erledigt markiert, es wurden aber keine Messwerte erfasst“,
 * und die festen Termine fehlten in der Belastung. Seit v3.21.0 zeigt die Demo auch die
 * Datei- und Kraft-Funktionen: Krafteinheiten tragen ihre Übungen (`exerciseIds`), erledigte
 * Kraft-Trainings ihre Sätze, und der jüngste lange Lauf hat Strecke und Höhenmeter.
 * Liefert neue Listen.
 */
export function completeDemoUnits(units = [], sessions = [], today, eventId = null) {
  const us = units.map((u) => (u.type === 'strength' && !Array.isArray(u.exerciseIds) ? { ...u, exerciseIds: [...DEMO_STRENGTH_IDS] } : { ...u }));
  const out = [...sessions];
  let n = 0;
  for (const u of us) {
    if (u.date >= today || u.status !== 'erledigt' || u.executedSessionId || u.type === 'rest') continue;
    const id = `demo-pu${++n}`;
    const s = { id, date: u.date, type: u.type, title: u.title, plannedId: u.id, eventId, source: 'demo', status: 'erledigt' };
    if (u.type === 'cross_football' || u.type === 'match') {
      const min = Number(u.targetDurationMin) || (u.type === 'match' ? 120 : 90);
      Object.assign(s, { intensity: u.intensity ?? null, durationSec: min * 60, plannedDurationMin: min, rpe: u.type === 'match' ? 8 : u.intensity === 'intensiv' ? 8 : u.intensity === 'leicht' ? 5 : 7 });
    } else if (Number(u.targetDistanceKm) > 0) {
      const pace = u.targetPaceSecPerKm && u.targetPaceMaxSecPerKm ? Math.round((u.targetPaceSecPerKm + u.targetPaceMaxSecPerKm) / 2)
        : (PACE[u.type] || 360);
      Object.assign(s, { distanceKm: u.targetDistanceKm, durationSec: Math.round(u.targetDistanceKm * pace), paceSecPerKm: pace, avgHr: HR[u.type] || 140, rpe: DEMO_RPE[u.type] || 4 });
    } else {
      const min = Number(u.targetDurationMin) || 30;
      Object.assign(s, { durationSec: min * 60, plannedDurationMin: min, rpe: DEMO_RPE[u.type] || 4 });
    }
    out.push(s);
    u.executedSessionId = id;
  }
  // Kraftsätze der erledigten Demo-Krafteinheiten, älteste zuerst (das Gewicht steigt).
  out.filter((s) => s.type === 'strength' && s.source === 'demo' && String(s.id).startsWith('demo-pu'))
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((s, k) => { s.strengthSets = demoStrengthSets(k); });
  // Der jüngste lange Lauf bekommt Strecke und Höhenmeter (als neues Objekt – die Eingabe bleibt).
  const longs = out.filter((s) => s.type === 'long' && s.date < today && Number(s.distanceKm) > 0);
  const last = longs.sort((a, b) => a.date.localeCompare(b.date))[longs.length - 1];
  if (last) out[out.indexOf(last)] = { ...last, ...demoRoute(Number(last.distanceKm)) };
  return { units: us, sessions: out };
}

/** Baut das komplette Demo-Set relativ zum heutigen Datum. */
export function buildDemo(today) {
  const D = (n) => addDays(today, n);

  /* ---- Admin: 14 Wochen Trainingshistorie (easy · Tempo/Intervalle · Long · alle 3 Wo. Regeneration) ----
     Über 90 Tage, damit die Fitnesskurve eingeschwungen ist und „Belastung & Form“ die Form bewertet. */
  const sessions = [];
  let sid = 0;
  const addS = (off, type, km, rpe) => sessions.push({
    id: 'demo-s' + (++sid), date: D(off), type, title: TITLE[type],
    distanceKm: Math.round(km * 10) / 10, durationSec: Math.round(km * PACE[type]),
    paceSecPerKm: PACE[type], avgHr: HR[type], rpe, status: 'erledigt', source: 'demo',
  });
  const HIST_WEEKS = 14;
  for (let w = HIST_WEEKS; w >= 1; w--) {
    const base = -(w * 7);
    addS(base + 1, 'easy', 8, 4);
    addS(base + 3, w % 2 === 0 ? 'tempo' : 'interval', 8, 7); // abwechselnd Tempo/Intervalle
    addS(base + 5, 'long', 9 + Math.round((HIST_WEEKS - w) * 0.6), 6);
    if (w % 3 === 0) addS(base + 6, 'recovery', 4, 2);        // alle 3 Wochen ein Regenerationslauf
  }
  // Diese Woche zusätzlich zum Plan zwei harte Einheiten (`extra`) – eine Abweichung
  // vom Plan, an der Belastungs- & Erholungssteuerung sichtbar werden.
  addS(-1, 'tempo', 9, 8);
  addS(-3, 'interval', 8, 8);
  sessions.slice(-2).forEach((s) => { s.extra = true; });
  // Vereinsfußball Mo + Mi (90 min, „normal“) – gehört zur Belastung dazu. Ohne ihn
  // zeigte die Demo Lastverhältnis und Form ohne die Fußball-Last (TRAIN-46).
  for (let off = HIST_WEEKS * 7; off >= 1; off--) {
    const date = D(-off);
    if (![1, 3].includes(isoDow(date))) continue;
    sessions.push({
      id: 'demo-fb' + off, date, type: 'cross_football', title: t('commitments.footballTraining'), intensity: 'normal',
      durationSec: 90 * 60, rpe: 7, status: 'erledigt', source: 'demo',
    });
  }

  /* ---- Lange, realistische Körper-/Fitness-Zeitreihe (alle Metriken) ---- */
  const health = demoHealthSeries(today);

  /* ---- Wettkampf (mit Stadt für das Wetter) ---- */
  const events = [{
    id: 'demo-e1', name: t('demo.raceCityHalf'), kind: 'race', date: D(70),
    distanceType: 'HM', distanceKm: 21.0975, targetTime: '01:55:00',
    priority: 'A', location: 'Dresden, Altstadt', status: 'geplant', createdAt: D(-42),
  }];

  // Angereichertes Profil: HF-/Pace-Zonen + Ziele; birthYear + sex speisen den
  // Grundumsatz (Kalorienbilanz). Zielgewicht bewusst unter dem aktuellen Wert
  // (Zeitreihe endet ~72 kg) → Abnehm-Ziel „in Arbeit“ fürs Dual-Goal-Cockpit.
  const profile = {
    heightCm: 179, weightKg: 72, targetWeightKg: 69, targetWeightStartKg: 75, birthYear: 1990, sex: 'w',
    maxHr: 190, restHr: 52, thresholdPaceSecPerKm: 312,
    goals: [t('demo.goalBodyFat'), t('demo.goalMuscle'), t('demo.goalHalf')],
    hrZones: demoHrZones(), paceZones: demoPaceZones(),
  };
  // Standort (Dresden) für die Wettervorhersage, aktive Module (inkl. Zyklus!),
  // sichtbare Metriken und Gesundheitsziele (Fortschritt auf „Heute“).
  const settings = {
    theme: 'system', accent: '#18b48a', weekStart: 1, units: 'metric', weather: true,
    location: { name: 'Dresden', country: 'DE', lat: 51.0504, lon: 13.7373 },
    modules: { cycle: true, nutrition: true, shopping: true, checklist: true, strength: true, labs: true },
    // Abgrenzungs-Fragen der Demo-Person beantwortet (alle „nein“) – sonst stünde
    // das Labor-Modul in der Demo dauerhaft im Einrichtungs-Schritt.
    labsGate: { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, minor: false },
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
    // damit im Katalog die „×N“-Zähler und in den Einheiten die nach Häufigkeit sortierten
    // Vorschläge sofort sichtbar sind.
    exerciseUsage: {
      plank: 11, glute_bridge: 9, hip_flexor_stretch: 8, cat_cow: 8, hamstring_stretch: 7,
      calf_stretch: 6, child_pose: 5, dead_bug: 4, squat: 4, side_plank: 3, superman: 3,
      bird_dog: 2, figure_four: 2, lunge: 2, supine_twist: 1,
    },
  };

  /* ---- Wochen-Speiseplan des Admins (geplante Gerichte → Einkaufsliste) ---- */
  const nutrition = [
    // Nährwerte wie im Rezeptkatalog (aus den Zutaten geschätzt) – Katalog, Speiseplan
    // und Tagebuch zeigen für dasselbe Gericht dieselben Zahlen.
    { id: 'demo-n1', suggestionId: 'overnight-oats-mit-beeren', category: 'fruehstueck', title: t('demo.mealOvernightOats'), kcal: 520, protein: 30, tags: ['proteinreich', 'vegetarisch', 'meal-prep'], ingredients: tList('demo.mealOvernightOatsIngredients') || [], plannedServings: 3 },
    { id: 'demo-n2', suggestionId: 'protein-porridge-mit-banane', category: 'fruehstueck', title: t('demo.mealProteinPorridge'), kcal: 600, protein: 39, tags: ['proteinreich', 'vegetarisch'], ingredients: tList('demo.mealProteinPorridgeIngredients') || [], plannedServings: 2 },
    { id: 'demo-n3', suggestionId: 'haehnchen-reis-bowl-mit-brokkoli', category: 'mittag', title: t('demo.mealChickenRiceBowl'), kcal: 600, protein: 46, tags: ['proteinreich', 'meal-prep'], ingredients: tList('demo.mealChickenRiceBowlIngredients') || [], plannedServings: 4 },
    { id: 'demo-n4', suggestionId: 'lachs-mit-suesskartoffel-spinat', category: 'mittag', title: t('demo.mealSalmon'), kcal: 620, protein: 35, tags: ['proteinreich', 'omega-3'], ingredients: tList('demo.mealSalmonIngredients') || [], plannedServings: 2 },
    { id: 'demo-n5', suggestionId: 'omelett-mit-feta-tomaten', category: 'abend', title: t('demo.mealOmelette'), kcal: 440, protein: 30, tags: ['proteinreich', 'vegetarisch', 'low-carb'], ingredients: tList('demo.mealOmeletteIngredients') || [], plannedServings: 3 },
    { id: 'demo-n6', suggestionId: 'skyr-mit-beeren', category: 'snack', title: t('demo.mealSkyr'), kcal: 140, protein: 18, tags: ['proteinreich', 'vegetarisch', 'schnell'], ingredients: tList('demo.mealSkyrIngredients') || [], plannedServings: 4 },
  ];

  /* ---- Ess-Tagebuch: acht Wochen (Kalorienbilanz + Verlauf der Energieversorgung) ----
     Bewusst VOLLSTÄNDIG erfasste Tage mit realistischer Menge: Bei ~72 kg,
     Grundumsatz ~1500 kcal und vier Trainingseinheiten pro Woche sind rund
     2400 kcal stimmig. Jeder vergangene Tag ist als „vollständig erfasst“ bestätigt –
     nur solche Tage zählen für die Energieversorgung; heute ist noch offen. */
  const diary = [];
  const dayMeals = [
    { title: t('demo.mealOvernightOats'), kcal: 520, protein: 30 },
    { title: t('demo.mealChickenRiceBowl'), kcal: 600, protein: 46 },
    { title: t('demo.mealOmelette'), kcal: 440, protein: 30 },
    { title: t('demo.mealSkyrNuts'), kcal: 320, protein: 24 },
    { title: t('demo.mealBananaBar'), kcal: 300, protein: 8 },
    { title: t('demo.mealCheeseBread'), kcal: 220, protein: 12 },
  ];
  for (let off = 0; off >= -55; off--) {
    // Leichte Tagesschwankung (deterministisch) – kein Wert ist jeden Tag gleich.
    const swing = 1 + NZ(-off, 0.07);
    dayMeals.forEach((m, i) => diary.push({
      id: `demo-d${-off}-${i}`, date: D(off), title: m.title,
      kcal: Math.round(m.kcal * swing), protein: Math.round(m.protein * swing), source: 'cooked',
    }));
    if (off < 0) diary.push({ id: `day-${D(off)}`, _kind: 'day', date: D(off), complete: true });
  }

  /* ---- Gemeinsames Familien-Lager (Vorräte) – reduziert den Einkaufsbedarf ---- */
  const pantry = [
    { id: 'demo-p1', name: t('demo.pantryOats'), unit: 'g', amount: 500, category: 'Trockenwaren' },
    { id: 'demo-p2', name: t('demo.pantryRice'), unit: 'g', amount: 1000, category: 'Trockenwaren' },
    { id: 'demo-p3', name: t('demo.pantryMilk'), unit: 'ml', amount: 1000, category: 'Milchprodukte' },
    { id: 'demo-p4', name: t('demo.pantryEggs'), unit: 'Stück', amount: 10, category: 'Milchprodukte' },
    { id: 'demo-p5', name: t('demo.pantrySkyr'), unit: 'g', amount: 500, category: 'Milchprodukte' },
    { id: 'demo-p6', name: t('demo.pantryOliveOil'), unit: 'ml', amount: 500, category: 'Sonstiges' },
  ];

  /* ---- Einkaufsliste (manuelle Positionen; die App ergänzt Zutaten aus dem Plan) ---- */
  const shopping = [
    { id: 'demo-sh1', name: t('demo.shopBananas'), category: 'Obst & Gemüse', qty: t('demo.shopBananasQty'), checked: false },
    { id: 'demo-sh2', name: t('demo.shopBerries'), category: 'Obst & Gemüse', qty: '500 g', checked: false },
    { id: 'demo-sh3', name: t('demo.shopChicken'), category: 'Fleisch & Fisch', qty: '600 g', checked: false },
    { id: 'demo-sh4', name: t('demo.shopSalmon'), category: 'Fleisch & Fisch', qty: '300 g', checked: false },
    { id: 'demo-sh5', name: t('demo.shopCoffee'), category: 'Getränke', qty: '500 g', checked: true },
    { id: 'demo-sh6', name: t('demo.shopProteinPowder'), category: 'Sonstiges', qty: t('demo.shopProteinPowderQty'), checked: false },
  ];

  /* ---- Zyklusdaten des Admins (eigene, strikt private Daten) ---- */
  const cycle = demoCycle(today);

  /* ---- Labor & Ergänzung des Admins (ebenfalls strikt privat) ---- */
  const labs = demoLabs(today);
  const supplements = demoSupplements(today);

  /* ---- Checkliste & Erinnerungen (Routinen + Termine) ---- */
  const checklist = [
    { id: 'demo-cl1', text: t('demo.checkStretch'), recurring: true, category: 'training', checked: false },
    { id: 'demo-cl2', text: t('demo.checkWater'), recurring: true, category: 'health', checked: true },
    { id: 'demo-cl3', text: t('demo.checkSleep'), recurring: true, category: 'health', checked: false },
    { id: 'demo-cl4', text: t('demo.checkShoes'), dueDate: D(4), category: 'training' },
    { id: 'demo-cl5', text: t('demo.checkRacePack'), dueDate: D(68), time: '17:00', category: 'appointment' },
  ];

  /* ---- 9 Demo-Mitglieder mit voller Datenfülle (Läufe, lange Werte-Reihe, Wettkämpfe) ---- */
  const MEMBER_SPECS = [
    { name: 'Max', role: 'admin', emoji: '🚴', color: '#3d8bff', w0: 82, level: 'high', race: 45, sex: 'm', age: 34, city: 'Dresden', shareLoad: true },
    { name: 'Lea', role: 'user', emoji: '🌟', color: '#ff5d8f', w0: 63, level: 'low', race: null, sex: 'w', age: 27, city: 'Leipzig' },
    { name: 'Henriette', role: 'admin', emoji: '🏃‍♀️', color: '#7c5cff', w0: 66, level: 'high', race: 30, sex: 'w', age: 41, city: 'Dresden', shareLoad: true },
    { name: 'Horst', role: 'user', emoji: '🧔', color: '#ff8a3d', w0: 88, level: 'low', race: null, sex: 'm', age: 52, city: 'Meißen' },
    { name: 'Bjarne', role: 'user', emoji: '⚡', color: '#19b9c9', w0: 79, level: 'mid', race: 60, sex: 'm', age: 29, city: 'Dresden', shareLoad: true },
    { name: 'Carla', role: 'user', emoji: '👧', color: '#f5b300', w0: 61, level: 'mid', race: null, sex: 'w', age: 24, city: 'Berlin' },
    { name: 'Deniz', role: 'admin', emoji: '🔥', color: '#18b48a', w0: 74, level: 'high', race: 20, sex: 'w', age: 36, city: 'Dresden' },
    { name: 'Elif', role: 'user', emoji: '👩', color: '#43c59e', w0: 64, level: 'mid', race: 52, sex: 'w', age: 31, city: 'Radebeul', shareLoad: true },
    { name: 'Frido', role: 'user', emoji: '🐶', color: '#5b8def', w0: 85, level: 'low', race: null, sex: 'm', age: 45, city: 'Dresden' },
    // Kinder- und Jugendprofil (12 Jahre): keine Kalorien- und Gewichtsziele, Labor nur dokumentierend.
    { name: 'Jonas', role: 'user', emoji: '⚽', color: '#2bb673', w0: 41, heightCm: 152, level: 'low', race: null, sex: 'm', age: 12, city: 'Dresden' },
  ];
  const members = MEMBER_SPECS.map((spec, idx) => {
    const data = demoMemberData(`dm${idx}`, today, { w0: spec.w0, seed: idx + 1, level: spec.level, raceOffset: spec.race, sex: spec.sex, minor: spec.age < 18 });
    // Weibliche Mitglieder haben ihre EIGENEN, privaten Zyklusdaten (eindeutige IDs je Mitglied).
    if (spec.sex === 'w') data.cycle = demoCycle(today, 5).map((c, i) => ({ ...c, id: `dm${idx}-cyc${i + 1}` }));
    // Eigene, private Laborwerte je Mitglied (PRIVATE_AREAS – für Admins unsichtbar).
    data.labs = demoMemberLabs(`dm${idx}`, today, { sex: spec.sex, level: spec.level, seed: idx + 1 });
    return { name: spec.name, role: spec.role, emoji: spec.emoji, color: spec.color, sex: spec.sex, profile: demoMemberProfile(spec, today), data };
  });

  // 3 Teams à 3 (Basis). Henriette ist zusätzlich im 2. Team (Mehrfach-Mitgliedschaft),
  // Horst bleibt ohne Team. '__self__' = die angemeldete Admin-Person (in der Demo: Nora).
  // Admins insgesamt: Nora + Max + Henriette + Deniz = 4.
  const teams = [
    { name: t('demo.teamRed'), emoji: '🔴', color: '#ff5d5d', memberNames: ['__self__', 'Max', 'Bjarne', 'Jonas'] },
    { name: t('demo.teamBlue'), emoji: '🔵', color: '#3d8bff', memberNames: ['Lea', 'Carla', 'Deniz', 'Henriette'] },
    { name: t('demo.teamGreen'), emoji: '🟢', color: '#43c59e', memberNames: ['Henriette', 'Elif', 'Frido'] },
  ];

  return { profile, settings, pantry, teams, self: { events, sessions, health, nutrition, diary, cycle, checklist, shopping, labs, supplements }, members };
}
