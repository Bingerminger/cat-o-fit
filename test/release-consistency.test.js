/* What a release has to keep in step, checked on every run (v4.2):
   - the bug form offers the current version,
   - every environment variable of the installation guide is in docker-compose.yml and in the
     Unraid and CasaOS templates,
   - the public demo is built from the newest release, never from a push to main,
   - the Docker image is tested in CI as users run it, the app in real browsers, and every test runs
     once a week under a moved clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../js/version.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the bug form offers the current version', () => {
  const form = read('.github/ISSUE_TEMPLATE/bug_report.yml');
  const options = form.slice(form.indexOf('id: version')).split('validations:')[0];
  assert.ok(options.includes(`- "${APP_VERSION}"`), `bug_report.yml: add "${APP_VERSION}" to the App version list`);
});

test('every documented environment variable is in docker-compose.yml and the Unraid/CasaOS templates', () => {
  const guide = read('docs/operations/installation.md');
  const section = guide.slice(guide.indexOf('## Environment variables'));
  const table = section.slice(0, section.indexOf('\n## ', 5) > 0 ? section.indexOf('\n## ', 5) : undefined);
  // All variables in the first column of each row (one row may name several, e.g. user and password).
  const firstCells = [...table.matchAll(/^\|([^|]*)\|/gm)].map((m) => m[1]);
  const vars = [...new Set(firstCells.flatMap((c) => [...c.matchAll(/`((?:CATOFIT_[A-Z_]+)|TZ)(?:=[^`]*)?`/g)].map((m) => m[1])))];
  assert.ok(vars.length >= 5, `variables found in the guide: ${vars.join(', ')}`);
  for (const [file, text] of [['docker-compose.yml', read('docker-compose.yml')], ['deploy/unraid/cat-o-fit.xml', read('deploy/unraid/cat-o-fit.xml')], ['deploy/casaos/docker-compose.yml', read('deploy/casaos/docker-compose.yml')]]) {
    const missing = vars.filter((v) => !new RegExp(`\\b${v}\\b`).test(text));
    assert.deepEqual(missing, [], `${file} lacks ${missing.join(', ')}`);
  }
});

test('the demo is built from the newest release, never from a push', () => {
  const pages = read('.github/workflows/pages.yml');
  const on = pages.slice(pages.indexOf('\non:'), pages.indexOf('\npermissions:'));
  assert.doesNotMatch(on, /\bpush:/, 'pages.yml must not run on push');
  assert.match(on, /release:\s*\n\s*types:\s*\[published\]/);
  assert.match(pages, /git tag --list 'v\*' --sort=-version:refname/, 'falls back to the newest tag');
  const build = pages.slice(pages.indexOf('  build:'), pages.indexOf('  deploy:'));
  assert.doesNotMatch(build, /pages:\s*write/, 'the build job has read access only');
  // Since 4.2 the site (start page + demo under demo/) is published, after its rules are checked.
  assert.match(build, /node tools\/build-site\.mjs --check/);
  assert.match(build, /node tools\/build-site\.mjs --out dist\/site/);
  assert.match(build, /path: dist\/site/);
});

test('README links lead to the start page and the demo under demo/', () => {
  for (const [file, demo] of [['README.md', 'https://bingerminger.github.io/cat-o-fit/demo/'], ['README.de.md', 'https://bingerminger.github.io/cat-o-fit/demo/?lang=de']]) {
    const text = read(file);
    assert.ok(text.includes(`](${demo})`), `${file}: the demo link should be ${demo}`);
    assert.doesNotMatch(text, /bingerminger\.github\.io\/cat-o-fit\/\?lang=/, `${file}: the demo moved to demo/`);
  }
});

test('CI tests the Docker image as users run it', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /docker build -t cat-o-fit:smoke \./);
  assert.match(ci, /bash tools\/test-docker\.sh/);
});

test('CI tests the app in real browsers, and the weekly time travel exists', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /npx playwright install --with-deps chromium webkit/);
  assert.match(ci, /node tools\/test-browser\.mjs/);
  const tt = read('.github/workflows/time-travel.yml');
  assert.match(tt, /faketime -f "@\$\{\{ matrix\.when \}\}" npm test/);
});
