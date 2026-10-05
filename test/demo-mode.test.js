/* Public demo (GitHub Pages, no PHP): a visit clears only this deployment's stored keys, answers
   the API in the browser, sets up the demo family with the persona "Alex" and shows the bar. The
   build marks index.html with data-demo and ships no server code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopeKey } from '../js/env.js';
import * as store from '../js/storage.js';
import { prepareDemo, startDemo, isDemo, DEMO_PIN } from '../js/demo-mode.js';
import { buildDemo } from '../tools/build-demo.mjs';

const { MiniNode } = globalThis.__domTest;

test('demo: a visit starts over – only this deployment\'s keys go, other apps keep theirs', async () => {
  const fetchBefore = globalThis.fetch;
  try {
    localStorage.setItem(scopeKey('familyStore'), '{"old":true}');
    localStorage.setItem('other-app:settings', 'keep');
    sessionStorage.setItem(scopeKey('session'), 'u-old');
    prepareDemo();
    assert.equal(localStorage.getItem(scopeKey('familyStore')), null);
    assert.equal(sessionStorage.getItem(scopeKey('session')), null);
    assert.equal(localStorage.getItem('other-app:settings'), 'keep');
    const ping = await (await fetch(new URL('api/api.php?action=ping', location.href))).json();
    assert.equal(ping.ok, true, 'the API answers in the browser');
    const off = await fetch(new URL('api/api.php?action=foodfacts&name=oats', location.href));
    assert.equal(off.status, 501, 'server-only features say they are not in the demo');
  } finally {
    globalThis.fetch = fetchBefore;
    localStorage.removeItem('other-app:settings');
  }
});

test('demo: the demo family with "Alex", demo data and the bar in the header', async () => {
  const fetchBefore = globalThis.fetch;
  const header = new MiniNode('header'); header.setAttribute('id', 'app-header');
  document.body.appendChild(header);
  try {
    prepareDemo();
    await store.init();
    await startDemo();
    const me = store.members().find((m) => m.id === store.activeUserId());
    assert.equal(me && me.name, 'Alex');
    assert.equal(me.role, 'admin');
    assert.ok(store.get('sessions').length > 10, 'demo history is there');
    const bar = header.querySelector('.demo-bar');
    assert.ok(bar, 'the bar sits in the header');
    assert.match(bar.textContent, new RegExp(DEMO_PIN));
  } finally {
    globalThis.fetch = fetchBefore;
    header.remove?.();
  }
});

test('demo: off unless the page is marked', () => {
  assert.equal(isDemo(), false);
});

test('demo build: index.html marked, no server code, files served as they are', () => {
  const out = mkdtempSync(join(tmpdir(), 'catofit-demo-'));
  try {
    buildDemo(out);
    assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /<html[^>]*\sdata-demo[\s>]/);
    for (const f of ['js/demo-mode.js', 'js/demo-server.js', 'locales/languages.json', 'service-worker.js', '.nojekyll']) {
      assert.ok(existsSync(join(out, f)), `${f} is part of the demo`);
    }
    for (const f of ['api', 'data', 'docs', 'tools', 'test']) assert.ok(!existsSync(join(out, f)), `${f} stays out`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
