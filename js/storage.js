/* =========================================================================
   storage.js — zentraler "local-first"-Store (server-autoritativ, v3.0.0).

   Modell (Option B):
   - Lokal optimistisch schreiben (sofort, offline-fähig) und jede Änderung als
     OPERATION (upsert/delete/replace) in eine persistente Queue legen.
   - Der SERVER ist die Merge-Autorität: er wendet Ops an und vergibt eine
     streng monotone `rev` je Datensatz (keine Geräte-Uhr-Abhängigkeit).
   - Sync je Bereich: erst eigene Ops PUSHEN (damit lokale Edits eine rev
     bekommen), dann Änderungen seit der bekannten rev PULLEN. Pull gewinnt nur,
     wenn die server-`rev` höher ist – konkurrierende Edits verschiedener
     Datensätze gehen nie verloren.
   - Löschungen sind Tombstones (deleted:true) mit eigener rev.
   - Die Familie ist eine Sammlung von Datensätzen (Mitglied je id, __settings,
     __pantry) -> Mitglieder mischen PRO MITGLIED (kein stiller Verlust mehr).

   Öffentliche Store-API bleibt unverändert -> Views brauchen keine Anpassung.
   ========================================================================= */

import {
  pushOps, pullChanges, apiGet, isOnline, onStatus, ping, deleteUserData,
} from './api-client.js';
import { uid, nowIso, debounce, todayStr, addDays, weekStartMonday, diffDays, scopeKey } from './ui.js';
import { sha256Hex } from './sha256.js';
import { buildDemo } from './demo.js';

const AREAS = ['profile', 'events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports'];
const ARRAY_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports'];
// Versiegelte Bereiche: append-only, nicht editier- oder löschbar (z. B. Urkunden/Reports).
const SEALED_AREAS = ['reports'];
// Alle Keys sind umgebungs-eindeutig (scopeKey), damit Prod & Abnahme auf
// derselben Origin ihren Speicher NICHT teilen (sonst „doppelte Nutzer").
const IDENTITY_KEY = scopeKey('identity');  // LEGACY (vor v3.2.0): dauerhaft gemerkter Nutzer – wird nur noch verworfen
const SESSION_KEY = scopeKey('session');    // Anmeldung DIESER Browser-Sitzung (sessionStorage): überlebt Reloads, nicht den App-Neustart
const FAMILY_STORE_LS = scopeKey('familyStore');

let identity = null;                        // angemeldete Person (Rollen + Zyklus-Privatsphäre)
let activeUser = null;                      // gerade betrachteter Nutzer (steuert die Datenanzeige)
const LS = (area) => scopeKey(`${activeUser}:${area}`);

const state = {
  profile: {},
  events: [], plans: [], sessions: [], health: [],
  nutrition: [], shopping: [], checklist: [], cycle: [], reports: [], diary: [],
};
let revs = {};          // area -> letzte gesehene Server-rev (Hochwassermarke)
let pendingOps = {};    // area -> ausstehende Ops des aktiven Nutzers

// Familie als Datensatz-Store + abgeleitete Sicht.
const familyStore = { rev: 0, records: {} };
let familyOps = [];
const family = { members: [], settings: {}, pantry: [] };

const syncListeners = new Set();
let syncState = 'idle'; // idle | syncing | offline | error

/* ----------------------------- LocalStorage ----------------------------- */
function readLS(area) {
  try { const raw = localStorage.getItem(LS(area)); return raw == null ? null : JSON.parse(raw); } catch { return null; }
}
function writeLS(area) {
  try { localStorage.setItem(LS(area), JSON.stringify(state[area])); } catch (e) { console.warn('LocalStorage voll?', e); }
}
function userMetaKey(user) { return scopeKey(`${user}:__meta`); }
function writeUserMeta() {
  if (!activeUser) return;
  try { localStorage.setItem(userMetaKey(activeUser), JSON.stringify({ revs, ops: pendingOps })); } catch { /* voll */ }
}
function readUserArea(user, area) { try { return JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { return null; } }
function writeUserArea(user, area, val) { try { localStorage.setItem(scopeKey(`${user}:${area}`), JSON.stringify(val)); } catch { /* voll */ } }
function readMeta(user) { try { return JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null') || { revs: {}, ops: {} }; } catch { return { revs: {}, ops: {} }; } }
function writeMeta(user, m) { try { localStorage.setItem(userMetaKey(user), JSON.stringify(m)); } catch { /* voll */ } }

/* ------------------------------- Merge ---------------------------------- */
function stripRev(r) { const c = { ...r }; delete c.rev; return c; }

/** Server-Datensätze in eine lokale Datensatzliste mischen: höhere rev gewinnt. */
function mergeRecords(arr, serverRecords) {
  const byId = new Map((arr || []).map((r) => [r.id, r]));
  for (const sr of serverRecords) {
    const l = byId.get(sr.id);
    if (!l || (sr.rev || 0) > (l.rev || 0)) byId.set(sr.id, sr);
  }
  return [...byId.values()];
}

/** Server-Datensätze in den State des AKTIVEN Nutzers übernehmen. */
function applyServerRecords(area, records) {
  if (!records || !records.length) return false;
  if (area === 'profile') {
    // Bei MEHREREN Profil-Upserts in einem Batch liefert der Server mehrere
    // 'profile'-Records – den mit der HÖCHSTEN rev nehmen (zuletzt angewandt),
    // nicht den ersten. Sonst überschreibt eine ältere Version neuere Felder
    // (z. B. ging der Standort bei seedDemo / schnellen Profil-Edits verloren).
    const sp = records
      .filter((r) => r.id === 'profile')
      .reduce((best, r) => (!best || (r.rev || 0) > (best.rev || 0) ? r : best), null);
    if (sp && (sp.rev || 0) > (state.profile.rev || 0)) { state.profile = sp; return true; }
    return false;
  }
  state[area] = mergeRecords(state[area], records);
  return true;
}

/* ----------------------------- Notifications ---------------------------- */
export function onSync(cb) { syncListeners.add(cb); return () => syncListeners.delete(cb); }
function notify(area, origin) { syncListeners.forEach((cb) => cb(area, origin)); }

function hasPending() {
  for (const a in pendingOps) if ((pendingOps[a] || []).length) return true;
  return familyOps.length > 0;
}
function setSyncState(s) {
  if (syncState === s) return;
  syncState = s;
  const ind = document.getElementById('sync-indicator');
  if (ind) {
    ind.dataset.state = s;
    ind.hidden = (s === 'idle');
    const label = { syncing: 'Sync …', offline: 'Offline', error: 'Sync-Fehler' }[s] || '';
    ind.innerHTML = `<span class="sync-indicator__dot"></span><span>${label}</span>`;
  }
}

/* ------------------------------ Op-Queue/Push --------------------------- */
function enqueueOp(area, op) {
  (pendingOps[area] ||= []).push(op);
  writeUserMeta();
  schedulePush(area);
}

const pushers = {};
// An den Nutzer GEBUNDEN debouncen: ein Sichtwechsel darf nie fremde Ops am
// falschen Nutzer abladen.
function schedulePush(area, user = activeUser) {
  if (!user) return;
  const key = `${user}|${area}`;
  if (!pushers[key]) pushers[key] = debounce(() => pushArea(area, user), 600);
  pushers[key]();
}

/** Ausstehende Ops eines Bereichs an den Server schicken (nutzergenau). */
async function pushArea(area, user) {
  if (!user) return;
  const active = user === activeUser;
  const ops = active ? (pendingOps[area] || []) : ((readMeta(user).ops || {})[area] || []);
  if (!ops.length) return;
  if (!isOnline()) { setSyncState('offline'); return; }
  const n = ops.length;
  const batch = ops.slice(0, n);
  setSyncState('syncing');
  try {
    const res = await pushOps(area, batch, { user });
    if (active) {
      pendingOps[area] = (pendingOps[area] || []).slice(n);
      applyServerRecords(area, res.records);
      revs[area] = Math.max(revs[area] || 0, res.rev || 0);
      writeLS(area); writeUserMeta();
    } else {
      const m = readMeta(user);
      m.ops = m.ops || {}; m.ops[area] = ((m.ops[area]) || []).slice(n);
      m.revs = m.revs || {}; m.revs[area] = Math.max((m.revs[area]) || 0, res.rev || 0);
      writeUserArea(user, area, mergeRecords(readUserArea(user, area) || [], res.records));
      writeMeta(user, m);
    }
    setSyncState(hasPending() ? 'offline' : 'idle');
  } catch (e) {
    setSyncState('error'); // Ops bleiben in der Queue -> später erneut
  }
}

/** Alle ausstehenden Ops eines Nutzers wegschreiben (z. B. vor Sichtwechsel). */
async function pushAllAreas(user) {
  for (const area of AREAS) await pushArea(area, user);
}

/* -------------------------------- Lesen --------------------------------- */
/** Sichtbare Einträge eines Bereichs (ohne Tombstones). */
export function get(area) {
  if (area === 'profile') return state.profile;
  if (!areaAllowed(area)) return [];   // private Bereiche (Zyklus) beim Verwalten fremder Mitglieder NICHT ausgeben
  return (state[area] || []).filter((r) => !r.deleted);
}
/** Roh inkl. Tombstones (für Persistenz/Debug). */
export function getRaw(area) { return state[area]; }
export function find(area, id) { return (state[area] || []).find((r) => r.id === id && !r.deleted) || null; }
export function profile() { return state.profile; }
export function settings() { return state.profile.settings || {}; }

/* ------------------------------- Schreiben ------------------------------ */
/** Fügt einen Datensatz ein oder ersetzt ihn (per id). */
export function upsert(area, record) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Bereich „${area}" ist versiegelt – nur addReport.`); return record; }
  if (!record.id) record.id = uid(area.slice(0, 3));
  record.updatedAt = nowIso();
  if (!record.createdAt) record.createdAt = record.updatedAt;
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === record.id);
  if (i >= 0) arr[i] = record; else arr.push(record);
  writeLS(area);
  enqueueOp(area, { op: 'upsert', record: stripRev(record) });
  notify(area, 'local');
  return record;
}

/** Aktualisiert Felder eines Datensatzes. */
export function patch(area, id, fields) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Bereich „${area}" ist versiegelt – nicht editierbar.`); return null; }
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...fields, updatedAt: nowIso() };
  writeLS(area);
  enqueueOp(area, { op: 'upsert', record: stripRev(arr[i]) });
  notify(area, 'local');
  return arr[i];
}

/** Soft-Delete (Tombstone). */
export function remove(area, id) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Bereich „${area}" ist versiegelt – nicht löschbar.`); return; }
  const arr = state[area];
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return;
  arr[i] = { ...arr[i], deleted: true, updatedAt: nowIso() };
  writeLS(area);
  enqueueOp(area, { op: 'delete', id });
  notify(area, 'local');
}

/** Versiegelten Report/Urkunde ablegen (append-only). */
export function addReport(rec) {
  const record = { ...rec, id: rec.id || uid('rep'), sealed: true, createdAt: rec.createdAt || nowIso(), updatedAt: nowIso() };
  state.reports.push(record);
  writeLS('reports');
  enqueueOp('reports', { op: 'upsert', record: stripRev(record) });
  notify('reports', 'local');
  return record;
}

/** Ersetzt einen kompletten Bereich (z. B. nach Plan-Generierung) – autoritativ. */
export function replaceArea(area, records) {
  state[area] = (records || []).map((r) => ({ ...r }));
  writeLS(area);
  enqueueOp(area, { op: 'replace', records: state[area].map(stripRev) });
  notify(area, 'local');
}

/** Profil aktualisieren. */
export function setProfile(fields) {
  state.profile = { ...state.profile, ...fields, id: 'profile', updatedAt: nowIso() };
  writeLS('profile');
  enqueueOp('profile', { op: 'upsert', record: stripRev(state.profile) });
  notify('profile', 'local');
  return state.profile;
}
export function setSetting(key, value) {
  const s = { ...(state.profile.settings || {}) };
  s[key] = value;
  return setProfile({ settings: s });
}

/* ------------------- Übungs-Nutzung (Zähler, pro Nutzer) ----------------- */
/** Map { exerciseId: count } der bisher genutzten Übungen des angemeldeten Nutzers. */
export function exerciseUsage() { return (state.profile.settings || {}).exerciseUsage || {}; }
/** Zählt eine oder mehrere Übungen um +1 hoch (z. B. „Gemacht" oder erledigte Einheit). */
export function bumpExerciseUsage(ids = []) {
  const u = { ...exerciseUsage() };
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) u[id] = (u[id] || 0) + 1; });
  return setSetting('exerciseUsage', u);
}

/* --------------------------------- Sync --------------------------------- */
let syncInFlight = false;
let syncPending = false;

async function pullArea(area, user) {
  const since = revs[area] || 0;
  const res = await pullChanges(area, { user, since });
  if (activeUser !== user) return;
  const changed = applyServerRecords(area, res.records);
  revs[area] = Math.max(revs[area] || 0, res.rev || 0);
  if (changed) { writeLS(area); notify(area, 'sync'); }
  writeUserMeta();
}

/** Ein Durchlauf für genau einen fixierten Nutzer: erst pushen, dann pullen. */
async function syncPass(u) {
  for (const area of AREAS) {
    if (activeUser !== u) return;       // Sichtwechsel -> Pass verwerfen
    await pushArea(area, u);
    if (activeUser !== u) return;
    try { await pullArea(area, u); } catch { setSyncState('error'); }
  }
}

/** Holt alle Bereiche vom Server und führt sie mit dem lokalen Stand zusammen. */
export async function syncNow() {
  if (!activeUser) { setSyncState('idle'); return; }
  if (!isOnline()) { setSyncState('offline'); return; }
  if (syncInFlight) { syncPending = true; return; }
  syncInFlight = true;
  try {
    do {
      syncPending = false;
      if (!activeUser || !isOnline()) break;
      setSyncState('syncing');
      await syncFamily();
      if (activeUser) await syncPass(activeUser);
    } while (syncPending);
  } finally {
    syncInFlight = false;
  }
  setSyncState(hasPending() ? 'offline' : (isOnline() ? 'idle' : 'offline'));
}

/* ------------------------------ Export/Import --------------------------- */
const EXPORT_VERSION = 1;
const PRIVATE_AREAS = ['cycle'];   // strikt privat: nie beim Verwalten fremder Mitglieder ausgeben/exportieren
/** Darf der Bereich im aktuellen Kontext ausgegeben werden? Private Bereiche (Zyklus)
    sind beim Verwalten fremder Mitglieder (isManaging) tabu – nur die Person selbst sieht sie. */
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
    dump[a] = a === 'profile' ? stripRev({ ...state.profile }) : get(a).map(stripRev);
  });
  return dump;
}

/** Spielt ein persönliches Backup ein (für den aktiven Nutzer, autoritativ). */
export function importAll(dump) {
  if (!dump || typeof dump !== 'object' || Array.isArray(dump)) throw new Error('Keine gültige Backup-Datei.');
  if (dump.app != null && dump.app !== 'catofit') throw new Error('Diese Datei stammt nicht aus Cat-O-Fit.');
  if (typeof dump.version === 'number' && dump.version > EXPORT_VERSION) throw new Error('Das Backup wurde mit einer neueren App-Version erstellt.');
  const imported = [];
  const skipped = [];
  AREAS.forEach((a) => {
    if (dump[a] == null) return;
    const wantArray = ARRAY_AREAS.includes(a);
    const val = dump[a];
    const okType = wantArray ? Array.isArray(val) : (typeof val === 'object' && !Array.isArray(val));
    if (!okType) { skipped.push(a); return; }
    if (a === 'profile') {
      state.profile = { ...val, id: 'profile', updatedAt: nowIso() };
      writeLS('profile');
      enqueueOp('profile', { op: 'upsert', record: stripRev(state.profile) });
      notify('profile', 'local');
    } else {
      replaceArea(a, val);
    }
    imported.push(a);
  });
  return { imported, skipped, user: dump.user || null, userName: dump.userName || null };
}

/* ----------------- Admin-Vollbackup (gesamte Familie) ------------------- */
const FULL_EXPORT_VERSION = 1;
function fullBackupAreas() { return AREAS.filter((a) => !PRIVATE_AREAS.includes(a)); }

/** Vollständiges Familien-Backup (nur Admin) – ohne private Zyklusdaten. */
export async function exportFamilyAll() {
  if (!isAdmin()) throw new Error('Nur Administrator:innen dürfen ein Vollbackup erstellen.');
  if (isOnline()) await syncFamily();   // Mitgliederliste frisch holen
  const dump = {
    app: 'catofit', kind: 'family-full', version: FULL_EXPORT_VERSION, exportedAt: nowIso(),
    family: { members: family.members.map((x) => ({ ...x })), settings: { ...family.settings }, pantry: family.pantry.map((x) => ({ ...x })) },
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

/** Vollständiges Familien-Backup einspielen (nur Admin, autoritativ). */
export async function importFamilyAll(dump) {
  if (!isAdmin()) throw new Error('Nur Administrator:innen dürfen ein Vollbackup einspielen.');
  if (!dump || typeof dump !== 'object' || dump.app !== 'catofit' || dump.kind !== 'family-full'
      || !dump.family || !Array.isArray(dump.family.members) || typeof dump.users !== 'object') {
    throw new Error('Keine gültige Vollbackup-Datei.');
  }
  if (typeof dump.version === 'number' && dump.version > FULL_EXPORT_VERSION) throw new Error('Das Vollbackup stammt aus einer neueren App-Version.');
  if (!dump.family.members.some((m) => m && m.role === 'admin')) throw new Error('Das Vollbackup enthält keine Admin-Person – Wiederherstellung abgebrochen.');

  const areas = fullBackupAreas();
  let usersRestored = 0; let areasRestored = 0;

  // 1) Familie autoritativ ersetzen (Mitglieder/Settings/Lager als Datensätze).
  familyReplaceFrom(dump.family);

  // 2) Je Mitglied alle enthaltenen Bereiche autoritativ als replace-Op schreiben.
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
      // lokal (records LS) + autoritativ pushen bzw. als Op puffern.
      writeUserArea(id, a, records);
      const op = { op: 'replace', records: records.map(stripRev) };
      if (isOnline()) {
        pushOps(a, [op], { user: id }).catch(() => queueUserOp(id, a, op));
      } else {
        queueUserOp(id, a, op);
      }
      areasRestored++; touched = true;
    }
    if (touched) usersRestored++;
  }

  // 3) Aktuelle Sicht neu laden (Zyklus bleibt erhalten – nie im Vollbackup).
  if (activeUser) { loadUserFromLS(); AREAS.forEach((a) => notify(a, 'local')); }
  return { users: usersRestored, areas: areasRestored };
}

/** Eine Op in die persistente Queue eines (evtl. nicht aktiven) Nutzers legen. */
function queueUserOp(user, area, op) {
  if (user === activeUser) { enqueueOp(area, op); return; }
  const m = readMeta(user);
  m.ops = m.ops || {}; (m.ops[area] ||= []).push(op);
  writeMeta(user, m);
}

/* ------------------------------- Familie -------------------------------- */
function readFamilyStoreLS() { try { return JSON.parse(localStorage.getItem(FAMILY_STORE_LS) || 'null'); } catch { return null; } }
function writeFamilyStoreLS() {
  try { localStorage.setItem(FAMILY_STORE_LS, JSON.stringify({ rev: familyStore.rev, records: familyStore.records, ops: familyOps })); } catch { /* voll */ }
}

/** Leitet die Sicht {members, settings, pantry, teams} aus den Datensätzen ab. */
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

const familyPusher = debounce(() => pushFamily(), 500);
function familyUpsert(rec) {
  const r = { ...rec, updatedAt: nowIso() };
  delete r.deleted;
  familyStore.records[r.id] = r;
  familyOps.push({ op: 'upsert', record: stripRev(r) });
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
function familyDelete(id) {
  const prev = familyStore.records[id] || {};
  familyStore.records[id] = { id, deleted: true, updatedAt: nowIso(), ...(prev._kind ? { _kind: prev._kind } : {}) };
  familyOps.push({ op: 'delete', id });
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}
/** Familie autoritativ aus einem {members, settings, pantry}-Objekt setzen. */
function familyReplaceFrom(fam) {
  const records = {};
  (fam.members || []).forEach((m) => { if (m && m.id) records[m.id] = { ...m, _kind: 'member' }; });
  records['__settings'] = { id: '__settings', _kind: 'settings', ...(fam.settings || {}) };
  records['__pantry'] = { id: '__pantry', _kind: 'pantry', items: Array.isArray(fam.pantry) ? fam.pantry : [] };
  (fam.teams || []).forEach((t) => { if (t && t.id) records[t.id] = { ...t, _kind: 'team', memberIds: Array.isArray(t.memberIds) ? t.memberIds : [] }; });
  familyStore.records = records;
  familyOps.push({ op: 'replace', records: Object.values(records).map(stripRev) });
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}

function applyFamilyServerRecords(records) {
  let changed = false;
  for (const sr of (records || [])) {
    const l = familyStore.records[sr.id];
    if (!l || (sr.rev || 0) > (l.rev || 0)) { familyStore.records[sr.id] = sr; changed = true; }
  }
  return changed;
}

async function pushFamily() {
  if (!familyOps.length) return;
  if (!isOnline()) { setSyncState('offline'); return; }
  const n = familyOps.length;
  const batch = familyOps.slice(0, n);
  try {
    const res = await pushOps('family', batch, { scope: 'family' });
    familyOps = familyOps.slice(n);
    applyFamilyServerRecords(res.records);
    familyStore.rev = Math.max(familyStore.rev || 0, res.rev || 0);
    rebuildFamily(); writeFamilyStoreLS();
    notify('family', 'sync'); notify('pantry', 'sync');
  } catch { setSyncState('error'); }
}

/** Familie synchronisieren: eigene Ops pushen, dann Änderungen pullen. */
async function syncFamily() {
  try {
    if (familyOps.length) await pushFamily();
    const res = await pullChanges('family', { scope: 'family', since: familyStore.rev || 0 });
    const changed = applyFamilyServerRecords(res.records);
    familyStore.rev = Math.max(familyStore.rev || 0, res.rev || 0);
    if (changed) { rebuildFamily(); }
    writeFamilyStoreLS();
    if (changed) { notify('family', 'sync'); notify('pantry', 'sync'); }
  } catch { /* offline -> später erneut */ }
}

/** Familienweite Daten (Mitglieder, Rollen, Einstellungen, Lager). */
export function getFamily() { return family; }
export function members() { return family.members || []; }
export function familySettings() { return family.settings || {}; }
export function activeUserId() { return activeUser; }
export function activeMember() { return (family.members || []).find((m) => m.id === activeUser) || null; }

/** Familie aktiv nachladen (für selbstheilende Login-/Team-Ansicht). */
export async function refreshFamily() {
  if (isOnline()) await syncFamily();
  return family.members || [];
}

/**
 * Familie setzen (Seeding/Bulk). `members` (falls gegeben) ist die autoritative
 * Mitgliederliste, `settings`/`pantry` werden gesetzt, wenn angegeben.
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
  // Teams: bei autoritativem Mitglieder-Reset (oder wenn `teams` gegeben) neu setzen/aufräumen.
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

/* ------------------------- Familien-Lager (pantry) ---------------------- */
export function familyPantry() { return family.pantry || []; }
export function setFamilyPantry(list) {
  familyUpsert({ id: '__pantry', _kind: 'pantry', items: Array.isArray(list) ? list : [] });
  notify('pantry', 'local');
  return family.pantry;
}

/* ----------------------------- Nutzer laden ----------------------------- */
function loadUserFromLS() {
  for (const area of AREAS) {
    const ls = readLS(area);
    state[area] = ls != null ? ls : (ARRAY_AREAS.includes(area) ? [] : {});
  }
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(userMetaKey(activeUser)) || 'null'); } catch { /* egal */ }
  revs = (meta && meta.revs) ? { ...meta.revs } : {};
  pendingOps = (meta && meta.ops) ? { ...meta.ops } : {};
}

/* --------------------------------- Init --------------------------------- */
export async function init() {
  // 1) Familie aus dem LocalStorage (offline-first) – fürs Anzeigen der Login-Kacheln.
  const fam = readFamilyStoreLS();
  if (fam && fam.records) {
    familyStore.rev = fam.rev || 0;
    familyStore.records = fam.records || {};
    familyOps = Array.isArray(fam.ops) ? fam.ops : [];
    rebuildFamily();
  }
  // Anmeldung der laufenden Browser-Sitzung wiederherstellen (sessionStorage):
  // überlebt Reloads (Theme-/Profil-/Plan-Änderungen laden die Seite neu), aber
  // NICHT den App-Neustart/das Schließen -> beim echten Start bleibt es bei
  // „immer neu anmelden". Den LEGACY-Schlüssel (dauerhaft, vor v3.2.0) verwerfen,
  // damit niemand ungewollt dauerhaft auto-angemeldet bleibt.
  try { localStorage.removeItem(IDENTITY_KEY); } catch { /* egal */ }
  identity = null;
  activeUser = null;
  let sess = null;
  try { sess = sessionStorage.getItem(SESSION_KEY); } catch { /* egal */ }
  if (sess && (family.members || []).some((m) => m.id === sess)) {
    identity = sess;
    activeUser = sess;
    loadUserFromLS();            // Daten offline-first laden; Server-Abgleich folgt unten
  } else if (sess) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
  }

  // 2) Online-Status spiegeln und bei Reconnect synchronisieren.
  onStatus((s) => { if (s === 'online') syncNow(); else setSyncState('offline'); });

  // 3) Hintergrund-Abgleich: Familie laden (Mitglieder fürs Login). Es ist noch
  //    niemand angemeldet – Nutzerdaten werden erst nach dem Login geladen.
  if (isOnline()) {
    await syncFamily();
    const ok = await ping().catch(() => false);
    if (!ok) { setSyncState('offline'); return; }
    // Wiederhergestellte Sitzung: existiert der Nutzer nach dem Familien-Sync noch?
    // Wenn nicht (z. B. auf einem anderen Gerät entfernt), sauber abmelden.
    if (activeUser && !(family.members || []).some((m) => m.id === activeUser)) {
      clearActiveUser();
    } else if (activeUser) {
      try { await syncNow(); } catch { /* bleibt offline-first */ }
    }
  } else {
    setSyncState('offline');
  }
}

/** Wechselt den betrachteten Nutzer (lädt dessen Bereiche, zeichnet neu). */
export async function setActiveUser(id) {
  if (!id) return;
  // Ausstehende Ops des bisherigen Nutzers noch wegschreiben (vor dem Wechsel).
  if (activeUser && activeUser !== id && isOnline()) {
    try { await pushAllAreas(activeUser); } catch { /* bleibt in der Queue */ }
  }
  activeUser = id;
  loadUserFromLS();
  AREAS.forEach((a) => notify(a, 'local'));
  if (isOnline()) await syncNow();
}

/** Meldet die angemeldete Person ab (zurück zum Familiendashboard). */
export function clearActiveUser() {
  identity = null;
  activeUser = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
  localStorage.removeItem(IDENTITY_KEY);
}

/** In-Memory-Daten des zuletzt aktiven Nutzers verwerfen (nach dem Abmelden). */
function resetState() {
  state.profile = {};
  ARRAY_AREAS.forEach((a) => { state[a] = []; });
  revs = {};
  pendingOps = {};
}

/**
 * Vollständig abmelden: noch ausstehende Änderungen (wenn online) wegschreiben,
 * dann Identität und die geladenen Daten im Speicher verwerfen. Danach ist nur
 * noch das Familien-/Login-Dashboard erreichbar (kein Auto-Login).
 */
export async function logout() {
  if (activeUser && isOnline()) {
    try { await pushAllAreas(activeUser); } catch { /* bleibt in der Queue (LocalStorage) */ }
  }
  clearActiveUser();
  resetState();
}

/* ------------------------------- Login / PIN ---------------------------- */
/**
 * PIN-Hash – **deterministisch in JEDEM Kontext** (reiner SHA-256, kein
 * crypto.subtle). Früher hing das an crypto.subtle (nur im secure context) mit
 * djb2-Fallback sonst → ein über http gesetzter PIN passte über https nicht mehr
 * (Aussperr-Gefahr). Jetzt überall gleich. Bewusst nur Frontend-Schutz.
 */
function pinHash(userId, pin) { return sha256Hex(`catofit:${userId}:${pin}`); }
/** Alt-Hash (djb2) aus früheren unsicheren Kontexten – nur noch fürs Verifizieren. */
function legacyPinHash(userId, pin) {
  const text = `catofit:${userId}:${pin}`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return 'fb' + h.toString(16);
}

export function memberHasPin(userId) {
  const m = (family.members || []).find((x) => x.id === userId);
  return !!(m && m.pinHash);
}
export async function verifyPin(userId, pin) {
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return false;
  if (!m.pinHash) return true;
  // Neuer (SHA-256) ODER alter (djb2) Hash – so funktionieren bestehende PINs weiter.
  return m.pinHash === pinHash(userId, pin) || m.pinHash === legacyPinHash(userId, pin);
}
export async function setMemberPin(userId, pin) {
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return;
  familyUpsert({ ...m, _kind: 'member', pinHash: pin ? pinHash(userId, pin) : null });
}

export async function login(userId, pin) {
  if (!(await verifyPin(userId, pin))) return false;
  identity = userId;
  // Anmeldung in der BROWSER-SITZUNG merken: überlebt Reloads (Theme-/Profil-/
  // Plan-Änderungen laden neu) – aber NICHT den App-Neustart/das Schließen
  // (sessionStorage), daher bleibt „immer neu anmelden" beim echten Start erhalten.
  try { sessionStorage.setItem(SESSION_KEY, userId); } catch { /* egal */ }
  await setActiveUser(userId);
  return true;
}

/** Logische Sicht eines Bereichs eines beliebigen Mitglieds (read-only). */
export async function peekUserArea(userId, area) {
  if (isOnline()) {
    try { return await apiGet(area, { user: userId }); } catch { /* fällt auf LS zurück */ }
  }
  const recs = readUserArea(userId, area);
  if (recs == null) return null;
  if (Array.isArray(recs)) return recs.filter((r) => !r.deleted).map(stripRev);
  return stripRev(recs);
}

/* --------------------------- Rollen / Mitverwaltung --------------------- */
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

/* ------------------------------- Mitglieder ----------------------------- */
export const MAX_MEMBERS = 32;
export const DEFAULT_PIN = '0000';

export async function addMember({ name, role = 'user', emoji = '🙂', color = '#3d8bff', pin = DEFAULT_PIN } = {}) {
  if (!isAdmin()) return null;
  if ((family.members || []).length >= MAX_MEMBERS) return null;
  const id = uid('u');
  familyUpsert({
    id, _kind: 'member', name: (name || 'Mitglied').trim(),
    role: role === 'admin' ? 'admin' : 'user', emoji, color,
    pinHash: pinHash(id, (pin || DEFAULT_PIN)), createdAt: nowIso(),
  });
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
  // Aus allen Teams entfernen, damit keine „Geister-Mitglieder" in Teams bleiben.
  (family.teams || []).forEach((t) => {
    if ((t.memberIds || []).includes(userId)) familyUpsert({ ...t, _kind: 'team', memberIds: (t.memberIds || []).filter((x) => x !== userId) });
  });
  if (activeUser === userId) backToSelf();
  deleteUserData(userId);
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${userId}:${a}`)); } catch { /* egal */ } });
  try { localStorage.removeItem(userMetaKey(userId)); } catch { /* egal */ }
  return true;
}

export function setFamilySetting(key, value) {
  if (!isAdmin()) return;
  familyUpsert({ id: '__settings', _kind: 'settings', ...(family.settings || {}), [key]: value });
}

/* ------------------------------- Teams ---------------------------------- */
/** Alle Teams (Untergruppen der Familie; ein Mitglied kann in mehreren sein). */
export function teams() { return family.teams || []; }
/** Teams, in denen `memberId` Mitglied ist. */
export function teamsOf(memberId) { return (family.teams || []).filter((t) => (t.memberIds || []).includes(memberId)); }
/** Aufgelöste Mitglieder eines Teams (in Anlege-Reihenfolge der Familie). */
export function teamMembers(teamId) {
  const t = (family.teams || []).find((x) => x.id === teamId);
  if (!t) return [];
  const ids = new Set(t.memberIds || []);
  return (family.members || []).filter((m) => ids.has(m.id));
}

export function addTeam({ name, emoji = '👥', color = '#3d8bff', memberIds = [] } = {}) {
  if (!isAdmin()) return null;
  const id = uid('t');
  familyUpsert({ id, _kind: 'team', name: (name || 'Team').trim(), emoji, color, memberIds: [...new Set(memberIds)], createdAt: nowIso() });
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
/** Setzt GENAU die Team-Zugehörigkeit eines Mitglieds (Zuordnung & Teamwechsel;
    Mehrfach-Mitgliedschaft erlaubt). Aktualisiert nur die betroffenen Teams. */
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

/* ----------------------- Ersteinrichtung / Reset ------------------------ */
/**
 * Legt den ALLERERSTEN Admin an (nur bei leerer Familie) und meldet ihn direkt
 * an. Umgeht bewusst die isAdmin()-Schranke von addMember, weil es noch keinen
 * Admin gibt. Die Ersteinrichtung (login.js) ruft das auf.
 */
export async function createFirstAdmin({ name, pin } = {}) {
  if ((family.members || []).length > 0) return null;   // nur bei leerer Installation
  // Vor dem Anlegen den Server abgleichen: Existiert dort bereits eine Familie
  // (z. B. auf einem anderen Gerät angelegt oder der Pull war beim Boot noch nicht
  // durch), KEINEN zweiten Admin erzeugen – das war eine Quelle „doppelter Nutzer".
  if (isOnline()) {
    try { await syncFamily(); } catch { /* offline -> lokal weiter */ }
    if ((family.members || []).length > 0) return null;
  }
  const id = uid('u');
  familyUpsert({
    id, _kind: 'member', name: (name || 'Admin').trim(), role: 'admin',
    emoji: '🏃', color: '#18b48a', pinHash: pinHash(id, pin || DEFAULT_PIN), createdAt: nowIso(),
  });
  if (isOnline()) { try { await pushFamily(); } catch { /* bleibt in der Queue */ } }
  identity = id;
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* egal */ }   // angemeldet bleiben (überlebt Reloads)
  await setActiveUser(id);
  setProfile({ name: (name || 'Admin').trim() });   // Profilname = Anzeigename (Begrüßung etc.)
  return id;
}

/** Befüllt die App mit Demodaten: Admin-Historie + 1–2 Demo-Mitglieder (nur Admin). */
export async function seedDemo(today = todayStr()) {
  if (!isAdmin()) return false;
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
  if (d.pantry) setFamilyPantry(d.pantry);  // gemeinsames Lager (Einkaufsliste zieht davon ab)

  // Echten, periodisierten Plan erzeugen (wie ein normaler Nutzer) und so rückdatieren,
  // dass die aktuelle Woche + absolvierte Einheiten enthalten sind (sonst stünde der
  // Plan-Start erst in der nächsten Woche und „Heute"/Kalender wären leer).
  try {
    const { createPlanForEvent, generatePlanUnits, makePhases } = await import('./plans.js');
    const { defaultCommitments, mkCommit } = await import('./commitments.js');
    const ev = d.self.events[0];
    const plan = createPlanForEvent(ev);
    const start = addDays(weekStartMonday(today), -14);
    const weeks = Math.max(plan.weeks, Math.ceil((diffDays(start, ev.date) + 1) / 7));
    const phases = makePhases(weeks);
    // Feste Termine der Demo: Mo/Mi Fußball + Sonntagsspiele ab ~2 Wochen – zeigt
    // konfigurierbare Termine, Datumsbereich und den Wochen-Check (Sa Long → So Spiel).
    const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: addDays(today, 12), durationMin: 120 })];
    let units = generatePlanUnits({ ...plan, startDate: start, weeks, phases, commitments }, ev, state.profile);
    units = units.map((u) => (u.date < today ? { ...u, status: 'erledigt' } : u));
    // v3.11.0: Mobility-Einheiten mit den (nach Nutzung) passendsten Übungen vorverknüpfen –
    // macht die Einheit↔Übungskatalog-Verknüpfung direkt in der Demo sichtbar.
    try {
      const { suggestedExercisesFor, sortByUsage } = await import('./exercises.js');
      const usage = exerciseUsage();
      units = units.map((u) => u.type === 'mobility'
        ? { ...u, exerciseIds: sortByUsage(suggestedExercisesFor(u.type), usage).slice(0, 2).map((e) => e.id) }
        : u);
    } catch { /* Übungs-Verknüpfung optional */ }
    patch('plans', plan.id, { startDate: start, weeks, phases, commitments, units, generated: true });
  } catch { /* Plan ist optional */ }

  const nameToId = { __self__: identity };
  for (const m of d.members) {
    const mem = await addMember({ name: m.name, role: m.role, emoji: m.emoji, color: m.color, pin: DEFAULT_PIN });
    if (!mem) continue;
    nameToId[m.name] = mem.id;
    for (const [area, records] of Object.entries(m.data)) {
      if (!Array.isArray(records) || !records.length) continue;
      writeUserArea(mem.id, area, records);
      const op = { op: 'replace', records: records.map(stripRev) };
      if (isOnline()) pushOps(area, [op], { user: mem.id }).catch(() => queueUserOp(mem.id, area, op));
      else queueUserOp(mem.id, area, op);
    }
    // Vollständiges, individuelles Mitglieder-Profil (Objekt-Bereich, kein Array).
    if (m.profile) {
      const prof = { id: 'profile', ...m.profile, updatedAt: nowIso() };
      writeUserArea(mem.id, 'profile', prof);
      const op = { op: 'upsert', record: stripRev(prof) };
      if (isOnline()) pushOps('profile', [op], { user: mem.id }).catch(() => queueUserOp(mem.id, 'profile', op));
      else queueUserOp(mem.id, 'profile', op);
    }
  }
  // Teams anlegen (Namen → IDs; '__self__' = Admin. Mehrfach-Mitgliedschaft möglich).
  for (const t of (d.teams || [])) {
    const memberIds = (t.memberNames || []).map((n) => nameToId[n]).filter(Boolean);
    addTeam({ name: t.name, emoji: t.emoji, color: t.color, memberIds });
  }
  if (isOnline()) { try { await syncNow(); } catch { /* egal */ } }
  return true;
}

/**
 * Setzt die App vollständig zurück: alle Mitglieder + Daten (Server & lokal) und
 * führt zur Ersteinrichtung zurück. Nur Admin. Unwiderruflich.
 */
export async function resetApp() {
  if (!isAdmin()) return false;
  const ids = (family.members || []).map((m) => m.id);
  if (isOnline()) {
    for (const id of ids) { try { await deleteUserData(id); } catch { /* weiter */ } }
  }
  // Familie autoritativ leeren (Tombstones auf dem Server).
  familyReplaceFrom({ members: [], settings: {}, pantry: [] });
  if (isOnline()) { try { await pushFamily(); } catch { /* egal */ } }
  // Lokalen App-Speicher verwerfen – NUR die Keys DIESER Umgebung (scopeKey-Präfix),
  // damit ein Reset der Abnahme-Instanz nicht den Speicher der Produktion auf
  // derselben Origin mitlöscht.
  try {
    const prefix = scopeKey('');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* egal */ }
  clearActiveUser();
  resetState();
  familyStore.records = {}; familyStore.rev = 0; familyOps = []; rebuildFamily();
  return true;
}

export { AREAS, ARRAY_AREAS };
