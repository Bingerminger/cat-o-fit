/* =========================================================================
   whatif.js — „Was passiert, wenn ich das ändere?". Reine, DOM-freie Logik.

   Leitsatz: „Wenn der Sportler an seinem Plan oder Einheiten etwas ändert, sollte
   er vor der Änderung wissen, was das für Auswirkungen haben soll." Dieses Modul
   simuliert das Hinzufügen/Verschieben einer Einheit und liefert Vorher/Nachher
   der betroffenen Woche (geplante Belastung, Anzahl harter Einheiten) plus eine
   Einordnung. Die UI zeigt das als Vorschau, bevor bestätigt wird.
   ========================================================================= */

import { weekStartMonday, addDays } from './ui.js';
import { RPE_BY_TYPE } from './fitness.js';
import { isHard } from './planflow.js';

/** Geschätzte Belastungspunkte einer geplanten Einheit (sRPE aus Ziel-Werten). */
export function unitLoad(u) {
  if (!u || u.type === 'rest') return 0;
  const min = u.targetDurationMin || (u.targetDistanceKm ? u.targetDistanceKm * 6 : 40);
  const rpe = RPE_BY_TYPE[u.type] || 4;
  return Math.round(min * rpe);
}

/** Geplante Kennzahlen der Mo–So-Woche von dateStr: Belastung, harte Einheiten, Anzahl. */
export function weekPlan(units = [], dateStr) {
  const ws = weekStartMonday(dateStr), we = addDays(ws, 6);
  const list = (units || []).filter((u) => u && !u.deleted && u.date >= ws && u.date <= we
    && u.type !== 'rest' && u.status !== 'verpasst' && u.status !== 'verschoben');
  return {
    load: list.reduce((s, u) => s + unitLoad(u), 0),
    hard: list.filter(isHard).length,
    count: list.length,
  };
}

/** Einordnung der Woche nach der Simulation (relativ zum Vorher-Zustand). */
function classify(before, after) {
  if (after.hard > 3 || (before.load > 0 && after.load > before.load * 1.35)) return 'hoch';
  if (after.hard > before.hard || after.load > before.load) return 'erhöht';
  return 'ok';
}

/** Simuliert das HINZUFÜGEN einer Einheit → Vorher/Nachher der betroffenen Woche. */
export function simulateAdd(units = [], newUnit) {
  if (!newUnit || !newUnit.date) return null;
  const before = weekPlan(units, newUnit.date);
  const after = weekPlan([...(units || []), newUnit], newUnit.date);
  return { date: newUnit.date, before, after, deltaLoad: after.load - before.load, level: classify(before, after) };
}

/** Simuliert das VERSCHIEBEN einer Einheit → Auswirkung auf alte UND neue Woche. */
export function simulateMove(units = [], unitId, newDate) {
  const u = (units || []).find((x) => x.id === unitId);
  if (!u || !newDate) return null;
  const moved = units.map((x) => (x.id === unitId ? { ...x, date: newDate } : x));
  const sameWeek = weekStartMonday(u.date) === weekStartMonday(newDate);
  const target = { date: newDate, before: weekPlan(units, newDate), after: weekPlan(moved, newDate) };
  target.deltaLoad = target.after.load - target.before.load;
  target.level = classify(target.before, target.after);
  if (sameWeek) return { target, source: null };
  const source = { date: u.date, before: weekPlan(units, u.date), after: weekPlan(moved, u.date) };
  source.deltaLoad = source.after.load - source.before.load;
  source.level = classify(source.after, source.before); // Quelle wird leichter → informativ
  return { target, source };
}

/** Kurzer Klartext-Satz zur Auswirkung (für die Vorschau). */
export function impactText(sim) {
  if (!sim) return '';
  const b = sim.before, a = sim.after;
  const hardTxt = a.hard !== b.hard ? ` Fordernde Einheiten: ${b.hard} → ${a.hard}.` : '';
  if (sim.level === 'hoch') return `Diese Woche wird deutlich fordernder (Belastung ${b.load} → ${a.load}).${hardTxt} Achte bewusst auf Erholung.`;
  if (sim.level === 'erhöht') return `Diese Woche wird etwas fordernder (Belastung ${b.load} → ${a.load}).${hardTxt}`;
  return `Kaum Auswirkung auf die Wochenbelastung (${b.load} → ${a.load}).`;
}
