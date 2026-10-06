# Changelog

All notable changes to Cat-O-Fit. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

Cat-O-Fit was developed privately, in German, up to v3.23.x. This repository and its changelog start
with v4.0.0, the first public release. Copies of v3.23.x or earlier that were handed out stay under the
MIT licence they came with.

## [4.0.0] – 2026-10-06

The first public release: Cat-O-Fit speaks seven languages, is developed in English and is licensed
under the GNU AGPL v3.0 or later.

### Added

- **Seven languages:** English, German, French, Spanish, Italian, Brazilian Portuguese and Dutch –
  every screen, the in-app help, all exercises with their movement cues, the follow-along workouts,
  recipes, lab values and badges. A new language is a set of catalog files plus one entry in
  `locales/languages.json`.
- **A language per person:** the app starts in the browser's language, the first admin's language
  becomes the instance default, and every member picks their own in Settings → Appearance. Instances
  set up before 4.0.0 stay German until an admin changes the default.
- **The server speaks the person's language:** calendar files and the titles of imported workouts
  follow the person they belong to; error messages carry a stable code that the app translates.
- **Recorded voice cues in every language:** 190 clips per language, made with Piper voices under free
  licences (public domain, CC0, CC BY 4.0) – see CREDITS.md.
- **Ingredients in every language:** quantities, units and shopping categories of recipes and the
  calorie estimate work the same in all seven languages.
- **Public demo** for GitHub Pages (`tools/build-demo.mjs`): the app without a server, an example
  family with full sample data, a language switch, nothing saved.
- **Import from Strong, Hevy and FitNotes:** strength history from their CSV exports, with sets in kg
  (pounds converted); exercises the library knows are matched, all others keep their own name.
- **Unraid and CasaOS templates** in `deploy/`.
- **Issue forms** for bugs, ideas and translation corrections.
- **Documentation in English and German**, with screenshots rendered per language.

### Changed

- **Licence:** GNU AGPL v3.0 or later (until 3.23.x: MIT). Contributions are accepted under the same
  licence, without a CLA; Settings → About links to the source code.
- **Development in English:** code comments, test names, commit messages and the developer
  documentation.
- The CSV export uses the spreadsheet format of the app's language (English: comma and decimal point).
- Recipe tags, chart axis dates and all numbers follow the active language.
- Where to get lab values: the German routes (insurers, fee schedule, prices) show for people in
  Germany – by their place, or by German as the app language; everyone else gets a general note.
- The planned-km tile of a plan shows the number only; the certificate stacks its goal line.

### Fixed

- German food matching: "ei" no longer matched inside "Reis", "Hackfleisch" or "Pizzateig", and
  pineapple counts as fruit in every language.
- The PIN field at first setup had a German placeholder in every language.
- After an update, an older catalog from the browser cache could meet newer scripts and show raw keys.

### Known limitations

- French, Spanish, Italian, Portuguese and Dutch are machine-translated and checked against the app,
  not yet by native speakers – corrections are welcome (`locales/REVIEW.md`). The same goes for the
  new voices.
- Units are metric; imperial units are planned for 4.1.
