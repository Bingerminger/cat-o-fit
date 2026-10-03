# Mitwirken an Cat-O-Fit

Schön, dass du beitragen möchtest! Cat-O-Fit ist **Trainingsplanung für die ganze Familie** als PWA –
bewusst schlank, ohne Build-Schritt und ohne externe Abhängigkeiten. Damit das so bleibt, hier die
wichtigsten Spielregeln.

## Grundprinzipien

- **Keine Abhängigkeiten.** Kein npm-Paket, kein Framework, kein CDN. Vanilla
  JavaScript (ES-Module), CSS und – fürs Speichern, Importieren und die Kalender-Dateien –
  schlankes PHP.
- **Kein Build-Schritt.** Was im Repo liegt, läuft direkt im Browser.
- **Local-first.** Die App funktioniert offline; das PHP-Backend dient der Persistenz
  (JSON-Dateien, **keine Datenbank**), der Anmeldung, der `.ics`-Ausgabe und dem Health-Import.
- **Logik testbar halten.** Reine Berechnungslogik gehört in DOM-freie Module
  (`js/fitness.js`, `js/load.js`, `js/energy.js`, `js/planflow.js`, `js/vdot.js`, `js/helpcontent.js` …)
  und wird per Unit-Test abgedeckt.
- **Datenschutz ernst nehmen.** Die **privaten Bereiche – Zyklus (`cycle`), Labor (`labs`) und
  Ergänzung (`supplements`)** – erscheinen nie im Team-/Familien-Dashboard, nie für Admins, nie im
  Vollbackup, und der Server gibt sie nur an die angemeldete Person selbst heraus (`api/auth.php`).
  Diese Invariante darf nicht aufgeweicht werden. Sicherheitsmodell: [SECURITY.md](SECURITY.md).

## Lokale Einrichtung

Voraussetzung: **Node.js 22 oder neuer** (nur für die Tests) und **PHP 8.1 oder neuer** fürs
vollständige Backend (lokal genügt `php -S`).

```bash
git clone https://github.com/Bingerminger/cat-o-fit.git
cd cat-o-fit

# Tests laufen lassen (reines Node, keine Installation nötig)
npm test
php tools/test-health-ingest.php && php tools/test-health-xml.php \
  && php tools/test-storage.php && php tools/test-api.php && php tools/test-ics.php

# App lokal servieren (Backend inklusive)
php -S localhost:8000
# danach http://localhost:8000 öffnen
```

Es gibt **kein** `npm install` – `package.json` enthält nur das Test-Skript.

## Tests

- Test-Framework: eingebautes **`node:test`** (keine Fremd-Runner); PHP-Tests unter `tools/test-*.php`.
- Neue/angepasste Logik **muss** durch Tests abgedeckt sein – am besten durch einen Test, der mit dem
  alten Code rot wäre. Lege Tests unter `test/<modul>.test.js` ab.
- UI lässt sich über das abhängigkeitsfreie Mini-DOM in `test-setup.js` testen
  (`test/views.test.js` als Vorlage).
- Die Doku ist mitgetestet (`test/docs.test.js`): Links und Anker, Bilder, Zahlen im README,
  Versionsgleichheit, Hilfe-Verweise.

## Konventionen

- **Versionierung:** Single Source of Truth ist `js/version.js`. Bei einer veröffentlichten
  Änderung `APP_VERSION` **und** `package.json` `version` anheben (SemVer), den **Service-Worker-Cache**
  (`VERSION` in `service-worker.js`) bumpen und neue Frontend-Dateien in `SHELL_ASSETS` eintragen.
- **Datenbereiche:** Neue Bereiche müssen **parallel** in `js/storage.js` (`AREAS`), `api/storage.php`
  (`user_areas`) sowie in `tools/loadtest.py` und `tools/loadtest_soak.py` (`USER_AREAS`) stehen.
- **Sprache:** UI-Texte, Doku und Commit-Beschreibungen auf **Deutsch**; Installation und Betrieb
  zusätzlich auf Englisch (`README.md`, `docs/en/`). Bezeichner im Code bleiben technisch (englisch),
  inklusive der gewachsenen Begriffe wie `scope=family` / `data/family/`.
- **Doku mitziehen:** Bei jedem Feature/Bugfix `CHANGELOG.md` und die passenden Seiten unter `docs/`
  (Übersicht: [docs/README.md](docs/README.md)) sowie die In-App-Hilfe (`js/helpcontent.js`)
  aktualisieren. Neue Kennzahlen bekommen einen Hilfeartikel und ein ⓘ (`infoButton`).
- **Stil:** Bestehendem Code-Stil folgen (`.editorconfig` beachten). Keine automatischen
  Massen-Reformatierungen.

## Begriffe und Schreibweise (Glossar)

| So schreiben | Nicht | Anmerkung |
|---|---|---|
| **Einheit** (geplant), **Training** (durchgeführt) | Session | Die Oberfläche sagt nie „Session“. |
| **Ziel** = **Wettkampf** oder **Trainingsprogramm** | Event, Veranstaltung | Menü „Ziele & Pläne“ |
| **Mitglied** (Rolle), **Person** (Fließtext), **Admin** bzw. Admin-Person | User, Nutzer | |
| **Abzeichen** | Badges | |
| **Momentum** (Schwung) | | einmal erklären |
| **Bereitschaft** | Readiness | |
| **Belastung**, **Belastungspunkte** (Minuten × Anstrengung) | Last-Punkte | Einheit „AU“ nur in Klammern |
| **Anstrengung (RPE)** | | Skala 1 sehr leicht … 10 maximal |
| **Trainingsbereiche** (Pace) | Pace-Bereiche, Zielpaces | |
| **Körperwerte** | | „Werte“ allein ist doppeldeutig (Labor) |
| **Daten & Sicherung**, **Mein Backup**, **Vollbackup** | Backup & Sicherung | |
| **die PIN** | der/einen PIN | |
| **Plan ab heute neu berechnen** | neu generieren, neu erstellen, aktualisieren | eine Aktion, ein Verb |
| **Ergänzung**, **Präparat** | Supplement | |
| **Energieversorgung** (Energieverfügbarkeit, RED-S) | Screening | kein Diagnose-Vokabular |

**Schreibweise:** neutral formulieren („wer trainiert“, „die Admin-Person“); der Doppelpunkt nur in
kurzen Beschriftungen („Administrator:in“). Anführungszeichen „so“ (unten öffnen, oben schließen),
Gedankenstrich „–“, Auslassung „…“. Zahlen mit **Dezimalkomma** (`fmtNum`, `fmtKm` …) – nie einen
rohen Wert mit Punkt in einen Satz einsetzen.

## Pull Requests

1. Branch von `main` abzweigen (`feature/...` oder `fix/...`).
2. Tests grün halten (`npm test` und die PHP-Tests), neue Tests ergänzen.
3. Doku/Changelog aktualisieren.
4. PR mit klarer Beschreibung öffnen; die [PR-Vorlage](.github/PULL_REQUEST_TEMPLATE.md) ausfüllen.
5. Die CI (GitHub Actions) muss grün sein.

## Fehler & Ideen melden

Nutze die [Issue-Vorlagen](.github/ISSUE_TEMPLATE/): **Bug** für reproduzierbare Fehler, **Feature**
für Vorschläge. Sicherheitsrelevantes bitte vertraulich über [SECURITY.md](SECURITY.md) melden.

Mit deinem Beitrag stimmst du zu, dass er unter der Lizenz des Projekts ([AGPL-3.0-or-later](LICENSE)) veröffentlicht
wird.
