# Changelog

All notable changes to Cat-O-Fit. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

Cat-O-Fit was developed privately, in German, up to v3.23.x. This repository and its changelog start
with v4.0.0, the first public release. Copies of v3.23.x or earlier that were handed out stay under the
MIT licence they came with.

## [4.2.1] – 2026-11-19

Race plans with fixed commitments build up again – in 4.2.0 such a plan could stop growing at some
16 km a week – and they keep what you chose: the number of runs and the strength sessions.

### Fixed

- **Race plans with fixed commitments stopped growing** (4.2.0 only). When a fixed commitment took the
  day of a run – with four or more run days a match on the day of the recovery run is enough –, the run
  was dropped together with its kilometres. The week ended below its target, the next week may rise only
  from the last one as planned, and the plan stayed at some 16 km a week, also for a marathon. Now the
  runs that take place carry the week.
- **A run whose day a fixed commitment takes moves to a free day** instead of being dropped; only
  mobility drops out on a commitment day. You keep the number of runs you chose while the week has a day
  for each. A run that finds no free day leaves its kilometres to the others.
- **Strength in run plans** was not planned at all in a week with several demanding commitments
  (football twice a week and a match, say). Calm days still come first; what is missing of the number
  you chose is planned all the same on the day that disturbs least – never on a commitment or on the day
  of a long run or quality session, never the day before a match or race, never on two days in a row.
- **Where sessions had to move, the shortest easy run sits where the day has to be gentlest:** the day
  before a match first, then the days next to the long run. Before, the week's second-longest run could
  land right before the long run.
- **Level suggestion:** one long run in the last four weeks – a race, for instance – no longer makes
  *Advanced* on its own; the weekly volume counts. The suggestion affects new plans only.

### Changed

- **Strength in run plans: the number you chose in every week up to the taper.** Before, only the base
  phase carried it, and build, peak and deload weeks one session. What the sessions hold still follows
  the phase (general strength, jumps for power, short sessions to keep it); the taper stays free. From
  the build phase on a second session is the week's fourth demanding one – the week check says so.

### For existing installations

- Race plans show **“New plan logic available”** once more. If your plan has fixed commitments,
  recalculate it from today (the past stays as it is, and so do sessions you added or moved yourself) –
  and have a look at the level while you are there. The runs of plans without fixed commitments are built
  exactly as before; its strength sessions follow the new number when you recalculate.

### Tests

- A new plan invariant over all patterns of fixed commitments, long plans from a small start and a
  combined pattern (football twice a week plus a match): the plan gets as far as one built for the run
  days that remain, the person keeps their runs while a day is free, and the easy runs are ordered by how
  gentle their day has to be. The weekly volume rules (no week above its target, no jump, deload, taper)
  are now checked with fixed commitments too, and the strength invariant states the new rules. All of them
  were red before the fix.

## [4.2.0] – 2026-11-14

Strength in depth, following along on a 3D stage with a real trainer, a library of 120 exercises – and a
large round of fixes for sync, plans, training figures, health values and imports.

### Added

- **Follow along on a 3D stage.** The non-stop session now plays in space: a trainer with a real body and
  skeleton shows every exercise in rhythm, with dumbbells, kettlebell, ball, band, box, wall or bar where
  the exercise needs them; the camera moves with the session. You choose **who leads** (a blonde or
  red-haired woman, or a man), the **tempo** (calm, brisk, fast – workouts start brisk) and, while it
  runs, one of **three looks** (natural on a beach, a night arena, drawn with an ink line). The trainer
  blinks and smiles; the cat trains along – it jumps, squats and lies down with the trainer and dances
  at the end. Points, a combo and stars count what you get through, for the session only. With Reduce
  Motion or without 3D graphics the session shows the drawn instructor instead.
- **A library of 120 exercises** (27 new) – among them floor press, renegade row, push press, box squat,
  wall and decline push-ups, sit-up, plank up-downs, reverse plank, boat hold, forward folds, squat to
  stand, star, tuck, split and box jumps and jump rope – each animated, in all seven languages, with a
  spoken name. **Five new workouts:** a gentle start with a chair and a wall, upper body with dumbbells, a
  strong core, jump power and gentle stretching (30 in total).
- **Strength in depth:** estimated one-rep max (Brzycki, up to 10 reps) and best values per exercise, a
  notice when a set is a personal record, records in the evaluation, a plate calculator (kg/lb); a rest
  timer per exercise that starts after “+ Set”; starter programmes for home and for the gym (A/B, up to
  three strength days); a plan shared as a file or PDF; your own exercises, your own follow-along
  workouts, and a workout assigned to a planned session.
- **Plans:** strength inside a run plan (0–2× a week, following the plan phase, off by default); an
  automatic volume adjustment from the load signals (only downwards, at most −15 %, can be switched off,
  with undo); season planning – B and C races inside the plan of an A race get a short taper and
  recovery, a C race replaces the tempo session.
- **Performance test:** threshold pace, FTP and CSS from a test; **heat and treadmill** per session count
  in the form estimate.
- The admin's full backup names the areas that did not come from the server (in the file and as a note).
- **Project site:** a start page in English and German with the demo under `/demo/`, the roadmap also in
  German, an ideas template, a public board and a milestone per release.

### Changed

- **Plan generator:** the sessions you see keep the rules of the plan – weekly volume, progression, the
  long run's share, distance between hard sessions and fixed appointments, a shake-out before the race;
  a standard marathon plan reaches the volume behind its prediction. Existing plans show “New plan logic
  available”; nothing changes unless you ask for it.
- **Progression hint for strength** (ACSM 2009): more weight only after two sessions in a row with 12 reps
  in every set, about 5 % on the smallest step; with light dumbbells (a step of more than 10 %) first 15
  reps or one more set.
- The gentle strength round of the programmes plays the wall push-up and the sit-to-stand as exercises of
  their own (they stood in as incline push-up and squat before).
- The admin's full backup fetches each member in one request (four in parallel) instead of area by area;
  the content of the file is the same, older servers get the old way.
- The demo lives under `/cat-o-fit/demo/`; old links with a route and installed demo apps end up there.
  The project site is built on a release.
- Development: the store lies in parts (`js/store-*.js`) behind `js/storage.js`, public names unchanged.

### Fixed

- **Data and sync:** signing in on a new device could overwrite the profile on the server with defaults –
  profile settings are now written field by field, and nothing automatic writes before the profile has
  been fetched. With device storage full, a change that was taken back is no longer synced later. “Reset
  app” reports only what really happened and keeps its own session to the end. The server no longer
  drops invalid changes silently; every error keeps its format.
- **Offline:** the app starts offline again (the service worker had not been registered since 4.0).
- **Plans:** “Recalculate from today” and changing fixed appointments keep your own, moved and made-up
  sessions; undoing an older automatic adjustment no longer overwrites what a newer one changed; phase
  names appear in the person's language.
- **Training figures:** the form rating is no longer pushed negative from day 90 on; the HRV rating stays
  on days without an HRV value; the form estimate counts calendar weeks and names the run behind the
  number; HR zone 5 never above HRmax; a pace in min/mi comes back as typed; distance ranges in miles on
  both ends (app and calendar feed); limits at 10 % and 3 VDOT points without floating-point slips.
- **Health intake:** a workout that is sent again (rolling 48 h window) no longer replaces the session –
  effort rating, notes and the link to the plan stay, deleted sessions stay deleted; a paused workout has
  the same duration on both ways in; the full import reads steps and active energy.
- **Health values:** energy for a distance without a duration; a lab value on the shown limit lies inside
  it; the BMI guard unrounded; with only a year of birth the youth profile lasts through the year of
  turning 19; lower haemoglobin limit for men 13.0 g/dL (WHO 2024); CRP, TSH and CK trends only beyond
  natural variation; weekly goal for children 60 min a day.
- **Cycle:** no question about a missing period under hormonal contraception or with the cycle switched
  off; no prediction made up between two real period starts or before the first entry; the weekly streak
  pauses on period days as it does when ill; a bleed of more than 14 days stays one period.
- **Imports:** GPX with single quotes and with several segments, TCX laps added up, day values with a
  thousands separator; in a strength import a set's effort rating is not the session's.
- **Formats:** calendar lines of at most 75 octets also with emoji, control characters removed; the date
  on reports and certificates follows the device calendar instead of UTC; the CSV export defuses an
  invalid date. The shopping list counts singular and plural as one item in all seven languages.
- **Operation:** toasts let taps through; contrast of at least 4.5:1 for race countdown, changes of
  figures, statistics, locked badges, lab percentages, neighbouring months and the demo bar; tap targets
  of at least 32 px for section actions and filter chips; the category bar scrolls instead of
  hyphenating; the effort legend is no longer German in every language.
- **Follow along** plays exactly the round the plan text names; a sentence about harder variants adds
  nothing to it, a hold exercise the plan gives in repetitions keeps them.

### Security

- The sign-in in front of the app in the Docker image is enforced for every action.
- General hardening of the server, the image and the demo.
- The published image is signed, comes with an SBOM and provenance, and is scanned for known
  vulnerabilities.

### For existing installations

- **Admins without a PIN** lose their admin rights until they set a PIN (“Today” says so). Check before
  updating whether an admin of your installation has none.
- **Calendar subscriptions without a key** (links made before keys were introduced) stop working after
  30 November 2026. Export the appointment or plan once again from the app; the export dialog explains it.
- Existing plans keep their sessions and show “New plan logic available”.
- Stored heart-rate zones from a threshold are corrected (zone 5 ≤ HRmax) the next time the zones are
  saved; an old, undated threshold pace in the profile does not count.
- The strength hint “more weight” now comes after the second session with 12 reps – whoever just changed
  over sees “once more, then increase” once.
- The image grows by a few megabytes (two trainer models, 189 voice clips). The models are fetched when a
  follow-along session is opened for the first time; after that the stage works offline.

### Known limits

- Season races only in run plans and up to 25 km; a week with a C race and fixed appointments can turn
  out very light.
- The 3D stage needs WebGL. The trainers' hair does not move, and points are not stored.

### Tests

- A browser test in CI (Chromium and WebKit, seven languages, offline start, demo, start page), a weekly
  run of all tests under a moved clock, a smoke test of the Docker image, the rules of the start page
  and the consistency of a release.
- Sync with a second device against one server; the admin's full backup against the PHP server.
- Tests on the sessions the plan generator writes (weekly sums, long-run share, distance to fixed
  appointments).
- The skeleton posing of the trainer models is checked against Blender to the millimetre; every exercise
  is posed on both models; every plan and programme text is checked against the search terms of the
  exercises.

### Documentation

- The training guide (English and German) describes strength in depth, the 3D stage, the performance
  test and the plan rules; the API description is complete; the methods table is held to the constants
  by a test; AGENTS.md states the project's rules for contributors.

## [4.1.1] – 2026-10-31

### Added

- A voluntary support link (Buy Me a Coffee) under Settings → About & legal, in all seven languages;
  it opens in a new tab without a referrer, nothing in the app depends on it, and a minor's profile
  does not show it. The README and GitHub's Sponsor button point to it as well.

## [4.1.0] – 2026-10-06

Your units: miles, pounds, °F, the first day of the week and conventional lab units – chosen per
person, stored metric.

### Added

- **Units per person** under Settings → Appearance → Units: kilometres or miles (pace in min/km or
  min/mi, elevation in metres or feet), kilograms or pounds (height in centimetres or feet and
  inches), °C or °F. Without a choice the app follows the browser's region – miles, pounds and °F in
  the United States, metric elsewhere – and saves that once, so the person keeps it on every device.
- **Everything shown follows the units:** Today, calendar, plans and their generated texts, sessions,
  statistics and charts, body values and goals, races and predictions, badges, team and family
  figures, weather and the printable reports. Storage stays metric, so switching back and forth
  changes no data; reports keep the units of the day they were written.
- **Everything typed follows them too:** logging and editing sessions, planned sessions and their
  target pace, strength sets in workout mode, a race's own distance, height, weight and target
  weight, weight goals and body values. A field saved unchanged keeps the stored value exactly.
- **First day of the week:** Monday, Saturday or Sunday (Sunday by default in the United States) –
  for the calendar, weekly figures, goals and charts. New plans start on that day; existing plans
  keep their days.
- **Conventional lab units:** lab values, ranges, trends and charts in units such as ng/mL and mg/dL
  instead of SI units (the default in the United States). Storage and ratings stay canonical.
- **Mile splits:** imported GPX and TCX runs also keep splits per mile.
- The calendar feed (.ics) and the CSV export use the person's units; the CSV headings name them.
- A help article in all seven languages on units and the first day of the week.

### Changed

- Saving a planned session with an unchanged target pace keeps its pace range instead of resetting
  the upper end to pace + 10 s.

### Documentation

- FAQ, getting started, settings, labs and training science describe the units; the README and the
  roadmap describe 4.1.

## [4.0.1] – 2026-10-06

### Added

- A help article in all seven languages on bringing strength history from Strong, Hevy or FitNotes,
  and the import described in the training guide.

### Fixed

- The in-app help names buttons, menu entries and sections exactly as the app shows them – 33 places in
  German, Italian, Brazilian Portuguese and Dutch (e.g. the German menu entry "Ziele & Pläne").
- The PIN hint for new members gives the full path Settings → Account → Change PIN.

### Documentation

- The labs guide explains when the German routes to lab values apply; the README and the comparison
  table describe 4.0.

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
