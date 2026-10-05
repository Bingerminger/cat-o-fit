/* =========================================================================
   formcards.js — „Aktuelle Form“ (VDOT, Paces) und „Deine Trainingsbereiche“.
   Dauer-Informationen: stehen unter „Fortschritt → Training“; auf „Heute“ erscheint
   die Formkarte nur, wenn es etwas zu tun gibt (Paces passen nicht zur Form, UI-15).
   ========================================================================= */

import * as store from './storage.js';
import {
  el, icon, iconSvg, fmtKm, fmtPace, fmtPaceRange, fmtDuration, fmtDate, fmtNum, todayStr, toast, refreshView, infoButton,
} from './ui.js';
import { estimateVdot, pacesFromVdot, paceAdjustment, raceZone, racePaceFromVdot } from './vdot.js';
import { repaceUnits } from './planflow.js';

import { t } from './i18n.js';

export function zonesCard() {
  const p = store.profile();
  const hz = p.hrZones || [];
  const pz = p.paceZones || {};
  if (!hz.length && !Object.keys(pz).length) return null;
  const paceLine = (key, label) => { const z = pz[key]; return z ? `${label} ${fmtPace(z.min)}–${fmtPace(z.max)}` : null; };
  const paces = [paceLine('easy', t('formCards.easy')), paceLine('threshold', t('formCards.threshold')), paceLine('race_hm', t('formCards.race'))].filter(Boolean);
  return el('a', { class: 'card card--link mt-2', href: '#/settings' }, [
    el('div', { class: 'row row--between mb-2' }, [
      el('div', { class: 'card__title', text: t('formCards.zonesTitle') }),
      el('span', { class: 'list-item__chev', html: iconSvg('chevronRight') }),
    ]),
    hz.length ? el('div', { class: 'row gap-1', style: { marginBottom: paces.length ? '8px' : '0' } }, hz.map((z) => el('div', { style: { flex: '1', textAlign: 'center' } }, [
      el('div', { style: { height: '6px', borderRadius: '3px', background: z.color || 'var(--accent)' } }),
      el('div', { class: 'dim', style: { fontSize: '.62rem', marginTop: '3px' }, text: `Z${z.zone}` }),
      el('div', { class: 'num', style: { fontSize: '.64rem' }, text: `${z.min}–${z.max}` }),
    ]))) : null,
    paces.length ? el('div', { class: 'muted', style: { fontSize: '.8rem' }, text: paces.join(' · ') + ' min/km' }) : null,
  ]);
}

/** Formbasierte Zielpace: schätzt die aktuelle Form (VDOT) und gleicht sie mit
    den Plan-Zielpaces ab – mit Option, die Trainingsbereiche nachzuführen. */
export function formCard(today, { actionableOnly = false } = {}) {
  const est = estimateVdot(store.get('sessions'), today, 42, { hrZones: store.profile().hrZones });
  if (!est) return null;
  const adj = paceAdjustment(store.profile().paceZones || {}, est.vdot);
  const fresh = adj.fresh;
  const paceRow = (label, z) => el('div', { class: 'row row--between', style: { padding: '2px 0' } }, [
    el('span', { class: 'muted', text: label }), el('span', { class: 'num', text: fmtPaceRange(z.min, z.max) }),
  ]);
  const basisText = !est.basis ? null
    : est.onlyEasy
      ? t('formCards.onlyEasy')
      : (est.weeks >= 3)
        ? t('formCards.basisSmoothed', { weeks: est.weeks, distance: fmtKm(est.basis.distanceKm, 1), time: fmtDuration(est.basis.durationSec), date: fmtDate(est.basis.date) })
        : t('formCards.basisEstimated', { distance: fmtKm(est.basis.distanceKm, 1), time: fmtDuration(est.basis.durationSec), date: fmtDate(est.basis.date) });
  const card = el('div', { class: 'card mt-2' }, [
    el('div', { class: 'row row--between', style: { alignItems: 'baseline' } }, [
      el('div', { class: 'card__title', text: t('formCards.currentForm') }),
      el('div', { class: 'row gap-1', style: { alignItems: 'center' } }, [
        el('span', { class: 'chip chip--accent', text: `VDOT ${fmtNum(est.vdot)}` }),
        infoButton('vdot', t('formCards.currentForm')),
      ]),
    ]),
    basisText ? el('div', { class: 'dim', style: { fontSize: '.74rem', marginTop: '2px' }, text: basisText }) : null,
    el('div', { class: 'mt-2' }, [paceRow(t('formCards.easy'), fresh.easy), paceRow(t('formCards.threshold'), fresh.threshold), paceRow(t('formCards.intervals'), fresh.vo2)]),
  ]);
  const faster = adj.deltaSec != null && adj.deltaSec >= 6;
  // Langsamer ansetzen nur, wenn die Form aus harten Läufen stammt – lockere Läufe
  // unterschätzen die Form und würden sonst genau die richtig Trainierenden bremsen.
  const slower = adj.deltaSec != null && adj.deltaSec <= -6 && !est.onlyEasy;
  if (actionableOnly && !faster && !slower) return null;
  if (faster || slower) {
    card.appendChild(el('div', { class: 'muted mt-2', style: { fontSize: '.8rem' }, text: faster
      ? t('formCards.fasterThanPlan', { sec: adj.deltaSec })
      : t('formCards.slowerThanPlan', { sec: -adj.deltaSec }) }));
    card.appendChild(el('button', { class: 'btn btn--soft btn--block mt-2', onclick: () => applyFormPaces(est.vdot) }, [icon('refresh'), t('formCards.adjustZones')]));
  } else if (adj.deltaSec != null && !est.onlyEasy) {
    card.appendChild(el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('formCards.pacesFit') }));
  }
  return card;
}
function applyFormPaces(vdot) {
  const zones = pacesFromVdot(vdot);
  store.setProfile({ paceZones: zones });
  // Offene, künftige Lauf-Einheiten gleich mit anpassen – über den Zonenschlüssel der
  // Einheit (`paceKey`), nicht über die HF-Zone: sonst bekam der Marathon das
  // HM-Tempo. Das Renntempo bleibt bei einer Zielzeit das Ziel; ohne Zielzeit folgt
  // es der Form.
  const today = todayStr();
  store.get('plans').forEach((plan) => {
    const event = store.find('events', plan.eventId);
    const raceKm = event?.distanceKm || null;
    const race = (!event?.targetTime && raceKm) ? raceZone(racePaceFromVdot(vdot, raceKm), raceKm) : null;
    const { units, changed } = repaceUnits(plan.units || [], zones, { today, race, raceKm });
    const patch = {};
    if (changed) patch.units = units;
    if (plan.paces) patch.paces = { ...zones, race: race || plan.paces.race || null };
    if (Object.keys(patch).length) store.patch('plans', plan.id, patch);
  });
  toast(t('formCards.zonesAdjusted'), 'good', 3600);
  refreshView();
}
