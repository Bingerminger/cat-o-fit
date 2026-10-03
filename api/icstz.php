<?php
/**
 * icstz.php — Zeitzone der Kalender-Dateien (reine Funktionen, testbar).
 *
 * Die Zeiten der Einheiten sind Ortszeit („Lauf um 18:00“). ics.php schreibt sie mit
 * TZID und liefert die passende VTIMEZONE mit. Welche Zone das ist, bestimmt die
 * Umgebungsvariable CATOFIT_TZ oder TZ (Docker); ohne gültige Angabe bleibt es wie
 * bisher bei Europe/Berlin – bewusst nicht die php.ini-Voreinstellung, die auf manchen
 * Hosts UTC ist und bestehende Kalender-Abos um Stunden verschieben würde.
 *
 *   php tools/test-ics.php   (Test)
 */

declare(strict_types=1);

/** Zeitzone für DTSTART;TZID=… und die VTIMEZONE. */
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

/** Versatz in Sekunden → „+0100“ / „-0430“. */
function ics_offset(int $seconds): string
{
    $sign = $seconds < 0 ? '-' : '+';
    $seconds = abs($seconds);
    return sprintf('%s%02d%02d', $sign, intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
}

/**
 * VTIMEZONE-Block für eine Zone. Europe/Berlin bleibt byte-gleich zur bisherigen
 * Ausgabe (keine Änderung für bestehende Abos); andere Zonen bekommen je Umstellung
 * im Zeitraum eine eigene STANDARD/DAYLIGHT-Komponente (RFC 5545, ohne RRULE),
 * Zonen ohne Umstellung eine einzige STANDARD-Komponente.
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
    // Unbekannte Zone gar nicht erst konstruieren: PHP ab 8.3 wirft dann eine
    // DateInvalidTimeZoneException, und mit aktivem Xdebug schlägt daraus ein Error
    // durch, den kein catch (Exception) mehr fängt (so geschehen in der CI).
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
        // DTSTART ist die Ortszeit VOR der Umstellung (z. B. 02:00 am Umstellungstag).
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
