# Roadmap

Die geplante Entwicklung von Cat-O-Fit, grob nach Priorität. Was schon erledigt ist, steht im
[CHANGELOG](../../CHANGELOG.md) (Englisch). Vorschläge und Hilfe sind willkommen – siehe
[CONTRIBUTING](../../CONTRIBUTING.md). English: [Roadmap](../ROADMAP.md).

**Stand:** 13. November 2026, v4.1.1.

**Wo du sie verfolgst:** Jedes Release hat einen [Meilenstein](https://github.com/Bingerminger/cat-o-fit/milestones)
mit einem Sammel-Issue, und das [Board](https://github.com/users/Bingerminger/projects/2) zeigt, was
angenommen, geplant, in Arbeit und ausgeliefert ist. Ideen gehören in
[Discussions › Ideas](https://github.com/Bingerminger/cat-o-fit/discussions/categories/ideas), dort
können alle mit 👍 abstimmen; Fehler in ein [Issue](https://github.com/Bingerminger/cat-o-fit/issues/new/choose).

## In Arbeit: v4.2 – Kraft, Bewegung und Verlässlichkeit

Sammel-Issue: [#6](https://github.com/Bingerminger/cat-o-fit/issues/6).

- **Krafttraining in der Tiefe** – geschätztes 1RM, Bestleistungen erkennen und ein Scheibenrechner;
  Pausentimer je Übung, Einsteigerprogramme, einen Plan als Datei oder PDF teilen; eigene Übungen und
  gespeicherte Mitmach-Workouts; ein Workout einer geplanten Einheit zuordnen.
- **Realistischere Vorturn-Animationen** für alle Übungen und eine männliche Vorturnfigur als Option
  neben der heutigen.
- **Eine größere Übungsbibliothek** – von 93 auf rund 120 animierte Übungen, in allen sieben Sprachen
  und mit Ansagen.
- **Klügere Pläne** – der Plan passt den Wochenumfang selbst an die Belastungssignale an (heute schlägt
  der Coach eine Korrektur vor, die du mit einem Tipp übernimmst); eine Saison mit mehreren Rennen
  (Haupt- und Nebenrennen, kurze Taper und Erholung dazwischen); Kraftblöcke, die der Planphase folgen
  (Grundlage, rennspezifisch, Taper).
- **Schwellenpace, FTP und CSS** aus einer Leistungsdiagnostik, ohne dass eine zweite Pace-Quelle der
  Formschätzung widerspricht; **Wetter je Einheit** – Hitze und Laufband zählen in der Formschätzung,
  nicht nur in einem Hinweis.
- **Verlässlichkeit** – Abgleich zwischen Geräten, Start ohne Netz, der Plan-Generator, Importe sowie
  Zyklus- und Laborwerte an den Rändern; eine überarbeitete Oberfläche (Kontrast, Fokus,
  Bildschirmleser, leere Ansichten).
- **Technik** – `storage.js` in Module hinter einer Fassade aufgeteilt (mit Lasttest), ein schnelleres
  Admin-Backup (eine Anfrage je Mitglied statt je Bereich), Tests in echten Browsern (Chromium und die Engine von Safari) und unter
  verstellter Uhr sowie ein signiertes Docker-Image mit Stückliste (SBOM).

## Erledigt: v4.1.0 – Deine Einheiten

Meilen und min/mi, Pfund, Fuß und Zoll, °F, der erste Tag der Woche und Laborwerte in konventionellen
Einheiten wie mg/dL – je Person wählbar, mit der Region des Browsers als Vorgabe; gespeichert wird
weiter metrisch. Details im [CHANGELOG](../../CHANGELOG.md).

## Erledigt: v4.0.0 – Cat-O-Fit spricht deine Sprache

Das erste öffentliche Release: sieben Sprachen mit einer Sprache je Person, Servertexte und
eingesprochene Ansagen in jeder Sprache, Englisch für Entwicklerinnen und Entwickler, die Lizenz
AGPL-3.0-or-later, eine öffentliche Demo, der Import aus Strong, Hevy und FitNotes sowie Vorlagen für
Unraid und CasaOS. Details im [CHANGELOG](../../CHANGELOG.md).

## Nach v4.2

### v4.3 – Kalender und Strecken

- **Vereinskalender (.ics)** – Spiele und Trainings als feste Termine übernehmen; ein Abruf durch den
  Server nur mit Schutz gegen Anfragen ins lokale Netz.
- **GPX/FIT-Export** eigener Aktivitäten. (Ein vollständiges JSON-Backup, der CSV-Export und ein
  Lesezugang für eigene Werkzeuge wie einen KI-Assistenten gibt es schon.)
- **Strecken als einfache Zeichnung** ohne Kartendienst.

### v4.4 – Offene Verbindungen

- Zyklusdaten aus Apple Health.
- Web Push für installierte PWAs (iOS 16.4+) als optionale Ergänzung zu den `.ics`-Erinnerungen.
- Eine echte Nährwert-Datenbank neben den kuratierten Werten und Open Food Facts.
- Laborkatalog mit LOINC-Codes, sorgfältig je Einheit zugeordnet; neue Werte wie Glukose und Cholesterin.

### Auf Nachfrage

- Weitere Sprachen (Polnisch, Schwedisch, Dänisch, Tschechisch, Ukrainisch …) und eine
  Übersetzungsplattform, sobald Mitwirkende danach fragen.

## v5.0.0 – Organisationen: echte Authentifizierung und Privatsphäre über 32 Personen hinaus

Das heutige Familien- und Teammodell beruht auf **Vertrauen**. Seit v3.20.0 prüft der Server die PIN,
öffnet eine Sitzung und schützt die privaten Bereiche (Zyklus, Laborwerte, Ergänzungen) und die
Admin-Aktionen. Alle anderen Daten kann jedes Gerät im Netz lesen, eine Admin-Person kann jedes
Mitglied öffnen und verwalten, und die Team- und Familienzahlen werden **im Browser** über alle
Mitglieder zusammengerechnet (`teamstats.js`). Für eine Familie oder ein kleines Team ist das genau
richtig und trägt bewusst **bis zu 32 Personen**. Darüber wird aus „Team & Familie“ eine
**Organisation** – und das Modell kippt. Größere oder offene Gruppen (Vereine mit mehr als 32
Mitgliedern, mehrere Familien, öffentlicher Betrieb) brauchen ein neues Fundament:

- **Echte Authentifizierung** – eine Sitzung für **alle** Bereiche, verpflichtende eigene Konten ohne
  Start mit `0000`, langsame Schlüsselableitung und Schlüssel (Health, Kalender) nur als Hash gespeichert.
- **Grenzen der Privatsphäre** – feine Sichtbarkeit und Rollen statt „die Admin-Person sieht und öffnet
  alles“.
- **Skalierbare Auswertung** – Team- und Familienzahlen auf dem Server oder nach Bedarf, statt jedes
  Mitglied in den Browser zu laden (das heutige `teamstats.js`-Modell wird mit vielen Personen auf
  einem Gerät langsam).
- **Optional:** Einladungen, mehrere oder größere Familien.

**Warum bis dahin genau 32?** Bis zu dieser Grenze kennen sich plausibel alle (Vertrauen ersetzt
strenge Zugriffskontrolle), und die Anmelde-Kacheln und die Auswertung im Browser bleiben auf iPhone
und iPad flüssig. Der Server schafft mehr (im Lasttest belegt) – 32 ist eine bewusste **Produkt- und
Vertrauensgrenze**, keine technische. Sie anzuheben ergibt erst auf dem Fundament von v5.0.0 Sinn;
vorher würde es Sicherheit und Privatsphäre verwässern.
