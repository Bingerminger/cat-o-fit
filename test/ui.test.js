/* UI tests against the mini DOM from test-setup.js: DOM helpers (el/append) and the
   self-drawn SVG charts. Ensures that the building blocks produce real nodes
   with the expected structure and that interactions (click/scrubber) work. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, append, clear, addDays, textarea, input } from '../js/ui.js';
import { barChart, donut, heatmap, heatmapLegend, progressRing, lineChart, multiLineChart, sparkline } from '../js/charts.js';
import { activityMatrix } from '../js/fitness.js';

test('el(): class, attribute, text and child elements', () => {
  const node = el('div', { class: 'card big', 'data-id': '7' }, [el('span', { text: 'hi' }), 'welt']);
  assert.equal(node.tagName, 'DIV');
  assert.ok(node.classList.contains('card') && node.classList.contains('big'));
  assert.equal(node.getAttribute('data-id'), '7');
  assert.equal(node.textContent, 'hiwelt');
  assert.equal(node.children.length, 1); // only the span; a text node does not count as a child
});

test('textarea(): existing text is in the field – otherwise saving deletes ingredients, goals and notes', () => {
  const t = textarea({ value: '60 g Haferflocken\n150 g Skyr' });
  assert.equal(t.value, '60 g Haferflocken\n150 g Skyr');
  assert.equal(input({ value: '42' }).value, '42');
  assert.equal(textarea({ placeholder: 'leer' }).value, '');
});

test('el(): onclick fires on click()', () => {
  let n = 0;
  const btn = el('button', { onclick: () => { n++; } }, 'OK');
  btn.click(); btn.click();
  assert.equal(n, 2);
});

test('el(): hidden, style object and null children are skipped', () => {
  const n = el('div', { hidden: true, style: { color: 'red' } }, [null, false, el('b', { text: 'x' })]);
  assert.equal(n.hidden, true);
  assert.equal(n.style.color, 'red');
  assert.equal(n.children.length, 1);
});

test('clear(): removes all children', () => {
  const n = el('div', {}, [el('span'), el('span')]);
  assert.equal(n.children.length, 2);
  clear(n);
  assert.equal(n.children.length, 0);
});

test('append(): array, string and null mixed', () => {
  const n = el('div');
  append(n, [el('i'), 'text', null, el('b')]);
  assert.equal(n.children.length, 2);
  assert.match(n.textContent, /text/);
});

test('barChart: one bar (rect) per data point + SVG root', () => {
  const svg = barChart([{ label: 'A', value: 5 }, { label: 'B', value: 10 }, { label: 'C', value: 3 }], { yUnit: 'km', showValues: true });
  assert.equal(svg.tagName, 'SVG');
  assert.ok(svg.querySelectorAll('rect').length >= 3);
});

/* ---- Axis labels must never overlap (bug v3.18.0) ---------
   With 21 days of intake adherence the dates ("13.07.") were stacked on top of
   each other as a jumble of letters. These helpers check the actual
   x positions of the drawn texts against their estimated width. */
const CHAR_W = 0.55; // ~character width per font size, as in charts.js
function axisLabels(svg) {
  return [...svg.querySelectorAll('text')]
    .map((t) => ({
      text: t.textContent,
      x: parseFloat(t.getAttribute('x')),
      y: parseFloat(t.getAttribute('y')),
      fs: parseFloat(t.getAttribute('font-size')) || 9,
      anchor: t.getAttribute('text-anchor'),
    }))
    .filter((t) => t.anchor === 'middle' && Number.isFinite(t.x));
}
/** Finds pairs whose estimated text boxes overlap at the same height. */
function overlaps(labels) {
  const out = [];
  const byRow = new Map();
  labels.forEach((l) => {
    const row = Math.round(l.y);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(l);
  });
  for (const row of byRow.values()) {
    const sorted = row.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const halfA = (a.text.length * a.fs * CHAR_W) / 2;
      const halfB = (b.text.length * b.fs * CHAR_W) / 2;
      if (a.x + halfA > b.x - halfB) out.push([a.text, b.text]);
    }
  }
  return out;
}

test('barChart: axis labels do not overlap even with many bars', () => {
  // 21 days with dates – the case from the "Adherence" chart in the labs and supplements view.
  const days = Array.from({ length: 21 }, (_, i) => ({
    label: `${String((i % 28) + 1).padStart(2, '0')}.07.`, value: 40 + (i % 5) * 15,
  }));
  const svg = barChart(days, { height: 90 });
  const labels = axisLabels(svg);
  assert.ok(labels.length >= 2, 'some labels stay visible');
  assert.ok(labels.length < days.length, 'but not all 21 – it is thinned out');
  assert.deepEqual(overlaps(labels), [], 'no overlapping labels');
  // The most recent bar (right) always carries a label.
  assert.equal(labels.at(-1).text, days.at(-1).label);
});

test('barChart: few bars keep ALL labels', () => {
  const weeks = Array.from({ length: 8 }, (_, i) => ({ label: `${i + 1}.`, value: 30 + i }));
  const svg = barChart(weeks, { showValues: true, yUnit: 'km' });
  const labels = axisLabels(svg).filter((l) => /^\d+\.$/.test(l.text));
  assert.equal(labels.length, 8, 'with eight weeks every week stays labelled');
  assert.deepEqual(overlaps(axisLabels(svg)), [], 'values above the bars do not overlap either');
});

test('barChart: the values above the bars are also thinned out', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ label: '', value: 1000 + i }));
  const svg = barChart(many, { showValues: true });
  assert.deepEqual(overlaps(axisLabels(svg)), [], 'four-digit values do not collide');
});

test('barChart: bars stay visibly wide even with many data points', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ label: `${i}.`, value: 50 }));
  const rects = [...barChart(many).querySelectorAll('rect')];
  const w = parseFloat(rects[0].getAttribute('width'));
  assert.ok(w > 9, `Bar width ${w} – with a fixed gap it was only ~6.9 px`);
});

test('heatmap: draws many day cells + legend separately', () => {
  const T = '2026-06-28';
  const sessions = [{ date: T, durationSec: 3600 }, { date: addDays(T, -10), distanceKm: 12 }];
  const m = activityMatrix({ sessions, today: T });
  const svg = heatmap(m);
  assert.equal(svg.tagName, 'SVG');
  assert.ok(svg.querySelectorAll('rect').length > 100, 'one cell per past day');
  assert.equal(heatmapLegend().tagName, 'SVG');
});

test('donut / progressRing / sparkline return SVG, lineChart a wrapper with SVG', () => {
  assert.equal(donut([{ label: 'x', value: 2, color: '#0a0' }, { label: 'y', value: 1, color: '#00a' }], { centerValue: 3, centerLabel: 'St' }).tagName, 'SVG');
  assert.equal(progressRing(0.42).tagName, 'SVG');
  assert.equal(sparkline([1, 2, 3, 2, 4]).tagName, 'SVG');
  const lc = lineChart([{ label: 'a', value: 70 }, { label: 'b', value: 68 }], { target: 65 });
  assert.ok(lc.classList.contains('chart-wrap'));
  assert.equal(lc.querySelector('svg').tagName, 'SVG');
});

test('lineChart: empty input -> "No data" without a crash', () => {
  const wrap = lineChart([]);
  assert.equal(wrap.querySelector('svg').tagName, 'SVG');
  assert.match(wrap.textContent, /Keine Daten/);
});

test('lineChart: Y scale with round ticks and gridlines', () => {
  const wrap = lineChart([{ label: '1.', value: 60 }, { label: '2.', value: 80 }]);
  const svg = wrap.querySelector('svg');
  const texts = svg.querySelectorAll('text').map((t) => t.textContent);
  ['60', '70', '80'].forEach((tick) => assert.ok(texts.includes(tick), `Tick ${tick} missing (${texts.join(', ')})`));
  assert.ok(svg.querySelectorAll('line').length >= 3, 'one gridline per tick');
});

test('lineChart: scrubber shows date + value in the tooltip (touch/mouse)', () => {
  const wrap = lineChart(
    [{ label: '1. Jul', value: 70 }, { label: '2. Jul', value: 68 }, { label: '3. Jul', value: 69 }],
    { unit: 'kg' },
  );
  wrap.getBoundingClientRect = () => ({ left: 0, width: 320 });
  const tip = wrap.querySelector('.chart-tip');
  assert.equal(tip.hidden, true, 'tooltip starts hidden');
  wrap.dispatchEvent({ type: 'pointermove', clientX: 318 });
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /3\. Jul/);
  assert.match(tip.textContent, /69,0 kg/);
  wrap.dispatchEvent({ type: 'pointerleave' });
  assert.equal(tip.hidden, true, 'pointerleave hides the tooltip');
});

test('lineChart: arrow keys control the scrubber, Escape hides it', () => {
  const wrap = lineChart([{ label: 'Mo', value: 1 }, { label: 'Di', value: 2 }]);
  const tip = wrap.querySelector('.chart-tip');
  wrap.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault() {} });
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Di/); // starts at the last point
  wrap.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(tip.hidden, true);
});

test('multiLineChart: tooltip lists all series at the chosen date', () => {
  const mk = (vals) => vals.map((v, i) => ({ label: `${i + 1}.`, value: v }));
  const wrap = multiLineChart([
    { name: 'Fitness', color: '#3d8bff', points: mk([10, 12, 14]) },
    { name: 'Ermüdung', color: '#f5a623', points: mk([8, 15, 11]) },
  ], { zeroLine: true });
  assert.ok(wrap.classList.contains('chart-wrap'));
  wrap.getBoundingClientRect = () => ({ left: 0, width: 320 });
  wrap.dispatchEvent({ type: 'pointermove', clientX: 0 });
  const tip = wrap.querySelector('.chart-tip');
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Fitness/);
  assert.match(tip.textContent, /Ermüdung/);
  assert.match(tip.textContent, /10/);
  assert.match(tip.textContent, /8/);
});

/* ---- Package G: charts (FE-09, FE-13, FE-14, FE-20) ---- */
const polyXs = (svg) => svg.querySelectorAll('polyline').map((pl) => pl.getAttribute('points').split(' ').map((p) => parseFloat(p.split(',')[0])));

test('FE-09: points with a date are positioned by days, the year is added for long spans', () => {
  const wrap = lineChart([
    { date: '2025-01-01', value: 30 }, { date: '2025-01-15', value: 32 },
    { date: '2025-09-01', value: 50 }, { date: '2025-12-01', value: 60 },
  ]);
  const [xs] = polyXs(wrap.querySelector('svg'));
  const ratio = (xs[1] - xs[0]) / (xs[3] - xs[0]);
  assert.ok(Math.abs(ratio - 14 / 334) < 0.01, `two weeks are ${ratio.toFixed(3)} of the span (expected ${(14 / 334).toFixed(3)})`);
  const texts = wrap.querySelector('svg').querySelectorAll('text').map((t) => t.textContent);
  assert.ok(texts.includes('1. Jan. 2025') && texts.includes('1. Dez. 2025'), texts.join(' | '));
});

test('FE-09: a missing value (null) interrupts the line instead of connecting it', () => {
  const wrap = lineChart([{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: null }, { label: 'd', value: 3 }, { label: 'e', value: 4 }]);
  assert.equal(wrap.querySelector('svg').querySelectorAll('polyline').length, 2);
});

test('FE-13: charts carry a summary for screen readers', () => {
  const lc = lineChart([{ date: '2026-09-01', value: 71.2 }, { date: '2026-09-20', value: 70.4 }], { label: 'Gewicht', unit: 'kg' });
  assert.match(lc.getAttribute('aria-label'), /^Gewicht: 2 Werte von 1\. Sept\. 2026 bis 20\. Sept\. 2026; niedrigster 70,4 kg, höchster 71,2 kg, zuletzt 70,4 kg/);
  const bc = barChart([{ label: '1.', value: 20 }, { label: '2.', value: 34 }], { yUnit: 'km', label: 'Lauf-km' });
  assert.equal(bc.getAttribute('role'), 'img');
  assert.match(bc.getAttribute('aria-label'), /Lauf-km: 2 Werte .*höchster 34 km, zuletzt 34 km/);
  assert.match(bc.querySelectorAll('rect')[0].textContent, /1\.: 20 km/, 'value per bar as title');
  const T = '2026-06-28';
  const hm = heatmap(activityMatrix({ sessions: [{ date: T, durationSec: 3600 }], today: T }));
  assert.match(hm.getAttribute('aria-label'), /1 Trainingstage? in \d+ Wochen/);
  assert.match(donut([{ label: 'Easy', value: 3, color: '#0a0' }], { label: 'Einheiten' }).getAttribute('aria-label'), /Einheiten: Easy: 3/);
  assert.equal(progressRing(0.5).getAttribute('aria-hidden'), 'true', 'ring next to the number is decoration');
});

test('FE-20/FE-14: fixed height, readable font in px, colours via CSS classes', () => {
  const wrap = lineChart([{ label: 'a', value: 1 }, { label: 'b', value: 2 }], { height: 150 });
  const svg = wrap.querySelector('svg');
  assert.match(svg.getAttribute('style'), /height:150px/);
  const sizes = svg.querySelectorAll('text').map((t) => parseFloat(t.getAttribute('font-size')));
  assert.ok(sizes.every((fs) => fs >= 10), `Font sizes ${sizes.join(', ')}`);
  const grid = svg.querySelectorAll('line').filter((l) => (l.getAttribute('class') || '').includes('chart-grid'));
  assert.ok(grid.length >= 2, 'grid via class');
  assert.ok(grid.every((l) => l.getAttribute('stroke') == null), 'no burnt-in colour');
});
