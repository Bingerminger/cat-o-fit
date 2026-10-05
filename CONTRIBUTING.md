# Contributing to Cat-O-Fit

Great that you want to contribute! Cat-O-Fit is **training planning for the whole family** as a PWA –
deliberately lean, with no build step and no external dependencies. To keep it that way, here are
the main ground rules.

## Principles

- **No dependencies.** No npm package, no framework, no CDN. Vanilla
  JavaScript (ES modules), CSS and – for saving, importing and the calendar files –
  lean PHP.
- **No build step.** What is in the repo runs directly in the browser.
- **Local-first.** The app works offline; the PHP backend handles persistence
  (JSON files, **no database**), sign-in, the `.ics` output and the health import.
- **Keep the logic testable.** Pure calculation logic belongs in DOM-free modules
  (`js/fitness.js`, `js/load.js`, `js/energy.js`, `js/planflow.js`, `js/vdot.js`, `js/helpcontent.js` …)
  and is covered by unit tests.
- **Take privacy seriously.** The **private areas – cycle (`cycle`), labs (`labs`) and
  supplements (`supplements`)** – never appear in the team/family dashboard, never for admins, never in the
  full backup, and the server hands them out only to the signed-in person themselves (`api/auth.php`).
  This invariant must not be weakened. Security model: [SECURITY.md](SECURITY.md).

## Local setup

Prerequisites: **Node.js 22 or newer** (for the tests only) and **PHP 8.1 or newer** for the
full backend (`php -S` is enough locally).

```bash
git clone https://github.com/Bingerminger/cat-o-fit.git
cd cat-o-fit

# Run the tests (plain Node, nothing to install)
npm test
php tools/test-health-ingest.php && php tools/test-health-xml.php \
  && php tools/test-storage.php && php tools/test-api.php && php tools/test-ics.php

# Serve the app locally (backend included)
php -S localhost:8000
# then open http://localhost:8000
```

There is **no** `npm install` – `package.json` contains only the test script. Installing and
running a server is described in the [installation guide](docs/operations/installation.md).

## Tests

- Test framework: the built-in **`node:test`** (no third-party runners); PHP tests live in `tools/test-*.php`.
- New or changed logic **must** be covered by tests – ideally by a test that would fail with the
  old code. Put tests in `test/<module>.test.js`.
- The UI can be tested with the dependency-free mini DOM in `test-setup.js`
  (`test/views.test.js` is a good template).
- The documentation is tested too (`test/docs.test.js`): links and anchors, images, numbers in the
  README, version consistency, help references.
- So are the translation catalogs (`test/i18n-catalog.test.js`): keys, placeholders, plural forms
  and empty texts – see [Translations](#translations).

## Conventions

- **Versioning:** the single source of truth is `js/version.js`. For a released
  change, raise `APP_VERSION` **and** the `version` in `package.json` (SemVer), bump the **service worker cache**
  (`VERSION` in `service-worker.js`) and add new frontend files to `SHELL_ASSETS`.
- **Data areas:** new areas must be added **in parallel** in `js/storage.js` (`AREAS`), `api/storage.php`
  (`user_areas`) and in `tools/loadtest.py` and `tools/loadtest_soak.py` (`USER_AREAS`).
- **Language:** development is in English from 4.0.0 – **commit messages and code comments are
  written in English**. UI texts are not hard-coded in modules: they live in the translation
  catalogs under `locales/` (English is the source, see [Translations](#translations)). The
  documentation is in English under `docs/`; a German copy lives under `docs/de/`
  (`README.de.md` for the README). Identifiers in the code stay technical (English), including
  grown terms such as `scope=family` / `data/family/`.
- **Keep the docs in step:** for every feature or bug fix, update `CHANGELOG.md` and the relevant
  pages under `docs/` (overview: [docs/README.md](docs/README.md)) as well as the in-app help
  (`js/helpcontent.js` and the texts in `locales/<lang>/help.json`). New metrics get a help
  article and an ⓘ (`infoButton`).
- **Style:** follow the existing code style (respect `.editorconfig`). No automatic
  mass reformatting.

## Terms and spelling (glossary)

These are the terms the app and the code use in English (the German and other-language
equivalents are in [locales/GLOSSARY.md](locales/GLOSSARY.md)).

| Write | Not | Note |
|---|---|---|
| **session** (planned unit), **training** (what you did, the log) | unit | **workout** is reserved for the follow-along mode |
| **goal** = **race** or **training programme** | event, occasion | menu "Goals & plans" |
| **member** (role), **person** (running text), **admin** | user | |
| **badges** | | |
| **momentum** | | explain it once |
| **readiness** | | |
| **load**, **load points** (minutes × effort) | | "AU" only in brackets |
| **effort (RPE)** | | scale from 1 "very light" to 10 "maximal" |
| **training zones (pace)** | pace ranges, target paces | |
| **body values** | | "values" on its own is ambiguous (lab values) |
| **Data & backup**, **My backup**, **Full backup** | | |
| **Recalculate plan from today** | regenerate, recreate, update | one action, one verb |
| **supplement** | drug, medication | private area "Labs & supplements" |
| **energy supply** (energy availability, RED-S) | screening | no diagnostic vocabulary |

**Spelling:** British English (programme, colour, favourite). Word things neutrally ("people who
train", "the admin"). Use typographic quotation marks “like this” and apostrophes (’), the spaced
en dash " – " and the ellipsis "…". Never format numbers, dates or units by hand: use `fmtNum`,
`fmtKm` … from `js/format.js`, so decimal separators follow the person's language – never insert a
raw value with a decimal point into a sentence.

## Translations

Cat-O-Fit speaks seven languages: English (the source), German, French, Spanish, Italian,
Brazilian Portuguese and Dutch. The catalogs live in `locales/<lang>/*.json`, one file per area
(`ui.json` holds everything on screen). The tone, the address form and fixed terms for each
language are in [locales/GLOSSARY.md](locales/GLOSSARY.md). For the developer's side (`t()`,
plurals, formats), see [Translations in the development guide](docs/DEVELOPMENT.md#translations-i18n-since-v400).

- **Improve a language:** edit the values in `locales/<lang>/*.json`. Keys stay English and must
  match `locales/en` exactly; placeholders such as `{count}` or `{name}` must stay unchanged;
  plural forms and the length and order of lists (weekday and month names) must match what the
  language needs. Run `npm test` – `test/i18n-catalog.test.js` checks keys, placeholders, plural
  forms and empty texts – then open a pull request.
- **Propose a new language:** add a folder `locales/<code>/` with the same files as
  `locales/en`, and an entry in `locales/languages.json` (language code → the language's own
  name, e.g. `"nl": "Nederlands"`). Every language listed there must be complete – `npm test`
  fails on a missing key. Add the language to the table in [locales/REVIEW.md](locales/REVIEW.md)
  and to the glossary in [locales/GLOSSARY.md](locales/GLOSSARY.md).
- **Reviews are welcome:** French, Spanish, Italian, Brazilian Portuguese and Dutch are
  machine-translated with a fixed glossary and have not yet been reviewed by native speakers –
  even a single correction helps. [locales/REVIEW.md](locales/REVIEW.md) shows the status of each
  language; in your pull request, add your GitHub name and the area you reviewed (for example
  "ui, help") to its last column.

## Pull requests

1. Branch off `main` (`feature/...` or `fix/...`).
2. Keep the tests green (`npm test` and the PHP tests) and add new tests.
3. Update the docs and the changelog.
4. Open the PR with a clear description and fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
5. CI (GitHub Actions) must be green.

## Reporting bugs and ideas

Use the [issue templates](.github/ISSUE_TEMPLATE/): **Bug** for reproducible bugs, **Feature**
for suggestions. Please report anything security-relevant confidentially via [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution is published under the project's licence
([AGPL-3.0-or-later](LICENSE)).
