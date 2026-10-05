/* Eligibility status for the whole app (js/eligibility.js): child and youth profile,
   pregnancy/breastfeeding, eating disorder, "hide numbers", no pre-filled answers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibilityFor, gateQuestionsFor, ageOf, weightGoalBlockReason } from '../js/eligibility.js';

const T = '2026-09-29';
const ALL_NO = { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, minor: false };

test('eligibility: age from the birth year – minors automatically in the child and youth profile', () => {
  assert.equal(ageOf({ birthYear: 2012 }, T), 14);
  assert.equal(ageOf({}, T), null);
  const kid = eligibilityFor({ profile: { birthYear: 2012 }, settings: {}, today: T });
  assert.equal(kid.minor, true);
  assert.equal(kid.answered, true, 'classified even without answers');
  assert.equal(kid.noWeightGoals, true);
  assert.equal(kid.noPerformanceSupplements, true);
  assert.equal(kid.labsEvaluate, false);
  assert.equal(kid.hideNumbers, true);
  assert.equal(kid.mode, 'documentation');
  assert.match(weightGoalBlockReason(kid), /Kinder und Jugendliche/);
  // The self-declaration "not a minor" does not override the birth year.
  assert.equal(eligibilityFor({ profile: { birthYear: 2012 }, settings: { labsGate: ALL_NO }, today: T }).minor, true);
});

test('eligibility: adults, gate answered, nothing applies', () => {
  const e = eligibilityFor({ profile: { birthYear: 1990 }, settings: { labsGate: ALL_NO }, today: T });
  assert.equal(e.answered, true);
  assert.equal(e.mode, 'full');
  assert.equal(e.noWeightGoals, false);
  assert.equal(e.hideNumbers, false);
  assert.equal(e.labsEvaluate, true);
  assert.equal(weightGoalBlockReason(e), null);
});

test('eligibility: no pre-filling – without answers nothing is answered', () => {
  assert.equal(eligibilityFor({ profile: { birthYear: 1990 }, settings: {}, today: T }).answered, false);
  // With a birth year the app does not ask for the age; without one it is a mandatory question.
  assert.ok(!gateQuestionsFor({ birthYear: 1990 }, T).some((q) => q.key === 'minor'));
  assert.ok(gateQuestionsFor({}, T).some((q) => q.key === 'minor'));
  const { minor, ...withoutMinor } = ALL_NO;
  assert.equal(minor, false);
  assert.equal(eligibilityFor({ profile: {}, settings: { labsGate: withoutMinor }, today: T }).answered, false);
  assert.equal(eligibilityFor({ profile: {}, settings: { labsGate: ALL_NO }, today: T }).answered, true);
});

test('eligibility: pregnancy and eating disorder block weight-loss goals; illness only the labs', () => {
  const adult = (gate, extra = {}) => eligibilityFor({ profile: { birthYear: 1990 }, settings: { labsGate: { ...ALL_NO, ...gate }, ...extra }, today: T });
  const preg = adult({ pregnancy: true });
  assert.equal(preg.noWeightGoals, true);
  assert.equal(preg.noPerformanceSupplements, false);
  assert.match(weightGoalBlockReason(preg), /Schwangerschaft/);

  const ed = adult({ eatingDisorder: true }, { hideCalorieNumbers: true });
  assert.equal(ed.noWeightGoals, true);
  assert.equal(ed.hideNumbers, true);
  assert.match(weightGoalBlockReason(ed), /Essstörung/);

  const med = adult({ medication: true });
  assert.equal(med.mode, 'documentation');
  assert.equal(med.noWeightGoals, false);
  assert.equal(med.labsEvaluate, true);
});

test('eligibility: "hide calorie numbers" also works without a further reason', () => {
  const e = eligibilityFor({ profile: { birthYear: 1990 }, settings: { labsGate: ALL_NO, hideCalorieNumbers: true }, today: T });
  assert.equal(e.hideNumbers, true);
  assert.equal(e.noWeightGoals, false);
});
