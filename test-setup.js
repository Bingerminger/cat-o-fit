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
class MemStorage {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
  key(i) { return Array.from(this._m.keys())[i] ?? null; }
  get length() { return this._m.size; }
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

  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; if (k === 'value') this.value = v; }
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
if (typeof g.addEventListener !== 'function') g.addEventListener = () => {};
if (typeof g.removeEventListener !== 'function') g.removeEventListener = () => {};
provide('window', g);

// Für UI-Tests importierbar machen.
g.__domTest = { MiniNode, textNode, query, makeViewRoot };
