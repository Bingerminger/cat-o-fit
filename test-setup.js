/* =========================================================================
   test-setup.js — Browser-Globals-Shim für die Node-Unit- UND UI-Tests.

   Die App-Module sind fürs Browser-Umfeld geschrieben. Hier stellen wir genug
   bereit, dass (a) reine Logik-Module in Node laden und der Store befüllbar ist
   und (b) die View-Module (el(), Render-Funktionen) gegen ein leichtgewichtiges,
   ABHÄNGIGKEITSFREIES Mini-DOM getestet werden können – kein jsdom, kein Build.

   Das Mini-DOM deckt genau die von ui.js `el()`/`append()` und charts.js (SVG)
   genutzten APIs ab: Knoten/Attribute/Klassen/Style/Events/textContent sowie ein
   einfacher querySelector(All) (tag, .class, #id, [attr], [attr="v"], Kommas).

   Wird via `node --import ./test-setup.js` vor den Tests geladen.
   ========================================================================= */
const g = globalThis;

/* ----------------------------- LocalStorage ----------------------------- */
// Mit simulierbarem Kontingent (Zeichen): `localStorage.__setQuota(n)` lässt setItem
// wie im Browser mit QuotaExceededError scheitern, sobald die Summe überschritten wird.
class MemStorage {
  constructor() { this._m = new Map(); this._quota = Infinity; }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) {
    const s = String(v);
    if (this._quota !== Infinity) {
      let used = 0;
      for (const [kk, vv] of this._m) if (kk !== k) used += kk.length + vv.length;
      if (used + String(k).length + s.length > this._quota) {
        const e = new Error('Das Kontingent ist erschöpft.'); e.name = 'QuotaExceededError'; throw e;
      }
    }
    this._m.set(k, s);
  }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
  key(i) { return Array.from(this._m.keys())[i] ?? null; }
  get length() { return this._m.size; }
  __setQuota(n) { this._quota = n; }
  __used() { let u = 0; for (const [k, v] of this._m) u += k.length + v.length; return u; }
}

/* ------------------------------- Mini-DOM ------------------------------- */
const ELEMENT_NODE = 1, TEXT_NODE = 3;

class ClassList {
  constructor(node) { this._node = node; this._set = new Set(); }
  add(...cs) { cs.forEach((c) => c && this._set.add(c)); this._flush(); }
  remove(...cs) { cs.forEach((c) => this._set.delete(c)); this._flush(); }
  toggle(c, force) {
    const want = force === undefined ? !this._set.has(c) : !!force;
    if (want) this._set.add(c); else this._set.delete(c);
    this._flush(); return want;
  }
  contains(c) { return this._set.has(c); }
  parse(v) { this._set = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  _flush() { this._node._className = [...this._set].join(' '); }
  toString() { return [...this._set].join(' '); }
}

class MiniNode {
  constructor(tag, ns) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tag ? String(tag).toUpperCase() : tag;
    this.nodeName = this.tagName;
    this.namespaceURI = ns || null;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.value = '';
    this._className = '';
    this._classList = new ClassList(this);
    this._listeners = {};
    this._innerHTML = '';
    this._text = '';
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === ELEMENT_NODE); }
  get firstChild() { return this.childNodes[0] || null; }
  get classList() { return this._classList; }
  set className(v) { this._className = String(v); this._classList.parse(v); }
  get className() { return this._className; }

  appendChild(n) { if (n == null) return n; if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
  append(...kids) { kids.forEach((k) => this.appendChild(typeof k === 'object' ? k : textNode(String(k)))); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  insertBefore(n, ref) { const i = this.childNodes.indexOf(ref); if (i < 0) return this.appendChild(n); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; }

  // Wie im Browser: Das value-ATTRIBUT füllt ein <textarea> nicht (nur die Eigenschaft).
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; if (k === 'value' && this.tagName !== 'TEXTAREA') this.value = v; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(ev, fn) { (this._listeners[ev] || (this._listeners[ev] = [])).push(fn); }
  removeEventListener(ev, fn) { if (this._listeners[ev]) this._listeners[ev] = this._listeners[ev].filter((f) => f !== fn); }
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((f) => f.call(this, ev)); return true; }
  click() { this.dispatchEvent({ type: 'click', target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }); }
  focus() {} blur() {}

  set textContent(v) { this.childNodes = []; if (v != null && v !== '') this.appendChild(textNode(String(v))); }
  get textContent() { return this.nodeType === TEXT_NODE ? this._text : this.childNodes.map((n) => n.textContent).join(''); }
  set innerHTML(v) { this.childNodes = []; this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML; }

  querySelector(sel) { return query(this, sel, true); }
  querySelectorAll(sel) { return query(this, sel, false); }
}

function textNode(t) { const n = new MiniNode(); n.nodeType = TEXT_NODE; n.nodeName = '#text'; n._text = t; return n; }

/** Sehr einfacher Selektor-Matcher: tag, .class, #id, [attr], [attr="v"]. */
function matchSel(node, sel) {
  sel = sel.trim(); if (!sel) return false;
  const tag = sel.match(/^[a-zA-Z][\w-]*/);
  if (tag && node.tagName !== tag[0].toUpperCase()) return false;
  for (const m of sel.matchAll(/\.([\w-]+)/g)) if (!node._classList.contains(m[1])) return false;
  for (const m of sel.matchAll(/#([\w-]+)/g)) if (node.attributes.id !== m[1]) return false;
  for (const m of sel.matchAll(/\[([\w-]+)(?:[*^$]?=["']?([^"'\]]*)["']?)?\]/g)) {
    const name = m[1], val = m[2];
    if (val === undefined) { if (!(name in node.attributes)) return false; }
    else if ((node.attributes[name] ?? '') !== val) return false;
  }
  return true;
}
function query(root, selector, firstOnly) {
  const sels = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (sels.some((s) => matchSel(child, s))) { out.push(child); if (firstOnly) return true; }
      if (walk(child)) return true;
    }
    return false;
  })(root);
  return firstOnly ? (out[0] || null) : out;
}

/** Test-Helfer: erzeugt einen frischen Render-Container (#view-artig). */
function makeViewRoot() { const v = new MiniNode('div'); v.setAttribute('id', 'view'); document.body.appendChild(v); return v; }

/* ------------------------------ Globals setzen --------------------------- */
function provide(name, value) {
  try { if (g[name] == null) Object.defineProperty(g, name, { value, writable: true, configurable: true }); }
  catch { /* read-only global -> unverändert lassen */ }
}
function force(name, value) {
  try { Object.defineProperty(g, name, { value, writable: true, configurable: true }); }
  catch { try { g[name] = value; } catch { /* non-configurable -> aufgeben */ } }
}

const document = {
  createElement: (tag) => new MiniNode(tag),
  createElementNS: (ns, tag) => new MiniNode(tag, ns),
  createTextNode: (t) => textNode(String(t)),
  createDocumentFragment: () => new MiniNode('#fragment'),
  getElementById: (id) => query(document.body, '#' + id, true),
  querySelector: (s) => query(document.body, s, true),
  querySelectorAll: (s) => query(document.body, s, false),
  body: new MiniNode('body'),
  documentElement: new MiniNode('html'),
  head: new MiniNode('head'),
  addEventListener() {}, removeEventListener() {},
};

force('localStorage', new MemStorage());
force('sessionStorage', new MemStorage());
provide('location', new URL('http://localhost/catofit/'));
force('document', document);
provide('navigator', { onLine: true, userAgent: 'catofit-test', serviceWorker: { register: async () => ({}) } });
// Node bringt ein eingebautes fetch mit -> hart überschreiben. Default: schnelle,
// LEERE Antwort (kein echter Netzzugriff, keine Retries). Tests, die echtes
// Sync-Verhalten prüfen, installieren ihren eigenen fetch-Mock (siehe sync.test.js).
force('fetch', async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rev: 0, records: [], data: [] }) }));
provide('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }));
provide('getComputedStyle', () => ({ getPropertyValue: () => '' }));
provide('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
provide('cancelAnimationFrame', (id) => clearTimeout(id));
// Fenster-Ereignisse: kleines Register, damit Tests z. B. 'offline'/'online' auslösen
// können (api-client.js lauscht darauf) und App-Ereignisse ('catofit:…') ankommen.
if (typeof g.addEventListener !== 'function') {
  const winListeners = {};
  g.addEventListener = (type, fn) => { (winListeners[type] ||= []).push(fn); };
  g.removeEventListener = (type, fn) => { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); };
  g.dispatchEvent = (ev) => { (winListeners[ev.type] || []).slice().forEach((f) => f(ev)); return true; };
}
if (typeof g.removeEventListener !== 'function') g.removeEventListener = () => {};
provide('window', g);

// Für UI-Tests importierbar machen.
g.__domTest = { MiniNode, textNode, query, makeViewRoot };

/* ---------------- Protokolltreuer Test-Server (opt-in, v3.20.0) -----------------
   Bildet api/storage.php nach: globale rev je Bereich, Tombstones, replace mit
   optionalem baseRev, höchstens 2000 Ops je Anfrage (sonst 413). Die Push-Antwort
   trägt – wie der echte Server – die GLOBALE Bereichs-rev, aber nur die eigenen
   Datensätze. Der frühere Standard-fetch („immer leer, immer OK“) hat genau die
   Sync-Fehler verdeckt, die dieser Server sichtbar macht.
   Nutzung: `const srv = __fakeServer.install();` – danach steuern
     srv.opts.latencyMs (Zahl oder (url, init) => ms), srv.opts.offline,
     srv.opts.failStatus, srv.opts.opLimit, srv.opts.features (['changes-all', 'ops-since'] =
     Sammelabruf und „since“ in der ops-Antwort) und srv.store(area, {user, scope}).
   Seit v3.20.0 bildet er auch api/auth.php nach: login/logout/session/set-pin/
   ics-token mit EINER simulierten Browser-Sitzung (srv.auth.session), Sperre der
   privaten Bereiche, Familien-Regeln (Admin-Sitzung, PIN-Hash nie in Antworten). */
function createFakeServer() {
  const stores = {};
  const requests = [];
  const DEFAULTS = { latencyMs: 0, offline: false, failStatus: null, failWhen: null, opLimit: 2000, features: [] };
  const opts = { ...DEFAULTS };
  const key = (area, scope, user) => `${scope}|${user || ''}|${area}`;
  const srv = (k) => (stores[k] ||= { rev: 0, records: {} });
  const resp = (o, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => o });
  const stripRev = (r) => { const c = { ...r }; delete c.rev; return c; };
  function applyOps(s, ops) {
    const now = new Date().toISOString();
    const applied = [];
    for (const op of ops) {
      if (op.op === 'upsert' && op.record && op.record.id) {
        const rec = { ...op.record, updatedAt: now, rev: ++s.rev }; delete rec.deleted;
        s.records[rec.id] = rec; applied.push(rec);
      } else if (op.op === 'delete' && op.id) {
        const prev = s.records[op.id] || {};
        const t = { id: op.id, deleted: true, updatedAt: now, rev: ++s.rev, ...(prev._kind ? { _kind: prev._kind } : {}) };
        s.records[op.id] = t; applied.push(t);
      } else if (op.op === 'replace' && Array.isArray(op.records)) {
        const base = typeof op.baseRev === 'number' ? op.baseRev : null;
        const newer = (r) => base !== null && (r.rev || 0) > base;
        const keep = new Set();
        for (const r of op.records) {
          if (!r || !r.id) continue;
          if (s.records[r.id] && newer(s.records[r.id])) { keep.add(r.id); continue; }
          const rec = { ...r, updatedAt: now, rev: ++s.rev }; delete rec.deleted;
          s.records[rec.id] = rec; applied.push(rec); keep.add(rec.id);
        }
        for (const id in s.records) {
          const r = s.records[id];
          if (!keep.has(id) && !r.deleted && !newer(r)) {
            const t = { id, deleted: true, updatedAt: now, rev: ++s.rev, ...(r._kind ? { _kind: r._kind } : {}) };
            s.records[id] = t; applied.push(t);
          }
        }
      }
    }
    return applied;
  }
  /* --- Anmeldung wie api/auth.php (ein simulierter Browser mit einem Sitzungs-Cookie) --- */
  const PRIVATE = ['cycle', 'labs', 'supplements'];
  const auth = { session: null, fails: {}, icsTokens: {} };
  const fam = () => srv(key('family', 'family', null));
  const member = (id) => { const r = fam().records[id]; return r && !r.deleted && (r._kind || 'member') === 'member' ? r : null; };
  const isHash = (h) => typeof h === 'string' && (/^[0-9a-f]{64}$/.test(h) || /^fb[0-9a-f]{1,8}$/.test(h));
  const legacy = (id, pin) => { const t = `catofit:${id}:${pin}`; let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return 'fb' + h.toString(16); };
  async function pinOk(m, id, pin) {
    if (!isHash(m.pinHash)) return true;
    const { sha256Hex } = await import('./js/sha256.js');
    return m.pinHash === sha256Hex(`catofit:${id}:${pin}`) || m.pinHash === legacy(id, pin);
  }
  const sessionRole = () => { const m = auth.session && member(auth.session); return m ? (m.role === 'admin' ? 'admin' : 'user') : null; };
  const publicRec = (r) => {
    if ((r._kind || 'member') !== 'member' || r.deleted) { const c = { ...r }; delete c.pinHash; return c; }
    const c = { ...r, hasPin: isHash(r.pinHash) }; delete c.pinHash;
    if (c.hasPin) c.pinHash = 'server';
    return c;
  };
  const hasAdmin = (s) => Object.values(s.records).some((r) => r && !r.deleted && (r._kind || 'member') === 'member' && r.role === 'admin');
  /** Familien-Op prüfen wie family_guard() in api/auth.php. */
  function familyGuard(op, s) {
    const admin = sessionRole() === 'admin';
    const trusted = admin || !hasAdmin(s);
    const clean = (rec) => {
      const c = { ...rec }; const incoming = c.pinHash; delete c.pinHash; delete c.hasPin;
      if ((c._kind || 'member') !== 'member') return c;
      const prev = s.records[c.id];
      if (trusted && isHash(incoming)) c.pinHash = incoming;
      else if (prev && !prev.deleted && isHash(prev.pinHash)) c.pinHash = prev.pinHash;
      return c;
    };
    if (op.op === 'upsert') {
      const rec = op.record || {}; const prev = s.records[rec.id]; const exists = !!(prev && !prev.deleted);
      const kind = rec._kind || (exists ? (prev._kind || 'member') : 'member');
      if (kind === 'member') {
        if (!exists && !trusted) return 'Neue Mitglieder nur mit Admin-Sitzung.';
        const oldRole = exists ? (prev.role === 'admin' ? 'admin' : 'user') : null;
        const newRole = (rec.role ?? oldRole ?? 'user') === 'admin' ? 'admin' : 'user';
        if (exists && oldRole !== newRole && !trusted) return 'Rollen nur mit Admin-Sitzung.';
      }
      return { ...op, record: clean(rec) };
    }
    if (op.op === 'delete') {
      const prev = s.records[op.id];
      if (prev && !prev.deleted && (prev._kind || 'member') === 'member' && !admin) return 'Entfernen nur mit Admin-Sitzung.';
      return op;
    }
    if (op.op === 'replace') {
      if (!trusted) return 'Ersetzen nur mit Admin-Sitzung.';
      return { ...op, records: (op.records || []).map(clean) };
    }
    return op;
  }
  async function authAction(action, u, init) {
    const body = init.body ? JSON.parse(init.body) : {};
    if (action === 'session') return resp({ ok: true, user: auth.session, role: sessionRole() });
    if (action === 'logout') { auth.session = null; return resp({ ok: true }); }
    if (action === 'login') {
      const m = member(body.user);
      if (!m) return resp({ ok: false, error: 'Dieses Profil gibt es nicht (mehr).', code: 'unknown' }, 404);
      if (isHash(m.pinHash)) {
        if ((auth.fails[body.user] || 0) >= 5) return resp({ ok: false, error: 'Zu viele Fehlversuche – bitte kurz warten.', code: 'locked', retryAfter: 900 }, 429);
        if (!(await pinOk(m, body.user, String(body.pin ?? '')))) {
          auth.fails[body.user] = (auth.fails[body.user] || 0) + 1;
          const left = 5 - auth.fails[body.user];
          return left > 0 ? resp({ ok: false, error: 'Falsche PIN.', code: 'pin', left }, 401)
            : resp({ ok: false, error: 'Zu viele Fehlversuche – bitte kurz warten.', code: 'locked', retryAfter: 900 }, 429);
        }
        delete auth.fails[body.user];
      }
      auth.session = body.user;
      return resp({ ok: true, user: body.user, role: m.role === 'admin' ? 'admin' : 'user', weakPin: !isHash(m.pinHash) || body.pin === '0000' });
    }
    if (!auth.session || !member(auth.session)) return resp({ ok: false, error: 'Bitte melde dich an.', code: 'session' }, 401);
    if (action === 'set-pin') {
      const m = member(body.user);
      if (!m) return resp({ ok: false, error: 'unbekannt', code: 'unknown' }, 404);
      if (auth.session === body.user) {
        if (isHash(m.pinHash) && !(await pinOk(m, body.user, String(body.old ?? '')))) return resp({ ok: false, error: 'Die bisherige PIN stimmt nicht.', code: 'pin', left: 4 }, 401);
      } else if (sessionRole() !== 'admin') return resp({ ok: false, error: 'Nur Admin.', code: 'admin' }, 403);
      if (!/^\d{4,8}$/.test(String(body.pin)) || body.pin === '0000') return resp({ ok: false, error: 'Die PIN braucht 4 bis 8 Ziffern und darf nicht 0000 sein.', code: 'weak' }, 400);
      const { sha256Hex } = await import('./js/sha256.js');
      const s = fam();
      s.records[body.user] = { ...m, pinHash: sha256Hex(`catofit:${body.user}:${body.pin}`), updatedAt: new Date().toISOString(), rev: ++s.rev };
      return resp({ ok: true });
    }
    if (action === 'ics-token') {
      if (auth.session !== body.user && sessionRole() !== 'admin') return resp({ ok: false, error: 'Nur Admin.', code: 'admin' }, 403);
      auth.icsTokens[body.user] ||= 'a'.repeat(48);
      return resp({ ok: true, token: auth.icsTokens[body.user] });
    }
    return null;
  }

  async function handler(url, init = {}) {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    const area = u.searchParams.get('area');
    const scope = u.searchParams.get('scope') === 'family' ? 'family' : 'user';
    const user = u.searchParams.get('user');
    const entry = { action, area, scope, user, ops: null, status: null, url: String(url), body: init.body || null };
    requests.push(entry);
    const delay = typeof opts.latencyMs === 'function' ? opts.latencyMs(u, init) : opts.latencyMs;
    // Wie ein echter Browser: ein abgebrochener Abruf (Timeout im Client) endet sofort.
    if (delay) {
      await new Promise((r, reject) => {
        const t = setTimeout(r, delay);
        if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('Abgebrochen'); e.name = 'AbortError'; reject(e); }, { once: true });
      });
    }
    if (opts.offline) { entry.status = 0; throw new TypeError('fetch failed (Test-Server offline)'); }
    const failing = opts.failStatus || (typeof opts.failWhen === 'function' ? opts.failWhen(u, init) : null);
    if (failing) { entry.status = failing; return resp({ ok: false, error: 'Testfehler' }, failing); }
    if (action === 'ping') return resp({ ok: true, pong: true, apiVersion: 1, features: opts.features });
    // Sammelabruf wie api.php: nur die genannten Bereiche, private nur mit eigener Sitzung.
    if (action === 'changes-all' && opts.features.includes('changes-all')) {
      const revs = {}, changes = {}, locked = [];
      for (const pair of (u.searchParams.get('since') || '').split(',')) {
        const m = /^([a-z]+):(\d+)$/.exec(pair.trim());
        if (!m) continue;
        const [, a, since] = m;
        if (PRIVATE.includes(a) && auth.session !== user) { locked.push(a); continue; }
        const st = srv(key(a, 'user', user));
        revs[a] = st.rev;
        const recs = Object.values(st.records).filter((r) => (r.rev || 0) > Number(since)).sort((x, y) => x.rev - y.rev);
        if (recs.length) changes[a] = recs;
      }
      return resp({ ok: true, revs, changes, locked });
    }
    if (['session', 'login', 'logout', 'set-pin', 'ics-token'].includes(action)) {
      const r = await authAction(action, u, init);
      entry.status = r.status;
      return r;
    }
    if (action === 'delete-user') {
      if (sessionRole() !== 'admin') { entry.status = 401; return resp({ ok: false, error: 'Nur Admin.', code: auth.session ? 'admin' : 'session' }, auth.session ? 403 : 401); }
      for (const k of Object.keys(stores)) if (k.startsWith(`user|${user}|`)) delete stores[k];
      return resp({ ok: true, deleted: user });
    }
    // Private Bereiche: nur die angemeldete Person selbst (wie api.php).
    if (scope === 'user' && PRIVATE.includes(area) && (!auth.session || auth.session !== user)) {
      entry.status = auth.session ? 403 : 401;
      return resp({ ok: false, error: 'Dieser Bereich ist privat.', code: auth.session ? 'private' : 'session' }, entry.status);
    }
    const s = srv(key(area, scope, user));
    const out = (recs) => (scope === 'family' ? recs.map(publicRec) : recs);
    if (action === 'changes') {
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      const records = Object.values(s.records).filter((r) => (r.rev || 0) > since).sort((a, b) => a.rev - b.rev);
      return resp({ ok: true, area, rev: s.rev, records: out(records) });
    }
    if (action === 'ops') {
      const body = JSON.parse(init.body || '{}');
      const ops = Array.isArray(body.ops) ? body.ops : [];
      entry.ops = ops.length;
      if (ops.length > opts.opLimit) { entry.status = 413; return resp({ ok: false, error: 'Zu viele Operationen in einem Batch.' }, 413); }
      if (scope === 'family') {
        // Wie apply_ops mit Guard: jede Op gegen den laufenden Stand prüfen, dann anwenden.
        const rejected = []; const applied = [];
        for (const op of ops) {
          const checked = familyGuard(op, s);
          if (typeof checked === 'string') rejected.push({ op: op.op, id: (op.record && op.record.id) || op.id || '', reason: checked });
          else applied.push(...applyOps(s, [checked]));
        }
        return resp({ ok: true, area, rev: s.rev, records: out(applied), ...(rejected.length ? { rejected } : {}) });
      }
      const applied = applyOps(s, ops);
      const extra = opts.features.includes('ops-since') && Number.isInteger(body.since)
        ? { changes: { rev: s.rev, records: Object.values(s.records).filter((r) => (r.rev || 0) > body.since).sort((a, b) => a.rev - b.rev) } }
        : {};
      return resp({ ok: true, area, rev: s.rev, records: applied, ...extra });
    }
    const data = Object.values(s.records).filter((r) => !r.deleted).map(stripRev);
    return resp({ ok: true, area, data: area === 'profile' ? (data[0] || {}) : out(data) });
  }
  return {
    opts, requests, handler, auth,
    store(area, { scope = 'user', user = null } = {}) { return srv(key(area, scope, user)); },
    reset() {
      for (const k of Object.keys(stores)) delete stores[k];
      requests.length = 0;
      Object.assign(opts, DEFAULTS);
      auth.session = null; auth.fails = {}; auth.icsTokens = {};
    },
    install() { this.reset(); force('fetch', handler); return this; },
  };
}
g.__fakeServer = createFakeServer();

/* ------------------------------ Translations ------------------------------
   Catalogs come from disk instead of fetch. Tests run in German by default:
   the de catalog holds the texts the UI showed before v4.0.0, so the existing
   German assertions guard against regressions. A test that needs another
   language calls `await setLocale('en')` from js/i18n.js. */
{
  const { readFile } = await import('node:fs/promises');
  const i18n = await import('./js/i18n.js');
  i18n.setLoader(async (path) => JSON.parse(await readFile(new URL(`./locales/${path}`, import.meta.url), 'utf8')));
  await i18n.loadLanguages();
  // CATOFIT_I18N_SKIP: the import-time guard in test/i18n-catalog.test.js needs empty catalogs.
  if (!process.env.CATOFIT_I18N_SKIP) {
    await i18n.setLocale('de');
    // Lazily loaded areas (exercises, help, …) are loaded up front in tests.
    const { existsSync } = await import('node:fs');
    for (const area of i18n.LAZY_AREAS) {
      if (existsSync(new URL(`./locales/de/${area}.json`, import.meta.url))) await i18n.loadArea(area);
    }
  }
}
