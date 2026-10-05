/* =========================================================================
   eligibility.js — EIN Eignungsstatus je Person für die ganze App.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   Cat-O-Fit richtet sich an gesunde Erwachsene. Früher fragte nur das
   Labormodul nach Erkrankung, Medikamenten, Schwangerschaft, Essstörung und
   Alter – Ernährung, Ziele und Programme rechneten trotzdem Defizite vor, auch
   für Kinder. Jetzt fragen alle Module diesen einen Status ab:

   • Minderjährig (automatisch aus dem Geburtsjahr, sonst aus der Antwort):
     Kinder- und Jugendprofil – keine Kalorien- und Gewichtsziele, kein
     Abnehmprogramm, keine Leistungspräparate, Labor nur dokumentierend.
   • Schwangerschaft/Stillzeit oder Essstörung: keine Abnehm- oder Defizitziele.
   • Erkrankung/Medikamente: Labor und Ergänzung im Dokumentationsmodus.
   • „Zahlen ausblenden“: Kalorienzahlen verbergen – für alle, denen sie nicht
     guttun (bei Minderjährigen immer).

   Gespeichert bleibt das Gate wie bisher in `settings.labsGate` (bestehende
   Antworten gelten weiter), dazu `settings.hideCalorieNumbers`.
   ========================================================================= */

import { t, tp } from './i18n.js';

/** Fragen zur Abgrenzung. `minor` wird nur gefragt, wenn kein Geburtsjahr bekannt ist. */
export const GATE_QUESTIONS = [
  { key: 'chronicCondition', get label() { return t('eligibility.chronicCondition'); } },
  { key: 'medication', get label() { return t('eligibility.medication'); } },
  { key: 'pregnancy', get label() { return t('eligibility.pregnancy'); } },
  { key: 'eatingDisorder', get label() { return t('eligibility.eatingDisorder'); } },
  { key: 'minor', get label() { return t('eligibility.minor'); } },
];

/** Alter in Jahren aus dem Geburtsjahr (Stichtag `today`) – oder null. */
export function ageOf(profile = {}, today = null) {
  const by = Number(profile && profile.birthYear);
  if (!Number.isFinite(by) || by < 1900) return null;
  const year = Number(String(today || '').slice(0, 4)) || new Date().getFullYear();
  const age = year - by;
  return age >= 0 && age < 130 ? age : null;
}

/** Welche Fragen diese Person beantworten muss (Alter fragt nur, wer kein Geburtsjahr hat). */
export function gateQuestionsFor(profile = {}, today = null) {
  return ageOf(profile, today) != null ? GATE_QUESTIONS.filter((q) => q.key !== 'minor') : GATE_QUESTIONS;
}

/**
 * Eignungsstatus einer Person.
 * @returns {{answered:boolean, mode:'full'|'documentation', reasons:string[], age:number|null,
 *   minor:boolean, pregnancy:boolean, eatingDisorder:boolean, noWeightGoals:boolean,
 *   noPerformanceSupplements:boolean, labsEvaluate:boolean, hideNumbers:boolean}}
 */
export function eligibilityFor({ profile = {}, settings = {}, today = null } = {}) {
  const gate = (settings && settings.labsGate) || {};
  const age = ageOf(profile, today);
  const minor = age != null ? age < 18 : gate.minor === true;
  const questions = gateQuestionsFor(profile, today);
  const answered = questions.every((q) => typeof gate[q.key] === 'boolean');
  const reasons = questions.filter((q) => gate[q.key] === true).map((q) => q.label);
  if (minor && age != null) reasons.push(tp('eligibility.minorByYear', age));
  const pregnancy = gate.pregnancy === true;
  const eatingDisorder = gate.eatingDisorder === true;
  return {
    answered: answered || minor,          // Minderjährige sind auch ohne Antworten eingeordnet
    mode: reasons.length ? 'documentation' : 'full',
    reasons, age, minor, pregnancy, eatingDisorder,
    noWeightGoals: minor || pregnancy || eatingDisorder,
    noPerformanceSupplements: minor,
    labsEvaluate: !minor,
    hideNumbers: minor || (settings && settings.hideCalorieNumbers === true),
  };
}

/** Kurzer, freundlicher Grund, warum keine Abnehmziele gerechnet werden (oder null). */
export function weightGoalBlockReason(elig) {
  if (!elig) return null;
  if (elig.minor) return t('eligibility.blockMinor');
  if (elig.pregnancy) return t('eligibility.blockPregnancy');
  if (elig.eatingDisorder) return t('eligibility.blockEatingDisorder');
  return null;
}
