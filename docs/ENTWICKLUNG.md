# Entwicklung

Praktischer Leitfaden zum lokalen Arbeiten an Cat-O-Fit. Architektur-Hintergrund in
[ARCHITEKTUR.md](ARCHITEKTUR.md), Beitrags-Etikette in
[../CONTRIBUTING.md](../CONTRIBUTING.md).

## Voraussetzungen

- **Node.js ≥ 22** – nur für die Tests (keine Laufzeit-Abhängigkeit der App; `node --test` mit Glob-Muster braucht Node 21+, die CI prüft 22 und 24).
- **PHP ≥ 8.1** – für das Backend (Persistenz, Anmeldung, `.ics`, Health-Import; die Speicherung braucht `fsync`, das es erst ab 8.1 gibt). Für reines
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

Mit leerem `data/` (so liegt es im Repo, nur mit `.htaccess`) startet die App in der
**Ersteinrichtung** (Admin mit eigener PIN anlegen, optional Demodaten). Für eine Instanz im
Altformat gibt es Entwickler-Seeds unter `tools/seed/` (erzeugt mit `tools/gen-demo-seeds.mjs`):
`cp tools/seed/*.json data/` vor dem ersten Start – `ensure_bootstrap()` migriert sie dann zum
ersten Admin `u-1` **ohne PIN** (nur lokal verwenden). Die Laufzeit-Ordner (`data/users`,
`data/family`, `data/auth`) sind in `.gitignore`.

### Sauberer Zustand / Reset

```bash
# Server-Laufzeitdaten zurücksetzen (danach wieder Ersteinrichtung)
rm -rf data/users data/family data/auth data/.bootstrap.lock data/*.json
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
- **Sync gegen einen protokolltreuen Test-Server (seit v3.20.0):** `globalThis.__fakeServer.install()`
  ersetzt `fetch` durch einen In-Memory-Server, der `apply_ops` nachbildet (globale Bereichs-`rev`,
  Tombstones, `replace` mit `baseRev`, 2000-Ops-Grenze → `413`). Stellschrauben über `srv.opts`:
  `latencyMs` (Zahl oder Funktion je Anfrage), `offline`, `failStatus`, `failWhen`, `opLimit`;
  `srv.requests` protokolliert jede Anfrage, `srv.store(area, {user|scope})` zeigt den Serverstand.
  Opt-in: ohne `install()` bleibt der einfache Erfolgs-Mock aktiv. Beispiel: `test/sync-integrity.test.js`.
- **Voller Gerätespeicher:** `localStorage.__setQuota(n)` begrenzt den Shim auf `n` Zeichen
  (`setItem` wirft dann `QuotaExceededError`), `localStorage.__used()` liefert den Füllstand.
- **PHP-API über HTTP:** `php tools/test-api.php` startet einen eigenen PHP-Testserver auf einer
  Kopie von `api/` mit leerem Temp-Datenverzeichnis und prüft Anmeldung/Sitzung, private Bereiche,
  Schutz vor fremden Seiten, Familienregeln, PIN-Regeln und Fehlversuchssperre, Kalender-Schlüssel,
  Health-Import-Grenzen, den Health-Eingang im Kurzbefehl-Format, `tools/reset-pin.php` und die
  Host-Liste.
- **PHP-Tests ohne Server:** `php tools/test-health-ingest.php` (Apple-Health-Mapping inkl.
  Tagesformat), `php tools/test-health-xml.php` (Voll-Import), `php tools/test-ics.php`
  (Kalender-Zeitzone) und `php tools/test-storage.php` (Persistenz: unlesbare/leere/beschädigte Datei,
  `replace` mit `baseRev`; arbeitet auf einer Kopie von `storage.php` in einem Temp-Verzeichnis).
- **Doku-Tests:** `test/docs.test.js` prüft Links und Anker aller Markdown-Dateien, Bildverweise,
  Zahlen im README, die Versionsgleichheit (version.js, package.json, CHANGELOG) und die
  Hilfe-Verweise; `test/help-context.test.js` die Hilfeartikel, `test/ui-texts.test.js` Begriffe und
  Zahlenformat der Ansichten.
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
**Read** (`changes`), **Backup** (alle Bereiche lesen) und **Import** (`replace` mit N Sätzen).
Geprüfte Integrität: keine verlorenen Updates, `rev` eindeutig, JSON auf Platte valide, Nutzer-Isolation,
Import-Konsistenz. Ausgabe als Tabelle. Der Dauerlauf prüft die Writes über **ID-Mengen** (jede bestätigte
ID liegt am Server, dort liegt nichts, was nie gesendet wurde) statt über eine Zählersumme – unter Last kann
eine Anfrage am Server ankommen, deren Antwort den Client nicht mehr erreicht.

```bash
QA=scratch/lt-app
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='scratch' --exclude='data' --exclude='docs' --exclude='test' ./ "$QA/"
mkdir -p "$QA/data"
PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:8078 -t "$QA" &
python3 tools/loadtest.py http://127.0.0.1:8078/api/api.php "$QA/data" 10 300 80 5 3 100 100
#         BASE_URL                              DATA_DIR    NUSERS·WRITES·READS·BACKUPS·IMPORTS·IMPORT_RECS·CONCURRENCY

# Dauerlast („Soak“): konstante Last über N Sekunden – zeigt, ob die Latenz mit
# wachsenden JSON-Dateien wegläuft. Misst je 10-Sekunden-Fenster (Zeile
# „Dauerlauf 60 s“ in der Tabelle unten).
python3 tools/loadtest_soak.py http://127.0.0.1:8078/api/api.php "$QA/data" 10 5000 500 60 100
#         BASE_URL                                   DATA_DIR    NUSERS·MAXWRITES·CONCURRENCY·DAUER·IMPORT_RECS

lsof -ti :8078 | xargs kill   # Server stoppen
```

Beide Skripte prüfen alle **13** Nutzer-Bereiche auf Integrität (inkl. `labs` und
`supplements` seit v3.17.0).

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
- **Teuerster Pfad: das Voll-Backup** (liest alle Bereiche) – wächst mit der Datenmenge; ebenso die
  Writes (jeder schreibt die ganze Bereichs-JSON neu → ~O(n)). Für eine Familie (≤10 Nutzer, kaum
  Gleichzeitigkeit, Hunderte Sätze über Jahre) ist das **riesige Reserve**. Erster Skalierungs-Hebel
  wäre ein inkrementelles statt „alle Bereiche lesen“-Backup.

## Browser-Verifikation

Die App nach Änderungen kurz im Browser prüfen (gerade UI-nahe Änderungen):

- Login lokal: Ein **Reload behält die Sitzung** (sessionStorage, seit v3.4.0); ein echter Neustart
  (leerer sessionStorage / neuer Tab) verlangt wieder eine Anmeldung. In der DevTools-Konsole anmelden:
  `const s = await import('./js/storage.js'); await s.refreshFamily(); await s.login('<id>','<pin>'); location.hash = '#/';`
  (ID und PIN der in der Ersteinrichtung angelegten Admin-Person). Oder einfach im UI auf die
  Profil-Kachel tippen. `php -S` wertet `.htaccess` nicht aus – die Content-Security-Policy greift
  trotzdem, weil `index.html` sie zusätzlich als `<meta>` trägt.
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
- **Die Pull-Marke rückt nur durch einen Pull vor (seit v3.20.0).** Die Push-Antwort trägt die
  GLOBALE Bereichs-`rev` – als Marke übernommen, übersprang sie fremde Änderungen dazwischen
  (zweites Gerät, Health-Ingest). `pushAreaNow`/`pushFamilyNow` fassen `revs` deshalb nicht an.
  Eine einmalige Heilung (`syncHeal` = `3.20`) setzt alle Marken beim ersten Start zurück, damit
  früher übersprungene Datensätze nachgeladen werden.
- **Keine Op geht still verloren (seit v3.20.0).** Ops tragen eine `opId` und werden nach dem
  Senden per Identität entfernt (nie per Anzahl/Position). Gesendet wird in Stücken ≤ 500 Ops
  (`PUSH_CHUNK`; bei `413` halbiert). Je Nutzer und Bereich läuft höchstens ein Push (`inflight`).
  `commitLocal` schreibt erst die Queue, dann den Bereich, und rollt bei vollem Speicher beides
  zurück (Ereignis `catofit:storage-full`, Toast in `app.js`). Massenimporte nutzen `upsertMany`
  (ein Schreibvorgang). Die Queue wird verdichtet (`replace` ersetzt alles davor, je ID zählt die
  letzte Op). Tabs vereinigen ihre Queues über das `storage`-Event (`adoptForeignOps`).
- **Server-Rücksprung konservativ behandeln.** Ist die Server-`rev` kleiner als die Marke, folgt
  `resyncArea` mit `mergeConservative`: Server gewinnt bei gleichem/neuerem `updatedAt`, lokal
  Neueres bleibt (mit `rev` 0, wird erneut gesendet), lokal wird nichts gelöscht. Dazu einmal pro
  Woche ein Voll-Abgleich je Bereich ohne offene Ops (`<user>:__fullSync`).
- **Verwaltete Mitglieder hinterlassen keinen Ballast.** `setActiveUser`/`logout` verwerfen die
  zwischengespeicherten Bereiche eines verwalteten Mitglieds (`evictUserCache`); offene Ops bleiben
  im `__meta` und werden beim nächsten Sync nachgesendet (`pushForeignQueues`).
- **Nutzer fixieren / Pushes binden.** `syncNow()` fixiert den Nutzer (In-Flight-Guard +
  einmaliger Nachlauf); `pushArea(area, user)` ist an den Nutzer gebunden – nie Ops am
  falschen Nutzer abladen.
- **Familie als Datensätze.** Mitglieder/Settings/Lager sind einzelne Records (`_kind`).
  Schreibzugriffe erzeugen **Einzel-Ops** – nie das ganze `family`-Objekt überschreiben,
  sonst kehrt der stille Mitglieder-Verlust zurück (Regressionstest: `test/sync.test.js`
  „zwei Admins legen je ein Mitglied an“).
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
  **Seit v3.20.0 auch am Server:** `cycle`, `labs`, `supplements` nur mit Sitzung der Person selbst
  (siehe „Sicherheitsmodell“); der Client fragt sie ohne eigene Sitzung gar nicht erst an.
  **Demo:** Alle Mitglieder haben vollständige Stammdaten (individuelles Profil + Einstellungen); die
  weiblichen Mitglieder haben eigene, private Zyklusdaten (`demoMemberProfile`, `data.cycle` je Frau).
  Diese privaten Demo-Daten warten in der Queue des Mitglieds auf diesem Gerät und gehen an den
  Server, sobald sich das Mitglied hier anmeldet (der Admin darf sie nicht schreiben).
- **Sitzung pro Browser-Sitzung (seit v3.4.0; davor „kein Auto-Login“ seit v3.2.0).** `login()` und
  `createFirstAdmin()` merken die Identität in **`sessionStorage`** (`catofit:session`); `init()` stellt
  sie daraus wieder her. Die Anmeldung **übersteht Reloads** (Theme-/Profil-/Plan-Änderungen laden die
  Seite neu → melden nicht mehr ab), aber **nicht** den App-Neustart/das Schließen → beim echten Start
  gilt weiter „immer neu anmelden“. Der LEGACY-Schlüssel `catofit:identity` (dauerhaft, vor v3.2.0) wird
  weiterhin verworfen. Ohne aktiven Nutzer ist nur `#/login` erreichbar, Menüs aus – Logik DOM-frei in
  `js/session-gate.js` (`gate()`/`menusVisible()`/`needsSetup()`, getestet in `test/session-gate.test.js`).
  `logout()`/`resetApp()` flushen offene Ops (online) und räumen `sessionStorage` weg; `logout()` beendet
  seit v3.20.0 auch die Server-Sitzung und räumt bei **„Gemeinsames Gerät“** (`isSharedDevice`) alle
  Personendaten aus dem Browserspeicher (`wipePersonalData`; ungesendete Ops bleiben). Nach einem Reload
  prüft `syncNow` per `?action=session`, ob das Cookie noch gilt.
- **Module: Standard-an, abschaltbar (seit v3.4.1).** Einheitliche Schranke ist `settings().modules[k] !== false`
  (auch für den Zyklus – nicht mehr Opt-in `=== true`). Die Navigation filtert modulgebundene Einträge über
  `navVisible()` und baut sich bei `catofit:nav` sofort neu (Sidebar + „Mehr“). Modul-/Metrik-Toggles lesen
  den **frischen** `modules`-Stand (kein Render-Snapshot), sonst überschreiben sich zwei Toggles
  nacheinander (Bug aus < v3.4.1).
- **Ersteinrichtung statt Auto-Anlage (seit v3.3.0).** Bei **leerer** Familie zeigt `/login` (`login.js`)
  die Ersteinrichtung: `createFirstAdmin({name,pin})` umgeht die `isAdmin()`-Schranke (es gibt noch keinen
  Admin) und meldet direkt an; `seedDemo(today)` füllt Beispiel-Daten (`js/demo.js`, DOM-frei + getestet).
  `resetApp()` (Admin) löscht Familie + alle Nutzer (Server & lokal) und führt zurück zur Ersteinrichtung.
  Testen ohne Neuinstallation: in den Einstellungen (Admin) **„App zurücksetzen“** – oder den isolierten
  PHP-Server mit leerem `data/` (siehe oben), dann landet die App im Setup-Assistenten.
- **Umgebungs-Namespace (seit v3.5.0).** Mehrere Deployments auf DERSELBEN Origin (etwa PROD
  `/cat-o-fit/` und ACC `/cat-o-fit-acc/`) dürfen sich Client-Speicher NICHT teilen. `APP_NS`/`scopeKey`
  (`js/ui.js`) leiten aus dem Auslieferungspfad einen Präfix ab; **alle** LocalStorage-/SessionStorage-Keys
  laufen darüber (Familie, Sitzung, Nutzerdaten, Meta, Feature-Caches). Der Service-Worker-Cache ist
  pfad-eindeutig, `resetApp` löscht nur die eigene Umgebung, und `createFirstAdmin` gleicht online erst
  den Server ab (kein zweiter Admin). Sonst kehren „doppelte Nutzer“ zurück (Regression: `test/env-isolation.test.js`).
  `pinHash` bleibt bewusst OHNE Namespace (sonst würden alle PINs ungültig).
- **Automatischer Health-Ingest (seit v3.6.0).** `api/health-ingest.php` (`?action=health-ingest&user=&token=`)
  nimmt kleine JSON-Payloads von „Health Auto Export“ entgegen und schreibt SERVER-SEITIG per `apply_ops`:
  health (ein Eintrag/Tag, **feldweise gemergt** – Nutzerfelder mood/energy/notes bleiben) und sessions
  (Workouts, **dedupliziert per `hk-<UUID>`**, plus Skip gegen deckungsgleiche manuelle Einheiten),
  `source: 'apple-health'`. Auth: hinter `.htpasswd` **plus** per-Nutzer-Token (`profile.healthToken`,
  in der Health-Import-Ansicht erzeugt). Die REINE Mapping-Logik liegt in `api/health-map.php` (`hi_parse`,
  ohne DB/Netz – Format **JSON v2**) und ist automatisiert getestet: **`php tools/test-health-ingest.php`**
  (Namen inkl. `weight_&_body_mass`, Schlaf-Plausibilitätsgrenze >24 h, mi→km, `duration` in Sekunden,
  v1/v2-Energie/HF, `ignoredMetrics`). `health-ingest.php` ergänzt nur Auth + Merge/Dedup + Schreiben.
  Metrik-Mapping ist tolerant (exakt + Heuristik) gegen App-Versionen; Unbekanntes kommt als `ignoredMetrics`
  zurück. Kein Client-Sync-Umbau – der Client zieht per Pull. Die Übersicht „Zuletzt importiert“ in der
  Health-Import-Ansicht ist in `test/views.test.js` getestet. Anleitung: [APPLE-HEALTH.md](APPLE-HEALTH.md).
- **Belastungssteuerung & feste Termine (seit v3.7.0).** Die Trainingslast beruht auf der sRPE-Methode
  (`load.js sessionLoad` = Minuten × RPE; RPE auf 1–10 geklemmt, Dauer erfasst → Strecke je Sportart →
  `plannedDurationMin` → 30 min, Deckel 24 h). ALLE Belastungskennzahlen liegen in `js/load.js` (eine
  Quelle): **Lastverhältnis** (ACWR entkoppelt: letzte 7 Tage gegen Tag 8–28; Stufe „aufbau“ unter 28 Tagen
  Historie), **Fitness/Ermüdung/Form** (CTL/ATL/TSB als Banister-EWMA, τ 42/7; `formState` relativ zur
  CTL, erst ab `FORM_MIN_DAYS` = 90 Tagen bewertet) und **Monotonie/Strain** (Foster; RPE ≤ 3 zählt nicht,
  Hinweis nur bei Woche ≥ 1,1 × eigene Wochenlast). Texte ohne Verletzungs- oder Schutzversprechen.
  `fitness.loadBalance` (Statistik-Ampel) baut auf `acwr()` auf. Dashboard-Karte „Belastung & Form“
  (`dashboard.js loadFormCard`) über `charts.js multiLineChart`; getestet in `test/load.test.js` und
  `test/train-assumptions.test.js`. — **Feste Termine** (`js/commitments.js`):
  Fußball ist NICHT im `DEFAULT_WEEK_TEMPLATE` verdrahtet, sondern in `plan.commitments`. Seit der
  Planüberarbeitung gibt es **keine Standardtermine** mehr: neue Pläne starten mit `commitments: []`, die
  Einrichtung fragt danach. Der Generator (`plangen.js buildWeekUnits`) plant **um** die Verpflichtungen
  herum – Schlüsseleinheiten weichen aus, Lockeres entfällt; Spiele mit Datumsbereich (`commitmentDates`).
  Qualität und Long Run liegen nie direkt neben einem harten festen Termin (auch Sonntag davor/Montag
  danach und Termine anderer Pläne): Ausweichen auf einen ruhigen Tag, sonst „Locker mit Steigerungen“
  (`downgradedFrom: 'quality'`).
  Fehlt `plan.commitments` (Pläne vor v3.7.0), liest `plangen.planCommitments` Mo/Mi-Fußball mit stabilen
  IDs (`c-legacy-mo/-mi`) – NUR für Lauf-Gerüste (`isRunTemplate`). Derselbe Termin in zwei Plänen erscheint
  einmal (`coveredFixed`). Neu berechnet wird immer nur ab heute (`planflow.mergeFromDate`).
  Getestet in `test/commitments.test.js` und `test/plangen.test.js`.
- **Plan-Generator (`plangen.js`, rein).** Umfang nach Niveau (Einsteiger/Fortgeschritten/Leistung) und
  Lauftagen (3–6): Einstieg aus `trainingHistory` (auch nach unten), +8/10/12 % je Woche gegenüber der
  letzten vollen Woche, jede 4. Woche 85 %, Taper 70/50 % (bei langen Taperphasen zusätzlich 85 %). Long
  Run: Anteil 33 % (5/10 km), 38 % (HM), 40 % (Marathon) der tatsächlichen Wochensumme, Zeitdeckel 150/180
  min, im Taper ≤ 75/55 % der Spitze. Rennwoche nach Tagesabstand (−1 Shakeout, −2 frei, −3…−6
  Aktivierung/kurz), Renneinheit an jedem Wochentag. Triathlon/Hyrox mit eigenen Gerüsten (Ruhetage,
  Formate, Stationsprogression). Getestet in `test/plangen.test.js`, Workout-Phasen in `test/workout-engine.test.js`.
- **Geglättete Form-Schätzung (`vdot.js estimateVdot`, seit v3.10.0).** Die „aktuelle Form“ ist NICHT mehr
  ein einzelner Lauf (ausreißer-empfindlich), sondern robust geglättet: (1) **Wochenbestwert** je Kalenderwoche
  (filtert lockere Läufe, dämpft Intra-Wochen-Ausreißer), (2) **Ausreißer-Kappung** der Wochenwerte auf
  Median ± 3·MAD, (3) **rezenzgewichtetes Mittel** (exponentiell, Halbwertszeit 2 Wochen – gleiche EWMA-Idee
  wie CTL/ATL). Fallback auf den besten Einzellauf bei < 3 Wochen Historie (jüngste Einheit als Basis). Seit
  der Planüberarbeitung zählen nur **harte Läufe** (Wettkampf/Tempo/Intervall, RPE ≥ 7, Ø-HF ab Zone 4);
  lockere Läufe sind Untergrenze bzw. bei fehlenden harten Läufen eine gekennzeichnete Schätzung
  (`onlyEasy`). Rückgabe `{ vdot, basis, weeks, onlyEasy, hardCount }`. `applyFormPaces` schreibt die
  Form-Paces in `profile.paceZones`, `plan.paces` und die offenen künftigen Lauf-Einheiten – über den
  Zonenschlüssel `paceKey` (`planflow.repaceUnits`), nicht über die HF-Zone. Renntempi kommen aus der
  Äquivalenzzeit (`racePaceFromVdot`). Getestet in `test/vdot.test.js`, `test/sollist.test.js`,
  `test/train-assumptions.test.js`.
- **Übungs-Bibliothek: Regionen, Nutzungszähler & Einheiten-Vorschläge (seit v3.11.0).** `js/exercises.js`
  bleibt DOM-frei: neben `category` gibt es einen **Körperregion-Filter** (`EX_REGIONS` + `exerciseRegions(id)`
  aus `REGION_BY_ID`), `suggestedExercisesFor(type)` (Kraft → Kraft/Rumpf, Mobility/Recovery → Beweglichkeit)
  und `sortByUsage(list, usage)`. Der **Nutzungszähler** liegt pro Nutzer in `profile.settings.exerciseUsage`
  (`storage.exerciseUsage`/`bumpExerciseUsage`) – erhöht per „Gemacht (+1)“ im Katalog ODER automatisch beim
  Erledigen einer Einheit für deren `unit.exerciseIds` (`session.js logWorkout`). `renderPlanned` blendet bei
  Kraft-/Mobility-Einheiten die nach Nutzung sortierten Vorschläge ein (Toggle schreibt `unit.exerciseIds`);
  seit v3.14.0 sind sie auch im Vollbild-**Workout** erreichbar (`workout-mode.js renderWorkoutExercises`).
  Seit v3.22.0 stehen in Einheiten zuerst die Übungen, die Titel/Beschreibung nennen (`exercisesInText`:
  Name + `ALIASES`, nur am Wortanfang – „Sprungkniebeuge“ ist keine „Kniebeuge“; `exercisesForUnit`
  liefert `{ named, suggested, all }`). `test/exercises.test.js` erzwingt `caution` und `progression`
  (aus `DETAIL_BY_ID`). 93 Übungen, davon 8 Präventionsübungen als Fußball-Vorschlag (`PREVENTION_IDS`).
- **Animierte Übungen (seit v3.22.0).** Jede Übung hat einen Bewegungsablauf in `js/exercise-motions.js`
  (`MOTIONS`, Schlüssel = Übungs-ID; `test/exercise-motions.test.js` erzwingt die Zuordnung in beide
  Richtungen). Ein Ablauf ist reine Daten: Ansicht (`side`/`front`), Schlüsselposen (`keys`), Startpose,
  Phasen (`seq`: Pose, Dauer in Sekunden, Bezeichnung, Hinweis ≤ 44 Zeichen, Atmung), optional Einstieg
  (`intro`), Seiten (`alternate`/`each`), Hilfsmittel (`props`) und die hervorgehobenen Glieder
  (`focus`). Genau eines von `reps` (Wiederholungen) oder `holdS` (Halteübung – daraus folgt
  `exercise.hold`). Jeder Durchgang endet in der Startpose. Die Posen löst `js/motion-rig.js` (rein,
  DOM-frei): feste Gliedlängen (`BODY`), Boden bei y = 0, zweigliedrige inverse Kinematik für Ziele
  (`at`) oder feste Winkel (`a`); beim Überblenden bleiben aufgesetzte Hände und Füße stehen.
  `js/motion-figure.js` zeichnet daraus Kachel-Standbilder (Start blass, Zielpose kräftig) als
  SVG-String und die Animation als DOM, das einmal gebaut und je Bild nur umgesetzt wird;
  `js/motion-player.js` steuert Vorschau und „Mitmachen“ (`buildPlan`/`stateAt`: Einstieg,
  Wiederholungen bzw. Zeit, Seitenwechsel, Pausen; Ton per WebAudio, Wake Lock, reduzierte Bewegung →
  Standbild). Neue Übung = Katalogeintrag + Ablauf; prüfen mit
  `node tools/motion-sheet.mjs --only <id>` (HTML-Kontaktbogen mit Einzelbildern beider Seiten unter
  `.playwright-mcp/motion-sheet/`; mit `PLAYWRIGHT_MODULE` wie beim Render-Skript zusätzlich als PNG).
  Seit v3.23.0 zeichnet `js/coach-figure.js` die Pose als Vorturnerin (Körper mit Volumen, Kleidung,
  Zopf mit Nachschwung, Schatten; nur Formen, gezeichnet in `motion-figure.js`). `style: 'line'`
  liefert weiter die Linienfigur. `viewBoxFor(m, aspect)` passt den Ausschnitt an eine Bühne an.
- **Durchgehend mitmachen (seit v3.23.0).** `js/show-program.js` (rein): `dosesFromText` liest Mengen,
  Runden und Rundenpause aus der Einheitsbeschreibung (`unit.description`; Textstück je Übung bis „·“
  bzw. Satzende, „A & B 8×/Seite“ teilt die Menge), `programForUnit`/`programForWorkout` bilden das
  Programm, `buildShow` die Zeitleiste (ready · work · switch · rest · roundRest). `beatPlan` legt
  jede Bewegungsphase auf halbe (schnelle auf Viertel-)Schläge und jede Wiederholung auf ganze Schläge
  im Tempobereich des Stils; Pausen dauern ganze Takte. `js/workout-show.js` ist die Vollbild-Ansicht.
  **Regeln aus dem iPad-Test:** Die Uhr ist immer die Bildschirm-Uhr (die Audio-Uhr steht auf iOS bei
  jeder Unterbrechung still – das Bild fror ein). Die Musik spielt vorab gerechnete Schleifen
  (`music.js renderLoop`, vier Takte, Ausklang vorn eingemischt) und rastet je Abschnitt phasengenau
  ein; ein Wächter weckt alle 0,5 s den AudioContext (`wakeAudio`) und zieht den Takt nach (> 80 ms
  Versatz). Ansagen nur in Pausen – die Sprachausgabe unterbricht auf iOS die Musik; Ansagen bleiben
  referenziert, nach `cancel()` wartet `speak()` kurz (sonst verschluckt Safari sie). Kein Vollbild
  (Safari legt ein eigenes Schließen-Kreuz über die Bühne). Töne werden kurz vor ihrem Zeitpunkt auf
  die Audio-Uhr gelegt, um die Ausgabeverzögerung früher. `js/audio.js` schaltet Ton und
  Sprachausgabe in der Nutzergeste frei und meldet die Audio-Sitzung als Wiedergabe an
  (`navigator.audioSession`, sonst stummes `assets/audio/silence.wav`) – sonst bleibt Web Audio auf
  iPhone/iPad im Lautlos-Modus stumm. Fertige Workouts stehen in
  `js/workouts.js` (Katalog mit `cat` für die Filter). Ansagen kommen aus Sprachbausteinen
  (`js/voice.js`: `voiceTexts` listet alle, `assets/voice/<schlüssel>.m4a`), abgespielt über die
  Audio-Uhr – speechSynthesis nur als Rückfall, weil sie auf iOS neben Web Audio stumm bleibt. Neue
  Übung oder neuer Text → Bausteine neu erzeugen: `node --import ./test-setup.js tools/voice-texts.mjs`
  und `tools/voice-clips.py` (Piper + Stimme Thorsten, Anleitung im Kopf der Datei); ein Test prüft,
  dass zu jedem Baustein eine Datei existiert. Hörproben mit Pegeln: `node tools/music-preview.mjs` (Playwright wie oben).
- **Rollierende Planung, Triage & Dual-Goal (seit v3.8.0).** Reine Module, alle auf `today`-Basis
  und per node:test abgedeckt: `js/rolling.js` (Erholungstag-Erkennung aus ACWR/harten Tagen/Form; nur
  offene, NICHT-fixe fordernde Einheiten werden entlastet; Transparenz-Log `plan.adaptLog` mit
  Rückgängig-Snapshot – der zentrale Anwende-/Undo-Kern `applyAdapt`/`undoAdapt` liegt seit v3.14.0 in
  `js/adapt.js`, damit auch `cycle.js` protokolliert), `js/triage.js` (Wochen-Kollisionen
  + Prioritätsordnung feste Termine → Schlüssel → Kraft → Umfang → Erholung; `destackSuggestion` entzerrt
  Zwei-Ziele-Stapel), `js/whatif.js`
  (Vorher/Nachher der Wochenbelastung beim Hinzufügen/Verschieben – im Verschieben-Dialog & Unit-Creator),
  `js/dualgoal.js` (phasenabhängiger Schwerpunkt Leistung↔Abnehmen + gedeckelte Defizit-Empfehlung +
  ehrlicher Reiz-Check gegen „Ruhetag-Schönrechnerei“). Das Ziel-Cockpit (`dashboard.js goalCockpitCard`)
  koppelt Laufprognose, Gewichtsziel, Phase und Ernährung. Wichtig: Die Belastungs-Signale reagieren nur
  auf ABWEICHUNGEN vom Plan (`rolling.restDaySuggestion`: Ist-Last der letzten 7 Tage > 1,15 × Soll aus
  `whatif.unitLoad`, oder ≥ 3 harte Tage mit mindestens einem ungeplanten – `hardStreakInfo`); die Form nur
  mit eingeschwungener Fitnesskurve. Ziel ist nur eine harte Einheit der nächsten 2 Tage (Horizont 2) –
  liegen lockere Tage davor, wird nichts gestrichen. `footballFollowupEase` zählt nur tatsächlich gespielten Fußball. Feste
  Termine sind für alle Automatiken tabu (auch `weekDeloadCandidates`).
- **Die eine Tagesempfehlung (`js/coach.js`).** `coachDecision` sammelt alle Kandidaten und wählt nach
  fester Priorität genau einen (`primary`), der Rest steht in `suppressed` (Begründung via `coachWhy`).
  EIN RPE-Fenster (`planflow.rpeProgression`, 21 Tage, ≥ 4 Einheiten); `adaptive.recentLoadFeedback` gibt
  es nicht mehr – ein Belastungsurteil fällt nur `load.js`. Nach Krankheit/Verletzung (`returnPhase`,
  14 Tage): Wiedereinstieg, kein Nachholen, kein Umfangsausgleich, keine Steigerung. Getestet in
  `test/coach.test.js`.
- **Eine Zahl überall.** Plan-Einhaltung nur über `fitness.adherence` (heute erst erledigt fällig,
  Gesundheitsausfälle und geschützte Zyklustage neutral; Monatsbericht mit `to = min(Monatsende, heute)`),
  Lauf-km nur über `fitness.runKm`, Serien als Wochen-Serie (`badges.weekStreak`, ≥ 3 Trainingstage,
  Krankheitswochen pausieren), Momentum mit Krankheitspause und höchstens 5 Tagen je Woche. Das
  Team-Dashboard zählt nur Trainings-Abzeichen (`TRAINING_BADGE_CATS`) und rechnet ohne Zyklusdaten
  anderer. Getestet in `test/consistency.test.js`.
- **Bedienung (seit v3.20.0).** Menü und aktive Markierung nur über `nav.js` (`TAB_ITEMS`,
  `MORE_GROUPS`, `navMatches`, `navVisible`); Konto-Anzeigen nur über `accountBlock()` – immer die
  **angemeldete** Person (`identityMember`), nie das verwaltete Mitglied. Nach dem Speichern
  `refreshView()`/`goOrRefresh()` statt `location.reload()` (Test `test/refresh.test.js` erlaubt reload
  nur an vier Stellen). Knopfgruppen über `field()` (benannte Gruppe), Umschalter über `segmented()`
  (Radiogruppe), RPE/Gefühl/Dauer über `rpeScale`/`feelingPicker`/`durationFields`, Dateien über
  `saveFile()`. Text in Akzent- und Statusfarben nur über `--accent-text`/`--*-text` (Test
  `test/contrast.test.js`); Diagramme färben über CSS-Klassen. Neue Module ohne statische Zyklen
  (Test `test/import-graph.test.js`). Getestet außerdem in `test/nav.test.js`, `test/a11y.test.js`,
  `test/boot-check.test.js`.
- **Gemeinsame Helfer statt Kopien (seit v3.21.1).** Zahlen mit Komma über `fmtNum(n, stellen)` bzw.
  `fmtDec(bereitsGerundet)`, Mitgliedsfarben über `safeAccent`/`colorTint`, Neuzeichnen einer Ansicht
  über `rerenderView(render)` – alles aus `ui.js`. Zwischen Zahl und Einheit setzt `el()` beim Anzeigen
  selbst ein geschütztes Leerzeichen (`keepUnits`); gespeicherte Werte, CSV und Kalender bleiben mit
  normalem Leerzeichen. Tests auf angezeigte Texte erwarten deshalb `\u00a0` zwischen Zahl und Einheit.
  Ein Wächter (`test/shared-helpers.test.js`) verhindert, dass Kopien zurückkehren.
- **Adaptiv-Erweiterungen (seit v3.14.0), alle über `adapt.js` protokolliert & rückgängig:**
  (1) **Zyklus** – beim Eintragen eines Periodenbeginns für heute/morgen fragt `cycle.js askAboutFirstDay`
  nach dem Befinden; nur bei „Lockerer machen“ entschärft `applyCycleEasing` die Einheiten am 1. Tag
  (`cycleSoftenTargets` + `cycleEaseVariant`, typ-bewusst via `rolling.js gentleVariant`). Phasentipps
  neutral (`phaseTip`), Einstellung `cycleHormonal` (Phase `neutral` außer Blutungstagen, keine
  Ausbleiben-Frage), keine Phasen/Prognose über `PREDICTION_MAX_AGE_DAYS` hinaus.
  (2) **Zwei Ziele** – `restDayApply` nimmt planübergreifend den GANZEN Tag zurück (`planflow.js dayLoadUnits`);
  `triage.js destackSuggestion` + `findMakeupDay` bieten das Verschieben einer Einheit auf einen freien Tag an.
  (3) **Fußball** – `cross_football` trägt eine **Intensität** (leicht/normal/intensiv, `commitments.js`),
  zählt ab „normal“ als hart (`planflow.isHard`, `rolling.dayIsHard`), fließt über `fitness.footballRpe`/
  `sessionLoad` in die Last ein, und `rolling.footballFollowupEase` schlägt den lockeren Folgetag vor.
- **Teams (seit v3.9.0).** Teams sind zusätzliche `_kind:'team'`-Records in `family.json`
  (`{id, name, emoji, color, memberIds}`) – NEBEN Mitgliedern/`__settings`/`__pantry`; sie syncen
  record-agnostisch mit (kein Sync-Umbau). Ein Mitglied kann in MEHREREN Teams sein (Mehrfach-Mitgliedschaft:
  überschneidende `memberIds`), manche in keinem. Store-API (nur Admin): `teams`/`teamsOf`/`teamMembers`/
  `addTeam`/`updateTeam`/`removeTeam`/`setMemberTeams` (Zuordnung & Teamwechsel). `removeMember` räumt
  Team-Mitgliedschaften auf (keine „Geister“), `saveFamily` setzt/leert Teams beim autoritativen Reset.
  Die Aggregation bleibt team-AGNOSTISCH: `teamstats.js` bekommt einfach eine gefilterte Mitgliederliste
  (`filterTeamMembers`/`teamlessMembers`); das `#/family`-Dashboard schaltet oben zwischen Alle/Team/Ohne
  Team um, verwaltet wird in `#/familie-verwalten`. `MAX_MEMBERS = 32`. Getestet: `test/teams.test.js`;
  Demo: 11 Personen (eine davon 12 Jahre alt – Kinder- und Jugendprofil), 3 Teams, Henriette in 2, Horst ohne (`seedDemo` löst `team.memberNames` → IDs auf,
  `__self__` = Admin).

## Sicherheitsmodell (seit v3.20.0: Server-Sitzung für das Private)

Die App läuft im **vertrauenswürdigen Heimnetz**. Seit v3.20.0 gibt es eine schlanke
**Server-Sitzung nach PIN-Prüfung** (`api/auth.php`) – bewusst nur dort, wo es nötig ist, damit
bestehende Geräte, der Health-Eingang und `.ics`-Links weiter funktionieren:

- **PIN-Prüfung am Server:** `?action=login` prüft SHA-256 (`catofit:<id>:<pin>`, identisch zu
  `js/sha256.js`) und das alte djb2-Format, begrenzt Fehlversuche (5 in 15 min je Mitglied, dann
  `429`) und setzt das Cookie `catofit_sid` (HttpOnly, SameSite=Strict, Pfad = API-Verzeichnis,
  also getrennt für mehrere Installationen auf derselben Origin). Sitzungen liegen als
  `data/auth/sessions/<sha256(token)>.json` und verfallen nach 30 Tagen ohne Nutzung.
  **PIN-Hashes verlassen den Server nicht:** Familien-Antworten tragen `hasPin` plus den
  Platzhalter `pinHash: "server"`, an dem ältere App-Versionen scheitern (statt ein Profil ohne
  PIN zu öffnen). Der Client speichert nie einen PIN-Hash (`localFamilyRecord` räumt alte
  Zwischenspeicher beim Start auf).
- **Offline-Anmeldung:** Der Client merkt sich nach einer erfolgreichen Server-Anmeldung einen
  Prüfwert mit eigenem Geräte-Salz (`pinLocal`). Ohne Server geht die Anmeldung nur damit – also
  nur auf Geräten, auf denen die Person schon online angemeldet war. Die PIN bleibt dann bis zur
  nachgeholten Server-Anmeldung im Arbeitsspeicher (`pendingServerPin`, `catchUpServerLogin`).
  Begründung: Die erste Anmeldung braucht ohnehin den Server (die App-Shell kommt von dort);
  danach soll das Training offline weitergehen.
- **Private Bereiche** (`cycle`, `labs`, `supplements`): lesen und schreiben nur mit Sitzung
  derselben Person (`401`/`403`). Der Client synchronisiert sie nur, wenn `privateAllowed(user)`
  gilt; sonst bleiben Ops in der Queue. Verliert der Server die Sitzung, fragt die App per
  `catofit:session-required` nach der PIN (`reauth`), ohne abzumelden. Dasselbe gilt, wenn der
  Server beim ersten Abgleich nach dem Neuladen gar keine Sitzung dieser Person kennt (Update von
  v3.19.0, 30 Tage Leerlauf) – einmal je Seitenaufruf (`sessionAsked`), „Später“ wird respektiert.
- **Admin-Aktionen:** `delete-user` und Familien-Ops, die Mitglieder anlegen, Rollen ändern,
  Mitglieder löschen oder die Familie ersetzen, brauchen eine Admin-Sitzung (`family_guard`).
  Ausnahme: die Ersteinrichtung (noch keine Admin-Person). Abgelehnte Ops kommen als `rejected`
  zurück; der Client verwirft seine Fassung und holt den Server-Stand (`catofit:ops-rejected`).
  PIN-Hashes übernimmt der Server nur von einer Admin-Sitzung; `set-pin` ändert die eigene PIN
  nur mit der bisherigen.
- **Alle anderen Bereiche** bleiben im bisherigen Vertrauensmodell (jedes Gerät im Netz kann sie
  lesen und schreiben). Für den Betrieb außerhalb des Heimnetzes ist eine Anmeldung davor Pflicht
  (README; optional `CATOFIT_BASIC_AUTH` im Docker-Image).
- **Schutz vor fremden Seiten (CSRF):** schreibende Aktionen nur mit `Content-Type:
  application/json` (Formulare fremder Seiten können das nicht senden, `fetch` bräuchte einen
  CORS-Preflight, den der Server nicht beantwortet) und nicht bei `Sec-Fetch-Site: cross-site`
  bzw. `same-site`. Der Multipart-Upload `health-import` verlangt eine Sitzung (SameSite-Cookie).
- **Weitere Schichten:** optionale Host-Liste `CATOFIT_ALLOWED_HOSTS` (DNS-Rebinding),
  Sicherheits-Header und CSP (`.htaccess`, zusätzlich `<meta>` in `index.html`; darum kein
  Inline-Skript – siehe `js/boot-check.js`), Sperren für `tools/`, `test/`, `docs/` und
  Repo-Dateien, ZIP-Grenzen beim Health-Import, `LIBXML_NONET` + Entity-Loader aus.
- **Backend-Validierung:** `userId`-Whitelist (`^[A-Za-z0-9_-]{1,64}$`), Area-Whitelist,
  `scope ∈ {user, family}`, atomare Schreibvorgänge (`flock`, Temp→`rename`), `Cache-Control:
  no-store`. Kein Path-Traversal über `area`/`user`.
- **PIN-Regeln:** Admin-PIN in der Ersteinrichtung Pflicht; neue PINs 4–8 Ziffern und nicht
  `0000` (`pinProblem` im Client, `valid_new_pin` am Server). Neue Mitglieder starten mit `0000`
  und sehen auf „Heute“ einen Hinweis, bis sie eine eigene festlegen. Der Hash bleibt **in jedem
  Kontext identisch** (reiner SHA-256, nicht an `crypto.subtle` koppeln – sonst Aussperr-Gefahr
  zwischen http und https).
- **Kein XSS-Einfallstor durch Freitext:** Benutzertexte (Namen, Notizen, Titel, Werte) werden über
  `el({ text })` → `textContent` gesetzt; `el({ html })` ist ausschließlich internen, festen
  SVG-/Markup-Schnipseln vorbehalten. Akzent- und Mitgliedsfarben nur als Hex (`safeAccent`).
  Abgesichert durch `test/xss-sweep.test.js` (präparierter Text in allen Feldern, alle Ansichten).

## Eine Änderung veröffentlichen (Checkliste)

1. `js/version.js` **und** `package.json` `version` anheben (SemVer).
2. `service-worker.js` `VERSION` (Cache-Name) bumpen.
3. Neue Frontend-Datei? In `service-worker.js` `SHELL_ASSETS` eintragen.
4. Neue Daten-Area? In `js/storage.js` (`AREAS`/`ARRAY_AREAS`), `api/storage.php`
   (`user_areas`) und in `tools/loadtest.py`/`tools/loadtest_soak.py` (`USER_AREAS`) eintragen.
5. Tests grün halten / ergänzen: `npm test` (JS) **und** die PHP-Tests `php tools/test-health-ingest.php`,
   `php tools/test-health-xml.php`, `php tools/test-storage.php`, `php tools/test-api.php` und
   `php tools/test-ics.php`.
6. `CHANGELOG.md` und ggf. `docs/ROADMAP.md`, die Seiten unter `docs/` und die In-App-Hilfe
   (`js/helpcontent.js`) aktualisieren.
7. Doku-Bilder neu erzeugen: `node tools/render-screenshots.mjs` (einmalig
   `npm install --no-save playwright`). Das Skript startet eine frische Instanz mit leerem `data/`,
   einem festen Demo-Tag und der Persona „Alex“ und schreibt alle Bilder nach `docs/assets`
   (einzelne mit `--only 05,16`, das Banner mit `--only promo`). Texte, die Werte aus den Bildern
   zitieren – „Aktuelle Form“ in `docs/nutzung/coach-und-belastung.md`, das Ferritin-Beispiel in
   `docs/nutzung/labor.md` –, danach gegenlesen.

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
    plangen.js program.js Plan-Generatoren (Wettkampf / Programm), rein
    plans.js              Plan-Einrichtung, -Aktualisierung und -Ansicht
    load.js coach.js      Belastung (eine Quelle) und die eine Tagesempfehlung, rein
    fitness.js            gemeinsame Kennzahlen (Plan-Einhaltung, Lauf-km, Ampel), rein
    …                     weitere View- und Logik-Module
  api/                    PHP-Backend (Persistenz, Anmeldung, .ics, Health-Eingang und -Import)
  data/                   JSON-Daten (durch .htaccess geschützt)
  css/                    Stylesheets
  test/                   node:test (*.test.js)
  test-setup.js           Mini-DOM + localStorage-Shim für die Tests
  docs/                   Doku nach Zielgruppen (Landkarte docs/README.md), Architektur, Entwicklung
  tools/                  PHP-Tests, Lasttest, Demo-Seeds, Render-Skript, Bewegungs-Kontaktbögen, Musik-Hörproben, reset-pin.php
```

## Deployment

**Synology Web Station** – Kurzfassung, Details unter
[Installation](betrieb/installation.md#weg-3-webspace-oder-synology-web-station):

1. Web Station + PHP installieren, Projekt nach `/web/cat-o-fit` kopieren.
2. Dem Webserver-Nutzer (`http`) Schreibrechte auf `data/` geben.
3. Per HTTPS aufrufen; `api/api.php?action=ping` muss `{"ok":true}` liefern.

**Docker** (Multi-Arch: amd64 + arm64) – Details unter [Installation](betrieb/installation.md#weg-1-docker):

```bash
docker compose up -d                          # fertiges Image ziehen; App auf Port 8080
docker compose build && docker compose up -d  # selbst bauen
```

Der Container startet bewusst mit **leerer Instanz** (Ersteinrichtungs-Assistent);
Entwickler-Seeds (`tools/seed/`) und Laufzeitdaten kommen nicht ins Image (`.dockerignore`).
Optional: `CATOFIT_BASIC_AUTH=1` mit `CATOFIT_AUTH_USER`/`CATOFIT_AUTH_PASSWORD` (Anmeldung vor
der App; der Entrypoint legt die Apache-Konfiguration an), `CATOFIT_ALLOWED_HOSTS` und `TZ`
(Zeitzone für PHP und die Kalender-Dateien).

Es gibt keinen Build-Schritt – die Dateien werden unverändert ausgeliefert.
