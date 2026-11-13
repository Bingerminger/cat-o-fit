/* =========================================================================
   store-setup.js — initial setup, demo data and resetting the app. Layer 11.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { REACH_TIMEOUT, deleteUserData, isOnline, ping, pushOps, serverLogin } from './api-client.js';
import { addDays, diffDays, nowIso, scopeKey, todayStr, uid, weekStart } from './ui.js';
import { locale, t as tr } from './i18n.js';
import { pinHash, pinProblem, rememberDevicePin } from './store-auth.js';
import { exerciseUsage, patch, replaceArea, setProfile, setSetting } from './store-data.js';
import { familyUpsert, isAdmin, pushFamily, rebuildFamily, setFamilyPantry, syncFamily } from './store-family.js';
import { writeUserArea } from './store-local.js';
import { addMember, addTeam } from './store-members.js';
import { stripRev, withOpId } from './store-merge.js';
import { pushArea, queueUserOp } from './store-queue.js';
import { DEFAULT_PIN, SESSION_KEY, family, familyStore, state, vars } from './store-state.js';
import { clearActiveUser, resetState, setActiveUser, syncNow } from './store-sync.js';

/**
 * Creates the VERY FIRST admin (only with an empty family) and signs them in directly.
 * Deliberately bypasses addMember's isAdmin() barrier because there is no
 * admin yet. The initial setup (login.js) calls this.
 */
export async function createFirstAdmin({ name, pin } = {}) {
  if ((family.members || []).length > 0) return null;   // only on an empty installation
  // The admin PIN is mandatory (since v3.20.0): 4–8 digits, not 0000.
  const problem = pinProblem(pin);
  if (problem) { vars.lastLoginErr = { code: 'weak', message: problem }; return null; }
  // Reconcile with the server before creating: if a family already exists there
  // (e.g. created on another device, or the pull had not yet gone
  // through at boot), do NOT create a second admin – that was a source of "duplicate users".
  if (isOnline()) {
    try { await syncFamily(); } catch { /* offline -> carry on locally */ }
    if ((family.members || []).length > 0) return null;
  }
  const id = uid('u');
  const p = String(pin);
  // The language of the setup becomes the instance default – written before the admin, so a
  // new instance is never mistaken for one set up before v4.0.0 (those default to German).
  if (!(family.settings || {}).language) {
    familyUpsert({ id: '__settings', _kind: 'settings', ...(family.settings || {}), language: locale() });
  }
  familyUpsert({
    id, _kind: 'member', name: (name || tr('account.admin')).trim(), role: 'admin',
    emoji: '🏃', color: '#18b48a', createdAt: nowIso(),
  }, { pinHash: pinHash(id, p) });
  if (isOnline()) { try { await pushFamily(); } catch { /* stays in the queue */ } }
  vars.identity = id;
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }   // stay signed in (survives reloads)
  // Server session for the new admin (for admin actions and private areas);
  // without a server connection it is caught up at the next sync.
  const r = isOnline() ? await serverLogin(id, p) : null;
  if (r && r.ok) vars.serverUser = id; else vars.pendingServerPin = { user: id, pin: p };
  rememberDevicePin(id, p);
  await setActiveUser(id);
  setProfile({ name: (name || tr('account.admin')).trim() });   // profile name = display name (greeting etc.)
  return id;
}

/** Fills the app with demo data: admin history + 1–2 demo members (admin only). */
export async function seedDemo(today = todayStr()) {
  if (!isAdmin()) return false;
  // Needed only for the initial setup – load only now instead of at every start (FE-19).
  const { buildDemo, completeDemoUnits, planPeriodSessions } = await import('./demo.js');
  const d = buildDemo(today);
  setProfile(d.profile);
  if (d.settings) for (const [k, v] of Object.entries(d.settings)) setSetting(k, v);
  replaceArea('events', d.self.events);
  replaceArea('sessions', d.self.sessions);
  replaceArea('health', d.self.health);
  if (d.self.nutrition) replaceArea('nutrition', d.self.nutrition);
  if (d.self.diary) replaceArea('diary', d.self.diary);
  if (d.self.cycle) replaceArea('cycle', d.self.cycle);
  if (d.self.checklist) replaceArea('checklist', d.self.checklist);
  if (d.self.shopping) replaceArea('shopping', d.self.shopping);
  if (d.self.labs) replaceArea('labs', d.self.labs);
  if (d.self.supplements) replaceArea('supplements', d.self.supplements);
  if (d.pantry) setFamilyPantry(d.pantry);  // shared pantry (shopping list deducts from it)

  // Generate a real, periodised plan (like a normal user) and backdate it so that
  // the current week + completed sessions are included (otherwise the plan start
  // would only be next week and "Today"/calendar would be empty).
  try {
    const { createPlanForEvent, generatePlanUnits, racePlanPhases } = await import('./plans.js');
    const { defaultCommitments, mkCommit } = await import('./commitments.js');
    const ev = d.self.events[0];
    const plan = createPlanForEvent(ev);
    const start = addDays(weekStart(today), -14);   // a new plan: it begins on the person's first day of the week
    const weeks = Math.max(plan.weeks, Math.ceil((diffDays(start, ev.date) + 1) / 7));
    const phases = racePlanPhases(weeks, start, ev.date, plan.raceDayJoinsTaper);
    // Fixed appointments of the demo: Mon/Wed football + Sunday matches from ~2 weeks on – shows
    // configurable appointments, date range and the weekly check (Sat long run → Sun match).
    const commitments = [...defaultCommitments(), mkCommit('match', 7, { fromDate: addDays(today, 12), durationMin: 120 })];
    let units = generatePlanUnits({ ...plan, startDate: start, weeks, phases, commitments }, ev, state.profile);
    units = units.map((u) => (u.date < today ? { ...u, status: 'erledigt' } : u));
    // Link demo workouts to the completed sessions (same day, same
    // sport) – otherwise they would appear twice in the calendar: as a session and as a free workout.
    const { linkDemoSessions } = await import('./planflow.js');
    const linked = linkDemoSessions(units, planPeriodSessions(d.self.sessions, start, today), today, ev.id);
    // Every other completed session (football too) gets a matching workout –
    // with duration and effort so that the load includes the fixed appointments.
    const completed = completeDemoUnits(linked.units, linked.sessions, today, ev.id);
    units = completed.units;
    replaceArea('sessions', completed.sessions);
    // v3.11.0: Pre-link mobility sessions with the most fitting exercises (by usage) –
    // makes the session↔exercise-catalogue link visible straight away in the demo.
    try {
      const { suggestedExercisesFor, sortByUsage } = await import('./exercises.js');
      const usage = exerciseUsage();
      units = units.map((u) => u.type === 'mobility'
        ? { ...u, exerciseIds: sortByUsage(suggestedExercisesFor(u.type), usage).slice(0, 2).map((e) => e.id) }
        : u);
    } catch { /* exercise link is optional */ }
    patch('plans', plan.id, { startDate: start, weeks, phases, commitments, units, generated: true });
  } catch { /* plan is optional */ }

  const nameToId = { __self__: vars.identity };
  // Put the demo members' ops durably into their queues first, then send: a
  // reload in the middle of sending then loses nothing (before: fire-and-forget).
  const jobs = [];
  for (const m of d.members) {
    const mem = await addMember({ name: m.name, role: m.role, emoji: m.emoji, color: m.color, pin: DEFAULT_PIN });
    if (!mem) continue;
    nameToId[m.name] = mem.id;
    for (const [area, records] of Object.entries(m.data)) {
      if (!Array.isArray(records) || !records.length) continue;
      writeUserArea(mem.id, area, records);
      queueUserOp(mem.id, area, { op: 'replace', records: records.map(stripRev) });
      jobs.push([mem.id, area]);
    }
    // Complete, individual member profile (object area, not an array).
    if (m.profile) {
      const prof = { id: 'profile', ...m.profile, updatedAt: nowIso() };
      writeUserArea(mem.id, 'profile', prof);
      queueUserOp(mem.id, 'profile', { op: 'upsert', record: stripRev(prof) });
      jobs.push([mem.id, 'profile']);
    }
  }
  if (isOnline()) await Promise.allSettled(jobs.map(([u, a]) => pushArea(a, u)));
  // Create teams (names → IDs; '__self__' = admin. Multiple memberships possible).
  for (const t of (d.teams || [])) {
    const memberIds = (t.memberNames || []).map((n) => nameToId[n]).filter(Boolean);
    addTeam({ name: t.name, emoji: t.emoji, color: t.color, memberIds });
  }
  if (isOnline()) { try { await syncNow(); } catch { /* ignore */ } }
  return true;
}

/**
 * Resets the app completely: all members + data (server & local) and
 * returns to the initial setup. Admin only. Irreversible.
 */
export async function resetApp() {
  if (!isAdmin()) return false;
  // The server first: the device starts over only once everything is gone there. Offline, or if
  // the server refuses a step, the device keeps its data and the caller says so (Settings).
  if (!isOnline() || !(await ping(REACH_TIMEOUT))) return false;
  vars.resetting = true;   // no sync meanwhile – a pending push used to recreate files after the deletion
  try {
    if (vars.syncRun) await vars.syncRun.catch(() => {});
    const ids = (family.members || []).map((m) => m.id);
    // The others first, the own person last: the server keeps the caller's session for that, and
    // the family is replaced with it afterwards (the session ends with it).
    for (const id of [...ids.filter((x) => x !== vars.identity), ...ids.filter((x) => x === vars.identity)]) {
      if (!(await deleteUserData(id))) return false;
    }
    const res = await pushOps('family', [withOpId({ op: 'replace', records: [] })], { scope: 'family' }).catch(() => null);
    if (!res || (res.rejected && res.rejected.length)) return false;
  } finally {
    vars.resetting = false;
  }
  // Discard local app storage – ONLY the keys of THIS environment (scopeKey prefix),
  // so that resetting the acceptance instance does not also wipe the storage of production
  // on the same origin.
  try {
    const prefix = scopeKey('');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  clearActiveUser();
  resetState();
  familyStore.records = {}; familyStore.rev = 0; vars.familyOps = []; rebuildFamily();
  return true;
}
