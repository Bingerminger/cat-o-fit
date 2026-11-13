/* =========================================================================
   store-sync.js — one sync pass and syncNow, the start, switching and signing out the person. Layer 7.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { REACH_TIMEOUT, isOnline, onStatus, ping, pullAllChanges, pullChanges, serverHas, serverLogout } from './api-client.js';
import { scopeKey } from './ui.js';
import { localFamilyRecord, rebuildFamily, syncFamily } from './store-family.js';
import { evictUserCache, hasPending, healMarksOnce, isSharedDevice, loadUserFromLS, notify, readFamilyStoreLS, safeSet, setSyncState, wipePersonalData, writeFamilyStoreLS } from './store-local.js';
import { withOpId } from './store-merge.js';
import { applyPull, pushAllAreas, pushArea, pushForeignQueues, resyncArea } from './store-queue.js';
import { catchUpServerLogin, privateAllowed, sessionLost } from './store-session.js';
import { AREAS, ARRAY_AREAS, IDENTITY_KEY, PRIVATE_AREAS, SESSION_KEY, WEAK_PIN_KEY, family, familyStore, state, vars } from './store-state.js';

export async function pullArea(area, user) {
  const since = vars.revs[area] || 0;
  const res = await pullChanges(area, { user, since });
  await applyPull(area, user, res, since);
}

// Weekly full sync per device and user: a restore on the server after which
// enough has been written again no longer shows up in the rev comparison.
// Once a week the complete server state therefore applies (plus pending ops).
export const FULL_RESYNC_MS = 7 * 24 * 3600 * 1000;
export function fullResyncKey(user) { return scopeKey(`${user}:__fullSync`); }

/** Bulk fetch (server with 'changes-all'): send everything pending, then fetch the changes of all areas
    in ONE request. false = the server cannot do that, the single route takes over. */
export async function syncPassBulk(u) {
  const areas = AREAS.filter((a) => !PRIVATE_AREAS.includes(a) || privateAllowed(u));
  for (const area of areas) {
    await pushArea(area, u);
    if (vars.activeUser !== u) return true;
  }
  const since = Object.fromEntries(areas.map((a) => [a, vars.revs[a] || 0]));
  let res;
  try {
    res = await pullAllChanges(u, since);
  } catch (e) {
    if (e && [400, 404, 405].includes(e.status)) return false;
    setSyncState('error');
    return true;
  }
  if (vars.activeUser !== u) return true;
  // Private areas locked: the server session has expired – ask for the PIN.
  if (res.locked.length) sessionLost();
  for (const area of areas) {
    if (res.locked.includes(area) || res.revs[area] == null) continue;
    await applyPull(area, u, { rev: res.revs[area], records: res.changes[area] || [] }, since[area]);
    if (vars.activeUser !== u) return true;
  }
  return true;
}

/** One pass for exactly one fixed user: push first, then pull. */
export async function syncPass(u) {
  let last = 0;
  try { last = parseInt(localStorage.getItem(fullResyncKey(u)) || '0', 10) || 0; } catch { /* ignore */ }
  const full = Date.now() - last > FULL_RESYNC_MS;
  // New server: one request instead of one per area. The weekly full sync stays on the single route.
  if (!full && serverHas('changes-all') && await syncPassBulk(u)) return;
  let allOk = true;
  for (const area of AREAS) {
    if (vars.activeUser !== u) return;       // View switch -> discard the pass
    // Private areas only with their own server session (ops wait in the queue meanwhile).
    if (PRIVATE_AREAS.includes(area) && !privateAllowed(u)) continue;
    await pushArea(area, u);
    if (vars.activeUser !== u) return;
    try {
      if (full && !(vars.pendingOps[area] || []).length) await resyncArea(area, u);
      else await pullArea(area, u);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403) && PRIVATE_AREAS.includes(area)) { sessionLost(); continue; }
      allOk = false; setSyncState('error');
    }
  }
  if (full && allOk && vars.activeUser === u) safeSet(fullResyncKey(u), String(Date.now()));
}

/**
 * Fetches all areas from the server and merges them with the local state. If a sync
 * is already running, the call waits for its end plus another round – previously it
 * returned immediately, and whoever reported (or checked) "done" afterwards saw a half state.
 */

export function syncNow() {
  if (vars.resetting) return Promise.resolve();
  if (!vars.activeUser) { setSyncState('idle'); return Promise.resolve(); }
  if (!isOnline()) { setSyncState('offline'); return Promise.resolve(); }
  if (vars.syncRun) { vars.syncPending = true; return vars.syncRun; }
  vars.syncRun = (async () => {
    let unreachable = false;
    try {
      do {
        vars.syncPending = false;
        if (!vars.activeUser || !isOnline()) break;
        setSyncState('syncing');
        // Ask briefly once whether the server answers – otherwise 13 areas would run individually
        // into their timeouts (on the road, home server in standby: minutes, FE-08).
        // If another sync was requested meanwhile, one more attempt follows (while condition).
        if (!(await ping(REACH_TIMEOUT))) { unreachable = true; continue; }
        unreachable = false;
        await catchUpServerLogin();
        await syncFamily();
        if (vars.activeUser) await syncPass(vars.activeUser);
        if (vars.activeUser) await pushForeignQueues();   // e.g. restores submitted later
      } while (vars.syncPending);
    } finally {
      vars.syncRun = null;
    }
    setSyncState(unreachable || hasPending() ? 'offline' : (isOnline() ? 'idle' : 'offline'));
  })();
  return vars.syncRun;
}

export async function init() {
  // 1) Family from LocalStorage (offline-first) – to display the login tiles.
  const fam = readFamilyStoreLS();
  if (fam && fam.records) {
    familyStore.rev = fam.rev || 0;
    // Do not carry on PIN hashes from older caches (only `hasPin` now).
    const recs = {};
    for (const id in (fam.records || {})) recs[id] = localFamilyRecord(fam.records[id]);
    familyStore.records = recs;
    vars.familyOps = (Array.isArray(fam.ops) ? fam.ops : []).map(withOpId);
    rebuildFamily();
    if (Object.keys(fam.records || {}).some((id) => fam.records[id] && 'pinHash' in fam.records[id])) writeFamilyStoreLS();
  }
  healMarksOnce();
  // Restore the sign-in of the running browser session (sessionStorage):
  // survives reloads (theme/profile/plan changes reload the page), but
  // NOT an app restart/closing -> on a real start it stays at
  // "always sign in again". Discard the LEGACY key (permanent, before v3.2.0)
  // so that nobody stays permanently auto-signed-in unintentionally.
  try { localStorage.removeItem(IDENTITY_KEY); } catch { /* ignore */ }
  vars.identity = null;
  vars.activeUser = null;
  vars.serverUser = null;             // whether the cookie is still valid is settled by the first sync
  vars.pendingServerPin = null;
  vars.sessionAsked = false;
  let sess = null;
  try { sess = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
  if (sess && (family.members || []).some((m) => m.id === sess)) {
    vars.identity = sess;
    vars.activeUser = sess;
    loadUserFromLS();            // load data offline-first; server sync follows below
  } else if (sess) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  // 2) Mirror the online status and sync on reconnect.
  onStatus((s) => { if (s === 'online') syncNow(); else setSyncState('offline'); });

  // 3) Sync in the BACKGROUND: the app draws immediately from the local state (FE-08) –
  //    previously the start waited for family, ping and all areas (with a hanging server
  //    up to 32 s, after which the error page appeared). Only a brand-new device (no
  //    family locally yet) waits briefly for the member list for the sign-in.
  const net = bootSync();
  if (!Object.keys(familyStore.records).length) await Promise.race([net, new Promise((r) => setTimeout(r, 6000))]);
}

/** Start sync: briefly check whether the server answers, then family and – with a
    restored session – the own areas. */
export async function bootSync() {
  if (!isOnline()) { setSyncState('offline'); return; }
  if (!(await ping(REACH_TIMEOUT))) { setSyncState('offline'); return; }
  await syncFamily();
  // Restored session: does the user still exist after the family sync?
  // If not (e.g. removed on another device), sign out cleanly – the view
  // learns of it via the family message and lands on the sign-in when redrawing.
  if (vars.activeUser && !(family.members || []).some((m) => m.id === vars.activeUser)) {
    clearActiveUser();
    notify('family', 'sync');
  } else if (vars.activeUser) {
    // syncNow also checks whether the server session (cookie) is still valid after the reload.
    try { await syncNow(); } catch { /* stays offline-first */ }
  }
}

/** Switches the user being viewed (loads their areas, redraws). */
export async function setActiveUser(id) {
  if (!id) return;
  const prev = vars.activeUser;
  // Still write out the previous user's pending ops (before the switch) – only if
  // the server answers; otherwise they stay in that user's queue and go out later.
  if (prev && prev !== id && isOnline() && await ping(REACH_TIMEOUT)) {
    try { await pushAllAreas(prev); } catch { /* stays in the queue */ }
  }
  vars.activeUser = id;
  vars.profileFetchedFor = null;
  loadUserFromLS();
  // Whoever only managed a member does not need their data permanently in storage.
  if (prev && prev !== id && prev !== vars.identity) evictUserCache(prev);
  AREAS.forEach((a) => notify(a, 'local'));
  // Sync in the background: sign-in and profile switch wait only for the local state;
  // whatever is new on the server, the view redraws on arrival (FE-08).
  if (isOnline()) syncNow().catch(() => {});
}

/** Signs the signed-in person out (back to the family dashboard). */
export function clearActiveUser() {
  vars.identity = null;
  vars.activeUser = null;
  vars.profileFetchedFor = null;
  vars.serverUser = null;
  vars.pendingServerPin = null;
  vars.sessionAsked = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* ignore */ }
  localStorage.removeItem(IDENTITY_KEY);
}

/** Discard the in-memory data of the most recently active user (after signing out). */
export function resetState() {
  state.profile = {};
  ARRAY_AREAS.forEach((a) => { state[a] = []; });
  vars.revs = {};
  vars.pendingOps = {};
}

/**
 * Sign out completely: write out pending changes (if online),
 * then discard identity and the loaded data in memory. Afterwards only
 * the family/login dashboard is reachable (no auto-login).
 */
export async function logout() {
  if (vars.activeUser && isOnline()) {
    try { await pushAllAreas(vars.activeUser); } catch { /* stays in the queue (LocalStorage) */ }
  }
  if (vars.serverUser && isOnline()) await serverLogout();
  const managed = vars.activeUser && vars.activeUser !== vars.identity ? vars.activeUser : null;
  clearActiveUser();
  if (managed) evictUserCache(managed);
  resetState();
  if (isSharedDevice()) wipePersonalData();
}
