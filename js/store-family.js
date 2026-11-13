/* =========================================================================
   store-family.js — the family as a record store (members, settings, pantry, teams), its sync and
   the roles of the signed-in person. Layer 4.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { debounce, nowIso } from './ui.js';
import { isOnline, pullChanges, pushOps, serverError } from './api-client.js';
import { notify, setSyncState, writeFamilyStoreLS } from './store-local.js';
import { contentKey, mergeConservative, stripRev, withOpId } from './store-merge.js';
import { catchUpServerLogin } from './store-session.js';
import { PUSH_CHUNK, family, familyStore, vars } from './store-state.js';

/** Derives the view {members, settings, pantry, teams} from the records. */
export function rebuildFamily() {
  const members = []; let settings = {}; let pantry = []; const teams = [];
  for (const id in familyStore.records) {
    const r = familyStore.records[id];
    if (!r || r.deleted) continue;
    const kind = r._kind || 'member';
    if (kind === 'member') { const m = { ...r }; delete m._kind; delete m.rev; members.push(m); }
    else if (kind === 'settings') { const s = { ...r }; delete s.id; delete s._kind; delete s.rev; delete s.updatedAt; settings = s; }
    else if (kind === 'pantry') { pantry = Array.isArray(r.items) ? r.items.slice() : []; }
    else if (kind === 'team') { const t = { ...r }; delete t._kind; delete t.rev; t.memberIds = Array.isArray(t.memberIds) ? t.memberIds : []; teams.push(t); }
  }
  members.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  teams.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  family.members = members; family.settings = settings; family.pantry = pantry; family.teams = teams;
}

/**
 * Member record for the local storage: PIN hashes have stayed on the server since v3.20.0;
 * locally only `hasPin` is stored. (Older caches still carried the hash.)
 */
export function localFamilyRecord(r) {
  if (!r || (r._kind || 'member') !== 'member' || !('pinHash' in r)) return r;
  const c = { ...r };
  if (c.hasPin === undefined) c.hasPin = !!c.pinHash;
  delete c.pinHash;
  return c;
}
/** Record for a family op: without derived fields. */
export function familyOpRecord(r) { const c = stripRev(r); delete c.hasPin; return c; }

export const familyPusher = debounce(() => pushFamily(), 500);
/** Set a family record locally and send it as an op. `pinHash` (optional) goes only into the
    op – the server accepts it exclusively from an admin session, or during the
    initial setup. */
export function familyUpsert(rec, { pinHash: newPinHash = null } = {}) {
  const r = localFamilyRecord({ ...rec, updatedAt: nowIso() });
  delete r.deleted;
  if (newPinHash) r.hasPin = true;
  familyStore.records[r.id] = r;
  const opRec = familyOpRecord(r);
  if (newPinHash) opRec.pinHash = newPinHash;
  vars.familyOps.push(withOpId({ op: 'upsert', record: opRec }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
export function familyDelete(id) {
  const prev = familyStore.records[id] || {};
  familyStore.records[id] = { id, deleted: true, updatedAt: nowIso(), ...(prev._kind ? { _kind: prev._kind } : {}) };
  vars.familyOps.push(withOpId({ op: 'delete', id }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
/** Set the family authoritatively from a {members, settings, pantry, teams} object.
    If `teams` is missing (full backups before v3.20.0 contained no teams), the
    existing teams are kept instead of being silently deleted. */
export function familyReplaceFrom(fam) {
  const records = {};
  (fam.members || []).forEach((m) => { if (m && m.id) records[m.id] = { ...m, _kind: 'member' }; });
  records['__settings'] = { id: '__settings', _kind: 'settings', ...(fam.settings || {}) };
  records['__pantry'] = { id: '__pantry', _kind: 'pantry', items: Array.isArray(fam.pantry) ? fam.pantry : [] };
  const teamList = fam.teams !== undefined ? (fam.teams || []) : (family.teams || []);
  teamList.forEach((t) => { if (t && t.id) records[t.id] = { ...t, _kind: 'team', memberIds: Array.isArray(t.memberIds) ? t.memberIds : [] }; });
  // PIN hashes from older full backups go only to the server (admin session); if they are
  // missing (backups from v3.20.0), the server keeps the stored PINs.
  const local = {};
  for (const id in records) local[id] = localFamilyRecord(records[id]);
  familyStore.records = local;
  vars.familyOps.push(withOpId({ op: 'replace', records: Object.values(records).map(familyOpRecord) }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}

/** Adopt family records; returns { changed, visible } as with mergeRecords. */
export function applyFamilyServerRecords(records) {
  let changed = false;
  let visible = false;
  for (const sr of (records || [])) {
    const l = familyStore.records[sr.id];
    if (!l || (sr.rev || 0) > (l.rev || 0)) {
      const rec = localFamilyRecord(sr);
      if (!visible && (!l || contentKey(l) !== contentKey(rec))) visible = true;
      familyStore.records[sr.id] = rec;
      changed = true;
    }
  }
  return { changed, visible };
}

/** Family ops rejected by the server (missing admin session): discard the local version
    and fetch the server state at the next sync; the UI is informed. */
export function dropRejectedFamilyOps(rejected) {
  if (!rejected || !rejected.length) return;
  for (const r of rejected) if (r && r.id) delete familyStore.records[r.id];
  familyStore.rev = 0;
  rebuildFamily(); writeFamilyStoreLS();
  try {
    const first = rejected[0] || {};
    window.dispatchEvent(new CustomEvent('catofit:ops-rejected', { detail: { count: rejected.length, reason: serverError({ code: first.code, error: first.reason }) } }));
  } catch { /* without DOM */ }
}

/** Send family ops. As with the user areas: remove only the ops that were sent (by opId)
    and do NOT take over the mark from the push response (only on pull). */
export function pushFamily() {
  if (vars.familyPushInflight) return vars.familyPushInflight.then(() => pushFamily());
  vars.familyPushInflight = pushFamilyNow().finally(() => { vars.familyPushInflight = null; });
  return vars.familyPushInflight;
}
export async function pushFamilyNow() {
  vars.familyOps = vars.familyOps.map(withOpId);
  if (!vars.familyOps.length) return;
  if (!isOnline()) { setSyncState('offline'); return; }
  // The server needs admin changes with a session – first catch up on a sign-in that was begun offline.
  if (vars.pendingServerPin) { try { await catchUpServerLogin(); } catch { /* ignore */ } }
  const batch = vars.familyOps.slice(0, PUSH_CHUNK);
  try {
    const res = await pushOps('family', batch, { scope: 'family' });
    const sent = new Set(batch.map((o) => o.opId));
    vars.familyOps = vars.familyOps.filter((o) => !sent.has(o.opId));
    const { visible } = applyFamilyServerRecords(res.records);
    const rejected = !!(res.rejected && res.rejected.length);
    dropRejectedFamilyOps(res.rejected);
    rebuildFamily(); writeFamilyStoreLS();
    // The response contains our own, already displayed records – a redraw happens
    // only if the server stored or rejected something differently (FE-12).
    if (visible || rejected) { notify('family', 'sync'); notify('pantry', 'sync'); }
    if (vars.familyOps.length) await pushFamilyNow();
  } catch { setSyncState('error'); }
}

/** Sync the family: push own ops, then pull changes. */
export async function syncFamily() {
  try {
    if (vars.familyOps.length) await pushFamily();
    const since = familyStore.rev || 0;
    const res = await pullChanges('family', { scope: 'family', since });
    if ((res.rev || 0) < since) {
      const full = await pullChanges('family', { scope: 'family', since: 0 });
      // Server completely empty (newly set up or reset, e.g. the ACC or TEST environment)
      // and nothing unsent on the device: the cache is outdated – adopt the server state.
      // Otherwise the sign-in shows profiles the server does not know ("This profile does not
      // exist (any more)."), and the initial setup never appears.
      if (!(full.records || []).some((r) => r && !r.deleted) && !vars.familyOps.length) {
        adoptServerFamily(full);
        return;
      }
      // Server state restored from a backup: merge carefully (delete nothing locally).
      const merged = {};
      for (const id in familyStore.records) merged[id] = familyStore.records[id];
      const serverById = new Map(full.records.map((r) => [r.id, r]));
      for (const id in merged) merged[id] = mergeConservative(merged[id], serverById.get(id));
      for (const r of full.records) if (!merged[r.id]) merged[r.id] = r;
      familyStore.records = merged;
      familyStore.rev = full.rev || 0;
      rebuildFamily(); writeFamilyStoreLS();
      notify('family', 'sync'); notify('pantry', 'sync');
      return;
    }
    const { changed, visible } = applyFamilyServerRecords(res.records);
    familyStore.rev = Math.max(familyStore.rev || 0, res.rev || 0);
    if (changed) { rebuildFamily(); }
    writeFamilyStoreLS();
    if (visible) { notify('family', 'sync'); notify('pantry', 'sync'); }
  } catch { /* offline -> again later */ }
}

/** Adopt the server's family state completely (the server is authoritative; call only without
    unsent family changes). If it is empty, the store remembers that for the
    notice in the initial setup. */
export function adoptServerFamily(full) {
  const recs = {};
  for (const r of (full.records || [])) if (r && r.id) recs[r.id] = localFamilyRecord(r);
  familyStore.records = recs;
  familyStore.rev = full.rev || 0;
  vars.serverReset = !Object.values(recs).some((r) => !r.deleted && (r._kind || 'member') === 'member');
  rebuildFamily(); writeFamilyStoreLS();
  notify('family', 'sync'); notify('pantry', 'sync');
}
/** Was an empty (newly set up or reset) server detected during the sync? */
export function serverWasReset() { return vars.serverReset && !(family.members || []).length; }

/** Family-wide data (members, roles, settings, pantry). */
export function getFamily() { return family; }
export function members() { return family.members || []; }
export function familySettings() { return family.settings || {}; }
export function activeUserId() { return vars.activeUser; }
export function activeMember() { return (family.members || []).find((m) => m.id === vars.activeUser) || null; }

/** Actively reload the family (for the self-healing login/team view). */
export async function refreshFamily() {
  if (isOnline()) await syncFamily();
  return family.members || [];
}

/**
 * Set the family (seeding/bulk). `members` (if given) is the authoritative
 * member list, `settings`/`pantry` are set if given.
 */
export function saveFamily(fields) {
  if (Array.isArray(fields.members)) {
    const keep = new Set(fields.members.map((m) => m.id));
    fields.members.forEach((m) => familyUpsert({ ...m, _kind: 'member' }));
    for (const id in familyStore.records) {
      const r = familyStore.records[id];
      if ((r._kind || 'member') === 'member' && !r.deleted && !keep.has(id)) familyDelete(id);
    }
  }
  if (fields.settings !== undefined) familyUpsert({ id: '__settings', _kind: 'settings', ...fields.settings });
  if (fields.pantry !== undefined) familyUpsert({ id: '__pantry', _kind: 'pantry', items: Array.isArray(fields.pantry) ? fields.pantry : [] });
  // Teams: set/tidy up again on an authoritative member reset (or if `teams` is given).
  if (fields.teams !== undefined || Array.isArray(fields.members)) {
    const keepT = new Set((fields.teams || []).map((t) => t.id));
    (fields.teams || []).forEach((t) => familyUpsert({ ...t, _kind: 'team', memberIds: Array.isArray(t.memberIds) ? t.memberIds : [] }));
    for (const id in familyStore.records) {
      const r = familyStore.records[id];
      if (r._kind === 'team' && !r.deleted && !keepT.has(id)) familyDelete(id);
    }
  }
  return family;
}

export function familyPantry() { return family.pantry || []; }
export function setFamilyPantry(list) {
  familyUpsert({ id: '__pantry', _kind: 'pantry', items: Array.isArray(list) ? list : [] });
  notify('pantry', 'local');
  return family.pantry;
}

export function identityId() { return vars.identity; }
export function identityMember() { return (family.members || []).find((m) => m.id === vars.identity) || null; }
export function isAdmin() { const m = identityMember(); return !!(m && m.role === 'admin'); }
export function isViewingSelf() { return vars.identity != null && vars.identity === vars.activeUser; }
export function isManaging() { return vars.identity != null && vars.activeUser != null && vars.identity !== vars.activeUser; }
