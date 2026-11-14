# Claims of the project site

Every factual statement on the project site (built by `tools/build-site.mjs` from
`tools/site/content.mjs`) carries an id (`c` in the texts, `data-c` in the HTML). This register says
per id what is claimed and where it is backed. `node tools/build-site.mjs --check` (and
`test/site.test.js`) fails when a page uses an id missing here, a row here is used by no page, or the
English and German pages back different ids.

Paths are in this repository. Where a test is named, it holds the statement in the code. Numbers in
braces come from the code at build time and are checked against it (rule S6).

**Review before every release:** what a release adds or changes on the start page – new functions,
figures, images – is read against this register (see “Project site” in `docs/DEVELOPMENT.md`).

## Start

| Id | Claim | Evidence |
|---|---|---|
| `tagline` | The subscription-free, self-hosted training planner for the whole family. | `README.md` line 7, `README.de.md` lines 7 to 9 |
| `context` | Periodized plans and load management with nutrition, cycle and lab values in context – on your own hardware, without an account. | `README.md` lines 8 and 9; “Truly yours” (“no account, no advertising, no telemetry”: `docs/operations/privacy.md`) |
| `demo-browser` | The demo runs in the browser and saves nothing. | `README.md` “Try the live demo”; `js/demo-mode.js`, `js/demo-server.js`; tests `test/demo-mode.test.js`, `test/demo-xhr.test.js`, `tools/test-browser.mjs` part “demo” (no request leaves the browser except the weather) |

## What it does

| Id | Claim | Evidence |
|---|---|---|
| `plans` | Periodized race plans from 5 km to the marathon or programmes without a race, set up by level and running days, volume starting from your history. | `README.md` “Why Cat-O-Fit?” › Plans that fit; `docs/usage/training.md` |
| `plans-today` | Recalculated from today without touching the past; club sessions are fixed appointments the plan works around. | `README.md` “Plans that fit”; `docs/usage/coach-and-load.md` “Fixed commitments (football & matches)” |
| `plans-beta` | Triathlon and Hyrox plans are in beta. | `README.md` “Plans that fit” and the comparison notes |
| `load` | Session-RPE load (minutes × effort) across all sports, an acute:chronic ratio and fitness, fatigue and form. | `README.md` “Load management you can read”; `docs/usage/coach-and-load.md`; `js/load.js`, `js/fitness.js` |
| `coach` | One coach recommendation per day with its “why”, no injury-prevention promises. | `README.md` “Load management you can read”; `docs/usage/coach-and-load.md` |
| `exercises` | {exercises} animated exercises to follow along in time. | `EXERCISES` in `js/exercises.js` (the number is taken from there); `docs/usage/training.md` “Exercise library” |
| `non-stop` | A whole session plays hands-free like a workout video – on a 3D stage, with a trainer you choose, music on the beat and recorded voice cues. | `README.md` “Plans that fit” and “Languages” (recorded clips); `docs/usage/training.md` “Follow along non-stop – with music and voice cues” (stage, figure, looks); `TRAINERS` in `js/stage-show.js`; `CREDITS.md` voice clips, `assets/trainer/CREDITS.md` |
| `strength-depth` | Sets with a hint for the next step, estimated one-rep max, personal records, a plate calculator. | `docs/usage/training.md` “Do a training session”; `js/strength.js`, `test/strength.test.js`; CHANGELOG 4.2.0 |
| `strength-import` | Strength history comes along from Strong, Hevy or FitNotes. | `README.md` “Truly yours”; `js/strength-import.js`; CHANGELOG 4.0.0 |
| `family` | Up to {people} people with their own goals and plans, teams, a shared dashboard, admins who plan for kids. | `README.md` “Built for the whole family”; `MAX_MEMBERS` in `js/storage.js` (the number is taken from there); `docs/usage/family.md` |
| `private` | Cycle, lab values and supplements stay private, also on the server, which hands them out only after that person's PIN sign-in. | `README.md` “Built for the whole family”; `SECURITY.md` “Private areas”; `docs/operations/privacy.md` |
| `health-import` | Body values from Apple Health or Android Health Connect, activity files (GPX, TCX, FIT), even a whole Garmin or Strava export. | `README.md` “Health in context”; `docs/usage/apple-health.md`; `js/activity-import.js` |
| `labs` | Lab values against your lab's reference range plus a sports corridor, cycle-aware planning, an energy-availability estimate. | `README.md` “Health in context”; `docs/usage/labs.md` |
| `not-diagnosis` | For documentation and general information, not a diagnosis. | `README.md` “Health in context”; `docs/usage/labs.md` |
| `kitchen` | Recipes, calorie balance, a food diary with barcode lookup, a shared shopping list with pantry. | `README.md` “Kitchen included”; `docs/usage/nutrition.md` |

## Truly yours

| Id | Claim | Evidence |
|---|---|---|
| `own-server` | JSON files on your own server – no database, no account, no telemetry. | `README.md` “Truly yours” and “Privacy and external services” (“No account, no telemetry”) |
| `offline` | Offline-first on every device, installable from the browser as an app. | `README.md` “Truly yours” and “Requirements” (PWA); `service-worker.js`; `tools/test-browser.mjs` part “offline” |
| `languages` | {languages} languages, one per person, with their names. | `locales/languages.json` (count and names are taken from there); `README.md` “Languages” |
| `units` | Units per person: km or miles, kg or pounds, °C or °F, first day of the week, lab values in SI or conventional units. | `README.md` “Languages” (last paragraph); CHANGELOG 4.1.0 |
| `open-source` | Open source under the AGPL-3.0-or-later, without third-party dependencies. | `LICENSE`; `package.json` (no dependencies); `README.md` badges |

## Install

| Id | Claim | Evidence |
|---|---|---|
| `docker` | One container for amd64 and arm64, or any web server with PHP 8.1 or newer. | `.github/workflows/docker.yml` (platforms); `README.md` “Requirements” |
| `home-network` | Built for your own, trusted network; from the internet only with a sign-in in front and HTTPS. | `README.md` security note; `SECURITY.md` “Important operating notes”; `docs/operations/installation.md` |

## Good to know

| Id | Claim | Evidence |
|---|---|---|
| `pwa` | A web app installed from the browser, not an app from the App Store or Google Play. | `README.md` comparison notes (“an installable web app, not an app-store app”) |
| `no-cloud` | No direct connection to the Garmin or Strava cloud; activities come as files or exports. | `README.md` comparison notes |
| `translations` | French, Spanish, Italian, Portuguese and Dutch were machine-translated and checked against the app, not yet by native speakers. | `README.md` “Languages”, second paragraph |

## Footer

| Id | Claim | Evidence |
|---|---|---|
| `site-privacy` | This page sets no cookies, stores nothing and loads nothing from other servers. | Rules S1 and S7 of `tools/build-site.mjs` (nothing from outside, inline scripts only read the address); no script file on the start page |
