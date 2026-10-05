/* =========================================================================
   nutrition.js — Ernährungsvorschläge mit Vorlieben-Lernen (abschaltbar).
   Die App lernt aus Favoriten und „Gekocht“-Häufigkeit, welche Tags du
   bevorzugst, und empfiehlt passende Gerichte („Für dich“).
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

import { t, tp } from './i18n.js';

const CATS = [
  { key: 'fruehstueck', get label() { return t('nutrition.catBreakfast'); } },
  { key: 'mittag', get label() { return t('nutrition.catLunch'); } },
  { key: 'abend', get label() { return t('nutrition.catDinner'); } },
  { key: 'snack', get label() { return t('nutrition.catSnack'); } },
];

/* Rezept-Ideen für eine abwechslungsreiche 7-Tage-Planung (#25). Werden auf
   Wunsch in den eigenen Bestand übernommen; bereits vorhandene Titel bleiben
   außen vor. Kuratierter, deutschsprachiger Katalog (offline, ohne externe
   Datenbank) – Zutaten in parsbarer „Menge Einheit Name“-Form für die
   automatische Einkaufsliste. */
export const SUGGESTED_MEALS = [
  // ---- Frühstück ----
  { category: 'fruehstueck', title: 'Overnight Oats mit Beeren', kcal: 520, protein: 30, tags: ['proteinreich', 'vegetarisch', 'meal-prep'], ingredients: ['60 g Haferflocken', '150 g Skyr', '150 ml Milch', '100 g Beeren', '1 EL Honig'] },
  { category: 'fruehstueck', title: 'Rührei mit Vollkornbrot & Avocado', kcal: 600, protein: 31, tags: ['proteinreich', 'vegetarisch'], ingredients: ['3 Eier', '2 Scheiben Vollkornbrot', '1/2 Avocado', 'Spinat'] },
  { category: 'fruehstueck', title: 'Protein-Porridge mit Banane', kcal: 600, protein: 39, tags: ['proteinreich', 'vegetarisch'], ingredients: ['60 g Haferflocken', '30 g Proteinpulver', '250 ml Milch', '1 Banane'] },
  { category: 'fruehstueck', title: 'Quark mit Nüssen & Apfel', kcal: 400, protein: 33, tags: ['proteinreich', 'vegetarisch', 'low-carb'], ingredients: ['250 g Magerquark', '20 g Walnuss', '1 Apfel', '1 TL Honig'] },
  { category: 'fruehstueck', title: 'Vollkorn-Pancakes mit Quark', kcal: 580, protein: 41, tags: ['proteinreich', 'vegetarisch'], ingredients: ['60 g Haferflocken', '2 Eier', '150 g Magerquark', '1 Banane', '1 TL Backpulver'] },
  { category: 'fruehstueck', title: 'Chia-Pudding mit Mango', kcal: 320, protein: 8, tags: ['vegetarisch', 'vegan', 'meal-prep'], ingredients: ['30 g Chiasamen', '200 ml Hafermilch', '100 g Mango', '1 TL Agavendicksaft'] },
  { category: 'fruehstueck', title: 'Bircher Müsli', kcal: 530, protein: 20, tags: ['vegetarisch', 'meal-prep'], ingredients: ['50 g Haferflocken', '150 g Joghurt', '1 Apfel', '20 g Mandeln', '100 ml Milch'] },
  { category: 'fruehstueck', title: 'Avocado-Brot mit Ei', kcal: 480, protein: 24, tags: ['proteinreich', 'vegetarisch'], ingredients: ['2 Scheiben Vollkornbrot', '1/2 Avocado', '2 Eier'] },
  { category: 'fruehstueck', title: 'Grießbrei mit Beeren', kcal: 430, protein: 16, tags: ['vegetarisch', 'schnell'], ingredients: ['50 g Grieß', '300 ml Milch', '100 g Beeren', '1 TL Honig'] },
  { category: 'fruehstueck', title: 'Skyr-Bowl mit Granola', kcal: 480, protein: 28, tags: ['proteinreich', 'vegetarisch'], ingredients: ['200 g Skyr', '40 g Granola', '1 Banane', '10 g Walnuss'] },
  { category: 'fruehstueck', title: 'Tofu-Rührei mit Brot', kcal: 470, protein: 35, tags: ['vegan', 'proteinreich'], ingredients: ['200 g Tofu', '2 Scheiben Vollkornbrot', '1 Tomate'] },
  { category: 'fruehstueck', title: 'Erdnussbutter-Toast mit Banane', kcal: 440, protein: 14, tags: ['vegetarisch', 'schnell', 'vor-dem-training'], ingredients: ['2 Scheiben Vollkornbrot', '20 g Erdnussbutter', '1 Banane'] },
  // ---- Mittag ----
  { category: 'mittag', title: 'Hähnchen-Reis-Bowl mit Brokkoli', kcal: 600, protein: 46, tags: ['proteinreich', 'meal-prep'], ingredients: ['150 g Hähnchen', '80 g Reis', '200 g Brokkoli', '1 EL Öl'] },
  { category: 'mittag', title: 'Lachs mit Süßkartoffel & Spinat', kcal: 620, protein: 35, tags: ['proteinreich', 'omega-3'], ingredients: ['150 g Lachs', '250 g Süßkartoffel', 'Spinat', '1 EL Öl'] },
  { category: 'mittag', title: 'Linsen-Dal mit Reis', kcal: 490, protein: 19, tags: ['vegetarisch', 'vegan', 'ballaststoffreich'], ingredients: ['120 g Linsen', '80 g Reis', '1 Zwiebel', '200 g Tomaten'] },
  { category: 'mittag', title: 'Pute-Quinoa-Pfanne', kcal: 530, protein: 51, tags: ['proteinreich', 'glutenfrei'], ingredients: ['150 g Pute', '80 g Quinoa', '1 Paprika', '1 Zucchini'] },
  { category: 'mittag', title: 'Rindergeschnetzeltes mit Reis', kcal: 550, protein: 39, tags: ['proteinreich'], ingredients: ['150 g Rind', '80 g Reis', '1 Paprika', '1 Zwiebel'] },
  { category: 'mittag', title: 'Kichererbsen-Bowl mit Quinoa', kcal: 550, protein: 27, tags: ['vegetarisch', 'vegan', 'ballaststoffreich'], ingredients: ['150 g Kichererbsen', '80 g Quinoa', '100 g Brokkoli', '1 Karotte'] },
  { category: 'mittag', title: 'Vollkorn-Spaghetti Bolognese', kcal: 780, protein: 43, tags: ['proteinreich', 'meal-prep'], ingredients: ['100 g Vollkornnudeln', '150 g Hackfleisch', '200 g Tomaten', '1 Zwiebel'] },
  { category: 'mittag', title: 'Gefüllte Süßkartoffel mit Hüttenkäse', kcal: 390, protein: 26, tags: ['proteinreich', 'vegetarisch'], ingredients: ['250 g Süßkartoffel', '150 g Hüttenkäse', '100 g Spinat'] },
  { category: 'mittag', title: 'Couscous-Salat mit Feta', kcal: 590, protein: 22, tags: ['vegetarisch', 'meal-prep'], ingredients: ['80 g Couscous', '50 g Feta', '1 Paprika', '1 Gurke', '1 EL Öl'] },
  { category: 'mittag', title: 'Hähnchen-Wrap mit Gemüse', kcal: 430, protein: 42, tags: ['proteinreich', 'schnell'], ingredients: ['1 Wrap', '150 g Hähnchen', 'Salat', '1 Tomate', '50 g Joghurt'] },
  { category: 'mittag', title: 'Kabeljau mit Kartoffeln & Brokkoli', kcal: 460, protein: 42, tags: ['proteinreich', 'omega-3', 'low-carb'], ingredients: ['180 g Kabeljau', '250 g Kartoffeln', '150 g Brokkoli', '1 EL Öl'] },
  { category: 'mittag', title: 'Gemüsecurry mit Kichererbsen', kcal: 880, protein: 23, tags: ['vegan', 'vegetarisch', 'ballaststoffreich'], ingredients: ['150 g Kichererbsen', '80 g Reis', '200 ml Kokosmilch', '1 Paprika'] },
  // ---- Abend ----
  { category: 'abend', title: 'Magerquark mit Gemüsesticks', kcal: 260, protein: 36, tags: ['proteinreich', 'low-carb', 'leicht'], ingredients: ['250 g Magerquark', '1 Paprika', '1 Gurke'] },
  { category: 'abend', title: 'Omelett mit Feta & Tomaten', kcal: 440, protein: 30, tags: ['proteinreich', 'vegetarisch', 'low-carb'], ingredients: ['3 Eier', '50 g Feta', '200 g Tomaten', 'Spinat'] },
  { category: 'abend', title: 'Thunfisch-Vollkornwrap', kcal: 410, protein: 43, tags: ['proteinreich', 'schnell'], ingredients: ['1 Wrap', '150 g Thunfisch', 'Salat', '50 g Joghurt'] },
  { category: 'abend', title: 'Ofengemüse mit Hähnchen', kcal: 510, protein: 43, tags: ['proteinreich', 'low-carb', 'meal-prep'], ingredients: ['150 g Hähnchen', '1 Zucchini', '1 Paprika', '1 Süßkartoffel', '1 EL Öl'] },
  { category: 'abend', title: 'Gebratener Tofu mit Gemüse', kcal: 330, protein: 31, tags: ['vegan', 'proteinreich', 'low-carb'], ingredients: ['200 g Tofu', '1 Paprika', '100 g Brokkoli', '1 EL Sojasauce'] },
  { category: 'abend', title: 'Hähnchensalat mit Avocado', kcal: 440, protein: 37, tags: ['proteinreich', 'low-carb'], ingredients: ['150 g Hähnchen', '1/2 Avocado', 'Salat', '1 Tomate', '1 EL Öl'] },
  { category: 'abend', title: 'Linsensuppe', kcal: 360, protein: 22, tags: ['vegan', 'vegetarisch', 'meal-prep'], ingredients: ['200 g Linsen', '1 Karotte', '1 Zwiebel', '1 Kartoffel'] },
  { category: 'abend', title: 'Caprese mit Mozzarella', kcal: 440, protein: 25, tags: ['vegetarisch', 'low-carb', 'schnell'], ingredients: ['125 g Mozzarella', '200 g Tomaten', 'Basilikum', '1 EL Öl'] },
  { category: 'abend', title: 'Garnelen-Zucchini-Pfanne', kcal: 260, protein: 33, tags: ['proteinreich', 'low-carb'], ingredients: ['150 g Garnelen', '1 Zucchini', '1 Zehe Knoblauch', '1 EL Öl'] },
  { category: 'abend', title: 'Putenbrust mit Ofengemüse', kcal: 360, protein: 43, tags: ['proteinreich', 'low-carb', 'meal-prep'], ingredients: ['150 g Pute', '1 Zucchini', '1 Paprika', '100 g Champignons', '1 EL Öl'] },
  { category: 'abend', title: 'Vollkorn-Pizza mit Gemüse', kcal: 630, protein: 27, tags: ['vegetarisch'], ingredients: ['1/2 Pizzateig', '100 g Tomaten', '80 g Mozzarella', '1 Paprika'] },
  { category: 'abend', title: 'Joghurt-Bowl mit Gurke & Fladenbrot', kcal: 420, protein: 20, tags: ['vegetarisch', 'leicht'], ingredients: ['200 g Joghurt', '1 Gurke', '1 Zehe Knoblauch', '1/2 Fladenbrot'] },
  // ---- Snack ----
  { category: 'snack', title: 'Skyr mit Beeren', kcal: 140, protein: 18, tags: ['proteinreich', 'vegetarisch', 'schnell'], ingredients: ['150 g Skyr', '100 g Beeren'] },
  { category: 'snack', title: 'Handvoll Mandeln & Apfel', kcal: 250, protein: 6, tags: ['vegetarisch', 'unterwegs'], ingredients: ['30 g Mandeln', '1 Apfel'] },
  { category: 'snack', title: 'Protein-Shake mit Banane', kcal: 380, protein: 31, tags: ['proteinreich', 'nach-dem-training'], ingredients: ['30 g Proteinpulver', '250 ml Milch', '1 Banane'] },
  { category: 'snack', title: 'Hüttenkäse auf Knäckebrot', kcal: 220, protein: 20, tags: ['proteinreich', 'vegetarisch'], ingredients: ['150 g Hüttenkäse', '2 Scheiben Knäckebrot'] },
  { category: 'snack', title: 'Energy Balls', kcal: 320, protein: 8, tags: ['vegan', 'vegetarisch', 'unterwegs'], ingredients: ['40 g Datteln', '30 g Haferflocken', '15 g Mandeln', '1 TL Kakao'] },
  { category: 'snack', title: 'Gemüsesticks mit Hummus', kcal: 310, protein: 9, tags: ['vegan', 'vegetarisch', 'low-carb'], ingredients: ['100 g Hummus', '1 Karotte', '1 Paprika'] },
  { category: 'snack', title: 'Reiswaffeln mit Frischkäse', kcal: 180, protein: 4, tags: ['vegetarisch', 'schnell'], ingredients: ['2 Reiswaffeln', '50 g Frischkäse'] },
  { category: 'snack', title: 'Beeren-Quark', kcal: 180, protein: 25, tags: ['proteinreich', 'vegetarisch', 'low-carb'], ingredients: ['200 g Magerquark', '100 g Beeren'] },
  { category: 'snack', title: 'Studentenfutter', kcal: 290, protein: 9, tags: ['vegetarisch', 'unterwegs'], ingredients: ['25 g Mandeln', '15 g Cashews', '20 g Rosinen'] },
  { category: 'snack', title: 'Banane mit Erdnussbutter', kcal: 230, protein: 6, tags: ['vegetarisch', 'vor-dem-training', 'schnell'], ingredients: ['1 Banane', '20 g Erdnussbutter'] },
  { category: 'snack', title: 'Edamame mit Meersalz', kcal: 180, protein: 17, tags: ['vegan', 'proteinreich', 'low-carb'], ingredients: ['150 g Edamame', '1 Prise Meersalz'] },
  { category: 'snack', title: 'Hüttenkäse mit Ananas', kcal: 200, protein: 19, tags: ['proteinreich', 'vegetarisch', 'schnell'], ingredients: ['150 g Hüttenkäse', '100 g Ananas'] },
];

/* --------------------------- Vorlieben-Lernen --------------------------- */
/** Gewichtet Tags nach Favorit-Status und Koch-Häufigkeit. */
function preferredTags(meals) {
  const score = {};
  meals.forEach((m) => {
    const w = (m.favorite ? 3 : 0) + (m.cookedCount || 0);
    if (w <= 0) return;
    (m.tags || []).forEach((tag) => { score[tag] = (score[tag] || 0) + w; });
  });
  return Object.entries(score).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

/** Empfiehlt Nicht-Favoriten mit passenden Lieblings-Tags. */
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

/** Sortierung innerhalb einer Kategorie: Favoriten zuerst, dann häufig gekocht. */
function byPreference(a, b) {
  return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.cookedCount || 0) - (a.cookedCount || 0) || a.title.localeCompare(b.title);
}

/* -------------------------------- Render -------------------------------- */
export function render(view) {
  setHeader({ title: t('nav.nutrition'), actions: [{ icon: 'plus', label: t('nutrition.add'), onClick: () => openMealForm() }] });

  if (store.settings().modules?.nutrition === false) { view.appendChild(moduleOff(t('nav.nutrition'))); return; }

  const meals = store.get('nutrition');
  if (!meals.length) {
    // Neuer Nutzer: KEIN stiller „leer“-Zustand – Rezept-Katalog laden oder eigenes Gericht anlegen.
    view.appendChild(emptyState('utensils', t('nutrition.emptyTitle'), t('nutrition.emptyText')));
    view.appendChild(el('button', { class: 'btn btn--primary btn--block mt-3', onclick: () => addSuggestions(SUGGESTED_MEALS) }, [
      icon('plus'), t('nutrition.loadIdeas', { n: SUGGESTED_MEALS.length }),
    ]));
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => openMealForm() }, [
      icon('plus'), t('nutrition.addOwn'),
    ]));
    return;
  }

  // Kalorienbilanz heute (#23)
  view.appendChild(balanceCard());

  view.appendChild(el('div', { class: 'card card--flat row gap-2', style: { alignItems: 'flex-start' } }, [
    el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', width: '18px', flex: '0 0 auto' } }),
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text: t('nutrition.learnHint') }),
  ]));

  // Lieblingsgerichte
  const favs = meals.filter((m) => m.favorite).sort(byPreference);
  if (favs.length) {
    view.appendChild(sectionHead(t('nutrition.favourites')));
    favs.forEach((m) => view.appendChild(mealCard(m)));
  }

  // Für dich (gelernt aus Vorlieben)
  const recs = recommendations(meals);
  if (recs.length) {
    view.appendChild(sectionHead(t('nutrition.recommended')));
    recs.forEach((m) => view.appendChild(mealCard(m, true)));
  }

  // Nach Kategorie
  CATS.forEach((c) => {
    const list = meals.filter((m) => m.category === c.key && !m.favorite).sort(byPreference);
    if (!list.length) return;
    view.appendChild(sectionHead(c.label));
    list.forEach((m) => view.appendChild(mealCard(m)));
  });

  // Mehr Rezeptvielfalt für die 7-Tage-Planung (#25)
  const fresh = SUGGESTED_MEALS.filter((s) => !meals.some((m) => m.title.toLowerCase() === s.title.toLowerCase()));
  if (fresh.length) {
    view.appendChild(el('button', { class: 'btn btn--soft btn--block mt-4', onclick: () => addSuggestions(fresh) }, [
      icon('plus'), tp('nutrition.addIdeas', fresh.length),
    ]));
  }
}

/** Übernimmt noch nicht vorhandene Vorschlagsrezepte in den eigenen Bestand (#25). */
function addSuggestions(fresh) {
  fresh.forEach((s) => store.upsert('nutrition', { ...s, id: uid('n') }));
  toast(tp('nutrition.ideasAdded', fresh.length), 'good');
  rerender();
}

/** Kalorienbilanz-Karte: verbraucht vs. eingenommen + Empfehlung (#23). Rechnet über
    `currentEnergyTargets` – dieselbe Quelle wie das Ziel-Cockpit auf „Heute“. */
function balanceCard() {
  const today = todayStr();
  const tg = currentEnergyTargets(today);
  const elig = tg.elig;
  const hide = elig.hideNumbers;

  // Kinder- und Jugendprofil: keine Kalorien- oder Gewichtsziele, keine Zahlen.
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
  // Ohne beantwortete Abgrenzung kein Tagesziel (Schwangerschaft/Essstörung wären sonst unbekannt).
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

/** Labor-Modul für die eigene Sicht aktiv? (Link zur Energieversorgung) */
function labsEnabledHere() { return !store.isManaging() && store.settings().modules?.labs !== false; }

/** „Heute gegessen“: die Ess-Tagebuch-Einträge des Tages, einzeln löschbar – plus der
    Tagesmarker „vollständig erfasst“, über den die Energieversorgung bewertet wird. */
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

/** Freitext „200 g Skyr, 1 Banane“ → Zutatenliste für die Nährwertschätzung. */
export function splitFoods(text) {
  return String(text || '').split(/[,;+\n]|\s+und\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Gegessenes schnell erfassen (UI-26): Lebensmittel mit Menge – geschätzt aus der
 * Nährwerttabelle –, „zuletzt gegessen“ mit einem Tipp oder pauschal nach Portionsgröße
 * (auswärts, #26). Vorher gab es nur die Pauschalportionen (± 200 kcal je Snack).
 */
/**
 * Bereich „Barcode“: Strichcode eintippen (oder, wo der Browser es kann, mit der Kamera
 * lesen), Produkt nachschlagen, Menge in Gramm – daraus kcal und Eiweiß.
 * Liefert { node, result(), stopCamera() }.
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
    // Derselbe Schalter wie für alle Abfragen bei Open Food Facts – ohne ihn geht nichts hinaus.
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
  // Kamera nur, wenn der Browser Strichcodes selbst erkennt – ohne Zusatzbibliothek.
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

  // Lebensmittel + Menge
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
  // Zuletzt gegessen: die letzten sechs verschiedenen Einträge, ein Tipp trägt sie für heute ein.
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

  // Pauschal nach Portionsgröße – für auswärts
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

  // Strichcode: Produkt über Open Food Facts nachschlagen (über den eigenen Server), Menge in Gramm.
  const bc = barcodePane(hide);
  const host = el('div', {}, [foodPane]);
  const modeCtl = segmented([{ value: 'food', label: t('nutrition.modeFood') }, { value: 'barcode', label: t('nutrition.modeBarcode') }, { value: 'portion', label: t('nutrition.modeOut') }], mode,
    (v) => { mode = v; bc.stopCamera(); host.innerHTML = ''; host.appendChild(v === 'food' ? foodPane : v === 'barcode' ? bc.node : portionPane); }, { label: t('nutrition.modeLabel') });
  openSheet({
    title: t('nutrition.logEaten'),
    body: el('div', {}, [el('div', { class: 'mb-3' }, [modeCtl]), host]),
    onClose: () => bc.stopCamera(),   // Kamera nie weiterlaufen lassen
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
  // Eine Portion gekocht: Zähler hoch, Wochenplan runter, Zutaten aus dem Lager buchen.
  store.patch('nutrition', m.id, {
    cookedCount: (m.cookedCount || 0) + 1,
    lastCooked: todayStr(),
    plannedServings: Math.max(0, (m.plannedServings || 0) - 1),
  });
  // Gekochte Portion ins Ess-Tagebuch (für die Kalorienbilanz), wenn kcal bekannt.
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

  // kcal-Feld mit Schätzhilfe aus den Zutaten (#26)
  const kcalField = el('div', { class: 'row gap-2', style: { alignItems: 'center' } }, [
    el('div', { class: 'grow' }, kcalI),
    el('button', {
      class: 'btn btn--soft', type: 'button', title: t('nutrition.estimateTitle'),
      onclick: async (e) => {
        const list = ingI.value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!list.length) { toast(t('nutrition.addIngredientsFirst'), 'bad'); return; }
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = t('nutrition.estimating');
        // Echte Nährwerte je Zutat von Open Food Facts holen (nur wenn aktiviert).
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

// Neu zeichnen über den Router (Scrollposition bleibt, auch wenn das Formular von
// einer anderen Ansicht aus geöffnet wurde); ohne App-Shell (Tests) direkt.
function rerender() { rerenderView(render); }

export function moduleOff(name) {
  return el('div', { class: 'empty', style: { paddingTop: '60px' } }, [
    el('div', { class: 'empty__icon', html: iconSvg('settings') }),
    el('div', { class: 'empty__title', text: t('nutrition.moduleOff', { name }) }),
    el('div', { class: 'muted', text: t('nutrition.moduleOffHint') }),
    el('button', { class: 'btn btn--soft mt-4', onclick: () => navigate('#/settings'), text: t('nutrition.toSettings') }),
  ]);
}
