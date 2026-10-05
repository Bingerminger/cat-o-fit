/* =========================================================================
   food.js — Mengen-Engine für die wochenbasierte Einkaufsliste mit Lager.

   Bewusst OHNE Store-/DOM-Abhängigkeit (reine Funktionen) – dadurch in Node
   leicht unit-testbar. Die Aufrufer (shopping.js, nutrition.js) reichen die
   Daten herein.

   Ablauf: Wochen-Speiseplan (geplante Gerichte × Portionen) -> Zutaten parsen
   und aggregieren (Bedarf) -> Einkaufsliste = Bedarf − Lagerbestand.
   ========================================================================= */

import { has, locale, t, tp } from './i18n.js';
import { fmtDec } from './format.js';

/** Bekannte Einheiten -> kanonische Form (de/en; weitere Sprachen siehe unten). */
const UNIT_CANON = {
  g: 'g', gramm: 'g', gr: 'g', kg: 'g',
  ml: 'ml', l: 'ml', liter: 'ml',
  el: 'EL', tl: 'TL', prise: 'Prise', bund: 'Bund', zehe: 'Zehe', zehen: 'Zehe',
  stück: 'Stück', stk: 'Stück', scheibe: 'Scheibe', scheiben: 'Scheibe',
  dose: 'Dose', dosen: 'Dose', packung: 'Packung', becher: 'Becher', glas: 'Glas',
  // English unit words -> the same canonical (stored) codes.
  gram: 'g', grams: 'g', kilogram: 'g', kilograms: 'g',
  litre: 'ml', litres: 'ml', liters: 'ml',
  tbsp: 'EL', tablespoon: 'EL', tablespoons: 'EL', tsp: 'TL', teaspoon: 'TL', teaspoons: 'TL',
  pinch: 'Prise', pinches: 'Prise', bunch: 'Bund', bunches: 'Bund', clove: 'Zehe', cloves: 'Zehe',
  piece: 'Stück', pieces: 'Stück', pc: 'Stück', pcs: 'Stück', slice: 'Scheibe', slices: 'Scheibe',
  can: 'Dose', cans: 'Dose', tin: 'Dose', tins: 'Dose', pack: 'Packung', packs: 'Packung',
  packet: 'Packung', packets: 'Packung', pot: 'Becher', pots: 'Becher', tub: 'Becher', tubs: 'Becher',
  jar: 'Glas', jars: 'Glas',
  // French (“pot”/“pots”: see English; “c. à s.” & co. are in UNIT_PHRASES)
  càs: 'EL', càc: 'TL', pincée: 'Prise', pincées: 'Prise', botte: 'Bund', bottes: 'Bund', gousse: 'Zehe', gousses: 'Zehe',
  pièce: 'Stück', pièces: 'Stück', tranche: 'Scheibe', tranches: 'Scheibe', boîte: 'Dose', boîtes: 'Dose', boite: 'Dose', boites: 'Dose',
  paquet: 'Packung', paquets: 'Packung', bocal: 'Glas', bocaux: 'Glas', gramme: 'g', grammes: 'g',
  // Spanish
  cda: 'EL', cdas: 'EL', cucharada: 'EL', cucharadas: 'EL', cdta: 'TL', cdtas: 'TL', cucharadita: 'TL', cucharaditas: 'TL',
  pizca: 'Prise', pizcas: 'Prise', manojo: 'Bund', manojos: 'Bund', diente: 'Zehe', dientes: 'Zehe',
  pieza: 'Stück', piezas: 'Stück', ud: 'Stück', uds: 'Stück', unidad: 'Stück', unidades: 'Stück',
  rebanada: 'Scheibe', rebanadas: 'Scheibe', loncha: 'Scheibe', lonchas: 'Scheibe', lata: 'Dose', latas: 'Dose',
  paquete: 'Packung', paquetes: 'Packung', tarrina: 'Becher', tarrinas: 'Becher', bote: 'Glas', botes: 'Glas',
  frasco: 'Glas', frascos: 'Glas', gramo: 'g', gramos: 'g',
  // Italian
  cucchiaio: 'EL', cucchiai: 'EL', cucchiaino: 'TL', cucchiaini: 'TL', pizzico: 'Prise', pizzichi: 'Prise',
  mazzetto: 'Bund', mazzetti: 'Bund', mazzo: 'Bund', mazzi: 'Bund', spicchio: 'Zehe', spicchi: 'Zehe',
  pezzo: 'Stück', pezzi: 'Stück', fetta: 'Scheibe', fette: 'Scheibe', scatola: 'Dose', scatole: 'Dose',
  lattina: 'Dose', lattine: 'Dose', confezione: 'Packung', confezioni: 'Packung', vasetto: 'Becher', vasetti: 'Becher',
  barattolo: 'Glas', barattoli: 'Glas', grammo: 'g', grammi: 'g',
  // Portuguese (Brazil; “lata”/“latas”/“unidades”: see Spanish)
  colher: 'EL', colheres: 'EL', colherinha: 'TL', colherinhas: 'TL', pitada: 'Prise', pitadas: 'Prise',
  maço: 'Bund', maços: 'Bund', dente: 'Zehe', dentes: 'Zehe', unidade: 'Stück', peça: 'Stück', peças: 'Stück',
  fatia: 'Scheibe', fatias: 'Scheibe', pacote: 'Packung', pacotes: 'Packung', pote: 'Becher', potes: 'Becher',
  vidro: 'Glas', vidros: 'Glas', grama: 'g', gramas: 'g',
  // Dutch (“el”/“tl”/“gram”: see German/English; “pot”/“potten” depend on the language, see LOCALE_UNITS)
  eetlepel: 'EL', eetlepels: 'EL', theelepel: 'TL', theelepels: 'TL', snuf: 'Prise', snufje: 'Prise', snufjes: 'Prise',
  mespunt: 'Prise', mespuntje: 'Prise', bos: 'Bund', bossen: 'Bund', bosje: 'Bund', bosjes: 'Bund',
  teen: 'Zehe', tenen: 'Zehe', teentje: 'Zehe', teentjes: 'Zehe', stuk: 'Stück', stuks: 'Stück', stukje: 'Stück', stukjes: 'Stück',
  snee: 'Scheibe', sneden: 'Scheibe', sneetje: 'Scheibe', sneetjes: 'Scheibe', plak: 'Scheibe', plakken: 'Scheibe',
  plakje: 'Scheibe', plakjes: 'Scheibe', blik: 'Dose', blikken: 'Dose', blikje: 'Dose', blikjes: 'Dose',
  pak: 'Packung', pakken: 'Packung', pakje: 'Packung', pakjes: 'Packung', verpakking: 'Packung', verpakkingen: 'Packung',
  bakje: 'Becher', bakjes: 'Becher', potje: 'Glas', potjes: 'Glas',
  // Metric words of the new languages (the stored unit stays g / ml)
  kilo: 'g', kilos: 'g', kilogramme: 'g', kilogrammes: 'g', kilogramo: 'g', kilogramos: 'g', chilo: 'g', chilogrammo: 'g',
  chilogrammi: 'g', quilo: 'g', quilos: 'g', quilograma: 'g', quilogramas: 'g',
  litro: 'ml', litros: 'ml', litri: 'ml', dl: 'ml', cl: 'ml',
};
const UNIT_FACTOR = {
  kg: 1000, l: 1000, liter: 1000, kilogram: 1000, kilograms: 1000, litre: 1000, litres: 1000, liters: 1000,   // -> g / ml
  kilo: 1000, kilos: 1000, kilogramme: 1000, kilogrammes: 1000, kilogramo: 1000, kilogramos: 1000, chilo: 1000,
  chilogrammo: 1000, chilogrammi: 1000, quilo: 1000, quilos: 1000, quilograma: 1000, quilogramas: 1000,
  litro: 1000, litros: 1000, litri: 1000, dl: 100, cl: 10,
};
// A jar in Dutch, a tub in French/English – the only unit word whose meaning depends on the language.
const LOCALE_UNITS = { nl: { pot: 'Glas', potten: 'Glas' } };
function unitWord(tok) {
  const loc = locale();
  if (Object.hasOwn(LOCALE_UNITS, loc) && Object.hasOwn(LOCALE_UNITS[loc], tok)) return LOCALE_UNITS[loc][tok];
  return Object.hasOwn(UNIT_CANON, tok) ? UNIT_CANON[tok] : null;
}
/** Multi-word / abbreviated unit phrases, tried before the one-word token. Spaces match any run of
    whitespace, a dot after a word is optional. */
const UNIT_PHRASES = [
  ['c. à s.', 'EL'], ['c. à soupe', 'EL'], ['cuillère à soupe', 'EL'], ['cuillères à soupe', 'EL'],
  ['c. à c.', 'TL'], ['c. à café', 'TL'], ['cuillère à café', 'TL'], ['cuillères à café', 'TL'],
  ['colher de sopa', 'EL'], ['colheres de sopa', 'EL'], ['colher de chá', 'TL'], ['colheres de chá', 'TL'],
  ['colher de café', 'TL'], ['colheres de café', 'TL'],
].map(([p, unit]) => [new RegExp(`^${p.split(' ').map((w) => w.replace(/\./g, '')).join('\\.?\\s*')}\\.?(?![\\p{L}])`, 'iu'), unit]);
// “200 g de poulet”, “1 cucchiaio d’olio”, “1 lata de atum”: the little word after a unit is not part of the name.
const PARTICLE = /^(?:de\s+(?:la\s+|l['’]\s*|los\s+|las\s+)?|d['’]\s*|di\s+|dell['’]\s*|do\s+|da\s+)(?=\p{L})/iu;

/** "1/2", "1 1/2", "250", "1,5" -> Zahl (oder null). */
export function parseAmount(str) {
  if (str == null) return null;
  str = String(str).trim().replace(',', '.');
  let m = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + (+m[2] / +m[3]);
  m = str.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  const n = parseFloat(str);
  return Number.isNaN(n) ? null : n;
}

/** "250 g Skyr" / "3 Eier" / "1/2 Avocado" / "Spinat" -> {name, amount, unit}. */
export function parseIngredient(raw) {
  const s = String(raw || '').trim();
  if (!s) return { name: '', amount: null, unit: null, raw: s };
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+[.,]?\d*)\s*(\p{L}+)?\.?\s*(.*)$/u);
  if (!m) return { name: s, amount: null, unit: null, raw: s };

  const amount = parseAmount(m[1]);
  const tok = (m[2] || '').toLowerCase();
  let name = (m[3] || '').trim();
  let unit = null;
  let amt = amount;

  // Mehrwort-Einheiten („c. à s.“, „colher de sopa“) vor dem Ein-Wort-Token.
  const rest = s.slice(m[1].length).trimStart();
  const phrase = UNIT_PHRASES.find(([re]) => re.test(rest));
  const known = tok ? unitWord(tok) : null;
  if (phrase) {
    unit = phrase[1];
    name = rest.replace(phrase[0], '').trim().replace(PARTICLE, '');
  } else if (known) {
    unit = known;
    if (Object.hasOwn(UNIT_FACTOR, tok)) amt = amount * UNIT_FACTOR[tok];
    name = name.replace(PARTICLE, '');
  } else if (tok) {
    // Kein bekanntes Einheitenwort -> gehört zum Namen (z. B. „Eier“, „Avocado“).
    name = (m[2] + (name ? ' ' + name : '')).trim();
    unit = amount != null ? 'Stück' : null;
  } else {
    unit = amount != null ? 'Stück' : null;
  }
  if (!name) name = s;
  return { name: name.replace(/\s+/g, ' ').trim(), amount: amt, unit, raw: s };
}

/** Name as the keyword tables see it: lower case, typographic apostrophe, œ/æ spelled out. */
export const fold = (s) => String(s).toLowerCase().replace(/'/g, '’').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
// Ganzes Wort (Zusammensetzungen am Wortanfang/-ende zählen nicht): „Ei“ ist nicht „Reiswaffel“. JS-\b kennt keine
// Umlaute, daher eigene Grenzen.
const wordRes = new Map();
export function wordRe(k) {
  let re = wordRes.get(k);
  if (!re) wordRes.set(k, re = new RegExp(`(^|[^\\p{L}])${k}($|[^\\p{L}])`, 'u'));
  return re;
}
/** Kommt das Stichwort im (gefalteten) Namen vor? Gewöhnliche Stichwörter zählen auch mitten im Wort („hähnchen“ in
    „Hähnchenbrust“); ein vorangestelltes „=“ verlangt ein ganzes Wort („=riz“ steckt nicht in „chorizo“). */
export function keywordIn(name, k) {
  return k.charCodeAt(0) === 61 ? wordRe(k.slice(1)).test(name) : name.includes(k);
}

// Category values stay German (stored in the pantry). The other languages' keywords follow the German and English ones
// (one line per language: fr, es, it, pt-BR, nl); a keyword with a leading "=" must stand alone as a word, like “=ei”.
// 'eggplant'/'veggie' come first so the dairy keyword 'egg' does not catch them.
const CAT_KW = [
  ['Obst & Gemüse', ['tomate', 'avocado', 'brokkoli', 'paprika', 'spinat', 'beere', 'banane', 'süßkartoffel', 'bohne', 'zitrone', 'salat', 'apfel', 'zwiebel', 'knoblauch', 'gemüse', 'obst', 'kartoffel',
    'tomato', 'broccoli', 'pepper', 'spinach', 'berry', 'berries', 'banana', 'sweet potato', 'bean', 'lemon', 'salad', 'lettuce', 'apple', 'onion', 'garlic', 'vegetable', 'veggie', 'eggplant', 'fruit', 'potato']],
  ['Milchprodukte', ['skyr', 'quark', 'joghurt', 'milch', 'feta', 'käse', 'butter', 'sahne', '=ei', 'eier', 'eigelb', 'eiklar', '=eiweiß', 'rührei', 'spiegelei', 'hühnerei', 'wachtelei',
    'yoghurt', 'yogurt', 'milk', 'cheese', 'cream', 'egg']],
  ['Fleisch & Fisch', ['hähnchen', 'lachs', 'fisch', 'rind', 'pute', 'thunfisch', 'hack',
    'chicken', 'salmon', 'fish', 'beef', 'turkey', 'tuna', 'mince']],
  ['Trockenwaren', ['haferflocken', 'quinoa', 'reis', 'linse', 'nudel', 'mehl', 'honig', 'kakao', 'protein', 'brot', 'mandel', 'walnuss', 'eiweißpulver',
    'oats', 'rice', 'lentil', 'noodle', 'pasta', 'flour', 'honey', 'cocoa', 'bread', 'almond', 'walnut']],
];
export function guessCategory(name) {
  const n = fold(name);
  for (const [cat, kws] of CAT_KW) if (kws.some((k) => keywordIn(n, k))) return cat;
  return 'Sonstiges';
}

/**
 * Aggregiert den Wochenbedarf aus geplanten Gerichten.
 * @param {Array<{ingredients:string[], servings:number}>} plannedMeals
 */
export function aggregateNeeds(plannedMeals) {
  const map = new Map();
  (plannedMeals || []).forEach(({ ingredients, servings }) => {
    const f = servings || 1;
    (ingredients || []).forEach((ing) => {
      const p = parseIngredient(ing);
      if (!p.name) return;
      const key = p.name.toLowerCase() + '|' + (p.unit || '?');
      const cur = map.get(key) || { name: p.name, unit: p.unit, amount: 0, hasAmount: false, category: guessCategory(p.name) };
      if (p.amount != null) { cur.amount += p.amount * f; cur.hasAmount = true; }
      map.set(key, cur);
    });
  });
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

const sameItem = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && (a.unit || '?') === (b.unit || '?');

/** Deterministische, mergebare ID eines Lager-/Zutat-Eintrags. */
export function itemKey(name, unit) {
  return 'pty-' + String(name).toLowerCase().replace(/[^a-z0-9äöü]+/g, '-').replace(/^-|-$/g, '') + '-' + (unit || 'x');
}

/** Einkaufsliste = Bedarf − Lagerbestand. */
export function computeShoppingList(needs, pantry) {
  const list = [];
  (needs || []).forEach((n) => {
    const stock = (pantry || []).find((p) => sameItem(p, n));
    const have = stock ? (stock.amount || 0) : 0;
    if (!n.hasAmount) {
      if (!stock) list.push({ name: n.name, unit: n.unit, category: n.category, buy: null, have: 0, need: null });
    } else {
      const buy = Math.max(0, Math.round((n.amount - have) * 100) / 100);
      if (buy > 0) list.push({ name: n.name, unit: n.unit, category: n.category, buy, have, need: n.amount });
    }
  });
  return list;
}

/** Lagerbestand nach einem Einkauf (gekaufte Mengen zubuchen). */
export function applyPurchase(pantry, bought) {
  const next = (pantry || []).map((p) => ({ ...p }));
  (bought || []).forEach((b) => {
    if (b.buy == null) return; // „nach Bedarf“ wird nicht mengenmäßig gebucht
    const ex = next.find((p) => sameItem(p, b));
    if (ex) ex.amount = (ex.amount || 0) + b.buy;
    else next.push({ id: itemKey(b.name, b.unit), name: b.name, unit: b.unit, amount: b.buy, category: b.category });
  });
  return next;
}

/** Lagerbestand nach dem Kochen (Zutaten verbrauchen, nicht unter 0). */
export function applyConsumption(pantry, ingredients, servings) {
  const next = (pantry || []).map((p) => ({ ...p }));
  const f = servings || 1;
  (ingredients || []).forEach((ing) => {
    const p = parseIngredient(ing);
    if (!p.name || p.amount == null) return;
    const ex = next.find((x) => sameItem(x, p));
    if (ex) ex.amount = Math.max(0, (ex.amount || 0) - p.amount * f);
  });
  return next.filter((p) => p.amount == null || p.amount > 0);
}

/** Nächster Einkaufstag (weekday: 0=So..6=Sa) ab fromDate (Default heute). */
export function nextShoppingDay(weekday, fromDateStr) {
  const from = fromDateStr ? new Date(fromDateStr + 'T12:00:00') : new Date();
  const add = ((weekday - from.getDay()) % 7 + 7) % 7;
  const d = new Date(from);
  d.setDate(d.getDate() + add);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Menge + Einheit als Text: „500 g“, „3 Stück“, „nach Bedarf“. */
export function fmtAmount(amount, unit) {
  if (amount == null) return t('food.asNeeded');
  const a = Math.round(amount * 100) / 100;
  if (unit === 'Stück') return `${fmtDec(a)}×`;
  return `${fmtDec(a)}${unit ? ' ' + unitLabel(unit, a) : ''}`;
}

/** Anzeigename einer Einheit; gespeichert bleibt der kanonische (deutsche) Wert. Unbekannte Einheiten bleiben, wie sie sind. */
const UNIT_ID = { g: 'g', ml: 'ml', EL: 'tbsp', TL: 'tsp', Prise: 'pinch', Bund: 'bunch', Zehe: 'clove', Stück: 'piece', Scheibe: 'slice', Dose: 'can', Packung: 'pack', Becher: 'pot', Glas: 'jar' };
export function unitLabel(unit, amount = 1) {
  const id = Object.hasOwn(UNIT_ID, unit) ? UNIT_ID[unit] : null;
  return id && has(`food.unit.${id}.other`) ? tp(`food.unit.${id}`, amount) : unit;
}
