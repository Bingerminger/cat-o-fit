/* =========================================================================
   whatif.js — „Was passiert, wenn ich das ändere?“. Reine, DOM-freie Logik.

   Leitsatz: „Wenn der Sportler an seinem Plan oder Einheiten etwas ändert, sollte
   er vor der Änderung wissen, was das für Auswirkungen haben soll." Dieses Modul
   simuliert das Hinzufügen/Verschieben einer Einheit und liefert Vorher/Nachher
   der betroffenen Woche (geplante Belastung, harte Einheiten, harte Folgetage)
   plus eine Einordnung. Die UI zeigt das als Vorschau, bevor bestätigt wird.

   Eingeordnet wird die VERÄNDERUNG, nicht der Zustand der Woche: Eine Woche mit
   zwei Fußballterminen, Tempo und Long Run hat schon vier harte Einheiten – früher
   meldete dort jede Kleinigkeit (15 min Mobility) „deutlich fordernder“.
   ========================================================================= */

import { weekStartMonday, addDays } from './ui.js';
import { sessionRpe, loadMinutes } from './load.js';
import { isHard } from './planflow.js';

import { t } from './i18n.js';

/** Geschätzte Belastungspunkte einer geplanten Einheit – nach denselben Regeln wie
    die erfasste Belastung (`load.js`): Fußball nach Intensität, Strecke nach Sportart. */
export function unitLoad(u) {
  if (!u || u.type === 'rest') return 0;
  // `dur`: Programmeinheiten aus früheren Versionen (Lese-Rückfall).
  const planned = Number(u.targetDurationMin) || Number(u.dur) || 0;
  const min = planned > 0 ? planned
    : (Number(u.targetDistanceKm) > 0 ? loadMinutes({ type: u.type, distanceKm: Number(u.targetDistanceKm) }).min : 40);
  return Math.round(min * sessionRpe({ type: u.type, intensity: u.intensity }));
}

/** Lastrelevante Einheiten (nicht verpasst, kein Ruhetag) im Datumsfenster. */
function relevant(units, from, to) {
  // Verschobene Einheiten zählen mit – sie belasten die Zielwoche (seit v3.16.0).
  return (units || []).filter((u) => u && !u.deleted && u.date >= from && u.date <= to
    && u.type !== 'rest' && u.status !== 'verpasst');
}

/** Paare harter Tage direkt nacheinander, die die Woche berühren – inklusive
    Sonntag davor und Montag danach (Spiel am Sonntag → Training am Montag). */
function hardPairs(units, ws, we) {
  const hardDays = new Set(relevant(units, addDays(ws, -1), addDays(we, 1)).filter(isHard).map((u) => u.date));
  let n = 0;
  for (let d = addDays(ws, -1); d < addDays(we, 1); d = addDays(d, 1)) {
    if (hardDays.has(d) && hardDays.has(addDays(d, 1))) n++;
  }
  return n;
}

/** Geplante Kennzahlen der Mo–So-Woche von dateStr: Belastung, harte Einheiten,
    Anzahl, harte Folgetage (über die Wochengrenze hinweg). */
export function weekPlan(units = [], dateStr) {
  const ws = weekStartMonday(dateStr), we = addDays(ws, 6);
  const list = relevant(units, ws, we);
  return {
    load: list.reduce((s, u) => s + unitLoad(u), 0),
    hard: list.filter(isHard).length,
    count: list.length,
    b2b: hardPairs(units, ws, we),
  };
}

/**
 * Einordnung aus der Veränderung: relative Laständerung, zusätzliche harte Einheit,
 * neuer harter Folgetag. „hoch“ = deutlich mehr Last (> 25 %) oder ein neuer harter
 * Folgetag; „erhöht“ = spürbar mehr (> 8 %) oder eine harte Einheit mehr.
 */
function classify(before, after) {
  const rel = before.load > 0 ? (after.load - before.load) / before.load : (after.load > 0 ? 1 : 0);
  if (rel > 0.25 || (after.b2b || 0) > (before.b2b || 0)) return 'hoch';
  if (rel > 0.08 || after.hard > before.hard) return 'erhöht';
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
  const pct = b.load > 0 ? Math.round(((a.load - b.load) / b.load) * 100) : null;
  const loadTxt = pct != null && pct !== 0
    ? t('whatif.loadChangePct', { before: b.load, after: a.load, pct: `${pct > 0 ? '+' : ''}${pct}` })
    : t('whatif.loadChange', { before: b.load, after: a.load });
  const hardTxt = a.hard !== b.hard ? ` ${t('whatif.hardChange', { before: b.hard, after: a.hard })}` : '';
  const b2bTxt = (a.b2b || 0) > (b.b2b || 0) ? ` ${t('whatif.b2b')}` : '';
  if (sim.level === 'hoch' && a.load <= b.load) {
    // Gleiche Last, aber ein neuer harter Folgetag (typisch: Verschieben in derselben Woche).
    return t('whatif.sameLoadB2b', { load: b.load });
  }
  if (sim.level === 'hoch') return `${t('whatif.muchHarder', { load: loadTxt })}${hardTxt}${b2bTxt} ${t('whatif.mindRecovery')}`;
  if (sim.level === 'erhöht') return `${t('whatif.bitHarder', { load: loadTxt })}${hardTxt}`;
  return t('whatif.littleEffect', { load: loadTxt });
}
