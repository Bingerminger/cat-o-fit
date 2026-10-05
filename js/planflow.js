/* =========================================================================
   planflow.js — adaptive Plan-Anpassungen rund um manuelle Eingriffe
   (aus dem Praxis-Feedback). Reine Funktionen ohne Store/DOM → testbar.

   Idee: Fügt man selbst eine Einheit hinzu oder verschiebt sie, soll die
   Wochenbelastung nicht unbemerkt anwachsen. Die App schlägt dann eine
   ähnliche, noch offene Einheit derselben Woche als Ausgleich vor.
   ========================================================================= */

import { weekStartMonday, addDays, diffDays } from './ui.js';

import { t } from './i18n.js';

/** Belastungsklasse eines Einheiten-Typs (für „ähnliche Intensität“). */
export function loadClass(type) {
  if (['tempo', 'interval', 'race', 'match', 'camp'].includes(type)) return 'quality';
  if (['easy', 'long', 'run', 'cross', 'cross_bike', 'cross_football'].includes(type)) return 'endurance';
  if (['recovery', 'mobility', 'walk'].includes(type)) return 'recovery';
  if (type === 'strength') return 'strength';
  return 'other';
}

/** Einheit zählt zur Wochenlast (nicht verpasst, kein Ruhetag).
    Hinweis: Seit v3.16.0 tragen verschobene Einheiten wieder den Status „geplant“
    (Herkunft in `movedFrom`). Der Alt-Status „verschoben“ aus früheren Versionen
    zählt hier bewusst MIT – die Einheit steht ja am neuen Tag im Plan. */
function countsToLoad(u) {
  return u.type !== 'rest' && u.status !== 'verpasst';
}
/** Noch offene, veränderbare Einheit (weder erledigt noch verpasst).
    Zentrale Quelle für ALLE Module (rolling, triage, cycle): so bleibt der
    Alt-Status „verschoben“ an genau einer Stelle behandelt. */
export function isOpen(u) {
  return !!u && u.type !== 'rest'
    && (u.status === 'geplant' || u.status === 'verschoben' || u.status == null);
}

/** Mo–So-Fenster eines Datums. */
export function weekRange(dateStr) {
  const ws = weekStartMonday(dateStr);
  return { ws, we: addDays(ws, 6) };
}

/** Einheiten derselben Kalenderwoche (Mo–So) wie dateStr, die zur Last zählen. */
export function unitsInWeek(units = [], dateStr) {
  const { ws, we } = weekRange(dateStr);
  return units.filter((u) => u.date >= ws && u.date <= we && countsToLoad(u));
}

/** Offene, lastrelevante, verschiebbare Einheiten EINES Tages (planübergreifend nutzbar):
    Kandidaten für eine ganztägige Erholung (#4). Feste Termine bleiben außen vor. */
export function dayLoadUnits(units = [], date) {
  return (units || []).filter((u) => u && u.date === date && !u.fixed
    && isOpen(u) && countsToLoad(u));
}

/** Belastungsüberblick der Woche: Anzahl Einheiten und geplante/erledigte km. */
export function weekLoad(units = [], dateStr) {
  const list = unitsInWeek(units, dateStr);
  const km = list.reduce((a, u) => a + (u.targetDistanceKm || u.distanceKm || 0), 0);
  return { count: list.length, km: Math.round(km) };
}

/**
 * Schlägt eine ähnliche, noch offene Einheit derselben Woche als Ausgleich für
 * eine neu hinzugefügte Einheit vor. null, wenn es nichts Vergleichbares gibt.
 */
export function suggestOffsetUnit(units = [], newUnit) {
  if (!newUnit || !newUnit.date) return null;
  const { ws, we } = weekRange(newUnit.date);
  const cls = loadClass(newUnit.type);
  const candidates = units.filter((u) =>
    u.id !== newUnit.id && u.date >= ws && u.date <= we && isOpen(u) && loadClass(u.type) === cls);
  if (!candidates.length) return null;
  // Bevorzugt eine andere Tages-Einheit, chronologisch die erste.
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates.find((u) => u.date !== newUnit.date) || candidates[0];
}

/**
 * Setzt eine Plan-Woche neu zusammen (#10): bereits **erledigte** Einheiten bleiben
 * an ihren Tagen erhalten, alle anderen (offen/verpasst/verschoben/manuell) werden
 * durch die frisch generierten ersetzt. An Tagen mit erledigter Einheit kommt nichts
 * Neues hinzu (keine Dubletten). Reine Funktion über die Einheiten **einer** Woche.
 */
export function mergeRegeneratedWeek(existing = [], fresh = []) {
  const kept = existing.filter((u) => u.status === 'erledigt');
  const keptDates = new Set(kept.map((u) => u.date));
  const added = fresh.filter((u) => !keptDates.has(u.date));
  return [...kept, ...added];
}

/**
 * Neu-Generieren ab einem Stichtag (in der Regel heute): Alles VOR `fromDate` bleibt
 * genau so, wie es ist – erledigt, verpasst (mit Grund), verschoben, manuell
 * angelegt. Ab dem Stichtag gilt die Wochenregel von `mergeRegeneratedWeek`, wobei
 * auch dort bereits als verpasst markierte Einheiten stehen bleiben. Früher baute
 * „Neu generieren“ auch die Vergangenheit neu: Ausfallgründe gingen verloren und
 * vergangene Tage wurden plötzlich überfällig.
 */
export function mergeFromDate(existing = [], fresh = [], fromDate) {
  const past = existing.filter((u) => u.date < fromDate);
  const current = existing.filter((u) => u.date >= fromDate);
  const kept = current.filter((u) => u.status === 'erledigt' || u.status === 'verpasst');
  const keptDates = new Set(kept.map((u) => u.date));
  const added = fresh.filter((u) => u.date >= fromDate && !keptDates.has(u.date));
  return [...past, ...kept, ...added].sort((a, b) => a.date.localeCompare(b.date));
}

/** Kategorie für die Zuordnung Training ↔ geplante Einheit (Laufen, Rad, Schwimmen,
    Gehen, Kraft, Fußball …). Ein Rad-Import passt nie auf einen geplanten Lauf. */
export function matchCategory(type) {
  if (['easy', 'long', 'tempo', 'interval', 'race', 'recovery', 'run'].includes(type)) return 'run';
  if (['cross_bike', 'spinning'].includes(type)) return 'bike';
  if (['walk', 'hike'].includes(type)) return 'walk';
  if (['strength', 'gym'].includes(type)) return 'strength';
  if (['cross_football', 'match'].includes(type)) return 'football';
  return type || 'other';
}

/** Offene geplante Einheit am Tag `date` in derselben Kategorie wie `type` – die erste
    in Plan-Reihenfolge, die noch keine Session trägt. `exclude`: bereits vergebene
    Einheiten-IDs. */
export function findPlannedMatch(plans = [], { date, type }, exclude = new Set()) {
  const cat = matchCategory(type);
  for (const p of plans || []) {
    for (const u of (p && p.units) || []) {
      if (!u || u.date !== date || exclude.has(u.id) || u.executedSessionId || !isOpen(u)) continue;
      if (matchCategory(u.type) === cat) return { plan: p, unit: u };
    }
  }
  return null;
}

/** Verknüpft vergangene, erledigte Plan-Einheiten mit Trainings desselben Tages und
    derselben Sportart (Demodaten) – auch feste Termine mit dem Fußball-Training des
    Tages. Liefert neue Listen, verändert nichts. */
export function linkDemoSessions(units = [], sessions = [], today, eventId = null) {
  const us = units.map((u) => ({ ...u }));
  const ss = sessions.map((s) => ({ ...s }));
  for (const s of ss) {
    // `extra`: ausdrücklich zusätzlich zum Plan trainiert – gehört zu keiner Einheit.
    if (s.plannedId || s.extra || s.date >= today) continue;
    const u = us.find((x) => x.date === s.date && x.date < today && !x.executedSessionId
      && matchCategory(x.type) === matchCategory(s.type));
    if (u) { u.executedSessionId = s.id; u.status = 'erledigt'; s.plannedId = u.id; s.eventId = eventId; }
  }
  return { units: us, sessions: ss };
}

/** Quellen automatisch/aus Dateien importierter Trainings. */
export const IMPORT_SOURCES = ['apple-health', 'health', 'health-connect', 'gpx'];

/**
 * Importierte Trainings der letzten `days` Tage ohne Planbezug, die zu einer offenen
 * geplanten Einheit desselben Tages passen – Kandidaten für „zuordnen?“. Jede Einheit
 * wird höchstens einmal vorgeschlagen; abgelehnte Vorschläge (`matchDismissed`) nicht erneut.
 * @returns {Array<{session, plan, unit}>}
 */
export function importedMatches(plans = [], sessions = [], today, days = 7) {
  const used = new Set();
  const out = [];
  (sessions || [])
    .filter((s) => s && !s.deleted && !s.plannedId && !s.matchDismissed && IMPORT_SOURCES.includes(s.source)
      && s.date <= today && diffDays(s.date, today) <= days)
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((s) => {
      const m = findPlannedMatch(plans, s, used);
      if (m) { used.add(m.unit.id); out.push({ session: s, ...m }); }
    });
  return out;
}

/** Ohne Nachfrage: Gehen und Mobility sind ohnehin leicht, Fußball hat seine Intensität. */
const NO_RPE_ASK = new Set(['walk', 'mobility', 'cross_football']);
/**
 * Importierte Trainings der letzten `days` Tage ohne Anstrengung – für die Nachfrage
 * „Wie hart war's?“ auf „Heute“. Ohne Antwort schätzt die Belastung sie aus der
 * Herzfrequenz; eine Angabe der Person ist trotzdem genauer.
 */
export function rpeAskList(sessions = [], today, days = 3) {
  return (sessions || [])
    .filter((s) => s && !s.deleted && IMPORT_SOURCES.includes(s.source) && !(Number(s.rpe) > 0) && !s.rpeDismissed
      && !NO_RPE_ASK.has(s.type) && s.date && s.date <= today && diffDays(s.date, today) < days)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Zonenschlüssel einer Einheit: gespeichert (`paceKey`) oder – für Einheiten aus
    älteren Versionen – aus dem Typ abgeleitet. */
export function paceKeyOf(unit) {
  if (!unit) return null;
  if (unit.paceKey) return unit.paceKey;
  return ({ race: 'race', tempo: 'threshold', interval: 'vo2', easy: 'easy', long: 'long', recovery: 'recovery' })[unit.type] || null;
}

/**
 * Führt die Zielpaces offener, künftiger Lauf-Einheiten an neue Trainingsbereiche
 * nach – über den Zonenschlüssel, nicht über die HF-Zone. Renn-Einheiten (`race`)
 * bekommen nur dann ein neues Tempo, wenn `race` übergeben wird (ohne Zielzeit folgt
 * das Renntempo der Form, mit Zielzeit bleibt es das Ziel). Reine Funktion.
 * @returns {{units:object[], changed:boolean}}
 */
export function repaceUnits(units = [], zones = {}, { today, race = null } = {}) {
  let changed = false;
  const out = units.map((u) => {
    if (!u || u.date < today || u.status === 'erledigt' || u.fixed) return u;
    const key = paceKeyOf(u);
    if (!key) return u;
    const z = key === 'race' ? race : zones[key];
    if (!z) return u;
    changed = true;
    return { ...u, targetPaceSecPerKm: z.min, targetPaceMaxSecPerKm: z.max, targetHrZone: z.hrZone ?? u.targetHrZone ?? null, paceKey: key };
  });
  return { units: out, changed };
}

/** Fordernde Einheit (zehrt an der Erholung): Qualität, Kraft, Long Run – und
    Fußball (Antritte/Spielintensität), außer der Termin ist ausdrücklich „leicht“ (#5). */
export function isHard(unit) {
  if (unit.type === 'cross_football') return unit.intensity !== 'leicht';
  const c = loadClass(unit.type);
  return c === 'quality' || c === 'strength' || unit.type === 'long';
}

/**
 * Schlägt vor, heute lockerer zu machen, wenn die Bereitschaft niedrig ist und
 * eine fordernde Einheit ansteht. `readiness` = { score } aus adaptive.js.
 * @returns {{unit:object, score:number}|null}
 */
export function softenSuggestion(todaysUnits = [], readiness) {
  if (!readiness || typeof readiness.score !== 'number' || readiness.score >= 55) return null;
  // Feste Termine (Fußball/Spiele) nicht zum „lockerer machen“ vorschlagen – die stehen fest.
  const hard = todaysUnits.find((u) => isHard(u) && !u.fixed && isOpen(u));
  return hard ? { unit: hard, score: readiness.score } : null;
}

/** Offene, lastrelevante Einheiten der nächsten `horizon` Tage – Kandidaten für eine
    Entlastung oder Steigerung. Feste Termine (Vereinstraining, Spiele) sind für alle
    Automatiken tabu: Früher wurde aus dem Fußball „Locker (Entlastung)“. */
export function weekDeloadCandidates(units = [], today, horizon = 7) {
  const end = addDays(today, horizon);
  return units.filter((u) => isOpen(u) && !u.fixed && countsToLoad(u) && u.date >= today && u.date <= end);
}

/** Ausfall wegen Krankheit oder Verletzung – nie nachholen, nie ausgleichen. */
function healthMiss(u) {
  return !!u && u.status === 'verpasst' && (u.missedReason === 'sick' || u.missedReason === 'injured');
}

/** Progressions-Variante: Umfang ~12 % rauf (Typ bleibt) – wenn noch Reserven da sind. */
export function progressVariant(unit) {
  const km = unit.targetDistanceKm ? Math.round(unit.targetDistanceKm * 1.12 * 2) / 2 : null;
  const min = !km && unit.targetDurationMin ? Math.round(unit.targetDurationMin * 1.1) : null;
  return { targetDistanceKm: km, targetDurationMin: min, boosted: true };
}

/** Entlastungs-Variante einer Einheit: Umfang ~25 % runter, die Intensität bleibt.
    Qualitätseinheiten verlieren ein Drittel ihrer Wiederholungen statt in einen
    lockeren Lauf verwandelt zu werden – Entlastung heißt weniger Umfang, nicht
    „kein Reiz“ (Bosquet et al. 2007). Der Typ der Einheit ändert sich nie. */
export function deloadVariant(unit) {
  const km = unit.targetDistanceKm ? Math.max(3, Math.round(unit.targetDistanceKm * 0.75 * 2) / 2) : null;
  const min = unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.75) : null;
  const patch = { targetDistanceKm: km, targetDurationMin: km ? null : min, deloaded: true };
  const iv = unit.intervals;
  if (iv && Array.isArray(iv.segments) && iv.segments.length > 2) {
    patch.intervals = { ...iv, segments: iv.segments.slice(0, Math.max(2, Math.round(iv.segments.length * 2 / 3))) };
  } else if (iv && iv.rounds > 2) {
    patch.intervals = { ...iv, rounds: Math.max(2, Math.round(iv.rounds * 2 / 3)) };
  }
  if (patch.intervals) patch.title = t('planflow.shortened', { title: unit.title });
  return patch;
}

/** Verpasste Schlüsseleinheiten (fordernd) der letzten `days` Tage, jüngste zuerst (#Umplanung).
    Ausfälle wegen Krankheit oder Verletzung zählen nicht: Danach heißt es behutsam
    wieder einsteigen, nicht die harte Einheit binnen Tagen nachholen. Feste Termine
    auch nicht – ein verpasstes Vereinstraining lässt sich nicht verschieben. */
export function missedKeyUnits(plans = [], today, days = 10) {
  const out = [];
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.status !== 'verpasst' || !isHard(u) || u.fixed || healthMiss(u)) return;
    const d = diffDays(u.date, today);
    if (d >= 0 && d <= days) out.push(u);
  }));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Findet einen geeigneten Nachhol-Tag in [today+1, today+horizon]: ein Tag ohne
 * lastrelevante Einheit und ohne fordernde Einheit am Vor-/Folgetag (Erholung).
 * @returns {string|null} Datum oder null.
 */
export function findMakeupDay(units = [], missedUnit, today, horizon = 7) {
  const others = units.filter((u) => u.id !== (missedUnit && missedUnit.id));
  for (let i = 1; i <= horizon; i++) {
    const date = addDays(today, i);
    if (others.some((u) => u.date === date && countsToLoad(u))) continue; // Tag belegt
    const prev = addDays(date, -1), next = addDays(date, 1);
    if (others.some((u) => isHard(u) && (u.date === prev || u.date === next))) continue; // harter Nachbar
    return date;
  }
  return null;
}

/** Wandelt eine Einheit in eine lockere Variante (Patch-Felder), behält das Original. */
export function easierVariant(unit, easyPace) {
  const km = unit.targetDistanceKm ? Math.max(4, Math.round(unit.targetDistanceKm * 0.6)) : null;
  return {
    type: 'easy',
    title: t('planflow.easierTitle'),
    targetDistanceKm: km,
    targetDurationMin: km ? null : (unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.7) : null),
    targetPaceSecPerKm: easyPace?.min ?? null,
    targetPaceMaxSecPerKm: easyPace?.max ?? null,
    targetHrZone: easyPace?.hrZone ?? 2,
    intervals: null,
    description: t('planflow.easierDescription'),
    softened: true,
    originalType: unit.originalType || unit.type,
  };
}

/**
 * Prüft das Verschieben einer Einheit auf newDate (#3): liegt dort schon eine
 * Einheit, und folgt eine harte Einheit ohne Erholungstag? Reine Fakten – die
 * UI formuliert daraus die Hinweise.
 * @returns {{sameDay: object|null, hardNeighbor: {unit:object, dir:'prev'|'next'}|null}}
 */
export function rescheduleCheck(units = [], unitId, newDate) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return { sameDay: null, hardNeighbor: null };
  const others = units.filter((u) => u.id !== unitId && countsToLoad(u));
  const sameDay = others.find((u) => u.date === newDate) || null;
  let hardNeighbor = null;
  if (isHard(unit)) {
    const prev = addDays(newDate, -1), next = addDays(newDate, 1);
    const n = others.find((u) => isHard(u) && (u.date === prev || u.date === next));
    if (n) hardNeighbor = { unit: n, dir: n.date < newDate ? 'prev' : 'next' };
  }
  return { sameDay, hardNeighbor };
}

/**
 * Automatischer Wochenumfang-Ausgleich: vergleicht geplante vs. erledigte Lauf-km
 * der Woche. Ist etwas liegen geblieben, wird vorgeschlagen, EINEN TEIL davon
 * behutsam (gedeckelt) auf die nächste offene LOCKERE Einheit zu legen – nie alles
 * auf einmal, nie auf eine harte Einheit. Liefert null, wenn nichts zu tun ist.
 */
export function weekVolumeBalance(units = [], today) {
  const km = (u) => Number(u.targetDistanceKm) || 0;
  const { ws, we } = weekRange(today);
  const run = units.filter((u) => u && !u.deleted && u.date >= ws && u.date <= we && km(u) > 0 && u.type !== 'rest');
  if (run.length < 2) return null;
  const planned = run.reduce((s, u) => s + km(u), 0);
  const done = run.filter((u) => u.status === 'erledigt').reduce((s, u) => s + km(u), 0);
  // Krankheits-/Verletzungsausfälle werden nie „ausgeglichen“ (kein Mehrumfang danach).
  const missedKm = run.filter((u) => u.status !== 'erledigt' && u.date < today && !healthMiss(u)).reduce((s, u) => s + km(u), 0);
  const openEasy = run
    .filter((u) => isOpen(u) && u.date >= today && (u.type === 'easy' || u.type === 'recovery'))
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  let suggestion = null;
  if (missedKm >= 2 && openEasy) {
    const addKm = Math.min(Math.round(missedKm * 0.5), Math.max(2, Math.round(km(openEasy) * 0.4)));
    if (addKm >= 1) suggestion = { kind: 'add', unit: openEasy, addKm, newKm: km(openEasy) + addKm };
  }
  return {
    planned: Math.round(planned), done: Math.round(done), missedKm: Math.round(missedKm),
    pctDone: planned ? done / planned : 0, suggestion,
  };
}

/** Das EINE Fenster für die Anstrengung (RPE) – früher gab es zwei (14 und 21 Tage)
    mit verschiedenen Schwellen, und „Heute“ zeigte widersprüchliche Karten. */
export const RPE_WINDOW_DAYS = 21;

/**
 * Anstrengungs-Trend der letzten Einheiten (erfasstes RPE): durchweg locker →
 * `progress`, durchweg sehr fordernd → `ease`, sonst `hold`. Nur ein Signal für die
 * zentrale Coach-Entscheidung (`coach.js`) – kein Urteil über die Belastung, das
 * kommt allein aus `load.js`. null bei zu wenig Daten (< 4 bewertete Einheiten).
 */
export function rpeProgression(sessions = [], today, days = RPE_WINDOW_DAYS) {
  const since = addDays(today, -days);
  const rated = (sessions || []).filter((s) => s && !s.deleted && Number(s.rpe) > 0 && s.date >= since && s.date <= today);
  if (rated.length < 4) return null;
  const avg = rated.reduce((a, s) => a + Math.min(10, Number(s.rpe)), 0) / rated.length;
  const trend = avg <= 4.5 ? 'progress' : avg >= 7.5 ? 'ease' : 'hold';
  return { trend, avgRpe: Math.round(avg * 10) / 10, count: rated.length, days };
}

/* ------------------------ Wochenzuordnung im Plan ------------------------ */
/* (aus plans.js hierher: badges.js brauchte sie und zog damit plans → session → health
   → badges in einen Import-Zyklus, FE-18) */
export function clampWeek(plan, dateStr) {
  if (dateStr < plan.startDate) return 1;
  if (dateStr > plan.endDate) return plan.weeks;
  return Math.min(plan.weeks, Math.floor(diffDays(plan.startDate, dateStr) / 7) + 1);
}

/** Robuste, öffentliche Wochenzuordnung eines Datums im Plan (1..plan.weeks).
 *  Zentrale Quelle, damit Ansichten die Woche aus dem AUTORITATIVEN Datum ableiten,
 *  statt sich auf ein gespeichertes `week`-Feld zu verlassen (manuell angelegte oder
 *  importierte Einheiten haben oft keines). Liefert null bei unvollständigem Plan. */
export function weekOfDate(plan, dateStr) {
  if (!plan || !plan.startDate || !plan.endDate || !plan.weeks || !dateStr) return null;
  return clampWeek(plan, dateStr);
}
