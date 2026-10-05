# Troubleshooting

**English** · [Deutsch](../de/operations/troubleshooting.md)

The most common stumbling blocks – first for everyone, then for the person who runs the server.

> Part of the [documentation](../README.md) · [Run](../README.md#run)

**On this page:**

- [The new version does not appear](#the-new-version-does-not-appear)
- [“Offline” or “Please confirm your PIN”](#offline-or-please-confirm-your-pin)
- [Forgotten PIN](#forgotten-pin)
- [“The app could not start” or a white page](#the-app-could-not-start-or-a-white-page)
- [Saving fails with “Server error”](#saving-fails-with-server-error)
- [Apple Health import](#apple-health-import)
- [Calendar](#calendar)

---

## The new version does not appear

The app fetches updates when it opens and when it comes back to the foreground. If that does not help:
**close the app completely** (iPhone: swipe up from the bottom edge and flick it away) and open it
again. Only as a last resort, delete the website data (iPhone: iOS Settings → Apps → Safari → Advanced
→ Website Data) – first make sure nothing is still waiting to be transmitted (the status is not
“Offline”), or save “My backup”.

---

## “Offline” or “Please confirm your PIN”

- **“Offline” stays:** Is the server reachable (Wi-Fi in your home network, VPN when out and about)?
  Opening `…/api/api.php?action=ping` in the browser must show `{"ok":true,…}`. Changes stay on the
  device and go out automatically as soon as the server answers.
- **“Please confirm your PIN”:** The sign-in at the server has expired (30 days without use) or is
  needed again after an update. With your PIN, cycle, labs and supplements are synced again; “Later”
  postpones that until the next time you open the app.
- **Syncing by hand:** Settings → Data & backup → “Sync now” starts the sync manually.

---

## Forgotten PIN

**A member:** An admin opens the member (More → Manage team → Open) and sets a new PIN under
Settings → Account.

**The only admin:** Then only the server can help. The tool `tools/reset-pin.php` sets a new PIN, ends
the person's sessions and deletes their failed attempts:

```bash
# without arguments: lists the members
php tools/reset-pin.php
php tools/reset-pin.php "Alex" 2468

# Docker
docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Alex" 2468

# Synology Web Station (via SSH, in the app folder)
cd /volume1/web/cat-o-fit && sudo -u http php tools/reset-pin.php "Alex" 2468
```

The new PIN: 4 to 8 digits, not `0000`. Then sign in to the app and choose your own under
Settings → Account. The tool runs only on the command line, never over the web.

---

## “The app could not start” or a white page

The message usually names the file that could not be loaded. Common causes:

- **Wrong file type:** `.js` files must be served as `text/javascript`. Apache takes care of that
  through the bundled `.htaccess`; with Nginx, add the MIME type.
- **Missing files:** Not all files were copied during the update – transfer the contents of the `js/`
  folder completely.
- **Access blocked:** A server rule that is too strict blocks `js/`, `css/` or `assets/` – only `data/`,
  `tools/`, `test/`, `docs/` and `docker/` should be blocked.

---

## Saving fails with “Server error”

- **PHP too old:** Cat-O-Fit needs **PHP 8.1** or newer; with 8.0 every save fails.
- **No write access:** The web server user must be allowed to write to `data/` (see
  [Installation](installation.md#option-3-web-hosting-or-synology-web-station)). After restoring a
  backup the permissions are often wrong.
- **Disk full** – the server cannot create the new file.

---

## Apple Health import

- **401 “Invalid token” (`code: invalid_token`):** The key does not match – after “Generate a new
  token”, replace the header value.
- **403:** Under Health import, first “Switch on auto-import”.
- **A ZIP is rejected:** The PHP extension `zip` is missing on the server – upload the `export.xml`
  from the ZIP on its own, or enable the extension.
- **The upload breaks off with large files:** With a plain PHP host (Option 3), raise `upload_max_filesize` and
  `post_max_size` (the Docker image allows 1 GB).
- More in [Apple Health](../usage/apple-health.md#troubleshooting).

---

## Calendar

- **A subscription shows nothing any more:** Links without a key (from versions before 3.20.0) only
  work until 30 November 2026 – in the plan, “…” → “Add to calendar (.ics)” → “Copy subscription
  link”, and subscribe again.
- **A subscription stays empty from the start:** iCloud, Google and Outlook fetch subscriptions over
  the internet and cannot reach a server that is only in your home network. Put the subscription
  directly on the device instead, see
  [Subscribe to the calendar](../usage/training.md#subscribe-to-the-calendar).
- **Times are off by hours:** The calendar time zone is `Europe/Berlin` unless `TZ` or `CATOFIT_TZ` say
  otherwise – see [Environment variables](installation.md#environment-variables).
