/* Season planning (since 4.2): B and C races inside the plan of an A race are built into that plan –
   at creation and when it is recalculated from today, never silently; a race with its own plan stays
   there; existing plans keep their sessions until the person recalculates. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import {
  createPlanForEvent, updatePlanFromToday, ensureGenerated, sideRaceCandidates, sideRaceStatus, sideRacesChanged, hostPlanFor,
} from '../js/plans.js';

const TODAY = '2027-01-04';   // Monday
const FAMILY = { members: [{ id: 'u-1', name: 'Robin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' }], settings: {}, pantry: [], teams: [] };
const A = { id: 'ev-a', name: 'Spring Half', date: '2027-04-04', distanceKm: 21.0975, priority: 'A', sport: 'run', status: 'geplant' };
const B = { id: 'ev-b', name: 'City 10k', date: '2027-02-28', distanceKm: 10, priority: 'B', sport: 'run', status: 'geplant' };
const C = { id: 'ev-c', name: 'Parkrun', date: '2027-02-06', distanceKm: 5, priority: 'C', sport: 'run', status: 'geplant' };

const plan = () => store.get('plans').find((p) => p.eventId === A.id);
const raceUnits = (p, id) => (p.units || []).filter((u) => u.type === 'race' && u.eventId === id);

beforeEach(async () => {
  localStorage.__setQuota(Infinity);
  localStorage.clear();
  const srv = globalThis.__fakeServer.install();
  srv.opts.features = ['changes-all', 'ops-since', 'merge-ops'];
  store.clearActiveUser();
  store.saveFamily(FAMILY);
  await store.login('u-1', '');
  await store.syncNow();
});
afterEach(() => { store.clearActiveUser(); });

test('a new plan for an A race builds in the B race inside its window', () => {
  store.upsertMany('events', [A, B]);
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  const p = plan();
  assert.deepEqual(p.sideRaces.map((r) => [r.eventId, r.priority, r.date]), [[B.id, 'B', B.date]]);
  const race = raceUnits(p, B.id);
  assert.equal(race.length, 1);
  assert.equal(race[0].date, B.date);
  assert.equal(race[0].sideRace, 'B');
  assert.equal(race[0].title, B.name);
  assert.equal(raceUnits(p, A.id).length, 1, 'the main race stays');
  const eve = p.units.filter((u) => u.date === '2027-02-27');
  assert.deepEqual(eve.map((u) => u.type), ['recovery'], 'shakeout the day before');
  assert.equal(sideRaceStatus(B).state, 'built');
  assert.equal(sideRacesChanged(p, A, TODAY), false);
});

test('a C race added later: the plan shows it, builds it in only when recalculated from today', () => {
  store.upsertMany('events', [A, B]);
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  const before = JSON.stringify(plan().units.map((u) => [u.date, u.type, u.targetDistanceKm]));
  store.upsert('events', C);
  ensureGenerated();
  assert.equal(JSON.stringify(plan().units.map((u) => [u.date, u.type, u.targetDistanceKm])), before, 'nothing changes by itself');
  assert.equal(sideRacesChanged(plan(), A, TODAY), true);
  assert.equal(sideRaceStatus(C).state, 'pending');
  updatePlanFromToday(plan(), A, { today: TODAY });
  const p = plan();
  assert.equal(raceUnits(p, C.id).length, 1);
  assert.equal(sideRaceStatus(C).state, 'built');
  const week = p.units.filter((u) => u.week === raceUnits(p, C.id)[0].week);
  assert.ok(!week.some((u) => (u.type === 'tempo' || u.type === 'interval') && !u.fixed), 'the C race is the quality session of its week');
  assert.equal(sideRacesChanged(p, A, TODAY), false);
  // Deleting it again: the plan offers the recalculation.
  store.remove('events', C.id);
  assert.equal(sideRacesChanged(plan(), A, TODAY), true);
});

test('a B race with a plan of its own is never built in a second time', () => {
  store.upsertMany('events', [A, B]);
  createPlanForEvent(B, { today: TODAY, daysPerWeek: 4 });
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  assert.deepEqual(plan().sideRaces, []);
  assert.equal(raceUnits(plan(), B.id).length, 0);
  assert.equal(hostPlanFor(B), null);
});

test('no side races for a plan whose own race is B or C, nor for triathlon; longer than 25 km stays out', () => {
  const p = { id: 'x', startDate: '2027-01-11', endDate: A.date, sport: 'run' };
  assert.deepEqual(sideRaceCandidates(p, { ...A, priority: 'B' }, [B, C], []), []);
  assert.deepEqual(sideRaceCandidates({ ...p, sport: 'triathlon' }, { ...A, sport: 'triathlon' }, [B, C], []), []);
  assert.deepEqual(sideRaceCandidates(p, A, [{ ...B, sport: 'triathlon' }], []), []);
  const M = { ...B, id: 'ev-m', distanceKm: 42.195 };
  store.upsertMany('events', [A, M]);
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  assert.equal(raceUnits(plan(), M.id).length, 0);
  assert.equal(sideRaceStatus(M).state, 'long');
});

test('a C race the day before a B race: only the B race is built in, the C race says why', () => {
  const C2 = { ...C, id: 'ev-c2', date: '2027-02-27' };
  store.upsertMany('events', [A, B, C2]);
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  assert.equal(raceUnits(plan(), B.id).length, 1);
  assert.equal(raceUnits(plan(), C2.id).length, 0);
  const st = sideRaceStatus(C2);
  assert.equal(st.state, 'clash');
  assert.equal(st.view.other, B.name);
});

test('a plan from before 4.2 keeps its sessions; the race shows up as pending', () => {
  store.upsertMany('events', [A, B]);
  createPlanForEvent(A, { today: TODAY, daysPerWeek: 4 });
  const { sideRaces, ...legacy } = plan();
  const units = legacy.units.filter((u) => u.eventId !== B.id || u.type !== 'race');
  store.upsert('plans', { ...legacy, units });
  ensureGenerated();
  assert.equal(raceUnits(plan(), B.id).length, 0);
  assert.equal(sideRaceStatus(B).state, 'pending');
  assert.equal(sideRacesChanged(plan(), A, TODAY), true);
});
