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

import { parseIngredient, fold, keywordIn, wordIn } from './food.js';
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
// The other languages (fr, es, it, pt-BR, nl) follow in every table of this file, one tagged line per language. A keyword with a
// leading '=' must stand alone as a whole word (see keywordIn in food.js), so “ail” is not in “volaille”; the whole-word tables
// (KCAL_STK, PIECE_G, PROT_STK, NEGLIGIBLE) list every inflected form instead and carry no '='. Only the Dutch compound stems
// (olijfolie, brood, kaas, ...) match inside longer words. Rows added for other languages say so in a comment: they sit in front
// of the row whose keyword would otherwise swallow theirs (“pomme” in “pomme de terre”, “noix” in “noix de cajou”).
const KCAL_G = [
  [['=jambon', '=jambons', '=jamon', '=jamón', '=jamones'], 1.2],   // fr/es: ham is not “jam” (1.2 = the default for unknown foods)
  [['öl', 'butter', 'margarine', 'oil',
    /* fr */ '=huile', '=huiles', '=beurre',
    /* es */ '=aceite', '=aceites', '=mantequilla', '=margarina',
    /* it */ '=olio', '=oli', '=burro', '=margarina',
    /* pt-BR */ '=óleo', '=óleos', '=azeite', '=azeites', '=manteiga', '=margarina',
    /* nl */ '=olie', '=oliën', 'olijfolie', 'zonnebloemolie', 'kokosolie', 'sesamolie', 'koolzaadolie', 'arachideolie', 'lijnzaadolie',
    '=boter', 'roomboter', '=halvarine',
  ], 8],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew', 'nuts', 'hazelnut', 'almond', 'walnut', 'peanut',
    /* fr */ '=fruits à coque', '=oléagineux', '=amande', '=amandes', '=noix', '=cacahuète', '=cacahuètes', '=cacahuete', '=cacahuetes',
    '=arachide', '=arachides', '=noix de cajou', '=cajou', '=cajous', '=noisette', '=noisettes',
    /* es */ '=frutos secos', '=fruto seco', '=almendra', '=almendras', '=nuez', '=nueces', '=cacahuete', '=cacahuetes', '=cacahuate',
    '=cacahuates', '=maní', '=anacardo', '=anacardos', '=avellana', '=avellanas',
    /* it */ '=frutta secca', '=frutta a guscio', '=mandorla', '=mandorle', '=noce', '=noci', '=arachide', '=arachidi', '=nocciolina',
    '=noccioline', '=anacardo', '=anacardi', '=nocciola', '=nocciole',
    /* pt-BR */ '=castanhas', '=oleaginosas', '=frutos secos', '=amêndoa', '=amêndoas', '=amendoa', '=amendoas', '=noz', '=nozes',
    '=amendoim', '=amendoins', '=castanha-de-caju', '=castanhas-de-caju', '=castanha de caju', '=castanhas de caju', '=caju', '=avelã',
    '=avelãs',
    /* nl */ '=noten', '=notenmix', '=walnoot', '=walnoten', '=pinda', '=pinda’s', '=pindas', '=aardnoot', '=aardnoten', '=hazelnoot',
    '=hazelnoten',
  ], 6],
  [['schokolade', 'kakao', 'chocolate', 'cocoa',
    /* fr */ '=chocolat', '=chocolats', '=cacao',
    /* es */ '=cacao',
    /* it */ '=cioccolato', '=cioccolata', '=cacao',
    /* pt-BR */ '=cacau', '=cacau em pó',
    /* nl */ '=chocola', 'chocolade', '=cacao', '=cacaopoeder',
  ], 5],
  [['haferflocken', 'müsli', 'granola', 'proteinpulver', 'eiweißpulver', 'oats', 'oatmeal', 'muesli', 'protein powder', 'whey',
    /* fr */ '=flocons d’avoine', '=müesli', '=musli', '=poudre de protéines', '=poudre de proteines', '=poudre de protéine',
    '=protéines en poudre', '=protéine en poudre', '=poudre protéinée',
    /* es */ '=copos de avena', '=museli', '=proteína en polvo', '=proteínas en polvo', '=proteina en polvo', '=polvo de proteína',
    '=polvo de proteínas',
    /* it */ '=fiocchi d’avena', '=proteine in polvere', '=proteina in polvere', '=polvere proteica',
    /* pt-BR */ '=flocos de aveia', '=aveia em flocos', '=proteína em pó', '=proteínas em pó', '=proteina em po', '=proteina em pó',
    /* nl */ '=havermout', '=havervlokken', '=haver', '=eiwitpoeder', '=proteïnepoeder', '=proteinepoeder', '=wei-eiwit',
  ], 3.8],
  [['mehl', 'zucker', 'nudel', 'pasta', 'reis', 'quinoa', 'couscous', 'linse', 'bohne', 'haferkleie',
    'flour', 'sugar', 'noodle', 'rice', 'lentil', 'bean', 'oat bran',
    /* fr */ '=farine', '=farines', '=sucre', '=sucres', '=pâtes', '=nouilles', '=riz', '=haricot', '=haricots', '=son d’avoine',
    /* es */ '=harina', '=harinas', '=azúcar', '=azucar', '=fideos', '=espaguetis', '=espagueti', '=macarrones', '=tallarines', '=arroz',
    '=quinua', '=cuscús', '=cuscus', '=lenteja', '=lentejas', '=judía', '=judías', '=alubia', '=alubias', '=frijol', '=frijoles',
    '=salvado de avena',
    /* it */ '=farina', '=farine', '=zucchero', '=zuccheri', '=tagliatelle', '=penne', '=fusilli', '=maccheroni', '=tagliolini',
    '=vermicelli', '=riso', '=lenticchie', '=fagiolo', '=fagioli', '=crusca d’avena',
    /* pt-BR */ '=farinha', '=farinhas', '=açúcar', '=acucar', '=açucar', '=macarrão', '=massa', '=massas', '=espaguete', '=macarrões',
    '=arroz', '=cuscuz', '=feijão', '=feijao', '=feijões', '=feijoes', '=farelo de aveia',
    /* nl */ '=bloem', 'meel', '=tarwebloem', 'suiker', '=noedels', '=macaroni', '=penne', '=vermicelli', '=tagliatelle', 'rijst', '=linze',
    '=linzen', '=boon', '=boontjes', 'bonen', '=haverzemelen',
  ], 3.5],
  [['honig', 'sirup', 'marmelade', 'honey', 'syrup', 'jam', 'marmalade',
    /* fr */ '=miel', '=sirop', '=sirops', '=confiture', '=confitures',
    /* es */ '=miel', '=sirope', '=siropes', '=jarabe', '=mermelada', '=mermeladas', '=confitura',
    /* it */ '=miele', '=sciroppo', '=sciroppi', '=marmellata', '=marmellate', '=confettura', '=confetture',
    /* pt-BR */ '=mel', '=xarope', '=xaropes', '=calda', '=geleia', '=geleias', '=compota', '=marmelada',
    /* nl */ 'honing', 'siroop', '=confituur',
  ], 3.0],
  [['käse', 'feta', 'parmesan', 'cheese',
    /* fr */ '=fromage', '=fromages',
    /* es */ '=queso', '=quesos', '=parmigiano',
    /* it */ '=formaggio', '=formaggi', '=parmigiano', '=parmigiano reggiano', '=grana padano',
    /* pt-BR */ '=queijo', '=queijos', '=parmesão', '=parmesao',
    /* nl */ 'kaas', '=parmezaan',
  ], 3.5],
  [['brot', 'brötchen', 'toast', 'wrap', 'bread',
    /* fr */ '=pain', '=pains', '=petit pain', '=petits pains', '=pain de mie', '=pain grillé', '=galette de blé', '=galettes de blé',
    /* es */ '=pan', '=panes', '=panecillo', '=panecillos', '=bollo', '=bollos', '=bolillo', '=bolillos', '=pan de molde', '=pan tostado',
    '=tostada', '=tostadas', '=tortilla de trigo', '=tortillas de trigo',
    /* it */ '=pane', '=pani', '=panino', '=panini', '=rosetta', '=rosette', '=pane in cassetta', '=pane tostato', '=piadina', '=piadine',
    /* pt-BR */ '=pão', '=pães', '=pao', '=pãozinho', '=pãezinhos', '=pão francês', '=pão de forma', '=torrada', '=torradas', '=tortilha',
    '=tortilhas',
    /* nl */ 'brood', '=tortilla',
  ], 2.5],
  [['hack', 'rind', 'salami', 'wurst', 'mince', 'beef', 'sausage',
    /* fr */ '=viande hachée', '=hachis', '=steak haché', '=boeuf haché', '=boeuf', '=bovin', '=veau', '=saucisse', '=saucisses',
    '=saucisson', '=saucissons', '=chorizo', '=merguez', '=saucisson sec',
    /* es */ '=carne picada', '=carne molida', '=carne de res picada', '=ternera', '=vacuno', '=buey', '=carne de res', '=salchicha',
    '=salchichas', '=chorizo', '=embutido', '=embutidos', '=salchichón',
    /* it */ '=carne macinata', '=macinato', '=carne tritata', '=manzo', '=bovino', '=vitello', '=carne di manzo', '=salsiccia', '=salsicce',
    '=würstel', '=salame',
    /* pt-BR */ '=carne moída', '=carne moida', '=carne picada', '=patinho moído', '=carne bovina', '=bovino', '=carne de boi',
    '=carne de vaca', '=salsicha', '=salsichas', '=linguiça', '=linguiças', '=chouriço', '=salame',
    /* nl */ '=gehakt', 'rundergehakt', 'varkensgehakt', 'kipgehakt', 'gehaktbal', 'rundvlees', '=runderlappen', '=biefstuk', '=ossenhaas',
    '=worst', '=worsten', '=worstje', '=worstjes', 'rookworst', 'leverworst', 'braadworst',
  ], 2.5],
  [['lachs', 'fisch', 'salmon', 'fish',
    /* fr */ '=saumon', '=saumons', '=poisson', '=poissons',
    /* es */ '=salmón', '=pescado', '=pescados',
    /* it */ '=pesce', '=pesci',
    /* pt-BR */ '=salmão', '=salmao', '=peixe', '=peixes',
    /* nl */ 'zalm', '=vis', '=vissen',
  ], 2.0],
  [['avocado',
    /* fr */ '=avocat', '=avocats',
    /* es */ '=aguacate', '=aguacates', '=palta', '=paltas',
    /* pt-BR */ '=abacate', '=abacates',
  ], 1.6],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'tofu', 'chicken', 'turkey', 'tuna',
    /* fr */ '=poulet', '=poulets', '=volaille', '=volailles', '=poule', '=dinde', '=dindes', '=thon', '=thons',
    /* es */ '=pollo', '=pollos', '=gallina', '=pavo', '=atún', '=atun',
    /* it */ '=pollo', '=petto di pollo', '=tacchino', '=petto di tacchino', '=tonno',
    /* pt-BR */ '=frango', '=frangos', '=galinha', '=peru', '=atum',
    /* nl */ '=kip', 'kipfilet', 'kippenborst', 'kippendij', 'kippenvlees', 'kalkoen', 'tonijn',
  ], 1.1],
  [['banane', 'banana',
    /* es */ '=plátano', '=plátanos', '=platano', '=platanos', '=banano',
    /* nl */ '=banaan',
  ], 0.9],
  [['kartoffel', 'süßkartoffel', 'mais', 'potato', 'sweetcorn',
    /* fr */ '=pomme de terre', '=pommes de terre', '=patate', '=patates', '=patate douce', '=patates douces', '=maïs',
    /* es */ '=patata', '=patatas', '=papa', '=papas', '=boniato', '=boniatos', '=camote', '=camotes', '=maíz', '=maiz',
    /* it */ '=patata', '=patate', '=patata dolce', '=patate dolci', '=patata americana', '=patate americane',
    /* pt-BR */ '=batata', '=batatas', '=batata-doce', '=batatas-doces', '=batata doce', '=batatas doces', '=milho',
    /* nl */ 'aardappel', '=bataat', '=bataten', '=maïs',
  ], 0.8],
  [['skyr', 'quark', 'joghurt', 'yoghurt', 'yogurt',
    /* fr */ '=fromage blanc', '=yaourt', '=yaourts', '=yogourt', '=yogourts',
    /* es */ '=queso batido', '=queso fresco batido', '=yogur', '=yogures',
    /* pt-BR */ '=iogurte', '=iogurtes',
    /* nl */ 'kwark',
  ], 0.7],
  [['milch', 'apfel', 'beere', 'obst', 'milk', 'apple', 'berry', 'berries', 'fruit',
    /* fr */ '=lait', '=laits', '=pomme', '=baie', '=baies', '=fraise', '=fraises', '=framboise', '=framboises', '=myrtille', '=myrtilles',
    '=mûre', '=mûres',
    /* es */ '=leche', '=manzana', '=manzanas', '=fruto rojo', '=frutos rojos', '=baya', '=bayas', '=frutos del bosque', '=fresa', '=fresas',
    '=frambuesa', '=frambuesas', '=arándano', '=arándanos', '=mora', '=moras', '=fruta', '=frutas',
    /* it */ '=latte', '=mela', '=mele', '=frutti di bosco', '=frutto di bosco', '=bacca', '=bacche', '=fragola', '=fragole', '=lampone',
    '=lamponi', '=mirtillo', '=mirtilli', '=frutta',
    /* pt-BR */ '=leite', '=maçã', '=maçãs', '=maca', '=macas', '=fruta vermelha', '=frutas vermelhas', '=frutos vermelhos',
    '=frutas silvestres', '=frutos silvestres', '=morango', '=morangos', '=framboesa', '=framboesas', '=mirtilo', '=mirtilos', '=amora',
    '=amoras', '=fruta', '=frutas',
    /* nl */ '=melk', '=appel', '=appels', '=bes', '=bessen', '=bosvruchten', '=bosvrucht', '=rode vruchten', '=aardbei', '=aardbeien',
    '=framboos', '=frambozen', '=braam', '=bramen', '=blauwe bes', '=blauwe bessen',
  ], 0.5],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'zwiebel', 'zucchini', 'pilz',
    'vegetable', 'salad', 'lettuce', 'spinach', 'tomato', 'pepper', 'broccoli', 'cucumber', 'onion', 'courgette', 'mushroom',
    /* fr */ '=légume', '=légumes', '=laitue', '=laitues', '=épinard', '=épinards', '=poivron', '=poivrons', '=brocoli', '=brocolis',
    '=concombre', '=concombres', '=oignon', '=oignons', '=champignon', '=champignons',
    /* es */ '=verdura', '=verduras', '=hortaliza', '=hortalizas', '=vegetal', '=vegetales', '=lechuga', '=lechugas', '=espinaca',
    '=espinacas', '=pimiento', '=pimientos', '=brócoli', '=brocoli', '=brécol', '=pepino', '=pepinos', '=cebolla', '=cebollas', '=calabacín',
    '=calabacin', '=calabacines', '=champiñón', '=champiñones', '=champinon', '=champinones', '=seta', '=setas',
    /* it */ '=verdura', '=verdure', '=ortaggi', '=ortaggio', '=lattuga', '=spinaci', '=pomodoro', '=pomodori', '=peperone', '=peperoni',
    '=broccolo', '=broccoletti', '=cetriolo', '=cetrioli', '=cipolla', '=cipolle', '=zucchina', '=zucchine', '=zucchino', '=fungo', '=funghi',
    /* pt-BR */ '=legume', '=legumes', '=verdura', '=verduras', '=hortaliça', '=hortaliças', '=alface', '=alfaces', '=espinafre',
    '=espinafres', '=pimentão', '=pimentao', '=pimentões', '=pimentoes', '=pimento', '=pimentos', '=brócolis', '=brócoli', '=brocolis',
    '=pepino', '=pepinos', '=cebola', '=cebolas', '=abobrinha', '=abobrinhas', '=curgete', '=curgetes', '=cogumelo', '=cogumelos',
    /* nl */ 'groente', '=sla', '=kropsla', '=ijsbergsla', 'spinazie', '=tomaat', '=komkommer', '=komkommers', '=ui', '=uien', '=champignon',
    '=champignons', '=paddenstoel', '=paddenstoelen',
  ], 0.3],
];
const KCAL_STK = [
  [['ei', 'eier', 'egg', 'eggs',
    /* fr */ 'oeuf', 'oeufs',
    /* es */ 'huevo', 'huevos',
    /* it */ 'uovo', 'uova',
    /* pt-BR */ 'ovo', 'ovos',
    /* nl */ 'eieren', 'eitje', 'eitjes',
  ], 75],
  [['banane', 'banana', 'bananas',
    /* fr */ 'bananes',
    /* es */ 'plátano', 'plátanos', 'platano', 'platanos', 'banano',
    /* nl */ 'banaan', 'bananen',
  ], 100],
  [['apfel', 'orange', 'paprika', 'apple', 'apples', 'oranges', 'pepper', 'peppers',
    /* fr */ 'pomme', 'poivron', 'poivrons',
    /* es */ 'manzana', 'manzanas', 'naranja', 'naranjas', 'pimiento', 'pimientos',
    /* it */ 'mela', 'mele', 'arancia', 'arance', 'peperone', 'peperoni',
    /* pt-BR */ 'maçã', 'maçãs', 'maca', 'macas', 'laranja', 'laranjas', 'pimentão', 'pimentao', 'pimentões', 'pimentoes', 'pimento',
    'pimentos',
    /* nl */ 'appel', 'appels', 'sinaasappel', 'sinaasappelen', 'sinaasappels', 'paprika’s', 'paprikas',
  ], 70],
  [['brötchen', 'scheibe', 'toast', 'bread roll', 'bread rolls', 'roll', 'rolls', 'slice',
    /* fr */ 'petit pain', 'petits pains', 'tranche', 'tranches', 'pain de mie', 'pain grillé', 'toasts',
    /* es */ 'panecillo', 'panecillos', 'bollo', 'bollos', 'bolillo', 'bolillos', 'rebanada', 'rebanadas', 'loncha', 'lonchas', 'rodaja',
    'rodajas', 'pan de molde', 'pan tostado', 'tostada', 'tostadas',
    /* it */ 'panino', 'panini', 'rosetta', 'rosette', 'fetta', 'fette', 'pane in cassetta', 'pane tostato',
    /* pt-BR */ 'pãozinho', 'pãezinhos', 'pão francês', 'fatia', 'fatias', 'pão de forma', 'torrada', 'torradas',
    /* nl */ 'broodje', 'broodjes', 'sneetje', 'sneetjes', 'snee', 'plak', 'plakje', 'plakjes', 'plakken', 'schijf', 'schijfje',
  ], 90],
  [['avocado', 'avocados',
    /* fr */ 'avocat', 'avocats',
    /* es */ 'aguacate', 'aguacates', 'palta', 'paltas',
    /* pt-BR */ 'abacate', 'abacates',
    /* nl */ 'avocado’s',
  ], 240],
];
const matchKcal = (name, table, fallback) => {
  const n = fold(name);
  for (const [kws, v] of table) if (kws.some((k) => keywordIn(n, k))) return v;
  return fallback;
};
// Whole word, not inside compounds: “Ei” is not “Reiswaffel” or “Pizzateig” (wordIn and the “=” keyword live in food.js).
const matchWord = (name, table, fallback) => {
  const n = fold(name);
  for (const [kws, v] of table) if (kws.some((k) => wordIn(n, k))) return v;
  return fallback;
};

/* Grammäquivalente für Küchenmaße – früher zählte alles außer g/ml/Stück pauschal
   45 kcal (ein Esslöffel Öl wie eine Prise Salz). [Stichwörter, Gramm]. */
const EL_G = [
  [['öl', 'butter', 'margarine', 'chiasamen', 'leinsamen', 'oil', 'chia', 'linseed', 'flaxseed',
    /* fr */ '=huile', '=huiles', '=beurre', '=graines de lin',
    /* es */ '=aceite', '=aceites', '=mantequilla', '=margarina', '=semillas de chía', '=semillas de lino', '=linaza', '=chía',
    /* it */ '=olio', '=oli', '=burro', '=margarina', '=semi di lino',
    /* pt-BR */ '=óleo', '=óleos', '=azeite', '=azeites', '=manteiga', '=margarina', '=sementes de linhaça', '=linhaça',
    /* nl */ '=olie', '=oliën', 'olijfolie', 'zonnebloemolie', 'kokosolie', 'sesamolie', 'koolzaadolie', 'arachideolie', 'lijnzaadolie',
    '=boter', 'roomboter', '=halvarine', '=lijnzaad', '=lijnzaden',
  ], 10],
  [['honig', 'sirup', 'agavendicksaft', 'marmelade', 'honey', 'syrup', 'agave', 'jam', 'marmalade',
    /* fr */ '=miel', '=sirop', '=sirops', '=confiture', '=confitures',
    /* es */ '=miel', '=sirope', '=siropes', '=jarabe', '=mermelada', '=mermeladas', '=confitura',
    /* it */ '=miele', '=sciroppo', '=sciroppi', '=marmellata', '=marmellate', '=confettura', '=confetture',
    /* pt-BR */ '=mel', '=xarope', '=xaropes', '=calda', '=geleia', '=geleias', '=compota', '=marmelada',
    /* nl */ 'honing', 'siroop', '=confituur',
  ], 20],
  [['erdnussbutter', 'mandelmus', 'nussmus', 'joghurt', 'quark', 'skyr', 'frischkäse', 'hummus',
    'peanut butter', 'almond butter', 'nut butter', 'yoghurt', 'yogurt', 'cream cheese',
    /* fr */ '=beurre de cacahuète', '=beurre de cacahuete', '=beurre d’amande', '=beurre d’arachide', '=purée d’amande',
    '=purée de cacahuète', '=yaourt', '=yaourts', '=yogourt', '=yogourts', '=fromage blanc', '=fromage à tartiner',
    '=fromage frais à tartiner', '=fromage crème', '=houmous', '=humus',
    /* es */ '=crema de cacahuete', '=mantequilla de cacahuete', '=mantequilla de almendra', '=crema de almendras', '=crema de cacahuate',
    '=mantequilla de cacahuate', '=yogur', '=yogures', '=queso batido', '=queso fresco batido', '=queso crema', '=queso para untar',
    '=queso cremoso', '=humus', '=hommus',
    /* it */ '=burro di arachidi', '=burro di mandorle', '=crema di arachidi', '=burro di noci', '=formaggio spalmabile',
    '=formaggio fresco spalmabile', '=humus',
    /* pt-BR */ '=pasta de amendoim', '=manteiga de amendoim', '=pasta de amêndoa', '=manteiga de amêndoa', '=pasta de castanha', '=iogurte',
    '=iogurtes', '=queijo cremoso', '=requeijão', '=homus',
    /* nl */ 'pindakaas', '=pindaboter', '=notenpasta', '=amandelpasta', '=amandelboter', 'kwark', '=roomkaas', '=smeerkaas',
  ], 15],
  [['haferflocken', 'mehl', 'kakao', 'proteinpulver', 'eiweißpulver', 'zucker', 'müsli',
    'oats', 'oatmeal', 'flour', 'cocoa', 'protein powder', 'whey', 'sugar', 'muesli',
    /* fr */ '=flocons d’avoine', '=farine', '=farines', '=cacao', '=poudre de protéines', '=poudre de proteines', '=poudre de protéine',
    '=protéines en poudre', '=protéine en poudre', '=poudre protéinée', '=sucre', '=sucres', '=müesli', '=musli',
    /* es */ '=copos de avena', '=harina', '=harinas', '=cacao', '=proteína en polvo', '=proteínas en polvo', '=proteina en polvo',
    '=polvo de proteína', '=polvo de proteínas', '=azúcar', '=azucar', '=museli',
    /* it */ '=fiocchi d’avena', '=farina', '=farine', '=cacao', '=proteine in polvere', '=proteina in polvere', '=polvere proteica',
    '=zucchero', '=zuccheri',
    /* pt-BR */ '=flocos de aveia', '=aveia em flocos', '=farinha', '=farinhas', '=cacau', '=cacau em pó', '=proteína em pó',
    '=proteínas em pó', '=proteina em po', '=proteina em pó', '=açúcar', '=acucar', '=açucar',
    /* nl */ '=havermout', '=havervlokken', '=haver', '=bloem', 'meel', '=tarwebloem', '=cacao', '=cacaopoeder', '=eiwitpoeder',
    '=proteïnepoeder', '=proteinepoeder', '=wei-eiwit', 'suiker',
  ], 8],
];
const SCHEIBE_G = [
  [['knäckebrot', 'crispbread',
    /* fr */ '=pain suédois', '=pain croustillant', '=pain scandinave', '=cracotte', '=cracottes', '=biscotte', '=biscottes',
    /* es */ '=pan crujiente', '=pan sueco',
    /* it */ '=pane croccante', '=pane svedese',
    /* pt-BR */ '=pão crocante', '=pão sueco',
    /* nl */ '=knäckebröd', '=knackebrod', '=knäckebrood', '=knackebrood', '=beschuit', '=beschuiten',
  ], 10],
  [['brot', 'toast', 'vollkorn', 'bread', 'wholemeal', 'wholegrain',
    /* fr */ '=pain', '=pains', '=pain de mie', '=pain grillé', '=complet', '=complets', '=complète', '=complètes', '=intégral', '=intégrale',
    '=intégraux', '=intégrales',
    /* es */ '=pan', '=panes', '=pan de molde', '=pan tostado', '=tostada', '=tostadas', '=integral', '=integrales',
    /* it */ '=pane', '=pani', '=pane in cassetta', '=pane tostato', '=integrale', '=integrali',
    /* pt-BR */ '=pão', '=pães', '=pao', '=pão de forma', '=torrada', '=torradas', '=integral', '=integrais',
    /* nl */ 'brood', '=volkoren',
  ], 45],
  [['käse', 'gouda', 'emmentaler', 'cheese', 'emmental',
    /* fr */ '=fromage', '=fromages',
    /* es */ '=queso', '=quesos',
    /* it */ '=formaggio', '=formaggi',
    /* pt-BR */ '=queijo', '=queijos',
    /* nl */ 'kaas',
  ], 20],
  [['wurst', 'salami', 'schinken', 'sausage',
    /* fr */ '=saucisse', '=saucisses', '=saucisson', '=saucissons', '=chorizo', '=merguez', '=saucisson sec', '=jambon', '=jambons',
    /* es */ '=salchicha', '=salchichas', '=chorizo', '=embutido', '=embutidos', '=salchichón', '=jamón', '=jamon', '=jamones',
    /* it */ '=salsiccia', '=salsicce', '=würstel', '=salame', '=prosciutto', '=prosciutti',
    /* pt-BR */ '=salsicha', '=salsichas', '=linguiça', '=linguiças', '=chouriço', '=salame', '=presunto', '=presuntos', '=fiambre',
    /* nl */ '=worst', '=worsten', '=worstje', '=worstjes', 'rookworst', 'leverworst', 'braadworst', '=achterham',
  ], 15],
];
const DOSE_G = [
  [['kokosmilch', 'tomate', 'tomaten', 'coconut milk', 'tomato',
    /* fr */ '=lait de coco',
    /* es */ '=leche de coco',
    /* it */ '=latte di cocco', '=pomodoro', '=pomodori',
    /* pt-BR */ '=leite de coco',
    /* nl */ '=kokosmelk', '=tomaat',
  ], 400],
  [['thunfisch', 'tuna',
    /* fr */ '=thon', '=thons',
    /* es */ '=atún', '=atun',
    /* it */ '=tonno',
    /* pt-BR */ '=atum',
    /* nl */ 'tonijn',
  ], 150],
];
// Stück-Gewichte für Zutaten, die in der Nährwerttabelle stehen (dann rechnet die
// App über die Gramm-Werte statt über eine Pauschale).
// Whole-word match: the sweet-potato row comes before the potato row, otherwise
// “sweet potato” would count as “potato”.
const PIECE_G = [
  [['reiswaffel', 'reiswaffeln', 'rice cake', 'rice cakes',
    /* fr */ 'galette de riz', 'galettes de riz', 'galette de riz soufflé', 'galettes de riz soufflé',
    /* es */ 'tortita de arroz', 'tortitas de arroz', 'galleta de arroz', 'galletas de arroz', 'torta de arroz',
    /* it */ 'galletta di riso', 'gallette di riso', 'gallette di riso soffiato',
    /* pt-BR */ 'biscoito de arroz', 'biscoitos de arroz', 'bolacha de arroz', 'bolachas de arroz',
    /* nl */ 'rijstwafel', 'rijstwafels', 'rijstcracker', 'rijstcrackers', 'rijstkoek', 'rijstkoeken',
  ], 8],
  [['knäckebrot', 'crispbread',
    /* fr */ 'pain suédois', 'pain croustillant', 'pain scandinave', 'cracotte', 'cracottes', 'biscotte', 'biscottes',
    /* es */ 'pan crujiente', 'pan sueco',
    /* it */ 'pane croccante', 'pane svedese',
    /* pt-BR */ 'pão crocante', 'pão sueco',
    /* nl */ 'knäckebröd', 'knackebrod', 'knäckebrood', 'knackebrood', 'beschuit', 'beschuiten',
  ], 10],
  [['brötchen', 'bread roll', 'bread rolls',
    /* fr */ 'petit pain', 'petits pains',
    /* es */ 'panecillo', 'panecillos', 'bollo', 'bollos', 'bolillo', 'bolillos',
    /* it */ 'panino', 'panini', 'rosetta', 'rosette',
    /* pt-BR */ 'pãozinho', 'pãezinhos', 'pão francês',
    /* nl */ 'broodje', 'broodjes',
  ], 60],
  [['fladenbrot', 'flatbread', 'flatbreads',
    /* fr */ 'pain pita', 'pains pita', 'pita', 'pitas', 'pain plat', 'pains plats', 'naan', 'naans',
    /* es */ 'pan plano', 'panes planos', 'pan de pita', 'pan pita', 'pita', 'pitas', 'naan',
    /* it */ 'pane pita', 'pita', 'pane arabo', 'naan',
    /* pt-BR */ 'pão sírio', 'pão sirio', 'pão árabe', 'pão pita', 'pita', 'naan',
    /* nl */ 'platbrood', 'turks brood', 'pitabrood', 'pita', 'naan',
  ], 200],
  [['pizzateig', 'pizza dough', 'pizza base',
    /* fr */ 'pâte à pizza',
    /* es */ 'masa de pizza', 'masa para pizza',
    /* it */ 'impasto per pizza', 'base per pizza',
    /* pt-BR */ 'massa de pizza', 'massa para pizza',
    /* nl */ 'pizzadeeg', 'pizzabodem', 'pizzabodems',
  ], 250],
  [['wrap', 'tortilla', 'wraps', 'tortillas',
    /* fr */ 'galette de blé', 'galettes de blé',
    /* es */ 'tortilla de trigo', 'tortillas de trigo',
    /* it */ 'piadina', 'piadine',
    /* pt-BR */ 'tortilha', 'tortilhas',
  ], 60],
  [['banane', 'bananen', 'banana', 'bananas',
    /* fr */ 'bananes',
    /* es */ 'plátano', 'plátanos', 'platano', 'platanos', 'banano',
    /* nl */ 'banaan',
  ], 120],
  [['pomme de terre', 'pommes de terre'], 100],   // fr: before “pomme” (apple)
  [['apfel', 'äpfel', 'apple', 'apples',
    /* fr */ 'pomme',
    /* es */ 'manzana', 'manzanas',
    /* it */ 'mela', 'mele',
    /* pt-BR */ 'maçã', 'maçãs', 'maca', 'macas',
    /* nl */ 'appel', 'appels',
  ], 150],
  [['avocado', 'avocados',
    /* fr */ 'avocat', 'avocats',
    /* es */ 'aguacate', 'aguacates', 'palta', 'paltas',
    /* pt-BR */ 'abacate', 'abacates',
    /* nl */ 'avocado’s',
  ], 150],
  [['süßkartoffel', 'süßkartoffeln', 'sweet potato', 'sweet potatoes',
    /* fr */ 'patate douce', 'patates douces',
    /* es */ 'boniato', 'boniatos', 'camote', 'camotes',
    /* it */ 'patata dolce', 'patate dolci', 'patata americana', 'patate americane',
    /* pt-BR */ 'batata-doce', 'batatas-doces', 'batata doce', 'batatas doces',
    /* nl */ 'zoete aardappel', 'zoete aardappelen', 'zoete aardappels', 'bataat', 'bataten',
  ], 200],
  [['kartoffel', 'kartoffeln', 'potato', 'potatoes',
    /* fr */ 'pomme de terre', 'pommes de terre', 'patate', 'patates',
    /* es */ 'patata', 'patatas', 'papa', 'papas',
    /* it */ 'patata', 'patate',
    /* pt-BR */ 'batata', 'batatas',
    /* nl */ 'aardappel', 'aardappelen', 'aardappels',
  ], 100],
  [['zwiebel', 'zwiebeln', 'onion', 'onions',
    /* fr */ 'oignon', 'oignons',
    /* es */ 'cebolla', 'cebollas',
    /* it */ 'cipolla', 'cipolle',
    /* pt-BR */ 'cebola', 'cebolas',
    /* nl */ 'ui', 'uien',
  ], 80],
  [['tomate', 'tomaten', 'tomato', 'tomatoes',
    /* fr */ 'tomates',
    /* es */ 'tomates',
    /* it */ 'pomodoro', 'pomodori',
    /* pt-BR */ 'tomates',
    /* nl */ 'tomaat',
  ], 100],
  [['paprika', 'pepper', 'peppers',
    /* fr */ 'poivron', 'poivrons',
    /* es */ 'pimiento', 'pimientos',
    /* it */ 'peperone', 'peperoni',
    /* pt-BR */ 'pimentão', 'pimentao', 'pimentões', 'pimentoes', 'pimento', 'pimentos',
    /* nl */ 'paprika’s', 'paprikas',
  ], 150],
  [['karotte', 'karotten', 'möhre', 'möhren', 'carrot', 'carrots',
    /* fr */ 'carotte', 'carottes',
    /* es */ 'zanahoria', 'zanahorias',
    /* it */ 'carota', 'carote',
    /* pt-BR */ 'cenoura', 'cenouras',
    /* nl */ 'wortel', 'wortels', 'wortelen', 'peen',
  ], 80],
  [['zucchini', 'courgette', 'courgettes',
    /* es */ 'calabacín', 'calabacin', 'calabacines',
    /* it */ 'zucchina', 'zucchine', 'zucchino',
    /* pt-BR */ 'abobrinha', 'abobrinhas', 'curgete', 'curgetes',
  ], 250],
  [['gurke', 'gurken', 'cucumber', 'cucumbers',
    /* fr */ 'concombre', 'concombres',
    /* es */ 'pepino', 'pepinos',
    /* it */ 'cetriolo', 'cetrioli',
    /* pt-BR */ 'pepino', 'pepinos',
    /* nl */ 'komkommer', 'komkommers',
  ], 400],
];
// Gewürze & Co. zählen nicht.
const NEGLIGIBLE = ['salz', 'pfeffer', 'gewürz', 'zimt', 'kräuter', 'petersilie', 'basilikum', 'knoblauch', 'chili', 'curry', 'paprikapulver', 'oregano', 'muskat', 'vanille', 'backpulver', 'natron', 'essig', 'zitronensaft',
  'salt', 'black pepper', 'peppercorns', 'spice', 'spices', 'cinnamon', 'herbs', 'parsley', 'basil', 'garlic', 'chilli', 'paprika powder', 'nutmeg', 'vanilla', 'baking powder', 'baking soda', 'bicarbonate of soda', 'vinegar', 'lemon juice',
  /* fr */ 'sel', 'sels', 'poivre', 'poivre noir', 'épice', 'épices', 'assaisonnement', 'cannelle', 'herbes', 'herbes aromatiques',
  'herbes de provence', 'fines herbes', 'persil', 'basilic', 'ail', 'piment', 'piments', 'piment de cayenne', 'paprika en poudre',
  'paprika doux', 'paprika fumé', 'piment doux', 'origan', 'noix de muscade', 'muscade', 'levure chimique', 'levure', 'bicarbonate',
  'bicarbonate de soude', 'bicarbonate alimentaire', 'vinaigre', 'jus de citron',
  /* es */ 'sal', 'pimienta', 'pimienta negra', 'especia', 'especias', 'condimento', 'condimentos', 'canela', 'hierbas',
  'hierbas aromáticas', 'hierbas provenzales', 'perejil', 'albahaca', 'ajo', 'ajos', 'chile', 'chiles', 'guindilla', 'guindillas', 'ají',
  'pimentón', 'pimenton', 'pimentón dulce', 'pimentón ahumado', 'orégano', 'nuez moscada', 'vainilla', 'levadura química',
  'levadura en polvo', 'polvo de hornear', 'levadura', 'bicarbonato', 'bicarbonato de sodio', 'bicarbonato sódico', 'vinagre',
  'zumo de limón', 'jugo de limón', 'zumo de limon',
  /* it */ 'sale', 'pepe', 'pepe nero', 'spezia', 'spezie', 'cannella', 'erbe', 'erbe aromatiche', 'erbette', 'prezzemolo', 'basilico',
  'aglio', 'peperoncino', 'peperoncini', 'paprica', 'paprika dolce', 'paprica dolce', 'paprica affumicata', 'origano', 'noce moscata',
  'vaniglia', 'lievito in polvere', 'lievito per dolci', 'lievito', 'bicarbonato', 'bicarbonato di sodio', 'aceto', 'succo di limone',
  /* pt-BR */ 'sal', 'pimenta', 'pimenta-do-reino', 'pimenta do reino', 'pimenta preta', 'especiaria', 'especiarias', 'tempero', 'temperos',
  'canela', 'ervas', 'ervas aromáticas', 'salsinha', 'manjericão', 'manjericao', 'alho', 'alhos', 'pimenta-malagueta', 'malagueta',
  'pimenta calabresa', 'páprica', 'paprica', 'páprica doce', 'páprica defumada', 'orégano', 'orégão', 'noz-moscada', 'noz moscada',
  'baunilha', 'fermento em pó', 'fermento químico', 'fermento', 'bicarbonato', 'bicarbonato de sódio', 'vinagre', 'suco de limão',
  'sumo de limão', 'suco de limao',
  /* nl */ 'zout', 'zeezout', 'keukenzout', 'jodiumzout', 'peper', 'zwarte peper', 'specerij', 'specerijen', 'kruidenmix', 'kaneel',
  'kruiden', 'verse kruiden', 'italiaanse kruiden', 'peterselie', 'basilicum', 'knoflook', 'chilipeper', 'chilipepers', 'chili’s',
  'rode peper', 'pepertjes', 'kerrie', 'currypoeder', 'paprikapoeder', 'nootmuskaat', 'bakpoeder', 'zuiveringszout', 'natriumbicarbonaat',
  'azijn', 'citroensap'];

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
  [['proteinpulver', 'eiweißpulver', 'protein powder', 'whey',
    /* fr */ '=poudre de protéines', '=poudre de proteines', '=poudre de protéine', '=protéines en poudre', '=protéine en poudre',
    '=poudre protéinée',
    /* es */ '=proteína en polvo', '=proteínas en polvo', '=proteina en polvo', '=polvo de proteína', '=polvo de proteínas',
    /* it */ '=proteine in polvere', '=proteina in polvere', '=polvere proteica',
    /* pt-BR */ '=proteína em pó', '=proteínas em pó', '=proteina em po', '=proteina em pó',
    /* nl */ '=eiwitpoeder', '=proteïnepoeder', '=proteinepoeder', '=wei-eiwit',
  ], 0.80],
  [['hähnchen', 'pute', 'huhn', 'thunfisch', 'rind', 'hack', 'lachs', 'fisch', 'garnele', 'kabeljau',
    'chicken', 'turkey', 'tuna', 'beef', 'mince', 'salmon', 'fish', 'prawn', 'shrimp', 'cod',
    /* fr */ '=poulet', '=poulets', '=volaille', '=volailles', '=poule', '=dinde', '=dindes', '=thon', '=thons', '=boeuf', '=bovin', '=veau',
    '=viande hachée', '=hachis', '=steak haché', '=boeuf haché', '=saumon', '=saumons', '=poisson', '=poissons', '=crevette', '=crevettes',
    '=gambas', '=cabillaud', '=morue', '=colin', '=merlu',
    /* es */ '=pollo', '=pollos', '=gallina', '=pavo', '=atún', '=atun', '=ternera', '=vacuno', '=buey', '=carne de res', '=carne picada',
    '=carne molida', '=carne de res picada', '=salmón', '=pescado', '=pescados', '=gamba', '=gambas', '=camarón', '=camarones', '=langostino',
    '=langostinos', '=bacalao', '=merluza', '=abadejo',
    /* it */ '=pollo', '=petto di pollo', '=tacchino', '=petto di tacchino', '=tonno', '=manzo', '=bovino', '=vitello', '=carne di manzo',
    '=carne macinata', '=macinato', '=carne tritata', '=pesce', '=pesci', '=gambero', '=gamberi', '=gamberetto', '=gamberetti', '=scampo',
    '=scampi', '=merluzzo', '=baccalà', '=stoccafisso', '=nasello',
    /* pt-BR */ '=frango', '=frangos', '=galinha', '=peru', '=atum', '=carne bovina', '=bovino', '=carne de boi', '=carne de vaca',
    '=carne moída', '=carne moida', '=carne picada', '=patinho moído', '=salmão', '=salmao', '=peixe', '=peixes', '=camarão', '=camarões',
    '=camarao', '=camaroes', '=bacalhau', '=bacalhau fresco', '=merluza',
    /* nl */ '=kip', 'kipfilet', 'kippenborst', 'kippendij', 'kippenvlees', 'kalkoen', 'tonijn', 'rundvlees', '=runderlappen', '=biefstuk',
    '=ossenhaas', '=gehakt', 'rundergehakt', 'varkensgehakt', 'kipgehakt', 'gehaktbal', 'zalm', '=vis', '=vissen', '=garnaal', 'garnalen',
    '=schol', '=koolvis', '=pangasius',
  ], 0.22],
  [['parmesan', 'feta', 'käse', 'mozzarella', 'cheese',
    /* fr */ '=fromage', '=fromages',
    /* es */ '=parmigiano', '=queso', '=quesos',
    /* it */ '=parmigiano', '=parmigiano reggiano', '=grana padano', '=formaggio', '=formaggi',
    /* pt-BR */ '=parmesão', '=parmesao', '=queijo', '=queijos', '=muçarela', '=mussarela', '=mozarela',
    /* nl */ '=parmezaan', 'kaas',
  ], 0.20],
  [['nuss', 'mandel', 'walnuss', 'erdnuss', 'cashew', 'nuts', 'hazelnut', 'almond', 'walnut', 'peanut',
    /* fr */ '=fruits à coque', '=oléagineux', '=amande', '=amandes', '=noix', '=cacahuète', '=cacahuètes', '=cacahuete', '=cacahuetes',
    '=arachide', '=arachides', '=noix de cajou', '=cajou', '=cajous', '=noisette', '=noisettes',
    /* es */ '=frutos secos', '=fruto seco', '=almendra', '=almendras', '=nuez', '=nueces', '=cacahuete', '=cacahuetes', '=cacahuate',
    '=cacahuates', '=maní', '=anacardo', '=anacardos', '=avellana', '=avellanas',
    /* it */ '=frutta secca', '=frutta a guscio', '=mandorla', '=mandorle', '=noce', '=noci', '=arachide', '=arachidi', '=nocciolina',
    '=noccioline', '=anacardo', '=anacardi', '=nocciola', '=nocciole',
    /* pt-BR */ '=castanhas', '=oleaginosas', '=frutos secos', '=amêndoa', '=amêndoas', '=amendoa', '=amendoas', '=noz', '=nozes',
    '=amendoim', '=amendoins', '=castanha-de-caju', '=castanhas-de-caju', '=castanha de caju', '=castanhas de caju', '=caju', '=avelã',
    '=avelãs',
    /* nl */ '=noten', '=notenmix', '=walnoot', '=walnoten', '=pinda', '=pinda’s', '=pindas', '=aardnoot', '=aardnoten', '=hazelnoot',
    '=hazelnoten',
  ], 0.20],
  [['tofu', 'linse', 'bohne', 'kichererbse', 'edamame', 'quinoa', 'lentil', 'bean', 'chickpea',
    /* fr */ '=haricot', '=haricots', '=pois chiche', '=pois chiches',
    /* es */ '=lenteja', '=lentejas', '=judía', '=judías', '=alubia', '=alubias', '=frijol', '=frijoles', '=garbanzo', '=garbanzos',
    '=quinua',
    /* it */ '=lenticchie', '=fagiolo', '=fagioli', '=cece', '=ceci',
    /* pt-BR */ '=feijão', '=feijao', '=feijões', '=feijoes', '=grão-de-bico', '=grão de bico', '=grãos-de-bico', '=grãos de bico',
    /* nl */ '=linze', '=linzen', '=boon', '=boontjes', 'bonen', '=kikkererwt', '=kikkererwten',
  ], 0.12],
  [['skyr', 'magerquark', 'quark', 'hüttenkäse',
    /* fr */ '=fromage blanc maigre', '=fromage blanc 0 %', '=fromage blanc 0%', '=fromage blanc allégé', '=fromage blanc',
    '=fromage cottage',
    /* es */ '=queso batido desnatado', '=queso fresco desnatado', '=queso batido', '=queso fresco batido', '=queso cottage', '=requesón',
    /* it */ '=fiocchi di latte', '=formaggio cottage',
    /* pt-BR */ '=queijo cottage',
    /* nl */ 'kwark', '=huttenkaas',
  ], 0.11],
  [['haferflocken', 'nudel', 'pasta', 'reis', 'brot', 'couscous', 'müsli', 'granola', 'oats', 'oatmeal', 'noodle', 'rice', 'bread', 'muesli',
    /* fr */ '=flocons d’avoine', '=pâtes', '=nouilles', '=riz', '=pain', '=pains', '=müesli', '=musli',
    /* es */ '=copos de avena', '=fideos', '=espaguetis', '=espagueti', '=macarrones', '=tallarines', '=arroz', '=pan', '=panes', '=cuscús',
    '=cuscus', '=museli',
    /* it */ '=fiocchi d’avena', '=tagliatelle', '=penne', '=fusilli', '=maccheroni', '=tagliolini', '=vermicelli', '=riso', '=pane', '=pani',
    /* pt-BR */ '=flocos de aveia', '=aveia em flocos', '=macarrão', '=massa', '=massas', '=espaguete', '=macarrões', '=arroz', '=pão',
    '=pães', '=pao', '=cuscuz',
    /* nl */ '=havermout', '=havervlokken', '=haver', '=noedels', '=macaroni', '=penne', '=vermicelli', '=tagliatelle', 'rijst', 'brood',
  ], 0.10],
  [['joghurt', 'milch', 'hafermilch', 'yoghurt', 'yogurt', 'milk',
    /* fr */ '=yaourt', '=yaourts', '=yogourt', '=yogourts', '=lait', '=laits', '=lait d’avoine', '=boisson à l’avoine', '=boisson d’avoine',
    '=boisson végétale à l’avoine',
    /* es */ '=yogur', '=yogures', '=leche', '=bebida de avena', '=leche de avena',
    /* it */ '=latte', '=latte d’avena', '=bevanda all’avena', '=bevanda di avena',
    /* pt-BR */ '=iogurte', '=iogurtes', '=leite', '=bebida de aveia', '=leite de aveia',
    /* nl */ '=melk', '=havermelk', '=haverdrink',
  ], 0.04],
  [['gemüse', 'salat', 'spinat', 'tomate', 'paprika', 'brokkoli', 'gurke', 'beere', 'apfel', 'banane',
    'vegetable', 'salad', 'lettuce', 'spinach', 'tomato', 'pepper', 'broccoli', 'cucumber', 'berry', 'berries', 'apple', 'banana',
    /* fr */ '=légume', '=légumes', '=laitue', '=laitues', '=épinard', '=épinards', '=poivron', '=poivrons', '=brocoli', '=brocolis',
    '=concombre', '=concombres', '=baie', '=baies', '=fruits rouges', '=fruits des bois', '=fraise', '=fraises', '=framboise', '=framboises',
    '=myrtille', '=myrtilles', '=mûre', '=mûres', '=pomme',
    /* es */ '=verdura', '=verduras', '=hortaliza', '=hortalizas', '=vegetal', '=vegetales', '=lechuga', '=lechugas', '=espinaca',
    '=espinacas', '=pimiento', '=pimientos', '=brócoli', '=brocoli', '=brécol', '=pepino', '=pepinos', '=fruto rojo', '=frutos rojos',
    '=baya', '=bayas', '=frutos del bosque', '=fresa', '=fresas', '=frambuesa', '=frambuesas', '=arándano', '=arándanos', '=mora', '=moras',
    '=manzana', '=manzanas', '=plátano', '=plátanos', '=platano', '=platanos', '=banano',
    /* it */ '=verdura', '=verdure', '=ortaggi', '=ortaggio', '=lattuga', '=spinaci', '=pomodoro', '=pomodori', '=peperone', '=peperoni',
    '=broccolo', '=broccoletti', '=cetriolo', '=cetrioli', '=frutti di bosco', '=frutto di bosco', '=bacca', '=bacche', '=fragola',
    '=fragole', '=lampone', '=lamponi', '=mirtillo', '=mirtilli', '=mela', '=mele',
    /* pt-BR */ '=legume', '=legumes', '=verdura', '=verduras', '=hortaliça', '=hortaliças', '=alface', '=alfaces', '=espinafre',
    '=espinafres', '=pimentão', '=pimentao', '=pimentões', '=pimentoes', '=pimento', '=pimentos', '=brócolis', '=brócoli', '=brocolis',
    '=pepino', '=pepinos', '=fruta vermelha', '=frutas vermelhas', '=frutos vermelhos', '=frutas silvestres', '=frutos silvestres',
    '=morango', '=morangos', '=framboesa', '=framboesas', '=mirtilo', '=mirtilos', '=amora', '=amoras', '=maçã', '=maçãs', '=maca', '=macas',
    /* nl */ 'groente', '=sla', '=kropsla', '=ijsbergsla', 'spinazie', '=tomaat', '=komkommer', '=komkommers', '=bes', '=bessen',
    '=bosvruchten', '=bosvrucht', '=rode vruchten', '=aardbei', '=aardbeien', '=framboos', '=frambozen', '=braam', '=bramen', '=blauwe bes',
    '=blauwe bessen', '=appel', '=appels', '=banaan',
  ], 0.02],
];
const PROT_STK = [
  [['ei', 'eier', 'egg', 'eggs',
    /* fr */ 'oeuf', 'oeufs',
    /* es */ 'huevo', 'huevos',
    /* it */ 'uovo', 'uova',
    /* pt-BR */ 'ovo', 'ovos',
    /* nl */ 'eieren', 'eitje', 'eitjes',
  ], 7],
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
    'sesame oil', 'linseed oil', 'peanut oil', 'walnut oil', 'almond oil', 'canola oil',
    /* fr */ '=huile', '=huiles',
    /* es */ '=aceite', '=aceites',
    /* it */ '=olio', '=oli',
    /* pt-BR */ '=óleo', '=óleos', '=azeite', '=azeites',
    /* nl */ '=olie', '=oliën', 'olijfolie', 'zonnebloemolie', 'kokosolie', 'sesamolie', 'koolzaadolie', 'arachideolie', 'lijnzaadolie',
  ], 880, 0],
  [['erdnussbutter', 'mandelmus', 'peanut butter', 'almond butter',
    /* fr */ '=beurre de cacahuète', '=beurre de cacahuete', '=beurre d’amande', '=beurre d’arachide', '=purée d’amande',
    '=purée de cacahuète',
    /* es */ '=crema de cacahuete', '=mantequilla de cacahuete', '=mantequilla de almendra', '=crema de almendras', '=crema de cacahuate',
    '=mantequilla de cacahuate',
    /* it */ '=burro di arachidi', '=burro di mandorle', '=crema di arachidi', '=burro di noci',
    /* pt-BR */ '=pasta de amendoim', '=manteiga de amendoim', '=pasta de amêndoa', '=manteiga de amêndoa', '=pasta de castanha',
    /* nl */ 'pindakaas', '=pindaboter', '=notenpasta', '=amandelpasta', '=amandelboter',
  ], 600, 25],
  // Substring-Fallen: „Buttermilch“/„Mandelmilch“ müssen VOR „butter“/„mandel“
  // stehen, sonst würden sie als Butter (740 kcal) bzw. Mandeln (580) gewertet.
  [['buttermilch', 'buttermilk',
    /* fr */ '=babeurre',
    /* es */ '=suero de mantequilla', '=suero de leche', '=mazada',
    /* it */ '=latticello',
    /* pt-BR */ '=leitelho', '=soro de leite',
    /* nl */ '=karnemelk',
  ], 37, 3],
  [['mandelmilch', 'almond milk', 'almond drink',
    /* fr */ '=lait d’amande', '=boisson à l’amande', '=boisson d’amande',
    /* es */ '=leche de almendra', '=leche de almendras', '=bebida de almendra', '=bebida de almendras',
    /* it */ '=latte di mandorla', '=latte di mandorle', '=bevanda alla mandorla',
    /* pt-BR */ '=leite de amêndoa', '=leite de amêndoas', '=bebida de amêndoa',
    /* nl */ '=amandelmelk', '=amandeldrink',
  ], 15, 1],
  [['kokosmilch', 'coconut milk',
    /* fr */ '=lait de coco',
    /* es */ '=leche de coco',
    /* it */ '=latte di cocco',
    /* pt-BR */ '=leite de coco',
    /* nl */ '=kokosmelk',
  ], 180, 2],
  [['butter',
    /* fr */ '=beurre',
    /* es */ '=mantequilla',
    /* it */ '=burro',
    /* pt-BR */ '=manteiga',
    /* nl */ '=boter', 'roomboter',
  ], 740, 1],
  [['margarine',
    /* es */ '=margarina',
    /* it */ '=margarina',
    /* pt-BR */ '=margarina',
    /* nl */ '=halvarine',
  ], 720, 0],
  [['noix de cajou'], 555, 18],   // fr: before “noix” (walnut)
  [['walnuss', 'walnut',
    /* fr */ '=noix',
    /* es */ '=nuez', '=nueces',
    /* it */ '=noce', '=noci',
    /* pt-BR */ '=noz', '=nozes',
    /* nl */ '=walnoot', '=walnoten',
  ], 650, 15],
  [['mandel', 'almond',
    /* fr */ '=amande', '=amandes',
    /* es */ '=almendra', '=almendras',
    /* it */ '=mandorla', '=mandorle',
    /* pt-BR */ '=amêndoa', '=amêndoas', '=amendoa', '=amendoas',
  ], 580, 21],
  [['cashew',
    /* fr */ '=noix de cajou', '=cajou', '=cajous',
    /* es */ '=anacardo', '=anacardos',
    /* it */ '=anacardo', '=anacardi',
    /* pt-BR */ '=castanha-de-caju', '=castanhas-de-caju', '=castanha de caju', '=castanhas de caju', '=caju',
  ], 555, 18],
  [['erdnuss', 'erdnüsse', 'peanut',
    /* fr */ '=cacahuète', '=cacahuètes', '=cacahuete', '=cacahuetes', '=arachide', '=arachides',
    /* es */ '=cacahuete', '=cacahuetes', '=cacahuate', '=cacahuates', '=maní',
    /* it */ '=arachide', '=arachidi', '=nocciolina', '=noccioline',
    /* pt-BR */ '=amendoim', '=amendoins',
    /* nl */ '=pinda', '=pinda’s', '=pindas', '=aardnoot', '=aardnoten',
  ], 570, 26],
  [['chiasamen', 'leinsamen', 'chia', 'linseed', 'flaxseed',
    /* fr */ '=graines de lin',
    /* es */ '=semillas de chía', '=semillas de lino', '=linaza', '=chía',
    /* it */ '=semi di lino',
    /* pt-BR */ '=sementes de linhaça', '=linhaça',
    /* nl */ '=lijnzaad', '=lijnzaden',
  ], 490, 17],
  [['honig', 'honey',
    /* fr */ '=miel',
    /* es */ '=miel',
    /* it */ '=miele',
    /* pt-BR */ '=mel',
    /* nl */ 'honing',
  ], 300, 0],
  [['sirup', 'agavendicksaft', 'syrup', 'agave',
    /* fr */ '=sirop', '=sirops',
    /* es */ '=sirope', '=siropes', '=jarabe',
    /* it */ '=sciroppo', '=sciroppi',
    /* pt-BR */ '=xarope', '=xaropes', '=calda',
    /* nl */ 'siroop',
  ], 300, 0],
  [['zucker', 'sugar',
    /* fr */ '=sucre', '=sucres',
    /* es */ '=azúcar', '=azucar',
    /* it */ '=zucchero', '=zuccheri',
    /* pt-BR */ '=açúcar', '=acucar', '=açucar',
    /* nl */ 'suiker',
  ], 400, 0],
  [['datteln', 'dates',
    /* fr */ '=datte', '=dattes',
    /* es */ '=dátil', '=dátiles', '=datil', '=datiles',
    /* it */ '=dattero', '=datteri',
    /* pt-BR */ '=tâmara', '=tâmaras',
    /* nl */ '=dadel', '=dadels',
  ], 280, 2],
  [['rosinen', 'raisins', 'sultanas',
    /* fr */ '=raisin sec',
    /* es */ '=pasas', '=pasa', '=uvas pasas',
    /* it */ '=uvetta', '=uva passa', '=uvetta sultanina',
    /* pt-BR */ '=uva-passa', '=uvas-passas', '=uva passa', '=uvas passas', '=passas',
    /* nl */ '=rozijn', '=rozijnen',
  ], 300, 3],
  [['schokolade', 'chocolate',
    /* fr */ '=chocolat', '=chocolats',
    /* it */ '=cioccolato', '=cioccolata',
    /* nl */ '=chocola', 'chocolade',
  ], 540, 7],
  [['kakao', 'cocoa',
    /* fr */ '=cacao',
    /* es */ '=cacao',
    /* it */ '=cacao',
    /* pt-BR */ '=cacau', '=cacau em pó',
    /* nl */ '=cacao', '=cacaopoeder',
  ], 350, 20],
  // Getreide / Backwaren (trocken)
  [['proteinpulver', 'eiweißpulver', 'protein powder', 'whey',
    /* fr */ '=poudre de protéines', '=poudre de proteines', '=poudre de protéine', '=protéines en poudre', '=protéine en poudre',
    '=poudre protéinée',
    /* es */ '=proteína en polvo', '=proteínas en polvo', '=proteina en polvo', '=polvo de proteína', '=polvo de proteínas',
    /* it */ '=proteine in polvere', '=proteina in polvere', '=polvere proteica',
    /* pt-BR */ '=proteína em pó', '=proteínas em pó', '=proteina em po', '=proteina em pó',
    /* nl */ '=eiwitpoeder', '=proteïnepoeder', '=proteinepoeder', '=wei-eiwit',
  ], 380, 75],
  [['haferflocken', 'oats', 'oatmeal',
    /* fr */ '=flocons d’avoine',
    /* es */ '=copos de avena',
    /* it */ '=fiocchi d’avena',
    /* pt-BR */ '=flocos de aveia', '=aveia em flocos',
    /* nl */ '=havermout', '=havervlokken', '=haver',
  ], 370, 13],
  [['granola', 'müsli', 'muesli',
    /* fr */ '=müesli', '=musli',
    /* es */ '=museli',
  ], 450, 9],
  [['quinoa',
    /* es */ '=quinua',
  ], 360, 14],
  [['couscous',
    /* es */ '=cuscús', '=cuscus',
    /* pt-BR */ '=cuscuz',
  ], 350, 12],
  [['grieß', 'griess', 'semolina',
    /* fr */ '=semoule',
    /* es */ '=sémola', '=semola',
    /* it */ '=semolino', '=semola',
    /* pt-BR */ '=sêmola', '=semola',
    /* nl */ '=griesmeel', '=gries',
  ], 350, 11],
  [['massa de pizza', 'massa para pizza'], 290, 8],   // pt: pizza dough, before “massa” (pasta)
  [['vollkornnudeln', 'wholemeal pasta', 'wholewheat pasta', 'whole wheat pasta', 'wholegrain pasta',
    /* fr */ '=pâtes complètes', '=pâtes intégrales',
    /* es */ '=pasta integral', '=pastas integrales', '=espaguetis integrales', '=macarrones integrales',
    /* it */ '=pasta integrale', '=spaghetti integrali', '=penne integrali', '=fusilli integrali', '=maccheroni integrali',
    /* pt-BR */ '=massa integral', '=macarrão integral', '=espaguete integral',
    /* nl */ 'volkorenpasta', '=volkoren pasta', '=volkorenspaghetti', '=volkorennoedels',
  ], 340, 13],
  [['nudel', 'pasta', 'spaghetti', 'noodle',
    /* fr */ '=pâtes', '=nouilles',
    /* es */ '=fideos', '=espaguetis', '=espagueti', '=macarrones', '=tallarines',
    /* it */ '=tagliatelle', '=penne', '=fusilli', '=maccheroni', '=tagliolini', '=vermicelli',
    /* pt-BR */ '=macarrão', '=massa', '=massas', '=espaguete', '=macarrões',
    /* nl */ '=noedels', '=macaroni', '=penne', '=vermicelli', '=tagliatelle',
  ], 360, 12],
  [['reis', 'rice',
    /* fr */ '=riz',
    /* es */ '=arroz',
    /* it */ '=riso',
    /* pt-BR */ '=arroz',
    /* nl */ 'rijst',
  ], 350, 7],
  [['mehl', 'flour',
    /* fr */ '=farine', '=farines',
    /* es */ '=harina', '=harinas',
    /* it */ '=farina', '=farine',
    /* pt-BR */ '=farinha', '=farinhas',
    /* nl */ '=bloem', 'meel', '=tarwebloem',
  ], 350, 10],
  [['knäckebrot', 'crispbread',
    /* fr */ '=pain suédois', '=pain croustillant', '=pain scandinave', '=cracotte', '=cracottes', '=biscotte', '=biscottes',
    /* es */ '=pan crujiente', '=pan sueco',
    /* it */ '=pane croccante', '=pane svedese',
    /* pt-BR */ '=pão crocante', '=pão sueco',
    /* nl */ '=knäckebröd', '=knackebrod', '=knäckebrood', '=knackebrood', '=beschuit', '=beschuiten',
  ], 350, 10],
  [['reiswaffel', 'rice cake',
    /* fr */ '=galette de riz', '=galettes de riz', '=galette de riz soufflé', '=galettes de riz soufflé',
    /* es */ '=tortita de arroz', '=tortitas de arroz', '=galleta de arroz', '=galletas de arroz', '=torta de arroz',
    /* it */ '=galletta di riso', '=gallette di riso', '=gallette di riso soffiato',
    /* pt-BR */ '=biscoito de arroz', '=biscoitos de arroz', '=bolacha de arroz', '=bolachas de arroz',
    /* nl */ '=rijstwafel', '=rijstwafels', '=rijstcracker', '=rijstcrackers', '=rijstkoek', '=rijstkoeken',
  ], 380, 8],
  [['vollkornbrot', 'vollkorntoast', 'wholemeal bread', 'wholemeal toast', 'wholegrain bread', 'wholewheat bread',
    /* fr */ '=pain complet', '=pain intégral', '=pain integral', '=pain aux céréales',
    /* es */ '=pan integral', '=pan de cereales',
    /* it */ '=pane integrale', '=pane ai cereali',
    /* pt-BR */ '=pão integral', '=pão de grãos',
    /* nl */ 'volkorenbrood', '=bruinbrood', '=meergranenbrood',
  ], 230, 9],
  [['brot', 'brötchen', 'toast', 'bread',
    /* fr */ '=pain', '=pains', '=petit pain', '=petits pains', '=pain de mie', '=pain grillé',
    /* es */ '=pan', '=panes', '=panecillo', '=panecillos', '=bollo', '=bollos', '=bolillo', '=bolillos', '=pan de molde', '=pan tostado',
    '=tostada', '=tostadas',
    /* it */ '=pane', '=pani', '=panino', '=panini', '=rosetta', '=rosette', '=pane in cassetta', '=pane tostato',
    /* pt-BR */ '=pão', '=pães', '=pao', '=pãozinho', '=pãezinhos', '=pão francês', '=pão de forma', '=torrada', '=torradas',
    /* nl */ 'brood',
  ], 250, 8],
  [['wrap', 'tortilla', 'fladenbrot', 'pizzateig', 'flatbread', 'pizza dough', 'pizza base',
    /* fr */ '=galette de blé', '=galettes de blé', '=pain pita', '=pains pita', '=pita', '=pitas', '=pain plat', '=pains plats', '=naan',
    '=naans', '=pâte à pizza',
    /* es */ '=pan plano', '=panes planos', '=pan de pita', '=pan pita', '=pita', '=pitas', '=naan', '=masa de pizza', '=masa para pizza',
    /* it */ '=piadina', '=piadine', '=pane pita', '=pita', '=pane arabo', '=naan', '=impasto per pizza', '=base per pizza',
    /* pt-BR */ '=tortilha', '=tortilhas', '=pão sírio', '=pão sirio', '=pão árabe', '=pão pita', '=pita', '=naan', '=massa de pizza',
    '=massa para pizza',
    /* nl */ 'platbrood', '=turks brood', '=pitabrood', '=pita', '=naan', '=pizzadeeg', '=pizzabodem', '=pizzabodems',
  ], 290, 8],
  // Hülsenfrüchte (gekocht/Konserve)
  [['linsen', 'lentil',
    /* es */ '=lenteja', '=lentejas',
    /* it */ '=lenticchie',
    /* nl */ '=linze', '=linzen',
  ], 115, 9],
  [['kichererbsen', 'chickpea',
    /* fr */ '=pois chiche', '=pois chiches',
    /* es */ '=garbanzo', '=garbanzos',
    /* it */ '=cece', '=ceci',
    /* pt-BR */ '=grão-de-bico', '=grão de bico', '=grãos-de-bico', '=grãos de bico',
    /* nl */ '=kikkererwt', '=kikkererwten',
  ], 130, 8],
  [['bohne', 'bohnen', 'bean',
    /* fr */ '=haricot', '=haricots',
    /* es */ '=judía', '=judías', '=alubia', '=alubias', '=frijol', '=frijoles',
    /* it */ '=fagiolo', '=fagioli',
    /* pt-BR */ '=feijão', '=feijao', '=feijões', '=feijoes',
    /* nl */ '=boon', '=boontjes', 'bonen',
  ], 95, 7],
  [['edamame'], 120, 11],
  // Fleisch / Fisch (roh)
  [['hähnchen', 'hühnchen', 'huhn', 'chicken',
    /* fr */ '=poulet', '=poulets', '=volaille', '=volailles', '=poule',
    /* es */ '=pollo', '=pollos', '=gallina',
    /* it */ '=pollo', '=petto di pollo',
    /* pt-BR */ '=frango', '=frangos', '=galinha',
    /* nl */ '=kip', 'kipfilet', 'kippenborst', 'kippendij', 'kippenvlees',
  ], 110, 23],
  [['pute', 'putenbrust', 'turkey',
    /* fr */ '=dinde', '=dindes',
    /* es */ '=pavo',
    /* it */ '=tacchino', '=petto di tacchino',
    /* pt-BR */ '=peru',
    /* nl */ 'kalkoen',
  ], 105, 24],
  [['hackfleisch', 'hack', 'mince', 'ground beef',
    /* fr */ '=viande hachée', '=hachis', '=steak haché', '=boeuf haché',
    /* es */ '=carne picada', '=carne molida', '=carne de res picada',
    /* it */ '=carne macinata', '=macinato', '=carne tritata',
    /* pt-BR */ '=carne moída', '=carne moida', '=carne picada', '=patinho moído',
    /* nl */ '=gehakt', 'rundergehakt', 'varkensgehakt', 'kipgehakt', 'gehaktbal',
  ], 250, 18],
  [['rind', 'rinder', 'beef',
    /* fr */ '=boeuf', '=bovin', '=veau',
    /* es */ '=ternera', '=vacuno', '=buey', '=carne de res',
    /* it */ '=manzo', '=bovino', '=vitello', '=carne di manzo',
    /* pt-BR */ '=carne bovina', '=bovino', '=carne de boi', '=carne de vaca',
    /* nl */ 'rundvlees', '=runderlappen', '=biefstuk', '=ossenhaas',
  ], 130, 21],
  [['lachs', 'salmon',
    /* fr */ '=saumon', '=saumons',
    /* es */ '=salmón',
    /* pt-BR */ '=salmão', '=salmao',
    /* nl */ 'zalm',
  ], 180, 20],
  [['thunfisch', 'tuna',
    /* fr */ '=thon', '=thons',
    /* es */ '=atún', '=atun',
    /* it */ '=tonno',
    /* pt-BR */ '=atum',
    /* nl */ 'tonijn',
  ], 110, 24],
  [['kabeljau', 'fisch', 'cod', 'fish',
    /* fr */ '=cabillaud', '=morue', '=colin', '=merlu', '=poisson', '=poissons',
    /* es */ '=bacalao', '=merluza', '=abadejo', '=pescado', '=pescados',
    /* it */ '=merluzzo', '=baccalà', '=stoccafisso', '=nasello', '=pesce', '=pesci',
    /* pt-BR */ '=bacalhau', '=bacalhau fresco', '=merluza', '=peixe', '=peixes',
    /* nl */ '=schol', '=koolvis', '=pangasius', '=vis', '=vissen',
  ], 80, 18],
  [['garnele', 'garnelen', 'prawn', 'shrimp',
    /* fr */ '=crevette', '=crevettes', '=gambas',
    /* es */ '=gamba', '=gambas', '=camarón', '=camarones', '=langostino', '=langostinos',
    /* it */ '=gambero', '=gamberi', '=gamberetto', '=gamberetti', '=scampo', '=scampi',
    /* pt-BR */ '=camarão', '=camarões', '=camarao', '=camaroes',
    /* nl */ '=garnaal', 'garnalen',
  ], 85, 20],
  [['salami', 'wurst', 'sausage',
    /* fr */ '=saucisson sec', '=saucisse', '=saucisses', '=saucisson', '=saucissons', '=chorizo', '=merguez',
    /* es */ '=salchichón', '=salchicha', '=salchichas', '=chorizo', '=embutido', '=embutidos',
    /* it */ '=salame', '=salsiccia', '=salsicce', '=würstel',
    /* pt-BR */ '=salame', '=salsicha', '=salsichas', '=linguiça', '=linguiças', '=chouriço',
    /* nl */ '=worst', '=worsten', '=worstje', '=worstjes', 'rookworst', 'leverworst', 'braadworst',
  ], 350, 18],
  // Milchprodukte / vegetarische Eiweißquellen
  [['skyr'], 63, 11],
  [['magerquark', 'low-fat quark', 'low fat quark',
    /* fr */ '=fromage blanc maigre', '=fromage blanc 0 %', '=fromage blanc 0%', '=fromage blanc allégé',
    /* es */ '=quark desnatado', '=queso batido desnatado', '=queso fresco desnatado',
    /* it */ '=quark magro', '=quark scremato',
    /* pt-BR */ '=quark magro',
    /* nl */ '=magere kwark',
  ], 67, 12],
  [['hüttenkäse', 'cottage cheese',
    /* fr */ '=fromage cottage',
    /* es */ '=queso cottage', '=requesón',
    /* it */ '=fiocchi di latte', '=formaggio cottage',
    /* pt-BR */ '=queijo cottage',
    /* nl */ '=huttenkaas',
  ], 100, 12],
  [['quark',
    /* fr */ '=fromage blanc',
    /* es */ '=queso batido', '=queso fresco batido',
    /* nl */ 'kwark',
  ], 110, 12],
  [['parmesan',
    /* es */ '=parmigiano',
    /* it */ '=parmigiano', '=parmigiano reggiano', '=grana padano',
    /* pt-BR */ '=parmesão', '=parmesao',
    /* nl */ '=parmezaan', '=parmezaanse kaas',
  ], 400, 36],
  [['feta'], 260, 14],
  [['mozzarella',
    /* pt-BR */ '=muçarela', '=mussarela', '=mozarela',
  ], 250, 18],
  [['frischkäse', 'cream cheese',
    /* fr */ '=fromage à tartiner', '=fromage frais à tartiner', '=fromage crème',
    /* es */ '=queso crema', '=queso para untar', '=queso cremoso',
    /* it */ '=formaggio spalmabile', '=formaggio fresco spalmabile',
    /* pt-BR */ '=queijo cremoso', '=requeijão',
    /* nl */ '=roomkaas', '=smeerkaas',
  ], 250, 6],
  [['käse', 'cheese',
    /* fr */ '=fromage', '=fromages',
    /* es */ '=queso', '=quesos',
    /* it */ '=formaggio', '=formaggi',
    /* pt-BR */ '=queijo', '=queijos',
    /* nl */ 'kaas',
  ], 360, 25],
  [['joghurt', 'yoghurt', 'yogurt',
    /* fr */ '=yaourt', '=yaourts', '=yogourt', '=yogourts',
    /* es */ '=yogur', '=yogures',
    /* pt-BR */ '=iogurte', '=iogurtes',
  ], 60, 4],
  [['hafermilch', 'oat milk', 'oat drink',
    /* fr */ '=lait d’avoine', '=boisson à l’avoine', '=boisson d’avoine', '=boisson végétale à l’avoine',
    /* es */ '=bebida de avena', '=leche de avena',
    /* it */ '=latte d’avena', '=bevanda all’avena', '=bevanda di avena',
    /* pt-BR */ '=bebida de aveia', '=leite de aveia',
    /* nl */ '=havermelk', '=haverdrink',
  ], 45, 1],
  [['crema de leche', 'creme de leite', 'crema di latte'], 290, 2],   // es/pt/it: cream, before “leche”/“leite”/“latte” (milk)
  [['milch', 'milk',
    /* fr */ '=lait', '=laits',
    /* es */ '=leche',
    /* it */ '=latte',
    /* pt-BR */ '=leite',
    /* nl */ '=melk',
  ], 64, 3],
  [['sahne', 'cream',
    /* fr */ '=crème', '=crèmes', '=creme',
    /* es */ '=nata', '=crema de leche', '=crema fresca', '=nata para cocinar', '=nata líquida', '=nata montada',
    /* it */ '=panna',
    /* pt-BR */ '=creme de leite', '=nata', '=creme culinário',
    /* nl */ 'slagroom', 'kookroom',
  ], 290, 2],
  [['tofu'], 120, 13],
  [['hummus',
    /* fr */ '=houmous', '=humus',
    /* es */ '=humus', '=hommus',
    /* it */ '=humus',
    /* pt-BR */ '=homus',
  ], 230, 7],
  // Obst / Gemüse (roh)
  [['avocado',
    /* fr */ '=avocat', '=avocats',
    /* es */ '=aguacate', '=aguacates', '=palta', '=paltas',
    /* pt-BR */ '=abacate', '=abacates',
  ], 160, 2],
  [['banane', 'banana',
    /* es */ '=plátano', '=plátanos', '=platano', '=platanos', '=banano',
    /* nl */ '=banaan',
  ], 90, 1],
  [['mango',
    /* fr */ '=mangue', '=mangues',
    /* it */ '=manghi',
    /* pt-BR */ '=manga', '=mangas',
  ], 60, 1],
  [['ananas', 'pineapple',
    /* es */ '=piña', '=piñas',
    /* pt-BR */ '=abacaxi', '=ananás',
  ], 50, 1],
  [['pomme de terre', 'pommes de terre'], 70, 2],   // fr: before “pomme” (apple)
  [['apfel', 'apple',
    /* fr */ '=pomme',
    /* es */ '=manzana', '=manzanas',
    /* it */ '=mela', '=mele',
    /* pt-BR */ '=maçã', '=maçãs', '=maca', '=macas',
    /* nl */ '=appel', '=appels',
  ], 52, 0],
  [['beere', 'beeren', 'berry', 'berries',
    /* fr */ '=baie', '=baies', '=fruits rouges', '=fruits des bois', '=fraise', '=fraises', '=framboise', '=framboises', '=myrtille',
    '=myrtilles', '=mûre', '=mûres',
    /* es */ '=fruto rojo', '=frutos rojos', '=baya', '=bayas', '=frutos del bosque', '=fresa', '=fresas', '=frambuesa', '=frambuesas',
    '=arándano', '=arándanos', '=mora', '=moras',
    /* it */ '=frutti di bosco', '=frutto di bosco', '=bacca', '=bacche', '=fragola', '=fragole', '=lampone', '=lamponi', '=mirtillo',
    '=mirtilli',
    /* pt-BR */ '=fruta vermelha', '=frutas vermelhas', '=frutos vermelhos', '=frutas silvestres', '=frutos silvestres', '=morango',
    '=morangos', '=framboesa', '=framboesas', '=mirtilo', '=mirtilos', '=amora', '=amoras',
    /* nl */ '=bes', '=bessen', '=bosvruchten', '=bosvrucht', '=rode vruchten', '=aardbei', '=aardbeien', '=framboos', '=frambozen', '=braam',
    '=bramen', '=blauwe bes', '=blauwe bessen',
  ], 45, 1],
  [['süßkartoffel', 'sweet potato',
    /* fr */ '=patate douce', '=patates douces',
    /* es */ '=boniato', '=boniatos', '=camote', '=camotes',
    /* it */ '=patata dolce', '=patate dolci', '=patata americana', '=patate americane',
    /* pt-BR */ '=batata-doce', '=batatas-doces', '=batata doce', '=batatas doces',
    /* nl */ '=zoete aardappel', '=zoete aardappelen', '=zoete aardappels', '=bataat', '=bataten',
  ], 86, 2],
  [['kartoffel', 'potato',
    /* fr */ '=pomme de terre', '=pommes de terre', '=patate', '=patates',
    /* es */ '=patata', '=patatas', '=papa', '=papas',
    /* it */ '=patata', '=patate',
    /* pt-BR */ '=batata', '=batatas',
    /* nl */ 'aardappel',
  ], 70, 2],
  [['brokkoli', 'broccoli',
    /* fr */ '=brocoli', '=brocolis',
    /* es */ '=brócoli', '=brocoli', '=brécol',
    /* it */ '=broccolo', '=broccoletti',
    /* pt-BR */ '=brócolis', '=brócoli', '=brocolis',
  ], 35, 3],
  [['spinat', 'spinach',
    /* fr */ '=épinard', '=épinards',
    /* es */ '=espinaca', '=espinacas',
    /* it */ '=spinaci',
    /* pt-BR */ '=espinafre', '=espinafres',
    /* nl */ 'spinazie',
  ], 23, 3],
  [['tomate', 'tomaten', 'tomato',
    /* it */ '=pomodoro', '=pomodori',
    /* nl */ '=tomaat',
  ], 18, 1],
  [['paprika', 'pepper',
    /* fr */ '=poivron', '=poivrons',
    /* es */ '=pimiento', '=pimientos',
    /* it */ '=peperone', '=peperoni',
    /* pt-BR */ '=pimentão', '=pimentao', '=pimentões', '=pimentoes', '=pimento', '=pimentos',
  ], 30, 1],
  [['zucchini', 'courgette',
    /* es */ '=calabacín', '=calabacin', '=calabacines',
    /* it */ '=zucchina', '=zucchine', '=zucchino',
    /* pt-BR */ '=abobrinha', '=abobrinhas', '=curgete', '=curgetes',
  ], 17, 1],
  [['gurke', 'cucumber',
    /* fr */ '=concombre', '=concombres',
    /* es */ '=pepino', '=pepinos',
    /* it */ '=cetriolo', '=cetrioli',
    /* pt-BR */ '=pepino', '=pepinos',
    /* nl */ '=komkommer', '=komkommers',
  ], 12, 1],
  [['zwiebel', 'onion',
    /* fr */ '=oignon', '=oignons',
    /* es */ '=cebolla', '=cebollas',
    /* it */ '=cipolla', '=cipolle',
    /* pt-BR */ '=cebola', '=cebolas',
    /* nl */ '=ui', '=uien',
  ], 40, 1],
  [['karotte', 'möhre', 'carrot',
    /* fr */ '=carotte', '=carottes',
    /* es */ '=zanahoria', '=zanahorias',
    /* it */ '=carota', '=carote',
    /* pt-BR */ '=cenoura', '=cenouras',
    /* nl */ '=wortel', '=wortels', '=wortelen', '=peen',
  ], 40, 1],
  [['champignon', 'pilz', 'mushroom',
    /* es */ '=champiñón', '=champiñones', '=champinon', '=champinones', '=seta', '=setas',
    /* it */ '=fungo', '=funghi',
    /* pt-BR */ '=cogumelo', '=cogumelos',
    /* nl */ '=paddenstoel', '=paddenstoelen',
  ], 22, 3],
  [['salat', 'lettuce', 'salad',
    /* fr */ '=laitue', '=laitues',
    /* es */ '=lechuga', '=lechugas',
    /* it */ '=lattuga',
    /* pt-BR */ '=alface', '=alfaces',
    /* nl */ '=sla', '=kropsla', '=ijsbergsla',
  ], 15, 1],
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
    if (NEGLIGIBLE.some((k) => wordIn(lname, k) || lname === k)) return;   // Gewürze
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
