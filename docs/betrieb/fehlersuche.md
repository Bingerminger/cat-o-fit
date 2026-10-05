# Fehlersuche

Die häufigsten Stolpersteine – erst für alle, dann für die Person, die den Server betreibt.

> Teil der [Dokumentation](../README.md) · [Betreiben](../README.md#betreiben)

**Auf dieser Seite:**

- [Neue Version erscheint nicht](#neue-version-erscheint-nicht)
- [„Offline“ oder „Bitte PIN bestätigen“](#offline-oder-bitte-pin-bestätigen)
- [PIN vergessen](#pin-vergessen)
- [„Die App konnte nicht starten“ oder weiße Seite](#die-app-konnte-nicht-starten-oder-weiße-seite)
- [Speichern scheitert mit „Serverfehler“](#speichern-scheitert-mit-serverfehler)
- [Apple-Health-Import](#apple-health-import)
- [Kalender](#kalender)

---

## Neue Version erscheint nicht

Die App holt Updates beim Öffnen und wenn sie wieder in den Vordergrund kommt. Hilft das nicht: App
**ganz schließen** (iPhone: vom unteren Rand nach oben wischen und wegschieben) und neu öffnen. Nur als
letzter Schritt die Website-Daten löschen (iPhone: iOS-Einstellungen → Apps → Safari → Erweitert →
Website-Daten) – vorher sicherstellen, dass nichts mehr auf Übertragung wartet (Status nicht „Offline“)
oder „Mein Backup“ sichern.

---

## „Offline“ oder „Bitte PIN bestätigen“

- **„Offline“ bleibt stehen:** Ist der Server erreichbar (WLAN im Heimnetz, VPN unterwegs)? Aufruf von
  `…/api/api.php?action=ping` im Browser muss `{"ok":true,…}` zeigen. Änderungen bleiben so lange auf
  dem Gerät und gehen automatisch raus, sobald der Server antwortet.
- **„Bitte PIN bestätigen“:** Die Anmeldung am Server ist abgelaufen (30 Tage ohne Nutzung) oder nach
  einem Update neu nötig. Mit der PIN gleichen Zyklus, Labor und Ergänzungen wieder ab; „Später“
  verschiebt das bis zum nächsten Öffnen.
- **Von Hand abgleichen:** Einstellungen → Daten & Sicherung → „Jetzt synchronisieren“ stößt den Abgleich von
  Hand an.

---

## PIN vergessen

**Ein Mitglied:** Eine Admin-Person öffnet das Mitglied (Mehr → „Team verwalten“ → „Öffnen“) und setzt
unter Einstellungen → Konto eine neue PIN.

**Die einzige Admin-Person:** Dann hilft nur der Server. Das Werkzeug `tools/reset-pin.php` setzt eine
neue PIN, beendet die Sitzungen der Person und löscht ihre Fehlversuche:

```bash
# ohne Argumente: listet die Mitglieder
php tools/reset-pin.php
php tools/reset-pin.php "Alex" 2468

# Docker
docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Alex" 2468

# Synology Web Station (per SSH, im App-Ordner)
cd /volume1/web/cat-o-fit && sudo -u http php tools/reset-pin.php "Alex" 2468
```

Die neue PIN: 4 bis 8 Ziffern, nicht `0000`. Danach in der App anmelden und unter Einstellungen → Konto
eine eigene wählen. Das Werkzeug läuft nur auf der Kommandozeile, nie über das Web.

---

## „Die App konnte nicht starten“ oder weiße Seite

Die Meldung nennt meist die Datei, die nicht geladen wurde. Häufige Ursachen:

- **Falscher Dateityp:** `.js`-Dateien müssen als `text/javascript` ausgeliefert werden. Apache erledigt
  das über die mitgelieferte `.htaccess`; bei Nginx den MIME-Typ ergänzen.
- **Fehlende Dateien:** Beim Update wurden nicht alle Dateien kopiert – den Inhalt des Ordners `js/`
  vollständig übertragen.
- **Zugriff gesperrt:** Eine zu strenge Server-Regel sperrt `js/`, `css/` oder `assets/` – nur `data/`,
  `tools/`, `test/`, `docs/` und `docker/` gehören gesperrt.

---

## Speichern scheitert mit „Serverfehler“

- **PHP zu alt:** Cat-O-Fit braucht **PHP 8.1** oder neuer; mit 8.0 scheitert jedes Speichern.
- **Keine Schreibrechte:** Der Webserver-Nutzer muss in `data/` schreiben dürfen (siehe
  [Installation](installation.md#weg-3-webspace-oder-synology-web-station)). Nach einem Zurückspielen
  einer Sicherung stimmen die Rechte oft nicht mehr.
- **Platte voll** – der Server kann die neue Datei nicht anlegen.

---

## Apple-Health-Import

- **401 „Invalid token“ (`code: invalid_token`):** Der Schlüssel passt nicht – nach „neu erzeugen“ den Header-Wert ersetzen.
- **403:** Unter Health-Import zuerst „Auto-Import aktivieren“.
- **ZIP wird abgelehnt:** Auf dem Server fehlt die PHP-Erweiterung `zip` – die `export.xml` aus dem ZIP
  einzeln hochladen, oder die Erweiterung aktivieren.
- **Upload bricht bei großen Dateien ab:** Bei Weg 3 `upload_max_filesize` und `post_max_size` erhöhen
  (das Docker-Image erlaubt 1 GB).
- Mehr unter [Apple Health](../APPLE-HEALTH.md#fehlersuche).

---

## Kalender

- **Abo zeigt nichts mehr:** Links ohne Schlüssel (aus Versionen vor 3.20.0) gelten nur bis
  30.11.2026 – im Plan „…“ → „In Kalender übernehmen (.ics)“ → „Abo-Link kopieren“ und neu abonnieren.
- **Abo bleibt von Anfang an leer:** iCloud, Google und Outlook holen Abos über das Internet ab und
  erreichen einen Server nur im Heimnetz nicht. Das Abo dann direkt aufs Gerät legen, siehe
  [Kalender abonnieren](../nutzung/training.md#kalender-abonnieren).
- **Uhrzeiten um Stunden verschoben:** Die Kalender-Zeitzone ist `Europe/Berlin`, solange `TZ` bzw.
  `CATOFIT_TZ` nichts anderes sagt – siehe [Umgebungsvariablen](installation.md#umgebungsvariablen).
