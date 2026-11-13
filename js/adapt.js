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
import { nowIso, todayStr } from './ui.js';
import { fmtNum } from './format.js';
import { pushAdaptLog } from './rolling.js';
import { isOpen } from './planflow.js';
import { autoVolumeDecision, autoVolumeVariant } from './autovolume.js';
import { t } from './i18n.js';

/**
 * Applies unit patches to a plan and logs the adjustment
 * (with an undo snapshot of the affected sessions and the changed fields).
 * @param {string} planId
 * @param {string[]} unitIds  IDs of the sessions to change
 * @param {(u:object)=>object} patchFor  returns the patch fields per session
 * @param {object} logEntry  { kind, title, reason } – appears in the adjustment log
 * @param {object} [planPatch]  further plan fields, written in the same change
 * @returns {string|null} the id of the new log entry (or null if there is no plan)
 */
export function applyAdapt(planId, unitIds, patchFor, logEntry, planPatch = {}) {
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
  store.patch('plans', planId, { ...planPatch, units, adaptLog });
  return adaptLog[0] && adaptLog[0].id;
}

const kmText = (km) => `${fmtNum(km, km % 1 ? 1 : 0)} km`;

/** One line per signal for the log (literal keys, so the catalog check sees them). */
function signalText(s) {
  if (s.key === 'load') return t('autoVolume.reasonLoad', { ratio: fmtNum(s.value, 2) });
  if (s.key === 'effort') return t('autoVolume.reasonEffort', { rpe: fmtNum(s.value, 1) });
  if (s.key === 'fatigue') return t('autoVolume.reasonFatigue');
  return t('autoVolume.reasonCompletion', { pct: s.value });
}

/**
 * Automatic volume adjustment (autovolume.js): shortens the remaining easy runs of the
 * current plan week when load, effort, form or the last week speak for it – once per
 * plan week, logged with undo. Runs only for the person themself, only with the
 * setting on, and only after plans and sessions came from the server in this session
 * (an old local state must never overwrite a plan changed on another device).
 * @returns {number} number of plans adjusted
 */
export function ensureAutoVolume(today = todayStr()) {
  if (store.isManaging() || store.settings().autoVolume === false) return 0;
  if (!store.areaFetched('plans') || !store.areaFetched('sessions')) return 0;
  const sessions = store.get('sessions');
  const plans = store.get('plans');
  const allUnits = plans.flatMap((p) => p.units || []);
  let n = 0;
  plans.forEach((plan) => {
    const d = autoVolumeDecision({ plan, sessions, today, allUnits });
    if (!d) return;
    const pct = Math.round((1 - d.factor) * 100);
    const signals = d.signals.map(signalText).join(' · ');
    applyAdapt(plan.id, d.unitIds, (u) => autoVolumeVariant(u, d.factor), {
      kind: 'autovolume',
      title: t('autoVolume.logTitle', { pct }),
      reason: d.beforeKm > d.afterKm
        ? t('autoVolume.logReason', { signals, before: kmText(d.beforeKm), after: kmText(d.afterKm) })
        : t('autoVolume.logReasonShort', { signals }),
    }, { autoVolume: { week: d.week, factor: d.factor, date: today } });
    n++;
  });
  return n;
}

/** Fields that an undo never touches: they belong to the state AFTER the adjustment
    (done, missed, session link) – previously "Undo" blindly reset a session that had
    been completed in the meantime to "planned" and left the session orphaned. */
const NEVER_RESTORE = ['id', 'status', 'executedSessionId', 'missedReason', 'updatedAt'];
/** For legacy entries without a stored field list: these fields additionally stay as they are
    (a later reschedule should not jump back) – except when de-stacking, whose
    adjustment was exactly the date. */
const KEEP_POSITION = ['date', 'dow', 'movedFrom'];

/** Sessions that an adjustment NEWER than `entry` changed again (the log runs newest first).
    Undoing the older one would lay its old fields over the newer change – a long run shortened
    automatically and then turned into a recovery day would come back as "Long Run 17 km" of
    type recovery. Those sessions stay; the newer adjustment can be undone first. */
function changedLater(entry, log = []) {
  const ids = new Set();
  for (const e of log || []) {
    if (!e || e.id === entry.id) break;
    ((e.undo && e.undo.units) || []).forEach((u) => ids.add(u.id));
  }
  return ids;
}

/**
 * Restores the sessions of a logged adjustment – but only while they are still
 * open, only those no newer adjustment changed again (`log` = the plan's adaptLog), and only
 * the fields the adjustment changed. Completed or missed sessions remain unchanged. Pure function.
 * @returns {{units:object[], restored:number, skipped:number}}
 */
export function undoUnits(units = [], entry = {}, log = []) {
  const snaps = new Map(((entry.undo && entry.undo.units) || []).map((u) => [u.id, u]));
  const known = entry.undo && Array.isArray(entry.undo.fields) ? entry.undo.fields : null;
  const later = changedLater(entry, log);
  let restored = 0, skipped = 0;
  const out = (units || []).map((u) => {
    const snap = snaps.get(u.id);
    if (!snap) return u;
    if (!isOpen(u) || later.has(u.id)) { skipped++; return u; }
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

/** Can the adjustment still be reverted? (at least one affected session still open and not
    changed again by a newer adjustment) */
export function canUndo(units = [], entry = {}, log = []) {
  if (!entry || !entry.undo) return false;
  const ids = new Set((entry.undo.units || []).map((u) => u.id));
  const later = changedLater(entry, log);
  return (units || []).some((u) => ids.has(u.id) && isOpen(u) && !later.has(u.id));
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
  if (!entry || !entry.undo || !canUndo(plan.units || [], entry, plan.adaptLog)) return false;
  const res = undoUnits(plan.units || [], entry, plan.adaptLog);
  const adaptLog = (plan.adaptLog || []).filter((e) => e.id !== logId);
  store.patch('plans', planId, { units: res.units, adaptLog });
  return { restored: res.restored, skipped: res.skipped };
}
