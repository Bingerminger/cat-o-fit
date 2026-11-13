/* =========================================================================
   strength-ui.js — shared views for strength training (since 4.2): the best values of an exercise
   (estimated one-repetition maximum, heaviest set, most repetitions), the note on a new personal
   record and the plate calculator. The numbers come from strength.js (pure); weights are shown in
   the person's unit.
   ========================================================================= */

import { el, icon, input, field, segmented, openSheet, fmtDate, fmtWeightDec, fmtDec } from './ui.js';
import { weightUnit, toInput } from './units.js';
import { platesPerSide, PLATES, BARS, ONE_RM_MAX_REPS } from './strength.js';

import { t } from './i18n.js';

/** "1RM ≈ 72.5 kg · heaviest set 8 × 65 kg · most reps 25" – empty when there is nothing yet. */
export function recordsLine(rec) {
  if (!rec) return '';
  const parts = [];
  if (rec.oneRm) parts.push(t('strength.bestOneRm', { weight: fmtWeightDec(rec.oneRm.value) }));
  if (rec.weight) parts.push(t('strength.bestWeight', { weight: fmtWeightDec(rec.weight.value), reps: rec.weight.reps }));
  if (rec.reps) parts.push(t('strength.bestReps', { n: rec.reps.value }));
  return parts.join(' · ');
}

/** What a new record improved, as a short text ("1RM ≈ 75 kg, 70 kg") – empty when nothing. */
export function newRecordText(nr) {
  if (!nr) return '';
  const parts = [];
  if (nr.oneRm != null) parts.push(t('strength.recordOneRm', { weight: fmtWeightDec(nr.oneRm) }));
  if (nr.weight != null) parts.push(t('strength.recordWeight', { weight: fmtWeightDec(nr.weight) }));
  if (nr.reps != null) parts.push(t('strength.recordReps', { n: nr.reps }));
  return parts.join(', ');
}

/** Card "Your best values" for the exercise sheet: each value with its day, plus the note on the estimate. */
export function recordsCard(rec) {
  const rows = [];
  if (rec.oneRm) rows.push([t('strength.oneRmLabel'), `≈ ${fmtWeightDec(rec.oneRm.value)}`, rec.oneRm.date]);
  if (rec.weight) rows.push([t('strength.heaviestLabel'), `${rec.weight.reps} × ${fmtWeightDec(rec.weight.value)}`, rec.weight.date]);
  if (rec.reps) rows.push([t('strength.mostRepsLabel'), t('strength.reps', { n: rec.reps.value }), rec.reps.date]);
  if (!rows.length) return null;
  return el('div', { class: 'card card--flat mt-3' }, [
    el('div', { style: { fontWeight: '700', fontSize: '.9rem' }, text: t('strength.bestTitle') }),
    ...rows.map(([label, value, date]) => el('div', { class: 'row', style: { justifyContent: 'space-between', fontSize: '.86rem', marginTop: '4px' } }, [
      el('span', { class: 'muted', text: label }),
      el('span', {}, [el('strong', { text: value }), el('span', { class: 'dim', text: ` · ${fmtDate(date)}` })]),
    ])),
    rec.oneRm ? el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('strength.oneRmNote', { max: ONE_RM_MAX_REPS }) }) : null,
  ]);
}

/** The plates per side as text in the shown unit ("20 + 10 + 2.5"). */
export function platesText(plates) {
  return plates.map((p) => fmtDec(p)).join(' + ');
}

/**
 * Plate calculator: total weight and bar → the plates per side. Starts with `kg` (stored, metric) when given.
 * Works in the unit the person uses (kg plates or lb plates).
 */
export function openPlateSheet({ kg = null } = {}) {
  const unit = weightUnit();
  const plates = PLATES[unit];
  const bars = BARS[unit];
  let bar = bars[0];
  const totalI = input({ type: 'number', inputmode: 'decimal', min: '0', step: unit === 'lb' ? '5' : '2.5', value: kg != null ? String(toInput(kg, 'weight')) : '', 'aria-label': t('strength.plateTotal', { unit }) });
  const out = el('div', { class: 'card card--flat mt-3', 'aria-live': 'polite' });
  const draw = () => {
    out.innerHTML = '';
    const total = parseFloat(String(totalI.value).replace(',', '.'));
    if (!(total > 0)) { out.appendChild(el('div', { class: 'muted', text: t('strength.plateEnter') })); return; }
    const r = platesPerSide(total, bar, plates);
    if (r.under) { out.appendChild(el('div', { class: 'muted', text: t('strength.plateUnderBar', { bar: `${fmtDec(bar)} ${unit}` }) })); return; }
    out.appendChild(el('div', { style: { fontWeight: '700' }, text: r.plates.length ? t('strength.platePerSide', { plates: `${platesText(r.plates)} ${unit}` }) : t('strength.plateBarOnly') }));
    if (r.rest > 0) {
      const reachable = total - r.rest;
      out.appendChild(el('div', { class: 'muted mt-1', style: { fontSize: '.84rem' }, text: t('strength.plateRest', { rest: `${fmtDec(r.rest)} ${unit}`, reachable: `${fmtDec(reachable)} ${unit}` }) }));
    }
  };
  totalI.addEventListener('input', draw);
  const barPick = segmented(bars.map((b) => ({ value: String(b), label: `${fmtDec(b)} ${unit}` })), String(bar), (v) => { bar = Number(v); draw(); }, { label: t('strength.plateBar') });
  draw();
  openSheet({
    title: t('strength.plateTitle'),
    body: el('div', {}, [
      field(t('strength.plateTotal', { unit }), totalI),
      el('div', { class: 'muted mt-2', style: { fontSize: '.84rem' }, text: t('strength.plateBar') }),
      el('div', { class: 'mt-1' }, [barPick]),
      out,
      el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('strength.plateHint', { plates: `${platesText(plates)} ${unit}` }) }),
    ]),
  });
}

/** Button that opens the plate calculator with the weight a field currently shows. */
export function plateButton(getKg) {
  return el('button', { class: 'btn btn--ghost mt-1', type: 'button', style: { fontSize: '.82rem', padding: '6px 10px' }, onclick: () => openPlateSheet({ kg: getKg() }) }, [icon('dumbbell'), t('strength.plateOpen')]);
}
