/* =========================================================================
   env.test.js — environment isolation & encapsulated LocalStorage access.
   Covers the central storage wrapper since v3.12.1: scopeKey (namespace per
   deployment) + the wrappers lsGet/lsSet/lsRemove, which enforce the namespace.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NS, scopeKey, lsGet, lsSet, lsRemove } from '../js/env.js';

test('scopeKey: builds catofit:<APP_NS>:<name>', () => {
  const k = scopeKey('foo');
  assert.ok(k.startsWith('catofit:'), 'starts with catofit:');
  assert.ok(k.includes(APP_NS), 'contains the environment namespace');
  assert.ok(k.endsWith(':foo'), 'ends with the name');
  assert.equal(k, `catofit:${APP_NS}:foo`);
});

test('scopeKey: different names -> different keys, same namespace', () => {
  assert.notEqual(scopeKey('a'), scopeKey('b'));
  assert.equal(scopeKey('a').replace(/:a$/, ''), scopeKey('b').replace(/:b$/, ''));
});

test('lsSet/lsGet: round trip lives under the scoped key (no flat key)', () => {
  lsSet('weather', 'sonnig');
  assert.equal(lsGet('weather'), 'sonnig', 'lsGet reads back what lsSet wrote');
  assert.equal(localStorage.getItem(scopeKey('weather')), 'sonnig', 'physically under the namespaced key');
  assert.equal(localStorage.getItem('weather'), null, 'no flat, un-namespaced key');
});

test('lsGet: missing key returns null', () => {
  assert.equal(lsGet('gibt-es-nicht'), null);
});

test('lsRemove: removes exactly the scoped key', () => {
  lsSet('tmpkey', 'x');
  assert.equal(lsGet('tmpkey'), 'x');
  lsRemove('tmpkey');
  assert.equal(lsGet('tmpkey'), null);
  assert.equal(localStorage.getItem(scopeKey('tmpkey')), null);
});

test('lsSet: overwrites an existing value', () => {
  lsSet('ov', 'alt');
  lsSet('ov', 'neu');
  assert.equal(lsGet('ov'), 'neu');
});
