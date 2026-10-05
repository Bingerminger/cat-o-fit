/* Test for the pure login logic (js/session-gate.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_PATH, isPublicPath, gate, menusVisible, needsSetup } from '../js/session-gate.js';

test('LOGIN_PATH is the login page', () => {
  assert.equal(LOGIN_PATH, '/login');
});

test('isPublicPath: only the login page is public', () => {
  assert.equal(isPublicPath('/login'), true);
  assert.equal(isPublicPath('/'), false);
  assert.equal(isPublicPath('/family'), false);
  assert.equal(isPublicPath('/settings'), false);
});

test('gate: when logged out, only the login page is allowed', () => {
  assert.deepEqual(gate(null, '/login'), { allow: true });
  assert.deepEqual(gate(null, '/'), { allow: false, redirect: '#/login' });
  assert.deepEqual(gate(null, '/family'), { allow: false, redirect: '#/login' });
  assert.deepEqual(gate('', '/stats'), { allow: false, redirect: '#/login' });
});

test('gate: when logged in, anywhere is allowed – except the login page', () => {
  assert.deepEqual(gate('u-1', '/'), { allow: true });
  assert.deepEqual(gate('u-1', '/family'), { allow: true });
  assert.deepEqual(gate('u-1', '/settings'), { allow: true });
  // logged in on /login -> back to the dashboard
  assert.deepEqual(gate('u-1', '/login'), { allow: false, redirect: '#/' });
});

test('menusVisible: only when logged in', () => {
  assert.equal(menusVisible('u-1'), true);
  assert.equal(menusVisible(null), false);
  assert.equal(menusVisible(''), false);
  assert.equal(menusVisible(undefined), false);
});

test('needsSetup: an empty family needs the first-time setup', () => {
  assert.equal(needsSetup(0), true);
  assert.equal(needsSetup(undefined), true);
  assert.equal(needsSetup(1), false);
  assert.equal(needsSetup(3), false);
});

test('FE-25: return target after login – internal routes only, never the login itself', async () => {
  const { safeReturnTo } = await import('../js/session-gate.js');
  assert.equal(safeReturnTo('#/session/u-abc_1'), '#/session/u-abc_1');
  assert.equal(safeReturnTo('#/event/e1'), '#/event/e1');
  assert.equal(safeReturnTo('#/login'), null);
  assert.equal(safeReturnTo('#/'), null);
  assert.equal(safeReturnTo('https://example.org/#/x'), null);
  assert.equal(safeReturnTo('#/x" onmouseover="y'), null);
  assert.equal(safeReturnTo(null), null);
});
