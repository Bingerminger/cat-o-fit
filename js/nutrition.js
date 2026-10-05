/* =========================================================================
   nutrition.js — nutrition suggestions with preference learning (can be switched off).
   The app learns from favourites and "cooked" frequency which tags you
   prefer, and recommends matching dishes ("For you").
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, uid, navigate, todayStr, sectionHead, emptyState, toast,
  openSheet, closeSheet, field, input, textarea, select, confirmDialog, stepper, fmtInt, toastUndo,
  segmented,
  fmtDec,
  rerenderView,
} from './ui.js';
import { setHeader } from './router.js';
import { applyConsumption, parseIngredient } from './food.js';
import { estimateNutrition, PORTION_KCAL } from './energy.js';
import { foodfactsLookup, foodfactsBarcode } from './api-client.js';
import { validGtin, portionFromProduct } from './barcode.js';
import { currentEnergyTargets, currentEligibility, gatePromptCard } from './wellness.js';
import { weightGoalBlockReason } from './eligibility.js';

import { t, tp, tList, hasArea, loadArea } from './i18n.js';

const CATS = [
  { key: 'fruehstueck', get label() { return t('nutrition.catBreakfast'); } },
  { key: 'mittag', get label() { return t('nutrition.catLunch'); } },
  { key: 'abend', get label() { return t('nutrition.catDinner'); } },
  { key: 'snack', get label() { return t('nutrition.catSnack'); } },
];

/* Recipe ideas for a varied 7-day plan (#25). On request they are copied into your own
   collection – in the language active at that moment; titles already there are skipped.
   Titles and ingredients live in the lazily loaded area 'recipes' (locales/<lang>/recipes.json),
   ingredients in a parseable "amount unit name" form for the automatic shopping list.
   Row: [id, category, kcal, protein, tags]. */
const RECIPE_ROWS = [
  ['overnight-oats-mit-beeren', 'fruehstueck', 520, 30, ['proteinreich', 'vegetarisch', 'meal-prep']],
  ['ruehrei-mit-vollkornbrot-avocado', 'fruehstueck', 600, 31, ['proteinreich', 'vegetarisch']],
  ['protein-porridge-mit-banane', 'fruehstueck', 600, 39, ['proteinreich', 'vegetarisch']],
  ['quark-mit-nuessen-apfel', 'fruehstueck', 400, 33, ['proteinreich', 'vegetarisch', 'low-carb']],
  ['vollkorn-pancakes-mit-quark', 'fruehstueck', 580, 41, ['proteinreich', 'vegetarisch']],
  ['chia-pudding-mit-mango', 'fruehstueck', 320, 8, ['vegetarisch', 'vegan', 'meal-prep']],
  ['bircher-muesli', 'fruehstueck', 530, 20, ['vegetarisch', 'meal-prep']],
  ['avocado-brot-mit-ei', 'fruehstueck', 480, 24, ['proteinreich', 'vegetarisch']],
  ['griessbrei-mit-beeren', 'fruehstueck', 430, 16, ['vegetarisch', 'schnell']],
  ['skyr-bowl-mit-granola', 'fruehstueck', 480, 28, ['proteinreich', 'vegetarisch']],
  ['tofu-ruehrei-mit-brot', 'fruehstueck', 470, 35, ['vegan', 'proteinreich']],
  ['erdnussbutter-toast-mit-banane', 'fruehstueck', 440, 14, ['vegetarisch', 'schnell', 'vor-dem-training']],
  ['haehnchen-reis-bowl-mit-brokkoli', 'mittag', 600, 46, ['proteinreich', 'meal-prep']],
  ['lachs-mit-suesskartoffel-spinat', 'mittag', 620, 35, ['proteinreich', 'omega-3']],
  ['linsen-dal-mit-reis', 'mittag', 490, 19, ['vegetarisch', 'vegan', 'ballaststoffreich']],
  ['pute-quinoa-pfanne', 'mittag', 530, 51, ['proteinreich', 'glutenfrei']],
  ['rindergeschnetzeltes-mit-reis', 'mittag', 550, 39, ['proteinreich']],
  ['kichererbsen-bowl-mit-quinoa', 'mittag', 550, 27, ['vegetarisch', 'vegan', 'ballaststoffreich']],
  ['vollkorn-spaghetti-bolognese', 'mittag', 780, 43, ['proteinreich', 'meal-prep']],
  ['gefuellte-suesskartoffel-mit-huettenkaese', 'mittag', 390, 26, ['proteinreich', 'vegetarisch']],
  ['couscous-salat-mit-feta', 'mittag', 590, 22, ['vegetarisch', 'meal-prep']],
  ['haehnchen-wrap-mit-gemuese', 'mittag', 430, 42, ['proteinreich', 'schnell']],
  ['kabeljau-mit-kartoffeln-brokkoli', 'mittag', 460, 42, ['proteinreich', 'omega-3', 'low-carb']],
  ['gemuesecurry-mit-kichererbsen', 'mittag', 880, 23, ['vegan', 'vegetarisch', 'ballaststoffreich']],
  ['magerquark-mit-gemuesesticks', 'abend', 260, 36, ['proteinreich', 'low-carb', 'leicht']],
  ['omelett-mit-feta-tomaten', 'abend', 440, 30, ['proteinreich', 'vegetarisch', 'low-carb']],
  ['thunfisch-vollkornwrap', 'abend', 410, 43, ['proteinreich', 'schnell']],
  ['ofengemuese-mit-haehnchen', 'abend', 510, 43, ['proteinreich', 'low-carb', 'meal-prep']],
  ['gebratener-tofu-mit-gemuese', 'abend', 330, 31, ['vegan', 'proteinreich', 'low-carb']],
  ['haehnchensalat-mit-avocado', 'abend', 440, 37, ['proteinreich', 'low-carb']],
  ['linsensuppe', 'abend', 360, 22, ['vegan', 'vegetarisch', 'meal-prep']],
  ['caprese-mit-mozzarella', 'abend', 440, 25, ['vegetarisch', 'low-carb', 'schnell']],
  ['garnelen-zucchini-pfanne', 'abend', 260, 33, ['proteinreich', 'low-carb']],
  ['putenbrust-mit-ofengemuese', 'abend', 360, 43, ['proteinreich', 'low-carb', 'meal-prep']],
  ['vollkorn-pizza-mit-gemuese', 'abend', 630, 27, ['vegetarisch']],
  ['joghurt-bowl-mit-gurke-fladenbrot', 'abend', 420, 20, ['vegetarisch', 'leicht']],
  ['skyr-mit-beeren', 'snack', 140, 18, ['proteinreich', 'vegetarisch', 'schnell']],
  ['handvoll-mandeln-apfel', 'snack', 250, 6, ['vegetarisch', 'unterwegs']],
  ['protein-shake-mit-banane', 'snack', 380, 31, ['proteinreich', 'nach-dem-training']],
  ['huettenkaese-auf-knaeckebrot', 'snack', 220, 20, ['proteinreich', 'vegetarisch']],
  ['energy-balls', 'snack', 320, 8, ['vegan', 'vegetarisch', 'unterwegs']],
  ['gemuesesticks-mit-hummus', 'snack', 310, 9, ['vegan', 'vegetarisch', 'low-carb']],
  ['reiswaffeln-mit-frischkaese', 'snack', 180, 4, ['vegetarisch', 'schnell']],
  ['beeren-quark', 'snack', 180, 25, ['proteinreich', 'vegetarisch', 'low-carb']],
  ['studentenfutter', 'snack', 290, 9, ['vegetarisch', 'unterwegs']],
  ['banane-mit-erdnussbutter', 'snack', 230, 6, ['vegetarisch', 'vor-dem-training', 'schnell']],
  ['edamame-mit-meersalz', 'snack', 180, 17, ['vegan', 'proteinreich', 'low-carb']],
  ['huettenkaese-mit-ananas', 'snack', 200, 19, ['proteinreich', 'vegetarisch', 'schnell']],
];
export const SUGGESTED_MEALS = RECIPE_ROWS.map(([id, category, kcal, protein, tags]) => ({
  suggestionId: id, category, kcal, protein, tags,
  get title() { return t(`recipes.${id}.title`); },
  get ingredients() { return tList(`recipes.${id}.ingredients`) || []; },
}));

let recipesLoading = null;
/** Loads recipe titles and ingredients (lazy catalog area). */
export function loadRecipeTexts() { return (recipesLoading ||= loadArea('recipes')); }

/* --------------------------- Preference learning --------------------------- */
/** Weights tags by favourite status and cooking frequency. */
function preferredTags(meals) {
  const score = {};
  meals.forEach((m) => {
    const w = (m.favorite ? 3 : 0) + (m.cookedCount || 0);
    if (w <= 0) return;
    (m.tags || []).forEach((tag) => { score[tag] = (score[tag] || 0) + w; });
  });
  return Object.entries(score).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

/** Recommends non-favourites with matching favourite tags. */
function recommendations(meals) {
  const tags = preferredTags(meals).slice(0, 3);
  if (!tags.length) return [];
  return meals
    .filter((m) => !m.favorite)
    .map((m) => ({ m, match: (m.tags || []).filter((tag) => tags.includes(tag)).length }))
    .filter((x) => x.match > 0)
    .sort((a, b) => b.match - a.match || (b.m.cookedCount || 0) - (a.m.cookedCount || 0))
    .slice(0, 3)
    .map((x) => x.m);
}

/** Sort order within a category: favourites first, then frequently cooked. */
function byPreference(a, b) {
  return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.cookedCount || 0) - (a.cookedCount || 0) || a.title.localeCompare(b.title);
}

/* -------------------------------- Render -------------------------------- */
export function render(view) {
  setHeader({ title: t('nav.nutrition'), actions: [{ icon: 'plus', label: t('nutrition.add'), onClick: () => openMealForm() }] });

  if (store.settings().modules?.nutrition === false) { view.appendChild(moduleOff(t('nav.nutrition'))); return; }
  // Recipe ideas come with the recipes area; draw again once it is there.
  if (!hasArea('recipes')) {
    loadRecipeTexts().then(() => { if (hasArea('recipes') && /^#\/nutrition/.test(location.hash)) render(view); });
  }

  const meals = store.get('nutrition');
  if (!meals.length) {
    // New user: NO silent "empty" state – load the recipe catalogue or create your own dish.
    view.appendChild(emptyState('utensils', t('nutrition.emptyTitle'), t('nutrition.emptyText')));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => addSuggestions(SUGGESTED_MEALS) }, [
      icon('plus'), t('nutrition.loadIdeas', { n: SUGGESTED_MEALS.length }),
    ]));
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openMealForm() }, [
      icon('plus'), t('nutrition.addOwn'),
    ]));
    return;
  }

  // Calorie balance today (#23)
  view.appendChild(balanceCard());

  view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('nutrition.learnHint') }),
  ]));

  // Favourite dishes
  const favs = meals.filter((m) => m.favorite).sort(byPreference);
  if (favs.length) {
    view.appendChild(sectionHead(t('nutrition.favourites')));
    favs.forEach((m) => view.appendChild(mealCard(m)));
  }

  // For you (learned from preferences)
  const recs = recommendations(meals);
  if (recs.length) {
    view.appendChild(sectionHead(t('nutrition.recommended')));
    recs.forEach((m) => view.appendChild(mealCard(m, true)));
  }

  // By category
  CATS.forEach((c) => {
    const list = meals.filter((m) => m.category === c.key && !m.favorite).sort(byPreference);
    if (!list.length) return;
    view.appendChild(sectionHead(c.label));
    list.forEach((m) => view.appendChild(mealCard(m)));
  });

  // More recipe variety for the 7-day plan (#25)
  const fresh = SUGGESTED_MEALS.filter((s) => !meals.some((m) => m.suggestionId === s.suggestionId || m.title.toLowerCase() === s.title.toLowerCase()));
  if (fresh.length) {
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-4', onclick: () => addSuggestions(fresh) }, [
      icon('plus'), tp('nutrition.addIdeas', fresh.length),
    ]));
  }
}

/** Adopts recipe suggestions not yet present into your own collection (#25). */
function addSuggestions(fresh) {
  fresh.forEach((s) => store.upsert('nutrition', { ...s, id: uid('n') }));
  toast(tp('nutrition.ideasAdded', fresh.length), 'good');
  rerender();
}

/** Calorie balance card: burned vs. consumed + recommendation (#23). Calculates via
    `currentEnergyTargets` – the same source as the goal cockpit on "Today". */
function balanceCard() {
  const today = todayStr();
  const tg = currentEnergyTargets(today);
  const elig = tg.elig;
  const hide = elig.hideNumbers;

  // Child and youth profile: no calorie or weight targets, no numbers.
  if (tg.block === 'minor') {
    return el('div', { class: 'card' }, [
      el('div', { class: 'card__title', text: t('nutrition.eatDrinkToday') }),
      el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: weightGoalBlockReason(elig) }),
      el('button', { class: 'btn btn--soft btn--block mt-3', onclick: () => openQuickEaten() }, [icon('plus'), t('nutrition.logEaten')]),
      diaryList({ hide: true, showComplete: false }),
    ]);
  }
  const bal = tg.balance;
  if (!bal) {
    return el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('nutrition.needProfile') }),
        el('button', { class: 'btn btn--soft mt-2', onclick: () => navigate('#/settings') }, t('nutrition.toProfile')),
      ]),
    ]);
  }
  // Without an answered delimitation no daily target (pregnancy/eating disorder would otherwise be unknown).
  const askGate = !elig.answered && tg.goalStatus && tg.goalStatus.status !== 'halten';
  const COL = { passt: '#2bb673', hoch: '#e8a13a', niedrig: '#5b8def', unklar: 'var(--text-3)' };
  const c = askGate ? 'var(--text-3)' : (COL[bal.status] || 'var(--text-3)');
  const goalTxt = askGate ? t('nutrition.goalOpen') : bal.goal === 'abnehmen' ? t('nutrition.goalLose') : bal.goal === 'zunehmen' ? t('nutrition.goalGain') : t('nutrition.goalMaintain');
  const blockNote = tg.block === 'eligibility' ? weightGoalBlockReason(elig)
    : tg.block === 'bmi' ? t('nutrition.bmiBlock')
      : tg.goalStatus && tg.goalStatus.beyond && tg.goalStatus.direction === 'down' ? t('nutrition.belowTarget')
        : null;
  const qualitative = { passt: t('nutrition.qualOk'), hoch: t('nutrition.qualHigh'), niedrig: t('nutrition.qualLow'), unklar: t('nutrition.qualNone') }[bal.status];
  return el('div', { class: 'card', style: { borderLeft: `5px solid ${c}` } }, [
    el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
      el('div', { class: 'card__title', text: t('nutrition.balanceToday') }),
      el('span', { class: 'dim', style: { fontSize: '.74rem' }, text: goalTxt }),
    ]),
    hide ? null : el('div', { class: 'stat-grid mt-2' }, [
      kcalStat(bal.intake, t('nutrition.statIntake')),
      kcalStat(bal.out, t('nutrition.statOut')),
      kcalStat(`${bal.balance > 0 ? '+' : ''}${fmtInt(bal.balance)}`, t('nutrition.statBalance')),
    ]),
    askGate
      ? gatePromptCard(t('nutrition.gatePrompt'), rerender)
      : el('div', { class: 'muted mt-2', style: { fontSize: '.82rem' }, text: hide ? qualitative : bal.hint }),
    blockNote ? el('div', { class: 'muted mt-2', style: { fontSize: '.8rem' }, text: blockNote }) : null,
    hide || askGate ? null : el('div', { class: 'dim mt-1', style: { fontSize: '.72rem' }, text: t('nutrition.balanceDetail', { bmr: fmtInt(bal.bmr), out: fmtInt(bal.out), target: fmtInt(bal.targetIntake) }) }),
    el('button', { class: 'btn btn--soft btn--block mt-3', onclick: () => openQuickEaten() }, [icon('plus'), t('nutrition.logEaten')]),
    diaryList({ hide, showComplete: true }),
    labsEnabledHere() ? el('a', { class: 'dim mt-2', href: '#/labor', style: { display: 'block', fontSize: '.74rem' }, text: t('nutrition.energyLink') }) : null,
  ]);
}

/** Labs module active for one's own view? (link to energy availability) */
function labsEnabledHere() { return !store.isManaging() && store.settings().modules?.labs !== false; }

/** "Eaten today": the food-diary entries of the day, individually deletable – plus the
    day marker "completely logged", by which energy availability is assessed. */
function diaryList({ hide = false, showComplete = true } = {}) {
  const today = todayStr();
  const all = store.get('diary');
  const todayDiary = all.filter((d) => d && !d.deleted && !d._kind && d.date === today);
  if (!todayDiary.length) return null;
  const marker = all.find((d) => d && !d.deleted && d._kind === 'day' && d.date === today);
  const complete = !!(marker && marker.complete);
  return el('div', { class: 'mt-3' }, [
    el('div', { class: 'dim mb-1', style: { fontSize: '.72rem', fontWeight: '700', letterSpacing: '.03em' }, text: t('nutrition.eatenToday') }),
    ...todayDiary.map((d) => el('div', { class: 'row row--between', style: { padding: '5px 0', borderTop: '1px solid var(--border)', alignItems: 'center' } }, [
      el('div', { class: 'grow', style: { fontSize: '.84rem' } }, [
        el('span', { text: d.title }),
        el('span', { class: 'dim', style: { marginLeft: '8px' }, text: `${hide ? '' : `${fmtInt(d.kcal)} kcal`}${d.source === 'cooked' ? `${hide ? '' : ' · '}${t('nutrition.cookedTag')}` : ''}` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': t('nutrition.deleteEntry'), style: { color: 'var(--text-3)' }, onclick: () => {
        const prev = { ...d };
        store.remove('diary', d.id); rerender();
        toastUndo(t('nutrition.entryDeleted'), () => { store.upsert('diary', { ...prev, deleted: undefined }); rerender(); });
      } }, icon('x')),
    ])),
    showComplete ? el('button', {
      class: `btn ${complete ? 'btn--soft' : 'btn--ghost'} btn--block mt-2`, style: { fontSize: '.8rem' },
      'aria-pressed': complete ? 'true' : 'false',
      onclick: () => {
        store.upsert('diary', { id: `day-${today}`, _kind: 'day', date: today, complete: !complete });
        toast(complete ? t('nutrition.markRemoved') : t('nutrition.dayMarked'), 'good');
        rerender();
      },
    }, [icon(complete ? 'check' : 'circle'), complete ? t('nutrition.dayLogged') : t('nutrition.dayMark')]) : null,
  ]);
}

function kcalStat(val, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__val num', style: { fontSize: '1.2rem' }, text: typeof val === 'number' ? fmtInt(val) : val }),
    el('div', { class: 'stat__label', text: label }),
  ]);
}

/** Free text "200 g Skyr, 1 banana" → ingredient list for the nutrient estimate. */
export function splitFoods(text) {
  return String(text || '').split(/[,;+\n]|\s+und\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Log eaten food quickly (UI-26): foods with quantity – estimated from the
 * nutrient table –, "recently eaten" with one tap or flat by portion size
 * (eating out, #26). Previously there were only the flat portions (± 200 kcal per snack).
 */
/**
 * "Barcode" section: type in the barcode (or, where the browser can, read it with the camera),
 * look up the product, quantity in grams – from that kcal and protein.
 * Returns { node, result(), stopCamera() }.
 */
function barcodePane(hide) {
  let product = null;
  let stream = null, timer = null;
  const codeI = input({ value: '', inputmode: 'numeric', placeholder: t('nutrition.barcodePlaceholder'), 'aria-label': t('nutrition.barcodeAria') });
  const gramsI = input({ type: 'number', value: '100', inputmode: 'decimal', min: '1', max: '5000', 'aria-label': t('nutrition.gramsAria') });
  const info = el('div', { class: 'dim mt-1', style: { fontSize: '.8rem' }, 'aria-live': 'polite' });
  const video = el('video', { class: 'barcode__video', playsinline: '', muted: '', hidden: true });
  const stopCamera = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
    video.hidden = true;
  };
  const showProduct = () => {
    if (!product) return;
    const p = portionFromProduct(product, gramsI.value);
    info.textContent = hide ? product.name
      : `${product.name}${product.kcal100 ? ` · ${t('nutrition.kcalPer100', { kcal: fmtDec(product.kcal100) })}` : ` · ${t('nutrition.noKcal')}`}${p ? ` → ${p.kcal} kcal${p.protein != null ? `, ${t('nutrition.gProtein', { g: fmtDec(p.protein) })}` : ''}` : ''}`;
  };
  const lookup = async () => {
    const code = codeI.value.replace(/\s/g, '');
    product = null;
    if (!validGtin(code)) { info.textContent = t('nutrition.badBarcode'); return; }
    // The same switch as for all lookups at Open Food Facts – without it nothing goes out.
    if (!store.foodLookupEnabled()) {
      info.textContent = '';
      info.appendChild(el('div', { text: t('nutrition.lookupOff') }));
      info.appendChild(el('button', { class: 'btn btn--soft mt-2', type: 'button', onclick: () => { store.setSetting('foodLookup', true); lookup(); } }, t('nutrition.turnOnSearch')));
      return;
    }
    info.textContent = t('nutrition.searching');
    const r = await foodfactsBarcode(code);
    if (!r) { info.textContent = t('nutrition.notFound'); return; }
    product = r;
    showProduct();
  };
  gramsI.addEventListener('input', showProduct);
  // Camera only if the browser recognises barcodes itself – without an extra library.
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const scanBtn = canScan ? el('button', { class: 'btn btn--soft', type: 'button', onclick: async () => {
    try {
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; video.hidden = false; await video.play();
      timer = setInterval(async () => {
        const found = await detector.detect(video).catch(() => []);
        const hit = found.find((b) => validGtin(b.rawValue));
        if (hit) { stopCamera(); codeI.value = hit.rawValue; lookup(); }
      }, 300);
    } catch { stopCamera(); toast(t('nutrition.cameraOff')); }
  } }, [icon('camera'), t('nutrition.scan')]) : null;
  const node = el('div', {}, [
    field(t('nutrition.barcode'), codeI),
    el('div', { class: 'row gap-2 mb-3' }, [el('button', { class: 'btn btn--soft grow', type: 'button', onclick: lookup }, t('nutrition.search')), scanBtn]),
    video,
    field(t('nutrition.amountGml'), gramsI),
    info,
    el('div', { class: 'dim mt-2', style: { fontSize: '.74rem' }, text: t('nutrition.offCredit') }),
  ]);
  return {
    node,
    stopCamera,
    result() {
      const p = product && portionFromProduct(product, gramsI.value);
      return p ? { title: `${product.name} (${fmtDec(gramsI.value)} g)`, kcal: p.kcal, protein: p.protein } : null;
    },
  };
}

export function openQuickEaten() {
  const SIZES = [['klein', t('nutrition.sizeSmall')], ['mittel', t('nutrition.sizeMedium')], ['gross', t('nutrition.sizeLarge')], ['restaurant', t('nutrition.sizeRestaurant')]];
  const hide = currentEligibility().hideNumbers;
  const today = todayStr();
  let mode = 'food';
  const save = (rec) => {
    store.upsert('diary', { id: uid('d'), date: today, protein: null, source: 'manual', ...rec });
    closeSheet(); toast(t('nutrition.logged'), 'good'); rerender();
  };

  // Food + quantity
  const foodI = input({ value: '', placeholder: t('nutrition.foodPlaceholder') });
  const est = el('div', { class: 'dim mt-1', style: { fontSize: '.8rem' }, 'aria-live': 'polite' });
  const estimate = () => { const parts = splitFoods(foodI.value); return parts.length ? estimateNutrition(parts) : null; };
  const showEst = () => {
    const r = estimate();
    est.textContent = !r ? t('nutrition.estHint')
      : hide ? t('nutrition.estHide')
        : `≈ ${fmtInt(r.kcal)} kcal${r.protein != null ? ` · ${t('nutrition.gProtein', { g: r.protein })}` : ''} – ${t('nutrition.estSource')}`;
  };
  foodI.addEventListener('input', showEst);
  showEst();
  // Recently eaten: the last six distinct entries; one tap logs them for today.
  const recent = [];
  store.get('diary').slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .forEach((d) => { if (d.title && d.kcal && recent.length < 6 && !recent.some((r) => r.title === d.title)) recent.push(d); });
  const foodPane = el('div', {}, [
    field(t('nutrition.whatHowMuch'), foodI), est,
    recent.length ? el('div', { class: 'mt-3' }, [
      el('div', { class: 'field__label', text: t('nutrition.recentlyEaten') }),
      el('div', { class: 'row wrap gap-2' }, recent.map((d) => el('button', {
        class: 'chip chip--btn', type: 'button', title: t('nutrition.logForToday'),
        text: hide ? d.title : `${d.title} · ${fmtInt(d.kcal)} kcal`,
        onclick: () => save({ title: d.title, kcal: d.kcal, protein: d.protein ?? null }),
      }))),
    ]) : null,
  ]);

  // Flat estimate by portion size – for eating out
  const titleI = input({ value: '', placeholder: t('nutrition.outPlaceholder') });
  const kcalI = input({ type: 'number', value: PORTION_KCAL.mittel, inputmode: 'numeric' });
  const sizeRow = el('div', { class: 'row wrap gap-2' }, SIZES.map(([k, lbl]) => {
    const b = el('button', {
      class: 'btn btn--soft' + (k === 'mittel' ? ' btn--primary' : ''), type: 'button', 'aria-pressed': k === 'mittel' ? 'true' : 'false',
      onclick: () => {
        kcalI.value = PORTION_KCAL[k];
        [...sizeRow.children].forEach((x) => { x.classList.remove('btn--primary'); x.setAttribute('aria-pressed', 'false'); });
        b.classList.add('btn--primary'); b.setAttribute('aria-pressed', 'true');
      },
    }, hide ? lbl : `${lbl} ~${PORTION_KCAL[k]}`);
    return b;
  }));
  const portionPane = el('div', {}, [
    el('div', { class: 'muted', style: { fontSize: '.84rem', marginBottom: '10px' }, text: hide ? t('nutrition.portionHintHide') : t('nutrition.portionHint') }),
    field(t('nutrition.what'), titleI),
    field(t('nutrition.portionSize'), sizeRow),
    hide ? null : field(t('nutrition.kcalAdjustable'), kcalI),
  ]);

  // Barcode: look the product up on Open Food Facts (via our own server), amount in grams.
  const bc = barcodePane(hide);
  const host = el('div', {}, [foodPane]);
  const modeCtl = segmented([{ value: 'food', label: t('nutrition.modeFood') }, { value: 'barcode', label: t('nutrition.modeBarcode') }, { value: 'portion', label: t('nutrition.modeOut') }], mode,
    (v) => { mode = v; bc.stopCamera(); host.innerHTML = ''; host.appendChild(v === 'food' ? foodPane : v === 'barcode' ? bc.node : portionPane); }, { label: t('nutrition.modeLabel') });
  openSheet({
    title: t('nutrition.logEaten'),
    body: el('div', {}, [el('div', { class: 'mb-3' }, [modeCtl]), host]),
    onClose: () => bc.stopCamera(),   // never leave the camera running
    footer: [
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('nutrition.log'),
        onclick: () => {
          if (mode === 'food') {
            const r = estimate();
            if (!r) { toast(t('nutrition.enterWhat'), 'bad'); return; }
            save({ title: foodI.value.trim(), kcal: r.kcal, protein: r.protein });
            return;
          }
          if (mode === 'barcode') {
            const r = bc.result();
            if (!r) { toast(t('nutrition.findProduct'), 'bad'); return; }
            bc.stopCamera();
            save(r);
            return;
          }
          save({ title: titleI.value.trim() || t('nutrition.ateOut'), kcal: parseInt(kcalI.value) || PORTION_KCAL.mittel });
        },
      }),
    ],
  });
}

function mealCard(m, isRec = false) {
  const cooked = m.cookedCount || 0;
  return el('div', { class: 'card' }, [
    el('div', { class: 'row row--between' }, [
      el('div', { class: 'card__title grow', text: m.title }),
      el('button', {
        class: 'icon-btn', 'aria-label': m.favorite ? t('nutrition.unfavourite') : t('nutrition.favourite'),
        style: { color: m.favorite ? '#ef5d6c' : 'var(--text-3)' },
        onclick: () => { store.patch('nutrition', m.id, { favorite: !m.favorite }); rerender(); },
      }, icon('heart')),
      el('button', { class: 'icon-btn', 'aria-label': t('nutrition.edit'), onclick: () => openMealForm(m) }, icon('edit')),
    ]),
    el('div', { class: 'row wrap gap-2 mt-2' }, [
      isRec ? el('span', { class: 'chip chip--accent', text: t('nutrition.matchesTastes') }) : null,
      m.plannedServings > 0 ? el('span', { class: 'chip chip--accent', text: t('nutrition.inWeekPlan', { n: m.plannedServings }) }) : null,
      cooked > 0 ? el('span', { class: 'chip chip--good', text: t('nutrition.cookedTimes', { n: cooked }) }) : null,
      m.kcal && !currentEligibility().hideNumbers ? el('span', { class: 'chip', text: `${fmtInt(m.kcal)} kcal` }) : null,
      m.protein ? el('span', { class: 'chip', text: t('nutrition.proteinG', { g: m.protein }) }) : null,
      ...(m.tags || []).map((tag) => el('span', { class: 'chip', text: tag })),
    ]),
    m.ingredients?.length ? el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: m.ingredients.join(' · ') }) : null,
    m.note ? el('div', { class: 'dim mt-2', style: { fontSize: '.8rem' }, text: m.note }) : null,
    el('div', { class: 'row row--between mt-3', style: { alignItems: 'center' } }, [
      el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
        el('span', { class: 'dim', style: { fontSize: '.76rem' }, html: iconSvg('cart'), title: t('nutrition.servingsForWeek') }),
        stepper(m.plannedServings || 0, { min: 0, max: 14, onChange: (v) => { store.patch('nutrition', m.id, { plannedServings: v }); } }),
      ]),
      el('button', { class: 'btn btn--soft', onclick: () => markCooked(m) }, [icon('check'), t('nutrition.cooked')]),
    ]),
  ]);
}

function markCooked(m) {
  // One serving cooked: count up, weekly plan down, ingredients taken out of the pantry.
  store.patch('nutrition', m.id, {
    cookedCount: (m.cookedCount || 0) + 1,
    lastCooked: todayStr(),
    plannedServings: Math.max(0, (m.plannedServings || 0) - 1),
  });
  // Cooked serving goes into the food diary (for the calorie balance) when kcal is known.
  if (m.kcal) store.upsert('diary', { id: uid('d'), date: todayStr(), title: m.title, kcal: m.kcal, protein: m.protein || null, source: 'cooked', mealId: m.id });
  const nextPantry = applyConsumption(store.familyPantry(), m.ingredients, 1);
  store.setFamilyPantry(nextPantry);
  toast(t('nutrition.cookedToast', { title: m.title }), 'good');
  rerender();
}

function openMealForm(existing = null) {
  const m = existing || { category: 'fruehstueck' };
  const titleI = input({ value: m.title || '', placeholder: t('nutrition.title') });
  const catI = select(CATS.map((c) => ({ value: c.key, label: c.label })), m.category || 'fruehstueck');
  const kcalI = input({ type: 'number', value: m.kcal || '', placeholder: 'kcal', inputmode: 'numeric' });
  const protI = input({ type: 'number', value: m.protein || '', placeholder: 'g', inputmode: 'numeric' });
  const ingI = textarea({ value: (m.ingredients || []).join('\n'), placeholder: t('nutrition.ingredientsPlaceholder') });
  const tagsI = input({ value: (m.tags || []).join(', '), placeholder: t('nutrition.tagsPlaceholder') });
  const noteI = input({ value: m.note || '', placeholder: t('nutrition.note') });

  // kcal field with an estimate from the ingredients (#26)
  const kcalField = el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
    el('div', { class: 'grow' }, kcalI),
    el('button', {
      class: 'btn btn--soft', type: 'button', title: t('nutrition.estimateTitle'),
      onclick: async (e) => {
        const list = ingI.value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!list.length) { toast(t('nutrition.addIngredientsFirst'), 'bad'); return; }
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = t('nutrition.estimating');
        // Fetch real nutrition values per ingredient from Open Food Facts (only when enabled).
        let map = null;
        if (store.foodLookupEnabled()) {
          const names = [...new Set(list.map((x) => parseIngredient(x).name).filter(Boolean))];
          const entries = await Promise.all(names.map(async (n) => [n.toLowerCase(), await foodfactsLookup(n)]));
          map = Object.fromEntries(entries.filter(([, v]) => v));
        }
        const lookup = map ? (name) => map[String(name).toLowerCase()] || null : null;
        const est = estimateNutrition(list, lookup);
        btn.disabled = false; btn.replaceChildren(icon('zap'), document.createTextNode(t('nutrition.estimate')));
        if (!est) { toast(t('nutrition.addIngredientsFirst'), 'bad'); return; }
        kcalI.value = est.kcal;
        if (est.protein != null && !protI.value) protI.value = est.protein;
        const off = map ? Object.keys(map).length : 0;
        toast(`${t('nutrition.estimatedPrefix')} ~${est.kcal} kcal${est.protein != null ? `, ${t('nutrition.proteinG', { g: est.protein })}` : ''}${off ? ` · ${t('nutrition.offCount', { n: off })}` : ''}`, 'good');
      },
    }, [icon('zap'), t('nutrition.estimate')]),
  ]);

  openSheet({
    title: existing ? t('nutrition.editMeal') : t('nutrition.newMeal'),
    body: el('div', {}, [
      field(t('nutrition.title'), titleI),
      el('div', { class: 'field__row' }, [field(t('nutrition.category'), catI), field(t('nutrition.proteinLabel'), protI)]),
      field('kcal', kcalField),
      field(t('nutrition.ingredients'), ingI),
      field(t('nutrition.tags'), tagsI),
      field(t('nutrition.note'), noteI),
    ]),
    footer: [
      existing ? el('button', { class: 'btn btn--danger', 'aria-label': t('nutrition.delete'), onclick: async () => { if (await confirmDialog({ title: t('nutrition.deleteQ'), confirmLabel: t('nutrition.delete'), danger: true })) { store.remove('nutrition', existing.id); closeSheet(); toast(t('nutrition.deleted')); rerender(); } } }, icon('trash')) : null,
      el('button', { class: 'btn btn--ghost grow', text: t('common.cancel'), onclick: () => closeSheet() }),
      el('button', {
        class: 'btn btn--primary grow', text: t('nutrition.save'),
        onclick: () => {
          if (!titleI.value.trim()) { toast(t('nutrition.titleMissing'), 'bad'); return; }
          store.upsert('nutrition', {
            ...m, id: m.id || uid('n'), title: titleI.value.trim(), category: catI.value,
            kcal: parseInt(kcalI.value) || null, protein: parseInt(protI.value) || null,
            ingredients: ingI.value.split('\n').map((x) => x.trim()).filter(Boolean),
            tags: tagsI.value.split(',').map((x) => x.trim()).filter(Boolean),
            note: noteI.value.trim(),
          });
          closeSheet(); toast(t('nutrition.saved'), 'good'); rerender();
        },
      }),
    ],
  });
}

// Redraw via the router (scroll position stays, even when the form was opened from
// another view); without the app shell (tests) directly.
function rerender() { rerenderView(render); }

export function moduleOff(name) {
  return el('div', { class: 'empty', style: { paddingTop: '60px' } }, [
    el('div', { class: 'empty__icon', html: iconSvg('settings') }),
    el('div', { class: 'empty__title', text: t('nutrition.moduleOff', { name }) }),
    el('div', { class: 'muted', text: t('nutrition.moduleOffHint') }),
    el('button', { class: 'btn btn--soft mt-4', onclick: () => navigate('#/settings'), text: t('nutrition.toSettings') }),
  ]);
}
