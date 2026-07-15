# Entwicklung

Praktischer Leitfaden zum lokalen Arbeiten an Cat-O-Fit. Architektur-Hintergrund in
[ARCHITEKTUR.md](ARCHITEKTUR.md), Beitrags-Etikette in
[../CONTRIBUTING.md](../CONTRIBUTING.md).

## Voraussetzungen

- **Node.js ≥ 18** – nur für die Tests (keine Laufzeit-Abhängigkeit der App).
- **PHP ≥ 8** – für das Backend (Persistenz, `.ics`, Health-Import). Für reines
  Frontend-Stöbern genügt ein beliebiger statischer Server, aber ohne PHP gibt es kein
  Speichern.

Es gibt **kein** `npm install` – `package.json` enthält nur das Test-Skript.

## Lokal starten

```bash
git clone https://github.com/Bingerminger/cat-o-fit.git
cd cat-o-fit

# Variante A: voll (Frontend + PHP-Backend)
php -S localhost:8000
# -> http://localhost:8000 öffnen

# Variante B: nur Tests
npm test
```

Beim ersten Server-Zugriff legt `ensure_bootstrap()` aus dem flachen Repo-Seed
(`data/*.json`) den ersten Admin `u-1` an (`data/users/u-1/…`). Diese Laufzeit-Ordner
sind in `.gitignore`.

### Sauberer Zustand / Reset

```bash
# Server-Laufzeitdaten zurücksetzen (Migration legt u-1 neu an)
rm -rf data/users data/family data/.bootstrap.lock
```

Im Browser zusätzlich `localStorage.clear()` und ggf. den Service-Worker-Cache leeren
(DevTools → Application → Storage), damit die frische Shell geladen wird.

## Tests

```bash
npm test     # node --import ./test-setup.js --test "test/**/*.test.js"
```

- Runner: eingebautes **`node:test`**.
- `test-setup.js` stellt ein **Mini-DOM** und einen `localStorage`-Shim bereit (kein
  jsdom). Damit laufen sowohl reine Logik-Tests als auch View-Render-Tests
  (`test/views.test.js`) im Node.
- Neue Logik in einem DOM-freien Modul kapseln und unter `test/<modul>.test.js` testen.
- Eine **GitHub-Actions-CI** (`.github/workflows/ci.yml`) führt die Tests bei jedem Push
  und Pull Request aus.

### PHP-API isoliert testen (ohne echte Daten zu berühren)

Die `node:test`-Suite mockt `fetch` – die **echte** PHP-Seite (`apply_ops`/`changes`/`load_area`/
`ics`/`health-import`) prüft man am besten gegen einen isolierten Server mit eigenem `data/`.
`DATA_DIR` ist fest `__DIR__/../data`, daher eine Kopie der App:

```bash
QA=$(mktemp -d)
rsync -a --exclude='.git/' --exclude='node_modules/' --exclude='/data/' ./ "$QA/"
mkdir "$QA/data"                                  # leeres, isoliertes Datenverzeichnis
php -S 127.0.0.1:8077 -t "$QA" &
curl "http://127.0.0.1:8077/api/api.php?action=ping"
```

So lassen sich Ops, .ics-Erzeugung (gegen `?action=ics&scope=event&id=…&user=u-1`), Parallelzugriffe
(flock) und der Health-Import durchspielen, **ohne** echte Daten zu verändern. Vor destruktiven
Tests gegen `data/` immer snapshotten und danach wiederherstellen.

## Lasttest & Performance

Verifiziert, dass die dateibasierte Persistenz (`flock` + atomares Temp→`rename`) **unter paralleler
Last dateninteger** bleibt und die Latenzen nutzbar sind. Wichtig: `php -S` ist standardmäßig
single-threaded – echte flock-Contention nur mit mehreren Workern (`PHP_CLI_SERVER_WORKERS`).

**Methode:** isolierte App-Kopie mit leerem `data/`, 8-Worker-PHP, Lastgenerator `tools/loadtest.py`
(python3-stdlib, `ThreadPoolExecutor`): 10 Nutzer, paralleler Mix aus **Write** (Einzel-Upsert),
**Read** (`changes`), **Backup** (alle 11 Bereiche lesen) und **Import** (`replace` mit N Sätzen).
Geprüfte Integrität: Anzahl == erfolgreiche Writes (keine verlorenen Updates), `rev` eindeutig, JSON auf
Platte valide, Nutzer-Isolation, Import-Konsistenz. Ausgabe als Tabelle.

```bash
QA=scratch/lt-app
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='scratch' --exclude='data' --exclude='docs' --exclude='test' ./ "$QA/"
mkdir -p "$QA/data"
PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:8078 -t "$QA" &
python3 tools/loadtest.py http://127.0.0.1:8078/api/api.php "$QA/data" 10 300 80 5 3 100 100
#         BASE_URL                              DATA_DIR    NUSERS·WRITES·READS·BACKUPS·IMPORTS·IMPORT_RECS·CONCURRENCY
lsof -ti :8078 | xargs kill   # Server stoppen
```

**Referenz-Plattform** (anonymisiert – nur als Anhaltspunkt; auf der Synology bzw. anderer Hardware
fallen die Zahlen anders aus): **Apple M1 Max · 10 Kerne · 64 GB RAM · macOS 26.5.1 · PHP 8.5.7**
(Built-in-Server, 8 Worker) · Python 3.14. Synthetische, anonyme Testdaten (`u-load-NN`).

| Last | Anfragen | Parallel | Dauer | Durchsatz | Write p95 | Backup p95 | Fehler | Integrität |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| leicht | 900 | 40 | 0,31 s | 2.908/s | 17 ms | 110 ms | 0 | ✓ |
| schwer | 3.880 | 100 | 1,13 s | 3.421/s | 42 ms | 290 ms | 0 | ✓ |
| sehr schwer | 11.580 | 200 | 3,81 s | 3.039/s | 94 ms | 836 ms | 0 | ✓ |
| Dauerlauf 60 s | 60.277 (45.161 Writes) | 500 | 60 s | 1.002/s | 478 ms | 4.426 ms | 0 | ✓ |

**Einordnung:**
- **Integrität: felsenfest** – selbst bei 10.000 nebenläufigen Writes bzw. 45.000 Writes / 13 MB im
  Dauerlauf kein verlorener Update, keine Korruption.
- **Durchsatz-Decke ≈ 3.400 req/s** beim Einzelhost (gesättigt um ~100 parallel). Mehr Parallelität
  bringt nur Latenz, keine Fehler.
- **Teuerster Pfad: das Voll-Backup** (liest alle 11 Bereiche) – wächst mit der Datenmenge; ebenso die
  Writes (jeder schreibt die ganze Bereichs-JSON neu → ~O(n)). Für eine Familie (≤10 Nutzer, kaum
  Gleichzeitigkeit, Hunderte Sätze über Jahre) ist das **riesige Reserve**. Erster Skalierungs-Hebel
  wäre ein inkrementelles statt „alle Bereiche lesen"-Backup.

## Browser-Verifikation

Die App nach Änderungen kurz im Browser prüfen (gerade UI-nahe Änderungen):

- Login lokal: Ein **Reload behält die Sitzung** (sessionStorage, seit v3.4.0); ein echter Neustart
  (leerer sessionStorage / neuer Tab) verlangt wieder eine Anmeldung. In der DevTools-Konsole anmelden:
  `const s = await import('./js/storage.js'); await s.refreshFamily(); await s.login('u-1','1234'); location.hash = '#/';`
  (PIN des Demo-Admins `u-1` = `1234`). Oder einfach im UI auf die Profil-Kachel tippen.
- Nach jeder Shell-Änderung den **Service-Worker-Cache** beachten – `VERSION` in
  `service-worker.js` erhöhen oder den Cache in den DevTools leeren.

## Datensicherheit & Sync (Invarianten, server-autoritativ seit v3.0.0)

Diese Regeln im Store (`storage.js`) und Backend (`storage.php`) **nicht** brechen:

- **Der Server vergibt die `rev`.** Jede angewandte Op erhöht eine monotone Bereichs-`rev`
  und stempelt einen Server-Zeitstempel. Clients setzen NIE selbst eine maßgebliche `rev`.
  Konflikte werden über die server-`rev` entschieden (nicht über die Geräte-Uhr).
- **Erst pushen, dann pullen.** `syncPass` schickt je Bereich zuerst die eigenen Ops, dann
  `pullChanges(since=rev)`. So überschreibt ein Pull nie un­gepushte lokale Edits; ein Pull
  gewinnt nur, wenn `record.rev` höher ist.
- **Nutzer fixieren / Pushes binden.** `syncNow()` fixiert den Nutzer (In-Flight-Guard +
  einmaliger Nachlauf); `pushArea(area, user)` ist an den Nutzer gebunden – nie Ops am
  falschen Nutzer abladen.
- **Familie als Datensätze.** Mitglieder/Settings/Lager sind einzelne Records (`_kind`).
  Schreibzugriffe erzeugen **Einzel-Ops** – nie das ganze `family`-Objekt überschreiben,
  sonst kehrt der stille Mitglieder-Verlust zurück (Regressionstest: `test/sync.test.js`
  „zwei Admins legen je ein Mitglied an").
- **Migration ist deterministisch.** `read_store` migriert Altformat in `{rev, records}` mit
  identischer rev-Vergabe bei Lese- und Schreibzugriff. Beim Ändern eines Records-Formats die
  Migration mitziehen.
- **`load_area` liefert OBJEKTE.** Intern arbeitet `read_store` mit assoziativen Arrays; `load_area`
  wandelt die logische Sicht per JSON-Roundtrip zurück in `stdClass`-Objekte. PHP-Konsumenten wie
  `ics.php` greifen per Objekt-Syntax zu (`$e->id`, `$u->type`) – das **nicht** auf Array-Zugriff
  umstellen, sonst entstehen leere `.ics` (Regression aus v3.0.0, behoben in v3.0.2).
- **Versiegelt/privat respektieren.** `SEALED_AREAS` (Reports) nur über `addReport`;
  `PRIVATE_AREAS` (Zyklus) nie in einen Fremd-/Admin-Export und nie beim Verwalten anzeigen.
  **Härtung seit v3.12.0:** `store.areaAllowed(area)` (= `!(isManaging() && PRIVATE_AREAS.includes(area))`)
  ist die zentrale Schranke. `get('cycle')` liefert beim Verwalten `[]`, und die Nav blendet private Module
  aus (`app.js navVisible` → `areaAllowed`; Nav wird bei Managing-Wechsel über das `catofit:nav`-Event neu
  gebaut). Die Person selbst (`!isManaging`) sieht ihren Zyklus normal. Getestet in `test/storage.test.js`.
  **Demo:** Alle Mitglieder haben vollständige Stammdaten (individuelles Profil + Einstellungen); die
  weiblichen Mitglieder haben eigene, private Zyklusdaten (`demoMemberProfile`, `data.cycle` je Frau).
- **Sitzung pro Browser-Sitzung (seit v3.4.0; davor „kein Auto-Login" seit v3.2.0).** `login()` und
  `createFirstAdmin()` merken die Identität in **`sessionStorage`** (`catofit:session`); `init()` stellt
  sie daraus wieder her. Die Anmeldung **übersteht Reloads** (Theme-/Profil-/Plan-Änderungen laden die
  Seite neu → melden nicht mehr ab), aber **nicht** den App-Neustart/das Schließen → beim echten Start
  gilt weiter „immer neu anmelden". Der LEGACY-Schlüssel `catofit:identity` (dauerhaft, vor v3.2.0) wird
  weiterhin verworfen. Ohne aktiven Nutzer ist nur `#/login` erreichbar, Menüs aus – Logik DOM-frei in
  `js/session-gate.js` (`gate()`/`menusVisible()`/`needsSetup()`, getestet in `test/session-gate.test.js`).
  `logout()`/`resetApp()` flushen offene Ops (online) und räumen `sessionStorage` weg.
- **Module: Standard-an, abschaltbar (seit v3.4.1).** Einheitliche Schranke ist `settings().modules[k] !== false`
  (auch für den Zyklus – nicht mehr Opt-in `=== true`). Die Navigation filtert modulgebundene Einträge über
  `navVisible()` und baut sich bei `catofit:nav` sofort neu (Sidebar + „Mehr"). Modul-/Metrik-Toggles lesen
  den **frischen** `modules`-Stand (kein Render-Snapshot), sonst überschreiben sich zwei Toggles
  nacheinander (Bug aus < v3.4.1).
- **Ersteinrichtung statt Auto-Anlage (seit v3.3.0).** Bei **leerer** Familie zeigt `/login` (`login.js`)
  die Ersteinrichtung: `createFirstAdmin({name,pin})` umgeht die `isAdmin()`-Schranke (es gibt noch keinen
  Admin) und meldet direkt an; `seedDemo(today)` füllt Beispiel-Daten (`js/demo.js`, DOM-frei + getestet).
  `resetApp()` (Admin) löscht Familie + alle Nutzer (Server & lokal) und führt zurück zur Ersteinrichtung.
  Testen ohne Neuinstallation: in den Einstellungen (Admin) **„App zurücksetzen"** – oder den isolierten
  PHP-Server mit leerem `data/` (siehe oben), dann landet die App im Setup-Assistenten.
- **Umgebungs-Namespace (seit v3.5.0).** Mehrere Deployments auf DERSELBEN Origin (Produktion
  `/cat-o-fit/`, Abnahme `/cat-o-fit-acc/`) dürfen sich Client-Speicher NICHT teilen. `APP_NS`/`scopeKey`
  (`js/ui.js`) leiten aus dem Auslieferungspfad einen Präfix ab; **alle** LocalStorage-/SessionStorage-Keys
  laufen darüber (Familie, Sitzung, Nutzerdaten, Meta, Feature-Caches). Der Service-Worker-Cache ist
  pfad-eindeutig, `resetApp` löscht nur die eigene Umgebung, und `createFirstAdmin` gleicht online erst
  den Server ab (kein zweiter Admin). Sonst kehren „doppelte Nutzer" zurück (Regression: `test/env-isolation.test.js`).
  `pinHash` bleibt bewusst OHNE Namespace (sonst würden alle PINs ungültig).
- **Automatischer Health-Ingest (seit v3.6.0).** `api/health-ingest.php` (`?action=health-ingest&user=&token=`)
  nimmt kleine JSON-Payloads von „Health Auto Export" entgegen und schreibt SERVER-SEITIG per `apply_ops`:
  health (ein Eintrag/Tag, **feldweise gemergt** – Nutzerfelder mood/energy/notes bleiben) und sessions
  (Workouts, **dedupliziert per `hk-<UUID>`**, plus Skip gegen deckungsgleiche manuelle Einheiten),
  `source: 'apple-health'`. Auth: hinter `.htpasswd` **plus** per-Nutzer-Token (`profile.healthToken`,
  in der Health-Import-Ansicht erzeugt). Die REINE Mapping-Logik liegt in `api/health-map.php` (`hi_parse`,
  ohne DB/Netz – Format **JSON v2**) und ist automatisiert getestet: **`php tools/test-health-ingest.php`**
  (Namen inkl. `weight_&_body_mass`, Schlaf-Plausibilitätsgrenze >24 h, mi→km, `duration` in Sekunden,
  v1/v2-Energie/HF, `ignoredMetrics`). `health-ingest.php` ergänzt nur Auth + Merge/Dedup + Schreiben.
  Metrik-Mapping ist tolerant (exakt + Heuristik) gegen App-Versionen; Unbekanntes kommt als `ignoredMetrics`
  zurück. Kein Client-Sync-Umbau – der Client zieht per Pull. Die Übersicht „Zuletzt importiert" in der
  Health-Import-Ansicht ist in `test/views.test.js` getestet. Anleitung: [APPLE-HEALTH.md](APPLE-HEALTH.md).
- **Belastungssteuerung & feste Termine (seit v3.7.0).** Die Trainingslast beruht auf der sRPE-Methode
  (`fitness.js sessionLoad` = Dauer × RPE, jetzt exportiert). REINE Kennzahlen liegen in `js/load.js`:
  **ACWR** (7:28 Tage, Sweet-Spot 0,8–1,3), **Fitness/Ermüdung/Form** (CTL/ATL/TSB als Banister-EWMA,
  τ 42/7) und **Monotonie/Strain** (Foster). Dashboard-Karte „Belastung & Form" (`dashboard.js loadFormCard`)
  über `charts.js multiLineChart`; getestet in `test/load.test.js`. — **Feste Termine** (`js/commitments.js`):
  Fußball ist NICHT mehr im `DEFAULT_WEEK_TEMPLATE` verdrahtet, sondern in `plan.commitments` (Standard
  Mo/Mi 90 min via `defaultCommitments`). Der Generator (`plans.js buildWeekUnits`) plant **um** die
  Verpflichtungen herum – an einem belegten Tag entfällt die Trainingseinheit; Spiele mit Datumsbereich
  (`commitmentDates`). Fehlt `plan.commitments` (Alt-Pläne), gilt der Fußball-Default NUR für Lauf-Gerüste
  (`isRunTemplate`) – Triathlon/Hyrox bleiben football-frei. Beim Anpassen bleiben erledigte Einheiten
  erhalten (`mergeRegeneratedWeek`). Getestet in `test/commitments.test.js`.
- **Geglättete Form-Schätzung (`vdot.js estimateVdot`, seit v3.10.0).** Die „aktuelle Form" ist NICHT mehr
  ein einzelner Lauf (ausreißer-empfindlich), sondern robust geglättet: (1) **Wochenbestwert** je Kalenderwoche
  (filtert lockere Läufe, dämpft Intra-Wochen-Ausreißer), (2) **Ausreißer-Kappung** der Wochenwerte auf
  Median ± 3·MAD, (3) **rezenzgewichtetes Mittel** (exponentiell, Halbwertszeit 2 Wochen – gleiche EWMA-Idee
  wie CTL/ATL). Fallback auf den besten Einzellauf bei < 3 Wochen Historie (jüngste Einheit als Basis). Rückgabe
  `{ vdot, basis, weeks }`; `dashboard.js formCard` zeigt bei `weeks ≥ 3` „geglättet über N Wochen · zuletzt …".
  `applyFormPaces` schreibt die Form-Paces in `profile.paceZones` UND in die offenen künftigen Lauf-Einheiten
  (HF-Zone → Pace). Getestet in `test/vdot.test.js` (u. a. Ausreißer-Dämpfung).
- **Übungs-Bibliothek: Regionen, Nutzungszähler & Einheiten-Vorschläge (seit v3.11.0).** `js/exercises.js`
  bleibt DOM-frei: neben `category` gibt es einen **Körperregion-Filter** (`EX_REGIONS` + `exerciseRegions(id)`
  aus `REGION_BY_ID`), `suggestedExercisesFor(type)` (Kraft → Kraft/Rumpf, Mobility/Recovery → Beweglichkeit)
  und `sortByUsage(list, usage)`. Der **Nutzungszähler** liegt pro Nutzer in `profile.settings.exerciseUsage`
  (`storage.exerciseUsage`/`bumpExerciseUsage`) – erhöht per „Gemacht (+1)" im Katalog ODER automatisch beim
  Erledigen einer Einheit für deren `unit.exerciseIds` (`session.js logWorkout`). `renderPlanned` blendet bei
  Kraft-/Mobility-Einheiten die nach Nutzung sortierten Vorschläge ein (Toggle schreibt `unit.exerciseIds`);
  seit v3.14.0 sind sie auch im Vollbild-**Workout** erreichbar (`workout-mode.js renderWorkoutExercises`).
  Neue Übungen brauchen eine SVG-Figur in `exercise-art.js` – `test/exercises.test.js` erzwingt das. 29 Übungen.
- **Rollierende Planung, Triage & Dual-Goal (seit v3.8.0).** Reine Module, alle auf `today`-Basis
  und per node:test abgedeckt: `js/rolling.js` (Erholungstag-Erkennung aus ACWR/harten Tagen/Form; nur
  offene, NICHT-fixe fordernde Einheiten werden entlastet; Transparenz-Log `plan.adaptLog` mit
  Rückgängig-Snapshot – der zentrale Anwende-/Undo-Kern `applyAdapt`/`undoAdapt` liegt seit v3.14.0 in
  `js/adapt.js`, damit auch `cycle.js` protokolliert), `js/triage.js` (Wochen-Kollisionen
  + Prioritätsordnung feste Termine → Schlüssel → Kraft → Umfang → Erholung; `destackSuggestion` entzerrt
  Zwei-Ziele-Stapel), `js/whatif.js`
  (Vorher/Nachher der Wochenbelastung beim Hinzufügen/Verschieben – im Verschieben-Dialog & Unit-Creator),
  `js/dualgoal.js` (phasenabhängiger Schwerpunkt Leistung↔Abnehmen + gedeckelte Defizit-Empfehlung +
  ehrlicher Reiz-Check gegen „Ruhetag-Schönrechnerei"). Das Ziel-Cockpit (`dashboard.js goalCockpitCard`)
  koppelt Laufprognose, Gewichtsziel, Phase und Ernährung. Wichtig: die Belastungs-Signale sind an eine
  ERHÖHTE ACWR gekoppelt (sonst triggert das Einschwingen der CTL-Kurve). Feste Termine sind für alle
  Automatiken tabu.
- **Adaptiv-Erweiterungen (seit v3.14.0), alle über `adapt.js` protokolliert & rückgängig:**
  (1) **Zyklus** – `cycle.js applyCycleEasing` entschärft beim Eintragen eines Periodenbeginns die Einheiten
  am 1. Tag (`cycleSoftenTargets` + `cycleEaseVariant`, typ-bewusst via `rolling.js gentleVariant`).
  (2) **Zwei Ziele** – `restDayApply` nimmt planübergreifend den GANZEN Tag zurück (`planflow.js dayLoadUnits`);
  `triage.js destackSuggestion` + `findMakeupDay` bieten das Verschieben einer Einheit auf einen freien Tag an.
  (3) **Fußball** – `cross_football` trägt eine **Intensität** (leicht/normal/intensiv, `commitments.js`),
  zählt ab „normal" als hart (`planflow.isHard`, `rolling.dayIsHard`), fließt über `fitness.footballRpe`/
  `sessionLoad` in die Last ein, und `rolling.footballFollowupEase` schlägt den lockeren Folgetag vor.
- **Teams (seit v3.9.0).** Teams sind zusätzliche `_kind:'team'`-Records in `family.json`
  (`{id, name, emoji, color, memberIds}`) – NEBEN Mitgliedern/`__settings`/`__pantry`; sie syncen
  record-agnostisch mit (kein Sync-Umbau). Ein Mitglied kann in MEHREREN Teams sein (Mehrfach-Mitgliedschaft:
  überschneidende `memberIds`), manche in keinem. Store-API (nur Admin): `teams`/`teamsOf`/`teamMembers`/
  `addTeam`/`updateTeam`/`removeTeam`/`setMemberTeams` (Zuordnung & Teamwechsel). `removeMember` räumt
  Team-Mitgliedschaften auf (keine „Geister"), `saveFamily` setzt/leert Teams beim autoritativen Reset.
  Die Aggregation bleibt team-AGNOSTISCH: `teamstats.js` bekommt einfach eine gefilterte Mitgliederliste
  (`filterTeamMembers`/`teamlessMembers`); das `#/family`-Dashboard schaltet oben zwischen Alle/Team/Ohne
  Team um, verwaltet wird in `#/familie-verwalten`. `MAX_MEMBERS = 32`. Getestet: `test/teams.test.js`;
  Demo: 10 Personen, 3 Teams, Henriette in 2, Horst ohne (`seedDemo` löst `team.memberNames` → IDs auf,
  `__self__` = Admin).

## Sicherheitsmodell (bewusst schlank)

Die App läuft im **vertrauenswürdigen Heimnetz** ohne serverseitige Authentifizierung – der
PHP-Teil vertraut dem Frontend. Trotzdem gelten:

- **Backend-Validierung:** `userId`-Whitelist (`^[A-Za-z0-9_-]{1,64}$`), Area-Whitelist,
  `scope ∈ {user, family}`, atomare Schreibvorgänge (`flock`, Temp→`rename`), `Cache-Control:
  no-store`. Kein Path-Traversal über `area`/`user`.
- **PIN:** Frontend-Schutz – verhindert neugieriges Antippen, kein kryptografischer Anspruch.
  Seit v3.0.1 **abhängigkeitsfreier SHA-256** (`js/sha256.js`) mit ID-Salt, **in jedem Kontext
  identisch** (auch über http im Heimnetz, wo `crypto.subtle` fehlt). Das frühere
  „crypto.subtle sonst djb2"-Schema war kontextabhängig und konnte aussperren – `verifyPin`
  akzeptiert daher zusätzlich noch alte djb2-Hashes. **Nicht** wieder an `crypto.subtle` koppeln.
  Seit v2.39.0 bekommt **jedes angelegte Mitglied** verpflichtend einen PIN (Default `0000`);
  einzige Ausnahme: der per Bootstrap angelegte erste Admin (`u-1`) darf zunächst PIN-frei sein.
- **Kein XSS-Einfallstor durch Freitext:** Benutzertexte (Namen, Notizen, Titel) werden über
  `el({ text })` → `textContent` gesetzt; `el({ html })` ist ausschließlich internen, festen
  SVG-/Markup-Schnipseln vorbehalten. Diese Trennung beibehalten.

## Eine Änderung veröffentlichen (Checkliste)

1. `js/version.js` **und** `package.json` `version` anheben (SemVer).
2. `service-worker.js` `VERSION` (Cache-Name) bumpen.
3. Neue Frontend-Datei? In `service-worker.js` `SHELL_ASSETS` eintragen.
4. Neue Daten-Area? In `js/storage.js` (`AREAS`/`ARRAY_AREAS`) **und** `api/storage.php`
   (`user_areas`) eintragen.
5. Tests grün halten / ergänzen: `npm test` (JS) **und** `php tools/test-health-ingest.php`
   (Apple-Health-Mapping).
6. `CHANGELOG.md` und ggf. `docs/ROADMAP.md`, Handbuch und In-App-Hilfe (`js/help.js`)
   aktualisieren.

## Projektstruktur (Kurz)

```
cat-o-fit/
  index.html              App-Shell (PWA, iOS-Meta)
  manifest.webmanifest    PWA-Manifest
  service-worker.js       Offline-Shell (network-first)
  js/
    app.js router.js      Bootstrap & Hash-Routing
    storage.js api-client.js   Datenschicht & Sync
    ui.js charts.js       UI-Bausteine
    plans.js program.js   Plan-Generatoren (Wettkampf / Programm)
    …                     weitere View- und Logik-Module
  api/                    PHP-Backend (Persistenz, .ics, Health-Import)
  data/                   JSON-Daten (durch .htaccess geschützt)
  css/                    Stylesheets
  test/                   node:test (*.test.js)
  test-setup.js           Mini-DOM + localStorage-Shim für die Tests
  docs/                   Handbuch, Architektur, Entwicklung, Roadmap
```

## Deployment

**Synology Web Station** – Kurzfassung, Details im
[README](../README.md#einrichtung-auf-der-synology-web-station):

1. Web Station + PHP installieren, Projekt nach `/web/cat-o-fit` kopieren.
2. Dem Webserver-Nutzer (`http`) Schreibrechte auf `data/` geben.
3. Per HTTPS aufrufen; `api/api.php?action=ping` muss `{"ok":true}` liefern.

**Docker** (Multi-Arch: amd64 + arm64) – Details im
[README](../README.md#schnellstart-mit-docker):

```bash
docker compose up -d   # Image bauen/ziehen; App auf Port 8080, data/ im Volume
```

Der Container startet bewusst mit **leerer Instanz** (Ersteinrichtungs-Assistent);
die flachen Repo-Seeds werden nicht ins Image kopiert (`.dockerignore`).

Es gibt keinen Build-Schritt – die Dateien werden unverändert ausgeliefert.
