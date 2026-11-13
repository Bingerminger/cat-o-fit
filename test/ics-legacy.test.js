/* Calendar links without a key (before 3.20.0) end on 30 November 2026: the export dialog says so before
   and after, and its date is the server's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legacyLinkNote, ICS_LEGACY_UNTIL } from '../js/ics-export.js';

test('old subscription links: a note before and after the end, none half a year later', () => {
  assert.match(legacyLinkNote('2026-11-20'), /gelten nur bis .*30\. November 2026/);
  assert.match(legacyLinkNote('2026-12-05'), /seit .*30\. November 2026 nicht mehr/);
  assert.equal(legacyLinkNote('2027-06-01'), null);
});

test('the date is the one the server uses', () => {
  const php = readFileSync(new URL('../api/ics.php', import.meta.url), 'utf8');
  assert.match(php, new RegExp(`const ICS_LEGACY_UNTIL = '${ICS_LEGACY_UNTIL}';`));
});
