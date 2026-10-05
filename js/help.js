/* =========================================================================
   help.js — knowledge base and help inside the app (#/hilfe, #/hilfe/<id>).
   Renders the content from helpcontent.js: search (with synonyms), addressable
   articles and the short view as a sheet for the ⓘ buttons on the metrics.
   ========================================================================= */

import * as store from './storage.js';
import { el, icon, iconSvg, navigate, debounce, openSheet, closeSheet } from './ui.js';
import { setHeader } from './router.js';
import { helpSections, findArticle, articleText, loadHelpTexts } from './helpcontent.js';

import { t } from './i18n.js';

/** Display name of the active person; without a name the help addresses the reader neutrally. */
function userName() {
  return ((store.profile() && store.profile().name) || store.activeMember()?.name || '').trim();
}

/* ------------------------------- Rendering ------------------------------ */
let pendingQuery = '';
/** Opens the help with a pre-filled search. */
export function openHelp(query = '') {
  pendingQuery = String(query || '');
  navigate('#/hilfe');
}

/** ⓘ on a metric: show the article as a sheet – with a jump into the full help. */
export async function openHelpArticle(id) {
  await loadHelpTexts();
  const hit = findArticle(helpSections(userName()), id);
  if (!hit) { openHelp(''); return; }
  openSheet({
    title: hit.article.q,
    body: el('div', { class: 'help-sheet' }, [
      ...articleBlocks(hit.article),
      el('button', {
        class: 'btn btn--ghost btn--block mt-3', type: 'button',
        onclick: () => { closeSheet(); navigate(`#/hilfe/${id}`); },
      }, [el('span', { text: t('helpView.openInHelp') }), icon('arrowRight')]),
    ]),
  });
}

export async function render(view, articleId = null) {
  const at = location.hash;
  await loadHelpTexts();
  if (location.hash !== at) return;   // navigated away while the texts were loading
  const name = userName();
  setHeader({ title: t('nav.help') });
  const data = helpSections(name);
  const initialQuery = pendingQuery;
  pendingQuery = '';
  const target = articleId ? findArticle(data, articleId) : null;

  // Greeting
  view.appendChild(el('div', { class: 'card card--accent' }, [
    el('div', { class: 'row gap-3', style: { alignItems: 'center' } }, [
      el('span', { html: iconSvg('sparkles'), style: { width: '26px', flex: '0 0 auto' } }),
      el('div', {}, [
        el('div', { style: { fontWeight: '800', fontSize: '1.1rem' }, text: name ? t('helpView.hello', { name }) : t('helpView.helloAnon') }),
        el('div', { style: { opacity: '0.9', fontSize: '0.88rem' }, text: t('helpView.intro') }),
      ]),
    ]),
  ]));

  // Search
  const searchInput = el('input', { class: 'input', type: 'search', 'aria-label': t('helpView.searchLabel'), placeholder: t('helpView.searchPlaceholder'), style: { marginTop: '16px' } });
  view.appendChild(searchInput);

  const container = el('div', { class: 'help-container mt-4' });
  view.appendChild(container);

  let focusCard = null;
  const draw = (query = '') => {
    container.innerHTML = '';
    focusCard = null;
    const q = query.trim().toLowerCase();
    let hits = 0;
    data.forEach((section) => {
      const matching = section.articles.filter((a) => !q || articleText(a).toLowerCase().includes(q) || section.title.toLowerCase().includes(q));
      if (!matching.length) return;
      hits += matching.length;
      container.appendChild(el('div', { class: 'section-head' }, [
        el('h2', { class: 'section-head__title row gap-2' }, [el('span', { html: iconSvg(section.icon), style: { width: '18px', color: 'var(--accent-text)' } }), section.title]),
      ]));
      matching.forEach((a) => {
        const isTarget = !q && target && target.article.id === a.id;
        const card = articleCard(a, !!q || isTarget);
        if (isTarget) { card.classList.add('help-article--focus'); focusCard = card; }
        container.appendChild(card);
      });
    });
    if (!hits) {
      container.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon', html: iconSvg('info') }),
        el('div', { class: 'empty__title', text: t('helpView.nothingFound') }),
        el('div', { class: 'muted', text: t('helpView.tryAnother') }),
      ]));
    }
  };

  searchInput.addEventListener('input', debounce((e) => draw(e.target.value), 180));
  searchInput.value = initialQuery;
  draw(initialQuery);
  // Directly addressed article (#/hilfe/<id>): expanded and scrolled into view.
  if (focusCard) setTimeout(() => focusCard.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 60);
}

/** The blocks of an article as DOM (for card and sheet). */
function articleBlocks(a) {
  const out = [];
  (a.body || []).forEach((b) => {
    if (b.p) out.push(el('p', { class: 'help-p', text: b.p }));
    if (b.steps) {
      const ol = el('ol', { class: 'help-steps' });
      b.steps.forEach((s) => ol.appendChild(el('li', { text: s })));
      out.push(ol);
    }
    if (b.tip) out.push(el('div', { class: 'help-tip' }, [el('span', { html: iconSvg('info'), style: { width: '16px', flex: '0 0 auto' } }), el('span', { text: b.tip })]));
    if (b.link) out.push(el('button', { class: 'btn btn--soft', type: 'button', style: { marginTop: '10px' }, onclick: () => navigate(b.link.hash) }, [el('span', { text: b.link.label }), icon('arrowRight')]));
  });
  return out;
}

function articleCard(a, openByDefault = false) {
  const body = el('div', { class: 'help-article__body', hidden: !openByDefault }, articleBlocks(a));
  const chev = el('span', { class: 'list-item__chev help-article__chev', html: iconSvg('chevronDown') });
  const head = el('button', {
    class: 'help-article__head', type: 'button', 'aria-expanded': openByDefault ? 'true' : 'false',
    onclick: () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      chev.style.transform = open ? 'rotate(180deg)' : '';
    },
  }, [el('span', { class: 'help-article__q', text: a.q }), chev]);
  if (openByDefault) chev.style.transform = 'rotate(180deg)';
  return el('div', { class: 'card help-article', id: `hilfe-${a.id}`, style: { padding: '0' } }, [head, body]);
}
