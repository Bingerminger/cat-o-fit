/* =========================================================================
   env.js — Umgebungs-Isolation & gekapselter LocalStorage-Zugriff.

   Produktion (/cat-o-fit/) und Abnahme (/cat-o-fit-acc/) laufen auf derselben
   Origin und teilen sich denselben localStorage. Damit sie sich NICHT in die
   Quere kommen, trägt jeder Storage-Key den Deployment-Pfad als Namespace.

   Dies ist – neben storage.js – die EINZIGE Stelle, die localStorage direkt
   berühren darf. Alle Feature-Module nutzen lsGet/lsSet/lsRemove, damit der
   Namespace nie vergessen werden kann. Abgesichert durch
   test/no-raw-localstorage.test.js und test/env-isolation.test.js.
   ========================================================================= */

/** Namespace der laufenden Umgebung = URL-Pfad des Deployments (z. B. „/cat-o-fit-acc/"). */
export const APP_NS = (() => {
  try { return new URL('.', location.href.split('#')[0]).pathname || '/'; }
  catch { return '/'; }
})();

/** Baut einen umgebungs-eindeutigen Storage-Key: `catofit:<pfad>:<name>`. */
export function scopeKey(name) { return `catofit:${APP_NS}:${name}`; }

/** Liest einen umgebungs-isolierten LocalStorage-Wert (roher String | null). */
export function lsGet(name) {
  try { return localStorage.getItem(scopeKey(name)); } catch { return null; }
}

/** Schreibt einen umgebungs-isolierten LocalStorage-Wert (still bei vollem/fehlendem Speicher). */
export function lsSet(name, value) {
  try { localStorage.setItem(scopeKey(name), value); } catch { /* voll / nicht verfügbar */ }
}

/** Entfernt einen umgebungs-isolierten LocalStorage-Wert. */
export function lsRemove(name) {
  try { localStorage.removeItem(scopeKey(name)); } catch { /* egal */ }
}
