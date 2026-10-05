/* Prints all voice building blocks of the session in one language as JSON ({ key: text }) –
   input for tools/voice-clips.py. The texts come from the catalogs of that language
   (locales/<lang>/), so the language is one of locales/languages.json.
   Call: node --import ./test-setup.js tools/voice-texts.mjs <lang> > /tmp/voice-<lang>.json
   Without an argument: German. */
import { EXERCISES } from '../js/exercises.js';
import { voiceTexts } from '../js/voice.js';
import { setLocale, loadArea, locale, languages, LAZY_AREAS } from '../js/i18n.js';

const lang = process.argv[2] || 'de';
if (!Object.hasOwn(languages(), lang)) {
  process.stderr.write(`Unknown language "${lang}". Available: ${Object.keys(languages()).join(', ')}\n`);
  process.exit(1);
}
await setLocale(lang);
for (const area of LAZY_AREAS) await loadArea(area);
if (locale() !== lang) {
  process.stderr.write(`Could not switch to "${lang}".\n`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(voiceTexts(EXERCISES), null, 1));
