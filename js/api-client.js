import { t, has, locale } from './i18n.js';
/* =========================================================================
   api-client.js — HTTP-Zugriff auf die PHP-API mit Retry.
   Seit v3.0.0 ist der Server die Merge-Autorität: Der Client schickt
   OPERATIONEN (pushOps) und holt Änderungen inkrementell (pullChanges).
   Die persistente Offline-/Op-Queue lebt im Store (storage.js), nicht hier.
   ========================================================================= */

// API-Basis relativ zur App ermitteln -> funktioniert in jedem Unterordner.
const API = new URL('api/api.php', location.href.split('#')[0]).href;

// Nur bei explizitem navigator.onLine === false als offline starten; ist der
// Wert unbekannt (manche Umgebungen liefern undefined), online annehmen – ein
// echter Ausfall zeigt sich ohnehin am fehlschlagenden fetch.
let online = navigator.onLine !== false;
const statusListeners = new Set();

export function isOnline() { return online; }
export function onStatus(cb) { statusListeners.add(cb); return () => statusListeners.delete(cb); }
function emitStatus(s) { statusListeners.forEach((l) => l(s)); }

window.addEventListener('online', () => { online = true; emitStatus('online'); });
window.addEventListener('offline', () => { online = false; emitStatus('offline'); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Text of a server error: the translation of its `code` (server.<code>, placeholders from the
    response), else the server's own (English) text, else the fallback. */
export function serverError(json, fallback = '') {
  const code = json && typeof json.code === 'string' ? json.code : '';
  if (code && has(`server.${code}`)) return t(`server.${code}`, json);
  return (json && json.error) || fallback;
}

/** Language (and country, if the language names one) for Open Food Facts: lc=de, lc=pt&cc=br. */
function foodLocaleQuery() {
  const [lc, cc] = locale().toLowerCase().split('-');
  return `&lc=${encodeURIComponent(lc)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}`;
}

/** Client-Fehler (4xx) werden nicht wiederholt – sie werden beim nächsten Versuch
    nicht besser (z. B. 413 „zu viele Operationen“). Ausnahmen: 408 und 429. */
function isFinalStatus(status) { return status >= 400 && status < 500 && status !== 408 && status !== 429; }

/** fetch mit Timeout und exponentiellem Backoff. Fehler tragen `status`, falls der
    Server geantwortet hat. */
async function request(url, opts = {}, { retries = 2, timeout = 9000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e && isFinalStatus(e.status)) break;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Baut eine Endpunkt-URL mit Nutzer-/Familien-Scope und optionalen Parametern. */
function endpoint(area, { user = null, scope = 'user', action = null, since = null } = {}) {
  let url = `${API}?area=${encodeURIComponent(area)}`;
  if (action) url += `&action=${encodeURIComponent(action)}`;
  if (scope === 'family') url += '&scope=family';
  else if (user) url += `&user=${encodeURIComponent(user)}`;
  if (since != null) url += `&since=${encodeURIComponent(since)}`;
  return url;
}

/**
 * Holt die Änderungen eines Bereichs ab der bekannten rev. Liefert
 * { rev, records } – records inkl. Tombstones, jeweils mit server-`rev`.
 */
export async function pullChanges(area, opts = {}) {
  const res = await request(endpoint(area, { ...opts, action: 'changes', since: opts.since ?? 0 }), {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.load')));
  return { rev: json.rev || 0, records: Array.isArray(json.records) ? json.records : [] };
}

/**
 * Wendet eine Operationsliste serverseitig an. Liefert { rev, records } –
 * die geänderten Datensätze mit ihrer neuen server-`rev`.
 * Ops: {op:'upsert', record} | {op:'delete', id} | {op:'replace', records}
 */
export async function pushOps(area, ops, opts = {}) {
  const { since = null, ...where } = opts;
  const res = await request(endpoint(area, { ...where, action: 'ops' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Mit `since` schickt ein Server mit 'ops-since' alle Änderungen seit dieser rev mit.
    body: JSON.stringify(since != null ? { ops, since } : { ops }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.save')));
  const ch = json.changes;
  return {
    rev: json.rev || 0,
    records: Array.isArray(json.records) ? json.records : [],
    rejected: Array.isArray(json.rejected) ? json.rejected : [],   // vom Server abgelehnte Ops (Familie)
    changes: ch && Array.isArray(ch.records) ? { rev: ch.rev || 0, records: ch.records } : null,
  };
}

/** Logische Sicht eines Bereichs (Liste/Objekt) – für Backup/Peek read-only. */
export async function apiGet(area, opts = {}) {
  const res = await request(endpoint(area, opts), { method: 'GET', headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.load')));
  return json.data;
}

/**
 * Open-Food-Facts-Nährwerte je 100 g/ml zu einem Zutatennamen (über den eigenen
 * Server-Proxy, server-seitig gecacht). Liefert {kcal100, protein100} oder null –
 * bei null (offline, Fehler, kein Treffer) nutzt der Aufrufer die lokale Heuristik.
 */
export async function foodfactsLookup(name) {
  const q = String(name || '').trim();
  if (!q || !online) return null;
  try {
    const res = await request(`${API}?action=foodfacts&q=${encodeURIComponent(q)}${foodLocaleQuery()}`,
      { method: 'GET', headers: { Accept: 'application/json' } }, { retries: 0, timeout: 6500 });
    const j = await res.json();
    return (j && j.found) ? { kcal100: j.kcal100, protein100: j.protein100 } : null;
  } catch { return null; }
}

/**
 * Produkt zu einem Strichcode (EAN/GTIN) über den eigenen Server-Proxy (Open Food Facts).
 * Liefert { name, kcal100, protein100 } oder null (offline, unbekannt, Fehler).
 */
export async function foodfactsBarcode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (!c || !online) return null;
  try {
    const res = await request(`${API}?action=foodfacts&code=${encodeURIComponent(c)}${foodLocaleQuery()}`,
      { method: 'GET', headers: { Accept: 'application/json' } }, { retries: 0, timeout: 6500 });
    const j = await res.json();
    return (j && j.found) ? { name: j.name, kcal100: j.kcal100 ?? null, protein100: j.protein100 ?? null } : null;
  } catch { return null; }
}

/** Löscht das Datenverzeichnis eines Nutzers serverseitig (Mitglied entfernen; Admin-Sitzung). */
export async function deleteUserData(userId) {
  try {
    await request(`${API}?action=delete-user&user=${encodeURIComponent(userId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, { retries: 1 });
    return true;
  } catch { return false; }
}

/* --------------------------- Server-Sitzung (v3.20.0) --------------------------- */
/**
 * POST mit JSON-Body an eine Aktion. Liefert { status, json } – auch bei 4xx (dann mit
 * maschinenlesbarem Grund `json.code`). Wirft nur, wenn der Server nicht erreichbar war.
 */
async function postAction(action, body, { timeout = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json: json && typeof json === 'object' ? json : {} };
  } finally {
    clearTimeout(timer);
  }
}

/** Antwort als Ergebnis { ok, … } oder null, wenn sie nicht zur Aktion passt. */
function actionResult({ json }, check) {
  if (json.ok === true && check(json)) return { ok: true, ...json };
  if (json.ok === false && json.code) return { ok: false, code: json.code, error: serverError(json), left: json.left, retryAfter: json.retryAfter };
  return null;
}

/**
 * PIN am Server prüfen und eine Sitzung (HttpOnly-Cookie) öffnen.
 * Liefert { ok:true, user, role, weakPin } | { ok:false, code, error, left, retryAfter }
 * oder null, wenn der Server nicht erreichbar war bzw. keine Sitzungen kennt.
 */
export async function serverLogin(user, pin) {
  if (!online) return null;
  try { return actionResult(await postAction('login', { user, pin }), (j) => j.user === user); } catch { return null; }
}

/** Sitzung am Server beenden (best effort). */
export async function serverLogout() {
  if (!online) return false;
  try { return (await postAction('logout', {}, { timeout: 4000 })).status === 200; } catch { return false; }
}

/** Wer ist am Server angemeldet? { user, role } oder null (nicht erreichbar/unbekannt). */
export async function serverSession() {
  if (!online) return null;
  try {
    const res = await request(`${API}?action=session`, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' }, { retries: 0, timeout: 5000 });
    const json = await res.json();
    return json && json.ok === true && 'user' in json ? { user: json.user || null, role: json.role || null } : null;
  } catch { return null; }
}

/** PIN setzen: eigene mit `old`, fremde als Admin. Ergebnis wie serverLogin (null = offline). */
export async function serverSetPin(user, pin, old = null) {
  if (!online) return null;
  try { return actionResult(await postAction('set-pin', old == null ? { user, pin } : { user, pin, old }), () => true); } catch { return null; }
}

/** Schlüssel für die Kalender-Links eines Mitglieds (oder null). */
export async function icsToken(user) {
  if (!online) return null;
  try {
    const r = actionResult(await postAction('ics-token', { user }), (j) => typeof j.token === 'string');
    return r && r.ok ? r.token : null;
  } catch { return null; }
}

/** Kurzer Verfügbarkeits-Check. Vor jedem Abgleich und vor der Server-Anmeldung mit
    2,5 s: `navigator.onLine` sagt unterwegs nichts darüber, ob der Heimserver antwortet (FE-08). */
export const REACH_TIMEOUT = 2500;
let features = [];
/** Kann der Server das (laut letztem ping)? Z. B. 'changes-all' (Sammelabruf), 'ops-since'. */
export function serverHas(feature) { return features.includes(feature); }

export async function ping(timeout = 3500) {
  if (!online) return false;
  try {
    const res = await request(`${API}?action=ping`, {}, { retries: 0, timeout });
    const json = await res.json();
    features = Array.isArray(json.features) ? json.features : [];
    return !!json.ok;
  } catch { return false; }
}

/**
 * Änderungen mehrerer Bereiche einer Person in EINER Anfrage (Server mit 'changes-all').
 * `since` = { bereich: rev }. Liefert { revs, changes: { bereich: [datensätze] }, locked }.
 */
export async function pullAllChanges(user, since) {
  const list = Object.entries(since).map(([a, r]) => `${a}:${Math.max(0, r | 0)}`).join(',');
  const res = await request(`${API}?action=changes-all&user=${encodeURIComponent(user)}&since=${encodeURIComponent(list)}`, {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.load')));
  return { revs: json.revs || {}, changes: json.changes || {}, locked: Array.isArray(json.locked) ? json.locked : [] };
}

/** Lädt einen Apple-Health-Export hoch und liefert die geparsten Kandidaten. */
export async function uploadHealthExport(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  // XHR statt fetch, damit ein Upload-Fortschritt angezeigt werden kann.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}?action=health-import`);
    xhr.timeout = 600000;
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (!json.ok) reject(new Error(serverError(json, t('errors.importFailed'))));
        else resolve(json);
      } catch (e) { reject(new Error(t('errors.badResponse'))); }
    };
    xhr.onerror = () => reject(new Error(t('errors.uploadNetwork')));
    xhr.ontimeout = () => reject(new Error(t('errors.uploadTimeout')));
    xhr.send(fd);
  });
}

/** URL für serverseitige .ics-Erzeugung (Download), mit Kalender-Schlüssel, falls vorhanden. */
export function icsUrl(scope, id, user, token = null) {
  const u = user ? `&user=${encodeURIComponent(user)}` : '';
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${API}?action=ics&scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}${u}${tokenQuery}`;
}
