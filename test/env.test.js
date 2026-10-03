/* =========================================================================
   env.test.js — Umgebungs-Isolation & gekapselter LocalStorage-Zugriff.
   Deckt die seit v3.12.1 zentrale Storage-Kapsel ab: scopeKey (Namespace pro
   Deployment) + die Wrapper lsGet/lsSet/lsRemove, die den Namespace erzwingen.
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NS, scopeKey, lsGet, lsSet, lsRemove } from '../js/env.js';

test('scopeKey: baut catofit:<APP_NS>:<name>', () => {
  const k = scopeKey('foo');
  assert.ok(k.startsWith('catofit:'), 'beginnt mit catofit:');
  assert.ok(k.includes(APP_NS), 'enthält den Umgebungs-Namespace');
  assert.ok(k.endsWith(':foo'), 'endet mit dem Namen');
  assert.equal(k, `catofit:${APP_NS}:foo`);
});

test('scopeKey: verschiedene Namen -> verschiedene Keys, gleicher Namespace', () => {
  assert.notEqual(scopeKey('a'), scopeKey('b'));
  assert.equal(scopeKey('a').replace(/:a$/, ''), scopeKey('b').replace(/:b$/, ''));
});

test('lsSet/lsGet: Roundtrip liegt unter dem gescopten Key (kein flacher Key)', () => {
  lsSet('weather', 'sonnig');
  assert.equal(lsGet('weather'), 'sonnig', 'lsGet liest zurück, was lsSet schrieb');
  assert.equal(localStorage.getItem(scopeKey('weather')), 'sonnig', 'physisch unter dem namespaced Key');
  assert.equal(localStorage.getItem('weather'), null, 'kein flacher, un-namespaced Key');
});

test('lsGet: fehlender Key liefert null', () => {
  assert.equal(lsGet('gibt-es-nicht'), null);
});

test('lsRemove: entfernt genau den gescopten Key', () => {
  lsSet('tmpkey', 'x');
  assert.equal(lsGet('tmpkey'), 'x');
  lsRemove('tmpkey');
  assert.equal(lsGet('tmpkey'), null);
  assert.equal(localStorage.getItem(scopeKey('tmpkey')), null);
});

test('lsSet: überschreibt vorhandenen Wert', () => {
  lsSet('ov', 'alt');
  lsSet('ov', 'neu');
  assert.equal(lsGet('ov'), 'neu');
});
