/* =========================================================================
   env.js — environment isolation & encapsulated LocalStorage access.

   Production (/cat-o-fit/) and acceptance (/cat-o-fit-acc/) run on the same
   origin and share the same localStorage. So that they do NOT get in each
   other's way, every storage key carries the deployment path as a namespace.

   Besides storage.js, this is the ONLY place allowed to touch
   localStorage directly. All feature modules use lsGet/lsSet/lsRemove so that the
   namespace can never be forgotten. Safeguarded by
   test/no-raw-localstorage.test.js and test/env-isolation.test.js.
   ========================================================================= */

/** Namespace of the running environment = URL path of the deployment (e.g. "/cat-o-fit-acc/"). */
export const APP_NS = (() => {
  try { return new URL('.', location.href.split('#')[0]).pathname || '/'; }
  catch { return '/'; }
})();

/** Builds an environment-unique storage key: `catofit:<path>:<name>`. */
export function scopeKey(name) { return `catofit:${APP_NS}:${name}`; }

/** Reads an environment-isolated LocalStorage value (raw string | null). */
export function lsGet(name) {
  try { return localStorage.getItem(scopeKey(name)); } catch { return null; }
}

/** Writes an environment-isolated LocalStorage value (silent when storage is full/unavailable). */
export function lsSet(name, value) {
  try { localStorage.setItem(scopeKey(name), value); } catch { /* full / unavailable */ }
}

/** Removes an environment-isolated LocalStorage value. */
export function lsRemove(name) {
  try { localStorage.removeItem(scopeKey(name)); } catch { /* ignore */ }
}
