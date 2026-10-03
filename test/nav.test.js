/* =========================================================================
   nav.test.js — Menüstruktur (UI-02, UI-14, UI-16, Navigation „groß“):
   Route → Menüeintrag, aktive Markierung von „Mehr“ und „Fortschritt“, Sichtbarkeit
   (Module, Admin, Verwalten fremder Profile), Konto-Kopf mit der ANGEMELDETEN Person,
   das Erfassen-Sheet und die Begrüßung beim Verwalten.
   ========================================================================= */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { el, genitive } from '../js/ui.js';
import {
  TAB_ITEMS, MORE_GROUPS, navMatches, navVisible, visibleGroups, inMore, progressTabs, accountBlock,
} from '../js/nav.js';
import { captureItems } from '../js/capture.js';
import * as dashboard from '../js/dashboard.js';
import * as settings from '../js/settings.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root', 'toast-root']) {
    doc.body.appendChild(el('div', { id }));
  }
  const view = el('div', { id: 'view' }); doc.body.appendChild(view);
  return view;
}
const tab = (key) => TAB_ITEMS.find((t) => t.key === key);
const item = (label) => MORE_GROUPS.flatMap((g) => g.items).find((i) => i.label === label);

async function family({ manage = false } = {}) {
  store.clearActiveUser();
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Nora', role: 'admin', emoji: '🏃', color: '#18b48a' },
    { id: 'u-2', name: 'Lea', role: 'user', emoji: '🧒', color: '#ff5d8f' },
  ], settings: {} });
  await store.login('u-1', '');
  store.setSetting('modules', {});
  if (manage) await store.enterMember('u-2');
}

beforeEach(async () => { await family(); });

test('navMatches: Startseite exakt, Unterseiten per Präfix, keine Teilwort-Treffer', () => {
  assert.equal(navMatches(tab('heute'), '#/'), true);
  assert.equal(navMatches(tab('heute'), '#/calendar'), false);
  assert.equal(navMatches(item('Ziele & Pläne'), '#/plan/e1'), true);
  assert.equal(navMatches(item('Ziele & Pläne'), '#/event/e1'), true);
  assert.equal(navMatches(item('Team/Familie'), '#/familie-verwalten'), false, 'kein Präfix-Treffer über Wortgrenzen');
  for (const p of ['#/stats', '#/health', '#/badges', '#/reports', '#/report/r1', '#/import']) {
    assert.equal(navMatches(tab('fortschritt'), p), true, `${p} gehört zu Fortschritt`);
  }
  assert.equal(navMatches(tab('fortschritt'), '#/settings'), false);
});

test('Mehr-Tab ist auf seinen Seiten aktiv, nicht auf Tab-Seiten (UI-14)', () => {
  assert.equal(inMore('#/settings'), true);
  assert.equal(inMore('#/plan/e1'), true, 'Plan-Seiten gehören zu „Ziele & Pläne“');
  assert.equal(inMore('#/nutrition'), true);
  assert.equal(inMore('#/stats'), false, 'Statistik liegt jetzt unter „Fortschritt“');
  assert.equal(inMore('#/'), false);
});

test('Sichtbarkeit: abgeschaltete Module und „Team verwalten“ nur für Admins', async () => {
  store.setSetting('modules', { nutrition: false });
  const labels = visibleGroups().flatMap((g) => g.items.map((i) => i.label));
  assert.ok(!labels.includes('Ernährung'));
  assert.ok(labels.includes('Team verwalten'), 'Nora ist Admin');
  store.clearActiveUser();
  await store.login('u-2', '');
  assert.ok(!visibleGroups().flatMap((g) => g.items.map((i) => i.label)).includes('Team verwalten'));
});

test('Verwalten: Zyklus und Labor verschwinden aus Mehr und Erfassen', async () => {
  const own = captureItems().map((c) => c.key);
  assert.deepEqual(own, ['training', 'koerper', 'mahlzeit', 'labor', 'periode', 'checkliste']);
  await family({ manage: true });
  assert.equal(navVisible(item('Zyklus')), false);
  assert.equal(navVisible(item('Labor & Ergänzung')), false);
  assert.deepEqual(captureItems().map((c) => c.key), ['training', 'koerper', 'mahlzeit', 'checkliste']);
});

test('Konto-Kopf zeigt die ANGEMELDETE Person und beim Verwalten den Rückweg (UI-02)', async () => {
  let block = accountBlock({ onBack: () => {} });
  assert.match(block.textContent, /Nora/);
  assert.match(block.textContent, /Administrator:in · angemeldet/);
  assert.doesNotMatch(block.textContent, /verwaltet gerade/);
  await family({ manage: true });
  let back = 0;
  block = accountBlock({ onBack: () => { back++; } });
  assert.match(block.textContent, /Nora/, 'nicht Lea als „angemeldet“');
  assert.doesNotMatch(block.textContent, /Lea.*angemeldet/);
  assert.match(block.textContent, /verwaltet gerade: Lea/);
  const btn = block.querySelectorAll('button').find((b) => b.textContent === 'Zurück zu mir');
  assert.ok(btn, 'Knopf „Zurück zu mir“');
  btn.click();
  assert.equal(back, 1);
});

test('Fortschritt-Reiter markieren die aktuelle Seite (aria-current)', () => {
  const nav = progressTabs('#/report/r1');
  const current = nav.querySelectorAll('a').filter((a) => a.getAttribute('aria-current') === 'page');
  assert.deepEqual(current.map((a) => a.textContent), ['Berichte']);
});

test('Heute: Titel „Heute“, beim Verwalten „Leas Übersicht“ statt Begrüßung', async () => {
  let view = setupShell();
  dashboard.render(view);
  assert.equal(doc.getElementById('header-title').textContent, 'Heute');
  assert.match(view.textContent, /Guten (Morgen|Tag|Abend), /);
  await family({ manage: true });
  view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Leas Übersicht/);
  assert.doesNotMatch(view.textContent, /Guten (Morgen|Tag|Abend), Lea/);
});

test('Einstellungen: Konto-Karte nennt beim Verwalten die angemeldete Person', async () => {
  await family({ manage: true });
  const view = setupShell();
  settings.render(view);
  const text = view.textContent;
  assert.match(text, /Nora/);
  assert.match(text, /Du verwaltest gerade Lea/);
  assert.match(text, /Zurück zu mir/);
  assert.match(text, /PIN für Lea setzen/);
});

test('genitive: deutscher Genitiv für Vornamen', () => {
  assert.equal(genitive('Lea'), 'Leas');
  assert.equal(genitive('Max'), 'Max’');
  assert.equal(genitive('Klaus'), 'Klaus’');
  assert.equal(genitive('Moritz'), 'Moritz’');
});

test('UI-13: leere App – Einstieg statt Ruhetag, Momentum erst nach dem ersten Training', async () => {
  ['sessions', 'plans', 'events'].forEach((a) => store.replaceArea(a, []));
  let view = setupShell();
  dashboard.render(view);
  const text = view.textContent;
  assert.match(text, /Los geht’s/);
  assert.match(text, /Profil ausfüllen/);
  assert.match(text, /Ziel oder Programm anlegen/);
  assert.match(text, /Mitglieder hinzufügen/, 'Admin sieht den Team-Schritt');
  assert.doesNotMatch(text, /Momentum/, 'kein Momentum ohne Aktivität');
  assert.doesNotMatch(text, /Ruhetag/, 'ohne Plan kein „Ruhetag“');
  store.replaceArea('sessions', [{ id: 's1', date: '2026-09-01', type: 'easy', durationSec: 1800 }]);
  view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Momentum/);
  assert.doesNotMatch(view.textContent, /Los geht’s/);
});

test('UI-15/UI-17: „Heute“ ohne Schnellzugriff, in zwei Spalten gegliedert', async () => {
  store.replaceArea('sessions', [{ id: 's1', date: '2026-09-01', type: 'easy', durationSec: 1800 }]);
  const view = setupShell();
  dashboard.render(view);
  const cols = view.querySelectorAll('.dash-col');
  assert.equal(cols.length, 2, 'zwei Spalten (ab 1180 px nebeneinander)');
  assert.match(cols[0].textContent, /Heute/);
  assert.doesNotMatch(view.textContent, /Schnellzugriff/);
});
