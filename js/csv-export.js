/* =========================================================================
   csv-export.js — your own data as a table (CSV) for Excel, Numbers, your doctor
   or another app. DOM-free; the settings offer the download.

   Format follows the active language, as spreadsheet programs there expect it: with a
   decimal comma (German, French, …) semicolon-separated, with a decimal point (English)
   comma-separated. UTF-8 with BOM (otherwise Excel shows umlauts wrongly), date as YYYY-MM-DD.
   Text that begins with = + - @ gets a leading apostrophe – otherwise a spreadsheet
   would read a note such as "=HYPERLINK(…)" as a formula.
   Distances, paces, elevation and weights come in the person's units, lab values in the lab units
   they chose (v4.1) – the headings name the unit.
   The JSON backup remains the complete format; the CSV is for further work.
   ========================================================================= */

import { ANALYTES, shownUnit, toShown, unitLabel } from './labs.js';
import { typeMeta, fmtPace } from './ui.js';
import { sessionLoad } from './load.js';

import { t } from './i18n.js';
import { decimalSeparator } from './format.js';
import { kmToShown, metresToShown, kgToShown, distanceUnit, paceUnit, elevationUnit, weightUnit } from './units.js';

const BOM = '﻿';
/** Field separator for the active language: ";" next to a decimal comma, "," next to a decimal point. */
const fieldSeparator = () => (decimalSeparator() === ',' ? ';' : ',');

/** Number with the language's decimal separator; empty for missing values. */
function numCell(v, digits = null) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  const s = digits == null ? String(n) : n.toFixed(digits);
  return s.replace('.', decimalSeparator());
}
/** Stored metric value in the person's unit: unchanged in metric, converted values rounded to `digits`. */
function shown(v, toUnit, digits) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return null;
  const n = toUnit(Number(v));
  return n === Number(v) ? n : Number(n.toFixed(digits));
}
/** Lab value (canonical) in the unit the person sees it in; unknown analytes as stored. */
const labShown = (l, v) => (ANALYTES[l.analyte] && v != null && v !== '' ? toShown(l.analyte, v) : v);
/** Text cell: double the quotation marks, enclose when it contains a separator/line break, defuse formulas. */
function textCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\n\r]/.test(s) || s.includes(fieldSeparator()) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Table from columns `[heading, (row) => cell]` – cells already as text. */
export function toCsv(rows, columns) {
  const sep = fieldSeparator();
  const head = columns.map(([h]) => textCell(h)).join(sep);
  const body = rows.map((r) => columns.map(([, f]) => f(r)).join(sep));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

const live = (list) => (list || []).filter((x) => x && !x.deleted && !x._kind && x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));

/** Workouts with duration, distance, heart rate, effort and load points. */
export function sessionsCsv(sessions) {
  return toCsv(live(sessions), [
    [t('csvExport.date'), (s) => s.date],
    [t('csvExport.sport'), (s) => textCell(typeMeta(s.type).label)],
    [t('csvExport.title'), (s) => textCell(s.title || '')],
    [t('csvExport.durationMin'), (s) => numCell(s.durationSec ? s.durationSec / 60 : null, 1)],
    [t('csvExport.distance', { unit: distanceUnit() }), (s) => numCell(shown(s.distanceKm, kmToShown, 2), 2)],
    [t('csvExport.pace', { unit: paceUnit() }), (s) => (s.paceSecPerKm > 0 ? fmtPace(s.paceSecPerKm) : '')],
    [t('csvExport.avgHr'), (s) => numCell(s.avgHr)],
    [t('csvExport.maxHr'), (s) => numCell(s.maxHr)],
    [t('csvExport.effortRpe'), (s) => numCell(s.rpe)],
    [t('csvExport.loadPoints'), (s) => numCell(sessionLoad(s))],
    [t('csvExport.ascent', { unit: elevationUnit() }), (s) => numCell(shown(s.ascentM, metresToShown, 0))],
    ['kcal', (s) => numCell(s.kcal)],
    [t('csvExport.source'), (s) => textCell(s.source || '')],
    [t('csvExport.notes'), (s) => textCell(s.notes || '')],
  ]);
}

/** Body measurements per day. */
export function healthCsv(health) {
  return toCsv(live(health), [
    [t('csvExport.date'), (h) => h.date],
    [t('csvExport.weight', { unit: weightUnit() }), (h) => numCell(shown(h.weight, kgToShown, 1))],
    [t('csvExport.bodyFatPct'), (h) => numCell(h.bodyFat)],
    [t('csvExport.muscleMass', { unit: weightUnit() }), (h) => numCell(shown(h.muscleMass, kgToShown, 1))],
    [t('csvExport.leanMass', { unit: weightUnit() }), (h) => numCell(shown(h.leanMass, kgToShown, 1))],
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

/** Lab values with unit and the reference range of the person's own lab (raw, without rating), in the
    lab units the person chose. */
export function labsCsv(labs) {
  return toCsv(live(labs), [
    [t('csvExport.date'), (l) => l.date],
    [t('csvExport.analyte'), (l) => textCell((ANALYTES[l.analyte] && ANALYTES[l.analyte].label) || l.analyte || '')],
    [t('csvExport.result'), (l) => numCell(labShown(l, l.value))],
    [t('csvExport.unit'), (l) => textCell(ANALYTES[l.analyte] ? unitLabel(shownUnit(l.analyte)) : l.unit || '')],
    [t('csvExport.refFrom'), (l) => numCell(labShown(l, l.refLow))],
    [t('csvExport.refTo'), (l) => numCell(labShown(l, l.refHigh))],
    [t('csvExport.note'), (l) => textCell(l.note || '')],
  ]);
}

/** Food diary (without the "day complete" markers). */
export function diaryCsv(diary) {
  return toCsv(live(diary), [
    [t('csvExport.date'), (d) => d.date],
    [t('csvExport.meal'), (d) => textCell(d.title || '')],
    ['kcal', (d) => numCell(d.kcal)],
    [t('csvExport.proteinG'), (d) => numCell(d.protein)],
    [t('csvExport.source'), (d) => textCell(d.source || '')],
  ]);
}
