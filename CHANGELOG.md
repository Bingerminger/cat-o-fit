# Changelog

Alle nennenswerten Änderungen an Cat-O-Fit werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

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
