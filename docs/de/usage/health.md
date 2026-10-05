# Gesundheit

Körperwerte, Apple Health, Gesundheitsziele, Gesundheit & Eignung und der Zykluskalender.

> Teil der [Dokumentation](../README.md) · [Alle Seiten der Nutzung](../README.md#nutzen)

**Auf dieser Seite:**

- [Körperwerte pflegen](#körperwerte-pflegen)
- [Daten aus Apple Health holen](#daten-aus-apple-health-holen)
- [Gesundheitsziele mit Fortschritt](#gesundheitsziele-mit-fortschritt)
- [Gesundheit & Eignung](#gesundheit--eignung)
- [Zykluskalender](#zykluskalender)

---

## Körperwerte pflegen

<img src="../assets/08-koerperwerte.png" width="270" align="right" alt="Körperwerte mit Trend-Charts" />

Unter **Fortschritt → Körper** verfolgst du deine Entwicklung – ruhig und ohne Druck:

1. Tippe auf **＋ Erfassen → Körperwerte** (oder oben auf **„+“**) und trage z. B. Gewicht, Ruhepuls
   oder Schlaf ein (nur was du möchtest).
2. Die Verläufe zeigen deinen **Trend** – mit **Y-Skala**, beim Gewicht mit **Ziellinie**. Die Punkte
   stehen **nach Datum**: Zwei Wochen und acht Monate bekommen nicht mehr dieselbe Breite. Oben wählst
   du den Zeitraum (**3 Monate · 1 Jahr · Alles**); lange Reihen erscheinen als Wochenmittel, und bei
   Zeiträumen über ein Jahr steht das Jahr an der Achse.
3. **Werte ablesen:** Zieh den Finger über ein Diagramm (am Rechner: Maus darüber) – eine Führungslinie
   springt zum nächsten Datenpunkt und zeigt **Datum + Wert** in einer kleinen Bubble. Bei Balken
   zeigt ein Tipp auf den Balken seinen Wert.

Die Darstellung ist bewusst **wertfrei** – es geht um die Richtung über Wochen, nicht um
tägliche Schwankungen. Die Kacheln oben zeigen deinen letzten Messwert und die **Veränderung über
den Wochenmittelwert** (Median) seit einer Messung mindestens eine Woche davor. Grün wird eine
Veränderung nur, wenn sie zu deinem Ziel passt – beim Gewicht also ein sinkender Wert bei einem Abnehmziel und
ein steigender bei einem Zunahmeziel; ohne Ziel bleibt sie neutral. Einzelne Werte kannst du in den
Einstellungen ausblenden.

**Muskelmasse oder fettfreie Masse?** „Muskelmasse“ ist der Wert einer Körperanalyse-Waage (bei 72 kg
etwa 28 kg). Die **fettfreie Masse** (Lean Body Mass, z. B. aus Apple Health) umfasst alles außer Fett
und ist deutlich höher (bei 25 % Körperfett rund 54 kg); sie fließt in die Energieversorgung ein.
**HRV** trägt ihre Messart: Apple speichert SDNN, viele Uhren und Ringe zeigen RMSSD – Verlauf, Ziele
und Bereitschaft vergleichen nur Werte derselben Messart. Beim Erfassen wählst du sie neben dem Wert.

<br clear="all" />

---

## Daten aus Apple Health holen

Uhren und Waagen (Apple Watch, Garmin, Withings …) schreiben nach Apple Health. Von dort kommen die
Werte auf drei Wegen zu Cat-O-Fit – die Einrichtung steht ausführlich unter
[Apple Health](../APPLE-HEALTH.md). Auf **Android** schickt eine Brücken-App die Werte aus
Health Connect an dieselbe Adresse (siehe [Android: Health Connect](../APPLE-HEALTH.md#android-health-connect)).

| Weg | Kosten | Was kommt an |
|---|---|---|
| **Automatisch** mit der App „Health Auto Export“ | App kostenlos, die nötige automatische Übertragung nur mit Premium (laut App Store, Stand September 2026: etwa 8 € im Jahr oder 30 € einmalig) | täglich Gewicht, Ruhepuls, HRV, VO₂max, Schlaf, Schritte, aktive Energie und Workouts |
| **Automatisch per Kurzbefehl** (Apple-App „Kurzbefehle“) | kostenlos | die Tageswerte, die der Kurzbefehl liest (z. B. Gewicht, Ruhepuls, HRV, Schlaf) |
| **Von Hand: Voll-Import** | kostenlos | Workouts aller zuordenbaren Sportarten, Körperwerte und auf Wunsch den Zyklus aus dem kompletten Export, so oft du magst |

**Voll-Import von Hand:**

1. iPhone → **Health-App** → oben aufs **Profilbild** → **„Alle Gesundheitsdaten exportieren“**.
2. Die entstehende **ZIP-Datei** in der App hochladen: **Fortschritt → Körper → Symbol „Health-Import“**
   oben (oder **Einstellungen → Daten & Sicherung → Apple Health & Datei-Import**).
3. Cat-O-Fit übernimmt die **Workouts** (Laufen, Rad, Schwimmen, Gehen, Wandern, Kraft, Rudern … →
   durchgeführte Einheiten, automatisch zugeordnet) und **Körperwerte** (Gewicht, Ruhepuls, Schlaf,
   HRV, VO₂max). Stehen Zyklusdaten im Export, fragt die App, ob sie die **Periodenbeginne**
   übernehmen soll – sie bleiben privat. Doppelte Einträge erkennt die App.

**Aktivitäten aus Dateien (GPX, TCX, FIT, ZIP).** Auf derselben Seite lädst du auch Aufzeichnungen
deiner Uhr hoch – einzeln oder als ganzen Export (mehr unter
[Aktivitäten aus Dateien übernehmen](training.md#aktivitäten-aus-dateien-übernehmen)). Sie werden
direkt im Browser ausgewertet: **Sportart** (aus der Datei; fehlt sie, fragt die App nach),
**Datum in deiner Zeitzone** (auch beim Neujahrslauf um 0:30 Uhr), **Bewegungszeit** ohne Pausen,
Distanz, Ø- und Max-Herzfrequenz, **Kilometer-Splits** und – mit deinen HF-Zonen aus den Einstellungen –
die **Zeit in jeder Zone**. Vor dem Speichern siehst du eine Zusammenfassung: Passt eine geplante
Einheit desselben Tages und derselben Sportart, wird die Aktivität ihr zugeordnet, sonst als freies
Training gespeichert.

**Automatisch importierte Trainings zuordnen.** Kommen Trainings über „Health Auto Export“ ohne Bezug
zum Plan an, schlägt „Heute“ vor, sie der passenden geplanten Einheit desselben Tages zuzuordnen
(**Zuordnen**, **Alle zuordnen** oder **Nicht zuordnen**). Zugeordnet gilt die Einheit als erledigt –
ohne doppelte Belastung.

> Splits, Zeit in HF-Zonen, Höhenmeter und Strecke gibt es für GPX-, TCX- und FIT-Dateien. Der
> Apple-Health-Export (automatisch wie manuell) liefert dafür keine Einzelpunkte.

---

## Gesundheitsziele mit Fortschritt

<img src="../assets/42-gesundheitsziele-coach.png" width="260" align="right" alt="Gesundheitsziele mit Fortschritt" />

Neben den **Wochenzielen** (aktive Minuten & Trainingstage) kannst du **dedizierte Zielwerte** für deine
Körperwerte festlegen: **Gewicht, Körperfett, Ruhepuls, HRV** oder **VO₂max** – jeweils mit optionaler
**Frist**.

1. **Einstellungen → Gesundheitsziele → „+ Ziel“**: Metrik wählen, Zielwert (und optional ein Zieldatum)
   eintragen. Dein **aktueller Wert** wird als **Startpunkt** gemerkt.
2. Auf **„Heute“** erscheint die Karte **Gesundheitsziele** mit einem **Fortschrittsbalken** je Ziel –
   vom Startwert zum Ziel, plus „noch X bis Ziel“ und die verbleibenden Tage.
3. Der Fortschritt zählt mit jedem neuen Wert, den du unter **Körperwerte** einträgst (oder per Apple-Health-
   Import). Ist das Ziel erreicht, feiert die Karte es 🎉. Beim Gewicht zählt das **Wochenmittel**, nicht
   die letzte Einzelmessung – „erreicht“ bedeutet überall in der App dasselbe.
4. **Plausibilität:** Ein Zielgewicht unter BMI 18,5 oder ein Körperfettziel unter etwa 12 % (Frauen) bzw.
   5 % (Männer) speichert die App erst nach einem deutlichen Hinweis. Für Kinder und Jugendliche sowie bei
   Schwangerschaft, Stillzeit oder Essstörung gibt es keine Gewichts- und Körperfettziele; bestehende
   bleiben gespeichert und sind ausgesetzt.

<br clear="all" />

---

## Gesundheit & Eignung

Cat-O-Fit dient der **Dokumentation und allgemeinen Information für gesunde Erwachsene** – es ist
**kein Medizinprodukt**. Unter **Einstellungen → Gesundheit & Eignung** beantwortest du einmal eine kurze
**Abgrenzung**; sie gilt für die ganze App (Ernährung, Ziele, Programme, Labor). Die Fragen sind bewusst
nicht vorbelegt – bis zur Antwort schlägt die App kein Abnehm-Defizit vor.

| Angabe | Was sich ändert |
|---|---|
| Erkrankung oder regelmäßige Medikamente | Labor & Ergänzung nur dokumentierend, ohne Empfehlungen |
| Schwangerschaft/Stillzeit oder (frühere) Essstörung | zusätzlich keine Abnehm- oder Defizitziele, kein Abnehmprogramm, keine Gewichts- und Körperfettziele |
| Unter 18 (aus dem **Geburtsjahr** im Profil) | **Kinder- und Jugendprofil:** keine Kalorien- und Gewichtsziele, kein Zielgewicht, kein Abnehmprogramm, keine Leistungspräparate, Laborwerte nur dokumentiert, Kalorienzahlen ausgeblendet |

**Kalorienzahlen ausblenden:** Der Schalter darunter verbirgt kcal-Angaben in der Ernährung, auf
„Heute“ und bei der Energieversorgung – für alle, denen Zahlen beim Essen nicht guttun. Erfassen kannst
du weiterhin alles.

**Für Eltern-Admins:** Verwaltest du das Profil eines Kindes, zeigt das Banner oben
„Kinder- und Jugendprofil“. Wichtig ist bei Kindern, genug und abwechslungsreich zu essen – besonders an
Trainingstagen.

**Ausbleibende Periode:** Ist dein letzter Periodenbeginn deutlich länger her als üblich, fragt die App
auf „Heute“ und im Zyklus nach („ausgeblieben“, „schwanger oder stillend“, „hormonelle Verhütung“, „nur
nicht eingetragen“). Einen ärztlichen Hinweis zeigt sie erst bei „ausgeblieben“ – oder nach 90 Tagen ohne
Antwort. Lange Zyklen zählen dabei als echte Zyklen, statt still mit 28 Tagen weiterzurechnen.

---

## Zykluskalender

<img src="../assets/18-zyklus.png" width="260" align="right" alt="Zykluskalender mit Phasen" />

Eine zyklusbewusste, rücksichtsvolle Trainingsplanung. Das Modul ist anfangs eingeschaltet; wer es
nicht braucht, schaltet es unter **Einstellungen → Module** aus (dann verschwinden Menüpunkt und
Eintrag unter „＋ Erfassen“).

1. Markiere deinen **Periodenbeginn** (**＋ Erfassen → Periode** oder auf der Zyklusseite) – oder lass
   ihn aus Apple Health bzw. Health Connect übernehmen (siehe oben; importierte Einträge tragen ihre
   Herkunft). Cat-O-Fit berechnet **Zykluslänge**, deine **aktuelle Phase**
   (Menstruation/Follikel/Ovulation/Luteal) und prognostiziert die **nächste Periode**.
2. Die Phasen erscheinen dezent im **Kalender**. Die Tipps je Phase sind bewusst **neutral**: Wie du dich
   im Zyklus fühlst, ist sehr individuell, und die Studienlage zu Leistungsunterschieden je Phase ist schwach
   – richte dich nach deinem Befinden.
3. An deinen **Menstruationstagen** sind Einheiten **geschützt**: Du kannst sie **schadfrei**
   verschieben oder auslassen – sie zählen nicht als verpasst und schmälern weder Plan-Einhaltung
   noch Momentum.
4. Trägst du einen Periodenbeginn für heute oder morgen ein, fragt Cat-O-Fit, ob du es an dem Tag
   **lockerer** angehen möchtest – nur dann wird das Training angepasst.
5. **Hormonelle Verhütung** (Pille, Hormonspirale, Implantat …): Mit dem Schalter unten auf der Seite zeigt
   Cat-O-Fit keine Phasen mehr, nur noch deine Blutungstage, und fragt bei einer ausbleibenden Blutung
   nicht nach – unter hormoneller Verhütung sind Zyklusphasen nicht aussagekräftig.
6. **Ohne neuen Eintrag seit rund drei Monaten** pausiert die Prognose: keine Phasen, keine „nächste
   Periode“, keine geschützten Tage. Trag den letzten Periodenbeginn nach, dann geht es weiter.
7. Das Abzeichen **„Zyklus im Blick“ 🌙** gibt es für drei eingetragene Periodenstarts.

> 🔒 **Datenschutz:** Zyklusdaten sieht nur die Person selbst – auch Admins beim Verwalten nicht, und
> der Server gibt sie nur nach ihrer PIN-Anmeldung heraus. Sie liegen auf eurem eigenen Server
> (siehe [Privat bleibt privat](familie.md#privat-bleibt-privat)).

<br clear="all" />
