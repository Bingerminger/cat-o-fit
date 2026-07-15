/* =========================================================================
   charts.js — leichtgewichtige, selbst gezeichnete SVG-Charts (kein CDN).
   Alle Charts sind responsiv (viewBox + width:100%).
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
const cssVar = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

/* --------------------- interne Helfer für Liniencharts ------------------- */

/** „Runde" Y-Ticks (1 / 2 / 2,5 / 5 × 10^k) innerhalb [min, max]. */
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
    svg.appendChild(s('line', { x1: padL, y1: ty, x2: W - padR, y2: ty, stroke: cssVar('--border', '#e3e7eb'), 'stroke-width': 1 }));
    svg.appendChild(txt(tickFmt(t, step), { x: padL - 5, y: ty + 2.6, 'text-anchor': 'end', fill: cssVar('--text-3', '#9aa7b4'), 'font-size': 8 }));
  });
}

/** Linker Innenabstand: so breit wie das längste Tick-Label. */
function tickPadL(ticks, step) {
  const chars = ticks.length ? Math.max(...ticks.map((t) => tickFmt(t, step).length)) : 2;
  return 10 + 4.8 * Math.max(2, chars);
}

/** Positionierbarer Wrapper – Anker für den Scrubber-Tooltip. */
function chartWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  return wrap;
}

/**
 * Scrubber für Liniencharts: eine Führungslinie schnappt zum nächstgelegenen
 * Datenpunkt, ein HTML-Tooltip zeigt Datum + Wert(e). Bedienbar per Touch
 * (Wischen), Maus (Hover) und Tastatur (Pfeiltasten/Escape); vertikales
 * Scrollen bleibt frei (CSS touch-action: pan-y auf .chart-wrap).
 * cfg: { W, H, padT, padB, n, xAt(i), xToIdx(vx), title(i), rows(i), pointsAt(i) }
 */
function attachScrubber(wrap, svg, cfg) {
  const { W, H, padT, padB, n } = cfg;
  const cursor = s('line', { y1: padT, y2: H - padB, stroke: cssVar('--text-3', '#9aa7b4'), 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
  svg.appendChild(cursor);
  const dots = [];
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  let cur = -1;

  const show = (i) => {
    if (i === cur) return;
    cur = i;
    const marks = cfg.pointsAt(i);
    while (dots.length < marks.length) {
      const d = s('circle', { r: 3.6, stroke: cssVar('--surface', '#fff'), 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' });
      dots.push(d); svg.appendChild(d);
    }
    dots.forEach((d, k) => {
      const m = marks[k];
      d.setAttribute('opacity', m ? 1 : 0);
      if (m) { d.setAttribute('cx', m.x); d.setAttribute('cy', m.y); d.setAttribute('fill', m.color); }
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
      tip.style.left = `${Math.max(half + 2, Math.min(ww - half - 2, (cx / W) * ww))}px`;
    } else {
      tip.style.left = `${(cx / W) * 100}%`;
    }
  };
  const hide = () => {
    cur = -1; cursor.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    tip.hidden = true;
  };
  const onMove = (ev) => {
    const r = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    const vx = ((ev.clientX - r.left) / r.width) * W;
    show(Math.max(0, Math.min(n - 1, Math.round(cfg.xToIdx(vx)))));
  };
  wrap.addEventListener('pointerdown', onMove);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') hide(); });
  wrap.addEventListener('pointerleave', hide);
  wrap.addEventListener('pointercancel', hide);
  wrap.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      show(Math.max(0, Math.min(n - 1, cur < 0 ? n - 1 : cur + (ev.key === 'ArrowRight' ? 1 : -1))));
    } else if (ev.key === 'Escape') hide();
  });
  wrap.addEventListener('blur', hide);
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${cfg.title(n - 1)}: ${cfg.rows(n - 1).map((r) => (r.name ? `${r.name} ` : '') + r.value).join(', ')}`);
}

/**
 * Liniendiagramm mit Y-Skala, dezenten Gridlines, optionaler Zielmarkierung
 * und Scrubber-Tooltip (Touch & Maus). Liefert einen Wrapper (<div>) mit SVG.
 * @param {Array<{label:string, value:number}>} points
 * @param {object} opts { color, target, targetLabel, height, unit, fmt, fill }
 */
export function lineChart(points, opts = {}) {
  const W = 320, H = opts.height || 150;
  const padR = 10, padT = 14, padB = 18;
  const color = opts.color || cssVar('--accent', '#18b48a');
  const fmt = opts.fmt || ((v) => fmtNum(v, 1));
  const unit = opts.unit ? ` ${opts.unit}` : '';
  const valid = points.filter((p) => p.value != null && !Number.isNaN(p.value));
  const wrap = chartWrap();

  if (valid.length === 0) {
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: 'width:100%;height:auto' });
    svg.appendChild(txt('Keine Daten', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: cssVar('--text-3', '#888'), 'font-size': 12 }));
    wrap.appendChild(svg);
    return wrap;
  }

  const ys = valid.map((p) => p.value);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (opts.target != null) { min = Math.min(min, opts.target); max = Math.max(max, opts.target); }
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  min -= range * 0.12; max += range * 0.12;

  const { ticks, step } = niceTicks(min, max);
  const padL = tickPadL(ticks, step);
  const n = valid.length;
  const stepX = n === 1 ? 0 : (W - padL - padR) / (n - 1);
  const x = (i) => (n === 1 ? padL + (W - padL - padR) / 2 : padL + i * stepX);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: 'width:100%;height:auto', preserveAspectRatio: 'none' });
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const defs = s('defs');
  const grad = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.28 }));
  grad.appendChild(s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
  defs.appendChild(grad); svg.appendChild(defs);

  // Y-Skala zuerst – Gridlines liegen hinter Fläche und Linie.
  yGrid(svg, { ticks, step, y, padL, W, padR });

  // Zielmarkierung
  if (opts.target != null) {
    const ty = y(opts.target);
    svg.appendChild(s('line', { x1: padL, y1: ty, x2: W - padR, y2: ty, stroke: cssVar('--text-3', '#999'), 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.7 }));
    svg.appendChild(txt(opts.targetLabel || `Ziel ${fmt(opts.target)}`, { x: W - padR, y: ty - 4, 'text-anchor': 'end', fill: cssVar('--text-2', '#888'), 'font-size': 9 }));
  }

  const linePts = valid.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  if (opts.fill !== false) {
    const area = `M ${x(0)},${y(valid[0].value)} L ${linePts.replace(/ /g, ' L ')} L ${x(n - 1)},${H - padB} L ${x(0)},${H - padB} Z`;
    svg.appendChild(s('path', { d: area, fill: `url(#${gid})` }));
  }
  svg.appendChild(s('polyline', { points: linePts, fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // Letzter Punkt hervorheben
  const last = valid[n - 1];
  svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 3.4, fill: color }));
  svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 6, fill: color, opacity: 0.18 }));

  // X-Beschriftung (erste & letzte)
  if (valid[0].label) svg.appendChild(txt(valid[0].label, { x: padL, y: H - 5, fill: cssVar('--text-3', '#999'), 'font-size': 9 }));
  if (valid[n - 1].label) svg.appendChild(txt(valid[n - 1].label, { x: W - padR, y: H - 5, 'text-anchor': 'end', fill: cssVar('--text-3', '#999'), 'font-size': 9 }));

  attachScrubber(wrap, svg, {
    W, H, padT, padB, n,
    xAt: x,
    xToIdx: (vx) => (n === 1 ? 0 : (vx - padL) / stepX),
    title: (i) => valid[i].label || '',
    rows: (i) => [{ value: fmt(valid[i].value) + unit }],
    pointsAt: (i) => [{ x: x(i), y: y(valid[i].value), color }],
  });
  wrap.appendChild(svg);
  return wrap;
}

/**
 * Mehrere Linien auf gemeinsamer Achse (z. B. Fitness/Ermüdung/Form) mit
 * Y-Skala, Gridlines und Scrubber-Tooltip über alle Reihen. Die Reihen teilen
 * sich die X-Positionen (gleiche Zeitachse); kürzere Reihen enden früher.
 * @param {Array<{name:string, color:string, points:Array<{label,value}>, width?:number, opacity?:number}>} series
 * @param {object} opts { height, zeroLine, fmt }
 */
export function multiLineChart(series, opts = {}) {
  const W = 320, H = opts.height || 150;
  const padR = 10, padT = 14, padB = 18;
  const fmt = opts.fmt || ((v) => fmtNum(v, 0));
  const accent = cssVar('--accent', '#18b48a');
  const clean = (series || [])
    .map((ser) => ({ ...ser, points: (ser.points || []).filter((p) => p.value != null && !Number.isNaN(p.value)) }))
    .filter((ser) => ser.points.length);
  const wrap = chartWrap();
  const all = clean.flatMap((ser) => ser.points.map((p) => p.value));
  if (!all.length) {
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: 'width:100%;height:auto' });
    svg.appendChild(txt('Keine Daten', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: cssVar('--text-3', '#888'), 'font-size': 12 }));
    wrap.appendChild(svg);
    return wrap;
  }
  let min = Math.min(...all), max = Math.max(...all);
  if (opts.zeroLine) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= 1; max += 1; }
  const range = max - min; min -= range * 0.12; max += range * 0.12;

  const { ticks, step } = niceTicks(min, max);
  const padL = tickPadL(ticks, step);
  const n = Math.max(...clean.map((ser) => ser.points.length));
  const stepX = n === 1 ? 0 : (W - padL - padR) / (n - 1);
  const x = (i) => (n === 1 ? padL + (W - padL - padR) / 2 : padL + i * stepX);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: 'width:100%;height:auto', preserveAspectRatio: 'none' });
  yGrid(svg, { ticks, step, y, padL, W, padR });

  // Nulllinie (für Form, die 0 kreuzt) – nur wenn kein Tick sie ohnehin zeichnet
  if (opts.zeroLine && min < 0 && max > 0 && !ticks.some((t) => t === 0)) {
    svg.appendChild(s('line', { x1: padL, y1: y(0), x2: W - padR, y2: y(0), stroke: cssVar('--border', '#e3e7eb'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  }
  clean.forEach((ser) => {
    const pts = ser.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
    svg.appendChild(s('polyline', { points: pts, fill: 'none', stroke: ser.color || accent, 'stroke-width': ser.width || 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: ser.opacity == null ? 1 : ser.opacity }));
  });
  // X-Beschriftung (erste & letzte) aus der längsten Reihe
  const base = clean.find((ser) => ser.points.length === n) || clean[0];
  const f = base.points[0].label, l = base.points[base.points.length - 1].label;
  if (f) svg.appendChild(txt(f, { x: padL, y: H - 5, fill: cssVar('--text-3', '#999'), 'font-size': 9 }));
  if (l) svg.appendChild(txt(l, { x: W - padR, y: H - 5, 'text-anchor': 'end', fill: cssVar('--text-3', '#999'), 'font-size': 9 }));

  attachScrubber(wrap, svg, {
    W, H, padT, padB, n,
    xAt: x,
    xToIdx: (vx) => (n === 1 ? 0 : (vx - padL) / stepX),
    title: (i) => base.points[i]?.label || '',
    rows: (i) => clean.filter((ser) => ser.points[i]).map((ser) => ({ color: ser.color || accent, name: ser.name || '', value: fmt(ser.points[i].value) })),
    pointsAt: (i) => clean.map((ser) => (ser.points[i] ? { x: x(i), y: y(ser.points[i].value), color: ser.color || accent } : null)),
  });
  wrap.appendChild(svg);
  return wrap;
}

/** Balkendiagramm. points: [{label, value, color?}] */
export function barChart(points, opts = {}) {
  const W = 320, H = opts.height || 150;
  const padT = 16, padB = 22;
  const max = Math.max(1, ...points.map((p) => p.value || 0), opts.min || 0);
  const n = points.length || 1;
  const gap = 8;
  const bw = (W - gap * (n + 1)) / n;
  const accent = cssVar('--accent', '#18b48a');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto' });
  // X-Achsen-Baseline + optionale Y-Skala (Orientierung, #22)
  svg.appendChild(s('line', { x1: gap / 2, y1: H - padB + 0.5, x2: W - gap / 2, y2: H - padB + 0.5, stroke: cssVar('--border', '#e3e7eb'), 'stroke-width': 1 }));
  if (opts.yUnit) svg.appendChild(txt(`${Math.round(max)} ${opts.yUnit}`, { x: 3, y: padT - 5, fill: cssVar('--text-3', '#9aa7b4'), 'font-size': 8.5 }));
  points.forEach((p, i) => {
    const h = ((p.value || 0) / max) * (H - padT - padB);
    const px = gap + i * (bw + gap);
    const py = H - padB - h;
    svg.appendChild(s('rect', { x: px, y: py, width: bw, height: Math.max(h, 1), rx: Math.min(5, bw / 2), fill: p.color || accent, opacity: p.dim ? 0.4 : 1 }));
    if (opts.showValues && p.value) svg.appendChild(txt(opts.fmt ? opts.fmt(p.value) : p.value, { x: px + bw / 2, y: py - 4, 'text-anchor': 'middle', fill: cssVar('--text-2', '#888'), 'font-size': 9 }));
    if (p.label) svg.appendChild(txt(p.label, { x: px + bw / 2, y: H - 7, 'text-anchor': 'middle', fill: cssVar('--text-3', '#999'), 'font-size': 9.5 }));
  });
  return svg;
}

/** Donut/Ringdiagramm. segments: [{label, value, color}] */
export function donut(segments, opts = {}) {
  const size = opts.size || 130, r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, b) => a + (b.value || 0), 0) || 1;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, style: `width:${size}px;height:${size}px` });
  svg.appendChild(s('circle', { cx, cy, r, fill: 'none', stroke: cssVar('--surface-3', '#eee'), 'stroke-width': 14 }));
  let offset = 0;
  segments.forEach((seg) => {
    const frac = (seg.value || 0) / total;
    if (frac <= 0) return;
    const dash = frac * circ;
    const c = s('circle', {
      cx, cy, r, fill: 'none', stroke: seg.color || cssVar('--accent', '#18b48a'),
      'stroke-width': 14, 'stroke-dasharray': `${dash} ${circ - dash}`,
      'stroke-dashoffset': -offset, transform: `rotate(-90 ${cx} ${cy})`, 'stroke-linecap': 'butt',
    });
    svg.appendChild(c);
    offset += dash;
  });
  if (opts.centerValue != null) {
    svg.appendChild(txt(opts.centerValue, { x: cx, y: cy - 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: cssVar('--text', '#111'), 'font-size': 22, 'font-weight': 800, 'font-family': 'system-ui' }));
    if (opts.centerLabel) svg.appendChild(txt(opts.centerLabel, { x: cx, y: cy + 16, 'text-anchor': 'middle', fill: cssVar('--text-2', '#888'), 'font-size': 9 }));
  }
  return svg;
}

/** Fortschrittsring 0..1. */
export function progressRing(pct, opts = {}) {
  const size = opts.size || 120, sw = opts.stroke || 12, r = size / 2 - sw / 2 - 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const color = opts.color || cssVar('--accent', '#18b48a');
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, style: `width:${size}px;height:${size}px` });
  svg.appendChild(s('circle', { cx, cy, r, fill: 'none', stroke: cssVar('--surface-3', '#eee'), 'stroke-width': sw }));
  svg.appendChild(s('circle', {
    cx, cy, r, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round',
    'stroke-dasharray': `${p * circ} ${circ}`, transform: `rotate(-90 ${cx} ${cy})`,
  }));
  return svg;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/**
 * Aktivitäts-Heatmap im GitHub-Contributions-Stil.
 * matrix = { cols: [{ weekStart, days: [{date, minutes, level, future}×7] }] }
 * 7 Zeilen (Mo–So) × N Spalten (Wochen). Farbe nach level (0–4); future = leer.
 */
export function heatmap(matrix, opts = {}) {
  const cell = opts.cell || 12, gap = 3;
  const padL = 28, padT = 16;
  const cols = matrix.cols || [];
  const W = padL + cols.length * (cell + gap);
  const H = padT + 7 * (cell + gap);
  const accent = cssVar('--accent', '#18b48a');
  const empty = cssVar('--surface-3', '#e9edf0');
  const muted = cssVar('--text-3', '#9aa7b4');
  const OP = [0, 0.28, 0.5, 0.74, 1];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px;max-width:none`, role: 'img' });

  // Wochentag-Labels (Mo/Mi/Fr)
  [[0, 'Mo'], [2, 'Mi'], [4, 'Fr']].forEach(([d, lbl]) =>
    svg.appendChild(txt(lbl, { x: 0, y: padT + d * (cell + gap) + cell - 1, fill: muted, 'font-size': 8.5 })));

  let prevMonth = null;
  cols.forEach((col, c) => {
    const x = padL + c * (cell + gap);
    // Monatslabel beim Monatswechsel
    const month = parseInt(col.weekStart.slice(5, 7), 10) - 1;
    if (month !== prevMonth) {
      svg.appendChild(txt(MONTHS_SHORT[month], { x, y: 10, fill: muted, 'font-size': 8.5 }));
      prevMonth = month;
    }
    col.days.forEach((day, d) => {
      if (day.future) return;
      const lvl = day.level || 0;
      const rect = s('rect', {
        x, y: padT + d * (cell + gap), width: cell, height: cell, rx: 2.5,
        fill: lvl === 0 ? empty : accent, 'fill-opacity': lvl === 0 ? 1 : OP[lvl],
      });
      const t = s('title'); t.textContent = `${day.date}: ${day.minutes ? day.minutes + ' min' : 'kein Training'}`;
      rect.appendChild(t);
      svg.appendChild(rect);
    });
  });
  return svg;
}

/** Legende „weniger → mehr" für die Heatmap. */
export function heatmapLegend() {
  const accent = cssVar('--accent', '#18b48a');
  const empty = cssVar('--surface-3', '#e9edf0');
  const OP = [0, 0.28, 0.5, 0.74, 1];
  const W = 5 * 15 + 80;
  const svg = s('svg', { viewBox: `0 0 ${W} 16`, style: `width:${W}px;height:16px` });
  svg.appendChild(txt('weniger', { x: 0, y: 12, fill: cssVar('--text-3', '#9aa7b4'), 'font-size': 9 }));
  for (let l = 0; l <= 4; l++) {
    svg.appendChild(s('rect', { x: 46 + l * 15, y: 3, width: 11, height: 11, rx: 2.5, fill: l === 0 ? empty : accent, 'fill-opacity': l === 0 ? 1 : OP[l] }));
  }
  svg.appendChild(txt('mehr', { x: 46 + 5 * 15 + 3, y: 12, fill: cssVar('--text-3', '#9aa7b4'), 'font-size': 9 }));
  return svg;
}

/** Mini-Sparkline (nur Linie). */
export function sparkline(values, opts = {}) {
  const W = 100, H = opts.height || 30;
  const v = values.filter((x) => x != null);
  if (v.length < 2) return s('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto' });
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const x = (i) => (i / (v.length - 1)) * W;
  const y = (val) => H - 2 - ((val - min) / rng) * (H - 4);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;height:auto', preserveAspectRatio: 'none' });
  svg.appendChild(s('polyline', { points: v.map((val, i) => `${x(i)},${y(val)}`).join(' '), fill: 'none', stroke: opts.color || cssVar('--accent', '#18b48a'), 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
