/* =========================================================================
   storage.js — central "local-first" store (server-authoritative, v3.0.0).

   Model (option B):
   - Write locally and optimistically (immediately, offline-capable) and put every
     change into a persistent queue as an OPERATION (upsert/delete/replace).
   - The SERVER is the merge authority: it applies ops and assigns a strictly
     monotonic `rev` per record (no dependence on the device clock).
   - Sync per area: first PUSH our own ops (so that local edits get a rev), then
     PULL the changes since the known rev. A pull only wins if the server `rev`
     is higher – concurrent edits to different records are never lost.
   - Deletions are tombstones (deleted:true) with their own rev.
   - The family is a collection of records (member per id, __settings,
     __pantry) -> members merge PER MEMBER (no more silent loss).

   The public store API stays unchanged -> views need no adjustment.

   Since 4.2 the store lives in parts (js/store-*.js); this file is its only door: views and
   tests import `* as store` from here, the parts import each other.
   ========================================================================= */

export {
  AREAS, ARRAY_AREAS, DEFAULT_PIN, MAX_MEMBERS,
} from './store-state.js';
export {
  isSharedDevice, onSync, setSharedDevice,
} from './store-local.js';
export {
  serverSessionActive,
} from './store-session.js';
export {
  activeMember, activeUserId, familyPantry, familySettings, getFamily, identityId, identityMember, isAdmin, isManaging, isViewingSelf, members, refreshFamily, saveFamily, serverWasReset, setFamilyPantry,
} from './store-family.js';
export {
  addReport, areaAllowed, bumpExerciseUsage, exerciseUsage, find, foodLookupEnabled, get, getRaw, patch, profile, profileFetched, remove, replaceArea, setProfile, setSetting, settings, upsert, upsertMany,
} from './store-data.js';
export {
  clearActiveUser, init, logout, setActiveUser, syncNow,
} from './store-sync.js';
export {
  lastLoginError, login, memberHasPin, pinIsWeak, pinProblem, reauth, setMemberPin,
} from './store-auth.js';
export {
  addMember, addTeam, backToSelf, enterMember, removeMember, removeTeam, setFamilySetting, setMemberTeams, teamMembers, teams, teamsOf, updateMember, updateTeam,
} from './store-members.js';
export {
  exportAll, exportFamilyAll, importAll, importFamilyAll, peekUserArea,
} from './store-backup.js';
export {
  createFirstAdmin, resetApp, seedDemo,
} from './store-setup.js';
