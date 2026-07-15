/* =========================================================================
   session-gate.js — reine Anmelde-Logik (DOM-frei, daher testbar).

   Entscheidet zwei Dinge, ohne irgendetwas über den Browser zu wissen:
     1) Darf eine Route ohne Anmeldung gerendert werden, oder muss zum
        Login umgeleitet werden?                         -> gate()
     2) Dürfen die Menüs (Bottom-Nav / Sidebar) sichtbar sein?  -> menusVisible()

   Modell (ab v3.3.0):
     - Es gibt KEINEN Auto-Login. Ohne aktiven Nutzer ist nur die Login-Seite
       (`/login`) erreichbar; dort wählt man sein Profil – oder bei leerer
       Installation läuft die Ersteinrichtung (siehe needsSetup()).
     - `/login` ist die EINZIGE öffentliche Route. Angemeldete werden von dort
       wieder ins Dashboard geschickt (die Login-Seite ist abgemeldet-only).
     - Das Team-/Familien-Dashboard liegt auf `/family` und ist NUR angemeldet
       erreichbar (es ist ein Menüpunkt, keine Login-Seite mehr).
   ========================================================================= */

/** Einzige ohne Anmeldung erreichbare Route: die Login-/Ersteinrichtungsseite. */
export const LOGIN_PATH = '/login';

/** Ist die Route auch ohne Anmeldung erlaubt? */
export function isPublicPath(path) {
  return path === LOGIN_PATH;
}

/**
 * Vor jedem Rendern: erlauben oder umleiten.
 * @param {string|null} activeUserId  angemeldeter Nutzer (oder null)
 * @param {string} path               Route ohne führendes '#'
 * @returns {{allow:true}|{allow:false, redirect:string}}
 */
export function gate(activeUserId, path) {
  if (activeUserId) {
    // Angemeldet: die Login-Seite ist abgemeldet-only -> zurück ins Dashboard.
    if (path === LOGIN_PATH) return { allow: false, redirect: '#/' };
    return { allow: true };
  }
  if (isPublicPath(path)) return { allow: true };
  return { allow: false, redirect: '#' + LOGIN_PATH };
}

/** Dürfen die Menüs (Haupt-Navigation) angezeigt werden? Nur im angemeldeten Zustand. */
export function menusVisible(activeUserId) {
  return !!activeUserId;
}

/** Leere Installation? Dann zeigt die Login-Seite die Ersteinrichtung statt der Profilauswahl. */
export function needsSetup(memberCount) {
  return (memberCount || 0) === 0;
}
