<?php
/**
 * icstz.php — time zone of the calendar files (pure functions, testable).
 *
 * The times of the sessions are local times ("run at 18:00"). ics.php writes them with
 * TZID and supplies the matching VTIMEZONE. Which zone that is is determined by the
 * environment variable CATOFIT_TZ or TZ (Docker); without a valid value it stays at
 * Europe/Berlin as before – deliberately not the php.ini default, which is UTC on
 * some hosts and would shift existing calendar subscriptions by hours.
 *
 *   php tools/test-ics.php   (test)
 */

declare(strict_types=1);

/** Time zone for DTSTART;TZID=… and the VTIMEZONE. */
function ics_timezone(): string
{
    foreach (['CATOFIT_TZ', 'TZ'] as $var) {
        $tz = trim((string) (getenv($var) ?: ''));
        if ($tz !== '' && in_array($tz, timezone_identifiers_list(), true)) {
            return $tz;
        }
    }
    return 'Europe/Berlin';
}

/** Offset in seconds → "+0100" / "-0430". */
function ics_offset(int $seconds): string
{
    $sign = $seconds < 0 ? '-' : '+';
    $seconds = abs($seconds);
    return sprintf('%s%02d%02d', $sign, intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
}

/**
 * VTIMEZONE block for a zone. Europe/Berlin stays byte-identical to the previous
 * output (no change for existing subscriptions); other zones get a STANDARD/DAYLIGHT
 * component of their own per transition in the period, zones without a transition
 * a single STANDARD component.
 *
 * @return string[]
 */
function vtimezone_lines(string $name, int $fromYear, int $toYear): array
{
    if ($name === 'Europe/Berlin') {
        return [
            'BEGIN:VTIMEZONE',
            'TZID:Europe/Berlin',
            'BEGIN:DAYLIGHT',
            'TZOFFSETFROM:+0100',
            'TZOFFSETTO:+0200',
            'TZNAME:CEST',
            'DTSTART:19700329T020000',
            'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
            'END:DAYLIGHT',
            'BEGIN:STANDARD',
            'TZOFFSETFROM:+0200',
            'TZOFFSETTO:+0100',
            'TZNAME:CET',
            'DTSTART:19701025T030000',
            'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
            'END:STANDARD',
            'END:VTIMEZONE',
        ];
    }
    // Do not even construct an unknown zone: PHP from 8.3 then throws a
    // DateInvalidTimeZoneException, and with Xdebug active that turns into an Error
    // that no catch (Exception) catches any more (this happened in CI).
    if (!in_array($name, timezone_identifiers_list(), true)) {
        return [];
    }
    try {
        $tz = new DateTimeZone($name);
    } catch (Throwable $e) {
        return [];
    }
    $utc = new DateTimeZone('UTC');
    $from = (new DateTimeImmutable(sprintf('%04d-01-01 00:00:00', $fromYear), $utc))->getTimestamp();
    $to = (new DateTimeImmutable(sprintf('%04d-01-01 00:00:00', $toYear + 1), $utc))->getTimestamp();
    $transitions = $tz->getTransitions($from, $to) ?: [];
    if (!$transitions) {
        return [];
    }

    $out = ['BEGIN:VTIMEZONE', 'TZID:' . $name];
    $prev = (int) $transitions[0]['offset'];
    $changes = 0;
    foreach (array_slice($transitions, 1) as $t) {
        $kind = $t['isdst'] ? 'DAYLIGHT' : 'STANDARD';
        // DTSTART is the local time BEFORE the transition (e.g. 02:00 on the transition day).
        array_push(
            $out,
            'BEGIN:' . $kind,
            'TZOFFSETFROM:' . ics_offset($prev),
            'TZOFFSETTO:' . ics_offset((int) $t['offset']),
            'TZNAME:' . $t['abbr'],
            'DTSTART:' . gmdate('Ymd\THis', (int) $t['ts'] + $prev),
            'END:' . $kind
        );
        $prev = (int) $t['offset'];
        $changes++;
    }
    if ($changes === 0) {
        $o = $transitions[0];
        array_push(
            $out,
            'BEGIN:STANDARD',
            'TZOFFSETFROM:' . ics_offset((int) $o['offset']),
            'TZOFFSETTO:' . ics_offset((int) $o['offset']),
            'TZNAME:' . $o['abbr'],
            'DTSTART:19700101T000000',
            'END:STANDARD'
        );
    }
    $out[] = 'END:VTIMEZONE';
    return $out;
}
