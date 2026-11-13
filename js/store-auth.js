/* =========================================================================
   store-auth.js — PIN and sign-in. Layer 8.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { REACH_TIMEOUT, isOnline, ping, pullChanges, serverLogin, serverSetPin } from './api-client.js';
import { t as tr } from './i18n.js';
import { sha256Hex } from './sha256.js';
import { adoptServerFamily, pushFamily, rebuildFamily } from './store-family.js';
import { safeSet, writeFamilyStoreLS } from './store-local.js';
import { DEFAULT_PIN, DEVICE_SALT_KEY, PIN_LOCAL_KEY, SESSION_KEY, WEAK_PIN_KEY, family, familyStore, vars } from './store-state.js';
import { setActiveUser, syncNow } from './store-sync.js';

/** Sign in to the server again without leaving the session in the app. */
export async function reauth(pin) {
  if (!vars.identity) return false;
  const r = await serverLogin(vars.identity, String(pin ?? ''));
  if (r && r.ok) {
    vars.serverUser = vars.identity; vars.pendingServerPin = null;
    if (memberHasPin(vars.identity)) rememberDevicePin(vars.identity, String(pin ?? ''));
    syncNow();
    return true;
  }
  vars.lastLoginErr = r ? { code: r.code, message: r.error || tr('reauth.wrongPin'), left: r.left, retryAfter: r.retryAfter }
    : { code: 'offline', message: tr('storage.serverUnreachable') };
  return false;
}

/**
 * PIN hash – **deterministic in EVERY context** (plain SHA-256, no
 * crypto.subtle; so a PIN set over http remains valid over https as well).
 * Since v3.20.0 the SERVER checks the PIN (same scheme, api/auth.php); the client
 * only computes the hash when an admin assigns a start PIN.
 */
export function pinHash(userId, pin) { return sha256Hex(`catofit:${userId}:${pin}`); }
export function deviceSalt() {
  let s = null;
  try { s = localStorage.getItem(DEVICE_SALT_KEY); } catch { /* ignore */ }
  if (!s) {
    const b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
    s = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    safeSet(DEVICE_SALT_KEY, s);
  }
  return s;
}
export function readPinLocal() { try { return JSON.parse(localStorage.getItem(PIN_LOCAL_KEY) || '{}') || {}; } catch { return {}; } }
export function devicePinHash(userId, pin) { return sha256Hex(`catofit-device:${deviceSalt()}:${userId}:${pin}`); }
export function rememberDevicePin(userId, pin) {
  const m = readPinLocal();
  m[userId] = devicePinHash(userId, pin);
  safeSet(PIN_LOCAL_KEY, JSON.stringify(m));
}
export function setWeakPin(userId, weak) {
  try { if (weak) sessionStorage.setItem(WEAK_PIN_KEY, userId); else sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* ignore */ }
}
/** Is the signed-in person still using the default PIN (or none at all)? */
export function pinIsWeak() {
  try { return !!vars.identity && sessionStorage.getItem(WEAK_PIN_KEY) === vars.identity; } catch { return false; }
}

export function memberHasPin(userId) {
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return false;
  return m.hasPin !== undefined ? !!m.hasPin : !!m.pinHash;
}

/** PIN rules (also apply on the server): 4 to 8 digits, not the default PIN 0000. */
export function pinProblem(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4,8}$/.test(p)) return tr('storage.pinLength');
  if (p === DEFAULT_PIN) return tr('storage.pinDefault');
  return null;
}

/**
 * Set the PIN – only with a server connection. One's own PIN requires the previous one
 * (`oldPin`); another member's PIN may only be reset by an admin.
 * Returns { ok } or { ok:false, code, message }.
 */
export async function setMemberPin(userId, pin, oldPin = null) {
  const problem = pinProblem(pin);
  if (problem) return { ok: false, code: 'weak', message: problem };
  if (!isOnline()) return { ok: false, code: 'offline', message: tr('storage.pinNeedsServer') };
  const self = userId === vars.identity;
  const r = await serverSetPin(userId, String(pin), self ? String(oldPin ?? '') : null);
  if (!r) return { ok: false, code: 'offline', message: tr('storage.serverUnreachable') };
  if (!r.ok) return { ok: false, code: r.code, message: r.error || tr('storage.pinNotSaved'), left: r.left, retryAfter: r.retryAfter };
  const rec = familyStore.records[userId];
  if (rec) { familyStore.records[userId] = { ...rec, hasPin: true }; rebuildFamily(); writeFamilyStoreLS(); }
  if (self) { rememberDevicePin(userId, String(pin)); setWeakPin(userId, false); vars.serverUser = vars.identity; }
  return { ok: true };
}

/** Reason for the most recently failed sign-in: { code, message, left?, retryAfter? }. */
export function lastLoginError() { return vars.lastLoginErr; }

/**
 * Sign in. With a server connection the server checks the PIN and opens a session
 * (prerequisite for cycle, labs and supplements). Without a server it only works on
 * devices where the person has already signed in online once; the
 * server sign-in is then caught up at the next sync.
 */
export async function login(userId, pin) {
  vars.lastLoginErr = null;
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) { vars.lastLoginErr = { code: 'unknown', message: tr('storage.profileGone') }; return false; }
  const p = String(pin ?? '');
  const hasPin = memberHasPin(userId);
  // If the server does not answer within 2.5 s, the sign-in counts as offline (PIN check on the
  // device, server session is caught up later) – previously the PIN sheet waited 17 s to 6 min (FE-08).
  let r = isOnline() && await ping(REACH_TIMEOUT) ? await serverLogin(userId, p) : null;
  // If the server does not know the profile yet (e.g. an initial setup begun offline),
  // first send the waiting family changes and then sign in again.
  if (r && !r.ok && r.code === 'unknown' && vars.familyOps.length) {
    try { await pushFamily(); } catch { /* ignore */ }
    r = await serverLogin(userId, p);
  }
  // If the server still does not know the profile, the list on this device is outdated
  // (removed elsewhere, or server set up anew): adopt the members from the server so that
  // the tile disappears or the initial setup appears.
  if (r && !r.ok && r.code === 'unknown' && !vars.familyOps.length) {
    try { adoptServerFamily(await pullChanges('family', { scope: 'family', since: 0 })); } catch { /* offline -> stays */ }
  }
  if (r && r.ok) {
    vars.serverUser = userId;
    vars.pendingServerPin = null;
    if (hasPin) rememberDevicePin(userId, p);
    setWeakPin(userId, !!r.weakPin);
  } else if (r) {
    vars.lastLoginErr = { code: r.code, message: r.error || tr('reauth.wrongPin'), left: r.left, retryAfter: r.retryAfter };
    return false;
  } else {
    if (hasPin) {
      const local = readPinLocal()[userId];
      if (!local) {
        vars.lastLoginErr = { code: 'offline-first', message: tr('login.firstNeedsServer') };
        return false;
      }
      if (local !== devicePinHash(userId, p)) { vars.lastLoginErr = { code: 'pin', message: tr('reauth.wrongPin') }; return false; }
    }
    vars.pendingServerPin = { user: userId, pin: p };
    setWeakPin(userId, !hasPin || p === DEFAULT_PIN);
  }
  vars.identity = userId;
  // Remember the sign-in in the BROWSER SESSION: survives reloads (theme/profile/
  // plan changes reload) – but NOT an app restart/closing
  // (sessionStorage), so "always sign in again" is kept on a real start.
  try { sessionStorage.setItem(SESSION_KEY, userId); } catch { /* ignore */ }
  await setActiveUser(userId);
  return true;
}
