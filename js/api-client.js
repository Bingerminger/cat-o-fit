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

/** fetch mit Timeout und exponentiellem Backoff. */
async function request(url, opts = {}, { retries = 2, timeout = 9000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
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
  if (!json.ok) throw new Error(json.error || 'Ladefehler');
  return { rev: json.rev || 0, records: Array.isArray(json.records) ? json.records : [] };
}

/**
 * Wendet eine Operationsliste serverseitig an. Liefert { rev, records } –
 * die geänderten Datensätze mit ihrer neuen server-`rev`.
 * Ops: {op:'upsert', record} | {op:'delete', id} | {op:'replace', records}
 */
export async function pushOps(area, ops, opts = {}) {
  const res = await request(endpoint(area, { ...opts, action: 'ops' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Speicherfehler');
  return { rev: json.rev || 0, records: Array.isArray(json.records) ? json.records : [] };
}

/** Logische Sicht eines Bereichs (Liste/Objekt) – für Backup/Peek read-only. */
export async function apiGet(area, opts = {}) {
  const res = await request(endpoint(area, opts), { method: 'GET', headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Ladefehler');
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
    const res = await request(`${API}?action=foodfacts&q=${encodeURIComponent(q)}`,
      { method: 'GET', headers: { Accept: 'application/json' } }, { retries: 0, timeout: 6500 });
    const j = await res.json();
    return (j && j.found) ? { kcal100: j.kcal100, protein100: j.protein100 } : null;
  } catch { return null; }
}

/** Löscht das Datenverzeichnis eines Nutzers serverseitig (Mitglied entfernen). */
export async function deleteUserData(userId) {
  try {
    await request(`${API}?action=delete-user&user=${encodeURIComponent(userId)}`, { method: 'POST' }, { retries: 1 });
    return true;
  } catch { return false; }
}

/** Kurzer Verfügbarkeits-Check. */
export async function ping() {
  try {
    const res = await request(`${API}?action=ping`, {}, { retries: 0, timeout: 3500 });
    const json = await res.json();
    return !!json.ok;
  } catch { return false; }
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
        if (!json.ok) reject(new Error(json.error || 'Import fehlgeschlagen'));
        else resolve(json);
      } catch (e) { reject(new Error('Ungültige Serverantwort.')); }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload.'));
    xhr.ontimeout = () => reject(new Error('Zeitüberschreitung beim Upload.'));
    xhr.send(fd);
  });
}

/** URL für serverseitige .ics-Erzeugung (Download). */
export function icsUrl(scope, id, user) {
  const u = user ? `&user=${encodeURIComponent(user)}` : '';
  return `${API}?action=ics&scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}${u}`;
}
