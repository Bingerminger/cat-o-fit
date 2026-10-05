/* Readable interface (package "Nachlesbar"):
   - UI-35: competition form without "Event", date without a default, priority explained,
     errors directly at the field instead of just as a toast; target time understands dot/comma and "75:30".
   - DOC-20: no doubled full stops on certificates, no Markdown and no private
     video hints in generated units, no "User" chip.
   - DOC-15: no ineffective module switch "Strength training".
   - DOC-16: Open Food Facts is credited. MKT-06: positioning "training planning".
   - DOC-21/UI-33: No view shows a number with a decimal point with the demo data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as store from '../js/storage.js';
import { parseTargetTime } from '../js/events.js';
import { programPlanName } from '../js/program.js';
import { buildGoalReport } from '../js/report.js';
import { fieldError, input, field } from '../js/ui.js';

const ROOT = new URL('../', import.meta.url);

function shell() {
  document.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root', 'toast-root', 'sync-indicator', 'manage-banner']) {
    const e = document.createElement('div'); e.setAttribute('id', id); document.body.appendChild(e);
  }
  const view = document.createElement('div'); view.setAttribute('id', 'view'); document.body.appendChild(view);
  return view;
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const buttons = (root) => root.querySelectorAll('button');
const byText = (root, re) => buttons(root).find((b) => re.test(b.textContent));

test('UI-35: target time as h:mm:ss, mm:ss, with dot or comma – unreadable input is detected', () => {
  assert.equal(parseTargetTime('1:55:00'), '01:55:00');
  assert.equal(parseTargetTime('1.55.00'), '01:55:00');
  assert.equal(parseTargetTime('1,55,00'), '01:55:00');
  assert.equal(parseTargetTime('45:30'), '00:45:30');
  assert.equal(parseTargetTime('75:30'), '01:15:30', 'previously "00:75:30"');
  for (const bad of ['', 'schnell', '1:75:00', '45:61', '1:2:3:4', '0:00']) assert.equal(parseTargetTime(bad), null, bad);
});

test('UI-35: error appears at the field, is named and disappears with the input', () => {
  shell();
  const i = input({});
  const wrap = field('Name', i);
  document.body.appendChild(wrap);
  fieldError(i, 'Bitte einen Namen eingeben.');
  assert.equal(i.getAttribute('aria-invalid'), 'true');
  const err = wrap.querySelector('.field__error');
  assert.ok(err && err.textContent === 'Bitte einen Namen eingeben.');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(i.getAttribute('aria-describedby'), err.getAttribute('id'));
  i.dispatchEvent({ type: 'input', target: i });
  assert.ok(!i.getAttribute('aria-invalid'), 'marking removed');
  assert.equal(wrap.querySelector('.field__error'), null);
});

test('UI-35: creating a competition – title, priority explanation and error at the field', async () => {
  const view = shell();
  const events = await import('../js/events.js');
  events.renderList(view);
  document.getElementById('header-actions').querySelector('button').click();
  const modal = document.getElementById('modal-root');
  byText(modal, /Wettkampf/).click();
  assert.match(modal.textContent, /Neuer Wettkampf/);
  assert.doesNotMatch(modal.textContent, /Event/);
  assert.match(modal.textContent, /A – Saisonhöhepunkt/);
  const date = modal.querySelectorAll('input').find((n) => n.getAttribute('type') === 'date');
  assert.equal(date.value || '', '', 'date not pre-filled with today');
  byText(modal, /^Speichern$/).click();
  const name = modal.querySelectorAll('input')[0];
  assert.equal(name.getAttribute('aria-invalid'), 'true', 'name missing → marked at the field');
  name.value = 'Stadtlauf';
  name.dispatchEvent({ type: 'input', target: name });
  byText(modal, /^Speichern$/).click();
  assert.equal(date.getAttribute('aria-invalid'), 'true', 'date missing → marked at the field');
  assert.equal(store.get('events').filter((e) => e.name === 'Stadtlauf').length, 0, 'nothing saved');
});

test('UI-35: programme name from the focus, plan name without duplication', () => {
  assert.equal(programPlanName({ programType: 'fitness', name: 'Allgemeine Fitness' }), 'Allgemeine Fitness');
  assert.equal(programPlanName({ programType: 'fitness', name: 'Sommerform' }), 'Allgemeine Fitness · Sommerform');
  assert.equal(programPlanName({ programType: 'fitness', name: '' }), 'Allgemeine Fitness');
});

test('DOC-20: certificate without a doubled full stop', () => {
  const r = buildGoalReport({ profile: { name: 'Alex' }, goalTitle: 'Ziel', goalDetail: 'Halbmarathon.', date: '2026-09-01' });
  assert.doesNotMatch(r.verdict, /\.\./);
  assert.match(r.verdict, /Halbmarathon\. Großartige Leistung!/);
  const s = buildGoalReport({ profile: { name: 'Alex' }, goalTitle: 'Gewicht 68 kg', date: '2026-09-01' });
  assert.match(s.verdict, /68 kg\. Großartige Leistung!/);
});

test('DOC-20: generated units without Markdown and without a private video hint', () => {
  const src = readFileSync(new URL('js/plangen.js', ROOT), 'utf8');
  assert.doesNotMatch(src, /Growingannanas/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /\*\*[A-Za-zäöü]/, 'no **bold** in texts');
});

test('DOC-15/DOC-16/DOC-20: settings without a strength training switch, with Open Food Facts; no "User" chip', async () => {
  const view = shell();
  store.setProfile({ ...store.profile(), name: 'Alex', birthYear: 1990 });
  (await import('../js/settings.js')).render(view);
  const labels = view.querySelectorAll('input').map((b) => b.getAttribute('aria-label') || '');
  assert.ok(labels.includes('Modul Ernährung'));
  assert.ok(!labels.includes('Modul Krafttraining'), 'ineffective switch removed');
  const html = view.querySelectorAll('div').concat(view.querySelectorAll('p')).map((n) => n._innerHTML || '').join(' ');
  assert.match(html, /Open Food Facts<\/a> – Datenbank unter ODbL/, 'attribution at the switch');
  assert.match(html, /nicht-kommerzielle Nutzung/, 'Open-Meteo condition');
  assert.match(view.textContent, /Trainingsplanung für die ganze Familie/);
  const fa = readFileSync(new URL('js/family-admin.js', ROOT), 'utf8');
  assert.doesNotMatch(fa, /'User'/);
});

test('MKT-06: title and manifest speak of training plans (English shell, German catalog)', () => {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', ROOT), 'utf8'));
  const de = JSON.parse(readFileSync(new URL('locales/de/ui.json', ROOT), 'utf8'));
  assert.match(html, /<title>Cat-O-Fit · Training plans/);
  assert.match(manifest.name, /Training plans/);
  assert.match(de.app.title, /^Cat-O-Fit · Trainingsplanung/);
  assert.doesNotMatch(html + manifest.description, /Fitness-, Health-/);
});

/** Number with a decimal point in running text – without dates (29.09.), versions (v3.20.0)
    and thousands separators (10.000). */
const DECIMAL_POINT = /(?<![\d.v])\d+\.(?:\d{1,2}|\d{4,})(?![\d.])/g;

test('DOC-21/UI-33: no view shows numbers with a decimal point with the demo data', async () => {
  const view = shell();
  globalThis.__fakeServer.install();
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [] });
  assert.ok(await store.createFirstAdmin({ name: 'Alex', pin: '2468' }));
  await store.seedDemo();
  const ev = store.get('events').find((e) => e.kind !== 'program');
  const plan = store.get('plans').find((p) => p.eventId === ev?.id);
  const done = store.get('sessions').find((s) => s.distanceKm);
  const unit = plan && (plan.units || []).find((u) => u.type === 'interval');
  const routes = [['dashboard', 'render'], ['calendar', 'render'], ['events', 'renderList'], ['events', 'renderDetail', ev?.id],
    ['plans', 'render', ev?.id], ['session', 'render', done?.id], ['session', 'render', unit?.id], ['health', 'render'],
    ['statistics', 'render'], ['nutrition', 'render'], ['shopping', 'render'], ['badges', 'render'], ['cycle', 'render'],
    ['labs-view', 'render'], ['family', 'render'], ['settings', 'render'], ['reports', 'render']];
  const hits = [];
  for (const [mod, fn, arg] of routes) {
    while (view.firstChild) view.removeChild(view.firstChild);
    const m = await import(`../js/${mod}.js`);
    await m[fn](view, arg);
    await tick(20);
    const text = `${view.textContent}\n${document.getElementById('header-title').textContent}`;
    for (const x of text.matchAll(DECIMAL_POINT)) hits.push(`${mod}${arg ? '(' + arg + ')' : ''}: …${text.slice(Math.max(0, x.index - 30), x.index + 12)}…`);
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test('DOC-21: number and unit stay together in displayed texts (non-breaking space)', async () => {
  const { el, keepUnits } = await import('../js/ui.js');
  assert.equal(keepUnits('noch 1,6 kg bis 72 kg'), 'noch 1,6 kg bis 72 kg');
  assert.equal(keepUnits('Ferritin 47 µg/l · 24 °C · 4 % · 12 Wdh.'), 'Ferritin 47 µg/l · 24 °C · 4 % · 12 Wdh.');
  assert.equal(keepUnits('12 Wochen · 5 lockere Läufe · Mo, 28. Sept. · 2 mal'), '12 Wochen · 5 lockere Läufe · Mo, 28. Sept. · 2 mal', 'words stay');
  assert.equal(el('span', { text: '539 kcal je 100 g' }).textContent, '539 kcal je 100 g');
  assert.equal(el('span', {}, ['6,2 km', ' · Ø 138 bpm']).textContent, '6,2 km · Ø 138 bpm');
});
