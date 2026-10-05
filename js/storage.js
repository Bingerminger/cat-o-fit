/* =========================================================================
   storage.js — central "local-first" store (server-authoritative, v3.0.0).

   Model (option B):
   - Write locally and optimistically (immediately, offline-capable) and put every
     change into a persistent queue as an OPERATION (upsert/delete/replace).
   - The SERVER is the merge authority: it applies ops and assigns a strictly
     monotonic `rev` per record (no dependence on the device clock).
   - Sync per area: first PUSH our own ops (so that local edits get a rev), then
     PULL the changes since the known rev. A pull only wins if the server `rev`
     is higher – concurrent edits to different records are never lost.
   - Deletions are tombstones (deleted:true) with their own rev.
   - The family is a collection of records (member per id, __settings,
     __pantry) -> members merge PER MEMBER (no more silent loss).

   The public store API stays unchanged -> views need no adjustment.
   ========================================================================= */

import {
  pushOps, pullChanges, pullAllChanges, serverHas, apiGet, isOnline, onStatus, ping, REACH_TIMEOUT, deleteUserData,
  serverLogin, serverLogout, serverSession, serverSetPin, serverError,
} from './api-client.js';
import { uid, nowIso, debounce, todayStr, addDays, weekStartMonday, diffDays, scopeKey } from './ui.js';
import { sha256Hex } from './sha256.js';
import { migrateHealth } from './healthdata.js';
import { migrateLabs } from './labs.js';
import { migratePlans } from './program.js';
import { locale, t as tr } from './i18n.js';

const AREAS = ['profile', 'events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
const ARRAY_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
// Sealed areas: append-only, cannot be edited or deleted (e.g. certificates/reports).
const SEALED_AREAS = ['reports'];
// All keys are environment-unique (scopeKey), so that production and acceptance on the
// same origin do NOT share their storage (otherwise "duplicate users").
const IDENTITY_KEY = scopeKey('identity');  // LEGACY (before v3.2.0): permanently remembered user – is only discarded now
const SESSION_KEY = scopeKey('session');    // Sign-in of THIS browser session (sessionStorage): survives reloads, not an app restart
const FAMILY_STORE_LS = scopeKey('familyStore');

let identity = null;                        // signed-in person (roles + cycle privacy)
let activeUser = null;                      // user currently being viewed (controls the data display)
const LS = (area) => scopeKey(`${activeUser}:${area}`);

// Server session (since v3.20.0): the server only hands out the private areas to the
// signed-in person themself. `serverUser` = the person for whom this browser, to our
// knowledge, has a valid session.
let serverUser = null;
let pendingServerPin = null;                // after an offline sign-in: catch up on the server later
let sessionAsked = false;                   // PIN prompt without a server session: once per page load
let lastLoginErr = null;

const state = {
  profile: {},
  events: [], plans: [], sessions: [], health: [],
  nutrition: [], shopping: [], checklist: [], cycle: [], reports: [], diary: [],
  labs: [], supplements: [],
};
let revs = {};          // area -> last seen server rev (high-water mark)
let pendingOps = {};    // area -> pending ops of the active user

// Family as a record store + derived view.
const familyStore = { rev: 0, records: {} };
let familyOps = [];
const family = { members: [], settings: {}, pantry: [] };

const syncListeners = new Set();
let syncState = 'idle'; // idle | syncing | offline | error

/* ----------------------------- LocalStorage ----------------------------- */
// Every write reports whether it succeeded. A full quota
// (QuotaExceededError) is never swallowed silently: the change is rolled back
// and the UI shows a notice (event 'catofit:storage-full').
let storageFullAt = 0;
function reportStorageFull(e) {
  console.warn('Device storage full?', e);
  setSyncState('full');
  const now = Date.now();
  if (now - storageFullAt < 3000) return;          // not for every single write
  storageFullAt = now;
  try { window.dispatchEvent(new Event('catofit:storage-full')); } catch { /* without DOM */ }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { reportStorageFull(e); return false; }
}
function readLS(area) {
  try { const raw = localStorage.getItem(LS(area)); return raw == null ? null : JSON.parse(raw); } catch { return null; }
}
function writeLS(area) { return safeSet(LS(area), JSON.stringify(state[area])); }
function userMetaKey(user) { return scopeKey(`${user}:__meta`); }
function writeUserMeta() {
  if (!activeUser) return true;
  adoptForeignOps();   // Take over ops from other tabs before the queue is overwritten
  return safeSet(userMetaKey(activeUser), JSON.stringify({ revs, ops: pendingOps }));
}
function readUserArea(user, area) { try { return JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { return null; } }
function writeUserArea(user, area, val) { return safeSet(scopeKey(`${user}:${area}`), JSON.stringify(val)); }
function readMeta(user) {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null'); } catch { /* ignore */ }
  m = m || { revs: {}, ops: {} };
  m.revs = m.revs || {};
  m.ops = normalizeOps(m.ops);
  return m;
}
function writeMeta(user, m) { return safeSet(userMetaKey(user), JSON.stringify(m)); }

/* ------------------------------- Merge ---------------------------------- */
function stripRev(r) { const c = { ...r }; delete c.rev; return c; }

/** Content of a record without the fields the server sets on saving
    (rev, updatedAt) – keys sorted so that the order does not matter. */
function contentKey(r) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {})
      : v);
  const c = { ...(r || {}) };
  delete c.rev; delete c.updatedAt;
  return JSON.stringify(canon(c));
}

/**
 * Merge server records into a local record list: the higher rev wins.
 * `changed`: at least one version was adopted (must be saved);
 * `visible`: content really changed in the process. If only our own, already
 * known records come back with a new rev, no view needs to redraw (FE-12).
 */
function mergeRecords(arr, serverRecords) {
  const byId = new Map((arr || []).map((r) => [r.id, r]));
  let changed = false;
  let visible = false;
  for (const sr of serverRecords) {
    const l = byId.get(sr.id);
    if (!l || (sr.rev || 0) > (l.rev || 0)) {
      if (!visible && (!l || contentKey(l) !== contentKey(sr))) visible = true;
      byId.set(sr.id, sr);
      changed = true;
    }
  }
  return { records: [...byId.values()], changed, visible };
}

/** Adopt server records into the state of the ACTIVE user ({ changed, visible }
    as with mergeRecords). */
function applyServerRecords(area, records) {
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

/* ----------------------------- Notifications ---------------------------- */
export function onSync(cb) { syncListeners.add(cb); return () => syncListeners.delete(cb); }
function notify(area, origin) { syncListeners.forEach((cb) => cb(area, origin)); }

function hasPending() {
  for (const a in pendingOps) {
    if (!(pendingOps[a] || []).length) continue;
    // Private areas of another person deliberately wait for that person's own sign-in –
    // this is not a connection problem and must not show "Offline" permanently.
    if (PRIVATE_AREAS.includes(a) && activeUser !== identity) continue;
    return true;
  }
  return familyOps.length > 0;
}
function setSyncState(s) {
  if (syncState === s) return;
  syncState = s;
  const ind = document.getElementById('sync-indicator');
  if (ind) {
    ind.dataset.state = s;
    ind.hidden = (s === 'idle');
    const label = { syncing: tr('storage.syncing'), offline: tr('storage.offline'), error: tr('storage.syncError'), full: tr('storage.full') }[s] || '';
    ind.innerHTML = `<span class="sync-indicator__dot"></span><span>${label}</span>`;
  }
}

/* ------------------------------ Op queue/push --------------------------- */
// Every op carries a unique `opId`. After a push exactly the ops that were sent are
// removed – not "the first n" –, even if the queue has changed in the meantime
// (user switch, second tab, compaction). The server ignores the field.
function withOpId(op) { return op && op.opId ? op : { ...op, opId: uid('op') }; }
function normalizeOps(opsByArea) {
  const out = {};
  for (const a in (opsByArea || {})) out[a] = (Array.isArray(opsByArea[a]) ? opsByArea[a] : []).map(withOpId);
  return out;
}
// opIds that this tab has taken out of the queue (confirmed, compacted), and ops that
// it has taken over from another tab.
const retired = new Set();
const adopted = new Set();
function retire(ops) {
  for (const o of ops) if (o && o.opId) { retired.add(o.opId); adopted.delete(o.opId); }
  if (retired.size > 20000) { const keep = [...retired].slice(-10000); retired.clear(); keep.forEach((id) => retired.add(id)); }
}
function opRecordId(o) { return o.op === 'upsert' ? (o.record && o.record.id) : (o.op === 'delete' ? o.id : null); }

/** Compacts on append: a replace op supersedes everything before it; an upsert/
    delete op supersedes older ops on the same record (after the last replace op). */
function compactAppend(list, newOps) {
  let base = list;
  let adds = newOps;
  const lastRep = newOps.map((o) => o.op).lastIndexOf('replace');
  if (lastRep >= 0) { retire(base); base = []; adds = newOps.slice(lastRep); }
  let lastReplace = -1;
  base.forEach((o, i) => { if (o.op === 'replace') lastReplace = i; });
  const ids = new Set(adds.map(opRecordId).filter((x) => x != null));
  const kept = []; const dropped = [];
  base.forEach((o, i) => { if (i > lastReplace && ids.has(opRecordId(o))) dropped.push(o); else kept.push(o); });
  // Among the new ops, too, keep only the last one per record.
  const lastIdx = new Map();
  adds.forEach((o, i) => { const id = opRecordId(o); if (id != null) lastIdx.set(id, i); });
  const addsKept = adds.filter((o, i) => { const id = opRecordId(o); return id == null || lastIdx.get(id) === i || o.op === 'replace'; });
  retire(dropped);
  return [...kept, ...addsKept];
}

/** Appends ops to the active user's queue (compacted, with opId). */
function queueOps(area, ops) {
  const withIds = ops.map(withOpId);
  pendingOps[area] = compactAppend(pendingOps[area] || [], withIds);
  return withIds;
}

/**
 * Commit a local change as a unit: first the queue, then the area.
 * If either of the two writes fails (device storage full), everything is
 * rolled back – the app never shows "saved" for something that is not secured.
 */
function commitLocal(area, ops, rollback) {
  const before = (pendingOps[area] || []).slice();
  queueOps(area, ops);
  const undo = () => {
    pendingOps[area] = before;
    before.forEach((o) => retired.delete(o.opId));
    rollback();
  };
  if (!writeUserMeta()) { undo(); return false; }
  if (!writeLS(area)) { undo(); writeUserMeta(); return false; }
  schedulePush(area);
  return true;
}

/** Put an op into the ACTIVE user's queue and persist it (without a change to the area). */
function enqueueOp(area, op) {
  queueOps(area, [op]);
  writeUserMeta();
  schedulePush(area);
}

const pushers = {};
// Debounce BOUND to the user: a view switch must never dump ops onto the
// wrong user.
function schedulePush(area, user = activeUser) {
  if (!user) return;
  const key = `${user}|${area}`;
  if (!pushers[key]) pushers[key] = debounce(() => pushArea(area, user), 600);
  pushers[key]();
}

/** Pending ops of a user/area – in memory (active) or in LocalStorage. */
function queueOf(user, area) {
  return user === activeUser ? (pendingOps[area] || []) : (readMeta(user).ops[area] || []);
}

// The server accepts at most 2000 ops per request. Sending happens in chunks; after
// each confirmed chunk the queue is shortened. A 413 halves the chunk size.
const PUSH_CHUNK = 500;
const inflight = new Map();   // `${user}|${area}` -> running push

/** Send the pending ops of an area to the server (per user). A second
    call for the same user/area waits for the running one instead of sending twice. */
function pushArea(area, user) {
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
function metaLacksOpIds(user) {
  try {
    const raw = JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null');
    return !!(raw && raw.ops && Object.values(raw.ops).some((l) => Array.isArray(l) && l.some((o) => o && !o.opId)));
  } catch { return false; }
}

async function pushAreaNow(area, user) {
  let chunk = PUSH_CHUNK;
  for (;;) {
    if (user === activeUser) adoptForeignOps();
    else if (metaLacksOpIds(user) && !writeMeta(user, readMeta(user))) return;  // Permanently give legacy ops an opId
    const ops = queueOf(user, area);
    if (!ops.length) break;
    if (!isOnline()) { setSyncState('offline'); return; }
    const batch = ops.slice(0, chunk);
    setSyncState('syncing');
    // For the active person, fetch all changes since their own mark straight away.
    const since = user === activeUser && serverHas('ops-since') ? (revs[area] || 0) : null;
    let res;
    try {
      res = await pushOps(area, batch, since != null ? { user, since } : { user });
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
    if (user === activeUser) {
      pendingOps[area] = (pendingOps[area] || []).filter((o) => !sent.has(o.opId));
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

/** Merge server records into the stored area of a (non-active) user. */
function mergeIntoUserArea(user, area, records) {
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

/** Write out all pending ops of a user (e.g. before a view switch). */
async function pushAllAreas(user) {
  for (const area of AREAS) await pushArea(area, user);
}

/** Take over ops that another tab of the same user has put into the queue, and
    discard taken-over ops that this tab has meanwhile sent itself. */
function adoptForeignOps() {
  if (!activeUser) return;
  let disk = null;
  try { disk = JSON.parse(localStorage.getItem(userMetaKey(activeUser)) || 'null'); } catch { return; }
  const diskOps = (disk && disk.ops) || {};
  const areas = new Set([...Object.keys(diskOps), ...Object.keys(pendingOps)]);
  for (const area of areas) {
    const onDisk = new Set((diskOps[area] || []).map((o) => o && o.opId).filter(Boolean));
    let list = pendingOps[area] || [];
    // Do not send again taken-over ops that the other tab has already dealt with.
    const stale = list.filter((o) => adopted.has(o.opId) && !onDisk.has(o.opId));
    if (stale.length) { const s = new Set(stale.map((o) => o.opId)); list = list.filter((o) => !s.has(o.opId)); stale.forEach((o) => adopted.delete(o.opId)); }
    const mine = new Set(list.map((o) => o.opId));
    const extra = (diskOps[area] || []).filter((o) => o && o.opId && !mine.has(o.opId) && !retired.has(o.opId));
    if (extra.length) { extra.forEach((o) => adopted.add(o.opId)); list = [...list, ...extra]; }
    if (stale.length || extra.length) pendingOps[area] = list;
  }
}

/** Resend ops of other users (e.g. from a restore) that are still waiting
    in LocalStorage – only for members that still exist. */
async function pushForeignQueues() {
  const prefix = scopeKey('');
  const users = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix) || !k.endsWith(':__meta')) continue;
      const u = k.slice(prefix.length, -':__meta'.length);
      if (u && u !== activeUser && (family.members || []).some((m) => m.id === u)) users.push(u);
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

/* -------------------------------- Reading --------------------------------- */
/** Visible entries of an area (without tombstones). Body, lab and plan data
    are reinterpreted on reading (fat-free mass, HRV measurement type, magnesium form,
    default prefill, field names of old programme sessions) – nothing is
    saved in the process; the backup exports the raw data. */
export function get(area) {
  if (area === 'profile') return state.profile;
  if (!areaAllowed(area)) return [];   // do NOT hand out private areas (cycle) when managing other members
  const live = (state[area] || []).filter((r) => !r.deleted);
  if (area === 'health') return migrateHealth(live);
  if (area === 'labs') return migrateLabs(live);
  if (area === 'plans') return migratePlans(live);
  return live;
}
/** Raw including tombstones (for persistence/debugging). */
export function getRaw(area) { return state[area]; }
export function find(area, id) { return (state[area] || []).find((r) => r.id === id && !r.deleted) || null; }
export function profile() { return state.profile; }
export function settings() { return state.profile.settings || {}; }

// Open Food Facts (adding nutritional values online): profiles created from v3.20.0 start
// as "off" (opt-in) – existing ones keep their previous state (the default was "on").
const FOOD_LOOKUP_OPT_IN_SINCE = '2026-09-28';
export function foodLookupEnabled() {
  const s = settings();
  if (typeof s.foodLookup === 'boolean') return s.foodLookup;
  const m = (family.members || []).find((x) => x.id === activeUser);
  return !!(m && m.createdAt && String(m.createdAt) < FOOD_LOOKUP_OPT_IN_SINCE);
}

/* ------------------------------- Writing ------------------------------ */
/** Inserts a record or replaces it (by id). */
export function upsert(area, record) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Area “${area}” is sealed – addReport only.`); return record; }
  if (!record.id) record.id = uid(area.slice(0, 3));
  record.updatedAt = nowIso();
  if (!record.createdAt) record.createdAt = record.updatedAt;
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === record.id);
  const prev = i >= 0 ? arr[i] : undefined;
  if (i >= 0) arr[i] = record; else arr.push(record);
  const ok = commitLocal(area, [{ op: 'upsert', record: stripRev(record) }], () => {
    const j = state[area].indexOf(record);
    if (j >= 0) { if (prev) state[area][j] = prev; else state[area].splice(j, 1); }
  });
  if (ok) notify(area, 'local');
  return record;
}

/**
 * Insert/replace several records in ONE write (e.g. imports with
 * thousands of days). Returns the saved records (empty if the
 * device storage was full – then nothing has changed).
 */
export function upsertMany(area, records) {
  if (SEALED_AREAS.includes(area) || !Array.isArray(records) || !records.length) return [];
  const now = nowIso();
  const prevArr = state[area];
  const arr = prevArr.slice();
  const index = new Map(arr.map((r, i) => [r.id, i]));
  const out = [];
  for (const rec of records) {
    const r = { ...rec, id: rec.id || uid(area.slice(0, 3)), updatedAt: now };
    if (!r.createdAt) r.createdAt = now;
    const i = index.get(r.id);
    if (i != null) arr[i] = r; else { index.set(r.id, arr.length); arr.push(r); }
    out.push(r);
  }
  state[area] = arr;
  const ok = commitLocal(area, out.map((r) => ({ op: 'upsert', record: stripRev(r) })), () => { state[area] = prevArr; });
  if (!ok) return [];
  notify(area, 'local');
  return out;
}

/** Updates fields of a record. */
export function patch(area, id, fields) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Area “${area}” is sealed – not editable.`); return null; }
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const prev = arr[i];
  const next = { ...prev, ...fields, updatedAt: nowIso() };
  arr[i] = next;
  const ok = commitLocal(area, [{ op: 'upsert', record: stripRev(next) }], () => {
    const j = state[area].indexOf(next);
    if (j >= 0) state[area][j] = prev;
  });
  if (!ok) return null;
  notify(area, 'local');
  return next;
}

/** Soft delete (tombstone). */
export function remove(area, id) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Area “${area}” is sealed – cannot be deleted.`); return; }
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return;
  const prev = arr[i];
  const next = { ...prev, deleted: true, updatedAt: nowIso() };
  arr[i] = next;
  const ok = commitLocal(area, [{ op: 'delete', id }], () => {
    const j = state[area].indexOf(next);
    if (j >= 0) state[area][j] = prev;
  });
  if (ok) notify(area, 'local');
}

/** Store a sealed report/certificate (append-only). */
export function addReport(rec) {
  const record = { ...rec, id: rec.id || uid('rep'), sealed: true, createdAt: rec.createdAt || nowIso(), updatedAt: nowIso() };
  state.reports.push(record);
  const ok = commitLocal('reports', [{ op: 'upsert', record: stripRev(record) }], () => {
    const j = state.reports.indexOf(record);
    if (j >= 0) state.reports.splice(j, 1);
  });
  if (ok) notify('reports', 'local');
  return record;
}

/** Replaces a complete area (e.g. after plan generation) – authoritative.
    Sealed areas (certificates) and private areas locked while managing
    cannot be overwritten this way. Returns whether it was replaced. */
export function replaceArea(area, records) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Area “${area}” is sealed – addReport only.`); return false; }
  if (!areaAllowed(area)) { console.warn(`Area “${area}” is private and locked while managing.`); return false; }
  const prev = state[area];
  state[area] = (records || []).map((r) => ({ ...r }));
  const ok = commitLocal(area, [{ op: 'replace', records: state[area].map(stripRev) }], () => { state[area] = prev; });
  if (ok) notify(area, 'local');
  return ok;
}

/** Update the profile. */
export function setProfile(fields) {
  const prev = state.profile;
  state.profile = { ...prev, ...fields, id: 'profile', updatedAt: nowIso() };
  const ok = commitLocal('profile', [{ op: 'upsert', record: stripRev(state.profile) }], () => { state.profile = prev; });
  if (ok) notify('profile', 'local');
  return state.profile;
}
export function setSetting(key, value) {
  const s = { ...(state.profile.settings || {}) };
  s[key] = value;
  return setProfile({ settings: s });
}

/* ------------------- Exercise usage (counters, per user) ----------------- */
/** Map { exerciseId: count } of the exercises used so far by the signed-in user. */
export function exerciseUsage() { return (state.profile.settings || {}).exerciseUsage || {}; }
/** Increments one or more exercises by +1 (e.g. when marking one as done, or a completed session). */
export function bumpExerciseUsage(ids = []) {
  const u = { ...exerciseUsage() };
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) u[id] = (u[id] || 0) + 1; });
  return setSetting('exerciseUsage', u);
}

/* --------------------------------- Sync --------------------------------- */
let syncRun = null;          // running sync (promise)
let syncPending = false;     // requested again during the run -> one more round

async function pullArea(area, user) {
  const since = revs[area] || 0;
  const res = await pullChanges(area, { user, since });
  await applyPull(area, user, res, since);
}

/** Adopt the changes fetched for an area – from the single or the bulk fetch
    or with a push response (`since` = the mark that was sent along). */
async function applyPull(area, user, res, since) {
  if (activeUser !== user) return;
  // If the server is BELOW the remembered mark, an older state was restored
  // there: then the server state applies, and only our own changes that have
  // not been sent yet are laid on top again.
  if ((res.rev || 0) < since) { await resyncArea(area, user); return; }
  const { changed, visible } = applyServerRecords(area, res.records);
  // Advance the mark only if the state is also secured locally – otherwise the
  // records are missing after a restart although the mark lists them as fetched.
  if (changed && !writeLS(area)) return;
  revs[area] = Math.max(revs[area] || 0, res.rev || 0);
  // Redraw only for genuinely new content – not because our own records
  // come back with a server rev (FE-12).
  if (visible) notify(area, 'sync');
  writeUserMeta();
}

/**
 * Careful merging for the full sync (rev lines are not comparable after a restore):
 * the server version wins if its server timestamp is not older than the local one.
 * Otherwise the local version stays, but gets rev 0 so that every future server
 * change wins. NOTHING is deleted locally: if the server lost data (instead of
 * being deliberately restored), the copies on the devices are kept.
 */
function mergeConservative(local, server) {
  if (!local) return server;
  if (!server) return { ...local, rev: 0 };
  return String(server.updatedAt || '') >= String(local.updatedAt || '') ? server : { ...local, rev: 0 };
}

/** Full sync of an area (after a restore, or weekly). */
async function resyncArea(area, user) {
  const full = await pullChanges(area, { user, since: 0 });
  if (activeUser !== user) return;
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
  revs[area] = full.rev || 0;
  writeUserMeta();
  notify(area, 'sync');
}

// Weekly full sync per device and user: a restore on the server after which
// enough has been written again no longer shows up in the rev comparison.
// Once a week the complete server state therefore applies (plus pending ops).
const FULL_RESYNC_MS = 7 * 24 * 3600 * 1000;
function fullResyncKey(user) { return scopeKey(`${user}:__fullSync`); }

/* ---------------------------- Server session ---------------------------- */
/** May this user's private areas be synced with the server now?
    Only for the signed-in person themself and only with their own server session. */
function privateAllowed(user) { return !!user && user === identity && serverUser === identity; }

/** The server does not (or no longer) know the session – e.g. expired, or the PIN was changed on
    another device. The UI then asks for the PIN (app.js). */
function sessionLost() {
  serverUser = null;
  sessionAsked = true;
  try { window.dispatchEvent(new Event('catofit:session-required')); } catch { /* without DOM */ }
}

/** Ensure the server session: catch up after a sign-in without a server connection,
    check after a reload whether the cookie is still valid. */
async function catchUpServerLogin() {
  if (!identity || serverUser === identity) return;
  if (pendingServerPin && pendingServerPin.user === identity) {
    const r = await serverLogin(identity, pendingServerPin.pin);
    if (r && r.ok) { serverUser = identity; pendingServerPin = null; return; }
    if (r) { pendingServerPin = null; sessionLost(); }   // PIN changed in the meantime or similar
    return;
  }
  const s = await serverSession();
  if (s && s.user === identity) serverUser = identity;
  // The server answers but knows no session for this person – after the update from
  // v3.19.0 (which had none) or after 30 days of inactivity. Without a prompt, cycle,
  // labs and supplements would silently stay put; "Later" applies until the next page load.
  else if (s && !sessionAsked) sessionLost();
}

/** Does this person have a server session? (For notices in the UI.) */
export function serverSessionActive() { return !!identity && serverUser === identity; }

/** Sign in to the server again without leaving the session in the app. */
export async function reauth(pin) {
  if (!identity) return false;
  const r = await serverLogin(identity, String(pin ?? ''));
  if (r && r.ok) {
    serverUser = identity; pendingServerPin = null;
    if (memberHasPin(identity)) rememberDevicePin(identity, String(pin ?? ''));
    syncNow();
    return true;
  }
  lastLoginErr = r ? { code: r.code, message: r.error || tr('reauth.wrongPin'), left: r.left, retryAfter: r.retryAfter }
    : { code: 'offline', message: tr('storage.serverUnreachable') };
  return false;
}

/** Bulk fetch (server with 'changes-all'): send everything pending, then fetch the changes of all areas
    in ONE request. false = the server cannot do that, the single route takes over. */
async function syncPassBulk(u) {
  const areas = AREAS.filter((a) => !PRIVATE_AREAS.includes(a) || privateAllowed(u));
  for (const area of areas) {
    await pushArea(area, u);
    if (activeUser !== u) return true;
  }
  const since = Object.fromEntries(areas.map((a) => [a, revs[a] || 0]));
  let res;
  try {
    res = await pullAllChanges(u, since);
  } catch (e) {
    if (e && [400, 404, 405].includes(e.status)) return false;
    setSyncState('error');
    return true;
  }
  if (activeUser !== u) return true;
  // Private areas locked: the server session has expired – ask for the PIN.
  if (res.locked.length) sessionLost();
  for (const area of areas) {
    if (res.locked.includes(area) || res.revs[area] == null) continue;
    await applyPull(area, u, { rev: res.revs[area], records: res.changes[area] || [] }, since[area]);
    if (activeUser !== u) return true;
  }
  return true;
}

/** One pass for exactly one fixed user: push first, then pull. */
async function syncPass(u) {
  let last = 0;
  try { last = parseInt(localStorage.getItem(fullResyncKey(u)) || '0', 10) || 0; } catch { /* ignore */ }
  const full = Date.now() - last > FULL_RESYNC_MS;
  // New server: one request instead of one per area. The weekly full sync stays on the single route.
  if (!full && serverHas('changes-all') && await syncPassBulk(u)) return;
  let allOk = true;
  for (const area of AREAS) {
    if (activeUser !== u) return;       // View switch -> discard the pass
    // Private areas only with their own server session (ops wait in the queue meanwhile).
    if (PRIVATE_AREAS.includes(area) && !privateAllowed(u)) continue;
    await pushArea(area, u);
    if (activeUser !== u) return;
    try {
      if (full && !(pendingOps[area] || []).length) await resyncArea(area, u);
      else await pullArea(area, u);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403) && PRIVATE_AREAS.includes(area)) { sessionLost(); continue; }
      allOk = false; setSyncState('error');
    }
  }
  if (full && allOk && activeUser === u) safeSet(fullResyncKey(u), String(Date.now()));
}

/**
 * Fetches all areas from the server and merges them with the local state. If a sync
 * is already running, the call waits for its end plus another round – previously it
 * returned immediately, and whoever reported (or checked) "done" afterwards saw a half state.
 */
export function syncNow() {
  if (!activeUser) { setSyncState('idle'); return Promise.resolve(); }
  if (!isOnline()) { setSyncState('offline'); return Promise.resolve(); }
  if (syncRun) { syncPending = true; return syncRun; }
  syncRun = (async () => {
    let unreachable = false;
    try {
      do {
        syncPending = false;
        if (!activeUser || !isOnline()) break;
        setSyncState('syncing');
        // Ask briefly once whether the server answers – otherwise 13 areas would run individually
        // into their timeouts (on the road, home server in standby: minutes, FE-08).
        // If another sync was requested meanwhile, one more attempt follows (while condition).
        if (!(await ping(REACH_TIMEOUT))) { unreachable = true; continue; }
        unreachable = false;
        await catchUpServerLogin();
        await syncFamily();
        if (activeUser) await syncPass(activeUser);
        if (activeUser) await pushForeignQueues();   // e.g. restores submitted later
      } while (syncPending);
    } finally {
      syncRun = null;
    }
    setSyncState(unreachable || hasPending() ? 'offline' : (isOnline() ? 'idle' : 'offline'));
  })();
  return syncRun;
}

/* ------------------------------ Export/Import --------------------------- */
const EXPORT_VERSION = 1;
// Strictly private: never hand out/export when managing other members.
// `labs`/`supplements` are health data within the meaning of Art. 9 GDPR and are
// therefore treated exactly like the cycle – even admins do not see them, and they
// stay out of the full family backup (the personal backup contains them).
const PRIVATE_AREAS = ['cycle', 'labs', 'supplements'];
/** May the area be handed out in the current context? Private areas (cycle)
    are taboo when managing other members (isManaging) – only the person themself sees them. */
export function areaAllowed(area) { return !(isManaging() && PRIVATE_AREAS.includes(area)); }

export function exportAll() {
  const m = activeMember();
  const managing = isManaging();
  const dump = {
    app: 'catofit', version: EXPORT_VERSION, exportedAt: nowIso(),
    user: activeUser || null, userName: (m && m.name) || null,
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

/* ----------------- Admin full backup (entire family) ------------------- */
const FULL_EXPORT_VERSION = 1;
function fullBackupAreas() { return AREAS.filter((a) => !PRIVATE_AREAS.includes(a)); }

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
  if (activeUser && jobs.some((j) => j.id === activeUser)) loadUserFromLS();

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
  if (activeUser) { loadUserFromLS(); AREAS.forEach((a) => notify(a, 'local')); }
  return { users: usersRestored, areas: areasRestored, pending };
}

/** Put an op into the persistent queue of a (possibly non-active) user. */
function queueUserOp(user, area, op) {
  if (user === activeUser) { enqueueOp(area, op); return; }
  const m = readMeta(user);
  m.ops[area] = compactAppend(m.ops[area] || [], [withOpId(op)]);
  writeMeta(user, m);
}

/* ------------------------------- Family -------------------------------- */
function readFamilyStoreLS() { try { return JSON.parse(localStorage.getItem(FAMILY_STORE_LS) || 'null'); } catch { return null; } }
function writeFamilyStoreLS() {
  return safeSet(FAMILY_STORE_LS, JSON.stringify({ rev: familyStore.rev, records: familyStore.records, ops: familyOps }));
}

/** Derives the view {members, settings, pantry, teams} from the records. */
function rebuildFamily() {
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
function localFamilyRecord(r) {
  if (!r || (r._kind || 'member') !== 'member' || !('pinHash' in r)) return r;
  const c = { ...r };
  if (c.hasPin === undefined) c.hasPin = !!c.pinHash;
  delete c.pinHash;
  return c;
}
/** Record for a family op: without derived fields. */
function familyOpRecord(r) { const c = stripRev(r); delete c.hasPin; return c; }

const familyPusher = debounce(() => pushFamily(), 500);
/** Set a family record locally and send it as an op. `pinHash` (optional) goes only into the
    op – the server accepts it exclusively from an admin session, or during the
    initial setup. */
function familyUpsert(rec, { pinHash: newPinHash = null } = {}) {
  const r = localFamilyRecord({ ...rec, updatedAt: nowIso() });
  delete r.deleted;
  if (newPinHash) r.hasPin = true;
  familyStore.records[r.id] = r;
  const opRec = familyOpRecord(r);
  if (newPinHash) opRec.pinHash = newPinHash;
  familyOps.push(withOpId({ op: 'upsert', record: opRec }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
function familyDelete(id) {
  const prev = familyStore.records[id] || {};
  familyStore.records[id] = { id, deleted: true, updatedAt: nowIso(), ...(prev._kind ? { _kind: prev._kind } : {}) };
  familyOps.push(withOpId({ op: 'delete', id }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
/** Set the family authoritatively from a {members, settings, pantry, teams} object.
    If `teams` is missing (full backups before v3.20.0 contained no teams), the
    existing teams are kept instead of being silently deleted. */
function familyReplaceFrom(fam) {
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
  familyOps.push(withOpId({ op: 'replace', records: Object.values(records).map(familyOpRecord) }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}

/** Adopt family records; returns { changed, visible } as with mergeRecords. */
function applyFamilyServerRecords(records) {
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
function dropRejectedFamilyOps(rejected) {
  if (!rejected || !rejected.length) return;
  for (const r of rejected) if (r && r.id) delete familyStore.records[r.id];
  familyStore.rev = 0;
  rebuildFamily(); writeFamilyStoreLS();
  try {
    const first = rejected[0] || {};
    window.dispatchEvent(new CustomEvent('catofit:ops-rejected', { detail: { count: rejected.length, reason: serverError({ code: first.code, error: first.reason }) } }));
  } catch { /* without DOM */ }
}

let familyPushInflight = null;
/** Send family ops. As with the user areas: remove only the ops that were sent (by opId)
    and do NOT take over the mark from the push response (only on pull). */
function pushFamily() {
  if (familyPushInflight) return familyPushInflight.then(() => pushFamily());
  familyPushInflight = pushFamilyNow().finally(() => { familyPushInflight = null; });
  return familyPushInflight;
}
async function pushFamilyNow() {
  familyOps = familyOps.map(withOpId);
  if (!familyOps.length) return;
  if (!isOnline()) { setSyncState('offline'); return; }
  // The server needs admin changes with a session – first catch up on a sign-in that was begun offline.
  if (pendingServerPin) { try { await catchUpServerLogin(); } catch { /* ignore */ } }
  const batch = familyOps.slice(0, PUSH_CHUNK);
  try {
    const res = await pushOps('family', batch, { scope: 'family' });
    const sent = new Set(batch.map((o) => o.opId));
    familyOps = familyOps.filter((o) => !sent.has(o.opId));
    const { visible } = applyFamilyServerRecords(res.records);
    const rejected = !!(res.rejected && res.rejected.length);
    dropRejectedFamilyOps(res.rejected);
    rebuildFamily(); writeFamilyStoreLS();
    // The response contains our own, already displayed records – a redraw happens
    // only if the server stored or rejected something differently (FE-12).
    if (visible || rejected) { notify('family', 'sync'); notify('pantry', 'sync'); }
    if (familyOps.length) await pushFamilyNow();
  } catch { setSyncState('error'); }
}

/** Sync the family: push own ops, then pull changes. */
async function syncFamily() {
  try {
    if (familyOps.length) await pushFamily();
    const since = familyStore.rev || 0;
    const res = await pullChanges('family', { scope: 'family', since });
    if ((res.rev || 0) < since) {
      const full = await pullChanges('family', { scope: 'family', since: 0 });
      // Server completely empty (newly set up or reset, e.g. the ACC or TEST environment)
      // and nothing unsent on the device: the cache is outdated – adopt the server state.
      // Otherwise the sign-in shows profiles the server does not know ("This profile does not
      // exist (any more)."), and the initial setup never appears.
      if (!(full.records || []).some((r) => r && !r.deleted) && !familyOps.length) {
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
let serverReset = false;
function adoptServerFamily(full) {
  const recs = {};
  for (const r of (full.records || [])) if (r && r.id) recs[r.id] = localFamilyRecord(r);
  familyStore.records = recs;
  familyStore.rev = full.rev || 0;
  serverReset = !Object.values(recs).some((r) => !r.deleted && (r._kind || 'member') === 'member');
  rebuildFamily(); writeFamilyStoreLS();
  notify('family', 'sync'); notify('pantry', 'sync');
}
/** Was an empty (newly set up or reset) server detected during the sync? */
export function serverWasReset() { return serverReset && !(family.members || []).length; }

/** Family-wide data (members, roles, settings, pantry). */
export function getFamily() { return family; }
export function members() { return family.members || []; }
export function familySettings() { return family.settings || {}; }
export function activeUserId() { return activeUser; }
export function activeMember() { return (family.members || []).find((m) => m.id === activeUser) || null; }

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

/* ------------------------- Family pantry (pantry) ---------------------- */
export function familyPantry() { return family.pantry || []; }
export function setFamilyPantry(list) {
  familyUpsert({ id: '__pantry', _kind: 'pantry', items: Array.isArray(list) ? list : [] });
  notify('pantry', 'local');
  return family.pantry;
}

/* ----------------------------- Loading the user ----------------------------- */
function loadUserFromLS() {
  for (const area of AREAS) {
    const ls = readLS(area);
    state[area] = ls != null ? ls : (ARRAY_AREAS.includes(area) ? [] : {});
  }
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(userMetaKey(activeUser)) || 'null'); } catch { /* ignore */ }
  revs = (meta && meta.revs) ? { ...meta.revs } : {};
  pendingOps = normalizeOps(meta && meta.ops);   // legacy ops get an opId
}

/* ------------- One-off full sync after the sync fix (v3.20.0) ------------ */
// Until v3.19.0 a push took over the global area rev as the mark; devices could thereby
// skip foreign changes permanently. Discard all marks once per device –
// the next pull then fetches everything (merging by rev is idempotent).
const HEAL_KEY = scopeKey('syncHeal');
const HEAL_VERSION = '3.20';
function healMarksOnce() {
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
function evictUserCache(user) {
  if (!user || user === identity) return;
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${user}:${a}`)); } catch { /* ignore */ } });
  const m = readMeta(user);
  const hasOps = Object.values(m.ops).some((l) => (l || []).length);
  try {
    if (hasOps) { m.revs = {}; localStorage.setItem(userMetaKey(user), JSON.stringify(m)); }
    else localStorage.removeItem(userMetaKey(user));
  } catch { /* ignore */ }
}

/** Adopt changes from another tab of the same user (queue and areas). */
function onOtherTabWrite(e) {
  if (!activeUser || !e || !e.key) return;
  if (e.key === userMetaKey(activeUser)) {
    const before = JSON.stringify(Object.keys(pendingOps).map((a) => (pendingOps[a] || []).length));
    adoptForeignOps();
    if (JSON.stringify(Object.keys(pendingOps).map((a) => (pendingOps[a] || []).length)) !== before) {
      Object.keys(pendingOps).forEach((a) => { if ((pendingOps[a] || []).length) schedulePush(a); });
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

/* --------------------------------- Init --------------------------------- */
export async function init() {
  // 1) Family from LocalStorage (offline-first) – to display the login tiles.
  const fam = readFamilyStoreLS();
  if (fam && fam.records) {
    familyStore.rev = fam.rev || 0;
    // Do not carry on PIN hashes from older caches (only `hasPin` now).
    const recs = {};
    for (const id in (fam.records || {})) recs[id] = localFamilyRecord(fam.records[id]);
    familyStore.records = recs;
    familyOps = (Array.isArray(fam.ops) ? fam.ops : []).map(withOpId);
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
  identity = null;
  activeUser = null;
  serverUser = null;             // whether the cookie is still valid is settled by the first sync
  pendingServerPin = null;
  sessionAsked = false;
  let sess = null;
  try { sess = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
  if (sess && (family.members || []).some((m) => m.id === sess)) {
    identity = sess;
    activeUser = sess;
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
async function bootSync() {
  if (!isOnline()) { setSyncState('offline'); return; }
  if (!(await ping(REACH_TIMEOUT))) { setSyncState('offline'); return; }
  await syncFamily();
  // Restored session: does the user still exist after the family sync?
  // If not (e.g. removed on another device), sign out cleanly – the view
  // learns of it via the family message and lands on the sign-in when redrawing.
  if (activeUser && !(family.members || []).some((m) => m.id === activeUser)) {
    clearActiveUser();
    notify('family', 'sync');
  } else if (activeUser) {
    // syncNow also checks whether the server session (cookie) is still valid after the reload.
    try { await syncNow(); } catch { /* stays offline-first */ }
  }
}

/** Switches the user being viewed (loads their areas, redraws). */
export async function setActiveUser(id) {
  if (!id) return;
  const prev = activeUser;
  // Still write out the previous user's pending ops (before the switch) – only if
  // the server answers; otherwise they stay in that user's queue and go out later.
  if (prev && prev !== id && isOnline() && await ping(REACH_TIMEOUT)) {
    try { await pushAllAreas(prev); } catch { /* stays in the queue */ }
  }
  activeUser = id;
  loadUserFromLS();
  // Whoever only managed a member does not need their data permanently in storage.
  if (prev && prev !== id && prev !== identity) evictUserCache(prev);
  AREAS.forEach((a) => notify(a, 'local'));
  // Sync in the background: sign-in and profile switch wait only for the local state;
  // whatever is new on the server, the view redraws on arrival (FE-08).
  if (isOnline()) syncNow().catch(() => {});
}

/** Signs the signed-in person out (back to the family dashboard). */
export function clearActiveUser() {
  identity = null;
  activeUser = null;
  serverUser = null;
  pendingServerPin = null;
  sessionAsked = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* ignore */ }
  localStorage.removeItem(IDENTITY_KEY);
}

/** Discard the in-memory data of the most recently active user (after signing out). */
function resetState() {
  state.profile = {};
  ARRAY_AREAS.forEach((a) => { state[a] = []; });
  revs = {};
  pendingOps = {};
}

/**
 * Sign out completely: write out pending changes (if online),
 * then discard identity and the loaded data in memory. Afterwards only
 * the family/login dashboard is reachable (no auto-login).
 */
export async function logout() {
  if (activeUser && isOnline()) {
    try { await pushAllAreas(activeUser); } catch { /* stays in the queue (LocalStorage) */ }
  }
  if (serverUser && isOnline()) await serverLogout();
  const managed = activeUser && activeUser !== identity ? activeUser : null;
  clearActiveUser();
  if (managed) evictUserCache(managed);
  resetState();
  if (isSharedDevice()) wipePersonalData();
}

/* ------------------------- Shared device (v3.20.0) ------------------------- */
// On a shared family iPad nothing personal should remain in browser storage after
// signing out. The switch applies per device (not per profile).
const SHARED_DEVICE_KEY = scopeKey('sharedDevice');
export function isSharedDevice() { try { return localStorage.getItem(SHARED_DEVICE_KEY) === '1'; } catch { return false; } }
export function setSharedDevice(on) {
  try { if (on) localStorage.setItem(SHARED_DEVICE_KEY, '1'); else localStorage.removeItem(SHARED_DEVICE_KEY); } catch { /* ignore */ }
}
/**
 * Removes all personal data from this environment's browser storage. May stay:
 * the family list (for the sign-in), device settings and – only if not yet
 * sent – the pending changes, so that nothing is lost.
 */
function wipePersonalData() {
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

/* ------------------------------- Login / PIN ---------------------------- */
/**
 * PIN hash – **deterministic in EVERY context** (plain SHA-256, no
 * crypto.subtle; so a PIN set over http remains valid over https as well).
 * Since v3.20.0 the SERVER checks the PIN (same scheme, api/auth.php); the client
 * only computes the hash when an admin assigns a start PIN.
 */
function pinHash(userId, pin) { return sha256Hex(`catofit:${userId}:${pin}`); }

// Check value of this device for signing in without a server – only for people who have
// already signed in here once with a server connection (own salt per device).
const DEVICE_SALT_KEY = scopeKey('deviceSalt');
const PIN_LOCAL_KEY = scopeKey('pinLocal');
function deviceSalt() {
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
function readPinLocal() { try { return JSON.parse(localStorage.getItem(PIN_LOCAL_KEY) || '{}') || {}; } catch { return {}; } }
function devicePinHash(userId, pin) { return sha256Hex(`catofit-device:${deviceSalt()}:${userId}:${pin}`); }
function rememberDevicePin(userId, pin) {
  const m = readPinLocal();
  m[userId] = devicePinHash(userId, pin);
  safeSet(PIN_LOCAL_KEY, JSON.stringify(m));
}

// Notice "default PIN not yet changed" (per browser session).
const WEAK_PIN_KEY = scopeKey('weakPin');
function setWeakPin(userId, weak) {
  try { if (weak) sessionStorage.setItem(WEAK_PIN_KEY, userId); else sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* ignore */ }
}
/** Is the signed-in person still using the default PIN (or none at all)? */
export function pinIsWeak() {
  try { return !!identity && sessionStorage.getItem(WEAK_PIN_KEY) === identity; } catch { return false; }
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
  const self = userId === identity;
  const r = await serverSetPin(userId, String(pin), self ? String(oldPin ?? '') : null);
  if (!r) return { ok: false, code: 'offline', message: tr('storage.serverUnreachable') };
  if (!r.ok) return { ok: false, code: r.code, message: r.error || tr('storage.pinNotSaved'), left: r.left, retryAfter: r.retryAfter };
  const rec = familyStore.records[userId];
  if (rec) { familyStore.records[userId] = { ...rec, hasPin: true }; rebuildFamily(); writeFamilyStoreLS(); }
  if (self) { rememberDevicePin(userId, String(pin)); setWeakPin(userId, false); serverUser = identity; }
  return { ok: true };
}

/** Reason for the most recently failed sign-in: { code, message, left?, retryAfter? }. */
export function lastLoginError() { return lastLoginErr; }

/**
 * Sign in. With a server connection the server checks the PIN and opens a session
 * (prerequisite for cycle, labs and supplements). Without a server it only works on
 * devices where the person has already signed in online once; the
 * server sign-in is then caught up at the next sync.
 */
export async function login(userId, pin) {
  lastLoginErr = null;
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) { lastLoginErr = { code: 'unknown', message: tr('storage.profileGone') }; return false; }
  const p = String(pin ?? '');
  const hasPin = memberHasPin(userId);
  // If the server does not answer within 2.5 s, the sign-in counts as offline (PIN check on the
  // device, server session is caught up later) – previously the PIN sheet waited 17 s to 6 min (FE-08).
  let r = isOnline() && await ping(REACH_TIMEOUT) ? await serverLogin(userId, p) : null;
  // If the server does not know the profile yet (e.g. an initial setup begun offline),
  // first send the waiting family changes and then sign in again.
  if (r && !r.ok && r.code === 'unknown' && familyOps.length) {
    try { await pushFamily(); } catch { /* ignore */ }
    r = await serverLogin(userId, p);
  }
  // If the server still does not know the profile, the list on this device is outdated
  // (removed elsewhere, or server set up anew): adopt the members from the server so that
  // the tile disappears or the initial setup appears.
  if (r && !r.ok && r.code === 'unknown' && !familyOps.length) {
    try { adoptServerFamily(await pullChanges('family', { scope: 'family', since: 0 })); } catch { /* offline -> stays */ }
  }
  if (r && r.ok) {
    serverUser = userId;
    pendingServerPin = null;
    if (hasPin) rememberDevicePin(userId, p);
    setWeakPin(userId, !!r.weakPin);
  } else if (r) {
    lastLoginErr = { code: r.code, message: r.error || tr('reauth.wrongPin'), left: r.left, retryAfter: r.retryAfter };
    return false;
  } else {
    if (hasPin) {
      const local = readPinLocal()[userId];
      if (!local) {
        lastLoginErr = { code: 'offline-first', message: tr('login.firstNeedsServer') };
        return false;
      }
      if (local !== devicePinHash(userId, p)) { lastLoginErr = { code: 'pin', message: tr('reauth.wrongPin') }; return false; }
    }
    pendingServerPin = { user: userId, pin: p };
    setWeakPin(userId, !hasPin || p === DEFAULT_PIN);
  }
  identity = userId;
  // Remember the sign-in in the BROWSER SESSION: survives reloads (theme/profile/
  // plan changes reload) – but NOT an app restart/closing
  // (sessionStorage), so "always sign in again" is kept on a real start.
  try { sessionStorage.setItem(SESSION_KEY, userId); } catch { /* ignore */ }
  await setActiveUser(userId);
  return true;
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

/* --------------------------- Roles / co-management --------------------- */
export function identityId() { return identity; }
export function identityMember() { return (family.members || []).find((m) => m.id === identity) || null; }
export function isAdmin() { const m = identityMember(); return !!(m && m.role === 'admin'); }
export function isViewingSelf() { return identity != null && identity === activeUser; }
export function isManaging() { return identity != null && activeUser != null && identity !== activeUser; }

export async function enterMember(userId) {
  if (!isAdmin() || !userId) return false;
  await setActiveUser(userId);
  return true;
}
export async function backToSelf() {
  if (identity) await setActiveUser(identity);
}

/* ------------------------------- Members ----------------------------- */
export const MAX_MEMBERS = 32;
export const DEFAULT_PIN = '0000';

export async function addMember({ name, role = 'user', emoji = '🙂', color = '#3d8bff', pin = DEFAULT_PIN } = {}) {
  if (!isAdmin()) return null;
  if ((family.members || []).length >= MAX_MEMBERS) return null;
  const id = uid('u');
  // Start PIN (default 0000): the hash goes only to the server, which accepts it from an
  // admin session; locally only `hasPin` is stored.
  familyUpsert({
    id, _kind: 'member', name: (name || tr('account.member')).trim(),
    role: role === 'admin' ? 'admin' : 'user', emoji, color, createdAt: nowIso(),
  }, { pinHash: pinHash(id, (pin || DEFAULT_PIN)) });
  return (family.members || []).find((m) => m.id === id) || null;
}

export function updateMember(userId, fields) {
  if (!isAdmin()) return;
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return;
  familyUpsert({
    ...m, _kind: 'member', ...fields,
    role: (fields.role ?? m.role) === 'admin' ? 'admin' : 'user',
  });
}

export function removeMember(userId) {
  if (!isAdmin()) return false;
  const list = family.members || [];
  const target = list.find((m) => m.id === userId);
  if (!target) return false;
  if (target.role === 'admin' && list.filter((m) => m.role === 'admin').length <= 1) return false;
  familyDelete(userId);
  // Remove from all teams so that no "ghost members" remain in teams.
  (family.teams || []).forEach((t) => {
    if ((t.memberIds || []).includes(userId)) familyUpsert({ ...t, _kind: 'team', memberIds: (t.memberIds || []).filter((x) => x !== userId) });
  });
  if (activeUser === userId) backToSelf();
  deleteUserData(userId);
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${userId}:${a}`)); } catch { /* ignore */ } });
  try { localStorage.removeItem(userMetaKey(userId)); } catch { /* ignore */ }
  return true;
}

export function setFamilySetting(key, value) {
  if (!isAdmin()) return;
  familyUpsert({ id: '__settings', _kind: 'settings', ...(family.settings || {}), [key]: value });
}

/* ------------------------------- Teams ---------------------------------- */
/** All teams (subgroups of the family; a member can be in several). */
export function teams() { return family.teams || []; }
/** Teams of which `memberId` is a member. */
export function teamsOf(memberId) { return (family.teams || []).filter((t) => (t.memberIds || []).includes(memberId)); }
/** Resolved members of a team (in the family's creation order). */
export function teamMembers(teamId) {
  const t = (family.teams || []).find((x) => x.id === teamId);
  if (!t) return [];
  const ids = new Set(t.memberIds || []);
  return (family.members || []).filter((m) => ids.has(m.id));
}

export function addTeam({ name, emoji = '👥', color = '#3d8bff', memberIds = [] } = {}) {
  if (!isAdmin()) return null;
  const id = uid('t');
  familyUpsert({ id, _kind: 'team', name: (name || tr('storage.defaultTeam')).trim(), emoji, color, memberIds: [...new Set(memberIds)], createdAt: nowIso() });
  return (family.teams || []).find((t) => t.id === id) || null;
}
export function updateTeam(teamId, fields = {}) {
  if (!isAdmin()) return;
  const t = (family.teams || []).find((x) => x.id === teamId);
  if (!t) return;
  const memberIds = fields.memberIds !== undefined ? [...new Set(fields.memberIds)] : t.memberIds;
  familyUpsert({ ...t, _kind: 'team', ...fields, memberIds });
}
export function removeTeam(teamId) {
  if (!isAdmin()) return false;
  if (!(family.teams || []).some((t) => t.id === teamId)) return false;
  familyDelete(teamId);
  return true;
}
/** Sets EXACTLY the team membership of a member (assignment & team change;
    multiple memberships allowed). Updates only the affected teams. */
export function setMemberTeams(memberId, teamIds = []) {
  if (!isAdmin()) return;
  const want = new Set(teamIds);
  (family.teams || []).forEach((t) => {
    const has = (t.memberIds || []).includes(memberId);
    const should = want.has(t.id);
    if (has === should) return;
    const memberIds = should ? [...(t.memberIds || []), memberId] : (t.memberIds || []).filter((x) => x !== memberId);
    familyUpsert({ ...t, _kind: 'team', memberIds: [...new Set(memberIds)] });
  });
}

/* ----------------------- Initial setup / reset ------------------------ */
/**
 * Creates the VERY FIRST admin (only with an empty family) and signs them in directly.
 * Deliberately bypasses addMember's isAdmin() barrier because there is no
 * admin yet. The initial setup (login.js) calls this.
 */
export async function createFirstAdmin({ name, pin } = {}) {
  if ((family.members || []).length > 0) return null;   // only on an empty installation
  // The admin PIN is mandatory (since v3.20.0): 4–8 digits, not 0000.
  const problem = pinProblem(pin);
  if (problem) { lastLoginErr = { code: 'weak', message: problem }; return null; }
  // Reconcile with the server before creating: if a family already exists there
  // (e.g. created on another device, or the pull had not yet gone
  // through at boot), do NOT create a second admin – that was a source of "duplicate users".
  if (isOnline()) {
    try { await syncFamily(); } catch { /* offline -> carry on locally */ }
    if ((family.members || []).length > 0) return null;
  }
  const id = uid('u');
  const p = String(pin);
  // The language of the setup becomes the instance default – written before the admin, so a
  // new instance is never mistaken for one set up before v4.0.0 (those default to German).
  if (!(family.settings || {}).language) {
    familyUpsert({ id: '__settings', _kind: 'settings', ...(family.settings || {}), language: locale() });
  }
  familyUpsert({
    id, _kind: 'member', name: (name || tr('account.admin')).trim(), role: 'admin',
    emoji: '🏃', color: '#18b48a', createdAt: nowIso(),
  }, { pinHash: pinHash(id, p) });
  if (isOnline()) { try { await pushFamily(); } catch { /* stays in the queue */ } }
  identity = id;
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }   // stay signed in (survives reloads)
  // Server session for the new admin (for admin actions and private areas);
  // without a server connection it is caught up at the next sync.
  const r = isOnline() ? await serverLogin(id, p) : null;
  if (r && r.ok) serverUser = id; else pendingServerPin = { user: id, pin: p };
  rememberDevicePin(id, p);
  await setActiveUser(id);
  setProfile({ name: (name || tr('account.admin')).trim() });   // profile name = display name (greeting etc.)
  return id;
}

/** Fills the app with demo data: admin history + 1–2 demo members (admin only). */
export async function seedDemo(today = todayStr()) {
  if (!isAdmin()) return false;
  // Needed only for the initial setup – load only now instead of at every start (FE-19).
  const { buildDemo, completeDemoUnits, planPeriodSessions } = await import('./demo.js');
  const d = buildDemo(today);
  setProfile(d.profile);
  if (d.settings) for (const [k, v] of Object.entries(d.settings)) setSetting(k, v);
  replaceArea('events', d.self.events);
  replaceArea('sessions', d.self.sessions);
  replaceArea('health', d.self.health);
  if (d.self.nutrition) replaceArea('nutrition', d.self.nutrition);
  if (d.self.diary) replaceArea('diary', d.self.diary);
  if (d.self.cycle) replaceArea('cycle', d.self.cycle);
  if (d.self.checklist) replaceArea('checklist', d.self.checklist);
  if (d.self.shopping) replaceArea('shopping', d.self.shopping);
  if (d.self.labs) replaceArea('labs', d.self.labs);
  if (d.self.supplements) replaceArea('supplements', d.self.supplements);
  if (d.pantry) setFamilyPantry(d.pantry);  // shared pantry (shopping list deducts from it)

  // Generate a real, periodised plan (like a normal user) and backdate it so that
  // the current week + completed sessions are included (otherwise the plan start
  // would only be next week and "Today"/calendar would be empty).
  try {
    const { createPlanForEvent, generatePlanUnits, makePhases } = await import('./plans.js');
    const { defaultCommitments, mkCommit } = await import('./commitments.js');
    const ev = d.self.events[0];
    const plan = createPlanForEvent(ev);
    const start = addDays(weekStartMonday(today), -14);
    const weeks = Math.max(plan.weeks, Math.ceil((diffDays(start, ev.date) + 1) / 7));
    const phases = makePhases(weeks);
    // Fixed appointments of the demo: Mon/Wed football + Sunday matches from ~2 weeks on – shows
    // configurable appointments, date range and the weekly check (Sat long run → Sun match).
    const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: addDays(today, 12), durationMin: 120 })];
    let units = generatePlanUnits({ ...plan, startDate: start, weeks, phases, commitments }, ev, state.profile);
    units = units.map((u) => (u.date < today ? { ...u, status: 'erledigt' } : u));
    // Link demo workouts to the completed sessions (same day, same
    // sport) – otherwise they would appear twice in the calendar: as a session and as a free workout.
    const { linkDemoSessions } = await import('./planflow.js');
    const linked = linkDemoSessions(units, planPeriodSessions(d.self.sessions, start, today), today, ev.id);
    // Every other completed session (football too) gets a matching workout –
    // with duration and effort so that the load includes the fixed appointments.
    const completed = completeDemoUnits(linked.units, linked.sessions, today, ev.id);
    units = completed.units;
    replaceArea('sessions', completed.sessions);
    // v3.11.0: Pre-link mobility sessions with the most fitting exercises (by usage) –
    // makes the session↔exercise-catalogue link visible straight away in the demo.
    try {
      const { suggestedExercisesFor, sortByUsage } = await import('./exercises.js');
      const usage = exerciseUsage();
      units = units.map((u) => u.type === 'mobility'
        ? { ...u, exerciseIds: sortByUsage(suggestedExercisesFor(u.type), usage).slice(0, 2).map((e) => e.id) }
        : u);
    } catch { /* exercise link is optional */ }
    patch('plans', plan.id, { startDate: start, weeks, phases, commitments, units, generated: true });
  } catch { /* plan is optional */ }

  const nameToId = { __self__: identity };
  // Put the demo members' ops durably into their queues first, then send: a
  // reload in the middle of sending then loses nothing (before: fire-and-forget).
  const jobs = [];
  for (const m of d.members) {
    const mem = await addMember({ name: m.name, role: m.role, emoji: m.emoji, color: m.color, pin: DEFAULT_PIN });
    if (!mem) continue;
    nameToId[m.name] = mem.id;
    for (const [area, records] of Object.entries(m.data)) {
      if (!Array.isArray(records) || !records.length) continue;
      writeUserArea(mem.id, area, records);
      queueUserOp(mem.id, area, { op: 'replace', records: records.map(stripRev) });
      jobs.push([mem.id, area]);
    }
    // Complete, individual member profile (object area, not an array).
    if (m.profile) {
      const prof = { id: 'profile', ...m.profile, updatedAt: nowIso() };
      writeUserArea(mem.id, 'profile', prof);
      queueUserOp(mem.id, 'profile', { op: 'upsert', record: stripRev(prof) });
      jobs.push([mem.id, 'profile']);
    }
  }
  if (isOnline()) await Promise.allSettled(jobs.map(([u, a]) => pushArea(a, u)));
  // Create teams (names → IDs; '__self__' = admin. Multiple memberships possible).
  for (const t of (d.teams || [])) {
    const memberIds = (t.memberNames || []).map((n) => nameToId[n]).filter(Boolean);
    addTeam({ name: t.name, emoji: t.emoji, color: t.color, memberIds });
  }
  if (isOnline()) { try { await syncNow(); } catch { /* ignore */ } }
  return true;
}

/**
 * Resets the app completely: all members + data (server & local) and
 * returns to the initial setup. Admin only. Irreversible.
 */
export async function resetApp() {
  if (!isAdmin()) return false;
  const ids = (family.members || []).map((m) => m.id);
  if (isOnline()) {
    for (const id of ids) { try { await deleteUserData(id); } catch { /* carry on */ } }
  }
  // Clear the family authoritatively (tombstones on the server).
  familyReplaceFrom({ members: [], settings: {}, pantry: [], teams: [] });
  if (isOnline()) { try { await pushFamily(); } catch { /* ignore */ } }
  // Discard local app storage – ONLY the keys of THIS environment (scopeKey prefix),
  // so that resetting the acceptance instance does not also wipe the storage of production
  // on the same origin.
  try {
    const prefix = scopeKey('');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  clearActiveUser();
  resetState();
  familyStore.records = {}; familyStore.rev = 0; familyOps = []; rebuildFamily();
  return true;
}

export { AREAS, ARRAY_AREAS };
