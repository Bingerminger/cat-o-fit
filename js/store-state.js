/* =========================================================================
   store-state.js — the store's shared state: areas, device-storage keys, the in-memory data of the
   active person and the family, and `vars`, the module variables the store parts reassign.
   Layer 0: imports no other part.
   Part of the store behind js/storage.js – import the store from there, not from this file.
   ========================================================================= */

import { scopeKey } from './ui.js';

/** Module variables the store parts reassign (one object, so every module sees the same value). */
export const vars = {
  identity: null,            // signed-in person (roles + cycle privacy)
  activeUser: null,          // user currently being viewed (controls the data display)
  // Server session (since v3.20.0): the server only hands out the private areas to the
  // signed-in person themself. `serverUser` = the person for whom this browser, to our
  // knowledge, has a valid session.
  serverUser: null,
  pendingServerPin: null,    // after an offline sign-in: catch up on the server later
  sessionAsked: false,       // PIN prompt without a server session: once per page load
  lastLoginErr: null,
  revs: {},                  // area -> last seen server rev (high-water mark)
  pendingOps: {},            // area -> pending ops of the active user
  familyOps: [],
  syncState: 'idle',         // idle | syncing | offline | error
  storageFullAt: 0,
  profileFetchedFor: null,   // whose profile came from the server in this session (store-data profileFetched)
  fetchedFor: {},            // area -> whose area came from the server in this session (store-data areaFetched)
  syncRun: null,             // running sync (promise)
  syncPending: false,        // requested again during the run -> one more round
  // "Reset the app" is deleting on the server: no sync and no push may run in between.
  resetting: false,
  serverReset: false,        // an empty (newly set up or reset) server was seen (store-family)
  familyPushInflight: null,
};

export const AREAS = ['profile', 'events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
export const ARRAY_AREAS = ['events', 'plans', 'sessions', 'health', 'nutrition', 'diary', 'shopping', 'checklist', 'cycle', 'reports', 'labs', 'supplements'];
// Sealed areas: append-only, cannot be edited or deleted (e.g. certificates/reports).
export const SEALED_AREAS = ['reports'];
// All keys are environment-unique (scopeKey), so that production and acceptance on the
// same origin do NOT share their storage (otherwise "duplicate users").
export const IDENTITY_KEY = scopeKey('identity');  // LEGACY (before v3.2.0): permanently remembered user – is only discarded now
export const SESSION_KEY = scopeKey('session');    // Sign-in of THIS browser session (sessionStorage): survives reloads, not an app restart
export const FAMILY_STORE_LS = scopeKey('familyStore');

export const LS = (area) => scopeKey(`${vars.activeUser}:${area}`);

export const state = {
  profile: {},
  events: [], plans: [], sessions: [], health: [],
  nutrition: [], shopping: [], checklist: [], cycle: [], reports: [], diary: [],
  labs: [], supplements: [],
};

// Family as a record store + derived view.
export const familyStore = { rev: 0, records: {} };
export const family = { members: [], settings: {}, pantry: [] };

export const syncListeners = new Set();
// opIds that this tab has taken out of the queue (confirmed, compacted), and ops that
// it has taken over from another tab.
export const retired = new Set();
export const adopted = new Set();

// The server accepts at most 2000 ops per request. Sending happens in chunks; after
// each confirmed chunk the queue is shortened. A 413 halves the chunk size.
export const PUSH_CHUNK = 500;
// Strictly private: never hand out/export when managing other members.
// `labs`/`supplements` are health data within the meaning of Art. 9 GDPR and are
// therefore treated exactly like the cycle – even admins do not see them, and they
// stay out of the full family backup (the personal backup contains them).
export const PRIVATE_AREAS = ['cycle', 'labs', 'supplements'];

// Check value of this device for signing in without a server – only for people who have
// already signed in here once with a server connection (own salt per device).
export const DEVICE_SALT_KEY = scopeKey('deviceSalt');
export const PIN_LOCAL_KEY = scopeKey('pinLocal');

// Notice "default PIN not yet changed" (per browser session).
export const WEAK_PIN_KEY = scopeKey('weakPin');

export const MAX_MEMBERS = 32;
export const DEFAULT_PIN = '0000';
