/* Eignungsstatus für die ganze App (js/eligibility.js): Kinder- und Jugendprofil,
   Schwangerschaft/Stillzeit, Essstörung, „Zahlen ausblenden“, keine Vorbelegung. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibilityFor, gateQuestionsFor, ageOf, weightGoalBlockReason } from '../js/eligibility.js';

const T = '2026-09-29';
const ALL_NO = { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false, minor: false };

test('eligibility: Alter aus dem Geburtsjahr – Minderjährige automatisch im Kinder- und Jugendprofil', () => {
  assert.equal(ageOf({ birthYear: 2012 }, T), 14);
  assert.equal(ageOf({}, T), null);
  const kid = eligibilityFor({ profile: { birthYear: 2012 }, settings: {}, today: T });
  assert.equal(kid.minor, true);
  assert.equal(kid.answered, true, 'auch ohne Antworten eingeordnet');
  assert.equal(kid.noWeightGoals, true);
  assert.equal(kid.noPerformanceSupplements, true);
  assert.equal(kid.labsEvaluate, false);
  assert.equal(kid.hideNumbers, true);
  assert.equal(kid.mode, 'documentation');
  assert.match(weightGoalBlockReason(kid), /Kinder und Jugendliche/);
  // Die Selbstauskunft „nicht minderjährig“ überstimmt das Geburtsjahr nicht.
  assert.equal(eligibilityFor({ profile: { birthYear: 2012 }, settings: { labsGate: ALL_NO }, today: T }).minor, true);
});

test('eligibility: Erwachsene, Abgrenzung beantwortet, nichts trifft zu', () => {
  const e = eligibilityFor({ profile: { birthYear: 1990 }, settings: { labsGate: ALL_NO }, today: T });
  assert.equal(e.answered, true);
  assert.equal(e.mode, 'full');
  assert.equal(e.noWeightGoals, false);
  assert.equal(e.hideNumbers, false);
  assert.equal(e.labsEvaluate, true);
  assert.equal(weightGoalBlockReason(e), null);
});

test('eligibility: keine Vorbelegung – ohne Antworten ist nichts beantwortet', () => {
  assert.equal(eligibilityFor({ profile: { birthYear: 1990 }, settings: {}, today: T }).answered, false);
  // Mit Geburtsjahr fragt die App das Alter nicht, ohne Geburtsjahr gehört es zu den Pflichtfragen.
  assert.ok(!gateQuestionsFor({ birthYear: 1990 }, T).some((q) => q.key === 'minor'));
  assert.ok(gateQuestionsFor({}, T).some((q) => q.key === 'minor'));
  const { minor, ...withoutMinor } = ALL_NO;
  assert.equal(minor, false);
  assert.equal(eligibilityFor({ profile: {}, settings: { labsGate: withoutMinor }, today: T }).answered, false);
  assert.equal(eligibilityFor({ profile: {}, settings: { labsGate: ALL_NO }, today: T }).answered, true);
});

test('eligibility: Schwangerschaft und Essstörung sperren Abnehmziele; Erkrankung nur das Labor', () => {
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

test('eligibility: „Kalorienzahlen ausblenden“ wirkt auch ohne weiteren Grund', () => {
  const e = eligibilityFor({ profile: { birthYear: 1990 }, settings: { labsGate: ALL_NO, hideCalorieNumbers: true }, today: T });
  assert.equal(e.hideNumbers, true);
  assert.equal(e.noWeightGoals, false);
});
