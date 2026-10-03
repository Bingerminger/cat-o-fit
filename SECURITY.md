# Sicherheitsrichtlinie

Cat-O-Fit verarbeitet persönliche Gesundheits- und Trainingsdaten. Sicherheit und
Datenschutz werden daher ernst genommen – auch wenn es sich um ein kleines,
quelloffenes Projekt handelt.

## Eine Schwachstelle melden

Bitte melde mögliche Sicherheitslücken **vertraulich** und **nicht** über
öffentliche Issues:

- Über die GitHub-Funktion **„Report a vulnerability“** (Reiter *Security* des
  Repositorys → *Advisories*). Die Meldung sieht nur die Projektleitung.
- Fehlt die Schaltfläche, eröffne bitte ein Issue **ohne technische Details** mit der
  Bitte um einen vertraulichen Kontakt – wir melden uns dann mit einem privaten Weg.

Bitte gib genug Informationen zur Reproduktion an (betroffene Datei/Route, Schritte,
mögliche Auswirkung). Du erhältst nach Möglichkeit innerhalb von **7 Tagen** eine
Rückmeldung. Bitte gewähre eine angemessene Frist zur Behebung, bevor Details
öffentlich gemacht werden (Responsible Disclosure).

## Unterstützte Versionen

| Version | Sicherheitskorrekturen |
|---|---|
| jeweils aktuelle Minor-Version auf `main` (Docker-Tag `latest`) | ✅ |
| ältere Versionen | ❌ – bitte aktualisieren |

## Sicherheitsmodell

Cat-O-Fit ist für den Betrieb im **eigenen, vertrauenswürdigen Netz** gebaut
(z. B. Synology im Heimnetz). Was die App schützt – und was nicht:

- **PIN und Server-Sitzung:** Der Server prüft die PIN (SHA-256, Fehlversuche werden
  begrenzt) und öffnet danach eine Sitzung (HttpOnly-Cookie). PIN-Hashes verlassen den
  Server nicht. Die eigene PIN lässt sich nur mit der bisherigen ändern; die eines
  Mitglieds setzt nur eine Admin-Person neu.
- **Private Bereiche:** Zyklus, Labor und Ergänzungen gibt der Server nur an die
  angemeldete Person selbst heraus – auch nicht an Admins. Sie fehlen im
  Familien-Vollbackup.
- **Alle anderen Bereiche** (Trainings, Pläne, Körperwerte, Ernährung …) folgen dem
  Heimnetz-Modell: Jedes Gerät, das den Server erreicht, kann sie lesen und ändern.
- **Admin-Aktionen** (Mitglieder anlegen, Rollen ändern, Mitglieder löschen, die
  Familie ersetzen) verlangen eine Admin-Anmeldung am Server.
- **Fremde Webseiten** können keine Änderungen auslösen: Schreibende Aufrufe nimmt der
  Server nur als JSON und nicht von fremden Seiten an. Strenge Content-Security-Policy,
  kein Einbetten in fremde Seiten.
- **Wer den Server betreibt,** kann alle Daten lesen – sie liegen unverschlüsselt als
  JSON-Dateien in `data/`. Das gilt auch für die privaten Bereiche.

## Wichtige Betriebshinweise

- **Aus dem Internet erreichbar?** Dann ist eine Anmeldung davor **Pflicht** (VPN,
  Reverse-Proxy mit HTTPS und Anmeldung oder die eingebaute Basic-Auth des
  Docker-Images) – siehe [Installation › Betrieb außerhalb des Heimnetzes](docs/betrieb/installation.md#betrieb-außerhalb-des-heimnetzes).
- `data/`, `tools/`, `test/`, `docs/` und Repo-Dateien sind per `.htaccess` gesperrt.
  Unter **nginx** greifen diese Dateien nicht; die nötigen Sperren stehen in der [Installation](docs/betrieb/installation.md).
- **Geteilte Geräte:** Nach dem Abmelden bleiben Daten im Browserspeicher, damit die
  App offline funktioniert. In den Einstellungen räumt **„Gemeinsames Gerät“** beim
  Abmelden alle persönlichen Daten vom Gerät.
- **Externe Verbindungen:** nur zwei optionale, abschaltbare Dienste – die
  Wetterabfrage bei Open-Meteo (direkt vom Gerät, mit Ort bzw. Koordinaten) und die
  Nährwertsuche bei Open Food Facts (vom Server, nur mit dem Zutatennamen; für neue
  Profile standardmäßig aus). Siehe [CREDITS.md](CREDITS.md).

## Geltungsbereich

Sicherheitsrelevant sind insbesondere:

- Das PHP-Backend unter `api/` (Anmeldung/Sitzung in `auth.php`, Datei-I/O,
  Pfad-Behandlung, Eingabevalidierung, `userId`-Whitelist).
- Die Trennung der Nutzerdaten im Mehrbenutzer-Betrieb (`data/users/<id>/`,
  `data/family/`) und die Privatheit der privaten Bereiche.
- Der Health-Eingang (`?action=health-ingest`, Schlüssel je Person) und die
  Kalender-Links (`?action=ics`, Schlüssel je Person).
