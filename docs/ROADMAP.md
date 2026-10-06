# Roadmap

Planned development of Cat-O-Fit, in rough order of priority. What is already done is in the
[CHANGELOG](../CHANGELOG.md). Suggestions and help are welcome – see [CONTRIBUTING](../CONTRIBUTING.md).

**As of:** 6 October 2026, v4.1.0.

## Done: v4.1.0 – Your units

Miles and min/mi, pounds, feet and inches, °F, the first day of the week and lab values in
conventional units such as mg/dL – chosen per person, with the browser's region as the default;
storage stays metric. Details are in the [CHANGELOG](../CHANGELOG.md).

## Done: v4.0.0 – Cat-O-Fit speaks your language

The first public release: seven languages with a language per person, server texts and recorded
voice cues in every language, English for developers, the AGPL-3.0-or-later licence, a public demo,
the import from Strong, Hevy and FitNotes, and templates for Unraid and CasaOS. Details are in the
[CHANGELOG](../CHANGELOG.md).

## After v4.1.0

### On demand

- More languages (Polish, Swedish, Danish, Czech, Ukrainian …), and a translation platform once
  contributors ask for one.

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
