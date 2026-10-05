/* =========================================================================
   Tests for lab values, the supplement rule set and the safety limits
   (js/labs.js, js/supplements.js, js/redflags.js).
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import { toCanonical, refRange, hasOwnRef, assess, trend, overview, unitsFor, latest } from '../js/labs.js';
import { LAB_SOURCES, LAB_STANDARDS } from '../js/labsources.js';
import { recommend, activePlans, takenOn, adherence } from '../js/supplements.js';
import { eligibility, redFlags, energyAvailability, leanMass, EA_LOW } from '../js/redflags.js';

const T = '2026-08-02';
const lab = (analyte, value, date, extra = {}) => ({ id: `l-${analyte}-${date}-${value}`, analyte, value, date, ...extra });

test('labsources: every route to a lab test is fully described', () => {
  assert.ok(LAB_SOURCES.length >= 4);
  LAB_SOURCES.forEach((s) => {
    ['key', 'title', 'what', 'cost', 'tip'].forEach((f) => {
      assert.ok(s[f] && String(s[f]).length > 3, `${s.key}: ${f} is missing`);
    });
  });
  // Exactly one route is marked as the best fit (sports medicine).
  assert.equal(LAB_SOURCES.filter((s) => s.best).length, 1);
  assert.ok(LAB_STANDARDS.regulated.length && LAB_STANDARDS.notRegulated.length);
});

/* ------------------------------ Units -------------------------------- */

test('labs: unit conversion (the classic vitamin D trap)', () => {
  // 30 ng/ml is 74.9 nmol/l – anyone who mixes up the unit is off by a factor of 2.5.
  assert.equal(toCanonical('vitaminD', 30, 'ng/ml'), 74.88);
  assert.equal(toCanonical('vitaminD', 75, 'nmol/l'), 75);
  assert.equal(toCanonical('hb', 8, 'mmol/l'), 12.891);
  assert.equal(toCanonical('ferritin', 'keine Zahl', 'µg/l'), null);
  assert.ok(unitsFor('vitaminD').includes('ng/ml'));
});

test('labs: the reference range depends on sex where it is clinically necessary', () => {
  assert.deepEqual(refRange('hb', 'm'), [13.5, 17.5]);
  assert.deepEqual(refRange('hb', 'w'), [12.0, 16.0]);
  assert.deepEqual(refRange('ferritin', 'w'), [15, 300]); // no sex difference
});

/* ------------- Reference range of the own lab (v3.19.0) --------------- */

test('labs: the reference range from the own report beats the default', () => {
  // In Germany every lab states its own ranges – the report wins.
  const rec = { analyte: 'ferritin', value: 14, date: T, refLow: 13, refHigh: 150 };
  assert.deepEqual(refRange('ferritin', 'w', rec), [13, 150]);
  // Without an own range the stored default still applies.
  assert.deepEqual(refRange('ferritin', 'w', null), [15, 300]);
  assert.equal(hasOwnRef(rec), true);
  assert.equal(hasOwnRef({ analyte: 'ferritin', value: 14 }), false);
});

test('labs: an own reference range changes the assessment', () => {
  const value = 14;
  // Default 15–300: 14 is below it.
  assert.equal(assess('ferritin', value, { sex: 'w' }).status, 'niedrig');
  // Lab with a lower limit of 13: the same value is "within the normal range" – but still
  // borderline for sport, the athletic target corridor is unaffected.
  const own = assess('ferritin', value, { sex: 'w', record: { refLow: 13, refHigh: 150 } });
  assert.equal(own.status, 'grenzwertig');
  assert.deepEqual(own.ref, [13, 150]);
  assert.equal(own.ownRef, true);
});

test('labs: incomplete or nonsensical reference values are ignored', () => {
  for (const rec of [{ refLow: 13 }, { refHigh: 150 }, { refLow: 200, refHigh: 20 }, { refLow: null, refHigh: null }]) {
    assert.deepEqual(refRange('ferritin', 'w', rec), [15, 300], `Fallback to the default for ${JSON.stringify(rec)}`);
    assert.equal(hasOwnRef(rec), false);
  }
});

test('labs: the overview uses the reference range of the most recent report', () => {
  const labs = [
    lab('ferritin', 20, addDays(T, -200)),
    lab('ferritin', 14, T, { refLow: 13, refHigh: 150 }),
  ];
  const row = overview(labs, { sex: 'w', today: T })[0];
  assert.equal(row.assessment.ownRef, true);
  assert.deepEqual(row.assessment.ref, [13, 150]);
});

/* ------------------------------ Assessment -------------------------------- */

test('labs: the sport target corridor is stricter than the lab range', () => {
  // Ferritin 25 counts as normal in the lab but is borderline for endurance sport.
  const a = assess('ferritin', 25, { sex: 'w', labs: [], today: T });
  assert.equal(a.status, 'grenzwertig');
  assert.equal(a.tone, 'warn');
  // Below the lab limit it becomes clear-cut.
  assert.equal(assess('ferritin', 9, { sex: 'w' }).status, 'niedrig');
  // Within the sport target range everything is fine.
  assert.equal(assess('ferritin', 60, { sex: 'w' }).status, 'gut');
});

test('labs: ferritin cannot be assessed when CRP is elevated (acute-phase protein)', () => {
  const labs = [lab('crp', 18, addDays(T, -2)), lab('ferritin', 80, T)];
  const a = assess('ferritin', 80, { sex: 'w', labs, today: T });
  assert.equal(a.status, 'unbeurteilbar');
  assert.match(a.blocked, /CRP/);
  // Without inflammation the same value would be good.
  assert.equal(assess('ferritin', 80, { sex: 'w', labs: [], today: T }).status, 'gut');
});

/* -------------------------------- Trend ---------------------------------- */

test('labs: a falling trend is detected and projected', () => {
  const labs = [
    lab('ferritin', 90, addDays(T, -180)),
    lab('ferritin', 75, addDays(T, -120)),
    lab('ferritin', 60, addDays(T, -60)),
    lab('ferritin', 50, T),
  ];
  const t = trend(labs, 'ferritin', { sex: 'w' });
  assert.equal(t.dir, 'down');
  assert.ok(t.perMonth < 0);
  assert.ok(t.daysToLimit > 0, 'projection to the sport limit present');
  assert.equal(t.limit, 40);
});

test('labs: fewer than three measurements give no trend', () => {
  assert.equal(trend([lab('ferritin', 50, T), lab('ferritin', 40, addDays(T, -30))], 'ferritin'), null);
});

test('labs: the overview sorts abnormal values to the top', () => {
  const labs = [lab('ferritin', 12, T), lab('vitaminD', 90, T), lab('magnesium', 2.0, T)];
  const rows = overview(labs, { sex: 'w', today: T });
  assert.equal(rows[0].key, 'ferritin', 'the abnormal value comes first');
  assert.equal(rows[0].assessment.status, 'niedrig');
  assert.equal(latest(labs, 'vitaminD', T).value, 90);
});

/* ------------------------------ Gate / flags ---------------------------- */

test('redflags: the gate switches to documentation mode', () => {
  assert.equal(eligibility({}).answered, false);
  assert.equal(eligibility({ chronicCondition: false, medication: false }).mode, 'full');
  const doc = eligibility({ medication: true });
  assert.equal(doc.mode, 'documentation');
  assert.equal(doc.reasons.length, 1);
});

test('redflags: critical values lead to a referral to a doctor instead of a recommendation', () => {
  const flags = redFlags({ labs: [lab('hb', 9.5, T)], today: T });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, 'stop');
  assert.match(flags[0].advice, /ärztlich/);
  assert.equal(redFlags({ labs: [lab('hb', 13.5, T)], today: T }).length, 0);
});

test('redflags: a period missing for months is a red flag (RED-S)', () => {
  const cycle = [{ id: 'c1', startDate: addDays(T, -140) }];
  const flags = redFlags({ labs: [], cycle, today: T });
  assert.equal(flags.length, 1);
  assert.match(flags[0].advice, /Energiemangel|RED-S/);
  // Fresh entry -> no flag.
  assert.equal(redFlags({ labs: [], cycle: [{ id: 'c1', startDate: addDays(T, -20) }], today: T }).length, 0);
});

/* -------------------- Energy availability (RED-S/LEA) -------------------- */

test('redflags: leanMass needs a plausible body-fat value', () => {
  assert.equal(leanMass(70, 20), 56);
  assert.equal(leanMass(70, null), null);
  assert.equal(leanMass(null, 20), null);
});

test('redflags: energy availability detects a critical deficit', () => {
  // Profile without BMR data -> the plausibility check does not apply,
  // the pure EA calculation is tested.
  const profile = { weightKg: 60, sex: 'w', activityFactor: 1.35 };
  const health = [{ id: 'h1', date: addDays(T, -3), weight: 60, bodyFat: 20 }];
  const diary = [], sessions = [];
  // 7 days: only 1500 kcal eaten, an easy one-hour run every day – every day
  // confirmed as fully logged (otherwise the app deliberately does not assess).
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 1500 });
    diary.push({ id: `day-${d}`, _kind: 'day', date: d, complete: true });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 10, durationSec: 3600 });
  }
  const ea = energyAvailability({ profile, health, sessions, diary, today: T });
  assert.ok(ea, 'result present');
  assert.equal(ea.ffm, 48);
  assert.ok(ea.ea < EA_LOW, `EA below the critical threshold, was ${ea.ea}`);
  assert.equal(ea.level, 'kritisch');
  assert.match(ea.hint, /Iss mehr/);
});

test('redflags: a patchy diary is not reported as energy deficiency', () => {
  // No assessment without confirmed days – but with a count instead of a silent guess.
  const profile = { weightKg: 60, heightCm: 170, birthYear: 1990, sex: 'w' };
  const health = [{ id: 'h1', date: T, weight: 60, bodyFat: 20 }];
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 1400 });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 8, durationSec: 2880 });
  }
  const ea = energyAvailability({ profile, health, sessions, diary, today: T });
  assert.equal(ea.level, 'unklar', 'no deficiency assessment from unconfirmed days');
  assert.equal(ea.confirmedDays, 0);
  assert.match(ea.hint, /0 von 7 Tagen/);

  // HEALTH-06: fully confirmed and still low -> is assessed, even below
  // 1.2 × BMR (this exact case used to stay "unclear" permanently).
  const confirmed = [...diary, ...diary.map((d) => ({ id: `day-${d.date}`, _kind: 'day', date: d.date, complete: true }))];
  const ea2 = energyAvailability({ profile, health, sessions, diary: confirmed, today: T });
  assert.notEqual(ea2.level, 'unklar', 'confirmed days are assessed');
  assert.equal(ea2.level, 'kritisch');
  assert.equal(ea2.confirmedDays, 7);
});

test('redflags: no assessment with too few logged days (no false alarm)', () => {
  const profile = { weightKg: 60 };
  const health = [{ id: 'h1', date: T, weight: 60, bodyFat: 20 }];
  // Only two logged days -> the gaps must not count as days of hunger.
  const diary = [{ id: 'd1', date: T, kcal: 2000 }, { id: 'd2', date: addDays(T, -1), kcal: 2100 }];
  assert.equal(energyAvailability({ profile, health, sessions: [], diary, today: T }), null);
});

/* ------------------------------ Supplements ------------------------------ */

test('supplements: iron is never recommended without a lab value', () => {
  const rec = recommend({ labs: [], profile: { sex: 'w' }, sessions: [], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(!iron || iron.holdOnly, 'without a report at most the advice to get tested');
});

test('supplements: low ferritin leads to a lab-based recommendation', () => {
  const labs = [lab('ferritin', 18, addDays(T, -10))];
  const rec = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron);
  assert.equal(iron.priority, 1);
  assert.match(iron.reason, /Ferritin 18/);
  assert.match(iron.action, /abklären/);
  assert.ok(iron.food, 'food-first hint present');
});

test('supplements: the recommendation is assessed against THE reference range of the report (v3.19.0)', () => {
  // Same value, own lab range 13–150: the values list says "within the
  // normal range, borderline for sport" – the recommendation below must say the same.
  const labs = [lab('ferritin', 14, T, { refLow: 13, refHigh: 150 })];
  const iron = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T })
    .items.find((i) => i.key === 'iron');
  assert.ok(iron);
  assert.match(iron.reason, /im Normbereich/);
  assert.ok(!/unter dem Referenzbereich/.test(iron.reason), 'no contradiction with the values list');

  // Without an own range the default (15–300) still applies -> "below the reference range".
  const std = recommend({ labs: [lab('ferritin', 14, T)], profile: { sex: 'w' }, sessions: [], today: T })
    .items.find((i) => i.key === 'iron');
  assert.match(std.reason, /unter dem Referenzbereich/);
});

test('supplements: with inflammation iron is put on hold instead of being recommended', () => {
  // High ferritin with inflammation: cannot be assessed.
  const high = recommend({ labs: [lab('crp', 25, T), lab('ferritin', 120, T)], profile: { sex: 'w' }, sessions: [], today: T });
  const hold = high.items.find((i) => i.key === 'iron');
  assert.ok(hold && hold.holdOnly, 'no intake recommendation with elevated CRP');
  assert.match(hold.reason, /CRP/);
  // Low ferritin stays abnormal even with inflammation (WHO 2020) – but for a doctor, not as a plan.
  const low = recommend({ labs: [lab('crp', 25, T), lab('ferritin', 18, T)], profile: { sex: 'w' }, sessions: [], today: T });
  const iron = low.items.find((i) => i.key === 'iron');
  assert.ok(iron && iron.holdOnly, 'no "Add to my plan" with inflammation');
  assert.match(iron.reason, /trotz Entzündung niedrig/);
  assert.match(iron.reason, /CRP/);
});

test('supplements: a vegan diet justifies B12 even without a lab value', () => {
  const rec = recommend({ labs: [], profile: {}, sessions: [], today: T, diet: 'vegan' });
  const b12 = rec.items.find((i) => i.key === 'b12');
  assert.ok(b12 && b12.priority === 1);
});

test('supplements: interactions only between supplements that are actually suggested', () => {
  const labs = [lab('ferritin', 15, T), lab('magnesium', 1.25, T)];   // whole blood below 1.3 mmol/l
  const rec = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T });
  assert.ok(rec.interactions.some((t) => /Eisen/.test(t) && /Magnesium/.test(t)));
  // Without a magnesium suggestion no magnesium interaction.
  const only = recommend({ labs: [lab('ferritin', 15, T)], profile: { sex: 'w' }, sessions: [], today: T });
  assert.ok(!only.interactions.some((t) => /Magnesium/.test(t)));
});

test('supplements: vitamin D is raised in winter even without a lab value', () => {
  const winter = recommend({ labs: [], profile: {}, sessions: [], today: '2026-01-15' });
  assert.ok(winter.items.some((i) => i.key === 'vitaminD'));
  const summer = recommend({ labs: [], profile: {}, sessions: [], today: '2026-07-15' });
  assert.ok(!summer.items.some((i) => i.key === 'vitaminD'));
});

/* --------------------------- Intake log -------------------------- */

test('supplements: plan, ticking off and adherence', () => {
  const supps = [
    { id: 'p1', _kind: 'plan', name: 'Magnesium', active: true, from: addDays(T, -13) },
    { id: 'p2', _kind: 'plan', name: 'Altes', active: false },
  ];
  assert.equal(activePlans(supps, T).length, 1);
  assert.equal(takenOn(supps, 'p1', T), false);

  // 7 of 14 days ticked off.
  for (let i = 0; i < 7; i++) supps.push({ id: `i${i}`, _kind: 'intake', planId: 'p1', date: addDays(T, -i) });
  assert.equal(takenOn(supps, 'p1', T), true);
  const ad = adherence(supps, T, 14);
  assert.equal(ad.expected, 14);
  assert.equal(ad.taken, 7);
  assert.equal(ad.pct, 50);
});
