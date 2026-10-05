# Installation

**English** · [Deutsch](../de/operations/installation.md)

Cat-O-Fit runs on your own hardware: with Docker (amd64 and arm64) or on any web server with PHP.
No database, no build step and no Node.js needed.

> Part of the [documentation](../README.md) · [Run](../README.md#run)

**On this page:**

- [Requirements](#requirements)
- [Option 1: Docker](#option-1-docker)
- [Option 2: Synology Container Manager](#option-2-synology-container-manager)
- [Unraid](#unraid)
- [CasaOS](#casaos)
- [Option 3: Web hosting or Synology Web Station](#option-3-web-hosting-or-synology-web-station)
- [Environment variables](#environment-variables)
- [HTTPS and “Add to Home Screen”](#https-and-add-to-home-screen)
- [Running outside your home network](#running-outside-your-home-network)
- [Checking the installation and first start](#checking-the-installation-and-first-start)

---

## Requirements

| What | At least | What for |
|---|---|---|
| **Docker** | a current version, amd64 or arm64 | Options 1 and 2, Unraid and CasaOS – the image brings everything else |
| **or PHP** | **8.1** (tested with 8.4) | Option 3. With PHP 8.0 every save fails with “Server error” (saving needs `fsync`, which only exists from 8.1). |
| PHP extensions | `json` (standard); `XMLReader` for the full Apple Health import, `zip` (ZipArchive) for ZIP uploads; `curl` and `mbstring` for the online nutrition lookup | The app also starts without `XMLReader`/`zip` – only the import concerned then reports what is missing. |
| Write access | to the `data/` folder | All data lives there as JSON files. |
| Browser | a current Safari (iPhone/iPad), Chrome, Edge or Firefox | – |
| Node.js | 22 or newer – **only** for the developer tests | Not needed to run the app. |

---

## Option 1: Docker

```bash
docker run -d --name cat-o-fit -p 8080:80 \
  -v cat-o-fit-data:/var/www/html/data \
  -e TZ=Europe/Berlin \
  ghcr.io/bingerminger/cat-o-fit:latest
```

Then open **http://localhost:8080** in your browser. The image runs on Intel/AMD **and** on Apple
Silicon or ARM. With Docker Compose: take the `docker-compose.yml` from the repository and run
`docker compose up -d` – this pulls the ready-made image. **To build it yourself:**
`docker compose build && docker compose up -d`.

What the image brings: PHP 8.4 with all extensions, uploads up to 1 GB (full Apple Health import), a
built-in health check (status shown in `docker ps`, for example), extra protection of `data/` against
direct web access, and an empty first start with the first-time setup.

---

## Option 2: Synology Container Manager

1. In the **Package Center**, install **Container Manager**.
2. Container Manager → **Project** → **Create**; project name `cat-o-fit`, and create a path such as
   `/docker/cat-o-fit`.
3. As source choose “**Create docker-compose.yml**” and paste this content:

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

4. **Next → Done.** The app runs at `http://<ip-of-your-synology>:8080`. (If port 8080 is taken, change
   the first number, for example `8081:80`.)
5. Your data lives as ordinary files under `/volume1/docker/cat-o-fit/data` – ideal for the Synology
   backup (see [Backup](backup.md)).

---

## Unraid

The repository carries a ready-made template for the Docker tab:
[`deploy/unraid/cat-o-fit.xml`](../../deploy/unraid/cat-o-fit.xml). It follows the Community
Applications format and pre-fills image, port, data folder and the environment variables.

1. Open the Unraid terminal (or SSH) and download the template into your user templates:

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-cat-o-fit.xml \
     https://raw.githubusercontent.com/Bingerminger/cat-o-fit/main/deploy/unraid/cat-o-fit.xml
   ```

2. **Docker** tab → **Add Container** → in the **Template** list, pick the Cat-O-Fit entry under
   *User templates*.
3. Check the pre-filled values: web interface port **8080** (the container listens on 80), data folder
   `/mnt/user/appdata/cat-o-fit` (becomes `/var/www/html/data` in the container) and your time zone.
   The login variables (`CATOFIT_BASIC_AUTH` and friends) are under **Show more settings**.
4. **Apply.** Open the app at `http://<ip-of-your-unraid>:8080` or through the container's *WebUI*
   entry in the Docker tab.

Prefer to fill the form by hand? Repository `ghcr.io/bingerminger/cat-o-fit:latest`, one port
(host 8080 → container 80), one path (`/mnt/user/appdata/cat-o-fit` → `/var/www/html/data`) and the
variable `TZ` are all it needs. The container sets the owner of the data folder itself on every
start. Updates: in the Docker tab, check for updates and apply the update – the data folder stays.
Put `/mnt/user/appdata/cat-o-fit` into your appdata backup (see [Backup](backup.md)).

---

## CasaOS

For CasaOS (and ZimaOS) there is a Compose file with the app store details (icon, screenshots,
descriptions in English and German, notes for the environment variables):
[`deploy/casaos/docker-compose.yml`](../../deploy/casaos/docker-compose.yml). It runs on amd64 and arm64.

1. Open the file in the repository and copy its whole content (the *Raw* view is easiest).
2. In CasaOS: **App Store** → **Custom Install** → **Import**, paste the content and confirm.
3. Check the values: web interface port **8080** (the container listens on 80), data folder
   `/DATA/AppData/cat-o-fit/data` (becomes `/var/www/html/data` in the container) and the time zone `TZ`.
   The `CATOFIT_…` variables are optional; the install dialog describes each of them.
4. **Install**, then open the app from its tile or at `http://<ip-of-your-casaos>:8080`.

To update, let CasaOS pull the new image (app menu → **Update**, where available) – the data folder
stays. Include `/DATA/AppData/cat-o-fit/data` in your regular backup (see [Backup](backup.md)).

Both platforms are meant for your own home network. Before you open the app to the internet, read
[Running outside your home network](#running-outside-your-home-network).

---

## Option 3: Web hosting or Synology Web Station

1. **Install Web Station and PHP** (Package Center → Web Station, plus PHP 8.1 or newer, for example
   8.4).
2. Create a folder, for example `/web/cat-o-fit`, and copy **all files of this project** into it. In the
   download, the `data/` folder contains only its access protection (`data/.htaccess`) – so the app
   starts with the first-time setup.
3. In Web Station's web portal settings, set PHP for this folder to the installed version and enable
   the extensions from the [requirements](#requirements).
4. **Write access for `data/`:** The web server user (on Synology usually `http`) must be allowed to
   write there – DSM → Control Panel → Shared Folder → `web` → Permissions, or via SSH:
   ```
   chown -R http:http /volume1/web/cat-o-fit/data
   chmod -R 775 /volume1/web/cat-o-fit/data
   ```
5. **Check the access protection:** The bundled `.htaccess` files block web access to `data/`,
   `tools/`, `test/`, `docs/` and repository files such as `.git`. **Nginx** does not read `.htaccess`
   – in that case copy these rules into the server configuration, at least the one for `data/`:

   ```nginx
   location ~ /(data|tools|test|docs|docker)(/|$)   { deny all; }
   location ~ /\.                                    { deny all; }   # .git, .htaccess …
   location ~ \.(md)$                                { deny all; }
   add_header X-Frame-Options "DENY" always;
   add_header Referrer-Policy "no-referrer" always;
   add_header X-Content-Type-Options "nosniff" always;
   ```

   In addition, `.js` files must be served as `text/javascript` (with Apache the `.htaccess` takes care
   of that).

---

## Environment variables

All optional (Docker; with Option 3 through the server configuration):

| Variable | Effect |
|---|---|
| `TZ` | Time zone, for example `Europe/Vienna` or `America/New_York`. Applies to PHP and to the times in the calendar files. Without it: `Europe/Berlin`. |
| `CATOFIT_TZ` | Like `TZ`, but only for the calendar files – it takes precedence if `TZ` means something else on the host. |
| `CATOFIT_BASIC_AUTH=1` with `CATOFIT_AUTH_USER` and `CATOFIT_AUTH_PASSWORD` | Sign-in (basic auth) in front of the whole app. The health ingest endpoint (with its own key) and the health check stay reachable. |
| `CATOFIT_ALLOWED_HOSTS` | Comma-separated host names, for example `fit.example.org` – the API rejects requests to other names (protection against DNS rebinding). |

On [Unraid](#unraid) and [CasaOS](#casaos) the same variables are fields in the template (the login
and host variables as optional or advanced settings).

---

## HTTPS and “Add to Home Screen”

Installing the app (Safari → Share → “Add to Home Screen”) and reaching it from outside your home
need **HTTPS** with a valid certificate – for example through a reverse proxy (Synology: Login Portal →
Reverse Proxy with a Let's Encrypt certificate). Inside your home network the app also works over
`http://`; PIN sign-in works either way.

---

## Running outside your home network

Cat-O-Fit is built for your own, trusted network: The PIN protects the profiles and the private areas
(cycle, labs, supplements) – on the server too, which hands them out only after that person's PIN
sign-in – but **not** training, plans, body values or nutrition. If the app is to be reachable from the
internet (QuickConnect, port forwarding, VPS), **a sign-in in front of it is mandatory** – otherwise
anyone with the address can read and change this data. Whoever operates the server can read all
files; they are stored unencrypted (see [Privacy](privacy.md)).

- **Simplest:** a VPN into your home network (WireGuard, Tailscale, Synology VPN Server) – the app then
  is not public at all.
- **Reverse proxy with sign-in:** HTTPS plus a sign-in in front (for example Authelia, Authentik or the
  proxy's basic auth).
- **Docker:** switch on the built-in basic auth (see [Environment variables](#environment-variables))
  and expose the app only over HTTPS.
- **Health ingest:** Health Auto Export and Shortcuts usually cannot cope with a sign-in in front –
  `?action=health-ingest` is protected by its own key and should be exempted from the sign-in (the
  built-in basic auth does that automatically).

---

## Checking the installation and first start

- `https://<address>/cat-o-fit/api/api.php?action=ping` must return a JSON `{"ok":true,…}`.
- On the first visit the **first-time setup** starts: create the admin person with their own PIN, then
  choose “Start with demo data” or “Start empty”.
- **Language:** the app speaks English, German, French, Spanish, Italian, Brazilian Portuguese and
  Dutch. The language the first admin's browser uses during setup becomes the **instance default** – it
  applies to the sign-in screen and to every new person. Each person can choose their own under
  Settings → Appearance → Language; admins change the default in the “Administration (admin)” section
  of Settings (“Default language”). Instances that were set up before version 4.0.0 stay on German
  until someone changes that. Texts the server writes itself (for example calendar files) follow the language of the
  person concerned.
- **Back up right away:** put the `data/` folder into your regular server backup (3-2-1 rule); the
  in-app full backup deliberately leaves out the private areas and does **not** replace it – see
  [Backup](backup.md).
- **Updates:** `docker compose pull && docker compose up -d` – the data volume stays. On a plain PHP
  host, copy the new files over the old ones **except `data/`** – see [Update](update.md).
- **Forgotten PIN of the only admin:**
  `docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Name" 2468` (called without
  arguments it lists the members) – see [Troubleshooting](troubleshooting.md#forgotten-pin).
- Back to the start: at the very bottom of Settings, “Reset / clear app” (admins only).

Next: [Update](update.md) · [Backup](backup.md) · [Privacy](privacy.md) ·
[Troubleshooting](troubleshooting.md)
