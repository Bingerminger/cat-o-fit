# Mitwirken an Cat-O-Fit

Schön, dass du beitragen möchtest! Cat-O-Fit ist eine **Fitness- & Health-PWA für
Teams und Familien** – bewusst schlank, ohne Build-Schritt und ohne externe
Abhängigkeiten. Damit das so bleibt, hier die wichtigsten Spielregeln.

## Grundprinzipien

- **Keine Abhängigkeiten.** Kein npm-Paket, kein Framework, kein CDN. Vanilla
  JavaScript (ES-Module), CSS und – nur fürs Speichern/Importieren – schlankes PHP.
- **Kein Build-Schritt.** Was im Repo liegt, läuft direkt im Browser.
- **Local-first.** Die App funktioniert offline; das PHP-Backend dient nur der
  Persistenz (JSON-Dateien, **keine Datenbank**), `.ics`-Ausgabe und dem Health-Import.
- **Logik testbar halten.** Reine Berechnungslogik gehört in DOM-freie Module
  (`js/fitness.js`, `js/energy.js`, `js/planflow.js`, `js/vdot.js`, …) und wird per
  Unit-Test abgedeckt.
- **Datenschutz ernst nehmen.** Zyklusdaten sind strikt privat (nie im
  Team-/Familien-Dashboard, nie für Admins sichtbar). Diese Invariante darf nicht
  aufgeweicht werden.

## Lokale Einrichtung

Voraussetzung: **Node.js ≥ 18** (nur für die Tests) und ein PHP-fähiger Webserver
fürs vollständige Backend (lokal genügt oft `php -S`).

```bash
git clone https://github.com/Bingerminger/cat-o-fit.git
cd cat-o-fit

# Tests laufen lassen (reines Node, keine Installation nötig)
npm test

# App lokal servieren (Backend inklusive)
php -S localhost:8000
# danach http://localhost:8000 öffnen
```

Es gibt **kein** `npm install` – `package.json` enthält nur das Test-Skript.

## Tests

- Test-Framework: eingebautes **`node:test`** (keine Fremd-Runner).
- Ausführen: `npm test`
- Neue/angepasste Logik **muss** durch Tests abgedeckt sein. Lege Tests unter
  `test/<modul>.test.js` ab.
- UI lässt sich über das abhängigkeitsfreie Mini-DOM in `test-setup.js` testen
  (`test/views.test.js` als Vorlage).

## Konventionen

- **Versionierung:** Single Source of Truth ist `js/version.js`. Bei einer
  veröffentlichten Änderung `APP_VERSION` **und** `package.json` `version` anheben
  (SemVer) und den **Service-Worker-Cache** (`VERSION` in `service-worker.js`) bumpen,
  damit Clients die neue Shell laden.
- **Datenbereiche:** Neue Daten-Areas müssen **parallel** in `js/storage.js` (`AREAS`)
  und `api/storage.php` (`user_areas`) eingetragen werden.
- **Sprache:** UI-Texte, Doku und Commit-Beschreibungen auf **Deutsch**. Bezeichner
  im Code bleiben technisch (englisch), inklusive der gewachsenen Begriffe wie
  `scope=family` / `data/family/`.
- **Doku mitziehen:** Bei jedem Feature/Bugfix `CHANGELOG.md` und – falls relevant –
  `docs/ROADMAP.md`, `docs/BENUTZERHANDBUCH.md` und die In-App-Hilfe aktualisieren.
- **Stil:** Bestehendem Code-Stil folgen (`.editorconfig` beachten). Keine
  automatischen Massen-Reformatierungen.

## Pull Requests

1. Branch von `main` abzweigen (`feature/...` oder `fix/...`).
2. Tests grün halten (`npm test`), neue Tests ergänzen.
3. Doku/Changelog aktualisieren.
4. PR mit klarer Beschreibung öffnen; die [PR-Vorlage](.github/PULL_REQUEST_TEMPLATE.md)
   ausfüllen.
5. Die CI (GitHub Actions) muss grün sein.

## Fehler & Ideen melden

Nutze die [Issue-Vorlagen](.github/ISSUE_TEMPLATE/): **Bug** für reproduzierbare
Fehler, **Feature** für Vorschläge. Sicherheitsrelevantes bitte vertraulich über
[SECURITY.md](SECURITY.md) melden.

Mit deinem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) des
Projekts veröffentlicht wird.
