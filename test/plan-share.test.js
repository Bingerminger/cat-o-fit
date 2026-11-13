/* Sharing a plan (4.2): one self-contained HTML document, week by week, in the person's language and
   units, everything escaped; offered in the plan's "…" menu. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { planDocument, planWeeks, planFileName, unitTargetText } from '../js/plan-share.js';
import { setUnits, METRIC } from '../js/units.js';

beforeEach(() => setUnits(METRIC));

const plan = {
  id: 'p', eventId: 'e', name: 'Halbmarathon <Dresden>', startDate: '2026-11-16', endDate: '2026-11-29',
  phases: [{ key: 'base', name: 'Grundlage', startWeek: 1, endWeek: 2 }],
  units: [
    { id: 'a', week: 1, date: '2026-11-18', type: 'easy', title: 'Lockerer Lauf 8 km', description: 'ruhig & locker', targetDistanceKm: 8, targetPaceSecPerKm: 360, targetHrZone: 2 },
    { id: 'b', week: 1, date: '2026-11-17', type: 'strength', title: 'Kraft', targetDurationMin: 30 },
    { id: 'r', week: 1, date: '2026-11-19', type: 'rest', title: 'Ruhetag' },
    { id: 'c', week: 2, date: '2026-11-24', type: 'tempo', title: '<script>x</script>', deleted: true },
    { id: 'd', week: 2, date: '2026-11-26', type: 'long', title: 'Langer Lauf', targetDistanceKm: 16 },
  ],
};

test('weeks in order, by date, without rest days and deleted sessions', () => {
  const w = planWeeks(plan);
  assert.deepEqual(w.map((x) => [x.week, x.units.map((u) => u.id)]), [[1, ['b', 'a']], [2, ['d']]]);
  assert.equal(w[0].phase.name, 'Grundlage');
});

test('the document: self-contained, escaped, with targets in the person\'s units', () => {
  const html = planDocument(plan, plan.name);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="de">/);
  assert.match(html, /Halbmarathon &lt;Dresden&gt;/);
  assert.doesNotMatch(html, /<script|<link|src=/, 'no scripts, no external resources');
  assert.match(html, /Woche 1 · Grundlage/);
  assert.match(html, /ruhig &amp; locker/);
  assert.match(html, /8 km · 6:00\/km · HF-Zone 2/);
  assert.match(html, /30 min/);
  setUnits({ ...METRIC, distance: 'mi' });
  assert.match(unitTargetText(plan.units[4]), /9,9\s?mi/);
  assert.equal(planFileName('Halbmarathon Dresden 2027!'), 'Halbmarathon-Dresden-2027.html');
});

test('offered in the plan menu', async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Test', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  store.upsert('events', { id: 'e', name: 'HM', date: '2027-04-01', distanceKm: 21.1 });
  store.upsert('plans', { ...plan, units: plan.units.slice(0, 2) });
  const doc = globalThis.document;
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'modal-root']) { const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e); }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  const { render } = await import('../js/plans.js');
  render(view, 'e');
  doc.getElementById('header-actions').querySelectorAll('button').find((b) => /Mehr|Weitere/.test(b.getAttribute('aria-label') || b.textContent)).click();
  assert.match(doc.getElementById('modal-root').textContent, /Plan teilen \(Datei\/PDF\)/);
});
