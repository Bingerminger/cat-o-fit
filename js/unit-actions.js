/* =========================================================================
   unit-actions.js — actions on planned units, without a UI (DOM-free).

   Find, change and complete a unit (from a workout, file import or form),
   link an existing training, find the next free day and the reasons
   for "missed". Used by Today, calendar, plan, workout mode and import;
   session.js passes the names on for older imports.
   ========================================================================= */

import * as store from './storage.js';
import { uid, nowIso, addDays } from './ui.js';

import { t } from './i18n.js';

export function findUnit(id) {
  for (const plan of store.get('plans')) {
    const unit = (plan.units || []).find((u) => u.id === id);
    if (unit) return { plan, unit };
  }
  return null;
}
export function saveUnitPatch(planId, unitId, patch) {
  const plan = store.find('plans', planId);
  if (!plan) return;
  const units = (plan.units || []).map((u) => (u.id === unitId ? { ...u, ...patch } : u));
  store.patch('plans', plan.id, { units });
}

/** Creates a performed session from a planned unit. */
export function completeUnit(plan, unit, data) {
  const session = {
    id: uid('ses'),
    plannedId: unit.id,
    eventId: plan.eventId,
    date: unit.date,
    type: unit.type,
    title: unit.title,
    intensity: unit.intensity ?? null,  // Football intensity for load/hard day (#5)
    distanceKm: data.distanceKm ?? null,
    durationSec: data.durationSec ?? null,
    // Target duration of the unit: if the logged duration is missing, the load uses it
    // instead of the flat 30 min (90 min of football would otherwise count like 30).
    plannedDurationMin: Number(unit.targetDurationMin) > 0 ? Number(unit.targetDurationMin) : null,
    paceSecPerKm: data.paceSecPerKm ?? (data.distanceKm && data.durationSec ? Math.round(data.durationSec / data.distanceKm) : null),
    avgHr: data.avgHr ?? null,
    maxHr: data.maxHr ?? null,
    rpe: data.rpe ?? null,
    feeling: data.feeling ?? null,
    timeInZones: data.timeInZones ?? null,
    splits: data.splits ?? [],
    // From file or watch (otherwise they would get lost when assigning to the planned unit):
    // calories, elevation gain, route – and the sets from workout mode.
    kcal: data.kcal ?? null,
    ascentM: data.ascentM ?? null,
    route: data.route ?? null,
    strengthSets: Array.isArray(data.strengthSets) && data.strengthSets.length ? data.strengthSets : null,
    source: data.source || 'manual',
    notes: data.notes || '',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.upsert('sessions', session);
  saveUnitPatch(plan.id, unit.id, { status: 'erledigt', executedSessionId: session.id });
  // Count the exercises selected for the unit as used (usage counter).
  if (Array.isArray(unit.exerciseIds) && unit.exerciseIds.length) store.bumpExerciseUsage(unit.exerciseIds);
  return session;
}

/** Links an already logged (e.g. imported) training to a planned unit:
    unit done, the session carries the plan reference. No second session. */
export function linkSession(plan, unit, session) {
  store.patch('sessions', session.id, {
    plannedId: unit.id, eventId: plan.eventId ?? null, matchDismissed: null,
    plannedDurationMin: Number(unit.targetDurationMin) > 0 ? Number(unit.targetDurationMin) : (session.plannedDurationMin ?? null),
  });
  saveUnitPatch(plan.id, unit.id, { status: 'erledigt', executedSessionId: session.id });
}

/** First day from `from` (at most 14 days) on which the plan has no other open unit. */
export function nextFreeDay(units, unitId, from, maxDays = 14) {
  for (let i = 0; i < maxDays; i++) {
    const d = addDays(from, i);
    const busy = (units || []).some((u) => u.id !== unitId && u.date === d && u.type !== 'rest' && u.status !== 'verpasst');
    if (!busy) return d;
  }
  return null;
}

export const MISSED_REASONS = [
  { key: 'time', emoji: '⏰', get label() { return t('unitActions.missedReasons.time'); } },
  { key: 'sick', emoji: '🤒', get label() { return t('unitActions.missedReasons.sick'); } },
  { key: 'injured', emoji: '🩹', get label() { return t('unitActions.missedReasons.injured'); } },
  { key: 'other', emoji: '🤷', get label() { return t('unitActions.missedReasons.other'); } },
];
/** Base label for a missedReason key (for display). */
export const MISSED_REASON_LABEL = Object.defineProperties({}, Object.fromEntries(MISSED_REASONS.map((r) => [r.key, { enumerable: true, get: () => r.label }])));
