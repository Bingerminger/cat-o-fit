/* =========================================================================
   labs.js — Laborwerte für Sportlerinnen und Sportler: Katalog, Einheiten-
   Umrechnung, Bewertung und Trend. Reine, DOM-freie Logik → per node:test
   abgedeckt.

   Leitgedanken:
   - ZWEI Korridore je Analyt: der LABOR-Referenzbereich („noch normal“) und der
     sportliche ZIELKORRIDOR („für Training und Regeneration günstig“). Beide
     unterscheiden sich teils deutlich – Ferritin etwa gilt ab 15 µg/l als normal,
     für Ausdauersportlerinnen sind aber erst ~30–40 µg/l komfortabel.
   - KONTEXT schlägt Grenzwert: Ferritin ist ein Akutphaseprotein und bei erhöhtem
     CRP derselben Blutentnahme nur eingeschränkt beurteilbar; CK, Harnstoff und CRP
     sind nach harter Belastung erhöht; Östradiol hängt am Zyklustag; Biotin stört
     manche Tests. Solche Fälle werden gekennzeichnet statt fröhlich bewertet.
   - TREND vor Momentaufnahme – aber erst oberhalb der natürlichen Schwankung
     (Referenzänderungswert) und nur in die ungünstige Richtung projiziert.
   - Jeder Bereich hat eine QUELLE (Feld `source`), die in der Ansicht erscheint.

   Bewusst KEINE Diagnostik: Cat-O-Fit ordnet Werte ein und dokumentiert sie,
   stellt aber keine Diagnose und ersetzt keine ärztliche Beurteilung.
   ========================================================================= */

import { diffDays, fmtDec } from './ui.js';
import { locale, t } from './i18n.js';

/* ----------------------------- Analyt-Katalog ---------------------------- */

/**
 * Sportrelevante Analyte. Je Eintrag:
 *   unit        kanonische Einheit (in der gespeichert wird)
 *   alt         in Deutschland gängige weitere Einheiten mit Faktor -> kanonisch
 *   ref         Labor-Referenzbereich [min, max|null] (grober Standard; `bySex` möglich,
 *               `null` als Obergrenze = keine Obergrenze)
 *   needsSex    ohne Geschlecht (oder eigenen Laborbereich) nicht beurteilbar
 *   sport       sportlicher Zielkorridor [min, max|null] (optional, `sportBySex` möglich)
 *   sportFirst  über dem Laborbereich, aber im Sportkorridor = „für Trainierende häufig“
 *   higherBetter/lowerBetter steuert Trend und Projektion
 *   context     Analyt derselben Blutentnahme, ohne den der Wert nur mit Vorbehalt gilt
 *   exercise    nach harter Belastung (48 h) erhöht – dann nicht beurteilbar
 *   biotin      Immunoassay, den Biotin-Präparate verfälschen können
 *   cycle       zyklusabhängig – bei Frauen nur mit eigenem Laborbereich beurteilbar
 *   rcv         Referenzänderungswert in % (Mindeständerung, ab der ein Trend zählt)
 *   validDays   so lange trägt ein Wert Empfehlungen (danach „neu bestimmen lassen“)
 *   source      Grundlage der Bereiche
 */
export const ANALYTES = {
  ferritin: {
    get label() { return t('labs.analyte.ferritin.label'); }, unit: 'µg/l', alt: { 'ng/ml': 1 }, group: 'Eisenstatus',
    ref: [15, 300], sport: [40, 200], higherBetter: true, context: 'crp', rcv: 48, validDays: 365,
    get source() { return t('labs.analyte.ferritin.source'); },
    get hint() { return t('labs.analyte.ferritin.hint'); },
  },
  transferrinSat: {
    get label() { return t('labs.analyte.transferrinSat.label'); }, unit: '%', group: 'Eisenstatus',
    ref: [16, 45], sport: [20, 45], higherBetter: true, validDays: 365,
    get source() { return t('labs.analyte.transferrinSat.source'); },
    get hint() { return t('labs.analyte.transferrinSat.hint'); },
  },
  hb: {
    get label() { return t('labs.analyte.hb.label'); }, unit: 'g/dl', group: 'Eisenstatus',
    alt: { 'mmol/l': 1.6114 }, bySex: { m: [13.5, 17.5], w: [12.0, 16.0] }, needsSex: true,
    pregnancyLow: 11.0, higherBetter: true, rcv: 9, validDays: 365,
    get source() { return t('labs.analyte.hb.source'); },
    get hint() { return t('labs.analyte.hb.hint'); },
  },
  crp: {
    get label() { return t('labs.analyte.crp.label'); }, unit: 'mg/l', alt: { 'mg/dl': 10 }, group: 'Entzündung',
    ref: [0, 5], lowerBetter: true, exercise: true, validDays: 60,
    get source() { return t('labs.analyte.crp.source'); },
    get hint() { return t('labs.analyte.crp.hint'); },
  },
  vitaminD: {
    get label() { return t('labs.analyte.vitaminD.label'); }, unit: 'nmol/l', alt: { 'ng/ml': 2.496 }, group: 'Vitamine',
    ref: [50, 125], sport: [50, 125], deficiencyBelow: 30, higherBetter: true, seasonal: true, rcv: 30, validDays: 120,
    get source() { return t('labs.analyte.vitaminD.source'); },
    get hint() { return t('labs.analyte.vitaminD.hint'); },
  },
  b12: {
    get label() { return t('labs.analyte.b12.label'); }, unit: 'pmol/l', group: 'Vitamine',
    ref: [35, null], sport: [50, null], get greyLabel() { return t('labs.analyte.b12.grey'); }, higherBetter: true, validDays: 365,
    get source() { return t('labs.analyte.b12.source'); },
    get hint() { return t('labs.analyte.b12.hint'); },
  },
  b12total: {
    get label() { return t('labs.analyte.b12total.label'); }, unit: 'pmol/l', alt: { 'pg/ml': 0.738 }, group: 'Vitamine',
    ref: [150, null], sport: [300, null], get greyLabel() { return t('labs.analyte.b12total.grey'); }, higherBetter: true, validDays: 365,
    get source() { return t('labs.analyte.b12total.source'); },
    get hint() { return t('labs.analyte.b12total.hint'); },
  },
  folate: {
    get label() { return t('labs.analyte.folate.label'); }, unit: 'nmol/l', alt: { 'ng/ml': 2.266 }, group: 'Vitamine',
    ref: [10, 45], higherBetter: true, validDays: 365,
    get source() { return t('labs.analyte.folate.source'); },
    get hint() { return t('labs.analyte.folate.hint'); },
  },
  magnesium: {
    get label() { return t('labs.analyte.magnesium.label'); }, unit: 'mmol/l', alt: { 'mg/dl': 0.4114 }, group: 'Mineralstoffe',
    ref: [1.3, 1.7], higherBetter: true, validDays: 180,
    get source() { return t('labs.analyte.magnesium.source'); },
    get hint() { return t('labs.analyte.magnesium.hint'); },
  },
  magnesiumSerum: {
    get label() { return t('labs.analyte.magnesiumSerum.label'); }, unit: 'mmol/l', alt: { 'mg/dl': 0.4114, 'mval/l': 0.5 }, group: 'Mineralstoffe',
    ref: [0.70, 1.05], higherBetter: true, validDays: 180,
    get source() { return t('labs.analyte.magnesiumSerum.source'); },
    get hint() { return t('labs.analyte.magnesiumSerum.hint'); },
  },
  zinc: {
    get label() { return t('labs.analyte.zinc.label'); }, unit: 'µmol/l', alt: { 'µg/dl': 0.153, 'µg/l': 0.0153 }, group: 'Mineralstoffe',
    ref: [11, 18], higherBetter: true, validDays: 365,
    get source() { return t('labs.sourceLabDependent'); },
    get hint() { return t('labs.analyte.zinc.hint'); },
  },
  selenium: {
    get label() { return t('labs.analyte.selenium.label'); }, unit: 'µg/l', alt: { 'µmol/l': 78.96 }, group: 'Mineralstoffe',
    ref: [70, 130], higherBetter: true, validDays: 365,
    get source() { return t('labs.sourceLabDependent'); },
    get hint() { return t('labs.analyte.selenium.hint'); },
  },
  sodium: {
    get label() { return t('labs.analyte.sodium.label'); }, unit: 'mmol/l', alt: { 'mval/l': 1 }, group: 'Mineralstoffe',
    ref: [135, 145], validDays: 30,
    get source() { return t('labs.analyte.sodium.source'); },
    get hint() { return t('labs.analyte.sodium.hint'); },
  },
  tsh: {
    get label() { return t('labs.analyte.tsh.label'); }, unit: 'mU/l', alt: { 'µIU/ml': 1 }, group: 'Hormone & Stoffwechsel',
    ref: [0.4, 4.0], biotin: true, validDays: 365,
    get source() { return t('labs.analyte.tsh.source'); },
    get hint() { return t('labs.analyte.tsh.hint'); },
  },
  ft3: {
    get label() { return t('labs.analyte.ft3.label'); }, unit: 'pmol/l', alt: { 'pg/ml': 1.536 }, group: 'Hormone & Stoffwechsel',
    ref: [3.1, 6.8], higherBetter: true, biotin: true, validDays: 365,
    get source() { return t('labs.analyte.ft3.source'); },
    get hint() { return t('labs.analyte.ft3.hint'); },
  },
  testosterone: {
    get label() { return t('labs.analyte.testosterone.label'); }, unit: 'nmol/l', alt: { 'ng/ml': 3.467, 'ng/dl': 0.03467 }, group: 'Hormone & Stoffwechsel',
    bySex: { m: [8.6, 29], w: [0.3, 1.7] }, needsSex: true, higherBetter: true, validDays: 365,
    get source() { return t('labs.analyte.testosterone.source'); },
    get hint() { return t('labs.analyte.testosterone.hint'); },
  },
  estradiol: {
    get label() { return t('labs.analyte.estradiol.label'); }, unit: 'pmol/l', alt: { 'pg/ml': 3.671 }, group: 'Hormone & Stoffwechsel',
    bySex: { m: [40, 160] }, needsSex: true, cycle: true, validDays: 365,
    get source() { return t('labs.analyte.estradiol.source'); },
    get hint() { return t('labs.analyte.estradiol.hint'); },
  },
  ck: {
    get label() { return t('labs.analyte.ck.label'); }, unit: 'U/l', alt: { 'µkat/l': 60 }, group: 'Belastung & Regeneration',
    bySex: { m: [0, 190], w: [0, 170] }, ref: [0, 170],
    sportBySex: { m: [0, 1083], w: [0, 513] }, sport: [0, 513], sportFirst: true,
    lowerBetter: true, exercise: true, validDays: 60,
    get source() { return t('labs.analyte.ck.source'); },
    get hint() { return t('labs.analyte.ck.hint'); },
  },
  urea: {
    get label() { return t('labs.analyte.urea.label'); }, unit: 'mmol/l', alt: { 'mg/dl': 0.1665, 'mg/dl (BUN)': 0.357 }, group: 'Belastung & Regeneration',
    ref: [2.5, 7.5], lowerBetter: true, exercise: true, validDays: 60,
    get source() { return t('labs.analyte.urea.source'); },
    get hint() { return t('labs.analyte.urea.hint'); },
  },
};

/** Gruppen in sinnvoller Anzeige-Reihenfolge. */
export const ANALYTE_GROUPS = [
  'Eisenstatus', 'Vitamine', 'Mineralstoffe', 'Hormone & Stoffwechsel',
  'Belastung & Regeneration', 'Entzündung',
];

/** Anzeigename einer Analyt-Gruppe (die Gruppe selbst bleibt der deutsche interne Wert). */
export function groupLabel(group) {
  switch (group) {
    case 'Eisenstatus': return t('labs.group.iron');
    case 'Vitamine': return t('labs.group.vitamins');
    case 'Mineralstoffe': return t('labs.group.minerals');
    case 'Hormone & Stoffwechsel': return t('labs.group.hormones');
    case 'Belastung & Regeneration': return t('labs.group.loadRecovery');
    case 'Entzündung': return t('labs.group.inflammation');
    default: return group;
  }
}

/** Datenstand neuer Laborwerte: ab 2 gelten Magnesium-Art und Referenzherkunft als geklärt. */
export const LAB_SCHEMA = 2;

/** Mindeständerung (%), ab der ein Verlauf als Trend zählt, wenn der Analyt keinen eigenen Wert hat. */
const DEFAULT_RCV = 25;

/** Alle wählbaren Einheiten eines Analyten (kanonisch zuerst). */
export function unitsFor(key) {
  const a = ANALYTES[key];
  if (!a) return [];
  return [a.unit, ...Object.keys(a.alt || {})];
}

/** Faktor einer Einheit -> kanonisch (1 für die kanonische Einheit), sonst null. */
export function unitFactor(key, unit) {
  const a = ANALYTES[key];
  if (!a) return null;
  if (!unit || unit === a.unit) return 1;
  return (a.alt || {})[unit] || null;
}

/**
 * Rechnet einen Wert in die kanonische Einheit um. Häufigste Fehlerquelle bei
 * Laborwerten: Vitamin D wird mal in ng/ml, mal in nmol/l angegeben (Faktor 2,5),
 * CRP in mg/l oder mg/dl (Faktor 10).
 */
export function toCanonical(key, value, unit) {
  const v = Number(value);
  const f = unitFactor(key, unit);
  if (f == null || value === '' || value == null || !Number.isFinite(v)) return null;
  return f === 1 ? v : Math.round(v * f * 1000) / 1000;
}

/** Rechnet einen kanonischen Wert in eine andere Einheit (für Platzhalter und Anzeige). */
export function fromCanonical(key, value, unit) {
  const v = Number(value);
  const f = unitFactor(key, unit);
  if (f == null || !Number.isFinite(v)) return null;
  return f === 1 ? v : Math.round((v / f) * 1000) / 1000;
}

/* ------------------------- Lese-Migration (v3.20.0) ----------------------- */

/* Bis v3.19.0 standen im Erfassungsformular die Standardbereiche als WERT (nicht als
   Platzhalter) und wurden mitgespeichert – bei Einheitenwechsel sogar falsch umgerechnet.
   Solche Datensätze sind nicht „dein Labor“. Hier die damaligen Standards (kanonisch) und
   die damaligen Einheitenfaktoren. */
const LEGACY_REFS = {
  ferritin: [[15, 300]], transferrinSat: [[16, 45]], hb: [[12, 17.5], [13.5, 17.5], [12, 16]],
  crp: [[0, 5]], vitaminD: [[50, 125]], b12: [[35, 150]], folate: [[10, 45]], magnesium: [[1.6, 2.4]],
  zinc: [[11, 18]], selenium: [[70, 130]], sodium: [[135, 145]], tsh: [[0.4, 4.0]], ft3: [[3.1, 6.8]],
  testosterone: [[0.3, 29], [8.6, 29], [0.3, 1.7]], estradiol: [[70, 1200]], ck: [[0, 200]], urea: [[2.5, 7.5]],
};
const LEGACY_FACTORS = { hb: [1.6114], vitaminD: [2.496] };
const close = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.002);

/** War der gespeicherte Bereich nur die alte Vorbelegung (ggf. falsch umgerechnet)? */
function isLegacyDefaultRef(key, lo, hi) {
  const refs = LEGACY_REFS[key];
  if (!refs || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  const factors = [1, ...(LEGACY_FACTORS[key] || [])];
  return refs.some(([l, h]) => factors.some((f) => close(lo, l * f) && close(hi, h * f)));
}

const labMemo = new WeakMap();

/**
 * Deutet einen älteren Laborwert-Datensatz beim Lesen um (gespeichert wird nichts):
 * - Die mitgespeicherte Standard-Vorbelegung gilt nicht als Bereich deines Labors.
 * - „Magnesium (Vollblut)“ unter 1,2 mmol/l ist mit großer Sicherheit ein SERUM-Wert:
 *   Alle veröffentlichten Vollblut-Bereiche beginnen bei 1,2–1,3 mmol/l, der Serum-
 *   bereich liegt bei 0,70–1,10. Bis v3.19.0 gab es nur das Vollblut-Feld, also landete
 *   auch der viel häufiger bestimmte Serumwert dort.
 */
export function migrateLabRecord(r) {
  if (!r || typeof r !== 'object' || (r.schema || 0) >= LAB_SCHEMA) return r;
  const cached = labMemo.get(r);
  if (cached) return cached;
  let out = null;
  if (r.analyte === 'magnesium' && Number(r.value) < 1.2) out = { ...r, analyte: 'magnesiumSerum', migratedFrom: 'magnesium' };
  if (r.refSource == null && isLegacyDefaultRef(r.analyte, Number(r.refLow), Number(r.refHigh))) {
    out = { ...(out || r), refSource: 'default' };
  }
  const result = out ? { ...out, schema: LAB_SCHEMA } : r;
  labMemo.set(r, result);
  return result;
}
/** Ganze Liste lesend umdeuten (idempotent). */
export function migrateLabs(labs = []) {
  return (labs || []).map(migrateLabRecord);
}

/* ------------------------------ Bereiche --------------------------------- */

/** Stammt der Referenzbereich dieses Datensatzes vom eigenen Labor? */
export function hasOwnRef(record) {
  if (!record || record.refSource === 'default') return false;
  const lo = Number(record.refLow);
  const hi = Number(record.refHigh);
  return record.refLow != null && record.refHigh != null && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
}

/**
 * Referenzbereich eines Analyten.
 *
 * WICHTIG: In Deutschland gibt es KEINE bundesweit einheitlichen Referenzbereiche –
 * jedes Labor gibt eigene an, abhängig von Messmethode, Gerät und Referenzkollektiv.
 * Deshalb hat der auf dem eigenen Befund abgedruckte Bereich IMMER Vorrang vor dem
 * hinterlegten Standardwert; der Standard ist nur die Rückfallebene.
 * Ohne Geschlecht gibt es für geschlechtsabhängige Werte (Hb, Testosteron, Östradiol)
 * keinen Standard mehr – ein „Vereinigungsbereich“ hätte Männer mit Blutarmut als gut
 * eingestuft.
 *
 * @param {object|null} record Laborwert-Datensatz mit optionalem refLow/refHigh
 * @returns {[number, number|null]|null}
 */
export function refRange(key, sex, record = null, { pregnant = false } = {}) {
  if (hasOwnRef(record)) return [Number(record.refLow), Number(record.refHigh)];
  const a = ANALYTES[key];
  if (!a) return null;
  let r = null;
  if (a.bySex && sex && a.bySex[sex]) r = a.bySex[sex];
  else if (a.needsSex) return null;
  else r = a.ref || null;
  if (r && pregnant && a.pregnancyLow != null && sex === 'w') r = [a.pregnancyLow, r[1]];
  return r;
}

/** Sportkorridor (je Geschlecht, wo hinterlegt). */
function sportRange(a, sex) {
  if (a.sportBySex && sex && a.sportBySex[sex]) return a.sportBySex[sex];
  return a.sport || null;
}

/* ------------------------------ Bewertung -------------------------------- */

/** Jüngster Wert eines Analyten (bis `today`), oder null. */
export function latest(labs = [], key, today = null) {
  return migrateLabs(labs)
    .filter((l) => l && !l.deleted && l.analyte === key && (!today || l.date <= today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1) || null;
}

/** Alle Werte eines Analyten, chronologisch. */
export function series(labs = [], key) {
  return migrateLabs(labs)
    .filter((l) => l && !l.deleted && l.analyte === key && Number.isFinite(Number(l.value)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Ist der Wert zu alt, um noch Empfehlungen zu tragen? (Vitamin D: auch Sommerwert im Winter.) */
export function isStale(key, record, today) {
  if (!record || !today) return false;
  const a = ANALYTES[key] || {};
  const age = diffDays(record.date, today);
  if (age > (a.validDays || 365)) return true;
  if (a.seasonal) {
    const m = (d) => Number(String(d).slice(5, 7));
    const summer = (x) => x >= 4 && x <= 9;
    if (summer(m(record.date)) && !summer(m(today)) && age > 45) return true;
  }
  return false;
}

/** Jüngster Wert, der noch aktuell genug für Empfehlungen ist (sonst null). */
export function freshLatest(labs = [], key, today = null) {
  const l = latest(labs, key, today);
  return l && !isStale(key, l, today) ? l : null;
}

/** CRP derselben Blutentnahme (± 3 Tage) – ein Wert von einem anderen Termin sagt nichts. */
export function sameDrawCrp(labs = [], record) {
  if (!record || !record.date) return null;
  const near = series(labs, 'crp').filter((c) => Math.abs(diffDays(c.date, record.date)) <= 3);
  if (!near.length) return null;
  return near.sort((x, y) => Math.abs(diffDays(x.date, record.date)) - Math.abs(diffDays(y.date, record.date)))[0];
}

const fmt = fmtDec;

/**
 * Bewertet einen einzelnen Laborwert.
 * @param {object} opts `record` = der Datensatz (eigener Bereich, Umstände der Blutentnahme),
 *   `pregnant` = Schwangerschaft laut Abgrenzung (Hb-Grenze nach WHO)
 * @returns {{status, side, label, tone, ref, sport, ownRef, blocked?:string, caveats:string[], source}}
 *   status: 'niedrig' | 'grenzwertig' | 'gut' | 'hoch' | 'unbeurteilbar' | 'unbekannt'
 */
export function assess(key, value, { sex = null, labs = [], today = null, record = null, pregnant = false } = {}) {
  const a = ANALYTES[key];
  const v = Number(value);
  if (!a || !Number.isFinite(v)) return { status: 'unbekannt', label: t('labs.statusUnknown'), tone: 'neutral', caveats: [] };
  const rec = migrateLabRecord(record);

  const ownRef = hasOwnRef(rec);
  const ref = refRange(key, sex, rec, { pregnant });
  const sport = sportRange(a, sex);
  const caveats = [];
  const base = { ref, sport, ownRef, caveats, source: a.source };
  const blockedResult = (text) => ({ ...base, status: 'unbeurteilbar', side: null, label: t('labs.notAssessable'), tone: 'neutral', blocked: text });

  // Ohne Geschlecht (und ohne eigenen Laborbereich) kein Standard.
  if (!ref) {
    return blockedResult(a.needsSex
      ? t('labs.blockedNeedsSex', { label: a.label })
      : t('labs.blockedNoRange'));
  }
  // Zyklusabhängig: bei Frauen nur mit dem Bereich des eigenen Labors (für die Zyklusphase).
  if (a.cycle && sex === 'w' && !ownRef) {
    const day = rec && rec.cycleDay ? ` ${t('labs.cycleDayNoted', { day: rec.cycleDay })}` : '';
    return blockedResult(t('labs.blockedCycle', { label: a.label, day }));
  }
  // Nach harter Belastung erhöht (CK, Harnstoff, CRP): erst in Ruhe aussagekräftig.
  if (a.exercise && rec && rec.exercise48h && ref[1] != null && v > ref[1]) {
    return blockedResult(t('labs.blockedExercise', { label: a.label }));
  }
  if (a.biotin && rec && rec.biotin) {
    caveats.push(t('labs.caveatBiotin'));
  }

  // Ferritin: CRP DERSELBEN Blutentnahme. Bei Entzündung sagt ein hoher Wert nichts,
  // ein niedriger aber sehr wohl (WHO 2020: unter 70 µg/l spricht dann für Eisenmangel).
  if (a.context === 'crp') {
    const crp = sameDrawCrp(labs, rec || { date: today });
    if (crp && Number(crp.value) > 5) {
      if (v < 70) {
        const clearlyLow = v < ref[0] || v < 30;
        return {
          ...base, status: clearlyLow ? 'niedrig' : 'grenzwertig', side: 'low', tone: clearlyLow ? 'bad' : 'warn', inflamed: true,
          label: clearlyLow ? t('labs.inflamedLow') : t('labs.inflamedSuspicious'),
          caveats: [...caveats, t('labs.caveatCrp', { crp: fmt(crp.value) })],
        };
      }
      return blockedResult(t('labs.blockedCrp', { crp: fmt(crp.value), label: a.label }));
    }
    if (!crp && rec && rec.date) caveats.push(t('labs.caveatNoCrp'));
  }

  // Über dem Laborbereich, aber im Sportkorridor (CK): für Trainierende häufig.
  if (a.sportFirst && sport && ref[1] != null && v > ref[1] && (sport[1] == null || v <= sport[1])) {
    return { ...base, status: 'grenzwertig', side: 'high', label: t('labs.highForAthletes'), tone: 'warn' };
  }
  if (v < ref[0]) {
    const deficient = a.deficiencyBelow != null && v < a.deficiencyBelow;
    return { ...base, status: 'niedrig', side: 'low', label: deficient ? t('labs.belowRangeDeficient') : t('labs.belowRange'), tone: 'bad', deficient };
  }
  if (ref[1] != null && v > ref[1]) return { ...base, status: 'hoch', side: 'high', label: t('labs.aboveRange'), tone: 'bad' };
  if (sport && v < sport[0]) return { ...base, status: 'grenzwertig', side: 'low', label: a.greyLabel || t('labs.normalButTight'), tone: 'warn' };
  if (sport && sport[1] != null && v > sport[1]) return { ...base, status: 'grenzwertig', side: 'high', label: t('labs.normalButHigh'), tone: 'warn' };
  return { ...base, status: 'gut', side: null, label: t('labs.favourable'), tone: 'good' };
}

/**
 * Trend eines Analyten: Richtung, Änderung pro 30 Tage und – nur in die UNGÜNSTIGE
 * Richtung (fallend bei „höher ist besser“, steigend bei „niedriger ist besser“) – eine
 * Projektion, wann die Grenze erreicht wäre.
 * Rauschschutz: mindestens 3 Werte über 60 Tage, und die Änderung muss den
 * Referenzänderungswert (`rcv`) überschreiten – sonst ist es natürliche Schwankung.
 * Projektionen über 12 Monate gibt es nicht (dafür ist eine Gerade zu unsicher).
 * @returns {{dir, perMonth, n, daysToLimit:number|null, limit:number|null, limitSide:'low'|'high'|null, seasonal:boolean}|null}
 */
export function trend(labs = [], key, { days = 540, sex = null } = {}) {
  const all = series(labs, key);
  if (all.length < 3) return null;
  const last = all.at(-1);
  const pts = all.filter((l) => diffDays(l.date, last.date) <= days);
  if (pts.length < 3) return null;
  const span = diffDays(pts[0].date, last.date);
  if (span < 60) return null;

  // Lineare Regression über (Tage seit erstem Punkt, Wert).
  const x0 = pts[0].date;
  const xs = pts.map((p) => diffDays(x0, p.date));
  const ys = pts.map((p) => Number(p.value));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const denom = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!denom) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / denom; // pro Tag

  const a = ANALYTES[key] || {};
  const perMonth = Math.round(slope * 30 * 100) / 100;
  const relChange = my ? Math.abs(slope * span) / Math.abs(my) * 100 : 0;
  const dir = relChange < (a.rcv || DEFAULT_RCV) ? 'flat' : (slope > 0 ? 'up' : 'down');
  const out = { dir, perMonth, n, daysToLimit: null, limit: null, limitSide: null, seasonal: !!a.seasonal };
  if (dir === 'flat') return out;

  // Projektion nur in die ungünstige Richtung; maßgeblich ist der Bereich des JÜNGSTEN Befunds.
  const ref = refRange(key, sex, last);
  const sport = sportRange(a, sex);
  const cur = Number(last.value);
  if (a.higherBetter && dir === 'down') {
    const lo = sport ? sport[0] : ref && ref[0];
    if (lo != null && cur > lo) { out.limit = lo; out.limitSide = 'low'; out.daysToLimit = Math.round((cur - lo) / -slope); }
  } else if (a.lowerBetter && dir === 'up') {
    const hi = ref && ref[1] != null ? ref[1] : null;
    if (hi != null && cur < hi) { out.limit = hi; out.limitSide = 'high'; out.daysToLimit = Math.round((hi - cur) / slope); }
  }
  if (out.daysToLimit != null && (out.daysToLimit < 0 || out.daysToLimit > 365)) {
    out.daysToLimit = null; out.limit = null; out.limitSide = null;
  }
  return out;
}

/** Einordnung ohne Bewertung – für Kinder und Jugendliche: Die hinterlegten Bereiche
    gelten für Erwachsene, altersgerechte Bereiche kennt nur das eigene Labor. */
const UNRATED = { status: 'unbewertet', side: null, get label() { return t('labs.unrated'); }, tone: 'neutral', ref: null, sport: null, caveats: [] };

/**
 * Gesamtbild: alle erfassten Analyte mit Bewertung und Trend, auffällige zuerst.
 * @returns {Array<{key, label, group, value, unit, date, assessment, trend, hint, record, stale}>}
 */
export function overview(labs = [], { sex = null, today = null, evaluate = true, pregnant = false } = {}) {
  const list = migrateLabs(labs);
  const keys = [...new Set(list.filter((l) => l && !l.deleted).map((l) => l.analyte))];
  const rank = { niedrig: 0, hoch: 0, grenzwertig: 1, unbeurteilbar: 2, gut: 3, unbewertet: 3, unbekannt: 4 };
  return keys
    .map((key) => {
      const a = ANALYTES[key];
      const last = latest(list, key, today);
      if (!a || !last) return null;
      return {
        key, label: a.label, group: a.group, unit: a.unit, hint: a.hint,
        value: Number(last.value), date: last.date, note: last.note || null, record: last,
        stale: isStale(key, last, today),
        assessment: evaluate ? assess(key, last.value, { sex, labs: list, today, record: last, pregnant }) : { ...UNRATED },
        trend: evaluate ? trend(list, key, { sex }) : null,
      };
    })
    .filter(Boolean)
    .sort((x, y) => (rank[x.assessment.status] - rank[y.assessment.status])
      || x.label.localeCompare(y.label, locale()));
}

/**
 * Plausibilität einer Eingabe: weit außerhalb des Standards (unter 0,2 × Untergrenze,
 * über 5 × Obergrenze) → vermutlich falsche Einheit. Sehr hohe CRP-, CK- oder
 * Harnstoffwerte kommen dagegen wirklich vor (Infekt, Muskelschaden) – dort nur die
 * Untergrenze prüfen.
 */
export function implausible(key, canonicalValue, sex = null) {
  const a = ANALYTES[key];
  const v = Number(canonicalValue);
  if (!a || !Number.isFinite(v)) return false;
  const r = (a.bySex && sex && a.bySex[sex]) || a.ref || (a.bySex && (a.bySex.m || a.bySex.w));
  if (!r) return false;
  if (r[0] > 0 && v < r[0] * 0.2) return true;
  if (!a.lowerBetter && v > (r[1] != null ? r[1] : r[0] * 4) * 5) return true;
  return false;
}

/**
 * Mehrere Werte EINES Befunds auf einmal (MKT-09) → Datensätze wie bei der Einzelerfassung.
 * `rows`: [{ key, value, unit, refLow, refHigh }] als Text aus den Feldern (Komma oder Punkt);
 * leere Werte zählen nicht. `ctx`: Umstände der Blutentnahme, gelten für alle Werte.
 * Liefert die Datensätze (ohne id/Zeitstempel), Fehler je Wert und die Werte mit
 * unplausibler Größenordnung (Einheit prüfen?).
 * @returns {{records: object[], errors: string[], implausible: string[]}}
 */
export function labRecordsFromReport({ date, note = '', ctx = {}, rows = [] } = {}, { sex = null } = {}) {
  const records = [], errors = [], odd = [];
  const txt = (v) => String(v == null ? '' : v).trim().replace(',', '.');
  for (const r of rows) {
    const a = ANALYTES[r && r.key];
    if (!a || txt(r.value) === '') continue;
    const unit = r.unit && unitFactor(r.key, r.unit) ? r.unit : a.unit;
    const v = toCanonical(r.key, txt(r.value), unit);
    if (v == null) { errors.push(t('labs.errorInvalidValue', { label: a.label })); continue; }
    const lo0 = txt(r.refLow), hi0 = txt(r.refHigh);
    if ((lo0 === '') !== (hi0 === '')) { errors.push(t('labs.errorBothLimits', { label: a.label })); continue; }
    const lo = lo0 !== '' ? toCanonical(r.key, lo0, unit) : null;
    const hi = hi0 !== '' ? toCanonical(r.key, hi0, unit) : null;
    if (lo0 !== '' && !(lo != null && hi != null && hi > lo)) { errors.push(t('labs.errorUpperLimit', { label: a.label })); continue; }
    if (implausible(r.key, v, sex)) odd.push(a.label);
    records.push({
      analyte: r.key, value: v, unit: a.unit, date, note: note ? String(note).trim() || null : null,
      refLow: lo, refHigh: hi, refSource: lo != null ? 'lab' : null,
      enteredValue: unit !== a.unit ? Number(txt(r.value)) : null,
      enteredUnit: unit !== a.unit ? unit : null,
      exercise48h: ctx.exercise48h || null, fasting: ctx.fasting || null, biotin: ctx.biotin || null,
      cycleDay: Number(ctx.cycleDay) > 0 ? Number(ctx.cycleDay) : null,
      schema: LAB_SCHEMA,
    });
  }
  return { records, errors, implausible: odd };
}
