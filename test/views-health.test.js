/* Ansichten nach Paket C: Eignung in den Einstellungen, Labor im Kinder- und
   Jugendprofil, ausgeblendete Kalorienzahlen, Perioden-Hinweis auf „Heute“,
   geglättete Körperwerte-Kacheln. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr, addDays } from '../js/ui.js';
import * as settings from '../js/settings.js';
import * as labsView from '../js/labs-view.js';
import * as dashboard from '../js/dashboard.js';
import * as health from '../js/health.js';
import * as nutrition from '../js/nutrition.js';

const doc = globalThis.document;
const ADULT_GATE = { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false };
const thisYear = Number(todayStr().slice(0, 4));

function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events', 'nutrition', 'diary', 'cycle', 'labs', 'supplements'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', {});
  store.setSetting('labsGate', {});
  store.setSetting('hideCalorieNumbers', false);
  store.setProfile({ name: 'Test', heightCm: 170, weightKg: 70, targetWeightKg: 65, birthYear: 1990, sex: 'w' });
});

test('Einstellungen: Bereich „Gesundheit & Eignung“ mit Abgrenzung, Zahlen-Schalter und Zweckbestimmung', () => {
  const view = setupShell();
  settings.render(view);
  const t = view.textContent;
  assert.match(t, /Gesundheit & Eignung/);
  assert.match(t, /Noch nicht beantwortet/);
  assert.match(t, /Kalorienzahlen ausblenden/);
  assert.match(t, /kein Medizinprodukt/);
  assert.match(t, /Ziel 65\u00a0kg/);
});

test('Einstellungen: Kinder- und Jugendprofil ohne Zielgewicht, Zahlen immer aus', () => {
  store.setProfile({ birthYear: thisYear - 13 });
  const view = setupShell();
  settings.render(view);
  const t = view.textContent;
  assert.match(t, /Kinder- und Jugendprofil \(laut Geburtsjahr 13 Jahre\)/);
  assert.match(t, /Im Kinder- und Jugendprofil immer ausgeblendet/);
  assert.doesNotMatch(t, /Ziel 65 kg/);
});

test('Labor: ohne Abgrenzung erst die Einrichtung; Kinderprofil nur dokumentierend', () => {
  store.replaceArea('labs', [{ id: 'l1', analyte: 'ferritin', value: 12, unit: 'µg/l', date: addDays(todayStr(), -5) }]);
  let view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /Einrichten/);

  store.setProfile({ birthYear: thisYear - 14 });
  view = setupShell();
  labsView.render(view);
  const t = view.textContent;
  assert.match(t, /dokumentiert deine Werte nur/);
  assert.match(t, /ohne Bewertung/);
  assert.match(t, /Für Kinder und Jugendliche gibt Cat-O-Fit keine Einnahme-Empfehlungen/);
  assert.doesNotMatch(t, /unter dem Referenzbereich/);
  assert.doesNotMatch(t, /Energieversorgung/);
});

test('Labor: Energieversorgung ohne Zahlen, wenn Kalorienzahlen ausgeblendet sind', () => {
  store.setSetting('labsGate', ADULT_GATE);
  const today = todayStr();
  const diary = [], sessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    diary.push({ id: `d${i}`, date: d, kcal: 1500 });
    diary.push({ id: `day-${d}`, _kind: 'day', date: d, complete: true });
    sessions.push({ id: `s${i}`, date: d, type: 'easy', distanceKm: 10, durationSec: 3600 });
  }
  store.replaceArea('diary', diary);
  store.replaceArea('sessions', sessions);
  store.replaceArea('health', [{ id: 'h1', date: addDays(today, -1), weight: 60, bodyFat: 20 }]);
  let view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /kcal je kg fettfreier Masse/);
  assert.match(view.textContent, /Spanne/);

  store.setSetting('hideCalorieNumbers', true);
  view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /Energieversorgung/);
  assert.doesNotMatch(view.textContent, /kcal je kg/);
});

test('Labor: fehlender Körperfettwert wird benannt (HEALTH-35)', () => {
  store.setSetting('labsGate', ADULT_GATE);
  const today = todayStr();
  store.replaceArea('diary', [{ id: 'd1', date: today, kcal: 1800 }]);
  store.replaceArea('health', [{ id: 'h1', date: today, weight: 60 }]);
  const view = setupShell();
  labsView.render(view);
  assert.match(view.textContent, /fehlt die fettfreie Masse/);
});

test('„Heute“: überfällige Periode fragt nach, bestätigt ausgeblieben zeigt den Arzthinweis (HEALTH-09)', () => {
  const today = todayStr();
  const last = addDays(today, -50);
  store.replaceArea('cycle', [
    { id: 'c1', startDate: addDays(last, -56), periodLength: 5 },
    { id: 'c2', startDate: addDays(last, -28), periodLength: 5 },
    { id: 'c3', startDate: last, periodLength: 5 },
  ]);
  let view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Periode überfällig\?/);
  store.upsert('cycle', { id: 'cycle-check', _kind: 'check', for: last, answer: 'ausgeblieben', at: '2026-01-01T00:00:00Z' });
  view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /ausgeblieben/);
  assert.match(view.textContent, /ärztlich abgeklärt/);
});

test('„Heute“: bei Essstörung kein Abnehm-Cockpit, nur das Leistungsziel (HEALTH-07)', () => {
  const today = todayStr();
  store.replaceArea('health', [{ id: 'h1', date: addDays(today, -2), weight: 70 }]);
  store.replaceArea('events', [{ id: 'e1', name: 'Herbstlauf', date: addDays(today, 60), distanceKm: 10, kind: 'race', targetTime: '00:52:00' }]);
  store.replaceArea('plans', [{
    id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(today, -14), endDate: addDays(today, 60), weeks: 11,
    phases: [{ key: 'base', name: 'Grundlage', startWeek: 1, endWeek: 5 }, { key: 'build', name: 'Aufbau', startWeek: 6, endWeek: 11 }],
    commitments: [], units: [],
  }]);
  store.setSetting('labsGate', ADULT_GATE);
  let view = setupShell();
  dashboard.render(view);
  assert.match(view.textContent, /Ziel-Cockpit · 10\u00a0km \+ Abnehmen/, 'Titel nennt die echte Distanz');
  store.setSetting('labsGate', { ...ADULT_GATE, eatingDisorder: true });
  view = setupShell();
  dashboard.render(view);
  const t = view.textContent;
  assert.match(t, /Ziel-Cockpit/);
  assert.match(t, /Herbstlauf/);
  assert.doesNotMatch(t, /\+ Abnehmen/);
  assert.doesNotMatch(t, /Zeitraum zum Abnehmen/);
  assert.doesNotMatch(t, /Defizit/);
  assert.doesNotMatch(t, /bis 65,0 kg|Ziel 65,0 kg/);
});

test('Körperwerte: Veränderung über den Wochenmedian, Hinweis auf die Glättung (HEALTH-28)', () => {
  const today = todayStr();
  store.replaceArea('health', [
    { id: 'h1', date: addDays(today, -14), weight: 70.0 }, { id: 'h2', date: addDays(today, -13), weight: 70.4 },
    { id: 'h3', date: addDays(today, -12), weight: 70.2 }, { id: 'h4', date: addDays(today, -2), weight: 69.6 },
    { id: 'h5', date: addDays(today, -1), weight: 69.8 }, { id: 'h6', date: today, weight: 71.0 },
  ]);
  const view = setupShell();
  health.render(view);
  const t = view.textContent;
  assert.match(t, /▼ 0,4/);
  assert.match(t, /Wochenmittels \(Median\)/);
});

test('Ernährung: „Kalorienzahlen ausblenden“ verbirgt kcal-Angaben', () => {
  store.setSetting('labsGate', ADULT_GATE);
  store.replaceArea('nutrition', [{ id: 'n1', title: 'Skyr-Bowl', category: 'fruehstueck', kcal: 380, protein: 32, ingredients: ['250 g Skyr'], tags: [] }]);
  store.replaceArea('diary', [{ id: 'd1', date: todayStr(), title: 'Skyr-Bowl', kcal: 380 }]);
  let view = setupShell();
  nutrition.render(view);
  assert.match(view.textContent, /kcal/);
  store.setSetting('hideCalorieNumbers', true);
  view = setupShell();
  nutrition.render(view);
  assert.doesNotMatch(view.textContent, /\d\s?kcal/);
});

test('UI-26: Gegessenes – Lebensmittel mit Menge und „zuletzt gegessen“', () => {
  const view = setupShell();
  for (const id of ['modal-root', 'toast-root']) { const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  store.replaceArea('diary', [{ id: 'd0', date: addDays(todayStr(), -1), title: 'Skyr mit Beeren', kcal: 190, protein: 20, source: 'manual' }]);
  assert.deepEqual(nutrition.splitFoods('200 g Skyr, 1 Banane und 30 g Haferflocken'), ['200 g Skyr', '1 Banane', '30 g Haferflocken']);
  nutrition.openQuickEaten();
  const sheet = doc.getElementById('modal-root');
  const input = sheet.querySelectorAll('input')[0];
  input.value = '200 g Skyr';
  input.dispatchEvent({ type: 'input' });
  assert.match(sheet.textContent, /≈ \d+ kcal/, 'Schätzung live');
  const recent = sheet.querySelectorAll('button').find((b) => /Skyr mit Beeren/.test(b.textContent));
  assert.ok(recent, '„zuletzt gegessen“ als Ein-Tipp-Eintrag');
  recent.click();
  const todays = store.get('diary').filter((d) => d.date === todayStr());
  assert.equal(todays.length, 1);
  assert.equal(todays[0].kcal, 190);
  void view;
});

test('FE-09: Körperwerte – Zeitraum-Umschalter und Wochenmittel bei langen Reihen', () => {
  const T = todayStr();
  store.replaceArea('health', Array.from({ length: 800 }, (_, i) => ({ id: `w${i}`, date: addDays(T, -i), weight: 70 + (i % 7) * 0.1 })));
  const view = setupShell();
  health.render(view);
  const tabs = view.querySelectorAll('button').filter((b) => b.getAttribute('role') === 'radio').map((b) => b.textContent);
  assert.deepEqual(tabs, ['3 Monate', '1 Jahr', 'Alles']);
  const pts = view.querySelectorAll('polyline')[0].getAttribute('points').split(' ').length;
  assert.ok(pts <= 54 && pts >= 50, `1 Jahr als Wochenmittel: ${pts} Punkte`);
  assert.deepEqual(health.weeklyMedian([
    { date: '2026-09-28', value: 70 }, { date: '2026-09-29', value: 72 }, { date: '2026-09-30', value: 71 },
  ]).map((p) => [p.date, p.value]), [['2026-09-28', 71]]);
});
