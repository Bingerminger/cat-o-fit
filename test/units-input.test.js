/* Units in the forms (v4.1): a person on miles and pounds types distances, paces, weights, heights
   and strength sets in their units; everything is stored metric. A form opened and saved without a
   change leaves the stored values exactly as they were (no km → mi → km drift). Metric forms work
   as before. Every test switches back to metric. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import {
  setUnits, METRIC, toInput, fromInput, paceToInput, paceFromInput, heightFromInput,
} from '../js/units.js';
import { todayStr, addDays } from '../js/ui.js';
import * as session from '../js/session.js';
import * as settings from '../js/settings.js';
import * as events from '../js/events.js';
import { openHealthEntry } from '../js/health.js';
import { render as renderWorkout } from '../js/workout-mode.js';
import { fmtSet } from '../js/strength.js';

const IMPERIAL = { distance: 'mi', weight: 'lb', temperature: 'f' };
const doc = globalThis.document;
const today = todayStr();
let view;
let modal;

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  modal = doc.getElementById('modal-root');
  store.setProfile({ name: 'Alex', heightCm: 180, weightKg: 80, targetWeightKg: 75, birthYear: 1990, sex: 'm' });
  setUnits(IMPERIAL);
});
afterEach(() => setUnits(METRIC));

/** The input of the form field with this label (in the open sheet). */
function fieldInput(label) {
  const l = modal.querySelectorAll('label').find((x) => x.querySelector('.field__label')?.textContent === label);
  assert.ok(l, `field "${label}"`);
  return l.querySelector('input');
}
/** A button by text or label; click() also runs an `onclick` property (the mini DOM only fires listeners). */
const button = (root, text) => {
  const b = root.querySelectorAll('button').find((x) => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
  assert.ok(b, `button "${text}"`);
  return { click: () => (typeof b.onclick === 'function' ? b.onclick() : b.click()) };
};
const headerAction = (label) => button(doc.getElementById('header-actions'), label);
/** "Log training" with a run picked (the mini DOM's <select> has no value of its own). */
function openActivity(opts) {
  session.openActivitySheet(opts);
  const sel = modal.querySelector('select');
  sel.value = opts.existing?.type || 'easy';
  sel.dispatchEvent({ type: 'change', target: sel });
}

/** A plan with one planned run (18 km at 5:20–5:34 min/km, as plangen stores it). */
function planWithRun(extra = {}) {
  const unit = {
    id: 'u-run', planId: 'p1', eventId: 'e1', date: today, dow: 1, week: 3, phase: 'build', type: 'long',
    title: 'Langer Lauf 18 km', description: '', targetDistanceKm: 18, targetPaceSecPerKm: 320, targetPaceMaxSecPerKm: 334,
    status: 'geplant', ...extra,
  };
  store.replaceArea('events', [{ id: 'e1', name: 'Stadtlauf', date: addDays(today, 60), distanceKm: 21.0975, distanceType: 'HM', sport: 'run', status: 'geplant' }]);
  store.replaceArea('plans', [{ id: 'p1', eventId: 'e1', kind: 'race', startDate: addDays(today, -14), endDate: addDays(today, 60), weeks: 11, phases: [], commitments: [], units: [unit] }]);
  return unit;
}
const planUnit = () => store.get('plans')[0].units.find((u) => u.id === 'u-run');

/* ------------------------------- Helpers ---------------------------------- */
test('helpers: miles and pounds in, kilometres and kilograms out – an unchanged field keeps the stored value', () => {
  assert.equal(toInput(10, 'distance'), 6.21);
  assert.equal(fromInput('6.21', 'distance', 10), 10, 'unchanged: stored value');
  assert.equal(fromInput('6,2', 'distance', 10), 9.98, 'changed: converted, km to 0.01');
  assert.equal(fromInput('26.2', 'distance'), 42.16);
  assert.equal(fromInput('', 'distance'), null);
  assert.equal(toInput(72.4, 'weight'), 159.6);
  assert.equal(fromInput('159.6', 'weight', 72.4), 72.4);
  assert.equal(fromInput('160', 'weight'), 72.57, '160 lb is shown again as 160.0 lb');
  assert.equal(paceToInput(320), 515, '5:20/km = 8:35/mi');
  assert.equal(paceFromInput(515, 320), 320);
  assert.equal(paceFromInput(483), 300, '8:03/mi ≈ 5:00/km');
  assert.equal(heightFromInput('5', '11', 180), 180, '5′ 11″ unchanged keeps 180 cm');
  assert.equal(heightFromInput('5', '11'), 180);
  assert.equal(heightFromInput('5', '9', 180), 175);
  assert.equal(heightFromInput('6', '', null), 183);
  assert.equal(heightFromInput('', '', 180), null);
});

test('helpers in metric: the stored value in the field, the typed value stored', () => {
  setUnits(METRIC);
  assert.equal(toInput(10.0423, 'distance'), 10.0423);
  assert.equal(fromInput('10.0423', 'distance', 10.0423), 10.0423);
  assert.equal(fromInput('8,5', 'distance'), 8.5);
  assert.equal(toInput(72.4, 'weight'), 72.4);
  assert.equal(fromInput('70.25', 'weight'), 70.25);
  assert.equal(paceFromInput(330), 330);
});

/* -------------------------------- Sessions -------------------------------- */
test('log training: distance typed in miles is stored in km, editing without a change keeps it', () => {
  openActivity({ date: today });
  const dist = fieldInput('Distanz (mi)');
  assert.equal(dist.getAttribute('placeholder'), 'mi');
  assert.equal(dist.getAttribute('step'), '0.01');
  dist.value = '5';
  modal.querySelector('input[aria-label="Dauer in Minuten"]').value = '40';
  button(modal, 'Speichern').click();
  const s = store.get('sessions')[0];
  assert.equal(s.distanceKm, 8.05);
  assert.equal(s.paceSecPerKm, Math.round(2400 / 8.05));

  // A GPX distance with many decimals survives opening and saving.
  store.patch('sessions', s.id, { distanceKm: 10.0423 });
  openActivity({ existing: store.find('sessions', s.id) });
  assert.equal(String(fieldInput('Distanz (mi)').value), '6.24');
  button(modal, 'Speichern').click();
  assert.equal(store.find('sessions', s.id).distanceKm, 10.0423);
});

test('planned session: log it (planned distance kept), then correct the distance in miles', () => {
  planWithRun();
  session.render(view, 'u-run');
  button(view, 'Erledigt erfassen').click();
  assert.equal(String(fieldInput('Distanz (mi)').value), '11.18', 'planned 18 km shown in miles');
  button(modal, 'Speichern').click();
  let done = store.get('sessions').find((x) => x.plannedId === 'u-run');
  assert.equal(done.distanceKm, 18, 'unchanged field: exactly the planned 18 km');

  view.childNodes = [];
  session.render(view, 'u-run');
  headerAction('Bearbeiten').click();
  fieldInput('Distanz (mi)').value = '10';
  button(modal, 'Speichern').click();
  done = store.get('sessions').find((x) => x.plannedId === 'u-run');
  assert.equal(done.distanceKm, 16.09);
});

test('planned session editor: distance and target pace per mile; opening and saving changes nothing', () => {
  planWithRun();
  session.render(view, 'u-run');
  headerAction('Bearbeiten').click();
  const dist = fieldInput('Distanz (mi)');
  const pace = fieldInput('Zielpace (min/mi)');
  assert.equal(String(dist.value), '11.18');
  assert.equal(String(pace.value), '8:35');
  assert.equal(pace.getAttribute('placeholder'), 'min:sek, z. B. 8:51', 'example pace per mile');
  assert.match(String(fieldInput('Titel').value), /^Langer Lauf 11[,.]2 mi$/, 'the plan title in miles too');
  button(modal, 'Speichern').click();
  let u = planUnit();
  assert.deepEqual([u.targetDistanceKm, u.targetPaceSecPerKm, u.targetPaceMaxSecPerKm], [18, 320, 334], 'round trip without drift');
  assert.equal(u.title, 'Langer Lauf 18 km', 'an unchanged title keeps its stored text');

  session.render(view, 'u-run');
  headerAction('Bearbeiten').click();
  fieldInput('Distanz (mi)').value = '10';
  fieldInput('Zielpace (min/mi)').value = '8:00';
  fieldInput('Titel').value = 'Langer Lauf 10 mi';
  button(modal, 'Speichern').click();
  u = planUnit();
  assert.equal(u.title, 'Langer Lauf 10 mi', 'a changed title is stored as typed');
  assert.equal(u.targetDistanceKm, 16.09);
  assert.equal(u.targetPaceSecPerKm, 298, '8:00/mi ≈ 4:58/km');
  assert.equal(u.targetPaceMaxSecPerKm, 308);
});

test('new planned session: distance and pace typed in miles', () => {
  planWithRun();
  session.openUnitCreator(store.get('plans')[0], addDays(today, 2));
  fieldInput('Distanz (mi)').value = '6.21';
  fieldInput('Zielpace (min/mi)').value = '8:03';
  button(modal, 'Speichern').click();
  const u = store.get('plans')[0].units.find((x) => x.id !== 'u-run');
  assert.equal(u.targetDistanceKm, 9.99);
  assert.equal(u.targetPaceSecPerKm, 300);
});

/* ------------------------------ Workout mode ------------------------------ */
test('workout mode: sets typed in pounds are stored in kg (to 0.01 kg) and shown as typed', () => {
  const unit = { id: 'k1', date: today, type: 'strength', title: 'Kraft', exerciseIds: ['squat'], status: 'geplant' };
  store.upsert('plans', { id: 'p2', eventId: 'e2', units: [unit] });
  store.upsert('sessions', { id: 'alt', date: '2026-01-05', type: 'strength', strengthSets: [{ exerciseId: 'squat', sets: [{ reps: 12, kg: 30 }] }] });
  renderWorkout(view, 'k1');
  const kg = view.querySelectorAll('input').find((i) => (i.getAttribute('aria-label') || '').endsWith('Gewicht (lb)'));
  assert.ok(kg, 'weight field in pounds');
  assert.equal(kg.getAttribute('placeholder'), 'lb');
  assert.equal(String(kg.value), '66.1', 'last time 30 kg, shown in pounds');
  const reps = () => view.querySelectorAll('input').find((i) => /Wiederholungen$/.test(i.getAttribute('aria-label') || ''));
  const weight = () => view.querySelectorAll('input').find((i) => (i.getAttribute('aria-label') || '').endsWith('Gewicht (lb)'));
  reps().value = '10'; weight().value = '45';
  button(view, '+ Satz').click();
  reps().value = '10';                     // weight left as filled in from the first set
  button(view, '+ Satz').click();
  button(view, 'Training beenden').click();
  button(modal, 'Speichern & abschließen').click();
  const saved = store.get('sessions').find((x) => x.plannedId === 'k1');
  assert.deepEqual(saved.strengthSets, [{ exerciseId: 'squat', sets: [{ reps: 10, kg: 20.41 }, { reps: 10, kg: 20.41 }] }]);
  assert.equal(fmtSet(saved.strengthSets[0].sets[0]), '10 × 45 lb', 'no drift to 45.2 lb');
});

test('workout mode: finishing a run – planned distance kept, a typed one converted', () => {
  planWithRun({ targetDistanceKm: 8, type: 'easy', title: 'Lauf 8 km' });
  renderWorkout(view, 'u-run');
  button(view, 'Training beenden').click();
  assert.equal(String(fieldInput('Distanz (mi)').value), '4.97');
  button(modal, 'Speichern & abschließen').click();
  assert.equal(store.get('sessions').find((x) => x.plannedId === 'u-run').distanceKm, 8);

  store.replaceArea('sessions', []);
  planWithRun({ targetDistanceKm: 8, type: 'easy', title: 'Lauf 8 km' });
  renderWorkout(view, 'u-run');
  button(view, 'Training beenden').click();
  fieldInput('Distanz (mi)').value = '5.5';
  button(modal, 'Speichern & abschließen').click();
  assert.equal(store.get('sessions').find((x) => x.plannedId === 'u-run').distanceKm, 8.85);
});

/* --------------------------------- Races ---------------------------------- */
test('own race distance in miles: unchanged stays exactly, a new one is converted', () => {
  store.replaceArea('events', [{ id: 'e7', name: 'Ultra', date: addDays(today, 40), distanceKm: 50, distanceType: 'custom', sport: 'run', status: 'geplant', priority: 'A' }]);
  events.renderDetail(view, 'e7');
  headerAction('Bearbeiten').click();
  const km = fieldInput('Distanz (mi)');
  assert.equal(String(km.value), '31.07');
  assert.equal(km.getAttribute('placeholder'), 'mi');
  button(modal, 'Speichern').click();
  assert.equal(store.find('events', 'e7').distanceKm, 50, 'no drift – the plan is not reported as affected');

  events.renderDetail(view, 'e7');
  headerAction('Bearbeiten').click();
  fieldInput('Distanz (mi)').value = '31';
  button(modal, 'Speichern').click();
  assert.equal(store.find('events', 'e7').distanceKm, 49.89);
});

/* -------------------------------- Profile --------------------------------- */
test('profile: height in feet and inches, weights in pounds; opening and saving keeps cm and kg', () => {
  settings.render(view);
  view.querySelectorAll('button').find((b) => b.classList.contains('card--link') && b.textContent.includes('Alex')).click();
  const ft = modal.querySelector('input[aria-label="Größe (ft)"]');
  const inch = modal.querySelector('input[aria-label="Größe (in)"]');
  assert.ok(ft && inch, 'feet and inches fields');
  assert.deepEqual([String(ft.value), String(inch.value)], ['5', '11']);
  assert.ok(modal.querySelectorAll('.field__label').some((l) => l.textContent === 'Größe (ft/in)'));
  assert.equal(String(fieldInput('Gewicht (lb)').value), '176.4');
  assert.equal(String(fieldInput('Zielgewicht (lb)').value), '165.3');
  button(modal, 'Speichern').click();
  let p = store.profile();
  assert.deepEqual([p.heightCm, p.weightKg, p.targetWeightKg], [180, 80, 75], 'round trip without drift');
  assert.equal(p.targetWeightStartKg, undefined, 'unchanged target: its start is not reset');

  settings.render(view);
  view.querySelectorAll('button').find((b) => b.classList.contains('card--link') && b.textContent.includes('Alex')).click();
  modal.querySelector('input[aria-label="Größe (ft)"]').value = '5';
  modal.querySelector('input[aria-label="Größe (in)"]').value = '9';
  fieldInput('Gewicht (lb)').value = '170';
  fieldInput('Zielgewicht (lb)').value = '160';
  button(modal, 'Speichern').click();
  p = store.profile();
  assert.deepEqual([p.heightCm, p.weightKg, p.targetWeightKg], [175, 77.11, 72.57]);
});

test('weight goal typed in pounds is stored in kg', () => {
  settings.render(view);
  button(view, '+ Ziel').click();
  const opt = modal.querySelectorAll('option').find((o) => o.getAttribute('value') === 'weight');
  assert.equal(opt.textContent, 'Gewicht (lb)');
  assert.match(modal.textContent, /176,4\slb/, 'current weight in pounds');
  modal.querySelector('input[type="number"]').value = '160';
  button(modal, 'Anlegen').click();
  const goal = store.settings().healthGoals[0];
  assert.equal(goal.metric, 'weight');
  assert.equal(goal.target, 72.57);
});

/* ------------------------------- Body values ------------------------------ */
test('body values: weight, muscle and lean mass in pounds, other units as they are', () => {
  store.upsert('health', { id: 'h1', date: today, weight: 80, bodyFat: 18.5, leanMass: 62 });
  openHealthEntry();
  assert.equal(String(fieldInput('Gewicht (lb)').value), '176.4');
  assert.equal(String(fieldInput('Fettfreie Masse (lb)').value), '136.7');
  assert.equal(String(fieldInput('Körperfett (%)').value), '18.5');
  fieldInput('Muskelmasse (lb)').value = '70';
  button(modal, 'Speichern').click();
  const h = store.get('health').find((x) => x.id === 'h1');
  assert.equal(h.weight, 80, 'unchanged: kept');
  assert.equal(h.leanMass, 62, 'unchanged: kept');
  assert.equal(h.bodyFat, 18.5);
  assert.equal(h.muscleMass, 31.75, '70 lb');
});

/* --------------------------------- Metric --------------------------------- */
test('metric unchanged: km, kg, cm and min/km as before', () => {
  setUnits(METRIC);
  openActivity({ date: today });
  const dist = fieldInput('Distanz (km)');
  assert.equal(dist.getAttribute('placeholder'), 'km');
  assert.equal(dist.getAttribute('step'), '0.1');
  dist.value = '8.5';
  modal.querySelector('input[aria-label="Dauer in Minuten"]').value = '45';
  button(modal, 'Speichern').click();
  assert.equal(store.get('sessions')[0].distanceKm, 8.5);

  planWithRun();
  session.render(view, 'u-run');
  headerAction('Bearbeiten').click();
  assert.equal(String(fieldInput('Distanz (km)').value), '18');
  assert.equal(String(fieldInput('Zielpace (min/km)').value), '5:20');
  fieldInput('Zielpace (min/km)').value = '5:00';
  button(modal, 'Speichern').click();
  assert.deepEqual([planUnit().targetDistanceKm, planUnit().targetPaceSecPerKm, planUnit().targetPaceMaxSecPerKm], [18, 300, 310]);

  settings.render(view);
  view.querySelectorAll('button').find((b) => b.classList.contains('card--link') && b.textContent.includes('Alex')).click();
  assert.equal(String(fieldInput('Größe (cm)').value), '180');
  assert.equal(String(fieldInput('Gewicht (kg)').value), '80');
  fieldInput('Größe (cm)').value = '172';
  fieldInput('Gewicht (kg)').value = '70.5';
  button(modal, 'Speichern').click();
  assert.deepEqual([store.profile().heightCm, store.profile().weightKg, store.profile().targetWeightKg], [172, 70.5, 75]);

  openHealthEntry();
  fieldInput('Gewicht (kg)').value = '70.4';
  button(modal, 'Speichern').click();
  assert.equal(store.get('health').find((x) => x.date === today).weight, 70.4);
});
