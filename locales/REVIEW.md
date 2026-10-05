# Translation review status

Cat-O-Fit is developed in English and German. The other languages are machine-translated
with a fixed glossary ([GLOSSARY.md](GLOSSARY.md)) and have not been reviewed by native
speakers yet. If you speak one of them, a pull request with corrections is very welcome –
even a single fix helps.

| Language | Folder | Produced by | Reviewed by a native speaker |
|---|---|---|---|
| English | `en` | written by the project (source language) | – |
| German | `de` | written by the project | yes |
| French | `fr` | machine translation + glossary | not yet |
| Spanish | `es` | machine translation + glossary | not yet |
| Italian | `it` | machine translation + glossary | not yet |
| Portuguese (Brazil) | `pt-BR` | machine translation + glossary | not yet |
| Dutch | `nl` | machine translation + glossary | not yet |

When you have reviewed an area of a language, add your GitHub name and the area (for example
"ui, help") to the last column in your pull request.

## Voice clips

The recorded voice cues in `assets/voice/<language>/` are spoken by free synthetic voices
(licences in [CREDITS.md](../CREDITS.md#voice-clips)). The new voices (English, French, Spanish,
Italian, Portuguese, Dutch) **need a listening check by native speakers**: nobody has listened to
them yet. Please play a few clips of your language (the "Follow along non-stop" workouts, or the
`.m4a` files directly) and report anything garbled, too fast or wrongly pronounced. Names most
likely to be off are the English loanwords in the exercise names (Dead bug, Hollow hold,
Kettlebell swings, Burpees, Jumping jacks, Wall balls, Mountain climbers, World's greatest stretch).
Names a voice cannot read are respelled per language in `js/voice.js` (`SAY`); a fix there plus
`tools/voice-clips.py --only ex-<id>` regenerates the clip.
