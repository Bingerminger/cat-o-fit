/* =========================================================================
   ics-export.js — UI für den .ics-Kalenderexport.
   Die Datei wird serverseitig erzeugt (api/ics.php). Auf iOS ist der native
   Kalender + VALARM der zuverlässigste Erinnerungsweg.
   ========================================================================= */

import { icsUrl, icsToken } from './api-client.js';
import * as store from './storage.js';
import { el, icon, iconSvg, openSheet, closeSheet, toast } from './ui.js';

// Kalender-Links öffnen sich außerhalb der App (Safari/Kalender, ohne Sitzungs-Cookie) und
// tragen deshalb den Kalender-Schlüssel der Person (seit v3.20.0). Einmal je Sitzung holen.
const tokens = new Map();
async function tokenFor(user) {
  if (!user) return null;
  if (!tokens.has(user)) {
    const t = await icsToken(user);
    if (!t) return null;
    tokens.set(user, t);
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
  const t = await tokenFor(u);
  if (!t) toast('Für Kalender-Links braucht die App eine Verbindung zum Server und deine Anmeldung mit PIN.', 'bad', 5000);
  if (unit) list.appendChild(optionRow('Diese Einheit', `${unit.title} – einzelner Termin mit Erinnerung`, icsUrl('session', unit.id, u, t)));
  let subscribe = null;
  let guide = null;
  if (event) {
    const planUrl = icsUrl('event', event.id, u, t);
    list.appendChild(optionRow('Kompletter Plan', 'Alle Einheiten + Wettkampf als Kalender', planUrl));
    list.appendChild(optionRow('Nur Wettkampf', event.name, icsUrl('race', event.id, u, t)));
    // Abo statt Einmal-Datei (DOC-29): Der Kalender holt Änderungen dann selbst.
    if (t) subscribe = el('button', { class: 'btn btn--soft btn--block mt-3', type: 'button', onclick: () => copySubscription(planUrl) }, [icon('link'), 'Abo-Link kopieren']);
    // Die Schritte je Kalender (iPhone, Mac, Google, Outlook, Heimnetz) pflegt nur die Hilfe.
    if (t) guide = el('button', { class: 'btn btn--ghost btn--block mt-2', type: 'button', onclick: () => import('./help.js').then((m) => m.openHelpArticle('kalender-abo')) }, [icon('info'), 'So richtest du das Abo ein']);
  }

  const hint = el('div', { class: 'card card--flat mt-4' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent-text)', flex: '0 0 auto', width: '20px' } }),
      el('div', { class: 'muted', style: { fontSize: '0.84rem' } },
        'Die .ics-Datei öffnet sich im iOS-Kalender. Die enthaltene Erinnerung (1 Std. vorher und am Vorabend) ist auf iPhone/iPad der zuverlässigste Weg für Hinweise – auch wenn die App geschlossen ist. Als Abo bleibt der Plan von selbst aktuell. Der Link enthält deinen persönlichen Kalender-Schlüssel – teile ihn nur mit Menschen, die deinen Plan sehen dürfen.'),
    ]),
  ]);

  openSheet({ title: 'In Kalender exportieren', body: [list, subscribe, guide, hint].filter(Boolean) });
}

/** Abo-Link als volle Adresse in die Zwischenablage; ohne Zwischenablage zum Abschreiben. */
async function copySubscription(url) {
  const abs = typeof location !== 'undefined' ? new URL(url, location.href).href : url;
  try {
    await navigator.clipboard.writeText(abs);
    toast('Abo-Link kopiert – im Kalender als Abonnement hinzufügen', 'good', 4200);
  } catch {
    toast(`Abo-Link: ${abs}`, '', 12000);
  }
}
