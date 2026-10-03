# Installation (English)

Cat-O-Fit runs on your own hardware – via Docker (amd64 and arm64) or on any web server with PHP.
No database, no build step, no Node.js needed.

> **Language:** the app's user interface and the user guide are **German**. This page and the
> [English README](../../README.md) cover installation and operation in English. Detailed operating
> pages in German: [Installation](../betrieb/installation.md), [Update](../betrieb/update.md),
> [Backup](../betrieb/backup.md), [Datenschutz](../betrieb/datenschutz.md),
> [Fehlersuche](../betrieb/fehlersuche.md).

---

## Requirements

- **Docker** (amd64 or arm64) – the image brings everything else, **or**
- **PHP 8.1 or newer** (tested with 8.4) with `json`; `XMLReader` for the Apple Health full import,
  `zip` for ZIP uploads, `curl` and `mbstring` for the optional online nutrition lookup. With PHP 8.0
  every save fails (the storage layer needs `fsync`).
- Write access for the web server to the `data/` folder.
- A current Safari (iPhone/iPad), Chrome, Edge or Firefox.

## Docker

```bash
docker run -d --name cat-o-fit -p 8080:80 \
  -v cat-o-fit-data:/var/www/html/data \
  -e TZ=Europe/Berlin \
  ghcr.io/bingerminger/cat-o-fit:latest
```

Open **http://localhost:8080**. With Compose, use the repository's `docker-compose.yml` and run
`docker compose up -d` (pulls the image); to build it yourself: `docker compose build && docker compose up -d`.

**Synology Container Manager:** Project → Create → “Create docker-compose.yml” with the image
`ghcr.io/bingerminger/cat-o-fit:latest`, port `8080:80`, `TZ` and a bound folder such as
`/volume1/docker/cat-o-fit/data:/var/www/html/data`.

## Plain PHP host (e.g. Synology Web Station)

Copy all project files into a PHP-enabled web folder and give the web server write access to `data/`.
The bundled `.htaccess` files block `data/`, `tools/`, `test/`, `docs/` and repository files for Apache.
**Nginx does not read `.htaccess`** – add at least:

```nginx
location ~ /(data|tools|test|docs|docker)(/|$)   { deny all; }
location ~ /\.                                    { deny all; }
location ~ \.(md)$                                { deny all; }
```

## Environment variables (optional)

| Variable | Effect |
|---|---|
| `TZ` | Time zone for PHP and the calendar (`.ics`) files, e.g. `America/New_York`. Default `Europe/Berlin`. |
| `CATOFIT_TZ` | Like `TZ`, only for the calendar files; takes precedence. |
| `CATOFIT_BASIC_AUTH=1` + `CATOFIT_AUTH_USER` + `CATOFIT_AUTH_PASSWORD` | Basic auth in front of the whole app (Docker). The Apple Health endpoint (own key) and the health check stay reachable. |
| `CATOFIT_ALLOWED_HOSTS` | Comma-separated host names the API accepts (DNS rebinding protection). |

## Security model – read this

Cat-O-Fit is built for your **own, trusted network**. PINs protect the profiles and the private areas
(cycle, lab values, supplements) – also on the server, which hands them out only after that person's
PIN login. All other data (training, plans, body metrics, nutrition) can be read by any device that
reaches the server. **Exposing the app to the internet requires authentication in front of it:**
a VPN into your home network, a reverse proxy with login, or at least the built-in basic auth, always
with HTTPS. Whoever operates the server can read all files; they are stored unencrypted.

## Backups – read this too

Back up the server's `data/` folder (e.g. Synology Hyper Backup, restic, borg) following the
**3-2-1 rule**: three copies, two different media, one off-site. The in-app “Vollbackup” (full backup,
admins) deliberately excludes the private areas, so it does **not** replace backing up `data/`.

```bash
docker run --rm -v cat-o-fit-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/cat-o-fit-data-$(date +%F).tgz -C /data .
```

## First start, updates, lost PIN

- First visit starts the **setup wizard** (admin with own PIN, then demo data or empty).
- **Update:** `docker compose pull && docker compose up -d` – the data volume stays. On a plain PHP host,
  copy the new files over the old ones **except `data/`**.
- **Only admin forgot the PIN:**
  `docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Name" 2468`
  (lists members when called without arguments).
- Health check: `…/api/api.php?action=ping` returns `{"ok":true,…}`.
