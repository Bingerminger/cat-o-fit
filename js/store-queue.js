/* =========================================================================
   store-queue.js — the persistent operation queue and the exchange with the server per area: push in
   chunks (only what was sent leaves the queue), apply what the server returns, full resync after
   a restore, writes of other tabs. Layer 5.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { debounce, scopeKey } from './ui.js';
import { isOnline, pullChanges, pushOps, serverHas } from './api-client.js';
import { adoptForeignOps, applyServerRecords, hasPending, mergeIntoUserArea, notify, readMeta, readUserArea, setSyncState, userMetaKey, writeLS, writeMeta, writeUserMeta } from './store-local.js';
import { compactAppend, mergeConservative, retire, stripRev, withOpId } from './store-merge.js';
import { privateAllowed, sessionLost } from './store-session.js';
import { AREAS, LS, PRIVATE_AREAS, PUSH_CHUNK, family, retired, state, vars } from './store-state.js';

/** Appends ops to the active user's queue (compacted, with opId). */
export function queueOps(area, ops) {
  const withIds = ops.map(withOpId);
  vars.pendingOps[area] = compactAppend(vars.pendingOps[area] || [], withIds);
  return withIds;
}

/**
 * Commit a local change as a unit: first the queue, then the area.
 * If either of the two writes fails (device storage full), everything is
 * rolled back – the app never shows "saved" for something that is not secured.
 */
export function commitLocal(area, ops, rollback) {
  const before = (vars.pendingOps[area] || []).slice();
  queueOps(area, ops);
  const beforeIds = new Set(before.map((o) => o.opId));
  const added = (vars.pendingOps[area] || []).filter((o) => !beforeIds.has(o.opId));
  const undo = () => {
    vars.pendingOps[area] = before;
    before.forEach((o) => retired.delete(o.opId));
    // The grown queue may already be on disk: mark its new ops as taken back, or the next
    // writeUserMeta() would adopt them there as another tab's ops and send them after all.
    retire(added);
    rollback();
  };
  if (!writeUserMeta()) { undo(); return false; }
  if (!writeLS(area)) { undo(); writeUserMeta(); return false; }
  schedulePush(area);
  return true;
}

/** Put an op into the ACTIVE user's queue and persist it (without a change to the area). */
export function enqueueOp(area, op) {
  queueOps(area, [op]);
  writeUserMeta();
  schedulePush(area);
}

export const pushers = {};
// Debounce BOUND to the user: a view switch must never dump ops onto the
// wrong user.
export function schedulePush(area, user = vars.activeUser) {
  if (!user) return;
  const key = `${user}|${area}`;
  if (!pushers[key]) pushers[key] = debounce(() => pushArea(area, user), 600);
  pushers[key]();
}

/** Pending ops of a user/area – in memory (active) or in LocalStorage. */
export function queueOf(user, area) {
  return user === vars.activeUser ? (vars.pendingOps[area] || []) : (readMeta(user).ops[area] || []);
}
export const inflight = new Map();   // `${user}|${area}` -> running push

/** Send the pending ops of an area to the server (per user). A second
    call for the same user/area waits for the running one instead of sending twice. */
export function pushArea(area, user) {
  if (!user) return Promise.resolve();
  // The server only accepts private areas from the signed-in person themself –
  // until then the ops stay safely in the queue.
  if (PRIVATE_AREAS.includes(area) && !privateAllowed(user)) return Promise.resolve();
  const key = `${user}|${area}`;
  const running = inflight.get(key);
  if (running) return running.then(() => pushArea(area, user));
  const p = pushAreaNow(area, user)
    .catch((e) => { console.warn('Push failed', e); setSyncState('error'); })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Are there legacy ops without an opId in a user's LocalStorage? */
export function metaLacksOpIds(user) {
  try {
    const raw = JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null');
    return !!(raw && raw.ops && Object.values(raw.ops).some((l) => Array.isArray(l) && l.some((o) => o && !o.opId)));
  } catch { return false; }
}

export async function pushAreaNow(area, user) {
  if (vars.resetting) return;
  let chunk = PUSH_CHUNK;
  for (;;) {
    if (user === vars.activeUser) adoptForeignOps();
    else if (metaLacksOpIds(user) && !writeMeta(user, readMeta(user))) return;  // Permanently give legacy ops an opId
    const ops = queueOf(user, area);
    if (!ops.length) break;
    if (!isOnline()) { setSyncState('offline'); return; }
    const batch = ops.slice(0, chunk);
    setSyncState('syncing');
    // For the active person, fetch all changes since their own mark straight away.
    const since = user === vars.activeUser && serverHas('ops-since') ? (vars.revs[area] || 0) : null;
    let res;
    try {
      res = await pushOps(area, wireOps(area, user, batch), since != null ? { user, since } : { user });
    } catch (e) {
      if (e && e.status === 413 && chunk > 1) { chunk = Math.max(1, Math.floor(chunk / 2)); continue; }
      if (e && (e.status === 401 || e.status === 403) && PRIVATE_AREAS.includes(area)) { sessionLost(); return; }
      setSyncState('error');          // Ops stay in the queue -> again later
      return;
    }
    const sent = new Set(batch.map((o) => o.opId));
    retire(batch);
    // After the await, decide AGAIN where the ops live (the user may have switched).
    // The high-water mark (revs) is deliberately NOT advanced here: the push response
    // carries the global area rev, but contains only our own records. Foreign
    // changes in between would otherwise never arrive at the pull.
    if (user === vars.activeUser) {
      vars.pendingOps[area] = (vars.pendingOps[area] || []).filter((o) => !sent.has(o.opId));
      applyServerRecords(area, res.records);
      writeLS(area); writeUserMeta();
      // If all changes since the mark came along, it may – unlike above – advance.
      if (res.changes && since != null) await applyPull(area, user, res.changes, since);
    } else {
      const m = readMeta(user);
      m.ops[area] = (m.ops[area] || []).filter((o) => !sent.has(o.opId));
      writeMeta(user, m);
      mergeIntoUserArea(user, area, res.records);
    }
  }
  setSyncState(hasPending() ? 'offline' : 'idle');
}

/** Ops as the server understands them: a server without field-wise profile writes (`merge-ops`,
    before v4.2) gets the whole profile instead – the behaviour of v4.1 and earlier. */
export function wireOps(area, user, ops) {
  if (area !== 'profile' || serverHas('merge-ops') || !ops.some((o) => o.op === 'merge')) return ops;
  const full = user === vars.activeUser ? state.profile : (readUserArea(user, 'profile') || {});
  return ops.map((o) => (o.op === 'merge' ? { op: 'upsert', record: stripRev({ ...full, id: 'profile' }), opId: o.opId } : o));
}

/** Write out all pending ops of a user (e.g. before a view switch). */
export async function pushAllAreas(user) {
  for (const area of AREAS) await pushArea(area, user);
}

/** Resend ops of other users (e.g. from a restore) that are still waiting
    in LocalStorage – only for members that still exist. */
export async function pushForeignQueues() {
  const prefix = scopeKey('');
  const users = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix) || !k.endsWith(':__meta')) continue;
      const u = k.slice(prefix.length, -':__meta'.length);
      if (u && u !== vars.activeUser && (family.members || []).some((m) => m.id === u)) users.push(u);
    }
  } catch { return; }
  for (const u of users) {
    const ops = readMeta(u).ops;
    // Private areas of other people wait until they sign in themselves.
    for (const area of Object.keys(ops)) {
      if ((ops[area] || []).length && !PRIVATE_AREAS.includes(area)) await pushArea(area, u);
    }
  }
}

/** Adopt the changes fetched for an area – from the single or the bulk fetch
    or with a push response (`since` = the mark that was sent along). */
export async function applyPull(area, user, res, since) {
  if (vars.activeUser !== user) return;
  // If the server is BELOW the remembered mark, an older state was restored
  // there: then the server state applies, and only our own changes that have
  // not been sent yet are laid on top again.
  if ((res.rev || 0) < since) { await resyncArea(area, user); return; }
  const { changed, visible } = applyServerRecords(area, res.records);
  // Advance the mark only if the state is also secured locally – otherwise the
  // records are missing after a restart although the mark lists them as fetched.
  if (changed && !writeLS(area)) return;
  vars.revs[area] = Math.max(vars.revs[area] || 0, res.rev || 0);
  writeUserMeta();
  const first = vars.fetchedFor[area] !== user;
  vars.fetchedFor[area] = user;
  if (area === 'profile' && vars.profileFetchedFor !== user) {
    vars.profileFetchedFor = user;
    notify(area, 'sync');   // waiting automatic writes (unit defaults) may run now
    return;
  }
  // Redraw only for genuinely new content – not because our own records
  // come back with a server rev (FE-12). The first fetch of an area in this session
  // is announced without a redraw ('fetched'): automatic writes that waited for it
  // (plan volume) may run now.
  if (visible) notify(area, 'sync');
  else if (first) notify(area, 'fetched');
}

/** Full sync of an area (after a restore, or weekly). */
export async function resyncArea(area, user) {
  const full = await pullChanges(area, { user, since: 0 });
  if (vars.activeUser !== user) return;
  if (area === 'profile') {
    const sp = full.records.filter((r) => r.id === 'profile')
      .reduce((best, r) => (!best || (r.rev || 0) > (best.rev || 0) ? r : best), null);
    const lp = state.profile && state.profile.id ? state.profile : null;
    const m = mergeConservative(lp, sp);
    state.profile = m && !m.deleted ? m : (lp || {});
  } else {
    const serverById = new Map(full.records.map((r) => [r.id, r]));
    const seen = new Set();
    const out = [];
    for (const l of state[area]) { out.push(mergeConservative(l, serverById.get(l.id))); seen.add(l.id); }
    for (const s of full.records) if (!seen.has(s.id)) out.push(s);
    state[area] = out;
  }
  if (!writeLS(area)) return;
  vars.revs[area] = full.rev || 0;
  writeUserMeta();
  if (area === 'profile') vars.profileFetchedFor = user;
  vars.fetchedFor[area] = user;
  notify(area, 'sync');
}

/** Put an op into the persistent queue of a (possibly non-active) user. */
export function queueUserOp(user, area, op) {
  if (user === vars.activeUser) { enqueueOp(area, op); return; }
  const m = readMeta(user);
  m.ops[area] = compactAppend(m.ops[area] || [], [withOpId(op)]);
  writeMeta(user, m);
}

/** Adopt changes from another tab of the same user (queue and areas). */
export function onOtherTabWrite(e) {
  if (!vars.activeUser || !e || !e.key) return;
  if (e.key === userMetaKey(vars.activeUser)) {
    const before = JSON.stringify(Object.keys(vars.pendingOps).map((a) => (vars.pendingOps[a] || []).length));
    adoptForeignOps();
    if (JSON.stringify(Object.keys(vars.pendingOps).map((a) => (vars.pendingOps[a] || []).length)) !== before) {
      Object.keys(vars.pendingOps).forEach((a) => { if ((vars.pendingOps[a] || []).length) schedulePush(a); });
    }
    return;
  }
  const area = AREAS.find((a) => e.key === LS(a));
  if (!area || !e.newValue) return;
  let theirs = null;
  try { theirs = JSON.parse(e.newValue); } catch { return; }
  if (area === 'profile') {
    if (theirs && (theirs.rev || 0) > (state.profile.rev || 0)) { state.profile = theirs; notify('profile', 'sync'); }
    return;
  }
  if (!Array.isArray(theirs)) return;
  const byId = new Map(state[area].map((r) => [r.id, r]));
  let changed = false;
  for (const r of theirs) {
    const l = byId.get(r.id);
    if (!l || (r.rev || 0) > (l.rev || 0)) { byId.set(r.id, r); changed = true; }
  }
  if (changed) { state[area] = [...byId.values()]; notify(area, 'sync'); }
}
try { if (typeof window.addEventListener === 'function') window.addEventListener('storage', onOtherTabWrite); } catch { /* without DOM */ }
