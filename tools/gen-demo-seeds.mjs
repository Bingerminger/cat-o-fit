/* =========================================================================
   tools/gen-demo-seeds.mjs — regeneriert die flachen Bootstrap-Seeds
   (data/*.json) aus buildDemo, damit eine FRISCHE Instanz (ACC/PROD-Erststart,
   Server-Bootstrap in api/storage.php:ensure_bootstrap) dieselben VOLLSTÄNDIGEN
   Demodaten bekommt wie „Mit Demodaten starten" – inkl. Ort (Dresden), Zyklus
   und langer Körper-/Fitness-Zeitreihe.

   Ausführen (DOM-Shim für ui.js):
     node --import ./test-setup.js tools/gen-demo-seeds.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import { buildDemo } from '../js/demo.js';
import { addDays, weekStartMonday, diffDays } from '../js/ui.js';
import { makePhases, generatePlanUnits, DEFAULT_WEEK_TEMPLATE } from '../js/plans.js';
import { defaultCommitments, mkCommit } from '../js/commitments.js';

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
const plan = {
  id: 'demo-plan1', eventId: ev.id, name: `Trainingsplan · ${ev.name}`,
  goalTime: ev.targetTime, startDate: start, endDate: ev.date, weeks, baseLongKm: null,
  phases, weekTemplate: DEFAULT_WEEK_TEMPLATE, commitments, sport: 'run',
  units: [], generated: true, createdAt: now, updatedAt: now,
};
plan.units = generatePlanUnits(plan, ev, d.profile)
  .map((u) => (u.date < REF ? { ...u, status: 'erledigt' } : u));

const files = {
  'data/profile.json': profile,
  'data/events.json': d.self.events,
  'data/plans.json': [plan],
  'data/sessions.json': d.self.sessions,
  'data/health.json': d.self.health,
  'data/nutrition.json': d.self.nutrition,
  'data/diary.json': d.self.diary,
  'data/cycle.json': d.self.cycle,
  'data/checklist.json': d.self.checklist,
  'data/shopping.json': d.self.shopping,
  'data/pantry.json': d.pantry,
};

for (const [path, data] of Object.entries(files)) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  const count = Array.isArray(data) ? `${data.length} Einträge` : 'Objekt';
  console.log(`  ✓ ${path} (${count})`);
}
console.log(`\nFertig. Health-Punkte: ${d.self.health.length}, Zyklen: ${d.self.cycle.length}, Plan-Einheiten: ${plan.units.length}.`);
console.log(`Ort: ${d.settings.location.name}, Zyklus-Modul: ${d.settings.modules.cycle}.`);
