# Architecture

This document describes how Cat-O-Fit is built, for developers. For setup and workflow see
[DEVELOPMENT.md](DEVELOPMENT.md), for using the app see the [documentation](README.md).

## Principles

- **No dependencies, no build.** Vanilla JS (ES modules), CSS, lean PHP.
  What is in the repo runs directly in the browser.
- **Local-first.** Every change lands in LocalStorage immediately; a background sync
  writes it to the server. The app is fully usable offline.
- **No database.** Persistence is JSON files under `data/`.
- **Pure logic is DOM-free and testable.** Calculations live in modules without
  DOM access and are covered by `node:test`.
- **Privacy is part of the architecture.** The private areas – cycle (`cycle`), labs
  (`labs`) and supplements (`supplements`) – are strictly private: never on the team/family
  dashboard, never visible to admins, not in the full backup, and the server hands them out only
  to the signed-in person.
- **Texts live in catalogs, not in code.** Everything the user reads comes from
  `locales/<lang>/*.json` (see [Internationalisation (i18n)](#internationalisation-i18n)).

## Layers

```
┌────────────────────────────────────────────────────────────────┐
│  index.html  ·  App shell (PWA, iOS meta, loads js/app.js)     │
├────────────────────────────────────────────────────────────────┤
│  app.js · router.js        Bootstrap, hash routing, guard      │
├────────────────────────────────────────────────────────────────┤
│  View modules (render into the #view element)                  │
│  dashboard · calendar · events · plans · session · workout     │
│  dashboard-goals · dashboard-coach                             │
│  health · statistics · nutrition · shopping · checklist        │
│  cycle · labs-view · settings · family · family-admin          │
│  badges · reports · help (+ helpcontent) · login · capture     │
├────────────────────────────────────────────────────────────────┤
│  Pure logic (DOM-free, unit-tested)                            │
│  load · coach · fitness · vdot · plangen · planflow · program  │
│  energy · eligibility · labs · supplements · redflags · gpx    │
│  fit · zip · activity-import · strength · barcode              │
│  csv-export · workout-engine · sollist · helpcontent           │
│  labsources · nav · unit-actions …                             │
├────────────────────────────────────────────────────────────────┤
│  UI building blocks  ui.js (el, icons, helpers) · charts.js    │
├────────────────────────────────────────────────────────────────┤
│  Language            i18n.js (t, tp) · language.js · format.js │
│                      locales/<lang>/<area>.json                │
├────────────────────────────────────────────────────────────────┤
│  Data layer          storage.js (state, sync) · api-client     │
├────────────────────────────────────────────────────────────────┤
│  Backend (PHP)       api/api.php · storage.php · auth.php ·    │
│                      ics.php (+ icstz) · health-ingest/-map ·  │
│                      health-import/-xml · foodfacts.php ·      │
│                      read-access.php · i18n.php                │
├────────────────────────────────────────────────────────────────┤
│  Persistence         data/users/<id>/<area>.json               │
│                      data/family/<area>.json · data/auth/      │
└────────────────────────────────────────────────────────────────┘
```

## Routing & bootstrap

- `app.js` boots the app: it loads the **local** state, draws immediately and starts the sync
  in the background (since v3.20.0; before that the start waited for the server). It registers the
  routes, builds the tab bar, the More sheet and the sidebar, and sets the router guard.
- **Menu structure (`nav.js`, since v3.20.0):** `TAB_ITEMS` (Today · Calendar · ＋ Log ·
  Progress · More), `PROGRESS_TABS` (tabs over the routes `/stats`, `/health`, `/badges`,
  `/reports`), `MORE_GROUPS` (the grouped “More”), `navMatches()` (route → entry for the active
  highlight), `navVisible()` (modules, admin, managing) and `accountBlock()` (always the
  **signed-in** person; while managing, “now managing: …” together with “Back to me”).
  `capture.js` is the Log sheet; the forms still belong to their modules.
- `router.js` is a **hash router** (`#/path`). `register(path, handler)` binds a
  view, `setGuard(fn)` protects routes (e.g. forces login → `#/family`). Parameters such as
  `#/session/:id` are passed to the handler. A handler may return a promise: `app.js` loads rarely
  used views (help, labs, reports, import, team administration, workout) only on demand via `import()`.
- Views receive the `#view` element and fill it; the header is set via `setHeader(...)`
  (title, subtitle, back, actions – with `title` as tooltip).
- **Redraw instead of reload (since v3.20.0):** After saving, a view calls
  `refreshView()` or `goOrRefresh(hash)` (`ui.js`; the views use `rerenderView(render)` for this); `app.js` connects this to
  `router.refresh()`, which redraws the current route and keeps the scroll position.
  `location.reload()` remains only for app reset, restoring a backup, service-worker update and the
  diagnostics button (test `refresh.test.js`). The background sync reports only real
  content changes (`mergeRecords` → `{ changed, visible }`); it does not redraw when the
  device's own change comes back with a new `rev`.
- **Dialogs (`openSheet`):** named by their title (`aria-labelledby`), Escape closes, focus
  moves in and back to the trigger, the background is `inert`. Button groups sit in
  `field()` as a named group (not in `<label>`), segments are radio groups.
- **Sign-in gate (since v3.2.0, extended in v3.3.0):** Without a signed-in user only `#/login`
  is reachable and the menus are hidden (`body.is-anon`). The pure decision lives DOM-free in
  `js/session-gate.js` (`gate()`, `menusVisible()`, `needsSetup()`); `app.js` applies it in the guard and via
  `onAfterRender` (`applyAuthChrome`). **No auto-login** – nobody is signed in at start.
- **Login and dashboard separated (v3.3.0):** `js/login.js` (`/login`, signed out) shows either the
  **first-time setup** (empty family → `createFirstAdmin`, optionally `seedDemo`) or the **profile picker**.
  `js/family.js` (`/family`, menu “Team/family”) is the **signed-in team dashboard** with team badges
  (`js/teamstats.js`, DOM-free). Administration/reset live in the settings, admin only.

## Data layer (`storage.js`)

The heart of the app. It holds the state per **area** and takes care of LocalStorage,
sync and the multi-user context.

- **Areas (`AREAS`, 13):** `profile` (object) plus the list areas `events`, `plans`,
  `sessions`, `health`, `nutrition`, `diary`, `shopping`, `checklist`, `cycle`, `reports`, `labs`,
  `supplements` (`ARRAY_AREAS`). **Invariant:** `ARRAY_AREAS` = `AREAS` without `profile`. A new area
  must be entered in `storage.js`, in `api/storage.php` (`user_areas`) and in the load-test tools
  (`USER_AREAS`).
- **Sealed areas (`SEALED_AREAS`, e.g. `reports`):** append-only. `upsert/patch/
  remove` have no effect; the only way to write is `addReport()` – for certificates/reports
  that must stay unchangeable as proof.
- **Strictly private areas (`PRIVATE_AREAS` = `cycle`, `labs`, `supplements`):** never in the full backup,
  never visible to a managing admin, on the server only with a session of the same person.
- **CRUD:** `get/find/upsert/patch/remove/replaceArea`. Records carry an `id`; deletions
  are **tombstones** (`deleted: true`) for the sync.
- **Multi-user:** `identity` = signed-in person (remembered in `sessionStorage`: survives a
  reload, not closing the app; no auto-login), `activeUser` = the person currently viewed.
  If they differ, an admin is **managing** a member (`isManaging()`), and private data (cycle,
  labs, supplements) stays hidden. `login()` checks the PIN at the server (session, since v3.20.0) or,
  offline, against the device's check value, and sets `identity`; `logout()` ends the server session
  and discards the loaded store (with “Shared device” also the browser storage).
- **Family-wide data:** The `family` view (members, `pantry`, `settings`) is **derived** from the
  family records (`members/familyPantry/familySettings`); writes
  (`addMember/updateMember/removeMember/setFamilyPantry/setFamilySetting`) produce
  single ops (per-member merge, see below).
- **Personal backup:** `exportAll()` (with app identifier, version, profile reference) and
  `importAll()` (validates app/version/types, private areas are left out while managing).
  Backs up the data of the **active person** – including their private cycle data.
- **Admin full backup (emergency recovery):** `exportFamilyAll()` / `importFamilyAll()` (admin
  only). Bundles the family configuration (including **teams**, since v3.20.0) **and** all areas of
  every member – except the strictly private ones (`cycle`, `labs`, `supplements`). The restore
  sets the family and all contained member areas on the server and locally (via a **`replace` op**
  per user). Since v3.20.0 the `replace` op carries the server state at the time of restoring as `baseRev`:
  if it is sent later (offline), it does not overwrite newer entries. The
  restore waits for the server and reports areas that are still to be delivered
  (`pending`). Safeguard: the backup must contain at least one admin (no lock-out);
  private data is **left untouched**.

### Sync model (server-authoritative, since v3.0.0)

The **server is the merge authority** (option B). Clients send **operations** instead of
whole arrays; the server assigns each record a strictly monotonic **`rev`** and a
server timestamp. This removes the dependence on device clocks and whole-array races.

- `api-client.js` wraps **`pushOps(area, ops, {user|scope})`** and
  **`pullChanges(area, {user|scope, since})`**; `apiGet` returns only the logical view
  (backup/peek). The persistent **op queue** lives in the store (per user + area), not in the
  api-client.
- **Writing:** `upsert/patch/remove/replaceArea` change the state optimistically and put
  an op (`upsert`/`delete`/`replace`) into the queue. **Deletions** are tombstones.
- **Sync per area:** **first PUSH own ops** (local edits get a `rev`), **then PULL
  changes since the known `rev`**. On a pull, a record wins only if the
  server `rev` is higher → concurrent edits to **different** records are never
  lost; for the **same** record, the write that reached the server last wins, deterministically.
- **Pull marker only from the pull (since v3.20.0):** The response to a push carries the
  **global** area `rev`. Adopting it as the marker would skip other people's changes
  (second device, health ingest) in between – the marker `revs[area]` therefore
  advances only through a pull.
- **Queue without silent loss (since v3.20.0):** Every op carries an `opId`; ops that were sent
  are removed from the queue by identity, not by count. Ops are sent in chunks
  of at most 500 (server limit 2000 per request; on `413` the client halves the chunk).
  Queue and area are written together or rolled back together – if the device storage is full,
  the app reports it (`catofit:storage-full`) instead of keeping data only
  in memory. Several tabs merge their queues via the `storage` event.
- **Server `rev` going backwards:** If the server `rev` is smaller than the own marker (server
  restored from a backup), a **conservative full reconcile** follows: the
  server version wins with an equal or newer `updatedAt`, anything newer locally stays and
  is sent again, nothing is deleted locally. In addition, every device reconciles each area without
  open ops completely once a week.
- **Switch safety (multi-user):** `syncNow()` **pins the user** per run
  (in-flight guard, a single follow-up run); `pushArea` is **bound to the user**, runs
  at most once at a time per user and area, and writes that user's ops per user
  (even after a view switch). The data of a managed member is removed from the
  device storage when switching back; open ops remain and are sent afterwards.
- **Bulk sync (since v3.21.0):** The `ping` names the server's features (`features`,
  `serverHas()`); `API_VERSION` stays 1. With `changes-all`, a run first sends the open
  ops and then fetches the changes of **all** areas of a person with one request
  (`pullAllChanges(user, since)`, `since` as `area:rev` pairs) – instead of one per area. Private
  areas without their own session are reported by the server as `locked`. With `ops-since`, even the
  response to a push brings the changes since the own marker (`pushOps(area, ops, {since})`
  → `changes`); the marker advances this way just as with a pull. The client serves older servers as
  before; the weekly full reconcile remains the single-area path (test `sync-bulk.test.js`).
- **Family merge per record:** The family is a collection of records – one per
  member, plus `__settings` and `__pantry`. Members therefore merge **per
  member**: if two admins each add a member on two devices at the same time, **both** are kept
  (previously the whole-object LWW could silently lose one).
- **Private areas only with the person's own server session (since v3.20.0):** The client syncs `cycle`, `labs` and
  `supplements` only if the server session belongs to the signed-in person
  (`privateAllowed`); otherwise their ops stay in the queue and the app asks once for the PIN
  (`catofit:session-required`). The server enforces the same (`api/auth.php`).
- **Local persistence:** `catofit:<user>:<area>` (records), `catofit:<user>:__meta`
  (`{revs, ops}`), `catofit:familyStore` (`{rev, records, ops}`, without PIN hashes – only `hasPin`),
  `pinLocal`/`deviceSalt` (check values for the offline sign-in). The sign-in lives only in
  `sessionStorage` (no auto-login); a possibly old `catofit:identity` is discarded at start.

## Internationalisation (i18n)

The app speaks seven languages (`locales/languages.json`: en, de, fr, es, it, pt-BR, nl) without a
library. English is the source language; the other catalogs follow its keys.

- **`js/i18n.js` – core.** Catalogs are nested JSON objects with dot keys, `{name}` placeholders
  and plurals as `key.one` / `key.other` (plus the other `Intl.PluralRules` categories where a
  language needs them). `t(key, params)` returns a text; `tp(key, count, params)` picks the plural
  form and fills `{count}`, formatted for the language; `tList`, `has`, `hasOwnText` and `tVariants`
  cover lists (weekday names), existence checks and text that may have been written in either
  language. **Lookup order: active language → English → the key itself** (an unknown key comes
  back unchanged, so a gap is visible rather than empty). `setLocale(lang)` loads the catalogs, sets
  `<html lang>` and notifies the `onLocaleChange` listeners; `matchLanguage(tags)` maps BCP-47
  tags to a supported language (`de-AT` → `de`, `pt` → `pt-BR`).
- **`js/language.js` – which language is shown.** Order: the signed-in person's choice
  (`settings.language`) → the instance default (family setting `language`) → German for instances
  set up before v4.0.0 (they already have members and were German-only) → the browser language →
  English. While an admin manages another member, the admin's own language stays.
  `applyLanguage()` runs before the first render and again when profile or family data change
  through the sync (e.g. a language picked on another device); `translateStatic()` fills the fixed
  texts of `index.html` (`data-i18n`, `data-i18n-aria`, title, description).
- **`js/format.js` – dates and numbers.** Weekday and month names and the date patterns come from
  the catalog (`format.*` in `ui.json`), so every browser shows exactly the same text; `Intl` only
  fills in when a catalog entry is missing. Number separators come from `Intl`; units stay metric.
- **Catalogs `locales/<lang>/<area>.json`.** `ui.json` (everything on screen) is loaded at start.
  Bigger areas are loaded on demand with `loadArea(area)` for the active language and for English
  (`LAZY_AREAS` in `js/i18n.js`: `help`, `exercises`, `workouts`, `recipes`, `health`; catalogs
  exist today for `help`, `exercises` and `recipes`). A key whose first segment names such an area is
  looked up there (`help.loadForm.title` → `help.json`, key `loadForm.title`); every other key lives
  in `ui.json`, whose top-level sections therefore never use an area name. A new language needs a
  catalog folder and one entry in `locales/languages.json`, no code. `locales/GLOSSARY.md` keeps the
  translations consistent, `locales/REVIEW.md` tracks the review state per language.
- **Offline.** The service worker caches `locales/languages.json` and the `ui`, `exercises`, `help`
  and `recipes` catalogs of every listed language, so a language switch also works offline.
- **Server side – `api/i18n.php`.** Text the server writes into results itself (calendar files,
  import titles) comes from `locales/<lang>/server.json`: `server_text($lang, $key, $params)` with
  the same fallback as the app (language → English → key), `server_number()` for the decimal
  separator. `person_language($userId)` follows the order of the app, except that the browser
  language only counts there: the person's own choice (`settings.language` in the profile) → the
  instance default (`language` in the family `__settings`) → German if the instance already has
  members → English. It is used by `ics.php` (labels, reminders, file name), `health-ingest.php`,
  `health-import.php` / `health-map.php` (titles of imported activities) and `foodfacts.php`
  (language of the Open Food Facts query).
- **Error messages.** The server's `error` text is English and every error carries a stable
  `code`. The app translates the code: `serverError(json, fallback)` in `api-client.js` looks up
  `server.<code>` in `ui.json` and fills its placeholders from the other fields of the response
  (for rejected family ops, from `{op, id, code, reason}`); an unknown code falls back to the
  English text. See [API.md](API.md).
- **Stored data stay as written.** Plan texts written before v4.0.0 are German;
  `js/exercise-terms-de.js` only recognises the exercises in them, the names shown come from the
  catalogs.
- **Guard rails.** `test/i18n-catalog.test.js` checks that every language has the same keys,
  placeholders and plural forms as English, that every key used in code exists and no catalog key
  goes unused, and that translated modules contain no hard-coded German text (a short list of
  matching vocabularies is exempt).

## Training plans: two generators

- **Competition:** The generator lives purely in `plangen.js` (periodisation `makePhases`, week skeletons per
  sport and running days, volume model `volumeConfig`/`weekVolumes`, units `buildWeekUnits`,
  race week by day distance, readiness check `planReadiness`). `plans.js` connects store,
  training history and paces: `createPlanForEvent(event, { level, daysPerWeek, commitments })` and
  `updatePlanFromToday` (new from today, the past unchanged via `planflow.mergeFromDate`). The
  paces come from `vdot.planPaces` (target time + form) and are stored per plan in `plan.paces`; every
  running unit carries its zone key `paceKey`. `plan.gen` marks the generator version.
- **Programme** (`program.js`): `createProgramPlan(program, today)` creates a weekly plan without a
  competition (fitness/strength/weight loss/mobility) with endurance-minute progression and strength days.
- Both deliver **the same plan/unit format** (`planId`, `date`, `type`, `targetDurationMin`,
  `description`, paces …). Programme units of older versions (`dur`/`desc`) are converted by
  `program.migratePlan` on reading (`store.get('plans')`). The two are told apart by `plan.kind === 'program'`.
- **Distance-specific:** `distanceEmphasis(raceKm)` (plangen.js) controls the key sessions per
  distance (5 km → short VO₂max stimuli, marathon → threshold/race pace …).
- **Workout mode:** `workout-engine.js` builds the phases (warm-up, efforts, rests, cool-down;
  distances via the target pace) and advances them by real time (`advance`); `workout-mode.js` is the view.
- **Planned vs. actual:** `sollist.js compareToPlan` (easy units two-sided, structured ones without an average verdict).

## Adaptive coach & other modules (DOM-free and tested)

Pure logic in argument-based, testable modules; the views only consume it:

- **planflow.js:** adaptive suggestions – among others `weekVolumeBalance` (automatic weekly volume balancing)
  and `rpeProgression` (progression control from the RPE trend). Surfaced as coach cards in `dashboard.js`
  (with an apply action via `saveUnitPatch`).
- **load.js:** the ONLY source for load verdicts – `sessionLoad`/`sessionRpe`/`loadMinutes` (sRPE,
  RPE 1–10 clamped, duration logged → distance → planned → 30 min), **load ratio** (ACWR decoupled:
  7 days vs. days 8–28), **CTL/ATL/TSB** (Banister/PMC, `formState` relative to CTL, rated from 90 days)
  and **monotony/strain** (Foster, only with a week above the person's own average). `fitness.js` passes the
  load functions on for existing imports. Dashboard card “Load & form” (`charts.js multiLineChart`).
  If the person's own rating is missing, `sessionRpeInfo` estimates the effort from heart rate (`rpeFromHr`;
  reference: max HR from the profile, set by `app.js` via `useHrReference`) – only as an input value,
  hard session types never below their default; `planflow.rpeAskList` then asks for it.
- **coach.js:** the ONE daily recommendation for “Today” (`coachDecision`, fixed priority: return to training →
  rest day → easier today → after football → unload → de-stack → catch up → balance volume →
  progress; `coachWhy` for the reasoning). Uses `rolling`, `planflow`, `triage`, `load` – the cards themselves are
  built by `dashboard.js`.
- **fitness.js:** shared definitions for all views – `adherence` (plan adherence), `runKm`
  (running km), `isHealthMiss`; statistics traffic light (`planStatus`) on `load.acwr`.
- **hrzones.js:** HR zones (% HRmax, Karvonen or from the threshold HR after Friel, `method: 'lthr'`) and
  HRmax estimate from age (Tanaka).
- **commitments.js:** fixed appointments – configurable football days (days/duration/**intensity**) + recurring
  matches with a date range; the generator (`plans.js`) plans **around** them. From “normal” on, football counts as
  demanding (`fitness.footballRpe`, `planflow.isHard`), goes fully into the load and relieves the following day.
- **rolling.js:** rolling planning – automatic rest day from the load; `gentleVariant`
  (type-aware easing) and `footballFollowupEase`. With two goals, the suggestion takes back the **whole day**
  (`planflow.dayLoadUnits`); `triage.destackSuggestion` spreads stacks onto a free day.
- **adapt.js:** central apply/undo core (`applyAdapt`/`undoAdapt`) with the transparency log `plan.adaptLog`
  – used by dashboard cards **and** `cycle.js` (easing the first period day only on request). The
  log stores the changed fields; `undoUnits` restores only open units and only those fields.
- **triage.js + whatif.js:** week check (prioritising collisions: fixed appointments → key runs → strength
  → volume) and what-if preview of the effect on the weekly load before adding/moving something.
- **dualgoal.js:** goal cockpit (half-marathon performance + weight loss) with a phase-dependent focus,
  deficit recommendation (nutrition coupling) and an honest stimulus check.
- **teamstats.js:** team/family aggregation (DOM-free) – figures per team via `filterTeamMembers`/
  `teamlessMembers`; teams are `_kind:'team'` records in `family.json` with multiple membership
  (`MAX_MEMBERS = 32` since v3.13.0 — a deliberate upper limit of the trust-based model: family/small
  team with PIN login instead of real auth, an admin manages/“opens” everyone, team aggregation on the client. This
  carries comfortably up to about 32 members (a large household plus friends, or a club with sub-teams). Beyond that it becomes an
  **organisation** — which needs real authentication, binding privacy boundaries and scalable
  aggregation; this change of model is planned for **v5.0.0**, see `docs/ROADMAP.md`).
- **goals.js:** dedicated health/weight goals (`goalProgress`/`goalsProgress`/`latestMetric`),
  stored in `profile.settings.healthGoals`; progress card on “Today”, management in `settings.js`.
- **unit-actions.js (since v3.21.1):** actions on planned units without a UI – `findUnit`,
  `saveUnitPatch`, `completeUnit`, `linkSession`, `nextFreeDay`, reasons for missed sessions. Used by Today,
  Calendar, Plan, workout mode and import; `session.js` re-exports the names.
- **“Today” in three modules (since v3.21.1):** `dashboard.js` (layout, training, load & form),
  `dashboard-goals.js` (goal cockpit, weekly and health goals) and `dashboard-coach.js` (the
  coach cards including apply/undo and the follow-up questions). The decision is made by `coach.js`.
- **exercises.js + exercise-art.js:** exercise library – catalogue + filter (DOM-free) and still images for
  tiles. View at `#/uebungen`.
- **Animated exercises (since v3.22.0):** `exercise-motions.js` (movement sequences as data),
  `motion-rig.js` (joint figure with inverse kinematics, pure), `motion-figure.js` (SVG still and
  animation) and `motion-player.js` (preview and “follow along” with sets, beat, cues and rests).
- **Follow along throughout (since v3.23.0):** `coach-figure.js` (the lead exerciser), `show-program.js`
  (plan text → programme → timeline in beat, pure), `workout-show.js` (full-screen session),
  `music.js` (training music, generated live), `audio.js` (unlocking, tones, announcements, wake lock) and
  `workouts.js` (ready-made workouts).
- **Activities from files (since v3.21.0):** `gpx.js` (GPX/TCX → `buildActivity`: splits, time in
  HR zones, elevation gain with 3 m hysteresis, simplified route – Douglas-Peucker down to at most 150
  points, encoded as a polyline), `fit.js` (binary FIT: definitions, compressed timestamps, both
  byte orders, sports), `zip.js` (ZIP directory and gzip via `DecompressionStream`, with
  upper limits) and `activity-import.js` (`activitiesFrom` for whole exports including ZIP in ZIP,
  `sameActivity` against duplicates, `guessType`). Everything runs in the browser; `health-import.js`
  saves in a single write, routes only on request (`settings.activityRoutes`).
  `charts.js routeMap` draws route and elevation profile without a map service.
- **strength.js:** strength sets (repetitions × kg), volume, last sets per exercise and
  an increase hint (double progression); recorded in workout mode, stored as
  `strengthSets` on the unit.
- **barcode.js:** check digit (GTIN) and portion from the values per 100 g; lookups go through
  `api/foodfacts.php` and only with “Fill in nutrition values online” (`store.foodLookupEnabled()`).
- **csv-export.js:** tables for sessions, body values, labs and food diary (semicolon,
  decimal comma, BOM, protection against formulas in cells).
- **teamstats.js `teamLoad`:** coach view – load and wellbeing only of the people with
  `shareLoad`, each with their own max HR as reference.

## Backend (PHP)

Deliberately minimal, but the **merge authority** since v3.0.0 – only persistence, op application and
two imports/exports:

- `api/api.php` – routing: `?action=changes` (GET, incremental records from the `since` rev),
  `?action=ops` (POST `{ops:[…]}`, applies `upsert`/`delete`/`replace`), `?area=` (GET,
  logical view for debug/`.ics`), plus `ping`, `delete-user`, `ics`, `health-import`,
  `health-ingest`, since v3.20.0 `login`, `logout`, `session`, `set-pin`, `ics-token` and since
  v3.21.0 `changes-all` (all areas of a person in one response) and `read` (read access).
  `ping` names the features (`features`: `changes-all`, `ops-since`).
  `userId` whitelist (`^[A-Za-z0-9_-]{1,64}$`), record-ID whitelist, writing calls only as
  JSON and not from other sites, optional host list. Errors come as `{ok: false, error, code}` –
  `error` in English, `code` stable (translated by the app, see
  [Internationalisation](#internationalisation-i18n)). Overview and guarantees:
  [API.md](API.md).
- `api/auth.php` – server session after the PIN check (cookie, lock after failed attempts), lock on the
  private areas, family rules (`family_guard`: admin session for members/roles/replace,
  PIN hashes never in responses), calendar key per member.
- `api/storage.php` – store format `{rev, records:{id→record}}` per area. `apply_ops()` runs
  under an exclusive lock, assigns each op a **monotonic `rev`** + server timestamp and writes
  **atomically** (temp file → `rename`). `changes_since()` returns all records with `rev>since`.
  An **unreadable** file (permissions, I/O) aborts with an error instead of counting as an empty area;
  `replace` knows the optional `baseRev` (newer records stay).
  Tested without a server: `php tools/test-storage.php`.
  **Migration** (old → store) happens deterministically on first read; `ensure_bootstrap()`
  migrates existing **legacy single-user data** to the first admin – but on a **fresh**
  installation (from v3.3.0) it no longer creates **anyone** automatically (empty family → first-time setup in the client).
- `api/i18n.php` – texts the server writes itself (calendar files, import titles) from
  `locales/<lang>/server.json`; `person_language()` picks the language of a person (see
  [Internationalisation](#internationalisation-i18n)).
- `api/ics.php` – `.ics` calendar export (RFC 5545, VALARM) per user, in the language of the person; the
  time zone comes from `api/icstz.php` (`CATOFIT_TZ`/`TZ`, otherwise Europe/Berlin – byte-identical to before for Berlin; test
  `php tools/test-ics.php`).
- `api/health-ingest.php` + `api/health-map.php` – automatic health intake (key per person):
  packages from Health Auto Export (`hi_parse`), the lean daily format of a Shortcuts template
  (`hi_parse_simple`, also with workouts) or Health Connect records of an Android bridge
  (`hi_parse_hcw`, timestamps in the time zone of the instance); period starts become cycle
  entries. Pure conversion in `health-map.php` (test `php tools/test-health-ingest.php`).
- `api/health-import.php` + `api/health-xml.php` – full import of the Apple Health export
  (XMLReader streaming; all assignable sports through the same table as the intake, periods;
  pure conversion in `health-xml.php`, test `php tools/test-health-xml.php`).
- `api/foodfacts.php` – optional nutrition search at Open Food Facts (server side, cache
  `data/foodfacts.json`), by name or – since v3.21.0 – by barcode (`?code=`, check digit
  before every request); the query language comes from the app (`lc`, `cc`), else from the instance.
- `api/read-access.php` – read access for your own tools (since v3.21.0): key per person
  (`profile.readToken`, sensible only as a header), read-only and only the shared
  areas – never `cycle`, `labs`, `supplements`, never keys from the profile.
- `tools/reset-pin.php` – emergency command-line tool (forgotten admin PIN), never via the web.

`data/.htaccess` (Deny from all) protects the JSON files from direct web access;
runtime folders (`data/users`, `data/family`, `data/auth`, `.bootstrap.lock`) are in `.gitignore`.

## Project structure

```
cat-o-fit/
  index.html              App shell (PWA, Apple meta tags, no inline scripts)
  manifest.webmanifest    PWA manifest
  service-worker.js       Offline shell (network-first, from the cache after 3 s)
  api/                    PHP backend (see “Backend”)
  data/                   JSON data (only .htaccess in the repo; runtime folders git-ignored)
  css/                    style, cards, dashboard, calendar, session, workout-mode, family, report, responsive
  js/                     app, router, storage, api-client, ui, charts, nav, i18n, language, format + view and logic modules
  locales/                Translation catalogs: <lang>/{ui,help,exercises,recipes,server}.json, languages.json
  assets/icons/           App icons (SVG + PNG)
  docs/                   Documentation (map: docs/README.md), images under docs/assets
  test/                   node:test tests (*.test.js), mini DOM in test-setup.js
  tools/                  PHP tests, load test, demo seeds (tools/seed), render script, reset-pin.php
  Dockerfile, docker/     Image (Apache + PHP, amd64/arm64), entrypoint, Apache/PHP configuration
  .github/workflows/      ci.yml (tests) + docker.yml (image to GHCR)
```

## Service worker & PWA

- `service-worker.js` caches the **app shell** (`SHELL_ASSETS`, including the app icons) – network-first
  with revalidation. If the server does not answer within **3 s**, the app starts from the cache; the
  late response refreshes it anyway (since v3.20.0). When publishing a change, raise
  `VERSION` (the cache name). New modules belong in `SHELL_ASSETS` (test `sw-assets.test.js`) –
  including those loaded on demand. The translation catalogs are cached on install (see
  [Internationalisation](#internationalisation-i18n)).
- **Start without a server (since v3.20.0):** `store.init()` waits for the member list for at most 6 s, and only on a
  brand-new device (no family locally yet); otherwise the sync runs in the
  background. Every sync and the server sign-in first ask via `ping` (2.5 s) whether the
  server answers – otherwise the run counts as offline, instead of letting 13 areas run
  into timeouts one after another. `syncNow()` waits for a sync that is already running. The start-up
  diagnosis (`boot-check.js`) appears only on a real error and disappears if the app starts after all.
- **Colours & contrast (`contrast.js`):** computes, per accent and theme, the text on the accent
  (`--accent-contrast`), the accent as text (`--accent-text`, `--accent-strong`) and the end of the
  hero gradients – each with ≥ 4.5:1 (WCAG AA). Status colours have fixed text variants
  (`--good-text` etc.) in `style.css`; charts are coloured via CSS classes, so a switch between light and dark
  takes effect immediately.
- **Single source of truth** for the app version: `js/version.js` (in parallel `package.json`).

## Tests

`node:test` (no third-party runner). `test-setup.js` provides a dependency-free
**mini DOM** and a `localStorage` shim, so that both pure logic and whole
`render()` functions can be tested. See `test/*.test.js` and
[DEVELOPMENT.md](DEVELOPMENT.md#tests).
