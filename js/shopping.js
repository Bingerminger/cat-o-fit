/* =========================================================================
   shopping.js — gemeinsame Einkaufsliste der Familie.

   Aggregiert die geplanten Gerichte ALLER Mitglieder (aus deren Ernährung) zu
   einer Summenliste und reduziert sie um das gemeinsame Familien-Lager.
   „Alles eingekauft“ bucht ins Lager; „Gekocht“ (Ernährung) bucht wieder ab.
   Fällig zum zentralen Einkaufstag der Familie (Standard: Dienstag).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, navigate, fmtDate, fmtDateLong, sectionHead, toast,
  openSheet, closeSheet, field, input, select, confirmDialog,
  rerenderView,
} from './ui.js';
import { setHeader } from './router.js';
import { moduleOff } from './nutrition.js';
import { aggregateNeeds, computeShoppingList, applyPurchase, nextShoppingDay, fmtAmount, itemKey, guessCategory, unitLabel } from './food.js';

import { t, tp } from './i18n.js';

const CATS = ['Obst & Gemüse', 'Milchprodukte', 'Fleisch & Fisch', 'Trockenwaren', 'Sonstiges'];
// Angezeigt wird der übersetzte Name; gespeichert bleibt der deutsche Wert.
const CAT_LABEL = {
  'Obst & Gemüse': () => t('shopping.catProduce'),
  Milchprodukte: () => t('shopping.catDairy'),
  'Fleisch & Fisch': () => t('shopping.catMeatFish'),
  Trockenwaren: () => t('shopping.catDry'),
  Sonstiges: () => t('shopping.catOther'),
};
const hexc = (c) => (typeof c === 'string' && c[0] === '#' ? c : 'var(--accent)');

export function render(view) {
  setHeader({ title: t('nav.shopping'), actions: [{ icon: 'plus', label: t('shopping.pantryEntry'), onClick: () => openPantryForm() }] });
  if (store.settings().modules?.shopping === false) { view.appendChild(moduleOff(t('nav.shopping'))); return; }

  const shopDay = store.familySettings().shoppingDay ?? 2;
  const shopDate = nextShoppingDay(shopDay);

  view.appendChild(el('div', { class: 'hero', style: { padding: '18px 20px' } }, [
    el('div', { class: 'hero__eyebrow', text: t('shopping.nextShop') }),
    el('div', { style: { fontWeight: '800', fontSize: '1.3rem' }, text: fmtDateLong(shopDate) }),
    el('div', { style: { opacity: '.9', fontSize: '.84rem', marginTop: '2px' }, text: t('shopping.needsMinusPantry') }),
  ]));

  const planSlot = el('div');
  const listSlot = el('div');
  view.appendChild(planSlot);
  view.appendChild(listSlot);
  planSlot.appendChild(el('div', { class: 'card card--flat', text: t('shopping.loadingPlans') }));

  renderPantry(view);

  loadFamilyMeals().then((entries) => {
    planSlot.innerHTML = '';
    listSlot.innerHTML = '';
    renderPlan(planSlot, entries);
    renderList(listSlot, entries);
  }).catch(() => { planSlot.innerHTML = ''; planSlot.appendChild(el('div', { class: 'card card--flat', text: t('shopping.plansFailed') })); });
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
  slot.appendChild(sectionHead(t('shopping.weekPlan'), { label: t('shopping.planMeals'), onClick: () => navigate('#/nutrition') }));
  if (!entries.length) {
    slot.appendChild(el('div', { class: 'card card--flat' }, [
      el('p', { class: 'muted', text: t('shopping.noMealsPlanned') }),
      el('button', { class: 'btn btn--soft btn--block mt-3', onclick: () => navigate('#/nutrition') }, [icon('utensils'), t('shopping.toNutrition')]),
    ]));
    return;
  }
  const card = el('div', { class: 'list-card' });
  entries.forEach(({ member, meal }) => card.appendChild(el('div', { class: 'list-item' }, [
    el('span', { class: 'member-card__avatar', style: { width: '30px', height: '30px', fontSize: '1rem', background: hexc(member.color) + '22', color: hexc(member.color) }, text: member.emoji || '🙂' }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: meal.title }),
      el('div', { class: 'list-item__sub', text: `${tp('shopping.servings', meal.plannedServings)} · ${member.name}` }),
    ]),
  ])));
  slot.appendChild(card);
}

function renderList(slot, entries) {
  if (!entries.length) return;
  const needs = aggregateNeeds(entries.map(({ meal }) => ({ ingredients: meal.ingredients, servings: meal.plannedServings })));
  const list = computeShoppingList(needs, store.familyPantry());
  slot.appendChild(sectionHead(t('shopping.toBuy')));
  if (!list.length) {
    slot.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'center' } }, [
      el('span', { style: { fontSize: '1.4rem' }, text: '✅' }),
      el('div', { class: 'muted', text: t('shopping.allInPantry') }),
    ]));
    return;
  }
  const byCat = {};
  list.forEach((i) => { (byCat[i.category] ||= []).push(i); });
  CATS.filter((c) => byCat[c]).forEach((cat) => {
    slot.appendChild(el('div', { class: 'section-head', style: { margin: '12px 0 4px' } }, el('h2', { class: 'section-head__title', style: { fontSize: '.86rem', color: 'var(--text-2)' }, text: CAT_LABEL[cat]() })));
    const c = el('div', { class: 'list-card' });
    byCat[cat].forEach((i) => c.appendChild(el('div', { class: 'list-item' }, [
      el('span', { class: 'icon-btn', style: { color: 'var(--text-3)' }, html: iconSvg('cart') }),
      el('div', { class: 'list-item__body' }, [
        el('div', { class: 'list-item__title', text: i.name }),
        i.have > 0 ? el('div', { class: 'list-item__sub', text: t('shopping.inPantry', { amount: fmtAmount(i.have, i.unit) }) }) : null,
      ]),
      el('div', { class: 'list-item__meta num', text: fmtAmount(i.buy, i.unit) }),
    ])));
    slot.appendChild(c);
  });
  slot.appendChild(el('button', { class: 'btn btn--primary btn--block mt-4', onclick: () => buyAll(list) }, [icon('check'), t('shopping.boughtAll')]));
}

function renderPantry(view) {
  const pantry = store.familyPantry();
  view.appendChild(sectionHead(t('shopping.sharedPantry')));
  if (!pantry.length) {
    view.appendChild(el('div', { class: 'card card--flat', text: t('shopping.pantryEmpty') }));
    return;
  }
  const c = el('div', { class: 'list-card' });
  pantry.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => c.appendChild(el('div', { class: 'list-item' }, [
    el('span', { style: { fontSize: '1.1rem' }, text: '📦' }),
    el('button', { class: 'list-item__body', style: { textAlign: 'left' }, onclick: () => openPantryForm(p) }, [
      el('div', { class: 'list-item__title', text: p.name }),
      el('div', { class: 'list-item__sub num', text: fmtAmount(p.amount, p.unit) }),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': t('shopping.delete'), onclick: () => removePantry(p.id) }, icon('trash')),
  ])));
  view.appendChild(c);
}

function buyAll(list) {
  const next = applyPurchase(store.familyPantry(), list).map((p) => ({ ...p, id: p.id || itemKey(p.name, p.unit) }));
  store.setFamilyPantry(next);
  toast(t('shopping.boughtToast'), 'good');
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
    title: t('shopping.removeQ'),
    message: item ? t('shopping.removeNamed', { name: item.name }) : t('shopping.removeEntry'),
    confirmLabel: t('shopping.remove'), danger: true,
  });
  if (!ok) return;
  store.setFamilyPantry(store.familyPantry().filter((p) => p.id !== id));
  rerender();
}

function openPantryForm(existing = null) {
  const it = existing || {};
  const nameI = input({ value: it.name || '', placeholder: t('shopping.namePlaceholder') });
  const amountI = input({ type: 'number', step: '0.1', inputmode: 'decimal', value: it.amount ?? '', placeholder: t('shopping.amount') });
  const unitI = select(['g', 'ml', 'Stück', 'Packung', 'Dose'].map((u) => ({ value: u, label: unitLabel(u) })), it.unit || 'g');
  openSheet({
    title: existing ? t('shopping.pantryEntry') : t('shopping.newItem'),
    body: el('div', {}, [field(t('shopping.article'), nameI), el('div', { class: 'field__row' }, [field(t('shopping.amount'), amountI), field(t('shopping.unit'), unitI)])]),
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('shopping.save'),
        onclick: () => {
          const name = nameI.value.trim();
          if (!name) { toast(t('shopping.nameMissing'), 'bad'); return; }
          const unit = unitI.value;
          upsertPantry({ id: existing?.id || itemKey(name, unit), name, unit, amount: parseFloat(amountI.value) || 0, category: guessCategory(name) });
          closeSheet(); rerender();
        },
      }),
    ],
  });
}

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }
