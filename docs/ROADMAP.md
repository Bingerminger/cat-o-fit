# Roadmap

Planned development of Cat-O-Fit, in rough order of priority. What is already done is in the
[CHANGELOG](../CHANGELOG.md). Suggestions and help are welcome – see [CONTRIBUTING](../CONTRIBUTING.md).

**As of:** 3 October 2026, after v3.23.0.

## Next: v4.0.0 – Cat-O-Fit speaks your language

Today the app, its help and most of the documentation are German only. v4.0.0 – the first public
release – makes Cat-O-Fit multilingual from the ground up and switches development to English.

### Languages

- **Seven languages:** English, German, French, Spanish, Italian, Brazilian Portuguese (pt-BR) and
  Dutch. A new language needs a catalog file and one entry in the language list, no code.
- **Your language, per person:** every member of a family or team picks their own language. New
  members inherit the language of the instance; on the very first start the browser language decides.
  Calendar export and reports follow the person they belong to.
- **Everything inside the app is translated:** navigation, setup, every screen, the in-app help
  (71 articles), all 93 exercises with their movement cues, the 25 follow-along workouts, recipes,
  lab values and badges. Content that only applies to Germany (statutory health insurance, IGeL,
  Kölner Liste) only shows when the country is set to Germany.
- **Voice cues in every language:** the follow-along player has pre-recorded voice clips per
  language – only voices with a free licence (CC0, CC BY or public domain), credited in CREDITS.md.
- **Formats from the browser's `Intl`:** dates, weekdays, months, numbers and plural forms follow the
  chosen language. Units stay metric in v4.0.0; data are always stored metric.
- **No migration of your data:** values stored by older versions stay as they are and are shown in
  your language. Plans you create from v4.0.0 on are stored language-neutral.
- **Honest about machine translation:** translations are produced with a fixed glossary and a
  consistent informal tone, and the README says so. Corrections by native speakers are welcome via
  pull request; a translation platform follows when contributors ask for it.
- **Checked in CI:** the same keys in every language, matching placeholders, all plural forms, no
  unknown keys in the code and no hard-coded user-facing text outside the catalogs.

### English for developers

- Code comments, test names, commit messages, release notes and the developer documentation
  (architecture, development, interfaces, contributing, security) are English.
- User documentation is English first with a German edition; the other languages are served by the
  in-app help. Screenshots are rendered automatically in English and German.
- The CHANGELOG is English from v4.0.0; older entries stay in German.

### Licence: AGPL-3.0-or-later

- Cat-O-Fit is licensed under the **GNU Affero General Public License v3.0 or later**. Whoever runs
  a modified version as a network service has to offer its source code to its users.
- Contributions are accepted under the same licence (inbound = outbound), without a CLA.
- The app links to its source code in Settings → About, as the AGPL asks.
- The name and logo stay protected separately, see [TRADEMARKS](../TRADEMARKS.md).

### Also in v4.0.0

- **Public demo** – a static build on GitHub Pages with an example person and full sample data,
  language switch included; nothing leaves the browser.
- **Import from Strong, Hevy and FitNotes** – bring your strength history along via CSV; unknown
  exercises become your own exercises, nothing is dropped.
- **Community** – GitHub Discussions, English issue forms, a fixed release rhythm and
  "good first issue" tasks for translations.
- **Unraid and CasaOS** – ready-made templates, and the container image for both amd64 and arm64.

### Only what the law requires

Translated in-app notices (not a medical device, suitability check, privacy notes), the privacy
template for operators in English and German, and a credits entry for every voice and third-party
component. No imprint and no cookie banner: the operator of an instance is responsible for those,
and Cat-O-Fit sets no tracking cookies.

## After v4.0.0

### v4.1 – Imperial units and regional details

- Miles, min/mi, pounds, feet and °F as a display option – storage stays metric.
- First day of the week as a setting, lab values in conventional units (e.g. mg/dL).
- More languages on demand (Polish, Swedish, Danish, Czech, Ukrainian …), and a translation platform
  once contributors ask for one.

### v4.2 – Strength in depth

- Estimated 1RM, personal-record detection and a plate calculator.
- Rest timer per exercise, starter programmes, share a plan as a file or PDF.
- Your own exercises and saved follow-along workouts; assign a workout to a planned session.
- A male demonstrator figure as an option next to the current one.

### v4.3 – Smarter plans

- **Automatic volume tracking in the plan** – today the coach suggests a correction and you accept it
  with one tap; the plan could adjust weekly volume itself from the load signals.
- **Season planning with several races** – main and secondary races in one plan, with short tapers
  and recovery in between.
- **Strength that follows the plan phase** – strength blocks for runners that change with base,
  race-specific and taper phases.
- **Threshold pace, FTP and CSS** – use more performance diagnostics without a second pace source
  contradicting the fitness estimate.
- **Weather per session** – heat and treadmill runs count in the fitness estimate, not just in a hint.
- **Club calendars (.ics)** – take games and training sessions as fixed appointments; a server-side
  fetch only with protection against requests into the local network.

### v4.4 – Open connections

- Export in open formats (full JSON, CSV, GPX/FIT) – your data are never locked in.
- Read access for your own AI assistant instead of a built-in AI coach.
- Routes as a simple drawing without a map service.
- Cycle data from Apple Health.
- Web Push for installed PWAs (iOS 16.4+) as an optional addition to the `.ics` reminders.
- A real nutrition database next to the curated values and Open Food Facts.
- Lab catalogue with LOINC codes, mapped carefully per unit.

### Technical

- **Split `storage.js`** – state, sync, family, backup and login in separate modules behind a facade,
  so that `import * as store` stays. Only together with a load test: the sync of all data hangs on it,
  and the modules share mutable state today.
- **Incremental admin backup** – the first scaling lever from the load test: back up only what changed
  since the last backup instead of reading every area.

## v5.0.0 – Organisations: real authentication and privacy beyond 32 people

The current family and team model is **trust-based**. Since v3.20.0 the server checks the PIN, opens
a session and protects the private areas (cycle, lab values, supplements) and admin actions. All other
data are readable by every device in the network, an admin can open and manage every member, and the
team and family figures are aggregated **on the client** across all members (`teamstats.js`). That is
exactly right for a family or a small team and deliberately carries **up to 32 people**. Beyond that,
"Team & Family" becomes an **organisation** – and the model tips over. Larger or open groups (clubs
with more than 32 members, several families, public use) need a new foundation:

- **Real authentication** – a session for **all** areas, mandatory individual accounts without a
  `0000` start, slow key derivation, and keys (Health, calendar) stored only as hashes.
- **Privacy boundaries** – fine-grained visibility and roles instead of "the admin sees and opens
  everything".
- **Scalable aggregation** – team and family figures on the server or lazily instead of loading every
  member into the browser (the current `teamstats.js` model gets slow with many people on one device).
- **Optional:** invitation flows, several or larger families.

**Why exactly 32 until then?** It is the limit up to which everyone plausibly knows each other (trust
replaces strict access control) and up to which the login tiles and client-side aggregation stay
smooth on iPhone and iPad. The server handles more (proven in the load test) – 32 is a deliberate
**product and trust limit**, not a technical one. Raising it only makes sense on the v5.0.0
foundation; before that it would water down security and privacy.
