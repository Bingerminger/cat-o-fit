/* =========================================================================
   charts.js — lightweight, self-drawn SVG charts (no CDN).

   Drawing at the ACTUAL width (FE-20): the first drawing uses 320
   units (before layout, in tests), after that a ResizeObserver redraws at the
   measured pixel width – 1 unit = 1 px, fixed height, type 10–11 px. Previously
   a fixed viewBox scaled along: 8 px axis values on the iPhone, 400 px tall
   bars with 22 px numbers on the Mac.
   Colours come through CSS classes/variables (FE-14) – switching light/dark recolours
   the charts without redrawing. Every chart carries a summary for
   screen readers (FE-13).
   ========================================================================= */

import { fmtNum } from './ui.js';
import { fmtDayMonth, monthNames, weekdayNames } from './format.js';
import { t as tr, tp } from './i18n.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (children) [].concat(children).forEach((c) => c && node.appendChild(c));
  return node;
}
function txt(content, attrs = {}) { const t = s('text', attrs); t.textContent = content; return t; }
/** Colour as style – `var(--…)` works reliably there, but not in presentation attributes. */
const paint = (prop, color) => `${prop}:${color}`;
const ACCENT = 'var(--accent)';

const AXIS_FS = 10.5;     // Axis values/date in px
const LABEL_FS = 10.5;    // Bar label
const VALUE_FS = 10;      // Values above bars

const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
/** "27. Sept." – with the year if the span covers almost a year or more. */
function dateLabel(iso, withYear) {
  return `${fmtDayMonth(iso.slice(0, 10))}${withYear ? ` ${iso.slice(0, 4)}` : ''}`;
}
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/* --------------------- internal helpers for line charts ------------------- */

/** "Round" y ticks (1 / 2 / 2.5 / 5 × 10^k) within [min, max]. */
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

/** Tick label: only as many decimals as the step size needs. */
const tickFmt = (t, step) => fmtNum(t, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

/** Subtle horizontal gridlines + tick values at the left edge. */
function yGrid(svg, { ticks, step, y, padL, W, padR }) {
  ticks.forEach((t) => {
    const ty = y(t);
    svg.appendChild(s('line', { class: 'chart-grid', x1: padL, y1: ty, x2: W - padR, y2: ty, 'stroke-width': 1 }));
    svg.appendChild(txt(tickFmt(t, step), { class: 'chart-axis', x: padL - 5, y: ty + 3.5, 'text-anchor': 'end', 'font-size': AXIS_FS }));
  });
}

/** Left inner padding: as wide as the longest tick label. */
function tickPadL(ticks, step) {
  const chars = ticks.length ? Math.max(...ticks.map((t) => tickFmt(t, step).length)) : 2;
  return 10 + AXIS_FS * 0.6 * Math.max(2, chars);
}

/** Positionable wrapper – anchor for the scrubber tooltip. */
function chartWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  return wrap;
}

/**
 * Draw at the actual width: first with 320 (before layout, in tests), then redraw on
 * every width change. The observer detaches as soon as the element is gone.
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

/** Empty chart ("No data"). */
function emptySvg(W, H) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: `width:100%;height:${H}px`, role: 'img', 'aria-label': tr('charts.noData') });
  svg.appendChild(txt(tr('charts.noData'), { class: 'chart-axis', x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 12 }));
  return svg;
}

/**
 * Scrubber for line charts: a guide line snaps to the nearest
 * data point, an HTML tooltip shows date + value(s). Operable by touch
 * (swipe), mouse (hover) and keyboard (arrow keys/Escape); vertical
 * scrolling stays free (CSS touch-action: pan-y on .chart-wrap).
 * The events are attached once to the wrapper; on every redraw `bind()` binds
 * the new SVG together with its configuration.
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

    tip.textContent = '';                       // Insert data as text only (no innerHTML)
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
    const ww = wrap.clientWidth || 0;           // Do not clip the bubble at the edges
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

/** Index of the point whose x position is nearest to `vx`. */
function nearestIdx(xs, vx) {
  let best = 0, bd = Infinity;
  xs.forEach((x, i) => { const d = Math.abs(x - vx); if (d < bd) { bd = d; best = i; } });
  return best;
}

/**
 * Time axis (FE-09): if all points carry a date (`date`, ISO), they are placed
 * by day – two weeks and eight months no longer get the same width.
 * Returns the day offset per point (or null without data) and whether the year belongs in
 * the label.
 */
function timeAxis(pts) {
  if (!pts.length || !pts.every((p) => isIso(p.date))) return null;
  const d0 = dayNum(pts[0].date);
  const days = pts.map((p) => dayNum(p.date) - d0);
  return { days, span: Math.max(1, days[days.length - 1]), withYear: days[days.length - 1] > 330 };
}

/** Summary for screen readers: period, min/max, last value. */
function summary(name, pts, fmt, unit, dates) {
  if (!pts.length) return tr('charts.noDataNamed', { name });
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const first = dates ? dateLabel(pts[0].date, true) : pts[0].label;
  const last = pts[pts.length - 1];
  const lastLbl = dates ? dateLabel(last.date, true) : last.label;
  const span = first && lastLbl && pts.length > 1 ? ` ${tr('charts.range', { from: first, to: lastLbl })}` : '';
  return tp('charts.summary', pts.length, {
    name, span, lo: `${fmt(lo)}${unit}`, hi: `${fmt(hi)}${unit}`, last: `${fmt(last.value)}${unit}`, lastLabel: lastLbl ? ` (${lastLbl})` : '',
  });
}

/**
 * Line chart with y scale, subtle gridlines, optional target marker
 * and scrubber tooltip (touch & mouse). Returns a wrapper (<div>) with SVG.
 * Points with `date` (ISO) are placed by date; `value: null` breaks the line.
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
  // Corridors (`bands`): limits near the values are included on the axis, distant
  // ones (e.g. ferritin upper limit 300 for values around 50) are clipped at the edge.
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

    // Y scale first – gridlines lie behind area and line.
    yGrid(svg, { ticks, step, y, padL, W, padR });

    // Corridors: `fill` = area (e.g. sport target range), `frame` = dashed limits
    // (e.g. the lab's reference range). Open limits (null) extend to the edge.
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

    // Target marker
    if (opts.target != null) {
      const ty = y(opts.target);
      svg.appendChild(s('line', { class: 'chart-target', x1: padL, y1: ty, x2: W - padR, y2: ty, 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
      svg.appendChild(txt(opts.targetLabel || tr('charts.target', { value: fmt(opts.target) }), { class: 'chart-label', x: W - padR, y: ty - 4, 'text-anchor': 'end', 'font-size': AXIS_FS }));
    }

    // Segments: a `null` in the input (day/week without a value) breaks the line.
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

    // Highlight last point
    const last = valid[n - 1];
    svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 3.4, style: paint('fill', color) }));
    svg.appendChild(s('circle', { cx: x(n - 1), cy: y(last.value), r: 6, style: `${paint('fill', color)};opacity:0.18` }));

    // X labels (first & last) – with the year for long periods.
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
      label: summary(opts.label || tr('charts.trend'), valid, fmt, unit, !!time),
    });
    wrap.appendChild(svg);
  });
  return wrap;
}

/**
 * Several lines on a shared axis (e.g. fitness/fatigue/form) with
 * y scale, gridlines and scrubber tooltip across all series. The series share
 * the x positions (same time axis); shorter series end earlier.
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
  const name = opts.label || clean.map((ser) => ser.name).filter(Boolean).join(', ') || tr('charts.trend');
  const lastIdx = n - 1;
  const label = tp('charts.multiSummary', n, {
    name,
    span: base.points[0].label ? ` ${tr('charts.range', { from: base.points[0].label, to: base.points[lastIdx].label })}` : '',
    last: clean.map((ser) => `${ser.name || ''} ${fmt(ser.points[ser.points.length - 1].value)}`.trim()).join(', '),
  });

  fitWidth(wrap, (W) => {
    const inner = W - padL - padR;
    const x = (i) => (n === 1 ? padL + inner / 2 : padL + (i / (n - 1)) * inner);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const old = wrap.querySelector && wrap.querySelector('svg');
    if (old) old.remove();
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', style: `width:100%;height:${H}px`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    yGrid(svg, { ticks, step, y, padL, W, padR });

    // Zero line (for form, which crosses 0) – only if no tick draws it anyway
    if (opts.zeroLine && min < 0 && max > 0 && !ticks.some((t) => t === 0)) {
      svg.appendChild(s('line', { class: 'chart-grid', x1: padL, y1: y(0), x2: W - padR, y2: y(0), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    }
    clean.forEach((ser) => {
      const pts = ser.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
      svg.appendChild(s('polyline', { points: pts, fill: 'none', style: `${paint('stroke', ser.color || ACCENT)};opacity:${ser.opacity == null ? 1 : ser.opacity}`, 'stroke-width': ser.width || 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
    // X labels (first & last) from the longest series
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

/** Rough text width in SVG units (system-like font, ~0.55 em per character). */
function estTextWidth(text, fontSize) {
  return String(text ?? '').length * fontSize * 0.55;
}

/**
 * Draws only as many labels as FIT side by side – thinned out
 * from the last bar onward, so the most recent value is always labelled.
 * Without that, with many bars (e.g. 21 days of medication adherence with
 * dates such as "13.07.") all the axis labels blurred into a mess.
 * @returns {(i:number) => boolean}
 */
function labelPicker(points, key, fontSize, step, n) {
  const maxW = points.reduce((m, p) => Math.max(m, estTextWidth(p[key], fontSize)), 0);
  if (!maxW || step <= 0) return () => true;
  const every = Math.max(1, Math.ceil((maxW + 4) / step));   // +4 = minimum breathing room
  return (i) => (n - 1 - i) % every === 0;
}

/**
 * Bar chart. points: [{label, value, color?, dim?}]. Returns an SVG.
 * Thinned-out values stay reachable: tap/hover on a bar shows it
 * (FE-13), plus a summary for screen readers.
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
    ? tp('charts.barSummary', vals.length, {
      name: opts.label || tr('charts.barChart'),
      span: points[0]?.label ? ` ${tr('charts.range', { from: points[0].label, to: points[points.length - 1].label })}` : '',
      hi: `${fmt(Math.max(...vals.map((p) => p.value)))}${unit}`, last: `${fmt(last.value)}${unit}`, lastLabel: last.label ? ` (${last.label})` : '',
    })
    : tr('charts.noDataNamed', { name: opts.label || tr('charts.barChart') }));

  let geo = null;   // current geometry for the tap hint
  const tipG = s('g', { class: 'chart-bartip', opacity: 0, 'pointer-events': 'none' });

  const draw = (W) => {
    svg.textContent = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('style', `width:100%;height:${H}px`);
    // Gap is adaptive: with many bars it shrinks so that the bars themselves
    // stay visibly wide (21 days with a fixed 8 px gave only 7 px strokes).
    const gap = Math.max(1.5, Math.min(8, W / (n * 4)));
    const bw = (W - gap * (n + 1)) / n;
    const step = bw + gap;
    // X axis baseline + optional y scale (orientation, #22)
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
      // `null` = no value on that day (e.g. before the plan start): no bar – unlike 0.
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

  // Tap/hover: show the value of the bar under the finger at the top.
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

/** Donut/ring chart. segments: [{label, value, color}] */
export function donut(segments, opts = {}) {
  const size = opts.size || 130, r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, b) => a + (b.value || 0), 0) || 1;
  const parts = segments.filter((sg) => sg.value > 0).map((sg) => `${sg.label}: ${sg.value}`).join(', ');
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, style: `width:${size}px;height:${size}px`, role: 'img', 'aria-label': `${opts.label || tr('charts.distribution')}${opts.centerValue != null ? ` (${opts.centerValue}${opts.centerLabel ? ` ${opts.centerLabel}` : ''})` : ''}: ${parts || tr('charts.noDataShort')}` });
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

/** Progress ring 0..1. Decorative next to a number → hidden from screen readers,
    otherwise named with `opts.label`. */
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
 * Activity heatmap in the GitHub contributions style.
 * matrix = { cols: [{ weekStart, days: [{date, minutes, level, future}×7] }] }
 * 7 rows (Mon–Sun) × N columns (weeks). Colour by level (0–4); future = empty.
 * Summary for screen readers, day values on tap/hover (German date).
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
    'aria-label': tp('charts.heatmapSummary', active.length, {
      name: opts.label || tr('charts.trainingYear'),
      weeks: tp('charts.weeksCount', cols.length), hours: tp('charts.hoursCount', Math.round(totalMin / 60)),
    }),
  });

  // Weekday labels (Mon/Wed/Fri)
  const dayNames = weekdayNames();
  [[0, 1], [2, 3], [4, 5]].forEach(([d, wd]) =>
    svg.appendChild(txt(dayNames[wd], { class: 'chart-axis', x: 0, y: padT + d * (cell + gap) + cell - 1, 'font-size': 9 })));

  let prevMonth = null;
  cols.forEach((col, c) => {
    const x = padL + c * (cell + gap);
    // Month label at the month change
    const month = parseInt(col.weekStart.slice(5, 7), 10) - 1;
    if (month !== prevMonth) {
      svg.appendChild(txt(monthNames(false)[month], { class: 'chart-axis', x, y: 10, 'font-size': 9 }));
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
      const t = s('title'); t.textContent = `${dateLabel(day.date, true)}: ${day.minutes ? day.minutes + ' min' : tr('charts.noTraining')}`;
      rect.appendChild(t);
      svg.appendChild(rect);
    });
  });
  return svg;
}

/** Legend "less → more" for the heatmap. */
export function heatmapLegend() {
  const OP = [0, 0.28, 0.5, 0.74, 1];
  const W = 5 * 15 + 80;
  const svg = s('svg', { viewBox: `0 0 ${W} 16`, style: `width:${W}px;height:16px`, 'aria-hidden': 'true' });
  svg.appendChild(txt(tr('charts.less'), { class: 'chart-axis', x: 0, y: 12, 'font-size': 9.5 }));
  for (let l = 0; l <= 4; l++) {
    svg.appendChild(s('rect', { x: 46 + l * 15, y: 3, width: 11, height: 11, rx: 2.5, class: l === 0 ? 'chart-cell chart-cell--empty' : 'chart-cell', style: l === 0 ? null : `${paint('fill', ACCENT)};fill-opacity:${OP[l]}` }));
  }
  svg.appendChild(txt(tr('charts.more'), { class: 'chart-axis', x: 46 + 5 * 15 + 3, y: 12, 'font-size': 9.5 }));
  return svg;
}

/** Mini sparkline (line only) – decorative next to the value, hidden from screen readers. */
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

/* ------------------------------ Route ------------------------------------ */

/**
 * Route as a line – without map tiles, hence without a request to a map service (MKT-17).
 * `route.poly` is the encoded, simplified route, `route.ele` optionally the elevation profile
 * (evenly spaced values). Returns an element with map and profile.
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
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'route-map__track', role: 'img', 'aria-label': distanceKm ? tr('charts.routeDistance', { km: fmtNum(distanceKm, 1) }) : tr('charts.route') });
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
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'route-map__ele', role: 'img', 'aria-label': ascentM
      ? tr('charts.elevationAscent', { min: Math.round(min), max: Math.round(max), ascent: ascentM })
      : tr('charts.elevation', { min: Math.round(min), max: Math.round(max) }) });
    svg.appendChild(s('polygon', { points: `0,${H - BOT} ${line.join(' ')} ${W},${H - BOT}`, style: paint('fill', 'color-mix(in srgb, var(--accent) 18%, transparent)') }));
    svg.appendChild(s('polyline', { points: line.join(' '), fill: 'none', style: paint('stroke', ACCENT), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.appendChild(txt(`${Math.round(max)} m`, { class: 'chart-axis', x: 2, y: TOP + 8, 'font-size': AXIS_FS }));
    svg.appendChild(txt(`${Math.round(min)} m`, { class: 'chart-axis', x: 2, y: H - BOT - 3, 'font-size': AXIS_FS }));
    svg.appendChild(txt(tr('charts.start'), { class: 'chart-axis', x: 0, y: H - 4, 'font-size': AXIS_FS }));
    if (distanceKm) svg.appendChild(txt(`${fmtNum(distanceKm, 1)} km`, { class: 'chart-axis', x: W, y: H - 4, 'text-anchor': 'end', 'font-size': AXIS_FS }));
    wrap.appendChild(svg);
  }
  return wrap;
}
