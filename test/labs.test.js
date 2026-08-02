/* =========================================================================
   Tests für Laborwerte, Supplement-Regelwerk und die Sicherheitsschranken
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

test('labsources: jeder Bezugsweg ist vollständig beschrieben', () => {
  assert.ok(LAB_SOURCES.length >= 4);
  LAB_SOURCES.forEach((s) => {
    ['key', 'title', 'what', 'cost', 'tip'].forEach((f) => {
      assert.ok(s[f] && String(s[f]).length > 3, `${s.key}: ${f} fehlt`);
    });
  });
  // Genau ein Weg ist als „passt am besten" markiert (die Sportmedizin).
  assert.equal(LAB_SOURCES.filter((s) => s.best).length, 1);
  assert.ok(LAB_STANDARDS.regulated.length && LAB_STANDARDS.notRegulated.length);
});

/* ------------------------------ Einheiten -------------------------------- */

test('labs: Einheiten-Umrechnung (die klassische Vitamin-D-Falle)', () => {
  // 30 ng/ml sind 74,9 nmol/l – wer die Einheit verwechselt, liegt um Faktor 2,5 daneben.
  assert.equal(toCanonical('vitaminD', 30, 'ng/ml'), 74.88);
  assert.equal(toCanonical('vitaminD', 75, 'nmol/l'), 75);
  assert.equal(toCanonical('hb', 8, 'mmol/l'), 12.891);
  assert.equal(toCanonical('ferritin', 'keine Zahl', 'µg/l'), null);
  assert.ok(unitsFor('vitaminD').includes('ng/ml'));
});

test('labs: Referenzbereich ist geschlechtsabhängig, wo es fachlich nötig ist', () => {
  assert.deepEqual(refRange('hb', 'm'), [13.5, 17.5]);
  assert.deepEqual(refRange('hb', 'w'), [12.0, 16.0]);
  assert.deepEqual(refRange('ferritin', 'w'), [15, 300]); // ohne Geschlechtsunterschied
});

/* ------------- Referenzbereich des eigenen Labors (v3.19.0) --------------- */

test('labs: der Referenzbereich vom eigenen Befund schlägt den Standard', () => {
  // In Deutschland gibt jedes Labor eigene Bereiche an – der Befund gewinnt.
  const rec = { analyte: 'ferritin', value: 14, date: T, refLow: 13, refHigh: 150 };
  assert.deepEqual(refRange('ferritin', 'w', rec), [13, 150]);
  // Ohne eigenen Bereich gilt weiter der hinterlegte Standard.
  assert.deepEqual(refRange('ferritin', 'w', null), [15, 300]);
  assert.equal(hasOwnRef(rec), true);
  assert.equal(hasOwnRef({ analyte: 'ferritin', value: 14 }), false);
});

test('labs: eigener Referenzbereich ändert die Bewertung', () => {
  const value = 14;
  // Standard 15–300: 14 liegt darunter.
  assert.equal(assess('ferritin', value, { sex: 'w' }).status, 'niedrig');
  // Labor mit Untergrenze 13: derselbe Wert ist „im Normbereich" – aber für
  // Sport weiterhin knapp, der sportliche Zielkorridor bleibt unberührt.
  const own = assess('ferritin', value, { sex: 'w', record: { refLow: 13, refHigh: 150 } });
  assert.equal(own.status, 'grenzwertig');
  assert.deepEqual(own.ref, [13, 150]);
  assert.equal(own.ownRef, true);
});

test('labs: unvollständige oder unsinnige Referenzangaben werden ignoriert', () => {
  for (const rec of [{ refLow: 13 }, { refHigh: 150 }, { refLow: 200, refHigh: 20 }, { refLow: null, refHigh: null }]) {
    assert.deepEqual(refRange('ferritin', 'w', rec), [15, 300], `Rückfall auf Standard bei ${JSON.stringify(rec)}`);
    assert.equal(hasOwnRef(rec), false);
  }
});

test('labs: Übersicht nutzt den Referenzbereich des jüngsten Befunds', () => {
  const labs = [
    lab('ferritin', 20, addDays(T, -200)),
    lab('ferritin', 14, T, { refLow: 13, refHigh: 150 }),
  ];
  const row = overview(labs, { sex: 'w', today: T })[0];
  assert.equal(row.assessment.ownRef, true);
  assert.deepEqual(row.assessment.ref, [13, 150]);
});

/* ------------------------------ Bewertung -------------------------------- */

test('labs: Sport-Zielkorridor ist strenger als der Laborbereich', () => {
  // Ferritin 25 gilt im Labor als normal, ist für Ausdauersport aber knapp.
  const a = assess('ferritin', 25, { sex: 'w', labs: [], today: T });
  assert.equal(a.status, 'grenzwertig');
  assert.equal(a.tone, 'warn');
  // Unter der Laborgrenze wird es deutlich.
  assert.equal(assess('ferritin', 9, { sex: 'w' }).status, 'niedrig');
  // Im Sport-Zielbereich ist alles gut.
  assert.equal(assess('ferritin', 60, { sex: 'w' }).status, 'gut');
});

test('labs: Ferritin ist bei erhöhtem CRP nicht beurteilbar (Akutphaseprotein)', () => {
  const labs = [lab('crp', 18, addDays(T, -2)), lab('ferritin', 80, T)];
  const a = assess('ferritin', 80, { sex: 'w', labs, today: T });
  assert.equal(a.status, 'unbeurteilbar');
  assert.match(a.blocked, /CRP/);
  // Ohne Entzündung wäre derselbe Wert gut.
  assert.equal(assess('ferritin', 80, { sex: 'w', labs: [], today: T }).status, 'gut');
});

/* -------------------------------- Trend ---------------------------------- */

test('labs: fallender Trend wird erkannt und projiziert', () => {
  const labs = [
    lab('ferritin', 90, addDays(T, -180)),
    lab('ferritin', 75, addDays(T, -120)),
    lab('ferritin', 60, addDays(T, -60)),
    lab('ferritin', 50, T),
  ];
  const t = trend(labs, 'ferritin', { sex: 'w' });
  assert.equal(t.dir, 'down');
  assert.ok(t.perMonth < 0);
  assert.ok(t.daysToLimit > 0, 'Projektion bis zum Sport-Grenzwert vorhanden');
  assert.equal(t.limit, 40);
});

test('labs: unter drei Messungen gibt es keinen Trend', () => {
  assert.equal(trend([lab('ferritin', 50, T), lab('ferritin', 40, addDays(T, -30))], 'ferritin'), null);
});

test('labs: Übersicht sortiert Auffälliges nach oben', () => {
  const labs = [lab('ferritin', 12, T), lab('vitaminD', 90, T), lab('magnesium', 2.0, T)];
  const rows = overview(labs, { sex: 'w', today: T });
  assert.equal(rows[0].key, 'ferritin', 'der auffällige Wert steht vorn');
  assert.equal(rows[0].assessment.status, 'niedrig');
  assert.equal(latest(labs, 'vitaminD', T).value, 90);
});

/* ------------------------------ Gate / Flaggen ---------------------------- */

test('redflags: Gate schaltet in den Dokumentationsmodus', () => {
  assert.equal(eligibility({}).answered, false);
  assert.equal(eligibility({ chronicCondition: false, medication: false }).mode, 'full');
  const doc = eligibility({ medication: true });
  assert.equal(doc.mode, 'documentation');
  assert.equal(doc.reasons.length, 1);
});

test('redflags: kritische Werte führen zum Arztverweis statt zur Empfehlung', () => {
  const flags = redFlags({ labs: [lab('hb', 9.5, T)], today: T });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, 'stop');
  assert.match(flags[0].advice, /ärztlich/);
  assert.equal(redFlags({ labs: [lab('hb', 13.5, T)], today: T }).length, 0);
});

test('redflags: ausbleibende Periode über Monate ist eine rote Flagge (RED-S)', () => {
  const cycle = [{ id: 'c1', startDate: addDays(T, -140) }];
  const flags = redFlags({ labs: [], cycle, today: T });
  assert.equal(flags.length, 1);
  assert.match(flags[0].advice, /Energiemangel|RED-S/);
  // Frischer Eintrag -> keine Flagge.
  assert.equal(redFlags({ labs: [], cycle: [{ id: 'c1', startDate: addDays(T, -20) }], today: T }).length, 0);
});

/* -------------------- Energieverfügbarkeit (RED-S/LEA) -------------------- */

test('redflags: leanMass braucht einen plausiblen Körperfettwert', () => {
  assert.equal(leanMass(70, 20), 56);
  assert.equal(leanMass(70, null), null);
  assert.equal(leanMass(null, 20), null);
});

test('redflags: Energieverfügbarkeit erkennt ein kritisches Defizit', () => {
  // Profil ohne Grundumsatz-Angaben -> Plausibilitätsprüfung greift nicht,
  // die reine EA-Rechnung wird geprüft.
  const profile = { weightKg: 60, sex: 'w', activityFactor: 1.35 };
  const health = [{ id: 'h1', date: addDays(T, -3), weight: 60, bodyFat: 20 }];
  const diary = [], sessions = [];
  // 7 Tage: nur 1500 kcal gegessen, täglich eine Stunde locker gelaufen.
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 1500 });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 10, durationSec: 3600 });
  }
  const ea = energyAvailability({ profile, health, sessions, diary, today: T });
  assert.ok(ea, 'Ergebnis vorhanden');
  assert.equal(ea.ffm, 48);
  assert.ok(ea.ea < EA_LOW, `EA unter der kritischen Schwelle, war ${ea.ea}`);
  assert.equal(ea.level, 'kritisch');
  assert.match(ea.hint, /Iss mehr/);
});

test('redflags: lückenhaftes Tagebuch wird nicht als Energiemangel ausgegeben', () => {
  // Ø unter dem Grundumsatz => fast immer fehlende Einträge, kein echter Hunger.
  const profile = { weightKg: 60, heightCm: 170, birthYear: 1990, sex: 'w' };
  const health = [{ id: 'h1', date: T, weight: 60, bodyFat: 20 }];
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(T, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 1400 });  // unter BMR × 1,2 -> unplausibel
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 8, durationSec: 2880 });
  }
  const ea = energyAvailability({ profile, health, sessions, diary, today: T });
  assert.equal(ea.level, 'unklar', 'keine Mangel-Diagnose aus Erfassungslücken');
  assert.match(ea.hint, /Mahlzeiten/);

  // Vollständig erfasst und trotzdem zu wenig -> jetzt wird bewertet.
  const full = diary.map((d) => ({ ...d, kcal: 2100 }));
  const ea2 = energyAvailability({ profile, health, sessions, diary: full, today: T });
  assert.notEqual(ea2.level, 'unklar', 'bei plausibler Erfassung wird wieder bewertet');
});

test('redflags: keine Bewertung bei zu wenigen erfassten Tagen (kein Fehlalarm)', () => {
  const profile = { weightKg: 60 };
  const health = [{ id: 'h1', date: T, weight: 60, bodyFat: 20 }];
  // Nur zwei erfasste Tage -> die Lücken dürfen nicht als Hungertage gelten.
  const diary = [{ id: 'd1', date: T, kcal: 2000 }, { id: 'd2', date: addDays(T, -1), kcal: 2100 }];
  assert.equal(energyAvailability({ profile, health, sessions: [], diary, today: T }), null);
});

/* ------------------------------ Supplemente ------------------------------ */

test('supplements: Eisen wird nie ohne Laborwert empfohlen', () => {
  const rec = recommend({ labs: [], profile: { sex: 'w' }, sessions: [], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(!iron || iron.holdOnly, 'ohne Befund höchstens der Rat, messen zu lassen');
});

test('supplements: niedriges Ferritin führt zu einer laborgestützten Empfehlung', () => {
  const labs = [lab('ferritin', 18, addDays(T, -10))];
  const rec = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron);
  assert.equal(iron.priority, 1);
  assert.match(iron.reason, /Ferritin 18/);
  assert.match(iron.action, /abklären/);
  assert.ok(iron.food, 'Food-first-Hinweis vorhanden');
});

test('supplements: Empfehlung bewertet gegen DEN Referenzbereich des Befunds (v3.19.0)', () => {
  // Gleicher Wert, eigener Laborbereich 13–150: die Werte-Liste sagt „im
  // Normbereich, für Sport knapp" – die Empfehlung darunter muss dasselbe sagen.
  const labs = [lab('ferritin', 14, T, { refLow: 13, refHigh: 150 })];
  const iron = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T })
    .items.find((i) => i.key === 'iron');
  assert.ok(iron);
  assert.match(iron.reason, /im Normbereich/);
  assert.ok(!/unter dem Referenzbereich/.test(iron.reason), 'kein Widerspruch zur Werte-Liste');

  // Ohne eigenen Bereich gilt weiter der Standard (15–300) -> „unter dem Referenzbereich".
  const std = recommend({ labs: [lab('ferritin', 14, T)], profile: { sex: 'w' }, sessions: [], today: T })
    .items.find((i) => i.key === 'iron');
  assert.match(std.reason, /unter dem Referenzbereich/);
});

test('supplements: bei Entzündung wird Eisen ausgesetzt statt empfohlen', () => {
  const labs = [lab('crp', 25, T), lab('ferritin', 18, T)];
  const rec = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T });
  const iron = rec.items.find((i) => i.key === 'iron');
  assert.ok(iron && iron.holdOnly, 'keine Einnahme-Empfehlung bei erhöhtem CRP');
  assert.match(iron.reason, /CRP/);
});

test('supplements: vegane Ernährung begründet B12 auch ohne Laborwert', () => {
  const rec = recommend({ labs: [], profile: {}, sessions: [], today: T, diet: 'vegan' });
  const b12 = rec.items.find((i) => i.key === 'b12');
  assert.ok(b12 && b12.priority === 1);
});

test('supplements: Wechselwirkungen nur zwischen tatsächlich vorgeschlagenen Mitteln', () => {
  const labs = [lab('ferritin', 15, T), lab('magnesium', 1.5, T)];
  const rec = recommend({ labs, profile: { sex: 'w' }, sessions: [], today: T });
  assert.ok(rec.interactions.some((t) => /Eisen/.test(t) && /Magnesium/.test(t)));
  // Ohne Magnesium-Vorschlag keine Magnesium-Wechselwirkung.
  const only = recommend({ labs: [lab('ferritin', 15, T)], profile: { sex: 'w' }, sessions: [], today: T });
  assert.ok(!only.interactions.some((t) => /Magnesium/.test(t)));
});

test('supplements: Vitamin D wird im Winter auch ohne Laborwert angesprochen', () => {
  const winter = recommend({ labs: [], profile: {}, sessions: [], today: '2026-01-15' });
  assert.ok(winter.items.some((i) => i.key === 'vitaminD'));
  const summer = recommend({ labs: [], profile: {}, sessions: [], today: '2026-07-15' });
  assert.ok(!summer.items.some((i) => i.key === 'vitaminD'));
});

/* --------------------------- Einnahme-Protokoll -------------------------- */

test('supplements: Plan, Abhaken und Einnahmetreue', () => {
  const supps = [
    { id: 'p1', _kind: 'plan', name: 'Magnesium', active: true, from: addDays(T, -13) },
    { id: 'p2', _kind: 'plan', name: 'Altes', active: false },
  ];
  assert.equal(activePlans(supps, T).length, 1);
  assert.equal(takenOn(supps, 'p1', T), false);

  // 7 von 14 Tagen abgehakt.
  for (let i = 0; i < 7; i++) supps.push({ id: `i${i}`, _kind: 'intake', planId: 'p1', date: addDays(T, -i) });
  assert.equal(takenOn(supps, 'p1', T), true);
  const ad = adherence(supps, T, 14);
  assert.equal(ad.expected, 14);
  assert.equal(ad.taken, 7);
  assert.equal(ad.pct, 50);
});
