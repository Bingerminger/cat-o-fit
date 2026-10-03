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
import { fmtDec } from './ui.js';

/** Zahl mit Komma, Datum als TT.MM.JJJJ – die Begründungen erscheinen wörtlich in der App. */
const num = fmtDec;
const de = (d) => (d ? `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}.${String(d).slice(0, 4)}` : '');

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
    label: 'Vitamin D', unit: 'IE', typical: '800 IE (20 µg) pro Tag', evidence: 'stark',
    food: 'Fetter Fisch (Lachs, Hering), Eigelb, Pilze – und im Sommer 15 Minuten Sonne auf Armen und Gesicht.',
    timing: 'Zu einer fetthaltigen Mahlzeit (fettlöslich).',
    ul: 'Obergrenze der EFSA: 4000 IE (100 µg) pro Tag – darüber nur ärztlich begleitet.',
    note: 'Bei bekanntem Mangel den Wert nach 3 Monaten kontrollieren.',
    source: 'DGE-Referenzwert, BfR, EFSA',
  },
  magnesium: {
    label: 'Magnesium', unit: 'mg', typical: 'bis 250 mg pro Tag aus Präparaten, auf zwei Portionen verteilt', evidence: 'mittel',
    food: 'Haferflocken, Nüsse, Hülsenfrüchte, Vollkorn, dunkle Schokolade, magnesiumreiches Mineralwasser.',
    timing: 'Wird oft abends genommen – mit Abstand zu Eisen und Zink.',
    ul: 'Mehr als 250 mg pro Tag aus Präparaten führt häufig zu weichem Stuhl (Obergrenze der EFSA).',
    note: 'Citrat oder Glycinat werden besser vertragen als Oxid.',
    source: 'BfR-Höchstmengenvorschlag, EFSA',
  },
  iron: {
    label: 'Eisen', unit: 'mg', typical: 'nur nach ärztlicher Rücksprache', evidence: 'stark',
    food: 'Rotes Fleisch, Hülsenfrüchte, Haferflocken, Hirse – zusammen mit Vitamin C (Paprika, Zitrus) aufnehmen.',
    timing: 'Nüchtern oder mit Vitamin C; mindestens 2 Stunden Abstand zu Kaffee, Tee, Milch und Kalzium.',
    ul: 'Nie ohne Laborwert einnehmen – bei vollen Speichern ist Eisen schädlich.',
    note: 'Jede Eisensupplementierung gehört ärztlich begleitet und kontrolliert.',
    requiresLab: true,
    source: 'BfR, IOC 2018',
  },
  b12: {
    label: 'Vitamin B12', unit: 'µg', typical: 'bis 25 µg pro Tag als Nahrungsergänzung; bei rein pflanzlicher Ernährung sind höhere Mengen nach ärztlicher Rücksprache üblich', evidence: 'stark',
    food: 'Fleisch, Fisch, Eier, Milchprodukte. Rein pflanzliche Ernährung erreicht den Bedarf nicht – hier ist ein Präparat der Normalfall.',
    timing: 'Unabhängig von den Mahlzeiten.',
    ul: 'Keine Obergrenze festgelegt; höhere Mengen nur mit Grund.',
    source: 'BfR-Höchstmengenvorschlag',
  },
  creatine: {
    label: 'Kreatin (Monohydrat)', unit: 'g', typical: '3–5 g pro Tag', evidence: 'stark',
    food: 'Rotes Fleisch und Fisch – die wirksame Menge ist über Nahrung kaum erreichbar.',
    timing: 'Täglich zur gleichen Zeit, Tageszeit egal. Die Wirkung baut sich über etwa 3–4 Wochen auf.',
    ul: 'Gut untersucht; bei gesunden Nieren gilt die übliche Menge als unbedenklich. Ausreichend trinken.',
    note: 'Anfangs 1–2 kg mehr auf der Waage durch Wasser im Muskel – das ist kein Fett.',
    performance: true,
    source: 'IOC-Konsens 2018',
  },
  protein: {
    label: 'Eiweißpulver', unit: 'g', typical: 'nur zum Auffüllen der Tagesmenge', evidence: 'stark',
    food: 'Quark, Skyr, Hüttenkäse, Eier, Fisch, Hülsenfrüchte – Pulver ist reine Bequemlichkeit, kein Zaubermittel.',
    timing: 'Über den Tag verteilt, üblich sind 20–40 g je Portion.',
    ul: 'Kein Grenzwert; Eiweiß aus echten Lebensmitteln bevorzugen.',
    source: 'ACSM 2016 (1,2–2,0 g je kg Körpergewicht)',
  },
  caffeine: {
    label: 'Koffein', unit: 'mg', typical: 'etwa 3 mg je kg Körpergewicht; ohne Erfahrung nicht mehr als 200 mg auf einmal', evidence: 'stark',
    food: 'Kaffee, Espresso, grüner Tee.',
    timing: '45–60 Minuten vor der Belastung. Mindestens 8 Stunden vor dem Schlafengehen die letzte Dosis.',
    ul: 'Mehr als 400 mg pro Tag (Erwachsene) erhöht Unruhe, Herzklopfen und Schlafstörungen.',
    note: 'Vorher im Training ausprobieren – nie zum ersten Mal im Wettkampf.',
    performance: true,
    source: 'EFSA 2015, IOC-Konsens 2018',
  },
  beetroot: {
    label: 'Rote-Bete-Konzentrat (Nitrat)', unit: 'ml', typical: '~70 ml Shot', evidence: 'mittel',
    food: 'Rote Bete, Rucola, Spinat, Mangold.',
    timing: '2–3 Stunden vor der Belastung; in den Tagen davor testen.',
    ul: 'Keine Dauereinnahme nötig – wird situativ vor Wettkämpfen genommen.',
    note: 'Untersucht vor allem bei Belastungen von 5–30 Minuten Dauer.',
    performance: true,
    source: 'IOC-Konsens 2018',
  },
  betaAlanine: {
    label: 'Beta-Alanin', unit: 'g', typical: '3–6 g pro Tag über 10–12 Wochen', evidence: 'mittel',
    food: 'Fleisch und Fisch (geringe Mengen).',
    timing: 'Auf mehrere kleine Portionen verteilen – das mindert das Kribbeln auf der Haut.',
    ul: 'Größere Einzelportionen lösen Hautkribbeln aus – daher aufteilen.',
    note: 'Untersucht vor allem bei harten Belastungen von 30 Sekunden bis 10 Minuten.',
    performance: true,
    source: 'IOC-Konsens 2018',
  },
  electrolytes: {
    label: 'Elektrolyte (Natrium)', unit: 'mg', typical: '300–700 mg Natrium je Stunde bei langer Belastung', evidence: 'situativ',
    food: 'Salzige Snacks, Brühe, Sportgetränk.',
    timing: 'Während langer Einheiten über 90 Minuten, besonders bei Hitze.',
    ul: 'Nur bei entsprechender Belastung – nicht als Dauerbeigabe.',
    note: 'Bei sehr langen Belastungen schützt Natrium vor gefährlich niedrigen Blutwerten.',
    source: 'ACSM 2016',
  },
  omega3: {
    label: 'Omega-3 (EPA/DHA)', unit: 'mg', typical: '1000–2000 mg pro Tag', evidence: 'mittel',
    food: 'Lachs, Hering, Makrele zweimal pro Woche; pflanzlich Leinöl und Walnüsse.',
    timing: 'Zu einer Mahlzeit.',
    ul: 'Mehr als 3000 mg pro Tag nur nach Rücksprache (Blutgerinnung); die EFSA hält bis 5 g für unbedenklich.',
    source: 'EFSA 2012',
  },
  zinc: {
    label: 'Zink', unit: 'mg', typical: 'bis 6,5 mg pro Tag aus Präparaten', evidence: 'situativ',
    food: 'Fleisch, Käse, Haferflocken, Kürbiskerne, Linsen.',
    timing: 'Nicht gleichzeitig mit Eisen oder Kalzium.',
    ul: 'Dauerhaft mehr als 25 mg pro Tag stört die Kupferaufnahme (Obergrenze der EFSA).',
    source: 'BfR-Höchstmengenvorschlag, EFSA',
  },
};

/** Hinweis zu Leistungspräparaten (Kontaminations- und Dopingrisiko, IOC-Konsens 2018). */
export const DOPING_NOTE = 'Für Wettkämpfe mit Dopingkontrollen nur chargengeprüfte Produkte verwenden (z. B. aus der Kölner Liste) – Nahrungsergänzungsmittel sind häufiger verunreinigt, als man denkt.';

/** Katalog-Schlüssel, die für diese Person infrage kommen (Minderjährige: keine Leistungspräparate). */
export function catalogFor(elig = null) {
  return Object.keys(SUPPLEMENTS).filter((k) => !(elig && elig.noPerformanceSupplements && SUPPLEMENTS[k].performance));
}

/** Bekannte Wechselwirkungen/Timing-Konflikte zwischen empfohlenen Mitteln. */
const INTERACTIONS = [
  { a: 'iron', b: 'zinc', text: 'Eisen und Zink konkurrieren um dieselben Aufnahmewege – mit mehreren Stunden Abstand einnehmen.' },
  { a: 'iron', b: 'magnesium', text: 'Magnesium (und Kalzium) bremsen die Eisenaufnahme – Eisen morgens, Magnesium abends.' },
  { a: 'caffeine', b: 'iron', text: 'Kaffee und Tee hemmen die Eisenaufnahme deutlich – mindestens zwei Stunden Abstand halten.' },
  { a: 'zinc', b: 'magnesium', text: 'Zink und Magnesium besser zeitversetzt nehmen, sonst behindern sie sich gegenseitig.' },
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
    `${label} ${num(rec.value)} ${unit} (${de(rec.date)}) – über dem Bereich.`,
    'Nicht (weiter) ergänzen. Falls du ein Präparat nimmst, die Einnahme überprüfen und den Wert ärztlich einordnen lassen.',
    { holdOnly: true, high: true });

  /* --- Eisen: ausschließlich laborgestützt ------------------------------- */
  const ferritin = fresh('ferritin');
  if (ferritin) {
    // `record` mitgeben, damit der Referenzbereich DES BEFUNDS und das CRP DERSELBEN
    // Blutentnahme gelten – sonst bewertet die Empfehlung anders als die Werte-Liste.
    const a = judge('ferritin', ferritin);
    if (a.status === 'unbeurteilbar') {
      items.push(mk('iron', 2, a.blocked, 'Ferritin nach Abklingen der Entzündung erneut bestimmen lassen – vorher keine Eisengabe.', { holdOnly: true }));
    } else if (a.side === 'low' && a.inflamed) {
      // Niedrig trotz Entzündung: auffällig, aber Eisen wird bei Entzündung schlecht aufgenommen –
      // das gehört ärztlich entschieden, nicht in den eigenen Plan.
      items.push(mk('iron', 1,
        `Ferritin ${num(ferritin.value)} µg/l (${de(ferritin.date)}) – ${a.label}. Das CRP derselben Blutentnahme ist erhöht.`,
        'Ärztlich abklären lassen: Bei einer Entzündung wird Eisen schlecht aufgenommen – ob und wann eine Eisengabe sinnvoll ist, entscheidet die Ärztin oder der Arzt.',
        { holdOnly: true, labBased: true }));
    } else if (a.side === 'low') {
      items.push(mk('iron', 1,
        `Ferritin ${num(ferritin.value)} µg/l (${de(ferritin.date)}) – ${a.status === 'grenzwertig' ? 'im Normbereich, für Ausdauersport aber knapp' : a.label}.`,
        'Ärztlich abklären lassen: Erst mit Befund entscheiden, ob und wie viel Eisen sinnvoll ist. Bis dahin über die Ernährung nachlegen.',
        { labBased: true }));
    } else if (a.side === 'high') {
      items.push(mk('iron', 1,
        `Ferritin ${num(ferritin.value)} µg/l (${de(ferritin.date)}) – ${a.status === 'hoch' ? 'über dem Referenzbereich' : 'für Sport ungewöhnlich hoch'}.`,
        'Kein Eisen einnehmen. Hohe Speicherwerte ärztlich einordnen lassen (z. B. mit der Transferrin-Sättigung).',
        { holdOnly: true, high: true }));
    } else if (a.status === 'gut') {
      const t = trend(labs, 'ferritin', { sex });
      if (t && t.dir === 'down' && t.daysToLimit != null && t.daysToLimit < 180) {
        items.push(mk('iron', 2,
          `Ferritin fällt seit mehreren Messungen deutlicher als die übliche Schwankung (etwa ${num(Math.abs(t.perMonth))} µg/l pro Monat) und erreicht bei diesem Verlauf ${t.daysToLimit < 45 ? 'in wenigen Wochen' : `in rund ${Math.round(t.daysToLimit / 30)} Monaten`} den knappen Bereich.`,
          'Noch kein Präparat nötig – eisenreicher essen und in etwa drei Monaten erneut messen lassen.',
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
        `Vitamin D ${num(vd.value)} nmol/l (${de(vd.date)}) – ${a.label}.`,
        a.deficient
          ? 'Ein Mangel gehört ärztlich begleitet – Menge und Kontrolle mit der Ärztin oder dem Arzt festlegen.'
          : 'Eine Ergänzung über die dunklen Monate ist in diesem Fall üblich – den Wert nach etwa drei Monaten kontrollieren lassen.'));
    } else if (a.side === 'high') {
      items.push(tooHigh('vitaminD', 'Vitamin D', vd, 'nmol/l'));
    }
  } else if (month >= 10 || month <= 3) {
    const old = latest(labs, 'vitaminD', today);
    items.push(mk('vitaminD', 3,
      old
        ? `Dein letzter Vitamin-D-Wert (${de(old.date)}) stammt aus einer anderen Jahreszeit oder ist älter als vier Monate. Zwischen Oktober und März reicht die Sonne in unseren Breiten nicht aus, um Vitamin D selbst zu bilden.`
        : 'Zwischen Oktober und März reicht die Sonne in unseren Breiten nicht aus, um Vitamin D selbst zu bilden.',
      'Wert einmal bestimmen lassen – das ist die verlässlichste Grundlage. Ohne Wert empfiehlt die DGE bei fehlender Sonne 20 µg (800 IE) am Tag.'));
  }

  /* --- B12: Laborwert (Holo-TC oder gesamt) oder pflanzliche Ernährung ---- */
  const b12 = fresh('b12');
  const b12t = b12 ? null : fresh('b12total');
  if (b12) {
    const a = judge('b12', b12);
    if (a.status === 'niedrig') {
      items.push(mk('b12', 1, `Holo-TC ${num(b12.value)} pmol/l (${de(b12.date)}) – ${a.label}.`,
        'Eine Ergänzung ist in diesem Fall üblich – den Wert nach etwa drei Monaten kontrollieren lassen.'));
    } else if (a.side === 'low') {
      items.push(mk('b12', 2, `Holo-TC ${num(b12.value)} pmol/l (${de(b12.date)}) – ${a.label}.`,
        'Im Graubereich klärt eine Bestimmung von Methylmalonsäure oder Homocystein, ob wirklich ein Mangel besteht.',
        { holdOnly: diet !== 'vegan' }));
    } else if (a.side === 'high') {
      items.push(tooHigh('b12', 'Holo-TC', b12, 'pmol/l'));
    }
  } else if (b12t) {
    const a = judge('b12total', b12t);
    if (a.side === 'low') {
      items.push(mk('b12', a.status === 'niedrig' ? 1 : 2, `Vitamin B12 (gesamt) ${num(b12t.value)} pmol/l (${de(b12t.date)}) – ${a.label}.`,
        'Das Gesamt-B12 ist wenig spezifisch: Holo-TC oder Methylmalonsäure bestimmen lassen und das Ergebnis ärztlich einordnen.',
        { holdOnly: diet !== 'vegan' }));
    }
  }
  if (!b12 && diet === 'vegan' && !items.some((i) => i.key === 'b12' && !i.holdOnly)) {
    items.push(mk('b12', 1, 'Rein pflanzliche Ernährung deckt den B12-Bedarf nicht.',
      'Hier ist ein Präparat kein Extra, sondern notwendig – dauerhaft, mit gelegentlicher Kontrolle des Werts.'));
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
    const label = key === 'magnesium' ? 'Magnesium (Vollblut)' : 'Magnesium (Serum)';
    if (a.side === 'low') {
      items.push(mk('magnesium', 2, `${label} ${num(mg.value)} mmol/l (${de(mg.date)}) – ${a.label}.`,
        'Zuerst magnesiumreich essen; eine Ergänzung ist möglich (wird oft abends genommen).'));
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
          `Laut Ess-Tagebuch im Schnitt ${fmtDec(Math.round(perKg * 10) / 10)} g Eiweiß je kg Körpergewicht (${byDay.size} Tage) – für Training sind 1,2–2,0 g je kg üblich.`,
          'Zuerst über echte Lebensmittel abdecken; Pulver nur, wenn die Tagesmenge sonst nicht zusammenkommt.'));
      }
    }
  }

  /* --- Kreatin: bei regelmäßigem Krafttraining (strukturiert, nicht per Zieltext) --- */
  if (today) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
    const strength = (sessions || []).filter((s) => s && !s.deleted && s.type === 'strength' && s.date >= since && s.date <= today).length;
    if (strength >= 6) {
      items.push(mk('creatine', 3,
        `${strength} Krafteinheiten in den letzten vier Wochen – für Kraft- und Muskelaufbau ist Kreatin das am besten untersuchte Nahrungsergänzungsmittel.`,
        'Nur bei Bedarf und dauerhaftem Krafttraining sinnvoll; die übliche Menge steht unten.'));
    }
  }

  /* --- Zyklusbewusst: Eisenbedarf bei starker Periode -------------------- */
  const hasCycle = (cycle || []).some((c) => c && !c.deleted && !c._kind && c.startDate);
  if (hasCycle && !ferritin) {
    items.push(mk('iron', 2,
      'Menstruierende Ausdauersportlerinnen verlieren regelmäßig Eisen – ohne Laborwert lässt sich der Speicher aber nicht einschätzen.',
      'Ferritin (zusammen mit CRP) bestimmen lassen, bevor über ein Eisenpräparat nachgedacht wird.', { holdOnly: true }));
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
    foodFirst: 'Erst die Ernährung, dann das Präparat: Was auf dem Teller landet, wirkt zuverlässiger als jede Kapsel – und ist billiger.',
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
      label: `${d.slice(8, 10)}.${d.slice(5, 7)}.`,
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
