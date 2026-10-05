# Backup

**English** · [Deutsch](../de/operations/backup.md)

Cat-O-Fit stores everything as JSON files in the `data/` folder on your server. A good backup needs
no database tools – but it needs one rule.

> Part of the [documentation](../README.md) · [Run](../README.md#run)

**On this page:**

- [Three levels](#three-levels)
- [The 3-2-1 rule](#the-3-2-1-rule)
- [Backing up the server folder](#backing-up-the-server-folder)
- [Restoring](#restoring)

---

## Three levels

| Level | What is in it | Who | What for |
|---|---|---|---|
| **Server folder `data/`** | everything: all people, including cycle, labs and supplements, plus sign-in and calendar keys | whoever runs the server | the actual backup – after losing the server, the only complete way back |
| **Full backup** (in the app, admins only) | all members, roles, teams, settings, training data, certificates and reports – **without** cycle, labs, supplements and without PINs | the admin | a quick emergency route inside the app, for example after a mistake |
| **My backup** (in the app, everyone) | your own data **including** cycle, labs and supplements | each person for themselves | a personal copy, for example before changing devices |

The full backup does **not** replace backing up `data/`: for privacy reasons it leaves out the private
areas – after losing the server they would otherwise be gone for everyone who has no backup of their
own.

---

## The 3-2-1 rule

Proven: **three** copies of your data, on **two** different media, **one** of them off-site. For
example the server itself, a USB drive on the NAS, and an encrypted copy with a cloud storage provider
or at relatives'. Backups contain the health data of all members – keep them protected accordingly.

---

## Backing up the server folder

- **Synology (Container Manager or Web Station):** add the folder (for example
  `/volume1/docker/cat-o-fit/data` or `/volume1/web/cat-o-fit/data`) to **Hyper Backup**, daily, with
  versioning.
- **Docker with a named volume:**
  ```bash
  docker run --rm -v cat-o-fit-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/cat-o-fit-data-$(date +%F).tgz -C /data .
  ```
- **Any other server:** include the `data/` folder in your usual backup (restic, borg, rsync …).

Backing up while the app is running is fine: every file is written atomically (first a copy, then
renamed), so there are no half-written files.

---

## Restoring

**Server folder:** stop the app or container, replace the contents of `data/` with the backup, start
again. The devices pick up the state at their next sync. Afterwards the web server's write access to
`data/` must be right again (see
[Installation](installation.md#option-3-web-hosting-or-synology-web-station)).

**Full backup in the app:** Settings → Data & backup → “Restore full backup (overwrites all)” (admins
only, with a connection to the server). This sets the whole family back to the state of the file –
private areas and PINs stay untouched; on a completely new server, the admin sets the members' PINs
again afterwards.

**My backup:** Settings → Data & backup → “Import my backup”.
