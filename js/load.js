/* =========================================================================
   load.js — Belastungssteuerung nach Profistandard. Reine, DOM-freie Logik
   -> per node:test abgedeckt. Baut auf der sRPE-Last (Dauer × RPE, Foster)
   aus fitness.js auf und liefert die Kennzahlen, die im Profisport zur
   Steuerung genutzt werden:

     - ACWR (Acute:Chronic Workload Ratio, 7 vs. 28 Tage) – „Sweet Spot" 0,8–1,3.
     - Fitness / Ermüdung / Form (CTL / ATL / TSB) als Impuls-Antwort-Glättung
       nach Banister (Performance-Management-Chart wie bei TrainingPeaks & Co.).
     - Monotonie & Strain (Foster) – Warnung bei zu gleichförmig hoher Last.

   Alles als Orientierung gedacht – Näherungen, keine Labordiagnostik. `today`
   wird immer übergeben (keine Abhängigkeit von der Geräteuhr).
   ========================================================================= */

import { addDays } from './ui.js';
import { sessionLoad } from './fitness.js';

const r1 = (v) => Math.round(v * 10) / 10;
/** Zahl mit deutschem Dezimalkomma (z. B. 1,24). */
export function fmtRatio(v) {
  return v == null ? '–' : (Math.round(v * 100) / 100).toString().replace('.', ',');
}

/**
 * Tägliche Belastungssumme (sRPE) über [today-days+1 .. today], chronologisch.
 * Rückgabe: [{date, load}] der Länge `days` – auch trainingsfreie Tage (load 0),
 * damit die Reihe lückenlos für ACWR/Glättung/Monotonie genutzt werden kann.
 */
export function dailyLoadSeries(sessions = [], today, days = 42) {
  const start = addDays(today, -(days - 1));
  const byDate = new Map();
  for (const s of sessions) {
    if (!s || s.deleted || !s.date) continue;
    if (s.date < start || s.date > today) continue;
    byDate.set(s.date, (byDate.get(s.date) || 0) + sessionLoad(s));
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    out.push({ date, load: Math.round(byDate.get(date) || 0) });
  }
  return out;
}

/**
 * Acute:Chronic Workload Ratio. Beide als mittlere Tageslast (rollierender
 * Schnitt) – akut = letzte `acute` Tage, chronisch = letzte `chronic` Tage.
 * @returns {{acute, chronic, ratio:number|null, zone, tone}}
 */
export function acwr(sessions = [], today, { acute = 7, chronic = 28 } = {}) {
  const series = dailyLoadSeries(sessions, today, chronic);
  const sum = (arr) => arr.reduce((a, d) => a + d.load, 0);
  const a = sum(series.slice(-acute)) / acute;
  const c = sum(series) / chronic;
  const ratio = c > 0 ? a / c : null;
  let zone = 'unklar', tone = 'neutral';
  if (ratio != null) {
    if (ratio < 0.8) { zone = 'niedrig'; tone = 'neutral'; }
    else if (ratio <= 1.3) { zone = 'optimal'; tone = 'good'; }
    else if (ratio <= 1.5) { zone = 'erhöht'; tone = 'warn'; }
    else { zone = 'hoch'; tone = 'bad'; }
  }
  return { acute: Math.round(a), chronic: Math.round(c), ratio, zone, tone };
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
 * @returns {Array<{date, ctl, atl, form}>}
 */
export function formSeries(sessions = [], today, { days = 42, warmup = 42 } = {}) {
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
 * Monotonie & Strain nach Foster über die letzten `win` Tage.
 * Monotonie = Mittel / Standardabweichung der Tageslast (hoch = jeden Tag gleich);
 * Strain = Wochenlast × Monotonie. Hohe Monotonie bei hoher Last gilt als Risiko.
 */
export function monotonyStrain(sessions = [], today, { win = 7 } = {}) {
  const daily = dailyLoadSeries(sessions, today, win).map((d) => d.load);
  const n = daily.length || 1;
  const weekLoad = daily.reduce((a, b) => a + b, 0);
  const mean = weekLoad / n;
  const variance = daily.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  // sd = 0 (jeden Tag exakt gleich) -> maximal monoton; ohne Last -> 0.
  const monotony = sd > 0 ? mean / sd : (mean > 0 ? n : 0);
  const strain = Math.round(weekLoad * monotony);
  const tone = (monotony >= 2 && weekLoad > 0) ? 'warn' : 'good';
  return { monotony: Math.round(monotony * 100) / 100, strain, weekLoad: Math.round(weekLoad), tone };
}

/**
 * Verdichtet ACWR, Form und Monotonie zu einer verständlichen Aussage fürs
 * Dashboard – inkl. Zeitreihe für die Kurve. `hasData` erst true, wenn eine
 * belastbare 28-Tage-Basis existiert.
 */
export function loadSummary(sessions = [], today) {
  const ac = acwr(sessions, today);
  const series = formSeries(sessions, today, { days: 42 });
  const form = series.at(-1) || { ctl: 0, atl: 0, form: 0 };
  const mono = monotonyStrain(sessions, today);
  const hasData = ac.chronic > 0;

  let headline, tone, advice;
  if (!hasData) {
    headline = 'Noch zu wenig Daten';
    tone = 'neutral';
    advice = 'Trage ein paar Einheiten ein – dann zeigt dir die Kurve deine Fitness, Ermüdung und Form.';
  } else if (ac.zone === 'hoch') {
    headline = 'Belastung zu schnell gestiegen';
    tone = 'bad';
    advice = `Deine akute Last liegt deutlich über dem Schnitt (ACWR ${fmtRatio(ac.ratio)}). Baue 1–2 lockere Tage ein – das senkt das Verletzungsrisiko spürbar.`;
  } else if (ac.zone === 'erhöht') {
    headline = 'Belastung erhöht';
    tone = 'warn';
    advice = `ACWR ${fmtRatio(ac.ratio)} – noch im Rahmen, aber steigere behutsam und achte auf gute Erholung.`;
  } else if (mono.tone === 'warn') {
    headline = 'Training sehr gleichförmig';
    tone = 'warn';
    advice = 'Deine Tage ähneln sich stark bei hoher Last (Monotonie). Setze harte und ganz lockere Tage bewusster im Wechsel – das verringert das Übertrainingsrisiko.';
  } else if (form.form > 5) {
    headline = 'Gut erholt – Form frisch';
    tone = 'good';
    advice = 'Deine Ermüdung liegt unter deiner Fitness (positive Form). Ideal für eine Schlüsseleinheit oder einen kleinen Test.';
  } else if (ac.zone === 'niedrig') {
    headline = 'Ruhige Phase';
    tone = 'neutral';
    advice = `Deine Last liegt unter dem Schnitt (ACWR ${fmtRatio(ac.ratio)}). Gut zur Erholung – oder Zeit, wieder etwas aufzubauen.`;
  } else {
    headline = 'Belastung im grünen Bereich';
    tone = 'good';
    advice = `ACWR ${fmtRatio(ac.ratio)} – mitten im Sweet Spot (0,8–1,3). Weiter so, gleichmäßig aufbauen.`;
  }
  return { acwr: ac, form, mono, series, headline, tone, advice, hasData };
}
