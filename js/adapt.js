/* =========================================================================
   adapt.js — zentraler Anwende-/Rückgängig-Kern für automatische Plan-
   Anpassungen (Erholungstag, Entlastung, Zyklus-Entschärfung …).

   Bislang lag diese Logik privat in dashboard.js. Ausgelagert, damit auch
   andere Module (z. B. cycle.js für die zyklusbewusste Entschärfung, #3)
   Einheiten anpassen UND transparent protokollieren können – jede Anpassung
   bleibt über den Snapshot rückgängig machbar. Store-nah; die Regeln fürs
   Rückgängigmachen sind reine Funktionen (`undoUnits`, `canUndo`).
   ========================================================================= */

import * as store from './storage.js';
import { nowIso } from './ui.js';
import { pushAdaptLog } from './rolling.js';
import { isOpen } from './planflow.js';

/**
 * Wendet Unit-Patches auf einen Plan an und protokolliert die Anpassung
 * (mit Rückgängig-Snapshot der betroffenen Einheiten und den geänderten Feldern).
 * @param {string} planId
 * @param {string[]} unitIds  IDs der zu ändernden Einheiten
 * @param {(u:object)=>object} patchFor  liefert je Einheit die Patch-Felder
 * @param {object} logEntry  { kind, title, reason } – erscheint im Anpassungs-Log
 * @returns {string|null} die id des neuen Log-Eintrags (oder null, wenn kein Plan)
 */
export function applyAdapt(planId, unitIds, patchFor, logEntry) {
  const plan = store.find('plans', planId);
  if (!plan) return null;
  const ids = new Set(unitIds);
  const undoUnits = (plan.units || []).filter((u) => ids.has(u.id)).map((u) => ({ ...u }));
  const fields = new Set();
  const units = (plan.units || []).map((u) => {
    if (!ids.has(u.id)) return u;
    const patch = patchFor(u);
    Object.keys(patch).forEach((k) => fields.add(k));
    return { ...u, ...patch, updatedAt: nowIso() };
  });
  const adaptLog = pushAdaptLog(plan.adaptLog || [], { ...logEntry, undo: { units: undoUnits, fields: [...fields] } });
  store.patch('plans', planId, { units, adaptLog });
  return adaptLog[0] && adaptLog[0].id;
}

/** Felder, die ein Rückgängig nie anfasst: Sie gehören zum Stand NACH der Anpassung
    (erledigt, verpasst, Session-Verknüpfung) – früher setzte „Rückgängig“ eine inzwischen
    erledigte Einheit blind auf „geplant“ zurück und ließ die Session verwaist zurück. */
const NEVER_RESTORE = ['id', 'status', 'executedSessionId', 'missedReason', 'updatedAt'];
/** Für Alt-Einträge ohne gespeicherte Feldliste: diese Felder bleiben zusätzlich stehen
    (eine spätere Verschiebung soll nicht zurückspringen) – außer beim Entzerren, dessen
    Anpassung genau das Datum war. */
const KEEP_POSITION = ['date', 'dow', 'movedFrom'];

/**
 * Stellt die Einheiten einer protokollierten Anpassung wieder her – aber nur, solange
 * sie noch offen sind, und nur die Felder, die die Anpassung geändert hat. Erledigte
 * oder verpasste Einheiten bleiben unverändert. Reine Funktion.
 * @returns {{units:object[], restored:number, skipped:number}}
 */
export function undoUnits(units = [], entry = {}) {
  const snaps = new Map(((entry.undo && entry.undo.units) || []).map((u) => [u.id, u]));
  const known = entry.undo && Array.isArray(entry.undo.fields) ? entry.undo.fields : null;
  let restored = 0, skipped = 0;
  const out = (units || []).map((u) => {
    const snap = snaps.get(u.id);
    if (!snap) return u;
    if (!isOpen(u)) { skipped++; return u; }
    const keys = known || [...new Set([...Object.keys(snap), ...Object.keys(u)])]
      .filter((k) => entry.kind === 'destack' || !KEEP_POSITION.includes(k));
    const next = { ...u };
    keys.forEach((k) => {
      if (NEVER_RESTORE.includes(k)) return;
      if (k in snap) next[k] = snap[k]; else delete next[k];
    });
    restored++;
    return { ...next, updatedAt: nowIso() };
  });
  return { units: out, restored, skipped };
}

/** Lässt sich die Anpassung noch zurücknehmen? (mindestens eine betroffene Einheit offen) */
export function canUndo(units = [], entry = {}) {
  if (!entry || !entry.undo) return false;
  const ids = new Set((entry.undo.units || []).map((u) => u.id));
  return (units || []).some((u) => ids.has(u.id) && isOpen(u));
}

/**
 * Macht eine protokollierte Anpassung anhand ihres Snapshots rückgängig (siehe
 * `undoUnits`). Der Log-Eintrag verschwindet danach.
 * @returns {{restored:number, skipped:number}|false}
 */
export function undoAdapt(planId, logId) {
  const plan = store.find('plans', planId);
  if (!plan) return false;
  const entry = (plan.adaptLog || []).find((e) => e.id === logId);
  if (!entry || !entry.undo || !canUndo(plan.units || [], entry)) return false;
  const res = undoUnits(plan.units || [], entry);
  const adaptLog = (plan.adaptLog || []).filter((e) => e.id !== logId);
  store.patch('plans', planId, { units: res.units, adaptLog });
  return { restored: res.restored, skipped: res.skipped };
}
