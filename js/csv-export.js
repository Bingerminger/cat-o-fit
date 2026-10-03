/* =========================================================================
   csv-export.js — eigene Daten als Tabelle (CSV) für Excel, Numbers, die Ärztin
   oder eine andere App. DOM-frei; die Einstellungen bieten den Download an.

   Format für deutsche Tabellenprogramme: Semikolon als Trenner, Dezimalkomma,
   UTF-8 mit BOM (sonst zeigt Excel Umlaute falsch), Datum als JJJJ-MM-TT.
   Texte, die mit = + - @ beginnen, bekommen ein Hochkomma vorangestellt – sonst
   läse ein Tabellenprogramm eine Notiz wie „=HYPERLINK(…)“ als Formel.
   Das JSON-Backup bleibt das vollständige Format; die CSV ist zum Weiterarbeiten.
   ========================================================================= */

import { ANALYTES } from './labs.js';
import { typeMeta } from './ui.js';
import { sessionLoad } from './load.js';

const BOM = '﻿';

/** Zahl mit Dezimalkomma; leer für fehlende Werte. */
function numCell(v, digits = null) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  const s = digits == null ? String(n) : n.toFixed(digits);
  return s.replace('.', ',');
}
/** Textzelle: Anführungszeichen verdoppeln, bei Trenner/Umbruch einschließen, Formeln entschärfen. */
function textCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tabelle aus Spalten `[überschrift, (zeile) => zelle]` – Zellen schon als Text. */
export function toCsv(rows, columns) {
  const head = columns.map(([h]) => textCell(h)).join(';');
  const body = rows.map((r) => columns.map(([, f]) => f(r)).join(';'));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

const live = (list) => (list || []).filter((x) => x && !x.deleted && !x._kind && x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));

/** Trainings mit Dauer, Strecke, Herzfrequenz, Anstrengung und Belastungspunkten. */
export function sessionsCsv(sessions) {
  return toCsv(live(sessions), [
    ['Datum', (s) => s.date],
    ['Sportart', (s) => textCell(typeMeta(s.type).label)],
    ['Titel', (s) => textCell(s.title || '')],
    ['Dauer (min)', (s) => numCell(s.durationSec ? s.durationSec / 60 : null, 1)],
    ['Distanz (km)', (s) => numCell(s.distanceKm, 2)],
    ['Pace (min/km)', (s) => (s.paceSecPerKm ? `${Math.floor(s.paceSecPerKm / 60)}:${String(Math.round(s.paceSecPerKm % 60)).padStart(2, '0')}` : '')],
    ['Ø-HF', (s) => numCell(s.avgHr)],
    ['Max-HF', (s) => numCell(s.maxHr)],
    ['Anstrengung (RPE)', (s) => numCell(s.rpe)],
    ['Belastungspunkte', (s) => numCell(sessionLoad(s))],
    ['Höhenmeter', (s) => numCell(s.ascentM)],
    ['kcal', (s) => numCell(s.kcal)],
    ['Quelle', (s) => textCell(s.source || '')],
    ['Notizen', (s) => textCell(s.notes || '')],
  ]);
}

/** Körperwerte je Tag. */
export function healthCsv(health) {
  return toCsv(live(health), [
    ['Datum', (h) => h.date],
    ['Gewicht (kg)', (h) => numCell(h.weight)],
    ['Körperfett (%)', (h) => numCell(h.bodyFat)],
    ['Muskelmasse (kg)', (h) => numCell(h.muscleMass)],
    ['Fettfreie Masse (kg)', (h) => numCell(h.leanMass)],
    ['Viszeralfett', (h) => numCell(h.visceralFat)],
    ['Ruhepuls', (h) => numCell(h.restingHr)],
    ['HRV (ms)', (h) => numCell(h.hrv)],
    ['HRV-Messart', (h) => textCell(h.hrvMethod ? String(h.hrvMethod).toUpperCase() : '')],
    ['VO2max', (h) => numCell(h.vo2max)],
    ['Schlaf (h)', (h) => numCell(h.sleepHours)],
    ['Schritte', (h) => numCell(h.steps)],
    ['Energie (1–10)', (h) => numCell(h.energy)],
    ['Stimmung (1–10)', (h) => numCell(h.mood)],
    ['Notizen', (h) => textCell(h.notes || '')],
  ]);
}

/** Laborwerte mit Einheit und dem Referenzbereich des eigenen Labors (roh, ohne Bewertung). */
export function labsCsv(labs) {
  return toCsv(live(labs), [
    ['Datum', (l) => l.date],
    ['Wert', (l) => textCell((ANALYTES[l.analyte] && ANALYTES[l.analyte].label) || l.analyte || '')],
    ['Messwert', (l) => numCell(l.value)],
    ['Einheit', (l) => textCell(l.unit || (ANALYTES[l.analyte] && ANALYTES[l.analyte].unit) || '')],
    ['Referenz von', (l) => numCell(l.refLow)],
    ['Referenz bis', (l) => numCell(l.refHigh)],
    ['Notiz', (l) => textCell(l.note || '')],
  ]);
}

/** Ess-Tagebuch (ohne die „Tag vollständig“-Markierungen). */
export function diaryCsv(diary) {
  return toCsv(live(diary), [
    ['Datum', (d) => d.date],
    ['Mahlzeit', (d) => textCell(d.title || '')],
    ['kcal', (d) => numCell(d.kcal)],
    ['Eiweiß (g)', (d) => numCell(d.protein)],
    ['Quelle', (d) => textCell(d.source || '')],
  ]);
}
