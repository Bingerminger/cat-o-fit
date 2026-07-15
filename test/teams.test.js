import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { filterTeamMembers, teamlessMembers, teamMonthKm } from '../js/teamstats.js';

// Frische Familie (Admin + Mitglieder) vor jedem Test – saveFamily räumt Teams mit auf.
beforeEach(async () => {
  store.saveFamily({ members: [
    { id: 'u-1', name: 'Nora', role: 'admin' },
    { id: 'u-2', name: 'Max', role: 'user' },
    { id: 'u-3', name: 'Henriette', role: 'admin' },
    { id: 'u-4', name: 'Horst', role: 'user' },
    { id: 'u-5', name: 'Lea', role: 'user' },
  ] });
  await store.login('u-1', '');
});

test('addTeam / teams / teamMembers aufgelöst', () => {
  const t = store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-2'] });
  assert.ok(t && t.id);
  assert.equal(store.teams().length, 1);
  assert.deepEqual(store.teamMembers(t.id).map((m) => m.name).sort(), ['Max', 'Nora']);
});

test('Mehrfach-Mitgliedschaft: Henriette in zwei Teams', () => {
  store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-3'] });
  store.addTeam({ name: 'Blau', memberIds: ['u-5', 'u-3'] });
  const th = store.teamsOf('u-3');
  assert.equal(th.length, 2);
  assert.deepEqual(th.map((t) => t.name).sort(), ['Blau', 'Rot']);
});

test('Teamwechsel: setMemberTeams verschiebt ein Mitglied', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2'] });
  const blau = store.addTeam({ name: 'Blau', memberIds: [] });
  store.setMemberTeams('u-2', [blau.id]);      // von Rot nach Blau
  assert.deepEqual(store.teamMembers(rot.id).map((m) => m.id), []);
  assert.deepEqual(store.teamMembers(blau.id).map((m) => m.id), ['u-2']);
  assert.deepEqual(store.teamsOf('u-2').map((t) => t.name), ['Blau']);
});

test('setMemberTeams: Mehrfach-Zuordnung und Entfernen', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: [] });
  const blau = store.addTeam({ name: 'Blau', memberIds: [] });
  store.setMemberTeams('u-3', [rot.id, blau.id]);
  assert.equal(store.teamsOf('u-3').length, 2);
  store.setMemberTeams('u-3', [rot.id]);
  assert.deepEqual(store.teamsOf('u-3').map((t) => t.name), ['Rot']);
  store.setMemberTeams('u-3', []);
  assert.equal(store.teamsOf('u-3').length, 0);
});

test('removeMember räumt Team-Mitgliedschaften auf (keine Geister)', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2', 'u-4'] });
  store.removeMember('u-4');
  assert.deepEqual(store.teamMembers(rot.id).map((m) => m.id), ['u-2']);
});

test('removeTeam entfernt das Team', () => {
  const rot = store.addTeam({ name: 'Rot', memberIds: ['u-2'] });
  assert.equal(store.removeTeam(rot.id), true);
  assert.equal(store.teams().length, 0);
});

test('teamlessMembers: wer in keinem Team ist (Horst)', () => {
  store.addTeam({ name: 'Rot', memberIds: ['u-1', 'u-2'] });
  store.addTeam({ name: 'Blau', memberIds: ['u-3', 'u-5'] });
  const teamless = teamlessMembers(store.members(), store.teams());
  assert.deepEqual(teamless.map((m) => m.name), ['Horst']);
});

test('Aggregation je Team: Kilometer sauber getrennt', () => {
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

test('nur Admins dürfen Teams verwalten', async () => {
  store.addTeam({ name: 'Rot', memberIds: [] });
  await store.login('u-2', '');       // u-2 ist user
  const before = store.teams().length;
  const t = store.addTeam({ name: 'Heimlich', memberIds: [] });
  assert.equal(t, null);
  assert.equal(store.teams().length, before);
});
