/* =========================================================================
   plangen.js — Generator der Wettkampfpläne: Periodisierung, Wochenumfang und
   konkrete Einheiten. Rein (ohne Store und DOM) und damit vollständig per
   node:test prüfbar; plans.js baut darauf Ansicht und Store-Anbindung.

   Grundlage → Aufbau → Spitze → Tapering. Der Wochenumfang folgt dem Niveau und
   den Trainingstagen: Steigerung je Woche höchstens 8–12 % gegenüber der letzten
   vollen Woche, jede 4. Woche Entlastung, danach zurück auf das Niveau davor (nie
   mehr als +25 % zur Vorwoche). Der Long Run ist über seinen Anteil am
   Wochenumfang, eine Distanz- und eine Zeitobergrenze gedeckelt (Daniels:
   ~150 min; bei Laufanfänger:innen gingen Wochensprünge > 30 % mit mehr
   Verletzungen einher, Nielsen et al. 2014). Tapering: zwei Wochen mit 70 % bzw.
   50 % des Spitzenumfangs bei gehaltener Intensität (Bosquet et al. 2007).
   Die Renneinheit steht an jedem Wochentag, die Tage davor werden entlastet.
   ========================================================================= */

import { uid, nowIso, typeMeta, fmtKm, fmtPaceRange, addDays, isoDow, diffDays, weekStartMonday } from './ui.js';
import { commitmentDates, commitMeta, defaultCommitments } from './commitments.js';
import { isHard } from './planflow.js';

import { t, tp } from './i18n.js';

/** Generator-Stand. Pläne ohne dieses Feld stammen aus früheren Versionen: Sie
    bleiben unverändert, bis jemand „Plan ab heute neu berechnen“ wählt. */
export const PLAN_GEN = 2;

export const PLAN_LEVELS = {
  einsteiger: { get label() { return t('plangen.levels.einsteiger.label'); }, get hint() { return t('plangen.levels.einsteiger.hint'); } },
  fortgeschritten: { get label() { return t('plangen.levels.fortgeschritten.label'); }, get hint() { return t('plangen.levels.fortgeschritten.hint'); } },
  leistung: { get label() { return t('plangen.levels.leistung.label'); }, get hint() { return t('plangen.levels.leistung.hint'); } },
};
const LEVELS = Object.keys(PLAN_LEVELS);
export const RUN_DAYS = [3, 4, 5, 6];

const r05 = (v) => Math.round(v * 2) / 2;
const r5 = (v) => Math.max(5, Math.round(v / 5) * 5);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const kmText = (km) => fmtKm(km, km % 1 ? 1 : 0);

/* ===================== Wochengerüste ===================== */

/** Standard-Wochengerüst mit vier Lauftagen. Feste Termine (z. B. Vereinstraining)
    kommen nicht aus dem Gerüst, sondern aus `plan.commitments`. */
export const DEFAULT_WEEK_TEMPLATE = [
  { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
  { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
  // Fr trägt kein fixes Training (frei vor dem Long Run). Kraft wird NICHT im
  // Wettkampfplan vorgegeben – sie lässt sich über ein eigenes Ziel/Programm steuern.
  { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
  { dow: 7, label: 'So', units: [{ role: 'recovery' }, { role: 'mobility' }] },
];

/** Lauf-Wochengerüste je Anzahl Lauftage. Zwei Schlüsseltage (Di, Sa) liegen nie
    nebeneinander; zusätzliche Tage sind kurze, lockere Läufe. */
export const RUN_TEMPLATES = {
  3: [
    { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
    { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
    { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
    { dow: 7, label: 'So', units: [{ role: 'mobility' }] },
  ],
  4: DEFAULT_WEEK_TEMPLATE,
  5: [
    { dow: 1, label: 'Mo', units: [{ role: 'extra' }] },
    ...DEFAULT_WEEK_TEMPLATE,
  ],
  6: [
    { dow: 1, label: 'Mo', units: [{ role: 'extra' }] },
    { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
    { dow: 3, label: 'Mi', units: [{ role: 'extra' }] },
    { dow: 4, label: 'Do', units: [{ role: 'endurance' }] },
    { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
    { dow: 7, label: 'So', units: [{ role: 'recovery' }, { role: 'mobility' }] },
  ],
};

/** Triathlon: Montag frei, zwei Schwimm-, zwei Rad- und drei Laufeinheiten, Kraft
    am lockeren Donnerstag. Harte Tage (Di, Do, So) liegen nie nebeneinander. */
export const TRIATHLON_TEMPLATE = [
  { dow: 2, label: 'Di', units: [{ role: 'swim' }, { role: 'quality' }] },
  { dow: 3, label: 'Mi', units: [{ role: 'bike' }] },
  { dow: 4, label: 'Do', units: [{ role: 'endurance' }, { role: 'strength' }] },
  { dow: 5, label: 'Fr', units: [{ role: 'swim' }] },
  { dow: 6, label: 'Sa', units: [{ role: 'long_bike' }] },
  { dow: 7, label: 'So', units: [{ role: 'long' }, { role: 'mobility' }] },
];

/** Hyrox: Montag frei, Lauf-Intervalle, Kraft, Stationstraining und ein ruhiger
    langer Lauf. Die drei harten Tage (Di, Do, So) liegen nie nebeneinander. */
export const HYROX_TEMPLATE = [
  { dow: 2, label: 'Di', units: [{ role: 'quality' }] },
  { dow: 3, label: 'Mi', units: [{ role: 'endurance' }] },
  { dow: 4, label: 'Do', units: [{ role: 'strength' }] },
  { dow: 5, label: 'Fr', units: [{ role: 'mobility' }] },
  { dow: 6, label: 'Sa', units: [{ role: 'long' }] },
  { dow: 7, label: 'So', units: [{ role: 'functional' }] },
];

const RUN_ROLES = ['quality', 'endurance', 'long', 'recovery', 'extra'];

/** Wochengerüst nach Sportart und (bei Laufplänen) Lauftagen. */
export function weekTemplateFor(sport, daysPerWeek = 4) {
  if (sport === 'triathlon') return TRIATHLON_TEMPLATE;
  if (sport === 'hyrox') return HYROX_TEMPLATE;
  return RUN_TEMPLATES[clampDays(daysPerWeek)] || DEFAULT_WEEK_TEMPLATE;
}

export function clampDays(d) { return clamp(Math.round(Number(d) || 4), 3, 6); }

/** Ist das ein Lauf-Wochengerüst (kein Triathlon/Hyrox)? */
export function isRunTemplate(tpl) {
  const roles = new Set((tpl || []).flatMap((r) => (r.units || []).map((u) => u.role)));
  return !roles.has('swim') && !roles.has('bike') && !roles.has('long_bike') && !roles.has('functional');
}

/** Stabile IDs für die Fußballtermine der Altpläne (siehe planCommitments). */
export const LEGACY_COMMITMENT_IDS = ['c-legacy-mo', 'c-legacy-mi'];

/** Feste Termine eines Plans. Neue Pläne tragen immer eine eigene Liste
    (standardmäßig leer – gefragt wird beim Anlegen). Pläne aus Versionen vor
    v3.7.0 haben kein Feld; für sie galten Mo + Mi Fußball. Diese Lese-Migration
    hält das mit stabilen IDs fest, damit sich für echte Fußballer:innen nichts
    ändert. Triathlon/Hyrox hatten nie Standardtermine. */
export function planCommitments(plan) {
  if (!plan) return [];
  if (plan.commitments != null) return plan.commitments;
  if (!isRunTemplate(plan.weekTemplate)) return [];
  return defaultCommitments().map((c, i) => ({ ...c, id: LEGACY_COMMITMENT_IDS[i] || c.id }));
}

/* ===================== Kraft-Schwerpunkte ===================== */

/** Rotierende Kraft-Schwerpunkte – Eigengewicht oder mit Geräten, ohne Video-Zwang. */
export const STRENGTH_FOCUS = [
  { get title() { return t('plangen.strengthFocus.fullBody.title'); }, get desc() { return t('plangen.strengthFocus.fullBody.desc'); } },
  { get title() { return t('plangen.strengthFocus.legs.title'); }, get desc() { return t('plangen.strengthFocus.legs.desc'); } },
  { get title() { return t('plangen.strengthFocus.core.title'); }, get desc() { return t('plangen.strengthFocus.core.desc'); } },
];

/** Kraft für Hyrox: Beine/Schieben, Zug/Griff, Ganzkörper mit Wall Balls. */
export const HYROX_STRENGTH = [
  { get title() { return t('plangen.hyroxStrength.legsPush.title'); }, get desc() { return t('plangen.hyroxStrength.legsPush.desc'); } },
  { get title() { return t('plangen.hyroxStrength.pullGrip.title'); }, get desc() { return t('plangen.hyroxStrength.pullGrip.desc'); } },
  { get title() { return t('plangen.hyroxStrength.fullBody.title'); }, get desc() { return t('plangen.hyroxStrength.fullBody.desc'); } },
];

/* ===================== Phasen ===================== */

/** Verteilt die Gesamtwochen auf die vier Trainingsphasen. */
export function makePhases(weeks) {
  const defs = [
    { key: 'base', name: t('plangen.phases.base.name'), color: '#43c59e', focus: t('plangen.phases.base.focus'), frac: 0.40 },
    { key: 'build', name: t('plangen.phases.build.name'), color: '#3d8bff', focus: t('plangen.phases.build.focus'), frac: 0.32 },
    { key: 'peak', name: t('plangen.phases.peak.name'), color: '#f5a623', focus: t('plangen.phases.peak.focus'), frac: 0.16 },
    { key: 'taper', name: t('plangen.phases.taper.name'), color: '#b079e6', focus: t('plangen.phases.taper.focus'), frac: 0.12 },
  ];
  if (weeks <= 1) return [{ ...defs[3], startWeek: 1, endWeek: weeks }].map(({ frac, ...p }) => p);
  // Kurzpläne (2–3 Wochen): die Rennwoche ist IMMER Tapering – ein voller
  // Aufbaublock direkt vor dem Wettkampf wäre kontraproduktiv.
  if (weeks < 4) {
    return [
      { ...defs[0], startWeek: 1, endWeek: weeks - 1 },
      { ...defs[3], startWeek: weeks, endWeek: weeks },
    ].filter((p) => p.startWeek <= p.endWeek).map(({ frac, ...p }) => p);
  }
  const counts = defs.map((d) => Math.max(1, Math.round(d.frac * weeks)));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum > weeks) { counts[counts.indexOf(Math.max(...counts))]--; sum--; }
  while (sum < weeks) { counts[0]++; sum++; }
  const phases = []; let wk = 1;
  defs.forEach((d, i) => { if (counts[i] <= 0) return; phases.push({ key: d.key, name: d.name, color: d.color, focus: d.focus, startWeek: wk, endWeek: wk + counts[i] - 1 }); wk += counts[i]; });
  return phases;
}

function phasesOf(plan) {
  return Array.isArray(plan.phases) && plan.phases.length ? plan.phases : makePhases(Math.max(1, plan.weeks | 0));
}
export function phaseForWeek(plan, week) {
  const phases = phasesOf(plan);
  return phases.find((p) => week >= p.startWeek && week <= p.endWeek) || phases.at(-1);
}

/* ===================== Distanz, Niveau, Historie ===================== */

/** Schwerpunkt der Schlüsseleinheiten je Wettkampfdistanz (distanzspezifisch). */
export function distanceEmphasis(raceKm = 21.1) {
  const km = Number(raceKm) || 21.1;
  if (km <= 6) return { key: '5k', short: true, marathon: false, focus: t('plangen.emphasis.5k') };
  if (km <= 12) return { key: '10k', short: true, marathon: false, focus: t('plangen.emphasis.10k') };
  if (km <= 25) return { key: 'hm', short: false, marathon: false, focus: t('plangen.emphasis.hm') };
  return { key: 'marathon', short: false, marathon: true, focus: t('plangen.emphasis.marathon') };
}

/** Wettkampfformate für Triathlon. */
export const TRI_FORMATS = {
  tri_sprint: { get label() { return t('plangen.triFormats.sprint'); }, swimM: 750, bikeKm: 20, runKm: 5 },
  tri_olympic: { get label() { return t('plangen.triFormats.olympic'); }, swimM: 1500, bikeKm: 40, runKm: 10 },
};

/** Schlüssel des Wettkampfs für Umfang und Einheitenwahl. */
export function raceKey(event = {}) {
  const sport = event.sport || 'run';
  const km = Number(event.distanceKm) || 21.0975;
  if (sport === 'triathlon') {
    if (event.distanceType === 'tri-olympic') return 'tri_olympic';
    if (event.distanceType === 'tri-sprint') return 'tri_sprint';
    return km > 6 ? 'tri_olympic' : 'tri_sprint';
  }
  if (sport === 'hyrox') return 'hyrox';
  return distanceEmphasis(km).key;
}

const raceLabel = (key) => t(`plangen.raceLabel.${key}`);

/** Spitzen-Wochenumfang (Lauf-km) bei vier Lauftagen je Distanz und Niveau. */
const PEAK_WEEK_KM = {
  '5k':        { einsteiger: 20, fortgeschritten: 30, leistung: 45 },
  '10k':       { einsteiger: 25, fortgeschritten: 38, leistung: 55 },
  hm:          { einsteiger: 35, fortgeschritten: 48, leistung: 65 },
  marathon:    { einsteiger: 45, fortgeschritten: 62, leistung: 80 },
  tri_sprint:  { einsteiger: 12, fortgeschritten: 18, leistung: 25 },
  tri_olympic: { einsteiger: 16, fortgeschritten: 24, leistung: 32 },
  hyrox:       { einsteiger: 18, fortgeschritten: 28, leistung: 38 },
};
/** Obergrenze eines lockeren Dauerlaufs (km) je Niveau. */
const ENDURANCE_MAX = { einsteiger: 14, fortgeschritten: 18, leistung: 22 };
/** Entlastungswoche: Anteil des Umfangs der letzten vollen Woche. */
const DELOAD = 0.85;
/** Mehr Lauftage tragen mehr Umfang. */
const DAYS_FACTOR = { 3: 0.85, 4: 1, 5: 1.12, 6: 1.25 };
/** Einstieg ohne Trainingshistorie als Anteil der Spitze. */
const START_SHARE = { einsteiger: 0.45, fortgeschritten: 0.6, leistung: 0.65 };
/** Höchste Steigerung je Woche gegenüber der letzten vollen Woche. */
const WEEK_STEP = { einsteiger: 0.08, fortgeschritten: 0.10, leistung: 0.12 };
/** Höchster Anteil des Long Runs am Wochenumfang (bei vier Lauftagen). Für Marathon
    und Halbmarathon etwas höher als die 25–30 % bei Daniels: Bei Freizeitumfängen
    bliebe der Long Run sonst weit unter der Renndistanz. */
const LONG_SHARE = { '5k': 0.33, '10k': 0.33, hm: 0.38, marathon: 0.4, tri_sprint: 0.4, tri_olympic: 0.4, hyrox: 0.4 };
/** Zeitobergrenze des Long Runs (Minuten). */
const LONG_TIME_CAP_MIN = { einsteiger: 150, fortgeschritten: 180, leistung: 180 };
/** Long-Run-Pace, wenn keine Paces bekannt sind (Sek./km) – bewusst ruhig. */
const FALLBACK_LONG_PACE = { einsteiger: 420, fortgeschritten: 370, leistung: 330 };
/** Distanz-Obergrenze des Long Runs für Triathlon/Hyrox (Laufen ist dort ein Teil). */
const MULTI_LONG_CAP = {
  tri_sprint: { einsteiger: 8, fortgeschritten: 10, leistung: 12 },
  tri_olympic: { einsteiger: 12, fortgeschritten: 15, leistung: 18 },
  hyrox: { einsteiger: 10, fortgeschritten: 12, leistung: 14 },
};
/** Wiederholungen je Niveau (Einsteiger kürzere Qualitätsreize). */
const REP_FACTOR = { einsteiger: 0.65, fortgeschritten: 1, leistung: 1.25 };
/** Empfohlene Mindestvorbereitung in Wochen (ohne passende Historie). */
const MIN_WEEKS = {
  '5k': { einsteiger: 6, fortgeschritten: 4, leistung: 3 },
  '10k': { einsteiger: 8, fortgeschritten: 6, leistung: 4 },
  hm: { einsteiger: 12, fortgeschritten: 8, leistung: 6 },
  marathon: { einsteiger: 18, fortgeschritten: 12, leistung: 10 },
  tri_sprint: { einsteiger: 10, fortgeschritten: 8, leistung: 6 },
  tri_olympic: { einsteiger: 14, fortgeschritten: 10, leistung: 8 },
  hyrox: { einsteiger: 10, fortgeschritten: 8, leistung: 6 },
};
/** Ab diesem längsten Lauf gilt die Vorbereitung als ausreichend vorhanden. */
const HISTORY_LONG_OK = { '5k': 6, '10k': 10, hm: 15, marathon: 26, tri_sprint: 6, tri_olympic: 10, hyrox: 8 };

/** Distanz-bewusste Long-Run-Spitzendistanz (km) auf dem Niveau „Fortgeschritten“.
    Kurze Distanzen brauchen relativ längere Grundlagen-Läufe, der Marathon wird bei
    ~32 km gedeckelt. */
export function longRunPeak(raceKm) {
  if (raceKm <= 6) return 15;                              // 5 km -> Grundlagen-Long
  if (raceKm <= 12) return 19;                             // 10 km
  if (raceKm <= 25) return Math.round(Math.min(raceKm * 0.9, 20)); // Halbmarathon
  return Math.round(Math.min(raceKm * 0.76, 32));          // Marathon (gedeckelt)
}

const RUN_TYPES = ['easy', 'long', 'tempo', 'interval', 'race', 'run', 'recovery'];

/** Trainingshistorie der letzten vier Wochen: Ø Wochen-km (erst ab zwei Wochen mit
    Läufen) und längster Lauf. Nur Laufen – Rad und Gehen zählen hier nicht. */
export function trainingHistory(sessions = [], today) {
  let km = 0, longKm = 0;
  const weeks = new Set();
  (sessions || []).forEach((s) => {
    if (!s || s.deleted || !s.distanceKm || !RUN_TYPES.includes(s.type)) return;
    const d = diffDays(s.date, today);
    if (d < 0 || d >= 28) return;
    km += s.distanceKm;
    weeks.add(Math.floor(d / 7));
    if (s.distanceKm > longKm) longKm = s.distanceKm;
  });
  return { weekKm: weeks.size >= 2 ? r05(km / 4) : null, longKm: longKm >= 5 ? r05(longKm) : null, weeks: weeks.size };
}

/** Vorschlag fürs Niveau aus der Historie (die Person kann ihn ändern). */
export function suggestLevel(hist = {}) {
  const wk = hist.weekKm || 0, lg = hist.longKm || 0;
  if (wk >= 40 || lg >= 18) return 'leistung';
  if (wk >= 15 || lg >= 10) return 'fortgeschritten';
  return 'einsteiger';
}

/** Niveau eines Plans. Altpläne ohne Feld: aus ihrer Historie, sonst „Fortgeschritten“
    (entspricht dem Umfang der früheren Pläne am ehesten). */
export function levelOf(plan = {}) {
  if (LEVELS.includes(plan.level)) return plan.level;
  if (plan.baseWeekKm || plan.baseLongKm) return suggestLevel({ weekKm: plan.baseWeekKm, longKm: plan.baseLongKm });
  return 'fortgeschritten';
}

/** Planstart (kommender Montag, bei sehr nahem Rennen heute) und Wochenzahl. */
export function planWindow(eventDate, today) {
  let start = today;
  const dow = isoDow(today);
  if (dow !== 1) start = addDays(today, 8 - dow);
  if (start >= eventDate) start = today;
  const weeks = Math.max(1, Math.ceil((diffDays(start, eventDate) + 1) / 7));
  return { start, weeks };
}

/**
 * Passt die Vorbereitungszeit? `past`/`today`: kein Plan mehr möglich; `short`:
 * kürzer als die empfohlene Mindestdauer (ohne passende Historie) – mit Alternativen.
 */
export function planReadiness(event, { today, level = 'fortgeschritten', hist = {} } = {}) {
  if (!event || !event.date) return { status: 'none' };
  if (event.date < today) return { status: 'past', text: t('plangen.readiness.past') };
  if (event.date === today) return { status: 'today', text: t('plangen.readiness.today') };
  const { weeks } = planWindow(event.date, today);
  const key = raceKey(event);
  const lvl = LEVELS.includes(level) ? level : 'fortgeschritten';
  const minWeeks = MIN_WEEKS[key][lvl];
  const histOk = (hist.longKm || 0) >= HISTORY_LONG_OK[key];
  if (weeks < minWeeks && !histOk) {
    return {
      status: 'short', weeks, minWeeks,
      text: tp('plangen.readiness.short', weeks, { race: raceLabel(key), level: PLAN_LEVELS[lvl].label, minWeeks }),
    };
  }
  return { status: 'ok', weeks, minWeeks };
}

/* ===================== Umfangsmodell ===================== */

function countRoles(tpl) {
  const c = {};
  (tpl || []).forEach((row) => (row.units || []).forEach((u) => { c[u.role] = (c[u.role] || 0) + 1; }));
  return c;
}

/** Eckwerte des Umfangs für einen Plan (Spitze, Einstieg, Steigerung, Long-Run-Deckel). */
export function volumeConfig(plan = {}, event = {}, pz = {}) {
  const key = raceKey({ ...event, sport: event.sport || plan.sport });
  const level = levelOf(plan);
  const roles = countRoles(plan.weekTemplate || DEFAULT_WEEK_TEMPLATE);
  const runDays = RUN_ROLES.reduce((n, r) => n + (roles[r] || 0), 0) || 4;
  const peak = r05(PEAK_WEEK_KM[key][level] * (DAYS_FACTOR[clamp(runDays, 3, 6)] || 1));
  // Einstieg: der aktuelle Umfang (auch darunter, wenn wenig gelaufen wird), höchstens die
  // Spitze des Niveaus; ohne Historie ein Anteil der Spitze.
  let start;
  if (plan.baseWeekKm) start = plan.baseWeekKm;
  else if (plan.baseLongKm) start = plan.baseLongKm * 2.5;   // ein Long Run lässt auf den Wochenumfang schließen
  else start = peak * START_SHARE[level];
  start = r05(clamp(start, Math.min(8, peak * 0.5), peak));
  const long = pz && pz.long;
  const longPace = long && long.min ? (long.min + (long.max || long.min)) / 2 : FALLBACK_LONG_PACE[level];
  const timeCapKm = (LONG_TIME_CAP_MIN[level] * 60) / longPace;
  const raceKm = Number(event.distanceKm) || 21.0975;
  const distCapKm = MULTI_LONG_CAP[key]
    ? MULTI_LONG_CAP[key][level]
    : longRunPeak(raceKm) * ({ einsteiger: 0.85, fortgeschritten: 1, leistung: 1.1 })[level];
  const longShare = Math.max(0.28, LONG_SHARE[key] - Math.max(0, runDays - 4) * 0.03);
  const longCapKm = r05(Math.min(distCapKm, timeCapKm));
  // Lauf-Geh-Wochen für Einsteiger:innen ohne Laufbasis (5 und 10 km).
  const runWalkWeeks = level === 'einsteiger' && (key === '5k' || key === '10k') && start < 12 ? (start < 10 ? 6 : 3) : 0;
  return {
    key, level, runDays, peak, start,
    step: WEEK_STEP[level],
    longShare, longCapKm,
    peakLongKm: r05(Math.min(peak * longShare, longCapKm)),
    runWalkWeeks,
  };
}

/**
 * Wochen-Soll je Planwoche (Index 1..weeks): { km, deload, taper }.
 * `plan.anchorWeek` (beim Aktualisieren ab heute): Die Steigerung beginnt in dieser
 * Woche beim Einstiegsumfang – so setzt der Plan am aktuellen Stand an.
 */
export function weekVolumes(plan, cfg) {
  const weeks = Math.max(1, plan.weeks | 0);
  const out = new Array(weeks + 1).fill(null);
  const at = (w, km, extra = {}) => { out[w] = { km: r05(km), deload: false, taper: null, ...extra }; };
  if (weeks === 1) { at(1, cfg.start * 0.5, { taper: 'race' }); return out; }
  if (weeks === 2) { at(1, cfg.start * 0.8, { taper: 'w1' }); at(2, cfg.start * 0.5, { taper: 'race' }); return out; }
  if (weeks === 3) { at(1, cfg.start); at(2, cfg.start * 0.7, { taper: 'w1' }); at(3, cfg.start * 0.5, { taper: 'race' }); return out; }
  let buildEnd = weeks - 2;
  if (weeks >= 6 && phaseForWeek(plan, weeks - 2).key === 'taper') buildEnd = weeks - 3;
  const anchor = clamp(plan.anchorWeek | 0 || 1, 1, buildEnd);
  let last = cfg.start, max = cfg.start, prevDeload = false;
  for (let w = 1; w <= buildEnd; w++) {
    if (w <= anchor) { at(w, cfg.start); continue; }
    if (w % 4 === 0 && w < buildEnd) { at(w, last * DELOAD, { deload: true }); prevDeload = true; continue; }
    const v = prevDeload ? last : Math.min(cfg.peak, last * (1 + cfg.step));
    prevDeload = false; last = v; max = Math.max(max, v);
    at(w, v);
  }
  if (buildEnd === weeks - 3) at(weeks - 2, max * 0.85, { taper: 'w2' });
  at(weeks - 1, max * 0.7, { taper: 'w1' });
  at(weeks, max * 0.5, { taper: 'race' });
  return out;
}

/** Nebeneinheiten als Anteil am Wochenumfang, gerundet und begrenzt. */
export function supportRunKm(baseKm, frac, { min = 4, max = 16 } = {}) {
  const km = (Number(baseKm) || 0) * frac;
  if (!km) return min;
  return r05(Math.max(min, Math.min(max, km)));
}

/** Unter diesem Wochenumfang werden Regenerations- und Zusatzläufe zu zügigem
    Gehen – vier Läufe à 2–3 km wären für Einsteiger:innen kein sinnvolles Training. */
const WALK_BELOW_KM = 16;

/** Verteilt den Wochenumfang auf die Rollen der Woche. Der Long Run hält seinen
    Anteil auch an der tatsächlichen Wochensumme ein und wird im Tapering deutlich
    kürzer (zwei Wochen vorher ≤ 75 %, eine Woche vorher ≤ 55 % der Spitze). */
function allocate(cfg, info, roles, phaseKey) {
  const V = info.km;
  const walk = V < WALK_BELOW_KM;
  // Grundlagenphase: Dauerlauf mit Steigerungen (≤ 12 km), sonst strukturierte Einheit (≤ 16 km).
  const qMax = phaseKey === 'base' && !info.taper ? 12 : 16;
  const quality = r05(clamp(V * (cfg.key === 'hyrox' || cfg.key.startsWith('tri') ? 0.3 : 0.25), 3, qMax));
  const recovery = roles.recovery && !walk ? supportRunKm(V, 0.12, { min: 3, max: 8 }) : 0;
  // Der Long Run folgt seinem Anteil am Wochenumfang – auch bei erfahrenen Läufer:innen
  // (deren höherer Umfang ihm dann Raum gibt), gedeckelt über Distanz und Zeit.
  let long = Math.min(V * cfg.longShare, cfg.longCapKm);
  if (info.taper === 'w2') long = Math.min(long, cfg.peakLongKm * 0.75);
  if (info.taper === 'w1') long = Math.min(long, cfg.peakLongKm * 0.55);
  const nExtra = roles.extra && !walk ? roles.extra : 0;
  const rest = V - long - quality - recovery;
  // Der Dauerlauf (Do) bleibt der zweitlängste Lauf; Zusatzläufe teilen sich den Rest.
  const endurance = roles.endurance
    ? r05(clamp(nExtra ? Math.max(V * 0.2, rest * 0.4) : rest / roles.endurance, 3, ENDURANCE_MAX[cfg.level]))
    : 0;
  const extra = nExtra ? r05(clamp((rest - endurance * (roles.endurance || 0)) / nExtra, 3, 10)) : 0;
  const others = quality + recovery + extra * nExtra + endurance * (roles.endurance || 0);
  long = Math.min(long, (others * cfg.longShare) / (1 - cfg.longShare));
  return { V, walk, long: r05(Math.max(3, long)), quality, recovery, extra, endurance };
}

/* ===================== Einheiten ===================== */

function pace(pz, key) {
  const z = pz[key];
  return z && z.min ? { min: z.min, max: z.max, hrZone: z.hrZone, key } : null;
}

const DEFAULT_HR = { easy: 2, long: 2, recovery: 1, threshold: 4, vo2: 5, race: 4, marathon: 3, race_hm: 4 };

/** Kilometer für eine Belastungszeit (Sek.) bei einer Pace (Sek./km); ohne Pace 5:00. */
function kmForSec(sec, paceSec) { return sec / (paceSec || 300); }
/** Trabpause in km (≈ 6:40 min/km). */
function jogKm(restSec) { return restSec / 400; }
function midPace(z) { return z && z.min ? (z.min + (z.max || z.min)) / 2 : null; }

function mkUnit(ctx, type, extra = {}) {
  const { plan, date, week, phase } = ctx;
  const p = extra.pace || null;
  const paceKey = extra.paceKey || (p && p.key) || null;
  return {
    id: uid('u'), planId: plan.id, eventId: plan.eventId,
    date, dow: isoDow(date), week, phase: phase.key,
    type, title: extra.title || typeMeta(type).label,
    targetDistanceKm: extra.dist ?? null,
    targetDurationMin: extra.dur ?? null,
    targetPaceSecPerKm: p ? p.min : null,
    targetPaceMaxSecPerKm: p ? p.max : null,
    targetHrZone: (p && p.hrZone) ?? extra.hrZone ?? (paceKey ? DEFAULT_HR[paceKey] ?? null : null),
    paceKey,
    description: extra.desc || '', time: extra.time || null,
    intervals: extra.intervals ?? null,
    ...(extra.raceBlockKm ? { raceBlockKm: extra.raceBlockKm } : {}),
    status: 'geplant', executedSessionId: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
}

/** Pyramiden-Intervalle: aufsteigend bis `peakSec`, dann absteigend; je `restSec` Trabpause.
    Liefert variable Segmente für den Workout-Modus (feinere Struktur als uniforme Runden). */
export function pyramidSegments(peakSec = 240, stepSec = 60, restSec = 90) {
  const up = [];
  for (let s = stepSec; s <= peakSec; s += stepSec) up.push(s);
  const seq = [...up, ...up.slice(0, -1).reverse()];
  return seq.map((workSec) => ({ workSec, restSec, label: `${Math.round(workSec / 60 * 10) / 10} min` }));
}

/** Wechselintervalle (Fahrtspiel): `rounds`× schnell/locker im Wechsel – die „Pause“
    ist hier lockeres Weiterlaufen (Float), kein Stopp. */
export function alternatingSegments(rounds = 6, fastSec = 60, floatSec = 60) {
  return Array.from({ length: rounds }, () => ({ workSec: fastSec, restSec: floatSec, label: t('plangen.segments.fast'), floatRest: true }));
}

/** Aufwärm-/Auslaufstrecke nach Niveau. */
function warmCool(cfg) {
  if (cfg.level === 'einsteiger' || cfg.key === 'hyrox') return { warm: 1.5, cool: 1.5 };
  if (cfg.level === 'leistung' && cfg.key === 'marathon') return { warm: 3, cool: 2 };
  return { warm: 2, cool: 2 };
}

/** Wiederholungen nach Niveau, so gekürzt, dass die Einheit ins Wochenbudget passt. */
function fitReps(base, min, kmOf, budget, cfg) {
  let n = Math.max(min, Math.round(base * REP_FACTOR[cfg.level]));
  while (n > min && kmOf(n) > budget * 1.15) n--;
  return n;
}

/** Zeit-Blöcke (Schwelle): n × workMin mit restMin Trabpause. */
function timeBlocks(ctx, { base, min = 2, workMin, restMin, paceKey, type = 'tempo', title, desc }) {
  const { cfg, pz, alloc } = ctx;
  const { warm, cool } = warmCool(cfg);
  const z = pz[paceKey];
  const kmOf = (n) => warm + cool + n * (kmForSec(workMin * 60, midPace(z)) + jogKm(restMin * 60));
  const n = fitReps(base, min, kmOf, alloc.quality, cfg);
  const segments = Array.from({ length: n }, (_, i) => ({ workSec: workMin * 60, restSec: restMin * 60, label: `${i + 1}/${n}` }));
  return mkUnit(ctx, type, {
    dist: r05(kmOf(n)), pace: pace(pz, paceKey), paceKey, title: title(n),
    intervals: { warmupKm: warm, cooldownKm: cool, segments },
    desc: desc(n, kmText(warm), kmText(cool)),
  });
}

/** Strecken-Wiederholungen: n × workM mit Trabpause (Sek.). */
function distanceReps(ctx, { base, min = 2, workM, restSec, paceKey, type = 'interval', title, desc }) {
  const { cfg, pz, alloc } = ctx;
  const { warm, cool } = warmCool(cfg);
  const z = pz[paceKey];
  const workSec = Math.round((workM / 1000) * (midPace(z) || 300));
  const kmOf = (n) => warm + cool + n * (workM / 1000 + jogKm(restSec));
  const n = fitReps(base, min, kmOf, alloc.quality, cfg);
  const label = workM >= 1000 && workM % 1000 === 0 ? `${workM / 1000} km` : `${workM} m`;
  const segments = Array.from({ length: n }, (_, i) => ({ workM, workSec, restSec, label: `${label} · ${i + 1}/${n}` }));
  return mkUnit(ctx, type, {
    dist: r05(kmOf(n)), pace: pace(pz, paceKey), paceKey, title: title(n),
    intervals: { warmupKm: warm, cooldownKm: cool, segments },
    desc: desc(n, kmText(warm), kmText(cool)),
  });
}

/** Schlüsseleinheit der Woche – phasen-, distanz- und niveauabhängig. */
function qualityUnit(ctx) {
  const { week, cfg, pz, alloc, sport, info } = ctx;
  // In den Tapering-Wochen gilt die Taper-Einheit, auch wenn die Phase noch „Spitze“ heißt.
  const phase = info.taper ? { key: 'taper' } : ctx.phase;
  const emKey = cfg.key === 'tri_sprint' ? '5k' : cfg.key === 'tri_olympic' ? '10k' : cfg.key;
  const even = week % 2 === 0;

  if (sport === 'hyrox' && phase.key !== 'base') {
    const taper = phase.key === 'taper';
    const pause = taper ? '2 min' : '90 s';
    return distanceReps(ctx, {
      base: taper ? 3 : 4 + (phase.key === 'peak' ? 2 : 0), min: 3, workM: 1000, restSec: taper ? 120 : 90,
      paceKey: 'threshold', type: 'tempo',
      title: (n) => t('plangen.hyroxRun.title', { n }),
      desc: (n, w, c) => t('plangen.hyroxRun.desc', { n, warm: w, cool: c, pause }),
    });
  }

  if (phase.key === 'base') {
    return mkUnit(ctx, 'easy', {
      dist: r05(clamp(alloc.quality, 4, 12)), pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.baseRun.title'),
      desc: t('plangen.baseRun.desc'),
    });
  }

  if (phase.key === 'build') {
    if (emKey === 'marathon') {
      return timeBlocks(ctx, {
        base: 2 + (week % 2), workMin: 12, restMin: 3, paceKey: 'threshold',
        title: (n) => t('plangen.threshold.title', { n, min: 12 }),
        desc: (n, w, c) => t('plangen.threshold.marathonDesc', { n, warm: w, cool: c }),
      });
    }
    if (even) { // Abwechslung: Fahrtspiel mit fließenden Wechseln statt Schwellenlauf
      const { warm, cool } = warmCool(ctx.cfg);
      const n = fitReps(8, 4, (k) => warm + cool + k * (kmForSec(60, midPace(pz.threshold)) + kmForSec(60, midPace(pz.easy) || 380)), alloc.quality, cfg);
      return mkUnit(ctx, 'tempo', {
        dist: r05(warm + cool + n * (kmForSec(60, midPace(pz.threshold)) + kmForSec(60, midPace(pz.easy) || 380))),
        pace: pace(pz, 'threshold'), paceKey: 'threshold', title: t('plangen.fartlek.title', { n }),
        intervals: { warmupKm: warm, cooldownKm: cool, segments: alternatingSegments(n, 60, 60) },
        desc: t('plangen.fartlek.desc', { warm: kmText(warm), n, cool: kmText(cool) }),
      });
    }
    return timeBlocks(ctx, {
      base: 3 + (week % 2), workMin: 6, restMin: 2, paceKey: 'threshold',
      title: (n) => t('plangen.threshold.title', { n, min: 6 }),
      desc: (n, w, c) => t('plangen.threshold.desc6', { n, warm: w, cool: c }),
    });
  }

  if (phase.key === 'peak') {
    if (emKey === 'marathon') {
      return even
        ? distanceReps(ctx, {
          base: 3, workM: 4000, restSec: 180, paceKey: 'race', type: 'tempo',
          title: (n) => t('plangen.marathonPace.title', { n }),
          desc: (n, w, c) => t('plangen.marathonPace.desc', { n, warm: w, cool: c }),
        })
        : timeBlocks(ctx, {
          base: 4, workMin: 8, restMin: 2, paceKey: 'threshold',
          title: (n) => t('plangen.threshold.title', { n, min: 8 }),
          desc: (n, w, c) => t('plangen.threshold.desc8', { n, warm: w, cool: c }),
        });
    }
    if (emKey === 'hm') {
      return even
        ? distanceReps(ctx, {
          base: 3, workM: 3000, restSec: 120, paceKey: 'race', type: 'tempo',
          title: (n) => t('plangen.hmPace.title', { n }),
          desc: (n, w, c) => t('plangen.hmPace.desc', { n, warm: w, cool: c }),
        })
        : distanceReps(ctx, {
          base: 6, min: 3, workM: 800, restSec: 150, paceKey: 'vo2',
          title: (n) => t('plangen.vo2.intervalsTitle', { n }),
          desc: (n, w, c) => t('plangen.vo2.desc800', { n, warm: w, cool: c }),
        });
    }
    if (emKey === '10k') {
      if (even) { // Pyramide: Einsteiger 1-2-3-2-1, sonst 1-2-3-4-3-2-1 min
        const peakSec = cfg.level === 'einsteiger' ? 180 : 240;
        const segments = pyramidSegments(peakSec, 60, 90);
        const { warm, cool } = warmCool(cfg);
        const workSec = segments.reduce((a, s) => a + s.workSec, 0);
        const seq = segments.map((s) => s.workSec / 60).join('-');
        return mkUnit(ctx, 'interval', {
          dist: r05(warm + cool + kmForSec(workSec, midPace(pz.vo2)) + jogKm(90 * (segments.length - 1))),
          pace: pace(pz, 'vo2'), paceKey: 'vo2', title: t('plangen.pyramid.title', { seq }),
          intervals: { warmupKm: warm, cooldownKm: cool, segments },
          desc: t('plangen.pyramid.desc', { warm: kmText(warm), seq: seq.replace(/-/g, ' – '), peak: peakSec / 60, cool: kmText(cool) }),
        });
      }
      return distanceReps(ctx, {
        base: 5, min: 3, workM: 1000, restSec: 150, paceKey: 'race',
        title: (n) => t('plangen.pace10k.title', { n }),
        desc: (n, w, c) => t('plangen.pace10k.desc', { n, warm: w, cool: c }),
      });
    }
    // 5 km: kurze, schnelle VO₂max-Reize
    return even
      ? distanceReps(ctx, {
        base: 8, min: 4, workM: 400, restSec: 90, paceKey: 'vo2',
        title: (n) => t('plangen.vo2.title', { n, m: 400 }),
        desc: (n, w, c) => t('plangen.vo2.desc400', { n, warm: w, cool: c }),
      })
      : distanceReps(ctx, {
        base: 5, min: 3, workM: 1000, restSec: 150, paceKey: 'vo2',
        title: (n) => t('plangen.vo2.title', { n, m: 1000 }),
        desc: (n, w, c) => t('plangen.vo2.desc1000', { n, warm: w, cool: c }),
      });
  }

  // Tapering (W-2/W-1): Reiz halten, Umfang runter
  if (emKey === 'marathon' || emKey === 'hm') {
    return distanceReps(ctx, {
      base: 2, min: 2, workM: 2000, restSec: 180, paceKey: 'race', type: 'tempo',
      title: (n) => t('plangen.taper.raceTitle', { n }),
      desc: (n, w, c) => t('plangen.taper.raceDesc', { n, warm: w, cool: c }),
    });
  }
  const tMin = cfg.level === 'einsteiger' ? 4 : 6;
  return timeBlocks(ctx, {
    base: 2, min: 2, workMin: tMin, restMin: 3, paceKey: 'threshold',
    title: (n) => t('plangen.taper.tempoTitle', { n, min: tMin }),
    desc: (n, w, c) => t('plangen.taper.tempoDesc', { n, warm: w, cool: c, min: tMin }),
  });
}

/** Stufen des Lauf-Geh-Wechsels: [Wiederholungen, Laufzeit in Sek.], je 1 min Gehen. */
const RUN_WALK_STEPS = [[6, 120], [6, 180], [5, 240], [4, 300], [3, 480], [2, 720]];

/** Lauf-Geh-Wechsel für Einsteiger:innen ohne Laufbasis. Alle Läufe der Woche folgen
    derselben Stufe (kürzer, normal, länger) – ein durchgehender 3-km-Lauf wäre in
    den ersten Wochen noch zu viel. */
function runWalkUnit(ctx, variant = 'base') {
  const idx = Math.max(0, Math.min(ctx.week - 1, RUN_WALK_STEPS.length - 1) - (ctx.info.deload ? 1 : 0));
  let [n, runSec] = RUN_WALK_STEPS[idx];
  if (variant === 'short') n = Math.max(2, n - 1);
  if (variant === 'long') n += 1;
  const runMin = (n * runSec) / 60;
  const walkMin = n + 10;
  const segments = Array.from({ length: n }, (_, i) => ({ workSec: runSec, restSec: 60, label: t('plangen.runWalk.run', { i: i + 1, n }), phaseLabel: t('plangen.runWalk.run', { i: i + 1, n }), restLabel: t('plangen.runWalk.walk'), walk: true, floatRest: true }));
  return mkUnit(ctx, 'easy', {
    dist: r05(runMin / 7.5 + walkMin / 12), dur: Math.round(runMin + walkMin),
    pace: pace(ctx.pz, 'easy'), paceKey: 'easy',
    title: variant === 'long' ? t('plangen.runWalk.titleLonger', { n, min: runSec / 60 }) : t('plangen.runWalk.title', { n, min: runSec / 60 }),
    intervals: { warmupSec: 300, cooldownSec: 300, segments },
    desc: t('plangen.runWalk.desc', { n, min: runSec / 60 }),
  });
}

/** Zügiges Gehen statt eines sehr kurzen Laufs (kleine Wochenumfänge). */
function walkUnit(ctx) {
  return mkUnit(ctx, 'walk', {
    dur: 30, hrZone: 1, title: t('plangen.walk.title'),
    desc: t('plangen.walk.desc'),
  });
}

/** Long Run der Woche (bei Hyrox ein ruhiger, langer Dauerlauf). */
function longUnit(ctx) {
  const { phase, alloc, info, cfg, pz, sport } = ctx;
  const km = alloc.long;
  if (sport === 'hyrox') {
    return mkUnit(ctx, 'easy', {
      dist: km, pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.long.easyTitle', { km: kmText(km) }),
      desc: t('plangen.long.easyDesc'),
    });
  }
  const title = km >= 10 ? t('plangen.long.title', { km: kmText(km) }) : t('plangen.long.titleShorter', { km: kmText(km) });
  const bikeKm = { from: Math.round(km * 4), to: Math.round(km * 5) };
  const bike = sport === 'triathlon' ? '' : ` ${t('plangen.long.bikeAlt', bikeKm)}`;
  const lead = info.deload ? `${t('plangen.long.leadDeload')} ` : info.taper ? `${t('plangen.long.leadTaper')} ` : '';
  const blockShare = phase.key === 'peak' && !info.deload && !info.taper ? (cfg.key === 'marathon' ? 0.4 : cfg.key === 'hm' ? 0.3 : 0) : 0;
  const blockKm = r05(km * blockShare);
  if (blockKm >= 3) {
    const rz = pz.race;
    const paceTxt = rz && rz.min ? ` (${fmtPaceRange(rz.min, rz.max)})` : '';
    return mkUnit(ctx, 'long', {
      dist: km, pace: pace(pz, 'long'), paceKey: 'long', raceBlockKm: blockKm, title,
      desc: `${t('plangen.long.raceBlockDesc', { km: kmText(km), block: kmText(blockKm), pace: paceTxt })}${bike && ` ${t('plangen.long.bikeAltRaceBlock', bikeKm)}`}`,
    });
  }
  const finish = phase.key === 'peak' && !info.deload && !info.taper && (cfg.key === '5k' || cfg.key === '10k')
    ? ` ${t('plangen.long.finish')}` : '';
  return mkUnit(ctx, 'long', {
    dist: km, pace: pace(pz, 'long'), paceKey: 'long', title,
    desc: `${lead}${t('plangen.long.desc')}${finish}${bike}`,
  });
}

/** Faktor für Schwimm-/Rad-/Stationsdauer nach Phase und Woche. */
function multiFactor(ctx, byPhase) {
  const { phase, info } = ctx;
  const f = byPhase[phase.key] ?? 1;
  const w = info.deload ? 0.8 : info.taper === 'w1' ? 0.6 : info.taper === 'w2' ? 0.8 : 1;
  return f * w;
}

function swimUnit(ctx) {
  const fmt = TRI_FORMATS[ctx.cfg.key] || TRI_FORMATS.tri_sprint;
  const olympic = ctx.cfg.key === 'tri_olympic';
  const dur = r5((olympic ? 45 : 35) * multiFactor(ctx, { base: 1, build: 1.1, peak: 1.2, taper: 0.8 }));
  if (ctx.dow === 2) { // Dienstag: Technik & Intervalle
    const reps = ({ base: 6, build: 8, peak: 10, taper: 6 })[ctx.phase.key] + (olympic ? 2 : 0);
    return mkUnit(ctx, 'swim', {
      dur, title: t('plangen.swim.techTitle'),
      desc: t('plangen.swim.techDesc', { m: olympic ? 300 : 200, reps }),
    });
  }
  const race = ctx.phase.key === 'peak' && !ctx.info.deload;
  return mkUnit(ctx, 'swim', {
    dur, title: t('plangen.swim.enduranceTitle'),
    desc: race
      ? t('plangen.swim.raceDesc', { m: fmt.swimM })
      : t('plangen.swim.enduranceDesc', { m: olympic ? 500 : 300 }),
  });
}

function bikeUnit(ctx) {
  const olympic = ctx.cfg.key === 'tri_olympic';
  const dur = r5((olympic ? 60 : 45) * multiFactor(ctx, { base: 1, build: 1.15, peak: 1.25, taper: 0.8 }));
  const text = {
    base: [t('plangen.bike.baseTitle'), t('plangen.bike.baseDesc')],
    build: [t('plangen.bike.buildTitle'), t('plangen.bike.buildDesc')],
    peak: [t('plangen.bike.peakTitle'), t('plangen.bike.peakDesc')],
    taper: [t('plangen.bike.taperTitle'), t('plangen.bike.taperDesc')],
  }[ctx.phase.key] || [t('plangen.bike.title'), t('plangen.bike.desc')];
  return mkUnit(ctx, 'cross_bike', { dur, title: text[0], hrZone: ctx.phase.key === 'base' ? 2 : 4, desc: text[1] });
}

function longBikeUnit(ctx) {
  const olympic = ctx.cfg.key === 'tri_olympic';
  const dur = r5((olympic ? 90 : 60) * multiFactor(ctx, { base: 1, build: 1.3, peak: 1.6, taper: 0.8 }));
  const brick = (ctx.phase.key === 'build' || ctx.phase.key === 'peak') && !ctx.info.deload && !ctx.info.taper;
  return mkUnit(ctx, 'cross_bike', {
    dur, hrZone: 2, title: brick ? t('plangen.bike.longBrickTitle') : t('plangen.bike.longTitle'),
    desc: `${t('plangen.bike.longDesc', { dur })}${brick ? ` ${t('plangen.bike.brick')}` : ''}`,
  });
}

function functionalUnit(ctx) {
  const { phase, week, cfg, info } = ctx;
  const rounds = (n) => Math.max(2, Math.round(n * REP_FACTOR[cfg.level]) - (info.deload ? 1 : 0));
  const f = info.deload ? 0.8 : 1;
  if (phase.key === 'base') {
    return mkUnit(ctx, 'strength', {
      dur: r5(45 * f), title: t('plangen.hyrox.baseTitle'),
      desc: t('plangen.hyrox.baseDesc', { rounds: rounds(3) }),
    });
  }
  if (phase.key === 'build') {
    return mkUnit(ctx, 'strength', {
      dur: r5(55 * f), title: t('plangen.hyrox.buildTitle'),
      desc: t('plangen.hyrox.buildDesc', { rounds: rounds(4) }),
    });
  }
  if (phase.key === 'peak') {
    if (week % 2 === 0 && !info.deload) {
      return mkUnit(ctx, 'strength', {
        dur: r5(70 * f), title: t('plangen.hyrox.simTitle'),
        desc: t('plangen.hyrox.simDesc', { rounds: rounds(6) }),
      });
    }
    return mkUnit(ctx, 'strength', {
      dur: r5(50 * f), title: t('plangen.hyrox.peakTitle'),
      desc: t('plangen.hyrox.peakDesc', { rounds: rounds(5) }),
    });
  }
  return mkUnit(ctx, 'strength', {
    dur: 30, title: t('plangen.hyrox.taperTitle'),
    desc: t('plangen.hyrox.taperDesc'),
  });
}

/**
 * Einheiten in den Tagen vor dem Wettkampf (Rennwoche) – unabhängig vom Wochentag
 * des Rennens. Liefert eine Einheit, null (Ruhetag) oder undefined (normal planen).
 *   1 Tag vorher: Shakeout; 2 Tage vorher: frei; 3–6 Tage vorher: Aktivierung,
 *   kurze lockere Läufe, keine Kraft, keine langen Rad-/Stationseinheiten.
 */
function nearRaceUnit(role, ctx) {
  const dtr = ctx.daysToRace;
  if (!(dtr >= 1 && dtr <= 6)) return undefined;
  const { pz, cfg } = ctx;
  const isRun = RUN_ROLES.includes(role);
  const short = cfg.level === 'einsteiger' ? 3 : cfg.level === 'leistung' ? 5 : 4;
  if (role === 'mobility') return undefined;
  if (dtr === 1) {
    if (isRun) return mkUnit(ctx, 'recovery', { dist: 3, pace: pace(pz, 'recovery'), paceKey: 'recovery', title: t('plangen.near.shakeoutTitle'), desc: t('plangen.near.shakeoutDesc') });
    if (role === 'bike' || role === 'long_bike') return mkUnit(ctx, 'cross_bike', { dur: 20, hrZone: 1, title: t('plangen.near.bikeCheckTitle'), desc: t('plangen.near.bikeCheckDesc') });
    return null;
  }
  if (dtr === 2) return null;
  switch (role) {
    case 'quality': {
      const beginner = cfg.level === 'einsteiger';
      const sec = beginner ? 60 : 120;
      return mkUnit(ctx, 'tempo', {
        dist: beginner ? 4 : 5, pace: pace(pz, 'race') || pace(pz, 'threshold'), paceKey: pz.race ? 'race' : 'threshold', title: t('plangen.near.activationTitle'),
        intervals: { warmupKm: beginner ? 1.5 : 2, cooldownKm: 1, segments: Array.from({ length: 3 }, (_, i) => ({ workSec: sec, restSec: 120, label: `${i + 1}/3` })) },
        desc: t('plangen.near.activationDesc', { warm: kmText(beginner ? 1.5 : 2), min: sec / 60 }),
      });
    }
    case 'long':
      if (ctx.sport === 'hyrox' || ctx.sport === 'triathlon') return mkUnit(ctx, 'easy', { dist: short + 1, pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.near.easyShortTitle'), desc: t('plangen.near.easyShortDesc') });
      return mkUnit(ctx, 'easy', { dist: r05(clamp(cfg.peakLongKm * 0.4, short, 10)), pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.steadyRun.title'), desc: t('plangen.near.lastLongerDesc') });
    case 'endurance': case 'extra': case 'recovery':
      return mkUnit(ctx, 'easy', { dist: short, pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.near.easyShortTitle'), desc: t('plangen.near.easyShortDesc') });
    case 'swim':
      return mkUnit(ctx, 'swim', { dur: 25, title: t('plangen.near.swimTitle'), desc: t('plangen.near.swimDesc') });
    case 'bike':
      return mkUnit(ctx, 'cross_bike', { dur: 40, hrZone: 2, title: t('plangen.near.rideTitle'), desc: t('plangen.near.rideDesc') });
    case 'long_bike':
      return mkUnit(ctx, 'cross_bike', { dur: 45, hrZone: 2, title: t('plangen.near.brickTitle'), desc: t('plangen.near.brickDesc') });
    case 'functional':
      return mkUnit(ctx, 'strength', { dur: 20, title: t('plangen.near.hyroxTitle'), desc: t('plangen.near.hyroxDesc') });
    default:
      return null;   // Kraft & Co. in der Rennwoche: frei
  }
}

/** Wandelt eine Vorlagen-„Rolle“ in eine konkrete Einheit (phasen- und niveauabhängig). */
function resolveRole(role, ctx) {
  const near = nearRaceUnit(role, ctx);
  if (near !== undefined) return near;
  const { pz, alloc, phase, week, sport, cfg } = ctx;

  // Einsteiger:innen ohne Laufbasis: die ersten Wochen im Lauf-Geh-Wechsel (nie in
  // den letzten beiden Wochen vor dem Rennen).
  if (week <= cfg.runWalkWeeks && week < ctx.plan.weeks - 1) {
    if (role === 'quality') return runWalkUnit(ctx, 'base');
    if (role === 'endurance') return runWalkUnit(ctx, 'short');
    if (role === 'long') return runWalkUnit(ctx, 'long');
    if (role === 'recovery' || role === 'extra') return walkUnit(ctx);
  }
  if ((role === 'recovery' || role === 'extra') && alloc.walk) return walkUnit(ctx);

  switch (role) {
    case 'cross_football': // Altpläne mit Fußball im Gerüst
      return mkUnit(ctx, 'cross_football', { dur: 90, title: t('plangen.football.title'), desc: t('plangen.football.desc') });

    case 'strength': {
      const focus = sport === 'hyrox' ? HYROX_STRENGTH : STRENGTH_FOCUS;
      const f = focus[(week - 1) % focus.length];
      const title = sport === 'hyrox' ? f.title : t('plangen.strength.title', { focus: f.title });
      return mkUnit(ctx, 'strength', { dur: phase.key === 'taper' || ctx.info.deload ? 30 : (sport === 'triathlon' ? 30 : 40), title, desc: f.desc });
    }

    case 'mobility':
      return mkUnit(ctx, 'mobility', { dur: 15, title: t('plangen.mobility.title'), desc: t('plangen.mobility.desc') });

    case 'recovery':
      return mkUnit(ctx, 'recovery', {
        dist: alloc.recovery, pace: pace(pz, 'recovery'), paceKey: 'recovery', title: t('plangen.recovery.title'),
        desc: t('plangen.recovery.desc'),
      });

    case 'extra':
      return mkUnit(ctx, 'easy', {
        dist: alloc.extra, pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.extra.title'),
        desc: t('plangen.extra.desc'),
      });

    case 'endurance': {
      const walk = cfg.runWalk && week <= 2 ? ` ${t('plangen.steadyRun.walkBreaks')}` : '';
      return mkUnit(ctx, 'easy', {
        dist: alloc.endurance, pace: pace(pz, 'easy'), paceKey: 'easy', title: t('plangen.steadyRun.title'),
        desc: `${t('plangen.steadyRun.desc')}${walk}${sport === 'run' ? ` ${t('plangen.steadyRun.backAlt')}` : ''}`,
      });
    }

    case 'quality': return qualityUnit(ctx);
    case 'long': return longUnit(ctx);
    case 'swim': return swimUnit(ctx);
    case 'bike': return bikeUnit(ctx);
    case 'long_bike': return longBikeUnit(ctx);
    case 'functional': return functionalUnit(ctx);
    default: return null;
  }
}

/** Taktik je Distanz für die Renneinheit. */
function raceTactic(raceKm) {
  const km = Number(raceKm) || 21.0975;
  if (km <= 6) return t('plangen.tactic.5k');
  if (km <= 12) return t('plangen.tactic.10k');
  if (km <= 25) return t('plangen.tactic.hm', { km: Math.round(km * 0.7) });
  return t('plangen.tactic.marathon', { km: Math.round(km * 0.72) });
}

/** Renntempo-Zone ohne Plan-Paces (Altbestand): nach Distanz aus dem Profil. */
function legacyRaceZone(pz, raceKm) {
  const km = Number(raceKm) || 21.0975;
  const key = km <= 6 ? 'vo2' : km <= 12 ? 'threshold' : km <= 25 ? 'race_hm' : 'marathon';
  return pz[key] && pz[key].min ? { ...pz[key] } : null;
}

function mmss(sec) { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function hmsToSec(hms) { if (!hms) return 0; const p = String(hms).split(':').map(Number); while (p.length < 3) p.unshift(0); return p[0] * 3600 + p[1] * 60 + p[2]; }

/** Die Renneinheit am Wettkampftag. */
export function makeRaceUnit(plan, event, date, week, phase, pz = {}) {
  const ctx = { plan, date, week, phase };
  const sport = event.sport || plan.sport || 'run';
  const targetSec = hmsToSec(event.targetTime);
  const target = event.targetTime ? ` ${t('plangen.race.targetTime', { time: event.targetTime })}` : '';
  if (sport === 'triathlon') {
    const fmt = TRI_FORMATS[raceKey(event)];
    return mkUnit(ctx, 'race', {
      title: event.name, dist: fmt.runKm, dur: targetSec ? Math.round(targetSec / 60) : null, hrZone: 4, time: '10:00',
      desc: t('plangen.race.triDesc', { format: fmt.label, swim: fmt.swimM, bike: fmt.bikeKm, run: fmt.runKm, target }),
    });
  }
  if (sport === 'hyrox') {
    const splits = targetSec
      ? ` ${t('plangen.race.hyroxSplits', { time: event.targetTime, run: mmss(targetSec * 0.52 / 8), station: mmss(targetSec * 0.48 / 8) })}`
      : '';
    return mkUnit(ctx, 'race', {
      title: event.name, dist: 8, dur: targetSec ? Math.round(targetSec / 60) : null, hrZone: 4, time: '10:00',
      desc: t('plangen.race.hyroxDesc', { target, splits }),
    });
  }
  const z = pz.race && pz.race.min ? pz.race : legacyRaceZone(pz, event.distanceKm);
  const km = Number(event.distanceKm) || 21.0975;
  return mkUnit(ctx, 'race', {
    title: event.name, dist: event.distanceKm,
    pace: z ? { min: z.min, max: z.max, hrZone: z.hrZone, key: 'race' } : null, paceKey: 'race',
    hrZone: km <= 6 ? 5 : km <= 25 ? 4 : 3, time: '10:00',
    desc: t('plangen.race.runDesc', { target, tactic: raceTactic(event.distanceKm) }),
  });
}

/** Baut die Einheit für einen festen Termin (Fußball/Spiel) an einem Datum. */
/** Schlüsselrollen, die nicht neben einem harten festen Termin liegen sollen. */
const KEY_ROLES = new Set(['quality', 'long']);

/** Fester Termin, der fordert: Spiel immer, Fußballtraining außer „leicht“. */
function isHardCommit(c) {
  const type = commitMeta(c && c.type).unitType;
  return type === 'match' || (type === 'cross_football' && c.intensity !== 'leicht');
}

/** Ersatz für eine Qualitätseinheit, die sonst direkt neben einem harten Termin läge. */
function stridesUnit(ctx) {
  const raceWeek = ctx.daysToRace <= 6;
  const short = ctx.cfg.level === 'einsteiger' ? 3 : ctx.cfg.level === 'leistung' ? 5 : 4;
  const unit = mkUnit(ctx, 'easy', {
    dist: raceWeek ? short : r05(clamp(ctx.alloc.quality || ctx.alloc.endurance || 6, 4, 12)), pace: pace(ctx.pz, 'easy'), paceKey: 'easy',
    title: t('plangen.strides.title'),
    desc: raceWeek
      ? t('plangen.strides.raceWeekDesc')
      : t('plangen.strides.desc'),
  });
  if (unit) unit.downgradedFrom = 'quality';
  return unit;
}

function mkCommitUnit(plan, date, c, week, phase) {
  const type = commitMeta(c.type).unitType || 'cross_football';
  return {
    id: uid('u'), planId: plan.id, eventId: plan.eventId,
    date, dow: isoDow(date), week, phase: phase.key,
    type, title: c.label || typeMeta(type).label,
    targetDistanceKm: null, targetDurationMin: c.durationMin || null,
    targetPaceSecPerKm: null, targetPaceMaxSecPerKm: null, targetHrZone: null,
    description: c.desc || '', time: null, intervals: null,
    status: 'geplant', executedSessionId: null,
    commitmentId: c.id, fixed: true, intensity: c.intensity || null,  // Fußball-Intensität (#5)
    createdAt: nowIso(), updatedAt: nowIso(),
  };
}

/** Schlüssel eines festen Termins an einem Tag – über Pläne hinweg eindeutig. */
export function fixedKey(unitType, date) { return `${unitType}|${date}`; }

/** Feste Termine, die andere Pläne schon eintragen (gegen doppelte Einträge). */
export function coveredFixed(plans = [], excludePlanId = null) {
  const out = new Set();
  (plans || []).forEach((p) => {
    if (!p || p.id === excludePlanId) return;
    (p.units || []).forEach((u) => { if (u && u.fixed) out.add(fixedKey(u.type, u.date)); });
  });
  return out;
}

/** Erzeugt die Einheiten genau einer Plan-Woche (1-basiert) – Basis für die
    selektive Wochen-Neuberechnung. `opts.coveredFixed`: feste Termine, die ein
    anderer Plan schon einträgt – sie formen die Woche mit, erscheinen aber nicht doppelt. */
export function buildWeekUnits(plan, event, profile = {}, week, opts = {}) {
  const pz = plan.paces || (profile && profile.paceZones) || {};
  const sport = (event && event.sport) || plan.sport || 'run';
  const cfg = volumeConfig(plan, event || {}, pz);
  const info = weekVolumes(plan, cfg)[week] || { km: cfg.start, deload: false, taper: null };
  const tpl = plan.weekTemplate || DEFAULT_WEEK_TEMPLATE;
  const phase = phaseForWeek(plan, week);
  const alloc = allocate(cfg, info, countRoles(tpl), phase.key);
  const weekStart = addDays(plan.startDate, (week - 1) * 7);
  const weekEnd = addDays(weekStart, 6);
  const monday = weekStartMonday(weekStart);
  const raceDate = event ? event.date : null;
  const covered = opts.coveredFixed || new Set();

  // Feste Termine dieser Woche einsammeln (Wettkampftag hat immer Vorrang).
  const commitByDate = new Map();
  for (const { date, commitment } of commitmentDates(planCommitments(plan), weekStart, weekEnd)) {
    if (raceDate && date >= raceDate) continue;
    if (!commitByDate.has(date)) commitByDate.set(date, []);
    commitByDate.get(date).push(commitment);
  }

  const dateOf = (dow) => {
    const d = addDays(monday, dow - 1);
    return d < weekStart ? addDays(d, 7) : d;   // Planstart mitten in der Woche
  };
  const usedDates = new Set([...tpl.map((row) => dateOf(row.dow)), ...commitByDate.keys()]);
  const dtr = (date) => (raceDate ? diffDays(date, raceDate) : Infinity);

  /** Freier Tag dieser Woche für eine verdrängte Einheit – möglichst nah am
      ursprünglichen Tag, nie am Renntag oder in den zwei Tagen davor, nie direkt
      neben einem festen Termin (sonst entsteht die nächste Doppelbelastung). */
  const findFreeDay = (wishDate) => {
    const cands = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (usedDates.has(date) || date < plan.startDate) continue;
      if (raceDate && (date >= raceDate || dtr(date) <= 2)) continue;
      const neighborCommit = commitByDate.has(addDays(date, -1)) || commitByDate.has(addDays(date, 1));
      cands.push({ date, dist: Math.abs(diffDays(wishDate, date)), neighborCommit });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (a.neighborCommit - b.neighborCommit) || (a.dist - b.dist));
    return cands[0].date;
  };

  // Rollen, die bei einer Kollision AUSWEICHEN statt zu entfallen: die Reize, die
  // das Ziel tragen. Lockeres (Regeneration/Mobility/Zusatzlauf) entfällt an einem
  // Termintag bewusst – der feste Termin ist an dem Tag die Belastung.
  const RELOCATABLE = new Set(['quality', 'long', 'endurance', 'strength', 'swim', 'bike', 'long_bike', 'functional']);

  // Harte feste Termine (Fußball nicht „leicht“, Spiele) – auch die, die ein anderer
  // Plan einträgt. Qualitätseinheit und Long Run liegen nie direkt daneben: Sonst
  // baute der Plan selbst harte Tage in Folge, der Wochen-Check bemängelte die eigene
  // Struktur, und der Coach schlug jede Woche vor, genau die Schlüsseleinheit zu streichen.
  const hardCommit = new Set();
  // Inklusive Sonntag davor und Montag danach (Spiel am Sonntag → kein Tempo am Montag).
  for (const { date, commitment } of commitmentDates(planCommitments(plan), addDays(weekStart, -1), addDays(weekEnd, 1))) {
    if ((!raceDate || date < raceDate) && isHardCommit(commitment)) hardCommit.add(date);
  }
  for (const key of covered) {
    const [type, d] = String(key).split('|');
    if ((type === 'cross_football' || type === 'match') && d >= addDays(weekStart, -1) && d <= addDays(weekEnd, 1)) hardCommit.add(d);
  }
  const nextToHard = (date) => hardCommit.has(addDays(date, -1)) || hardCommit.has(addDays(date, 1));
  const keyDates = new Set(tpl.filter((row) => row.units.some((x) => KEY_ROLES.has(x.role))).map((row) => dateOf(row.dow)));
  /** Ruhiger Tag für eine Schlüsseleinheit: frei, nicht neben einem harten Termin und
      nicht neben einer anderen Schlüsseleinheit, nie in den zwei Tagen vor dem Rennen. */
  const findCalmDay = (wishDate) => {
    const cands = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (usedDates.has(date) || date < plan.startDate || hardCommit.has(date)) continue;
      if (raceDate && (date >= raceDate || dtr(date) <= 2)) continue;
      if (nextToHard(date)) continue;
      if ([...keyDates].some((k) => k !== wishDate && Math.abs(diffDays(k, date)) === 1)) continue;
      cands.push({ date, dist: Math.abs(diffDays(wishDate, date)) });
    }
    cands.sort((a, b) => a.dist - b.dist);
    return cands.length ? cands[0].date : null;
  };

  const out = [];
  for (const row of tpl) {
    const date = dateOf(row.dow);
    if (date < plan.startDate || date > weekEnd) continue;
    if (raceDate && date >= raceDate) continue;
    const blocked = commitByDate.has(date);
    for (const u of row.units) {
      let useDate = date;
      let downgrade = false;
      if (blocked) {
        if (!RELOCATABLE.has(u.role)) continue;
        const alt = findFreeDay(date);
        if (!alt) continue;
        useDate = alt;
        usedDates.add(alt);
      } else if (KEY_ROLES.has(u.role) && nextToHard(date) && dtr(date) > 2
        && isHard(resolveRole(u.role, { plan, event, date, week, phase, pz, sport, cfg, info, alloc, dow: row.dow, daysToRace: dtr(date) }) || {})) {
        const alt = findCalmDay(date);
        if (alt) {
          useDate = alt;
          usedDates.add(alt);
          keyDates.delete(date);
          keyDates.add(alt);
        } else if (u.role === 'quality') {
          // Kein ruhiger Tag frei: Die Intensität liefert in dieser Woche der Termin –
          // die Laufeinheit bleibt locker mit Steigerungen.
          downgrade = true;
          keyDates.delete(date);
        }
      }
      const ctx = { plan, event, date: useDate, week, phase, pz, sport, cfg, info, alloc, dow: row.dow, daysToRace: dtr(useDate) };
      const unit = downgrade ? stridesUnit(ctx) : resolveRole(u.role, ctx);
      if (unit) {
        if (useDate !== date) unit.relocatedFrom = date;
        out.push(unit);
      }
    }
  }
  // Die Renneinheit steht am Wettkampftag – an jedem Wochentag.
  if (event && raceDate >= weekStart && raceDate <= weekEnd && raceDate >= plan.startDate) {
    out.push(makeRaceUnit(plan, event, raceDate, week, phase, pz));
  }
  // Feste Termine als Einheiten einfügen – der Plan wurde um sie herum gebaut.
  for (const [date, cs] of commitByDate) {
    for (const c of cs) {
      const type = commitMeta(c.type).unitType || 'cross_football';
      if (covered.has(fixedKey(type, date))) continue;
      out.push(mkCommitUnit(plan, date, c, week, phase));
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function generatePlanUnits(plan, event, profile = {}, opts = {}) {
  const units = [];
  for (let w = 1; w <= plan.weeks; w++) units.push(...buildWeekUnits(plan, event, profile, w, opts));
  units.sort((a, b) => a.date.localeCompare(b.date));
  return units;
}
