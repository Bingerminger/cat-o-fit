/* =========================================================================
   eligibility.js — ONE eligibility status per person for the whole app.
   Pure, DOM-free logic → covered by node:test.

   Cat-O-Fit is aimed at healthy adults. Previously only the lab module asked
   about illness, medication, pregnancy, eating disorder and age – nutrition,
   goals and programmes nevertheless calculated deficits, even for children.
   Now all modules query this one status:

   • Minor (automatically from the birth year, otherwise from the answer):
     child and teenage profile – no calorie and weight goals, no
     weight-loss programme, no performance supplements, labs only documenting.
   • Pregnancy/breastfeeding or eating disorder: no weight-loss or deficit goals.
   • Illness/medication: labs and supplements in documentation mode.
   • "Hide calorie figures": hide calorie numbers – for everyone they do not
     agree with (always for minors).

   The gate remains stored as before in `settings.labsGate` (existing
   answers still apply), plus `settings.hideCalorieNumbers`.
   ========================================================================= */

import { t, tp } from './i18n.js';

/** Screening questions. `minor` is only asked if no birth year is known. */
export const GATE_QUESTIONS = [
  { key: 'chronicCondition', get label() { return t('eligibility.chronicCondition'); } },
  { key: 'medication', get label() { return t('eligibility.medication'); } },
  { key: 'pregnancy', get label() { return t('eligibility.pregnancy'); } },
  { key: 'eatingDisorder', get label() { return t('eligibility.eatingDisorder'); } },
  { key: 'minor', get label() { return t('eligibility.minor'); } },
];

/** Age in years from the birth year (reference date `today`) – or null. */
export function ageOf(profile = {}, today = null) {
  const by = Number(profile && profile.birthYear);
  if (!Number.isFinite(by) || by < 1900) return null;
  const year = Number(String(today || '').slice(0, 4)) || new Date().getFullYear();
  const age = year - by;
  return age >= 0 && age < 130 ? age : null;
}

/** Child and youth profile by age from the year of birth (see eligibilityFor): under 19 by year, because
    the birthday is unknown. The one rule for the gate and the profile form. */
export function minorByYear(age) { return age != null && age < 19; }

/** Which questions this person has to answer (age is only asked of those without a birth year). */
export function gateQuestionsFor(profile = {}, today = null) {
  return ageOf(profile, today) != null ? GATE_QUESTIONS.filter((q) => q.key !== 'minor') : GATE_QUESTIONS;
}

/**
 * Eligibility status of a person.
 * @returns {{answered:boolean, mode:'full'|'documentation', reasons:string[], age:number|null,
 *   minor:boolean, pregnancy:boolean, eatingDisorder:boolean, noWeightGoals:boolean,
 *   noPerformanceSupplements:boolean, labsEvaluate:boolean, hideNumbers:boolean}}
 */
export function eligibilityFor({ profile = {}, settings = {}, today = null } = {}) {
  const gate = (settings && settings.labsGate) || {};
  const age = ageOf(profile, today);
  // Only the year of birth is known: in the year someone turns 18 they may still be 17. The youth profile
  // therefore holds until the year they turn 19 – also the first year the basal metabolic rate (Mifflin,
  // studied from 19) applies. Before 4.2 an 18 by year counted as adult from 1 January.
  const minor = age != null ? minorByYear(age) : gate.minor === true;
  const questions = gateQuestionsFor(profile, today);
  const answered = questions.every((q) => typeof gate[q.key] === 'boolean');
  const reasons = questions.filter((q) => gate[q.key] === true).map((q) => q.label);
  if (minor && age != null) reasons.push(tp('eligibility.minorByYear', age, age === 18 ? { count: '17–18' } : {}));
  const pregnancy = gate.pregnancy === true;
  const eatingDisorder = gate.eatingDisorder === true;
  return {
    answered: answered || minor,          // Minors are classified even without answers
    mode: reasons.length ? 'documentation' : 'full',
    reasons, age, minor, pregnancy, eatingDisorder,
    noWeightGoals: minor || pregnancy || eatingDisorder,
    noPerformanceSupplements: minor,
    labsEvaluate: !minor,
    hideNumbers: minor || (settings && settings.hideCalorieNumbers === true),
  };
}

/** Short, friendly reason why no weight-loss goals are calculated (or null). */
export function weightGoalBlockReason(elig) {
  if (!elig) return null;
  if (elig.minor) return t('eligibility.blockMinor');
  if (elig.pregnancy) return t('eligibility.blockPregnancy');
  if (elig.eatingDisorder) return t('eligibility.blockEatingDisorder');
  return null;
}
