# Changelog

Alle nennenswerten Änderungen an Cat-O-Fit werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [3.16.0] – 2026-08-02 – Fachliches Audit: Datensicherheit, Belastung & Trainingspläne

Ein vollständiges Review der Berechnungen, der Trainingsplan-Logik und der
Datenhaltung. Die Kennzahlen folgen jetzt durchgängig einer Methodik, und drei
Fehler mit echtem Schadenspotenzial sind behoben.

### Behoben
- **Kein stiller Datenverlust mehr bei vollem Speicher.** Ein unvollständiger
  Schreibvorgang wurde bisher nicht erkannt (`fwrite` meldet dann keinen Fehler,
  sondern eine zu kleine Byte-Zahl) – die abgeschnittene Datei landete am Ziel und
  wurde beim nächsten Lesen als *leerer* Bereich interpretiert und überschrieben.
  Jetzt wird die Schreibmenge geprüft, vor dem Umbenennen `fsync` erzwungen, und
  eine beschädigte Datei wird als `.corrupt-<Zeitstempel>` gesichert statt
  überschrieben.
- **Verschobene Einheiten zählen wieder mit.** Wer eine Einheit verschob, bekam sie
  am neuen Tag angezeigt – in Wochenbelastung, Wochen-Check, What-if-Vorschau,
  Nachhol-Tag-Suche und Erholungsvorschlägen war sie jedoch unsichtbar. Ausgerechnet
  die Kollisionswarnung schwieg also beim Verschieben. Der Status bleibt jetzt
  „geplant"; die Herkunft merkt sich `movedFrom` (der Chip „Verschoben" bleibt).
- **„Plan neu generieren" behält erledigte Einheiten.** Der Dialog versprach es,
  der Code ersetzte trotzdem alles – samt Verknüpfung zu den absolvierten Sessions
  und damit der Plan-Einhaltung.
- **Kein 21-km-Long-Run in Woche 1.** Der Einstieg richtet sich nach dem
  tatsächlichen Niveau (längster Lauf der letzten Wochen) statt starr nach der
  halben Renndistanz – für Marathon-Einsteiger:innen war das ein Verletzungsrisiko.
- **Feste Termine entkernen den Plan nicht mehr.** Lag ein Fußballtermin auf einem
  Trainingstag (z. B. Vereinstraining Di/Do), entfiel die Einheit ersatzlos –
  Schlüsselreiz und Umfang fehlten dann komplett. Jetzt weichen die Schlüsselreize
  auf einen freien Tag der Woche aus; nur lockere Einheiten entfallen.
- **Wettkampf-Einheit passt zur Distanz.** Zielpace, Herzfrequenzzone und
  Taktik-Hinweis richteten sich immer nach dem Halbmarathon („ab km 15 alles
  geben") – jetzt distanzgerecht von 5 km bis Marathon.
- **Kurzpläne enden mit Tapering.** Pläne unter vier Wochen bekamen keine
  Tapering-Phase; die Rennwoche ist nun immer eine Entlastungswoche.
- Kalorienbilanz: Der Ruheumsatz der Trainingszeit wurde doppelt gezählt
  (~100 kcal je Trainingsstunde zu viel); Laufeinheiten werden jetzt einheitlich
  über die Strecke gerechnet statt je nach Datenlage unterschiedlich.

### Geändert
- **Eine Formprognose statt zwei.** Die Wettkampfprognose nutzt jetzt dieselbe
  geglättete Formbasis (VDOT) wie die Trainingsbereiche, statt die schnellste
  Riegel-Hochrechnung aus allen Läufen zu nehmen. Ein einzelner zügiger 5er lässt
  die Marathonprognose damit nicht mehr purzeln; extreme Hochrechnungen
  (Faktor > 4) unterbleiben ganz.
- **Eine Belastungsrechnung statt zwei.** Die Statistik-Ampel bewertet die Last
  jetzt über alle Sportarten (Belastungspunkte statt nur Lauf-km) und mit denselben
  Schwellen wie die Karte „Belastung & Form" – Kraft und Fußball zählten dort bisher
  gar nicht.
- **Keine Fehlalarme in den ersten Wochen.** Ohne volle 4-Wochen-Historie meldete
  die Belastungssteuerung rechnerisch „zu schnell gesteigert" und schlug
  Erholungstage vor. Sie zeigt jetzt ehrlich „Datenbasis wächst noch".
- **Form wird korrekt eingeschwungen.** Die Fitness-Kurve hatte zu wenig Vorlauf,
  wodurch die angezeigte Form dauerhaft zu negativ war.
- Gewicht und Ruhepuls werden für die Trendbewertung über eine Woche geglättet
  (Tagesschwankungen von 1–2 kg erzeugten Zufallstrends).
- Kalorien-Empfehlung: Das Defizit folgt der Trainingsphase (Grundlage bis
  Tapering) statt pauschal −400 kcal und wird **nie unter den Grundumsatz**
  gesenkt – Schutz vor Unterversorgung bei hohem Trainingsumfang.
- Monotonie nach Foster mit der Stichproben-Standardabweichung berechnet.
- Nährwert-Schätzung: „Buttermilch", „Mandelmilch" und „Kokosmilch" werden nicht
  mehr als Butter bzw. Mandeln gewertet.
- **Docker:** OPcache aktiviert, Zeitzone per `TZ` einstellbar, und der Schnellstart
  weist deutlich darauf hin, dass die App ohne vorgelagerte Authentifizierung ins
  eigene Netz gehört.

## [3.15.1] – 2026-07-15 – Schnellstart, Feinschliff & Social-Preview

### Neu
- **Schnellstart im README:** drei Einstiegswege Schritt für Schritt – Docker mit
  einem Befehl, Synology Container Manager ganz ohne Kommandozeile (inkl. fertigem
  Compose-Block) und der klassische Weg ohne Docker – plus „Die ersten 5 Minuten
  in der App".
- **Social-Preview-Banner** (1280×640) für die Repo-Vorschau auf GitHub
  (`docs/assets/promo/social-preview.png` + Vorlage `social-preview.html`).

### Geändert
- Promo-Banner, Handbuch und Ersteinrichtung nennen die korrekten Demodaten-
  Dimensionen: **„bis zu 32 Profile"** und eine **komplette Beispiel-Familie mit
  Teams** (statt veraltet „10 Profile" bzw. „zwei Demo-Mitglieder").
- Endnutzer-Texte formulieren serverneutral („dein Server/NAS" statt nur
  „Synology") – im Handbuch und in der In-App-Hilfe. Die Apple-Health-Anleitung
  erklärt den `Authorization`-Header jetzt als optional (nur bei vorgeschalteter
  Basic-Auth) und ohne internes Umgebungs-Konzept.
- `.ics`-Export: PRODID-Schreibweise „Cat-O-Fit".

## [3.15.0] – 2026-07-15 – Erstveröffentlichung

Cat-O-Fit erscheint erstmals öffentlich – als ausgereifte Trainings-, Fitness- &
Health-PWA für Team und Familie (bis zu 32 Personen). Die Versionsnummer führt den
internen Entwicklungsstand fort; die Historie davor war nicht öffentlich.

### Stand dieser Veröffentlichung

- **Ziele:** periodisierte Wettkampfpläne (5 km bis Marathon, Triathlon, Hyrox)
  **und** Trainingsprogramme ohne Wettkampf (Fitness, Kraft, Abnehmen, Beweglichkeit).
- **Adaptive, rollierende Planung:** Belastungssteuerung nach Profistandard
  (ACWR, Fitness/Ermüdung/Form nach Banister, Monotonie/Strain nach Foster),
  Readiness-Coach, automatischer Erholungstag, Wochen-Check (Ziel-Triage),
  What-if-Vorschau – alles als Vorschlag mit Transparenz-Log und Rückgängig.
- **Zwei Ziele in einem Plan** (z. B. Halbmarathon + Abnehmen) mit
  phasenabhängigem Schwerpunkt und Defizit-Empfehlung.
- **Workout-Modus** mit Intervall-Engine (Ton + Vibration), Satz-Zähler &
  Pausentimer sowie eine **Übungs-Bibliothek** mit 29 illustrierten Übungen.
- **Team & Familie:** Ersteinrichtungs-Assistent, PIN-Login, Rollen, Teams mit
  Mehrfach-Mitgliedschaft, gemeinsames Dashboard, gemeinsamer Einkauf –
  **Zyklusdaten bleiben strikt privat**.
- **Ernährung:** Rezepte, Ess-Tagebuch, Kalorienbilanz, Nährwert-Schätzung
  (kuratierte Tabelle + optional Open Food Facts), Einkaufsliste mit Lager.
- **Körperwerte & Statistik:** interaktive Verlaufscharts (Scrubber-Tooltip,
  Y-Skala), Ampel „Bin ich auf Plan?", Trainingsjahr-Heatmap, Wettkampfprognose.
- **Importe & Export:** Apple-Health-Import (automatisch per REST-Automation oder
  manueller Voll-Import), GPX-/TCX-Einzelimport, `.ics`-Kalenderexport mit
  Erinnerungen.
- **Local-first-Sync** mit server-autoritativem Merge (kein Datenverlust bei
  gleichzeitigen Änderungen, per Lasttest belegt), Backup & Admin-Vollbackup
  mit Recovery.
- **Technik:** Vanilla JS + schlankes PHP, JSON-Dateien statt Datenbank,
  **0 Abhängigkeiten**, kein Build-Schritt, installierbar als PWA.
- **Deployment:** Synology Web Station, jeder PHP-Host **oder Docker**
  (Multi-Arch-Image für amd64 & arm64, GitHub Container Registry).
