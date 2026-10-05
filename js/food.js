/* =========================================================================
   food.js — quantity engine for the week-based shopping list with pantry stock.

   Deliberately WITHOUT any store/DOM dependency (pure functions), which makes
   it easy to unit-test in Node. The callers (shopping.js, nutrition.js) pass
   the data in.

   Flow: weekly meal plan (planned dishes × servings) -> parse and aggregate
   the ingredients (demand) -> shopping list = demand − pantry stock.
   ========================================================================= */

import { has, locale, t, tp } from './i18n.js';
import { fmtDec } from './format.js';

/** Known units -> canonical form (de/en; further languages see below). */
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
  rebanada: 'Scheibe', rebanadas: 'Scheibe', loncha: 'Scheibe', lonchas: 'Scheibe', rodaja: 'Scheibe', rodajas: 'Scheibe', lata: 'Dose', latas: 'Dose',
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
  plakje: 'Scheibe', plakjes: 'Scheibe', schijf: 'Scheibe', schijven: 'Scheibe', schijfje: 'Scheibe', schijfjes: 'Scheibe', blik: 'Dose', blikken: 'Dose', blikje: 'Dose', blikjes: 'Dose',
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

/** "1/2", "1 1/2", "250", "1,5" -> number (or null). */
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

  // Multi-word units (“c. à s.”, “colher de sopa”) come before the one-word token.
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
    // Not a known unit word -> it belongs to the name (e.g. “Eier”, “Avocado”).
    // A hyphen or apostrophe right behind the first word belongs to the name (“batata-doce”, “pomme-de-terre”).
    name = (m[2] + (name ? (/^[-'’]/.test(rest.slice(m[2].length)) ? '' : ' ') + name : '')).trim();
    unit = amount != null ? 'Stück' : null;
  } else {
    unit = amount != null ? 'Stück' : null;
  }
  if (!name) name = s;
  return { name: name.replace(/\s+/g, ' ').trim(), amount: amt, unit, raw: s };
}

/** Name as the keyword tables see it: lower case, typographic apostrophe, œ/æ spelled out. */
export const fold = (s) => String(s).toLowerCase().replace(/'/g, '’').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
// Whole word (compounds do not count): “Ei” is not in “Reiswaffel”. JS \b knows no umlauts or accents, hence our own
// boundaries.
const wordRes = new Map();
function wordRe(k) {
  let re = wordRes.get(k);
  if (!re) wordRes.set(k, re = new RegExp(`(^|[^\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u'));
  return re;
}
/** Is `w` a whole word of the (folded) name? The cheap includes() runs first, the regex only when it passes. */
export const wordIn = (name, w) => name.includes(w) && wordRe(w).test(name);
/** Does the (folded) name contain the keyword? A plain keyword also counts inside a longer word (“hähnchen” in
    “Hähnchenbrust”); a leading “=” demands a whole word (“=riz” is not in “chorizo”). */
export function keywordIn(name, k) {
  return k.charCodeAt(0) === 61 ? wordIn(name, k.slice(1)) : name.includes(k);
}

// Category values stay German (stored in the pantry). The other languages' keywords follow the German and English ones
// (one line per language: fr, es, it, pt-BR, nl); a keyword with a leading "=" must stand alone as a word, like “=ei”.
// 'eggplant'/'veggie' come first so the dairy keyword 'egg' does not catch them.
const CAT_KW = [
  // Exceptions first: names that contain a keyword of a later row but are not that kind of food (like German “Cashews”).
  ['Sonstiges', [
    /* fr */ '=noix de cajou', '=noix de coco', '=noix de muscade', '=noix de pécan',
    /* es */ '=nuez moscada', '=nuez de coco',
    /* it */ '=noce moscata', '=noce di cocco',
    /* pt-BR */ '=noz-moscada', '=noz moscada', '=noz de coco', '=massa de pizza', '=massa para pizza',
    /* nl */ '=griesmeel', '=gries',
  ]],
  ['Obst & Gemüse', ['tomate', 'avocado', 'brokkoli', 'paprika', 'spinat', 'beere', 'banane', 'süßkartoffel', 'bohne', 'zitrone', 'salat', 'apfel', 'zwiebel', 'knoblauch', 'gemüse', 'obst', 'kartoffel', 'ananas',
    'pineapple', 'tomato', 'broccoli', 'pepper', 'spinach', 'berry', 'berries', 'banana', 'sweet potato', 'bean', 'lemon', 'salad', 'lettuce', 'apple', 'onion', 'garlic', 'vegetable', 'veggie', 'eggplant', 'fruit', 'potato',
    /* fr */ '=avocat', '=avocats', '=brocoli', '=brocolis', '=poivron', '=poivrons', '=épinard', '=épinards', '=baie', '=baies', '=fraise',
    '=fraises', '=framboise', '=framboises', '=myrtille', '=myrtilles', '=mûre', '=mûres', '=patate douce', '=patates douces', '=haricot',
    '=haricots', '=citron', '=citrons', '=laitue', '=laitues', '=pomme', '=oignon', '=oignons', '=ail', '=légume', '=légumes',
    '=pomme de terre', '=pommes de terre', '=patate', '=patates',
    /* es */ '=aguacate', '=aguacates', '=palta', '=paltas', '=brócoli', '=brocoli', '=brécol', '=pimiento', '=pimientos', '=espinaca',
    '=espinacas', '=fruto rojo', '=frutos rojos', '=baya', '=bayas', '=frutos del bosque', '=fresa', '=fresas', '=frambuesa', '=frambuesas',
    '=arándano', '=arándanos', '=mora', '=moras', '=plátano', '=plátanos', '=platano', '=platanos', '=banano', '=boniato', '=boniatos',
    '=camote', '=camotes', '=judía', '=judías', '=alubia', '=alubias', '=frijol', '=frijoles', '=limón', '=limon', '=limones', '=lechuga',
    '=lechugas', '=manzana', '=manzanas', '=cebolla', '=cebollas', '=ajo', '=ajos', '=verdura', '=verduras', '=hortaliza', '=hortalizas',
    '=vegetal', '=vegetales', '=fruta', '=frutas', '=patata', '=patatas', '=papa', '=papas', '=piña', '=piñas',
    /* it */ '=pomodoro', '=pomodori', '=broccolo', '=broccoletti', '=peperone', '=peperoni', '=spinaci', '=frutti di bosco',
    '=frutto di bosco', '=bacca', '=bacche', '=fragola', '=fragole', '=lampone', '=lamponi', '=mirtillo', '=mirtilli', '=patata dolce',
    '=patate dolci', '=patata americana', '=patate americane', '=fagiolo', '=fagioli', '=limone', '=limoni', '=lattuga', '=mela', '=mele',
    '=cipolla', '=cipolle', '=aglio', '=verdura', '=verdure', '=ortaggi', '=ortaggio', '=frutta', '=patata', '=patate',
    /* pt-BR */ '=abacate', '=abacates', '=brócolis', '=brócoli', '=brocolis', '=pimentão', '=pimentao', '=pimentões', '=pimentoes',
    '=pimento', '=pimentos', '=espinafre', '=espinafres', '=fruta vermelha', '=frutas vermelhas', '=frutos vermelhos', '=frutas silvestres',
    '=frutos silvestres', '=morango', '=morangos', '=framboesa', '=framboesas', '=mirtilo', '=mirtilos', '=amora', '=amoras', '=batata-doce',
    '=batatas-doces', '=batata doce', '=batatas doces', '=feijão', '=feijao', '=feijões', '=feijoes', '=limão', '=limao', '=limões',
    '=alface', '=alfaces', '=maçã', '=maçãs', '=maca', '=macas', '=cebola', '=cebolas', '=alho', '=alhos', '=legume', '=legumes', '=verdura',
    '=verduras', '=hortaliça', '=hortaliças', '=fruta', '=frutas', '=batata', '=batatas', '=abacaxi', '=abacaxis',
    /* nl */ '=tomaat', 'spinazie', '=bes', '=bessen', '=bosvruchten', '=bosvrucht', '=rode vruchten', '=aardbei', '=aardbeien', '=framboos',
    '=frambozen', '=braam', '=bramen', '=blauwe bes', '=blauwe bessen', '=banaan', '=bataat', '=bataten', '=boon', '=boontjes', 'bonen',
    '=citroen', '=citroenen', '=sla', '=kropsla', '=ijsbergsla', '=appel', '=appels', '=ui', '=uien', 'knoflook', 'groente', 'aardappel',
  ]],
  ['Milchprodukte', ['skyr', 'quark', 'joghurt', 'milch', 'feta', 'käse', 'butter', 'sahne', '=ei', 'eier', 'eigelb', 'eiklar', '=eiweiß', 'rührei', 'spiegelei', 'hühnerei', 'wachtelei', 'eipulver', 'eiscreme',
    'yoghurt', 'yogurt', 'milk', 'cheese', 'cream', 'egg',
    /* fr */ '=fromage blanc', '=yaourt', '=yaourts', '=yogourt', '=yogourts', '=lait', '=laits', '=fromage', '=fromages', '=beurre',
    '=crème', '=crèmes', '=creme', '=oeuf', '=oeufs', '=beurre de cacahuète', '=beurre de cacahuete', '=beurre d’amande',
    '=beurre d’arachide', '=purée d’amande', '=purée de cacahuète', '=lait d’avoine', '=boisson à l’avoine', '=boisson d’avoine',
    '=boisson végétale à l’avoine', '=lait d’amande', '=boisson à l’amande', '=boisson d’amande', '=lait de coco', '=babeurre',
    /* es */ '=queso batido', '=queso fresco batido', '=yogur', '=yogures', '=leche', '=queso', '=quesos', '=mantequilla', '=nata',
    '=crema de leche', '=crema fresca', '=nata para cocinar', '=nata líquida', '=nata montada', '=huevo', '=huevos', '=crema de cacahuete',
    '=mantequilla de cacahuete', '=mantequilla de almendra', '=crema de almendras', '=crema de cacahuate', '=mantequilla de cacahuate',
    '=bebida de avena', '=leche de avena', '=leche de almendra', '=leche de almendras', '=bebida de almendra', '=bebida de almendras',
    '=leche de coco', '=suero de mantequilla', '=suero de leche', '=mazada',
    /* it */ '=latte', '=formaggio', '=formaggi', '=burro', '=panna', '=uovo', '=uova', '=burro di arachidi', '=burro di mandorle',
    '=crema di arachidi', '=burro di noci', '=latte d’avena', '=bevanda all’avena', '=bevanda di avena', '=latte di mandorla',
    '=latte di mandorle', '=bevanda alla mandorla', '=latte di cocco', '=latticello',
    /* pt-BR */ '=iogurte', '=iogurtes', '=leite', '=queijo', '=queijos', '=manteiga', '=creme de leite', '=nata', '=creme culinário', '=ovo',
    '=ovos', '=pasta de amendoim', '=manteiga de amendoim', '=pasta de amêndoa', '=manteiga de amêndoa', '=pasta de castanha',
    '=bebida de aveia', '=leite de aveia', '=leite de amêndoa', '=leite de amêndoas', '=bebida de amêndoa', '=leite de coco', '=leitelho',
    '=soro de leite',
    /* nl */ 'kwark', '=melk', 'kaas', '=boter', 'roomboter', 'slagroom', 'kookroom', '=eitje', '=eitjes', '=pindaboter', '=notenpasta',
    '=amandelpasta', '=amandelboter', '=havermelk', '=haverdrink', '=amandelmelk', '=amandeldrink', '=kokosmelk', '=karnemelk',
  ]],
  ['Fleisch & Fisch', ['hähnchen', 'lachs', 'fisch', 'rind', 'pute', 'thunfisch', 'hack',
    'chicken', 'salmon', 'fish', 'beef', 'turkey', 'tuna', 'mince',
    /* fr */ '=poulet', '=poulets', '=volaille', '=volailles', '=poule', '=saumon', '=saumons', '=poisson', '=poissons', '=boeuf', '=bovin',
    '=veau', '=dinde', '=dindes', '=thon', '=thons', '=viande hachée', '=hachis', '=steak haché', '=boeuf haché',
    /* es */ '=pollo', '=pollos', '=gallina', '=salmón', '=pescado', '=pescados', '=ternera', '=vacuno', '=buey', '=carne de res', '=pavo',
    '=atún', '=atun', '=carne picada', '=carne molida', '=carne de res picada',
    /* it */ '=pollo', '=petto di pollo', '=pesce', '=pesci', '=manzo', '=bovino', '=vitello', '=carne di manzo', '=tacchino',
    '=petto di tacchino', '=tonno', '=carne macinata', '=macinato', '=carne tritata',
    /* pt-BR */ '=frango', '=frangos', '=galinha', '=salmão', '=salmao', '=peixe', '=peixes', '=carne bovina', '=bovino', '=carne de boi',
    '=carne de vaca', '=peru', '=atum', '=carne moída', '=carne moida', '=carne picada', '=patinho moído',
    /* nl */ '=kip', 'kipfilet', 'kippenborst', 'kippendij', 'kippenvlees', 'zalm', '=vis', '=vissen', 'rundvlees', '=runderlappen',
    '=biefstuk', '=ossenhaas', 'kalkoen', 'tonijn', '=gehakt', 'rundergehakt', 'varkensgehakt', 'kipgehakt', 'gehaktbal',
  ]],
  ['Trockenwaren', ['haferflocken', 'quinoa', 'reis', 'linse', 'nudel', 'mehl', 'honig', 'kakao', 'protein', 'brot', 'mandel', 'walnuss', 'eiweißpulver',
    'oats', 'rice', 'lentil', 'noodle', 'pasta', 'flour', 'honey', 'cocoa', 'bread', 'almond', 'walnut',
    /* fr */ '=flocons d’avoine', '=riz', '=pâtes', '=nouilles', '=farine', '=farines', '=miel', '=cacao', '=protéine', '=protéines', '=pain',
    '=pains', '=amande', '=amandes', '=noix', '=poudre de protéines', '=poudre de protéine', '=protéines en poudre', '=protéine en poudre',
    '=poudre protéinée', '=pain suédois', '=pain croustillant', '=pain scandinave', '=cracotte', '=cracottes', '=biscotte', '=biscottes',
    '=pain pita', '=pains pita', '=pita', '=pitas', '=pain plat', '=pains plats', '=naan', '=naans', '=pain complet', '=pain intégral',
    '=pain integral', '=pain aux céréales',
    /* es */ '=copos de avena', '=quinua', '=arroz', '=lenteja', '=lentejas', '=fideos', '=espaguetis', '=espagueti', '=macarrones',
    '=tallarines', '=harina', '=harinas', '=miel', '=cacao', '=proteína', '=proteínas', '=pan', '=panes', '=almendra', '=almendras', '=nuez',
    '=nueces', '=proteína en polvo', '=proteínas en polvo', '=polvo de proteína', '=polvo de proteínas', '=pan crujiente', '=pan sueco',
    '=pan plano', '=panes planos', '=pan de pita', '=pan pita', '=pita', '=pitas', '=naan', '=pan integral', '=pan de cereales',
    /* it */ '=fiocchi d’avena', '=riso', '=lenticchie', '=tagliatelle', '=penne', '=fusilli', '=maccheroni', '=tagliolini', '=vermicelli',
    '=farina', '=farine', '=miele', '=cacao', '=pane', '=pani', '=mandorla', '=mandorle', '=noce', '=noci', '=polvere proteica',
    '=pane croccante', '=pane svedese', '=pane pita', '=pita', '=pane arabo', '=naan', '=pane integrale', '=pane ai cereali',
    /* pt-BR */ '=flocos de aveia', '=aveia em flocos', '=arroz', '=macarrão', '=massa', '=massas', '=espaguete', '=macarrões', '=farinha',
    '=farinhas', '=mel', '=cacau', '=cacau em pó', '=proteína', '=proteínas', '=pão', '=pães', '=pao', '=amêndoa', '=amêndoas', '=amendoa',
    '=amendoas', '=noz', '=nozes', '=proteína em pó', '=proteínas em pó', '=pão crocante', '=pão sueco', '=pão sírio', '=pão sirio',
    '=pão árabe', '=pão pita', '=pita', '=naan', '=pão integral', '=pão de grãos',
    /* nl */ '=havermout', '=havervlokken', '=haver', 'rijst', '=linze', '=linzen', '=noedels', '=macaroni', '=penne', '=vermicelli',
    '=tagliatelle', '=bloem', 'meel', '=tarwebloem', 'honing', '=cacao', '=cacaopoeder', '=eiwit', '=eiwitten', '=proteïne', '=proteïnen',
    'brood', '=walnoot', '=walnoten', '=eiwitpoeder', '=proteïnepoeder', '=wei-eiwit', '=knäckebröd', '=knackebrod', '=beschuit',
    '=beschuiten', '=pita', '=naan',
  ]],
];
export function guessCategory(name) {
  const n = fold(name);
  for (const [cat, kws] of CAT_KW) if (kws.some((k) => keywordIn(n, k))) return cat;
  return 'Sonstiges';
}

/**
 * Aggregates the weekly demand from planned dishes.
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

/** Deterministic, mergeable ID of a pantry/ingredient entry. */
export function itemKey(name, unit) {
  return 'pty-' + String(name).toLowerCase().replace(/[^a-z0-9äöü]+/g, '-').replace(/^-|-$/g, '') + '-' + (unit || 'x');
}

/** Shopping list = demand − pantry stock. */
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

/** Pantry stock after a purchase (adds the bought quantities). */
export function applyPurchase(pantry, bought) {
  const next = (pantry || []).map((p) => ({ ...p }));
  (bought || []).forEach((b) => {
    if (b.buy == null) return; // “as needed” items are not booked by quantity
    const ex = next.find((p) => sameItem(p, b));
    if (ex) ex.amount = (ex.amount || 0) + b.buy;
    else next.push({ id: itemKey(b.name, b.unit), name: b.name, unit: b.unit, amount: b.buy, category: b.category });
  });
  return next;
}

/** Pantry stock after cooking (consumes the ingredients, never below 0). */
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

/** Next shopping day (weekday: 0=Sun..6=Sat) from fromDate on (default today). */
export function nextShoppingDay(weekday, fromDateStr) {
  const from = fromDateStr ? new Date(fromDateStr + 'T12:00:00') : new Date();
  const add = ((weekday - from.getDay()) % 7 + 7) % 7;
  const d = new Date(from);
  d.setDate(d.getDate() + add);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Quantity + unit as text: “500 g”, “3×”, “as needed”. */
export function fmtAmount(amount, unit) {
  if (amount == null) return t('food.asNeeded');
  const a = Math.round(amount * 100) / 100;
  if (unit === 'Stück') return `${fmtDec(a)}×`;
  return `${fmtDec(a)}${unit ? ' ' + unitLabel(unit, a) : ''}`;
}

/** Display name of a unit; the stored value stays the canonical (German) one. Unknown units are left as they are. */
const UNIT_ID = { g: 'g', ml: 'ml', EL: 'tbsp', TL: 'tsp', Prise: 'pinch', Bund: 'bunch', Zehe: 'clove', Stück: 'piece', Scheibe: 'slice', Dose: 'can', Packung: 'pack', Becher: 'pot', Glas: 'jar' };
export function unitLabel(unit, amount = 1) {
  const id = Object.hasOwn(UNIT_ID, unit) ? UNIT_ID[unit] : null;
  return id && has(`food.unit.${id}.other`) ? tp(`food.unit.${id}`, amount) : unit;
}
