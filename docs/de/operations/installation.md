# Installation

[English](../../operations/installation.md) · **Deutsch**

Cat-O-Fit läuft auf eigener Hardware: per Docker (amd64 und arm64) oder auf jedem Webserver mit PHP.
Eine Datenbank, ein Build-Schritt oder Node.js sind nicht nötig.

> Teil der [Dokumentation](../README.md) · [Betreiben](../README.md#betreiben)

**Auf dieser Seite:**

- [Voraussetzungen](#voraussetzungen)
- [Weg 1: Docker](#weg-1-docker)
- [Weg 2: Synology Container Manager](#weg-2-synology-container-manager)
- [Unraid](#unraid)
- [CasaOS](#casaos)
- [Weg 3: Webspace oder Synology Web Station](#weg-3-webspace-oder-synology-web-station)
- [Umgebungsvariablen](#umgebungsvariablen)
- [HTTPS und „Zum Home-Bildschirm“](#https-und-zum-home-bildschirm)
- [Betrieb außerhalb des Heimnetzes](#betrieb-außerhalb-des-heimnetzes)
- [Funktionstest und erster Start](#funktionstest-und-erster-start)

---

## Voraussetzungen

| Was | Mindestens | Wofür |
|---|---|---|
| **Docker** | aktuelle Version, amd64 oder arm64 | Weg 1 und 2, Unraid und CasaOS – alles Weitere bringt das Image mit |
| **oder PHP** | **8.1** (getestet mit 8.4) | Weg 3. Mit PHP 8.0 scheitert jedes Speichern mit „Serverfehler“ (die Speicherung braucht `fsync`, das es erst ab 8.1 gibt). |
| PHP-Erweiterungen | `json` (Standard); für den Apple-Health-Voll-Import `XMLReader`, für ZIP-Uploads `zip` (ZipArchive); für die Nährwertsuche im Netz `curl` und `mbstring` | Die App startet auch ohne `XMLReader`/`zip` – nur der jeweilige Import meldet dann, was fehlt. |
| Schreibrechte | auf den Ordner `data/` | Dort liegen alle Daten als JSON-Dateien. |
| Browser | aktuelles Safari (iPhone/iPad), Chrome, Edge oder Firefox | – |
| Node.js | 22 oder neuer – **nur** für die Entwickler-Tests | Für den Betrieb nicht nötig. |

---

## Weg 1: Docker

```bash
docker run -d --name cat-o-fit -p 8080:80 \
  -v cat-o-fit-data:/var/www/html/data \
  -e TZ=Europe/Berlin \
  ghcr.io/bingerminger/cat-o-fit:latest
```

Dann im Browser **http://localhost:8080** öffnen. Das Image läuft auf Intel/AMD **und** Apple Silicon
bzw. ARM. Mit Docker Compose: die `docker-compose.yml` aus dem Repo nehmen und `docker compose up -d`
ausführen – das zieht das fertige Image. **Selbst bauen:** `docker compose build && docker compose up -d`.

Was das Image mitbringt: PHP 8.4 mit allen Erweiterungen, Uploads bis 1 GB (Apple-Health-Voll-Import),
einen eingebauten Healthcheck (Status z. B. in `docker ps`), einen zusätzlichen Schutz von `data/`
gegen direkten Webzugriff und einen leeren Erststart mit der Ersteinrichtung.

---

## Weg 2: Synology Container Manager

1. Im **Paket-Zentrum** den **Container Manager** installieren.
2. Container Manager → **Projekt** → **Erstellen**; Projektname `cat-o-fit`, als Pfad z. B.
   `/docker/cat-o-fit` anlegen.
3. Quelle „**docker-compose.yml erstellen**“ und diesen Inhalt einfügen:

   ```yaml
   services:
     cat-o-fit:
       image: ghcr.io/bingerminger/cat-o-fit:latest
       ports:
         - "8080:80"
       environment:
         - TZ=Europe/Berlin
       volumes:
         - /volume1/docker/cat-o-fit/data:/var/www/html/data
       restart: unless-stopped
   ```

4. **Weiter → Fertig.** Die App läuft unter `http://<ip-deiner-synology>:8080`. (Ist Port 8080 belegt,
   die erste Zahl ändern, z. B. `8081:80`.)
5. Deine Daten liegen als normale Dateien unter `/volume1/docker/cat-o-fit/data` – ideal für die
   Synology-Datensicherung (siehe [Backup](backup.md)).

---

## Unraid

Im Repo liegt eine fertige Vorlage für den Docker-Tab:
[`deploy/unraid/cat-o-fit.xml`](../../../deploy/unraid/cat-o-fit.xml). Sie folgt dem Format der Community
Applications und füllt Image, Port, Datenordner und die Umgebungsvariablen vor.

1. Das Unraid-Terminal (oder SSH) öffnen und die Vorlage in die Benutzervorlagen laden:

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-cat-o-fit.xml \
     https://raw.githubusercontent.com/Bingerminger/cat-o-fit/main/deploy/unraid/cat-o-fit.xml
   ```

2. Reiter **Docker** → **Add Container** → in der Liste **Template** den Eintrag Cat-O-Fit unter
   *User templates* wählen.
3. Die vorbelegten Werte prüfen: Port der Weboberfläche **8080** (der Container lauscht auf 80),
   Datenordner `/mnt/user/appdata/cat-o-fit` (wird im Container zu `/var/www/html/data`) und deine
   Zeitzone. Die Anmelde-Variablen (`CATOFIT_BASIC_AUTH` und Co.) stehen unter **Show more settings**.
4. **Apply.** Die App öffnest du unter `http://<ip-deines-unraid>:8080` oder über den Eintrag *WebUI*
   des Containers im Docker-Tab.

Lieber von Hand ausfüllen? Repository `ghcr.io/bingerminger/cat-o-fit:latest`, ein Port (Host
8080 → Container 80), ein Pfad (`/mnt/user/appdata/cat-o-fit` → `/var/www/html/data`) und die Variable
`TZ` – mehr braucht es nicht. Den Besitzer des Datenordners setzt der Container bei jedem Start
selbst. Updates: im Docker-Tab nach Updates suchen und das Update einspielen – der Datenordner bleibt.
Nimm `/mnt/user/appdata/cat-o-fit` in deine Appdata-Sicherung auf (siehe [Backup](backup.md)).

---

## CasaOS

Für CasaOS (und ZimaOS) gibt es eine Compose-Datei mit den App-Store-Angaben (Icon, Screenshots,
Beschreibungen auf Englisch und Deutsch, Hinweise zu den Umgebungsvariablen):
[`deploy/casaos/docker-compose.yml`](../../../deploy/casaos/docker-compose.yml). Sie läuft auf amd64 und arm64.

1. Die Datei im Repo öffnen und den ganzen Inhalt kopieren (am einfachsten in der Ansicht *Raw*).
2. In CasaOS: **App Store** → **Custom Install** → **Import**, den Inhalt einfügen und bestätigen.
3. Die Werte prüfen: Port der Weboberfläche **8080** (der Container lauscht auf 80), Datenordner
   `/DATA/AppData/cat-o-fit/data` (wird im Container zu `/var/www/html/data`) und die Zeitzone `TZ`.
   Die `CATOFIT_…`-Variablen sind optional; der Installationsdialog beschreibt jede davon.
4. **Install**, dann die App über ihre Kachel oder unter `http://<ip-deines-casaos>:8080` öffnen.

Zum Aktualisieren lässt du CasaOS das neue Image ziehen (App-Menü → **Update**, wo vorhanden) – der
Datenordner bleibt. Nimm `/DATA/AppData/cat-o-fit/data` in deine reguläre Sicherung auf (siehe
[Backup](backup.md)).

Beide Plattformen sind für das eigene Heimnetz gedacht. Bevor du die App ins Internet öffnest, lies
[Betrieb außerhalb des Heimnetzes](#betrieb-außerhalb-des-heimnetzes).

---

## Weg 3: Webspace oder Synology Web Station

1. **Web Station und PHP installieren** (Paket-Zentrum → Web Station, dazu PHP 8.1 oder neuer, z. B. 8.4).
2. Einen Ordner anlegen, z. B. `/web/cat-o-fit`, und **alle Dateien dieses Projekts** hineinkopieren.
   Der Ordner `data/` enthält im Download nur seinen Zugriffsschutz (`data/.htaccess`) – die App startet
   deshalb mit der Ersteinrichtung.
3. Im Webdienst-Portal PHP für diesen Ordner auf die installierte Version setzen und die Erweiterungen
   aus den [Voraussetzungen](#voraussetzungen) aktivieren.
4. **Schreibrechte für `data/`:** Der Webserver-Nutzer (Synology meist `http`) muss dort schreiben dürfen –
   DSM → Systemsteuerung → Gemeinsame Ordner → `web` → Berechtigungen, oder per SSH:
   ```
   chown -R http:http /volume1/web/cat-o-fit/data
   chmod -R 775 /volume1/web/cat-o-fit/data
   ```
5. **Zugriffsschutz prüfen:** Die mitgelieferten `.htaccess`-Dateien sperren `data/`, `tools/`, `test/`,
   `docs/` und Repo-Dateien wie `.git` für den Webzugriff. **Nginx** wertet `.htaccess` nicht aus – dann
   diese Regeln in die Server-Konfiguration übernehmen, mindestens die für `data/`:

   ```nginx
   location ~ /(data|tools|test|docs|docker)(/|$)   { deny all; }
   location ~ /\.                                    { deny all; }   # .git, .htaccess …
   location ~ \.(md)$                                { deny all; }
   add_header X-Frame-Options "DENY" always;
   add_header Referrer-Policy "no-referrer" always;
   add_header X-Content-Type-Options "nosniff" always;
   ```

   Außerdem müssen `.js`-Dateien als `text/javascript` ausgeliefert werden (bei Apache erledigt das die
   `.htaccess`).

---

## Umgebungsvariablen

Alle optional (Docker; bei Weg 3 über die Server-Konfiguration):

| Variable | Wirkung |
|---|---|
| `TZ` | Zeitzone, z. B. `Europe/Vienna` oder `America/New_York`. Gilt für PHP und für die Zeiten in den Kalender-Dateien. Ohne Angabe: `Europe/Berlin`. |
| `CATOFIT_TZ` | wie `TZ`, nur für die Kalender-Dateien – hat Vorrang, falls `TZ` auf dem Host etwas anderes bedeutet. |
| `CATOFIT_BASIC_AUTH=1` mit `CATOFIT_AUTH_USER` und `CATOFIT_AUTH_PASSWORD` | Anmeldung (Basic Auth) vor der ganzen App. Der Health-Eingang (eigener Schlüssel) und der Healthcheck bleiben erreichbar. |
| `CATOFIT_ALLOWED_HOSTS` | kommagetrennte Hostnamen, z. B. `fit.example.org` – Anfragen an andere Namen lehnt die API ab (Schutz vor DNS-Rebinding). |

Bei [Unraid](#unraid) und [CasaOS](#casaos) sind dieselben Variablen Felder der Vorlage (die Anmelde-
und Host-Variablen als optionale bzw. erweiterte Einstellungen).

---

## HTTPS und „Zum Home-Bildschirm“

Für die Installation als App (Safari → Teilen → „Zum Home-Bildschirm“) und für den Zugriff von unterwegs
braucht es **HTTPS** mit gültigem Zertifikat – etwa über einen Reverse-Proxy (Synology:
Anwendungsportal → Reverse-Proxy mit Let's-Encrypt-Zertifikat). Im Heimnetz läuft die App auch über
`http://`; die PIN-Anmeldung funktioniert auf beiden Wegen.

---

## Betrieb außerhalb des Heimnetzes

Cat-O-Fit ist für das eigene, vertrauenswürdige Netz gebaut: Die PIN schützt die Profile und die
privaten Bereiche (Zyklus, Labor, Ergänzungen) – auch auf dem Server, der sie erst nach der
PIN-Anmeldung der jeweiligen Person herausgibt –, aber **nicht** Trainings, Pläne, Körperwerte oder
Ernährung. Soll die App aus dem Internet erreichbar sein (QuickConnect, Portfreigabe, VPS), ist eine
**Anmeldung davor Pflicht** – sonst kann jede Person mit der Adresse diese Daten lesen und ändern. Wer
den Server betreibt, kann alle Dateien lesen; sie liegen unverschlüsselt (siehe
[Datenschutz](privacy.md)).

- **Am einfachsten:** VPN ins Heimnetz (WireGuard, Tailscale, Synology VPN Server) – die App bleibt dann
  gar nicht öffentlich.
- **Reverse-Proxy mit Anmeldung:** HTTPS plus eine Anmeldung davor (z. B. Authelia, Authentik oder die
  Basic Auth des Proxys).
- **Docker:** die eingebaute Basic Auth einschalten (siehe [Umgebungsvariablen](#umgebungsvariablen))
  und nur per HTTPS freigeben.
- **Health-Eingang:** Health Auto Export und Kurzbefehle können eine vorgeschaltete Anmeldung meist nicht –
  `?action=health-ingest` ist durch seinen eigenen Schlüssel geschützt und sollte von der Anmeldung
  ausgenommen werden (die eingebaute Basic Auth macht das automatisch).

---

## Funktionstest und erster Start

- `https://<adresse>/cat-o-fit/api/api.php?action=ping` muss ein JSON `{"ok":true,…}` liefern.
- Beim ersten Öffnen startet die **Ersteinrichtung**: Admin-Person mit eigener PIN anlegen, dann
  **„Mit Demodaten starten“** oder **„Leer starten“**.
- **Sprache:** Die App spricht Englisch, Deutsch, Französisch, Spanisch, Italienisch, brasilianisches
  Portugiesisch und Niederländisch. Die Sprache, die der Browser der ersten Admin-Person bei der
  Ersteinrichtung verwendet, wird zur **Standardsprache der Instanz** – sie gilt für die Anmeldeseite
  und für jede neue Person. Jede Person kann unter Einstellungen → Darstellung → Sprache ihre eigene
  wählen; Admins ändern die Standardsprache im Abschnitt „Verwaltung (Admin)“ der Einstellungen
  („Standardsprache“). Instanzen, die vor Version 4.0.0 eingerichtet wurden, bleiben auf Deutsch, bis
  jemand das ändert. Texte, die der Server selbst schreibt (zum Beispiel Kalender-Dateien), folgen der
  Sprache der jeweiligen Person.
- **Gleich sichern:** Den Ordner `data/` in die reguläre Serversicherung aufnehmen (3-2-1-Regel); das
  Vollbackup in der App lässt die privaten Bereiche bewusst aus und ersetzt sie **nicht** – siehe
  [Backup](backup.md).
- **Updates:** `docker compose pull && docker compose up -d` – das Daten-Volume bleibt. Auf einem
  reinen PHP-Host kopierst du die neuen Dateien über die alten, **außer `data/`** – siehe
  [Update](update.md).
- **PIN der einzigen Admin-Person vergessen:**
  `docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Name" 2468` (ohne Argumente listet das
  Werkzeug die Mitglieder auf) – siehe [Fehlersuche](troubleshooting.md#pin-vergessen).
- Zurück zum Anfang: In der App ganz unten in den Einstellungen **„App zurücksetzen“** (nur Admins).

Weiter: [Update](update.md) · [Backup](backup.md) · [Datenschutz](privacy.md) ·
[Fehlersuche](troubleshooting.md)
