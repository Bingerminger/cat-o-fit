# Danksagungen & Drittanbieter-Hinweise

Cat-O-Fit ist bewusst **abhängigkeitsfrei** gebaut: Es gibt keine npm-Pakete,
kein Build-Tool und keine eingebundenen Fremd-Bibliotheken. Der gesamte
Anwendungs-Code (JavaScript, PHP, CSS) ist eigenständig geschrieben und steht
unter der [GNU AGPL v3.0 oder neuer](LICENSE).

Trotzdem stützt sich das Projekt auf einige externe Dienste und Ideen, die hier
gewürdigt werden.

## Laufzeit-Dienste

### Open-Meteo
Wetter- und Geocoding-Daten stammen von **[Open-Meteo](https://open-meteo.com/)**.
Die Daten stehen unter der Lizenz
[Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

> Weather data by Open-Meteo.com (CC BY 4.0)

Open-Meteo wird ausschließlich zur Laufzeit für die optionale Wetter-Anzeige
aufgerufen (direkt vom Gerät, mit Ort bzw. Koordinaten). Es werden keine
Open-Meteo-Daten mit Cat-O-Fit ausgeliefert, daher berührt diese Attribution nicht
die Lizenz des Quellcodes.

**Nutzungsbedingungen:** Die kostenlose Schnittstelle von Open-Meteo ist laut ihren
[Bedingungen](https://open-meteo.com/en/terms) nur für **nicht-kommerzielle** Nutzung
gedacht (unter 10 000 Aufrufen am Tag). Wer Cat-O-Fit kommerziell betreibt – etwa als
bezahlten Dienst für einen Verein –, braucht einen eigenen Open-Meteo-Tarif oder schaltet
das Wetter ab.

### Open Food Facts
Nährwerte je Zutat für die optionale „schätzen“-Hilfe stammen – nur wenn
„Nährwerte online ergänzen“ eingeschaltet ist (für neue Profile standardmäßig aus) –
aus **[Open Food Facts](https://openfoodfacts.org)**, einer offenen, gemeinnützigen
Datenbank. Die Datenbank steht unter der
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/), die
einzelnen Inhalte unter der
[Database Contents License (DbCL)](https://opendatacommons.org/licenses/dbcl/1-0/).

> Nährwertdaten: Open Food Facts – openfoodfacts.org (ODbL/DbCL)

Die Anfrage stellt der eigene Server und schickt dabei nur den Zutatennamen; die
Ergebnisse werden dort bis zu 90 Tage zwischengespeichert. Mit Cat-O-Fit werden keine
Open-Food-Facts-Daten ausgeliefert; die App nennt die Quelle neben dem Schalter und unter
„Über & Rechtliches“.

## Mitgelieferte Inhalte

| Inhalt | Herkunft | Lizenz |
|---|---|---|
| Rezept-Ideen (48 Gerichte) | für Cat-O-Fit zusammengestellt; Nährwerte aus den Zutaten gerechnet | AGPL-3.0-or-later (wie der Code) |
| Nährwerttabelle der „schätzen“-Hilfe | gerundete Durchschnittswerte je 100 g bzw. ml, für Cat-O-Fit zusammengestellt | AGPL-3.0-or-later |
| Übungsgrafiken | selbst gezeichnete, symbolische Strichfiguren | AGPL-3.0-or-later |
| Icons | selbst gezeichnet (siehe unten) | AGPL-3.0-or-later |
| Bildschirmfotos in `docs/assets` | aus der App mit Beispieldaten erzeugt | AGPL-3.0-or-later |
| Laborbereiche und Zielkorridore | aus Fachliteratur und Laborangaben, Quelle je Wert in der App und unter [Methodik & Quellen](docs/wissen/methodik-und-quellen.md) | Angaben zur Orientierung |

## Gestalterische Inspiration

### Icons
Das SVG-Icon-Set ist selbst gezeichnet, orientiert sich aber stilistisch an den
quelloffenen Icon-Bibliotheken **[Feather Icons](https://feathericons.com/)**
(MIT-Lizenz) und **[Lucide](https://lucide.dev/)** (ISC-Lizenz). Es wurden keine
Original-Pfaddaten kopiert; die Anlehnung beschränkt sich auf Strichstärke,
Raster (24×24) und visuelle Sprache.

## Trainingswissenschaftliche Methoden

Die in der App verwendeten Berechnungsmethoden beruhen auf öffentlich
publizierten, frei anwendbaren Verfahren, unter anderem:

- **VDOT- / Pace-Schätzung** nach den Trainingsprinzipien von **Jack Daniels**
  (*Daniels' Running Formula*). Siehe auch [TRADEMARKS.md](TRADEMARKS.md).
- **Wettkampfzeit-Hochrechnung** nach der **Riegel-Formel** (Peter Riegel, 1977/1981).
- **Fitness, Ermüdung und Form** nach dem Modell von **Eric Banister**.
- **Belastungspunkte (Session-RPE)** sowie **Monotonie und Strain** nach **Carl Foster**.
- **Maximale Herzfrequenz** nach **Tanaka**, **Herzfrequenzreserve** nach **Karvonen**.
- **Grundumsatz** nach der **Mifflin-St-Jeor-Gleichung**.

Die vollständige Liste mit Literaturangaben – auch für Energieverfügbarkeit, Laborwerte
und Ergänzung – steht unter [Methodik & Quellen](docs/wissen/methodik-und-quellen.md).
Diese Methoden sind Allgemeingut der Trainings- und Sportwissenschaft; lediglich einzelne
Bezeichnungen sind markenrechtlich geschützt (siehe TRADEMARKS.md).
