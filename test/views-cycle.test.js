/* Cycle (TRAIN-30, HEALTH-32, TRAIN-38): easing on day 1 only on request,
   neutral phase tips, setting "hormonal contraception", no phases and no
   prediction any more after ~3 months without an entry. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { todayStr, addDays } from '../js/ui.js';
import * as cycle from '../js/cycle.js';
import { cyclePhase, isProtectedDay, nextPredictedStart, periodState, phaseTip, PREDICTION_MAX_AGE_DAYS } from '../js/cycle.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}
function all(node, out = []) { (node.childNodes || []).forEach((c) => { out.push(c); all(c, out); }); return out; }
function button(root, re) { return all(root).find((n) => n.tagName === 'BUTTON' && re.test(n.textContent || '')); }
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ['plans', 'cycle', 'sessions'].forEach((a) => store.replaceArea(a, []));
  store.setSetting('modules', { cycle: true });
  store.setSetting('cycleHormonal', false);
});

test('TRAIN-30: entering the start of a period eases nothing automatically – only the answer decides', async () => {
  const today = todayStr();
  store.upsert('plans', { id: 'p1', eventId: 'e1', units: [{ id: 'l', date: today, type: 'long', title: 'Long Run', status: 'geplant', targetDistanceKm: 16 }] });
  const view = setupShell();
  cycle.render(view);
  button(view, /Periodenbeginn eintragen/).click();
  const root = doc.getElementById('modal-root');
  button(root, /^Speichern$/).click();
  await tick();
  assert.equal(store.get('cycle').filter((c) => c.startDate === today).length, 1, 'entry saved');
  assert.equal(store.find('plans', 'p1').units[0].type, 'long', 'nothing eased yet');
  assert.match(root.textContent, /Wie geht es dir\?/);
  assert.match(root.textContent, /beides ist okay/);
  button(root, /Wie geplant/).click();
  await tick();
  assert.equal(store.find('plans', 'p1').units[0].type, 'long', '"As planned" leaves the unit in place');

  // Second run: "Make it easier" eases – only on explicit request.
  store.replaceArea('cycle', []);
  const v2 = setupShell();
  cycle.render(v2);
  button(v2, /Periodenbeginn eintragen/).click();
  button(doc.getElementById('modal-root'), /^Speichern$/).click();
  await tick();
  button(doc.getElementById('modal-root'), /Lockerer machen/).click();
  await tick();
  const u = store.find('plans', 'p1').units[0];
  assert.equal(u.type, 'recovery');
  assert.equal(u.cycleEased, true);
});

test('TRAIN-30/HEALTH-32: phase tips without performance promises', () => {
  const tips = ['menstruation', 'follikel', 'ovulation', 'luteal'].map(phaseTip).join(' ');
  assert.doesNotMatch(tips, /Leistungshoch|ideal für Tempo|gute Zeit für intensivere/);
  assert.match(tips, /Befinden|Gefühl/);
});

test('HEALTH-32: hormonal contraception hides the phases and keeps the bleeding days', () => {
  const start = addDays(todayStr(), -10);
  store.replaceArea('cycle', [{ id: 'a', startDate: addDays(start, -28), periodLength: 5 }, { id: 'b', startDate: start, periodLength: 5 }]);
  assert.equal(cyclePhase(addDays(start, 13)).phase, 'ovulation', 'positive control without contraception');
  store.setSetting('cycleHormonal', true);
  assert.equal(cyclePhase(start).phase, 'menstruation');
  assert.equal(isProtectedDay(start), true, 'bleeding days stay protected');
  assert.equal(cyclePhase(addDays(start, 13)).phase, 'neutral');
  const view = setupShell();
  cycle.render(view);
  assert.doesNotMatch(view.textContent, /Follikelphase|Lutealphase|Ovulation/);
  assert.match(view.textContent, /Hormonelle Verhütung/);
  // Missing bleeding under contraception: no warning sign, no follow-up question.
  store.replaceArea('cycle', [{ id: 'c', startDate: addDays(todayStr(), -60), periodLength: 5 }]);
  const ps = periodState(todayStr());
  assert.equal(ps.state, 'contraception');
  assert.equal(ps.flag, false);
});

test('TRAIN-38: after ~3 months without an entry no phases, no prediction – "forecast paused"', () => {
  const last = addDays(todayStr(), -(PREDICTION_MAX_AGE_DAYS + 8));
  store.replaceArea('cycle', [{ id: 'a', startDate: addDays(last, -28), periodLength: 5 }, { id: 'b', startDate: last, periodLength: 5 }]);
  assert.equal(cyclePhase(todayStr()), null);
  assert.equal(nextPredictedStart(todayStr()), null);
  const view = setupShell();
  cycle.render(view);
  assert.match(view.textContent, /Prognose pausiert/);
  assert.doesNotMatch(view.textContent, /Nächste Periode in/);
  // Positive control: fresh entry → prediction present.
  store.replaceArea('cycle', [{ id: 'c', startDate: addDays(todayStr(), -20), periodLength: 5 }]);
  assert.ok(nextPredictedStart(todayStr()));
});
