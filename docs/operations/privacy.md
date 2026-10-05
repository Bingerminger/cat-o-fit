# Privacy when running the app

**English** · [Deutsch](../de/operations/privacy.md)

What is stored where, what leaves the house, who can read what – honestly, without marketing
language. Whoever runs Cat-O-Fit for a family or a team shares the responsibility for everyone else's
data; this page helps to judge that correctly.

> Part of the [documentation](../README.md) · [Run](../README.md#run) ·
> Please report security vulnerabilities confidentially: [SECURITY.md](../../SECURITY.md)

**On this page:**

- [What is stored where](#what-is-stored-where)
- [What leaves the house](#what-leaves-the-house)
- [Who can read what](#who-can-read-what)
- [Recommendations](#recommendations)

---

## What is stored where

| Place | Contents |
|---|---|
| **Device** (browser storage) | a copy of the signed-in person's data so the app works offline, plus changes not sent yet. With “Shared device” (Settings → Account), signing out clears the personal data again. |
| **Server, `data/` folder** | all data of all people as unencrypted JSON files: `family/` (members, roles, teams, check values of the PINs, shared settings such as the instance's default language), `users/<id>/` (plans, training, body values, nutrition, cycle, labs, supplements …; a person's own language choice is part of their profile), `auth/` (sign-in sessions, failed attempts, calendar keys), `foodfacts.json` (cache of the nutrition lookup). |
| **Backups** | Full backups contain the data of all members except the private areas; “My backup” contains one person's data including cycle, labs and supplements. |

---

## What leaves the house

Only two **optional** extra services; no account, no advertising, no telemetry:

| Service | Who asks | What is transmitted | How to switch off |
|---|---|---|---|
| **Open-Meteo** (weather) | the device, directly | the place name when searching, then coordinates | Settings → Location & weather |
| **Open Food Facts** (nutrition values) | your server | only the ingredient name or the barcode of a package | Settings → Nutrition → “Fill in nutrition values online” (off at first for new profiles; this also covers the barcode) |

Legal notes on the services: Open-Meteo's free interface is meant for non-commercial use only (under
10,000 calls a day); anyone running Cat-O-Fit commercially needs their own plan there. Nutrition data
from Open Food Facts is under the Open Database License (ODbL) – the app names the source. Details in
[CREDITS](../../CREDITS.md).

The **camera** for scanning barcodes starts only when you tap; the browser evaluates the image itself,
and it does not leave the device. **Activity files** (GPX, TCX, FIT, ZIP) are read by the device too –
only the result, that is the training, goes to the server.

Optional connections that you set up yourself (Apple Health through Health Auto Export or a Shortcut,
and on Android Health Connect through a bridge app) send from the phone **to your server** – not to
third parties. These apps come from other providers; what they do beyond that is governed by their own
privacy policies.

---

## Who can read what

| Who | What |
|---|---|
| the person themself | everything of their own, including cycle, labs and supplements (after their PIN sign-in) |
| admins in the app | when they “Open” a member: that member's plans, training and body values – **never** cycle, labs or supplements. In the team/family dashboard: the load and wellbeing of the people who switched on “Show my load to coaches” (off by default) |
| other members | in the team/family dashboard only what the person shares there (main goal, key figures) |
| any device that reaches the server | training, plans, body values, nutrition – the shared areas are **not** protected by the PIN. That is why the app belongs in your own network or behind a sign-in. |
| whoever operates the server | all files, including the private areas – they lie unencrypted on the disk |
| whoever knows a calendar link | the appointments of that plan (the link contains a personal key) |
| a tool with a person's read key | read-only access to their training, plans, body values and nutrition – **never** cycle, labs or supplements. Only if the person has switched on “Read access for your own tools” (off by default); switching it off invalidates the key immediately |

**Routes** from GPS files (a simplified line) are stored with the training. They show where someone
has been – often also where the round starts. Anyone who does not want that stored switches off “Save
the route too” when importing the file.

The key of the health ingest and of the read access belongs in the `X-Catofit-Token` header, not in the
URL – URLs end up in the access logs of server and proxy. Older setups with the key in the URL keep
working; a new key (Health import → ⟳) invalidates the old one.

---

## Recommendations

1. **Run it in your own network** or with a sign-in in front (VPN, reverse proxy with sign-in,
   built-in basic auth) – see [Installation](installation.md#running-outside-your-home-network).
2. **Everyone gets their own PIN** – new members start with `0000` and are reminded of that.
3. **Switch on “Shared device”** on family iPads.
4. **Protect your backups** – they contain health data (see [Backup](backup.md)).
5. **Remove members** who no longer use the app (More → Manage team) – their data then disappears
   from the server too.
