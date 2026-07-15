/* =========================================================================
   shopping.js — gemeinsame Einkaufsliste der Familie.

   Aggregiert die geplanten Gerichte ALLER Mitglieder (aus deren Ernährung) zu
   einer Summenliste und reduziert sie um das gemeinsame Familien-Lager.
   „Alles eingekauft" bucht ins Lager; „Gekocht" (Ernährung) bucht wieder ab.
   Fällig zum zentralen Einkaufstag der Familie (Standard: Dienstag).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, fmtDate, sectionHead, toast,
  openSheet, closeSheet, field, input, select, confirmDialog,
} from './ui.js';
import { setHeader } from './router.js';
import { moduleOff } from './nutrition.js';
import { aggregateNeeds, computeShoppingList, applyPurchase, nextShoppingDay, fmtAmount, itemKey, guessCategory } from './food.js';

const CATS = ['Obst & Gemüse', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Sonstiges'];
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const hexc = (c) => (typeof c === 'string' && c[0] === '#' ? c : 'var(--accent)');

export function render(view) {
  setHeader({ title: 'Einkaufsliste', actions: [{ icon: 'plus', label: 'Lager-Eintrag', onClick: () => openPantryForm() }] });
  if (store.settings().modules?.shopping === false) { view.appendChild(moduleOff('Einkaufsliste')); return; }

  const shopDay = store.familySettings().shoppingDay ?? 2;
  const shopDate = nextShoppingDay(shopDay);

  view.appendChild(el('div', { class: 'hero', style: { padding: '18px 20px' } }, [
    el('div', { class: 'hero__eyebrow', text: 'Nächster gemeinsamer Einkauf' }),
    el('div', { style: { fontWeight: '800', fontSize: '1.3rem' }, text: `${WD[new Date(shopDate + 'T12:00').getDay()]}, ${fmtDate(shopDate)}` }),
    el('div', { style: { opacity: '.9', fontSize: '.84rem', marginTop: '2px' }, text: 'Bedarf aller Speisepläne minus gemeinsames Lager' }),
  ]));

  const planSlot = el('div');
  const listSlot = el('div');
  view.appendChild(planSlot);
  view.appendChild(listSlot);
  planSlot.appendChild(el('div', { class: 'card card--flat', text: 'Lade gemeinsame Speisepläne …' }));

  renderPantry(view);

  loadFamilyMeals().then((entries) => {
    planSlot.innerHTML = '';
    listSlot.innerHTML = '';
    renderPlan(planSlot, entries);
    renderList(listSlot, entries);
  }).catch(() => { planSlot.innerHTML = ''; planSlot.appendChild(el('div', { class: 'card card--flat', text: 'Speisepläne konnten nicht geladen werden.' })); });
}

/** Geplante Gerichte aller Mitglieder einsammeln (aktiver Nutzer lokal, Rest read-only). */
async function loadFamilyMeals() {
  const out = [];
  for (const m of store.members()) {
    const nutrition = m.id === store.activeUserId()
      ? store.get('nutrition')
      : ((await store.peekUserArea(m.id, 'nutrition')) || []);
    nutrition
      .filter((x) => x && !x.deleted && (x.plannedServings || 0) > 0)
      .forEach((meal) => out.push({ member: m, meal }));
  }
  return out;
}

function renderPlan(slot, entries) {
  slot.appendChild(sectionHead('Gemeinsamer Wochenplan', { label: 'Gerichte planen', onClick: () => navigate('#/nutrition') }));
  if (!entries.length) {
    slot.appendChild(el('div', { class: 'card card--flat' }, [
      el('p', { class: 'muted', text: 'Noch keine Gerichte geplant. Jedes Mitglied plant in der Ernährung seine Gerichte mit Portionen – daraus entsteht die gemeinsame Einkaufsliste.' }),
      el('button', { class: 'btn btn--soft btn--block mt-3', onclick: () => navigate('#/nutrition') }, [icon('utensils'), 'Zur Ernährung']),
    ]));
    return;
  }
  const card = el('div', { class: 'list-card' });
  entries.forEach(({ member, meal }) => card.appendChild(el('div', { class: 'list-item' }, [
    el('span', { class: 'member-card__avatar', style: { width: '30px', height: '30px', fontSize: '1rem', background: hexc(member.color) + '22', color: hexc(member.color) }, text: member.emoji || '🙂' }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: meal.title }),
      el('div', { class: 'list-item__sub', text: `${meal.plannedServings} Portion${meal.plannedServings > 1 ? 'en' : ''} · ${member.name}` }),
    ]),
  ])));
  slot.appendChild(card);
}

function renderList(slot, entries) {
  if (!entries.length) return;
  const needs = aggregateNeeds(entries.map(({ meal }) => ({ ingredients: meal.ingredients, servings: meal.plannedServings })));
  const list = computeShoppingList(needs, store.familyPantry());
  slot.appendChild(sectionHead('Einzukaufen'));
  if (!list.length) {
    slot.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.4rem' }, text: '✅' }),
      el('div', { class: 'muted', text: 'Alles im Lager – diese Woche ist nichts zu kaufen!' }),
    ]));
    return;
  }
  const byCat = {};
  list.forEach((i) => { (byCat[i.category] ||= []).push(i); });
  CATS.filter((c) => byCat[c]).forEach((cat) => {
    slot.appendChild(el('div', { class: 'section-head', style: { margin: '12px 0 4px' } }, el('h2', { class: 'section-head__title', style: { fontSize: '.86rem', color: 'var(--text-2)' }, text: cat })));
    const c = el('div', { class: 'list-card' });
    byCat[cat].forEach((i) => c.appendChild(el('div', { class: 'list-item' }, [
      el('span', { class: 'icon-btn', style: { color: 'var(--text-3)' }, html: iconSvg('cart') }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: i.name }),
        i.have > 0 ? el('div', { class: 'list-item__sub', text: `Lager: ${fmtAmount(i.have, i.unit)}` }) : null,
      ]),
      el('div', { class: 'list-item__meta num', text: fmtAmount(i.buy, i.unit) }),
    ])));
    slot.appendChild(c);
  });
  slot.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => buyAll(list) }, [icon('check'), 'Alles eingekauft → ins Lager']));
}

function renderPantry(view) {
  const pantry = store.familyPantry();
  view.appendChild(sectionHead('Gemeinsames Lager'));
  if (!pantry.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: 'Das gemeinsame Lager ist leer. Was ihr einkauft, landet hier – oder trage Vorräte über „+" ein.' }));
    return;
  }
  const c = el('div', { class: 'list-card' });
  pantry.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => c.appendChild(el('div', { class: 'list-item' }, [
    el('span', { style: { fontSize: '1.1rem' }, text: '📦' }),
    el('button', { class: 'list-item__body', style: { textAlign: 'left' }, onclick: () => openPantryForm(p) }, [
      el('div', { class: 'list-item__title', text: p.name }),
      el('div', { class: 'list-item__sub num', text: fmtAmount(p.amount, p.unit) }),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => removePantry(p.id) }, icon('trash')),
  ])));
  view.appendChild(c);
}

function buyAll(list) {
  const next = applyPurchase(store.familyPantry(), list).map((p) => ({ ...p, id: p.id || itemKey(p.name, p.unit) }));
  store.setFamilyPantry(next);
  toast('Eingekauft & ins gemeinsame Lager gebucht 🛒', 'good');
  rerender();
}

function upsertPantry(item) {
  const list = store.familyPantry().slice();
  const i = list.findIndex((p) => p.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  store.setFamilyPantry(list);
}
async function removePantry(id) {
  const item = store.familyPantry().find((p) => p.id === id);
  const ok = await confirmDialog({
    title: 'Aus dem Lager entfernen?',
    message: item ? `„${item.name}" wird aus dem gemeinsamen Familien-Lager gelöscht.` : 'Eintrag wird aus dem gemeinsamen Lager gelöscht.',
    confirmLabel: 'Entfernen', danger: true,
  });
  if (!ok) return;
  store.setFamilyPantry(store.familyPantry().filter((p) => p.id !== id));
  rerender();
}

function openPantryForm(existing = null) {
  const it = existing || {};
  const nameI = input({ value: it.name || '', placeholder: 'z. B. Haferflocken' });
  const amountI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: it.amount ?? '', placeholder: 'Menge' });
  const unitI = select([{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }, { value: 'Stück', label: 'Stück' }, { value: 'Packung', label: 'Packung' }, { value: 'Dose', label: 'Dose' }], it.unit || 'g');
  openSheet({
    title: existing ? 'Lager-Eintrag' : 'Neuer Vorrat',
    body: el('div', {}, [field('Artikel', nameI), el('div', { class: 'field__row' }, [field('Menge', amountI), field('Einheit', unitI)])]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: 'Abbrechen', onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: 'Speichern',
        onclick: () => {
          const name = nameI.value.trim();
          if (!name) { toast('Name fehlt', 'bad'); return; }
          const unit = unitI.value;
          upsertPantry({ id: existing?.id || itemKey(name, unit), name, unit, amount: parseFloat(amountI.value) || 0, category: guessCategory(name) });
          closeSheet(); rerender();
        },
      }),
    ],
  });
}

function rerender() { const v = document.getElementById('view'); v.innerHTML = ''; render(v); }
