/* =========================================================================
   format.js — dates and numbers in the active language.

   Weekday and month names and the date patterns come from the catalog
   (format.* in ui.json), so every browser shows exactly the same text –
   Intl's names differ between engines and contexts ("Sa." vs "Sa",
   "Jul" vs "Juli"). Intl only fills in when a catalog is missing.
   Numbers use the separators Intl reports for the language. Units stay metric.
   ========================================================================= */

import { locale, t, tList, has } from './i18n.js';

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

export function fmtKm(km, digits = 1) {
  if (km == null) return '–';
  return Number(km).toFixed(digits).replace('.', decimalSeparator()) + ' km';
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
