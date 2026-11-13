# AGENTS.md

Notes for contributors who work with an AI coding agent, and for the agent itself. They sum up
[CONTRIBUTING.md](CONTRIBUTING.md); where the two differ, CONTRIBUTING wins. You stay responsible for
the change: say in the pull request that an agent helped and what you checked yourself.

## The project in brief

- **Frontend:** vanilla ES modules in `js/`, CSS in `css/`, no build step, no npm packages
  (`package.json` holds only the test script). A PWA with a service worker (`service-worker.js`).
- **Backend:** lean PHP 8.1 or newer in `api/`, no framework, no Composer packages. `api/api.php` is
  the only entry point; data lives as JSON files in `data/` (no database).
- **Languages:** seven interface languages in `locales/<lang>/*.json` (English is the source).
- **Layout:** `js/` (app and pure calculation modules), `api/` (server), `locales/` (catalogs),
  `docs/` (English, authoritative) and `docs/de/` (German copy), `test/` (`node:test` with the mini
  DOM in `test-setup.js`), `tools/` (PHP tests, Docker smoke test, build and render scripts),
  `docker/` (image).
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); development notes and the invariants
  of sync and data safety: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); API: [docs/API.md](docs/API.md).

## Run the tests locally

```bash
npm test                                            # all Node suites (node:test, mini DOM)
php tools/test-health-ingest.php && php tools/test-health-xml.php \
  && php tools/test-storage.php && php tools/test-api.php && php tools/test-ics.php
docker build -t cat-o-fit:smoke . && IMAGE=cat-o-fit:smoke bash tools/test-docker.sh
npm install --no-save playwright@1.65.0 && npx playwright install chromium webkit
node tools/test-browser.mjs                         # real browsers, seven languages, demo, offline start
```

The CI runs the same on every push and pull request (`.github/workflows/ci.yml`); a weekly workflow
runs all tests under a moved clock (`.github/workflows/time-travel.yml`).

Every change brings its test. Do the **counter-check**: turn the new safeguard in the code back for a
moment – the test must fail; only then does it guard anything. Prefer fixed dates in tests and pass
them on (`today` parameters such as `planWindow(eventDate, today)` or `estimateVdot(sessions,
today)`); a test that needs "today" derives its dates from it and never relies on a weekday, month
end or time change falling a certain way. Moving a test's data forward is not a fix.

## Rules that matter most

- **No user data.** The repository is public. Never real names, health values, lab results, cycle
  data, training logs, addresses or logs from a real installation – not in code, tests, fixtures,
  screenshots, commit messages or pull requests. Use invented values; example hosts only
  `fit.example.org`, `nas.local` or `192.168.178.x`.
- **No third-party packages.** No npm runtime packages, no Composer packages, no CDN. A new library
  is an architecture question: open an issue first.
- **Private areas stay private.** Cycle, labs and supplements never appear for admins, on the
  team/family dashboard or in the full backup, and the server hands them out only to the signed-in
  person. PIN hashes never leave the server. See [SECURITY.md](SECURITY.md).
- **One source per figure.** Fitness and race predictions come from the VDOT estimate, training load
  from session RPE, the energy deficit from the dual-goal logic. Do not compute a second version of the
  same figure somewhere else; reuse the module that owns it.
- **Data is stored metric, the person's units are for display and input.** Convert at the edges
  (`js/units.js`, the formatters in `js/format.js`), never in stored records.
- **Interfaces change only additively.** API fields and actions, the backup format and the CSV stay
  compatible; a new capability is announced in `features` of `?action=ping`. Never break the sync
  invariants in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (the server assigns `rev`, nothing is
  dropped silently, profile writes are field by field).
- **Texts for people come from the catalogs**, in all seven languages (`test/i18n-catalog.test.js`).
  Never branch on the wording of a message; use a field or a code.
- **Health, labs and training are not medical advice.** Ranges and rules carry their source in
  [docs/knowledge/methods-and-sources.md](docs/knowledge/methods-and-sources.md); a new rule needs a
  source and a test that holds the documented limits.
- **Docs in English and German.** English under `docs/` is authoritative, the German copy lives under
  `docs/de/` at the same path (`README.de.md` for the README). `test/docs.test.js` checks links,
  anchors, numbers and the pairs. A claim in the docs needs a test that holds it.
- **Naming.** Symbols, comments and commit messages in English. One topic per pull request, no
  unrelated refactoring, no mass reformatting.

## Reporting what an automated test or an agent found

Use the issue form **"Report a bug"** and choose **"With an automated test or agent"** under
*How was it found?*; in triage the issue gets the label `found-by-automation`. Give the exact version,
the steps or the test that shows the error, and what you expected according to the docs. Leave out
personal data. Security issues never go into an issue: see [SECURITY.md](SECURITY.md). Ideas go to
[Discussions → Ideas](https://github.com/Bingerminger/cat-o-fit/discussions/categories/ideas).
