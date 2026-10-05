/* =========================================================================
   wellness.js — Eignung & Energieziele für die Ansichten (dünne Schicht über
   eligibility.js / energy.js / redflags.js, liest den Store).

   Ernährung, „Heute“, Einstellungen, Programme und Labor fragen hier denselben
   Eignungsstatus und dieselben Energieziele ab – eine Quelle statt vier
   Rechnungen, die sich widersprechen.
   ========================================================================= */

import * as store from './storage.js';
import { el, icon, todayStr, openSheet, closeSheet, toast } from './ui.js';
import { eligibilityFor, gateQuestionsFor } from './eligibility.js';
import { energyTargets } from './energy.js';
import { leanMassNow } from './redflags.js';
import { phaseEmphasis } from './dualgoal.js';

import { t, tp } from './i18n.js';

/** Eignungsstatus der gerade betrachteten Person. */
export function currentEligibility(today = todayStr()) {
  return eligibilityFor({ profile: store.profile(), settings: store.settings(), today });
}

/** Energieziele (Bilanz, Zielgewicht-Status, Defizit) der gerade betrachteten Person. */
export function currentEnergyTargets(today = todayStr()) {
  const profile = store.profile();
  const health = store.get('health');
  const elig = currentEligibility(today);
  const targets = energyTargets({
    profile, health, sessions: store.get('sessions'), diary: store.get('diary'),
    plans: store.get('plans'), events: store.get('events'), today, elig,
    ffm: leanMassNow({ profile, health, today }).ffm,
    phaseDeficit: (plan, day) => phaseEmphasis(plan, day).kcal,
  });
  return { ...targets, elig };
}

/**
 * Abgrenzungs-Dialog (für die ganze App). Keine Vorbelegung: Gespeichert wird erst,
 * wenn jede Frage bewusst beantwortet ist. Das Alter kommt aus dem Geburtsjahr.
 */
export function openGateSheet({ onSaved = null } = {}) {
  const profile = store.profile();
  const questions = gateQuestionsFor(profile, todayStr());
  const prev = store.settings().labsGate || {};
  const cur = {};
  questions.forEach((q) => { if (typeof prev[q.key] === 'boolean') cur[q.key] = prev[q.key]; });
  const saveBtn = el('button', { class: 'btn btn--primary btn--block' }, [icon('check'), t('wellness.save')]);
  const hint = el('div', { class: 'dim', style: { fontSize: '.76rem', textAlign: 'center', marginTop: '6px' } });
  const refresh = () => {
    const open = questions.filter((q) => typeof cur[q.key] !== 'boolean').length;
    saveBtn.disabled = open > 0;
    hint.textContent = open ? tp('wellness.questionsOpen', open) : '';
  };
  const rows = questions.map((q, i) => {
    const qid = `gate-q-${i}`;
    const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': qid });
    const buttons = [['nein', t('wellness.no'), false], ['ja', t('wellness.yes'), true]].map(([key, label, val]) => {
      const b = el('button', {
        class: 'segmented__opt', type: 'button', role: 'radio',
        'aria-checked': cur[q.key] === val ? 'true' : 'false',
        onclick: () => {
          cur[q.key] = val;
          buttons.forEach(([bb, v]) => { bb.classList.toggle('is-active', cur[q.key] === v); bb.setAttribute('aria-checked', cur[q.key] === v ? 'true' : 'false'); });
          refresh();
        },
      }, label);
      if (cur[q.key] === val) b.classList.add('is-active');
      return [b, val];
    });
    buttons.forEach(([b]) => group.appendChild(b));
    return el('div', { class: 'row row--between', style: { padding: '8px 0', borderTop: '1px solid var(--border)', gap: '12px' } }, [
      el('span', { id: qid, style: { fontSize: '.86rem' }, text: q.label }),
      group,
    ]);
  });
  saveBtn.onclick = () => {
    if (questions.some((q) => typeof cur[q.key] !== 'boolean')) return;
    store.setSetting('labsGate', { ...prev, ...cur });
    closeSheet();
    toast(t('wellness.saved'), 'good');
    if (onSaved) onSaved();
  };
  refresh();
  openSheet({
    title: t('wellness.title'),
    body: el('div', {}, [
      el('div', { class: 'muted mb-3', style: { fontSize: '.84rem' }, text: t('wellness.intro') }),
      ...rows,
      profile.birthYear ? el('div', { class: 'dim mt-2', style: { fontSize: '.76rem' }, text: t('wellness.ageHint') }) : null,
    ]),
    footer: el('div', { style: { width: '100%' } }, [saveBtn, hint]),
  });
}

/** Kleine Karte „Einmal kurz beantworten“, solange die Abgrenzung fehlt. */
export function gatePromptCard(text, onSaved) {
  return el('div', { class: 'card card--flat mt-2' }, [
    el('div', { class: 'muted', style: { fontSize: '.84rem' }, text }),
    el('button', { class: 'btn btn--soft mt-2', onclick: () => openGateSheet({ onSaved }) }, [icon('check'), t('wellness.answerNow')]),
  ]);
}
