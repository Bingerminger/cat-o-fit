/* =========================================================================
   redflags.js — safety barriers for the lab/supplement module.
   Pure, DOM-free logic → covered by node:test.

   Cat-O-Fit is aimed at HEALTHY athletes. This module
   pins that boundary down technically instead of only
   writing it into a notice text:

   1) GATE: Anyone who reports a condition needing treatment, long-term medication, a
      pregnancy/breastfeeding period or an eating disorder (or is a minor)
      gets the module in pure DOCUMENTATION MODE: recording values and
      seeing them over time yes – intake recommendations no. Documenting is harmless,
      recommending would not be.
   2) RED FLAGS: Certain constellations need medical clarification and do
      not belong in an app recommendation. They suspend the recommendations.
   3) ENERGY AVAILABILITY (RED-S): The most common serious problem in
      endurance sport is not a missing supplement but too little energy
      for the work done. Cat-O-Fit can estimate this from existing data
      (nutrition, training, body values, cycle).

   No claim to diagnose: All notices are prompts for a conversation with a doctor.
   ========================================================================= */

import { addDays } from './ui.js';
import { freshLatest } from './labs.js';
import { trainingKcal, measuredActiveKcal } from './energy.js';
import { GATE_QUESTIONS } from './eligibility.js';
import { periodStarts, periodSignal } from './cyclecalc.js';
import { migrateHealth } from './healthdata.js';

import { t, tp } from './i18n.js';

/* --------------------------------- Gate ---------------------------------- */

// Since v3.20.0 the questions apply to the whole app (eligibility.js).
export { GATE_QUESTIONS };

/**
 * Operating mode from the plain gate answers (short form; the app uses
 * `eligibilityFor` from eligibility.js, which additionally knows the age).
 * @param {object} gate  Answers from the settings ({key: true|false})
 * @returns {{mode:'full'|'documentation', reasons:string[], answered:boolean}}
 */
export function eligibility(gate = {}) {
  const reasons = GATE_QUESTIONS.filter((q) => gate[q.key] === true).map((q) => q.label);
  const answered = GATE_QUESTIONS.some((q) => typeof gate[q.key] === 'boolean');
  return { mode: reasons.length ? 'documentation' : 'full', reasons, answered };
}

/* ------------------------------ Red flags ------------------------------ */

/** Values for which the app gives no recommendation but sends the user to a doctor. */
const CRITICAL = [
  { key: 'hb', below: 11, get text() { return t('redFlags.hbLow'); } },
  { key: 'sodium', below: 130, get text() { return t('redFlags.sodiumLow'); } },
  { key: 'ck', above: 5000, get text() { return t('redFlags.ckHigh'); } },
  { key: 'crp', above: 50, get text() { return t('redFlags.crpHigh'); } },
  { key: 'ferritin', above: 400, get text() { return t('redFlags.ferritinHigh'); } },
  { key: 'tsh', above: 10, get text() { return t('redFlags.tshHigh'); } },
];

/**
 * Checks for constellations that belong with a doctor.
 * `gate` (pregnancy) and `cycleCheck` (answer to the "period missed?" question)
 * prevent false alarms when a period is missing.
 * @returns {Array<{severity:'stop', text:string, advice:string}>}
 */
export function redFlags({ labs = [], cycle = [], today = null, gate = {}, cycleCheck = null, avgLen = null } = {}) {
  const out = [];
  for (const c of CRITICAL) {
    const l = freshLatest(labs, c.key, today);   // a value from years ago is not a current medical case
    if (!l) continue;
    const v = Number(l.value);
    if ((c.below != null && v < c.below) || (c.above != null && v > c.above)) {
      out.push({
        severity: 'stop', text: c.text,
        advice: t('redFlags.seeDoctor'),
      });
    }
  }

  // Missing period: classic warning sign of too little energy (RED-S) –
  // but only if it has really stopped (not with pregnancy,
  // hormonal contraception or discontinued tracking).
  const signal = periodSignal({ starts: periodStarts(cycle), today, avgLen, gate, check: cycleCheck });
  if (signal && signal.flag) out.push(periodFlag(signal));
  return out;
}

/** Doctor notice for a missed period (shared by cycle, lab and "Today"). */
export function periodFlag(signal) {
  return {
    severity: 'stop',
    text: signal.state === 'missed'
      ? tp('redFlags.periodMissedWeeks', Math.round(signal.days / 7))
      : tp('redFlags.periodNoneMonths', Math.round(signal.days / 30)),
    advice: t('redFlags.periodAdvice'),
  };
}

/* -------------------- Energy availability (RED-S/LEA) -------------------- */

/**
 * Course of energy availability: one point per week over `weeks` weeks.
 * Athletes think in curves – a single snapshot
 * says little, the course shows whether the ratio of eating and training
 * is shifting (typical: it drops in build phases because the load rises).
 * @returns {Array<{label:string, value:number|null, date:string}>}
 */
export function energyAvailabilitySeries(args = {}, { weeks = 10 } = {}) {
  const { today } = args;
  if (!today) return [];
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const ref = addDays(today, -w * 7);
    const ea = energyAvailability({ ...args, today: ref, days: 7, minDays: 3 });
    out.push({
      date: ref,
      label: t('redFlags.shortDate', { dd: String(ref).slice(8, 10), mm: String(ref).slice(5, 7) }),
      value: ea && ea.level !== 'unklar' ? ea.ea : null,
    });
  }
  return out;
}

/** Thresholds according to common sports-medicine classification (kcal/kg fat-free mass/day).
    The 30 is a guideline, not a diagnostic point; for men the limit is rather lower
    according to the IOC consensus 2023 (here: 25). */
export const EA_LOW = 30;
export const EA_LOW_MALE = 25;
export const EA_OPTIMAL = 45;

/** Low threshold by sex. */
export function eaLowFor(sex) { return sex === 'm' ? EA_LOW_MALE : EA_LOW; }

/** Fat-free mass (kg) from weight and body-fat percentage. */
export function leanMass(weightKg, bodyFatPct) {
  const kg = Number(weightKg);
  const bf = Number(bodyFatPct);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  if (!Number.isFinite(bf) || bf <= 0 || bf >= 70) return null;
  return Math.round(kg * (1 - bf / 100) * 10) / 10;
}

/**
 * Fat-free mass on the reference date: most recent weight with a body-fat value from the last
 * 120 days (otherwise from the profile). `missing` names what is missing (for the notice in the
 * UI instead of a silently vanished card).
 * @returns {{ffm:number|null, kg:number|null, missing:null|'weight'|'bodyFat'}}
 */
export function leanMassNow({ profile = {}, health = [], today } = {}) {
  const list = migrateHealth(health);
  const recent = (h) => h && !h.deleted && h.date <= today && h.date >= addDays(today, -120);
  const bf = list.filter((h) => recent(h) && h.bodyFat != null)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const weight = list.filter((h) => h && !h.deleted && h.weight != null && h.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const kg = (weight && Number(weight.weight)) || Number(profile.weightKg) || null;
  if (!kg) return { ffm: null, kg: null, missing: 'weight' };
  // Measured fat-free mass (e.g. Apple Health "Lean Body Mass") takes precedence over the
  // calculation from weight and body-fat percentage.
  const lm = list.filter((h) => recent(h) && Number(h.leanMass) > 0 && Number(h.leanMass) < kg * 1.05)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (lm) return { ffm: Math.round(Number(lm.leanMass) * 10) / 10, kg, missing: null, measured: true };
  const ffm = leanMass(kg, bf ? bf.bodyFat : profile.bodyFatPct);
  return { ffm, kg, missing: ffm ? null : 'bodyFat' };
}

/** Days confirmed in the food diary as "completely logged" (record `_kind: 'day'`). */
export function completeDays(diary = []) {
  return new Set((diary || [])
    .filter((d) => d && !d.deleted && d._kind === 'day' && d.complete === true && d.date)
    .map((d) => d.date));
}

/**
 * Estimates the energy availability of the last `days` days:
 *   EA = (intake − training expenditure) / fat-free mass
 *
 * Rated ONLY over days confirmed as completely logged. Previously
 * "avg intake below 1.2 × BMR ⇒ probably incomplete" applied – that made
 * exactly the most serious cases (eating little, logging carefully) permanently
 * invisible. Now the app asks instead of assuming: without enough
 * confirmed days it stays "unclear" – with a count.
 * Below `minDays` days with meals there is deliberately no result.
 *
 * @param {object} p  `lossGoal`: weight-loss goal active (30–45 is then an acceptable weight-loss range)
 * @returns {{ea, eaRounded, range, days, confirmedDays, intakeAvg, trainingAvg, ffm,
 *   level:'kritisch'|'niedrig'|'gut'|'unklar', hint, lossBand:boolean}|null}
 */
export function energyAvailability({
  profile = {}, health = [], sessions = [], diary = [], today, days = 14, minDays = 5, lossGoal = false,
} = {}) {
  if (!today) return null;
  const from = addDays(today, -(days - 1));
  const { ffm, kg, measured } = leanMassNow({ profile, health, today });
  if (!ffm) return null;

  // Days with recorded food intake.
  const byDay = new Map();
  (diary || []).forEach((m) => {
    if (!m || m.deleted || m._kind || !m.date || !m.kcal) return;
    if (m.date < from || m.date > today) return;
    byDay.set(m.date, (byDay.get(m.date) || 0) + Number(m.kcal));
  });
  if (byDay.size < minDays) return null;

  let trainN = 0, trainMeasured = 0;
  const trainOn = (date) => (sessions || [])
    .filter((s) => s && !s.deleted && s.date === date)
    .reduce((a, s) => { trainN++; if (measuredActiveKcal(s) != null) trainMeasured++; return a + trainingKcal(s, kg, { net: true, activityFactor: profile.activityFactor || 1.35 }); }, 0);
  // Origin of the training expenditure for the card: measured (watch), partly or estimated.
  const trainingSource = () => (!trainN ? null : trainMeasured === trainN ? 'gemessen' : trainMeasured ? 'teils' : 'geschätzt');
  const complete = completeDays(diary);
  const confirmed = [...byDay.keys()].filter((d) => complete.has(d));

  if (confirmed.length < minDays) {
    let iSum = 0, tSum = 0;
    for (const [date, kcal] of byDay) { iSum += kcal; tSum += trainOn(date); }
    return {
      ea: null, eaRounded: null, range: null, days: byDay.size, confirmedDays: confirmed.length, ffmMeasured: !!measured, trainingSource: trainingSource(),
      intakeAvg: Math.round(iSum / byDay.size), trainingAvg: Math.round(tSum / byDay.size), ffm,
      level: 'unklar', lossBand: false,
      hint: t('redFlags.eaConfirm', { confirmed: confirmed.length, days: byDay.size, minDays }),
    };
  }

  let intakeSum = 0, trainSum = 0;
  for (const date of confirmed) { intakeSum += byDay.get(date); trainSum += trainOn(date); }
  const n = confirmed.length;
  const intakeAvg = Math.round(intakeSum / n);
  const trainingAvg = Math.round(trainSum / n);
  const ea = Math.round(((intakeSum - trainSum) / n / ffm) * 10) / 10;
  // Intake, training expenditure and fat-free mass are estimates – the number is
  // not accurate to the decimal place. Hence rounded and shown as a range (± 15 %).
  const eaRounded = Math.round(ea);
  const range = [Math.round(ea * 0.85), Math.round(ea * 1.15)];
  const approx = `≈ ${range[0]}–${range[1]}`;
  const low = eaLowFor(profile.sex);

  const level = ea < low ? 'kritisch' : ea < EA_OPTIMAL ? 'niedrig' : 'gut';
  const lossBand = level === 'niedrig' && lossGoal;
  const hint = level === 'kritisch'
    ? t('redFlags.eaCritical', { ea: eaRounded, approx })
    : lossBand
      ? t('redFlags.eaLossBand', { ea: eaRounded, approx, low, optimal: EA_OPTIMAL })
      : level === 'niedrig'
        ? t('redFlags.eaLow', { ea: eaRounded, approx, optimal: EA_OPTIMAL })
        : t('redFlags.eaGood', { ea: eaRounded, approx });

  return { ea, eaRounded, range, days: byDay.size, confirmedDays: n, intakeAvg, trainingAvg, ffm, ffmMeasured: !!measured, trainingSource: trainingSource(), level, hint, lossBand };
}
