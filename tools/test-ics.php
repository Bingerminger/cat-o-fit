<?php
/**
 * test-ics.php — Zeitzone der Kalender-Dateien (api/icstz.php).
 *
 *   php tools/test-ics.php
 *
 * Vor v3.21.0 schrieb ics.php fest TZID=Europe/Berlin, auch wenn der Container mit einer
 * anderen TZ lief – Termine landeten außerhalb Mitteleuropas um Stunden verschoben im
 * Kalender. Bestehende Abos in Europe/Berlin dürfen sich dabei nicht ändern.
 * Exit-Code 0 = alle grün, 1 = mind. ein Fehler. Läuft in der CI mit.
 */
declare(strict_types=1);

require __DIR__ . '/../api/icstz.php';

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

// --- Welche Zone? ---------------------------------------------------------
check('ohne Angabe: Europe/Berlin wie bisher', withEnv(['CATOFIT_TZ' => null, 'TZ' => null], 'ics_timezone') === 'Europe/Berlin');
check('TZ aus der Umgebung (Docker)', withEnv(['CATOFIT_TZ' => null, 'TZ' => 'America/New_York'], 'ics_timezone') === 'America/New_York');
check('CATOFIT_TZ hat Vorrang', withEnv(['CATOFIT_TZ' => 'Europe/Vienna', 'TZ' => 'UTC'], 'ics_timezone') === 'Europe/Vienna');
check('unsinnige Angabe → Europe/Berlin', withEnv(['CATOFIT_TZ' => null, 'TZ' => ':/etc/localtime'], 'ics_timezone') === 'Europe/Berlin');

// --- Versatz ---------------------------------------------------------------
check('ics_offset(+1 h)', ics_offset(3600) === '+0100');
check('ics_offset(−4:30 h)', ics_offset(-16200) === '-0430', ics_offset(-16200));

// --- VTIMEZONE -------------------------------------------------------------
$berlin = implode("\n", vtimezone_lines('Europe/Berlin', 2025, 2028));
check('Europe/Berlin byte-gleich zur bisherigen Ausgabe',
    $berlin === "BEGIN:VTIMEZONE\nTZID:Europe/Berlin\nBEGIN:DAYLIGHT\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0200\nTZNAME:CEST\nDTSTART:19700329T020000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\nEND:DAYLIGHT\nBEGIN:STANDARD\nTZOFFSETFROM:+0200\nTZOFFSETTO:+0100\nTZNAME:CET\nDTSTART:19701025T030000\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\nEND:STANDARD\nEND:VTIMEZONE");

$ny = vtimezone_lines('America/New_York', 2026, 2026);
$nyText = implode("\n", $ny);
check('New York: TZID', in_array('TZID:America/New_York', $ny, true));
check('New York: Sommerzeit ab 8. März 2026, 2:00 (−5 → −4)',
    str_contains($nyText, "BEGIN:DAYLIGHT\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nTZNAME:EDT\nDTSTART:20260308T020000"), $nyText);
check('New York: Winterzeit ab 1. November 2026, 2:00 (−4 → −5)',
    str_contains($nyText, "BEGIN:STANDARD\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nTZNAME:EST\nDTSTART:20261101T020000"), $nyText);
check('New York: Block vollständig', $ny[0] === 'BEGIN:VTIMEZONE' && end($ny) === 'END:VTIMEZONE');

$tokyo = implode("\n", vtimezone_lines('Asia/Tokyo', 2026, 2027));
check('Tokyo (keine Umstellung): eine STANDARD-Komponente +0900',
    substr_count($tokyo, 'BEGIN:STANDARD') === 1 && str_contains($tokyo, 'TZOFFSETTO:+0900') && !str_contains($tokyo, 'DAYLIGHT'), $tokyo);
check('unbekannte Zone → kein Block', vtimezone_lines('Mars/Olympus', 2026, 2026) === []);
// Mit Xdebug (CI) schlug die Ausnahme einer unbekannten Zone als Error durch, den kein
// catch (Exception) fängt – deshalb prüft vtimezone_lines die Zone VOR dem Konstruieren.
check('unbekannte Zone wird vor dem Konstruieren abgewiesen', preg_match(
    '/function vtimezone_lines.*?timezone_identifiers_list\(\).*?new DateTimeZone\(\$name\)/s',
    (string) file_get_contents(__DIR__ . '/../api/icstz.php')) === 1);

// --- Einbindung in ics.php ---------------------------------------------------
$src = file_get_contents(__DIR__ . '/../api/ics.php');
check('ics.php nutzt die Zone für DTSTART', substr_count($src, "'DTSTART;TZID=' . ics_timezone() . ':'") === 2);
check('ics.php schreibt keine feste Zone mehr', !str_contains($src, 'TZID=Europe/Berlin:'));

echo "\nics: {$pass} ok, {$fail} fehlgeschlagen\n";
exit($fail === 0 ? 0 : 1);
