/* Lab values that are right (package D): units, read-time migration of the old pre-filled
   defaults, magnesium whole blood/serum, ranges by sex, context of the blood draw, honest
   trend, expiry date, adherence to intake and the charts for it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/ui.js';
import {
  ANALYTES, unitsFor, toCanonical, fromCanonical, assess, trend, overview, hasOwnRef,
  migrateLabRecord, isStale, implausible, sameDrawCrp,
} from '../js/labs.js';
import { recommend, adherence, adherenceSeries } from '../js/supplements.js';
import { barChart, lineChart } from '../js/charts.js';

const T = '2026-09-29';
const lab = (analyte, value, date = T, extra = {}) => ({ id: `l-${analyte}-${date}-${value}`, analyte, value, date, ...extra });
const find = (node, pred) => {
  const out = [];
  const walk = (n) => { if (!n || !n.childNodes) return; if (pred(n)) out.push(n); n.childNodes.forEach(walk); };
  walk(node);
  return out;
};

/* -------------------------------- Units ------------------------------ */

test('Units: alternatives common in Germany for (almost) every analyte (HEALTH-04)', () => {
  for (const key of Object.keys(ANALYTES)) {
    if (key === 'transferrinSat' || key === 'b12') continue;   // % and holo-TC respectively, always in pmol/l
    assert.ok(unitsFor(key).length >= 2, `${key}: only ${unitsFor(key).join(', ')}`);
  }
  assert.equal(toCanonical('crp', 1.2, 'mg/dl'), 12);
  assert.equal(toCanonical('folate', 8, 'ng/ml'), 18.128);
  assert.equal(toCanonical('testosterone', 5, 'ng/ml'), 17.335);
  assert.equal(toCanonical('estradiol', 30, 'pg/ml'), 110.13);
  assert.equal(toCanonical('zinc', 80, 'µg/dl'), 12.24);
  assert.equal(toCanonical('urea', 30, 'mg/dl'), 4.995);
  assert.equal(toCanonical('ck', 2.5, 'µkat/l'), 150);
  assert.equal(toCanonical('b12total', 400, 'pg/ml'), 295.2);
  assert.equal(fromCanonical('vitaminD', 124.8, 'ng/ml'), 50);
  // CRP in mg/dl: 1.2 mg/dl = 12 mg/l is elevated – and blocks the ferritin from the same blood draw.
  const labs = [lab('crp', toCanonical('crp', 1.2, 'mg/dl')), lab('ferritin', 120)];
  assert.equal(assess('crp', labs[0].value, { labs, today: T, record: labs[0] }).status, 'hoch');
  assert.equal(assess('ferritin', 120, { labs, today: T, record: labs[1] }).status, 'unbeurteilbar');
});

test('Plausibility: far outside the usual range → unit warning', () => {
  assert.equal(implausible('testosterone', 500, 'm'), true, 'ng/dl typed in as nmol/l');
  assert.equal(implausible('ferritin', 1, 'w'), true);
  assert.equal(implausible('ferritin', 60, 'w'), false);
  assert.equal(implausible('crp', 180), false, 'a very high CRP really does occur');
});

/* ------------------------ Read-time migration (legacy data) --------------------- */

test('The old default pre-fill does not count as the own lab range, even when wrongly converted (HEALTH-02)', () => {
  // Vitamin D 30 ng/ml, saved back then with the pre-fill 50/125 and the unit ng/ml:
  const old = lab('vitaminD', 74.88, T, { refLow: 124.8, refHigh: 312 });
  assert.equal(hasOwnRef(migrateLabRecord(old)), false);
  assert.equal(assess('vitaminD', 74.88, { labs: [old], today: T, record: old }).status, 'gut');
  // Unchanged Hb pre-fill converted to mmol/l:
  const hb = lab('hb', 13.2, T, { refLow: 12 * 1.6114, refHigh: 16 * 1.6114 });
  assert.equal(assess('hb', 13.2, { sex: 'w', labs: [hb], today: T, record: hb }).status, 'gut');
  // A range that was really typed in still counts.
  const own = lab('ferritin', 25, T, { refLow: 30, refHigh: 400, refSource: 'lab' });
  assert.equal(hasOwnRef(own), true);
  assert.equal(assess('ferritin', 25, { labs: [own], today: T, record: own }).status, 'niedrig');
});

test('Magnesium: whole-blood range 1.3–1.7 instead of 1.6–2.4; legacy values below 1.2 are serum (HEALTH-03)', () => {
  assert.equal(assess('magnesium', 1.45).status, 'gut');
  assert.equal(assess('magnesium', 1.2).status, 'niedrig');
  const legacy = lab('magnesium', 0.85, T, { refLow: 1.6, refHigh: 2.4 });
  const m = migrateLabRecord(legacy);
  assert.equal(m.analyte, 'magnesiumSerum');
  assert.equal(hasOwnRef(m), false, 'old whole-blood pre-fill does not count');
  const rows = overview([legacy], { sex: 'w', today: T });
  assert.equal(rows[0].label, 'Magnesium (Serum)');
  assert.equal(rows[0].assessment.status, 'gut');
  // New records (schema 2) are not reinterpreted.
  assert.equal(migrateLabRecord({ ...legacy, schema: 2 }).analyte, 'magnesium');
});

/* ---------------------------- Ranges per person -------------------------- */

test('Ranges: holo-TC without an upper limit, sex required, CK sport corridor (HEALTH-19)', () => {
  assert.notEqual(assess('b12', 200).status, 'hoch');
  assert.equal(assess('b12', 42).status, 'grenzwertig', 'grey zone 35–50');
  assert.equal(assess('hb', 12.5).status, 'unbeurteilbar', 'without sex no combined range');
  assert.equal(assess('hb', 12.5, { sex: 'm' }).status, 'niedrig');
  assert.equal(assess('testosterone', 5, { sex: 'm' }).status, 'niedrig');
  assert.equal(assess('testosterone', 5).status, 'unbeurteilbar');
  assert.equal(assess('estradiol', 300, { sex: 'm' }).status, 'hoch');
  assert.equal(assess('estradiol', 300, { sex: 'w' }).status, 'unbeurteilbar', 'women: only with the lab range for the cycle phase');
  const ck = assess('ck', 350, { sex: 'm' });
  assert.equal(ck.status, 'grenzwertig');
  assert.match(ck.label, /für Trainierende häufig/);
  assert.equal(assess('ck', 1500, { sex: 'm' }).status, 'hoch');
  // Pregnancy: Hb limit 11.0 (WHO).
  assert.equal(assess('hb', 11.5, { sex: 'w' }).status, 'niedrig');
  assert.equal(assess('hb', 11.5, { sex: 'w', pregnant: true }).status, 'gut');
});

test('Vitamin D: sufficient from 50 nmol/l (DGE), deficient below 30 (HEALTH-16)', () => {
  assert.equal(assess('vitaminD', 60).status, 'gut');
  const rec = recommend({ labs: [lab('vitaminD', 60)], profile: {}, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'vitaminD'), '50–75 is no reason for a supplement');
  const low = assess('vitaminD', 25);
  assert.equal(low.status, 'niedrig');
  assert.match(low.label, /Mangel/);
});

/* ---------------------------- Context of the draw ------------------------ */

test('CRP from the same blood draw; low ferritin is flagged despite inflammation (HEALTH-15)', () => {
  const oldFerritin = lab('ferritin', 80, addDays(T, -200));
  const labs = [oldFerritin, lab('crp', 12, T)];
  assert.equal(sameDrawCrp(labs, oldFerritin), null);
  assert.equal(assess('ferritin', 80, { labs, today: T, record: oldFerritin }).status, 'gut', 'a CRP from today does not block an old value');
  const draw = [lab('ferritin', 11, T), lab('crp', 8, addDays(T, -1))];
  const a = assess('ferritin', 11, { labs: draw, today: T, record: draw[0] });
  assert.equal(a.status, 'niedrig');
  assert.match(a.label, /trotz Entzündung/);
  const noCrp = assess('ferritin', 80, { labs: [lab('ferritin', 80)], today: T, record: lab('ferritin', 80) });
  assert.ok(noCrp.caveats.some((c) => /Vorbehalt/.test(c)));
});

test('Circumstances of the blood draw: exertion, biotin (HEALTH-25)', () => {
  const ck = lab('ck', 900, T, { exercise48h: true });
  assert.equal(assess('ck', 900, { sex: 'w', labs: [ck], today: T, record: ck }).status, 'unbeurteilbar');
  const crp = lab('crp', 9, T, { exercise48h: true });
  assert.match(assess('crp', 9, { labs: [crp], today: T, record: crp }).blocked, /hart trainiert/);
  const tsh = lab('tsh', 1.2, T, { biotin: true });
  assert.ok(assess('tsh', 1.2, { labs: [tsh], today: T, record: tsh }).caveats.some((c) => /Biotin/.test(c)));
});

/* --------------------------------- Trend ---------------------------------- */

test('Trend: projected only in the unfavourable direction, with a verb per side (HEALTH-13)', () => {
  const crpFalling = [lab('crp', 9, addDays(T, -100)), lab('crp', 6, addDays(T, -50)), lab('crp', 2.5, T)];
  const t1 = trend(crpFalling, 'crp');
  assert.equal(t1.dir, 'down');
  assert.equal(t1.daysToLimit, null, 'a falling CRP is not a warning');
  const crpRising = [lab('crp', 0.5, addDays(T, -120)), lab('crp', 1.8, addDays(T, -60)), lab('crp', 3, T)];
  const t2 = trend(crpRising, 'crp');
  assert.equal(t2.limitSide, 'high');
  const fer = [lab('ferritin', 88, addDays(T, -330)), lab('ferritin', 72, addDays(T, -220)), lab('ferritin', 58, addDays(T, -110)), lab('ferritin', 47, addDays(T, -12))];
  const t3 = trend(fer, 'ferritin');
  assert.equal(t3.limitSide, 'low');
  assert.ok(t3.daysToLimit > 0 && t3.daysToLimit < 365);
});

test('Trend: fluctuation below the reference change value is not a trend, no projection beyond 12 months (HEALTH-14)', () => {
  const vd = [lab('vitaminD', 110, addDays(T, -150)), lab('vitaminD', 108, addDays(T, -75)), lab('vitaminD', 107.9, T)];
  assert.equal(trend(vd, 'vitaminD').dir, 'flat');
  const hb = [lab('hb', 13.6, addDays(T, -318)), lab('hb', 13.4, addDays(T, -200)), lab('hb', 13.1, T)];
  assert.equal(trend(hb, 'hb', { sex: 'w' }).dir, 'flat');
  const tooShort = [lab('ferritin', 60, addDays(T, -40)), lab('ferritin', 52, addDays(T, -20)), lab('ferritin', 45, T)];
  assert.equal(trend(tooShort, 'ferritin'), null, 'no trend below 60 days');
  const slow = [lab('ferritin', 200, addDays(T, -500)), lab('ferritin', 160, addDays(T, -250)), lab('ferritin', 120, T)];
  assert.equal(trend(slow, 'ferritin').daysToLimit, null, 'more than a year to the limit: no number');
});

/* ------------------------------- Expiry date ----------------------------- */

test('Old values no longer back any suggestions (HEALTH-18)', () => {
  const summer = lab('vitaminD', 90, '2026-08-20');
  assert.equal(isStale('vitaminD', summer, '2027-01-15'), true);
  const winter = recommend({ labs: [summer], profile: {}, today: '2027-01-15' });
  assert.ok(winter.items.some((i) => i.key === 'vitaminD'), 'winter hint despite a summer value');
  const ancient = recommend({ labs: [lab('ferritin', 12, '2023-05-01')], profile: { sex: 'w' }, today: T });
  assert.ok(!ancient.items.some((i) => i.key === 'iron' && !i.holdOnly), 'no iron suggestion from a three-year-old value');
  const rows = overview([lab('ferritin', 12, '2023-05-01')], { sex: 'w', today: T });
  assert.equal(rows[0].stale, true);
});

/* ------------------------ Adherence and charts ---------------------- */

test('Adherence: no 0 % bars before the plan starts, "as needed" does not count (HEALTH-31)', () => {
  const supps = [
    { id: 'p1', _kind: 'plan', name: 'Vitamin D', active: true, from: addDays(T, -2) },
    { id: 'p2', _kind: 'plan', name: 'Koffein', active: true, from: addDays(T, -20), frequency: 'bedarf' },
    { id: 'i1', _kind: 'intake', planId: 'p1', date: T },
    { id: 'i2', _kind: 'intake', planId: 'p1', date: addDays(T, -1) },
  ];
  const ser = adherenceSeries(supps, T, 7);
  assert.equal(ser[0].value, null, 'no bar before the plan starts');
  assert.equal(ser.at(-1).value, 100);
  const ad = adherence(supps, T);
  assert.equal(ad.expected, 3, 'only the daily plan counts');
});

test('Charts: 100 % anchor, empty days, corridors in the trend (FE-10)', () => {
  const svg = barChart([{ label: 'a', value: 50 }, { label: 'b', value: null }, { label: 'c', value: 100 }], { min: 100, height: 90 });
  const rects = find(svg, (n) => n.tagName === 'RECT');
  assert.equal(rects.length, 2, 'no bar for the empty day');
  const h = rects.map((r) => Number(r.getAttribute('height')));
  assert.ok(Math.abs(h[0] * 2 - h[1]) < 1, `50 % is half as tall as 100 % (${h})`);
  const chart = lineChart([{ label: 'x', value: 20 }, { label: 'y', value: 34 }], { bands: [{ lo: 40, hi: 200, kind: 'fill' }, { lo: 15, hi: 300, kind: 'frame' }] });
  assert.ok(find(chart, (n) => (n.getAttribute && /chart-band--fill/.test(n.getAttribute('class') || ''))).length === 1);
  assert.ok(find(chart, (n) => (n.getAttribute && /chart-band--frame/.test(n.getAttribute('class') || ''))).length >= 1);
});
