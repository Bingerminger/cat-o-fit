# Stabile Schnittstellen

Diese Endpunkte nutzen Programme außerhalb der App (Health Auto Export, Kalender,
Monitoring, Docker-Healthcheck) oder ältere App-Versionen auf den Geräten. Für sie gilt:

- **Nur additiv ändern:** neue Felder und Parameter ja – bestehende werden nie umbenannt,
  entfernt oder in ihrer Bedeutung geändert.
- **`apiVersion`** (in `?action=ping`) steigt nur bei einer inkompatiblen Änderung. Diese
  Seite beschreibt `apiVersion` **1**. Zusätzliche Fähigkeiten meldet `ping` seit v3.21.0 in
  `features` (z. B. `changes-all`, `ops-since`) – Clients nutzen sie nur, wenn sie dort stehen.
- Alle Endpunkte liegen unter `…/api/api.php`. Fehler kommen einheitlich als
  `{"ok": false, "error": "<Text>", "code": "<Grund>"}` mit passendem HTTP-Status.

## Für externe Programme

| Aufruf | Genutzt von | Antwort |
|---|---|---|
| `GET ?action=ping` | Docker-Healthcheck, Monitoring | `{ok, pong, apiVersion, features, time, php}` |
| `POST ?action=health-ingest&user=<id>` mit Header `X-Catofit-Token: <schlüssel>` (oder wie bisher `&token=<schlüssel>` in der URL) | Health Auto Export (JSON v2), seit v3.21.0 auch das schlanke Tagesformat (Kurzbefehl, eigene Skripte) und Android-Brücken für Health Connect | `{ok, received, health, sessions, cycle, ignoredMetrics, warnings}` |
| `GET ?action=read&user=<id>` mit Header `X-Catofit-Token: <schlüssel>`, optional `&areas=sessions,health&from=YYYY-MM-DD` | eigene Werkzeuge, etwa ein selbst betriebener KI-Assistent – nur, wenn die Person den Lesezugang eingeschaltet hat | `{ok, user, generatedAt, profile, data: {<bereich>: [...]}}`; nur lesend, ohne Zyklus, Labor und Ergänzungen |
| `GET ?action=ics&scope=event\|session\|race&id=<id>&user=<id>&token=<schlüssel>` | Kalender (iOS & Co.), auch als Abo | `text/calendar` |

**Tagesformat des Health-Eingangs** (additiv, seit v3.21.0): ein Objekt
`{"date": "YYYY-MM-DD", "weight": 72.4, "restingHr": 52, "hrv": 48, "sleepHours": 7.3, …}` oder
`{"days": [ … ]}`. Felder: `weight` (kg, mit `"weightUnit": "lb"` Pfund), `bodyFat` (%), `leanMass`
(kg), `restingHr`, `hrv` (ms, `"hrvMethod": "rmssd"` sonst SDNN), `vo2max`, `sleepHours`, `steps`,
`activeEnergyKcal`. Zahlen dürfen Text mit Dezimalkomma sein; unplausible Werte landen in
`warnings`, unbekannte Felder in `ignoredMetrics`. Pakete mit `metrics` gelten weiter als
Health-Auto-Export-Format. Details: [Apple Health](APPLE-HEALTH.md#kostenlos-per-kurzbefehl).

**Trainings im Tagesformat** (seit v3.21.0): Neben `days` darf `workouts` mitkommen – Felder wie bei
Health Auto Export: `name` (z. B. `Running`, `Cycling`), `start`, `end` oder `duration` (Sekunden),
`distanceKm` bzw. `distance` (`{qty, units}`), `avgHeartRate`, `maxHeartRate`, `activeEnergyBurned`
(kJ werden in kcal umgerechnet).

**Health Connect (Android)** (seit v3.21.0): Arrays je Datentyp mit ISO-Zeitstempeln, wie sie
Brücken-Apps (z. B. „HC Webhook“) schicken – `weight` (`kilograms`), `body_fat` (`percentage`),
`lean_body_mass`, `resting_heart_rate` (`bpm`), `heart_rate_variability` (`rmssd_millis`, als
RMSSD gespeichert), `steps` (`count`), `active_calories` (`calories`), `sleep`
(`session_end_time`, `duration_seconds`, `stages`), `exercise` (`type`, `start_time`, `end_time`,
`duration_seconds`, `distance_meters`), `heart_rate` (`bpm`, für die Ø-HF der Trainings),
`menstruation_period`/`menstruation_flow`. Tageswerte gehören zum Kalendertag in der Zeitzone des
Servers (`CATOFIT_TZ`/`TZ`). Perioden landen im privaten Bereich `cycle` (nur, was die Quelle
schickt; schon erfasste Beginne ± 3 Tage bleiben).

**Strichcode-Nachschlagen** (seit v3.21.0): `GET ?action=foodfacts&code=<EAN>` liefert wie die
Textsuche `{found, name, kcal100, protein100}`; nur gültige Strichcodes (8, 12, 13 oder 14 Ziffern
mit Prüfziffer) gehen an Open Food Facts, alles andere antwortet sofort mit `found: false`.

**Kalender-Zeitzone:** `DTSTART;TZID=…` und die `VTIMEZONE` richten sich nach `CATOFIT_TZ` bzw. `TZ`
des Servers; ohne gültige Angabe bleibt es bei `Europe/Berlin` (Ausgabe dann unverändert wie vor v3.21.0).

Kalender-Links ohne `token` (aus Versionen vor 3.20.0) gelten noch bis **30.11.2026**.
Die App erzeugt sie seitdem nur noch mit Schlüssel; wer einen alten Link abonniert hat,
richtet das Abo einmal neu ein („Abo-Link kopieren“ im Export-Dialog).

## Synchronisation (App ↔ Server)

| Aufruf | Zweck |
|---|---|
| `GET ?action=changes&area=<bereich>&user=<id>&since=<rev>` | Änderungen seit einem Stand (`{ok, area, rev, records}`; Löschungen als `deleted: true`) |
| `POST ?action=ops&area=<bereich>&user=<id>` mit `{"ops":[…]}` | Operationen `upsert` / `delete` / `replace` (optional mit `baseRev`), höchstens 2000 je Anfrage; Antwort `{ok, area, rev, records, rejected?}`. Mit `"since": <rev>` im Body (Fähigkeit `ops-since`) kommt zusätzlich `changes: {rev, records}` – alle Änderungen seit dieser Marke |
| `GET ?action=changes-all&user=<id>&since=<bereich>:<rev>,…` | Sammelabruf (Fähigkeit `changes-all`): die Änderungen mehrerer Bereiche in einer Antwort `{ok, revs, changes, locked}`; private Bereiche ohne eigene Sitzung stehen unter `locked` |
| `&scope=family` statt `&user=` | dieselben Aufrufe für die Familie (Mitglieder, Teams, Einstellungen, Lager) |

- `rev` ist eine je Bereich fortlaufende Nummer des Servers; die Antwort auf `ops` trägt die
  **globale** Bereichs-`rev` (als Stand für `since` taugt nur die Antwort auf `changes`,
  `changes-all` oder das `changes`-Feld einer `ops`-Antwort mit `since`).
- Familien-Antworten enthalten nie PIN-Hashes, sondern `hasPin` (plus den Platzhalter
  `pinHash: "server"` für ältere App-Versionen).
- `rejected` listet Familien-Ops, die eine Admin-Anmeldung gebraucht hätten.

## Anmeldung (Server-Sitzung)

| Aufruf | Zweck |
|---|---|
| `POST ?action=login` mit `{"user", "pin"}` | PIN prüfen, Sitzung öffnen (Cookie `catofit_sid`, HttpOnly, SameSite=Strict); Antwort `{ok, user, role, weakPin}` |
| `POST ?action=logout` | Sitzung beenden |
| `GET ?action=session` | `{ok, user, role}` der laufenden Sitzung (`user: null` ohne Sitzung) |
| `POST ?action=set-pin` mit `{"user", "pin", "old"?}` | eigene PIN (mit bisheriger) bzw. als Admin die eines Mitglieds |
| `POST ?action=ics-token` mit `{"user"}` | Schlüssel für Kalender-Links |

- **Private Bereiche** (`cycle`, `labs`, `supplements`) lesen und schreiben nur die angemeldete
  Person selbst: ohne Sitzung `401` (`code: session`), fremde Sitzung `403` (`code: private`).
- **Schreibende Aufrufe** verlangen `Content-Type: application/json` (sonst `415`) und werden
  von fremden Seiten abgelehnt (`Sec-Fetch-Site`, `403`, `code: origin`).
- **Admin-Aktionen** (`delete-user`, neue Mitglieder, Rollen, Mitglieder entfernen, Familie
  ersetzen) verlangen eine Admin-Sitzung.
- Nach fünf falschen PINs in 15 Minuten antwortet `login` mit `429` (`code: locked`,
  `retryAfter` in Sekunden).

## Sicherungsdateien und Tabellen

- **Mein Backup** (`exportAll`): `{app: "catofit", version: 1, exportedAt, user, userName, <bereich>: …}`.
- **Familien-Vollbackup** (`exportFamilyAll`): `{app: "catofit", kind: "family-full", version: 1,
  family: {members, settings, pantry, teams}, users: {<id>: {<bereich>: …}}}` – ohne private
  Bereiche und ohne PIN-Hashes; `teams` fehlt in Dateien vor v3.20.0 (dann bleiben die Teams
  beim Einspielen erhalten).
- **Tabellen (CSV)** aus „Einstellungen → Daten & Sicherung“: Trainings, Körperwerte, Laborwerte und
  Ess-Tagebuch, je eine Datei – Semikolon als Trenner, Dezimalkomma, UTF-8 mit BOM. Zum
  Weiterarbeiten gedacht; wiederherstellen lässt sich nur das Backup.
