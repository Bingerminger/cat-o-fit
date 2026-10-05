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
  pushOps, pullChanges, pullAllChanges, serverHas, apiGet, isOnline, onStatus, ping, REACH_TIMEOUT, deleteUserData,
  serverLogin, serverLogout, serverSession, serverSetPin,
} from './api-client.js';
import { uid, nowIso, debounce, todayStr, addDays, weekStartMonday, diffDays, scopeKey } from './ui.js';
import { sha256Hex } from './sha256.js';
import { migrateHealth } from './healthdata.js';
import { migrateLabs } from './labs.js';
import { migratePlans } from './program.js';
import { locale, t as tr } from './i18n.js';

const AREAS = ['profile', 'events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
const ARRAY_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
// Versiegelte Bereiche: append-only, nicht editier- oder löschbar (z. B. Urkunden/Reports).
const SEALED_AREAS = ['reports'];
// Alle Keys sind umgebungs-eindeutig (scopeKey), damit Prod & Abnahme auf
// derselben Origin ihren Speicher NICHT teilen (sonst „doppelte Nutzer“).
const IDENTITY_KEY = scopeKey('identity');  // LEGACY (vor v3.2.0): dauerhaft gemerkter Nutzer – wird nur noch verworfen
const SESSION_KEY = scopeKey('session');    // Anmeldung DIESER Browser-Sitzung (sessionStorage): überlebt Reloads, nicht den App-Neustart
const FAMILY_STORE_LS = scopeKey('familyStore');

let identity = null;                        // angemeldete Person (Rollen + Zyklus-Privatsphäre)
let activeUser = null;                      // gerade betrachteter Nutzer (steuert die Datenanzeige)
const LS = (area) => scopeKey(`${activeUser}:${area}`);

// Server-Sitzung (seit v3.20.0): Der Server gibt die privaten Bereiche nur an die
// angemeldete Person selbst heraus. `serverUser` = für wen dieser Browser nach
// unserem Wissen eine gültige Sitzung hat.
let serverUser = null;
let pendingServerPin = null;                // nach einer Offline-Anmeldung: später am Server nachholen
let sessionAsked = false;                   // PIN-Nachfrage ohne Server-Sitzung: einmal je Seitenaufruf
let lastLoginErr = null;

const state = {
  profile: {},
  events: [], plans: [], sessions: [], health: [],
  nutrition: [], shopping: [], checklist: [], cycle: [], reports: [], diary: [],
  labs: [], supplements: [],
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
// Jeder Schreibvorgang meldet, ob er gelang. Ein volles Kontingent
// (QuotaExceededError) wird nie still verschluckt: Die Änderung wird zurückgerollt
// und die Oberfläche zeigt einen Hinweis (Event 'catofit:storage-full').
let storageFullAt = 0;
function reportStorageFull(e) {
  console.warn('Device storage full?', e);
  setSyncState('full');
  const now = Date.now();
  if (now - storageFullAt < 3000) return;          // nicht für jeden Einzelschreibvorgang
  storageFullAt = now;
  try { window.dispatchEvent(new Event('catofit:storage-full')); } catch { /* ohne DOM */ }
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
  adoptForeignOps();   // Ops anderer Tabs übernehmen, bevor die Queue überschrieben wird
  return safeSet(userMetaKey(activeUser), JSON.stringify({ revs, ops: pendingOps }));
}
function readUserArea(user, area) { try { return JSON.parse(localStorage.getItem(scopeKey(`${user}:${area}`)) || 'null'); } catch { return null; } }
function writeUserArea(user, area, val) { return safeSet(scopeKey(`${user}:${area}`), JSON.stringify(val)); }
function readMeta(user) {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(userMetaKey(user)) || 'null'); } catch { /* egal */ }
  m = m || { revs: {}, ops: {} };
  m.revs = m.revs || {};
  m.ops = normalizeOps(m.ops);
  return m;
}
function writeMeta(user, m) { return safeSet(userMetaKey(user), JSON.stringify(m)); }

/* ------------------------------- Merge ---------------------------------- */
function stripRev(r) { const c = { ...r }; delete c.rev; return c; }

/** Inhalt eines Datensatzes ohne die Felder, die der Server beim Speichern setzt
    (rev, updatedAt) – Schlüssel sortiert, damit die Reihenfolge nicht zählt. */
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
 * Server-Datensätze in eine lokale Datensatzliste mischen: höhere rev gewinnt.
 * `changed`: mindestens eine Fassung wurde übernommen (muss gespeichert werden);
 * `visible`: dabei hat sich wirklich Inhalt geändert. Kommen nur die eigenen, schon
 * bekannten Datensätze mit neuer rev zurück, muss keine Ansicht neu zeichnen (FE-12).
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

/** Server-Datensätze in den State des AKTIVEN Nutzers übernehmen ({ changed, visible }
    wie bei mergeRecords). */
function applyServerRecords(area, records) {
  const none = { changed: false, visible: false };
  if (!records || !records.length) return none;
  if (area === 'profile') {
    // Bei MEHREREN Profil-Upserts in einem Batch liefert der Server mehrere
    // 'profile'-Records – den mit der HÖCHSTEN rev nehmen (zuletzt angewandt),
    // nicht den ersten. Sonst überschreibt eine ältere Version neuere Felder
    // (z. B. ging der Standort bei seedDemo / schnellen Profil-Edits verloren).
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
    // Private Bereiche einer anderen Person warten bewusst auf deren eigene Anmeldung –
    // das ist kein Verbindungsproblem und soll nicht dauerhaft „Offline“ anzeigen.
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

/* ------------------------------ Op-Queue/Push --------------------------- */
// Jede Op trägt eine eindeutige `opId`. Nach einem Push werden genau die gesendeten
// Ops entfernt – nicht „die ersten n“ –, auch wenn sich die Queue inzwischen geändert
// hat (Nutzerwechsel, zweiter Tab, Verdichtung). Der Server ignoriert das Feld.
function withOpId(op) { return op && op.opId ? op : { ...op, opId: uid('op') }; }
function normalizeOps(opsByArea) {
  const out = {};
  for (const a in (opsByArea || {})) out[a] = (Array.isArray(opsByArea[a]) ? opsByArea[a] : []).map(withOpId);
  return out;
}
// opIds, die dieser Tab aus der Queue genommen hat (bestätigt, verdichtet), und Ops,
// die er aus einem anderen Tab übernommen hat.
const retired = new Set();
const adopted = new Set();
function retire(ops) {
  for (const o of ops) if (o && o.opId) { retired.add(o.opId); adopted.delete(o.opId); }
  if (retired.size > 20000) { const keep = [...retired].slice(-10000); retired.clear(); keep.forEach((id) => retired.add(id)); }
}
function opRecordId(o) { return o.op === 'upsert' ? (o.record && o.record.id) : (o.op === 'delete' ? o.id : null); }

/** Verdichtet beim Anhängen: eine replace-Op ersetzt alles Vorherige; eine upsert-/
    delete-Op ersetzt ältere Ops desselben Datensatzes (nach der letzten replace-Op). */
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
  // Innerhalb der neuen Ops ebenfalls nur die letzte je Datensatz behalten.
  const lastIdx = new Map();
  adds.forEach((o, i) => { const id = opRecordId(o); if (id != null) lastIdx.set(id, i); });
  const addsKept = adds.filter((o, i) => { const id = opRecordId(o); return id == null || lastIdx.get(id) === i || o.op === 'replace'; });
  retire(dropped);
  return [...kept, ...addsKept];
}

/** Hängt Ops an die Queue des aktiven Nutzers (verdichtet, mit opId). */
function queueOps(area, ops) {
  const withIds = ops.map(withOpId);
  pendingOps[area] = compactAppend(pendingOps[area] || [], withIds);
  return withIds;
}

/**
 * Lokale Änderung als Einheit festschreiben: erst die Queue, dann den Bereich.
 * Scheitert einer der beiden Schreibvorgänge (Gerätespeicher voll), wird alles
 * zurückgerollt – die App zeigt nie „gespeichert“ für etwas, das nicht gesichert ist.
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

/** Op in die Queue des AKTIVEN Nutzers legen und persistieren (ohne Bereichsänderung). */
function enqueueOp(area, op) {
  queueOps(area, [op]);
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

/** Ausstehende Ops eines Nutzers/Bereichs – im Speicher (aktiv) oder im LocalStorage. */
function queueOf(user, area) {
  return user === activeUser ? (pendingOps[area] || []) : (readMeta(user).ops[area] || []);
}

// Der Server nimmt höchstens 2000 Ops je Anfrage an. Gesendet wird in Stücken; nach
// jedem bestätigten Stück wird die Queue gekürzt. Ein 413 halbiert die Stückgröße.
const PUSH_CHUNK = 500;
const inflight = new Map();   // `${user}|${area}` -> laufender Push

/** Ausstehende Ops eines Bereichs an den Server schicken (nutzergenau). Ein zweiter
    Aufruf für denselben Nutzer/Bereich wartet auf den laufenden, statt doppelt zu senden. */
function pushArea(area, user) {
  if (!user) return Promise.resolve();
  // Private Bereiche nimmt der Server nur von der angemeldeten Person selbst an –
  // bis dahin bleiben die Ops sicher in der Queue.
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

/** Liegen im LocalStorage eines Nutzers noch Alt-Ops ohne opId? */
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
    else if (metaLacksOpIds(user) && !writeMeta(user, readMeta(user))) return;  // Alt-Ops dauerhaft mit opId versehen
    const ops = queueOf(user, area);
    if (!ops.length) break;
    if (!isOnline()) { setSyncState('offline'); return; }
    const batch = ops.slice(0, chunk);
    setSyncState('syncing');
    // Für die aktive Person gleich alle Änderungen seit der eigenen Marke mitholen.
    const since = user === activeUser && serverHas('ops-since') ? (revs[area] || 0) : null;
    let res;
    try {
      res = await pushOps(area, batch, since != null ? { user, since } : { user });
    } catch (e) {
      if (e && e.status === 413 && chunk > 1) { chunk = Math.max(1, Math.floor(chunk / 2)); continue; }
      if (e && (e.status === 401 || e.status === 403) && PRIVATE_AREAS.includes(area)) { sessionLost(); return; }
      setSyncState('error');          // Ops bleiben in der Queue -> später erneut
      return;
    }
    const sent = new Set(batch.map((o) => o.opId));
    retire(batch);
    // Nach dem await NEU entscheiden, wo die Ops liegen (der Nutzer kann gewechselt haben).
    // Die Hochwassermarke (revs) wird hier bewusst NICHT fortgeschrieben: Die Push-Antwort
    // trägt die globale Bereichs-rev, enthält aber nur die eigenen Datensätze. Fremde
    // Änderungen dazwischen kämen sonst nie mehr beim Pull an.
    if (user === activeUser) {
      pendingOps[area] = (pendingOps[area] || []).filter((o) => !sent.has(o.opId));
      applyServerRecords(area, res.records);
      writeLS(area); writeUserMeta();
      // Kamen alle Änderungen seit der Marke mit, darf sie – anders als oben – vorrücken.
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

/** Server-Datensätze in den gespeicherten Bereich eines (nicht aktiven) Nutzers mischen. */
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

/** Alle ausstehenden Ops eines Nutzers wegschreiben (z. B. vor Sichtwechsel). */
async function pushAllAreas(user) {
  for (const area of AREAS) await pushArea(area, user);
}

/** Ops übernehmen, die ein anderer Tab desselben Nutzers in die Queue gelegt hat, und
    übernommene Ops verwerfen, die jener Tab inzwischen selbst gesendet hat. */
function adoptForeignOps() {
  if (!activeUser) return;
  let disk = null;
  try { disk = JSON.parse(localStorage.getItem(userMetaKey(activeUser)) || 'null'); } catch { return; }
  const diskOps = (disk && disk.ops) || {};
  const areas = new Set([...Object.keys(diskOps), ...Object.keys(pendingOps)]);
  for (const area of areas) {
    const onDisk = new Set((diskOps[area] || []).map((o) => o && o.opId).filter(Boolean));
    let list = pendingOps[area] || [];
    // Übernommene Ops, die der andere Tab erledigt hat, nicht erneut senden.
    const stale = list.filter((o) => adopted.has(o.opId) && !onDisk.has(o.opId));
    if (stale.length) { const s = new Set(stale.map((o) => o.opId)); list = list.filter((o) => !s.has(o.opId)); stale.forEach((o) => adopted.delete(o.opId)); }
    const mine = new Set(list.map((o) => o.opId));
    const extra = (diskOps[area] || []).filter((o) => o && o.opId && !mine.has(o.opId) && !retired.has(o.opId));
    if (extra.length) { extra.forEach((o) => adopted.add(o.opId)); list = [...list, ...extra]; }
    if (stale.length || extra.length) pendingOps[area] = list;
  }
}

/** Ops fremder Nutzer (z. B. aus einer Wiederherstellung), die noch im LocalStorage
    warten, nachsenden – nur für Mitglieder, die es noch gibt. */
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
    // Private Bereiche anderer Personen warten, bis sie sich selbst anmelden.
    for (const area of Object.keys(ops)) {
      if ((ops[area] || []).length && !PRIVATE_AREAS.includes(area)) await pushArea(area, u);
    }
  }
}

/* -------------------------------- Lesen --------------------------------- */
/** Sichtbare Einträge eines Bereichs (ohne Tombstones). Körper-, Labor- und Plandaten
    kommen lesend umgedeutet heraus (fettfreie Masse, HRV-Messart, Magnesium-Art,
    Standard-Vorbelegung, Feldnamen alter Programmeinheiten) – gespeichert wird dabei
    nichts; das Backup exportiert die Rohdaten. */
export function get(area) {
  if (area === 'profile') return state.profile;
  if (!areaAllowed(area)) return [];   // private Bereiche (Zyklus) beim Verwalten fremder Mitglieder NICHT ausgeben
  const live = (state[area] || []).filter((r) => !r.deleted);
  if (area === 'health') return migrateHealth(live);
  if (area === 'labs') return migrateLabs(live);
  if (area === 'plans') return migratePlans(live);
  return live;
}
/** Roh inkl. Tombstones (für Persistenz/Debug). */
export function getRaw(area) { return state[area]; }
export function find(area, id) { return (state[area] || []).find((r) => r.id === id && !r.deleted) || null; }
export function profile() { return state.profile; }
export function settings() { return state.profile.settings || {}; }

// Open Food Facts (Nährwerte online ergänzen): Profile, die ab v3.20.0 entstehen, starten
// mit „aus“ (Opt-in) – bestehende behalten ihren bisherigen Stand (Standard war „an“).
const FOOD_LOOKUP_OPT_IN_SINCE = '2026-09-28';
export function foodLookupEnabled() {
  const s = settings();
  if (typeof s.foodLookup === 'boolean') return s.foodLookup;
  const m = (family.members || []).find((x) => x.id === activeUser);
  return !!(m && m.createdAt && String(m.createdAt) < FOOD_LOOKUP_OPT_IN_SINCE);
}

/* ------------------------------- Schreiben ------------------------------ */
/** Fügt einen Datensatz ein oder ersetzt ihn (per id). */
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
 * Mehrere Datensätze in EINEM Schreibvorgang einfügen/ersetzen (z. B. Importe mit
 * tausenden Tagen). Liefert die gespeicherten Datensätze (leer, wenn der
 * Gerätespeicher voll war – dann ist nichts verändert).
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

/** Aktualisiert Felder eines Datensatzes. */
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

/** Soft-Delete (Tombstone). */
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

/** Versiegelten Report/Urkunde ablegen (append-only). */
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

/** Ersetzt einen kompletten Bereich (z. B. nach Plan-Generierung) – autoritativ.
    Versiegelte Bereiche (Urkunden) und beim Verwalten gesperrte private Bereiche
    lassen sich so nicht überschreiben. Liefert, ob ersetzt wurde. */
export function replaceArea(area, records) {
  if (SEALED_AREAS.includes(area)) { console.warn(`Area “${area}” is sealed – addReport only.`); return false; }
  if (!areaAllowed(area)) { console.warn(`Area “${area}” is private and locked while managing.`); return false; }
  const prev = state[area];
  state[area] = (records || []).map((r) => ({ ...r }));
  const ok = commitLocal(area, [{ op: 'replace', records: state[area].map(stripRev) }], () => { state[area] = prev; });
  if (ok) notify(area, 'local');
  return ok;
}

/** Profil aktualisieren. */
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

/* ------------------- Übungs-Nutzung (Zähler, pro Nutzer) ----------------- */
/** Map { exerciseId: count } der bisher genutzten Übungen des angemeldeten Nutzers. */
export function exerciseUsage() { return (state.profile.settings || {}).exerciseUsage || {}; }
/** Zählt eine oder mehrere Übungen um +1 hoch (z. B. „Gemacht“ oder erledigte Einheit). */
export function bumpExerciseUsage(ids = []) {
  const u = { ...exerciseUsage() };
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => { if (id) u[id] = (u[id] || 0) + 1; });
  return setSetting('exerciseUsage', u);
}

/* --------------------------------- Sync --------------------------------- */
let syncRun = null;          // laufender Abgleich (Promise)
let syncPending = false;     // während des Laufs erneut angefordert -> noch eine Runde

async function pullArea(area, user) {
  const since = revs[area] || 0;
  const res = await pullChanges(area, { user, since });
  await applyPull(area, user, res, since);
}

/** Geholte Änderungen eines Bereichs übernehmen – aus dem Einzel- oder dem Sammelabruf
    oder mit einer Push-Antwort (`since` = die mitgeschickte Marke). */
async function applyPull(area, user, res, since) {
  if (activeUser !== user) return;
  // Liegt der Server UNTER der gemerkten Marke, wurde dort ein älterer Stand
  // zurückgesichert: Dann gilt der Server-Stand, und nur noch nicht gesendete
  // eigene Änderungen werden wieder darübergelegt.
  if ((res.rev || 0) < since) { await resyncArea(area, user); return; }
  const { changed, visible } = applyServerRecords(area, res.records);
  // Marke nur fortschreiben, wenn der Stand auch lokal gesichert ist – sonst fehlen
  // die Datensätze nach einem Neustart, obwohl die Marke sie als geholt ausweist.
  if (changed && !writeLS(area)) return;
  revs[area] = Math.max(revs[area] || 0, res.rev || 0);
  // Neu zeichnen nur bei echtem neuem Inhalt – nicht, weil die eigenen Datensätze
  // mit Server-rev zurückkommen (FE-12).
  if (visible) notify(area, 'sync');
  writeUserMeta();
}

/**
 * Vorsichtiges Mischen für den Voll-Abgleich (rev-Linien sind nach einer Rücksicherung
 * nicht vergleichbar): Die Server-Fassung gewinnt, wenn ihr Server-Zeitstempel nicht
 * älter ist als der lokale. Sonst bleibt die lokale Fassung, bekommt aber rev 0, damit
 * jede künftige Server-Änderung gewinnt. Lokal wird dabei NICHTS gelöscht: Hat der
 * Server Daten verloren (statt bewusst zurückgesichert), bleiben die Kopien auf den
 * Geräten erhalten.
 */
function mergeConservative(local, server) {
  if (!local) return server;
  if (!server) return { ...local, rev: 0 };
  return String(server.updatedAt || '') >= String(local.updatedAt || '') ? server : { ...local, rev: 0 };
}

/** Voll-Abgleich eines Bereichs (nach einer Rücksicherung bzw. wöchentlich). */
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

// Wöchentlicher Voll-Abgleich je Gerät und Nutzer: Eine Rücksicherung auf dem Server,
// nach der schon wieder genug geschrieben wurde, fällt am rev-Vergleich nicht mehr auf.
// Einmal pro Woche gilt deshalb der komplette Server-Stand (plus ausstehende Ops).
const FULL_RESYNC_MS = 7 * 24 * 3600 * 1000;
function fullResyncKey(user) { return scopeKey(`${user}:__fullSync`); }

/* ---------------------------- Server-Sitzung ---------------------------- */
/** Dürfen die privaten Bereiche dieses Nutzers jetzt mit dem Server abgeglichen werden?
    Nur für die angemeldete Person selbst und nur mit ihrer eigenen Server-Sitzung. */
function privateAllowed(user) { return !!user && user === identity && serverUser === identity; }

/** Der Server kennt die Sitzung nicht (mehr) – z. B. abgelaufen oder die PIN wurde auf
    einem anderen Gerät geändert. Die Oberfläche bittet dann um die PIN (app.js). */
function sessionLost() {
  serverUser = null;
  sessionAsked = true;
  try { window.dispatchEvent(new Event('catofit:session-required')); } catch { /* ohne DOM */ }
}

/** Server-Sitzung sicherstellen: nach einer Anmeldung ohne Serververbindung nachholen,
    nach einem Neuladen prüfen, ob das Cookie noch gilt. */
async function catchUpServerLogin() {
  if (!identity || serverUser === identity) return;
  if (pendingServerPin && pendingServerPin.user === identity) {
    const r = await serverLogin(identity, pendingServerPin.pin);
    if (r && r.ok) { serverUser = identity; pendingServerPin = null; return; }
    if (r) { pendingServerPin = null; sessionLost(); }   // PIN inzwischen geändert o. Ä.
    return;
  }
  const s = await serverSession();
  if (s && s.user === identity) serverUser = identity;
  // Der Server antwortet, kennt aber keine Sitzung dieser Person – nach dem Update von
  // v3.19.0 (dort gab es keine) oder nach 30 Tagen Leerlauf. Ohne Nachfrage blieben Zyklus,
  // Labor und Ergänzungen still liegen; „Später“ gilt bis zum nächsten Seitenaufruf.
  else if (s && !sessionAsked) sessionLost();
}

/** Hat diese Person eine Server-Sitzung? (Für Hinweise in der Oberfläche.) */
export function serverSessionActive() { return !!identity && serverUser === identity; }

/** Erneut am Server anmelden, ohne die Sitzung in der App zu verlassen. */
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

/** Sammelabruf (Server mit 'changes-all'): alles Ausstehende senden, dann die Änderungen aller Bereiche
    in EINER Anfrage holen. false = Server kann das nicht, der Einzelweg übernimmt. */
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
  // Private Bereiche gesperrt: Die Server-Sitzung ist abgelaufen – nach der PIN fragen.
  if (res.locked.length) sessionLost();
  for (const area of areas) {
    if (res.locked.includes(area) || res.revs[area] == null) continue;
    await applyPull(area, u, { rev: res.revs[area], records: res.changes[area] || [] }, since[area]);
    if (activeUser !== u) return true;
  }
  return true;
}

/** Ein Durchlauf für genau einen fixierten Nutzer: erst pushen, dann pullen. */
async function syncPass(u) {
  let last = 0;
  try { last = parseInt(localStorage.getItem(fullResyncKey(u)) || '0', 10) || 0; } catch { /* egal */ }
  const full = Date.now() - last > FULL_RESYNC_MS;
  // Neuer Server: eine Anfrage statt einer je Bereich. Der wöchentliche Voll-Abgleich bleibt Einzelweg.
  if (!full && serverHas('changes-all') && await syncPassBulk(u)) return;
  let allOk = true;
  for (const area of AREAS) {
    if (activeUser !== u) return;       // Sichtwechsel -> Pass verwerfen
    // Private Bereiche nur mit eigener Server-Sitzung (Ops warten so lange in der Queue).
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
 * Holt alle Bereiche vom Server und führt sie mit dem lokalen Stand zusammen. Läuft schon
 * ein Abgleich, wartet der Aufruf auf dessen Ende samt einer weiteren Runde – vorher kam er
 * sofort zurück, und wer danach „fertig“ meldete (oder prüfte), sah einen halben Stand.
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
        // Einmal kurz fragen, ob der Server antwortet – sonst liefen 13 Bereiche einzeln in
        // ihre Timeouts (unterwegs, Heimserver im Ruhezustand: Minuten, FE-08).
        // Wurde währenddessen erneut angefordert, folgt noch ein Versuch (while-Bedingung).
        if (!(await ping(REACH_TIMEOUT))) { unreachable = true; continue; }
        unreachable = false;
        await catchUpServerLogin();
        await syncFamily();
        if (activeUser) await syncPass(activeUser);
        if (activeUser) await pushForeignQueues();   // z. B. nachgereichte Wiederherstellungen
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
// Strikt privat: nie beim Verwalten fremder Mitglieder ausgeben/exportieren.
// `labs`/`supplements` sind Gesundheitsdaten im Sinne von Art. 9 DSGVO und werden
// deshalb genauso behandelt wie der Zyklus – auch Admins sehen sie nicht, und sie
// bleiben aus dem Familien-Vollbackup heraus (persönliches Backup enthält sie).
const PRIVATE_AREAS = ['cycle', 'labs', 'supplements'];
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
    // Rohdaten (ohne Lese-Umdeutung): Das Backup gibt genau zurück, was gespeichert ist.
    dump[a] = a === 'profile' ? stripRev({ ...state.profile }) : (state[a] || []).filter((r) => !r.deleted).map(stripRev);
  });
  return dump;
}

/** Spielt ein persönliches Backup ein (für den aktiven Nutzer, autoritativ). */
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
    // Private Bereiche eines verwalteten Mitglieds bleiben unangetastet – spiegelbildlich
    // zum Export, der sie beim Verwalten ebenfalls auslässt.
    if (managing && PRIVATE_AREAS.includes(a)) { privateSkipped.push(a); return; }
    if (a === 'profile') {
      const prev = state.profile;
      state.profile = { ...val, id: 'profile', updatedAt: nowIso() };
      if (!commitLocal('profile', [{ op: 'upsert', record: stripRev(state.profile) }], () => { state.profile = prev; })) { skipped.push(a); return; }
      notify('profile', 'local');
    } else if (SEALED_AREAS.includes(a)) {
      // Versiegelt (Urkunden/Berichte): nur ergänzen, was fehlt – nichts ersetzen oder löschen.
      const have = new Set((state[a] || []).map((r) => r.id));
      val.filter((r) => r && r.id && !have.has(r.id)).forEach((r) => addReport(r));
    } else if (!replaceArea(a, val)) {
      skipped.push(a); return;
    }
    imported.push(a);
  });
  return { imported, skipped, privateSkipped, user: dump.user || null, userName: dump.userName || null };
}

/* ----------------- Admin-Vollbackup (gesamte Familie) ------------------- */
const FULL_EXPORT_VERSION = 1;
function fullBackupAreas() { return AREAS.filter((a) => !PRIVATE_AREAS.includes(a)); }

/** Vollständiges Familien-Backup (nur Admin) – ohne private Zyklusdaten. */
export async function exportFamilyAll() {
  if (!isAdmin()) throw new Error(tr('storage.fullExportAdminOnly'));
  if (isOnline()) await syncFamily();   // Mitgliederliste frisch holen
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

/** Vollständiges Familien-Backup einspielen (nur Admin, autoritativ). */
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

  // 1) Familie autoritativ ersetzen (Mitglieder/Settings/Lager/Teams als Datensätze)
  //    und abwarten, bis der Server sie hat.
  familyReplaceFrom(dump.family);
  if (isOnline()) { try { await pushFamily(); } catch { /* bleibt in der Queue */ } }

  // 2) Je Mitglied und Bereich eine autoritative replace-Op vorbereiten.
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
  // Die eigene (aktive) Sicht sofort auf den wiederhergestellten Stand bringen – sonst
  // schriebe der folgende Push den alten Speicherstand über die Wiederherstellung.
  if (activeUser && jobs.some((j) => j.id === activeUser)) loadUserFromLS();

  // 3) Server-Stand je Bereich merken (baseRev): Wird eine Ersetzung erst später
  //    gesendet, überschreibt sie nichts, was das Mitglied inzwischen selbst erfasst hat.
  if (isOnline()) {
    await Promise.allSettled(jobs.map(async (j) => {
      const r = await pullChanges(j.a, { user: j.id, since: Number.MAX_SAFE_INTEGER });
      j.op.baseRev = r.rev || 0;
    }));
  }

  // 4) Erst dauerhaft in die Queues legen, dann senden und auf den Server warten.
  //    „Wiederhergestellt“ gilt erst, wenn der Server bestätigt hat; der Rest wird
  //    nachgereicht (pushForeignQueues beim nächsten Sync).
  jobs.forEach((j) => queueUserOp(j.id, j.a, j.op));
  if (isOnline()) await Promise.allSettled(jobs.map((j) => pushArea(j.a, j.id)));
  const pending = jobs.filter((j) => queueOf(j.id, j.a).some((o) => o.opId === j.op.opId)).length;

  // 5) Aktuelle Sicht neu laden (private Bereiche bleiben erhalten – nie im Vollbackup).
  if (activeUser) { loadUserFromLS(); AREAS.forEach((a) => notify(a, 'local')); }
  return { users: usersRestored, areas: areasRestored, pending };
}

/** Eine Op in die persistente Queue eines (evtl. nicht aktiven) Nutzers legen. */
function queueUserOp(user, area, op) {
  if (user === activeUser) { enqueueOp(area, op); return; }
  const m = readMeta(user);
  m.ops[area] = compactAppend(m.ops[area] || [], [withOpId(op)]);
  writeMeta(user, m);
}

/* ------------------------------- Familie -------------------------------- */
function readFamilyStoreLS() { try { return JSON.parse(localStorage.getItem(FAMILY_STORE_LS) || 'null'); } catch { return null; } }
function writeFamilyStoreLS() {
  return safeSet(FAMILY_STORE_LS, JSON.stringify({ rev: familyStore.rev, records: familyStore.records, ops: familyOps }));
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

/**
 * Mitglieds-Datensatz für den lokalen Speicher: PIN-Hashes bleiben seit v3.20.0 auf dem
 * Server; lokal steht nur `hasPin`. (Ältere Zwischenspeicher trugen noch den Hash.)
 */
function localFamilyRecord(r) {
  if (!r || (r._kind || 'member') !== 'member' || !('pinHash' in r)) return r;
  const c = { ...r };
  if (c.hasPin === undefined) c.hasPin = !!c.pinHash;
  delete c.pinHash;
  return c;
}
/** Datensatz für eine Familien-Op: ohne abgeleitete Felder. */
function familyOpRecord(r) { const c = stripRev(r); delete c.hasPin; return c; }

const familyPusher = debounce(() => pushFamily(), 500);
/** Familien-Datensatz lokal setzen und als Op senden. `pinHash` (optional) geht nur in die
    Op – der Server übernimmt ihn ausschließlich von einer Admin-Sitzung bzw. bei der
    Ersteinrichtung. */
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
/** Familie autoritativ aus einem {members, settings, pantry, teams}-Objekt setzen.
    Fehlt `teams` (Vollbackups vor v3.20.0 enthielten keine Teams), bleiben die
    vorhandenen Teams erhalten, statt still gelöscht zu werden. */
function familyReplaceFrom(fam) {
  const records = {};
  (fam.members || []).forEach((m) => { if (m && m.id) records[m.id] = { ...m, _kind: 'member' }; });
  records['__settings'] = { id: '__settings', _kind: 'settings', ...(fam.settings || {}) };
  records['__pantry'] = { id: '__pantry', _kind: 'pantry', items: Array.isArray(fam.pantry) ? fam.pantry : [] };
  const teamList = fam.teams !== undefined ? (fam.teams || []) : (family.teams || []);
  teamList.forEach((t) => { if (t && t.id) records[t.id] = { ...t, _kind: 'team', memberIds: Array.isArray(t.memberIds) ? t.memberIds : [] }; });
  // PIN-Hashes aus älteren Vollbackups gehen nur an den Server (Admin-Sitzung); fehlen
  // sie (Backups ab v3.20.0), behält der Server die gespeicherten PINs.
  const local = {};
  for (const id in records) local[id] = localFamilyRecord(records[id]);
  familyStore.records = local;
  familyOps.push(withOpId({ op: 'replace', records: Object.values(records).map(familyOpRecord) }));
  rebuildFamily(); writeFamilyStoreLS(); familyPusher();
}

/** Familien-Datensätze übernehmen; Rückgabe { changed, visible } wie bei mergeRecords. */
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

/** Vom Server abgelehnte Familien-Ops (fehlende Admin-Sitzung): lokale Fassung verwerfen
    und beim nächsten Abgleich den Server-Stand holen; die Oberfläche erfährt davon. */
function dropRejectedFamilyOps(rejected) {
  if (!rejected || !rejected.length) return;
  for (const r of rejected) if (r && r.id) delete familyStore.records[r.id];
  familyStore.rev = 0;
  rebuildFamily(); writeFamilyStoreLS();
  try {
    window.dispatchEvent(new CustomEvent('catofit:ops-rejected', { detail: { count: rejected.length, reason: rejected[0].reason || '' } }));
  } catch { /* ohne DOM */ }
}

let familyPushInflight = null;
/** Familien-Ops senden. Wie bei den Nutzerbereichen: nur die gesendeten Ops (per opId)
    entfernen und die Marke NICHT aus der Push-Antwort übernehmen (nur beim Pull). */
function pushFamily() {
  if (familyPushInflight) return familyPushInflight.then(() => pushFamily());
  familyPushInflight = pushFamilyNow().finally(() => { familyPushInflight = null; });
  return familyPushInflight;
}
async function pushFamilyNow() {
  familyOps = familyOps.map(withOpId);
  if (!familyOps.length) return;
  if (!isOnline()) { setSyncState('offline'); return; }
  // Admin-Änderungen braucht der Server mit Sitzung – eine offline begonnene Anmeldung zuerst nachholen.
  if (pendingServerPin) { try { await catchUpServerLogin(); } catch { /* egal */ } }
  const batch = familyOps.slice(0, PUSH_CHUNK);
  try {
    const res = await pushOps('family', batch, { scope: 'family' });
    const sent = new Set(batch.map((o) => o.opId));
    familyOps = familyOps.filter((o) => !sent.has(o.opId));
    const { visible } = applyFamilyServerRecords(res.records);
    const rejected = !!(res.rejected && res.rejected.length);
    dropRejectedFamilyOps(res.rejected);
    rebuildFamily(); writeFamilyStoreLS();
    // Die Antwort enthält die eigenen, schon angezeigten Datensätze – neu gezeichnet wird
    // nur, wenn der Server etwas anders gespeichert oder abgelehnt hat (FE-12).
    if (visible || rejected) { notify('family', 'sync'); notify('pantry', 'sync'); }
    if (familyOps.length) await pushFamilyNow();
  } catch { setSyncState('error'); }
}

/** Familie synchronisieren: eigene Ops pushen, dann Änderungen pullen. */
async function syncFamily() {
  try {
    if (familyOps.length) await pushFamily();
    const since = familyStore.rev || 0;
    const res = await pullChanges('family', { scope: 'family', since });
    if ((res.rev || 0) < since) {
      const full = await pullChanges('family', { scope: 'family', since: 0 });
      // Server ganz leer (neu aufgesetzt oder zurückgesetzt, etwa die ACC- oder TEST-Umgebung)
      // und nichts Ungesendetes auf dem Gerät: Der Zwischenspeicher ist veraltet – übernehmen.
      // Sonst zeigt die Anmeldung Profile, die der Server nicht kennt („Dieses Profil gibt es
      // nicht (mehr).“), und die Ersteinrichtung erscheint nie.
      if (!(full.records || []).some((r) => r && !r.deleted) && !familyOps.length) {
        adoptServerFamily(full);
        return;
      }
      // Server-Stand zurückgesichert: vorsichtig mischen (nichts lokal löschen).
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
  } catch { /* offline -> später erneut */ }
}

/** Familienstand des Servers vollständig übernehmen (Server ist maßgeblich; nur ohne
    ungesendete Familien-Änderungen aufrufen). Ist er leer, merkt sich der Store das für den
    Hinweis in der Ersteinrichtung. */
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
/** Wurde beim Abgleich ein leerer (neu aufgesetzter oder zurückgesetzter) Server erkannt? */
export function serverWasReset() { return serverReset && !(family.members || []).length; }

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
  pendingOps = normalizeOps(meta && meta.ops);   // Alt-Ops bekommen eine opId
}

/* ------------- Einmaliger Voll-Abgleich nach dem Sync-Fix (v3.20.0) ------------ */
// Bis v3.19.0 übernahm ein Push die globale Bereichs-rev als Marke; Geräte konnten so
// fremde Änderungen dauerhaft überspringen. Einmal je Gerät alle Marken verwerfen –
// der nächste Pull holt dann alles (Mischen nach rev ist idempotent).
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
      } catch { /* einzelner Eintrag egal */ }
    }
    familyStore.rev = 0;
    writeFamilyStoreLS();
    localStorage.setItem(HEAL_KEY, HEAL_VERSION);
  } catch { /* ohne Speicher: beim nächsten Start erneut */ }
}

/** Zwischengespeicherte Daten eines nur VERWALTETEN Mitglieds verwerfen (sie kommen
    per Pull wieder) – entlastet das Speicherkontingent. Wartende Ops bleiben. */
function evictUserCache(user) {
  if (!user || user === identity) return;
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${user}:${a}`)); } catch { /* egal */ } });
  const m = readMeta(user);
  const hasOps = Object.values(m.ops).some((l) => (l || []).length);
  try {
    if (hasOps) { m.revs = {}; localStorage.setItem(userMetaKey(user), JSON.stringify(m)); }
    else localStorage.removeItem(userMetaKey(user));
  } catch { /* egal */ }
}

/** Änderungen eines anderen Tabs desselben Nutzers übernehmen (Queue und Bereiche). */
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
try { if (typeof window.addEventListener === 'function') window.addEventListener('storage', onOtherTabWrite); } catch { /* ohne DOM */ }

/* --------------------------------- Init --------------------------------- */
export async function init() {
  // 1) Familie aus dem LocalStorage (offline-first) – fürs Anzeigen der Login-Kacheln.
  const fam = readFamilyStoreLS();
  if (fam && fam.records) {
    familyStore.rev = fam.rev || 0;
    // PIN-Hashes älterer Zwischenspeicher nicht weiter mitführen (nur noch `hasPin`).
    const recs = {};
    for (const id in (fam.records || {})) recs[id] = localFamilyRecord(fam.records[id]);
    familyStore.records = recs;
    familyOps = (Array.isArray(fam.ops) ? fam.ops : []).map(withOpId);
    rebuildFamily();
    if (Object.keys(fam.records || {}).some((id) => fam.records[id] && 'pinHash' in fam.records[id])) writeFamilyStoreLS();
  }
  healMarksOnce();
  // Anmeldung der laufenden Browser-Sitzung wiederherstellen (sessionStorage):
  // überlebt Reloads (Theme-/Profil-/Plan-Änderungen laden die Seite neu), aber
  // NICHT den App-Neustart/das Schließen -> beim echten Start bleibt es bei
  // „immer neu anmelden“. Den LEGACY-Schlüssel (dauerhaft, vor v3.2.0) verwerfen,
  // damit niemand ungewollt dauerhaft auto-angemeldet bleibt.
  try { localStorage.removeItem(IDENTITY_KEY); } catch { /* egal */ }
  identity = null;
  activeUser = null;
  serverUser = null;             // ob das Cookie noch gilt, klärt der erste Abgleich
  pendingServerPin = null;
  sessionAsked = false;
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

  // 3) Abgleich im HINTERGRUND: Die App zeichnet sofort aus dem lokalen Stand (FE-08) –
  //    vorher wartete der Start auf Familie, Ping und alle Bereiche (bei hängendem Server
  //    bis 32 s, danach erschien die Fehlerseite). Nur ein ganz neues Gerät (noch keine
  //    Familie lokal) wartet kurz auf die Mitgliederliste für die Anmeldung.
  const net = bootSync();
  if (!Object.keys(familyStore.records).length) await Promise.race([net, new Promise((r) => setTimeout(r, 6000))]);
}

/** Start-Abgleich: kurz prüfen, ob der Server antwortet, dann Familie und – bei
    wiederhergestellter Sitzung – die eigenen Bereiche. */
async function bootSync() {
  if (!isOnline()) { setSyncState('offline'); return; }
  if (!(await ping(REACH_TIMEOUT))) { setSyncState('offline'); return; }
  await syncFamily();
  // Wiederhergestellte Sitzung: existiert der Nutzer nach dem Familien-Sync noch?
  // Wenn nicht (z. B. auf einem anderen Gerät entfernt), sauber abmelden – die Ansicht
  // erfährt es über die Familien-Meldung und landet beim Neuzeichnen auf der Anmeldung.
  if (activeUser && !(family.members || []).some((m) => m.id === activeUser)) {
    clearActiveUser();
    notify('family', 'sync');
  } else if (activeUser) {
    // syncNow prüft dabei auch, ob die Server-Sitzung (Cookie) nach dem Neuladen noch gilt.
    try { await syncNow(); } catch { /* bleibt offline-first */ }
  }
}

/** Wechselt den betrachteten Nutzer (lädt dessen Bereiche, zeichnet neu). */
export async function setActiveUser(id) {
  if (!id) return;
  const prev = activeUser;
  // Ausstehende Ops des bisherigen Nutzers noch wegschreiben (vor dem Wechsel) – nur wenn
  // der Server antwortet; sonst bleiben sie in dessen Queue und gehen später raus.
  if (prev && prev !== id && isOnline() && await ping(REACH_TIMEOUT)) {
    try { await pushAllAreas(prev); } catch { /* bleibt in der Queue */ }
  }
  activeUser = id;
  loadUserFromLS();
  // Wer ein Mitglied nur verwaltet hat, braucht dessen Daten nicht dauerhaft im Speicher.
  if (prev && prev !== id && prev !== identity) evictUserCache(prev);
  AREAS.forEach((a) => notify(a, 'local'));
  // Abgleich im Hintergrund: Anmeldung und Profilwechsel warten nur auf den lokalen Stand;
  // was der Server Neues hat, zeichnet die Ansicht beim Eintreffen nach (FE-08).
  if (isOnline()) syncNow().catch(() => {});
}

/** Meldet die angemeldete Person ab (zurück zum Familiendashboard). */
export function clearActiveUser() {
  identity = null;
  activeUser = null;
  serverUser = null;
  pendingServerPin = null;
  sessionAsked = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
  try { sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* egal */ }
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
  if (serverUser && isOnline()) await serverLogout();
  const managed = activeUser && activeUser !== identity ? activeUser : null;
  clearActiveUser();
  if (managed) evictUserCache(managed);
  resetState();
  if (isSharedDevice()) wipePersonalData();
}

/* ------------------------- Gemeinsames Gerät (v3.20.0) ------------------------- */
// Auf einem geteilten Familien-iPad soll nach dem Abmelden nichts Persönliches im
// Browserspeicher bleiben. Der Schalter gilt je Gerät (nicht je Profil).
const SHARED_DEVICE_KEY = scopeKey('sharedDevice');
export function isSharedDevice() { try { return localStorage.getItem(SHARED_DEVICE_KEY) === '1'; } catch { return false; } }
export function setSharedDevice(on) {
  try { if (on) localStorage.setItem(SHARED_DEVICE_KEY, '1'); else localStorage.removeItem(SHARED_DEVICE_KEY); } catch { /* egal */ }
}
/**
 * Entfernt alle Personendaten aus dem Browserspeicher dieser Umgebung. Bleiben dürfen:
 * die Familienliste (für die Anmeldung), Geräte-Einstellungen und – nur falls noch nicht
 * gesendet – die wartenden Änderungen, damit nichts verloren geht.
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
    } catch { /* einzelner Schlüssel egal */ }
  }
}

/* ------------------------------- Login / PIN ---------------------------- */
/**
 * PIN-Hash – **deterministisch in JEDEM Kontext** (reiner SHA-256, kein
 * crypto.subtle; so bleibt ein über http gesetzter PIN auch über https gültig).
 * Seit v3.20.0 prüft der SERVER die PIN (gleiches Schema, api/auth.php); der Client
 * berechnet den Hash nur noch, wenn eine Admin-Person eine Start-PIN vergibt.
 */
function pinHash(userId, pin) { return sha256Hex(`catofit:${userId}:${pin}`); }

// Prüfwert dieses Geräts für die Anmeldung ohne Server – nur für Personen, die sich hier
// schon einmal mit Serververbindung angemeldet haben (eigenes Salz je Gerät).
const DEVICE_SALT_KEY = scopeKey('deviceSalt');
const PIN_LOCAL_KEY = scopeKey('pinLocal');
function deviceSalt() {
  let s = null;
  try { s = localStorage.getItem(DEVICE_SALT_KEY); } catch { /* egal */ }
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

// Hinweis „Standard-PIN noch nicht geändert“ (je Browser-Sitzung).
const WEAK_PIN_KEY = scopeKey('weakPin');
function setWeakPin(userId, weak) {
  try { if (weak) sessionStorage.setItem(WEAK_PIN_KEY, userId); else sessionStorage.removeItem(WEAK_PIN_KEY); } catch { /* egal */ }
}
/** Nutzt die angemeldete Person noch die Standard-PIN (oder gar keine)? */
export function pinIsWeak() {
  try { return !!identity && sessionStorage.getItem(WEAK_PIN_KEY) === identity; } catch { return false; }
}

export function memberHasPin(userId) {
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return false;
  return m.hasPin !== undefined ? !!m.hasPin : !!m.pinHash;
}

/** PIN-Regeln (gelten auch am Server): 4 bis 8 Ziffern, nicht die Standard-PIN 0000. */
export function pinProblem(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4,8}$/.test(p)) return tr('storage.pinLength');
  if (p === DEFAULT_PIN) return tr('storage.pinDefault');
  return null;
}

/**
 * PIN setzen – nur mit Serververbindung. Die eigene PIN verlangt die bisherige
 * (`oldPin`); die eines anderen Mitglieds darf nur eine Admin-Person neu setzen.
 * Liefert { ok } oder { ok:false, code, message }.
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

/** Grund der zuletzt gescheiterten Anmeldung: { code, message, left?, retryAfter? }. */
export function lastLoginError() { return lastLoginErr; }

/**
 * Anmelden. Mit Serververbindung prüft der Server die PIN und öffnet eine Sitzung
 * (Voraussetzung für Zyklus, Labor und Ergänzungen). Ohne Server geht es nur auf
 * Geräten, auf denen sich die Person schon einmal online angemeldet hat; die
 * Server-Anmeldung wird dann beim nächsten Abgleich nachgeholt.
 */
export async function login(userId, pin) {
  lastLoginErr = null;
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) { lastLoginErr = { code: 'unknown', message: tr('storage.profileGone') }; return false; }
  const p = String(pin ?? '');
  const hasPin = memberHasPin(userId);
  // Antwortet der Server nicht binnen 2,5 s, gilt die Anmeldung offline (PIN-Prüfung am
  // Gerät, Server-Sitzung wird nachgeholt) – vorher wartete das PIN-Sheet 17 s bis 6 min (FE-08).
  let r = isOnline() && await ping(REACH_TIMEOUT) ? await serverLogin(userId, p) : null;
  // Kennt der Server das Profil noch nicht (z. B. offline begonnene Ersteinrichtung),
  // erst die wartenden Familien-Änderungen senden und dann erneut anmelden.
  if (r && !r.ok && r.code === 'unknown' && familyOps.length) {
    try { await pushFamily(); } catch { /* egal */ }
    r = await serverLogin(userId, p);
  }
  // Kennt der Server das Profil trotzdem nicht, ist die Liste auf diesem Gerät veraltet
  // (anderswo entfernt oder Server neu aufgesetzt): Mitglieder vom Server übernehmen, damit
  // die Kachel verschwindet bzw. die Ersteinrichtung erscheint.
  if (r && !r.ok && r.code === 'unknown' && !familyOps.length) {
    try { adoptServerFamily(await pullChanges('family', { scope: 'family', since: 0 })); } catch { /* offline -> bleibt */ }
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
  // Anmeldung in der BROWSER-SITZUNG merken: überlebt Reloads (Theme-/Profil-/
  // Plan-Änderungen laden neu) – aber NICHT den App-Neustart/das Schließen
  // (sessionStorage), daher bleibt „immer neu anmelden“ beim echten Start erhalten.
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
  // Start-PIN (Standard 0000): Der Hash geht nur an den Server, der ihn von einer
  // Admin-Sitzung annimmt; lokal steht nur `hasPin`.
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
  // Aus allen Teams entfernen, damit keine „Geister-Mitglieder“ in Teams bleiben.
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
  // Die Admin-PIN ist Pflicht (seit v3.20.0): 4–8 Ziffern, nicht 0000.
  const problem = pinProblem(pin);
  if (problem) { lastLoginErr = { code: 'weak', message: problem }; return null; }
  // Vor dem Anlegen den Server abgleichen: Existiert dort bereits eine Familie
  // (z. B. auf einem anderen Gerät angelegt oder der Pull war beim Boot noch nicht
  // durch), KEINEN zweiten Admin erzeugen – das war eine Quelle „doppelter Nutzer“.
  if (isOnline()) {
    try { await syncFamily(); } catch { /* offline -> lokal weiter */ }
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
  if (isOnline()) { try { await pushFamily(); } catch { /* bleibt in der Queue */ } }
  identity = id;
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* egal */ }   // angemeldet bleiben (überlebt Reloads)
  // Server-Sitzung für die neue Admin-Person (für Admin-Aktionen und private Bereiche);
  // ohne Serververbindung wird sie beim nächsten Abgleich nachgeholt.
  const r = isOnline() ? await serverLogin(id, p) : null;
  if (r && r.ok) serverUser = id; else pendingServerPin = { user: id, pin: p };
  rememberDevicePin(id, p);
  await setActiveUser(id);
  setProfile({ name: (name || tr('account.admin')).trim() });   // Profilname = Anzeigename (Begrüßung etc.)
  return id;
}

/** Befüllt die App mit Demodaten: Admin-Historie + 1–2 Demo-Mitglieder (nur Admin). */
export async function seedDemo(today = todayStr()) {
  if (!isAdmin()) return false;
  // Nur für die Ersteinrichtung gebraucht – erst jetzt laden statt bei jedem Start (FE-19).
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
  if (d.pantry) setFamilyPantry(d.pantry);  // gemeinsames Lager (Einkaufsliste zieht davon ab)

  // Echten, periodisierten Plan erzeugen (wie ein normaler Nutzer) und so rückdatieren,
  // dass die aktuelle Woche + absolvierte Einheiten enthalten sind (sonst stünde der
  // Plan-Start erst in der nächsten Woche und „Heute“/Kalender wären leer).
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
    // Demo-Trainings mit den erledigten Einheiten verknüpfen (gleicher Tag, gleiche
    // Sportart) – sonst stünden sie im Kalender doppelt: als Einheit und als freies Training.
    const { linkDemoSessions } = await import('./planflow.js');
    const linked = linkDemoSessions(units, planPeriodSessions(d.self.sessions, start, today), today, ev.id);
    // Jede übrige erledigte Einheit (auch Fußball) bekommt ein passendes Training –
    // mit Dauer und Anstrengung, damit die Belastung die festen Termine enthält.
    const completed = completeDemoUnits(linked.units, linked.sessions, today, ev.id);
    units = completed.units;
    replaceArea('sessions', completed.sessions);
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
  // Ops der Demo-Mitglieder erst dauerhaft in deren Queues legen, dann senden: Ein
  // Neuladen mitten im Senden verliert so nichts (vorher: fire-and-forget).
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
    // Vollständiges, individuelles Mitglieder-Profil (Objekt-Bereich, kein Array).
    if (m.profile) {
      const prof = { id: 'profile', ...m.profile, updatedAt: nowIso() };
      writeUserArea(mem.id, 'profile', prof);
      queueUserOp(mem.id, 'profile', { op: 'upsert', record: stripRev(prof) });
      jobs.push([mem.id, 'profile']);
    }
  }
  if (isOnline()) await Promise.allSettled(jobs.map(([u, a]) => pushArea(a, u)));
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
  familyReplaceFrom({ members: [], settings: {}, pantry: [], teams: [] });
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
