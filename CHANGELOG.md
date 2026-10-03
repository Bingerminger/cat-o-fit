# Changelog

Alle nennenswerten Änderungen an Cat-O-Fit werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

## [3.23.0] – 2026-10-03 – Durchgehend mitmachen, mit Musik und Vorturnerin

### Hervorgehoben
- **Eine ganze Einheit am Stück – wie ein Video zum Mitmachen.** „Durchgehend mitmachen“ spielt alle
  Übungen einer Kraft- oder Mobility-Einheit hintereinander ab, ohne dass du etwas antippen musst: die
  Vorturnerin macht jede Übung im Takt vor, dazwischen Pause mit Vorschau auf die nächste Übung,
  Seitenwechsel und Rundenpause. Die Mengen kommen aus dem Plan („Kniebeugen 12× · Plank 30–45 s ·
  3 Runden · 60–90 s Pause“). Groß genug fürs iPad auf dem Boden: Name, Wiederholung bzw. Restzeit,
  Hinweis, Atmung und „Danach“.
- **Musik im Takt der Übung.** Ein Beat passend zur Kategorie – kräftig bei Kraft, ruhiger bei Rumpf,
  flächig bei Beweglichkeit, treibend bei Kondition –, in der Pause leiser, vor dem Einsatz baut er
  auf. Das Tempo folgt der Bewegung: jede Bewegung – runter, halten, hoch – fällt auf den Beat. Die
  Musik entsteht im Gerät; „Eigene Musik“ lässt z. B. Spotify weiterlaufen.
- **Ansagen und Töne.** In den Pausen nennt eine eingesprochene Stimme die nächste Übung samt Menge und
  den Seitenwechsel – über denselben Weg wie die Musik, auch auf lautlos. In der Übung führen Töne:
  drei Töne vor jedem Einsatz, die letzten drei Wiederholungen bzw. Sekunden ticken, ein Doppelton bei
  „noch 10 Sekunden“.
- **Neuer Stil: die Vorturnerin.** Statt der Strichfigur zeigt eine gezeichnete Trainerin mit Körper,
  Kleidung und Zopf jede der 93 Übungen – in der Bibliothek, im Detail, in Einheit und Workout.
- **25 Workouts zum Mitmachen** als eigener Katalog in der Übungs-Bibliothek – mit Suche, Filter (Kraft,
  Rumpf, Beweglichkeit, Kondition, Laufen & Fußball), Dauer, Schwierigkeit und Geräten: von Ganzkörper
  ohne Geräte, Kurzhanteln, Kettlebell und Hyrox-Kraft über Bauch und Tabata bis Mobility am Morgen,
  Hüfte frei, Abendroutine, Lauf-ABC und Fußball-Prävention.
- **Mitmach-Tempo:** Schnelle Konditionsübungen (Kniehebelauf, Anfersen, Hampelmann, Mountain Climber
  u. a.) laufen ruhiger, damit man sie auf dem Bildschirm mitmachen kann. Die Vorturnerin hat schlankere
  Waden und richtige Turnschuhe.

### Behoben
- **Kein Ton auf iPhone und iPad im Lautlos-Modus:** Takt-Ton und Signale im Workout-Modus blieben
  stumm, wenn das Gerät auf lautlos stand. Die App meldet ihren Ton jetzt als Wiedergabe an – wie ein
  Video; die Töne sind außerdem lauter und weicher.
- **Ruhiger Ablauf auf iPhone und iPad:** Das Bild läuft an der Bildschirm-Uhr und bleibt nie stehen,
  auch wenn iOS den Ton kurz unterbricht (etwa durch eine Ansage). Die Musik spielt als vorab
  gerechnete Schleife und rastet danach von selbst wieder im Takt ein; der Ton wird geweckt.

### Geändert
- Nach einer durchgehenden Session aus dem Plan erfasst „Als erledigt erfassen“ die Einheit gleich mit
  der tatsächlichen Dauer; alle Übungen zählen als gemacht.
- „Brustöffner & Wirbelsäulen-Rotation 8×/Seite“: Übungen ohne eigene Zahl übernehmen die Menge der
  folgenden.
- Hilfe („Durchgehend mitmachen – mit Musik und Ansagen“), Handbuch und README beschreiben die Session.

### Für Entwickler
- Neue Module: `coach-figure.js` (Vorturnerin), `show-program.js` (Plantext → Programm → Zeitleiste im
  Takt, `beatPlan` legt jede Bewegungsphase auf halbe bzw. Viertelschläge), `workout-show.js`
  (Vollbild-Session), `music.js` (Musik als vorab gerechnete Schleifen), `audio.js` (Freischalten,
  Töne, Ansagen, Wake Lock) und `workouts.js`. `tools/music-preview.mjs` rendert Hörproben samt Pegel
  und Rechenzeit.

### Tests
- 843 JavaScript-Tests in 98 Dateien (vorher 825), neu: Plantext lesen, Zeitleiste im Takt (ganze
  Schläge je Wiederholung, Pausen auf ganzen Takten, Tempo im Stil), fertige Workouts, Musikmuster,
  die Session von der Übersicht bis „Geschafft“, Ansagen, Ton ohne Web Audio und die Vorturnerin in
  allen Posen (der Zopf hängt nie durch den Boden).

## [3.22.0] – 2026-10-03 – Übungen zum Mitmachen

### Hervorgehoben
- **Jede Übung bewegt sich.** Statt der Strichfiguren zeigt eine animierte Figur jede Übung im Takt
  der Ausführung – etwa langsam absenken, kurz halten, zügig hochdrücken. Die arbeitenden Muskeln
  leuchten in der Farbe der Kategorie, darüber stehen die Phase („Absenken“, „Halten“ …) und bei
  einseitigen Übungen die Seite. Die Kacheln zeigen Start- und Zielpose in einem Bild.
- **Mitmachen.** Wiederholungen (bei Halteübungen Sekunden) und Sätze einstellen, „Mitmachen“
  tippen: Die Animation zählt Sätze und Wiederholungen, zeigt einen kurzen Technik-Hinweis und wann du
  ein- und ausatmest, hält die Pausen und zeigt den Seitenwechsel. „Langsam“ hilft beim Lernen, „Ton“
  gibt den Takt hörbar vor, der Bildschirm bleibt an. Am Ende zählt die Übung als gemacht.
- **93 statt 37 Übungen.** 56 neue, darunter Goblet Squat, Sumo-Kniebeuge, Hip Thrust,
  Kettlebell-Swing, Wall Ball, Thruster, Farmers Walk, Klimmzug, einarmiges Rudern, Russian Twist,
  Herabschauender Hund, Taube und World’s Greatest Stretch – dazu die neue Kategorie **Kondition**
  mit Hampelmann, Burpee, Mountain Climber und mehr.

### Neu
- **Übungen aus dem Plan:** Nennt die Beschreibung einer Kraft- oder Mobility-Einheit Übungen
  („Kniebeugen 12× · Liegestütz 8–12× · Plank 30–45 s“), stehen genau diese in der Einheit und im
  Workout oben – markiert mit „im Plan“ und in der Reihenfolge der Beschreibung. Danach folgen die
  Vorschläge nach deiner Nutzung.
- **Suche:** findet Übungen auch unter gängigen anderen Namen („Lunges“, „Jump Squat“, „Bergsteiger“).

### Geändert
- Ist auf dem Gerät „Bewegung reduzieren“ eingeschaltet, zeigt die Übung ein Standbild; Antippen
  spielt die Animation ab.
- Die Kategorie-Leiste der Bibliothek lässt sich auf schmalen Handys seitlich wischen.
- Hilfe, Handbuch und README beschreiben die Animationen und das Mitmachen.

### Für Entwickler
- Neue Module: `exercise-motions.js` (Bewegungsabläufe als Daten), `motion-rig.js` (Gelenkfigur
  mit inverser Kinematik, DOM-frei), `motion-figure.js` (SVG-Standbild und Animation) und
  `motion-player.js` (Vorschau und Mitmachen). `exercise-art.js` zeichnet die Kacheln aus denselben
  Abläufen. `tools/motion-sheet.mjs` rendert Kontaktbögen mit Einzelbildern zur Sichtprüfung.

### Tests
- 825 JavaScript-Tests in 95 Dateien (vorher 809), neu: jede Übung hat einen Ablauf und umgekehrt,
  Abläufe sind stimmig (Startpose, Takt, Hinweise), die Figur bleibt heil (Reichweite, Boden, keine
  ungültigen Werte), Mitmach-Plan und Player, Erkennung der Übungen im Plantext – auch an echten
  Plan-Einheiten.

## [3.21.3] – 2026-09-30 – Kalender-Abo in der Hilfe, Vergleich im README

### Geändert
- **Hilfe „Den Plan im Kalender abonnieren“:** der Weg über „Ziele & Pläne“, die Schritte für
  iPhone/iPad, Mac, Google und Outlook und was hilft, wenn der Server nur im Heimnetz erreichbar ist.
  Das Handbuch hat dafür einen eigenen Abschnitt, die Fehlersuche den Fall „Abo bleibt leer“.
- **In Kalender exportieren:** „So richtest du das Abo ein“ unter dem Abo-Link öffnet diese Anleitung;
  der Hinweis im Fenster nennt keinen veralteten iOS-Menüweg mehr.
- **README:** Vergleich mit selbst gehosteten Projekten und bekannten Apps, auf Deutsch und Englisch –
  mit Stichtag, Anmerkungen und Quellen zu jeder Einschätzung.

### Tests
- 809 JavaScript-Tests in 93 Dateien (vorher 807), neu: das Export-Fenster mit und ohne
  Kalender-Schlüssel samt Anleitung aus der Hilfe.

## [3.21.2] – 2026-09-30 – Anmeldung nach neu aufgesetztem Server

### Behoben
- War der Server neu aufgesetzt oder zurückgesetzt, bot die Anmeldung noch die früheren Profile an
  („Dieses Profil gibt es nicht (mehr).“), und die Ersteinrichtung erschien nicht. Jetzt übernimmt das
  Gerät den leeren Stand und zeigt die Ersteinrichtung mit einem kurzen Hinweis. Kennt der Server ein
  angetipptes Profil nicht, verschwindet die Kachel nach dem Anmeldeversuch. Ungesendete Änderungen
  einer offline begonnenen Einrichtung bleiben erhalten.

### Für Entwickler
- Nicht mehr genutzte Stylesheet-Regeln entfernt (frühere Schnellaktionen, schwebender Knopf u. a.).
- GitHub Actions auf aktuelle Hauptversionen (Laufzeit Node 24).

### Tests
- 807 JavaScript-Tests in 92 Dateien (vorher 804), u. a. für den leeren Server und veraltete Profile.

## [3.21.1] – 2026-09-30 – Berichte mit Vorschau, Zahl und Einheit bleiben zusammen

### Geändert
- **Berichte und Urkunden mit Vorschau:** Vor dem Speichern zeigt die App den Bericht so, wie er
  abgelegt wird. „Ändern“ führt zurück – die Eingaben bleiben –, erst „Bericht speichern“ bzw.
  „Urkunde speichern“ legt ihn unveränderlich ab.
- **Zahl und Einheit bleiben zusammen:** „72,4 kg“, „539 kcal“ oder „24 °C“ brechen in der Anzeige
  nicht mehr zwischen Zahl und Einheit um.
- Mitgliedsfarben werden überall gleich streng geprüft.

### Behoben
- Eine unbekannte Zeitzone bringt Kalender-Export und Health-Connect-Eingang nicht mehr zum Absturz;
  die PHP-Tests laufen dadurch auch mit aktivem Xdebug durch.

### Für Entwickler
- Gemeinsame Helfer statt Kopien (Dezimalkomma, Farben, Neuzeichnen), „Heute“ in drei Modulen, die
  Aktionen an Einheiten als eigenes Modul `unit-actions.js`; zeitabhängige Tests warten großzügiger.

### Tests
- 804 JavaScript-Tests in 91 Dateien (vorher 796), u. a. für die Berichtsvorschau, die geschützten
  Leerzeichen und die gemeinsamen Helfer; PHP-Tests für unbekannte Zeitzonen.

## [3.21.0] – 2026-09-29 – Hilfe an der Kennzahl, Android und Uhren-Dateien, Kraftsätze, Strichcode

Bestehende Daten, Backups und alle Anbindungen funktionieren weiter. Die Schnittstelle bleibt bei
Version 1 und nennt neue Fähigkeiten zusätzlich.

### Hervorgehoben
- **Hilfe genau dort, wo die Frage entsteht.** Ein ⓘ an Kennzahlen wie Belastungspunkten, Form,
  Prognose, Bereitschaft oder Energieversorgung öffnet die passende Erklärung. Die Suche findet
  Begriffe auch unter anderen Namen; neue Artikel erklären Belastungspunkte, Monotonie, Bereitschaft,
  Energieverfügbarkeit, Trendprojektion, Module, Sicherungen und die Fehlersuche.
- **Android und jede Uhr.** Health Connect schickt über eine Brücken-App an dieselbe Adresse wie
  Apple Health. Aktivitäten kommen als GPX, TCX oder FIT – einzeln oder als ganzer Garmin- bzw.
  Strava-Export im ZIP – mit Sportart, Höhenmetern, Strecke und Höhenprofil, gezeichnet ohne
  Kartendienst.
- **„Wie hart war's?“** Fehlt deine Angabe, schätzt die App die Anstrengung aus der Herzfrequenz und
  fragt auf „Heute“ kurz nach. Die Belastungspunkte stimmen damit auch für importierte Trainings.
- **Kraft mit Sätzen.** Im Workout-Modus trägst du je Übung Wiederholungen und Gewicht ein, siehst,
  was du beim letzten Mal geschafft hast, und bekommst einen Hinweis für den nächsten Schritt.
- **Dokumentation neu gegliedert** – nach Nutzen, Verstehen und Betreiben, mit neuen Bildern, einer
  englischen README und einer Kurzanleitung zur Installation auf Englisch. Die Oberfläche bleibt
  deutsch.

### Neu
- **Apple Health:** Der Voll-Import übernimmt alle zuordenbaren Sportarten und auf Wunsch die
  Periodenbeginne (privat). Gemessene aktive Kalorien ersetzen die Schätzung; die
  Energieverfügbarkeit sagt, ob ihr Wert gemessen oder geschätzt ist. Kostenloser Weg per Kurzbefehl
  mit einem schlanken Tagesformat, auf Wunsch auch mit Workouts.
- **Labor:** „Befund mit mehreren Werten erfassen“ – Datum und Umstände einmal, alle Werte
  untereinander.
- **Ernährung:** Modus „Barcode“ – Strichcode eintippen oder, wo der Browser es kann, mit der Kamera
  lesen. Die Nährwerte kommen über deinen Server von Open Food Facts, nur mit „Nährwerte online
  ergänzen“.
- **Bereitschaft:** die HRV als 7-Tage-Mittel gegen deinen eigenen Normalbereich statt als
  Einzelwert.
- **HF-Zonen aus der Schwellen-HF** – aus einer Leistungsdiagnostik oder einem 30-Minuten-Feldtest.
- **Hitze und Höhenmeter:** Der Wetterhinweis nennt ab 24 °C, wie viel langsamer du ungefähr sein
  wirst; hügelige Läufe zählen in der Form-Schätzung fairer.
- **Trainer-Sicht:** Wer „Meine Belastung für Trainer:innen zeigen“ einschaltet (standardmäßig aus),
  zeigt den Admins im Team-Dashboard Belastung, Lastverhältnis und Befinden.
- **Als Tabelle exportieren (CSV):** Trainings, Körperwerte, Laborwerte und Ess-Tagebuch – für
  Excel, Numbers oder die Arztpraxis.
- **Lesezugang für eigene Werkzeuge** (standardmäßig aus): ein persönlicher Schlüssel, nur lesend,
  nie Zyklus, Labor oder Ergänzungen.
- **Kalender:** „Abo-Link kopieren“ mit kurzer Anleitung.

### Geändert
- **Schneller abgleichen:** Ein Durchlauf holt die Änderungen aller Bereiche mit einer Anfrage, und
  die Antwort aufs Senden bringt neue Änderungen gleich mit. Ältere Server werden wie bisher bedient.
- **Wettkampf statt „Event“**, Zielzeit mit Punkt oder Komma, Hinweise direkt am Feld statt als
  kurze Einblendung; einheitliche Begriffe wie „Plan ab heute neu berechnen“.
- **Typografie:** Dezimalkomma in allen Zahlen, deutsche Anführungszeichen, neutrale Ansprache.
- **Datei-Import:** „Strecke mitspeichern“ lässt sich ausschalten – die Linie zeigt, wo du unterwegs
  warst.
- Der Schalter „Krafttraining“ unter den Modulen ist entfernt; er hatte keine Wirkung.

### Behoben
- Die Muskelmasse einer Waage konnte als fettfreie Masse gelten – die Energieverfügbarkeit fiel
  dadurch viel zu hoch aus.
- Beim Zuordnen importierter Trainings zu einer geplanten Einheit gingen Kalorien, Höhenmeter und
  Strecke verloren.
- Die Silbentrennung in Abzeichen und Kacheln wirkte nicht; lange Wettkampfnamen, das
  Trinkpausen-Banner und das Wetter im Kalender werden nicht mehr abgeschnitten.
- Die Hilfe beschreibt Anmeldung, Apple-Health-Kosten und die Einrichtung wieder so, wie sie sind.
- Die Zeitzone aus `TZ` galt nicht für PHP; der Kalender-Export war fest auf Berlin eingestellt.

### Sicherheit & Datenschutz
- Die Kamera ist nur für die App selbst erlaubt und startet nur auf Tipp; das Bild verlässt das
  Gerät nicht.
- Der neue Lesezugang gibt private Bereiche und Schlüssel nie heraus; Ausschalten macht den
  Schlüssel sofort ungültig. Die Seite „Datenschutz im Betrieb“ nennt alle neuen Datenwege.

### Für Betreiber
- `TZ` (bzw. `CATOFIT_TZ`) gilt jetzt auch für PHP und den Kalender-Export; Standard bleibt
  Europe/Berlin.
- `tools/reset-pin.php` hilft auf der Kommandozeile, wenn die einzige Admin-Person ihre PIN
  vergessen hat.
- Schnittstelle: `ping` nennt `features` (`changes-all`, `ops-since`), neu sind `changes-all`,
  `read` und die Strichcode-Suche. Details in `docs/SCHNITTSTELLEN.md`.
- `tools/render-screenshots.mjs` erzeugt die Doku-Bilder reproduzierbar (fester Tag,
  Beispiel-Persona).

### Tests
- 796 JavaScript-Tests in 89 Dateien (vorher 707), u. a. für Datei-Importe (FIT, ZIP), die
  Anstrengung aus der Herzfrequenz, den Sammelabgleich, Hilfe-Verweise, die Doku selbst (Version,
  Links, Menüpfade, Typografie) und das Layout.
- Server-Tests erweitert (Health Connect, Sammelabgleich, Lesezugang, Strichcode), neu
  `tools/test-ics.php` für Kalender und Zeitzone.

## [3.20.0] – 2026-09-29 – Zuverlässiger Abgleich, Datenschutz am Server, gesunde Ziele, stimmige Laborwerte, bessere Pläne, ein Coach, neue Navigation

Dieses Release bündelt eine gründliche Überprüfung der ganzen App. Bestehende Daten, Backups und
der Apple-Health-Auto-Export funktionieren weiter, bisherige Kalender-Abos bis 30.11.2026. Nach dem
Update fragt die App einmal nach deiner PIN, damit Zyklus, Labor und Ergänzungen wieder abgleichen.

### Hervorgehoben
- **Neue Navigation.** Unten (iPhone) bzw. links (iPad, Mac): **Heute · Kalender · ＋ Erfassen ·
  Fortschritt · Mehr**. „＋ Erfassen“ ist der feste Platz für Training (auch ohne Plan),
  Körperwerte, Mahlzeit, Laborwert, Periode und Checklisten-Punkt. „Fortschritt“ bündelt Training,
  Körper, Erfolge und Berichte als Reiter; „Mehr“ ist nach Themen gegliedert und markiert die
  aktuelle Seite. Die Seitenleiste zeigt unten immer, wer angemeldet ist – samt Abmelden.
- **Speichern ohne Neuladen.** Nach dem Speichern bleibt die Seite stehen, wo du warst, und die
  Bestätigung bleibt lesbar. Gelöschte Einträge und das Verschieben per Ziehen lassen sich
  rückgängig machen.
- **Privates bleibt privat – auch am Server.** Zyklus, Labor und Ergänzungen sind am Server an die
  Anmeldung der jeweiligen Person gebunden. Die PIN wird am Server geprüft und öffnet dort eine
  Sitzung.
- **Nichts geht beim Abgleich still verloren.** Änderungen von anderen Geräten kommen zuverlässig
  an, große Apple-Health-Importe gehen in Stücken raus, und ein voller Gerätespeicher wird gemeldet
  statt Änderungen zu verlieren.
- **Ein Coach, eine Zahl.** Pro Tag gibt es eine Empfehlung mit „Warum?“, die Belastung kommt aus
  einer Quelle, und Plan-Einhaltung, Lauf-Kilometer und Serien sind überall gleich gerechnet.

### Neu
- **Bedienung:** Einheit mit klebender Leiste „Starten · Erledigt erfassen“; der ▶ auf „Heute“
  startet das Training direkt. Verschieben mit Schnellwahl („Morgen“, „Übermorgen“, „Nächster
  freier Tag“); Ziehen im Kalender mit Rückfrage bei Konflikten, Auto-Scroll und größerem Griff.
  Mahlzeiten als **Lebensmittel mit Menge** („200 g Skyr, 1 Banane“) oder mit einem Tipp aus
  „zuletzt gegessen“. Anstrengungs-Skala mit Ankern (1 sehr leicht … 10 maximal), Dauer in
  Minuten und Sekunden. Einstieg „Los geht's“ nach „Leer starten“.
- **Verwalten eines Mitglieds** ist jetzt überall sichtbar: Band im Kopf mit „Zurück zu mir“,
  „Leas Übersicht“ statt Begrüßung, Konto-Anzeigen mit der angemeldeten Person.
- **iPad & Mac:** „Heute“ zweispaltig, Monatskalender mit Kurztiteln, Formulare als Dialog in der
  Mitte; Diagramme zeichnen in echter Breite mit lesbarer Schrift und fester Höhe.
- **Diagramme nach Datum** (Zeitraum 3 Monate · 1 Jahr · Alles, Wochenmittel bei langen Reihen, Jahr
  an der Achse bei langen Zeiträumen), Lücken unterbrechen die Linie, Balkenwerte per Tipp.
- **Gesundheit & Eignung für die ganze App:** kurze Abgrenzung (z. B. Schwangerschaft,
  Essstörung), **Kinder- und Jugendprofil** aus dem Geburtsjahr (keine Kalorien- und Gewichtsziele,
  Laborwerte nur dokumentiert) und der Schalter **„Kalorienzahlen ausblenden“**.
- **Labor:** Einheitenwahl mit Umrechnung und Rückfrage bei unplausiblen Werten, Referenzbereich nur
  noch als Platzhalter (gespeichert wird, was du vom Befund abtippst), Messungen bearbeiten und
  löschen, Umstände der Blutentnahme, Magnesium Vollblut/Serum, Gesamt-B12, Quellen je Wert,
  Trend erst über die natürliche Schwankung, Hinweis auf veraltete Werte.
- **Körperwerte:** eigenes Feld **fettfreie Masse**, HRV mit **Messart** (SDNN/RMSSD – verglichen
  wird nur innerhalb einer Art).
- **Pläne:** Einrichtung mit Niveau und Lauftagen, Umfang ab deiner Historie mit behutsamer
  Steigerung, Renntag an jedem Wochentag, Renntempo aus der Zielzeit und Trainingstempo nach deiner
  Form, feste Termine nur auf Wunsch, „Ab heute aktualisieren“ lässt die Vergangenheit unverändert,
  Programme mit Dauer und Anleitung, Triathlon/Hyrox (Beta) mit Ruhetagen und Taper.
- **Training erfassen ohne Plan**, GPX/TCX mit Sportart, Splits und Zeit in Zonen, importierte
  Trainings passenden Einheiten zuordnen, Workout-Modus mit echter Zeitmessung, Zielpace und Zone
  je Phase.
- **Coach:** Wiedereinstieg nach Krankheit, Erholung nur bei Abweichung vom Plan, keine
  Qualitätseinheit neben harten festen Terminen, Serien in Wochen, Momentum pausiert bei Krankheit,
  HF-Zonen per Schätzung (Tanaka/Karvonen), Zyklus: Frage statt automatischer Entschärfung,
  Verhütungs-Schalter, Prognose pausiert bei veralteten Einträgen.
- **Anmeldung:** Pflicht-PIN für die erste Admin-Person, PIN ändern mit bisheriger PIN und
  Wiederholung, Schalter **„Gemeinsames Gerät“** (Abmelden entfernt die persönlichen Daten vom
  Gerät), Rücksprung zum Deep-Link nach der Anmeldung.

### Geändert
- **Barrierefreiheit (WCAG 2.2 AA):** Kontrast für Text und Schaltflächen mit jeder Akzentfarbe in
  hell und dunkel, Dialoge mit Escape und Fokusführung, benannte Schalter und Knopfgruppen,
  Sprunglink, sichtbarer Fokusrahmen, Zoomen erlaubt, Zusammenfassungen für Screenreader an allen
  Diagrammen.
- **Start ohne Server:** Die App zeichnet sofort aus dem Gerätespeicher und gleicht im Hintergrund
  ab; antwortet der Server nicht, arbeitet sie nach wenigen Sekunden offline weiter (vorher dauerten
  Start und Anmeldung dann bis zu mehreren Minuten und endeten mit einer irreführenden Fehlermeldung).
  Selten genutzte Bereiche laden erst bei Bedarf.
- **„Heute“ kürzer:** ein Coach-Hinweis (weitere aufklappbar), Form und Trainingsbereiche unter
  „Fortschritt → Training“, ohne doppelten Schnellzugriff. Einstellungen mit Sprungleiste.
- **Energie & Ziele:** eine Zieldefinition für alle Ansichten, Tagesziel nie unter Grundumsatz und
  Trainingsbedarf, kein Defizit bei Untergewicht, Energieversorgung nur aus bestätigten Tagen,
  Rezeptwerte aus ihren Zutaten gerechnet, Eisen und Magnesium nur mit passendem Laborwert.
- **Monatsbericht:** Vorwahl des letzten abgeschlossenen Monats, beim laufenden Monat mit Stand.
- **Wetter:** Ortssuche mit Auswahl aus mehreren Treffern.
- **Backup** auf iPhone/iPad über das Teilen-Menü („In Dateien sichern“), neutrale Meldung.
- Frische Installationen starten mit der Ersteinrichtung (Beispieldaten nur auf Wunsch).

### Behoben
- Beim Bearbeiten von Zutaten, Zielen und Notizen konnten mehrzeilige Felder leer erscheinen und
  beim Speichern gelöscht werden.
- Körperwerte für einen anderen Tag nachtragen: Das Formular zeigt und speichert jetzt die Werte
  genau dieses Tages.
- „km kg“ im Ziel-Cockpit, Dezimalpunkte statt Kommas in Coach- und Formtexten, doppelte Wochentage
  beim Einkaufsdatum, interne Kürzel in den Beispieldaten, abgeschnittene Titel, unsichtbare oder
  riesige Symbole in Rückmeldungen, Umbrüche in Abzeichen-Namen.
- „Jetzt synchronisieren“ meldete Erfolg, bevor ein laufender Abgleich fertig war.
- Die App-Symbole fehlten im Offline-Cache; ein kaputt kodierter Link brach den Start ab.

### Sicherheit & Datenschutz
- Die Schnittstelle ist durchgehend strenger abgesichert: Anmeldung und PIN-Prüfung am Server,
  Admin-Anmeldung für Verwaltungsaufgaben, Schutz schreibender Anfragen, Sicherheits-Header mit
  Inhaltsrichtlinie und Grenzen für Uploads. Wer eine ältere Version betreibt – besonders außerhalb
  des Heimnetzes –, sollte aktualisieren.
- Kalender-Abos haben einen persönlichen Schlüssel je Person: Abos bitte einmal über „In Kalender
  exportieren“ neu einrichten. Bisherige Links ohne Schlüssel gelten noch bis 30.11.2026.
- Die Nährwertsuche im Netz (Open Food Facts) ist für neue Profile zunächst aus.

### Für Betreiber
- Beispieldaten liegen unter `tools/seed/` statt in `data/`.
- Optional: `CATOFIT_BASIC_AUTH` mit `CATOFIT_AUTH_USER`/`CATOFIT_AUTH_PASSWORD` (Docker) und
  `CATOFIT_ALLOWED_HOSTS`. Schnittstellen und Übergangsfristen: `docs/SCHNITTSTELLEN.md`.
- `.htaccess` komprimiert die App-Dateien; hängt der Server, antwortet der Service Worker nach
  spätestens 3 s aus dem Cache.

### Tests
- 707 JavaScript-Tests in 77 Dateien (vorher 441), darunter Wächter für Sync-Integrität,
  Server-Sitzung und PIN, Eignung und Kinderprofil, Laborwerte, Plangenerator, Workout-Zeitmessung,
  Coach, Barrierefreiheit, Kontrast, Navigation und Importzyklen.
- Neue Server-Tests `tools/test-storage.php`, `tools/test-api.php` und `tools/test-health-xml.php`
  (zusammen mit `tools/test-health-ingest.php` in der CI).

## [3.19.0] – 2026-08-02 – Referenzbereiche deines Labors, Hilfe zur Wertbeschaffung

### Neu
- **Der Referenzbereich deines eigenen Befunds zählt.** In Deutschland gibt es keine
  bundesweit einheitlichen Referenzbereiche – jedes Labor legt eigene fest, abhängig von
  Messmethode, Gerät und Vergleichsgruppe (bei Ferritin, fT3 oder B12 unterscheiden sie sich
  spürbar). Bisher rechnete Cat-O-Fit immer gegen einen hinterlegten Standardwert und wirkte
  damit genauer, als es sein konnte. Beim Erfassen stehen jetzt zwei Felder
  **„Referenzbereich deines Labors“** bereit – vorbelegt mit einem üblichen Bereich, einfach
  mit dem Wert vom Befund überschreibbar. Die Bewertung, die Trendprojektion und die
  Zielmarkierung im Verlauf richten sich dann danach. Der sportliche Zielkorridor bleibt als
  zweite Ebene unverändert bestehen.
- **„Woher bekomme ich Laborwerte?“** – solange noch nichts erfasst ist, erklärt eine
  aufklappbare Karte im Modul die Wege in Deutschland: sportmedizinische Untersuchung,
  Haus-/Facharztpraxis, Check-up 35, Einsendelabor und Blutspende – jeweils mit dem, was
  drin ist, ungefähren Kosten und einem praktischen Tipp. Darunter der Hinweis, den die
  wenigsten kennen: **Viele Krankenkassen bezuschussen den Sportcheck** als freiwillige
  Satzungsleistung.

### Geändert
- **Hilfe und Handbuch** erklären beides ausführlich: die Bezugswege als Tabelle mit Kosten,
  warum der Referenzbereich zum Wert dazugehört, und was in Deutschland tatsächlich normiert
  ist (RiliBÄK, DIN EN ISO 15189, LDT, ePA) – und was ausdrücklich nicht: die
  Referenzbereiche selbst und sportspezifische Zielwerte.
- Im Wert-Detail steht jetzt, ob der Referenzbereich **von deinem Labor** stammt oder der
  übliche ist; im zweiten Fall lädt ein Hinweis dazu ein, ihn beim nächsten Mal einzutragen.

## [3.18.1] – 2026-08-02 – Hotfix: Achsenbeschriftungen in Balkendiagrammen

### Behoben
- **Datumsangaben überlappten sich** unter der Einnahmetreue in „Labor & Ergänzung“:
  21 Balken teilten sich die Breite, die Beschriftungen („13.07.“) standen als
  Buchstabenbrei übereinander. Balkendiagramme zeichnen jetzt nur so viele
  Beschriftungen, wie nebeneinander **passen** – ausgedünnt vom jüngsten Wert aus,
  damit der aktuellste Balken immer beschriftet bleibt. Dasselbe gilt für die
  Werte über den Balken.
- **Balken bleiben sichtbar breit:** Der Abstand zwischen ihnen passt sich der
  Anzahl an (bei 21 Tagen waren es vorher 7-Pixel-Striche). Diagramme mit wenigen
  Balken – etwa der Wochenumfang in der Statistik – sehen unverändert aus und
  behalten alle Beschriftungen.

### Tests
- Vier neue Chart-Tests prüfen die tatsächlichen x-Positionen der gezeichneten
  Texte gegen ihre Breite: keine Überlappung bei vielen Balken, vollständige
  Beschriftung bei wenigen, Ausdünnung auch der Werte, Mindest-Balkenbreite.
  (Gegenprobe: Mit dem alten Code schlagen genau diese Tests fehl.)

## [3.18.0] – 2026-08-02 – Auswertungen im Labor, klarere Navigation

### Neu
- **Labor & Ergänzung wird datengetrieben.** Sportlerinnen und Sportler denken in Kurven –
  das Modul liefert sie jetzt:
  - **Überblicks-Ring:** Wie viele Werte liegen im Sport-Zielbereich, wie viele solltest du
    beobachten? Dazu Anzahl der Messungen, Termine und das Datum des letzten Befunds.
  - **Mini-Verläufe in jeder Zeile:** Trend erkennen, ohne etwas aufzuklappen.
  - **Verlauf der Energieversorgung** über die letzten Wochen als Kurve mit Richtwert-Linie –
    damit wird sichtbar, ob sich das Verhältnis von Essen und Training verschiebt (es sinkt
    typischerweise in Aufbauphasen).
  - **Einnahmetreue** als Balkendiagramm der letzten drei Wochen.
- **Demodaten für Labor & Ergänzung** – für die Beispiel-Person *und* alle neun
  Demo-Mitglieder. Die Werte sind als kleine Geschichten angelegt, damit jede Auswertung
  etwas Sinnvolles zeigt: ein über vier Messungen fallender Eisenspeicher (mit
  Trendprojektion), ein im Winter absinkendes Vitamin D, ein Mitglied mit erhöhtem CRP
  (Ferritin dadurch „nicht beurteilbar“) und Werte im Zielbereich als Gegenbeispiel.

### Geändert
- **Eigenes Symbol für „Labor & Ergänzung“** (Erlenmeyerkolben) – vorher teilte es sich das
  Herz-Symbol mit „Werte“.
- **Menü thematisch sortiert:** Team/Familie → Statistik → Erfolge & Momentum → Berichte &
  Urkunden → Zyklus → Ernährung → Labor & Ergänzung → Einkaufsliste → Checkliste →
  Übungs-Bibliothek → Health-Import → Einstellungen → Hilfe. „Berichte & Urkunden“ hat dabei
  ein eigenes Symbol bekommen (vorher wie „Erfolge“).
- **Demo-Ernährung realistisch:** Die Beispiel-Person aß laut Tagebuch nur ~1630 kcal bei
  vier Trainingseinheiten pro Woche – zu wenig für ihr Pensum und damit ein irreführendes
  Beispiel. Jetzt acht Wochen vollständig erfasste Tage mit stimmigen ~2400 kcal.
- **Hilfe & Handbuch** um Anwendungsfälle zu den Funktionen seit 3.15 erweitert: Werte aus
  Diagrammen ablesen, Einheiten verschieben ohne die Woche zu sprengen, Belastung prüfen –
  jeweils mit Bildern.
- **README** neu ausgerichtet: Cat-O-Fit als **quelloffener Sport-Datenhub für Team und
  Familie** – warum verteilte Sportdaten ein Problem sind, was zusammenläuft und was „Open
  Source“ hier konkret bedeutet.

## [3.17.0] – 2026-08-02 – Labor & Ergänzung, Umfang nach Niveau

### Neu
- **Labor & Ergänzung** (neues Modul, in den Einstellungen abschaltbar): Werte aus
  dem Laborbefund erfassen, im Verlauf verfolgen und **sportbezogen** einordnen.
  Cat-O-Fit kennt dabei zwei Korridore je Wert – den Labor-Referenzbereich und den
  für Training günstigen Zielbereich. Ein Ferritin von 25 ist eben „normal“, für
  Ausdauertraining aber knapp.
  - **17 sportrelevante Werte** von Eisenstatus über Vitamin D, B12 und Magnesium
    (Vollblut) bis zu Schilddrüse, CK und Natrium – mit Einheiten-Umrechnung
    (z. B. Vitamin D in ng/ml oder nmol/l).
  - **Kontext statt nackter Grenzwert:** Ferritin wird bei erhöhtem CRP als „nicht
    beurteilbar“ ausgewiesen statt fälschlich als in Ordnung – es steigt bei jeder
    Entzündung mit an.
  - **Trend vor Momentaufnahme:** Fällt ein Wert über mehrere Messungen, rechnet
    die App aus, wann er den günstigen Bereich verlässt – ein guter Termin für die
    nächste Kontrolle.
  - **Vorschläge zur Ergänzung** mit Begründung, Menge, Zeitpunkt, Obergrenze und
    Wechselwirkungen (z. B. Kaffee und Kalzium bremsen die Eisenaufnahme). Immer
    zuerst der Weg über die Ernährung – ein Präparat füllt die Lücke, es ersetzt
    keinen Teller. Eisen wird **nie ohne Laborwert** vorgeschlagen.
  - **Einnahmeplan** zum täglichen Abhaken samt Einnahmetreue.
- **Energieversorgung (RED-S).** Aus Ess-Tagebuch, Trainingsverbrauch und
  fettfreier Masse schätzt Cat-O-Fit die Energieverfügbarkeit. Zu wenig Energie für
  die geleistete Arbeit ist im Ausdauersport das häufigere Problem als ein fehlendes
  Präparat – und die Ursache für Leistungsabfall, Verletzungen und Zyklusstörungen.
  Gerechnet wird nur über Tage mit erfassten Mahlzeiten, damit Erfassungslücken
  keinen Fehlalarm auslösen.
- **Klare Abgrenzung, technisch verankert.** Das Modul richtet sich an gesunde
  Sportlerinnen und Sportler. Wer eine behandlungsbedürftige Erkrankung, Medikamente,
  eine Schwangerschaft oder eine Essstörung angibt, nutzt es im reinen
  **Dokumentationsmodus**: erfassen und Verlauf ansehen ja, Empfehlungen nein.
  Auffällige Werte (etwa sehr niedriges Hämoglobin oder eine über Monate ausbleibende
  Periode) setzen alle Empfehlungen aus und verweisen ärztlich.
- **Privat wie der Zyklus:** Laborwerte und Ergänzungen sind für Admins unsichtbar
  und bleiben aus dem Familien-Vollbackup heraus; im persönlichen Backup sind sie dabei.

### Geändert
- **Der Wochenumfang skaliert mit dem Leistungsniveau.** Die Neben- und
  Umfangseinheiten hatten feste 7–9 km – unabhängig davon, ob jemand für 5 km oder
  einen Marathon trainiert. Sie richten sich jetzt nach dem Long Run derselben Woche
  und wachsen damit automatisch mit Progression, Entlastungswochen und Tapering mit.
- **Zyklus: veraltete Prognosen schützen nicht mehr.** Prognostizierte
  Menstruationstage stellten Einheiten auch dann schadfrei, wenn der letzte echte
  Eintrag Monate zurücklag – das schönte die Plan-Einhaltung still. Ab jetzt gilt der
  Schutz für Prognosen nur noch bis drei Monate nach dem letzten echten Eintrag;
  selbst eingetragene Perioden schützen unverändert immer.

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
  „geplant“; die Herkunft merkt sich `movedFrom` (der Chip „Verschoben“ bleibt).
- **„Plan neu generieren“ behält erledigte Einheiten.** Der Dialog versprach es,
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
  geben“) – jetzt distanzgerecht von 5 km bis Marathon.
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
  Schwellen wie die Karte „Belastung & Form“ – Kraft und Fußball zählten dort bisher
  gar nicht.
- **Keine Fehlalarme in den ersten Wochen.** Ohne volle 4-Wochen-Historie meldete
  die Belastungssteuerung rechnerisch „zu schnell gesteigert“ und schlug
  Erholungstage vor. Sie zeigt jetzt ehrlich „Datenbasis wächst noch“.
- **Form wird korrekt eingeschwungen.** Die Fitness-Kurve hatte zu wenig Vorlauf,
  wodurch die angezeigte Form dauerhaft zu negativ war.
- Gewicht und Ruhepuls werden für die Trendbewertung über eine Woche geglättet
  (Tagesschwankungen von 1–2 kg erzeugten Zufallstrends).
- Kalorien-Empfehlung: Das Defizit folgt der Trainingsphase (Grundlage bis
  Tapering) statt pauschal −400 kcal und wird **nie unter den Grundumsatz**
  gesenkt – Schutz vor Unterversorgung bei hohem Trainingsumfang.
- Monotonie nach Foster mit der Stichproben-Standardabweichung berechnet.
- Nährwert-Schätzung: „Buttermilch“, „Mandelmilch“ und „Kokosmilch“ werden nicht
  mehr als Butter bzw. Mandeln gewertet.
- **Docker:** OPcache aktiviert, Zeitzone per `TZ` einstellbar, und der Schnellstart
  weist deutlich darauf hin, dass die App ohne vorgelagerte Authentifizierung ins
  eigene Netz gehört.

## [3.15.1] – 2026-07-15 – Schnellstart, Feinschliff & Social-Preview

### Neu
- **Schnellstart im README:** drei Einstiegswege Schritt für Schritt – Docker mit
  einem Befehl, Synology Container Manager ganz ohne Kommandozeile (inkl. fertigem
  Compose-Block) und der klassische Weg ohne Docker – plus „Die ersten 5 Minuten
  in der App“.
- **Social-Preview-Banner** (1280×640) für die Repo-Vorschau auf GitHub
  (`docs/assets/promo/social-preview.png` + Vorlage `social-preview.html`).

### Geändert
- Promo-Banner, Handbuch und Ersteinrichtung nennen die korrekten Demodaten-
  Dimensionen: **„bis zu 32 Profile“** und eine **komplette Beispiel-Familie mit
  Teams** (statt veraltet „10 Profile“ bzw. „zwei Demo-Mitglieder“).
- Endnutzer-Texte formulieren serverneutral („dein Server/NAS“ statt nur
  „Synology“) – im Handbuch und in der In-App-Hilfe. Die Apple-Health-Anleitung
  erklärt den `Authorization`-Header jetzt als optional (nur bei vorgeschalteter
  Basic-Auth) und ohne internes Umgebungs-Konzept.
- `.ics`-Export: PRODID-Schreibweise „Cat-O-Fit“.

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
  Y-Skala), Ampel „Bin ich auf Plan?“, Trainingsjahr-Heatmap, Wettkampfprognose.
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

[Unreleased]: https://github.com/Bingerminger/cat-o-fit/compare/v3.21.3...HEAD
[3.21.3]: https://github.com/Bingerminger/cat-o-fit/compare/v3.21.2...v3.21.3
[3.21.2]: https://github.com/Bingerminger/cat-o-fit/compare/v3.21.1...v3.21.2
[3.21.1]: https://github.com/Bingerminger/cat-o-fit/compare/v3.21.0...v3.21.1
[3.21.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.20.0...v3.21.0
[3.20.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.19.0...v3.20.0
[3.19.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.18.1...v3.19.0
[3.18.1]: https://github.com/Bingerminger/cat-o-fit/compare/v3.18.0...v3.18.1
[3.18.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.17.0...v3.18.0
[3.17.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.16.0...v3.17.0
[3.16.0]: https://github.com/Bingerminger/cat-o-fit/compare/v3.15.1...v3.16.0
[3.15.1]: https://github.com/Bingerminger/cat-o-fit/compare/v3.15.0...v3.15.1
[3.15.0]: https://github.com/Bingerminger/cat-o-fit/releases/tag/v3.15.0
