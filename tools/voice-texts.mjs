/* Prints all voice building blocks of the session as JSON ({ key: text }) – input
   for tools/voice-clips.py. Call: node --import ./test-setup.js tools/voice-texts.mjs > /tmp/voice.json */
import { EXERCISES } from '../js/exercises.js';
import { voiceTexts } from '../js/voice.js';

process.stdout.write(JSON.stringify(voiceTexts(EXERCISES), null, 1));
