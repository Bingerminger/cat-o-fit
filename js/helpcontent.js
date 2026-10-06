/* =========================================================================
   helpcontent.js — the in-app help as data (DOM-free). help.js renders it;
   tests check it against routes, handbook and UI. Every article has a stable
   id – addressable as #/hilfe/<id> and via the ⓘ buttons next to figures
   (infoButton in ui.js).

   The structure lives here: sections, articles and the kind of each block
   ('p' paragraph, 'steps' list, 'tip' hint, ['link', hash]). The texts live in
   the lazily loaded area 'help' (locales/<lang>/help.json): sections.<id>,
   articles.<id>.q / .aliases ("a|b", searchable, not shown) / .blocks.<index>.
   {hi} is ", <name>" (empty without a name), {name} the active person's name.
   Three blocks are built from labsources.js: 'labSources', 'labBestTip',
   'labStandards'. Call loadHelpTexts() before showing the help.
   ========================================================================= */

import { LAB_SOURCES, LAB_STANDARDS, inGermany } from './labsources.js';
import { t, tList, has, loadArea } from './i18n.js';

/** labsources.js marks terms with **…** – the help shows plain text. */
const plain = (s) => String(s).replace(/\*\*/g, '');

/** [sectionId, icon, [[articleId, [block kinds]]]] */
const STRUCTURE = [
  ['start', 'sparkles', [
    ['willkommen', ['p', 'p', 'tip']],
    ['aufbau', ['p', 'steps', ['link', '#/']]],
    ['anmelden', ['p', 'steps', 'tip', 'tip', 'p']],
  ]],
  ['usecases', 'target', [
    ['diagramme', ['p', 'steps', 'tip']],
    ['belastung-pruefen', ['p', 'steps', 'tip']],
    ['wettkampf-anlegen', ['steps', 'tip', 'p', ['link', '#/events']]],
    ['programm-starten', ['p', 'steps', 'tip', ['link', '#/events']]],
    ['training-durchfuehren', ['steps', 'tip']],
    ['training-nachtragen', ['p', 'steps', 'tip']],
    ['training-ohne-plan', ['p', 'steps', 'tip']],
    ['einheit-verschieben', ['p', 'steps', 'tip', ['link', '#/calendar']]],
    ['einheiten-anpassen', ['p', 'steps', 'tip', 'tip', 'tip', 'tip']],
    ['koerperwerte', ['steps', 'tip', 'tip', ['link', '#/health']]],
    ['apple-health', ['p', 'steps', 'tip', ['link', '#/import']]],
    ['health-connect', ['p', 'steps', 'tip', ['link', '#/import']]],
    ['erinnerungen', ['p', 'steps']],
    ['fortschritt', ['p', 'steps', ['link', '#/stats']]],
  ]],
  ['views', 'grid', [
    ['navigation', ['p']],
    ['heute', ['p', ['link', '#/']]],
    ['kalender', ['p', ['link', '#/calendar']]],
    ['ziele', ['p', ['link', '#/events']]],
    ['trainingsplan', ['p']],
    ['einheit-ansicht', ['p']],
    ['workout-modus', ['p']],
    ['fortschritt-koerper', ['p', ['link', '#/health']]],
    ['fortschritt-training', ['p', ['link', '#/stats']]],
    ['erfolge', ['p', ['link', '#/badges']]],
    ['uebungen', ['p', 'steps', 'p', ['link', '#/uebungen']]],
    ['durchgehend', ['p', 'steps', 'tip', ['link', '#/uebungen']]],
    ['laborwerte-woher', ['p', 'labSources', 'labBestTip', 'p']],
    ['referenzbereich', ['p', 'steps', 'p', 'p', 'labStandards']],
    ['labor', ['p', 'steps', 'tip', 'p', ['link', '#/labor']]],
    ['energieverfuegbarkeit', ['p', 'steps', 'tip', ['link', '#/labor']]],
    ['trendprojektion', ['steps', 'tip']],
    ['berichte', ['p', ['link', '#/reports']]],
    ['ernaehrung-einkauf', ['p']],
    ['einstellungen', ['p', ['link', '#/settings']]],
  ]],
  ['knowledge', 'info', [
    ['periodisierung', ['p', 'steps']],
    ['hf-zonen', ['p', 'steps', 'tip']],
    ['pace-bereiche', ['p']],
    ['rpe', ['p', 'steps', 'tip']],
    ['trainingslast', ['p', 'tip', 'tip']],
    ['vdot', ['p', 'p', 'steps', 'p', 'steps', 'tip']],
    ['trinkpausen', ['p', 'tip']],
    ['coach', ['p', 'steps', 'tip']],
    ['belastung-form', ['p', 'steps', 'tip']],
    ['belastungspunkte', ['p', 'steps', 'tip']],
    ['monotonie', ['p', 'steps', 'tip']],
    ['bereitschaft', ['p', 'steps', 'tip']],
    ['feste-termine', ['p', 'steps', 'tip']],
    ['erholungstag', ['p', 'steps', 'tip']],
    ['wochen-check', ['p', 'steps']],
    ['ziel-cockpit', ['p', 'steps', 'tip']],
    ['gesundheitsziel', ['p', 'steps', ['tip', '#/settings']]],
    ['momentum', ['p', 'p', 'steps', ['link', '#/badges']]],
    ['vorlieben', ['p', 'p']],
    ['kalorienbilanz', ['p', 'steps', 'tip', 'p']],
    ['eignung', ['p', 'steps', 'tip', ['link', '#/settings']]],
    ['einkaufsliste', ['p', 'steps', 'tip', ['link', '#/shopping']]],
    ['wetter', ['steps', 'tip']],
    ['zyklus', ['p', 'p', 'p', 'tip', ['link', '#/zyklus']]],
  ]],
  ['faq', 'bell', [
    ['offline', ['p']],
    ['datenschutz', ['steps', 'p', 'p', 'p']],
    ['familie', ['p', 'p', 'p', 'tip', 'tip', ['link', '#/family']]],
    ['teams', ['p', 'p', 'p', 'tip', 'tip', ['link', '#/familie-verwalten']]],
    ['erinnerungen-zuverlaessig', ['p']],
    ['kalender-abo', ['p', 'steps', 'p', 'p', 'p', 'p', 'tip', 'tip', 'tip', ['link', '#/events']]],
    ['module', ['p', 'steps', 'tip', ['link', '#/settings']]],
    ['backup', ['steps', 'tip', ['link', '#/settings']]],
    ['fehlersuche', ['steps']],
  ]],
  ['glossar', 'list', [
    ['glossar', ['steps']],
  ]],
];

/** Loads the help texts (lazy catalog area). */
export function loadHelpTexts() { return loadArea('help'); }

const fill = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));

function block(kind, key, params) {
  if (Array.isArray(kind) && kind[0] === 'link') return { link: { label: t(key, params), hash: kind[1] } };
  if (kind === 'p') return { p: t(key, params) };
  if (kind === 'tip') return { tip: t(key, params) };
  if (Array.isArray(kind) && kind[0] === 'tip') return { tip: t(key, params), link: { label: t(key.replace('.blocks.', '.links.'), params), hash: kind[1] } };
  if (kind === 'steps') return { steps: (tList(key) || []).map((s) => fill(s, params)) };
  // Lab routes and standards describe Germany; outside it the help gives the general version.
  if (kind === 'labSources') {
    if (!inGermany()) return { p: t('labSources.elsewhere') };
    return { steps: LAB_SOURCES.map((s) => `${s.title}${s.best ? ` (${t('help.labBest')})` : ''}: ${s.what} ${s.cost.charAt(0).toUpperCase()}${s.cost.slice(1)}.`) };
  }
  if (kind === 'labBestTip') return { tip: inGermany() ? LAB_SOURCES.find((s) => s.best).tip : t('labSources.elsewhereTip') };
  if (kind === 'labStandards') {
    return { steps: (inGermany() ? [...LAB_STANDARDS.regulated, ...LAB_STANDARDS.notRegulated] : [t('labSources.standardsElsewhere')]).map(plain) };
  }
  throw new Error(`unknown help block ${kind}`);
}

/**
 * The help as sections → articles → blocks. `name` is the active person's display
 * name – without one the help speaks neutrally.
 */
export function helpSections(name = '') {
  const params = { hi: name ? `, ${name}` : '', name };
  return STRUCTURE.map(([id, icon, articles]) => ({
    id, icon, title: t(`help.sections.${id}`),
    articles: articles.map(([aid, kinds]) => {
      const key = `help.articles.${aid}`;
      const article = { id: aid, q: t(`${key}.q`, params), body: kinds.map((k, i) => block(k, `${key}.blocks.${i}`, params)) };
      if (has(`${key}.aliases`)) article.aliases = t(`${key}.aliases`).split('|');
      return article;
    }),
  }));
}

/** Article with its section for an id (or null). */
export function findArticle(sections, id) {
  for (const section of sections || []) {
    const article = (section.articles || []).find((a) => a.id === id);
    if (article) return { section, article };
  }
  return null;
}

/** Searchable text of an article – including synonyms (aliases) that are not shown. */
export function articleText(a) {
  const parts = [a.q, ...(a.aliases || [])];
  (a.body || []).forEach((b) => {
    if (b.p) parts.push(b.p);
    if (b.tip) parts.push(b.tip);
    if (b.steps) parts.push(b.steps.join(' '));
    if (b.link) parts.push(b.link.label);
  });
  return parts.join(' ');
}
