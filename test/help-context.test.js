/* Help right at the metric (DOC-19, UI-21, DOC-12):
   - Every help article has a unique, addressable ID (#/hilfe/<id>).
   - Every ⓘ link in the code (infoButton / sectionHead-help) points to an article.
   - Every link in the help leads to a registered route.
   - The search knows synonyms (RED-S → energy availability).
   - The lab routes come from labsources.js – one source for the lab view and the help.
   Before v3.21.0 articles had no address, no view linked into the help, and
   help.js maintained its own, diverging version of the lab routes. */
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

test('DOC-19: every article has a unique lower-case ID', () => {
  const ids = articles.map((a) => a.id);
  assert.ok(ids.length >= 60, `only ${ids.length} articles`);
  assert.ok(ids.every((id) => /^[a-z0-9-]+$/.test(id)), 'IDs usable as an address');
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no duplicate IDs');
});

test('DOC-19/UI-21: every ⓘ in the code points to an existing article', () => {
  const refs = [];
  for (const f of readdirSync(JS).filter((n) => n.endsWith('.js'))) {
    const src = read(f);
    for (const m of src.matchAll(/infoButton\('([a-z0-9-]+)'/g)) refs.push([f, m[1]]);
    for (const m of src.matchAll(/\{ help: '([a-z0-9-]+)' \}/g)) refs.push([f, m[1]]);
  }
  assert.ok(refs.length >= 10, `only ${refs.length} ⓘ found`);
  const missing = refs.filter(([, id]) => !findArticle(sections, id));
  assert.deepEqual(missing, [], 'unknown articles');
});

test('DOC-12: every link in the help leads to a registered route', () => {
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
  assert.ok(routes.includes('/hilfe/:id'), 'articles are addressable');
});

test('UI-21: the search knows synonyms (RED-S, ACWR, sRPE)', () => {
  const find = (q) => articles.filter((a) => articleText(a).toLowerCase().includes(q.toLowerCase())).map((a) => a.id);
  assert.ok(find('RED-S').includes('energieverfuegbarkeit'));
  assert.ok(find('sRPE').includes('belastungspunkte'));
  assert.ok(find('Readiness').includes('bereitschaft'));
  assert.ok(find('3-2-1').includes('backup'));
});

test('DOC-12: the lab routes in the help come from labsources.js', () => {
  const a = findArticle(sections, 'laborwerte-woher').article;
  const steps = a.body.find((b) => b.steps).steps;
  assert.equal(steps.length, LAB_SOURCES.length);
  LAB_SOURCES.forEach((s, i) => assert.ok(steps[i].startsWith(s.title), s.title));
  assert.ok(articleText(a).includes('60–200 €'), 'statutory insurance subsidy depends on the insurer (MKT-14)');
  assert.doesNotMatch(articleText(a), /100–150 €/);
});

test('DOC-14/DOC-22: neutral address without a name, no persona leftovers', () => {
  const anon = helpSections('');
  assert.equal(anon[0].articles[0].q, 'Willkommen!');
  const all = anon.flatMap((s) => s.articles).map(articleText).join('\n');
  assert.doesNotMatch(all, /Sportlerin|Noras|Session-Ansicht|Team-Badges|aufs Trinken/);
  assert.doesNotMatch(all, /Aktiviere ihn in den Einstellungen/, 'cycle is not opt-in (DOC-15)');
  assert.doesNotMatch(all, /erscheint das Team\/Familie-Dashboard/, 'the start is the login');
});

test('DOC-06/DOC-07: Apple Health mentions the premium costs and the header only as an exception', () => {
  const t = articleText(findArticle(sections, 'apple-health').article);
  assert.match(t, /Premium/);
  assert.match(t, /Kostenlos/);
  assert.match(t, /Export-Version 2/);
  assert.match(t, /brauchst du nur, falls/);
});

test('DOC-19: #/hilfe/<id> opens exactly this article', async () => {
  const view = shell();
  const help = await import('../js/help.js');
  await help.render(view, 'bereitschaft');
  const card = view.querySelector('#hilfe-bereitschaft');
  assert.ok(card, 'article has an address in the DOM');
  assert.ok(card.classList.contains('help-article--focus'));
  assert.equal(card.querySelector('.help-article__body').hidden, false, 'expanded');
  assert.equal(view.querySelector('#hilfe-vdot').querySelector('.help-article__body').hidden, true, 'others stay closed');
});

test('UI-21: ⓘ opens the article as a sheet with a jump into the help', async () => {
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

test('UI-21: settings sections carry their ⓘ', async () => {
  const view = shell();
  store.setProfile({ ...store.profile(), name: 'Alex', birthYear: 1990, heightCm: 170, weightKg: 62 });
  const settings = await import('../js/settings.js');
  settings.render(view);
  const ids = view.querySelectorAll('[data-help]').map((b) => b.getAttribute('data-help'));
  for (const id of ['hf-zonen', 'module', 'backup']) assert.ok(ids.includes(id), `${id} missing in ${ids.join(', ')}`);
});
