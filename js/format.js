/* =========================================================================
   format.js — dates and numbers in the active language.

   Weekday and month names and the date patterns come from the catalog
   (format.* in ui.json), so every browser shows exactly the same text –
   Intl's names differ between engines and contexts ("Sa." vs "Sa",
   "Jul" vs "Juli"). Intl only fills in when a catalog is missing.
   Numbers use the separators Intl reports for the language. Distances, paces,
   weights, heights, temperatures and elevations follow the person's units
   (units.js) – the values passed in are always metric.
   ========================================================================= */

import { locale, t, tList, has } from './i18n.js';
import {
  kmToShown, kgToShown, celsiusToShown, metresToShown, cmToFeetInches, units,
  distanceUnit, weightUnit, temperatureUnit, elevationUnit, KM_PER_MI,
} from './units.js';

/** "YYYY-MM-DD" -> local Date (no time-zone shift). */
export function parseDate(str) {
  if (str instanceof Date) return str;
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function intlLocale() { return locale() === 'en' ? 'en-GB' : locale(); }

function intlNames(opts, dateFor, count) {
  try {
    const f = new Intl.DateTimeFormat(intlLocale(), opts);
    return Array.from({ length: count }, (_, i) => f.format(dateFor(i)));
  } catch { return Array.from({ length: count }, (_, i) => String(i + 1)); }
}

/** Weekday names, Sunday first (matches Date#getDay). */
export function weekdayNames(long = false) {
  return tList(long ? 'format.weekdaysLong' : 'format.weekdaysShort')
    || intlNames({ weekday: long ? 'long' : 'short' }, (i) => new Date(2026, 0, 4 + i), 7);   // 4 Jan 2026 is a Sunday
}
/** Month names, January first. */
export function monthNames(long = true) {
  return tList(long ? 'format.monthsLong' : 'format.monthsShort')
    || intlNames({ month: long ? 'long' : 'short' }, (i) => new Date(2026, i, 1), 12);
}

function pattern(key, d, long, intlOpts) {
  const parts = {
    weekday: weekdayNames(long)[d.getDay()],
    day: d.getDate(),
    month: monthNames(long)[d.getMonth()],
    year: d.getFullYear(),
  };
  if (has(key)) return t(key, parts);
  try { return new Intl.DateTimeFormat(intlLocale(), intlOpts).format(d); } catch { return d.toDateString(); }
}

export function fmtWeekday(dateStr, long = false) { return weekdayNames(long)[parseDate(dateStr).getDay()]; }
/** Short date with weekday, e.g. "Sa, 18. Juli" / "Sat 18 Jul". */
export function fmtDate(dateStr) {
  return pattern('format.date', parseDate(dateStr), false, { weekday: 'short', day: 'numeric', month: 'short' });
}
/** Long date, e.g. "Samstag, 18. Juli 2026" / "Saturday 18 July 2026". */
export function fmtDateLong(dateStr) {
  return pattern('format.dateLong', parseDate(dateStr), true, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
/** Day and month, e.g. "18. Juli" / "18 Jul". */
export function fmtDayMonth(dateStr) {
  return pattern('format.dayMonth', parseDate(dateStr), false, { day: 'numeric', month: 'short' });
}
/** Compact numeric day and month for chart axes, e.g. "26.08." / "26/08". */
export function fmtDayMonthNumeric(dateStr) {
  const d = parseDate(dateStr);
  const parts = { day: String(d.getDate()).padStart(2, '0'), month: String(d.getMonth() + 1).padStart(2, '0') };
  return has('format.dayMonthNumeric') ? t('format.dayMonthNumeric', parts) : `${parts.day}/${parts.month}`;
}
export function monthName(monthIdx, long = true) { return monthNames(long)[monthIdx]; }

const decimalSeps = new Map();
const intFormats = new Map();
/** Decimal separator of the active language ("," or "."). */
export function decimalSeparator() {
  const l = intlLocale();
  if (!decimalSeps.has(l)) {
    let sep = '.';
    try { sep = new Intl.NumberFormat(l).formatToParts(1.5).find((p) => p.type === 'decimal')?.value || '.'; } catch { /* '.' */ }
    decimalSeps.set(l, sep);
  }
  return decimalSeps.get(l);
}

/** Distance from kilometres in the person's unit: "21,1 km" / "13.1 mi". */
export function fmtKm(km, digits = 1) {
  if (km == null) return '–';
  return Number(kmToShown(Number(km))).toFixed(digits).replace('.', decimalSeparator()) + ' ' + distanceUnit();
}
export const fmtDistance = fmtKm;
/** A single distance (planned session, race, run): whole kilometres without a decimal ("10 km"),
    otherwise – and always in miles, where whole km are rarely whole miles – to a tenth ("6,2 mi"). */
export function fmtKmAuto(km) {
  if (km == null) return '–';
  return fmtKm(km, Number(km) % 1 || units().distance === 'mi' ? 1 : 0);
}
/** Body weight from kilograms: "72,4 kg" / "159.6 lb". */
export function fmtWeight(kg, digits = 1) {
  if (kg == null || Number.isNaN(Number(kg))) return '–';
  return Number(kgToShown(Number(kg))).toFixed(digits).replace('.', decimalSeparator()) + ' ' + weightUnit();
}
/** Weight from kilograms without padding: kg as stored ("65 kg", "22,25 kg"), pounds to a tenth
    ("143,3 lb") – for targets, sets and other values that were typed in rather than measured. */
export function fmtWeightDec(kg) {
  if (kg == null || kg === '' || Number.isNaN(Number(kg))) return '–';
  const v = units().weight === 'lb' ? Math.round(kgToShown(Number(kg)) * 10) / 10 : Number(kg);
  return `${fmtDec(v)} ${weightUnit()}`;
}
/** Height from centimetres: "180 cm" / "5′ 11″". */
export function fmtHeight(cm) {
  if (cm == null || Number.isNaN(Number(cm))) return '–';
  if (units().weight !== 'lb') return `${Math.round(Number(cm))} cm`;
  const h = cmToFeetInches(Number(cm));
  return `${h.ft}′ ${h.in}″`;
}
/** Temperature from °C, whole degrees: "21 °C" / "70 °F". */
export function fmtTemp(c) {
  if (c == null || Number.isNaN(Number(c))) return '–';
  return `${Math.round(celsiusToShown(Number(c)))} ${temperatureUnit()}`;
}
/** Elevation from metres, whole: "120 m" / "394 ft". */
export function fmtElevation(m) {
  if (m == null || Number.isNaN(Number(m))) return '–';
  return `${fmtInt(Math.round(metresToShown(Number(m))))} ${elevationUnit()}`;
}

/* Generated plan texts are stored with metric amounts ("Long run 18 km", "6×1 km at 4:45/km").
   For a person on miles they are converted when shown; metre intervals (track) stay. */
const PACE_IN_TEXT = /(\d{1,2}:\d{2})(?:(\s?[–-]\s?)(\d{1,2}:\d{2}))?(\s?(?:min)?\s?)\/\s?km\b/g;
const KM_IN_TEXT = /(\d+(?:[.,]\d+)?)(\s?| )km\b(?!\/h)/g;
const perMile = (mss) => {
  const [m, s] = mss.split(':').map(Number);
  const sec = Math.round((m * 60 + s) * KM_PER_MI);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
export function localizeUnits(text) {
  if (typeof text !== 'string' || units().distance !== 'mi') return text;
  return text
    .replace(PACE_IN_TEXT, (_, a, dash, b, gap) => `${perMile(a)}${b ? dash + perMile(b) : ''}${gap}/mi`)
    .replace(KM_IN_TEXT, (_, n, gap) => {
      const km = Number(n.replace(',', '.'));
      const mi = km / KM_PER_MI;
      // Long distances to a tenth, short ones to a hundredth ("0.62 mi" for 1 km).
      const digits = mi >= 3 ? 1 : 2;
      return `${mi.toFixed(digits).replace(/\.?0+$/, '').replace('.', decimalSeparator())}${gap}mi`;
    });
}
export function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '–';
  return Number(n).toFixed(digits).replace('.', decimalSeparator());
}
/** An already rounded number with the language's decimal separator ("7,5" / "7.5"); – if missing. */
export function fmtDec(v) {
  return v == null || Number.isNaN(Number(v)) ? '–' : String(v).replace('.', decimalSeparator());
}
/** Whole number with the language's digit grouping, e.g. 1.234 / 1,234. */
export function fmtInt(n) {
  if (n == null || Number.isNaN(Number(n))) return '–';
  const l = intlLocale();
  let f = intFormats.get(l);
  if (!f) { try { f = new Intl.NumberFormat(l, { maximumFractionDigits: 0 }); } catch { f = null; } intFormats.set(l, f); }
  const v = Math.round(Number(n));
  return f ? f.format(v) : String(v);
}
