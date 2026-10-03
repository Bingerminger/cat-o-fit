# Translation guide and glossary

Cat-O-Fit is written in English (the source language, `locales/en`) and translated into
German, French, Spanish, Italian, Brazilian Portuguese and Dutch. This page keeps the
translations consistent. Corrections by native speakers are very welcome – see
[REVIEW.md](REVIEW.md) for the state of each language.

## How the catalogs work

- One folder per language, one JSON file per area: `ui.json` (everything on screen) and, later,
  `help.json`, `exercises.json`, `workouts.json`, `recipes.json`, `health.json`.
- Keys are nested and stay English; only the values are translated.
- Placeholders such as `{count}`, `{name}` or `{language}` stay exactly as they are.
- Plurals: `"one"` and `"other"`, plus `"many"`, `"few"` … where the language needs them
  (see `Intl.PluralRules`). `{count}` arrives already formatted for the language.
- Lists (weekday and month names) keep their length and order: weekdays start on Sunday,
  months on January.
- `test/i18n-catalog.test.js` checks keys, placeholders, plural forms and empty texts.

## Tone

Friendly, short and direct – a coach, not a manual. Always the informal address:

| Language | Address | Example |
|---|---|---|
| English | you | "Applies to you on every device." |
| German | du (lower case) | „Gilt für dich auf allen Geräten.“ |
| French | tu | « S’applique à toi sur tous tes appareils. » |
| Spanish | tú | "Se aplica a ti en todos tus dispositivos." |
| Italian | tu | "Vale per te su tutti i tuoi dispositivi." |
| Brazilian Portuguese | você | "Vale para você em todos os seus dispositivos." |
| Dutch | je/jij | "Geldt voor jou op al je apparaten." |

- Gender-inclusive: German uses the colon form (`Läufer:innen`); the other languages use neutral
  wording ("people who run", "personas", "pessoas") instead of a gender marker.
- Typography: typographic quotes and apostrophes of each language (“ ” · „ “ · « » · ’),
  a non-breaking space between number and unit (`5 km`, `72,4 kg`).
- Dates and numbers come from `js/format.js` – never write them into a text by hand.

## Glossary

Terms with a fixed translation. Brand and method names (VDOT, Hyrox, Apple Health, Garmin,
Strava, RPE, ACWR, HRV, FTP, CSS) are never translated.

| English | German | French | Spanish | Italian | Portuguese (BR) | Dutch |
|---|---|---|---|---|---|---|
| plan | Plan | plan | plan | piano | plano | schema |
| session (planned unit) | Einheit | séance | sesión | sessione | treino | training |
| workout (follow-along) | Workout | séance guidée | entrenamiento guiado | allenamento guidato | treino guiado | workout |
| race | Wettkampf | course | carrera | gara | prova | wedstrijd |
| long run | Long Run | sortie longue | tirada larga | lungo | longão | duurloop |
| pace | Pace | allure | ritmo | passo | pace | tempo |
| load | Belastung | charge | carga | carico | carga | belasting |
| fitness / fatigue / form | Fitness / Ermüdung / Form | forme / fatigue / fraîcheur | forma / fatiga / frescura | forma / fatica / freschezza | condicionamento / fadiga / forma | fitheid / vermoeidheid / vorm |
| rest day | Ruhetag | jour de repos | día de descanso | giorno di riposo | dia de descanso | rustdag |
| strength | Kraft | renforcement | fuerza | forza | força | kracht |
| set / rep | Satz / Wiederholung | série / répétition | serie / repetición | serie / ripetizione | série / repetição | set / herhaling |
| exercise | Übung | exercice | ejercicio | esercizio | exercício | oefening |
| lab values | Laborwerte | analyses | análisis | esami | exames | labwaarden |
| reference range | Referenzbereich | valeurs de référence | rango de referencia | intervallo di riferimento | valores de referência | referentiewaarden |
| cycle | Zyklus | cycle | ciclo | ciclo | ciclo | cyclus |
| food diary | Ess-Tagebuch | journal alimentaire | diario de comidas | diario alimentare | diário alimentar | eetdagboek |
| shopping list | Einkaufsliste | liste de courses | lista de la compra | lista della spesa | lista de compras | boodschappenlijst |
| family / team | Familie / Team | famille / équipe | familia / equipo | famiglia / squadra | família / equipe | gezin / team |
| admin | Admin | admin | admin | admin | admin | beheerder |
| instance | Instanz | instance | instancia | istanza | instância | instantie |
| sign in | anmelden | se connecter | iniciar sesión | accedere | entrar | aanmelden |
