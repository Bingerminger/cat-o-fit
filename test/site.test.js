/* The project site on GitHub Pages (tools/build-site.mjs, since 4.2): start page in English and
   German, the demo under demo/, a 404 page and a worker that retires the demo's old service worker.
   - the built site keeps every rule (S1–S7, see the head of build-site.mjs),
   - each rule fires on a broken page (so a passing check means something),
   - old demo addresses lead to the demo or the German start page,
   - the retiring worker deletes only the caches of the old address, never the demo's. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, checkSite, legacyTarget, RETIRE_WORKER } from '../tools/build-site.mjs';

let out;
let built;
before(async () => {
  out = mkdtempSync(join(tmpdir(), 'catofit-site-test-'));
  built = await buildSite(out);
});
after(() => rmSync(out, { recursive: true, force: true }));

test('SITE-01: the built site keeps every rule', () => {
  assert.deepEqual(checkSite(out, built), []);
  for (const f of ['index.html', 'de/index.html', '404.html', 'service-worker.js', 'demo/index.html', 'assets/style.css', 'assets/banner.png']) {
    assert.ok(existsSync(join(out, f)), `${f} is missing`);
  }
  assert.match(readFileSync(join(out, 'demo', 'index.html'), 'utf8'), /<html[^>]*data-demo/, 'the demo is built in demo mode');
});

test('SITE-02: each rule fires on a broken page', () => {
  const en = built.pages['index.html'];
  const broken = (rule, page, claims = built.claims, fig = built.fig) => {
    const problems = checkSite(out, { pages: { ...built.pages, 'index.html': page }, claims, fig });
    assert.ok(problems.some((p) => p.startsWith(`${rule}:`)), `${rule} did not fire:\n${problems.join('\n')}`);
  };
  const body = (extra) => en.replace('</main>', `${extra}</main>`);
  broken('S1', body('<script src="https://cdn.example.org/x.js"></script>'));
  broken('S1', en.replace('<link rel="stylesheet" href="assets/style.css">', '<link rel="stylesheet" href="https://fonts.example.org/a.css">'));
  broken('S2', body('<img src="assets/en/missing.png" width="1" height="1" alt="x">'));
  broken('S2', body('<a href="#nowhere">x</a>'));
  broken('S2', body('<a href="nothing-here/">x</a>'));
  broken('S3', body('<img src="assets/en/04-plan.png" width="390" height="844">'));
  broken('S3', body('<img src="assets/en/04-plan.png" width="100" height="100" alt="plan">'));
  broken('S4', body('<p data-c="x">x</p>'), { ...built.claims, en: new Set([...built.claims.en, 'invented-claim']) });
  broken('S4', en, { ...built.claims, en: new Set([...built.claims.en].filter((c) => c !== 'pwa')) });
  broken('S5', body('<h1>Second</h1>'));
  broken('S5', en.replace(/<link rel="alternate" hreflang="de"[^>]*>/, ''));
  broken('S6', body('<p>Used by 1,200 users</p>'));
  broken('S6', body(`<p>${built.fig.exercises + 1} exercises</p>`));
  broken('S6', body('<p>up to 99 people</p>'));
  broken('S7', body('<script>localStorage.setItem("a", 1)</script>'));
  broken('S7', body('<script>fetch("/x")</script>'));
});

test('SITE-03: old demo addresses lead on', () => {
  assert.equal(legacyTarget('', '#/calendar'), 'demo/#/calendar');
  assert.equal(legacyTarget('', '#/'), 'demo/#/', 'an installed demo app starts at ./index.html#/');
  assert.equal(legacyTarget('?lang=de', '#/stats'), 'demo/?lang=de#/stats');
  assert.equal(legacyTarget('?lang=de', ''), 'de/', 'the German README linked ?lang=de');
  assert.equal(legacyTarget('?lang=de-DE', ''), 'de/');
  assert.equal(legacyTarget('?lang=fr', ''), null);
  assert.equal(legacyTarget('', ''), null);
  assert.equal(legacyTarget('', '#install'), null, 'anchors on the start page stay');
  assert.match(built.pages['index.html'], /location\.replace/, 'the English start page carries the redirect');
  assert.doesNotMatch(built.pages['de/index.html'], /location\.replace/);
});

test('SITE-04: the retiring worker deletes only the old address\'s caches and removes itself', async () => {
  const handlers = {};
  const deleted = [];
  let unregistered = false;
  const self = {
    location: { href: 'https://bingerminger.github.io/cat-o-fit/service-worker.js' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    registration: { unregister: async () => { unregistered = true; return true; } },
    clients: { matchAll: async () => [] },
  };
  const caches = {
    keys: async () => ['catofit-v118-/cat-o-fit/-shell', 'catofit-v130-/cat-o-fit/demo/-shell', 'catofit-v130-/cat-o-fit-acc/-shell', 'energietracker'],
    delete: async (k) => { deleted.push(k); return true; },
  };
  new Function('self', 'caches', RETIRE_WORKER)(self, caches);
  let work;
  handlers.activate({ waitUntil: (p) => { work = p; } });
  await work;
  assert.deepEqual(deleted, ['catofit-v118-/cat-o-fit/-shell']);
  assert.ok(unregistered);
});
