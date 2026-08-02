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

import { latest, assess, trend } from './labs.js';
import { acwr } from './load.js';

/* ------------------------------- Katalog --------------------------------- */

/**
 * Supplement-Katalog. `evidence`: 'stark' (gut belegt), 'mittel', 'situativ'.
 * `ul` = tolerierbare Tagesobergrenze für Erwachsene (Dauergebrauch).
 */
export const SUPPLEMENTS = {
  vitaminD: {
    label: 'Vitamin D', unit: 'IE', typical: '800–2000 IE/Tag', evidence: 'stark',
    food: 'Fetter Fisch (Lachs, Hering), Eigelb, Pilze – und im Sommer 15 Minuten Sonne auf Armen und Gesicht.',
    timing: 'Zu einer fetthaltigen Mahlzeit (fettlöslich).',
    ul: '4000 IE/Tag ohne ärztliche Kontrolle nicht überschreiten.',
    note: 'Bei bekanntem Mangel den Wert nach 3 Monaten kontrollieren.',
  },
  magnesium: {
    label: 'Magnesium', unit: 'mg', typical: '200–400 mg/Tag', evidence: 'mittel',
    food: 'Haferflocken, Nüsse, Hülsenfrüchte, Vollkorn, dunkle Schokolade, magnesiumreiches Mineralwasser.',
    timing: 'Abends – unterstützt die Entspannung und stört keine anderen Nährstoffe.',
    ul: 'Über 350 mg/Tag aus Präparaten führt häufig zu weichem Stuhl.',
    note: 'Citrat oder Glycinat werden besser vertragen als Oxid.',
  },
  iron: {
    label: 'Eisen', unit: 'mg', typical: 'nur nach ärztlicher Rücksprache', evidence: 'stark',
    food: 'Rotes Fleisch, Hülsenfrüchte, Haferflocken, Hirse – zusammen mit Vitamin C (Paprika, Zitrus) aufnehmen.',
    timing: 'Nüchtern oder mit Vitamin C; mindestens 2 Stunden Abstand zu Kaffee, Tee, Milch und Kalzium.',
    ul: 'Nie ohne Laborwert einnehmen – bei vollen Speichern ist Eisen schädlich.',
    note: 'Jede Eisensupplementierung gehört ärztlich begleitet und kontrolliert.',
    requiresLab: true,
  },
  b12: {
    label: 'Vitamin B12', unit: 'µg', typical: '10–250 µg/Tag', evidence: 'stark',
    food: 'Fleisch, Fisch, Eier, Milchprodukte. Rein pflanzliche Ernährung erreicht den Bedarf nicht – hier ist ein Präparat der Normalfall.',
    timing: 'Unabhängig von den Mahlzeiten.',
    ul: 'Sehr breite Sicherheitsspanne; Überschuss wird ausgeschieden.',
  },
  creatine: {
    label: 'Kreatin (Monohydrat)', unit: 'g', typical: '3–5 g/Tag', evidence: 'stark',
    food: 'Rotes Fleisch und Fisch – die wirksame Menge ist über Nahrung kaum erreichbar.',
    timing: 'Täglich zur gleichen Zeit, Tageszeit egal. Wirkt erst nach ~3–4 Wochen voll.',
    ul: 'Gut untersucht und sicher bei gesunden Nieren. Ausreichend trinken.',
    note: 'Anfangs 1–2 kg mehr auf der Waage durch Wasser im Muskel – das ist kein Fett.',
  },
  protein: {
    label: 'Eiweißpulver', unit: 'g', typical: 'nur zum Auffüllen der Tagesmenge', evidence: 'stark',
    food: 'Quark, Skyr, Hüttenkäse, Eier, Fisch, Hülsenfrüchte – Pulver ist reine Bequemlichkeit, kein Zaubermittel.',
    timing: 'Über den Tag verteilt, ideal 20–40 g je Portion.',
    ul: 'Kein Grenzwert; Eiweiß aus echten Lebensmitteln bevorzugen.',
  },
  caffeine: {
    label: 'Koffein', unit: 'mg', typical: '3–6 mg je kg Körpergewicht', evidence: 'stark',
    food: 'Kaffee, Espresso, grüner Tee.',
    timing: '45–60 Minuten vor der Belastung. Mindestens 8 Stunden vor dem Schlafengehen die letzte Dosis.',
    ul: 'Über 400 mg/Tag steigen Unruhe, Herzklopfen und Schlafstörungen.',
    note: 'Vorher im Training ausprobieren – nie zum ersten Mal im Wettkampf.',
  },
  beetroot: {
    label: 'Rote-Bete-Konzentrat (Nitrat)', unit: 'ml', typical: '~70 ml Shot', evidence: 'mittel',
    food: 'Rote Bete, Rucola, Spinat, Mangold.',
    timing: '2–3 Stunden vor der Belastung; in den Tagen davor testen.',
    ul: 'Keine Dauereinnahme nötig – wirkt situativ vor Wettkämpfen.',
    note: 'Wirkt vor allem bei Belastungen von 5–30 Minuten Dauer.',
  },
  betaAlanine: {
    label: 'Beta-Alanin', unit: 'g', typical: '3–6 g/Tag über Wochen', evidence: 'mittel',
    food: 'Fleisch und Fisch (geringe Mengen).',
    timing: 'Auf mehrere kleine Portionen verteilen – das mindert das Kribbeln auf der Haut.',
    ul: 'Wirkt erst nach 4–6 Wochen Aufsättigung; nützt bei 1–10-minütigen harten Belastungen.',
  },
  electrolytes: {
    label: 'Elektrolyte (Natrium)', unit: 'mg', typical: '300–700 mg Natrium je Stunde bei langer Belastung', evidence: 'situativ',
    food: 'Salzige Snacks, Brühe, Sportgetränk.',
    timing: 'Während langer Einheiten über 90 Minuten, besonders bei Hitze.',
    ul: 'Nur bei entsprechender Belastung – nicht als Dauerbeigabe.',
    note: 'Bei sehr langen Belastungen schützt Natrium vor gefährlich niedrigen Blutwerten.',
  },
  omega3: {
    label: 'Omega-3 (EPA/DHA)', unit: 'mg', typical: '1000–2000 mg/Tag', evidence: 'mittel',
    food: 'Lachs, Hering, Makrele zweimal pro Woche; pflanzlich Leinöl und Walnüsse.',
    timing: 'Zu einer Mahlzeit.',
    ul: 'Über 3000 mg/Tag nur nach Rücksprache (Blutgerinnung).',
  },
  zinc: {
    label: 'Zink', unit: 'mg', typical: '10–15 mg/Tag', evidence: 'situativ',
    food: 'Fleisch, Käse, Haferflocken, Kürbiskerne, Linsen.',
    timing: 'Nicht gleichzeitig mit Eisen oder Kalzium.',
    ul: 'Dauerhaft über 25 mg/Tag stört die Kupferaufnahme.',
  },
};

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
  labs = [], profile = {}, sessions = [], today = null, diet = null, cycle = [],
} = {}) {
  const items = [];
  const sex = profile.sex || null;
  const month = monthOf(today);

  /* --- Eisen: ausschließlich laborgestützt ------------------------------- */
  const ferritin = latest(labs, 'ferritin', today);
  if (ferritin) {
    const a = assess('ferritin', ferritin.value, { sex, labs, today });
    if (a.status === 'unbeurteilbar') {
      items.push(mk('iron', 2, a.blocked, 'Ferritin nach Abklingen der Entzündung erneut bestimmen lassen – vorher keine Eisengabe.', { holdOnly: true }));
    } else if (a.status === 'niedrig' || a.status === 'grenzwertig') {
      items.push(mk('iron', 1,
        `Ferritin ${ferritin.value} µg/l (${ferritin.date})${a.status === 'grenzwertig' ? ' – im Normbereich, für Ausdauersport aber knapp' : ' – unter dem Referenzbereich'}.`,
        'Ärztlich abklären lassen: Erst mit Befund entscheiden, ob und wie viel Eisen sinnvoll ist. Bis dahin über die Ernährung nachlegen.'));
    } else if (a.status === 'gut') {
      const t = trend(labs, 'ferritin', { sex });
      if (t && t.dir === 'down' && t.daysToLimit != null && t.daysToLimit < 180) {
        items.push(mk('iron', 2,
          `Ferritin fällt seit mehreren Messungen (etwa ${Math.abs(t.perMonth)} µg/l pro Monat) und erreicht bei diesem Verlauf in rund ${Math.round(t.daysToLimit / 30)} Monaten den kritischen Bereich.`,
          'Noch kein Präparat nötig – aber eisenreicher essen und in etwa drei Monaten erneut messen lassen.'));
      }
    }
  }

  /* --- Vitamin D: Laborwert oder Jahreszeit ------------------------------ */
  const vd = latest(labs, 'vitaminD', today);
  if (vd) {
    const a = assess('vitaminD', vd.value, { sex, labs, today });
    if (a.status === 'niedrig' || a.status === 'grenzwertig') {
      items.push(mk('vitaminD', 1,
        `Vitamin D ${vd.value} nmol/l (${vd.date}) – ${a.status === 'niedrig' ? 'unter dem Referenzbereich' : 'für Sport eher knapp'}.`,
        'Über die dunklen Monate ergänzen und den Wert nach etwa drei Monaten kontrollieren.'));
    }
  } else if (month >= 10 || month <= 3) {
    items.push(mk('vitaminD', 3,
      'Zwischen Oktober und März reicht die Sonne in unseren Breiten nicht aus, um Vitamin D selbst zu bilden.',
      'Wert einmal bestimmen lassen – das ist die verlässlichste Grundlage. Bis dahin ist eine moderate Ergänzung in dieser Jahreszeit üblich.'));
  }

  /* --- B12: Laborwert oder pflanzliche Ernährung ------------------------- */
  const b12 = latest(labs, 'b12', today);
  if (b12) {
    const a = assess('b12', b12.value, { sex, labs, today });
    if (a.status !== 'gut' && a.status !== 'unbeurteilbar') {
      items.push(mk('b12', 1, `Holo-TC ${b12.value} pmol/l (${b12.date}) – ${a.label}.`,
        'Ergänzen und in drei Monaten kontrollieren.'));
    }
  } else if (diet === 'vegan') {
    items.push(mk('b12', 1, 'Rein pflanzliche Ernährung deckt den B12-Bedarf nicht.',
      'Dauerhaft ergänzen – hier ist ein Präparat kein Extra, sondern notwendig. Wert gelegentlich kontrollieren.'));
  }

  /* --- Magnesium: Vollblutwert oder hohe Last + Krämpfe ------------------ */
  const mg = latest(labs, 'magnesium', today);
  const load = today ? acwr(sessions, today) : null;
  const highLoad = !!(load && !load.sparse && load.ratio != null && load.ratio > 1.1 && load.chronic > 0);
  if (mg) {
    const a = assess('magnesium', mg.value, { sex, labs, today });
    if (a.status !== 'gut' && a.status !== 'unbeurteilbar') {
      items.push(mk('magnesium', 2, `Magnesium ${mg.value} mmol/l (${mg.date}) – ${a.label}.`,
        'Abends ergänzen und auf magnesiumreiche Lebensmittel achten.'));
    }
  } else if (highLoad) {
    items.push(mk('magnesium', 3,
      'Deine Trainingslast liegt über deinem Schnitt – über Schweiß gehen dabei spürbar Mineralstoffe verloren.',
      'Zuerst über die Ernährung abdecken. Wer zu nächtlichen Wadenkrämpfen neigt, kann abends ergänzen.'));
  }

  /* --- Eiweiß: aus dem Trainingsprofil ----------------------------------- */
  if (highLoad) {
    items.push(mk('protein', 3,
      'In Phasen mit hoher Last steigt der Eiweißbedarf auf etwa 1,6–2,0 g je kg Körpergewicht.',
      'Zuerst über echte Lebensmittel abdecken; Pulver nur, wenn die Tagesmenge sonst nicht zusammenkommt.'));
  }

  /* --- Leistungs-Supplemente: nur bei passendem Ziel --------------------- */
  const strengthGoal = Array.isArray(profile.goals)
    && profile.goals.some((g) => /kraft|muskel/i.test(String(g)));
  if (strengthGoal) {
    items.push(mk('creatine', 3,
      'Dein Ziel enthält Kraft- bzw. Muskelaufbau – Kreatin ist dafür das am besten untersuchte Nahrungsergänzungsmittel.',
      'Täglich 3–5 g, dauerhaft. Wirkung zeigt sich nach einigen Wochen.'));
  }

  /* --- Zyklusbewusst: Eisenbedarf bei starker Periode -------------------- */
  const hasCycle = (cycle || []).some((c) => c && !c.deleted && c.startDate);
  if (hasCycle && !ferritin) {
    items.push(mk('iron', 2,
      'Menstruierende Ausdauersportlerinnen verlieren regelmäßig Eisen – ohne Laborwert lässt sich der Speicher aber nicht einschätzen.',
      'Ferritin (zusammen mit CRP) bestimmen lassen, bevor über ein Eisenpräparat nachgedacht wird.', { holdOnly: true }));
  }

  // Dubletten desselben Mittels zusammenführen (höchste Priorität gewinnt).
  const byKey = new Map();
  for (const it of items) {
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

/**
 * Einnahmetreue der letzten `days` Tage über alle aktiven Pläne.
 * @returns {{pct:number, taken:number, expected:number}|null}
 */
export function adherence(supplements = [], today, days = 14) {
  const plans = activePlans(supplements, today);
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
