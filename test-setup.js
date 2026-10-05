/* =========================================================================
   test-setup.js — browser-globals shim for the Node unit AND UI tests.

   The app modules are written for the browser environment. Here we provide enough
   that (a) pure logic modules load in Node and the store can be populated, and
   (b) the view modules (el(), render functions) can be tested against a lightweight,
   DEPENDENCY-FREE mini DOM – no jsdom, no build.

   The mini DOM covers exactly the APIs used by ui.js `el()`/`append()` and charts.js (SVG):
   nodes/attributes/classes/style/events/textContent plus a simple
   querySelector(All) (tag, .class, #id, [attr], [attr="v"], commas).

   Loaded before the tests via `node --import ./test-setup.js`.
   ========================================================================= */
const g = globalThis;

/* ----------------------------- LocalStorage ----------------------------- */
// With a simulable quota (characters): `localStorage.__setQuota(n)` makes setItem
// fail with QuotaExceededError as in the browser as soon as the total is exceeded.
class MemStorage {
  constructor() { this._m = new Map(); this._quota = Infinity; }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) {
    const s = String(v);
    if (this._quota !== Infinity) {
      let used = 0;
      for (const [kk, vv] of this._m) if (kk !== k) used += kk.length + vv.length;
      if (used + String(k).length + s.length > this._quota) {
        const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
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

  // As in the browser: the value ATTRIBUTE does not fill a <textarea> (only the property).
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

/** Very simple selector matcher: tag, .class, #id, [attr], [attr="v"]. */
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

/** Test helper: creates a fresh render container (#view-like). */
function makeViewRoot() { const v = new MiniNode('div'); v.setAttribute('id', 'view'); document.body.appendChild(v); return v; }

/* ------------------------------ Setting globals --------------------------- */
function provide(name, value) {
  try { if (g[name] == null) Object.defineProperty(g, name, { value, writable: true, configurable: true }); }
  catch { /* read-only global -> leave unchanged */ }
}
function force(name, value) {
  try { Object.defineProperty(g, name, { value, writable: true, configurable: true }); }
  catch { try { g[name] = value; } catch { /* non-configurable -> give up */ } }
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
// Node ships a built-in fetch -> overwrite it forcibly. Default: fast,
// EMPTY response (no real network access, no retries). Tests that check real
// sync behaviour install their own fetch mock (see sync.test.js).
force('fetch', async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rev: 0, records: [], data: [] }) }));
provide('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }));
provide('getComputedStyle', () => ({ getPropertyValue: () => '' }));
provide('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
provide('cancelAnimationFrame', (id) => clearTimeout(id));
// Window events: a small registry so that tests can trigger e.g. 'offline'/'online'
// (api-client.js listens for them) and app events ('catofit:…') arrive.
if (typeof g.addEventListener !== 'function') {
  const winListeners = {};
  g.addEventListener = (type, fn) => { (winListeners[type] ||= []).push(fn); };
  g.removeEventListener = (type, fn) => { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); };
  g.dispatchEvent = (ev) => { (winListeners[ev.type] || []).slice().forEach((f) => f(ev)); return true; };
}
if (typeof g.removeEventListener !== 'function') g.removeEventListener = () => {};
provide('window', g);

// Make it importable for UI tests.
g.__domTest = { MiniNode, textNode, query, makeViewRoot };

/* ---------------- Protocol-faithful test server (opt-in, v3.20.0) -----------------
   The fake PHP API lives in js/demo-server.js (the public demo runs on it too). The earlier
   default fetch ("always empty, always OK") hid exactly the sync errors that this server
   makes visible. Usage: `const srv = __fakeServer.install();` – afterwards control
   srv.opts (latencyMs, offline, failStatus, failWhen, opLimit, features), srv.auth and
   srv.store(area, {user, scope}). */
{
  const { createFakeServer } = await import('./js/demo-server.js');
  const server = createFakeServer();
  server.install = function install() { this.reset(); force('fetch', this.handler); return this; };
  g.__fakeServer = server;
}

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
