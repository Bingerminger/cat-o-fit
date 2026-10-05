# Architektur

Dieses Dokument beschreibt den Aufbau von Cat-O-Fit für Entwickler:innen. Für die
Einrichtung und den Arbeitsablauf siehe [ENTWICKLUNG.md](ENTWICKLUNG.md), für die
Bedienung die [Dokumentation](README.md).

## Leitplanken

- **Keine Abhängigkeiten, kein Build.** Vanilla JS (ES-Module), CSS, schlankes PHP.
  Was im Repo liegt, läuft direkt im Browser.
- **Local-first.** Jede Änderung landet sofort im LocalStorage; ein Hintergrund-Sync
  schreibt sie auf den Server. Die App ist offline voll bedienbar.
- **Keine Datenbank.** Persistenz sind JSON-Dateien unter `data/`.
- **Reine Logik ist DOM-frei und testbar.** Berechnungen leben in Modulen ohne
  DOM-Zugriff und werden per `node:test` abgedeckt.
- **Datenschutz ist Teil der Architektur.** Die privaten Bereiche – Zyklus (`cycle`), Labor
  (`labs`) und Ergänzung (`supplements`) – sind strikt privat: nie im Team-/Familien-Dashboard, nie
  für Admins, nicht im Vollbackup, und der Server gibt sie nur an die angemeldete Person heraus.

## Schichten

```
┌─────────────────────────────────────────────────────────────┐
│  index.html  ·  App-Shell (PWA, iOS-Meta, lädt js/app.js)    │
├─────────────────────────────────────────────────────────────┤
│  app.js · router.js        Bootstrap, Hash-Routing, Guard    │
├─────────────────────────────────────────────────────────────┤
│  View-Module (rendern ins #view-Element)                     │
│  dashboard · calendar · events · plans · session · workout   │
│  dashboard-goals · dashboard-coach                           │
│  health · statistics · nutrition · shopping · checklist      │
│  cycle · labs-view · settings · family · family-admin        │
│  badges · reports · help (+ helpcontent) · login · capture   │
├─────────────────────────────────────────────────────────────┤
│  Reine Logik (DOM-frei, unit-getestet)                       │
│  load · coach · fitness · vdot · plangen · planflow · program │
│  energy · eligibility · labs · supplements · redflags · gpx   │
│  fit · zip · activity-import · strength · barcode             │
│  csv-export · workout-engine · sollist · helpcontent          │
│  labsources · nav · unit-actions …                            │
├─────────────────────────────────────────────────────────────┤
│  UI-Bausteine        ui.js (el, Icons, Helfer) · charts.js   │
├─────────────────────────────────────────────────────────────┤
│  Datenschicht        storage.js (State, Sync) · api-client   │
├─────────────────────────────────────────────────────────────┤
│  Backend (PHP)       api/api.php · storage.php · auth.php ·  │
│                      ics.php (+ icstz) · health-ingest/-map · │
│                      health-import/-xml · foodfacts.php ·    │
│                      read-access.php                         │
├─────────────────────────────────────────────────────────────┤
│  Persistenz          data/users/<id>/<area>.json             │
│                      data/family/<area>.json · data/auth/    │
└─────────────────────────────────────────────────────────────┘
```

## Routing & Bootstrap

- `app.js` bootet die App: lädt den **lokalen** Stand, zeichnet sofort und startet den Abgleich
  im Hintergrund (seit v3.20.0; vorher wartete der Start auf den Server). Es registriert die
  Routen, baut Tab-Leiste, Mehr-Sheet und Seitenleiste und setzt den Router-Guard.
- **Menüstruktur (`nav.js`, seit v3.20.0):** `TAB_ITEMS` (Heute · Kalender · ＋ Erfassen ·
  Fortschritt · Mehr), `PROGRESS_TABS` (Reiter über die Routen `/stats`, `/health`, `/badges`,
  `/reports`), `MORE_GROUPS` (gegliedertes „Mehr“), `navMatches()` (Route → Eintrag für die aktive
  Markierung), `navVisible()` (Module, Admin, Verwalten) und `accountBlock()` (immer die
  **angemeldete** Person, beim Verwalten „verwaltet gerade: …“ samt „Zurück zu mir“).
  `capture.js` ist das Erfassen-Sheet; die Formulare gehören weiter ihren Modulen.
- `router.js` ist ein **Hash-Router** (`#/pfad`). `register(path, handler)` bindet eine
  View, `setGuard(fn)` schützt Routen (z. B. erzwingt Login → `#/family`). Parameter wie
  `#/session/:id` werden an den Handler übergeben. Ein Handler darf ein Promise liefern: Selten
  genutzte Ansichten (Hilfe, Labor, Berichte, Import, Team-Verwaltung, Workout) lädt `app.js` erst
  bei Bedarf per `import()`.
- Views bekommen das `#view`-Element und füllen es; der Header wird über `setHeader(...)`
  gesetzt (Titel, Untertitel, Zurück, Aktionen – mit `title` als Tooltip).
- **Neu zeichnen statt neu laden (seit v3.20.0):** Nach dem Speichern ruft eine View
  `refreshView()` bzw. `goOrRefresh(hash)` (`ui.js`; die Views nutzen dafür `rerenderView(render)`); `app.js` verbindet das mit
  `router.refresh()`, das die aktuelle Route neu zeichnet und die Scrollposition behält.
  `location.reload()` bleibt nur für App-Reset, Backup-Einspielen, Service-Worker-Update und den
  Diagnose-Knopf (Test `refresh.test.js`). Der Hintergrund-Sync meldet nur echte
  Inhaltsänderungen (`mergeRecords` → `{ changed, visible }`), kehrt die eigene Änderung nur mit
  neuer `rev` zurück, zeichnet nichts neu.
- **Dialoge (`openSheet`):** benannt über den Titel (`aria-labelledby`), Escape schließt, der Fokus
  wandert hinein und zurück zum Auslöser, der Hintergrund ist `inert`. Knopfgruppen stehen in
  `field()` als benannte Gruppe (nicht in `<label>`), Segmente sind Radiogruppen.
- **Anmelde-Gate (seit v3.2.0, erweitert v3.3.0):** Ohne angemeldeten Nutzer ist nur `#/login`
  erreichbar und die Menüs sind ausgeblendet (`body.is-anon`). Die reine Entscheidung liegt DOM-frei in
  `js/session-gate.js` (`gate()`, `menusVisible()`, `needsSetup()`); `app.js` setzt sie im Guard und per
  `onAfterRender` (`applyAuthChrome`) um. **Kein Auto-Login** – beim Start ist niemand angemeldet.
- **Login vs. Dashboard getrennt (v3.3.0):** `js/login.js` (`/login`, abgemeldet) zeigt entweder die
  **Ersteinrichtung** (leere Familie → `createFirstAdmin`, optional `seedDemo`) oder die **Profilauswahl**.
  `js/family.js` (`/family`, Menü „Team/Familie“) ist das **angemeldete Team-Dashboard** mit Team-Badges
  (`js/teamstats.js`, DOM-frei). Verwaltung/Reset liegen admin-only in den Einstellungen.

## Datenschicht (`storage.js`)

Das Herzstück. Hält den State je **Bereich** (Area) und kümmert sich um LocalStorage,
Sync und Mehrbenutzer-Kontext.

- **Bereiche (`AREAS`, 13):** `profile` (Objekt) plus die Listen-Bereiche `events`, `plans`,
  `sessions`, `health`, `nutrition`, `diary`, `shopping`, `checklist`, `cycle`, `reports`, `labs`,
  `supplements` (`ARRAY_AREAS`). **Invariante:** `ARRAY_AREAS` = `AREAS` ohne `profile`. Eine neue Area
  muss in `storage.js`, in `api/storage.php` (`user_areas`) und in den Lasttest-Werkzeugen
  (`USER_AREAS`) eingetragen werden.
- **Versiegelte Bereiche (`SEALED_AREAS`, z. B. `reports`):** append-only. `upsert/patch/
  remove` sind wirkungslos; der einzige Schreibweg ist `addReport()` – für Urkunden/Reports,
  die als Beleg unveränderlich bleiben müssen.
- **Strikt private Bereiche (`PRIVATE_AREAS` = `cycle`, `labs`, `supplements`):** nie im Vollbackup,
  nie für eine verwaltende Admin-Person sichtbar, am Server nur mit Sitzung derselben Person.
- **CRUD:** `get/find/upsert/patch/remove/replaceArea`. Records tragen `id`, Löschungen
  sind **Tombstones** (`deleted: true`) für den Sync.
- **Mehrbenutzer:** `identity` = angemeldete Person (gemerkt in `sessionStorage`: übersteht ein
  Neuladen, nicht das Schließen der App; kein Auto-Login), `activeUser` = gerade betrachtete Person.
  Sind sie verschieden, **verwaltet** ein Admin ein Mitglied (`isManaging()`), und Privates (Zyklus,
  Labor, Ergänzungen) bleibt verborgen. `login()` prüft die PIN am Server (Sitzung, seit v3.20.0) bzw.
  offline gegen den Prüfwert des Geräts und setzt `identity`; `logout()` beendet die Server-Sitzung
  und verwirft den geladenen Speicher (bei „Gemeinsames Gerät“ auch den Browserspeicher).
- **Familienweite Daten:** Die Sicht `family` (Mitglieder, `pantry`, `settings`) wird aus den
  Familien-Datensätzen **abgeleitet** (`members/familyPantry/familySettings`); Schreibzugriffe
  (`addMember/updateMember/removeMember/setFamilyPantry/setFamilySetting`) erzeugen
  Einzel-Ops (per-Mitglied-Merge, s. u.).
- **Persönliches Backup:** `exportAll()` (mit App-Kennung, Version, Profilbezug) und
  `importAll()` (validiert App/Version/Typen, private Bereiche bleiben beim Verwalten außen vor).
  Sichert die Daten der **aktiven Person** – inkl. ihrer privaten Zyklusdaten.
- **Admin-Vollbackup (Notfall-Recovery):** `exportFamilyAll()` / `importFamilyAll()` (nur
  Admin). Bündelt die Familienkonfiguration (inkl. **Teams**, seit v3.20.0) **und** je Mitglied
  alle Bereiche – außer den strikt privaten (`cycle`, `labs`, `supplements`). Die Wiederherstellung
  setzt Familie und alle enthaltenen Mitglieder-Bereiche server- und lokalseitig (per **`replace`-Op**
  je Nutzer). Seit v3.20.0 trägt die `replace`-Op den Server-Stand beim Einspielen als `baseRev`:
  wird sie erst später gesendet (offline), überschreibt sie keine jüngeren Eingaben. Die
  Wiederherstellung wartet auf den Server und meldet Bereiche, die noch nachgereicht werden
  (`pending`). Schutz: das Backup muss mindestens eine Admin-Person enthalten (kein Aussperren);
  private Daten bleiben dabei **unangetastet** erhalten.

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
- **Pull-Marke nur aus dem Pull (seit v3.20.0):** Die Antwort auf einen Push trägt die
  **globale** Bereichs-`rev`. Sie als Marke zu übernehmen, würde fremde Änderungen
  (zweites Gerät, Health-Ingest) dazwischen überspringen – die Marke `revs[area]` rückt
  deshalb ausschließlich durch einen Pull vor.
- **Queue ohne stillen Verlust (seit v3.20.0):** Jede Op trägt eine `opId`; gesendete Ops
  werden per Identität aus der Queue entfernt, nicht per Anzahl. Gesendet wird in Stücken
  zu höchstens 500 Ops (Server-Grenze 2000 je Anfrage, bei `413` halbiert der Client).
  Queue und Bereich werden gemeinsam geschrieben oder gemeinsam zurückgerollt – ist der
  Gerätespeicher voll, meldet die App das (`catofit:storage-full`) statt Daten nur im
  Arbeitsspeicher zu halten. Mehrere Tabs vereinigen ihre Queues über das `storage`-Event.
- **Rücksprung der Server-`rev`:** Ist die Server-`rev` kleiner als die eigene Marke (Server
  aus einer Sicherung zurückgespielt), folgt ein **konservativer Voll-Abgleich**: die
  Server-Version gewinnt bei gleichem oder neuerem `updatedAt`, lokal Neueres bleibt und
  wird erneut gesendet, gelöscht wird lokal nichts. Zusätzlich gleicht jedes Gerät einmal
  pro Woche jeden Bereich ohne offene Ops vollständig ab.
- **Wechsel-Sicherheit (Mehrbenutzer):** `syncNow()` **fixiert den Nutzer** je Durchlauf
  (In-Flight-Guard, einmaliger Nachlauf); `pushArea` ist **an den Nutzer gebunden**, läuft
  je Nutzer und Bereich höchstens einmal gleichzeitig und schreibt dessen Ops nutzergenau
  (auch nach einem Sichtwechsel). Die Daten eines verwalteten Mitglieds werden beim
  Zurückwechseln aus dem Gerätespeicher entfernt; offene Ops bleiben und werden nachgesendet.
- **Sammelabgleich (seit v3.21.0):** Der `ping` nennt die Merkmale des Servers (`features`,
  `serverHas()`); `API_VERSION` bleibt 1. Mit `changes-all` sendet ein Durchlauf erst die offenen
  Ops und holt dann die Änderungen **aller** Bereiche einer Person mit einer Anfrage
  (`pullAllChanges(user, since)`, `since` als `bereich:rev`-Paare) – statt einer je Bereich. Private
  Bereiche ohne eigene Sitzung meldet der Server als `locked`. Mit `ops-since` bringt schon die
  Antwort auf einen Push die Änderungen seit der eigenen Marke mit (`pushOps(area, ops, {since})`
  → `changes`); die Marke rückt damit wie bei einem Pull vor. Ältere Server bedient der Client wie
  bisher, der wöchentliche Voll-Abgleich bleibt der Einzelweg (Test `sync-bulk.test.js`).
- **Familien-Merge pro Datensatz:** Die Familie ist eine Sammlung von Datensätzen – je
  Mitglied ein Record, plus `__settings` und `__pantry`. Mitglieder mischen daher **pro
  Mitglied**: Legen zwei Admins gleichzeitig auf zwei Geräten je ein Mitglied an, bleiben
  **beide** erhalten (früher konnte das Ganzobjekt-LWW eines still verlieren).
- **Private Bereiche nur mit eigener Server-Sitzung (seit v3.20.0):** `cycle`, `labs` und
  `supplements` gleicht der Client nur ab, wenn die Server-Sitzung zur angemeldeten Person gehört
  (`privateAllowed`); sonst bleiben ihre Ops in der Queue und die App fragt einmal nach der PIN
  (`catofit:session-required`). Der Server erzwingt dasselbe (`api/auth.php`).
- **Persistenz lokal:** `catofit:<user>:<area>` (Datensätze), `catofit:<user>:__meta`
  (`{revs, ops}`), `catofit:familyStore` (`{rev, records, ops}`, ohne PIN-Hashes – nur `hasPin`),
  `pinLocal`/`deviceSalt` (Prüfwerte für die Offline-Anmeldung). Die Anmeldung liegt nur in
  `sessionStorage` (kein Auto-Login); ein evtl. alter `catofit:identity` wird beim Start verworfen.

## Trainingspläne: zwei Generatoren

- **Wettkampf:** Der Generator liegt rein in `plangen.js` (Periodisierung `makePhases`, Wochengerüste je
  Sportart und Lauftagen, Umfangsmodell `volumeConfig`/`weekVolumes`, Einheiten `buildWeekUnits`,
  Rennwoche nach Tagesabstand, Vorbereitungscheck `planReadiness`). `plans.js` bindet Store,
  Trainingshistorie und Paces an: `createPlanForEvent(event, { level, daysPerWeek, commitments })` und
  `updatePlanFromToday` (neu ab heute, Vergangenes unverändert über `planflow.mergeFromDate`). Die
  Paces kommen aus `vdot.planPaces` (Zielzeit + Form) und liegen je Plan in `plan.paces`; jede
  Laufeinheit trägt ihren Zonenschlüssel `paceKey`. `plan.gen` markiert den Generatorstand.
- **Programm** (`program.js`): `createProgramPlan(program, today)` erzeugt einen Wochenplan ohne
  Wettkampf (Fitness/Kraft/Abnehmen/Beweglichkeit) mit Ausdauerminuten-Progression und Krafttagen.
- Beide liefern **dasselbe Plan-/Unit-Format** (`planId`, `date`, `type`, `targetDurationMin`,
  `description`, Paces …). Programmeinheiten älterer Versionen (`dur`/`desc`) deutet
  `program.migratePlan` beim Lesen um (`store.get('plans')`). Unterschieden wird über `plan.kind === 'program'`.
- **Distanzspezifisch:** `distanceEmphasis(raceKm)` (plangen.js) steuert die Schlüsseleinheiten je
  Distanz (5 km → kurze VO₂max-Reize, Marathon → Schwelle/Renntempo …).
- **Workout-Modus:** `workout-engine.js` baut die Phasen (Einlaufen, Belastungen, Pausen, Auslaufen;
  Strecken über die Zielpace) und rechnet sie nach echter Zeit weiter (`advance`); `workout-mode.js` ist die Ansicht.
- **Soll-Ist:** `sollist.js compareToPlan` (lockere Einheiten zweiseitig, strukturierte ohne Schnitt-Urteil).

## Adaptiver Coach & weitere Module (DOM-frei + getestet)

Reine Logik in argument-basierten, testbaren Modulen; die Views konsumieren sie nur:

- **planflow.js:** adaptive Vorschläge – u. a. `weekVolumeBalance` (automatischer Wochenumfang-Ausgleich)
  und `rpeProgression` (Progressionssteuerung aus dem RPE-Trend). Surfacing als Coach-Karten in `dashboard.js`
  (mit „Übernehmen“ via `saveUnitPatch`).
- **load.js:** EINZIGE Quelle für Belastungsurteile – `sessionLoad`/`sessionRpe`/`loadMinutes` (sRPE,
  RPE 1–10 geklemmt, Dauer erfasst → Strecke → geplant → 30 min), **Lastverhältnis** (ACWR entkoppelt:
  7 Tage vs. Tag 8–28), **CTL/ATL/TSB** (Banister/PMC, `formState` relativ zur CTL, bewertet ab 90 Tagen)
  und **Monotonie/Strain** (Foster, nur mit Woche über dem eigenen Schnitt). `fitness.js` reicht die
  Belastungsfunktionen für bestehende Importe weiter. Dashboard-Karte „Belastung & Form“ (`charts.js multiLineChart`).
  Fehlt die eigene Angabe, schätzt `sessionRpeInfo` die Anstrengung aus der Herzfrequenz (`rpeFromHr`;
  Bezug: Max-HF aus dem Profil, von `app.js` über `useHrReference` gesetzt) – nur als Eingangswert,
  harte Einheitstypen nie unter ihrer Voreinstellung; `planflow.rpeAskList` fragt danach nach.
- **coach.js:** die EINE Tagesempfehlung für „Heute“ (`coachDecision`, feste Priorität: Wiedereinstieg →
  Erholungstag → heute lockerer → nach Fußball → Entlastung → entzerren → nachholen → Umfang ausgleichen →
  steigern; `coachWhy` für die Begründung). Nutzt `rolling`, `planflow`, `triage`, `load` – die Karten selbst
  baut `dashboard.js`.
- **fitness.js:** gemeinsame Definitionen für alle Ansichten – `adherence` (Plan-Einhaltung), `runKm`
  (Lauf-km), `isHealthMiss`; Statistik-Ampel (`planStatus`) auf `load.acwr`.
- **hrzones.js:** HF-Zonen (% HFmax, Karvonen oder aus der Schwellen-HF nach Friel, `method: 'lthr'`) und
  HFmax-Schätzung aus dem Alter (Tanaka).
- **commitments.js:** feste Termine – konfigurierbare Fußballtage (Tage/Dauer/**Intensität**) + wiederkehrende
  Spiele mit Datumsbereich; der Generator (`plans.js`) plant **um** sie herum. Fußball zählt ab „normal“ als
  fordernd (`fitness.footballRpe`, `planflow.isHard`), fließt voll in die Last ein und entlastet den Folgetag.
- **rolling.js:** rollierende Planung – automatischer Erholungstag aus der Belastung; `gentleVariant`
  (typ-bewusste Entschärfung) und `footballFollowupEase`. Bei zwei Zielen nimmt der Vorschlag den **ganzen Tag**
  zurück (`planflow.dayLoadUnits`); `triage.destackSuggestion` entzerrt Stapel auf einen freien Tag.
- **adapt.js:** zentraler Anwende-/Rückgängig-Kern (`applyAdapt`/`undoAdapt`) mit Transparenz-Log `plan.adaptLog`
  – genutzt von Dashboard-Karten **und** `cycle.js` (Entschärfung des 1. Periodentags nur auf Wunsch). Das
  Log speichert die geänderten Felder; `undoUnits` stellt nur offene Einheiten und nur diese Felder wieder her.
- **triage.js + whatif.js:** Wochen-Check (Kollisionen priorisieren: feste Termine → Schlüssel-Läufe → Kraft
  → Umfang) bzw. What-if-Vorschau der Auswirkung auf die Wochenbelastung vor dem Hinzufügen/Verschieben.
- **dualgoal.js:** Ziel-Cockpit (Halbmarathon-Leistung + Abnehmen) mit phasenabhängigem Schwerpunkt,
  Defizit-Empfehlung (Ernährungskopplung) und ehrlichem Reiz-Check.
- **teamstats.js:** Team-/Familien-Aggregation (DOM-frei) – Kennzahlen je Team über `filterTeamMembers`/
  `teamlessMembers`; Teams sind `_kind:'team'`-Records in `family.json` mit Mehrfach-Mitgliedschaft
  (`MAX_MEMBERS = 32` seit v3.13.0 — bewusste Obergrenze des vertrauensbasierten Modells: Familie/kleines
  Team mit PIN-Login statt echter Auth, Admin verwaltet/„öffnet“ alle, Team-Aggregation client-seitig. Das
  trägt komfortabel bis ~32 (großer Haushalt + Freunde, oder Verein mit Sub-Teams). Darüber wird es eine
  **Organisation** — dann braucht es echte Authentifizierung, verbindliche Privacy-Grenzen und skalierbare
  Aggregation; dieser Modellwechsel ist für **v5.0.0** vorgesehen, siehe `docs/ROADMAP.md`).
- **goals.js:** dedizierte Gesundheits-/Gewichtsziele (`goalProgress`/`goalsProgress`/`latestMetric`),
  gespeichert in `profile.settings.healthGoals`; Fortschrittskarte auf „Heute“, Verwaltung in `settings.js`.
- **unit-actions.js (seit v3.21.1):** Aktionen an geplanten Einheiten ohne Oberfläche – `findUnit`,
  `saveUnitPatch`, `completeUnit`, `linkSession`, `nextFreeDay`, Verpasst-Gründe. Genutzt von Heute,
  Kalender, Plan, Workout-Modus und Import; `session.js` reicht die Namen weiter.
- **„Heute“ in drei Modulen (seit v3.21.1):** `dashboard.js` (Aufbau, Training, Belastung & Form),
  `dashboard-goals.js` (Ziel-Cockpit, Wochen- und Gesundheitsziele) und `dashboard-coach.js` (die
  Coach-Karten samt Übernehmen/Rückgängig und den Nachfragen). Die Entscheidung trifft `coach.js`.
- **exercises.js + exercise-art.js:** Übungs-Bibliothek – Katalog + Filter (DOM-frei) und Standbilder für
  Kacheln. View unter `#/uebungen`.
- **Animierte Übungen (seit v3.22.0):** `exercise-motions.js` (Bewegungsabläufe als Daten),
  `motion-rig.js` (Gelenkfigur mit inverser Kinematik, rein), `motion-figure.js` (SVG-Standbild und
  Animation) und `motion-player.js` (Vorschau und „Mitmachen“ mit Sätzen, Takt, Hinweisen und Pausen).
- **Durchgehend mitmachen (seit v3.23.0):** `coach-figure.js` (die Vorturnerin), `show-program.js`
  (Plantext → Programm → Zeitleiste im Takt, rein), `workout-show.js` (Vollbild-Session),
  `music.js` (Trainingsmusik, live erzeugt), `audio.js` (Freischalten, Töne, Ansagen, Wake Lock) und
  `workouts.js` (fertige Workouts).
- **Aktivitäten aus Dateien (seit v3.21.0):** `gpx.js` (GPX/TCX → `buildActivity`: Splits, Zeit in
  HF-Zonen, Höhenmeter mit 3-m-Hysterese, vereinfachte Strecke – Douglas-Peucker auf höchstens 150
  Punkte, als Polyline kodiert), `fit.js` (binäres FIT: Definitionen, komprimierte Zeitstempel, beide
  Byte-Reihenfolgen, Sportarten), `zip.js` (ZIP-Verzeichnis und gzip über `DecompressionStream`, mit
  Obergrenzen) und `activity-import.js` (`activitiesFrom` für ganze Exporte samt ZIP im ZIP,
  `sameActivity` gegen Doppelte, `guessType`). Alles läuft im Browser; `health-import.js`
  speichert in einem Schreibvorgang, Strecken nur auf Wunsch (`settings.activityRoutes`).
  `charts.js routeMap` zeichnet Strecke und Höhenprofil ohne Kartendienst.
- **strength.js:** Kraftsätze (Wiederholungen × kg), Volumen, letzte Sätze je Übung und
  Steigerungshinweis (doppelte Progression); erfasst im Workout-Modus, gespeichert als
  `strengthSets` an der Einheit.
- **barcode.js:** Prüfziffer (GTIN) und Portion aus den Werten je 100 g; nachgeschlagen wird über
  `api/foodfacts.php` und nur mit „Nährwerte online ergänzen“ (`store.foodLookupEnabled()`).
- **csv-export.js:** Tabellen für Trainings, Körperwerte, Labor und Ess-Tagebuch (Semikolon,
  Dezimalkomma, BOM, Schutz vor Formeln in Zellen).
- **teamstats.js `teamLoad`:** Trainer-Sicht – Belastung und Befinden nur der Personen mit
  `shareLoad`, je mit der eigenen Max-HF als Bezug.

## Backend (PHP)

Bewusst minimal, aber seit v3.0.0 **Merge-Autorität** – nur Persistenz, Op-Anwendung und
zwei Importe/Exporte:

- `api/api.php` – Routing: `?action=changes` (GET, inkrementelle Datensätze ab `since`-rev),
  `?action=ops` (POST `{ops:[…]}`, wendet `upsert`/`delete`/`replace` an), `?area=` (GET,
  logische Sicht für Debug/`.ics`), plus `ping`, `delete-user`, `ics`, `health-import`,
  `health-ingest`, seit v3.20.0 `login`, `logout`, `session`, `set-pin`, `ics-token` und seit
  v3.21.0 `changes-all` (alle Bereiche einer Person in einer Antwort) und `read` (Lesezugang).
  `ping` nennt die Merkmale (`features`: `changes-all`, `ops-since`).
  `userId`-Whitelist (`^[A-Za-z0-9_-]{1,64}$`), Datensatz-ID-Whitelist, schreibende Aufrufe nur als
  JSON und nicht von fremden Seiten, optionale Host-Liste. Übersicht und Zusagen:
  [SCHNITTSTELLEN.md](SCHNITTSTELLEN.md).
- `api/auth.php` – Server-Sitzung nach PIN-Prüfung (Cookie, Fehlversuchssperre), Sperre der
  privaten Bereiche, Familienregeln (`family_guard`: Admin-Sitzung für Mitglieder/Rollen/Ersetzen,
  PIN-Hashes nie in Antworten), Kalender-Schlüssel je Mitglied.
- `api/storage.php` – Store-Format `{rev, records:{id→record}}` je Area. `apply_ops()` läuft
  unter exklusivem Lock, vergibt je Op eine **monotone `rev`** + Server-Zeitstempel und schreibt
  **atomar** (Temp-Datei → `rename`). `changes_since()` liefert alle Datensätze mit `rev>since`.
  Eine **unlesbare** Datei (Rechte, I/O) bricht mit Fehler ab, statt als leerer Bereich zu
  gelten; `replace` kennt das optionale `baseRev` (jüngere Datensätze bleiben).
  Getestet ohne Server: `php tools/test-storage.php`.
  **Migration** (alt→Store) erfolgt deterministisch beim ersten Lesen; `ensure_bootstrap()`
  migriert vorhandene **Legacy-Single-User-Daten** zum ersten Admin – legt aber bei einer **frischen**
  Installation (ab v3.3.0) **niemanden** mehr automatisch an (leere Familie → Ersteinrichtung im Client).
- `api/ics.php` – `.ics`-Kalenderexport (RFC 5545, VALARM) je Nutzer; die Zeitzone kommt aus
  `api/icstz.php` (`CATOFIT_TZ`/`TZ`, sonst Europe/Berlin – für Berlin byte-gleich wie früher; Test
  `php tools/test-ics.php`).
- `api/health-ingest.php` + `api/health-map.php` – automatischer Health-Eingang (Schlüssel je Person):
  Pakete von Health Auto Export (`hi_parse`), das schlanke Tagesformat einer Kurzbefehl-Vorlage
  (`hi_parse_simple`, auch mit Workouts) oder Health-Connect-Datensätze einer Android-Brücke
  (`hi_parse_hcw`, Zeitstempel in die Zeitzone der Instanz); Periodenbeginne werden zu Zyklus-
  Einträgen. Reine Umwandlung in `health-map.php` (Test `php tools/test-health-ingest.php`).
- `api/health-import.php` + `api/health-xml.php` – Voll-Import des Apple-Health-Exports
  (XMLReader-Streaming; alle zuordenbaren Sportarten über dieselbe Tabelle wie der Eingang, Perioden;
  reine Umwandlung in `health-xml.php`, Test `php tools/test-health-xml.php`).
- `api/foodfacts.php` – optionale Nährwertsuche bei Open Food Facts (serverseitig, Zwischenspeicher
  `data/foodfacts.json`), nach Namen oder – seit v3.21.0 – nach Strichcode (`?code=`, Prüfziffer
  vor jeder Anfrage).
- `api/read-access.php` – Lesezugang für eigene Werkzeuge (seit v3.21.0): Schlüssel je Person
  (`profile.readToken`, nur als Header sinnvoll), ausschließlich lesend und nur die gemeinsamen
  Bereiche – nie `cycle`, `labs`, `supplements`, nie Schlüssel aus dem Profil.
- `tools/reset-pin.php` – Notfall-Werkzeug für die Kommandozeile (vergessene Admin-PIN), nie per Web.

`data/.htaccess` (Deny from all) schützt die JSON-Dateien vor direktem Webzugriff;
Laufzeit-Ordner (`data/users`, `data/family`, `data/auth`, `.bootstrap.lock`) sind in `.gitignore`.

## Projektstruktur

```
cat-o-fit/
  index.html              App-Shell (PWA, Apple-Meta-Tags, keine Inline-Skripte)
  manifest.webmanifest    PWA-Manifest
  service-worker.js       Offline-Shell (network-first, nach 3 s aus dem Cache)
  api/                    PHP-Backend (siehe „Backend“)
  data/                   JSON-Daten (nur .htaccess im Repo; Laufzeit-Ordner gitignoriert)
  css/                    style, cards, dashboard, calendar, session, workout-mode, family, report, responsive
  js/                     app, router, storage, api-client, ui, charts, nav + View- und Logik-Module
  assets/icons/           App-Symbole (SVG + PNG)
  docs/                   Dokumentation (Landkarte: docs/README.md), Bilder unter docs/assets
  test/                   node:test-Tests (*.test.js), Mini-DOM in test-setup.js
  tools/                  PHP-Tests, Lasttest, Demo-Seeds (tools/seed), Render-Skript, reset-pin.php
  Dockerfile, docker/     Image (Apache + PHP, amd64/arm64), Entrypoint, Apache-/PHP-Konfiguration
  .github/workflows/      ci.yml (Tests) + docker.yml (Image nach GHCR)
```

## Service Worker & PWA

- `service-worker.js` cacht die **App-Shell** (`SHELL_ASSETS`, samt App-Symbolen) – network-first
  mit Revalidierung. Antwortet der Server nicht binnen **3 s**, startet die App aus dem Cache; die
  späte Antwort frischt ihn trotzdem auf (seit v3.20.0). Beim Veröffentlichen einer Änderung die
  `VERSION` (Cache-Name) erhöhen. Neue Module gehören in `SHELL_ASSETS` (Test `sw-assets.test.js`) –
  auch die bei Bedarf geladenen.
- **Start ohne Server (seit v3.20.0):** `store.init()` wartet nur auf dem ganz neuen Gerät (noch
  keine Familie lokal) höchstens 6 s auf die Mitgliederliste; sonst läuft der Abgleich im
  Hintergrund. Jeder Abgleich und die Server-Anmeldung fragen zuerst per `ping` (2,5 s), ob der
  Server antwortet – sonst gilt der Durchlauf als offline, statt 13 Bereiche nacheinander in
  Timeouts laufen zu lassen. `syncNow()` wartet auf einen laufenden Abgleich. Die Startdiagnose
  (`boot-check.js`) erscheint nur bei echtem Fehler und verschwindet, wenn die App doch startet.
- **Farben & Kontrast (`contrast.js`):** errechnet je Akzent und Theme die Schrift auf dem Akzent
  (`--accent-contrast`), den Akzent als Text (`--accent-text`, `--accent-strong`) und das Ende der
  Hero-Verläufe – jeweils mit ≥ 4,5:1 (WCAG AA). Statusfarben haben feste Textvarianten
  (`--good-text` usw.) in `style.css`; Diagramme färben über CSS-Klassen, ein Wechsel Hell/Dunkel
  wirkt sofort.
- **Single Source of Truth** der App-Version: `js/version.js` (parallel `package.json`).

## Tests

`node:test` (kein Fremd-Runner). `test-setup.js` stellt ein abhängigkeitsfreies
**Mini-DOM** und `localStorage`-Shim bereit, sodass sowohl reine Logik als auch ganze
`render()`-Funktionen getestet werden. Siehe `test/*.test.js` und
[ENTWICKLUNG.md](ENTWICKLUNG.md#tests).
