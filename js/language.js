/* =========================================================================
   language.js — which language the app shows.

   Order: the signed-in person's choice (settings.language) → the instance
   default (family settings) → German for instances set up before v4.0.0 →
   the browser language → English. While an admin manages another member,
   the admin's own language stays.
   ========================================================================= */

import * as store from './storage.js';
import { resolveLanguage, setLocale, t } from './i18n.js';

function browserLanguages() {
  return typeof navigator !== 'undefined' ? (navigator.languages || navigator.language || null) : null;
}

function resolve(person) {
  const fam = store.getFamily() || {};
  return resolveLanguage({
    person,
    instance: store.familySettings().language,
    legacy: (fam.members || []).length > 0,
    browser: browserLanguages(),
  });
}

/** Default language of the instance – what the sign-in screen and new people get. */
export function instanceLanguage() { return resolve(null); }

/** Language for the signed-in person, or the instance default when nobody is signed in. */
export function appLanguage() { return resolve(store.activeUserId() ? store.settings().language : null); }

/** The fixed texts of index.html: [data-i18n] → text, [data-i18n-aria] → aria-label, title, description. */
export function translateStatic(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return;
  doc.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
  doc.querySelectorAll('[data-i18n-aria]').forEach((n) => n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))));
  doc.title = t('app.title');
  const meta = doc.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', t('app.description'));
}

/** Applies the language; true if it changed (the navigation is then rebuilt). */
export async function applyLanguage() {
  if (store.isManaging()) return false;
  const changed = await setLocale(appLanguage());
  translateStatic();
  if (changed && typeof window !== 'undefined' && typeof Event === 'function') window.dispatchEvent(new Event('catofit:nav'));
  return changed;
}
