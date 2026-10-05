/* =========================================================================
   energy.js — Kalorien & Energiebilanz (aus dem Praxis-Feedback).
   Reine Funktionen ohne Store/DOM, damit alles unit-testbar bleibt.

   - bmr():            Grundumsatz nach Mifflin-St-Jeor
   - trainingKcal():   Verbrauch einer Einheit (gemessen, sonst geschätzt)
   - energyBalance():  Tagesbilanz „verbraucht vs. eingenommen“ + Empfehlung
   - estimateKcal():   grobe kcal-Schätzung eines Rezepts aus den Zutaten
   - portionKcal():    pauschale Schätzung für auswärts gegessene Portionen

   Alles ist als Orientierung gedacht – bewusst grob, keine Diät-Beratung.
   ========================================================================= */

import { parseIngredient, fold, keywordIn, wordRe } from './food.js';
import { fmtInt } from './format.js';
import { t } from './i18n.js';

/** MET-Richtwerte je Einheiten-Typ (Intensität als Vielfaches des Ruheumsatzes; übrige
    Sportarten nach dem Compendium of Physical Activities – vorher zählten sie pauschal 6). */
const MET = {
  recovery: 8, easy: 9, long: 9.5, tempo: 11, interval: 12.5, race: 12, run: 9,
  strength: 5, mobility: 2.5, cross: 7, cross_bike: 7.5, cross_football: 8, walk: 3.5, other: 6,
  swim: 8, rowing: 7, hike: 6, tennis: 7, badminton: 5.5, squash: 9, tabletennis: 4, spinning: 8, elliptical: 5, gym: 5,
};

/** Quellen, deren `kcal` die gemessene AKTIVE Energie einer Einheit ist (Apple Health:
    Auto-Export und Voll-Import) – ohne Ruheumsatz, von der Uhr aus Herzfrequenz und Bewegung. */
export const MEASURED_KCAL_SOURCES = ['apple-health', 'health'];
/** Gemessene aktive Energie einer Einheit (kcal) oder null. */
export function measuredActiveKcal(s) {
  const k = Number(s && s.kcal);
  return s && MEASURED_KCAL_SOURCES.includes(s.source) && Number.isFinite(k) && k > 0 && k < 10000 ? k : null;
}

/** Grundumsatz (kcal/Tag) nach Mifflin-St-Jeor. null, wenn Angaben fehlen. */
export function bmr(profile = {}, today) {
  const kg = profile.weightKg, cm = profile.heightCm, by = profile.birthYear;
  if (!kg || !cm || !by) return null;
  const year = parseInt(String(today || '').slice(0, 4)) || new Date().getFullYear();
  const age = Math.max(10, year - by);
  const s = profile.sex === 'm' ? 5 : (profile.sex === 'w' || profile.sex === 'f') ? -161 : -78; // neutral, wenn unbekannt
  return Math.round(10 * kg + 6.25 * cm - 5 * age + s);
}

/** Lauf-Einheiten (Energieaufwand hängt hier an der Strecke, nicht am MET-Mittel). */
const RUN_TYPES = ['easy', 'long', 'tempo', 'interval', 'race', 'run', 'recovery'];

/**
 * Geschätzter Energieverbrauch einer Einheit (kcal).
 *
 * @param {object} session
 * @param {number} weightKg
 * @param {{net?: boolean, activityFactor?: number}} [opts]
 *   `net: true` zieht den Ruhe-/Alltagsumsatz ab, der für dieselbe Zeit ohnehin
 *   im Tagesumsatz steckt – nur so darf der Wert auf den TDEE addiert werden
 *   (sonst zählt der Grundumsatz der Trainingsstunde doppelt, ~100 kcal/h).
 *   Für die reine Anzeige („verbrannt“) bleibt der Brutto-Wert der Standard,
 *   weil Uhren und Tracker ihn ebenfalls brutto ausweisen.
 */
export function trainingKcal(session = {}, weightKg, { net = false, activityFactor = 1.35 } = {}) {
  const kg = weightKg || 70;
  const hours = session.durationSec ? session.durationSec / 3600 : null;
  const baseline = net ? activityFactor : 0;   // in MET-Einheiten

  // Gemessen schlägt geschätzt: Die aktive Energie der Uhr enthält keinen Ruheumsatz.
  // Brutto (Anzeige) = aktiv + Ruheumsatz der Trainingszeit (~1 kcal je kg und Stunde);
  // netto zieht davon wie unten den ohnehin im Tagesumsatz steckenden Alltagsumsatz ab.
  const active = measuredActiveKcal(session);
  if (active != null) return Math.max(0, Math.round(active + (hours ? (1 - baseline) * kg * hours : 0)));

  // Laufen mit bekannter Strecke: ~1 kcal/kg/km brutto – geschwindigkeitsunabhängig
  // und deutlich näher an der Realität als ein pauschaler MET-Wert. (Vorher nur
  // als Fallback ohne Dauer genutzt, was 10 km in 50 min um ~33 % auseinanderlaufen ließ.)
  if (session.distanceKm && RUN_TYPES.includes(session.type)) {
    const gross = kg * session.distanceKm;
    const rest = hours ? baseline * kg * hours : 0;
    return Math.max(0, Math.round(gross - rest));
  }

  const met = MET[session.type] || MET.other;
  if (hours) return Math.max(0, Math.round(Math.max(0, met - baseline) * kg * hours));
  if (session.distanceKm) return Math.round(kg * session.distanceKm);
  return 0;
}

const round10 = (v) => Math.round(v / 10) * 10;
const dayNum = (d) => Math.round(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / 86400000);

/** Standard-Tagesdefizit ohne laufenden Plan (kcal). */
export const DEFAULT_DEFICIT = -400;
/** Höchstens so viel Defizit (Anteil am Tagesumsatz), solange keine fettfreie Masse bekannt ist. */
export const MAX_DEFICIT_SHARE = 0.15;
/** Untergrenze der Energieverfügbarkeit fürs Tagesziel beim Abnehmen (kcal je kg fettfreier Masse). */
export const EA_FLOOR = 30;
/** Toleranzband ums Zielgewicht (kg): innerhalb gilt „halten“. */
export const WEIGHT_TOLERANCE_KG = 0.5;

/**
 * Aktuelles Körpergewicht: Median der Messungen der letzten 7 Tage bis zur jüngsten
 * Messung (glättet Tagesschwankungen von ±1–2 kg), sonst das Profilgewicht.
 */
export function weightNow(health = [], profile = {}, today = null) {
  const vals = (health || []).filter((h) => h && !h.deleted && h.date && (!today || h.date <= today)
    && h.weight !== '' && h.weight != null && Number.isFinite(Number(h.weight)));
  if (vals.length) {
    const latest = vals.reduce((a, b) => (String(b.date) > String(a.date) ? b : a));
    const lastDay = dayNum(latest.date);
    // Unlesbares Datum (Fremdimport): ohne Glättung den jüngsten Wert nehmen statt NaN.
    const win = Number.isFinite(lastDay)
      ? vals.filter((v) => lastDay - dayNum(v.date) < 7).map((v) => Number(v.weight)).sort((a, b) => a - b)
      : [];
    if (!win.length) return Number(latest.weight);
    const m = Math.floor(win.length / 2);
    return Math.round((win.length % 2 ? win[m] : (win[m - 1] + win[m]) / 2) * 10) / 10;
  }
  const p = Number(profile && profile.weightKg);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Zielgewicht-Status – EINE Definition für alle Ansichten (Ernährung, Cockpit,
 * Wochenziele, Gesundheitsziele, Statistik). Die Richtung kommt vom Startwert
 * (`start`, sonst dem aktuellen Wert); ± 0,5 kg um das Ziel heißt „halten“.
 * Wer ein Abnehmziel unterschreitet, bekommt „halten – Ziel prüfen“, nie
 * automatisch „zunehmen“ (das gibt es nur bei einem echten Zunahmeziel).
 * @returns {null|{current, target, start, direction:'down'|'up'|'hold', reached:boolean,
 *   status:'abnehmen'|'zunehmen'|'halten', remaining:number, gap:number, beyond:boolean}}
 */
export function weightGoalStatus({ current = null, target = null, start = null } = {}) {
  if (current == null || target == null || current === '' || target === '') return null;
  const c = Number(current), tgt = Number(target);
  if (!Number.isFinite(c) || !Number.isFinite(tgt)) return null;
  const s = start != null && start !== '' && Number.isFinite(Number(start)) ? Number(start) : null;
  const from = s != null ? s : c;
  const direction = from > tgt ? 'down' : from < tgt ? 'up' : 'hold';
  const gap = Math.round((c - tgt) * 10) / 10;              // > 0: über dem Ziel
  const near = Math.abs(gap) <= WEIGHT_TOLERANCE_KG;
  let reached;
  if (direction === 'down') reached = c <= tgt;
  else if (direction === 'up') reached = c >= tgt;
  else reached = near;
  let status;
  if (reached || near) status = 'halten';
  else if (direction === 'hold') status = gap > 0 ? 'abnehmen' : 'zunehmen';
  else status = direction === 'down' ? 'abnehmen' : 'zunehmen';
  return {
    current: c, target: tgt, start: s, direction, reached, status,
    remaining: reached ? 0 : Math.abs(gap), gap, beyond: reached && !near,
  };
}

/** BMI eines Gewichts bei der Profilgröße (oder null). */
export function bmiFor(kg, profile = {}) {
  const m = Number(profile.heightCm) / 100;
  const w = Number(kg);
  if (!m || !Number.isFinite(w) || w <= 0) return null;
  return Math.round((w / (m * m)) * 10) / 10;
}

/**
 * Tagesbilanz: Grundumsatz + Alltag + Training gegen die eingenommenen kcal.
 * `diary` = Ess-Tagebuch-Einträge ({ date, kcal }); die von heute zählen als gegessen.
 *
 * Optionen (seit v3.20.0, über `energyTargets` gesetzt):
 *   `goal`  – Ziel vorgeben ('abnehmen'|'zunehmen'|'halten'); sonst aus Profil-/Zielgewicht
 *   `ffm`   – fettfreie Masse: Das Tagesziel beim Abnehmen bleibt dann über
 *             Trainingsverbrauch + 30 kcal je kg FFM (Energieverfügbarkeit ≥ 30).
 *             Ohne FFM ist das Defizit auf 15 % des Tagesumsatzes begrenzt.
 * @returns {object|null} null, wenn der Grundumsatz mangels Profilangaben fehlt.
 */
export function energyBalance({ profile = {}, sessions = [], diary = [], today, deficitKcal = null, goal: goalIn = null, ffm = null } = {}) {
  const base = bmr(profile, today);
  if (base == null) return null;
  const kg = profile.weightKg;
  const af = profile.activityFactor || 1.35;
  const tdeeBase = Math.round(base * af); // Alltag ohne Sport

  // NETTO-Trainingsverbrauch: der Ruheumsatz der Trainingsstunde steckt bereits
  // in tdeeBase und darf nicht doppelt zählen.
  const todays = sessions.filter((s) => s.date === today);
  const trainingOut = todays.reduce((a, s) => a + trainingKcal(s, kg, { net: true, activityFactor: af }), 0);
  const trainingGross = todays.reduce((a, s) => a + trainingKcal(s, kg), 0);
  const out = tdeeBase + trainingOut;

  const eaten = diary.filter((m) => m && !m.deleted && !m._kind && m.date === today && m.kcal);
  const intake = eaten.reduce((a, m) => a + (m.kcal || 0), 0);
  const hasIntake = eaten.length > 0;

  // Empfehlung Richtung Zielgewicht. `deficitKcal` kommt – wenn ein Plan läuft –
  // aus dualgoal.js (phasenabhängig: Grundlage −450 … Tapering 0). Ohne Plan
  // gilt der moderate Standardwert.
  let goal = goalIn;
  if (!goal) {
    const gap = (profile.targetWeightKg != null && kg != null) ? kg - profile.targetWeightKg : 0;
    goal = gap > WEIGHT_TOLERANCE_KG ? 'abnehmen' : gap < -WEIGHT_TOLERANCE_KG ? 'zunehmen' : 'halten';
  }
  let delta = goal === 'abnehmen' ? (deficitKcal != null ? deficitKcal : DEFAULT_DEFICIT)
    : goal === 'zunehmen' ? 300 : 0;

  // SICHERHEITSUNTERGRENZEN beim Abnehmen (RED-S): nie unter den Grundumsatz und –
  // wenn die fettfreie Masse bekannt ist – nie unter Trainingsverbrauch + 30 kcal je
  // kg FFM (darunter beginnt die niedrige Energieverfügbarkeit). Ohne FFM höchstens
  // 15 % Defizit. Die strengste Grenze gewinnt.
  let floorReason = null;
  let target = out + delta;
  if (delta < 0) {
    const floors = [['bmr', base]];
    if (ffm) floors.push(['ea', trainingGross + EA_FLOOR * ffm]);
    else floors.push(['share', out * (1 - MAX_DEFICIT_SHARE)]);
    for (const [reason, min] of floors) {
      if (target < min) { target = min; floorReason = reason; }
    }
    // Auf 10 kcal Richtung „weniger Defizit“ gerundet – nie tiefer als die Untergrenze.
    if (floorReason) delta = Math.min(0, Math.ceil((target - out) / 10) * 10);
  }
  const floored = floorReason != null;
  const targetIntake = round10(target);

  const balance = intake - out;
  const diff = intake - targetIntake; // >0 zu viel, <0 zu wenig
  let status = 'unklar', hint = t('nutrition.qualNone');
  if (hasIntake) {
    if (Math.abs(diff) <= 200) { status = 'passt'; hint = goal === 'halten' ? t('energy.holdingWell') : goal === 'abnehmen' ? t('energy.onTrackLose') : t('energy.onTrackGain'); }
    else if (diff > 200) { status = 'hoch'; hint = t('energy.overTarget', { kcal: fmtInt(round10(diff)) }); }
    else { status = 'niedrig'; hint = t('energy.underTarget', { kcal: fmtInt(round10(-diff)) }); }
  }

  if (floorReason === 'bmr') {
    hint += ` ${t('energy.floorBmr')}`;
  } else if (floorReason === 'ea') {
    hint += ` ${t('energy.floorEa')}`;
  } else if (floorReason === 'share') {
    hint += ` ${t('energy.floorShare')}`;
  }
  return { bmr: base, tdeeBase, trainingOut, trainingGross, out, intake, hasIntake, balance, goal, delta, targetIntake, status, hint, floored, floorReason };
}

/**
 * Ziel-Plan für die Energieempfehlung: der Plan zum nächsten anstehenden Wettkampf
 * (wie im Ziel-Cockpit). Programme ohne Wettkampf zählen nicht.
 */
export function goalPlanFor(plans = [], events = [], today = null) {
  let best = null;
  for (const p of (plans || [])) {
    if (!p || p.deleted || p.kind === 'program') continue;
    const ev = (events || []).find((e) => e && !e.deleted && e.id === p.eventId);
    if (!ev || !ev.date || (today && ev.date < today)) continue;
    if (!best || ev.date < best.event.date) best = { plan: p, event: ev };
  }
  return best;
}

/**
 * EINE Quelle für Ernährungskarte und Ziel-Cockpit: aktuelles (geglättetes) Gewicht,
 * Zielgewicht-Status, Phasen-Defizit aus dem Wettkampfplan, Eignung (Kinder,
 * Schwangerschaft, Essstörung → keine Abnehmziele), Ziel-BMI unter 18,5 → halten,
 * Sicherheitsuntergrenzen. `phaseDeficit(plan, today)` liefert das Phasen-Defizit
 * (dualgoal.js) – als Parameter, damit dieses Modul ohne Plan-Abhängigkeiten bleibt.
 */
export function energyTargets({
  profile = {}, health = [], sessions = [], diary = [], plans = [], events = [], today,
  elig = null, ffm = null, phaseDeficit = null,
} = {}) {
  const kgNow = weightNow(health, profile, today);
  const status = weightGoalStatus({
    current: kgNow, target: profile.targetWeightKg,
    start: profile.targetWeightStartKg != null ? profile.targetWeightStartKg : profile.weightKg,
  });
  const goalPlan = goalPlanFor(plans, events, today);
  const phaseKcal = goalPlan && phaseDeficit ? phaseDeficit(goalPlan.plan, today) : null;

  let block = null;
  if (elig && elig.minor) block = 'minor';
  else if (elig && elig.noWeightGoals && status && status.status === 'abnehmen') block = 'eligibility';
  else if (status && status.status === 'abnehmen') {
    const bmiTarget = bmiFor(profile.targetWeightKg, profile);
    if (bmiTarget != null && bmiTarget < 18.5) block = 'bmi';
  }
  const goal = block ? 'halten' : (status ? status.status : 'halten');
  const deficitKcal = phaseKcal != null ? phaseKcal : DEFAULT_DEFICIT;
  const bal = block === 'minor'
    ? null   // Kinder- und Jugendprofil: keine Grundumsatz-/Zielrechnung (Mifflin gilt ab 19)
    : energyBalance({ profile: kgNow != null ? { ...profile, weightKg: kgNow } : profile, sessions, diary, today, deficitKcal, goal, ffm });
  return {
    balance: bal, goalStatus: status, weightNow: kgNow, block, goal,
    plan: goalPlan ? goalPlan.plan : null, event: goalPlan ? goalPlan.event : null,
    deficitKcal: bal ? bal.delta : 0,
  };
}

/* ---- kcal-Schätzung aus Zutaten (#26) ---- */

// Grobe Energiedichte je 1 g (bzw. je Stück) nach Stichwort im Zutatennamen.
// English keywords follow the German ones in each row (substring match: 'nuts', not 'nut',
// so “butternut”/“coconut” stay out).
const KCAL_G = [
  [['öl', 'butter', 'margarine', 'oil'], 8],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew', 'nuts', 'hazelnut', 'almond', 'walnut', 'peanut'], 6],
  [['schokolade', 'kakao', 'chocolate', 'cocoa'], 5],
  [['haferflocken', 'müsli', 'granola', 'proteinpulver', 'eiweißpulver', 'oats', 'oatmeal', 'muesli', 'protein powder', 'whey'], 3.8],
  [['mehl', 'zucker', 'nudel', 'pasta', 'reis', 'quinoa', 'couscous', 'linse', 'bohne', 'haferkleie',
    'flour', 'sugar', 'noodle', 'rice', 'lentil', 'bean', 'oat bran'], 3.5],
  [['honig', 'sirup', 'marmelade', 'honey', 'syrup', 'jam', 'marmalade'], 3.0],
  [['käse', 'feta', 'parmesan', 'cheese'], 3.5],
  [['brot', 'brötchen', 'toast', 'wrap', 'bread'], 2.5],
  [['hack', 'rind', 'salami', 'wurst', 'mince', 'beef', 'sausage'], 2.5],
  [['lachs', 'fisch', 'salmon', 'fish'], 2.0],
  [['avocado'], 1.6],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'tofu', 'chicken', 'turkey', 'tuna'], 1.1],
  [['banane', 'banana'], 0.9],
  [['kartoffel', 'süßkartoffel', 'mais', 'potato', 'sweetcorn'], 0.8],
  [['skyr', 'quark', 'joghurt', 'yoghurt', 'yogurt'], 0.7],
  [['milch', 'apfel', 'beere', 'obst', 'milk', 'apple', 'berry', 'berries', 'fruit'], 0.5],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'zwiebel', 'zucchini', 'pilz',
    'vegetable', 'salad', 'lettuce', 'spinach', 'tomato', 'pepper', 'broccoli', 'cucumber', 'onion', 'courgette', 'mushroom'], 0.3],
];
const KCAL_STK = [
  [['ei', 'eier', 'egg', 'eggs'], 75],
  [['banane', 'banana', 'bananas'], 100],
  [['apfel', 'orange', 'paprika', 'apple', 'apples', 'oranges', 'pepper', 'peppers'], 70],
  [['brötchen', 'scheibe', 'toast', 'bread roll', 'bread rolls', 'roll', 'rolls', 'slice'], 90],
  [['avocado', 'avocados'], 240],
];
const matchKcal = (name, table, fallback) => {
  const n = fold(name);
  for (const [kws, v] of table) if (kws.some((k) => keywordIn(n, k))) return v;
  return fallback;
};
// Ganzes Wort (auch in Zusammensetzungen am Wortanfang/-ende nicht): „Ei“ ist nicht
// „Reiswaffel“ oder „Pizzateig“ (wordRe und das „=“-Stichwort: food.js).
const matchWord = (name, table, fallback) => {
  const n = fold(name);
  for (const [kws, v] of table) if (kws.some((k) => wordRe(k).test(n))) return v;
  return fallback;
};

/* Grammäquivalente für Küchenmaße – früher zählte alles außer g/ml/Stück pauschal
   45 kcal (ein Esslöffel Öl wie eine Prise Salz). [Stichwörter, Gramm]. */
const EL_G = [
  [['öl', 'butter', 'margarine', 'chiasamen', 'leinsamen', 'oil', 'chia', 'linseed', 'flaxseed'], 10],
  [['honig', 'sirup', 'agavendicksaft', 'marmelade', 'honey', 'syrup', 'agave', 'jam', 'marmalade'], 20],
  [['erdnussbutter', 'mandelmus', 'nussmus', 'joghurt', 'quark', 'skyr', 'frischkäse', 'hummus',
    'peanut butter', 'almond butter', 'nut butter', 'yoghurt', 'yogurt', 'cream cheese'], 15],
  [['haferflocken', 'mehl', 'kakao', 'proteinpulver', 'eiweißpulver', 'zucker', 'müsli',
    'oats', 'oatmeal', 'flour', 'cocoa', 'protein powder', 'whey', 'sugar', 'muesli'], 8],
];
const SCHEIBE_G = [
  [['knäckebrot', 'crispbread'], 10],
  [['brot', 'toast', 'vollkorn', 'bread', 'wholemeal', 'wholegrain'], 45],
  [['käse', 'gouda', 'emmentaler', 'cheese', 'emmental'], 20],
  [['wurst', 'salami', 'schinken', 'sausage'], 15],
];
const DOSE_G = [
  [['kokosmilch', 'tomate', 'tomaten', 'coconut milk', 'tomato'], 400],
  [['thunfisch', 'tuna'], 150],
];
// Stück-Gewichte für Zutaten, die in der Nährwerttabelle stehen (dann rechnet die
// App über die Gramm-Werte statt über eine Pauschale).
// Whole-word match: the sweet-potato row comes before the potato row, otherwise
// “sweet potato” would count as “potato”.
const PIECE_G = [
  [['reiswaffel', 'reiswaffeln', 'rice cake', 'rice cakes'], 8],
  [['knäckebrot', 'crispbread'], 10],
  [['brötchen', 'bread roll', 'bread rolls'], 60],
  [['fladenbrot', 'flatbread', 'flatbreads'], 200],
  [['pizzateig', 'pizza dough', 'pizza base'], 250],
  [['wrap', 'tortilla', 'wraps', 'tortillas'], 60],
  [['banane', 'bananen', 'banana', 'bananas'], 120],
  [['apfel', 'äpfel', 'apple', 'apples'], 150],
  [['avocado', 'avocados'], 150],
  [['süßkartoffel', 'süßkartoffeln', 'sweet potato', 'sweet potatoes'], 200],
  [['kartoffel', 'kartoffeln', 'potato', 'potatoes'], 100],
  [['zwiebel', 'zwiebeln', 'onion', 'onions'], 80],
  [['tomate', 'tomaten', 'tomato', 'tomatoes'], 100],
  [['paprika', 'pepper', 'peppers'], 150],
  [['karotte', 'karotten', 'möhre', 'möhren', 'carrot', 'carrots'], 80],
  [['zucchini', 'courgette', 'courgettes'], 250],
  [['gurke', 'gurken', 'cucumber', 'cucumbers'], 400],
];
// Gewürze & Co. zählen nicht.
const NEGLIGIBLE = ['salz', 'pfeffer', 'gewürz', 'zimt', 'kräuter', 'petersilie', 'basilikum', 'knoblauch', 'chili', 'curry', 'paprikapulver', 'oregano', 'muskat', 'vanille', 'backpulver', 'natron', 'essig', 'zitronensaft',
  'salt', 'black pepper', 'peppercorns', 'spice', 'spices', 'cinnamon', 'herbs', 'parsley', 'basil', 'garlic', 'chilli', 'paprika powder', 'nutmeg', 'vanilla', 'baking powder', 'baking soda', 'bicarbonate of soda', 'vinegar', 'lemon juice'];

/** Menge einer Zutat in Gramm/Milliliter (oder null, wenn nicht ableitbar). */
function gramsOf(p) {
  const n = fold(p.name);
  if (p.amount == null) return null;
  switch (p.unit) {
    case 'g': case 'ml': return p.amount;
    case 'EL': return p.amount * matchKcal(n, EL_G, 12);
    case 'TL': return p.amount * matchKcal(n, EL_G, 12) / 3;
    case 'Prise': case 'Zehe': return 0;
    case 'Scheibe': return p.amount * matchKcal(n, SCHEIBE_G, 30);
    case 'Dose': return p.amount * matchKcal(n, DOSE_G, 240);
    case 'Bund': return p.amount * 50;
    case 'Becher': case 'Glas': case 'Packung': return p.amount * 200;
    case 'Stück': { const g = matchWord(n, PIECE_G, null); return g != null ? p.amount * g : null; }
    default: return null;
  }
}

// Grober Proteingehalt je 1 g (bzw. je Stück) – analog zu KCAL_*, für die Schätzhilfe.
const PROT_G = [
  [['proteinpulver', 'eiweißpulver', 'protein powder', 'whey'], 0.80],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'rind', 'hack', 'lachs', 'fisch', 'garnele', 'kabeljau',
    'chicken', 'turkey', 'tuna', 'beef', 'mince', 'salmon', 'fish', 'prawn', 'shrimp', 'cod'], 0.22],
  [['parmesan', 'feta', 'käse', 'mozzarella', 'cheese'], 0.20],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew', 'nuts', 'hazelnut', 'almond', 'walnut', 'peanut'], 0.20],
  [['tofu', 'linse', 'bohne', 'kichererbse', 'edamame', 'quinoa', 'lentil', 'bean', 'chickpea'], 0.12],
  [['skyr', 'magerquark', 'quark', 'hüttenkäse'], 0.11],
  [['haferflocken', 'nudel', 'pasta', 'reis', 'brot', 'couscous', 'müsli', 'granola', 'oats', 'oatmeal', 'noodle', 'rice', 'bread', 'muesli'], 0.10],
  [['joghurt', 'milch', 'hafermilch', 'yoghurt', 'yogurt', 'milk'], 0.04],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'beere', 'apfel', 'banane',
    'vegetable', 'salad', 'lettuce', 'spinach', 'tomato', 'pepper', 'broccoli', 'cucumber', 'berry', 'berries', 'apple', 'banana'], 0.02],
];
const PROT_STK = [
  [['ei', 'eier', 'egg', 'eggs'], 7],
];

/* Kuratierte Nährwerttabelle für häufige (deutsche) Zutaten – Standardwerte je
   100 g/ml, [Stichwörter, kcal, Protein-g]. Spezifisches vor Allgemeinem (erstes
   Treffer-Stichwort gewinnt). Genauer & rauschfrei -> wird VOR Open Food Facts
   und der groben Heuristik genutzt. Mengenangaben in Rezepten meist roh/trocken
   (Reis/Nudeln) bzw. gekocht/Konserve (Hülsenfrüchte). */
const NUTRI_100 = [
  // Fette, Nüsse, Süßes (energiedicht)
  // English: only named oils here; plain 'oil' is the last row, so “boiled potatoes” finds
  // the potato row first.
  [['olivenöl', 'rapsöl', 'öl', 'olive oil', 'rapeseed oil', 'sunflower oil', 'vegetable oil', 'coconut oil',
    'sesame oil', 'linseed oil', 'peanut oil', 'walnut oil', 'almond oil', 'canola oil'], 880, 0],
  [['erdnussbutter', 'mandelmus', 'peanut butter', 'almond butter'], 600, 25],
  // Substring-Fallen: „Buttermilch“/„Mandelmilch“ müssen VOR „butter“/„mandel“
  // stehen, sonst würden sie als Butter (740 kcal) bzw. Mandeln (580) gewertet.
  [['buttermilch', 'buttermilk'], 37, 3],
  [['mandelmilch', 'almond milk', 'almond drink'], 15, 1],
  [['kokosmilch', 'coconut milk'], 180, 2],
  [['butter'], 740, 1],
  [['margarine'], 720, 0],
  [['walnuss', 'walnut'], 650, 15],
  [['mandel', 'almond'], 580, 21],
  [['cashew'], 555, 18],
  [['erdnuss', 'erdnüsse', 'peanut'], 570, 26],
  [['chiasamen', 'leinsamen', 'chia', 'linseed', 'flaxseed'], 490, 17],
  [['honig', 'honey'], 300, 0],
  [['sirup', 'agavendicksaft', 'syrup', 'agave'], 300, 0],
  [['zucker', 'sugar'], 400, 0],
  [['datteln', 'dates'], 280, 2],
  [['rosinen', 'raisins', 'sultanas'], 300, 3],
  [['schokolade', 'chocolate'], 540, 7],
  [['kakao', 'cocoa'], 350, 20],
  // Getreide / Backwaren (trocken)
  [['proteinpulver', 'eiweißpulver', 'protein powder', 'whey'], 380, 75],
  [['haferflocken', 'oats', 'oatmeal'], 370, 13],
  [['granola', 'müsli', 'muesli'], 450, 9],
  [['quinoa'], 360, 14],
  [['couscous'], 350, 12],
  [['grieß', 'griess', 'semolina'], 350, 11],
  [['vollkornnudeln', 'wholemeal pasta', 'wholewheat pasta', 'whole wheat pasta', 'wholegrain pasta'], 340, 13],
  [['nudel', 'pasta', 'spaghetti', 'noodle'], 360, 12],
  [['reis', 'rice'], 350, 7],
  [['mehl', 'flour'], 350, 10],
  [['knäckebrot', 'crispbread'], 350, 10],
  [['reiswaffel', 'rice cake'], 380, 8],
  [['vollkornbrot', 'vollkorntoast', 'wholemeal bread', 'wholemeal toast', 'wholegrain bread', 'wholewheat bread'], 230, 9],
  [['brot', 'brötchen', 'toast', 'bread'], 250, 8],
  [['wrap', 'tortilla', 'fladenbrot', 'pizzateig', 'flatbread', 'pizza dough', 'pizza base'], 290, 8],
  // Hülsenfrüchte (gekocht/Konserve)
  [['linsen', 'lentil'], 115, 9],
  [['kichererbsen', 'chickpea'], 130, 8],
  [['bohne', 'bohnen', 'bean'], 95, 7],
  [['edamame'], 120, 11],
  // Fleisch / Fisch (roh)
  [['hähnchen', 'hühnchen', 'huhn', 'chicken'], 110, 23],
  [['pute', 'putenbrust', 'turkey'], 105, 24],
  [['hackfleisch', 'hack', 'mince', 'ground beef'], 250, 18],
  [['rind', 'rinder', 'beef'], 130, 21],
  [['lachs', 'salmon'], 180, 20],
  [['thunfisch', 'tuna'], 110, 24],
  [['kabeljau', 'fisch', 'cod', 'fish'], 80, 18],
  [['garnele', 'garnelen', 'prawn', 'shrimp'], 85, 20],
  [['salami', 'wurst', 'sausage'], 350, 18],
  // Milchprodukte / vegetarische Eiweißquellen
  [['skyr'], 63, 11],
  [['magerquark', 'low-fat quark', 'low fat quark'], 67, 12],
  [['hüttenkäse', 'cottage cheese'], 100, 12],
  [['quark'], 110, 12],
  [['parmesan'], 400, 36],
  [['feta'], 260, 14],
  [['mozzarella'], 250, 18],
  [['frischkäse', 'cream cheese'], 250, 6],
  [['käse', 'cheese'], 360, 25],
  [['joghurt', 'yoghurt', 'yogurt'], 60, 4],
  [['hafermilch', 'oat milk', 'oat drink'], 45, 1],
  [['milch', 'milk'], 64, 3],
  [['sahne', 'cream'], 290, 2],
  [['tofu'], 120, 13],
  [['hummus'], 230, 7],
  // Obst / Gemüse (roh)
  [['avocado'], 160, 2],
  [['banane', 'banana'], 90, 1],
  [['mango'], 60, 1],
  [['ananas', 'pineapple'], 50, 1],
  [['apfel', 'apple'], 52, 0],
  [['beere', 'beeren', 'berry', 'berries'], 45, 1],
  [['süßkartoffel', 'sweet potato'], 86, 2],
  [['kartoffel', 'potato'], 70, 2],
  [['brokkoli', 'broccoli'], 35, 3],
  [['spinat', 'spinach'], 23, 3],
  [['tomate', 'tomaten', 'tomato'], 18, 1],
  [['paprika', 'pepper'], 30, 1],
  [['zucchini', 'courgette'], 17, 1],
  [['gurke', 'cucumber'], 12, 1],
  [['zwiebel', 'onion'], 40, 1],
  [['karotte', 'möhre', 'carrot'], 40, 1],
  [['champignon', 'pilz', 'mushroom'], 22, 3],
  [['salat', 'lettuce', 'salad'], 15, 1],
  // Plain English 'oil' last: as a substring it also sits in “boiled”.
  [['oil'], 880, 0],
];
/** Standard-Nährwerte je 100 g/ml zu einem Zutatennamen aus der kuratierten Tabelle – oder null. */
function curatedNutrition(name) {
  const n = fold(name);
  for (const [kws, kcal, prot] of NUTRI_100) if (kws.some((k) => keywordIn(n, k))) return { kcal100: kcal, protein100: prot };
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
    const lname = fold(p.name);
    if (NEGLIGIBLE.some((k) => wordRe(k).test(lname) || lname === k)) return;   // Gewürze
    const grams = gramsOf(p);
    if (grams != null) {
      if (grams <= 0) return;
      const cur = curatedNutrition(p.name);
      if (cur) {
        // 1) Kuratierte Tabelle: genau & rauschfrei -> direkt nutzen.
        kcal += (cur.kcal100 / 100) * grams;
        if (cur.protein100 > 0) { protein += (cur.protein100 / 100) * grams; hadProtein = true; }
      } else {
        // 2) Open Food Facts (sanity-gegatet), sonst 3) grobe Heuristik.
        const off = lookup ? lookup(p.name) : null;
        const heurK = matchKcal(p.name, KCAL_G, 1.2);
        const heurP = matchKcal(p.name, PROT_G, 0);
        const perK = plausible(off && off.kcal100 != null ? off.kcal100 / 100 : null, heurK) ?? heurK;
        const perP = plausible(off && off.protein100 != null ? off.protein100 / 100 : null, heurP) ?? heurP;
        kcal += perK * grams;
        if (perP > 0) { protein += perP * grams; hadProtein = true; }
      }
    } else if (p.amount != null && p.unit === 'Stück') {
      kcal += matchWord(p.name, KCAL_STK, 60) * p.amount;
      const pr = matchWord(p.name, PROT_STK, 0) * p.amount; if (pr) { protein += pr; hadProtein = true; }
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
