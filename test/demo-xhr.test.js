/* The public demo answers its API in the browser. That has to hold for XMLHttpRequest as well (the
   health import uploads with it, for its progress bar): a real export file must never leave the
   browser, and the app says in the person's language that this needs an own installation. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDemoServer } from '../js/demo-server.js';
import { uploadHealthExport } from '../js/api-client.js';
import { setLocale } from '../js/i18n.js';

const sentToNetwork = [];
const saved = { fetch: globalThis.fetch, XHR: globalThis.XMLHttpRequest, location: globalThis.location };

/** A browser-like XMLHttpRequest that records whatever would go over the network. */
class FakeXHR extends EventTarget {
  open(method, url) { this.method = method; this.url = url; }
  send(body) {
    sentToNetwork.push({ method: this.method, url: String(this.url), body });
    queueMicrotask(() => this.onerror?.(new Event('error')));   // like GitHub Pages refusing the POST
  }
}

before(() => {
  globalThis.XMLHttpRequest = FakeXHR;
  if (!globalThis.location?.href) globalThis.location = { href: 'https://demo.example/cat-o-fit/' };
  globalThis.fetch = async (url) => { sentToNetwork.push({ method: 'fetch', url: String(url) }); return new Response('{}'); };
  installDemoServer();
});
after(async () => {
  globalThis.fetch = saved.fetch;
  globalThis.XMLHttpRequest = saved.XHR;
  if (saved.location) globalThis.location = saved.location;
  await setLocale('de');
});

test('demo: the health upload never reaches the network and is explained in the person\'s language', async () => {
  await setLocale('de');
  const file = new Blob(['<HealthData/>'], { type: 'text/xml' });
  await assert.rejects(uploadHealthExport(file), (e) => {
    assert.match(e.message, /Demo/, e.message);
    assert.doesNotMatch(e.message, /Not available/, 'translated, not the English fallback');
    return true;
  });
  assert.deepEqual(sentToNetwork, [], 'nothing went over the network');
});

test('demo: other XMLHttpRequests (not the API) still go to the network', async () => {
  sentToNetwork.length = 0;
  const x = new XMLHttpRequest();
  x.open('GET', 'https://api.open-meteo.com/v1/forecast?latitude=1');
  x.send();
  assert.equal(sentToNetwork.length, 1);
  assert.match(sentToNetwork[0].url, /open-meteo/);
});
