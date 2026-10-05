# Development

Practical guide to working on Cat-O-Fit locally. Architecture background in
[ARCHITECTURE.md](ARCHITECTURE.md), contribution etiquette in
[../CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements

- **Node.js ≥ 22** – only for the tests (not a runtime dependency of the app; `node --test` with a glob pattern needs Node 21+, CI checks 22 and 24).
- **PHP ≥ 8.1** – for the backend (persistence, sign-in, `.ics`, health import; storage needs `fsync`, which only exists from 8.1). For browsing the
  frontend alone any static server will do, but without PHP nothing can be saved.

There is **no** `npm install` – `package.json` only holds the test script.

## Running locally

```bash
git clone https://github.com/Bingerminger/cat-o-fit.git
cd cat-o-fit

# Option A: full (frontend + PHP backend)
php -S localhost:8000
# -> open http://localhost:8000

# Option B: tests only
npm test
```

With an empty `data/` (as it ships in the repo, containing only a `.htaccess`) the app starts in
**first-time setup** (create an admin with their own PIN, optionally demo data). For an instance in
the old format there are developer seeds under `tools/seed/` (generated with `tools/gen-demo-seeds.mjs`):
`cp tools/seed/*.json data/` before the first start – `ensure_bootstrap()` then migrates them to the
first admin `u-1` **without a PIN** (use locally only). The runtime folders (`data/users`,
`data/family`, `data/auth`) are in `.gitignore`.

### Clean state / reset

```bash
# Reset the server runtime data (afterwards the app is back in first-time setup)
rm -rf data/users data/family data/auth data/.bootstrap.lock data/*.json
```

In the browser also run `localStorage.clear()` and, if necessary, empty the service-worker cache
(DevTools → Application → Storage) so that the fresh shell is loaded.

## Tests

```bash
npm test     # node --import ./test-setup.js --test "test/**/*.test.js"
```

- Runner: the built-in **`node:test`**.
- `test-setup.js` provides a **mini DOM** and a `localStorage` shim (no jsdom). With it, both pure
  logic tests and view render tests (`test/views.test.js`) run in Node.
- Put new logic in a DOM-free module and test it under `test/<module>.test.js`.
- **Sync against a protocol-faithful test server (since v3.20.0):** `globalThis.__fakeServer.install()`
  replaces `fetch` with an in-memory server that reproduces `apply_ops` (global area `rev`,
  tombstones, `replace` with `baseRev`, 2000-op limit → `413`). Knobs via `srv.opts`:
  `latencyMs` (a number or a function per request), `offline`, `failStatus`, `failWhen`, `opLimit`;
  `srv.requests` logs every request, `srv.store(area, {user|scope})` shows the server state.
  Opt-in: without `install()` the simple success mock stays active. Example: `test/sync-integrity.test.js`.
- **Full device storage:** `localStorage.__setQuota(n)` limits the shim to `n` characters
  (`setItem` then throws `QuotaExceededError`), `localStorage.__used()` returns the fill level.
- **PHP API over HTTP:** `php tools/test-api.php` starts its own PHP test server on a copy of `api/`
  with an empty temporary data directory and checks sign-in/session, private areas, protection against
  foreign sites, family rules, PIN rules and the lockout after failed attempts, calendar keys,
  health-import limits, the health intake in the Shortcuts format, `tools/reset-pin.php` and the
  host list.
- **PHP tests without a server:** `php tools/test-health-ingest.php` (Apple Health mapping incl.
  the daily format), `php tools/test-health-xml.php` (full import), `php tools/test-ics.php`
  (calendar time zone) and `php tools/test-storage.php` (persistence: unreadable/empty/corrupt file,
  `replace` with `baseRev`; works on a copy of `storage.php` in a temporary directory).
- **Documentation tests:** `test/docs.test.js` checks links and anchors of all Markdown files, image
  references, the numbers quoted in the docs and README, version equality (version.js, package.json,
  CHANGELOG) and the help links; `test/help-context.test.js` checks the help articles,
  `test/ui-texts.test.js` the terms and number format of the views.
- A **GitHub Actions CI** (`.github/workflows/ci.yml`) runs the tests on every push
  and pull request.

### Testing the PHP API in isolation (without touching real data)

The `node:test` suite mocks `fetch` – the **real** PHP side (`apply_ops`/`changes`/`load_area`/
`ics`/`health-import`) is best checked against an isolated server with its own `data/`.
`DATA_DIR` is fixed to `__DIR__/../data`, so use a copy of the app:

```bash
QA=$(mktemp -d)
rsync -a --exclude='.git/' --exclude='node_modules/' --exclude='/data/' ./ "$QA/"
mkdir "$QA/data"                                  # empty, isolated data directory
php -S 127.0.0.1:8077 -t "$QA" &
curl "http://127.0.0.1:8077/api/api.php?action=ping"
```

This lets you play through ops, `.ics` generation (against `?action=ics&scope=event&id=…&user=u-1`),
parallel access (flock) and the health import **without** changing real data. Before destructive
tests against `data/`, always take a snapshot and restore it afterwards.

## Load test & performance

Verifies that the file-based persistence (`flock` + atomic temp→`rename`) **stays data-intact under
parallel load** and that the latencies are usable. Important: `php -S` is single-threaded by
default – real flock contention only shows with several workers (`PHP_CLI_SERVER_WORKERS`).

**Method:** an isolated app copy with an empty `data/`, 8-worker PHP, load generator `tools/loadtest.py`
(python3 stdlib, `ThreadPoolExecutor`): 10 users, a parallel mix of **write** (single upsert),
**read** (`changes`), **backup** (read all areas) and **import** (`replace` with N records).
Integrity checked: no lost updates, `rev` unique, JSON on disk valid, user isolation,
import consistency. Output as a table. The soak run checks the writes by **sets of IDs** (every acknowledged
ID is on the server, and nothing is there that was never sent) instead of by a counter total – under load
a request can reach the server whose response never reaches the client.

```bash
QA=scratch/lt-app
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='scratch' --exclude='data' --exclude='docs' --exclude='test' ./ "$QA/"
mkdir -p "$QA/data"
PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:8078 -t "$QA" &
python3 tools/loadtest.py http://127.0.0.1:8078/api/api.php "$QA/data" 10 300 80 5 3 100 100
#         BASE_URL                              DATA_DIR    NUSERS·WRITES·READS·BACKUPS·IMPORTS·IMPORT_RECS·CONCURRENCY

# Sustained load ("soak"): constant load for N seconds – shows whether the latency
# runs away as the JSON files grow. Measured per 10-second window (row
# "Soak run 60 s" in the table below).
python3 tools/loadtest_soak.py http://127.0.0.1:8078/api/api.php "$QA/data" 10 5000 500 60 100
#         BASE_URL                                   DATA_DIR    NUSERS·MAXWRITES·CONCURRENCY·DURATION·IMPORT_RECS

lsof -ti :8078 | xargs kill   # stop the server
```

Both scripts check all **13** user areas for integrity (including `labs` and
`supplements` since v3.17.0).

**Reference platform** (anonymised – only a rough guide; on the Synology or other hardware
the numbers will differ): **Apple M1 Max · 10 cores · 64 GB RAM · macOS 26.5.1 · PHP 8.5.7**
(built-in server, 8 workers) · Python 3.14. Synthetic, anonymous test data (`u-load-NN`).

| Load | Requests | Concurrent | Duration | Throughput | Write p95 | Backup p95 | Errors | Integrity |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| light | 900 | 40 | 0.31 s | 2,908/s | 17 ms | 110 ms | 0 | ✓ |
| heavy | 3,880 | 100 | 1.13 s | 3,421/s | 42 ms | 290 ms | 0 | ✓ |
| very heavy | 11,580 | 200 | 3.81 s | 3,039/s | 94 ms | 836 ms | 0 | ✓ |
| Soak run 60 s | 60,277 (45,161 writes) | 500 | 60 s | 1,002/s | 478 ms | 4,426 ms | 0 | ✓ |

**Assessment:**
- **Integrity: rock solid** – even with 10,000 concurrent writes or 45,000 writes / 13 MB in the
  soak run, no lost update and no corruption.
- **Throughput ceiling ≈ 3,400 req/s** on a single host (saturated at ~100 concurrent). More
  concurrency only brings latency, not errors.
- **Most expensive path: the full backup** (reads all areas) – it grows with the amount of data; so
  do the writes (each one rewrites the whole area JSON → ~O(n)). For a family (≤ 10 users, hardly any
  concurrency, hundreds of records over the years) this is a **huge reserve**. The first scaling lever
  would be an incremental backup instead of "read all areas".

## Browser verification

After changes, check the app briefly in the browser (especially for changes close to the UI):

- Local sign-in: a **reload keeps the session** (sessionStorage, since v3.4.0); a real restart
  (empty sessionStorage / new tab) asks for a sign-in again. Sign in from the DevTools console:
  `const s = await import('./js/storage.js'); await s.refreshFamily(); await s.login('<id>','<pin>'); location.hash = '#/';`
  (ID and PIN of the admin person created in the first-time setup). Or simply tap the
  profile tile in the UI. `php -S` does not evaluate `.htaccess` – the Content Security Policy still
  applies, because `index.html` carries it additionally as a `<meta>` tag.
- After every shell change, mind the **service-worker cache** – raise `VERSION` in
  `service-worker.js` or empty the cache in the DevTools.

## Data safety & sync (invariants, server-authoritative since v3.0.0)

Do **not** break these rules in the store (`storage.js`) and backend (`storage.php`):

- **The server assigns the `rev`.** Every applied op raises a monotonic area `rev`
  and stamps a server timestamp. Clients NEVER set an authoritative `rev` themselves.
  Conflicts are decided by the server `rev` (not by the device clock).
- **Push first, then pull.** For each area, `syncPass` first sends its own ops, then
  `pullChanges(since=rev)`. This way a pull never overwrites unpushed local edits; a pull
  only wins if `record.rev` is higher.
- **The pull marker only advances through a pull (since v3.20.0).** The push response carries the
  GLOBAL area `rev` – taken over as the marker, it skipped other people's changes in between
  (second device, health ingest). `pushAreaNow`/`pushFamilyNow` therefore do not touch `revs`.
  A one-off heal (`syncHeal` = `3.20`) resets all markers on first start so that records
  skipped earlier are fetched again.
- **No op is lost silently (since v3.20.0).** Ops carry an `opId` and are removed after sending by
  identity (never by count/position). They are sent in chunks of ≤ 500 ops
  (`PUSH_CHUNK`; halved on `413`). At most one push runs per user and area (`inflight`).
  `commitLocal` writes the queue first, then the area, and rolls both back when storage is full
  (event `catofit:storage-full`, toast in `app.js`). Bulk imports use `upsertMany`
  (a single write). The queue is compacted (`replace` supersedes everything before it, per ID the
  last op counts). Tabs merge their queues via the `storage` event (`adoptForeignOps`).
- **Treat a server rollback conservatively.** If the server `rev` is lower than the marker,
  `resyncArea` follows with `mergeConservative`: the server wins on an equal or newer `updatedAt`, newer
  local data stays (with `rev` 0, so it is sent again), nothing local is deleted. In addition, once a
  week, a full reconciliation per area without pending ops (`<user>:__fullSync`).
- **Managed members leave nothing behind.** `setActiveUser`/`logout` discard the cached areas of a
  managed member (`evictUserCache`); pending ops stay in `__meta` and are sent on the next
  sync (`pushForeignQueues`).
- **Pin the user / bind pushes.** `syncNow()` pins the user (in-flight guard plus one
  follow-up run); `pushArea(area, user)` is bound to the user – never dump ops on the
  wrong user.
- **Family as records.** Members/settings/pantry are individual records (`_kind`).
  Writes produce **single ops** – never overwrite the whole `family` object, or the silent
  member loss returns (regression test: `test/sync.test.js`,
  “two admins each add a member”).
- **Migration is deterministic.** `read_store` migrates the old format into `{rev, records}` with
  identical `rev` assignment for reads and writes. When you change a record format, update the
  migration too.
- **`load_area` returns OBJECTS.** Internally `read_store` works with associative arrays; `load_area`
  converts the logical view back into `stdClass` objects via a JSON round trip. PHP consumers such as
  `ics.php` access them with object syntax (`$e->id`, `$u->type`) – do **not** change that to
  array access, or empty `.ics` files appear (regression from v3.0.0, fixed in v3.0.2).
- **Respect sealed/private.** `SEALED_AREAS` (reports) only via `addReport`;
  `PRIVATE_AREAS` (cycle) never into a foreign/admin export and never shown while managing.
  **Hardening since v3.12.0:** `store.areaAllowed(area)` (= `!(isManaging() && PRIVATE_AREAS.includes(area))`)
  is the central barrier. `get('cycle')` returns `[]` while managing, and the nav hides private modules
  (`app.js navVisible` → `areaAllowed`; the nav is rebuilt via the `catofit:nav` event when managing changes).
  The person themself (`!isManaging`) sees their cycle as usual. Tested in `test/storage.test.js`.
  **Since v3.20.0 on the server too:** `cycle`, `labs`, `supplements` only with the session of the person
  themself (see “Security model”); the client does not even request them without its own session.
  **Demo:** all members have complete master data (individual profile + settings); the female members
  have their own, private cycle data (`demoMemberProfile`, `data.cycle` per woman).
  These private demo data wait in the member's queue on this device and go to the
  server as soon as the member signs in here (the admin may not write them).
- **Sign-in lasts for the browser session (since v3.4.0; before that “no auto-login” since v3.2.0).** `login()` and
  `createFirstAdmin()` keep the identity in **`sessionStorage`** (`catofit:session`); `init()` restores
  it from there. The sign-in **survives reloads** (theme/profile/plan changes reload the page – they no
  longer sign you out), but **not** an app restart/closing → on a real start “always sign in again” still
  applies. The LEGACY key `catofit:identity` (persistent, before v3.2.0) is still discarded. Without an
  active user only `#/login` is reachable and the menus are off – logic DOM-free in
  `js/session-gate.js` (`gate()`/`menusVisible()`/`needsSetup()`, tested in `test/session-gate.test.js`).
  `logout()`/`resetApp()` flush pending ops (online) and clear `sessionStorage`; since v3.20.0 `logout()`
  also ends the server session and, with **“Shared device”** (`isSharedDevice`), clears all personal data
  from the browser storage (`wipePersonalData`; unsent ops stay). After a reload
  `syncNow` checks via `?action=session` whether the cookie is still valid.
- **Modules: on by default, can be switched off (since v3.4.1).** The uniform barrier is `settings().modules[k] !== false`
  (also for the cycle – no longer opt-in `=== true`). The navigation filters module-bound entries via
  `navVisible()` and rebuilds immediately on `catofit:nav` (sidebar + “More”). Module/metric toggles read
  the **fresh** `modules` state (no render snapshot), otherwise two toggles in a row overwrite each other
  (bug from before v3.4.1).
- **First-time setup instead of auto-creation (since v3.3.0).** With an **empty** family, `/login` (`login.js`)
  shows the first-time setup: `createFirstAdmin({name,pin})` bypasses the `isAdmin()` barrier (there is no
  admin yet) and signs in directly; `seedDemo(today)` fills in example data (`js/demo.js`, DOM-free + tested).
  `resetApp()` (admin) deletes the family + all users (server & local) and leads back to the first-time setup.
  Testing without a reinstall: in the settings (admin) use **“Reset app”** – or the isolated
  PHP server with an empty `data/` (see above), and the app lands in the setup wizard.
- **Environment namespace (since v3.5.0).** Several deployments on the SAME origin (for example PROD
  `/cat-o-fit/` and ACC `/cat-o-fit-acc/`) must NOT share client storage. `APP_NS`/`scopeKey`
  (`js/ui.js`) derive a prefix from the delivery path; **all** localStorage/sessionStorage keys
  go through it (family, session, user data, meta, feature caches). The service-worker cache is
  unique per path, `resetApp` only deletes its own environment, and `createFirstAdmin` first checks
  the server when online (no second admin). Otherwise “duplicate users” return (regression: `test/env-isolation.test.js`).
  `pinHash` deliberately stays WITHOUT a namespace (otherwise all PINs would become invalid).
- **Automatic health ingest (since v3.6.0).** `api/health-ingest.php` (`?action=health-ingest&user=&token=`)
  accepts small JSON payloads from “Health Auto Export” and writes SERVER-SIDE via `apply_ops`:
  health (one entry/day, **merged field by field** – the user's fields mood/energy/notes stay) and sessions
  (workouts, **deduplicated by `hk-<UUID>`**, plus a skip against matching manual sessions),
  `source: 'apple-health'`. Auth: behind `.htpasswd` **plus** a per-user token (`profile.healthToken`,
  created in the health import view). The PURE mapping logic lives in `api/health-map.php` (`hi_parse`,
  without DB/network – format **JSON v2**) and is tested automatically: **`php tools/test-health-ingest.php`**
  (names incl. `weight_&_body_mass`, sleep plausibility limit > 24 h, mi→km, `duration` in seconds,
  v1/v2 energy/HR, `ignoredMetrics`). `health-ingest.php` only adds auth + merge/dedup + writing.
  The metric mapping is tolerant (exact + heuristic) towards app versions; unknown things come back as
  `ignoredMetrics`. No client sync rework – the client pulls. The “Recently imported (automatic)” overview in the
  health import view is tested in `test/views.test.js`. Guide: [Apple Health](usage/apple-health.md).
- **Load control & fixed appointments (since v3.7.0).** Training load rests on the sRPE method
  (`load.js sessionLoad` = minutes × RPE; RPE clamped to 1–10, duration recorded → distance per sport →
  `plannedDurationMin` → 30 min, cap 24 h). ALL load figures live in `js/load.js` (one
  source): **load ratio** (ACWR, uncoupled: last 7 days against days 8–28; level `aufbau` (build-up) below 28 days of
  history), **fitness/fatigue/form** (CTL/ATL/TSB as Banister EWMA, τ 42/7; `formState` relative to the
  CTL, rated only from `FORM_MIN_DAYS` = 90 days) and **monotony/strain** (Foster; RPE ≤ 3 does not count,
  a hint only for a week ≥ 1.1 × one's own weekly load). Texts make no injury or protection promises.
  `fitness.loadBalance` (statistics traffic light) builds on `acwr()`. The dashboard card “Load & form”
  (`dashboard.js loadFormCard`) uses `charts.js multiLineChart`; tested in `test/load.test.js` and
  `test/train-assumptions.test.js`. — **Fixed appointments** (`js/commitments.js`):
  Football is NOT wired into the `DEFAULT_WEEK_TEMPLATE` but lives in `plan.commitments`. Since the
  plan overhaul there are **no default appointments** any more: new plans start with `commitments: []`, the
  setup asks about them. The generator (`plangen.js buildWeekUnits`) plans **around** the commitments –
  key sessions move aside, easy ones drop out; games with a date range (`commitmentDates`).
  Quality and long run are never placed directly next to a hard fixed appointment (also the Sunday before/Monday
  after, and appointments of other plans): they move to a calm day, otherwise “Easy with strides”
  (`downgradedFrom: 'quality'`).
  If `plan.commitments` is missing (plans from before v3.7.0), `plangen.planCommitments` reads Mon/Wed
  football with stable IDs (`c-legacy-mo/-mi`) – ONLY for running templates (`isRunTemplate`). The same appointment in two plans appears
  once (`coveredFixed`). Recalculation always starts from today only (`planflow.mergeFromDate`).
  Tested in `test/commitments.test.js` and `test/plangen.test.js`.
- **Plan generator (`plangen.js`, pure).** Volume by level (beginner/intermediate/advanced) and
  running days (3–6): starting point from `trainingHistory` (also downwards), +8/10/12 % per week over the
  last full week, every 4th week 85 %, taper 70/50 % (an extra 85 % for long taper phases). Long
  run: share of 33 % (5/10 km), 38 % (half marathon), 40 % (marathon) of the actual weekly total, time cap 150/180
  min, in the taper ≤ 75/55 % of the peak. Race week by days to the race (−1 shakeout, −2 rest, −3…−6
  activation/short), race session on any weekday. Triathlon/Hyrox with their own frameworks (rest days,
  formats, station progression). Tested in `test/plangen.test.js`, workout phases in `test/workout-engine.test.js`.
- **Smoothed form estimate (`vdot.js estimateVdot`, since v3.10.0).** The “current form” is NO longer
  a single run (sensitive to outliers) but robustly smoothed: (1) **weekly best** per calendar week
  (filters easy runs, dampens intra-week outliers), (2) **outlier capping** of the weekly values to
  median ± 3·MAD, (3) **recency-weighted mean** (exponential, half-life 2 weeks – the same EWMA idea
  as CTL/ATL). Fallback to the best single run with < 3 weeks of history (the most recent session as the basis). Since
  the plan overhaul only **hard runs** count (race/tempo/interval, RPE ≥ 7, average HR from zone 4);
  easy runs are a lower bound or, when there are no hard runs, a flagged estimate
  (`onlyEasy`). Return value `{ vdot, basis, weeks, onlyEasy, hardCount }`. `applyFormPaces` writes the
  form paces into `profile.paceZones`, `plan.paces` and the open future running sessions – via the
  zone key `paceKey` (`planflow.repaceUnits`), not via the HR zone. Race paces come from the
  equivalent time (`racePaceFromVdot`). Tested in `test/vdot.test.js`, `test/sollist.test.js`,
  `test/train-assumptions.test.js`.
- **Exercise library: regions, usage counter & session suggestions (since v3.11.0).** `js/exercises.js`
  stays DOM-free: besides `category` there is a **body-region filter** (`EX_REGIONS` + `exerciseRegions(id)`
  from `REGION_BY_ID`), `suggestedExercisesFor(type)` (strength → strength/core, mobility/recovery → mobility)
  and `sortByUsage(list, usage)`. The **usage counter** lives per user in `profile.settings.exerciseUsage`
  (`storage.exerciseUsage`/`bumpExerciseUsage`) – raised by “Done (+1)” in the catalogue OR automatically when
  a session is completed, for its `unit.exerciseIds` (`session.js logWorkout`). `renderPlanned` shows the
  suggestions sorted by usage for strength/mobility sessions (the toggle writes `unit.exerciseIds`);
  since v3.14.0 they are also reachable in the full-screen **workout** (`workout-mode.js renderWorkoutExercises`).
  Since v3.22.0, sessions list first the exercises named in the title/description (`exercisesInText`:
  name + `ALIASES`, only at the start of a word – a “jump squat” is not a “squat”; `exercisesForUnit`
  returns `{ named, suggested, all }`). `test/exercises.test.js` enforces `caution` and `progression`
  (from `DETAIL_BY_ID`). 93 exercises, of which 8 prevention exercises as a football suggestion (`PREVENTION_IDS`).
- **Animated exercises (since v3.22.0).** Every exercise has a movement sequence in `js/exercise-motions.js`
  (`MOTIONS`, key = exercise ID; `test/exercise-motions.test.js` enforces the mapping in both
  directions). A sequence is pure data: view (`side`/`front`), key poses (`keys`), start pose,
  phases (`seq`: pose, duration in seconds, label, hint ≤ 44 characters, breathing), optionally an intro
  (`intro`), sides (`alternate`/`each`), equipment (`props`) and the highlighted limbs
  (`focus`). Exactly one of `reps` (repetitions) or `holdS` (hold exercise – which implies
  `exercise.hold`). Every pass ends in the start pose. The poses are resolved by `js/motion-rig.js` (pure,
  DOM-free): fixed limb lengths (`BODY`), floor at y = 0, two-segment inverse kinematics for targets
  (`at`) or fixed angles (`a`); while blending, planted hands and feet stay put.
  `js/motion-figure.js` draws tile still images from it (start faint, target pose strong) as an
  SVG string and the animation as DOM that is built once and only repositioned per frame;
  `js/motion-player.js` drives the preview and “Follow along” (`buildPlan`/`stateAt`: intro,
  repetitions or time, side changes, pauses; sound via WebAudio, wake lock, reduced motion →
  still image). A new exercise = catalogue entry + sequence; check it with
  `node tools/motion-sheet.mjs --only <id>` (HTML contact sheet with single frames of both sides under
  `.playwright-mcp/motion-sheet/`; with `PLAYWRIGHT_MODULE`, as for the render script, additionally as PNG).
  Since v3.23.0 `js/coach-figure.js` draws the pose as an instructor figure (body with volume, clothing,
  ponytail with follow-through, shadow; only shapes, drawn in `motion-figure.js`). `style: 'line'`
  still gives the line figure. `viewBoxFor(m, aspect)` fits the frame to a stage.
- **Follow along non-stop (since v3.23.0).** `js/show-program.js` (pure): `dosesFromText` reads amounts,
  rounds and round rest from the session description (`unit.description`; the text piece per exercise up to “·”
  or the end of the sentence, “A & B 8×/side” splits the amount), `programForUnit`/`programForWorkout` build the
  programme, `buildShow` the timeline (ready · work · switch · rest · roundRest). `beatPlan` puts
  every movement phase on half beats (fast ones on quarter beats) and every repetition on whole beats
  in the tempo range of the style; pauses last whole bars. `js/workout-show.js` is the full-screen view.
  **Rules from the iPad test:** the clock is always the screen clock (the audio clock stands still on iOS at
  every interruption – the picture froze). The music plays pre-computed loops
  (`music.js renderLoop`, four bars, tail mixed in at the front) and locks in per section with the correct phase;
  a watchdog wakes the AudioContext every 0.5 s (`wakeAudio`) and pulls the beat back in (> 80 ms
  offset). Announcements only in pauses – speech output interrupts the music on iOS; announcements stay
  referenced, and after `cancel()` `speak()` waits briefly (otherwise Safari swallows them). No full screen
  (Safari puts its own close cross over the stage). Sounds are placed on the audio clock shortly before
  their time, to compensate for the output delay. `js/audio.js` unlocks sound and
  speech output in the user gesture and registers the audio session as playback
  (`navigator.audioSession`, otherwise a silent `assets/audio/silence.wav`) – otherwise Web Audio stays
  silent on iPhone/iPad in silent mode. Ready-made workouts are in
  `js/workouts.js` (catalogue with `cat` for the filters). Announcements come from voice clips
  (`js/voice.js`: `voiceTexts` lists them all, `assets/voice/<key>.m4a`), played through the
  audio clock – speechSynthesis only as a fallback, because on iOS it stays silent next to Web Audio. New
  exercise or new text → regenerate the clips: `node --import ./test-setup.js tools/voice-texts.mjs`
  and `tools/voice-clips.py` (Piper + voice Thorsten, instructions at the top of the file); a test checks
  that a file exists for every clip. Listening tests with levels: `node tools/music-preview.mjs` (Playwright as above).
- **Rolling planning, triage & dual goal (since v3.8.0).** Pure modules, all based on `today`
  and covered by node:test: `js/rolling.js` (rest-day detection from ACWR/hard days/form; only
  open, NON-fixed demanding sessions are eased; transparency log `plan.adaptLog` with an
  undo snapshot – the central apply/undo core `applyAdapt`/`undoAdapt` lives in
  `js/adapt.js` since v3.14.0, so `cycle.js` logs too), `js/triage.js` (week collisions
  + priority order fixed appointments → key sessions → strength → volume → recovery; `destackSuggestion` untangles
  two-goal stacks), `js/whatif.js`
  (before/after of the weekly load when adding/moving – in the move dialog & unit creator),
  `js/dualgoal.js` (phase-dependent emphasis performance↔weight loss + capped deficit recommendation +
  an honest stimulus check against “rest-day cosmetics”). The goal cockpit (`dashboard.js goalCockpitCard`)
  couples the race forecast, weight goal, phase and nutrition. Important: the load signals react only
  to DEVIATIONS from the plan (`rolling.restDaySuggestion`: actual load of the last 7 days > 1.15 × planned from
  `whatif.unitLoad`, or ≥ 3 hard days with at least one unplanned – `hardStreakInfo`); the form only
  with a settled fitness curve. The target is only one hard session within the next 2 days (horizon 2) –
  if easy days come before it, nothing is cancelled. `footballFollowupEase` counts only football actually played. Fixed
  appointments are taboo for all automations (also `weekDeloadCandidates`).
- **The one daily recommendation (`js/coach.js`).** `coachDecision` collects all candidates and picks
  exactly one by a fixed priority (`primary`); the rest goes into `suppressed` (reason via `coachWhy`).
  ONE RPE window (`planflow.rpeProgression`, 21 days, ≥ 4 sessions); `adaptive.recentLoadFeedback` no
  longer exists – only `load.js` passes a load verdict. After illness/injury (`returnPhase`,
  14 days): return to training, no catching up, no volume compensation, no increase. Tested in
  `test/coach.test.js`.
- **One number everywhere.** Plan adherence only via `fitness.adherence` (today only counts once it is done,
  health absences and protected cycle days neutral; monthly report with `to = min(month end, today)`),
  running km only via `fitness.runKm`, streaks as a weekly streak (`badges.weekStreak`, ≥ 3 training days,
  illness weeks pause), momentum with an illness pause and at most 5 days per week. The
  team dashboard counts only training badges (`TRAINING_BADGE_CATS`) and works without other
  people's cycle data. Tested in `test/consistency.test.js`.
- **Usability conventions (since v3.20.0).** Menu and active highlight only via `nav.js` (`TAB_ITEMS`,
  `MORE_GROUPS`, `navMatches`, `navVisible`); account displays only via `accountBlock()` – always the
  **signed-in** person (`identityMember`), never the managed member. After saving use
  `refreshView()`/`goOrRefresh()` instead of `location.reload()` (the test `test/refresh.test.js` allows reload
  in only four places). Button groups via `field()` (named group), switches via `segmented()`
  (radio group), RPE/feeling/duration via `rpeScale`/`feelingPicker`/`durationFields`, files via
  `saveFile()`. Text in accent and status colours only via `--accent-text`/`--*-text` (test
  `test/contrast.test.js`); charts are coloured via CSS classes. New modules without static cycles
  (test `test/import-graph.test.js`). Also tested in `test/nav.test.js`, `test/a11y.test.js`,
  `test/boot-check.test.js`.
- **Shared helpers instead of copies (since v3.21.1).** Numbers with the language's decimal separator via `fmtNum(n, digits)` or
  `fmtDec(alreadyRounded)`, member colours via `safeAccent`/`colorTint`, redrawing a view
  via `rerenderView(render)` – all available from `ui.js`. Between a number and its unit, `el()` itself inserts a
  non-breaking space when displaying (`keepUnits`); stored values, CSV and calendar keep a
  normal space. Tests on displayed text therefore expect ` ` between number and unit.
  A guard (`test/shared-helpers.test.js`) prevents copies from coming back.
- **Adaptive extensions (since v3.14.0), all logged & undoable via `adapt.js`:**
  (1) **Cycle** – when a period start is entered for today/tomorrow, `cycle.js askAboutFirstDay`
  asks how the person feels; only on “Take it easier” does `applyCycleEasing` soften the sessions on day 1
  (`cycleSoftenTargets` + `cycleEaseVariant`, type-aware via `rolling.js gentleVariant`). Phase tips
  neutral (`phaseTip`), setting `cycleHormonal` (phase `neutral` except on bleeding days, no
  missed-period question), no phases/forecast beyond `PREDICTION_MAX_AGE_DAYS`.
  (2) **Two goals** – `restDayApply` takes back the WHOLE day across plans (`planflow.js dayLoadUnits`);
  `triage.js destackSuggestion` + `findMakeupDay` offer moving a session to a free day.
  (3) **Football** – `cross_football` carries an **intensity** (light/normal/intense, `commitments.js`),
  counts as hard from “normal” (`planflow.isHard`, `rolling.dayIsHard`), flows into the load via `fitness.footballRpe`/
  `sessionLoad`, and `rolling.footballFollowupEase` suggests the easy following day.
- **Teams (since v3.9.0).** Teams are additional `_kind:'team'` records in `family.json`
  (`{id, name, emoji, color, memberIds}`) – ALONGSIDE members/`__settings`/`__pantry`; they sync
  along record-agnostically (no sync rework). A member can be in SEVERAL teams (multiple membership:
  overlapping `memberIds`), some in none. Store API (admin only): `teams`/`teamsOf`/`teamMembers`/
  `addTeam`/`updateTeam`/`removeTeam`/`setMemberTeams` (assignment & team change). `removeMember` cleans up
  team memberships (no “ghosts”), `saveFamily` sets/clears teams on the authoritative reset.
  The aggregation stays team-AGNOSTIC: `teamstats.js` simply gets a filtered member list
  (`filterTeamMembers`/`teamlessMembers`); the `#/family` dashboard switches at the top between All / a team / No
  team, management happens in `#/familie-verwalten`. `MAX_MEMBERS = 32`. Tested: `test/teams.test.js`;
  demo: 11 people (one of them 12 years old – child and youth profile), 3 teams, one member in 2 of them, one in none (`seedDemo` resolves `team.memberNames` → IDs,
  `__self__` = admin).

## Security model (since v3.20.0: server session for private data)

The app runs on a **trusted home network**. Since v3.20.0 there is a lean
**server session after a PIN check** (`api/auth.php`) – deliberately only where it is needed, so that
existing devices, the health intake and `.ics` links keep working:

- **PIN check on the server:** `?action=login` checks SHA-256 (`catofit:<id>:<pin>`, identical to
  `js/sha256.js`) and the old djb2 format, limits failed attempts (5 in 15 min per member, then
  `429`) and sets the cookie `catofit_sid` (HttpOnly, SameSite=Strict, path = API directory,
  hence separate for several installations on the same origin). Sessions are stored as
  `data/auth/sessions/<sha256(token)>.json` and expire after 30 days without use.
  **PIN hashes do not leave the server:** family responses carry `hasPin` plus the
  placeholder `pinHash: "server"`, on which older app versions fail (instead of opening a profile without a
  PIN). The client never stores a PIN hash (`localFamilyRecord` cleans up old
  caches at start).
- **Offline sign-in:** after a successful server sign-in the client remembers a
  check value with its own device salt (`pinLocal`). Without the server, signing in works only with it – so
  only on devices where the person has already signed in online. Until the server sign-in is
  caught up, the PIN stays in working memory (`pendingServerPin`, `catchUpServerLogin`).
  Rationale: the first sign-in needs the server anyway (the app shell comes from there);
  after that, training should be able to continue offline.
- **Private areas** (`cycle`, `labs`, `supplements`): read and write only with the session
  of the same person (`401`/`403`). The client only synchronises them when `privateAllowed(user)`
  holds; otherwise ops stay in the queue. If the server loses the session, the app asks for the PIN via
  `catofit:session-required` (`reauth`) without signing out. The same applies if the
  server knows no session of this person at all at the first reconciliation after a reload (update from
  v3.19.0, 30 days idle) – once per page load (`sessionAsked`), “Later” is respected.
- **Admin actions:** `delete-user` and family ops that create members, change roles,
  delete members or replace the family need an admin session (`family_guard`).
  Exception: the first-time setup (no admin person yet). Rejected ops come back as `rejected`;
  the client discards its version and fetches the server state (`catofit:ops-rejected`).
  The server accepts PIN hashes only from an admin session; `set-pin` changes one's own PIN
  only with the previous one.
- **All other areas** stay in the previous trust model (any device on the network can
  read and write them). For operation outside the home network, a sign-in in front is mandatory
  (README; optionally `CATOFIT_BASIC_AUTH` in the Docker image).
- **Protection against foreign sites (CSRF):** writing actions only with `Content-Type:
  application/json` (forms on foreign sites cannot send that, `fetch` would need a
  CORS preflight, which the server does not answer) and not with `Sec-Fetch-Site: cross-site`
  or `same-site`. The multipart upload `health-import` requires a session (SameSite cookie).
- **Further layers:** optional host list `CATOFIT_ALLOWED_HOSTS` (DNS rebinding),
  security headers and CSP (`.htaccess`, additionally a `<meta>` tag in `index.html`; hence no
  inline script – see `js/boot-check.js`), blocks for `tools/`, `test/`, `docs/` and
  repo files, ZIP limits in the health import, `LIBXML_NONET` + entity loader off.
- **Backend validation:** `userId` whitelist (`^[A-Za-z0-9_-]{1,64}$`), area whitelist,
  `scope ∈ {user, family}`, atomic writes (`flock`, temp→`rename`), `Cache-Control:
  no-store`. No path traversal via `area`/`user`.
- **PIN rules:** admin PIN mandatory in the first-time setup; new PINs 4–8 digits and not
  `0000` (`pinProblem` in the client, `valid_new_pin` on the server). New members start with `0000`
  and see a hint on “Today” until they set their own. The hash stays **identical in every
  context** (plain SHA-256, do not tie it to `crypto.subtle` – otherwise there is a risk of lock-out
  between http and https).
- **No XSS entry point through free text:** user texts (names, notes, titles, values) are set via
  `el({ text })` → `textContent`; `el({ html })` is reserved exclusively for internal, fixed
  SVG/markup snippets. Accent and member colours only as hex (`safeAccent`).
  Secured by `test/xss-sweep.test.js` (prepared text in all fields, all views).

## Translations (i18n, since v4.0.0)

Development is in English: code, comments, test names, commit messages and these developer docs.
The app itself speaks seven languages (`de`, `en`, `fr`, `es`, `it`, `pt-BR`, `nl`), chosen per person.

- **Catalogs:** `locales/<lang>/<area>.json`, nested keys, placeholders `{name}`, plurals
  `key.one` / `key.other` (plus the `Intl.PluralRules` forms a language needs). English is the
  source; lookup goes active language → English → key. The language list is
  `locales/languages.json` (code → endonym): a new language is a folder plus one entry there.
  Areas: `ui` (everything on screen), `help`, `exercises`, `recipes` and `server` (the text the PHP
  backend writes into calendar files and import titles, read by `api/i18n.php`; error messages stay
  English with a stable `code` that the app translates as `server.<code>` in `ui.json`).
- **Code:** `t('section.key', params)`, `tp('section.key', count)`, `tList(…)` from `js/i18n.js`.
  `ui` is loaded at start; bigger areas (`LAZY_AREAS` in `js/i18n.js`: `help`, `exercises`, `workouts`,
  `recipes`, `health`) via `loadArea()`, and their keys start with the area name. Text is set with
  `el({ text })` as before – a catalog string goes into `html` only if it is fixed markup without user data.
- **Formats:** `js/format.js` (re-exported by `ui.js`) – weekday/month names and date patterns from
  the catalog (`format.*`), separators from `Intl`. Never build dates or decimals by hand. Units stay
  metric (imperial units come with 4.1).
- **Which language:** `js/language.js` – the person's `settings.language`, else the instance default
  (`familySettings().language`, written at first setup), else German for instances set up before
  v4.0.0, else the browser. While an admin manages someone else, the admin's language stays.
- **Stored data stay as they are:** internal values (`erledigt`, categories …) are keys; only
  their display is translated. No data migration. Plan texts written before v4.0.0 stay German;
  `js/exercise-terms-de.js` (and the matching vocabularies in `energy.js`/`food.js`) recognise them.
- **Tests run in German** (`test-setup.js`): the de catalog holds the texts shown before v4.0.0, so
  existing assertions guard against regressions; switch with `await setLocale('en')`.
  `test/i18n-catalog.test.js` checks keys, placeholders, plural forms, unknown and unused keys (for
  the `server` catalog against `api/*.php`), and keeps every module in `js/` free of German
  literals except a short allow-list (`GERMAN_ALLOWED`: the matching vocabularies for German plan
  texts, the German voice's phonetic help and the start-up diagnosis). It also fails when a module
  calls `t()` while it is being imported (the catalogs load later in the browser – look keys up inside
  a function) or hides `t` with a local variable. Every language in `languages.json` must be complete
  (`COMPLETE_LANGUAGES`); a language added later may start with fewer keys (it falls back to
  English) if you take it out of that list until its translation is done.
- **Translators:** `locales/GLOSSARY.md` (tone, address, fixed terms), `locales/REVIEW.md`.
- **Documentation:** the English pages live in `docs/usage`, `docs/operations` and `docs/knowledge`
  (map: `docs/README.md`); the German copies of these pages are under `docs/de/`. The developer
  docs (this guide, `ARCHITECTURE.md`, `API.md`) are English only. Screenshots are kept per
  language in `docs/assets/de/` and `docs/assets/en/`, with identical file names.

## Publishing a change (checklist)

1. Raise `js/version.js` **and** `package.json` `version` (SemVer).
2. Bump `VERSION` (cache name) in `service-worker.js`.
3. New frontend file? Add it to `SHELL_ASSETS` in `service-worker.js`.
4. New data area? Add it in `js/storage.js` (`AREAS`/`ARRAY_AREAS`), `api/storage.php`
   (`user_areas`) and in `tools/loadtest.py`/`tools/loadtest_soak.py` (`USER_AREAS`).
5. Keep the tests green / extend them: `npm test` (JS) **and** the PHP tests `php tools/test-health-ingest.php`,
   `php tools/test-health-xml.php`, `php tools/test-storage.php`, `php tools/test-api.php` and
   `php tools/test-ics.php`.
6. Update `CHANGELOG.md` and, where needed, `docs/ROADMAP.md`, the pages under `docs/` (the English
   pages and their German copies under `docs/de/`) and the in-app help (structure in
   `js/helpcontent.js`, texts in `locales/<lang>/help.json`). New or changed UI texts go into the
   catalogs of every language (see “Translations” above).
7. Re-render the documentation images: `node tools/render-screenshots.mjs` (once
   `npm install --no-save playwright`). For each language the script starts a fresh instance with an
   empty `data/`, a fixed demo day and the persona “Alex”, and writes the images to
   `docs/assets/<lang>/` under identical names (`--lang en|de|all`, default all; individual images with
   `--only 05,16`, the promo images with `--only promo`: `docs/assets/promo/banner.png`, `banner.de.png`
   and `social-preview.png`). Buttons and fields are found through the catalogs, so a renamed label
   needs no change in the script. Texts that quote values from the images –
   “Current form” in `docs/usage/coach-and-load.md`, the ferritin example in
   `docs/usage/labs.md` (and their German copies under `docs/de/usage/`) – must be proofread afterwards.

## Project structure (short)

```
cat-o-fit/
  index.html              App shell (PWA, iOS meta)
  manifest.webmanifest    PWA manifest
  service-worker.js       Offline shell (network-first)
  js/
    app.js router.js      Bootstrap & hash routing
    storage.js api-client.js   Data layer & sync
    ui.js charts.js       UI building blocks
    i18n.js language.js format.js   Translations, language choice, number/date formats
    plangen.js program.js Plan generators (race / programme), pure
    plans.js              Plan setup, update and view
    load.js coach.js      Load (one source) and the one daily recommendation, pure
    fitness.js            Shared figures (plan adherence, running km, traffic light), pure
    …                     further view and logic modules
  api/                    PHP backend (persistence, sign-in, .ics, health intake and import, i18n.php)
  locales/                Translation catalogs (<lang>/<area>.json, languages.json, GLOSSARY.md, REVIEW.md)
  data/                   JSON data (protected by .htaccess)
  css/                    Stylesheets
  test/                   node:test (*.test.js)
  test-setup.js           Mini DOM + localStorage shim for the tests
  docs/                   Documentation by audience (map in docs/README.md; German copies in docs/de/), architecture, development
  tools/                  PHP tests, load test, demo seeds, render script, movement contact sheets, music listening tests, reset-pin.php
```

## Deployment

**Synology Web Station** – short version, details under
[Installation](operations/installation.md#option-3-web-hosting-or-synology-web-station):

1. Install Web Station + PHP, copy the project to `/web/cat-o-fit`.
2. Give the web server user (`http`) write permission on `data/`.
3. Open it over HTTPS; `api/api.php?action=ping` must return `{"ok":true}`.

**Docker** (multi-arch: amd64 + arm64) – details under [Installation](operations/installation.md#option-1-docker):

```bash
docker compose up -d                          # pull the ready-made image; app on port 8080
docker compose build && docker compose up -d  # build it yourself
```

The container deliberately starts with an **empty instance** (first-time setup wizard);
developer seeds (`tools/seed/`) and runtime data do not go into the image (`.dockerignore`).
Optional: `CATOFIT_BASIC_AUTH=1` with `CATOFIT_AUTH_USER`/`CATOFIT_AUTH_PASSWORD` (sign-in in front of
the app; the entrypoint creates the Apache configuration), `CATOFIT_ALLOWED_HOSTS` and `TZ`
(time zone for PHP and the calendar files).

There is no build step – the files are served unchanged.
