<?php
/**
 * test-ics.php — time zone of the calendar files (api/icstz.php).
 *
 *   php tools/test-ics.php
 *
 * Before v3.21.0 ics.php hard-coded TZID=Europe/Berlin, even when the container ran with a
 * different TZ – outside Central Europe, appointments ended up shifted by hours in the
 * calendar. Existing subscriptions in Europe/Berlin must not change as a result.
 * Exit code 0 = all green, 1 = at least one failure. Also runs in CI.
 */
declare(strict_types=1);

require __DIR__ . '/../api/icstz.php';
require __DIR__ . '/../api/i18n.php';

$pass = 0;
$fail = 0;
function check(string $name, bool $cond, $got = null): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ok  {$name}\n"; return; }
    $fail++;
    echo "  XX  {$name}" . ($got !== null ? ' → ' . json_encode($got, JSON_UNESCAPED_UNICODE) : '') . "\n";
}
function withEnv(array $vars, callable $fn)
{
    $old = [];
    foreach ($vars as $k => $v) { $old[$k] = getenv($k); putenv($v === null ? $k : "{$k}={$v}"); }
    try { return $fn(); } finally {
        foreach ($old as $k => $v) putenv($v === false ? $k : "{$k}={$v}");
    }
}

// --- Which zone? ---------------------------------------------------------
check('without a setting: Europe/Berlin as before', withEnv(['CATOFIT_TZ' => null, 'TZ' => null], 'ics_timezone') === 'Europe/Berlin');
check('TZ from the environment (Docker)', withEnv(['CATOFIT_TZ' => null, 'TZ' => 'America/New_York'], 'ics_timezone') === 'America/New_York');
check('CATOFIT_TZ takes precedence', withEnv(['CATOFIT_TZ' => 'Europe/Vienna', 'TZ' => 'UTC'], 'ics_timezone') === 'Europe/Vienna');
check('nonsensical setting → Europe/Berlin', withEnv(['CATOFIT_TZ' => null, 'TZ' => ':/etc/localtime'], 'ics_timezone') === 'Europe/Berlin');

// --- Offset ---------------------------------------------------------------
check('ics_offset(+1 h)', ics_offset(3600) === '+0100');
check('ics_offset(−4:30 h)', ics_offset(-16200) === '-0430', ics_offset(-16200));

// --- VTIMEZONE -------------------------------------------------------------
$berlin = implode("\n", vtimezone_lines('Europe/Berlin', 2025, 2028));
check('Europe/Berlin byte-identical to the previous output',
    $berlin === "BEGIN:VTIMEZONE\nTZID:Europe/Berlin\nBEGIN:DAYLIGHT\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0200\nTZNAME:CEST\nDTSTART:19700329T020000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\nEND:DAYLIGHT\nBEGIN:STANDARD\nTZOFFSETFROM:+0200\nTZOFFSETTO:+0100\nTZNAME:CET\nDTSTART:19701025T030000\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\nEND:STANDARD\nEND:VTIMEZONE");

$ny = vtimezone_lines('America/New_York', 2026, 2026);
$nyText = implode("\n", $ny);
check('New York: TZID', in_array('TZID:America/New_York', $ny, true));
check('New York: daylight saving time from 8 March 2026, 2:00 (−5 → −4)',
    str_contains($nyText, "BEGIN:DAYLIGHT\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nTZNAME:EDT\nDTSTART:20260308T020000"), $nyText);
check('New York: standard time from 1 November 2026, 2:00 (−4 → −5)',
    str_contains($nyText, "BEGIN:STANDARD\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nTZNAME:EST\nDTSTART:20261101T020000"), $nyText);
check('New York: block complete', $ny[0] === 'BEGIN:VTIMEZONE' && end($ny) === 'END:VTIMEZONE');

$tokyo = implode("\n", vtimezone_lines('Asia/Tokyo', 2026, 2027));
check('Tokyo (no changeover): one STANDARD component +0900',
    substr_count($tokyo, 'BEGIN:STANDARD') === 1 && str_contains($tokyo, 'TZOFFSETTO:+0900') && !str_contains($tokyo, 'DAYLIGHT'), $tokyo);
check('unknown zone → no block', vtimezone_lines('Mars/Olympus', 2026, 2026) === []);
// With Xdebug (CI) the exception of an unknown zone came through as an Error that no
// catch (Exception) catches – so vtimezone_lines checks the zone BEFORE constructing.
check('unknown zone is rejected before constructing', preg_match(
    '/function vtimezone_lines.*?timezone_identifiers_list\(\).*?new DateTimeZone\(\$name\)/s',
    (string) file_get_contents(__DIR__ . '/../api/icstz.php')) === 1);

// --- Integration in ics.php ---------------------------------------------------
$src = file_get_contents(__DIR__ . '/../api/ics.php');
check('ics.php uses the zone for DTSTART', substr_count($src, "'DTSTART;TZID=' . ics_timezone() . ':'") === 2);
check('ics.php no longer writes a fixed zone', !str_contains($src, 'TZID=Europe/Berlin:'));

// --- Texts and numbers per language (api/i18n.php) ------------------------------
check('Language: exact, via the base language, or none', server_match_language('de-AT') === 'de' && server_match_language('pt') === 'pt-BR'
    && server_match_language('PT_br') === 'pt-BR' && server_match_language('xx') === null && server_match_language(null) === null);
check('Text: placeholders, German as before', server_text('de', 'ics.distance', ['km' => '10,5']) === 'Distanz: 10,5 km');
check('Text: English', server_text('en', 'ics.alarmTomorrow', ['title' => 'Long run']) === 'Tomorrow: Long run');
check('Text: French catalogue, unsupported language → English, unknown key → the key', server_text('fr', 'ics.race') === 'Course'
    && server_text('xx', 'ics.race') === 'Race' && server_text('de', 'ics.nope') === 'ics.nope');
check('Number: decimal comma (de, fr), decimal point (en), no trailing zeros', server_number(21.0975, 2, 'de') === '21,1'
    && server_number(21.0975, 2, 'en') === '21.1' && server_number(10.0, 1, 'fr') === '10' && server_number(8.25, 2, 'nl') === '8,25',
    [server_number(21.0975, 2, 'de'), server_number(21.0975, 2, 'en'), server_number(10.0, 1, 'fr')]);

echo "\nics: {$pass} ok, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
