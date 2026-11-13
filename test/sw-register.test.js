/* The service worker (app shell offline, reliable updates) is registered whether the page has
   finished loading before the app's asynchronous start reaches this point or not. Before v4.2 the
   app waited for a `load` event that had long passed – no registration, no offline start. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerServiceWorker } from '../js/sw-register.js';

function fakeEnv(readyState) {
  const calls = [];
  const listeners = {};
  const env = {
    calls,
    doc: { readyState, visibilityState: 'visible', addEventListener: (t, f) => { (listeners[`doc:${t}`] ||= []).push(f); } },
    win: { addEventListener: (t, f) => { (listeners[`win:${t}`] ||= []).push(f); } },
    sw: {
      controller: null,
      addEventListener: (t, f) => { (listeners[`sw:${t}`] ||= []).push(f); },
      register: async (url, opts) => { calls.push({ url, opts }); return { update: () => calls.push({ update: true }) }; },
    },
    fire: async (key) => { for (const f of listeners[key] || []) await f(); },
  };
  return env;
}

test('page already loaded: registers right away', async () => {
  const e = fakeEnv('complete');
  await registerServiceWorker({ serviceWorker: e.sw, doc: e.doc, win: e.win, reload: () => {} });
  assert.equal(e.calls.filter((c) => c.url).length, 1, 'registered without a load event');
  assert.equal(e.calls[0].url, 'service-worker.js');
  assert.deepEqual(e.calls[0].opts, { updateViaCache: 'none' });
});

test('page still loading: registers on load, once', async () => {
  const e = fakeEnv('loading');
  const done = registerServiceWorker({ serviceWorker: e.sw, doc: e.doc, win: e.win, reload: () => {} });
  assert.equal(e.calls.length, 0, 'not before load');
  await e.fire('win:load');
  await done;
  assert.equal(e.calls.filter((c) => c.url).length, 1);
});

test('a new version takes over: reload once, not on the very first install', async () => {
  let reloads = 0;
  const first = fakeEnv('complete');
  await registerServiceWorker({ serviceWorker: first.sw, doc: first.doc, win: first.win, reload: () => { reloads++; } });
  await first.fire('sw:controllerchange');
  assert.equal(reloads, 0, 'first install: no reload');

  const update = fakeEnv('complete');
  update.sw.controller = {};   // an older version controls the page
  await registerServiceWorker({ serviceWorker: update.sw, doc: update.doc, win: update.win, reload: () => { reloads++; } });
  await update.fire('sw:controllerchange');
  await update.fire('sw:controllerchange');
  assert.equal(reloads, 1, 'update: reloaded exactly once');
});

test('without service worker support nothing happens', async () => {
  assert.equal(await registerServiceWorker({ serviceWorker: null }), null);
});
