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

import { t } from './i18n.js';

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
    [t('csvExport.date'), (s) => s.date],
    [t('csvExport.sport'), (s) => textCell(typeMeta(s.type).label)],
    [t('csvExport.title'), (s) => textCell(s.title || '')],
    [t('csvExport.durationMin'), (s) => numCell(s.durationSec ? s.durationSec / 60 : null, 1)],
    [t('csvExport.distanceKm'), (s) => numCell(s.distanceKm, 2)],
    ['Pace (min/km)', (s) => (s.paceSecPerKm ? `${Math.floor(s.paceSecPerKm / 60)}:${String(Math.round(s.paceSecPerKm % 60)).padStart(2, '0')}` : '')],
    [t('csvExport.avgHr'), (s) => numCell(s.avgHr)],
    [t('csvExport.maxHr'), (s) => numCell(s.maxHr)],
    [t('csvExport.effortRpe'), (s) => numCell(s.rpe)],
    [t('csvExport.loadPoints'), (s) => numCell(sessionLoad(s))],
    [t('csvExport.ascent'), (s) => numCell(s.ascentM)],
    ['kcal', (s) => numCell(s.kcal)],
    [t('csvExport.source'), (s) => textCell(s.source || '')],
    [t('csvExport.notes'), (s) => textCell(s.notes || '')],
  ]);
}

/** Körperwerte je Tag. */
export function healthCsv(health) {
  return toCsv(live(health), [
    [t('csvExport.date'), (h) => h.date],
    [t('csvExport.weightKg'), (h) => numCell(h.weight)],
    [t('csvExport.bodyFatPct'), (h) => numCell(h.bodyFat)],
    [t('csvExport.muscleMassKg'), (h) => numCell(h.muscleMass)],
    [t('csvExport.leanMassKg'), (h) => numCell(h.leanMass)],
    [t('csvExport.visceralFat'), (h) => numCell(h.visceralFat)],
    [t('csvExport.restingHr'), (h) => numCell(h.restingHr)],
    ['HRV (ms)', (h) => numCell(h.hrv)],
    [t('csvExport.hrvMethod'), (h) => textCell(h.hrvMethod ? String(h.hrvMethod).toUpperCase() : '')],
    ['VO2max', (h) => numCell(h.vo2max)],
    [t('csvExport.sleepH'), (h) => numCell(h.sleepHours)],
    [t('csvExport.steps'), (h) => numCell(h.steps)],
    [t('csvExport.energy'), (h) => numCell(h.energy)],
    [t('csvExport.mood'), (h) => numCell(h.mood)],
    [t('csvExport.notes'), (h) => textCell(h.notes || '')],
  ]);
}

/** Laborwerte mit Einheit und dem Referenzbereich des eigenen Labors (roh, ohne Bewertung). */
export function labsCsv(labs) {
  return toCsv(live(labs), [
    [t('csvExport.date'), (l) => l.date],
    [t('csvExport.analyte'), (l) => textCell((ANALYTES[l.analyte] && ANALYTES[l.analyte].label) || l.analyte || '')],
    [t('csvExport.result'), (l) => numCell(l.value)],
    [t('csvExport.unit'), (l) => textCell(l.unit || (ANALYTES[l.analyte] && ANALYTES[l.analyte].unit) || '')],
    [t('csvExport.refFrom'), (l) => numCell(l.refLow)],
    [t('csvExport.refTo'), (l) => numCell(l.refHigh)],
    [t('csvExport.note'), (l) => textCell(l.note || '')],
  ]);
}

/** Ess-Tagebuch (ohne die „Tag vollständig“-Markierungen). */
export function diaryCsv(diary) {
  return toCsv(live(diary), [
    [t('csvExport.date'), (d) => d.date],
    [t('csvExport.meal'), (d) => textCell(d.title || '')],
    ['kcal', (d) => numCell(d.kcal)],
    [t('csvExport.proteinG'), (d) => numCell(d.protein)],
    [t('csvExport.source'), (d) => textCell(d.source || '')],
  ]);
}
