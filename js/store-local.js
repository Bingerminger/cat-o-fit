/* =========================================================================
   store-local.js — the device storage (LocalStorage) of the store: areas, queues and the family
   store of this device, a full device, the sync indicator, notifications, ops of other tabs, a
   shared device. Layer 2.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { scopeKey } from './ui.js';
import { t as tr } from './i18n.js';
import { contentKey, mergeRecords, normalizeOps } from './store-merge.js';
import { AREAS, ARRAY_AREAS, DEVICE_SALT_KEY, FAMILY_STORE_LS, LS, PRIVATE_AREAS, adopted, familyStore, retired, state, syncListeners, vars } from './store-state.js';

// Every write reports whether it succeeded. A full quota
// (QuotaExceededError) is never swallowed silently: the change is rolled back
// and the UI shows a notice (event 'catofit:storage-full').
export function reportStorageFull(e) {
  console.warn('Device storage full?', e);
  setSyncState('full');
  const now = Date.now();
  if (now - vars.storageFullAt < 3000) return;          // not for every single write
  vars.storageFullAt = now;
  try { window.dispatchEvent(new Event('catofit:storage-full')); } catch { /* without DOM */ }
}
export function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { reportStorageFull(e); return false; }
}
export function readLS(area) {
  try { const raw = localStorage.getItem(LS(area)); return raw == null ? null : JSON.parse(raw); } catch { return null; }
}
export function writeLS(area) { return safeSet(LS(area), JSON.stringify(state[area])); }
export function userMetaKey(user) { return scopeKey(`${user}:__meta`); }
export function writeUserMeta() {
  if (!vars.activeUser) return true;
  adoptForeignOps();   // Take over ops from other tabs before the queue is overwritten
  return safeSet(userMetaKey(vars.activeUser), JSON.stringify({ revs: vars.revs, ops: vars.pendingOps }));
}
export function readUserArea(user, area) { try { return JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { return null; } }
export function writeUserArea(user, area, val) { return safeSet(scopeKey(`${user}:${area}`), JSON.stringify(val)); }
export function readMeta(user) {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null'); } catch { /* ignore */ }
  m = m || { revs: {}, ops: {} };
  m.revs = m.revs || {};
  m.ops = normalizeOps(m.ops);
  return m;
}
export function writeMeta(user, m) { return safeSet(userMetaKey(user), JSON.stringify(m)); }

/** Adopt server records into the state of the ACTIVE user ({ changed, visible }
    as with mergeRecords). */
export function applyServerRecords(area, records) {
  const none = { changed: false, visible: false };
  if (!records || !records.length) return none;
  if (area === 'profile') {
    // With MULTIPLE profile upserts in one batch the server returns several
    // 'profile' records – take the one with the HIGHEST rev (applied last),
    // not the first. Otherwise an older version overwrites newer fields
    // (e.g. the location was lost with seedDemo / rapid profile edits).
    const sp = records
      .filter((r) => r.id === 'profile')
      .reduce((best, r) => (!best || (r.rev || 0) > (best.rev || 0) ? r : best), null);
    if (sp && (sp.rev || 0) > (state.profile.rev || 0)) {
      const visible = contentKey(state.profile) !== contentKey(sp);
      state.profile = sp;
      return { changed: true, visible };
    }
    return none;
  }
  const m = mergeRecords(state[area], records);
  if (m.changed) state[area] = m.records;
  return { changed: m.changed, visible: m.visible };
}

export function onSync(cb) { syncListeners.add(cb); return () => syncListeners.delete(cb); }
export function notify(area, origin) { syncListeners.forEach((cb) => cb(area, origin)); }

export function hasPending() {
  for (const a in vars.pendingOps) {
    if (!(vars.pendingOps[a] || []).length) continue;
    // Private areas of another person deliberately wait for that person's own sign-in –
    // this is not a connection problem and must not show "Offline" permanently.
    if (PRIVATE_AREAS.includes(a) && vars.activeUser !== vars.identity) continue;
    return true;
  }
  return vars.familyOps.length > 0;
}
export function setSyncState(s) {
  if (vars.syncState === s) return;
  vars.syncState = s;
  const ind = document.getElementById('sync-indicator');
  if (ind) {
    ind.dataset.state = s;
    ind.hidden = (s === 'idle');
    const label = { syncing: tr('storage.syncing'), offline: tr('storage.offline'), error: tr('storage.syncError'), full: tr('storage.full') }[s] || '';
    ind.innerHTML = `<span class="sync-indicator__dot"></span><span>${label}</span>`;
  }
}

/** Merge server records into the stored area of a (non-active) user. */
export function mergeIntoUserArea(user, area, records) {
  if (!records || !records.length) return;
  const cur = readUserArea(user, area);
  if (area === 'profile') {
    const sp = records.filter((r) => r.id === 'profile')
      .reduce((best, r) => (!best || (r.rev || 0) > (best.rev || 0) ? r : best), null);
    if (sp && (!cur || (sp.rev || 0) > (cur.rev || 0))) writeUserArea(user, 'profile', sp);
    return;
  }
  writeUserArea(user, area, mergeRecords(Array.isArray(cur) ? cur : [], records).records);
}

/** Take over ops that another tab of the same user has put into the queue, and
    discard taken-over ops that this tab has meanwhile sent itself. */
export function adoptForeignOps() {
  if (!vars.activeUser) return;
  let disk = null;
  try { disk = JSON.parse(localStorage.getItem(userMetaKey(vars.activeUser)) || 'null'); } catch { return; }
  const diskOps = (disk && disk.ops) || {};
  const areas = new Set([...Object.keys(diskOps), ...Object.keys(vars.pendingOps)]);
  for (const area of areas) {
    const onDisk = new Set((diskOps[area] || []).map((o) => o && o.opId).filter(Boolean));
    let list = vars.pendingOps[area] || [];
    // Do not send again taken-over ops that the other tab has already dealt with.
    const stale = list.filter((o) => adopted.has(o.opId) && !onDisk.has(o.opId));
    if (stale.length) { const s = new Set(stale.map((o) => o.opId)); list = list.filter((o) => !s.has(o.opId)); stale.forEach((o) => adopted.delete(o.opId)); }
    const mine = new Set(list.map((o) => o.opId));
    const extra = (diskOps[area] || []).filter((o) => o && o.opId && !mine.has(o.opId) && !retired.has(o.opId));
    if (extra.length) { extra.forEach((o) => adopted.add(o.opId)); list = [...list, ...extra]; }
    if (stale.length || extra.length) vars.pendingOps[area] = list;
  }
}

export function readFamilyStoreLS() { try { return JSON.parse(localStorage.getItem(FAMILY_STORE_LS) || 'null'); } catch { return null; } }
export function writeFamilyStoreLS() {
  return safeSet(FAMILY_STORE_LS, JSON.stringify({ rev: familyStore.rev, records: familyStore.records, ops: vars.familyOps }));
}

export function loadUserFromLS() {
  for (const area of AREAS) {
    const ls = readLS(area);
    state[area] = ls != null ? ls : (ARRAY_AREAS.includes(area) ? [] : {});
  }
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(userMetaKey(vars.activeUser)) || 'null'); } catch { /* ignore */ }
  vars.revs = (meta && meta.revs) ? { ...meta.revs } : {};
  vars.pendingOps = normalizeOps(meta && meta.ops);   // legacy ops get an opId
}

// Until v3.19.0 a push took over the global area rev as the mark; devices could thereby
// skip foreign changes permanently. Discard all marks once per device –
// the next pull then fetches everything (merging by rev is idempotent).
export const HEAL_KEY = scopeKey('syncHeal');
export const HEAL_VERSION = '3.20';
export function healMarksOnce() {
  try {
    if (localStorage.getItem(HEAL_KEY) === HEAL_VERSION) return;
    const prefix = scopeKey('');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k.endsWith(':__meta')) keys.push(k);
    }
    for (const k of keys) {
      try {
        const m = JSON.parse(localStorage.getItem(k) || 'null');
        if (m) { m.revs = {}; localStorage.setItem(k, JSON.stringify(m)); }
      } catch { /* a single entry does not matter */ }
    }
    familyStore.rev = 0;
    writeFamilyStoreLS();
    localStorage.setItem(HEAL_KEY, HEAL_VERSION);
  } catch { /* without storage: again at the next start */ }
}

/** Discard cached data of a member who is only MANAGED (it comes back
    via pull) – relieves the storage quota. Waiting ops are kept. */
export function evictUserCache(user) {
  if (!user || user === vars.identity) return;
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${user}:${a}`)); } catch { /* ignore */ } });
  const m = readMeta(user);
  const hasOps = Object.values(m.ops).some((l) => (l || []).length);
  try {
    if (hasOps) { m.revs = {}; localStorage.setItem(userMetaKey(user), JSON.stringify(m)); }
    else localStorage.removeItem(userMetaKey(user));
  } catch { /* ignore */ }
}

// On a shared family iPad nothing personal should remain in browser storage after
// signing out. The switch applies per device (not per profile).
export const SHARED_DEVICE_KEY = scopeKey('sharedDevice');
export function isSharedDevice() { try { return localStorage.getItem(SHARED_DEVICE_KEY) === '1'; } catch { return false; } }
export function setSharedDevice(on) {
  try { if (on) localStorage.setItem(SHARED_DEVICE_KEY, '1'); else localStorage.removeItem(SHARED_DEVICE_KEY); } catch { /* ignore */ }
}
/**
 * Removes all personal data from this environment's browser storage. May stay:
 * the family list (for the sign-in), device settings and – only if not yet
 * sent – the pending changes, so that nothing is lost.
 */
export function wipePersonalData() {
  const prefix = scopeKey('');
  const keep = new Set([FAMILY_STORE_LS, SHARED_DEVICE_KEY, HEAL_KEY, DEVICE_SALT_KEY].filter(Boolean));
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix) && !keep.has(k)) keys.push(k); }
  } catch { return; }
  for (const k of keys) {
    try {
      if (k.endsWith(':__meta')) {
        const m = JSON.parse(localStorage.getItem(k) || 'null');
        const ops = (m && m.ops) || {};
        if (Object.values(ops).some((l) => Array.isArray(l) && l.length)) { localStorage.setItem(k, JSON.stringify({ revs: {}, ops })); continue; }
      }
      localStorage.removeItem(k);
    } catch { /* a single key does not matter */ }
  }
}
