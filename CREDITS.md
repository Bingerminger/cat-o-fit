# Danksagungen & Drittanbieter-Hinweise

Cat-O-Fit ist bewusst **abhängigkeitsfrei** gebaut: Es gibt keine npm-Pakete,
kein Build-Tool und keine eingebundenen Fremd-Bibliotheken. Der gesamte
Anwendungs-Code (JavaScript, PHP, CSS) ist eigenständig geschrieben und steht
unter der [MIT-Lizenz](LICENSE).

Trotzdem stützt sich das Projekt auf einige externe Dienste und Ideen, die hier
gewürdigt werden.

## Laufzeit-Dienste

### Open-Meteo
Wetter- und Geocoding-Daten stammen von **[Open-Meteo](https://open-meteo.com/)**.
Die Daten stehen unter der Lizenz
[Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

> Weather data by Open-Meteo.com (CC BY 4.0)

Open-Meteo wird ausschließlich zur Laufzeit für die optionale Wetter-Anzeige
aufgerufen. Es werden keine Open-Meteo-Daten mit Cat-O-Fit ausgeliefert, daher
berührt diese Attribution nicht die MIT-Lizenz des Quellcodes.

## Gestalterische Inspiration

### Icons
Das SVG-Icon-Set ist selbst gezeichnet, orientiert sich aber stilistisch an den
quelloffenen Icon-Bibliotheken **[Feather Icons](https://feathericons.com/)**
(MIT-Lizenz) und **[Lucide](https://lucide.dev/)** (ISC-Lizenz). Es wurden keine
Original-Pfaddaten kopiert; die Anlehnung beschränkt sich auf Strichstärke,
Raster (24×24) und visuelle Sprache.

## Trainingswissenschaftliche Methoden

Die in der App verwendeten Berechnungsmethoden beruhen auf öffentlich
publizierten, frei anwendbaren Formeln:

- **VDOT- / Pace-Schätzung** nach den Trainingsprinzipien von **Jack Daniels**
  (*Daniels' Running Formula*). Siehe auch [TRADEMARKS.md](TRADEMARKS.md).
- **Wettkampfzeit-Hochrechnung** nach der **Riegel-Formel** (Peter Riegel, 1977).
- **Grundumsatz** nach der **Mifflin-St-Jeor-Gleichung**.

Diese Formeln sind Allgemeingut der Trainings- und Sportwissenschaft; lediglich
einzelne Bezeichnungen sind markenrechtlich geschützt (siehe TRADEMARKS.md).
