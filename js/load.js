/* =========================================================================
   load.js — Belastungssteuerung. Reine, DOM-freie Logik -> per node:test
   abgedeckt. EINZIGE Quelle für Belastungsurteile in der App: sRPE-Last
   (Dauer × Anstrengung, Foster) und die daraus abgeleiteten Kennzahlen:

     - Lastverhältnis (ACWR): letzte 7 Tage gegen die 21 Tage davor – entkoppelt,
       weil die akuten Tage sonst im eigenen Nenner stecken (Scheinkorrelation,
       Lolli et al. 2019). Die Grenzen 0,8 / 1,3 / 1,5 sind eine Orientierung aus
       Beobachtungsdaten, kein Verletzungsbarometer (Impellizzeri et al. 2020).
     - Fitness / Ermüdung / Form (CTL / ATL / TSB) als Impuls-Antwort-Glättung
       nach Banister – in Belastungspunkten (AU), Form relativ zur Fitness.
     - Monotonie & Strain (Foster) – Hinweis nur bei gleichförmiger UND über dem
       eigenen Schnitt liegender Last.

   Alles als Orientierung gedacht – Näherungen, keine Labordiagnostik. `today`
   wird immer übergeben (keine Abhängigkeit von der Geräteuhr).
   ========================================================================= */

import { addDays, diffDays, fmtDec } from './ui.js';

import { t, tp } from './i18n.js';

const r1 = (v) => Math.round(v * 10) / 10;
/** Zahl mit deutschem Dezimalkomma (z. B. 1,24). */
export function fmtRatio(v) {
  return fmtDec(v == null ? null : Math.round(v * 100) / 100);
}

/* --------------------------- Belastung je Einheit --------------------------- */

/** Geschätztes Belastungsempfinden je Einheitentyp, falls kein RPE erfasst wurde. */
export const RPE_BY_TYPE = {
  recovery: 3, easy: 4, long: 6, tempo: 7, interval: 8, race: 9, run: 5,
  // Fußball ist HIIT-artig (Antritte, Spielintensität) und wird höher gewichtet als
  // ein lockerer Lauf; der Default 7 entspricht „normal“ (siehe FOOTBALL_RPE).
  strength: 5, mobility: 2, cross: 5, cross_bike: 5, cross_football: 7, match: 8, camp: 7, walk: 2, other: 4,
  // Übrige Sportarten der Erfassung – ohne Eintrag zählte Indoor-Cycling wie ein lockerer Lauf.
  swim: 5, hike: 4, rowing: 6, tennis: 6, badminton: 6, squash: 7, tabletennis: 5, spinning: 6, elliptical: 5, gym: 5,
};
/** Fußball-Intensität → RPE. Pro Termin einstellbar (leicht/normal/intensiv), damit
    die Belastung realistisch in ACWR/Form und die Plan-Entlastung einfließt (#5). */
export const FOOTBALL_RPE = { leicht: 5, normal: 7, intensiv: 8.5 };
export function footballRpe(intensity) { return FOOTBALL_RPE[intensity] || FOOTBALL_RPE.normal; }

/* Uhrendaten: Fehlt die Anstrengung, schätzt die Ø-Herzfrequenz sie – relativ zur
   Max-HF der Person. Die Belastung bleibt sRPE (Dauer × Anstrengung); die HF liefert nur
   den Eingangswert. Ohne diese Schätzung zählte jede importierte Einheit als „locker“
   (ein Intervalltraining von der Uhr mit Anstrengung 4 statt ~7). */
let hrReference = () => null;
/** Liefert die Max-HF der aktiven Person (`{ maxHr }`); die App registriert das einmal. */
export function useHrReference(fn) { hrReference = typeof fn === 'function' ? fn : () => null; }

/** Stützstellen Ø-HF in % der Max-HF → Anstrengung (passend zu den HF-Zonen 50/60/70/80/90 %). */
const HR_RPE = [[0.5, 1.5], [0.6, 2.5], [0.7, 4], [0.8, 6], [0.9, 8], [1, 10]];
/** Anstrengung (1–10, eine Nachkommastelle) aus Ø-HF und Max-HF; null ohne verwertbare Werte. */
export function rpeFromHr(avgHr, maxHr) {
  const a = Number(avgHr), m = Number(maxHr);
  if (!(a >= 60) || !(m >= 120 && m <= 230) || a > m * 1.05) return null;
  const pct = a / m;
  if (pct <= HR_RPE[0][0]) return HR_RPE[0][1];
  for (let i = 1; i < HR_RPE.length; i++) {
    const [x0, y0] = HR_RPE[i - 1], [x1, y1] = HR_RPE[i];
    if (pct <= x1) return Math.round((y0 + ((y1 - y0) * (pct - x0)) / (x1 - x0)) * 10) / 10;
  }
  return 10;
}

/** Harte Einheiten: Die Ø-HF unterschätzt Intervalle (die Pausen zählen mit) – dort bleibt
    der Wert des Typs die Untergrenze. */
const HARD_TYPES = new Set(['tempo', 'interval', 'race', 'match']);

/**
 * Anstrengung einer Einheit (1–10) samt Herkunft: erfasst (geklemmt) → Fußball-Intensität →
 * aus der Herzfrequenz geschätzt → Standardwert des Typs. RPE 0, negative oder ungültige
 * Werte gelten als „nicht erfasst“.
 * @returns {{rpe:number, source:'erfasst'|'herzfrequenz'|'typ'}}
 */
export function sessionRpeInfo(s, ref = hrReference()) {
  const r = Number(s && s.rpe);
  if (Number.isFinite(r) && r > 0) return { rpe: Math.min(10, Math.max(1, r)), source: 'erfasst' };
  if (s && s.type === 'cross_football') return { rpe: footballRpe(s.intensity), source: 'typ' };
  const typeRpe = RPE_BY_TYPE[s && s.type] || 4;
  const hr = ref ? rpeFromHr(s && s.avgHr, ref.maxHr) : null;
  if (hr != null) return { rpe: HARD_TYPES.has(s.type) ? Math.max(hr, typeRpe) : hr, source: 'herzfrequenz' };
  return { rpe: typeRpe, source: 'typ' };
}

/** Anstrengung einer Einheit auf der Skala 1–10 (siehe `sessionRpeInfo`). */
export function sessionRpe(s, ref) {
  return sessionRpeInfo(s, ref === undefined ? hrReference() : ref).rpe;
}

/** Minuten je km, wenn nur die Strecke bekannt ist (Laufen 6, Rad deutlich schneller …). */
const MIN_PER_KM = { cross_bike: 2.5, spinning: 2.5, walk: 12, hike: 15, swim: 25, rowing: 5 };
/** Obergrenze einer einzelnen Einheit – ein Tippfehler (3000 statt 30 min) darf die
    Belastung nicht für Wochen verzerren. */
const MAX_MIN = 24 * 60;

/**
 * Dauer (min), mit der eine Einheit in die Belastung eingeht – samt Herkunft:
 * erfasst → aus der Strecke → geplante Dauer der Einheit → 30-min-Pauschale.
 * @returns {{min:number, source:'erfasst'|'strecke'|'geplant'|'pauschal'}}
 */
export function loadMinutes(s) {
  const sec = Number(s && s.durationSec);
  if (Number.isFinite(sec) && sec > 0) return { min: Math.min(sec / 60, MAX_MIN), source: 'erfasst' };
  const km = Number(s && s.distanceKm);
  if (Number.isFinite(km) && km > 0) return { min: Math.min(km * (MIN_PER_KM[s.type] || 6), MAX_MIN), source: 'strecke' };
  const planned = Number(s && s.plannedDurationMin);
  if (Number.isFinite(planned) && planned > 0) return { min: Math.min(planned, MAX_MIN), source: 'geplant' };
  return { min: 30, source: 'pauschal' };
}

/** Belastungspunkte (AU) einer Einheit = Dauer (min) × Anstrengung (RPE 1–10) –
    Session-RPE-Methode. Nie negativ, nie über 24 h × 10. `ref` ({ maxHr } oder null) gilt für
    die HF-Schätzung; ohne Angabe die angemeldete Person. */
export function sessionLoad(s, ref) {
  return Math.round(loadMinutes(s).min * sessionRpe(s, ref));
}

/**
 * Gesamtbelastung (alle Sportarten) der letzten `days` Tage – Summe der Belastungspunkte.
 * Erfasst – anders als die km-Last – auch Kraft, Fußball, Schwimmen, Rad, Testspiele.
 */
export function trainingLoad(sessions = [], today, days = 7, ref) {
  return (sessions || []).reduce((a, s) => {
    if (!s || s.deleted) return a;
    const d = diffDays(s.date, today);
    return d >= 0 && d < days ? a + sessionLoad(s, ref) : a;
  }, 0);
}

/* ------------------------------ Zeitreihen --------------------------------- */

/**
 * Tägliche Belastungssumme (sRPE) über [today-days+1 .. today], chronologisch.
 * Rückgabe: [{date, load}] der Länge `days` – auch trainingsfreie Tage (load 0),
 * damit die Reihe lückenlos für ACWR/Glättung/Monotonie genutzt werden kann.
 */
export function dailyLoadSeries(sessions = [], today, days = 42, ref) {
  const start = addDays(today, -(days - 1));
  const byDate = new Map();
  for (const s of sessions || []) {
    if (!s || s.deleted || !s.date) continue;
    if (s.date < start || s.date > today) continue;
    byDate.set(s.date, (byDate.get(s.date) || 0) + sessionLoad(s, ref));
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, load: Math.round(byDate.get(date) || 0) });
  }
  return out;
}

/** Tage seit der ersten erfassten Einheit (inklusive heute); 0 ohne Daten. */
export function historyDays(sessions = [], today) {
  const first = (sessions || [])
    .filter((s) => s && !s.deleted && s.date && s.date <= today)
    .map((s) => s.date).sort()[0] || null;
  return first ? diffDays(first, today) + 1 : 0;
}

/** Ab so viel Historie ist die Form (CTL − ATL) aussagekräftig: Die Fitnesskurve
    (τ 42 Tage) startet beim ersten Eintrag bei 0 und braucht rund drei Monate, bis
    sie eingeschwungen ist – vorher wäre die Form künstlich negativ. */
export const FORM_MIN_DAYS = 90;

/**
 * Lastverhältnis (Acute:Chronic Workload Ratio), entkoppelt: akut = mittlere
 * Tageslast der letzten `acute` Tage, chronisch = mittlere Tageslast der Tage
 * DAVOR bis Tag `chronic` (Standard: Tag 8–28). Werte lesen sich direkt: 1,3 =
 * die letzte Woche war 30 % fordernder als dein Schnitt der drei Wochen davor.
 * @returns {{acute:number, chronic:number, acuteWeek:number, chronicWeek:number,
 *   ratio:number|null, zone:string, tone:string, sparse:boolean, historyDays:number}}
 */
export function acwr(sessions = [], today, { acute = 7, chronic = 28, ref } = {}) {
  const series = dailyLoadSeries(sessions, today, chronic, ref);
  const sum = (arr) => arr.reduce((a, d) => a + d.load, 0);
  const a = sum(series.slice(-acute)) / acute;
  const c = sum(series.slice(0, chronic - acute)) / (chronic - acute);
  const ratio = c > 0 ? a / c : null;

  // Reicht die HISTORIE für einen belastbaren chronischen Schnitt? Wer gerade
  // erst anfängt (oder Altdaten nicht nachgetragen hat), hat lauter Null-Tage im
  // Nenner – das Verhältnis schießt dann rechnerisch hoch, ohne dass jemand zu
  // schnell gesteigert hätte. Solche Fälle werden als „aufbau“ markiert.
  const hist = historyDays(sessions, today);
  const sparse = hist < chronic;

  let zone = 'unklar', tone = 'neutral';
  // Junge Historie: Stufe „aufbau“ – auch wenn in Tag 8–28 noch gar nichts liegt.
  if (hist > 0 && sparse) zone = 'aufbau';
  else if (ratio != null) {
    if (ratio < 0.8) { zone = 'niedrig'; tone = 'neutral'; }
    else if (ratio <= 1.3) { zone = 'optimal'; tone = 'good'; }
    else if (ratio <= 1.5) { zone = 'erhöht'; tone = 'warn'; }
    else { zone = 'hoch'; tone = 'bad'; }
  }
  return {
    acute: Math.round(a), chronic: Math.round(c),
    acuteWeek: Math.round(a * 7), chronicWeek: Math.round(c * 7),
    ratio, zone, tone, sparse, historyDays: hist,
  };
}

const CTL_TAU = 42;   // Fitness: langsame Glättung (~6 Wochen)
const ATL_TAU = 7;    // Ermüdung: schnelle Glättung (~1 Woche)

/** Impuls-Antwort-Glättung (Banister): x_t = x_{t-1} + (load_t − x_{t-1})·(1 − e^(−1/τ)). */
function ewma(daily, tau) {
  const k = 1 - Math.exp(-1 / tau);
  let x = 0;
  return daily.map((d) => (x += (d.load - x) * k));
}

/**
 * Fitness (CTL), Ermüdung (ATL) und Form (TSB = CTL − ATL) als Zeitreihe der
 * letzten `days` Tage. `warmup` zusätzliche Tage vor dem sichtbaren Fenster
 * dienen dem Einschwingen der Glättung (sonst startet die Kurve künstlich bei 0).
 *
 * Der Warmup muss ein Vielfaches von CTL_TAU sein: Nach nur 42 Tagen stünde die
 * Fitness erst bei ~63 % ihres Gleichgewichts, die Ermüdung (τ 7) aber längst bei
 * 100 % – die angezeigte Form (CTL − ATL) wäre dauerhaft künstlich negativ.
 * 180 Tage ≈ 4·τ bringen die Fitnesskurve praktisch vollständig zum Einschwingen.
 * Das hilft nur, wenn im Vorlauf Daten liegen – deshalb `FORM_MIN_DAYS`.
 * @returns {Array<{date, ctl, atl, form}>}
 */
export function formSeries(sessions = [], today, { days = 42, warmup = 180 } = {}) {
  const total = days + warmup;
  const daily = dailyLoadSeries(sessions, today, total);
  const ctl = ewma(daily, CTL_TAU);
  const atl = ewma(daily, ATL_TAU);
  const out = [];
  for (let i = warmup; i < total; i++) {
    out.push({ date: daily[i].date, ctl: r1(ctl[i]), atl: r1(atl[i]), form: r1(ctl[i] - atl[i]) });
  }
  return out;
}

/** Aktueller Stand von Fitness/Ermüdung/Form (letzter Punkt der Reihe). */
export function formToday(sessions = [], today, opts = {}) {
  const series = formSeries(sessions, today, opts);
  return series.at(-1) || { date: today, ctl: 0, atl: 0, form: 0 };
}

/**
 * Form relativ zur Fitness (TSB in % der CTL) mit verbaler Einordnung. Die Kurven
 * laufen in Belastungspunkten (Minuten × RPE) – eine absolute Schwelle wie „Form > 5“
 * wäre dort praktisch „Form > 0“. Vor `FORM_MIN_DAYS` Historie: keine Bewertung.
 * @returns {{key:'einschwingen'|'frisch'|'ausgeglichen'|'training'|'ermuedet', label:string, rel:number|null, reliable:boolean}}
 */
export function formState(form = {}, hist = 0) {
  const rel = form.ctl > 0 ? form.form / form.ctl : null;
  if (hist < FORM_MIN_DAYS || rel == null) return { key: 'einschwingen', label: t('load.formSettling'), rel, reliable: false };
  if (rel >= 0.1) return { key: 'frisch', label: t('load.formFresh'), rel, reliable: true };
  if (rel >= -0.1) return { key: 'ausgeglichen', label: t('load.formBalanced'), rel, reliable: true };
  if (rel >= -0.3) return { key: 'training', label: t('load.formTraining'), rel, reliable: true };
  return { key: 'ermuedet', label: t('load.formTired'), rel, reliable: true };
}

/**
 * Monotonie & Strain nach Foster über die letzten `win` Tage.
 * Monotonie = Mittel / Standardabweichung der Tageslast (hoch = jeden Tag gleich);
 * Strain = Wochenlast × Monotonie. Foster beschreibt das Risiko für anhaltend
 * SCHWERES, gleichförmiges Training: Sehr leichte Aktivität (RPE ≤ 3 – Spazieren,
 * Mobility, Regeneration) zählt deshalb nicht mit, und ein Hinweis kommt nur, wenn
 * die Woche zugleich deutlich über der eigenen Wochenlast der drei Wochen davor liegt.
 */
export function monotonyStrain(sessions = [], today, { win = 7, chronic = 28 } = {}) {
  const relevant = (sessions || []).filter((s) => s && sessionRpe(s) > 3);
  const series = dailyLoadSeries(relevant, today, chronic);
  const daily = series.slice(-win).map((d) => d.load);
  const n = daily.length || 1;
  const weekLoad = daily.reduce((a, b) => a + b, 0);
  const mean = weekLoad / n;
  // Stichproben-Varianz (n−1), wie in Fosters Originalarbeit – mit n wären die
  // Monotonie-Werte systematisch ~8 % zu hoch und die Warnschwelle 2 zu scharf.
  const variance = daily.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const sd = Math.sqrt(variance);
  // sd = 0 (jeden Tag exakt gleich) -> maximal monoton; ohne Last -> 0.
  const monotony = sd > 0 ? mean / sd : (mean > 0 ? n : 0);
  const strain = Math.round(weekLoad * monotony);
  const before = series.slice(0, chronic - win).reduce((a, d) => a + d.load, 0);
  const chronicWeek = (chronic - win) > 0 ? (before / (chronic - win)) * win : 0;
  const tone = (monotony >= 2 && weekLoad > 0 && chronicWeek > 0 && weekLoad >= chronicWeek * 1.1) ? 'warn' : 'good';
  return { monotony: Math.round(monotony * 100) / 100, strain, weekLoad: Math.round(weekLoad), chronicWeek: Math.round(chronicWeek), tone };
}

/**
 * Verdichtet Lastverhältnis, Form und Monotonie zu einer verständlichen Aussage
 * fürs Dashboard – inkl. Zeitreihe für die Kurve. `hasData` erst true, wenn eine
 * belastbare 28-Tage-Basis existiert; die Form wird erst ab `FORM_MIN_DAYS`
 * bewertet. Die Texte versprechen keinen Verletzungsschutz – die Kennzahl zeigt,
 * wie stark die Last gegenüber deinem eigenen Schnitt gestiegen ist, mehr nicht.
 */
export function loadSummary(sessions = [], today) {
  const ac = acwr(sessions, today);
  const series = formSeries(sessions, today, { days: 42 });
  const form = series.at(-1) || { ctl: 0, atl: 0, form: 0 };
  const fstate = formState(form, ac.historyDays);
  const mono = monotonyStrain(sessions, today);
  // Belastbar erst mit voller 28-Tage-Historie: sonst stünden lauter Null-Tage im
  // chronischen Nenner und die Karte meldete „zu schnell gesteigert“, obwohl nur
  // die Datenbasis fehlt (typisch in den ersten Wochen nach der Einrichtung).
  const hasData = ac.chronic > 0 && !ac.sparse;
  const r = fmtRatio(ac.ratio);

  let headline, tone, advice;
  if (!hasData) {
    tone = 'neutral';
    if (!ac.historyDays) {
      headline = t('load.headlineNoData');
      advice = t('load.adviceNoData');
    } else if (ac.sparse) {
      headline = t('load.headlineSparse');
      advice = t('load.adviceSparse', { days: tp('load.days', ac.historyDays) });
    } else {
      headline = t('load.headlineReturn');
      advice = t('load.adviceReturn');
    }
  } else if (ac.zone === 'hoch') {
    headline = t('load.headlineHigh');
    tone = 'bad';
    advice = t('load.adviceHigh', { ratio: r });
  } else if (ac.zone === 'erhöht') {
    headline = t('load.headlineRaised');
    tone = 'warn';
    advice = t('load.adviceRaised', { ratio: r });
  } else if (mono.tone === 'warn') {
    headline = t('load.headlineUniform');
    tone = 'warn';
    advice = t('load.adviceUniform');
  } else if (fstate.key === 'ermuedet') {
    headline = t('load.headlineTired');
    tone = 'warn';
    advice = t('load.adviceTired', { pct: Math.round(fstate.rel * 100) });
  } else if (fstate.key === 'frisch') {
    headline = t('load.headlineFresh');
    tone = 'good';
    advice = t('load.adviceFresh');
  } else if (ac.zone === 'niedrig') {
    headline = t('load.headlineLow');
    tone = 'neutral';
    advice = t('load.adviceLow', { ratio: r });
  } else {
    headline = t('load.headlineOptimal');
    tone = 'good';
    advice = t('load.adviceOptimal', { ratio: r });
  }
  const formNote = fstate.reliable ? null
    : t('load.formNote', { days: tp('load.days', ac.historyDays) });
  return { acwr: ac, form, formState: fstate, formNote, mono, series, headline, tone, advice, hasData };
}
