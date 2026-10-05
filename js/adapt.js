/* =========================================================================
   adapt.js — central apply/undo core for automatic plan adjustments
   (recovery day, relief, cycle easing …).

   So far this logic lay privately in dashboard.js. Extracted so that other
   modules (e.g. cycle.js for the cycle-aware easing, #3) can adjust sessions
   AND log them transparently – every adjustment remains undoable via the
   snapshot. Store-adjacent; the rules for undoing are pure functions
   (`undoUnits`, `canUndo`).
   ========================================================================= */

import * as store from './storage.js';
import { nowIso } from './ui.js';
import { pushAdaptLog } from './rolling.js';
import { isOpen } from './planflow.js';

/**
 * Applies unit patches to a plan and logs the adjustment
 * (with an undo snapshot of the affected sessions and the changed fields).
 * @param {string} planId
 * @param {string[]} unitIds  IDs of the sessions to change
 * @param {(u:object)=>object} patchFor  returns the patch fields per session
 * @param {object} logEntry  { kind, title, reason } – appears in the adjustment log
 * @returns {string|null} the id of the new log entry (or null if there is no plan)
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

/** Fields that an undo never touches: they belong to the state AFTER the adjustment
    (done, missed, session link) – previously "Undo" blindly reset a session that had
    been completed in the meantime to "planned" and left the session orphaned. */
const NEVER_RESTORE = ['id', 'status', 'executedSessionId', 'missedReason', 'updatedAt'];
/** For legacy entries without a stored field list: these fields additionally stay as they are
    (a later reschedule should not jump back) – except when de-stacking, whose
    adjustment was exactly the date. */
const KEEP_POSITION = ['date', 'dow', 'movedFrom'];

/**
 * Restores the sessions of a logged adjustment – but only while they are still
 * open, and only the fields the adjustment changed. Completed or missed sessions
 * remain unchanged. Pure function.
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

/** Can the adjustment still be reverted? (at least one affected session still open) */
export function canUndo(units = [], entry = {}) {
  if (!entry || !entry.undo) return false;
  const ids = new Set((entry.undo.units || []).map((u) => u.id));
  return (units || []).some((u) => ids.has(u.id) && isOpen(u));
}

/**
 * Undoes a logged adjustment using its snapshot (see
 * `undoUnits`). The log entry disappears afterwards.
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
