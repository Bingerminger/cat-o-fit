/* UI-Tests gegen das Mini-DOM aus test-setup.js: DOM-Helfer (el/append) und die
   selbstgezeichneten SVG-Charts. Stellt sicher, dass die Bausteine echte Knoten
   mit erwarteter Struktur erzeugen und Interaktionen (click/Scrubber) funktionieren. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, append, clear, addDays } from '../js/ui.js';
import { barChart, donut, heatmap, heatmapLegend, progressRing, lineChart, multiLineChart, sparkline } from '../js/charts.js';
import { activityMatrix } from '../js/fitness.js';

test('el(): Klasse, Attribut, Text und Kind-Elemente', () => {
  const node = el('div', { class: 'card big', 'data-id': '7' }, [el('span', { text: 'hi' }), 'welt']);
  assert.equal(node.tagName, 'DIV');
  assert.ok(node.classList.contains('card') && node.classList.contains('big'));
  assert.equal(node.getAttribute('data-id'), '7');
  assert.equal(node.textContent, 'hiwelt');
  assert.equal(node.children.length, 1); // nur das span; Textknoten zählt nicht als child
});

test('el(): onclick feuert bei click()', () => {
  let n = 0;
  const btn = el('button', { onclick: () => { n++; } }, 'OK');
  btn.click(); btn.click();
  assert.equal(n, 2);
});

test('el(): hidden, style-Objekt und null-Kinder werden übersprungen', () => {
  const n = el('div', { hidden: true, style: { color: 'red' } }, [null, false, el('b', { text: 'x' })]);
  assert.equal(n.hidden, true);
  assert.equal(n.style.color, 'red');
  assert.equal(n.children.length, 1);
});

test('clear(): entfernt alle Kinder', () => {
  const n = el('div', {}, [el('span'), el('span')]);
  assert.equal(n.children.length, 2);
  clear(n);
  assert.equal(n.children.length, 0);
});

test('append(): Array, String und null gemischt', () => {
  const n = el('div');
  append(n, [el('i'), 'text', null, el('b')]);
  assert.equal(n.children.length, 2);
  assert.match(n.textContent, /text/);
});

test('barChart: ein Balken (rect) je Datenpunkt + SVG-Wurzel', () => {
  const svg = barChart([{ label: 'A', value: 5 }, { label: 'B', value: 10 }, { label: 'C', value: 3 }], { yUnit: 'km', showValues: true });
  assert.equal(svg.tagName, 'SVG');
  assert.ok(svg.querySelectorAll('rect').length >= 3);
});

/* ---- Achsenbeschriftungen dürfen sich nie überlappen (Bug v3.18.0) ---------
   Bei 21 Tagen Einnahmetreue standen die Datumsangaben („13.07.") als
   Buchstabenbrei übereinander. Diese Helfer prüfen die tatsächlichen
   x-Positionen der gezeichneten Texte gegen ihre geschätzte Breite. */
const CHAR_W = 0.55; // ~Zeichenbreite je Schriftgrad, wie in charts.js
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
/** Findet Paare, deren geschätzte Textkästen auf gleicher Höhe überlappen. */
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

test('barChart: Achsenbeschriftungen überlappen auch bei vielen Balken nicht', () => {
  // 21 Tage mit Datumsangaben – der Fall aus „Labor & Ergänzung → Einnahmetreue".
  const days = Array.from({ length: 21 }, (_, i) => ({
    label: `${String((i % 28) + 1).padStart(2, '0')}.07.`, value: 40 + (i % 5) * 15,
  }));
  const svg = barChart(days, { height: 90 });
  const labels = axisLabels(svg);
  assert.ok(labels.length >= 2, 'einige Beschriftungen bleiben sichtbar');
  assert.ok(labels.length < days.length, 'aber nicht alle 21 – es wird ausgedünnt');
  assert.deepEqual(overlaps(labels), [], 'keine überlappenden Beschriftungen');
  // Der jüngste Balken (rechts) trägt immer eine Beschriftung.
  assert.equal(labels.at(-1).text, days.at(-1).label);
});

test('barChart: wenige Balken behalten ALLE Beschriftungen', () => {
  const weeks = Array.from({ length: 8 }, (_, i) => ({ label: `${i + 1}.`, value: 30 + i }));
  const svg = barChart(weeks, { showValues: true, yUnit: 'km' });
  const labels = axisLabels(svg).filter((l) => /^\d+\.$/.test(l.text));
  assert.equal(labels.length, 8, 'bei acht Wochen bleibt jede Woche beschriftet');
  assert.deepEqual(overlaps(axisLabels(svg)), [], 'auch Werte über den Balken überlappen nicht');
});

test('barChart: auch die Werte über den Balken werden ausgedünnt', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ label: '', value: 1000 + i }));
  const svg = barChart(many, { showValues: true });
  assert.deepEqual(overlaps(axisLabels(svg)), [], 'vierstellige Werte kollidieren nicht');
});

test('barChart: Balken bleiben auch bei vielen Datenpunkten sichtbar breit', () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ label: `${i}.`, value: 50 }));
  const rects = [...barChart(many).querySelectorAll('rect')];
  const w = parseFloat(rects[0].getAttribute('width'));
  assert.ok(w > 9, `Balkenbreite ${w} – mit festem Abstand waren es nur ~6,9 px`);
});

test('heatmap: zeichnet viele Tageszellen + Legende getrennt', () => {
  const T = '2026-06-28';
  const sessions = [{ date: T, durationSec: 3600 }, { date: addDays(T, -10), distanceKm: 12 }];
  const m = activityMatrix({ sessions, today: T });
  const svg = heatmap(m);
  assert.equal(svg.tagName, 'SVG');
  assert.ok(svg.querySelectorAll('rect').length > 100, 'eine Zelle je vergangenem Tag');
  assert.equal(heatmapLegend().tagName, 'SVG');
});

test('donut / progressRing / sparkline liefern SVG, lineChart einen Wrapper mit SVG', () => {
  assert.equal(donut([{ label: 'x', value: 2, color: '#0a0' }, { label: 'y', value: 1, color: '#00a' }], { centerValue: 3, centerLabel: 'St' }).tagName, 'SVG');
  assert.equal(progressRing(0.42).tagName, 'SVG');
  assert.equal(sparkline([1, 2, 3, 2, 4]).tagName, 'SVG');
  const lc = lineChart([{ label: 'a', value: 70 }, { label: 'b', value: 68 }], { target: 65 });
  assert.ok(lc.classList.contains('chart-wrap'));
  assert.equal(lc.querySelector('svg').tagName, 'SVG');
});

test('lineChart: leere Eingabe -> „Keine Daten" ohne Crash', () => {
  const wrap = lineChart([]);
  assert.equal(wrap.querySelector('svg').tagName, 'SVG');
  assert.match(wrap.textContent, /Keine Daten/);
});

test('lineChart: Y-Skala mit runden Ticks und Gridlines', () => {
  const wrap = lineChart([{ label: '1.', value: 60 }, { label: '2.', value: 80 }]);
  const svg = wrap.querySelector('svg');
  const texts = svg.querySelectorAll('text').map((t) => t.textContent);
  ['60', '70', '80'].forEach((tick) => assert.ok(texts.includes(tick), `Tick ${tick} fehlt (${texts.join(', ')})`));
  assert.ok(svg.querySelectorAll('line').length >= 3, 'eine Gridline je Tick');
});

test('lineChart: Scrubber zeigt Datum + Wert im Tooltip (Touch/Maus)', () => {
  const wrap = lineChart(
    [{ label: '1. Jul', value: 70 }, { label: '2. Jul', value: 68 }, { label: '3. Jul', value: 69 }],
    { unit: 'kg' },
  );
  wrap.getBoundingClientRect = () => ({ left: 0, width: 320 });
  const tip = wrap.querySelector('.chart-tip');
  assert.equal(tip.hidden, true, 'Tooltip startet verborgen');
  wrap.dispatchEvent({ type: 'pointermove', clientX: 318 });
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /3\. Jul/);
  assert.match(tip.textContent, /69,0 kg/);
  wrap.dispatchEvent({ type: 'pointerleave' });
  assert.equal(tip.hidden, true, 'pointerleave blendet den Tooltip aus');
});

test('lineChart: Pfeiltasten steuern den Scrubber, Escape blendet aus', () => {
  const wrap = lineChart([{ label: 'Mo', value: 1 }, { label: 'Di', value: 2 }]);
  const tip = wrap.querySelector('.chart-tip');
  wrap.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault() {} });
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Di/); // startet beim letzten Punkt
  wrap.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(tip.hidden, true);
});

test('multiLineChart: Tooltip listet alle Reihen am gewählten Datum', () => {
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
