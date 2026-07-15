/* =========================================================================
   energy.js — Kalorien & Energiebilanz (aus dem Praxis-Feedback).
   Reine Funktionen ohne Store/DOM, damit alles unit-testbar bleibt.

   - bmr():            Grundumsatz nach Mifflin-St-Jeor
   - trainingKcal():   geschätzter Verbrauch einer Einheit
   - energyBalance():  Tagesbilanz „verbraucht vs. eingenommen" + Empfehlung
   - estimateKcal():   grobe kcal-Schätzung eines Rezepts aus den Zutaten
   - portionKcal():    pauschale Schätzung für auswärts gegessene Portionen

   Alles ist als Orientierung gedacht – bewusst grob, keine Diät-Beratung.
   ========================================================================= */

import { parseIngredient } from './food.js';

/** MET-Richtwerte je Einheiten-Typ (Intensität als Vielfaches des Ruheumsatzes). */
const MET = {
  recovery: 8, easy: 9, long: 9.5, tempo: 11, interval: 12.5, race: 12, run: 9,
  strength: 5, mobility: 2.5, cross: 7, cross_bike: 7.5, cross_football: 8, walk: 3.5, other: 6,
};

/** Grundumsatz (kcal/Tag) nach Mifflin-St-Jeor. null, wenn Angaben fehlen. */
export function bmr(profile = {}, today) {
  const kg = profile.weightKg, cm = profile.heightCm, by = profile.birthYear;
  if (!kg || !cm || !by) return null;
  const year = parseInt(String(today || '').slice(0, 4)) || new Date().getFullYear();
  const age = Math.max(10, year - by);
  const s = profile.sex === 'm' ? 5 : (profile.sex === 'w' || profile.sex === 'f') ? -161 : -78; // neutral, wenn unbekannt
  return Math.round(10 * kg + 6.25 * cm - 5 * age + s);
}

/** Geschätzter Energieverbrauch einer Einheit (kcal). */
export function trainingKcal(session = {}, weightKg) {
  const kg = weightKg || 70;
  const met = MET[session.type] || MET.other;
  if (session.durationSec) return Math.round(met * kg * (session.durationSec / 3600));
  if (session.distanceKm) return Math.round(kg * session.distanceKm); // Laufen: ~1 kcal/kg/km
  return 0;
}

const round10 = (v) => Math.round(v / 10) * 10;

/**
 * Tagesbilanz: Grundumsatz + Alltag + Training gegen die eingenommenen kcal.
 * `diary` = Ess-Tagebuch-Einträge ({ date, kcal }); die von heute zählen als gegessen.
 * @returns {object|null} null, wenn der Grundumsatz mangels Profilangaben fehlt.
 */
export function energyBalance({ profile = {}, sessions = [], diary = [], today } = {}) {
  const base = bmr(profile, today);
  if (base == null) return null;
  const kg = profile.weightKg;
  const tdeeBase = Math.round(base * (profile.activityFactor || 1.35)); // Alltag ohne Sport

  const trainingOut = sessions
    .filter((s) => s.date === today)
    .reduce((a, s) => a + trainingKcal(s, kg), 0);
  const out = tdeeBase + trainingOut;

  const eaten = diary.filter((m) => m && !m.deleted && m.date === today && m.kcal);
  const intake = eaten.reduce((a, m) => a + (m.kcal || 0), 0);
  const hasIntake = eaten.length > 0;

  // Empfehlung Richtung Zielgewicht
  const gap = (profile.targetWeightKg != null && kg != null) ? kg - profile.targetWeightKg : 0;
  const goal = gap > 0.5 ? 'abnehmen' : gap < -0.5 ? 'zunehmen' : 'halten';
  const delta = goal === 'abnehmen' ? -400 : goal === 'zunehmen' ? 300 : 0;
  const targetIntake = round10(out + delta);

  const balance = intake - out;
  const diff = intake - targetIntake; // >0 zu viel, <0 zu wenig
  let status = 'unklar', hint = 'Noch keine Mahlzeit für heute erfasst.';
  if (hasIntake) {
    if (Math.abs(diff) <= 200) { status = 'passt'; hint = goal === 'halten' ? 'Du hältst dein Gewicht gut.' : `Im Zielkorridor zum ${goal === 'abnehmen' ? 'Abnehmen' : 'Zunehmen'}.`; }
    else if (diff > 200) { status = 'hoch'; hint = `Rund ${round10(diff)} kcal über dem Tagesziel.`; }
    else { status = 'niedrig'; hint = `Rund ${round10(-diff)} kcal unter dem Tagesziel – genug essen.`; }
  }

  return { bmr: base, tdeeBase, trainingOut, out, intake, hasIntake, balance, goal, delta, targetIntake, status, hint };
}

/* ---- kcal-Schätzung aus Zutaten (#26) ---- */

// Grobe Energiedichte je 1 g (bzw. je Stück) nach Stichwort im Zutatennamen.
const KCAL_G = [
  [['öl', 'butter', 'margarine'], 8],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew'], 6],
  [['schokolade', 'kakao'], 5],
  [['haferflocken', 'müsli', 'granola', 'proteinpulver', 'eiweißpulver'], 3.8],
  [['mehl', 'zucker', 'nudel', 'pasta', 'reis', 'quinoa', 'couscous', 'linse', 'bohne', 'haferkleie'], 3.5],
  [['honig', 'sirup', 'marmelade'], 3.0],
  [['käse', 'feta', 'parmesan'], 3.5],
  [['brot', 'brötchen', 'toast', 'wrap'], 2.5],
  [['hack', 'rind', 'salami', 'wurst'], 2.5],
  [['lachs', 'fisch'], 2.0],
  [['avocado'], 1.6],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'tofu'], 1.1],
  [['banane'], 0.9],
  [['kartoffel', 'süßkartoffel', 'mais'], 0.8],
  [['skyr', 'quark', 'joghurt'], 0.7],
  [['milch', 'apfel', 'beere', 'obst'], 0.5],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'zwiebel', 'zucchini', 'pilz'], 0.3],
];
const KCAL_STK = [
  [['ei', 'eier'], 75],
  [['banane'], 100],
  [['apfel', 'orange', 'paprika'], 70],
  [['brötchen', 'scheibe', 'toast'], 90],
  [['avocado'], 240],
];
const matchKcal = (name, table, fallback) => {
  const n = name.toLowerCase();
  for (const [kws, v] of table) if (kws.some((k) => n.includes(k))) return v;
  return fallback;
};

// Grober Proteingehalt je 1 g (bzw. je Stück) – analog zu KCAL_*, für die Schätzhilfe.
const PROT_G = [
  [['proteinpulver', 'eiweißpulver'], 0.80],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'rind', 'hack', 'lachs', 'fisch', 'garnele', 'kabeljau'], 0.22],
  [['parmesan', 'feta', 'käse', 'mozzarella'], 0.20],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew'], 0.20],
  [['tofu', 'linse', 'bohne', 'kichererbse', 'edamame', 'quinoa'], 0.12],
  [['skyr', 'magerquark', 'quark', 'hüttenkäse'], 0.11],
  [['haferflocken', 'nudel', 'pasta', 'reis', 'brot', 'couscous', 'müsli', 'granola'], 0.10],
  [['joghurt', 'milch', 'hafermilch'], 0.04],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'beere', 'apfel', 'banane'], 0.02],
];
const PROT_STK = [
  [['ei', 'eier'], 7],
];

/* Kuratierte Nährwerttabelle für häufige (deutsche) Zutaten – Standardwerte je
   100 g/ml, [Stichwörter, kcal, Protein-g]. Spezifisches vor Allgemeinem (erstes
   Treffer-Stichwort gewinnt). Genauer & rauschfrei -> wird VOR Open Food Facts
   und der groben Heuristik genutzt. Mengenangaben in Rezepten meist roh/trocken
   (Reis/Nudeln) bzw. gekocht/Konserve (Hülsenfrüchte). */
const NUTRI_100 = [
  // Fette, Nüsse, Süßes (energiedicht)
  [['olivenöl', 'rapsöl', 'öl'], 880, 0],
  [['erdnussbutter', 'mandelmus'], 600, 25],
  [['butter'], 740, 1],
  [['margarine'], 720, 0],
  [['walnuss'], 650, 15],
  [['mandel'], 580, 21],
  [['cashew'], 555, 18],
  [['erdnuss', 'erdnüsse'], 570, 26],
  [['chiasamen', 'leinsamen'], 490, 17],
  [['honig'], 300, 0],
  [['sirup', 'agavendicksaft'], 300, 0],
  [['zucker'], 400, 0],
  [['datteln'], 280, 2],
  [['rosinen'], 300, 3],
  [['schokolade'], 540, 7],
  [['kakao'], 350, 20],
  // Getreide / Backwaren (trocken)
  [['proteinpulver', 'eiweißpulver'], 380, 75],
  [['haferflocken'], 370, 13],
  [['granola', 'müsli'], 450, 9],
  [['quinoa'], 360, 14],
  [['couscous'], 350, 12],
  [['vollkornnudeln'], 340, 13],
  [['nudel', 'pasta', 'spaghetti'], 360, 12],
  [['reis'], 350, 7],
  [['mehl'], 350, 10],
  [['knäckebrot'], 350, 10],
  [['reiswaffel'], 380, 8],
  [['vollkornbrot', 'vollkorntoast'], 230, 9],
  [['brot', 'brötchen', 'toast'], 250, 8],
  [['wrap', 'tortilla', 'fladenbrot', 'pizzateig'], 290, 8],
  // Hülsenfrüchte (gekocht/Konserve)
  [['linsen'], 115, 9],
  [['kichererbsen'], 130, 8],
  [['bohne', 'bohnen'], 95, 7],
  [['edamame'], 120, 11],
  // Fleisch / Fisch (roh)
  [['hähnchen', 'hühnchen', 'huhn'], 110, 23],
  [['pute', 'putenbrust'], 105, 24],
  [['hackfleisch', 'hack'], 250, 18],
  [['rind', 'rinder'], 130, 21],
  [['lachs'], 180, 20],
  [['thunfisch'], 110, 24],
  [['kabeljau', 'fisch'], 80, 18],
  [['garnele', 'garnelen'], 85, 20],
  [['salami', 'wurst'], 350, 18],
  // Milchprodukte / vegetarische Eiweißquellen
  [['skyr'], 63, 11],
  [['magerquark'], 67, 12],
  [['hüttenkäse'], 100, 12],
  [['quark'], 110, 12],
  [['parmesan'], 400, 36],
  [['feta'], 260, 14],
  [['mozzarella'], 250, 18],
  [['frischkäse'], 250, 6],
  [['käse'], 360, 25],
  [['joghurt'], 60, 4],
  [['hafermilch'], 45, 1],
  [['milch'], 64, 3],
  [['sahne'], 290, 2],
  [['tofu'], 120, 13],
  [['hummus'], 230, 7],
  // Obst / Gemüse (roh)
  [['avocado'], 160, 2],
  [['banane'], 90, 1],
  [['mango'], 60, 1],
  [['ananas'], 50, 1],
  [['apfel'], 52, 0],
  [['beere', 'beeren'], 45, 1],
  [['süßkartoffel'], 86, 2],
  [['kartoffel'], 70, 2],
  [['brokkoli'], 35, 3],
  [['spinat'], 23, 3],
  [['tomate', 'tomaten'], 18, 1],
  [['paprika'], 30, 1],
  [['zucchini'], 17, 1],
  [['gurke'], 12, 1],
  [['zwiebel'], 40, 1],
  [['karotte', 'möhre'], 40, 1],
  [['champignon', 'pilz'], 22, 3],
  [['salat'], 15, 1],
];
/** Standard-Nährwerte je 100 g/ml zu einem Zutatennamen aus der kuratierten Tabelle – oder null. */
function curatedNutrition(name) {
  const n = String(name).toLowerCase();
  for (const [kws, kcal, prot] of NUTRI_100) if (kws.some((k) => n.includes(k))) return { kcal100: kcal, protein100: prot };
  return null;
}

/**
 * Grobe Nährwert-Schätzung eines Rezepts (eine Portion) aus den Zutaten.
 * Mit optionalem `lookup(name) -> {kcal100, protein100}` (z. B. Open Food Facts)
 * werden echte Werte je 100 g/ml bevorzugt; sonst greifen die lokalen Tabellen.
 * @returns {{kcal:number, protein:number|null}|null}  null bei leerer Liste.
 */
// OFF-Wert nur übernehmen, wenn er grob (Faktor 0,5–2) zur lokalen Erwartung
// passt – schützt vor kontaminierten Marken-Medianen aus Open Food Facts
// (z. B. „Öl“-Dressings, „Hähnchen“-Fertiggerichte).
const plausible = (offPerG, heurPerG) => {
  if (offPerG == null) return null;
  if (heurPerG <= 0) return offPerG;            // keine Erwartung -> OFF nehmen
  const r = offPerG / heurPerG;
  return (r >= 0.5 && r <= 2) ? offPerG : null; // sonst verwerfen
};

export function estimateNutrition(ingredients = [], lookup = null) {
  let kcal = 0, protein = 0, counted = 0, hadProtein = false;
  (ingredients || []).forEach((raw) => {
    const p = parseIngredient(raw);
    if (!p.name) return;
    counted++;
    if (p.amount != null && (p.unit === 'g' || p.unit === 'ml')) {
      const cur = curatedNutrition(p.name);
      if (cur) {
        // 1) Kuratierte Tabelle: genau & rauschfrei -> direkt nutzen.
        kcal += (cur.kcal100 / 100) * p.amount;
        if (cur.protein100 > 0) { protein += (cur.protein100 / 100) * p.amount; hadProtein = true; }
      } else {
        // 2) Open Food Facts (sanity-gegatet), sonst 3) grobe Heuristik.
        const off = lookup ? lookup(p.name) : null;
        const heurK = matchKcal(p.name, KCAL_G, 1.2);
        const heurP = matchKcal(p.name, PROT_G, 0);
        const perK = plausible(off && off.kcal100 != null ? off.kcal100 / 100 : null, heurK) ?? heurK;
        const perP = plausible(off && off.protein100 != null ? off.protein100 / 100 : null, heurP) ?? heurP;
        kcal += perK * p.amount;
        if (perP > 0) { protein += perP * p.amount; hadProtein = true; }
      }
    } else if (p.amount != null && p.unit === 'Stück') {
      kcal += matchKcal(p.name, KCAL_STK, 60) * p.amount;
      const pr = matchKcal(p.name, PROT_STK, 0) * p.amount; if (pr) { protein += pr; hadProtein = true; }
    } else {
      kcal += 45; // unbestimmte Zutat pauschal
    }
  });
  if (!counted) return null;
  return { kcal: round10(kcal), protein: hadProtein ? Math.round(protein) : null };
}

/** Nur die kcal-Schätzung (Rückwärtskompatibilität; akzeptiert denselben optionalen lookup). */
export function estimateKcal(ingredients = [], lookup = null) {
  const r = estimateNutrition(ingredients, lookup);
  return r ? r.kcal : null;
}

/** Pauschale kcal nach Portionsgröße – für schnell nachgepflegte Auswärts-Mahlzeiten. */
export const PORTION_KCAL = { klein: 350, mittel: 550, gross: 800, restaurant: 1000 };
export function portionKcal(size) { return PORTION_KCAL[size] ?? PORTION_KCAL.mittel; }
