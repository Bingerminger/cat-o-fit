# Update

[English](../../operations/update.md) · **Deutsch**

Ein Update tauscht die Programmdateien – deine Daten im Ordner `data/` bleiben unangetastet. Ältere
Datensätze liest jede neue Version weiter (Lese-Migration statt Umschreiben).

> Teil der [Dokumentation](../README.md) · [Betreiben](../README.md#betreiben)

**Auf dieser Seite:**

- [Vorher](#vorher)
- [Docker](#docker)
- [Synology Container Manager](#synology-container-manager)
- [Webspace oder Web Station](#webspace-oder-web-station)
- [Danach auf den Geräten](#danach-auf-den-geräten)
- [Zurück zur Vorversion](#zurück-zur-vorversion)

---

## Vorher

1. Den Ordner **`data/` sichern** (siehe [Backup](backup.md)) – das ist die einzige Vorbereitung, die
   wirklich zählt.
2. Den [CHANGELOG](../../../CHANGELOG.md) der neuen Version lesen: Dort steht, ob Nutzerinnen und Nutzer
   danach etwas tun müssen (z. B. Kalender-Abos neu einrichten).

---

## Docker

```bash
docker compose pull && docker compose up -d
```

bzw. ohne Compose: `docker pull ghcr.io/bingerminger/cat-o-fit:latest`, Container entfernen und mit
denselben Optionen (vor allem demselben Volume) neu starten. Das Volume bzw. der gebundene Ordner
`/var/www/html/data` bleibt dabei erhalten.

Wer Updates bewusst steuern will, nimmt statt `latest` ein Versions-Tag: `3.21` (alle Korrekturen der
Version 3.21) oder `3.21.0` (genau diese Version).

---

## Synology Container Manager

Container Manager → **Projekt** → dein Projekt anhalten → unter **Image** das Image
`ghcr.io/bingerminger/cat-o-fit` neu herunterladen → das Projekt neu erstellen bzw. starten. Die Daten
liegen im gebundenen Ordner (z. B. `/volume1/docker/cat-o-fit/data`) und bleiben erhalten.

---

## Webspace oder Web Station

1. Die neue Version herunterladen und entpacken.
2. Alle Dateien **außer dem Ordner `data/`** in den bestehenden App-Ordner kopieren und dabei
   überschreiben. `data/` weder löschen noch ersetzen – dort liegen eure Daten.
3. Dateien, die es in der neuen Version nicht mehr gibt, dürfen liegen bleiben; sie stören nicht.
4. Funktionstest: `…/api/api.php?action=ping` liefert `{"ok":true,…}`.

> Wer per Git aktualisiert (`git pull` im App-Ordner): `data/` ist bis auf den Zugriffsschutz nicht im
> Repository – ein Pull berührt eure Daten nicht.

---

## Danach auf den Geräten

- Jedes Gerät holt die neue Version beim **nächsten Öffnen** (bzw. wenn die App wieder in den
  Vordergrund kommt). Erscheint sie nicht: App ganz schließen und neu öffnen.
- Bringt ein Update eine neue Anmeldung am Server mit (wie 3.20.0), fragt die App einmal nach der PIN;
  „Später“ verschiebt das bis zum nächsten Öffnen.
- Offline gemachte Änderungen gehen nach dem Update ganz normal an den Server.

---

## Zurück zur Vorversion

- **Docker:** das vorige Versions-Tag starten (z. B. `ghcr.io/bingerminger/cat-o-fit:3.20.0`).
- **Web Station:** die Dateien der vorigen Version zurückkopieren – wieder ohne `data/`.
- Neuere Versionen können Felder anlegen, die eine ältere nicht kennt; sie bleiben dann ungenutzt liegen.
  Wurde nach dem Update schon viel geändert und verhält sich die ältere Version seltsam, hilft das
  Backup von `data/` von vor dem Update.
