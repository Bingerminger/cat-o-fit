# Architektur

Dieses Dokument beschreibt den Aufbau von Cat-O-Fit für Entwickler:innen. Für die
Einrichtung und den Arbeitsablauf siehe [ENTWICKLUNG.md](ENTWICKLUNG.md), für die
Bedienung das [Benutzerhandbuch](BENUTZERHANDBUCH.md).

## Leitplanken

- **Keine Abhängigkeiten, kein Build.** Vanilla JS (ES-Module), CSS, schlankes PHP.
  Was im Repo liegt, läuft direkt im Browser.
- **Local-first.** Jede Änderung landet sofort im LocalStorage; ein Hintergrund-Sync
  schreibt sie auf den Server. Die App ist offline voll bedienbar.
- **Keine Datenbank.** Persistenz sind JSON-Dateien unter `data/`.
- **Reine Logik ist DOM-frei und testbar.** Berechnungen leben in Modulen ohne
  DOM-Zugriff und werden per `node:test` abgedeckt.
- **Datenschutz ist Teil der Architektur.** Zyklusdaten sind strikt privat
  (nie im Team-/Familien-Dashboard, nie für Admins, nicht im Fremd-Export).

## Schichten

```
┌─────────────────────────────────────────────────────────────┐
│  index.html  ·  App-Shell (PWA, iOS-Meta, lädt js/app.js)    │
├─────────────────────────────────────────────────────────────┤
│  app.js · router.js        Bootstrap, Hash-Routing, Guard    │
├─────────────────────────────────────────────────────────────┤
│  View-Module (rendern ins #view-Element)                     │
│  dashboard · calendar · events · plans · program · session   │
│  health · statistics · nutrition · shopping · checklist      │
│  cycle · settings · family · family-admin · badges · help    │
├─────────────────────────────────────────────────────────────┤
│  Reine Logik (DOM-frei, unit-getestet)                       │
│  fitness · energy · food · planflow · vdot · gpx · program    │
│  adaptive · suggestions                                       │
├─────────────────────────────────────────────────────────────┤
│  UI-Bausteine        ui.js (el, Icons, Helfer) · charts.js   │
├─────────────────────────────────────────────────────────────┤
│  Datenschicht        storage.js (State, Sync) · api-client   │
├─────────────────────────────────────────────────────────────┤
│  Backend (PHP)       api/api.php · storage.php · ics.php ·   │
│                      health-import.php                        │
├─────────────────────────────────────────────────────────────┤
│  Persistenz          data/users/<id>/<area>.json             │
│                      data/family/<area>.json                 │
└─────────────────────────────────────────────────────────────┘
```

## Routing & Bootstrap

- `app.js` bootet die App: registriert die Routen, baut die Navigation (`PRIMARY_NAV`,
  `MORE_NAV`), setzt den Router-Guard und startet den ersten Sync.
- `router.js` ist ein **Hash-Router** (`#/pfad`). `register(path, handler)` bindet eine
  View, `setGuard(fn)` schützt Routen (z. B. erzwingt Login → `#/family`). Parameter wie
  `#/session/:id` werden an den Handler übergeben.
- Views bekommen das `#view`-Element und füllen es; der Header wird über `setHeader(...)`
  gesetzt (Titel, Untertitel, Zurück, Aktionen).
- **Anmelde-Gate (seit v3.2.0, erweitert v3.3.0):** Ohne angemeldeten Nutzer ist nur `#/login`
  erreichbar und die Menüs sind ausgeblendet (`body.is-anon`). Die reine Entscheidung liegt DOM-frei in
  `js/session-gate.js` (`gate()`, `menusVisible()`, `needsSetup()`); `app.js` setzt sie im Guard und per
  `onAfterRender` (`applyAuthChrome`) um. **Kein Auto-Login** – beim Start ist niemand angemeldet.
- **Login vs. Dashboard getrennt (v3.3.0):** `js/login.js` (`/login`, abgemeldet) zeigt entweder die
  **Ersteinrichtung** (leere Familie → `createFirstAdmin`, optional `seedDemo`) oder die **Profilauswahl**.
  `js/family.js` (`/family`, Menü „Team/Familie") ist das **angemeldete Team-Dashboard** mit Team-Badges
  (`js/teamstats.js`, DOM-frei). Verwaltung/Reset liegen admin-only in den Einstellungen.

## Datenschicht (`storage.js`)

Das Herzstück. Hält den State je **Bereich** (Area) und kümmert sich um LocalStorage,
Sync und Mehrbenutzer-Kontext.

- **Bereiche (`AREAS`):** `profile` (Objekt) plus die Listen-Bereiche `events`, `plans`,
  `sessions`, `health`, `nutrition`, `diary`, `shopping`, `checklist`, `cycle`, `reports`
  (`ARRAY_AREAS`). **Invariante:** `ARRAY_AREAS` = `AREAS` ohne `profile`. Eine neue Area
  muss in `storage.js` **und** in `api/storage.php` (`user_areas`) eingetragen werden.
- **Versiegelte Bereiche (`SEALED_AREAS`, z. B. `reports`):** append-only. `upsert/patch/
  remove` sind wirkungslos; der einzige Schreibweg ist `addReport()` – für Urkunden/Reports,
  die als Beleg unveränderlich bleiben müssen.
- **Strikt private Bereiche (`PRIVATE_AREAS`, z. B. `cycle`):** nie in einem Fremd-Export,
  nie für eine verwaltende Admin-Person sichtbar.
- **CRUD:** `get/find/upsert/patch/remove/replaceArea`. Records tragen `id`, Löschungen
  sind **Tombstones** (`deleted: true`) für den Sync.
- **Mehrbenutzer:** `identity` = angemeldete Person (**nur in dieser Sitzung** – ab v3.2.0 kein
  Auto-Login, `catofit:identity` wird nicht mehr gemerkt), `activeUser` = gerade betrachtete Person.
  Sind sie verschieden, **verwaltet** ein Admin ein Mitglied (`isManaging()`), und Privates (Zyklus)
  bleibt verborgen. `login()` setzt `identity`, `logout()` verwirft sie und den geladenen Speicher.
- **Familienweite Daten:** Die Sicht `family` (Mitglieder, `pantry`, `settings`) wird aus den
  Familien-Datensätzen **abgeleitet** (`members/familyPantry/familySettings`); Schreibzugriffe
  (`addMember/updateMember/removeMember/setFamilyPantry/setFamilySetting`) erzeugen
  Einzel-Ops (per-Mitglied-Merge, s. u.).
- **Persönliches Backup:** `exportAll()` (mit App-Kennung, Version, Profilbezug) und
  `importAll()` (validiert App/Version/Typen, private Bereiche bleiben beim Verwalten außen vor).
  Sichert die Daten der **aktiven Person** – inkl. ihrer privaten Zyklusdaten.
- **Admin-Vollbackup (Notfall-Recovery):** `exportFamilyAll()` / `importFamilyAll()` (nur
  Admin). Bündelt die Familienkonfiguration **und** je Mitglied alle Bereiche – außer den
  strikt privaten (`cycle`). Die Wiederherstellung ist **autoritativ**: sie überschreibt
  Familie und alle enthaltenen Mitglieder-Bereiche server- und lokalseitig (per **`replace`-Op**
  je Nutzer). Schutz: das Backup muss mindestens eine Admin-Person enthalten (kein Aussperren);
  private Zyklusdaten bleiben dabei **unangetastet** erhalten.

### Sync-Modell (server-autoritativ, seit v3.0.0)

Der **Server ist die Merge-Autorität** (Option B). Clients schicken **Operationen** statt
ganzer Arrays; der Server vergibt je Datensatz eine streng monotone **`rev`** und einen
Server-Zeitstempel. Das beseitigt Geräte-Uhr-Abhängigkeit und Ganzarray-Races.

- `api-client.js` kapselt **`pushOps(area, ops, {user|scope})`** und
  **`pullChanges(area, {user|scope, since})`**; `apiGet` liefert nur noch die logische Sicht
  (Backup/Peek). Die persistente **Op-Queue** lebt im Store (pro Nutzer+Bereich), nicht im
  api-client.
- **Schreiben:** `upsert/patch/remove/replaceArea` ändern den State optimistisch und legen
  eine Op (`upsert`/`delete`/`replace`) in die Queue. **Löschungen** sind Tombstones.
- **Sync je Bereich:** **erst eigene Ops PUSHEN** (lokale Edits bekommen eine `rev`), **dann
  Änderungen seit der bekannten `rev` PULLEN**. Beim Pull gewinnt ein Datensatz nur, wenn die
  server-`rev` höher ist → konkurrierende Edits **verschiedener** Datensätze gehen nie
  verloren; beim **selben** Datensatz gewinnt deterministisch der zuletzt am Server
  angekommene Schreibvorgang.
- **Wechsel-Sicherheit (Mehrbenutzer):** `syncNow()` **fixiert den Nutzer** je Durchlauf
  (In-Flight-Guard, einmaliger Nachlauf); `pushArea` ist **an den Nutzer gebunden** und
  schreibt dessen Ops nutzergenau (auch nach einem Sichtwechsel).
- **Familien-Merge pro Datensatz:** Die Familie ist eine Sammlung von Datensätzen – je
  Mitglied ein Record, plus `__settings` und `__pantry`. Mitglieder mischen daher **pro
  Mitglied**: Legen zwei Admins gleichzeitig auf zwei Geräten je ein Mitglied an, bleiben
  **beide** erhalten (früher konnte das Ganzobjekt-LWW eines still verlieren).
- **Persistenz lokal:** `catofit:<user>:<area>` (Datensätze), `catofit:<user>:__meta`
  (`{revs, ops}`), `catofit:familyStore` (`{rev, records, ops}`). Die **Anmeldung wird nicht
  persistiert** (kein Auto-Login, ab v3.2.0); ein evtl. alter `catofit:identity` wird beim Start verworfen.

## Trainingspläne: zwei Generatoren

- **Wettkampf** (`plans.js`): `createPlanForEvent(event)` erzeugt einen **periodisierten**
  Plan bis zum Wettkampftag – Phasen (`makePhases`), Wochengerüst je Sportart, Zielpaces
  aus der Zielzeit (`vdot.js`).
- **Programm** (`program.js`): `createProgramPlan(program, today)` erzeugt einen
  **wiederkehrenden** Wochenplan ohne Wettkampf (Fitness/Kraft/Abnehmen/Beweglichkeit).
- Beide liefern **dasselbe Plan-/Unit-Format** (`planId`, `date`, `type`, `dur`/`pace`, …).
  Dadurch zeigen Kalender, Session-Ansicht, Workout-Modus und Statistik beides ohne
  Sonderfall. Unterschieden wird über `plan.kind === 'program'`.
- **Distanzspezifisch:** `distanceEmphasis(raceKm)` (plans.js) steuert die Schlüsseleinheiten je
  Distanz (5 km → kurze VO₂max-Reize, Marathon → Schwelle/Renntempo …).

## Adaptiver Coach & weitere Module (DOM-frei + getestet)

Reine Logik in argument-basierten, testbaren Modulen; die Views konsumieren sie nur:

- **planflow.js:** adaptive Vorschläge – u. a. `weekVolumeBalance` (automatischer Wochenumfang-Ausgleich)
  und `rpeProgression` (Progressionssteuerung aus dem RPE-Trend). Surfacing als Coach-Karten in `dashboard.js`
  (mit „Übernehmen" via `saveUnitPatch`).
- **load.js:** Belastungssteuerung nach Profistandard – **ACWR** (7:28, Sweet-Spot 0,8–1,3), **CTL/ATL/TSB**
  (Banister/PMC) und **Monotonie/Strain** (Foster) aus der sRPE-Last (Dauer × RPE, sportartübergreifend).
  Dashboard-Karte „Belastung & Form" (`charts.js multiLineChart`).
- **commitments.js:** feste Termine – konfigurierbare Fußballtage (Tage/Dauer/**Intensität**) + wiederkehrende
  Spiele mit Datumsbereich; der Generator (`plans.js`) plant **um** sie herum. Fußball zählt ab „normal" als
  fordernd (`fitness.footballRpe`, `planflow.isHard`), fließt voll in die Last ein und entlastet den Folgetag.
- **rolling.js:** rollierende Planung – automatischer Erholungstag aus der Belastung; `gentleVariant`
  (typ-bewusste Entschärfung) und `footballFollowupEase`. Bei zwei Zielen nimmt der Vorschlag den **ganzen Tag**
  zurück (`planflow.dayLoadUnits`); `triage.destackSuggestion` entzerrt Stapel auf einen freien Tag.
- **adapt.js:** zentraler Anwende-/Rückgängig-Kern (`applyAdapt`/`undoAdapt`) mit Transparenz-Log `plan.adaptLog`
  – genutzt von Dashboard-Karten **und** `cycle.js` (Auto-Entschärfung des Trainings am 1. Periodentag).
- **triage.js + whatif.js:** Wochen-Check (Kollisionen priorisieren: feste Termine → Schlüssel-Läufe → Kraft
  → Umfang) bzw. What-if-Vorschau der Auswirkung auf die Wochenbelastung vor dem Hinzufügen/Verschieben.
- **dualgoal.js:** Ziel-Cockpit (Halbmarathon-Leistung + Abnehmen) mit phasenabhängigem Schwerpunkt,
  Defizit-Empfehlung (Ernährungskopplung) und ehrlichem Reiz-Check.
- **teamstats.js:** Team-/Familien-Aggregation (DOM-frei) – Kennzahlen je Team über `filterTeamMembers`/
  `teamlessMembers`; Teams sind `_kind:'team'`-Records in `family.json` mit Mehrfach-Mitgliedschaft
  (`MAX_MEMBERS = 32` seit v3.13.0 — bewusste Obergrenze des vertrauensbasierten Modells: Familie/kleines
  Team mit PIN-Login statt echter Auth, Admin verwaltet/„öffnet" alle, Team-Aggregation client-seitig. Das
  trägt komfortabel bis ~32 (großer Haushalt + Freunde, oder Verein mit Sub-Teams). Darüber wird es eine
  **Organisation** — dann braucht es echte Authentifizierung, verbindliche Privacy-Grenzen und skalierbare
  Aggregation; dieser Modellwechsel ist für **v4.0.0** vorgesehen, siehe `docs/ROADMAP.md`).
- **goals.js:** dedizierte Gesundheits-/Gewichtsziele (`goalProgress`/`goalsProgress`/`latestMetric`),
  gespeichert in `profile.settings.healthGoals`; Fortschrittskarte auf „Heute", Verwaltung in `settings.js`.
- **exercises.js + exercise-art.js:** Übungs-Bibliothek – Katalog + Filter (DOM-frei) und **symbolhafte
  SVG-Illustrationen** (selbst gezeichnete Strichfiguren, `currentColor`). View unter `#/uebungen`.

## Backend (PHP)

Bewusst minimal, aber seit v3.0.0 **Merge-Autorität** – nur Persistenz, Op-Anwendung und
zwei Importe/Exporte:

- `api/api.php` – Routing: `?action=changes` (GET, inkrementelle Datensätze ab `since`-rev),
  `?action=ops` (POST `{ops:[…]}`, wendet `upsert`/`delete`/`replace` an), `?area=` (GET,
  logische Sicht für Debug/`.ics`), plus `ping`, `delete-user`, `ics`, `health-import`.
  `userId`-Whitelist (`^[A-Za-z0-9_-]{1,64}$`), Datensatz-ID-Whitelist.
- `api/storage.php` – Store-Format `{rev, records:{id→record}}` je Area. `apply_ops()` läuft
  unter exklusivem Lock, vergibt je Op eine **monotone `rev`** + Server-Zeitstempel und schreibt
  **atomar** (Temp-Datei → `rename`). `changes_since()` liefert alle Datensätze mit `rev>since`.
  **Migration** (alt→Store) erfolgt deterministisch beim ersten Lesen; `ensure_bootstrap()`
  migriert vorhandene **Legacy-Single-User-Daten** zum ersten Admin – legt aber bei einer **frischen**
  Installation (ab v3.3.0) **niemanden** mehr automatisch an (leere Familie → Ersteinrichtung im Client).
- `api/ics.php` – `.ics`-Kalenderexport (RFC 5545, VALARM) je Nutzer.
- `api/health-import.php` – Streaming-Parsing des Apple-Health-Exports (XMLReader).

`data/.htaccess` (Deny from all) schützt die JSON-Dateien vor direktem Webzugriff;
Laufzeit-Ordner (`data/users`, `data/family`, `.bootstrap.lock`) sind in `.gitignore`.

## Service Worker & PWA

- `service-worker.js` cacht die **App-Shell** (`SHELL_ASSETS`) – network-first mit
  Revalidierung. Beim Veröffentlichen einer Änderung die `VERSION` (Cache-Name) erhöhen.
- **Single Source of Truth** der App-Version: `js/version.js` (parallel `package.json`).

## Tests

`node:test` (kein Fremd-Runner). `test-setup.js` stellt ein abhängigkeitsfreies
**Mini-DOM** und `localStorage`-Shim bereit, sodass sowohl reine Logik als auch ganze
`render()`-Funktionen getestet werden. Siehe `test/*.test.js` und
[ENTWICKLUNG.md](ENTWICKLUNG.md#tests).
