# Backup

Cat-O-Fit speichert alles als JSON-Dateien im Ordner `data/` auf eurem Server. Eine gute Sicherung
braucht keine Datenbank-Werkzeuge – aber eine Regel.

> Teil der [Dokumentation](../README.md) · [Betreiben](../README.md#betreiben)

**Auf dieser Seite:**

- [Drei Ebenen](#drei-ebenen)
- [Die 3-2-1-Regel](#die-3-2-1-regel)
- [Den Server-Ordner sichern](#den-server-ordner-sichern)
- [Wiederherstellen](#wiederherstellen)

---

## Drei Ebenen

| Ebene | Was drin ist | Wer | Wofür |
|---|---|---|---|
| **Server-Ordner `data/`** | alles: alle Personen, auch Zyklus, Labor und Ergänzungen, dazu Anmelde- und Kalender-Schlüssel | wer den Server betreibt | die eigentliche Sicherung – nach einem Serververlust der einzige vollständige Weg |
| **Vollbackup** (App, nur Admins) | alle Mitglieder, Rollen, Teams, Einstellungen, Trainingsdaten, Urkunden und Berichte – **ohne** Zyklus, Labor, Ergänzungen und ohne PINs | Admin-Person | schneller Notfall-Weg in der App, etwa nach einer Fehlbedienung |
| **Mein Backup** (App, alle) | die eigenen Daten **inklusive** Zyklus, Labor und Ergänzungen | jede Person selbst | persönliche Kopie, z. B. vor einem Gerätewechsel |

Das Vollbackup ersetzt die Sicherung von `data/` **nicht**: Aus Datenschutzgründen fehlen darin die
privaten Bereiche – nach einem Serververlust wären sie sonst für alle weg, die kein eigenes Backup haben.

---

## Die 3-2-1-Regel

Bewährt: **drei** Kopien eurer Daten, auf **zwei** verschiedenen Medien, **eine** davon außer Haus.
Also etwa der Server selbst, eine USB-Platte am NAS und eine verschlüsselte Kopie bei einem
Cloud-Speicher oder bei Verwandten. Sicherungen enthalten Gesundheitsdaten aller Mitglieder –
bewahre sie entsprechend geschützt auf.

---

## Den Server-Ordner sichern

- **Synology (Container Manager oder Web Station):** den Ordner (z. B. `/volume1/docker/cat-o-fit/data`
  bzw. `/volume1/web/cat-o-fit/data`) in **Hyper Backup** aufnehmen, täglich, mit Versionierung.
- **Docker mit benanntem Volume:**
  ```bash
  docker run --rm -v cat-o-fit-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/cat-o-fit-data-$(date +%F).tgz -C /data .
  ```
- **Jeder andere Server:** den Ordner `data/` in die gewohnte Sicherung (restic, borg, rsync …).

Eine Sicherung während des Betriebs ist in Ordnung: Jede Datei wird atomar geschrieben (erst eine
Kopie, dann umbenannt), halbe Dateien gibt es nicht.

---

## Wiederherstellen

**Server-Ordner:** App bzw. Container anhalten, den Inhalt von `data/` durch die Sicherung ersetzen,
wieder starten. Die Geräte holen den Stand beim nächsten Abgleich. Die Schreibrechte des Webservers auf
`data/` müssen danach wieder stimmen (siehe [Installation](installation.md#weg-3-webspace-oder-synology-web-station)).

**Vollbackup in der App:** Einstellungen → Daten & Sicherung → „Vollbackup wiederherstellen“ (nur
Admins, mit Verbindung zum Server). Das setzt die ganze Familie auf den Stand der Datei – private
Bereiche und PINs bleiben unangetastet; auf einem ganz neuen Server setzt die Admin-Person die PINs der
Mitglieder danach neu.

**Mein Backup:** Einstellungen → Daten & Sicherung → „Mein Backup importieren“.
