# Credits & third-party notices

Cat-O-Fit is deliberately built **without dependencies**: there are no npm packages, no
build tool and no bundled third-party libraries. All application code (JavaScript, PHP,
CSS) is written from scratch and licensed under the
[GNU AGPL v3.0 or later](LICENSE).

Even so, the project relies on a few external services and ideas, which are acknowledged
here.

## Runtime services

### Open-Meteo
Weather and geocoding data come from **[Open-Meteo](https://open-meteo.com/)**.
The data is licensed under
[Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

> Weather data by Open-Meteo.com (CC BY 4.0)

Open-Meteo is called only at runtime, for the optional weather display (directly from the
device, with the place or coordinates). No Open-Meteo data ships with Cat-O-Fit, so this
attribution does not affect the licence of the source code.

**Terms of use:** According to its
[terms](https://open-meteo.com/en/terms), the free Open-Meteo interface is intended for
**non-commercial** use only (under 10,000 calls a day). Anyone who runs Cat-O-Fit
commercially – for example as a paid service for a club – needs their own Open-Meteo plan
or must switch the weather off.

### Open Food Facts
Nutrition values per ingredient for the optional "estimate" helper come – only when
"Fill in nutrition values online" is switched on (off by default for new profiles) –
from **[Open Food Facts](https://openfoodfacts.org)**, an open, non-profit database. The
database is licensed under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/), the
individual contents under the
[Database Contents License (DbCL)](https://opendatacommons.org/licenses/dbcl/1-0/).

> Nutrition data: Open Food Facts – openfoodfacts.org (ODbL/DbCL)

The request is made by your own server and sends only the ingredient name; the results are
cached there for up to 90 days. No Open Food Facts data ships with Cat-O-Fit; the app names
the source next to the switch and under "About & legal".

## Bundled content

| Content | Origin | Licence |
|---|---|---|
| Recipe ideas (48 dishes) | compiled for Cat-O-Fit; nutrition values calculated from the ingredients | AGPL-3.0-or-later (like the code) |
| Nutrition table of the "estimate" helper | rounded averages per 100 g or ml, compiled for Cat-O-Fit | AGPL-3.0-or-later |
| Exercise graphics | self-drawn, symbolic stick figures | AGPL-3.0-or-later |
| Icons | self-drawn (see below) | AGPL-3.0-or-later |
| Screenshots in `docs/assets` | generated from the app with sample data | AGPL-3.0-or-later |
| Lab ranges and target corridors | from specialist literature and laboratory information; source per value in the app and under [Methods & sources](docs/knowledge/methods-and-sources.md) | information for orientation only |

## Design inspiration

### Icons
The SVG icon set is self-drawn, but stylistically inspired by the open-source icon
libraries **[Feather Icons](https://feathericons.com/)** (MIT licence) and
**[Lucide](https://lucide.dev/)** (ISC licence). No original path data was copied; the
inspiration is limited to stroke width, grid (24×24) and visual language.

## Training-science methods

The calculation methods used in the app are based on publicly published, freely
applicable methods, including:

- **VDOT / pace estimation** based on the training principles of **Jack Daniels**
  (*Daniels' Running Formula*). See also [TRADEMARKS.md](TRADEMARKS.md).
- **Race-time projection** using the **Riegel formula** (Peter Riegel, 1977/1981).
- **Fitness, fatigue and form** based on the model of **Eric Banister**.
- **Load points (session RPE)** as well as **monotony and strain** after **Carl Foster**.
- **Maximum heart rate** after **Tanaka**, **heart rate reserve** after **Karvonen**.
- **Basal metabolic rate** using the **Mifflin-St Jeor equation**.

The complete list with references – also for energy availability, lab values and
supplements – is under [Methods & sources](docs/knowledge/methods-and-sources.md).
These methods are common property of training and sport science; only some individual
names are protected by trademark law (see TRADEMARKS.md).
