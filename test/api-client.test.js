/* =========================================================================
   api-client.test.js — HTTP-Client zur PHP-API (server-autoritatives Sync).
   Prüft die URL-/Scope-Bildung, das Op-basierte Push/Pull und die Parsing-/
   Fehlerlogik gegen einen kontrollierten fetch-Mock (kein echter Server).
   ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pullChanges, pullAllChanges, pushOps, apiGet, ping, icsUrl, isOnline, serverHas } from '../js/api-client.js';

// Kontrollierbarer fetch-Mock: merkt sich den letzten Aufruf, liefert eine Skript-Antwort.
let lastCall = null;
let nextResponse = null;
globalThis.fetch = async (url, opts = {}) => {
  lastCall = { url: String(url), opts };
  return nextResponse || { ok: true, status: 200, json: async () => ({ ok: true, rev: 0, records: [], data: null }) };
};
/** Nächste Serverantwort setzen. httpOk=false simuliert einen HTTP-Fehlerstatus. */
function respond(json, { httpOk = true, status = 200 } = {}) {
  nextResponse = { ok: httpOk, status, json: async () => json };
}

test('icsUrl: Download-URL mit und ohne user-Scope', () => {
  const withUser = icsUrl('user', 'ev1', 'u-1');
  assert.ok(withUser.includes('action=ics'), 'action=ics');
  assert.ok(withUser.includes('scope=user') && withUser.includes('id=ev1'));
  assert.ok(withUser.includes('user=u-1'), 'user-Param gesetzt');
  const noUser = icsUrl('family', 'ev2');
  assert.ok(noUser.includes('scope=family') && noUser.includes('id=ev2'));
  assert.ok(!noUser.includes('user='), 'ohne user kein user-Param');
});

test('pullChanges: GET action=changes&since, liefert {rev, records}', async () => {
  respond({ ok: true, rev: 7, records: [{ id: 'a', rev: 7 }] });
  const out = await pullChanges('events', { user: 'u-1', since: 3 });
  assert.equal(lastCall.opts.method, 'GET');
  assert.ok(lastCall.url.includes('area=events'));
  assert.ok(lastCall.url.includes('action=changes'));
  assert.ok(lastCall.url.includes('since=3'));
  assert.ok(lastCall.url.includes('user=u-1'));
  assert.deepEqual(out, { rev: 7, records: [{ id: 'a', rev: 7 }] });
});

test('pullChanges: since fehlt -> since=0', async () => {
  respond({ ok: true, rev: 1, records: [] });
  await pullChanges('plans', { user: 'u-1' });
  assert.ok(lastCall.url.includes('since=0'));
});

test('pushOps: POST action=ops mit body {ops}, liefert {rev, records}', async () => {
  respond({ ok: true, rev: 9, records: [{ id: 'x', rev: 9 }] });
  const ops = [{ op: 'upsert', record: { id: 'x' } }];
  const out = await pushOps('sessions', ops, { user: 'u-1' });
  assert.equal(lastCall.opts.method, 'POST');
  assert.ok(lastCall.url.includes('action=ops'));
  assert.deepEqual(JSON.parse(lastCall.opts.body), { ops });
  assert.deepEqual(out, { rev: 9, records: [{ id: 'x', rev: 9 }], rejected: [], changes: null });
});

test('pushOps: scope=family -> &scope=family statt user', async () => {
  respond({ ok: true, rev: 2, records: [] });
  await pushOps('family', [], { scope: 'family', user: 'u-1' });
  assert.ok(lastCall.url.includes('scope=family'));
  assert.ok(!lastCall.url.includes('user='), 'family-Scope überschreibt user');
});

test('apiGet: liefert json.data', async () => {
  respond({ ok: true, data: [{ id: 1 }, { id: 2 }] });
  assert.deepEqual(await apiGet('health', { user: 'u-1' }), [{ id: 1 }, { id: 2 }]);
});

test('pullChanges: Serverfehler (ok:false) wirft mit Server-Meldung', async () => {
  respond({ ok: false, error: 'kaputt' });
  await assert.rejects(() => pullChanges('events', { user: 'u-1', since: 0 }), /kaputt/);
});

test('ping: true bei ok, false bei HTTP-Fehler', async () => {
  respond({ ok: true });
  assert.equal(await ping(), true);
  respond({}, { httpOk: false, status: 500 }); // request wirft -> ping fängt (retries:0) -> false
  assert.equal(await ping(), false);
});

test('pushOps: 413 (zu viele Ops) wird nicht wiederholt und trägt den Status', async () => {
  const mock = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => { calls++; return mock(url, opts); };
  try {
    respond({ ok: false, error: 'zu viele Ops' }, { httpOk: false, status: 413 });
    const t0 = Date.now();
    await assert.rejects(() => pushOps('health', [{ op: 'upsert', record: { id: 'x' } }], { user: 'u-1' }), (e) => e.status === 413);
    assert.equal(calls, 1, 'endgültiger Fehler: genau ein Versuch');
    assert.ok(Date.now() - t0 < 300, 'keine Wartezeit für Wiederholungen');
  } finally { globalThis.fetch = mock; nextResponse = null; }
});

test('isOnline: liefert einen Boolean', () => {
  assert.equal(typeof isOnline(), 'boolean');
});

test('FE-26: pushOps mit since – Body {ops, since}, Änderungen seit der Marke kommen mit', async () => {
  respond({ ok: true, rev: 12, records: [{ id: 'x', rev: 12 }], changes: { rev: 12, records: [{ id: 'f', rev: 11 }, { id: 'x', rev: 12 }] } });
  const ops = [{ op: 'upsert', record: { id: 'x' } }];
  const out = await pushOps('sessions', ops, { user: 'u-1', since: 10 });
  assert.deepEqual(JSON.parse(lastCall.opts.body), { ops, since: 10 });
  assert.ok(!lastCall.url.includes('since='), 'since gehört in den Body, nicht in die Adresse');
  assert.deepEqual(out.changes, { rev: 12, records: [{ id: 'f', rev: 11 }, { id: 'x', rev: 12 }] });
});

test('FE-26: Sammelabruf – eine Anfrage mit allen Marken, Antwort je Bereich', async () => {
  respond({ ok: true, revs: { sessions: 5, health: 2 }, changes: { sessions: [{ id: 's', rev: 5 }] }, locked: ['labs'] });
  const out = await pullAllChanges('u-1', { sessions: 3, health: 2, labs: 0 });
  assert.ok(lastCall.url.includes('action=changes-all') && lastCall.url.includes('user=u-1'));
  assert.ok(decodeURIComponent(lastCall.url).includes('since=sessions:3,health:2,labs:0'));
  assert.ok(!lastCall.url.includes('area='), 'kein einzelner Bereich');
  assert.deepEqual(out, { revs: { sessions: 5, health: 2 }, changes: { sessions: [{ id: 's', rev: 5 }] }, locked: ['labs'] });
});

test('FE-26: ping merkt sich die Fähigkeiten des Servers (ältere Server: keine)', async () => {
  respond({ ok: true, pong: true, apiVersion: 1, features: ['changes-all', 'ops-since'] });
  assert.equal(await ping(), true);
  assert.equal(serverHas('changes-all'), true);
  respond({ ok: true, pong: true, apiVersion: 1 });
  await ping();
  assert.equal(serverHas('changes-all'), false);
});
