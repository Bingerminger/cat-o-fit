/* =========================================================================
   ics-export.js — UI für den .ics-Kalenderexport.
   Die Datei wird serverseitig erzeugt (api/ics.php). Auf iOS ist der native
   Kalender + VALARM der zuverlässigste Erinnerungsweg.
   ========================================================================= */

import { icsUrl } from './api-client.js';
import * as store from './storage.js';
import { el, icon, iconSvg, openSheet, closeSheet, toast } from './ui.js';

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

export function openIcsSheet({ scope = 'event', id, event = null, unit = null } = {}) {
  const list = el('div', { class: 'list' });

  const u = store.activeUserId();
  if (unit) list.appendChild(optionRow('Diese Einheit', `${unit.title} – einzelner Termin mit Erinnerung`, icsUrl('session', unit.id, u)));
  if (event) {
    list.appendChild(optionRow('Kompletter Plan', 'Alle Einheiten + Wettkampf als Kalender', icsUrl('event', event.id, u)));
    list.appendChild(optionRow('Nur Wettkampf', event.name, icsUrl('race', event.id, u)));
  }

  const hint = el('div', { class: 'card card--flat mt-4' }, [
    el('div', { class: 'row gap-2', style: { alignItems: 'flex-start' } }, [
      el('span', { html: iconSvg('info'), style: { color: 'var(--accent)', flex: '0 0 auto', width: '20px' } }),
      el('div', { class: 'muted', style: { fontSize: '0.84rem' } },
        'Die .ics-Datei öffnet sich im iOS-Kalender. Die enthaltene Erinnerung (1 Std. vorher und am Vorabend) ist auf iPhone/iPad der zuverlässigste Weg für Hinweise – auch wenn die App geschlossen ist.'),
    ]),
  ]);

  openSheet({ title: 'In Kalender exportieren', body: [list, hint] });
}
