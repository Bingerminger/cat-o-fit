/* =========================================================================
   store-members.js — co-management, members and teams (admin actions). Layer 9.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { nowIso, scopeKey, uid } from './ui.js';
import { t as tr } from './i18n.js';
import { deleteUserData } from './api-client.js';
import { pinHash } from './store-auth.js';
import { familyDelete, familyUpsert, isAdmin } from './store-family.js';
import { userMetaKey } from './store-local.js';
import { AREAS, DEFAULT_PIN, MAX_MEMBERS, family, vars } from './store-state.js';
import { setActiveUser } from './store-sync.js';

export async function enterMember(userId) {
  if (!isAdmin() || !userId) return false;
  await setActiveUser(userId);
  return true;
}
export async function backToSelf() {
  if (vars.identity) await setActiveUser(vars.identity);
}

export async function addMember({ name, role = 'user', emoji = '🙂', color = '#3d8bff', pin = DEFAULT_PIN } = {}) {
  if (!isAdmin()) return null;
  if ((family.members || []).length >= MAX_MEMBERS) return null;
  const id = uid('u');
  // Start PIN (default 0000): the hash goes only to the server, which accepts it from an
  // admin session; locally only `hasPin` is stored.
  familyUpsert({
    id, _kind: 'member', name: (name || tr('account.member')).trim(),
    role: role === 'admin' ? 'admin' : 'user', emoji, color, createdAt: nowIso(),
  }, { pinHash: pinHash(id, (pin || DEFAULT_PIN)) });
  return (family.members || []).find((m) => m.id === id) || null;
}

export function updateMember(userId, fields) {
  if (!isAdmin()) return;
  const m = (family.members || []).find((x) => x.id === userId);
  if (!m) return;
  familyUpsert({
    ...m, _kind: 'member', ...fields,
    role: (fields.role ?? m.role) === 'admin' ? 'admin' : 'user',
  });
}

export function removeMember(userId) {
  if (!isAdmin()) return false;
  const list = family.members || [];
  const target = list.find((m) => m.id === userId);
  if (!target) return false;
  if (target.role === 'admin' && list.filter((m) => m.role === 'admin').length <= 1) return false;
  familyDelete(userId);
  // Remove from all teams so that no "ghost members" remain in teams.
  (family.teams || []).forEach((t) => {
    if ((t.memberIds || []).includes(userId)) familyUpsert({ ...t, _kind: 'team', memberIds: (t.memberIds || []).filter((x) => x !== userId) });
  });
  if (vars.activeUser === userId) backToSelf();
  deleteUserData(userId);
  AREAS.forEach((a) => { try { localStorage.removeItem(scopeKey(`${userId}:${a}`)); } catch { /* ignore */ } });
  try { localStorage.removeItem(userMetaKey(userId)); } catch { /* ignore */ }
  return true;
}

export function setFamilySetting(key, value) {
  if (!isAdmin()) return;
  familyUpsert({ id: '__settings', _kind: 'settings', ...(family.settings || {}), [key]: value });
}

/** All teams (subgroups of the family; a member can be in several). */
export function teams() { return family.teams || []; }
/** Teams of which `memberId` is a member. */
export function teamsOf(memberId) { return (family.teams || []).filter((t) => (t.memberIds || []).includes(memberId)); }
/** Resolved members of a team (in the family's creation order). */
export function teamMembers(teamId) {
  const t = (family.teams || []).find((x) => x.id === teamId);
  if (!t) return [];
  const ids = new Set(t.memberIds || []);
  return (family.members || []).filter((m) => ids.has(m.id));
}

export function addTeam({ name, emoji = '👥', color = '#3d8bff', memberIds = [] } = {}) {
  if (!isAdmin()) return null;
  const id = uid('t');
  familyUpsert({ id, _kind: 'team', name: (name || tr('storage.defaultTeam')).trim(), emoji, color, memberIds: [...new Set(memberIds)], createdAt: nowIso() });
  return (family.teams || []).find((t) => t.id === id) || null;
}
export function updateTeam(teamId, fields = {}) {
  if (!isAdmin()) return;
  const t = (family.teams || []).find((x) => x.id === teamId);
  if (!t) return;
  const memberIds = fields.memberIds !== undefined ? [...new Set(fields.memberIds)] : t.memberIds;
  familyUpsert({ ...t, _kind: 'team', ...fields, memberIds });
}
export function removeTeam(teamId) {
  if (!isAdmin()) return false;
  if (!(family.teams || []).some((t) => t.id === teamId)) return false;
  familyDelete(teamId);
  return true;
}
/** Sets EXACTLY the team membership of a member (assignment & team change;
    multiple memberships allowed). Updates only the affected teams. */
export function setMemberTeams(memberId, teamIds = []) {
  if (!isAdmin()) return;
  const want = new Set(teamIds);
  (family.teams || []).forEach((t) => {
    const has = (t.memberIds || []).includes(memberId);
    const should = want.has(t.id);
    if (has === should) return;
    const memberIds = should ? [...(t.memberIds || []), memberId] : (t.memberIds || []).filter((x) => x !== memberId);
    familyUpsert({ ...t, _kind: 'team', memberIds: [...new Set(memberIds)] });
  });
}
