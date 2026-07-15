# Sicherheitsrichtlinie

Cat-O-Fit verarbeitet persönliche Gesundheits- und Trainingsdaten. Sicherheit und
Datenschutz werden daher ernst genommen – auch wenn es sich um ein kleines,
quelloffenes Projekt handelt.

## Eine Schwachstelle melden

Bitte melde mögliche Sicherheitslücken **vertraulich** und **nicht** über
öffentliche Issues:

- Bevorzugt über die GitHub-Funktion **„Report a vulnerability"** (Security Advisories)
  des Repositorys.
- Alternativ per E-Mail an den Maintainer (siehe GitHub-Profil **@Bingerminger**).

Bitte gib genug Informationen zur Reproduktion an (betroffene Datei/Route, Schritte,
mögliche Auswirkung). Du erhältst nach Möglichkeit innerhalb von **7 Tagen** eine
Rückmeldung. Bitte gewähre eine angemessene Frist zur Behebung, bevor Details
öffentlich gemacht werden (Responsible Disclosure).

## Geltungsbereich

Sicherheitsrelevant sind insbesondere:

- Das PHP-Backend unter `api/` (Datei-I/O, Pfad-Behandlung, Eingabevalidierung,
  `userId`-Whitelist).
- Trennung der Nutzerdaten im Mehrbenutzer-Betrieb (`data/users/<id>/`,
  `data/family/`).
- Die **Privatheit der Zyklusdaten** (dürfen niemals im Team-/Familien-Dashboard
  oder für Admins sichtbar werden).
- Der PIN-Login (Frontend-seitig, SHA-256).

## Wichtige Betriebshinweise

Cat-O-Fit ist für den Betrieb im **privaten/vertrauten Netz** (z. B. Synology Web
Station im Heimnetz) konzipiert:

- Der PIN-Login ist ein **Komfort-/Profilschutz**, kein serverseitiger
  Authentifizierungsmechanismus. Die JSON-Daten liegen im Klartext auf dem Server.
- Wer die App aus dem Internet erreichbar macht, sollte den Zugriff zusätzlich
  absichern (z. B. HTTPS + vorgelagerte Authentifizierung/Reverse-Proxy) und den
  `data/`-Ordner vor direktem Web-Zugriff schützen.
- Es werden keine Daten an Dritte gesendet; einzige externe Verbindung ist die
  optionale Wetterabfrage an Open-Meteo (siehe [CREDITS.md](CREDITS.md)).

## Unterstützte Versionen

Sicherheitskorrekturen fließen in die **jeweils aktuelle** Version auf `main` ein.
Ältere Versionen werden nicht separat gepflegt.
