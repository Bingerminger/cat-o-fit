/* =========================================================================
   ui.js — gemeinsame UI-Bausteine, Icons, Taxonomie und Formatierung.
   Wird von allen View-Modulen genutzt. Kein externes Framework.
   ========================================================================= */

/* -------------------------------------------------------------------------
   Umgebungs-Namespace für den Client-Speicher
   -------------------------------------------------------------------------
   Mehrere Deployments (z. B. /cat-o-fit/ = Produktion und /cat-o-fit-acc/ =
   Abnahme) liegen auf DERSELBEN Origin und teilen sich damit LocalStorage,
   SessionStorage und den Service-Worker-Cache. Ohne Trennung vermischen sich
   ihre Familien-/Sitzungsdaten -> „doppelte Nutzer". Wir leiten deshalb aus dem
   Auslieferungspfad einen stabilen Namespace ab und präfixen ALLE Storage-Keys
   damit. So bleibt jede Umgebung strikt isoliert.
   ------------------------------------------------------------------------- */
/* Umgebungs-Isolation (APP_NS/scopeKey) lebt jetzt in env.js — hier nur
   re-exportiert, damit bestehende Importe aus ui.js gültig bleiben. */
export { APP_NS, scopeKey } from './env.js';

/* -------------------------------------------------------------------------
   DOM-Helfer
   ------------------------------------------------------------------------- */

/** Hängt Kinder (Node | String | Array | null) an ein Elternelement an. */
export function append(parent, child) {
  if (child == null || child === false) return parent;
  if (Array.isArray(child)) { child.forEach((c) => append(parent, c)); return parent; }
  parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  return parent;
}

/**
 * Kompakter Element-Builder.
 * el('div', { class: 'card', onclick: fn, dataset: {id:1} }, [child, 'text'])
 */
export function el(tag, attrs = {}, children = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (children != null) append(node, children);
  return node;
}

/** Leert einen Knoten. */
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* -------------------------------------------------------------------------
   Lokales SVG-Icon-Set (Feather/Lucide-Stil, 24×24, stroke = currentColor)
   ------------------------------------------------------------------------- */
export const ICONS = {
  home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/><path d="M9 20h6M12 15v5"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  chart: '<line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="22" y1="20" x2="2" y2="20"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  play: '<polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  skip: '<polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><circle cx="12" cy="14" r="8"/><line x1="12" y1="14" x2="12" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  feather: '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h3.5"/>',
  zap: '<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.5 17a9 9 0 1 1 17 0z"/>',
  dumbbell: '<path d="M3 9v6"/><path d="M6 7v10"/><path d="M18 7v10"/><path d="M21 9v6"/><line x1="6" y1="12" x2="18" y2="12"/>',
  wind: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3"/><circle cx="18.5" cy="17.5" r="3"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.4 2.5-1.3 4h-4.2l-1.3-4z"/><path d="M12 7.5V3M15.4 10l4-1.3M14.1 13.5l2.5 3.4M9.9 13.5l-2.5 3.4M8.6 10l-4-1.3"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 2s4.5 4 4.5 9a4.5 4.5 0 0 1-9 0c0-1.2.6-2.3.6-2.3S6 11.5 6 14.5a6 6 0 0 0 12 0C18 8 12 2 12 2z"/>',
  scale: '<path d="M5 7h14l2.5 12a1 1 0 0 1-1 1.2H3.5a1 1 0 0 1-1-1.2z"/><circle cx="12" cy="7" r="2.2"/><line x1="12" y1="11" x2="12" y2="15"/>',
  drop: '<path d="M12 2.7S5 10 5 14a7 7 0 0 0 14 0c0-4-7-11.3-7-11.3z"/>',
  bed: '<path d="M2 18v-5a2 2 0 0 1 2-2h12a4 4 0 0 1 4 4v3"/><line x1="2" y1="18" x2="22" y2="18"/><line x1="2" y1="21" x2="2" y2="16"/><line x1="22" y1="21" x2="22" y2="18"/><circle cx="7" cy="10" r="1.6"/>',
  utensils: '<path d="M4 3v7a2 2 0 0 0 2 2v9"/><path d="M8 3v7a2 2 0 0 1-2 2"/><path d="M6 3v9"/><path d="M18 3c-1.5 0-3 1.8-3 5 0 2.4 1 3.4 2 3.7V21"/>',
  cart: '<circle cx="9" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M2 3h2.2l2.3 12.4a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2L21 7H5.3"/>',
  list: '<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><polyline points="3 6 4 7 6 5"/><polyline points="3 12 4 13 6 11"/><polyline points="3 18 4 19 6 17"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2.5"/><path d="M16 9.5 22 6v12l-6-3.5z"/>',
  sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  waves: '<path d="M2 7c2 0 2 1.6 4 1.6S8 7 10 7s2 1.6 4 1.6S16 7 18 7s2 1.6 4 1.6"/><path d="M2 12c2 0 2 1.6 4 1.6S8 12 10 12s2 1.6 4 1.6S16 12 18 12s2 1.6 4 1.6"/><path d="M2 17c2 0 2 1.6 4 1.6S8 17 10 17s2 1.6 4 1.6S16 17 18 17s2 1.6 4 1.6"/>',
  racket: '<ellipse cx="9.5" cy="8.5" rx="6" ry="6.8"/><line x1="13.7" y1="13.2" x2="20" y2="19.5"/>',
  mountain: '<path d="M2 20h20L14 5l-4 7-2.5-3.5z"/>',
  rowing: '<line x1="4" y1="19" x2="14" y2="9"/><line x1="20" y1="19" x2="10" y2="9"/><circle cx="3" cy="20" r="1.6"/><circle cx="21" cy="20" r="1.6"/>',
};

/** Liefert ein <svg>-Element für ein Icon. */
export function icon(name, cls = '') {
  const span = el('span', { style: { display: 'contents' } });
  span.innerHTML = iconSvg(name, cls);
  return span.firstElementChild;
}

/** Liefert das Icon als SVG-String (für innerHTML-Templates). */
export function iconSvg(name, cls = '') {
  const p = ICONS[name] || ICONS.dot;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* -------------------------------------------------------------------------
   Trainings-Taxonomie (Best Practice: Easy/Long/Tempo/Intervall/...)
   ------------------------------------------------------------------------- */
export const SESSION_TYPES = {
  recovery:       { label: 'Regeneration',     short: 'Reg.',   color: '#7fb8ff', icon: 'feather',  cat: 'run' },
  easy:           { label: 'Lockerer Lauf',    short: 'Easy',   color: '#43c59e', icon: 'activity', cat: 'run' },
  long:           { label: 'Long Run',         short: 'Long',   color: '#2bb0a3', icon: 'route',    cat: 'run' },
  tempo:          { label: 'Tempo / Schwelle', short: 'Tempo',  color: '#f59145', icon: 'zap',      cat: 'run' },
  interval:       { label: 'Intervalle (VO2)', short: 'Int.',   color: '#ef5d6c', icon: 'gauge',    cat: 'run' },
  race:           { label: 'Wettkampf',        short: 'Race',   color: '#f5a623', icon: 'flag',     cat: 'run' },
  strength:       { label: 'Kraft',            short: 'Kraft',  color: '#b079e6', icon: 'dumbbell', cat: 'strength' },
  mobility:       { label: 'Mobility',         short: 'Mob.',   color: '#9aa7b4', icon: 'wind',     cat: 'mobility' },
  cross:          { label: 'Cross-Training',   short: 'Cross',  color: '#6ec6ff', icon: 'activity', cat: 'cross' },
  cross_bike:     { label: 'Radtour',          short: 'Rad',    color: '#5bc0eb', icon: 'bike',     cat: 'cross' },
  cross_football: { label: 'Fußball',          short: 'Ball',   color: '#5cc97a', icon: 'ball',     cat: 'cross' },
  match:          { label: 'Testspiel',        short: 'Spiel',  color: '#f5a623', icon: 'flag',     cat: 'cross' },
  camp:           { label: 'Trainingslager',   short: 'Camp',   color: '#ef8a5d', icon: 'flame',    cat: 'cross' },
  rest:           { label: 'Ruhetag',          short: 'Frei',   color: '#aeb8c2', icon: 'moon',     cat: 'rest' },
  run:            { label: 'Lauf',             short: 'Lauf',   color: '#43c59e', icon: 'activity', cat: 'run' },
  walk:           { label: 'Gehen / Spazieren', short: 'Gehen', color: '#9aa7b4', icon: 'route',    cat: 'cross' },
  swim:           { label: 'Schwimmen',        short: 'Schw.',  color: '#19b9c9', icon: 'waves',    cat: 'cross' },
  hike:           { label: 'Wandern',          short: 'Wand.',  color: '#6aa45f', icon: 'mountain', cat: 'cross' },
  rowing:         { label: 'Rudern',           short: 'Rudern', color: '#3d8bff', icon: 'rowing',   cat: 'cross' },
  tennis:         { label: 'Tennis',           short: 'Tennis', color: '#9acd32', icon: 'racket',   cat: 'cross' },
  badminton:      { label: 'Badminton',        short: 'Bad.',   color: '#7ec850', icon: 'racket',   cat: 'cross' },
  squash:         { label: 'Squash',           short: 'Squash', color: '#e6a33d', icon: 'racket',   cat: 'cross' },
  tabletennis:    { label: 'Tischtennis',      short: 'TT',     color: '#5b7fff', icon: 'racket',   cat: 'cross' },
  spinning:       { label: 'Indoor-Cycling',   short: 'Spin.',  color: '#5bc0eb', icon: 'bike',     cat: 'cross' },
  elliptical:     { label: 'Crosstrainer',     short: 'Cross.', color: '#6ec6ff', icon: 'activity', cat: 'cross' },
  gym:            { label: 'Gerätetraining',   short: 'Gym',    color: '#b079e6', icon: 'dumbbell', cat: 'strength' },
  other:          { label: 'Training',         short: '–',      color: '#9aa7b4', icon: 'activity', cat: 'other' },
};

export function typeMeta(type) { return SESSION_TYPES[type] || SESSION_TYPES.other; }

/** Farbiges Trainingstyp-Icon (Kreis/Kachel mit Symbol). */
export function typeIcon(type, size = '') {
  const m = typeMeta(type);
  const wrap = el('span', { class: `type-icon ${size}`, style: { background: m.color } });
  wrap.innerHTML = iconSvg(m.icon);
  return wrap;
}

export const FEELINGS = [
  { key: 'schlecht', emoji: '😣', label: 'schlecht' },
  { key: 'ok',       emoji: '😐', label: 'ok' },
  { key: 'gut',      emoji: '🙂', label: 'gut' },
  { key: 'stark',    emoji: '💪', label: 'stark' },
  { key: 'top',      emoji: '🤩', label: 'top' },
];

export const PRIORITIES = { A: 'Hauptwettkampf', B: 'Wichtig', C: 'Vorbereitung' };

/** Trainingstypen als Optionsliste für Auswahlfelder (Läufe zuerst). */
export const TYPE_OPTIONS = [
  'easy', 'long', 'tempo', 'interval', 'recovery', 'race',
  'strength', 'gym', 'mobility',
  'swim', 'cross_bike', 'spinning', 'rowing', 'elliptical',
  'walk', 'hike',
  'tennis', 'badminton', 'squash', 'tabletennis', 'cross_football',
  'cross', 'match', 'camp', 'rest',
].map((k) => ({ value: k, label: SESSION_TYPES[k].label }));

/** Status-Metadaten (inkl. abgeleitetem „überfällig"). */
export const STATUS_META = {
  geplant:    { label: 'Geplant',    color: 'var(--accent)', cls: 'geplant' },
  erledigt:   { label: 'Erledigt',   color: 'var(--good)',   cls: 'erledigt' },
  verschoben: { label: 'Verschoben', color: 'var(--warn)',   cls: 'verschoben' },
  verpasst:   { label: 'Verpasst',   color: 'var(--bad)',    cls: 'verpasst' },
  ueberfaellig: { label: 'Überfällig', color: '#f5a623',    cls: 'ueberfaellig' },
};

/**
 * Effektiver Status einer geplanten Einheit – berücksichtigt „überfällig"
 * (Datum in der Vergangenheit, weder erledigt noch verpasst, kein Ruhetag).
 */
export function effectiveStatus(unit, todayString = todayStr()) {
  if (!unit) return 'geplant';
  if (unit.status === 'erledigt') return 'erledigt';
  if (unit.status === 'verpasst') return 'verpasst';
  if (unit.type === 'rest') return 'geplant';
  if (unit.date < todayString) return 'ueberfaellig';
  return unit.status || 'geplant';
}
export function isOverdue(unit, todayString = todayStr()) { return effectiveStatus(unit, todayString) === 'ueberfaellig'; }

/* -------------------------------------------------------------------------
   Formatierung (deutsch)
   ------------------------------------------------------------------------- */
const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG  = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MO_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const MO_LONG  = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** "YYYY-MM-DD" -> lokales Date-Objekt (ohne Zeitzonen-Verschiebung). */
export function parseDate(str) {
  if (str instanceof Date) return str;
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
/** Date -> "YYYY-MM-DD" (lokal). */
export function toDateStr(date) {
  const d = date instanceof Date ? date : parseDate(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayStr() { return toDateStr(new Date()); }
export function addDays(dateStr, n) { const d = parseDate(dateStr); d.setDate(d.getDate() + n); return toDateStr(d); }
/** Ganze Tage zwischen a und b (b - a). */
export function diffDays(a, b) {
  const ms = parseDate(b).setHours(12) - parseDate(a).setHours(12);
  return Math.round(ms / 86400000);
}
/** Wochentag 1=Mo .. 7=So. */
export function isoDow(dateStr) { const d = parseDate(dateStr).getDay(); return d === 0 ? 7 : d; }
/** Montag der Woche eines Datums. */
export function weekStartMonday(dateStr) { return addDays(dateStr, -(isoDow(dateStr) - 1)); }

export function fmtWeekday(dateStr, long = false) { return (long ? WD_LONG : WD_SHORT)[parseDate(dateStr).getDay()]; }
export function fmtDate(dateStr) { const d = parseDate(dateStr); return `${WD_SHORT[d.getDay()]}, ${d.getDate()}. ${MO_SHORT[d.getMonth()]}`; }
export function fmtDateLong(dateStr) { const d = parseDate(dateStr); return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MO_LONG[d.getMonth()]} ${d.getFullYear()}`; }
export function fmtDayMonth(dateStr) { const d = parseDate(dateStr); return `${d.getDate()}. ${MO_SHORT[d.getMonth()]}`; }
export function monthName(monthIdx, long = true) { return (long ? MO_LONG : MO_SHORT)[monthIdx]; }

/** Sekunden/km -> "m:ss". */
export function fmtPace(sec) {
  if (!sec || sec <= 0) return '–';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtPaceRange(min, max) {
  if (!min) return '–';
  if (!max || max === min) return `${fmtPace(min)} min/km`;
  return `${fmtPace(min)}–${fmtPace(max)} min/km`;
}
/** Sekunden -> "M:SS" oder "H:MM:SS". */
export function fmtDuration(sec) {
  if (sec == null) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
/** Sekunden -> "MM:SS" für große Timer-Anzeigen. */
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** "HH:MM:SS" -> Sekunden. */
export function parseHms(str) {
  if (!str) return 0;
  const p = String(str).split(':').map(Number);
  while (p.length < 3) p.unshift(0);
  return p[0] * 3600 + p[1] * 60 + p[2];
}
export function fmtKm(km, digits = 1) {
  if (km == null) return '–';
  return Number(km).toFixed(digits).replace('.', ',') + ' km';
}
export function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '–';
  return Number(n).toFixed(digits).replace('.', ',');
}

/** Ganzzahl mit Tausenderpunkt (deutsche Schreibweise), z. B. 1.234. */
export function fmtInt(n) {
  if (n == null || Number.isNaN(Number(n))) return '–';
  const sign = Number(n) < 0 ? '-' : '';
  const abs = Math.abs(Math.round(Number(n)));
  return sign + String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/* -------------------------------------------------------------------------
   Kleinkram
   ------------------------------------------------------------------------- */
export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
export function nowIso() { return new Date().toISOString(); }
export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function navigate(hash) { location.hash = hash; }

/* -------------------------------------------------------------------------
   Toast
   ------------------------------------------------------------------------- */
export function toast(message, variant = '', ms = 2400) {
  const root = document.getElementById('toast-root');
  if (!root) return; // kein Toast-Container (z. B. vor App-Init) -> still überspringen statt crashen
  const t = el('div', { class: `toast ${variant ? 'toast--' + variant : ''}` });
  if (variant === 'good') t.appendChild(icon('check'));
  if (variant === 'bad') t.appendChild(icon('info'));
  t.appendChild(el('span', { text: message }));
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s ease, transform .25s ease';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 260);
  }, ms);
}

/* -------------------------------------------------------------------------
   Bottom-Sheet / Modal
   ------------------------------------------------------------------------- */
let activeSheet = null;

/**
 * Öffnet ein Bottom-Sheet.
 * @returns {{close: Function, body: HTMLElement, foot: HTMLElement}}
 */
export function openSheet({ title = '', body = null, footer = null, onClose = null } = {}) {
  const root = document.getElementById('modal-root');
  closeSheet();

  const bodyEl = el('div', { class: 'sheet__body' });
  if (body) append(bodyEl, body);

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet__grip' }),
    el('div', { class: 'sheet__head' }, [
      el('div', { class: 'sheet__title', text: title }),
      el('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => closeSheet() }, icon('x')),
    ]),
    bodyEl,
  ]);

  let footEl = null;
  if (footer) { footEl = el('div', { class: 'sheet__foot' }); append(footEl, footer); sheet.appendChild(footEl); }

  const scrim = el('div', { class: 'modal-scrim', onclick: () => closeSheet() });
  clear(root);
  append(root, [scrim, sheet]);
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  activeSheet = { root, onClose };
  return { close: closeSheet, body: bodyEl, foot: footEl, sheet };
}

export function closeSheet() {
  const root = document.getElementById('modal-root');
  if (!root.classList.contains('is-open')) return;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  clear(root);
  if (activeSheet?.onClose) activeSheet.onClose();
  activeSheet = null;
}

/** Bestätigungsdialog. Promise<boolean>. */
export function confirmDialog({ title = 'Sicher?', message = '', confirmLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const settle = (val) => { if (!decided) { decided = true; resolve(val); } };
    const sheet = openSheet({
      title,
      body: el('p', { class: 'muted', text: message }),
      footer: [
        el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
        el('button', { class: `btn grow ${danger ? 'btn--danger' : 'btn--primary'}`, text: confirmLabel, onclick: () => { settle(true); closeSheet(); } }),
      ],
      onClose: () => settle(false),
    });
    void sheet;
  });
}

/**
 * Quittungs-Dialog mit einem einzigen „OK". Für unmissverständliches Erfolgs-/
 * Fehler-Feedback (z. B. nach Backup/Recovery). `tone`: 'good' | 'bad' | ''.
 * Liefert ein Promise, das bei OK/Schließen auflöst – so kann der Aufrufer
 * danach z. B. neu laden.
 */
export function alertDialog({ title = 'Hinweis', message = '', okLabel = 'OK', tone = '' } = {}) {
  const prefix = tone === 'good' ? '✅ ' : tone === 'bad' ? '⚠️ ' : '';
  return new Promise((resolve) => {
    let done = false;
    const settle = () => { if (!done) { done = true; resolve(); } };
    openSheet({
      title: prefix + title,
      body: el('p', { class: 'muted', style: { lineHeight: '1.5' }, text: message }),
      footer: [
        el('button', { class: `btn grow ${tone === 'bad' ? 'btn--danger' : 'btn--primary'}`, text: okLabel, onclick: () => { settle(); closeSheet(); } }),
      ],
      onClose: () => settle(),
    });
  });
}

/* -------------------------------------------------------------------------
   Formular-Bausteine
   ------------------------------------------------------------------------- */
export function field(label, control) {
  return el('label', { class: 'field' }, [
    label ? el('span', { class: 'field__label', text: label }) : null,
    control,
  ]);
}

export function input(attrs = {}) { return el('input', { class: 'input', ...attrs }); }
export function textarea(attrs = {}) { return el('textarea', { class: 'textarea', ...attrs }); }
export function select(options, value, attrs = {}) {
  const sel = el('select', { class: 'select', ...attrs });
  options.forEach((o) => {
    const opt = el('option', { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

/** Segmented Control. onChange(value). */
export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'tablist' });
  options.forEach((o) => {
    const b = el('button', {
      class: `segmented__opt ${o.value === value ? 'is-active' : ''}`,
      text: o.label,
      onclick: () => {
        wrap.querySelectorAll('.segmented__opt').forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        onChange(o.value);
      },
    });
    wrap.appendChild(b);
  });
  return wrap;
}

/** +/- Stepper. onChange(value). */
export function stepper(value, { min = 0, max = 999, step = 1, onChange = () => {} } = {}) {
  let v = value;
  const valEl = el('span', { class: 'stepper__val num', text: String(v) });
  const set = (nv) => { v = clamp(nv, min, max); valEl.textContent = String(v); onChange(v); };
  return el('div', { class: 'stepper' }, [
    el('button', { class: 'stepper__btn', 'aria-label': 'weniger', onclick: () => set(v - step) }, '−'),
    valEl,
    el('button', { class: 'stepper__btn', 'aria-label': 'mehr', onclick: () => set(v + step) }, '+'),
  ]);
}

/** Toggle-Switch. */
export function toggle(checked, onChange) {
  const inp = el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return el('label', { class: 'switch' }, [inp, el('span', { class: 'switch__track' })]);
}

/** Leerzustand. */
export function emptyState(iconName, title, text) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__icon', html: iconSvg(iconName) }),
    el('div', { class: 'empty__title', text: title }),
    text ? el('div', { text }) : null,
  ]);
}

/** Abschnitts-Überschrift mit optionaler Aktion. */
export function sectionHead(title, action = null) {
  return el('div', { class: 'section-head' }, [
    el('h2', { class: 'section-head__title', text: title }),
    action ? el('button', { class: 'section-head__action', text: action.label, onclick: action.onClick }) : null,
  ]);
}
