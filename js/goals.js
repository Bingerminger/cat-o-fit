/* =========================================================================
   goals.js — dedizierte Gesundheits-/Gewichtsziele mit Fortschritt.

   Ein Ziel ist ein angestrebter Wert einer Körper-/Gesundheitsmetrik
   (z. B. „65 kg", „Ruhepuls 50", „VO₂max 45"). Der Fortschritt wird gegen den
   Startwert (bei Anlage erfasst) und den aktuellsten gemessenen Wert berechnet.
   DOM-frei und damit testbar; gespeichert in `profile.settings.healthGoals`.
   Ergänzt die Wochen-Aktivitätsziele (healthgoals.js), die sich auf
   Minuten/Trainingstage pro Woche beziehen.
   ========================================================================= */

/** Unterstützte Metriken (aus den Körperwerten). */
export const GOAL_METRICS = [
  { key: 'weight', label: 'Gewicht', unit: 'kg', field: 'weight', digits: 1, hint: 'runter oder rauf' },
  { key: 'bodyFat', label: 'Körperfett', unit: '%', field: 'bodyFat', digits: 1, hint: 'meist runter' },
  { key: 'restingHr', label: 'Ruhepuls', unit: 'bpm', field: 'restingHr', digits: 0, hint: 'meist runter' },
  { key: 'hrv', label: 'HRV', unit: 'ms', field: 'hrv', digits: 0, hint: 'meist rauf' },
  { key: 'vo2max', label: 'VO₂max', unit: '', field: 'vo2max', digits: 0, hint: 'rauf' },
];
export function metricMeta(key) { return GOAL_METRICS.find((m) => m.key === key) || null; }

/** Aktuellster erfasster Wert einer Metrik (aus health; Gewicht ersatzweise aus dem Profil). */
export function latestMetric(key, { profile = {}, health = [] } = {}) {
  const m = metricMeta(key);
  if (!m) return null;
  const vals = (health || [])
    .filter((h) => h && !h.deleted && h[m.field] != null && h[m.field] !== '')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (vals.length) return Number(vals[0][m.field]);
  if (key === 'weight' && profile.weightKg != null) return Number(profile.weightKg);
  return null;
}

/** Tage bis zur Frist (oder null). */
function daysUntil(deadline, today) {
  if (!deadline || !today) return null;
  const d = (Date.parse(deadline) - Date.parse(today)) / 86400000;
  return Number.isNaN(d) ? null : Math.round(d);
}

/** Fortschritt eines einzelnen Ziels. */
export function goalProgress(goal, ctx = {}) {
  const m = metricMeta(goal.metric);
  const current = latestMetric(goal.metric, ctx);
  const start = goal.start != null ? Number(goal.start) : current;
  const target = Number(goal.target);
  const down = (start != null ? start : target) > target;   // Zielwert kleiner als Start => „runter"
  let pct = 0;
  let reached = false;
  if (current != null && start != null) {
    if (start === target) { pct = 1; reached = true; }
    else {
      pct = down ? (start - current) / (start - target) : (current - start) / (target - start);
      pct = Math.max(0, Math.min(1, pct));
      reached = down ? current <= target : current >= target;
    }
  }
  const remaining = current != null ? Math.round(Math.abs(current - target) * 10) / 10 : null;
  return {
    metric: m, current, start, target, down, reached,
    pct: reached ? 1 : pct,
    remaining,
    daysLeft: daysUntil(goal.deadline, ctx.today),
  };
}

/** Fortschritt aller im Profil hinterlegten Ziele. */
export function goalsProgress({ profile = {}, health = [], today } = {}) {
  const goals = (profile.settings && profile.settings.healthGoals) || [];
  return goals.map((g) => ({ goal: g, ...goalProgress(g, { profile, health, today }) }));
}
