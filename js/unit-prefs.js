/* =========================================================================
   unit-prefs.js — the signed-in person's units (settings: distanceUnit,
   weightUnit, temperatureUnit, weekStart, labUnits) applied to units.js.

   Without a choice the browser's region decides; ensureUnitDefaults() saves
   that once, so the server (calendar files) knows the person's units too.
   While an admin manages another member, the admin's own units stay – like
   the language.
   ========================================================================= */

import * as store from './storage.js';
import { defaultUnits, setUnits } from './units.js';

const KEYS = { distance: 'distanceUnit', weight: 'weightUnit', temperature: 'temperatureUnit', weekStart: 'weekStart', labs: 'labUnits' };

function browserLanguages() {
  return typeof navigator !== 'undefined' ? (navigator.languages || navigator.language || null) : null;
}

/** The person's units: their own settings, else the defaults for the browser's region. */
export function personUnits() {
  const s = store.activeUserId() ? store.settings() : {};
  const d = defaultUnits(browserLanguages());
  const out = {};
  for (const [k, key] of Object.entries(KEYS)) out[k] = s[key] ?? d[k];
  return out;
}

/** Applies the units; true if they changed (the view is then redrawn). */
export function applyUnits() {
  if (store.isManaging()) return false;
  return setUnits(personUnits());
}

/** Saves the region defaults for settings the person has not chosen yet (once per setting). */
export function ensureUnitDefaults() {
  if (!store.activeUserId() || store.isManaging()) return;
  const s = store.settings();
  const d = defaultUnits(browserLanguages());
  for (const [k, key] of Object.entries(KEYS)) if (s[key] == null) store.setSetting(key, d[k]);
}
