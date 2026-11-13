# Stable interfaces

These endpoints are used by programs outside the app (Health Auto Export, calendars,
monitoring, the Docker healthcheck) or by older app versions on devices. The following applies to them:

- **Change additively only:** new fields and parameters are fine – existing ones are never renamed,
  removed or changed in meaning.
- **`apiVersion`** (in `?action=ping`) only increases with an incompatible change. This
  page describes `apiVersion` **1**. Since v3.21.0, `ping` reports additional capabilities in
  `features` (`changes-all`, `ops-since`, since v4.2 `merge-ops`) – clients use them only if they are listed there.
- All endpoints live under `…/api/api.php`. Errors always come in the same format,
  `{"ok": false, "error": "<text>", "code": "<reason>"}`, with a matching HTTP status. `code` is
  authoritative (stable, snake_case; older codes such as `content-type` stay); since v4.0.0
  `error` is English and only a fallback – the app translates the code (`server.<code>` in its
  language catalogs). Further values of an error (for example `retryAfter`, `left`, `action`,
  `area`) arrive as additional fields of the same response. Clients should therefore branch on the
  HTTP status and `code`, not on the wording of `error`. One exception: `?action=ics` answers errors
  as `text/plain` in the person's language (the link opens in a browser or calendar, not in the app).

## For external programs

| Call | Used by | Response |
|---|---|---|
| `GET ?action=ping` | Docker healthcheck, monitoring | `{ok, pong, apiVersion, features, time, php}` |
| `POST ?action=health-ingest&user=<id>` with header `X-Catofit-Token: <key>` (or, as before, `&token=<key>` in the URL) | Health Auto Export (JSON v2); since v3.21.0 also the lean daily format (Shortcut, own scripts) and Android bridges for Health Connect | `{ok, received, health, sessions, cycle, ignoredMetrics, warnings}` |
| `GET ?action=read&user=<id>` with header `X-Catofit-Token: <key>`, optionally `&areas=sessions,health&from=YYYY-MM-DD` | your own tools, such as an AI assistant you run yourself – only if the person has switched read access on | `{ok, user, generatedAt, profile, data: {<area>: [...]}}`; read-only, without cycle, labs and supplements |
| `GET ?action=ics&scope=event\|session\|race&id=<id>&user=<id>&token=<key>` | calendars (iOS and others), also as a subscription | `text/calendar` |

**Daily format of the health intake** (additive, since v3.21.0): an object
`{"date": "YYYY-MM-DD", "weight": 72.4, "restingHr": 52, "hrv": 48, "sleepHours": 7.3, …}` or
`{"days": [ … ]}`. Fields: `weight` (kg, pounds with `"weightUnit": "lb"`), `bodyFat` (%), `leanMass`
(kg), `restingHr`, `hrv` (ms, `"hrvMethod": "rmssd"` otherwise SDNN), `vo2max`, `sleepHours`, `steps`,
`activeEnergyKcal`. Numbers may be text with a decimal comma; implausible values end up in
`warnings`, unknown fields in `ignoredMetrics`. Packages with `metrics` continue to be treated as
Health Auto Export format. Details: [Apple Health](usage/apple-health.md#free-with-a-shortcut).

**Workouts in the daily format** (since v3.21.0): `workouts` may come along with `days` – fields as in
Health Auto Export: `name` (e.g. `Running`, `Cycling`), `start`, `end` or `duration` (seconds),
`distanceKm` or `distance` (`{qty, units}`), `avgHeartRate`, `maxHeartRate`, `activeEnergyBurned`
(kJ are converted to kcal); since 4.2 also `isIndoor` / `location` (`"Indoor"`) and `temperature`
(`{qty, units: "degF"|"degC"}`, the air temperature during the workout). A workout sent again (same id)
keeps what the person added in the app; one deleted there stays deleted.

**Fields added in 4.2 (additive):** sessions may carry `indoor: true` and `tempC` (air temperature in
°C during the session); a pace typed per mile is stored to a tenth of a second per km. The profile may
carry `thresholdPaceSecPerKm`/`thresholdPaceDate`, `ftpW`/`ftpDate`, `cssSecPer100m`/`cssDate` (read
access includes them) and `settings.autoVolume`. Plans may carry `strengthDays` (0–2), `sideRaces`
(`[{eventId, date, priority, name, distanceKm, targetTime}]`), `autoVolume` (`{week, factor, date}`);
sessions of a plan may carry `sideRace` (`"B"`/`"C"`), `autoVolume` (the factor) and `manual: true`.
Strength (4.2): `settings.restByExercise` (`{exerciseId: seconds}`), `settings.customExercises`
(`[{id, name, category, hold, gear, notes, art}]`) and `settings.customWorkouts`
(`[{id, title, items: [exerciseId], work, rest, rounds}]`); a planned session may carry `workoutId`
(a catalogue workout or an own one); `strengthSets` may name an own exercise by its `exerciseId`.
Programmes may have the types `starterHome` and `starterGym`.

**Health Connect (Android)** (since v3.21.0): arrays per data type with ISO timestamps, as sent by
bridge apps (e.g. “HC Webhook”) – `weight` (`kilograms`), `body_fat` (`percentage`),
`lean_body_mass`, `resting_heart_rate` (`bpm`), `heart_rate_variability` (`rmssd_millis`, stored as
RMSSD), `steps` (`count`), `active_calories` (`calories`), `sleep`
(`session_end_time`, `duration_seconds`, `stages`), `exercise` (`type`, `start_time`, `end_time`,
`duration_seconds`, `distance_meters`), `heart_rate` (`bpm`, for the average HR of the workouts),
`menstruation_period`/`menstruation_flow`. Daily values belong to the calendar day in the time zone of
the server (`CATOFIT_TZ`/`TZ`). Periods land in the private area `cycle` (only what the source
sends; period starts already logged ± 3 days stay).

**Food lookup:** `GET ?action=foodfacts&q=<text>` (text search, at most 64 characters) returns
`{found, name, kcal100, protein100, source, samples}` – the median of at least two products. Since 4.2
only with the person's session (otherwise `401`, `code: session`) and with their switch “add nutritional
values online” on (otherwise `{found: false, disabled: true}`, nothing leaves the server).
**Barcode lookup** (since v3.21.0): `GET ?action=foodfacts&code=<EAN>` returns, like the
text search, `{found, name, kcal100, protein100}`; only valid barcodes (8, 12, 13 or 14 digits
with a check digit) go to Open Food Facts, anything else answers immediately with `found: false`.
Since v4.0.0 the server queries `world.openfoodfacts.org` with `lc=<language>` (the app sends its
language, optionally `cc=<country>`); without `lc` the language of the instance applies.

**Calendar time zone:** `DTSTART;TZID=…` and the `VTIMEZONE` follow `CATOFIT_TZ` or `TZ`
of the server; without a valid value it stays at `Europe/Berlin` (the output is then unchanged from before v3.21.0).

**Calendar language** (since v4.0.0): labels, reminders and the file name follow the language of the
person (their own choice, otherwise the instance default, German for instances from before v4.0.0).

Calendar links without `token` (from versions before 3.20.0) remain valid until **30 November 2026**.
Since then the app only creates them with a key; if you subscribed to an old link,
set up the subscription once more (“Copy subscription link” in the “Export to calendar” dialog).

## Synchronisation (app ↔ server)

| Call | Purpose |
|---|---|
| `GET ?action=changes&area=<area>&user=<id>&since=<rev>` | Changes since a given state (`{ok, area, rev, records}`; deletions as `deleted: true`) |
| `POST ?action=ops&area=<area>&user=<id>` with `{"ops":[…]}` | Operations `upsert` / `delete` / `replace` (optionally with `baseRev`) and – for `area=profile` only, capability `merge-ops` – `merge` (the given fields replace the stored ones, `settings` is merged per key, everything else stays; elsewhere it is rejected with `merge_not_allowed`), at most 2000 per request; response `{ok, area, rev, records, rejected?}`. With `"since": <rev>` in the body (capability `ops-since`), `changes: {rev, records}` also comes back – all changes since that marker |
| `GET ?action=changes-all&user=<id>&since=<area>:<rev>,…` | Bulk fetch (capability `changes-all`): the changes of several areas in one response `{ok, revs, changes, locked}`; private areas without the person's own session are listed under `locked` |
| `&scope=family` instead of `&user=` | the same calls for the family (members, teams, settings, pantry) |

- `rev` is a consecutive number per area, issued by the server; the response to `ops` carries the
  **global** area `rev` (only the response to `changes`, `changes-all` or the `changes` field of an
  `ops` response with `since` is suitable as a state for `since`).
- Family responses never contain PIN hashes, only `hasPin` (plus the placeholder
  `pinHash: "server"` for older app versions).
- `rejected` lists every op that was not applied – nothing is dropped silently (since v4.2). Each entry
  is `{op, id, code, reason}`: `code` is stable – family ops that would have needed an admin sign-in
  (`admin_add_member`, `admin_change_role`, `admin_remove_member`, `admin_replace_family`), and for
  every area `invalid_op` (not an object), `invalid_id` (missing, or not `[A-Za-z0-9_:.-]{1,128}`),
  `invalid_records` (`replace` without a list), `unknown_op` and `merge_not_allowed`; `reason` is
  English text. The valid ops of the same request are applied.
- A missing or invalid `user` for a person's area answers `400 invalid_or_missing_user`; a value JSON
  cannot store (e.g. `1e400`) `400 invalid_ops`; a query parameter given twice `400 invalid_parameter`.
  An error nobody expected (for example a damaged data file) answers `500 server_error` in the same
  format; the details go to the server log, never into the response.

## Sign-in (server session)

| Call | Purpose |
|---|---|
| `POST ?action=login` with `{"user", "pin"}` | Check the PIN, open a session (cookie `catofit_sid`, HttpOnly, SameSite=Strict); response `{ok, user, role, weakPin, adminPinRequired}` – since 4.2 `role` is `admin` only for an admin with a PIN; without one, `adminPinRequired: true` and the rights of a member until they set their own PIN (no old one needed) |
| `POST ?action=logout` | End the session |
| `GET ?action=session` | `{ok, user, role}` of the running session (`user: null` without a session) |
| `POST ?action=set-pin` with `{"user", "pin", "old"?}` | own PIN (with the previous one) or, as an admin, that of a member |
| `POST ?action=ics-token` with `{"user", "rotate"?}` | Key for calendar links: `{ok, token}`; with `"rotate": true` a new key (old links stop working) |
| `POST ?action=health-import` (multipart, field `file`: ZIP of the Apple Health export or its `export.xml`) | Full import, evaluated on the server and taken over by the app: `{ok, summary: {workouts, healthDays, sleepNights, periods}, workouts, health, periods}` |
| `POST ?action=delete-user&user=<id>` | Delete a person's data (admin session): `{ok, deleted}` |

- **Private areas** (`cycle`, `labs`, `supplements`) are read and written only by the signed-in
  person themselves: without a session `401` (`code: session`), someone else's session `403` (`code: private`).
- **Writing calls** require `Content-Type: application/json` (otherwise `415`, `code: content-type`) and are
  rejected when they come from other sites (`Sec-Fetch-Site`, `403`, `code: origin`). Two exceptions:
  `health-import` is a file upload (multipart), and `health-ingest` takes any content type – it is not
  opened with the session cookie but with the person's key, so bridge apps can send what they send.
- **Admin actions** (`delete-user`, new members, roles, removing members, replacing the
  family) require an admin session (`delete-user` answers `403`, `code: admin`; family ops that
  lack it are listed in `rejected`, see above).
- A wrong PIN answers `401` (`code: pin`, `left`: attempts remaining before the lock). After five
  wrong PINs in 15 minutes, `login` answers `429` (`code: locked`, `retryAfter` in seconds).

## Backup files and tables

- **My backup** (`exportAll`): `{app: "catofit", version: 1, exportedAt, user, userName, <area>: …}`.
- **Full family backup** (`exportFamilyAll`): `{app: "catofit", kind: "family-full", version: 1,
  family: {members, settings, pantry, teams}, users: {<id>: {<area>: …}}}` – without private
  areas and without PIN hashes; `teams` is missing in files from before v3.20.0 (the teams
  are then kept when restoring). Since 4.2 `incomplete: [{user, area, from}]` lists areas the server did
  not hand out (`from`: `device` = this device's copy, maybe older; `missing`) – the app says so too.
- **Tables (CSV)** from “Settings → Data & backup”: sessions, body values, lab values and
  food diary, one file each, UTF-8 with BOM, date as `YYYY-MM-DD`. The format follows the language: with
  a decimal comma (German, French …) semicolon-separated, with a decimal point (English)
  comma-separated. Meant for further processing; only the backup can be restored.
- **Logical view** (debug and older clients): `GET ?area=<area>&user=<id>` (or `&scope=family`) returns
  `{ok, area, data}` – the area as a list or object, with the same access rules as `changes`.
