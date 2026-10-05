/* =========================================================================
   session-gate.js — pure sign-in logic (DOM-free, hence testable).

   Decides two things without knowing anything about the browser:
     1) May a route be rendered without sign-in, or must it be redirected
        to the login?                                    -> gate()
     2) May the menus (bottom nav / sidebar) be visible?  -> menusVisible()

   Model (since v3.3.0):
     - There is NO auto-login. Without an active user only the login page
       (`/login`) is reachable; there one picks one's profile – or, on an empty
       installation, the initial setup runs (see needsSetup()).
     - `/login` is the ONLY public route. Signed-in users are sent from there
       back to the dashboard (the login page is signed-out-only).
     - The team/family dashboard lives at `/family` and is reachable ONLY when
       signed in (it is a menu item, no longer a login page).
   ========================================================================= */

/** The only route reachable without sign-in: the login/initial setup page. */
export const LOGIN_PATH = '/login';

/** Is the route allowed even without sign-in? */
export function isPublicPath(path) {
  return path === LOGIN_PATH;
}

/**
 * Before every render: allow or redirect.
 * @param {string|null} activeUserId  signed-in user (or null)
 * @param {string} path               route without leading '#'
 * @returns {{allow:true}|{allow:false, redirect:string}}
 */
export function gate(activeUserId, path) {
  if (activeUserId) {
    // Signed in: the login page is signed-out-only -> back to the dashboard.
    if (path === LOGIN_PATH) return { allow: false, redirect: '#/' };
    return { allow: true };
  }
  if (isPublicPath(path)) return { allow: true };
  return { allow: false, redirect: '#' + LOGIN_PATH };
}

/** May the menus (main navigation) be shown? Only when signed in. */
export function menusVisible(activeUserId) {
  return !!activeUserId;
}

/** Empty installation? Then the login page shows the initial setup instead of the profile selection. */
export function needsSetup(memberCount) {
  return (memberCount || 0) === 0;
}

/**
 * Return target after sign-in (FE-25): calendar reminders open "#/session/<id>" –
 * without a session it first went to sign-in and afterwards always to "Today". Only
 * internal routes are allowed (never the sign-in itself, no foreign addresses).
 */
export function safeReturnTo(hash) {
  const h = String(hash || '');
  if (!/^#\/[\w\-./%]*$/.test(h) || h.length > 200) return null;
  if (h === '#/' || h === '#' + LOGIN_PATH || h.startsWith('#' + LOGIN_PATH + '/')) return null;
  return h;
}
