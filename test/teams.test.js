import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { filterTeamMembers, teamlessMembers, teamMonthKm } from '../js/teamstats.js';

// Fresh family (admin + members) before each test – saveFamily also cleans up teams.
beforeEach(async () => {
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Robin', role: 'admin' },
    { id: 'u-2', name: 'Max', role: 'user' },
    { id: 'u-3', name: 'Henriette', role: 'admin' },
    { id: 'u-4', name: 'Horst', role: 'user' },
    { id: 'u-5', name: 'Lea', role: 'user' },
  ] });
  await store.login('u-1', '');
});

test('addTeam / teams / teamMembers resolved', () => {
  const t = store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-2'] });
  assert.ok(t && t.id);
  assert.equal(store.teams().length, 1);
  assert.deepEqual(store.teamMembers(t.id).map((m) => m.name).sort(), ['Max', 'Robin']);
});

test('Multiple membership: Henriette in two teams', () => {
  store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-3'] });
  store.addTeam({ name: 'Blau', memberIds: ['u-5', 'u-3'] });
  const th = store.teamsOf('u-3');
  assert.equal(th.length, 2);
  assert.deepEqual(th.map((t) => t.name).sort(), ['Blau', 'Rot']);
});

test('Team switch: setMemberTeams moves a member', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2'] });
  const blau = store.addTeam({ name: 'Blau', memberIds: [] });
  store.setMemberTeams('u-2', [blau.id]);      // from Rot to Blau
  assert.deepEqual(store.teamMembers(rot.id).map((m) => m.id), []);
  assert.deepEqual(store.teamMembers(blau.id).map((m) => m.id), ['u-2']);
  assert.deepEqual(store.teamsOf('u-2').map((t) => t.name), ['Blau']);
});

test('setMemberTeams: multiple assignment and removal', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: [] });
  const blau = store.addTeam({ name: 'Blau', memberIds: [] });
  store.setMemberTeams('u-3', [rot.id, blau.id]);
  assert.equal(store.teamsOf('u-3').length, 2);
  store.setMemberTeams('u-3', [rot.id]);
  assert.deepEqual(store.teamsOf('u-3').map((t) => t.name), ['Rot']);
  store.setMemberTeams('u-3', []);
  assert.equal(store.teamsOf('u-3').length, 0);
});

test('removeMember cleans up team memberships (no ghosts)', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2', 'u-4'] });
  store.removeMember('u-4');
  assert.deepEqual(store.teamMembers(rot.id).map((m) => m.id), ['u-2']);
});

test('removeTeam removes the team', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2'] });
  assert.equal(store.removeTeam(rot.id), true);
  assert.equal(store.teams().length, 0);
});

test('teamlessMembers: who is in no team (Horst)', () => {
  store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-2'] });
  store.addTeam({ name: 'Blau', memberIds: ['u-3', 'u-5'] });
  const teamless = teamlessMembers(store.members(), store.teams());
  assert.deepEqual(teamless.map((m) => m.name), ['Horst']);
});

test('Aggregation per team: kilometres cleanly separated', () => {
  const today = '2026-07-15';
  const members = [
    { id: 'u-1', sessions: [{ date: '2026-07-10', distanceKm: 10 }] },
    { id: 'u-2', sessions: [{ date: '2026-07-11', distanceKm: 20 }] },
    { id: 'u-3', sessions: [{ date: '2026-07-12', distanceKm: 5 }] },
  ];
  const rot = teamMonthKm(filterTeamMembers(members, { memberIds: ['u-1', 'u-2'] }), today);
  const blau = teamMonthKm(filterTeamMembers(members, { memberIds: ['u-3'] }), today);
  assert.equal(rot.km, 30);
  assert.equal(blau.km, 5);
});

test('only admins may manage teams', async () => {
  store.addTeam({ name: 'Rot', memberIds: [] });
  await store.login('u-2', '');       // u-2 is a user
  const before = store.teams().length;
  const t = store.addTeam({ name: 'Heimlich', memberIds: [] });
  assert.equal(t, null);
  assert.equal(store.teams().length, before);
});
