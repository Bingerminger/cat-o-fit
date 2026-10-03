/* =========================================================================
   unit-actions.js — Aktionen an geplanten Einheiten, ohne Oberfläche (DOM-frei).

   Einheit finden, ändern, erledigen (aus Workout, Datei-Import oder Formular),
   ein vorhandenes Training verknüpfen, den nächsten freien Tag suchen und die
   Gründe für „verpasst“. Genutzt von Heute, Kalender, Plan, Workout-Modus und
   Import; session.js reicht die Namen für ältere Importe weiter.
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

/** Erstellt aus einer geplanten Einheit eine durchgeführte Session. */
export function completeUnit(plan, unit, data) {
  const session = {
    id: uid('ses'),
    plannedId: unit.id,
    eventId: plan.eventId,
    date: unit.date,
    type: unit.type,
    title: unit.title,
    intensity: unit.intensity ?? null,  // Fußball-Intensität für Belastung/harten Tag (#5)
    distanceKm: data.distanceKm ?? null,
    durationSec: data.durationSec ?? null,
    // Soll-Dauer der Einheit: Fehlt die erfasste Dauer, rechnet die Belastung damit
    // statt mit der 30-min-Pauschale (90 min Fußball zählten sonst wie 30).
    plannedDurationMin: Number(unit.targetDurationMin) > 0 ? Number(unit.targetDurationMin) : null,
    paceSecPerKm: data.paceSecPerKm ?? (data.distanceKm && data.durationSec ? Math.round(data.durationSec / data.distanceKm) : null),
    avgHr: data.avgHr ?? null,
    maxHr: data.maxHr ?? null,
    rpe: data.rpe ?? null,
    feeling: data.feeling ?? null,
    timeInZones: data.timeInZones ?? null,
    splits: data.splits ?? [],
    // Aus Datei oder Uhr (sonst gingen sie beim Zuordnen zur geplanten Einheit verloren):
    // Kalorien, Höhenmeter, Strecke – und die Sätze aus dem Workout-Modus.
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
  // Für die Einheit ausgewählte Übungen als genutzt zählen (Nutzungszähler).
  if (Array.isArray(unit.exerciseIds) && unit.exerciseIds.length) store.bumpExerciseUsage(unit.exerciseIds);
  return session;
}

/** Verknüpft ein bereits erfasstes (z. B. importiertes) Training mit einer geplanten
    Einheit: Einheit erledigt, Session trägt den Planbezug. Keine zweite Session. */
export function linkSession(plan, unit, session) {
  store.patch('sessions', session.id, {
    plannedId: unit.id, eventId: plan.eventId ?? null, matchDismissed: null,
    plannedDurationMin: Number(unit.targetDurationMin) > 0 ? Number(unit.targetDurationMin) : (session.plannedDurationMin ?? null),
  });
  saveUnitPatch(plan.id, unit.id, { status: 'erledigt', executedSessionId: session.id });
}

/** Erster Tag ab `from` (höchstens 14 Tage), an dem im Plan keine andere offene Einheit liegt. */
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
/** Grund-Label zu einem missedReason-Schlüssel (für die Anzeige). */
export const MISSED_REASON_LABEL = Object.defineProperties({}, Object.fromEntries(MISSED_REASONS.map((r) => [r.key, { enumerable: true, get: () => r.label }])));
