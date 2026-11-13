/* Cycle at its edges (4.2): the lab page asks about a missed bleed exactly when the cycle page
   and "Today" do (not under hormonal contraception, not with the module off); between two real
   period starts no forecast puts a period afterwards; a skipped session on a period day pauses
   the weekly streak instead of breaking it. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr, addDays } from '../js/ui.js';
import * as labsView from '../js/labs-view.js';
import { cyclePhase, isProtectedDay } from '../js/cycle.js';
import { adherence } from '../js/fitness.js';
import { weekStreak, momentum } from '../js/badges.js';

const doc = globalThis.document;
const ADULT_GATE = { chronicCondition: false, medication: false, pregnancy: false, eatingDisorder: false };
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

beforeEach(() => {
  ['sessions', 'plans', 'health', 'events', 'diary', 'cycle', 'labs', 'supplements'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', { cycle: true });
  store.setSetting('cycleHormonal', false);
  store.setSetting('labsGate', ADULT_GATE);
  store.setProfile({ name: 'Test', heightCm: 170, weightKg: 60, birthYear: 1990, sex: 'w' });
});

test('labs: no missed-period alarm under hormonal contraception or with the cycle module off', () => {
  store.replaceArea('cycle', [{ id: 'c1', startDate: addDays(todayStr(), -120), periodLength: 5 }]);
  const labsText = () => { const v = setupShell(); labsView.render(v); return v.textContent; };
  assert.match(labsText(), /keine Periode erfasst/, 'without contraception the long gap is a red flag');

  store.setSetting('cycleHormonal', true);
  assert.doesNotMatch(labsText(), /keine Periode erfasst/, 'the cycle page does not ask under hormonal contraception');

  store.setSetting('cycleHormonal', false);
  store.setSetting('modules', { cycle: false });
  assert.doesNotMatch(labsText(), /keine Periode erfasst/, 'module off: no cycle signal anywhere');
});

test('cycle: between two real starts no forecast period afterwards', () => {
  // 28, 28, 45 days -> average 34; the forecast from 27.07. would have been 30.08.
  store.replaceArea('cycle', ['2026-06-01', '2026-06-29', '2026-07-27', '2026-09-10']
    .map((d, i) => ({ id: `c${i}`, startDate: d, periodLength: 5 })));
  for (let d = '2026-08-30'; d <= '2026-09-09'; d = addDays(d, 1)) {
    assert.equal(isProtectedDay(d), false, d);
    assert.notEqual(cyclePhase(d).phase, 'menstruation', d);
    assert.equal(cyclePhase(d).predicted, false, d);
  }
  // The known 45-day cycle: ovulation ~14 days before the next start, luteal phase after it.
  assert.equal(cyclePhase('2026-08-27').phase, 'ovulation');
  assert.equal(cyclePhase('2026-09-05').phase, 'luteal');
  assert.equal(isProtectedDay('2026-09-10'), true, 'the real entry protects');
  // Missed sessions on the days the forecast used to cover count again.
  const units = ['2026-08-31', '2026-09-02', '2026-09-04'].map((date, i) => ({ id: `u${i}`, date, type: 'easy', status: 'verpasst' }));
  assert.equal(adherence([{ id: 'p', units }], { today: '2026-09-20', isProtectedDay }).due, 3);
  // After the last entry the forecast still works (within ~3 months).
  assert.equal(isProtectedDay('2026-10-14'), true);
  assert.equal(cyclePhase('2026-10-14').predicted, true);
  // Before the first entry nothing is known.
  assert.equal(cyclePhase('2026-05-20'), null);
  assert.equal(isProtectedDay('2026-05-04'), false);
});

test('cycle: a gap of more than 90 days between two entries gets no forecast period', () => {
  store.replaceArea('cycle', ['2026-01-01', '2026-01-29', '2026-06-01']
    .map((d, i) => ({ id: `c${i}`, startDate: d, periodLength: 5 })));
  assert.equal(isProtectedDay('2026-02-26'), false, 'no period was entered between 29.01. and 01.06.');
  assert.equal(cyclePhase('2026-04-15'), null, 'no phases deep inside the gap');
});

test('weekly streak: a session skipped on a period day pauses the streak like an illness', () => {
  const MON = '2026-10-19';
  const today = addDays(MON, 9); // Wednesday of the following week
  const sessions = [], units = [];
  // Six weeks Mon/Wed/Fri before, then the period week with Mon + Wed skipped.
  for (let w = 6; w >= 1; w--) {
    for (const d of [0, 2, 4]) {
      const date = addDays(MON, -7 * w + d);
      sessions.push({ id: `s${date}`, date, type: 'easy', durationSec: 2400 });
      units.push({ id: `u${date}`, date, type: 'easy', status: 'erledigt', sessionId: `s${date}` });
    }
  }
  units.push({ id: 'm1', date: MON, type: 'easy', status: 'verpasst' });
  units.push({ id: 'm2', date: addDays(MON, 2), type: 'easy', status: 'verpasst' });
  sessions.push({ id: 'sf', date: addDays(MON, 4), type: 'easy', durationSec: 2400 });
  units.push({ id: 'm3', date: addDays(MON, 4), type: 'easy', status: 'erledigt', sessionId: 'sf' });
  const plans = [{ id: 'p', units }];
  const period = (d) => d >= MON && d <= addDays(MON, 4);

  assert.equal(weekStreak({ sessions, plans }, today), 0, 'without the cycle rule the week breaks the streak');
  assert.equal(weekStreak({ sessions, plans, isProtectedDay: period }, today), 6, 'paused, not broken');
  // Momentum: nothing missed, and the streak share stays (it used to drop with the streak).
  const m = momentum({ sessions, plans, isProtectedDay: period }, today);
  assert.equal(m.missed, 0);
  assert.equal(m.streak, 6);
  // A session moved away from a period day into the next week pauses the same way.
  const moved = units.map((u) => (['m1', 'm2'].includes(u.id) ? { ...u, date: addDays(u.date, 7), movedFrom: u.date, status: 'geplant' } : u));
  assert.equal(weekStreak({ sessions, plans: [{ id: 'p', units: moved }] }, today), 0);
  assert.equal(weekStreak({ sessions, plans: [{ id: 'p', units: moved }], isProtectedDay: period }, today), 6);
});
