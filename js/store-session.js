/* =========================================================================
   store-session.js — the server session (since v3.20.0): may private areas go to the server,
   catching up a sign-in that began offline, a session that was lost. Layer 3.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { serverLogin, serverSession } from './api-client.js';
import { vars } from './store-state.js';

/** May this user's private areas be synced with the server now?
    Only for the signed-in person themself and only with their own server session. */
export function privateAllowed(user) { return !!user && user === vars.identity && vars.serverUser === vars.identity; }

/** The server does not (or no longer) know the session – e.g. expired, or the PIN was changed on
    another device. The UI then asks for the PIN (app.js). */
export function sessionLost() {
  vars.serverUser = null;
  vars.sessionAsked = true;
  try { window.dispatchEvent(new Event('catofit:session-required')); } catch { /* without DOM */ }
}

/** Ensure the server session: catch up after a sign-in without a server connection,
    check after a reload whether the cookie is still valid. */
export async function catchUpServerLogin() {
  if (!vars.identity || vars.serverUser === vars.identity) return;
  if (vars.pendingServerPin && vars.pendingServerPin.user === vars.identity) {
    const r = await serverLogin(vars.identity, vars.pendingServerPin.pin);
    if (r && r.ok) { vars.serverUser = vars.identity; vars.pendingServerPin = null; return; }
    if (r) { vars.pendingServerPin = null; sessionLost(); }   // PIN changed in the meantime or similar
    return;
  }
  const s = await serverSession();
  if (s && s.user === vars.identity) vars.serverUser = vars.identity;
  // The server answers but knows no session for this person – after the update from
  // v3.19.0 (which had none) or after 30 days of inactivity. Without a prompt, cycle,
  // labs and supplements would silently stay put; "Later" applies until the next page load.
  else if (s && !vars.sessionAsked) sessionLost();
}

/** Does this person have a server session? (For notices in the UI.) */
export function serverSessionActive() { return !!vars.identity && vars.serverUser === vars.identity; }
