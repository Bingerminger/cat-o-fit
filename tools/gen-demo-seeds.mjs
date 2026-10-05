/* =========================================================================
   tools/gen-demo-seeds.mjs — regenerates the flat developer seeds
   (tools/seed/*.json) from buildDemo – incl. location (Dresden), cycle and a long
   body/fitness time series.

   Since v3.20.0 the seeds are NO longer placed in data/: a fresh installation
   always starts with the first-run setup (admin PIN is mandatory; demo data can
   be chosen there). Only for a local developer instance in the old format:
     cp tools/seed/*.json data/        # BEFORE the first start, empty data/
   api/storage.php:ensure_bootstrap then migrates them to the first admin "u-1"
   (without a PIN – so never use on a reachable server).

   Run (DOM shim for ui.js):
     node --import ./test-setup.js tools/gen-demo-seeds.mjs
   ========================================================================= */
import { writeFileSync } from 'node:fs';
import { buildDemo, completeDemoUnits, planPeriodSessions } from '../js/demo.js';
import { addDays, weekStartMonday, diffDays } from '../js/ui.js';
import { makePhases, generatePlanUnits, DEFAULT_WEEK_TEMPLATE, PLAN_GEN, trainingHistory, suggestLevel } from '../js/plans.js';
import { defaultCommitments, mkCommit } from '../js/commitments.js';
import { estimateVdot, planPaces } from '../js/vdot.js';
import { linkDemoSessions } from '../js/planflow.js';

const REF = '2026-07-04';                 // reference date of the seeds (keep it current)
const now = REF + 'T08:00:00+02:00';
const d = buildDemo(REF);

// Profile as a flat object incl. settings (bootstrap copies it 1:1 to u-1).
const profile = {
  id: 'profile', name: 'Nora', ...d.profile, settings: d.settings,
  createdAt: now, updatedAt: now,
};

// Build the periodised plan like seedDemo (back-dated, fixed dates, "done" marking).
const ev = d.self.events[0];
const start = addDays(weekStartMonday(REF), -14);
const weeks = Math.max(1, Math.ceil((diffDays(start, ev.date) + 1) / 7));
const phases = makePhases(weeks);
const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: addDays(REF, 12), durationMin: 120 })];
// Like createPlanForEvent: level from the history, paces from target time and form.
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
// Link demo workouts with the completed sessions and supplement the remaining completed
// sessions (football too) with matching workouts (as seedDemo does).
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
