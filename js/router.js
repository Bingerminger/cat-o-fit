/* =========================================================================
   router.js — Hash-Routing mit Deep-Links (#/session/:id).
   Kein Server-Rewrite nötig; jede View rendert in #view und setzt den Header.
   ========================================================================= */

import { el, clear, icon, navigate } from './ui.js';

const routes = [];
let notFound = null;
let guard = null;
let current = { path: '', params: {}, handler: null };
const afterRenderCbs = new Set();

/** Registriert eine Route. pattern z. B. "/session/:id". */
export function register(pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ rx, keys, handler, pattern });
}
export function setNotFound(handler) { notFound = handler; }
/** Guard vor jedem Rendern. Gibt der Guard false zurück, hat er selbst umgeleitet. */
export function setGuard(fn) { guard = fn; }
export function onAfterRender(cb) { afterRenderCbs.add(cb); return () => afterRenderCbs.delete(cb); }

function parseHash() {
  let h = location.hash.replace(/^#/, '');
  if (!h || h === '/') return '/';
  return h.replace(/\/+$/, '') || '/';
}

/** Parameter aus dem Pfad – ein kaputt kodierter Link („%E0%A4%A“) darf den Start nicht
    abbrechen (FE-25): dann gilt die Route als unbekannt. */
function decodeParams(r, m) {
  const params = {};
  try {
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  } catch { return null; }
  return params;
}

function resolve(opts = {}) {
  const path = parseHash();
  if (guard && guard(path) === false) return;  // Guard hat selbst umgeleitet
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = decodeParams(r, m);
      if (!params) break;
      render(r, path, params, opts);
      return;
    }
  }
  if (notFound) render({ handler: notFound, pattern: '*' }, path, {}, opts);
}

function render(route, path, params, { keep = false } = {}) {
  // Neu zeichnen derselben Ansicht (nach dem Speichern, nach einem Sync) behält die
  // Scrollposition; nur ein Seitenwechsel beginnt oben (UI-10, FE-12).
  const same = keep && current.path === path;
  const scrollY = same ? window.scrollY : 0;
  current = { path, params, handler: route.handler, pattern: route.pattern };
  const view = document.getElementById('view');
  resetHeader();
  clear(view);
  if (!same) { view.classList.remove('fade-in'); void view.offsetWidth; view.classList.add('fade-in'); }
  const fail = (e) => {
    console.error('Render-Fehler', e);
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__title', text: 'Hoppla, da ging etwas schief.' }),
      el('div', { class: 'muted', text: String(e && e.message || e) }),
    ]));
  };
  const done = () => {
    if (same) window.scrollTo(0, scrollY);
    else { view.scrollTop = 0; window.scrollTo(0, 0); }
    afterRenderCbs.forEach((cb) => cb(current, { refreshed: same }));
  };
  let result;
  try { result = route.handler(view, params); } catch (e) { fail(e); }
  // Ansichten, die erst bei Bedarf geladen werden (FE-19), liefern ein Promise –
  // Scrollposition und Nacharbeiten erst, wenn sie gezeichnet sind.
  if (result && typeof result.then === 'function') result.then(done, (e) => { fail(e); done(); });
  else done();
}

/** Zeichnet die aktuelle Route neu (nach dem Speichern, nach Hintergrund-Sync) – die
    Scrollposition bleibt, es gibt keinen Seitenwechsel und kein Neuladen. */
export function refresh() { resolve({ keep: true }); }

/** Pfad der aktuell gezeichneten Route (z. B. „/plan/e1“). */
export function currentPath() { return current.path; }

export function start() {
  window.addEventListener('hashchange', () => resolve());
  if (!location.hash) location.replace('#/');
  resolve();
}

/* ------------------------------ Header-API ------------------------------ */
function resetHeader() {
  setHeader({ title: 'Cat-O-Fit', subtitle: '', back: null, actions: [] });
}

/**
 * Setzt Kopfzeile.
 * @param {{title?:string, subtitle?:string, back?:(string|true|null), actions?:Array}} cfg
 */
export function setHeader({ title = 'Cat-O-Fit', subtitle = '', back = null, actions = [] } = {}) {
  document.getElementById('header-title').textContent = title;
  const sub = document.getElementById('header-subtitle');
  sub.textContent = subtitle || '';
  sub.hidden = !subtitle;

  const backBtn = document.getElementById('header-back');
  if (back) {
    backBtn.hidden = false;
    clear(backBtn); backBtn.appendChild(icon('arrowLeft'));
    backBtn.onclick = () => { (back === true) ? history.back() : navigate(back); };
  } else {
    backBtn.hidden = true; backBtn.onclick = null;
  }

  const actEl = document.getElementById('header-actions');
  clear(actEl);
  actions.forEach((a) => {
    // title = Tooltip am Mac: Symbole allein erklärten nicht, was sie tun (UI-34).
    const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': a.label || '', title: a.label || '', onclick: a.onClick });
    b.appendChild(icon(a.icon));
    if (a.badge) b.appendChild(el('span', { class: 'badge', text: String(a.badge), style: { position: 'absolute', transform: 'translate(12px,-12px)' } }));
    actEl.appendChild(b);
  });
}
