/* Hilfe direkt an der Kennzahl (DOC-19, UI-21, DOC-12):
   - Jeder Hilfeartikel hat eine eindeutige, adressierbare ID (#/hilfe/<id>).
   - Jede ⓘ-Verknüpfung im Code (infoButton / sectionHead-help) zeigt auf einen Artikel.
   - Jeder Verweis in der Hilfe führt auf eine registrierte Route.
   - Die Suche kennt Synonyme (RED-S → Energieversorgung).
   - Die Labor-Wege kommen aus labsources.js – eine Quelle für Labor-Ansicht und Hilfe.
   Vor v3.21.0 hatten Artikel keine Adresse, keine Ansicht verlinkte in die Hilfe, und
   help.js pflegte eine eigene, abweichende Fassung der Labor-Wege. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { helpSections, findArticle, articleText } from '../js/helpcontent.js';
import { LAB_SOURCES } from '../js/labsources.js';
import * as store from '../js/storage.js';

const JS = new URL('../js/', import.meta.url);
const read = (f) => readFileSync(new URL(f, JS), 'utf8');
const sections = helpSections('Alex');
const articles = sections.flatMap((s) => s.articles);

function shell() {
  document.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root', 'toast-root']) {
    const e = document.createElement('div'); e.setAttribute('id', id); document.body.appendChild(e);
  }
  const view = document.createElement('div'); view.setAttribute('id', 'view'); document.body.appendChild(view);
  return view;
}

test('DOC-19: jeder Artikel hat eine eindeutige ID aus Kleinbuchstaben', () => {
  const ids = articles.map((a) => a.id);
  assert.ok(ids.length >= 60, `nur ${ids.length} Artikel`);
  assert.ok(ids.every((id) => /^[a-z0-9-]+$/.test(id)), 'IDs als Adresse brauchbar');
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'keine doppelten IDs');
});

test('DOC-19/UI-21: jede ⓘ im Code zeigt auf einen vorhandenen Artikel', () => {
  const refs = [];
  for (const f of readdirSync(JS).filter((n) => n.endsWith('.js'))) {
    const src = read(f);
    for (const m of src.matchAll(/infoButton\('([a-z0-9-]+)'/g)) refs.push([f, m[1]]);
    for (const m of src.matchAll(/\{ help: '([a-z0-9-]+)' \}/g)) refs.push([f, m[1]]);
  }
  assert.ok(refs.length >= 10, `nur ${refs.length} ⓘ gefunden`);
  const missing = refs.filter(([, id]) => !findArticle(sections, id));
  assert.deepEqual(missing, [], 'unbekannte Artikel');
});

test('DOC-12: jeder Verweis in der Hilfe führt auf eine registrierte Route', () => {
  const routes = [...read('app.js').matchAll(/router\.register\('([^']+)'/g)].map((m) => m[1]);
  const toRx = (r) => new RegExp('^' + r.replace(/:[a-zA-Z]+/g, '[^/]+') + '$');
  const bad = [];
  for (const a of articles) {
    for (const b of a.body || []) {
      if (!b.link) continue;
      const path = b.link.hash.replace(/^#/, '') || '/';
      if (!routes.some((r) => toRx(r).test(path))) bad.push(`${a.id}: ${b.link.hash}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(routes.includes('/hilfe/:id'), 'Artikel sind adressierbar');
});

test('UI-21: die Suche kennt Synonyme (RED-S, ACWR, sRPE)', () => {
  const find = (q) => articles.filter((a) => articleText(a).toLowerCase().includes(q.toLowerCase())).map((a) => a.id);
  assert.ok(find('RED-S').includes('energieverfuegbarkeit'));
  assert.ok(find('sRPE').includes('belastungspunkte'));
  assert.ok(find('Readiness').includes('bereitschaft'));
  assert.ok(find('3-2-1').includes('backup'));
});

test('DOC-12: die Labor-Wege der Hilfe kommen aus labsources.js', () => {
  const a = findArticle(sections, 'laborwerte-woher').article;
  const steps = a.body.find((b) => b.steps).steps;
  assert.equal(steps.length, LAB_SOURCES.length);
  LAB_SOURCES.forEach((s, i) => assert.ok(steps[i].startsWith(s.title), s.title));
  assert.ok(articleText(a).includes('60–200 €'), 'Kassenzuschuss je nach Kasse (MKT-14)');
  assert.doesNotMatch(articleText(a), /100–150 €/);
});

test('DOC-14/DOC-22: neutrale Ansprache ohne Namen, keine Persona-Reste', () => {
  const anon = helpSections('');
  assert.equal(anon[0].articles[0].q, 'Willkommen!');
  const all = anon.flatMap((s) => s.articles).map(articleText).join('\n');
  assert.doesNotMatch(all, /Sportlerin|Noras|Session-Ansicht|Team-Badges|aufs Trinken/);
  assert.doesNotMatch(all, /Aktiviere ihn in den Einstellungen/, 'Zyklus ist kein Opt-in (DOC-15)');
  assert.doesNotMatch(all, /erscheint das Team\/Familie-Dashboard/, 'Start ist die Anmeldung');
});

test('DOC-06/DOC-07: Apple Health nennt Premium-Kosten und den Header nur als Ausnahme', () => {
  const t = articleText(findArticle(sections, 'apple-health').article);
  assert.match(t, /Premium/);
  assert.match(t, /Kostenlos/);
  assert.match(t, /Export-Version 2/);
  assert.match(t, /brauchst du nur, falls/);
});

test('DOC-19: #/hilfe/<id> öffnet genau diesen Artikel', async () => {
  const view = shell();
  const help = await import('../js/help.js');
  await help.render(view, 'bereitschaft');
  const card = view.querySelector('#hilfe-bereitschaft');
  assert.ok(card, 'Artikel hat eine Adresse im DOM');
  assert.ok(card.classList.contains('help-article--focus'));
  assert.equal(card.querySelector('.help-article__body').hidden, false, 'aufgeklappt');
  assert.equal(view.querySelector('#hilfe-vdot').querySelector('.help-article__body').hidden, true, 'andere bleiben zu');
});

test('UI-21: ⓘ öffnet den Artikel als Sheet mit Sprung in die Hilfe', async () => {
  shell();
  const { infoButton } = await import('../js/ui.js');
  const btn = infoButton('energieverfuegbarkeit', 'Energieversorgung');
  assert.equal(btn.getAttribute('aria-label'), 'Erklärung: Energieversorgung');
  btn.click();
  for (let i = 0; i < 400 && !document.getElementById('modal-root').textContent; i++) await new Promise((r) => setTimeout(r, 5));
  const sheet = document.getElementById('modal-root');
  assert.match(sheet.textContent, /Energieverfügbarkeit/);
  assert.match(sheet.textContent, /In der Hilfe öffnen/);
});

test('UI-21: Abschnitte der Einstellungen tragen ihr ⓘ', async () => {
  const view = shell();
  store.setProfile({ ...store.profile(), name: 'Alex', birthYear: 1990, heightCm: 170, weightKg: 62 });
  const settings = await import('../js/settings.js');
  settings.render(view);
  const ids = view.querySelectorAll('[data-help]').map((b) => b.getAttribute('data-help'));
  for (const id of ['hf-zonen', 'module', 'backup']) assert.ok(ids.includes(id), `${id} fehlt in ${ids.join(', ')}`);
});
