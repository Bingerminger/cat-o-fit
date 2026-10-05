/* =========================================================================
   demo-mode.js — the public demo (GitHub Pages), which has no PHP behind it.

   tools/build-demo.mjs marks the demo's index.html with `data-demo`; a normal
   instance never runs this code. Every visit starts over: this deployment's stored
   data is cleared (only its own `catofit:<path>:` keys – other apps on the same
   origin keep theirs), the API is answered in memory (demo-server.js), and a demo
   family with the persona "Alex" is set up. A bar in the header says so and offers
   the languages; picking one starts the demo over in it (`?lang=fr`).
   ========================================================================= */

import { installDemoServer } from './demo-server.js';
import { scopeKey } from './env.js';
import { t, languages, locale, setLocale } from './i18n.js';
import { el, todayStr } from './ui.js';
import * as store from './storage.js';
import { applyLanguage } from './language.js';

export const DEMO_PIN = '2468';
const PROJECT_URL = 'https://github.com/Bingerminger/cat-o-fit';

/** True only in the demo build. */
export function isDemo() {
  return typeof document !== 'undefined' && !!document.documentElement?.hasAttribute?.('data-demo');
}

/** Before the store starts: forget the previous visit and answer the API in the browser. */
export function prepareDemo() {
  const prefix = scopeKey('');
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const own = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) own.push(k); }
      own.forEach((k) => storage.removeItem(k));
    } catch { /* storage unavailable – nothing to forget */ }
  }
  return installDemoServer();
}

/** After the catalogs are loaded: the demo family in the language from ?lang= (else the
    browser's), without a burst of badge toasts, and the bar. */
export async function startDemo() {
  const wanted = new URLSearchParams(location.search).get('lang');
  // Before the family exists, so the demo data and the instance language come in that language.
  if (wanted && languages()[wanted] && wanted !== locale()) await setLocale(wanted);
  await store.createFirstAdmin({ name: 'Alex', pin: DEMO_PIN });
  await store.seedDemo(todayStr());
  await applyLanguage();
  // The seeded history unlocks a dozen badges at once – they count as seen, not as news.
  const { badgeData, markAllSeen } = await import('./badges.js');
  markAllSeen(badgeData());
  showBar();
}

/** The bar in the sticky header: what the demo is, the PIN, the language, the project. */
export function showBar() {
  const header = document.getElementById('app-header');
  if (!header) return;
  header.querySelector('.demo-bar')?.remove();
  const choose = el('select', {
    class: 'demo-bar__lang', 'aria-label': t('settings.language.label'),
    // A new language starts the demo over in it – the demo data is written in one language.
    onchange: (e) => {
      const url = new URL(location.href);
      url.searchParams.set('lang', e.target.value);
      location.assign(url.href);
    },
  }, Object.entries(languages()).map(([code, name]) => el('option', { value: code, selected: code === locale(), text: name })));
  header.appendChild(el('div', { class: 'demo-bar', role: 'note' }, [
    el('span', { text: t('demoMode.bar') }),
    el('span', { class: 'demo-bar__pin', text: t('demoMode.pin', { pin: DEMO_PIN }) }),
    choose,
    el('a', { href: PROJECT_URL, rel: 'noopener', text: t('demoMode.get') }),
  ]));
}
