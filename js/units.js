/* =========================================================================
   units.js — the units the app shows: distance (km/mi, with pace and elevation),
   weight (kg/lb, with height cm/ft-in), temperature (°C/°F), the first day of
   the week and lab units (SI/conventional).

   Data are always stored metric (and weekdays as ISO numbers); this module only
   converts for display and input. The state is set from the signed-in person's
   settings by unit-prefs.js – like setLocale, without importing the store (the
   store imports the formatting helpers, which read this module).
   ========================================================================= */

export const KM_PER_MI = 1.609344;
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const M_PER_FT = 0.3048;

/** Metric, week from Monday, SI lab units – also the state until a person is applied. */
export const METRIC = Object.freeze({ distance: 'km', weight: 'kg', temperature: 'c', weekStart: 1, labs: 'si' });
const ALLOWED = { distance: ['km', 'mi'], weight: ['kg', 'lb'], temperature: ['c', 'f'], labs: ['si', 'conventional'] };

let state = { ...METRIC };

/** Valid values only; anything else falls back to the metric default. */
function clean(u = {}) {
  const out = { ...METRIC };
  for (const k of Object.keys(ALLOWED)) if (ALLOWED[k].includes(u[k])) out[k] = u[k];
  const ws = Number(u.weekStart);
  if (Number.isInteger(ws) && ws >= 0 && ws <= 6) out.weekStart = ws;
  return out;
}

/** The units in use. */
export function units() { return state; }
/** Sets the units (missing or invalid values: metric); true if anything changed. */
export function setUnits(next = {}) {
  const before = JSON.stringify(state);
  state = clean(next);
  return JSON.stringify(state) !== before;
}

/** Defaults for the browser's region: the United States uses miles, pounds, °F, weeks from Sunday and
    conventional lab units; everywhere else metric, Monday and SI. */
export function defaultUnits(tags) {
  const first = (Array.isArray(tags) ? tags : [tags]).find((x) => typeof x === 'string' && x) || '';
  const region = (first.split(/[-_]/)[1] || '').toUpperCase();
  return region === 'US'
    ? { distance: 'mi', weight: 'lb', temperature: 'f', weekStart: 0, labs: 'conventional' }
    : { ...METRIC };
}

/* ------------------------------- Conversions ------------------------------ */
const miles = () => state.distance === 'mi';
const pounds = () => state.weight === 'lb';

/** Kilometres → the distance unit shown (km or mi). */
export const kmToShown = (km) => (km == null ? km : miles() ? km / KM_PER_MI : km);
/** Distance typed in the unit shown → kilometres (stored). */
export const shownToKm = (v) => (v == null ? v : miles() ? v * KM_PER_MI : v);
/** Seconds per km → seconds per unit shown (km or mi). */
export const paceToShown = (secPerKm) => (secPerKm == null ? secPerKm : miles() ? secPerKm * KM_PER_MI : secPerKm);
/** Pace typed per unit shown → seconds per km (stored). */
export const shownToPace = (sec) => (sec == null ? sec : miles() ? sec / KM_PER_MI : sec);
/** Metres of elevation → m, or ft alongside miles. */
export const metresToShown = (m) => (m == null ? m : miles() ? m / M_PER_FT : m);
/** Kilograms → kg or lb. */
export const kgToShown = (kg) => (kg == null ? kg : pounds() ? kg / KG_PER_LB : kg);
/** Weight typed in the unit shown → kilograms (stored). */
export const shownToKg = (v) => (v == null ? v : pounds() ? v * KG_PER_LB : v);
/** °C → °C or °F. */
export const celsiusToShown = (c) => (c == null ? c : state.temperature === 'f' ? (c * 9) / 5 + 32 : c);
/** Centimetres → { ft, in } (inches rounded, 12 in carry over). */
export function cmToFeetInches(cm) {
  if (cm == null) return null;
  let ft = Math.floor(cm / CM_PER_IN / 12);
  let inch = Math.round(cm / CM_PER_IN - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return { ft, in: inch };
}
/** Feet and inches → centimetres (whole). */
export const feetInchesToCm = (ft, inch = 0) => Math.round((Number(ft) * 12 + Number(inch || 0)) * CM_PER_IN);

/** Unit labels as the app writes them. */
export const distanceUnit = () => (miles() ? 'mi' : 'km');
export const paceUnit = () => (miles() ? 'min/mi' : 'min/km');
export const elevationUnit = () => (miles() ? 'ft' : 'm');
export const weightUnit = () => (pounds() ? 'lb' : 'kg');
export const temperatureUnit = () => (state.temperature === 'f' ? '°F' : '°C');

/* --------------------------------- Input ---------------------------------- */
/* Forms show stored amounts in the person's unit and turn what is typed back into metric. A field
   saved as it was filled keeps the stored amount, so opening and saving moves nothing – also where
   km → mi → km would round (and a changed race distance would ask for a new plan). In km and kg
   everything stays as it was: the stored value in the field, the typed value stored. */
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const AMOUNTS = {
  // Miles to a hundredth, back to km at 0.01 (10 m).
  distance: { converted: miles, toShown: kmToShown, toMetric: shownToKm, shownDigits: 2, metricDigits: 2 },
  // Pounds to a tenth, back to kg at 0.01 – so 160 lb comes back as 160.0 lb, not 160.1.
  weight: { converted: pounds, toShown: kgToShown, toMetric: shownToKg, shownDigits: 1, metricDigits: 2 },
};

/** A stored metric amount as its form field shows it ('' when there is none): miles and pounds
    rounded, km and kg as stored. kind: 'distance' or 'weight'. */
export function toInput(metric, kind) {
  if (metric == null || metric === '' || !Number.isFinite(Number(metric))) return '';
  const a = AMOUNTS[kind];
  return a.converted() ? round(a.toShown(Number(metric)), a.shownDigits) : metric;
}
/** An amount typed in the unit shown ("," or "." as decimal mark) in metric; null when empty or no
    number. `stored`: the value the field was filled with – kept while the field still shows it. */
export function fromInput(value, kind, stored = null) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const a = AMOUNTS[kind];
  if (!a.converted()) return n;
  if (toInput(stored, kind) === round(n, a.shownDigits)) return Number(stored);
  return round(a.toMetric(n), a.metricDigits);
}
/** A stored pace (s/km) as its field shows it: whole seconds per km or per mile; null without. */
export const paceToInput = (secPerKm) => (Number(secPerKm) > 0 ? Math.round(paceToShown(Number(secPerKm))) : null);
/** Seconds typed per unit shown → whole seconds per km; the stored pace stays while the field shows it. */
export function paceFromInput(shownSec, stored = null) {
  const n = Number(shownSec);
  if (!shownSec || !Number.isFinite(n) || n <= 0) return null;
  if (paceToInput(stored) === Math.round(n)) return Number(stored);
  return Math.round(shownToPace(n));
}
/** Height typed in feet and inches → whole cm (null when both are empty or zero); the stored
    height stays while the fields show it. */
export function heightFromInput(ft, inch, storedCm = null) {
  const f = parseFloat(String(ft ?? '').replace(',', '.'));
  const i = parseFloat(String(inch ?? '').replace(',', '.'));
  const feet = Number.isFinite(f) ? f : 0, inches = Number.isFinite(i) ? i : 0;
  if (feet * 12 + inches <= 0) return null;
  const was = Number(storedCm) > 0 ? cmToFeetInches(Number(storedCm)) : null;
  if (was && was.ft === feet && was.in === inches) return Number(storedCm);
  return feetInchesToCm(feet, inches);
}
