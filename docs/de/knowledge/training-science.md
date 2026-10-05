# Trainingswissen

[English](../../knowledge/training-science.md) · **Deutsch**

Periodisierung, Zonen, Tempo, Belastung und Energie – das Wissen hinter den Plänen, mit den Formeln,
die Cat-O-Fit tatsächlich rechnet.

> Teil der [Dokumentation](../README.md) · [Verstehen](../README.md#verstehen) ·
> Quellen: [Methodik & Quellen](methods-and-sources.md)

**Auf dieser Seite:**

- [Trainingswissen](#trainingswissen)
- [Belastung in Zahlen](#belastung-in-zahlen)
- [Form, Prognose und Trainingstempo](#form-prognose-und-trainingstempo)
- [Energieversorgung](#energieversorgung)
- [Grenzen](#grenzen)

---

## Trainingswissen

**Die Trainingsphasen (Periodisierung).** Ein guter Plan baut in Phasen auf:
*Grundlage* (lockerer Umfang), *Aufbau* (Schwelle, Tempohärte), *Spitze* (kurze schnelle
Reize & Wettkampftempo), *Tapering* (Umfang runter, frisch an den Start).

**Herzfrequenz-Zonen.** Fünf Zonen aus deiner Max-HF: Z1 Regeneration, Z2 Grundlage
(„unterhaltsam“, hier wächst die Ausdauer), Z3 Tempo, Z4 Schwelle, Z5 VO₂max (nur kurz). Kennst du deine
Max-HF nicht, schätzt Cat-O-Fit sie auf Wunsch aus dem Alter (208 − 0,7 × Alter) – deutlich als Schätzung
markiert, denn im Einzelfall liegt sie oft 10 Schläge daneben. Mit **Ruhepuls** kannst du die Zonen über die
**Herzfrequenzreserve** (Karvonen) rechnen lassen; sie liegen dann für die Grundlage meist etwas höher.

**Pace-Bereiche.** Jeder Einheitstyp hat einen Tempobereich in min/km, abgeleitet aus deiner
Zielzeit bzw. deiner Form – ein Vorschlag, kein Muss. Tagesform zählt. (Die App rechnet metrisch;
imperiale Einheiten sind für Version 4.1 geplant.)

**RPE (1–10).** Dein subjektives Belastungsempfinden ergänzt Herzfrequenz und Pace –
besonders an Tagen, an denen sich Zahlen „anders anfühlen“. 1 ist sehr leicht, 3 locker, 5 mittel,
7 hart, 10 maximal.

**Einheiten-Typen.** Lauf-Einheiten (Regeneration, lockerer Lauf, Long Run, Tempo/Schwelle,
Intervalle, Wettkampf), Kraft & **Gerätetraining**, Mobility, **Gehen/Spazieren** und **Wandern**,
**Schwimmen**, **Rudern**, Rad & **Indoor-Cycling**, **Crosstrainer**, Ballsport (**Tennis,
Badminton, Squash, Tischtennis**, Fußball) sowie Cross-Training und Ruhetag. Alle außer dem Ruhetag
lassen sich im Workout-Modus mit Stoppuhr starten und zählen zur Gesamtbelastung.

---

## Belastung in Zahlen

Alle Belastungsurteile haben **eine Quelle**: die Belastungspunkte jeder Einheit.

| Größe | So rechnet Cat-O-Fit |
|---|---|
| **Belastungspunkte (AU, Session-RPE)** | Dauer in Minuten × Anstrengung (RPE 1–10). Fehlt die Dauer: aus der Strecke je Sportart, dann die geplante Dauer, zuletzt 30 Minuten. Fehlt die Anstrengung: ein typischer Wert der Einheitenart. |
| **Lastverhältnis (ACWR)** | Belastung der letzten 7 Tage ÷ Wochenschnitt der 21 Tage davor („entkoppelt“ – die akuten Tage stecken nicht im Vergleichswert). 0,8–1,3 heißt: nah an deinem Schnitt. In den ersten vier Wochen gibt es noch kein Urteil. |
| **Fitness (CTL) und Ermüdung (ATL)** | Exponentiell geglättete Tageslast mit Zeitkonstanten von 42 bzw. 7 Tagen (nach Banister). |
| **Form (TSB)** | Fitness − Ermüdung, eingeordnet **relativ zur Fitness**: frisch (über +10 %), ausgeglichen, im Training (bis −30 %), deutlich ermüdet. Bewertet erst ab rund 90 Tagen Daten. |
| **Monotonie und Strain** | Wochenschnitt der Tageslast ÷ ihre Standardabweichung (nach Foster); Strain = Wochenlast × Monotonie. Hinweis nur bei Monotonie ab 2 **und** einer Woche mindestens 10 % über deiner üblichen Wochenlast; Einheiten bis RPE 3 zählen nicht. |

Die Grenzen 0,8/1,3/1,5 stammen aus Beobachtungsdaten im Teamsport. Dass Training nach dieser Ampel
Verletzungen verhindert, ist **nicht belegt** – Cat-O-Fit nutzt sie als Hinweis, wie stark deine Last
gegenüber deinem eigenen Schnitt gestiegen ist, nicht als Schutzversprechen.

---

## Form, Prognose und Trainingstempo

- **VDOT** ist ein Formwert nach Jack Daniels: Aus einer Strecke und einer Zeit ergibt sich eine
  Leistungsfähigkeit, aus der sich Äquivalenzzeiten für andere Strecken und Trainingstempi ableiten.
- **Aktuelle Form:** je Woche der beste **harte** Lauf (Wettkampf, Tempo, Intervalle oder Anstrengung
  ab 7 bzw. Herzfrequenz ab Zone 4), jüngere Wochen stärker gewichtet, Ausreißer gekappt (Median ±
  3 × MAD, Halbwertszeit zwei Wochen). Lockere Läufe zählen nur als Untergrenze.
- **Prognose:** die Äquivalenzzeit deiner Form für die Wettkampfstrecke. Für Halbmarathon und
  Marathon gilt sie nur mit passendem Umfang (Marathon: ab ~50 km pro Woche und Long Run ab ~25 km;
  Halbmarathon: ab ~30 km und ~15 km) – sonst trägt die Prognose einen Vorbehalt. Fehlen harte Läufe,
  rechnet die App ersatzweise mit der Riegel-Formel.
- **Trainingstempo im Plan:** Training aus der langsameren von Ziel- und Formleistung, das
  **Renntempo** aus der Zielzeit. Ist die Zielzeit mehr als 3 VDOT-Punkte über deiner Form, sagt die
  App das und trainiert nach der Form.

---

## Energieversorgung

Die **Energieverfügbarkeit** ist die gegessene Energie minus Trainingsverbrauch, geteilt durch die
fettfreie Masse in kg. Richtwert rund **45 kcal je kg**; mit Abnehmziel gilt 30–45 vorübergehend als
vertretbar, darunter (bei Männern unter 25) wird es für Hormone, Knochen und Regeneration kritisch –
in der Sportmedizin heißt ein anhaltendes Defizit **RED-S**. Cat-O-Fit rechnet nur mit Tagen, die du
als „Tag vollständig“ bestätigt hast, und zeigt eine Spanne, weil alle Eingangswerte Schätzungen sind.

Beim Abnehmen bleibt das Tagesziel über dem **Grundumsatz** (Mifflin-St Jeor) und über dem
Trainingsbedarf plus 30 kcal je kg fettfreier Masse; ohne Körperfettwert ist das Defizit auf 15 %
begrenzt. Unter einem Ziel-BMI von 18,5 rechnet die App kein Defizit.

---

## Grenzen

Cat-O-Fit dient der **Dokumentation und allgemeinen Information für gesunde Erwachsene** – es ist kein
Medizinprodukt, stellt keine Diagnose und ersetzt keine Trainings- oder ärztliche Beratung. Alle
Kennzahlen sind Orientierung aus Modellen; wie du dich fühlst, zählt mehr als jede Zahl.
