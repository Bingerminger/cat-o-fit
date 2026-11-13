# Roadmap

Planned development of Cat-O-Fit, in rough order of priority. What is already done is in the
[CHANGELOG](../CHANGELOG.md). Suggestions and help are welcome – see [CONTRIBUTING](../CONTRIBUTING.md).
Deutsch: [Roadmap](de/ROADMAP.md).

**As of:** 13 November 2026, v4.1.1.

**Where to follow it:** each release has a [milestone](https://github.com/Bingerminger/cat-o-fit/milestones)
with a tracking issue, and the [board](https://github.com/users/Bingerminger/projects/2) shows what is
accepted, planned, in progress and released. Ideas go into
[Discussions › Ideas](https://github.com/Bingerminger/cat-o-fit/discussions/categories/ideas), where
everyone can vote with 👍; bugs go into an [issue](https://github.com/Bingerminger/cat-o-fit/issues/new/choose).

## In progress: v4.2 – Strength, movement and reliability

Tracking issue: [#6](https://github.com/Bingerminger/cat-o-fit/issues/6).

- **Strength in depth** – estimated 1RM, personal-record detection and a plate calculator; a rest
  timer per exercise, starter programmes, sharing a plan as a file or PDF; your own exercises and saved
  follow-along workouts; a workout assigned to a planned session.
- **More realistic follow-along animations** for every exercise, and a male demonstrator figure as an
  option next to the current one.
- **A larger exercise library** – from 93 to about 120 animated exercises, in all seven languages and
  with voice cues.
- **Smarter plans** – the plan adjusts weekly volume itself from the load signals (today the coach
  suggests a correction that you accept with one tap); a season with several races (main and secondary
  races, short tapers and recovery in between); strength blocks that follow the plan phase (base,
  race-specific, taper).
- **Threshold pace, FTP and CSS** from a performance test, without a second pace source contradicting
  the fitness estimate; **weather per session** – heat and treadmill runs count in the fitness estimate,
  not just in a hint.
- **Reliability** – sync between devices, starting without network, the plan generator, imports and
  cycle and lab values at the edges; a reworked interface (contrast, focus, screen readers, empty views).
- **Technical** – `storage.js` split into modules behind a facade (with a load test), an incremental
  admin backup, tests in real browsers (Chromium and Safari's engine) and under a moved clock, and a
  signed Docker image with a software bill of materials.

## Done: v4.1.0 – Your units

Miles and min/mi, pounds, feet and inches, °F, the first day of the week and lab values in
conventional units such as mg/dL – chosen per person, with the browser's region as the default;
storage stays metric. Details are in the [CHANGELOG](../CHANGELOG.md).

## Done: v4.0.0 – Cat-O-Fit speaks your language

The first public release: seven languages with a language per person, server texts and recorded
voice cues in every language, English for developers, the AGPL-3.0-or-later licence, a public demo,
the import from Strong, Hevy and FitNotes, and templates for Unraid and CasaOS. Details are in the
[CHANGELOG](../CHANGELOG.md).

## After v4.2

### v4.3 – Calendars and routes

- **Club calendars (.ics)** – take games and training sessions as fixed appointments; a server-side
  fetch only with protection against requests into the local network.
- **GPX/FIT export** of your own activities. (A full JSON backup, the CSV export and read access for
  your own tools such as an AI assistant already exist.)
- **Routes as a simple drawing** without a map service.

### v4.4 – Open connections

- Cycle data from Apple Health.
- Web Push for installed PWAs (iOS 16.4+) as an optional addition to the `.ics` reminders.
- A real nutrition database next to the curated values and Open Food Facts.
- Lab catalogue with LOINC codes, mapped carefully per unit; new analytes such as glucose and cholesterol.

### On demand

- More languages (Polish, Swedish, Danish, Czech, Ukrainian …), and a translation platform once
  contributors ask for one.

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
