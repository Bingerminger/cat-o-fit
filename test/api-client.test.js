/* =========================================================================
   api-client.test.js — HTTP client for the PHP API (server-authoritative sync).
   Checks URL/scope construction, op-based push/pull and the parsing/error
   logic against a controlled fetch mock (no real server).
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pullChanges, pullAllChanges, pushOps, apiGet, ping, icsUrl, isOnline, serverHas, serverError } from '../js/api-client.js';

// Controllable fetch mock: remembers the last call, returns a scripted response.
let lastCall = null;
let nextResponse = null;
globalThis.fetch = async (url, opts = {}) => {
  lastCall = { url: String(url), opts };
  return nextResponse || { ok: true, status: 200, json: async () => ({ ok: true, rev: 0, records: [], data: null }) };
};
/** Set the next server response. httpOk=false simulates an HTTP error status. */
function respond(json, { httpOk = true, status = 200 } = {}) {
  nextResponse = { ok: httpOk, status, json: async () => json };
}

test('icsUrl: download URL with and without user scope', () => {
  const withUser = icsUrl('user', 'ev1', 'u-1');
  assert.ok(withUser.includes('action=ics'), 'action=ics');
  assert.ok(withUser.includes('scope=user') && withUser.includes('id=ev1'));
  assert.ok(withUser.includes('user=u-1'), 'user param set');
  const noUser = icsUrl('family', 'ev2');
  assert.ok(noUser.includes('scope=family') && noUser.includes('id=ev2'));
  assert.ok(!noUser.includes('user='), 'no user param without user');
});

test('pullChanges: GET action=changes&since, returns {rev, records}', async () => {
  respond({ ok: true, rev: 7, records: [{ id: 'a', rev: 7 }] });
  const out = await pullChanges('events', { user: 'u-1', since: 3 });
  assert.equal(lastCall.opts.method, 'GET');
  assert.ok(lastCall.url.includes('area=events'));
  assert.ok(lastCall.url.includes('action=changes'));
  assert.ok(lastCall.url.includes('since=3'));
  assert.ok(lastCall.url.includes('user=u-1'));
  assert.deepEqual(out, { rev: 7, records: [{ id: 'a', rev: 7 }] });
});

test('pullChanges: since missing -> since=0', async () => {
  respond({ ok: true, rev: 1, records: [] });
  await pullChanges('plans', { user: 'u-1' });
  assert.ok(lastCall.url.includes('since=0'));
});

test('pushOps: POST action=ops with body {ops}, returns {rev, records}', async () => {
  respond({ ok: true, rev: 9, records: [{ id: 'x', rev: 9 }] });
  const ops = [{ op: 'upsert', record: { id: 'x' } }];
  const out = await pushOps('sessions', ops, { user: 'u-1' });
  assert.equal(lastCall.opts.method, 'POST');
  assert.ok(lastCall.url.includes('action=ops'));
  assert.deepEqual(JSON.parse(lastCall.opts.body), { ops });
  assert.deepEqual(out, { rev: 9, records: [{ id: 'x', rev: 9 }], rejected: [], changes: null });
});

test('pushOps: scope=family -> &scope=family instead of user', async () => {
  respond({ ok: true, rev: 2, records: [] });
  await pushOps('family', [], { scope: 'family', user: 'u-1' });
  assert.ok(lastCall.url.includes('scope=family'));
  assert.ok(!lastCall.url.includes('user='), 'family scope overrides user');
});

test('apiGet: returns json.data', async () => {
  respond({ ok: true, data: [{ id: 1 }, { id: 2 }] });
  assert.deepEqual(await apiGet('health', { user: 'u-1' }), [{ id: 1 }, { id: 2 }]);
});

test('pullChanges: server error (ok:false) throws with the server message', async () => {
  respond({ ok: false, error: 'kaputt' });
  await assert.rejects(() => pullChanges('events', { user: 'u-1', since: 0 }), /kaputt/);
});

test('Server errors: the code is translated (placeholders from the response), otherwise the server text applies', async () => {
  respond({ ok: false, error: 'Unknown area: x', code: 'unknown_area', area: 'x' });
  await assert.rejects(() => pullChanges('events', { user: 'u-1', since: 0 }), { message: 'Unbekannter Bereich: x' });
  assert.equal(serverError({ ok: false, error: 'Invalid user ID.', code: 'invalid_user' }), 'Ungültige Nutzer-ID.');
  assert.equal(serverError({ ok: false, error: 'GET expected.', code: 'method_not_allowed', action: 'changes', expected: 'GET' }), 'changes erwartet GET.');
  assert.equal(serverError({ ok: false, error: 'Something new', code: 'brand_new_code' }), 'Something new', 'unknown code → server text');
  assert.equal(serverError({ ok: false }, 'Laden fehlgeschlagen'), 'Laden fehlgeschlagen', 'without code and text → fallback');
});

test('ping: true on ok, false on HTTP error', async () => {
  respond({ ok: true });
  assert.equal(await ping(), true);
  respond({}, { httpOk: false, status: 500 }); // request throws -> ping catches it (retries:0) -> false
  assert.equal(await ping(), false);
});

test('pushOps: 413 (too many ops) is not retried and carries the status', async () => {
  const mock = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => { calls++; return mock(url, opts); };
  try {
    respond({ ok: false, error: 'zu viele Ops' }, { httpOk: false, status: 413 });
    const t0 = Date.now();
    await assert.rejects(() => pushOps('health', [{ op: 'upsert', record: { id: 'x' } }], { user: 'u-1' }), (e) => e.status === 413);
    assert.equal(calls, 1, 'final error: exactly one attempt');
    assert.ok(Date.now() - t0 < 300, 'no waiting for retries');
  } finally { globalThis.fetch = mock; nextResponse = null; }
});

test('isOnline: returns a boolean', () => {
  assert.equal(typeof isOnline(), 'boolean');
});

test('FE-26: pushOps with since – body {ops, since}, changes since the mark come along', async () => {
  respond({ ok: true, rev: 12, records: [{ id: 'x', rev: 12 }], changes: { rev: 12, records: [{ id: 'f', rev: 11 }, { id: 'x', rev: 12 }] } });
  const ops = [{ op: 'upsert', record: { id: 'x' } }];
  const out = await pushOps('sessions', ops, { user: 'u-1', since: 10 });
  assert.deepEqual(JSON.parse(lastCall.opts.body), { ops, since: 10 });
  assert.ok(!lastCall.url.includes('since='), 'since belongs in the body, not in the address');
  assert.deepEqual(out.changes, { rev: 12, records: [{ id: 'f', rev: 11 }, { id: 'x', rev: 12 }] });
});

test('FE-26: bulk pull – one request with all marks, response per area', async () => {
  respond({ ok: true, revs: { sessions: 5, health: 2 }, changes: { sessions: [{ id: 's', rev: 5 }] }, locked: ['labs'] });
  const out = await pullAllChanges('u-1', { sessions: 3, health: 2, labs: 0 });
  assert.ok(lastCall.url.includes('action=changes-all') && lastCall.url.includes('user=u-1'));
  assert.ok(decodeURIComponent(lastCall.url).includes('since=sessions:3,health:2,labs:0'));
  assert.ok(!lastCall.url.includes('area='), 'no single area');
  assert.deepEqual(out, { revs: { sessions: 5, health: 2 }, changes: { sessions: [{ id: 's', rev: 5 }] }, locked: ['labs'] });
});

test('FE-26: ping remembers the server capabilities (older servers: none)', async () => {
  respond({ ok: true, pong: true, apiVersion: 1, features: ['changes-all', 'ops-since'] });
  assert.equal(await ping(), true);
  assert.equal(serverHas('changes-all'), true);
  respond({ ok: true, pong: true, apiVersion: 1 });
  await ping();
  assert.equal(serverHas('changes-all'), false);
});
