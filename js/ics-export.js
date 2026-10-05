/* =========================================================================
   ics-export.js — UI for the .ics calendar export.
   The file is generated server-side (api/ics.php). On iOS the native
   calendar + VALARM is the most reliable way to get reminders.
   ========================================================================= */

import { icsUrl, icsToken } from './api-client.js';
import * as store from './storage.js';
import { el, icon, iconSvg, openSheet, closeSheet, toast } from './ui.js';

import { t } from './i18n.js';

// Calendar links open outside the app (Safari/Calendar, without a session cookie) and
// therefore carry the person's calendar key (since v3.20.0). Fetch once per session.
const tokens = new Map();
async function tokenFor(user) {
  if (!user) return null;
  if (!tokens.has(user)) {
    const token = await icsToken(user);
    if (!token) return null;
    tokens.set(user, token);
  }
  return tokens.get(user);
}

function optionRow(title, sub, url) {
  return el('a', {
    class: 'list-item', href: url, target: '_blank', rel: 'noopener',
    download: '', onclick: () => setTimeout(closeSheet, 400),
  }, [
    el('span', { class: 'type-icon type-icon--sm', style: { background: 'var(--accent-soft)', color: 'var(--accent-strong)' }, html: iconSvg('calendar') }),
    el('div', { class: 'list-item__body' }, [
      el('div', { class: 'list-item__title', text: title }),
      el('div', { class: 'list-item__sub', text: sub }),
    ]),
    el('span', { class: 'list-item__chev', html: iconSvg('download') }),
  ]);
}

export async function openIcsSheet({ scope = 'event', id, event = null, unit = null } = {}) {
  const list = el('div', { class: 'list' });

  const u = store.activeUserId();
  const token = await tokenFor(u);
  if (!token) toast(t('icsExport.needsServer'), 'bad', 5000);
  if (unit) list.appendChild(optionRow(t('icsExport.thisSession'), t('icsExport.thisSessionSub', { title: unit.title }), icsUrl('session', unit.id, u, token)));
  let subscribe = null;
  let guide = null;
  if (event) {
    const planUrl = icsUrl('event', event.id, u, token);
    list.appendChild(optionRow(t('icsExport.fullPlan'), t('icsExport.fullPlanSub'), planUrl));
    list.appendChild(optionRow(t('icsExport.raceOnly'), event.name, icsUrl('race', event.id, u, token)));
    // Subscription instead of a one-off file (DOC-29): the calendar then fetches changes itself.
    if (token) subscribe = el('button', { class: 'btn btn--soft btn--block mt-3', type: 'button', onclick: () => copySubscription(planUrl) }, [icon('link'), t('icsExport.copyLink')]);
    // The steps per calendar (iPhone, Mac, Google, Outlook, home network) are maintained only by the help.
    if (token) guide = el('button', { class: 'btn btn--ghost btn--block mt-2', type: 'button', onclick: () => import('./help.js').then((m) => m.openHelpArticle('kalender-abo')) }, [icon('info'), t('icsExport.howTo')]);
  }

  const hint = el('div', { class: 'card card--flat mt-4' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', flex: '0 0 auto', width: '20px' } }),
      el('div', { class: 'muted', style: { fontSize: '0.84rem' } },
        t('icsExport.hint')),
    ]),
  ]);

  openSheet({ title: t('icsExport.title'), body: [list, subscribe, guide, hint].filter(Boolean) });
}

/** Subscription link as a full address to the clipboard; without clipboard access, to copy by hand. */
async function copySubscription(url) {
  const abs = typeof location !== 'undefined' ? new URL(url, location.href).href : url;
  try {
    await navigator.clipboard.writeText(abs);
    toast(t('icsExport.linkCopied'), 'good', 4200);
  } catch {
    toast(t('icsExport.linkIs', { url: abs }), '', 12000);
  }
}
