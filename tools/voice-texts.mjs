/* Gibt alle Sprachbausteine der Session als JSON aus ({ Schlüssel: Text }) – Eingabe
   für tools/voice-clips.py. Aufruf: node --import ./test-setup.js tools/voice-texts.mjs > /tmp/voice.json */
import { EXERCISES } from '../js/exercises.js';
import { voiceTexts } from '../js/voice.js';

process.stdout.write(JSON.stringify(voiceTexts(EXERCISES), null, 1));
