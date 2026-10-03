/* Laborwerte, die stimmen (Paket D): Einheiten, Lese-Migration der alten Vorbelegung,
   Magnesium Vollblut/Serum, Bereiche je Geschlecht, Kontext der Blutentnahme, ehrlicher
   Trend, Verfallsdatum, Einnahmetreue und die Diagramme dazu. */
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

/* -------------------------------- Einheiten ------------------------------ */

test('Einheiten: in Deutschland gängige Alternativen für (fast) jeden Analyten (HEALTH-04)', () => {
  for (const key of Object.keys(ANALYTES)) {
    if (key === 'transferrinSat' || key === 'b12') continue;   // % bzw. Holo-TC immer in pmol/l
    assert.ok(unitsFor(key).length >= 2, `${key}: nur ${unitsFor(key).join(', ')}`);
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
  // CRP in mg/dl: 1,2 mg/dl = 12 mg/l ist erhöht – und sperrt das Ferritin derselben Blutentnahme.
  const labs = [lab('crp', toCanonical('crp', 1.2, 'mg/dl')), lab('ferritin', 120)];
  assert.equal(assess('crp', labs[0].value, { labs, today: T, record: labs[0] }).status, 'hoch');
  assert.equal(assess('ferritin', 120, { labs, today: T, record: labs[1] }).status, 'unbeurteilbar');
});

test('Plausibilität: weit außerhalb des Üblichen → „Einheit prüfen?“', () => {
  assert.equal(implausible('testosterone', 500, 'm'), true, 'ng/dl als nmol/l eingetippt');
  assert.equal(implausible('ferritin', 1, 'w'), true);
  assert.equal(implausible('ferritin', 60, 'w'), false);
  assert.equal(implausible('crp', 180), false, 'sehr hohes CRP kommt wirklich vor');
});

/* ------------------------ Lese-Migration (Altbestand) --------------------- */

test('Alte Standard-Vorbelegung gilt nicht als „dein Labor“, auch falsch umgerechnet (HEALTH-02)', () => {
  // Vitamin D 30 ng/ml, damals mit Vorbelegung 50/125 und Einheit ng/ml gespeichert:
  const old = lab('vitaminD', 74.88, T, { refLow: 124.8, refHigh: 312 });
  assert.equal(hasOwnRef(migrateLabRecord(old)), false);
  assert.equal(assess('vitaminD', 74.88, { labs: [old], today: T, record: old }).status, 'gut');
  // Unveränderte Hb-Vorbelegung in mmol/l umgerechnet:
  const hb = lab('hb', 13.2, T, { refLow: 12 * 1.6114, refHigh: 16 * 1.6114 });
  assert.equal(assess('hb', 13.2, { sex: 'w', labs: [hb], today: T, record: hb }).status, 'gut');
  // Ein wirklich abgetippter Bereich zählt weiter.
  const own = lab('ferritin', 25, T, { refLow: 30, refHigh: 400, refSource: 'lab' });
  assert.equal(hasOwnRef(own), true);
  assert.equal(assess('ferritin', 25, { labs: [own], today: T, record: own }).status, 'niedrig');
});

test('Magnesium: Vollblut-Bereich 1,3–1,7 statt 1,6–2,4; Altwerte unter 1,2 sind Serum (HEALTH-03)', () => {
  assert.equal(assess('magnesium', 1.45).status, 'gut');
  assert.equal(assess('magnesium', 1.2).status, 'niedrig');
  const legacy = lab('magnesium', 0.85, T, { refLow: 1.6, refHigh: 2.4 });
  const m = migrateLabRecord(legacy);
  assert.equal(m.analyte, 'magnesiumSerum');
  assert.equal(hasOwnRef(m), false, 'alte Vollblut-Vorbelegung gilt nicht');
  const rows = overview([legacy], { sex: 'w', today: T });
  assert.equal(rows[0].label, 'Magnesium (Serum)');
  assert.equal(rows[0].assessment.status, 'gut');
  // Neue Datensätze (schema 2) werden nicht umgedeutet.
  assert.equal(migrateLabRecord({ ...legacy, schema: 2 }).analyte, 'magnesium');
});

/* ---------------------------- Bereiche je Person -------------------------- */

test('Bereiche: Holo-TC ohne Obergrenze, Geschlecht nötig, CK-Sportkorridor (HEALTH-19)', () => {
  assert.notEqual(assess('b12', 200).status, 'hoch');
  assert.equal(assess('b12', 42).status, 'grenzwertig', 'Graubereich 35–50');
  assert.equal(assess('hb', 12.5).status, 'unbeurteilbar', 'ohne Geschlecht kein Vereinigungsbereich');
  assert.equal(assess('hb', 12.5, { sex: 'm' }).status, 'niedrig');
  assert.equal(assess('testosterone', 5, { sex: 'm' }).status, 'niedrig');
  assert.equal(assess('testosterone', 5).status, 'unbeurteilbar');
  assert.equal(assess('estradiol', 300, { sex: 'm' }).status, 'hoch');
  assert.equal(assess('estradiol', 300, { sex: 'w' }).status, 'unbeurteilbar', 'Frauen: nur mit Laborbereich der Zyklusphase');
  const ck = assess('ck', 350, { sex: 'm' });
  assert.equal(ck.status, 'grenzwertig');
  assert.match(ck.label, /für Trainierende häufig/);
  assert.equal(assess('ck', 1500, { sex: 'm' }).status, 'hoch');
  // Schwangerschaft: Hb-Grenze 11,0 (WHO).
  assert.equal(assess('hb', 11.5, { sex: 'w' }).status, 'niedrig');
  assert.equal(assess('hb', 11.5, { sex: 'w', pregnant: true }).status, 'gut');
});

test('Vitamin D: ab 50 nmol/l ausreichend (DGE), unter 30 Mangel (HEALTH-16)', () => {
  assert.equal(assess('vitaminD', 60).status, 'gut');
  const rec = recommend({ labs: [lab('vitaminD', 60)], profile: {}, today: T });
  assert.ok(!rec.items.some((i) => i.key === 'vitaminD'), '50–75 ist kein Anlass für ein Präparat');
  const low = assess('vitaminD', 25);
  assert.equal(low.status, 'niedrig');
  assert.match(low.label, /Mangel/);
});

/* ---------------------------- Kontext der Entnahme ------------------------ */

test('CRP derselben Blutentnahme; niedriges Ferritin trotz Entzündung auffällig (HEALTH-15)', () => {
  const oldFerritin = lab('ferritin', 80, addDays(T, -200));
  const labs = [oldFerritin, lab('crp', 12, T)];
  assert.equal(sameDrawCrp(labs, oldFerritin), null);
  assert.equal(assess('ferritin', 80, { labs, today: T, record: oldFerritin }).status, 'gut', 'ein CRP von heute sperrt keinen alten Wert');
  const draw = [lab('ferritin', 11, T), lab('crp', 8, addDays(T, -1))];
  const a = assess('ferritin', 11, { labs: draw, today: T, record: draw[0] });
  assert.equal(a.status, 'niedrig');
  assert.match(a.label, /trotz Entzündung/);
  const noCrp = assess('ferritin', 80, { labs: [lab('ferritin', 80)], today: T, record: lab('ferritin', 80) });
  assert.ok(noCrp.caveats.some((c) => /Vorbehalt/.test(c)));
});

test('Umstände der Blutentnahme: Belastung, Biotin (HEALTH-25)', () => {
  const ck = lab('ck', 900, T, { exercise48h: true });
  assert.equal(assess('ck', 900, { sex: 'w', labs: [ck], today: T, record: ck }).status, 'unbeurteilbar');
  const crp = lab('crp', 9, T, { exercise48h: true });
  assert.match(assess('crp', 9, { labs: [crp], today: T, record: crp }).blocked, /hart trainiert/);
  const tsh = lab('tsh', 1.2, T, { biotin: true });
  assert.ok(assess('tsh', 1.2, { labs: [tsh], today: T, record: tsh }).caveats.some((c) => /Biotin/.test(c)));
});

/* --------------------------------- Trend ---------------------------------- */

test('Trend: nur in die ungünstige Richtung projiziert, mit Verb je Seite (HEALTH-13)', () => {
  const crpFalling = [lab('crp', 9, addDays(T, -100)), lab('crp', 6, addDays(T, -50)), lab('crp', 2.5, T)];
  const t1 = trend(crpFalling, 'crp');
  assert.equal(t1.dir, 'down');
  assert.equal(t1.daysToLimit, null, 'sinkendes CRP ist keine Warnung');
  const crpRising = [lab('crp', 0.5, addDays(T, -120)), lab('crp', 1.8, addDays(T, -60)), lab('crp', 3, T)];
  const t2 = trend(crpRising, 'crp');
  assert.equal(t2.limitSide, 'high');
  const fer = [lab('ferritin', 88, addDays(T, -330)), lab('ferritin', 72, addDays(T, -220)), lab('ferritin', 58, addDays(T, -110)), lab('ferritin', 47, addDays(T, -12))];
  const t3 = trend(fer, 'ferritin');
  assert.equal(t3.limitSide, 'low');
  assert.ok(t3.daysToLimit > 0 && t3.daysToLimit < 365);
});

test('Trend: Schwankung unter dem Referenzänderungswert ist kein Trend, keine Projektion über 12 Monate (HEALTH-14)', () => {
  const vd = [lab('vitaminD', 110, addDays(T, -150)), lab('vitaminD', 108, addDays(T, -75)), lab('vitaminD', 107.9, T)];
  assert.equal(trend(vd, 'vitaminD').dir, 'flat');
  const hb = [lab('hb', 13.6, addDays(T, -318)), lab('hb', 13.4, addDays(T, -200)), lab('hb', 13.1, T)];
  assert.equal(trend(hb, 'hb', { sex: 'w' }).dir, 'flat');
  const tooShort = [lab('ferritin', 60, addDays(T, -40)), lab('ferritin', 52, addDays(T, -20)), lab('ferritin', 45, T)];
  assert.equal(trend(tooShort, 'ferritin'), null, 'unter 60 Tagen kein Trend');
  const slow = [lab('ferritin', 200, addDays(T, -500)), lab('ferritin', 160, addDays(T, -250)), lab('ferritin', 120, T)];
  assert.equal(trend(slow, 'ferritin').daysToLimit, null, 'mehr als ein Jahr bis zur Grenze: keine Zahl');
});

/* ------------------------------- Verfallsdatum ----------------------------- */

test('Alte Werte tragen keine Vorschläge mehr (HEALTH-18)', () => {
  const summer = lab('vitaminD', 90, '2026-08-20');
  assert.equal(isStale('vitaminD', summer, '2027-01-15'), true);
  const winter = recommend({ labs: [summer], profile: {}, today: '2027-01-15' });
  assert.ok(winter.items.some((i) => i.key === 'vitaminD'), 'Winterhinweis trotz Sommerwert');
  const ancient = recommend({ labs: [lab('ferritin', 12, '2023-05-01')], profile: { sex: 'w' }, today: T });
  assert.ok(!ancient.items.some((i) => i.key === 'iron' && !i.holdOnly), 'kein Eisen-Vorschlag aus einem drei Jahre alten Wert');
  const rows = overview([lab('ferritin', 12, '2023-05-01')], { sex: 'w', today: T });
  assert.equal(rows[0].stale, true);
});

/* ------------------------ Einnahmetreue und Diagramme ---------------------- */

test('Einnahmetreue: keine 0-%-Balken vor Planbeginn, „bei Bedarf“ zählt nicht (HEALTH-31)', () => {
  const supps = [
    { id: 'p1', _kind: 'plan', name: 'Vitamin D', active: true, from: addDays(T, -2) },
    { id: 'p2', _kind: 'plan', name: 'Koffein', active: true, from: addDays(T, -20), frequency: 'bedarf' },
    { id: 'i1', _kind: 'intake', planId: 'p1', date: T },
    { id: 'i2', _kind: 'intake', planId: 'p1', date: addDays(T, -1) },
  ];
  const ser = adherenceSeries(supps, T, 7);
  assert.equal(ser[0].value, null, 'vor dem Planbeginn kein Balken');
  assert.equal(ser.at(-1).value, 100);
  const ad = adherence(supps, T);
  assert.equal(ad.expected, 3, 'nur der tägliche Plan zählt');
});

test('Diagramme: 100-%-Anker, leere Tage, Korridore im Verlauf (FE-10)', () => {
  const svg = barChart([{ label: 'a', value: 50 }, { label: 'b', value: null }, { label: 'c', value: 100 }], { min: 100, height: 90 });
  const rects = find(svg, (n) => n.tagName === 'RECT');
  assert.equal(rects.length, 2, 'für den leeren Tag kein Balken');
  const h = rects.map((r) => Number(r.getAttribute('height')));
  assert.ok(Math.abs(h[0] * 2 - h[1]) < 1, `50 % ist halb so hoch wie 100 % (${h})`);
  const chart = lineChart([{ label: 'x', value: 20 }, { label: 'y', value: 34 }], { bands: [{ lo: 40, hi: 200, kind: 'fill' }, { lo: 15, hi: 300, kind: 'frame' }] });
  assert.ok(find(chart, (n) => (n.getAttribute && /chart-band--fill/.test(n.getAttribute('class') || ''))).length === 1);
  assert.ok(find(chart, (n) => (n.getAttribute && /chart-band--frame/.test(n.getAttribute('class') || ''))).length >= 1);
});
