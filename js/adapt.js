/* =========================================================================
   adapt.js — zentraler Anwende-/Rückgängig-Kern für automatische Plan-
   Anpassungen (Erholungstag, Entlastung, Zyklus-Entschärfung …).

   Bislang lag diese Logik privat in dashboard.js. Ausgelagert, damit auch
   andere Module (z. B. cycle.js für die zyklusbewusste Auto-Entschärfung, #3)
   Einheiten anpassen UND transparent protokollieren können – jede Anpassung
   bleibt über den Snapshot rückgängig machbar. DOM-frei, store-nah.
   ========================================================================= */

import * as store from './storage.js';
import { nowIso } from './ui.js';
import { pushAdaptLog } from './rolling.js';

/**
 * Wendet Unit-Patches auf einen Plan an und protokolliert die Anpassung
 * (mit Rückgängig-Snapshot der betroffenen Einheiten).
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
  const units = (plan.units || []).map((u) => (ids.has(u.id) ? { ...u, ...patchFor(u), updatedAt: nowIso() } : u));
  const adaptLog = pushAdaptLog(plan.adaptLog || [], { ...logEntry, undo: { units: undoUnits } });
  store.patch('plans', planId, { units, adaptLog });
  return adaptLog[0] && adaptLog[0].id;
}

/**
 * Macht eine protokollierte Anpassung anhand ihres Snapshots rückgängig.
 * @returns {boolean} true, wenn ein Eintrag zurückgenommen wurde.
 */
export function undoAdapt(planId, logId) {
  const plan = store.find('plans', planId);
  if (!plan) return false;
  const entry = (plan.adaptLog || []).find((e) => e.id === logId);
  if (!entry || !entry.undo) return false;
  const byId = new Map(entry.undo.units.map((u) => [u.id, u]));
  const units = (plan.units || []).map((u) => (byId.has(u.id) ? { ...byId.get(u.id), updatedAt: nowIso() } : u));
  const adaptLog = (plan.adaptLog || []).filter((e) => e.id !== logId);
  store.patch('plans', planId, { units, adaptLog });
  return true;
}
