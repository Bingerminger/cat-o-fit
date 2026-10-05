# Update

**English** · [Deutsch](../de/operations/update.md)

An update replaces the program files – your data in the `data/` folder stays untouched. Every new
version keeps reading older records (they are migrated on reading, not rewritten).

> Part of the [documentation](../README.md) · [Run](../README.md#run)

**On this page:**

- [Before you start](#before-you-start)
- [Docker](#docker)
- [Synology Container Manager](#synology-container-manager)
- [Web hosting or Web Station](#web-hosting-or-web-station)
- [Afterwards on the devices](#afterwards-on-the-devices)
- [Going back to the previous version](#going-back-to-the-previous-version)

---

## Before you start

1. **Back up the `data/` folder** (see [Backup](backup.md)) – this is the only preparation that really
   matters.
2. Read the [CHANGELOG](../../CHANGELOG.md) of the new version: it says whether users have to do
   something afterwards (for example set up calendar subscriptions again).

---

## Docker

```bash
docker compose pull && docker compose up -d
```

Without Compose: `docker pull ghcr.io/bingerminger/cat-o-fit:latest`, remove the container and start
it again with the same options (above all the same volume). The volume or bound folder
`/var/www/html/data` is kept.

If you want to control updates deliberately, use a version tag instead of `latest`: `4.0` (all fixes
of version 4.0) or `4.0.0` (exactly this version).

---

## Synology Container Manager

Container Manager → **Project** → stop your project → under **Image**, download the image
`ghcr.io/bingerminger/cat-o-fit` again → recreate or start the project. Your data lives in the bound
folder (for example `/volume1/docker/cat-o-fit/data`) and stays.

---

## Web hosting or Web Station

1. Download and unpack the new version.
2. Copy all files **except the `data/` folder** into the existing app folder and overwrite. Neither
   delete nor replace `data/` – your data lives there.
3. Files that no longer exist in the new version may stay; they do no harm.
4. Function test: `…/api/api.php?action=ping` returns `{"ok":true,…}`.

> If you update with Git (`git pull` in the app folder): apart from its access protection, `data/` is
> not in the repository – a pull does not touch your data.

---

## Afterwards on the devices

- Every device picks up the new version the **next time you open the app** (or when the app comes
  back to the foreground). If it does not appear: close the app completely and open it again.
- If an update brings a new sign-in at the server, the app asks for your PIN once; “Later” postpones
  that until the next time you open the app.
- Changes made offline go to the server as usual after the update.

---

## Going back to the previous version

- **Docker:** start the previous version tag (for example `ghcr.io/bingerminger/cat-o-fit:4.0.0`).
- **Web Station:** copy the files of the previous version back – again without `data/`.
- Newer versions may create fields that an older one does not know; they then stay unused. If a lot
  has changed since the update and the older version behaves strangely, the backup of `data/` from
  before the update helps.
