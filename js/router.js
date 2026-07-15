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

function resolve() {
  const path = parseHash();
  if (guard && guard(path) === false) return;  // Guard hat selbst umgeleitet
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      render(r, path, params);
      return;
    }
  }
  if (notFound) render({ handler: notFound, pattern: '*' }, path, {});
}

function render(route, path, params) {
  current = { path, params, handler: route.handler, pattern: route.pattern };
  const view = document.getElementById('view');
  resetHeader();
  clear(view);
  view.classList.remove('fade-in'); void view.offsetWidth; view.classList.add('fade-in');
  try {
    route.handler(view, params);
  } catch (e) {
    console.error('Render-Fehler', e);
    view.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'empty__title', text: 'Hoppla, da ging etwas schief.' }),
      el('div', { class: 'muted', text: String(e && e.message || e) }),
    ]));
  }
  // Inhaltsbereich nach oben scrollen.
  view.scrollTop = 0; window.scrollTo(0, 0);
  afterRenderCbs.forEach((cb) => cb(current));
}

/** Rendert die aktuelle Route neu (z. B. nach Hintergrund-Sync). */
export function refresh() { resolve(); }

export function start() {
  window.addEventListener('hashchange', resolve);
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
    const b = el('button', { class: 'icon-btn', 'aria-label': a.label || '', onclick: a.onClick });
    b.appendChild(icon(a.icon));
    if (a.badge) b.appendChild(el('span', { class: 'badge', text: String(a.badge), style: { position: 'absolute', transform: 'translate(12px,-12px)' } }));
    actEl.appendChild(b);
  });
}
