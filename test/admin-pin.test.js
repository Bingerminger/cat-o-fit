/* An admin without a PIN has a member's rights on the server until they set one (4.2): "Today" says
   so instead of the general PIN reminder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import * as dashboard from '../js/dashboard.js';
import { scopeKey } from '../js/ui.js';

const doc = globalThis.document;
function setupShell() {
  doc.body.childNodes = [];
  for (const id of ['header-title', 'header-subtitle', 'header-back', 'header-actions']) {
    const e = doc.createElement('div'); e.setAttribute('id', id); doc.body.appendChild(e);
  }
  const view = doc.createElement('div'); view.setAttribute('id', 'view'); doc.body.appendChild(view);
  return view;
}

async function todayFor(member) {
  localStorage.clear();
  store.clearActiveUser();
  store.saveFamily({ members: [member, { id: 'u-2', name: 'Kim', role: 'user' }], settings: {}, pantry: [] });
  await store.login(member.id, '');
  sessionStorage.setItem(scopeKey('weakPin'), member.id);   // what the server answers for an empty PIN
  const view = setupShell();
  dashboard.render(view);
  return view.textContent;
}

test('"Today": an admin without a PIN learns that the admin rights wait for the PIN', async () => {
  const admin = await todayFor({ id: 'u-1', name: 'Alex', role: 'admin', hasPin: false });
  assert.match(admin, /Admin-Rechte gelten erst/);
  const member = await todayFor({ id: 'u-3', name: 'Robin', role: 'user', hasPin: false });
  assert.doesNotMatch(member, /Admin-Rechte/);
  assert.match(member, /Standard-PIN 0000/);
});
