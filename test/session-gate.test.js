/* Test für die reine Anmelde-Logik (js/session-gate.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_PATH, isPublicPath, gate, menusVisible, needsSetup } from '../js/session-gate.js';

test('LOGIN_PATH ist die Login-Seite', () => {
  assert.equal(LOGIN_PATH, '/login');
});

test('isPublicPath: nur die Login-Seite ist öffentlich', () => {
  assert.equal(isPublicPath('/login'), true);
  assert.equal(isPublicPath('/'), false);
  assert.equal(isPublicPath('/family'), false);
  assert.equal(isPublicPath('/settings'), false);
});

test('gate: abgemeldet darf nur auf die Login-Seite', () => {
  assert.deepEqual(gate(null, '/login'), { allow: true });
  assert.deepEqual(gate(null, '/'), { allow: false, redirect: '#/login' });
  assert.deepEqual(gate(null, '/family'), { allow: false, redirect: '#/login' });
  assert.deepEqual(gate('', '/stats'), { allow: false, redirect: '#/login' });
});

test('gate: angemeldet darf überallhin – außer auf die Login-Seite', () => {
  assert.deepEqual(gate('u-1', '/'), { allow: true });
  assert.deepEqual(gate('u-1', '/family'), { allow: true });
  assert.deepEqual(gate('u-1', '/settings'), { allow: true });
  // angemeldet auf /login -> zurück ins Dashboard
  assert.deepEqual(gate('u-1', '/login'), { allow: false, redirect: '#/' });
});

test('menusVisible: nur angemeldet', () => {
  assert.equal(menusVisible('u-1'), true);
  assert.equal(menusVisible(null), false);
  assert.equal(menusVisible(''), false);
  assert.equal(menusVisible(undefined), false);
});

test('needsSetup: leere Familie braucht die Ersteinrichtung', () => {
  assert.equal(needsSetup(0), true);
  assert.equal(needsSetup(undefined), true);
  assert.equal(needsSetup(1), false);
  assert.equal(needsSetup(3), false);
});
