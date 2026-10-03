import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../js/i18n.js';
import { dosesFromText, doseLabel, programForUnit } from '../js/show-program.js';

const DE = 'Ganzkörper, 3 Runden: Kniebeugen 12× · Ausfallschritte 10×/Bein · Plank 30–45 s. 60–90 s Pause zwischen den Runden.';
const EN = 'Full body, 3 rounds: Squats 12× · Lunges 10×/leg · Plank 30–45 s. 60–90 s rest between rounds.';
const brief = (d) => ({ rounds: d.rounds, roundRest: d.roundRest, items: d.items.map(({ id, reps, holdS, perSide }) => ({ id, reps, holdS, perSide })) });

test('an English plan text gives the same exercises and doses as the German one', async () => {
  const de = brief(dosesFromText(DE));
  assert.deepEqual(de.items.map((i) => i.id), ['squat', 'lunge', 'plank']);
  await setLocale('en');
  try {
    assert.deepEqual(brief(dosesFromText(EN)), de);
    // German plan texts written before v4.0.0 are still understood in an English UI.
    assert.deepEqual(brief(dosesFromText(DE)), de);
  } finally { await setLocale('de'); }
});

test('dose labels and the fallback title follow the language', async () => {
  const unit = { type: 'strength', description: EN };
  await setLocale('en');
  try {
    const p = programForUnit(unit);
    assert.equal(p.title, 'Session');
    const lunge = p.items.find((i) => i.id === 'lunge');
    assert.match(doseLabel(lunge, p), /^\d+×( each side)?$/);
  } finally { await setLocale('de'); }
});
