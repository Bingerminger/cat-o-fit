/* "Export to calendar" window (3.21.3): the subscription link exists only with a
   calendar key, the instructions for it open the help article, and the hint no longer names an
   own (outdated) iOS route – the steps per calendar are maintained only in the help. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { openIcsSheet } from '../js/ics-export.js';

const realFetch = globalThis.fetch;
const wait = async (cond, ms = 2000) => { for (let t = 0; t < ms && !cond(); t += 10) await new Promise((r) => setTimeout(r, 10)); };
const EVENT = { id: 'e1', name: 'Stadtlauf', date: '2026-10-11' };
let root;

beforeEach(async () => {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [{ id: 'u-1', name: 'Alex', role: 'admin' }], settings: {}, pantry: [] });
  await store.login('u-1', '');
  const doc = globalThis.document;
  doc.body.childNodes = [];
  root = doc.createElement('div'); root.setAttribute('id', 'modal-root'); doc.body.appendChild(root);
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions', 'view', 'toast-root']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Server that hands out the calendar key – or refuses. */
const serveToken = (ok) => {
  globalThis.fetch = async (url) => ({
    ok, status: ok ? 200 : 403,
    json: async () => (String(url).includes('action=ics-token')
      ? (ok ? { ok: true, token: 'a'.repeat(48) } : { ok: false, code: 'admin', error: 'Nur Admin.' })
      : { ok: true }),
  });
};

test('without a calendar key: only the files, no subscription link and no subscription instructions', async () => {
  serveToken(false);
  await openIcsSheet({ event: EVENT });
  assert.match(root.textContent, /In Kalender exportieren/);
  assert.match(root.textContent, /Kompletter Plan/);
  assert.doesNotMatch(root.textContent, /Abo-Link kopieren/);
  assert.doesNotMatch(root.textContent, /So richtest du das Abo ein/);
});

test('with a calendar key: subscription link, instructions from the help, no outdated iOS route in the hint', async () => {
  serveToken(true);
  await openIcsSheet({ event: EVENT });
  assert.match(root.textContent, /Abo-Link kopieren/);
  assert.match(root.textContent, /Als Abo bleibt der Plan von selbst aktuell/);
  assert.doesNotMatch(root.textContent, /Accounts → Account hinzufügen/, 'only the help names menu paths');
  root.querySelectorAll('button').find((b) => b.textContent.includes('So richtest du das Abo ein')).click();
  await wait(() => /Den Plan im Kalender abonnieren/.test(root.textContent));
  assert.match(root.textContent, /Den Plan im Kalender abonnieren/, 'the instructions open the help article');
  assert.match(root.textContent, /Vom Web abonnieren/);
  assert.match(root.textContent, /Kalenderabonnement hinzufügen/);
});
