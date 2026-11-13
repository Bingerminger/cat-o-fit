/* =========================================================================
   store-backup.js — the personal backup and the admin's full family backup. Layer 10.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { nowIso } from './ui.js';
import { t as tr } from './i18n.js';
import { apiGet, isOnline, pullAllChanges, pullChanges, serverHas } from './api-client.js';
import { addReport, replaceArea } from './store-data.js';
import { activeMember, familyReplaceFrom, identityMember, isAdmin, isManaging, pushFamily, syncFamily } from './store-family.js';
import { loadUserFromLS, notify, readUserArea, writeUserArea } from './store-local.js';
import { stripRev, withOpId } from './store-merge.js';
import { commitLocal, pushArea, queueOf, queueUserOp } from './store-queue.js';
import { AREAS, ARRAY_AREAS, PRIVATE_AREAS, SEALED_AREAS, family, state, vars } from './store-state.js';

export const EXPORT_VERSION = 1;

export function exportAll() {
  const m = activeMember();
  const managing = isManaging();
  const dump = {
    app: 'catofit', version: EXPORT_VERSION, exportedAt: nowIso(),
    user: vars.activeUser || null, userName: (m && m.name) || null,
  };
  AREAS.forEach((a) => {
    if (managing && PRIVATE_AREAS.includes(a)) return;
    // Raw data (without the reading reinterpretation): the backup returns exactly what is stored.
    dump[a] = a === 'profile' ? stripRev({ ...state.profile }) : (state[a] || []).filter((r) => !r.deleted).map(stripRev);
  });
  return dump;
}

/** Restores a personal backup (for the active user, authoritative). */
export function importAll(dump) {
  if (!dump || typeof dump !== 'object' || Array.isArray(dump)) throw new Error(tr('storage.backupInvalid'));
  if (dump.app != null && dump.app !== 'catofit') throw new Error(tr('storage.notFromApp'));
  if (typeof dump.version === 'number' && dump.version > EXPORT_VERSION) throw new Error(tr('storage.backupNewer'));
  const imported = [];
  const skipped = [];
  const privateSkipped = [];
  const managing = isManaging();
  AREAS.forEach((a) => {
    if (dump[a] == null) return;
    const wantArray = ARRAY_AREAS.includes(a);
    const val = dump[a];
    const okType = wantArray ? Array.isArray(val) : (typeof val === 'object' && !Array.isArray(val));
    if (!okType) { skipped.push(a); return; }
    // Private areas of a managed member stay untouched – mirroring
    // the export, which also leaves them out when managing.
    if (managing && PRIVATE_AREAS.includes(a)) { privateSkipped.push(a); return; }
    if (a === 'profile') {
      const prev = state.profile;
      state.profile = { ...val, id: 'profile', updatedAt: nowIso() };
      if (!commitLocal('profile', [{ op: 'upsert', record: stripRev(state.profile) }], () => { state.profile = prev; })) { skipped.push(a); return; }
      notify('profile', 'local');
    } else if (SEALED_AREAS.includes(a)) {
      // Sealed (certificates/reports): only add what is missing – replace or delete nothing.
      const have = new Set((state[a] || []).map((r) => r.id));
      val.filter((r) => r && r.id && !have.has(r.id)).forEach((r) => addReport(r));
    } else if (!replaceArea(a, val)) {
      skipped.push(a); return;
    }
    imported.push(a);
  });
  return { imported, skipped, privateSkipped, user: dump.user || null, userName: dump.userName || null };
}

export const FULL_EXPORT_VERSION = 1;
export function fullBackupAreas() { return AREAS.filter((a) => !PRIVATE_AREAS.includes(a)); }

/** Complete family backup (admin only) – without private cycle data. */
export async function exportFamilyAll() {
  if (!isAdmin()) throw new Error(tr('storage.fullExportAdminOnly'));
  if (isOnline()) await syncFamily();   // Fetch the member list fresh
  const dump = {
    app: 'catofit', kind: 'family-full', version: FULL_EXPORT_VERSION, exportedAt: nowIso(),
    family: {
      members: family.members.map((x) => ({ ...x })), settings: { ...family.settings },
      pantry: family.pantry.map((x) => ({ ...x })), teams: (family.teams || []).map((t) => ({ ...t })),
    },
    users: {},
  };
  const areas = fullBackupAreas();
  // Since 4.2 one request per member (BACKUP_PARALLEL at a time) instead of one per member and area;
  // the order of the members in the file stays the family's order.
  const list = family.members || [];
  const buckets = new Array(list.length);
  const gaps = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < list.length; i = next++) buckets[i] = await memberBucket(list[i].id, areas, gaps);
  };
  await Promise.all(Array.from({ length: Math.min(BACKUP_PARALLEL, list.length) }, worker));
  list.forEach((m, i) => { dump.users[m.id] = buckets[i]; });
  // Areas the server did not hand out: taken from this device's copy (maybe older) or missing – said in
  // the file and to the admin, not silently (since 4.2).
  if (gaps.length) dump.incomplete = gaps;
  return dump;
}

/** How many members the full backup fetches at the same time. */
export const BACKUP_PARALLEL = 4;

/** The backup areas of one member: in one request if the server can, otherwise area by area.
    `gaps` collects the areas that did not come from the server ({user, area, from: 'device'|'missing'}). */
async function memberBucket(userId, areas, gaps = []) {
  const bulk = await peekUserAreas(userId, areas);
  if (bulk) return bulk;
  const bucket = {};
  for (const a of areas) {
    const { data, from } = await peekUserAreaFrom(userId, a);
    if (data != null) bucket[a] = data;
    if (from !== 'server') gaps.push({ user: userId, area: a, from: data != null ? 'device' : 'missing' });
  }
  return bucket;
}

/**
 * Logical view of several areas of a member in ONE request (server with `changes-all`): the same as
 * peekUserArea per area – lists without tombstones and revs, the profile without rev and id. Only the
 * given areas are asked for (the full backup never names the private ones). null = the server cannot
 * do that or did not answer; the caller then asks area by area.
 */
export async function peekUserAreas(userId, areas) {
  if (!isOnline() || !serverHas('changes-all')) return null;
  let res;
  try { res = await pullAllChanges(userId, Object.fromEntries(areas.map((a) => [a, 0]))); } catch { return null; }
  if (areas.some((a) => res.revs[a] == null)) return null;   // an area the server did not hand out
  const out = {};
  for (const a of areas) {
    const recs = res.changes[a] || [];
    if (a === 'profile') {
      const p = recs.filter((r) => r.id === 'profile').reduce((best, r) => (!best || (r.rev || 0) > (best.rev || 0) ? r : best), null);
      const view = p && !p.deleted ? stripRev(p) : {};
      delete view.id;
      out[a] = view;
    } else {
      out[a] = recs.filter((r) => !r.deleted).map(stripRev);
    }
  }
  return out;
}

/** Restores a complete family backup (admin only, authoritative). */
export async function importFamilyAll(dump) {
  if (!isAdmin()) throw new Error(tr('storage.fullImportAdminOnly'));
  if (!dump || typeof dump !== 'object' || dump.app !== 'catofit' || dump.kind !== 'family-full'
      || !dump.family || !Array.isArray(dump.family.members) || typeof dump.users !== 'object') {
    throw new Error(tr('storage.fullBackupInvalid'));
  }
  if (typeof dump.version === 'number' && dump.version > FULL_EXPORT_VERSION) throw new Error(tr('storage.fullBackupNewer'));
  if (!dump.family.members.some((m) => m && m.role === 'admin')) throw new Error(tr('storage.fullBackupNoAdmin'));

  const areas = fullBackupAreas();
  let usersRestored = 0; let areasRestored = 0;

  // 1) Replace the family authoritatively (members/settings/pantry/teams as records)
  //    and wait until the server has them. The admin who restores stays a member (with their PIN, which
  //    the server keeps for an ID it knows) even if the backup comes from another server: otherwise they
  //    would lock themself out, and nobody could set the restored members' PINs.
  const me = identityMember();
  const family = me && !dump.family.members.some((m) => m && m.id === me.id)
    ? { ...dump.family, members: [...dump.family.members, { ...me, role: 'admin' }] }
    : dump.family;
  familyReplaceFrom(family);
  if (isOnline()) { try { await pushFamily(); } catch { /* stays in the queue */ } }

  // 2) Prepare one authoritative replace op per member and area.
  const jobs = [];
  for (const id of Object.keys(dump.users || {})) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
    const bucket = dump.users[id] || {};
    let touched = false;
    for (const a of areas) {
      if (bucket[a] == null) continue;
      const wantArray = ARRAY_AREAS.includes(a);
      const okType = wantArray ? Array.isArray(bucket[a]) : (typeof bucket[a] === 'object' && !Array.isArray(bucket[a]));
      if (!okType) continue;
      const records = a === 'profile' ? [{ ...bucket[a], id: 'profile' }] : bucket[a].map((r) => ({ ...r }));
      writeUserArea(id, a, a === 'profile' ? records[0] : records);
      jobs.push({ id, a, op: withOpId({ op: 'replace', records: records.map(stripRev) }) });
      areasRestored++; touched = true;
    }
    if (touched) usersRestored++;
  }
  // Bring the own (active) view to the restored state straight away – otherwise
  // the following push would write the old stored state over the restore.
  if (vars.activeUser && jobs.some((j) => j.id === vars.activeUser)) loadUserFromLS();

  // 3) Remember the server state per area (baseRev): if a replacement is sent only
  //    later, it overwrites nothing that the member has meanwhile recorded themself.
  if (isOnline()) {
    await Promise.allSettled(jobs.map(async (j) => {
      const r = await pullChanges(j.a, { user: j.id, since: Number.MAX_SAFE_INTEGER });
      j.op.baseRev = r.rev || 0;
    }));
  }

  // 4) First put into the queues durably, then send and wait for the server.
  //    "Restored" only applies once the server has confirmed; the rest is
  //    submitted later (pushForeignQueues at the next sync).
  jobs.forEach((j) => queueUserOp(j.id, j.a, j.op));
  if (isOnline()) await Promise.allSettled(jobs.map((j) => pushArea(j.a, j.id)));
  const pending = jobs.filter((j) => queueOf(j.id, j.a).some((o) => o.opId === j.op.opId)).length;

  // 5) Reload the current view (private areas are kept – never in the full backup).
  if (vars.activeUser) { loadUserFromLS(); AREAS.forEach((a) => notify(a, 'local')); }
  return { users: usersRestored, areas: areasRestored, pending };
}

/** Logical view of an area of any member (read-only). */
export async function peekUserArea(userId, area) {
  return (await peekUserAreaFrom(userId, area)).data;
}

/** The same, with where it came from: `from` 'server' or 'device' (the copy on this device, maybe older). */
async function peekUserAreaFrom(userId, area) {
  if (isOnline()) {
    try { return { data: await apiGet(area, { user: userId }), from: 'server' }; } catch { /* falls back to LS */ }
  }
  const recs = readUserArea(userId, area);
  if (recs == null) return { data: null, from: 'device' };
  if (Array.isArray(recs)) return { data: recs.filter((r) => !r.deleted).map(stripRev), from: 'device' };
  return { data: stripRev(recs), from: 'device' };
}
