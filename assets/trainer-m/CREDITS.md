# The second trainer model (a man) – sources and licences

Like the first one (`assets/trainer/`), this figure is a human generated with **MakeHuman** (via the Blender extension
**MPFB 2**, <http://www.makehumancommunity.org>). Everything in this folder was exported from that human; nothing
comes from a game, an avatar service or a motion library.

| File | What | Source asset | Licence |
| --- | --- | --- | --- |
| `trainer.bin`, `trainer.json` | meshes with skin weights, skeleton (`game_engine` rig, fingers folded into the hands) | MakeHuman base mesh `hm08` and the assets below | CC0 |
| `body.jpg` | skin, with a tank top and shorts painted onto it for this project | `skins/young_caucasian_male` (MakeHuman system assets) | CC0 |
| `short04.png` | hair | `hair/short04` (MakeHuman system assets) | CC0 |
| `eyebrow003.png`, `eyelashes01.png` | brows, lashes | `eyebrows/eyebrow003`, `eyelashes/eyelashes01` (MakeHuman system assets) | CC0 |
| `high_poly.png` | eyes | `eyes/high-poly` with the iris `eyes/materials/brown` (MakeHuman system assets) | CC0 |
| `shoes05.jpg` | shoes and socks | `clothes/shoes05` (MakeHuman system assets) | CC0 |
| face shapes in `trainer.bin` | closing eyelids, a smile | MakeHuman expression units `eye-left-closure`, `eye-right-closure`, `mouth-corner-puller` (targets of the base mesh) | CC0 |

The MakeHuman system assets were explicitly released as CC0 in September 2020 (copyright holders at the time:
Data Collection AB, Joel Palmius, Jonas Hauquier). What MakeHuman and MPFB export is free of the tools' own
licences (the tools themselves are AGPL-3.0 and GPL-3.0 and are not part of this repository).

The body shape (an athlete), the face, the colours of hair and clothes and the cut of the clothes are settings and
paint of this project and are published with it under the project's licence.
