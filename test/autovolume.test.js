/* Automatic volume adjustment of the plan week (js/autovolume.js, apply in js/adapt.js).
   Only downwards, at most −15 %, once per plan week, only the easy running volume – and
   in the app only after plans and sessions came from the server in this session. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoVolumeDecision, autoVolumeSignals, autoVolumeVariant, combineFactors, lastWeekShare, AUTO_VOLUME_FLOOR,
} from '../js/autovolume.js';
import { weekDeloadCandidates } from '../js/planflow.js';
import { addDays } from '../js/ui.js';
import * as store from '../js/storage.js';
import { ensureAutoVolume, undoAdapt, applyAdapt, canUndo } from '../js/adapt.js';
import { gentleVariant } from '../js/rolling.js';

const START = '2026-10-05';   // Monday; week 7 = 16.–22.11. (load and form count from the fifth week on)
const TUE3 = '2026-11-17';

/** Plan with nine weeks: Tue easy 8 · Wed strength · Thu tempo 8 · Sat long 14 · Sun football (fixed). */
function buildPlan({ weeks = 9, extra = [] } = {}) {
  const units = [];
  let n = 0;
  const add = (date, type, km, more = {}) => units.push({
    id: `u${++n}`, planId: 'p1', date, week: null, phase: 'base', type, title: type === 'long' ? `Long Run ${km} km` : type,
    targetDistanceKm: km, targetDurationMin: km ? null : 45, status: 'geplant', ...more,
  });
  for (let w = 0; w < weeks; w++) {
    const mon = addDays(START, w * 7);
    add(addDays(mon, 1), 'easy', 8);
    add(addDays(mon, 2), 'strength', null);
    add(addDays(mon, 3), 'tempo', 8, { intervals: { rounds: 4 } });
    add(addDays(mon, 5), 'long', 14);
    add(addDays(mon, 6), 'cross_football', null, { fixed: true });
  }
  units.push(...extra);
  return {
    id: 'p1', eventId: 'e1', startDate: START, endDate: addDays(START, weeks * 7 - 1), weeks, units, adaptLog: [],
  };
}

/** Daily runs: 40 min before the last week, `acuteMin` in the last 7 days, RPE `rpe`, `km` per run. */
function buildSessions(today, { acuteMin = 40, rpe = 5, km = 7, days = 35 } = {}) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    const date = addDays(today, -i);
    const min = i <= 6 ? acuteMin : 40;
    out.push({ id: `s${i}`, date, type: 'easy', durationSec: min * 60, distanceKm: km, rpe });
  }
  return out;
}

test('load ratio above 1.3 shortens the easy runs of the current plan week by 10 %', () => {
  const plan = buildPlan({ extra: [{ id: 'own', planId: 'p1', date: '2026-11-20', type: 'easy', targetDistanceKm: 6, status: 'geplant', manual: true }] });
  const sessions = buildSessions(TUE3, { acuteMin: 66 });
  const d = autoVolumeDecision({ plan, sessions, today: TUE3 });
  assert.ok(d, 'a decision');
  assert.deepEqual(d.signals.map((s) => s.key), ['load']);
  assert.equal(d.factor, 0.9);
  assert.equal(d.week, 7);
  const byId = Object.fromEntries(plan.units.map((u) => [u.id, u]));
  assert.deepEqual(d.unitIds.map((id) => byId[id].type).sort(), ['easy', 'long'], 'only easy and long runs');
  assert.ok(d.unitIds.every((id) => byId[id].date >= '2026-11-17' && byId[id].date <= '2026-11-22'), 'only this plan week');
  assert.ok(!d.unitIds.includes('own'), 'the person\'s own session stays');
  assert.equal(d.beforeKm, 22);
  assert.equal(d.afterKm, 19.5);   // 8 → 7, 14 → 12.5
});

test('the session that is already past or done stays as it is', () => {
  const plan = buildPlan();
  const tue = plan.units.find((u) => u.date === TUE3 && u.type === 'easy');
  tue.status = 'erledigt';
  const d = autoVolumeDecision({ plan, sessions: buildSessions('2026-11-18', { acuteMin: 66 }), today: '2026-11-18' });
  assert.ok(d);
  assert.ok(!d.unitIds.includes(tue.id));
  assert.equal(d.unitIds.length, 1, 'only the long run of Saturday');
});

test('no adjustment without a signal, in the first week, twice per week, for programmes', () => {
  const calm = buildSessions(TUE3);
  assert.equal(autoVolumeDecision({ plan: buildPlan(), sessions: calm, today: TUE3 }), null, 'ratio 1.0, last week fully run');
  const hot = buildSessions('2026-10-07', { acuteMin: 66 });
  assert.equal(autoVolumeDecision({ plan: buildPlan(), sessions: hot, today: '2026-10-07' }), null, 'first plan week');
  const sessions = buildSessions(TUE3, { acuteMin: 66 });
  assert.equal(autoVolumeDecision({ plan: { ...buildPlan(), autoVolume: { week: 7, factor: 0.9 } }, sessions, today: TUE3 }), null, 'already adjusted this week');
  assert.ok(autoVolumeDecision({ plan: { ...buildPlan(), autoVolume: { week: 6, factor: 0.9 } }, sessions, today: TUE3 }), 'a new week may be adjusted again');
  // Load ratio and form are measured against the plan's own ratio: only after four plan weeks.
  assert.equal(autoVolumeDecision({ plan: { ...buildPlan(), startDate: '2026-10-26' }, sessions, today: TUE3 }), null, 'plan in its fourth week');
  assert.equal(autoVolumeDecision({ plan: { ...buildPlan(), kind: 'program' }, sessions, today: TUE3 }), null, 'programmes');
});

test('weeks that are lighter by plan are left alone: taper, race week, deload', () => {
  const sessions = buildSessions(TUE3, { acuteMin: 66 });
  const taper = buildPlan();
  taper.units.forEach((u) => { if (u.date >= '2026-11-16' && u.date <= '2026-11-22') u.phase = 'taper'; });
  assert.equal(autoVolumeDecision({ plan: taper, sessions, today: TUE3 }), null, 'taper');
  const race = buildPlan({ extra: [{ id: 'race', planId: 'p1', date: '2026-11-22', type: 'race', targetDistanceKm: 21.1, status: 'geplant' }] });
  assert.equal(autoVolumeDecision({ plan: race, sessions, today: TUE3 }), null, 'race week');
  const deload = buildPlan();
  deload.units.forEach((u) => { if (u.date >= '2026-11-16' && u.date <= '2026-11-22' && u.type === 'long') u.targetDistanceKm = 10; });
  assert.equal(autoVolumeDecision({ plan: deload, sessions, today: TUE3 }), null, 'week planned clearly lighter than the one before');
});

test('a plan from before 4.2 (sessions without a phase): a taper week is recognised by its lower volume', () => {
  const strip = (p) => ({ ...p, units: p.units.map(({ phase, ...u }) => u) });
  const sessions = buildSessions(TUE3, { acuteMin: 66 });
  assert.ok(autoVolumeDecision({ plan: strip(buildPlan()), sessions, today: TUE3 }), 'an ordinary week is adjusted');
  const taper = buildPlan();
  taper.units.forEach((u) => { if (u.date >= '2026-11-16' && u.date <= '2026-11-22' && u.targetDistanceKm) u.targetDistanceKm *= 0.7; });
  assert.equal(autoVolumeDecision({ plan: strip(taper), sessions, today: TUE3 }), null, 'the taper week stays');
});

test('last week more than half missed → −15 %, but only once every run of it is settled', () => {
  const plan = buildPlan();
  const week2 = plan.units.filter((u) => u.date >= '2026-11-09' && u.date <= '2026-11-15');
  const status = { easy: 'erledigt', tempo: 'verpasst', long: 'verpasst', strength: 'erledigt' };
  week2.forEach((u) => { if (status[u.type]) u.status = status[u.type]; });
  const calm = buildSessions(TUE3);
  const sig = autoVolumeSignals({ plan, sessions: calm, today: TUE3, weekStart: '2026-11-16' });
  assert.deepEqual(sig.map((s) => [s.key, s.factor]), [['completion', 0.85]]);
  assert.equal(sig[0].value, 27, '8 of 30 km');
  assert.equal(lastWeekShare(plan, '2026-11-16').toFixed(2), '0.27');
  // The long run of Sunday is still open (Monday's import has not arrived yet): no verdict.
  week2.find((u) => u.type === 'long').status = 'geplant';
  assert.equal(lastWeekShare(plan, '2026-11-16'), null);
  assert.equal(autoVolumeDecision({ plan, sessions: calm, today: TUE3 }), null);
  // Only the long run missed (14 of 30 km) → −10 %; only the tempo run (8 of 30) → nothing.
  week2.find((u) => u.type === 'long').status = 'verpasst';
  week2.find((u) => u.type === 'tempo').status = 'erledigt';
  assert.deepEqual(autoVolumeSignals({ plan, sessions: calm, today: TUE3, weekStart: '2026-11-16' }).map((s) => [s.key, s.factor, s.value]),
    [['completion', 0.9, 53]]);
  week2.find((u) => u.type === 'long').status = 'erledigt';
  week2.find((u) => u.type === 'tempo').status = 'verpasst';
  assert.deepEqual(autoVolumeSignals({ plan, sessions: calm, today: TUE3, weekStart: '2026-11-16' }), []);
});

test('effort consistently very high → −10 %', () => {
  const plan = buildPlan();
  const hard = buildSessions(TUE3, { rpe: 8 });
  const d = autoVolumeDecision({ plan, sessions: hard, today: TUE3 });
  assert.deepEqual(d.signals.map((s) => s.key), ['effort']);
  assert.equal(d.factor, 0.9);
});

test('signals multiply, never below −15 %', () => {
  assert.equal(combineFactors([{ factor: 0.9 }]), 0.9);
  assert.equal(combineFactors([{ factor: 0.9 }, { factor: 0.9 }]), AUTO_VOLUME_FLOOR);
  assert.equal(combineFactors([{ factor: 0.85 }, { factor: 0.85 }, { factor: 0.9 }]), AUTO_VOLUME_FLOOR);
  const d = autoVolumeDecision({ plan: buildPlan(), sessions: buildSessions(TUE3, { acuteMin: 66, rpe: 8 }), today: TUE3 });
  assert.deepEqual(d.signals.map((s) => s.key).sort(), ['effort', 'load']);
  assert.equal(d.factor, 0.85);
});

test('the shortened session: half kilometres, at least 3 km, the title follows', () => {
  assert.deepEqual(autoVolumeVariant({ targetDistanceKm: 14, title: 'Long Run 14 km' }, 0.9),
    { autoVolume: 0.9, targetDistanceKm: 12.5, title: 'Long Run 12,5 km' });
  assert.equal(autoVolumeVariant({ targetDistanceKm: 3.5 }, 0.85).targetDistanceKm, 3);
  assert.equal(autoVolumeVariant({ targetDurationMin: 40 }, 0.9).targetDurationMin, 35);
  const p = autoVolumeVariant({ targetDistanceKm: 8, title: 'Lockerer Lauf' }, 0.9);
  assert.equal(p.title, undefined, 'a title without a distance stays');
});

test('the coach does not offer the shortened sessions for a deload or boost again', () => {
  const units = [
    { id: 'a', date: TUE3, type: 'easy', status: 'geplant', autoVolume: 0.9 },
    { id: 'b', date: '2026-11-19', type: 'tempo', status: 'geplant' },
  ];
  assert.deepEqual(weekDeloadCandidates(units, TUE3).map((u) => u.id), ['b']);
});

/* ------------------------------- In the app ------------------------------- */

const FAMILY = {
  members: [
    { id: 'u-1', name: 'Robin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'u-2', name: 'Kim', role: 'member', createdAt: '2026-01-01T00:00:00Z' },
  ],
  settings: {}, pantry: [], teams: [],
};

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  const srv = globalThis.__fakeServer.install();
  srv.opts.features = ['changes-all', 'ops-since', 'merge-ops'];
  store.clearActiveUser();
  store.saveFamily(FAMILY);
  await store.login('u-1', '');
  await store.syncNow();
  store.upsert('plans', buildPlan());
  store.upsertMany('sessions', buildSessions(TUE3, { acuteMin: 66 }));
  await store.syncNow();
});
afterEach(() => { store.clearActiveUser(); });

test('app: waits until plans and sessions came from the server in this session', async () => {
  // A new start without a connection: the local state of last time, nothing fetched yet.
  const srv = globalThis.__fakeServer;
  store.clearActiveUser();
  srv.opts.offline = true;
  assert.equal(await store.login('u-1', ''), true, 'offline sign-in');
  await store.syncNow();
  assert.equal(store.find('plans', 'p1').units.length > 0, true, 'the plan is there locally');
  assert.equal(store.areaFetched('plans'), false);
  assert.equal(ensureAutoVolume(TUE3), 0, 'no write before the fetch');
  assert.equal(store.find('plans', 'p1').adaptLog.length, 0);
  srv.opts.offline = false;
  await store.syncNow();
  assert.equal(store.areaFetched('plans'), true);
  assert.equal(store.areaFetched('sessions'), true);
  assert.equal(store.profileFetched(), true, 'the switch came from the server too');
  assert.equal(ensureAutoVolume(TUE3), 1);
});

test('app: shortens once per week, logs it and can be undone', async () => {
  assert.equal(ensureAutoVolume(TUE3), 1);
  const plan = store.find('plans', 'p1');
  const long = plan.units.find((u) => u.date === '2026-11-21');
  assert.equal(long.targetDistanceKm, 12.5);
  assert.equal(long.title, 'Long Run 12,5 km');
  assert.equal(plan.units.find((u) => u.date === '2026-11-19').intervals.rounds, 4, 'the tempo session keeps its stimulus');
  assert.deepEqual(plan.autoVolume, { week: 7, factor: 0.9, date: TUE3 });
  const entry = plan.adaptLog[0];
  assert.equal(entry.kind, 'autovolume');
  assert.match(entry.title, /−10 %/);
  assert.match(entry.reason, /^Belastung: Verhältnis 1,\d\d – die ruhigen Läufe dieser Woche sind kürzer: 19,5 km statt 22 km\.$/);
  assert.equal(ensureAutoVolume(TUE3), 0, 'once per plan week');
  assert.equal(ensureAutoVolume('2026-11-19'), 0, 'also later in the same week');

  const res = undoAdapt('p1', entry.id);
  assert.equal(res.restored, 2);
  const after = store.find('plans', 'p1');
  const back = after.units.find((u) => u.date === '2026-11-21');
  assert.equal(back.targetDistanceKm, 14);
  assert.equal(back.title, 'Long Run 14 km');
  assert.equal(back.autoVolume, undefined);
  assert.equal(ensureAutoVolume(TUE3), 0, 'undone means: not again this week');
  // The plan goes to the server as one change.
  await store.syncNow();
  const srvPlan = globalThis.__fakeServer.store('plans', { user: 'u-1' }).records.p1;
  assert.equal(srvPlan.autoVolume.week, 7);
});

test('app: undoing the automatic cut leaves a session that a newer adjustment changed again', () => {
  assert.equal(ensureAutoVolume(TUE3), 1);
  const auto = store.find('plans', 'p1').adaptLog[0];
  const longId = store.find('plans', 'p1').units.find((u) => u.date === '2026-11-21').id;
  // Then the coach's recovery day lands on the shortened long run.
  applyAdapt('p1', [longId], (u) => gentleVariant(u, { title: 'Erholungstag', description: '' }), { kind: 'rest', title: 'Erholungstag', reason: '' });
  const rested = store.find('plans', 'p1').units.find((u) => u.id === longId);
  assert.notEqual(rested.type, 'long');
  assert.equal(canUndo(store.find('plans', 'p1').units, auto, store.find('plans', 'p1').adaptLog), true, 'the easy run can still go back');
  const res = undoAdapt('p1', auto.id);
  assert.deepEqual([res.restored, res.skipped], [1, 1]);
  const after = store.find('plans', 'p1').units;
  assert.deepEqual(after.find((u) => u.id === longId), rested, 'the recovery day stays as it is');
  assert.equal(after.find((u) => u.date === TUE3 && u.type === 'easy').targetDistanceKm, 8);
  // Undoing the recovery day brings back the shortened long run – consistent.
  const rest = store.find('plans', 'p1').adaptLog[0];
  undoAdapt('p1', rest.id);
  const back = store.find('plans', 'p1').units.find((u) => u.id === longId);
  assert.deepEqual([back.type, back.targetDistanceKm, back.title], ['long', 12.5, 'Long Run 12,5 km']);
});

test('app: not with the setting off, not while managing another person', async () => {
  store.setSetting('autoVolume', false);
  assert.equal(ensureAutoVolume(TUE3), 0);
  store.setSetting('autoVolume', true);
  await store.setActiveUser('u-2');
  await store.syncNow();
  store.upsert('plans', buildPlan());
  store.upsertMany('sessions', buildSessions(TUE3, { acuteMin: 66 }));
  assert.equal(store.isManaging(), true);
  assert.equal(ensureAutoVolume(TUE3), 0);
});
