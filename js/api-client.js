import { t, has, locale } from './i18n.js';
/* =========================================================================
   api-client.js — HTTP access to the PHP API with retry.
   Since v3.0.0 the server is the merge authority: the client sends
   OPERATIONS (pushOps) and fetches changes incrementally (pullChanges).
   The persistent offline/op queue lives in the store (storage.js), not here.
   ========================================================================= */

// Determine the API base relative to the app -> works in any subfolder.
const API = new URL('api/api.php', location.href.split('#')[0]).href;

// Start as offline only on an explicit navigator.onLine === false; if the
// value is unknown (some environments return undefined), assume online – a
// real outage shows up anyway as a failing fetch.
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

/** Client errors (4xx) are not retried – they do not get better on the next
    attempt (e.g. 413 "too many operations"). Exceptions: 408 and 429. */
function isFinalStatus(status) { return status >= 400 && status < 500 && status !== 408 && status !== 429; }

/** fetch with timeout and exponential backoff. Errors carry `status` if the
    server has answered. */
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

/** Builds an endpoint URL with user/family scope and optional parameters. */
function endpoint(area, { user = null, scope = 'user', action = null, since = null } = {}) {
  let url = `${API}?area=${encodeURIComponent(area)}`;
  if (action) url += `&action=${encodeURIComponent(action)}`;
  if (scope === 'family') url += '&scope=family';
  else if (user) url += `&user=${encodeURIComponent(user)}`;
  if (since != null) url += `&since=${encodeURIComponent(since)}`;
  return url;
}

/**
 * Fetches the changes of an area from the known rev. Returns
 * { rev, records } – records including tombstones, each with the server `rev`.
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
 * Applies an operation list on the server. Returns { rev, records } –
 * the changed records with their new server `rev`.
 * Ops: {op:'upsert', record} | {op:'delete', id} | {op:'replace', records}
 */
export async function pushOps(area, ops, opts = {}) {
  const { since = null, ...where } = opts;
  const res = await request(endpoint(area, { ...where, action: 'ops' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // With `since`, a server with 'ops-since' sends along all changes since this rev.
    body: JSON.stringify(since != null ? { ops, since } : { ops }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.save')));
  const ch = json.changes;
  return {
    rev: json.rev || 0,
    records: Array.isArray(json.records) ? json.records : [],
    rejected: Array.isArray(json.rejected) ? json.rejected : [],   // rejected: Array.isArray(json.rejected) ? json.rejected : [],   // ops rejected by the server (family)
    changes: ch && Array.isArray(ch.records) ? { rev: ch.rev || 0, records: ch.records } : null,
  };
}

/** Logical view of an area (list/object) – read-only, for backup/peek. */
export async function apiGet(area, opts = {}) {
  const res = await request(endpoint(area, opts), { method: 'GET', headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (!json.ok) throw new Error(serverError(json, t('errors.load')));
  return json.data;
}

/**
 * Open Food Facts nutrition values per 100 g/ml for an ingredient name (via the own
 * server proxy, cached server-side). Returns {kcal100, protein100} or null –
 * on null (offline, error, no match) the caller uses the local heuristic.
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
 * Product for a barcode (EAN/GTIN) via the own server proxy (Open Food Facts).
 * Returns { name, kcal100, protein100 } or null (offline, unknown, error).
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

/** Deletes a user's data directory on the server (remove a member; admin session). */
export async function deleteUserData(userId) {
  try {
    await request(`${API}?action=delete-user&user=${encodeURIComponent(userId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, { retries: 1 });
    return true;
  } catch { return false; }
}

/* --------------------------- Server session (v3.20.0) --------------------------- */
/**
 * POST with a JSON body to an action. Returns { status, json } – also for 4xx (then with a
 * machine-readable reason `json.code`). Only throws if the server was unreachable.
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

/** Response as a result { ok, … } or null if it does not fit the action. */
function actionResult({ json }, check) {
  if (json.ok === true && check(json)) return { ok: true, ...json };
  if (json.ok === false && json.code) return { ok: false, code: json.code, error: serverError(json), left: json.left, retryAfter: json.retryAfter };
  return null;
}

/**
 * Verify the PIN on the server and open a session (HttpOnly cookie).
 * Returns { ok:true, user, role, weakPin } | { ok:false, code, error, left, retryAfter }
 * or null if the server was unreachable or knows no sessions.
 */
export async function serverLogin(user, pin) {
  if (!online) return null;
  try { return actionResult(await postAction('login', { user, pin }), (j) => j.user === user); } catch { return null; }
}

/** End the session on the server (best effort). */
export async function serverLogout() {
  if (!online) return false;
  try { return (await postAction('logout', {}, { timeout: 4000 })).status === 200; } catch { return false; }
}

/** Who is signed in on the server? { user, role } or null (unreachable/unknown). */
export async function serverSession() {
  if (!online) return null;
  try {
    const res = await request(`${API}?action=session`, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' }, { retries: 0, timeout: 5000 });
    const json = await res.json();
    return json && json.ok === true && 'user' in json ? { user: json.user || null, role: json.role || null } : null;
  } catch { return null; }
}

/** Set a PIN: one's own with `old`, someone else's as admin. Result like serverLogin (null = offline). */
export async function serverSetPin(user, pin, old = null) {
  if (!online) return null;
  try { return actionResult(await postAction('set-pin', old == null ? { user, pin } : { user, pin, old }), () => true); } catch { return null; }
}

/** Key for a member's calendar links (or null). */
export async function icsToken(user) {
  if (!online) return null;
  try {
    const r = actionResult(await postAction('ics-token', { user }), (j) => typeof j.token === 'string');
    return r && r.ok ? r.token : null;
  } catch { return null; }
}

/** Short availability check. Before every sync and before the server sign-in, with
    2.5 s: `navigator.onLine` says nothing on the move about whether the home server answers (FE-08). */
export const REACH_TIMEOUT = 2500;
let features = [];
/** Can the server do this (according to the last ping)? E.g. 'changes-all' (bulk fetch), 'ops-since'. */
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
 * Changes of several areas of one person in ONE request (server with 'changes-all').
 * `since` = { area: rev }. Returns { revs, changes: { area: [records] }, locked }.
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

/** Uploads an Apple Health export and returns the parsed candidates. */
export async function uploadHealthExport(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file);
  // XHR instead of fetch so that upload progress can be shown.
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

/** URL for server-side .ics generation (download), with calendar key if present. */
export function icsUrl(scope, id, user, token = null) {
  const u = user ? `&user=${encodeURIComponent(user)}` : '';
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${API}?action=ics&scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}${u}${tokenQuery}`;
}
