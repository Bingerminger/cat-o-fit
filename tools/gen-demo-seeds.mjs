/* =========================================================================
   tools/gen-demo-seeds.mjs — regeneriert die flachen Entwickler-Seeds
   (tools/seed/*.json) aus buildDemo – inkl. Ort (Dresden), Zyklus und langer
   Körper-/Fitness-Zeitreihe.

   Seit v3.20.0 liegen die Seeds NICHT mehr in data/: Eine frische Installation
   startet immer mit der Ersteinrichtung (Admin-PIN ist Pflicht; Demodaten lassen
   sich dort wählen). Nur für eine lokale Entwickler-Instanz im Altformat:
     cp tools/seed/*.json data/        # VOR dem ersten Start, leeres data/
   api/storage.php:ensure_bootstrap migriert sie dann zum ersten Admin „u-1"
   (ohne PIN – daher nie auf einem erreichbaren Server verwenden).

   Ausführen (DOM-Shim für ui.js):
     node --import ./test-setup.js tools/gen-demo-seeds.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import { buildDemo, completeDemoUnits, planPeriodSessions } from '../js/demo.js';
import { addDays, weekStartMonday, diffDays } from '../js/ui.js';
import { makePhases, generatePlanUnits, DEFAULT_WEEK_TEMPLATE, PLAN_GEN, trainingHistory, suggestLevel } from '../js/plans.js';
import { defaultCommitments, mkCommit } from '../js/commitments.js';
import { estimateVdot, planPaces } from '../js/vdot.js';
import { linkDemoSessions } from '../js/planflow.js';

const REF = '2026-07-04';                 // Referenzdatum der Seeds (aktuell halten)
const now = REF + 'T08:00:00+02:00';
const d = buildDemo(REF);

// Profil als flaches Objekt inkl. settings (Bootstrap kopiert es 1:1 nach u-1).
const profile = {
  id: 'profile', name: 'Nora', ...d.profile, settings: d.settings,
  createdAt: now, updatedAt: now,
};

// Periodisierten Plan wie seedDemo bauen (rückdatiert, feste Termine, erledigt-Markierung).
const ev = d.self.events[0];
const start = addDays(weekStartMonday(REF), -14);
const weeks = Math.max(1, Math.ceil((diffDays(start, ev.date) + 1) / 7));
const phases = makePhases(weeks);
const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: addDays(REF, 12), durationMin: 120 })];
// Wie createPlanForEvent: Niveau aus der Historie, Paces aus Zielzeit und Form.
const hist = trainingHistory(d.self.sessions, REF);
const form = estimateVdot(d.self.sessions, REF, 42, { hrZones: d.profile.hrZones });
const [h, m, s] = ev.targetTime.split(':').map(Number);
const pp = planPaces({ distanceKm: ev.distanceKm, targetSec: h * 3600 + m * 60 + s, formVdot: form && !form.onlyEasy ? form.vdot : null });
const plan = {
  id: 'demo-plan1', eventId: ev.id, name: `Trainingsplan · ${ev.name}`,
  goalTime: ev.targetTime, startDate: start, endDate: ev.date, weeks,
  level: suggestLevel(hist), daysPerWeek: 4, baseLongKm: hist.longKm, baseWeekKm: hist.weekKm,
  paces: pp ? pp.zones : null,
  paceInfo: pp ? { goalVdot: pp.goalVdot, formVdot: pp.formVdot, trainingVdot: pp.trainingVdot, ambitious: pp.ambitious } : null,
  phases, weekTemplate: DEFAULT_WEEK_TEMPLATE, commitments, sport: 'run', gen: PLAN_GEN,
  units: [], generated: true, createdAt: now, updatedAt: now,
};
const units = generatePlanUnits(plan, ev, d.profile)
  .map((u) => (u.date < REF ? { ...u, status: 'erledigt' } : u));
// Demo-Trainings mit den erledigten Einheiten verknüpfen und die übrigen erledigten
// Einheiten (auch Fußball) um passende Trainings ergänzen (wie seedDemo).
const linked = linkDemoSessions(units, planPeriodSessions(d.self.sessions, start, REF), REF, ev.id);
const completed = completeDemoUnits(linked.units, linked.sessions, REF, ev.id);
plan.units = completed.units;
d.self.sessions = completed.sessions;

const files = {
  'tools/seed/profile.json': profile,
  'tools/seed/events.json': d.self.events,
  'tools/seed/plans.json': [plan],
  'tools/seed/sessions.json': d.self.sessions,
  'tools/seed/health.json': d.self.health,
  'tools/seed/nutrition.json': d.self.nutrition,
  'tools/seed/diary.json': d.self.diary,
  'tools/seed/cycle.json': d.self.cycle,
  'tools/seed/checklist.json': d.self.checklist,
  'tools/seed/shopping.json': d.self.shopping,
  'tools/seed/pantry.json': d.pantry,
};

for (const [path, data] of Object.entries(files)) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  const count = Array.isArray(data) ? `${data.length} Einträge` : 'Objekt';
  console.log(`  ✓ ${path} (${count})`);
}
console.log(`\nFertig. Health-Punkte: ${d.self.health.length}, Zyklen: ${d.self.cycle.length}, Plan-Einheiten: ${plan.units.length}.`);
console.log(`Ort: ${d.settings.location.name}, Zyklus-Modul: ${d.settings.modules.cycle}.`);
