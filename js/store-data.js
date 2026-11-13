/* =========================================================================
   store-data.js — reading and writing the areas of the active person (the public data API). Layer 6.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { migrateHealth } from './healthdata.js';
import { migrateLabs } from './labs.js';
import { migratePlans } from './program.js';
import { nowIso, uid } from './ui.js';
import { isManaging } from './store-family.js';
import { notify } from './store-local.js';
import { stripRev } from './store-merge.js';
import { commitLocal } from './store-queue.js';
import { PRIVATE_AREAS, SEALED_AREAS, family, state, vars } from './store-state.js';

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
export const FOOD_LOOKUP_OPT_IN_SINCE = '2026-09-28';
export function foodLookupEnabled() {
  const s = settings();
  if (typeof s.foodLookup === 'boolean') return s.foodLookup;
  const m = (family.members || []).find((x) => x.id === vars.activeUser);
  return !!(m && m.createdAt && String(m.createdAt) < FOOD_LOOKUP_OPT_IN_SINCE);
}

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

/** Update the profile. Only the given fields go to the server (op `merge`, v4.2): a device that has
    not fetched the profile yet, or a second device writing at the same time, no longer wipes fields
    it did not touch. Clear a field with null, not by leaving it out. */
export function setProfile(fields) { return writeProfile(fields, fields); }
export function setSetting(key, value) {
  const s = { ...(state.profile.settings || {}) };
  s[key] = value;
  return writeProfile({ settings: s }, { settings: { [key]: value } });
}
/** `fields` change the local profile, `patch` is what is sent – both field by field. */
export function writeProfile(fields, patch) {
  const prev = state.profile;
  state.profile = { ...prev, ...fields, id: 'profile', updatedAt: nowIso() };
  const record = stripRev({ ...patch, id: 'profile' });
  delete record.updatedAt;
  const ok = commitLocal('profile', [{ op: 'merge', record }], () => { state.profile = prev; });
  if (ok) notify('profile', 'local');
  return state.profile;
}

/** Has the active person's profile come from the server in this session? Automatic writes
    (the region's unit defaults) wait for it – otherwise a new device saves its guesses over
    the choices the person made elsewhere. */
export function profileFetched() { return !!vars.activeUser && vars.profileFetchedFor === vars.activeUser; }

/** Map { exerciseId: count } of the exercises used so far by the signed-in user. */
export function exerciseUsage() { return (state.profile.settings || {}).exerciseUsage || {}; }
/** Increments one or more exercises by +1 (e.g. when marking one as done, or a completed session). */
export function bumpExerciseUsage(ids = []) {
  const u = { ...exerciseUsage() };
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) u[id] = (u[id] || 0) + 1; });
  return setSetting('exerciseUsage', u);
}
/** May the area be handed out in the current context? Private areas (cycle)
    are taboo when managing other members (isManaging) – only the person themself sees them. */
export function areaAllowed(area) { return !(isManaging() && PRIVATE_AREAS.includes(area)); }
