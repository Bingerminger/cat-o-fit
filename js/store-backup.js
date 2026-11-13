/* =========================================================================
   store-backup.js — the personal backup and the admin's full family backup. Layer 10.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { nowIso } from './ui.js';
import { t as tr } from './i18n.js';
import { apiGet, isOnline, pullChanges } from './api-client.js';
import { addReport, replaceArea } from './store-data.js';
import { activeMember, familyReplaceFrom, isAdmin, isManaging, pushFamily, syncFamily } from './store-family.js';
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
  for (const m of (family.members || [])) {
    const bucket = {};
    for (const a of areas) {
      const data = await peekUserArea(m.id, a);
      if (data != null) bucket[a] = data;
    }
    dump.users[m.id] = bucket;
  }
  return dump;
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
  //    and wait until the server has them.
  familyReplaceFrom(dump.family);
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
  if (isOnline()) {
    try { return await apiGet(area, { user: userId }); } catch { /* falls back to LS */ }
  }
  const recs = readUserArea(userId, area);
  if (recs == null) return null;
  if (Array.isArray(recs)) return recs.filter((r) => !r.deleted).map(stripRev);
  return stripRev(recs);
}
