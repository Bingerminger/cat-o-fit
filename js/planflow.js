/* =========================================================================
   planflow.js — adaptive Plan-Anpassungen rund um manuelle Eingriffe
   (aus dem Praxis-Feedback). Reine Funktionen ohne Store/DOM → testbar.

   Idee: Fügt man selbst eine Einheit hinzu oder verschiebt sie, soll die
   Wochenbelastung nicht unbemerkt anwachsen. Die App schlägt dann eine
   ähnliche, noch offene Einheit derselben Woche als Ausgleich vor.
   ========================================================================= */

import { weekStartMonday, addDays, diffDays } from './ui.js';

/** Belastungsklasse eines Einheiten-Typs (für „ähnliche Intensität"). */
export function loadClass(type) {
  if (['tempo', 'interval', 'race', 'match', 'camp'].includes(type)) return 'quality';
  if (['easy', 'long', 'run', 'cross', 'cross_bike', 'cross_football'].includes(type)) return 'endurance';
  if (['recovery', 'mobility', 'walk'].includes(type)) return 'recovery';
  if (type === 'strength') return 'strength';
  return 'other';
}

/** Einheit zählt zur Wochenlast (nicht verpasst/verschoben, kein Ruhetag). */
function countsToLoad(u) {
  return u.type !== 'rest' && u.status !== 'verpasst' && u.status !== 'verschoben';
}
/** Noch offene, veränderbare Einheit (weder erledigt noch verpasst/verschoben). */
function isOpen(u) {
  return u.type !== 'rest' && (u.status === 'geplant' || u.status == null);
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
    && (u.status === 'geplant' || u.status == null) && countsToLoad(u));
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

/** Fordernde Einheit (zehrt an der Erholung): Qualität, Kraft, Long Run – und
    Fußball (Antritte/Spielintensität), außer der Termin ist ausdrücklich „leicht" (#5). */
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
  // Feste Termine (Fußball/Spiele) nicht zum „lockerer machen" vorschlagen – die stehen fest.
  const hard = todaysUnits.find((u) => isHard(u) && !u.fixed && (u.status === 'geplant' || u.status == null));
  return hard ? { unit: hard, score: readiness.score } : null;
}

/** Offene, lastrelevante Einheiten der nächsten `horizon` Tage – Kandidaten für eine Entlastung. */
export function weekDeloadCandidates(units = [], today, horizon = 7) {
  const end = addDays(today, horizon);
  return units.filter((u) => (u.status === 'geplant' || u.status == null) && countsToLoad(u) && u.date >= today && u.date <= end);
}

/** Progressions-Variante: Umfang ~12 % rauf (Typ bleibt) – wenn noch Reserven da sind. */
export function progressVariant(unit) {
  const km = unit.targetDistanceKm ? Math.round(unit.targetDistanceKm * 1.12 * 2) / 2 : null;
  const min = !km && unit.targetDurationMin ? Math.round(unit.targetDurationMin * 1.1) : null;
  return { targetDistanceKm: km, targetDurationMin: min, boosted: true };
}

/** Entlastungs-Variante einer Einheit: Umfang ~25 % runter; harte Einheit wird locker. */
export function deloadVariant(unit) {
  const km = unit.targetDistanceKm ? Math.max(4, Math.round(unit.targetDistanceKm * 0.75 * 2) / 2) : null;
  const min = unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.75) : null;
  if (isHard(unit) && unit.type !== 'strength') {
    return { type: 'easy', title: 'Locker (Entlastung)', targetDistanceKm: km, targetPaceMaxSecPerKm: null, intervals: null, deloaded: true, originalType: unit.originalType || unit.type };
  }
  return { targetDistanceKm: km, targetDurationMin: km ? null : min, deloaded: true };
}

/** Verpasste Schlüsseleinheiten (fordernd) der letzten `days` Tage, jüngste zuerst (#Umplanung). */
export function missedKeyUnits(plans = [], today, days = 10) {
  const out = [];
  plans.forEach((p) => (p.units || []).forEach((u) => {
    if (u.status !== 'verpasst' || !isHard(u)) return;
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
    title: 'Locker (an Bereitschaft angepasst)',
    targetDistanceKm: km,
    targetDurationMin: km ? null : (unit.targetDurationMin ? Math.round(unit.targetDurationMin * 0.7) : null),
    targetPaceSecPerKm: easyPace?.min ?? null,
    targetPaceMaxSecPerKm: easyPace?.max ?? null,
    targetHrZone: easyPace?.hrZone ?? 2,
    intervals: null,
    description: 'Heute bewusst lockerer wegen niedriger Bereitschaft. Ganz entspannt in Z2 – die Schlüsseleinheit holst du nach, wenn du erholter bist.',
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
  const missedKm = run.filter((u) => u.status !== 'erledigt' && u.date < today).reduce((s, u) => s + km(u), 0);
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

/**
 * Automatische Progressionssteuerung aus dem RPE-Trend der letzten Einheiten:
 * war es durchweg locker -> behutsam steigern; durchweg sehr hart -> lockere
 * Phase; sonst Kurs halten. Reiner Vorschlag. null bei zu wenig Daten (<3).
 */
export function rpeProgression(sessions = [], today, days = 21) {
  const since = addDays(today, -days);
  const rated = (sessions || []).filter((s) => s && !s.deleted && Number(s.rpe) > 0 && s.date >= since && s.date <= today);
  if (rated.length < 3) return null;
  const avg = rated.reduce((a, s) => a + Number(s.rpe), 0) / rated.length;
  let trend; let advice;
  if (avg <= 5.5) { trend = 'progress'; advice = 'Zuletzt eher locker – Zeit, behutsam zu steigern: etwas mehr Tempo oder Umfang in der nächsten Schlüsseleinheit.'; }
  else if (avg >= 8) { trend = 'ease'; advice = 'Zuletzt durchweg sehr fordernd – plane eine lockere Phase ein, bevor du weiter steigerst.'; }
  else { trend = 'hold'; advice = 'Belastung im guten Bereich – Kurs halten.'; }
  return { trend, avgRpe: Math.round(avg * 10) / 10, count: rated.length, advice };
}
