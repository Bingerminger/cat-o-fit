/* =========================================================================
   supplements.js — Nahrungsergänzung für Sportlerinnen und Sportler:
   Katalog, regelbasierte Vorschläge, Wechselwirkungen und Obergrenzen.
   Reine, DOM-freie Logik → per node:test abgedeckt.

   Grundsätze, die das ganze Modul tragen:

   • FOOD FIRST. Jeder Vorschlag nennt zuerst den Weg über die Ernährung. Ein
     Präparat ist die Lücke­nfüllung, nicht der Standardweg.
   • BEGRÜNDUNG STATT ORAKEL. Jede Empfehlung trägt die Auslöser mit sich
     (welcher Wert, welches Datum, welche Trainingslast) – nachvollziehbar wie das
     Anpassungs-Protokoll des Trainingsplans.
   • KEINE EMPFEHLUNG INS BLAUE. Eisen etwa wird NIE ohne Laborwert vorgeschlagen:
     Eisen auf Verdacht zu nehmen ist bei vollen Speichern schädlich.
   • GRENZEN KENNEN. Zu jedem Mittel gehören Obergrenze, typische Wechselwirkung
     und – für Wettkampfsport – der Hinweis auf geprüfte Produkte.

   Cat-O-Fit ist kein Medizinprodukt: Die Hinweise ersetzen keine ärztliche
   Beratung, und bei auffälligen Werten verweist die App bewusst dorthin
   (siehe redflags.js).
   ========================================================================= */

import { latest, freshLatest, assess, trend } from './labs.js';
import { fmtDec, parseDate } from './ui.js';
import { locale, t, tp } from './i18n.js';

/** Number with the language's decimal separator, date in the language's own order (05.03.2026 / 05/03/2026) – the reasons appear verbatim in the app. */
const num = fmtDec;
const dateIn = (d, opts) => {
  try { return new Intl.DateTimeFormat(locale() === 'en' ? 'en-GB' : locale(), opts).format(parseDate(d)); } catch { return String(d); }
};
const dmy = (d) => (d ? dateIn(d, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/* ------------------------------- Katalog --------------------------------- */

/**
 * Supplement-Katalog. `evidence`: 'stark' (gut belegt), 'mittel', 'situativ'.
 * `typical` = allgemeine Information zur üblichen Menge (keine persönliche Dosierung),
 * ausgerichtet an den Höchstmengenvorschlägen des BfR bzw. den Obergrenzen der EFSA;
 * `ul` = Obergrenze bzw. Warnhinweis; `source` = Grundlage der Mengenangabe;
 * `performance` = Leistungspräparat (nicht für Minderjährige, Doping-/Verunreinigungshinweis).
 */
export const SUPPLEMENTS = {
  vitaminD: {
    get label() { return t('supplements.vitaminD.label'); }, unit: 'IE', get typical() { return t('supplements.vitaminD.typical'); }, evidence: 'stark',
    get food() { return t('supplements.vitaminD.food'); },
    get timing() { return t('supplements.vitaminD.timing'); },
    get ul() { return t('supplements.vitaminD.ul'); },
    get note() { return t('supplements.vitaminD.note'); },
    get source() { return t('supplements.vitaminD.source'); },
  },
  magnesium: {
    get label() { return t('supplements.magnesium.label'); }, unit: 'mg', get typical() { return t('supplements.magnesium.typical'); }, evidence: 'mittel',
    get food() { return t('supplements.magnesium.food'); },
    get timing() { return t('supplements.magnesium.timing'); },
    get ul() { return t('supplements.magnesium.ul'); },
    get note() { return t('supplements.magnesium.note'); },
    get source() { return t('supplements.sourceBfrEfsa'); },
  },
  iron: {
    get label() { return t('supplements.iron.label'); }, unit: 'mg', get typical() { return t('supplements.iron.typical'); }, evidence: 'stark',
    get food() { return t('supplements.iron.food'); },
    get timing() { return t('supplements.iron.timing'); },
    get ul() { return t('supplements.iron.ul'); },
    get note() { return t('supplements.iron.note'); },
    requiresLab: true,
    get source() { return t('supplements.iron.source'); },
  },
  b12: {
    get label() { return t('supplements.b12.label'); }, unit: 'µg', get typical() { return t('supplements.b12.typical'); }, evidence: 'stark',
    get food() { return t('supplements.b12.food'); },
    get timing() { return t('supplements.b12.timing'); },
    get ul() { return t('supplements.b12.ul'); },
    get source() { return t('supplements.b12.source'); },
  },
  creatine: {
    get label() { return t('supplements.creatine.label'); }, unit: 'g', get typical() { return t('supplements.creatine.typical'); }, evidence: 'stark',
    get food() { return t('supplements.creatine.food'); },
    get timing() { return t('supplements.creatine.timing'); },
    get ul() { return t('supplements.creatine.ul'); },
    get note() { return t('supplements.creatine.note'); },
    performance: true,
    get source() { return t('supplements.sourceIoc2018'); },
  },
  protein: {
    get label() { return t('supplements.protein.label'); }, unit: 'g', get typical() { return t('supplements.protein.typical'); }, evidence: 'stark',
    get food() { return t('supplements.protein.food'); },
    get timing() { return t('supplements.protein.timing'); },
    get ul() { return t('supplements.protein.ul'); },
    get source() { return t('supplements.protein.source'); },
  },
  caffeine: {
    get label() { return t('supplements.caffeine.label'); }, unit: 'mg', get typical() { return t('supplements.caffeine.typical'); }, evidence: 'stark',
    get food() { return t('supplements.caffeine.food'); },
    get timing() { return t('supplements.caffeine.timing'); },
    get ul() { return t('supplements.caffeine.ul'); },
    get note() { return t('supplements.caffeine.note'); },
    performance: true,
    get source() { return t('supplements.caffeine.source'); },
  },
  beetroot: {
    get label() { return t('supplements.beetroot.label'); }, unit: 'ml', get typical() { return t('supplements.beetroot.typical'); }, evidence: 'mittel',
    get food() { return t('supplements.beetroot.food'); },
    get timing() { return t('supplements.beetroot.timing'); },
    get ul() { return t('supplements.beetroot.ul'); },
    get note() { return t('supplements.beetroot.note'); },
    performance: true,
    get source() { return t('supplements.sourceIoc2018'); },
  },
  betaAlanine: {
    get label() { return t('supplements.betaAlanine.label'); }, unit: 'g', get typical() { return t('supplements.betaAlanine.typical'); }, evidence: 'mittel',
    get food() { return t('supplements.betaAlanine.food'); },
    get timing() { return t('supplements.betaAlanine.timing'); },
    get ul() { return t('supplements.betaAlanine.ul'); },
    get note() { return t('supplements.betaAlanine.note'); },
    performance: true,
    get source() { return t('supplements.sourceIoc2018'); },
  },
  electrolytes: {
    get label() { return t('supplements.electrolytes.label'); }, unit: 'mg', get typical() { return t('supplements.electrolytes.typical'); }, evidence: 'situativ',
    get food() { return t('supplements.electrolytes.food'); },
    get timing() { return t('supplements.electrolytes.timing'); },
    get ul() { return t('supplements.electrolytes.ul'); },
    get note() { return t('supplements.electrolytes.note'); },
    get source() { return t('supplements.electrolytes.source'); },
  },
  omega3: {
    get label() { return t('supplements.omega3.label'); }, unit: 'mg', get typical() { return t('supplements.omega3.typical'); }, evidence: 'mittel',
    get food() { return t('supplements.omega3.food'); },
    get timing() { return t('supplements.omega3.timing'); },
    get ul() { return t('supplements.omega3.ul'); },
    get source() { return t('supplements.omega3.source'); },
  },
  zinc: {
    get label() { return t('supplements.zinc.label'); }, unit: 'mg', get typical() { return t('supplements.zinc.typical'); }, evidence: 'situativ',
    get food() { return t('supplements.zinc.food'); },
    get timing() { return t('supplements.zinc.timing'); },
    get ul() { return t('supplements.zinc.ul'); },
    get source() { return t('supplements.sourceBfrEfsa'); },
  },
};

/** Hinweis zu Leistungspräparaten (Kontaminations- und Dopingrisiko, IOC-Konsens 2018). */
export const dopingNote = () => t('supplements.dopingNote');

/** Katalog-Schlüssel, die für diese Person infrage kommen (Minderjährige: keine Leistungspräparate). */
export function catalogFor(elig = null) {
  return Object.keys(SUPPLEMENTS).filter((k) => !(elig && elig.noPerformanceSupplements && SUPPLEMENTS[k].performance));
}

/** Bekannte Wechselwirkungen/Timing-Konflikte zwischen empfohlenen Mitteln. */
const INTERACTIONS = [
  { a: 'iron', b: 'zinc', get text() { return t('supplements.interaction.ironZinc'); } },
  { a: 'iron', b: 'magnesium', get text() { return t('supplements.interaction.ironMagnesium'); } },
  { a: 'caffeine', b: 'iron', get text() { return t('supplements.interaction.caffeineIron'); } },
  { a: 'zinc', b: 'magnesium', get text() { return t('supplements.interaction.zincMagnesium'); } },
];

/* ------------------------------ Regelwerk -------------------------------- */

const mk = (key, priority, reason, action, extra = {}) => ({
  key, ...SUPPLEMENTS[key], priority, reason, action, ...extra,
});

/** Monat aus einem ISO-Datum (1–12). */
const monthOf = (d) => Number(String(d || '').slice(5, 7)) || 0;

/**
 * Leitet Vorschläge aus Laborwerten, Profil, Training und Ernährung ab.
 *
 * @returns {{items:Array, interactions:Array<string>, foodFirst:string}}
 *   items sind nach Priorität sortiert (1 = am wichtigsten).
 */
export function recommend({
  labs = [], profile = {}, sessions = [], today = null, diet = null, cycle = [], diary = [], elig = null,
} = {}) {
  const items = [];
  const sex = profile.sex || null;
  const month = monthOf(today);
  const pregnant = !!(elig && elig.pregnancy);
  // Nur Werte, die noch aktuell sind, tragen Vorschläge (Vitamin D: ein Sommerwert zählt
  // im Winter nicht, Ferritin nach einem Jahr nicht mehr).
  const fresh = (key) => freshLatest(labs, key, today);
  const judge = (key, rec) => assess(key, rec.value, { sex, labs, today, record: rec, pregnant });
  // Ein zu HOHER Wert führt nie zu „ergänzen“, sondern zum Hinweis, die Einnahme zu prüfen.
  const tooHigh = (key, label, rec, unit) => mk(key, 1,
    t('supplements.tooHighReason', { label, value: num(rec.value), unit, date: dmy(rec.date) }),
    t('supplements.tooHighAction'),
    { holdOnly: true, high: true });

  /* --- Eisen: ausschließlich laborgestützt ------------------------------- */
  const ferritin = fresh('ferritin');
  if (ferritin) {
    // `record` mitgeben, damit der Referenzbereich DES BEFUNDS und das CRP DERSELBEN
    // Blutentnahme gelten – sonst bewertet die Empfehlung anders als die Werte-Liste.
    const a = judge('ferritin', ferritin);
    if (a.status === 'unbeurteilbar') {
      items.push(mk('iron', 2, a.blocked, t('supplements.ironInflamedWait'), { holdOnly: true }));
    } else if (a.side === 'low' && a.inflamed) {
      // Niedrig trotz Entzündung: auffällig, aber Eisen wird bei Entzündung schlecht aufgenommen –
      // das gehört ärztlich entschieden, nicht in den eigenen Plan.
      items.push(mk('iron', 1,
        t('supplements.ironInflamedReason', { value: num(ferritin.value), date: dmy(ferritin.date), assessment: a.label }),
        t('supplements.ironInflamedAction'),
        { holdOnly: true, labBased: true }));
    } else if (a.side === 'low') {
      items.push(mk('iron', 1,
        t('supplements.ferritinReason', { value: num(ferritin.value), date: dmy(ferritin.date), assessment: a.status === 'grenzwertig' ? t('supplements.ironBorderline') : a.label }),
        t('supplements.ironLowAction'),
        { labBased: true }));
    } else if (a.side === 'high') {
      items.push(mk('iron', 1,
        t('supplements.ferritinReason', { value: num(ferritin.value), date: dmy(ferritin.date), assessment: a.status === 'hoch' ? t('labs.aboveRange') : t('supplements.ferritinUnusuallyHigh') }),
        t('supplements.ironHighAction'),
        { holdOnly: true, high: true }));
    } else if (a.status === 'gut') {
      const slope = trend(labs, 'ferritin', { sex });
      if (slope && slope.dir === 'down' && slope.daysToLimit != null && slope.daysToLimit < 180) {
        items.push(mk('iron', 2,
          t('supplements.ferritinFalling', { rate: num(Math.abs(slope.perMonth)), when: slope.daysToLimit < 45 ? t('supplements.inFewWeeks') : tp('supplements.inAboutMonths', Math.round(slope.daysToLimit / 30)) }),
          t('supplements.ironFallingAction'),
          { holdOnly: true }));
      }
    }
  }

  /* --- Vitamin D: Laborwert (DGE: ab 50 nmol/l ausreichend) oder Jahreszeit --- */
  const vd = fresh('vitaminD');
  if (vd) {
    const a = judge('vitaminD', vd);
    if (a.side === 'low') {
      items.push(mk('vitaminD', 1,
        t('supplements.vitaminDReason', { value: num(vd.value), date: dmy(vd.date), assessment: a.label }),
        a.deficient
          ? t('supplements.vitaminDDeficientAction')
          : t('supplements.vitaminDLowAction')));
    } else if (a.side === 'high') {
      items.push(tooHigh('vitaminD', SUPPLEMENTS.vitaminD.label, vd, 'nmol/l'));
    }
  } else if (month >= 10 || month <= 3) {
    const old = latest(labs, 'vitaminD', today);
    items.push(mk('vitaminD', 3,
      old
        ? `${t('supplements.vitaminDOld', { date: dmy(old.date) })} ${t('supplements.vitaminDWinter')}`
        : t('supplements.vitaminDWinter'),
      t('supplements.vitaminDMeasureAction')));
  }

  /* --- B12: Laborwert (Holo-TC oder gesamt) oder pflanzliche Ernährung ---- */
  const b12 = fresh('b12');
  const b12t = b12 ? null : fresh('b12total');
  if (b12) {
    const a = judge('b12', b12);
    if (a.status === 'niedrig') {
      items.push(mk('b12', 1, t('supplements.holoTcReason', { value: num(b12.value), date: dmy(b12.date), assessment: a.label }),
        t('supplements.b12LowAction')));
    } else if (a.side === 'low') {
      items.push(mk('b12', 2, t('supplements.holoTcReason', { value: num(b12.value), date: dmy(b12.date), assessment: a.label }),
        t('supplements.b12GreyAction'),
        { holdOnly: diet !== 'vegan' }));
    } else if (a.side === 'high') {
      items.push(tooHigh('b12', 'Holo-TC', b12, 'pmol/l'));
    }
  } else if (b12t) {
    const a = judge('b12total', b12t);
    if (a.side === 'low') {
      items.push(mk('b12', a.status === 'niedrig' ? 1 : 2, t('supplements.b12TotalReason', { value: num(b12t.value), date: dmy(b12t.date), assessment: a.label }),
        t('supplements.b12TotalAction'),
        { holdOnly: diet !== 'vegan' }));
    }
  }
  if (!b12 && diet === 'vegan' && !items.some((i) => i.key === 'b12' && !i.holdOnly)) {
    items.push(mk('b12', 1, t('supplements.veganReason'),
      t('supplements.veganAction')));
  }

  /* --- Magnesium: nur mit Laborwert (Vollblut oder Serum) -----------------
     Ohne Befund kein Präparatehinweis: Für Krampfvorbeugung gibt es keine belastbare
     Evidenz (Cochrane 2020), und das IOC rät von Ergänzung ohne Mangel ab. */
  const mgVb = fresh('magnesium');
  const mgSe = fresh('magnesiumSerum');
  const mg = mgVb && mgSe ? (mgVb.date >= mgSe.date ? mgVb : mgSe) : (mgVb || mgSe);
  if (mg) {
    const key = mg === mgVb ? 'magnesium' : 'magnesiumSerum';
    const a = judge(key, mg);
    const label = key === 'magnesium' ? t('labs.analyte.magnesium.label') : t('labs.analyte.magnesiumSerum.label');
    if (a.side === 'low') {
      items.push(mk('magnesium', 2, t('supplements.magnesiumReason', { label, value: num(mg.value), date: dmy(mg.date), assessment: a.label }),
        t('supplements.magnesiumAction')));
    } else if (a.side === 'high') {
      items.push(tooHigh('magnesium', label, mg, 'mmol/l'));
    }
  }

  /* --- Eiweiß: aus dem Ess-Tagebuch statt aus der Trainingslast ----------- */
  const kg = Number(profile.weightKg) || null;
  if (kg && today) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10);
    const byDay = new Map();
    (diary || []).forEach((d) => {
      if (!d || d.deleted || d._kind || !d.date || d.date < since || d.date > today || d.protein == null) return;
      byDay.set(d.date, (byDay.get(d.date) || 0) + Number(d.protein || 0));
    });
    if (byDay.size >= 5) {
      const perKg = [...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size / kg;
      if (perKg < 1.2) {
        items.push(mk('protein', 3,
          t('supplements.proteinReason', { value: fmtDec(Math.round(perKg * 10) / 10), days: byDay.size }),
          t('supplements.proteinAction')));
      }
    }
  }

  /* --- Kreatin: bei regelmäßigem Krafttraining (strukturiert, nicht per Zieltext) --- */
  if (today) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
    const strength = (sessions || []).filter((s) => s && !s.deleted && s.type === 'strength' && s.date >= since && s.date <= today).length;
    if (strength >= 6) {
      items.push(mk('creatine', 3,
        tp('supplements.creatineReason', strength),
        t('supplements.creatineAction')));
    }
  }

  /* --- Zyklusbewusst: Eisenbedarf bei starker Periode -------------------- */
  const hasCycle = (cycle || []).some((c) => c && !c.deleted && !c._kind && c.startDate);
  if (hasCycle && !ferritin) {
    items.push(mk('iron', 2,
      t('supplements.cycleIronReason'),
      t('supplements.cycleIronAction'), { holdOnly: true }));
  }

  // „Nie ohne Befund“ technisch absichern: Mittel mit `requiresLab` erscheinen nur als
  // laborgestützter Vorschlag oder als reiner Mess-/Prüfhinweis – nie aus einer anderen Regel.
  // Minderjährige: keine Leistungspräparate.
  const allowed = items.filter((it) => (!SUPPLEMENTS[it.key].requiresLab || it.holdOnly || it.labBased)
    && !(elig && elig.noPerformanceSupplements && SUPPLEMENTS[it.key].performance));

  // Dubletten desselben Mittels zusammenführen (höchste Priorität gewinnt).
  const byKey = new Map();
  for (const it of allowed) {
    const cur = byKey.get(it.key);
    if (!cur || it.priority < cur.priority) byKey.set(it.key, it);
  }
  const list = [...byKey.values()].sort((a, b) => a.priority - b.priority);

  // Wechselwirkungen nur für tatsächlich einzunehmende Mittel – wo bloß eine
  // Messung angeraten wird (`holdOnly`), gibt es noch nichts zu kombinieren.
  const keys = new Set(list.filter((i) => !i.holdOnly).map((i) => i.key));
  const interactions = INTERACTIONS
    .filter((i) => keys.has(i.a) && keys.has(i.b))
    .map((i) => i.text);

  return {
    items: list,
    interactions,
    foodFirst: t('supplements.foodFirst'),
  };
}

/* --------------------------- Einnahme-Protokoll --------------------------- */

/** Aktive Plan-Einträge (Records mit `_kind: 'plan'`). */
export function activePlans(supplements = [], today = null) {
  return (supplements || []).filter((s) => s && !s.deleted && s._kind === 'plan'
    && s.active !== false
    && (!today || ((!s.from || s.from <= today) && (!s.to || s.to >= today))));
}

/** Wurde ein geplantes Mittel an diesem Tag abgehakt? */
export function takenOn(supplements = [], planId, date) {
  return (supplements || []).some((s) => s && !s.deleted && s._kind === 'intake'
    && s.planId === planId && s.date === date);
}

/** Tagesliste (ISO) der letzten `days` Tage, endend bei `today`. */
function lastDays(today, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** Mittel, die nur bei Bedarf genommen werden (z. B. Koffein oder Rote Bete vor Wettkämpfen),
    zählen nicht als tägliche Pflicht – sonst sähe richtige Einnahme wie Vergessen aus. */
export function isDaily(plan) { return !plan || plan.frequency !== 'bedarf'; }

/**
 * Einnahmetreue je Tag über `days` Tage – als Balkenreihe für die Anzeige.
 * Tage ohne fälligen Plan (vor Planbeginn) sind `null` statt 0 %: Kein Balken, denn
 * dort wurde nichts verpasst.
 * @returns {Array<{label:string, value:number|null, date:string}>} value = % des Tages
 */
export function adherenceSeries(supplements = [], today, days = 21) {
  const plans = activePlans(supplements, today).filter(isDaily);
  if (!plans.length || !today) return [];
  return lastDays(today, days).map((d) => {
    const due = plans.filter((p) => (!p.from || d >= p.from) && (!p.to || d <= p.to));
    const taken = due.filter((p) => takenOn(supplements, p.id, d)).length;
    return {
      date: d,
      label: dateIn(d, { day: '2-digit', month: '2-digit' }),
      value: due.length ? Math.round((taken / due.length) * 100) : null,
    };
  });
}

/**
 * Einnahmetreue der letzten `days` Tage über alle aktiven, täglichen Pläne.
 * @returns {{pct:number, taken:number, expected:number}|null}
 */
export function adherence(supplements = [], today, days = 14) {
  const plans = activePlans(supplements, today).filter(isDaily);
  if (!plans.length || !today) return null;
  let taken = 0, expected = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
    for (const p of plans) {
      if (p.from && d < p.from) continue;
      if (p.to && d > p.to) continue;
      expected++;
      if (takenOn(supplements, p.id, d)) taken++;
    }
  }
  return expected ? { pct: Math.round((taken / expected) * 100), taken, expected } : null;
}
