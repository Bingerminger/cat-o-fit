/* =========================================================================
   charts.js — leichtgewichtige, selbst gezeichnete SVG-Charts (kein CDN).

   Zeichnen in der TATSÄCHLICHEN Breite (FE-20): Die erste Zeichnung nutzt 320
   Einheiten (vor dem Layout, in Tests), danach zeichnet ein ResizeObserver in der
   gemessenen Pixelbreite neu – 1 Einheit = 1 px, feste Höhe, Schrift 10–11 px. Vorher
   skalierte ein festes viewBox mit: 8 px Achsenwerte auf dem iPhone, 400 px hohe
   Balken mit 22-px-Zahlen am Mac.
   Farben kommen über CSS-Klassen/Variablen (FE-14) – ein Wechsel Hell/Dunkel färbt
   die Diagramme ohne Neuzeichnen um. Jedes Diagramm trägt eine Zusammenfassung für
   Screenreader (FE-13).
   ========================================================================= */

import { fmtNum } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (children) [].concat(children).forEach((c) => c && node.appendChild(c));
  return node;
}
function txt(content, attrs = {}) { const t = s('text', attrs); t.textContent = content; return t; }
/** Farbe als Stil – `var(--…)` funktioniert dort zuverlässig, in Präsentationsattributen nicht. */
const paint = (prop, color) => `${prop}:${color}`;
const ACCENT = 'var(--accent)';

const AXIS_FS = 10.5;     // Achsenwerte/Datum in px
const LABEL_FS = 10.5;    // Balken-Beschriftung
const VALUE_FS = 10;      // Werte über Balken

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_ABBR = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
/** „27. Sept.“ – mit Jahr, wenn die Spanne fast ein Jahr oder mehr umfasst. */
function dateLabel(iso, withYear) {
  const d = +iso.slice(8, 10), m = +iso.slice(5, 7) - 1;
  return `${d}. ${MONTHS_ABBR[m]}${withYear ? ` ${iso.slice(0, 4)}` : ''}`;
}
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/* --------------------- interne Helfer für Liniencharts ------------------- */

/** „Runde“ Y-Ticks (1 / 2 / 2,5 / 5 × 10^k) innerhalb [min, max]. */
function niceTicks(min, max, count = 4) {
  const span = max - min;
  if (!(span > 0)) return { ticks: [], step: 1 };
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => span / st <= count) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return { ticks, step };
}

/** Tick-Beschriftung: nur so viele Nachkommastellen wie die Schrittweite braucht. */
const tickFmt = (t, step) => fmtNum(t, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

/** Dezente horizontale Gridlines + Tick-Werte am linken Rand. */
function yGrid(svg, { ticks, step, y, padL, W, padR }) {
  ticks.forEach((t) => {
    const ty = y(t);
    svg.appendChild(s('line', { class: 'chart-grid', x1: padL, y1: ty, x2: W - padR, y2: ty, 'stroke-width': 1 }));
    svg.appendChild(txt(tickFmt(t, step), { class: 'chart-axis', x: padL - 5, y: ty + 3.5, 'text-anchor': 'end', 'font-size': AXIS_FS }));
  });
}

/** Linker Innenabstand: so breit wie das längste Tick-Label. */
function tickPadL(ticks, step) {
  const chars = ticks.length ? Math.max(...ticks.map((t) => tickFmt(t, step).length)) : 2;
  return 10 + AXIS_FS * 0.6 * Math.max(2, chars);
}

/** Positionierbarer Wrapper – Anker für den Scrubber-Tooltip. */
function chartWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  return wrap;
}

/**
 * In der tatsächlichen Breite zeichnen: erst mit 320 (vor dem Layout, in Tests), dann bei
 * jeder Breitenänderung neu. Der Beobachter löst sich, sobald das Element weg ist.
 */
function fitWidth(host, draw) {
  let lastW = 320;
  draw(lastW);
  if (typeof ResizeObserver !== 'function') return;
  const ro = new ResizeObserver((entries) => {
    if (!host.isConnected) { ro.disconnect(); return; }
    const w = Math.round(entries[0].contentRect.width);
    if (w > 0 && Math.abs(w - lastW) >= 2) { lastW = Math.max(200, w); draw(lastW); }
  });
  ro.observe(host);
}

/** Leeres Diagramm („Keine Daten“). */
function emptySvg(W, H) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: `width:100%;height:${H}px`, role: 'img', 'aria-label': 'Keine Daten' });
  svg.appendChild(txt('Keine Daten', { class: 'chart-axis', x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 12 }));
  return svg;
}

/**
 * Scrubber für Liniencharts: eine Führungslinie schnappt zum nächstgelegenen
 * Datenpunkt, ein HTML-Tooltip zeigt Datum + Wert(e). Bedienbar per Touch
 * (Wischen), Maus (Hover) und Tastatur (Pfeiltasten/Escape); vertikales
 * Scrollen bleibt frei (CSS touch-action: pan-y auf .chart-wrap).
 * Die Ereignisse hängen einmal am Wrapper; bei jedem Neuzeichnen bindet `bind()`
 * das neue SVG samt Konfiguration.
 * cfg: { W, H, padT, padB, n, xAt(i), nearest(vx), title(i), rows(i), pointsAt(i), label }
 */
function attachScrubber(wrap) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  let cfg = null, svg = null, cursor = null, dots = [], cur = -1;

  const show = (i) => {
    if (!cfg || i === cur) return;
    cur = i;
    const marks = cfg.pointsAt(i);
    while (dots.length < marks.length) {
      const d = s('circle', { class: 'chart-dot', r: 4, 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' });
      dots.push(d); svg.appendChild(d);
    }
    dots.forEach((d, k) => {
      const m = marks[k];
      d.setAttribute('opacity', m ? 1 : 0);
      if (m) { d.setAttribute('cx', m.x); d.setAttribute('cy', m.y); d.setAttribute('style', paint('fill', m.color)); }
    });
    const cx = cfg.xAt(i);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('opacity', 0.55);

    tip.textContent = '';                       // Daten nur als Text einfügen (kein innerHTML)
    const title = document.createElement('div');
    title.className = 'chart-tip__title'; title.textContent = cfg.title(i) || '';
    tip.appendChild(title);
    cfg.rows(i).forEach((r) => {
      const row = document.createElement('div'); row.className = 'chart-tip__row';
      if (r.color) { const key = document.createElement('span'); key.className = 'chart-tip__key'; key.style.background = r.color; row.appendChild(key); }
      const val = document.createElement('b'); val.textContent = r.value; row.appendChild(val);
      if (r.name) { const name = document.createElement('span'); name.className = 'chart-tip__name'; name.textContent = r.name; row.appendChild(name); }
      tip.appendChild(row);
    });
    tip.hidden = false;
    const ww = wrap.clientWidth || 0;           // Bubble an den Rändern nicht abschneiden
    if (ww) {
      const half = (tip.offsetWidth || 0) / 2;
      tip.style.left = `${Math.max(half + 2, Math.min(ww - half - 2, (cx / cfg.W) * ww))}px`;
    } else {
      tip.style.left = `${(cx / cfg.W) * 100}%`;
    }
  };
  const hide = () => {
    cur = -1;
    if (cursor) cursor.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    tip.hidden = true;
  };
  const onMove = (ev) => {
    if (!cfg) return;
    const r = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    show(cfg.nearest(((ev.clientX - r.left) / r.width) * cfg.W));
  };
  wrap.addEventListener('pointerdown', onMove);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') hide(); });
  wrap.addEventListener('pointerleave', hide);
  wrap.addEventListener('pointercancel', hide);
  wrap.addEventListener('keydown', (ev) => {
    if (!cfg) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      show(Math.max(0, Math.min(cfg.n - 1, cur < 0 ? cfg.n - 1 : cur + (ev.key === 'ArrowRight' ? 1 : -1))));
    } else if (ev.key === 'Escape') hide();
  });
  wrap.addEventListener('blur', hide);
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'img');

  return (newSvg, newCfg) => {
    svg = newSvg; cfg = newCfg; dots = []; cur = -1; tip.hidden = true;
    cursor = s('line', { class: 'chart-cursor', y1: cfg.padT, y2: cfg.H - cfg.padB, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(cursor);
    wrap.setAttribute('aria-label', cfg.label);
  };
}

/** Index des Punkts, dessen x-Position `vx` am nächsten liegt. */
function nearestIdx(xs, vx) {
  let best = 0, bd = Infinity;
  xs.forEach((x, i) => { const d = Math.abs(x - vx); if (d < bd) { bd = d; best = i; } });
  return best;
}

/**
 * Zeitachse (FE-09): Tragen alle Punkte ein Datum (`date`, ISO), stehen sie nach
 * Tagen – zwei Wochen und acht Monate bekommen nicht mehr dieselbe Breite.
 * Liefert je Punkt den Tagesversatz (oder null ohne Daten) und ob das Jahr in die
 * Beschriftung gehört.
 */
function timeAxis(pts) {
  if (!pts.length || !pts.every((p) => isIso(p.date))) return null;
  const d0 = dayNum(pts[0].date);
  const days = pts.map((p) => dayNum(p.date) - d0);
  return { days, span: Math.max(1, days[days.length - 1]), withYear: days[days.length - 1] > 330 };
}

/** Zusammenfassung für Screenreader: Zeitraum, Min/Max, letzter Wert. */
function summary(name, pts, fmt, unit, dates) {
  if (!pts.length) return `${name}: keine Daten`;
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const first = dates ? dateLabel(pts[0].date, true) : pts[0].label;
  const last = pts[pts.length - 1];
  const lastLbl = dates ? dateLabel(last.date, true) : last.label;
  const span = first && lastLbl && pts.length > 1 ? ` von ${first} bis ${lastLbl}` : '';
  return `${name}: ${pts.length} Werte${span}; niedrigster ${fmt(lo)}${unit}, höchster ${fmt(hi)}${unit}, zuletzt ${fmt(last.value)}${unit}${lastLbl ? ` (${lastLbl})` : ''}.`;
}

/**
 * Liniendiagramm mit Y-Skala, dezenten Gridlines, optionaler Zielmarkierung
 * und Scrubber-Tooltip (Touch & Maus). Liefert einen Wrapper (<div>) mit SVG.
 * Punkte mit `date` (ISO) stehen nach Datum; `value: null` unterbricht die Linie.
 * @param {Array<{label?:string, date?:string, value:number|null}>} points
 * @param {object} opts { color, target, targetLabel, height, unit, fmt, fill, bands, label }
 */
export function lineChart(points, opts = {}) {
  const H = opts.height || 150;
  const padR = 10, padT = 14, padB = 22;
  const color = opts.color || ACCENT;
  const fmt = opts.fmt || ((v) => fmtNum(v, 1));
  const unit = opts.unit ? ` ${opts.unit}` : '';
  const ok = (p) => p && p.value != null && !Number.isNaN(p.value);
  const valid = points.filter(ok);
  const wrap = chartWrap();

  if (valid.length === 0) {
    wrap.appendChild(emptySvg(320, H));
    return wrap;
  }

  const ys = valid.map((p) => p.value);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (opts.target != null) { min = Math.min(min, opts.target); max = Math.max(max, opts.target); }
  // Korridore (`bands`): Grenzen in der Nähe der Werte kommen mit auf die Achse, weit
  // entfernte (z. B. Ferritin-Obergrenze 300 bei Werten um 50) werden am Rand abgeschnitten.
  const bands = (opts.bands || []).filter((b) => b && (b.lo != null || b.hi != null));
  const dataSpan = Math.max(max - min, Math.abs(max) * 0.1, 1e-9);
  bands.forEach((b) => [b.lo, b.hi].forEach((v) => {
    if (v != null && v >= min - dataSpan && v <= max + dataSpan) { min = Math.min(min, v); max = Math.max(max, v); }
  }));
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  min -= range * 0.12; max += range * 0.12;

  const { ticks, step } = niceTicks(min, max);
  const padL = tickPadL(ticks, step);
  const n = valid.length;
  const time = timeAxis(valid);
  const labelOf = (p) => (time ? dateLabel(p.date, time.withYear) : (p.label || ''));
  const bind = attachScrubber(wrap);

  fitWidth(wrap, (W) => {
    const inner = W - padL - padR;
    const x = (i) => (n === 1 ? padL + inner / 2 : time ? padL + (time.days[i] / time.span) * inner : padL + (i / (n - 1)) * inner);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

    const old = wrap.querySelector && wrap.querySelector('svg');
    if (old) old.remove();
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: `width:100%;height:${H}px`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    const defs = s('defs');
    const grad = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(s('stop', { offset: '0%', style: `${paint('stop-color', color)};stop-opacity:0.28` }));
    grad.appendChild(s('stop', { offset: '100%', style: `${paint('stop-color', color)};stop-opacity:0` }));
    defs.appendChild(grad); svg.appendChild(defs);

    // Y-Skala zuerst – Gridlines liegen hinter Fläche und Linie.
    yGrid(svg, { ticks, step, y, padL, W, padR });

    // Korridore: `fill` = Fläche (z. B. Sport-Zielbereich), `frame` = gestrichelte Grenzen
    // (z. B. Referenzbereich des Labors). Offene Grenzen (null) reichen bis zum Rand.
    const clampY = (v) => Math.max(padT, Math.min(H - padB, y(v)));
    bands.forEach((b) => {
      const top = b.hi == null ? padT : clampY(b.hi);
      const bottom = b.lo == null ? H - padB : clampY(b.lo);
      if (b.kind === 'frame') {
        [b.lo, b.hi].forEach((v) => {
          if (v == null || y(v) < padT || y(v) > H - padB) return;
          svg.appendChild(s('line', { class: 'chart-band chart-band--frame', x1: padL, y1: y(v), x2: W - padR, y2: y(v), 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
        });
        if (b.label && b.hi != null && y(b.hi) >= padT && y(b.hi) <= H - padB) svg.appendChild(txt(b.label, { class: 'chart-axis', x: W - padR, y: y(b.hi) - 3, 'text-anchor': 'end', 'font-size': AXIS_FS }));
      } else if (bottom > top) {
        svg.appendChild(s('rect', { class: 'chart-band chart-band--fill', x: padL, y: top, width: inner, height: bottom - top, style: `${paint('fill', b.color || 'var(--good)')};opacity:0.12` }));
        if (b.label) svg.appendChild(txt(b.label, { class: 'chart-label', x: padL + 4, y: top + 12, 'font-size': AXIS_FS }));
      }
    });

    // Zielmarkierung
    if (opts.target != null) {
      const ty = y(opts.target);
      svg.appendChild(s('line', { class: 'chart-target', x1: padL, y1: ty, x2: W - padR, y2: ty, 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
      svg.appendChild(txt(opts.targetLabel || `Ziel ${fmt(opts.target)}`, { class: 'chart-label', x: W - padR, y: ty - 4, 'text-anchor': 'end', 'font-size': AXIS_FS }));
    }

    // Segmente: ein `null` in der Eingabe (Tag/Woche ohne Wert) unterbricht die Linie.
    const segs = [];
    let curSeg = [];
    let vi = 0;
    points.forEach((p) => {
      if (!ok(p)) { if (curSeg.length) segs.push(curSeg); curSeg = []; return; }
      curSeg.push(vi++);
    });
    if (curSeg.length) segs.push(curSeg);
    segs.forEach((seg) => {
      const pts = seg.map((i) => `${x(i)},${y(valid[i].value)}`).join(' ');
      if (opts.fill !== false && seg.length > 1) {
        const a = seg[0], b = seg[seg.length - 1];
        svg.appendChild(s('path', { d: `M ${x(a)},${H - padB} L ${pts.replace(/ /g, ' L ')} L ${x(b)},${H - padB} Z`, fill: `url(#${gid})` }));
      }
      if (seg.length > 1) svg.appendChild(s('polyline', { points: pts, fill: 'none', style: paint('stroke', color), 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      else svg.appendChild(s('circle', { cx: x(seg[0]), cy: y(valid[seg[0]].value), r: 2.6, style: paint('fill', color) }));
    });

    // Letzter Punkt hervorheben
    const last = valid[n - 1];
    svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 3.4, style: paint('fill', color) }));
    svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 6, style: `${paint('fill', color)};opacity:0.18` }));

    // X-Beschriftung (erste & letzte) – bei langen Zeiträumen mit Jahr.
    const fl = labelOf(valid[0]), ll = labelOf(last);
    if (fl && n > 1) svg.appendChild(txt(fl, { class: 'chart-axis', x: padL, y: H - 6, 'font-size': AXIS_FS }));
    if (ll) svg.appendChild(txt(ll, { class: 'chart-axis', x: W - padR, y: H - 6, 'text-anchor': 'end', 'font-size': AXIS_FS }));

    const xs = valid.map((_, i) => x(i));
    bind(svg, {
      W, H, padT, padB, n,
      xAt: x,
      nearest: (vx) => nearestIdx(xs, vx),
      title: (i) => (time ? dateLabel(valid[i].date, true) : valid[i].label || ''),
      rows: (i) => [{ value: fmt(valid[i].value) + unit }],
      pointsAt: (i) => [{ x: x(i), y: y(valid[i].value), color }],
      label: summary(opts.label || 'Verlauf', valid, fmt, unit, !!time),
    });
    wrap.appendChild(svg);
  });
  return wrap;
}

/**
 * Mehrere Linien auf gemeinsamer Achse (z. B. Fitness/Ermüdung/Form) mit
 * Y-Skala, Gridlines und Scrubber-Tooltip über alle Reihen. Die Reihen teilen
 * sich die X-Positionen (gleiche Zeitachse); kürzere Reihen enden früher.
 * @param {Array<{name:string, color:string, points:Array<{label,value}>, width?:number, opacity?:number}>} series
 * @param {object} opts { height, zeroLine, fmt, label }
 */
export function multiLineChart(series, opts = {}) {
  const H = opts.height || 150;
  const padR = 10, padT = 14, padB = 22;
  const fmt = opts.fmt || ((v) => fmtNum(v, 0));
  const clean = (series || [])
    .map((ser) => ({ ...ser, points: (ser.points || []).filter((p) => p.value != null && !Number.isNaN(p.value)) }))
    .filter((ser) => ser.points.length);
  const wrap = chartWrap();
  const all = clean.flatMap((ser) => ser.points.map((p) => p.value));
  if (!all.length) {
    wrap.appendChild(emptySvg(320, H));
    return wrap;
  }
  let min = Math.min(...all), max = Math.max(...all);
  if (opts.zeroLine) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= 1; max += 1; }
  const range = max - min; min -= range * 0.12; max += range * 0.12;

  const { ticks, step } = niceTicks(min, max);
  const padL = tickPadL(ticks, step);
  const n = Math.max(...clean.map((ser) => ser.points.length));
  const base = clean.find((ser) => ser.points.length === n) || clean[0];
  const bind = attachScrubber(wrap);
  const name = opts.label || clean.map((ser) => ser.name).filter(Boolean).join(', ') || 'Verlauf';
  const lastIdx = n - 1;
  const label = `${name}: ${n} Tage${base.points[0].label ? ` von ${base.points[0].label} bis ${base.points[lastIdx].label}` : ''}; zuletzt ${clean.map((ser) => `${ser.name || ''} ${fmt(ser.points[ser.points.length - 1].value)}`.trim()).join(', ')}.`;

  fitWidth(wrap, (W) => {
    const inner = W - padL - padR;
    const x = (i) => (n === 1 ? padL + inner / 2 : padL + (i / (n - 1)) * inner);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const old = wrap.querySelector && wrap.querySelector('svg');
    if (old) old.remove();
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: `width:100%;height:${H}px`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    yGrid(svg, { ticks, step, y, padL, W, padR });

    // Nulllinie (für Form, die 0 kreuzt) – nur wenn kein Tick sie ohnehin zeichnet
    if (opts.zeroLine && min < 0 && max > 0 && !ticks.some((t) => t === 0)) {
      svg.appendChild(s('line', { class: 'chart-grid', x1: padL, y1: y(0), x2: W - padR, y2: y(0), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    }
    clean.forEach((ser) => {
      const pts = ser.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
      svg.appendChild(s('polyline', { points: pts, fill: 'none', style: `${paint('stroke', ser.color || ACCENT)};opacity:${ser.opacity == null ? 1 : ser.opacity}`, 'stroke-width': ser.width || 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
    // X-Beschriftung (erste & letzte) aus der längsten Reihe
    const f = base.points[0].label, l = base.points[base.points.length - 1].label;
    if (f) svg.appendChild(txt(f, { class: 'chart-axis', x: padL, y: H - 6, 'font-size': AXIS_FS }));
    if (l) svg.appendChild(txt(l, { class: 'chart-axis', x: W - padR, y: H - 6, 'text-anchor': 'end', 'font-size': AXIS_FS }));

    const xs = Array.from({ length: n }, (_, i) => x(i));
    bind(svg, {
      W, H, padT, padB, n,
      xAt: x,
      nearest: (vx) => nearestIdx(xs, vx),
      title: (i) => base.points[i]?.label || '',
      rows: (i) => clean.filter((ser) => ser.points[i]).map((ser) => ({ color: ser.color || ACCENT, name: ser.name || '', value: fmt(ser.points[i].value) })),
      pointsAt: (i) => clean.map((ser) => (ser.points[i] ? { x: x(i), y: y(ser.points[i].value), color: ser.color || ACCENT } : null)),
      label,
    });
    wrap.appendChild(svg);
  });
  return wrap;
}

/** Grobe Textbreite in SVG-Einheiten (systemnahe Schrift, ~0,55 em je Zeichen). */
function estTextWidth(text, fontSize) {
  return String(text ?? '').length * fontSize * 0.55;
}

/**
 * Zeichnet nur so viele Beschriftungen, wie nebeneinander PASSEN – ausgedünnt
 * vom letzten Balken aus, damit der jüngste Wert immer beschriftet ist.
 * Ohne das überlappten bei vielen Balken (z. B. 21 Tage Einnahmetreue mit
 * Datumsangaben wie „13.07.“) sämtliche Achsenbeschriftungen zu Buchstabenbrei.
 * @returns {(i:number) => boolean}
 */
function labelPicker(points, key, fontSize, step, n) {
  const maxW = points.reduce((m, p) => Math.max(m, estTextWidth(p[key], fontSize)), 0);
  if (!maxW || step <= 0) return () => true;
  const every = Math.max(1, Math.ceil((maxW + 4) / step));   // +4 = Mindestluft
  return (i) => (n - 1 - i) % every === 0;
}

/**
 * Balkendiagramm. points: [{label, value, color?, dim?}]. Liefert ein SVG.
 * Ausgedünnte Werte bleiben erreichbar: Tipp/Hover auf einen Balken zeigt ihn an
 * (FE-13), dazu eine Zusammenfassung für Screenreader.
 * opts: { height, showValues, yUnit, fmt, min, label }
 */
export function barChart(points, opts = {}) {
  const H = opts.height || 150;
  const padT = 18, padB = 24;
  const max = Math.max(1, ...points.map((p) => p.value || 0), opts.min || 0);
  const n = points.length || 1;
  const fmt = opts.fmt || ((v) => String(v));
  const unit = opts.yUnit ? ` ${opts.yUnit}` : '';
  const vals = points.filter((p) => p.value != null);
  const svg = s('svg', { class: 'chart chart--bars', role: 'img' });
  const last = vals[vals.length - 1];
  svg.setAttribute('aria-label', vals.length
    ? `${opts.label || 'Balkendiagramm'}: ${vals.length} Werte${points[0]?.label ? ` von ${points[0].label} bis ${points[points.length - 1].label}` : ''}; höchster ${fmt(Math.max(...vals.map((p) => p.value)))}${unit}, zuletzt ${fmt(last.value)}${unit}${last.label ? ` (${last.label})` : ''}.`
    : `${opts.label || 'Balkendiagramm'}: keine Daten`);

  let geo = null;   // aktuelle Geometrie für den Tipp-Hinweis
  const tipG = s('g', { class: 'chart-bartip', opacity: 0, 'pointer-events': 'none' });

  const draw = (W) => {
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('style', `width:100%;height:${H}px`);
    // Abstand adaptiv: bei vielen Balken schrumpft er, damit die Balken selbst
    // sichtbar breit bleiben (21 Tage ergaben mit festen 8 px nur 7-px-Striche).
    const gap = Math.max(1.5, Math.min(8, W / (n * 4)));
    const bw = (W - gap * (n + 1)) / n;
    const step = bw + gap;
    // X-Achsen-Baseline + optionale Y-Skala (Orientierung, #22)
    svg.appendChild(s('line', { class: 'chart-grid', x1: gap / 2, y1: H - padB + 0.5, x2: W - gap / 2, y2: H - padB + 0.5, 'stroke-width': 1 }));
    if (opts.yUnit) svg.appendChild(txt(`${Math.round(max)} ${opts.yUnit}`, { class: 'chart-axis', x: 3, y: padT - 6, 'font-size': AXIS_FS }));

    const showLabel = labelPicker(points, 'label', LABEL_FS, step, n);
    const valuePoints = points.map((p) => ({ v: opts.fmt ? opts.fmt(p.value) : p.value }));
    const showValue = labelPicker(valuePoints, 'v', VALUE_FS, step, n);

    geo = { gap, bw, step, W };
    points.forEach((p, i) => {
      const h = ((p.value || 0) / max) * (H - padT - padB);
      const px = gap + i * step;
      const py = H - padB - h;
      // `null` = kein Wert an diesem Tag (z. B. vor Planbeginn): kein Balken – anders als 0.
      if (p.value == null) {
        if (p.label && showLabel(i)) svg.appendChild(txt(p.label, { class: 'chart-axis', x: px + bw / 2, y: H - 7, 'text-anchor': 'middle', 'font-size': LABEL_FS }));
        return;
      }
      const rect = s('rect', { x: px, y: py, width: bw, height: Math.max(h, 1), rx: Math.min(5, bw / 2), style: `${paint('fill', p.color || ACCENT)};opacity:${p.dim ? 0.4 : 1}` });
      const t = s('title'); t.textContent = `${p.label ? `${p.label}: ` : ''}${fmt(p.value)}${unit}`;
      rect.appendChild(t);
      svg.appendChild(rect);
      if (opts.showValues && p.value && showValue(i)) svg.appendChild(txt(valuePoints[i].v, { class: 'chart-label', x: px + bw / 2, y: py - 4, 'text-anchor': 'middle', 'font-size': VALUE_FS }));
      if (p.label && showLabel(i)) svg.appendChild(txt(p.label, { class: 'chart-axis', x: px + bw / 2, y: H - 7, 'text-anchor': 'middle', 'font-size': LABEL_FS }));
    });
    svg.appendChild(tipG);
  };

  // Tipp/Hover: Wert des Balkens unter dem Finger oben einblenden.
  const showTip = (ev) => {
    if (!geo || !svg.getBoundingClientRect) return;
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const vx = ((ev.clientX - r.left) / r.width) * geo.W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((vx - geo.gap / 2) / geo.step)));
    const p = points[i];
    tipG.textContent = '';
    if (!p || p.value == null) { tipG.setAttribute('opacity', 0); return; }
    const label = `${p.label ? `${p.label}: ` : ''}${fmt(p.value)}${unit}`;
    const w = estTextWidth(label, 11) + 12;
    const cx = Math.max(w / 2 + 2, Math.min(geo.W - w / 2 - 2, geo.gap + i * geo.step + geo.bw / 2));
    tipG.appendChild(s('rect', { class: 'chart-bartip__bg', x: cx - w / 2, y: 0, width: w, height: 16, rx: 5 }));
    tipG.appendChild(txt(label, { class: 'chart-bartip__text', x: cx, y: 11.5, 'text-anchor': 'middle', 'font-size': 11 }));
    tipG.setAttribute('opacity', 1);
  };
  const hideTip = () => tipG.setAttribute('opacity', 0);
  svg.addEventListener('pointerdown', showTip);
  svg.addEventListener('pointermove', showTip);
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('pointercancel', hideTip);

  fitWidth(svg, draw);
  return svg;
}

/** Donut/Ringdiagramm. segments: [{label, value, color}] */
export function donut(segments, opts = {}) {
  const size = opts.size || 130, r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, b) => a + (b.value || 0), 0) || 1;
  const parts = segments.filter((sg) => sg.value > 0).map((sg) => `${sg.label}: ${sg.value}`).join(', ');
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, style: `width:${size}px;height:${size}px`, role: 'img', 'aria-label': `${opts.label || 'Verteilung'}${opts.centerValue != null ? ` (${opts.centerValue}${opts.centerLabel ? ` ${opts.centerLabel}` : ''})` : ''}: ${parts || 'keine Daten'}` });
  svg.appendChild(s('circle', { class: 'chart-track', cx, cy, r, fill: 'none', 'stroke-width': 14 }));
  let offset = 0;
  segments.forEach((seg) => {
    const frac = (seg.value || 0) / total;
    if (frac <= 0) return;
    const dash = frac * circ;
    const c = s('circle', {
      cx, cy, r, fill: 'none', style: paint('stroke', seg.color || ACCENT),
      'stroke-width': 14, 'stroke-dasharray': `${dash} ${circ - dash}`,
      'stroke-dashoffset': -offset, transform: `rotate(-90 ${cx} ${cy})`, 'stroke-linecap': 'butt',
    });
    svg.appendChild(c);
    offset += dash;
  });
  if (opts.centerValue != null) {
    svg.appendChild(txt(opts.centerValue, { class: 'chart-center', x: cx, y: cy - 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 22, 'font-weight': 800, 'font-family': 'system-ui' }));
    if (opts.centerLabel) svg.appendChild(txt(opts.centerLabel, { class: 'chart-label', x: cx, y: cy + 16, 'text-anchor': 'middle', 'font-size': 10 }));
  }
  return svg;
}

/** Fortschrittsring 0..1. Schmückend neben einer Zahl → für Screenreader ausgeblendet,
    sonst mit `opts.label` benannt. */
export function progressRing(pct, opts = {}) {
  const size = opts.size || 120, sw = opts.stroke || 12, r = size / 2 - sw / 2 - 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const color = opts.color || ACCENT;
  const a11y = opts.label ? { role: 'img', 'aria-label': `${opts.label}: ${Math.round(p * 100)} %` } : { 'aria-hidden': 'true' };
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, style: `width:${size}px;height:${size}px`, ...a11y });
  svg.appendChild(s('circle', { class: 'chart-track', cx, cy, r, fill: 'none', 'stroke-width': sw }));
  svg.appendChild(s('circle', {
    cx, cy, r, fill: 'none', style: paint('stroke', color), 'stroke-width': sw, 'stroke-linecap': 'round',
    'stroke-dasharray': `${p * circ} ${circ}`, transform: `rotate(-90 ${cx} ${cy})`,
  }));
  return svg;
}

/**
 * Aktivitäts-Heatmap im GitHub-Contributions-Stil.
 * matrix = { cols: [{ weekStart, days: [{date, minutes, level, future}×7] }] }
 * 7 Zeilen (Mo–So) × N Spalten (Wochen). Farbe nach level (0–4); future = leer.
 * Zusammenfassung für Screenreader, Tageswerte per Tipp/Hover (deutsches Datum).
 */
export function heatmap(matrix, opts = {}) {
  const cell = opts.cell || 12, gap = 3;
  const padL = 28, padT = 16;
  const cols = matrix.cols || [];
  const W = padL + cols.length * (cell + gap);
  const H = padT + 7 * (cell + gap);
  const OP = [0, 0.28, 0.5, 0.74, 1];
  const days = cols.flatMap((c) => c.days.filter((d) => !d.future));
  const active = days.filter((d) => (d.minutes || 0) > 0);
  const totalMin = active.reduce((a, d) => a + (d.minutes || 0), 0);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px;max-width:none`, role: 'img',
    'aria-label': `${opts.label || 'Trainingsjahr'}: ${active.length} Trainingstage in ${cols.length} Wochen, zusammen ${Math.round(totalMin / 60)} Stunden.`,
  });

  // Wochentag-Labels (Mo/Mi/Fr)
  [[0, 'Mo'], [2, 'Mi'], [4, 'Fr']].forEach(([d, lbl]) =>
    svg.appendChild(txt(lbl, { class: 'chart-axis', x: 0, y: padT + d * (cell + gap) + cell - 1, 'font-size': 9 })));

  let prevMonth = null;
  cols.forEach((col, c) => {
    const x = padL + c * (cell + gap);
    // Monatslabel beim Monatswechsel
    const month = parseInt(col.weekStart.slice(5, 7), 10) - 1;
    if (month !== prevMonth) {
      svg.appendChild(txt(MONTHS_SHORT[month], { class: 'chart-axis', x, y: 10, 'font-size': 9 }));
      prevMonth = month;
    }
    col.days.forEach((day, d) => {
      if (day.future) return;
      const lvl = day.level || 0;
      const rect = s('rect', {
        x, y: padT + d * (cell + gap), width: cell, height: cell, rx: 2.5,
        class: lvl === 0 ? 'chart-cell chart-cell--empty' : 'chart-cell',
        style: lvl === 0 ? null : `${paint('fill', ACCENT)};fill-opacity:${OP[lvl]}`,
      });
      const t = s('title'); t.textContent = `${dateLabel(day.date, true)}: ${day.minutes ? day.minutes + ' min' : 'kein Training'}`;
      rect.appendChild(t);
      svg.appendChild(rect);
    });
  });
  return svg;
}

/** Legende „weniger → mehr“ für die Heatmap. */
export function heatmapLegend() {
  const OP = [0, 0.28, 0.5, 0.74, 1];
  const W = 5 * 15 + 80;
  const svg = s('svg', { viewBox: `0 0 ${W} 16`, style: `width:${W}px;height:16px`, 'aria-hidden': 'true' });
  svg.appendChild(txt('weniger', { class: 'chart-axis', x: 0, y: 12, 'font-size': 9.5 }));
  for (let l = 0; l <= 4; l++) {
    svg.appendChild(s('rect', { x: 46 + l * 15, y: 3, width: 11, height: 11, rx: 2.5, class: l === 0 ? 'chart-cell chart-cell--empty' : 'chart-cell', style: l === 0 ? null : `${paint('fill', ACCENT)};fill-opacity:${OP[l]}` }));
  }
  svg.appendChild(txt('mehr', { class: 'chart-axis', x: 46 + 5 * 15 + 3, y: 12, 'font-size': 9.5 }));
  return svg;
}

/** Mini-Sparkline (nur Linie) – schmückend neben dem Wert, für Screenreader ausgeblendet. */
export function sparkline(values, opts = {}) {
  const W = 100, H = opts.height || 30;
  const v = values.filter((x) => x != null);
  if (v.length < 2) return s('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto', 'aria-hidden': 'true' });
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const x = (i) => (i / (v.length - 1)) * W;
  const y = (val) => H - 2 - ((val - min) / rng) * (H - 4);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  svg.appendChild(s('polyline', { points: v.map((val, i) => `${x(i)},${y(val)}`).join(' '), fill: 'none', style: paint('stroke', opts.color || ACCENT), 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}

/* ------------------------------ Strecke ------------------------------------ */

/**
 * Strecke als Linie – ohne Kartenkacheln, also ohne Anfrage an einen Kartendienst (MKT-17).
 * `route.poly` ist die kodierte, vereinfachte Strecke, `route.ele` optional das Höhenprofil
 * (gleich weit auseinanderliegende Werte). Liefert ein Element mit Karte und Profil.
 * @param {{poly:string, ele?:Array<number|null>}} route
 * @param {{distanceKm?:number, ascentM?:number, decode:Function}} opts
 */
export function routeMap(route, { distanceKm = null, ascentM = null, decode } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'route-map';
  const pts = route && route.poly && decode ? decode(route.poly) : [];
  if (pts.length >= 2) {
    const W = 320, H = 200, PAD = 12;
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xy = pts.map(([la, lo]) => [lo * kx, -la]);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1e-9), (H - 2 * PAD) / (maxY - minY || 1e-9));
    const offX = (W - (maxX - minX) * scale) / 2, offY = (H - (maxY - minY) * scale) / 2;
    const P = ([x, y]) => [Math.round((offX + (x - minX) * scale) * 10) / 10, Math.round((offY + (y - minY) * scale) * 10) / 10];
    const d = xy.map((p, i) => `${i ? 'L' : 'M'}${P(p).join(' ')}`).join('');
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'route-map__track', role: 'img', 'aria-label': `Strecke${distanceKm ? ` über ${fmtNum(distanceKm, 1)} km` : ''} – ohne Karte gezeichnet` });
    svg.appendChild(s('path', { d, fill: 'none', style: paint('stroke', ACCENT), 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const [sx, sy] = P(xy[0]), [ex, ey] = P(xy[xy.length - 1]);
    svg.appendChild(s('circle', { cx: ex, cy: ey, r: 5.5, style: `${paint('fill', 'var(--surface)')};${paint('stroke', 'var(--text)')}`, 'stroke-width': 2.5 }));
    svg.appendChild(s('circle', { cx: sx, cy: sy, r: 5, style: paint('fill', 'var(--good)') }));
    wrap.appendChild(svg);
  }
  const ele = route && Array.isArray(route.ele) ? route.ele : null;
  const vals = ele ? ele.filter((e) => e != null) : [];
  if (vals.length >= 2) {
    const W = 320, H = 72, TOP = 6, BOT = 18;
    const min = Math.min(...vals), max = Math.max(...vals), rng = Math.max(max - min, 10);
    const x = (i) => Math.round(((i / (ele.length - 1)) * W) * 10) / 10;
    const y = (v) => Math.round((TOP + (1 - (v - min) / rng) * (H - TOP - BOT)) * 10) / 10;
    let last = vals[0];
    const line = ele.map((e, i) => { if (e != null) last = e; return `${x(i)},${y(last)}`; });
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'route-map__ele', role: 'img', 'aria-label': `Höhenprofil: ${Math.round(min)} bis ${Math.round(max)} m${ascentM ? `, ${ascentM} Höhenmeter bergauf` : ''}` });
    svg.appendChild(s('polygon', { points: `0,${H - BOT} ${line.join(' ')} ${W},${H - BOT}`, style: paint('fill', 'color-mix(in srgb, var(--accent) 18%, transparent)') }));
    svg.appendChild(s('polyline', { points: line.join(' '), fill: 'none', style: paint('stroke', ACCENT), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.appendChild(txt(`${Math.round(max)} m`, { class: 'chart-axis', x: 2, y: TOP + 8, 'font-size': AXIS_FS }));
    svg.appendChild(txt(`${Math.round(min)} m`, { class: 'chart-axis', x: 2, y: H - BOT - 3, 'font-size': AXIS_FS }));
    svg.appendChild(txt('Start', { class: 'chart-axis', x: 0, y: H - 4, 'font-size': AXIS_FS }));
    if (distanceKm) svg.appendChild(txt(`${fmtNum(distanceKm, 1)} km`, { class: 'chart-axis', x: W, y: H - 4, 'text-anchor': 'end', 'font-size': AXIS_FS }));
    wrap.appendChild(svg);
  }
  return wrap;
}
