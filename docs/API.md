# Stable interfaces

These endpoints are used by programs outside the app (Health Auto Export, calendars,
monitoring, the Docker healthcheck) or by older app versions on devices. The following applies to them:

- **Change additively only:** new fields and parameters are fine – existing ones are never renamed,
  removed or changed in meaning.
- **`apiVersion`** (in `?action=ping`) only increases with an incompatible change. This
  page describes `apiVersion` **1**. Since v3.21.0, `ping` reports additional capabilities in
  `features` (e.g. `changes-all`, `ops-since`) – clients use them only if they are listed there.
- All endpoints live under `…/api/api.php`. Errors always come in the same format,
  `{"ok": false, "error": "<text>", "code": "<reason>"}`, with a matching HTTP status. `code` is
  authoritative (stable, snake_case; older codes such as `content-type` stay); since v4.0.0
  `error` is English and only a fallback – the app translates the code (`server.<code>` in its
  language catalogs). Further values of an error (for example `retryAfter`, `left`, `action`,
  `area`) arrive as additional fields of the same response. Clients should therefore branch on the
  HTTP status and `code`, not on the wording of `error`.

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
(kJ are converted to kcal).

**Health Connect (Android)** (since v3.21.0): arrays per data type with ISO timestamps, as sent by
bridge apps (e.g. “HC Webhook”) – `weight` (`kilograms`), `body_fat` (`percentage`),
`lean_body_mass`, `resting_heart_rate` (`bpm`), `heart_rate_variability` (`rmssd_millis`, stored as
RMSSD), `steps` (`count`), `active_calories` (`calories`), `sleep`
(`session_end_time`, `duration_seconds`, `stages`), `exercise` (`type`, `start_time`, `end_time`,
`duration_seconds`, `distance_meters`), `heart_rate` (`bpm`, for the average HR of the workouts),
`menstruation_period`/`menstruation_flow`. Daily values belong to the calendar day in the time zone of
the server (`CATOFIT_TZ`/`TZ`). Periods land in the private area `cycle` (only what the source
sends; period starts already logged ± 3 days stay).

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
| `POST ?action=ops&area=<area>&user=<id>` with `{"ops":[…]}` | Operations `upsert` / `delete` / `replace` (optionally with `baseRev`), at most 2000 per request; response `{ok, area, rev, records, rejected?}`. With `"since": <rev>` in the body (capability `ops-since`), `changes: {rev, records}` also comes back – all changes since that marker |
| `GET ?action=changes-all&user=<id>&since=<area>:<rev>,…` | Bulk fetch (capability `changes-all`): the changes of several areas in one response `{ok, revs, changes, locked}`; private areas without the person's own session are listed under `locked` |
| `&scope=family` instead of `&user=` | the same calls for the family (members, teams, settings, pantry) |

- `rev` is a consecutive number per area, issued by the server; the response to `ops` carries the
  **global** area `rev` (only the response to `changes`, `changes-all` or the `changes` field of an
  `ops` response with `since` is suitable as a state for `since`).
- Family responses never contain PIN hashes, only `hasPin` (plus the placeholder
  `pinHash: "server"` for older app versions).
- `rejected` lists family ops that would have needed an admin sign-in. Each entry is
  `{op, id, code, reason}`: `code` is stable (`admin_add_member`, `admin_change_role`,
  `admin_remove_member`, `admin_replace_family`), `reason` is its English text.

## Sign-in (server session)

| Call | Purpose |
|---|---|
| `POST ?action=login` with `{"user", "pin"}` | Check the PIN, open a session (cookie `catofit_sid`, HttpOnly, SameSite=Strict); response `{ok, user, role, weakPin}` |
| `POST ?action=logout` | End the session |
| `GET ?action=session` | `{ok, user, role}` of the running session (`user: null` without a session) |
| `POST ?action=set-pin` with `{"user", "pin", "old"?}` | own PIN (with the previous one) or, as an admin, that of a member |
| `POST ?action=ics-token` with `{"user"}` | Key for calendar links |

- **Private areas** (`cycle`, `labs`, `supplements`) are read and written only by the signed-in
  person themselves: without a session `401` (`code: session`), someone else's session `403` (`code: private`).
- **Writing calls** require `Content-Type: application/json` (otherwise `415`, `code: content-type`) and are
  rejected when they come from other sites (`Sec-Fetch-Site`, `403`, `code: origin`).
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
  are then kept when restoring).
- **Tables (CSV)** from “Settings → Data & backup”: sessions, body values, lab values and
  food diary, one file each – semicolon as separator, decimal comma, UTF-8 with BOM. Meant for
  further processing; only the backup can be restored.
