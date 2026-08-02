/* =========================================================================
   labs.js — Laborwerte für Sportlerinnen und Sportler: Katalog, Einheiten-
   Umrechnung, Bewertung und Trend. Reine, DOM-freie Logik → per node:test
   abgedeckt.

   Leitgedanken:
   - ZWEI Korridore je Analyt: der LABOR-Referenzbereich („noch normal") und der
     sportliche ZIELKORRIDOR („für Training und Regeneration günstig"). Beide
     unterscheiden sich teils deutlich – Ferritin etwa gilt ab 15 µg/l als normal,
     für Ausdauersportlerinnen sind aber erst ~30–40 µg/l komfortabel.
   - KONTEXT schlägt Grenzwert: Ferritin ist ein Akutphaseprotein und bei erhöhtem
     CRP (Infekt, harter Trainingsblock) nicht beurteilbar. Solche Fälle werden als
     „nicht beurteilbar" gekennzeichnet statt fröhlich bewertet.
   - TREND vor Momentaufnahme: Ein fallender Verlauf ist oft aussagekräftiger als
     ein einzelner Wert im Normbereich.

   Bewusst KEINE Diagnostik: Cat-O-Fit ordnet Werte ein und dokumentiert sie,
   stellt aber keine Diagnose und ersetzt keine ärztliche Beurteilung.
   ========================================================================= */

import { diffDays } from './ui.js';

/* ----------------------------- Analyt-Katalog ---------------------------- */

/**
 * Sportrelevante Analyte. Je Eintrag:
 *   unit        kanonische Einheit (in der gespeichert wird)
 *   alt         alternative Einheiten mit Faktor -> kanonisch
 *   ref         Labor-Referenzbereich [min, max] (grober Standard; `bySex` möglich)
 *   sport       sportlicher Zielkorridor [min, max] (optional)
 *   higherBetter/lowerBetter steuert die Trendbewertung
 *   context     Analyt, ohne den dieser Wert nicht sinnvoll beurteilbar ist
 *   group       fachliche Gruppierung für die Anzeige
 */
export const ANALYTES = {
  ferritin: {
    label: 'Ferritin', unit: 'µg/l', group: 'Eisenstatus',
    ref: [15, 300], sport: [40, 200], higherBetter: true, context: 'crp',
    hint: 'Eisenspeicher. Für Ausdauersport sind Werte deutlich über der unteren Laborgrenze günstig – niedrige Speicher kosten Leistung, bevor eine Blutarmut sichtbar wird.',
  },
  transferrinSat: {
    label: 'Transferrin-Sättigung', unit: '%', group: 'Eisenstatus',
    ref: [16, 45], sport: [20, 45], higherBetter: true,
    hint: 'Wie viel Eisen tatsächlich transportiert wird – ergänzt das Ferritin.',
  },
  hb: {
    label: 'Hämoglobin', unit: 'g/dl', group: 'Eisenstatus',
    alt: { 'mmol/l': 1.6114 }, bySex: { m: [13.5, 17.5], w: [12.0, 16.0] },
    ref: [12.0, 17.5], higherBetter: true,
    hint: 'Sauerstofftransport. Bei Ausdauersport oft leicht niedrig durch das größere Blutplasma („Pseudoanämie") – das ist kein Mangel.',
  },
  crp: {
    label: 'CRP', unit: 'mg/l', group: 'Entzündung',
    ref: [0, 5], sport: [0, 3], lowerBetter: true,
    hint: 'Entzündungsmarker. Nach harten Einheiten kurzzeitig erhöht; dauerhaft hohe Werte sprechen gegen einen belastbaren Trainingszustand.',
  },
  vitaminD: {
    label: 'Vitamin D (25-OH)', unit: 'nmol/l', group: 'Vitamine',
    alt: { 'ng/ml': 2.496 }, ref: [50, 125], sport: [75, 125], higherBetter: true,
    hint: 'Wirkt auf Muskelkraft, Knochen und Immunsystem. In unseren Breiten fällt der Wert von Oktober bis März regelmäßig ab.',
  },
  b12: {
    label: 'Vitamin B12 (Holo-TC)', unit: 'pmol/l', group: 'Vitamine',
    ref: [35, 150], sport: [50, 150], higherBetter: true,
    hint: 'Holo-Transcobalamin zeigt die aktiv verfügbare Form – aussagekräftiger als das Gesamt-B12. Besonders relevant bei vegetarischer/veganer Ernährung.',
  },
  folate: {
    label: 'Folsäure', unit: 'nmol/l', group: 'Vitamine',
    ref: [10, 45], higherBetter: true,
    hint: 'Wichtig für Blutbildung und Zellteilung.',
  },
  magnesium: {
    label: 'Magnesium (Vollblut)', unit: 'mmol/l', group: 'Mineralstoffe',
    ref: [1.6, 2.4], sport: [1.8, 2.4], higherBetter: true,
    hint: 'Im VOLLBLUT gemessen aussagekräftig – der häufig bestimmte Serumwert bleibt lange normal, obwohl die Speicher schon leer sind.',
  },
  zinc: {
    label: 'Zink', unit: 'µmol/l', group: 'Mineralstoffe',
    ref: [11, 18], higherBetter: true,
    hint: 'Immunfunktion und Regeneration; Verluste über Schweiß sind bei hohem Umfang relevant.',
  },
  selenium: {
    label: 'Selen', unit: 'µg/l', group: 'Mineralstoffe',
    ref: [70, 130], higherBetter: true,
    hint: 'Antioxidativer Schutz und Schilddrüsenstoffwechsel. Überdosierung ist schädlich – Zielbereich nicht überschreiten.',
  },
  sodium: {
    label: 'Natrium', unit: 'mmol/l', group: 'Mineralstoffe',
    ref: [135, 145],
    hint: 'Bei sehr langen Belastungen mit viel Trinken kann Natrium gefährlich absinken (Hyponatriämie).',
  },
  tsh: {
    label: 'TSH', unit: 'mU/l', group: 'Hormone & Stoffwechsel',
    ref: [0.4, 4.0],
    hint: 'Steuerhormon der Schilddrüse.',
  },
  ft3: {
    label: 'fT3', unit: 'pmol/l', group: 'Hormone & Stoffwechsel',
    ref: [3.1, 6.8], higherBetter: true,
    hint: 'Sinkt bei anhaltendem Energiemangel oft früh ab – ein Warnzeichen für zu wenig Energie im Verhältnis zum Training.',
  },
  testosterone: {
    label: 'Testosteron (gesamt)', unit: 'nmol/l', group: 'Hormone & Stoffwechsel',
    bySex: { m: [8.6, 29], w: [0.3, 1.7] }, ref: [0.3, 29], higherBetter: true,
    hint: 'Fällt bei dauerhaftem Energiedefizit und Übertraining ab.',
  },
  estradiol: {
    label: 'Östradiol', unit: 'pmol/l', group: 'Hormone & Stoffwechsel',
    ref: [70, 1200], higherBetter: true,
    hint: 'Stark zyklusabhängig – nur zusammen mit dem Zyklustag beurteilbar. Dauerhaft niedrige Werte plus ausbleibende Periode sind ein Alarmzeichen.',
  },
  ck: {
    label: 'Kreatinkinase (CK)', unit: 'U/l', group: 'Belastung & Regeneration',
    ref: [0, 200], sport: [0, 500], lowerBetter: true,
    hint: 'Marker für Muskelbeanspruchung. Nach harten Einheiten stark erhöht – erst im Ruhezustand aussagekräftig.',
  },
  urea: {
    label: 'Harnstoff', unit: 'mmol/l', group: 'Belastung & Regeneration',
    ref: [2.5, 7.5], lowerBetter: true,
    hint: 'Steigt bei hoher Trainingslast und eiweißreicher Kost; anhaltend hohe Werte sprechen für unvollständige Erholung.',
  },
};

/** Gruppen in sinnvoller Anzeige-Reihenfolge. */
export const ANALYTE_GROUPS = [
  'Eisenstatus', 'Vitamine', 'Mineralstoffe', 'Hormone & Stoffwechsel',
  'Belastung & Regeneration', 'Entzündung',
];

/** Alle wählbaren Einheiten eines Analyten (kanonisch zuerst). */
export function unitsFor(key) {
  const a = ANALYTES[key];
  if (!a) return [];
  return [a.unit, ...Object.keys(a.alt || {})];
}

/**
 * Rechnet einen Wert in die kanonische Einheit um. Häufigste Fehlerquelle bei
 * Laborwerten: Vitamin D wird mal in ng/ml, mal in nmol/l angegeben (Faktor 2,5),
 * Hämoglobin in g/dl oder mmol/l.
 */
export function toCanonical(key, value, unit) {
  const a = ANALYTES[key];
  const v = Number(value);
  if (!a || !Number.isFinite(v)) return null;
  if (!unit || unit === a.unit) return v;
  const f = (a.alt || {})[unit];
  return f ? Math.round(v * f * 1000) / 1000 : null;
}

/** Referenzbereich – geschlechtsabhängig, wo hinterlegt. */
export function refRange(key, sex) {
  const a = ANALYTES[key];
  if (!a) return null;
  if (a.bySex && sex && a.bySex[sex]) return a.bySex[sex];
  return a.ref || null;
}

/* ------------------------------ Bewertung -------------------------------- */

/** Jüngster Wert eines Analyten (bis `today`), oder null. */
export function latest(labs = [], key, today = null) {
  return (labs || [])
    .filter((l) => l && !l.deleted && l.analyte === key && (!today || l.date <= today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1) || null;
}

/** Alle Werte eines Analyten, chronologisch. */
export function series(labs = [], key) {
  return (labs || [])
    .filter((l) => l && !l.deleted && l.analyte === key && Number.isFinite(Number(l.value)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bewertet einen einzelnen Laborwert.
 * @returns {{status, label, tone, ref, sport, blocked?:string}}
 *   status: 'niedrig' | 'grenzwertig' | 'gut' | 'hoch' | 'unbeurteilbar' | 'unbekannt'
 */
export function assess(key, value, { sex = null, labs = [], today = null } = {}) {
  const a = ANALYTES[key];
  const v = Number(value);
  if (!a || !Number.isFinite(v)) return { status: 'unbekannt', label: 'unbekannt', tone: 'neutral' };

  const ref = refRange(key, sex);
  const sport = a.sport || null;

  // Kontext-Prüfung: manche Werte sind bei Entzündung schlicht nicht beurteilbar.
  if (a.context === 'crp') {
    const crp = latest(labs, 'crp', today);
    if (crp && Number(crp.value) > 5) {
      return {
        status: 'unbeurteilbar', label: 'nicht beurteilbar', tone: 'neutral', ref, sport,
        blocked: `CRP liegt bei ${crp.value} mg/l – ${a.label} steigt bei Entzündungen an und lässt sich dann nicht sinnvoll einordnen. Nach Abklingen erneut messen.`,
      };
    }
  }

  if (ref && v < ref[0]) return { status: 'niedrig', label: 'unter dem Referenzbereich', tone: 'bad', ref, sport };
  if (ref && v > ref[1]) return { status: 'hoch', label: 'über dem Referenzbereich', tone: 'bad', ref, sport };
  if (sport && v < sport[0]) return { status: 'grenzwertig', label: 'im Normbereich, für Sport eher knapp', tone: 'warn', ref, sport };
  if (sport && v > sport[1]) return { status: 'grenzwertig', label: 'im Normbereich, aber hoch', tone: 'warn', ref, sport };
  return { status: 'gut', label: 'im günstigen Bereich', tone: 'good', ref, sport };
}

/**
 * Trend eines Analyten über die letzten `days`: Richtung, Änderung pro 30 Tage
 * und – bei fallendem Verlauf Richtung Grenzwert – eine Projektion, wann die
 * untere Grenze erreicht wäre. Braucht mindestens 3 Messungen.
 * @returns {{dir, perMonth, n, daysToLimit:number|null, limit:number|null}|null}
 */
export function trend(labs = [], key, { days = 540, sex = null } = {}) {
  const all = series(labs, key);
  if (all.length < 3) return null;
  const last = all.at(-1);
  const pts = all.filter((l) => diffDays(l.date, last.date) <= days);
  if (pts.length < 3) return null;

  // Lineare Regression über (Tage seit erstem Punkt, Wert).
  const x0 = pts[0].date;
  const xs = pts.map((p) => diffDays(x0, p.date));
  const ys = pts.map((p) => Number(p.value));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!denom) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom; // pro Tag

  const perMonth = Math.round(slope * 30 * 100) / 100;
  const dir = Math.abs(perMonth) < 0.01 ? 'flat' : (perMonth > 0 ? 'up' : 'down');

  // Projektion nur, wenn es Richtung Grenzwert geht.
  const a = ANALYTES[key];
  const ref = refRange(key, sex);
  const target = a && a.sport ? a.sport : ref;
  let daysToLimit = null, limit = null;
  const cur = Number(last.value);
  if (dir === 'down' && target && cur > target[0]) {
    limit = target[0];
    daysToLimit = Math.round((cur - limit) / -slope);
  } else if (dir === 'up' && target && cur < target[1] && a && a.lowerBetter) {
    limit = target[1];
    daysToLimit = Math.round((limit - cur) / slope);
  }
  if (daysToLimit != null && (daysToLimit < 0 || daysToLimit > 3650)) { daysToLimit = null; limit = null; }
  return { dir, perMonth, n, daysToLimit, limit };
}

/**
 * Gesamtbild: alle erfassten Analyte mit Bewertung und Trend, auffällige zuerst.
 * @returns {Array<{key, label, group, value, unit, date, assessment, trend, hint}>}
 */
export function overview(labs = [], { sex = null, today = null } = {}) {
  const keys = [...new Set((labs || []).filter((l) => l && !l.deleted).map((l) => l.analyte))];
  const rank = { niedrig: 0, hoch: 0, grenzwertig: 1, unbeurteilbar: 2, gut: 3, unbekannt: 4 };
  return keys
    .map((key) => {
      const a = ANALYTES[key];
      const last = latest(labs, key, today);
      if (!a || !last) return null;
      return {
        key, label: a.label, group: a.group, unit: a.unit, hint: a.hint,
        value: Number(last.value), date: last.date, note: last.note || null,
        assessment: assess(key, last.value, { sex, labs, today }),
        trend: trend(labs, key, { sex }),
      };
    })
    .filter(Boolean)
    .sort((x, y) => (rank[x.assessment.status] - rank[y.assessment.status])
      || x.label.localeCompare(y.label, 'de'));
}
