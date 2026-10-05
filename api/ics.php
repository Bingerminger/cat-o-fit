<?php
/**
 * ics.php — serverseitige Generierung von iCalendar-Dateien (RFC 5545).
 *
 * Wird von api.php bei ?action=ics eingebunden. Liefert eine .ics-Datei
 * zum Download, die im iOS-Kalender importiert werden kann (inkl. VALARM
 * als zuverlässige Erinnerung auf iPhone/iPad).
 *
 * Aufrufe (der Parameter user=<id> ist im Mehrbenutzer-Betrieb verpflichtend,
 * `token` ist der Kalender-Schlüssel des Mitglieds, siehe ?action=ics-token):
 *   ?action=ics&scope=event&id=<eventId>&user=<id>&token=<t>   -> kompletter Plan (alle Einheiten + Wettkampf)
 *   ?action=ics&scope=session&id=<unitId>&user=<id>&token=<t>  -> einzelne geplante Einheit
 *   ?action=ics&scope=race&id=<eventId>&user=<id>&token=<t>    -> nur der Wettkampf selbst
 *
 * Quelle der Daten: data/users/<id>/plans.json und .../events.json (pro Mitglied),
 * geladen über load_area('…','user',$user). Der Client (ics-export.js) übergibt
 * dafür store.activeUserId().
 */

declare(strict_types=1);

// storage.php/auth.php sind bereits via api.php geladen; defensiv erneut sicherstellen.
require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/icstz.php';
require_once __DIR__ . '/i18n.php';

$scope = isset($_GET['scope']) ? (string) $_GET['scope'] : 'event';
$id    = isset($_GET['id']) ? (string) $_GET['id'] : '';
$user  = isset($_GET['user']) ? (string) $_GET['user'] : null;
// Texts in the person's language (without a valid person: the instance default).
$lang  = person_language($user !== null && is_valid_user($user) ? $user : null);

/** Plain-text error – the link opens in a browser or calendar, not in the app. */
$icsError = static function (int $status, string $key) use ($lang): never {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo server_text($lang, $key);
    exit;
};

if ($id === '') {
    $icsError(400, 'ics.error.missingId');
}
if ($user === null || !is_valid_user($user)) {
    $icsError(400, 'ics.error.invalidUser');
}

// Zugriff (seit v3.20.0): Kalender-Links tragen einen Schlüssel je Mitglied
// (`token`, siehe ?action=ics-token) – sie öffnen sich außerhalb der App ohne
// Sitzungs-Cookie. Innerhalb der App genügt auch die eigene Sitzung (oder die einer
// Admin-Person). Links ohne Schlüssel aus älteren Versionen gelten noch bis
// ICS_LEGACY_UNTIL; danach muss der Termin einmal neu aus der App exportiert werden.
const ICS_LEGACY_UNTIL = '2026-11-30';
$token = isset($_GET['token']) ? (string) $_GET['token'] : '';
if ($token !== '') {
    $stored = ics_token_read($user);
    if ($stored === null || !hash_equals($stored, $token)) {
        $icsError(403, 'ics.error.linkInvalid');
    }
} else {
    $session = current_session();
    $own = $session !== null && ($session['user'] === $user || $session['role'] === 'admin');
    if (!$own && date('Y-m-d') > ICS_LEGACY_UNTIL) {
        $icsError(403, 'ics.error.linkExpired');
    }
}

$events = load_area('events', 'user', $user);
$plans  = load_area('plans', 'user', $user);

/** Findet ein Event-Objekt anhand der ID. */
function find_event(array $events, string $id): ?object
{
    foreach ($events as $e) {
        if (isset($e->id) && $e->id === $id) {
            return $e;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// App-Basis-URL für Deep-Links zurück in die Session-View ableiten.
// ---------------------------------------------------------------------------
$scheme  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
// Host nur in plausibler Form übernehmen (fließt in Deep-Links und die UID).
$host    = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
if (preg_match('/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/', $host) !== 1) {
    $host = 'localhost';
}
$scriptDir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/api.php'));
$appBase = preg_replace('#/api/?$#', '', $scriptDir);   // .../lauf-app
$appUrl  = $scheme . '://' . $host . rtrim($appBase, '/');

// ---------------------------------------------------------------------------
// Hilfsfunktionen für RFC-5545-konforme Ausgabe.
// ---------------------------------------------------------------------------

/** Escaped Sonderzeichen in TEXT-Werten (Backslash, Komma, Semikolon, Newline). */
function ics_escape(string $text): string
{
    $text = str_replace('\\', '\\\\', $text);
    $text = str_replace(["\r\n", "\r", "\n"], '\\n', $text);
    $text = str_replace(',', '\\,', $text);
    $text = str_replace(';', '\\;', $text);
    return $text;
}

/**
 * Line-Folding nach RFC 5545: Zeilen dürfen max. 75 Oktette lang sein.
 * Wir falten konservativ bei ~73 Bytes und brechen nie innerhalb eines
 * UTF-8-Mehrbyte-Zeichens um.
 */
function ics_fold(string $line): string
{
    $out = '';
    $len = strlen($line);
    $count = 0;
    for ($i = 0; $i < $len; $i++) {
        $byte = $line[$i];
        // Anfang eines UTF-8-Zeichens erkennen (kein Continuation-Byte 10xxxxxx).
        $isCharStart = (ord($byte) & 0xC0) !== 0x80;
        if ($count >= 73 && $isCharStart) {
            $out .= "\r\n ";   // Fortsetzungszeile beginnt mit einem Space.
            $count = 1;
        }
        $out .= $byte;
        $count++;
    }
    return $out;
}

/** Lokale Zeit (Zone laut ics_timezone()) als YYYYMMDDTHHMMSS für DTSTART;TZID=... */
function dt_local(string $date, string $time): string
{
    [$h, $m] = array_pad(explode(':', $time), 2, '00');
    $d = preg_replace('/[^0-9]/', '', $date);   // 2026-10-25 -> 20261025
    return sprintf('%sT%02d%02d00', $d, (int) $h, (int) $m);
}

/** UTC-Zeitstempel als YYYYMMDDTHHMMSSZ (für DTSTAMP). */
function dt_utc_now(): string
{
    return gmdate('Ymd\THis\Z');
}

/** Default-Startzeit je Trainingstyp (HH:MM, lokale Zeit). */
function default_time(string $type): string
{
    return match ($type) {
        'race'           => '10:00',
        'long'           => '09:00',
        'cross_bike'     => '09:30',
        'cross_football' => '19:30',
        'cross'          => '18:30',
        'strength'       => '18:00',
        'mobility'       => '20:00',
        default          => '18:00',   // easy, recovery, tempo, interval ...
    };
}

/** Geschätzte Dauer (Minuten) einer Einheit aus Distanz/Pace bzw. Default. */
function estimate_minutes(object $u): int
{
    if (!empty($u->targetDurationMin)) {
        return (int) round((float) $u->targetDurationMin);
    }
    // Programmeinheiten aus früheren Versionen: Dauer im Feld `dur`.
    if (!empty($u->dur)) {
        return (int) round((float) $u->dur);
    }
    $dist = isset($u->targetDistanceKm) ? (float) $u->targetDistanceKm : 0.0;
    $pace = 0.0;
    if (!empty($u->targetPaceSecPerKm)) {
        $pace = (float) $u->targetPaceSecPerKm;
        if (!empty($u->targetPaceMaxSecPerKm)) {
            $pace = ((float) $u->targetPaceSecPerKm + (float) $u->targetPaceMaxSecPerKm) / 2.0;
        }
    }
    if ($dist > 0 && $pace > 0) {
        return (int) max(10, round($dist * $pace / 60.0));
    }
    return 60;
}

/** Zielzeit "HH:MM:SS" -> Minuten. */
function targettime_minutes(?string $t): int
{
    if (!$t) {
        return 120;
    }
    $p = array_map('intval', explode(':', $t));
    $p = array_pad($p, 3, 0);
    return (int) max(10, round(($p[0] * 3600 + $p[1] * 60 + $p[2]) / 60));
}

// ---------------------------------------------------------------------------
// VEVENT-Bausteine erzeugen.
// ---------------------------------------------------------------------------

/** Baut ein VEVENT für eine geplante Trainingseinheit. */
function vevent_unit(object $u, ?object $event, string $appUrl, string $host, string $lang): array
{
    $type = $u->type ?? 'easy';
    $time = !empty($u->time) ? (string) $u->time : default_time($type);
    $mins = estimate_minutes($u);

    $title = $u->title ?? server_text($lang, 'ics.training');
    $summary = $title;

    // DESCRIPTION mit Zielwerten + Deep-Link in die App.
    $descParts = [];
    if (!empty($u->description)) {
        $descParts[] = (string) $u->description;
    } elseif (!empty($u->desc)) {
        $descParts[] = (string) $u->desc;   // Programmeinheit aus früheren Versionen
    }
    if (!empty($u->targetDistanceKm)) {
        $descParts[] = server_text($lang, 'ics.distance', ['km' => server_number((float) $u->targetDistanceKm, 1, $lang)]);
    }
    if (!empty($u->targetPaceSecPerKm)) {
        $pmin = sec_to_pace((int) $u->targetPaceSecPerKm);
        $pmax = !empty($u->targetPaceMaxSecPerKm) ? '–' . sec_to_pace((int) $u->targetPaceMaxSecPerKm) : '';
        $descParts[] = server_text($lang, 'ics.pace', ['pace' => $pmin . $pmax]);
    }
    if (!empty($u->targetHrZone)) {
        $descParts[] = server_text($lang, 'ics.hrZone', ['zone' => (int) $u->targetHrZone]);
    }
    $descParts[] = '';
    $descParts[] = server_text($lang, 'ics.openInApp', ['url' => $appUrl . '/#/session/' . ($u->id ?? '')]);
    $description = implode("\n", $descParts);

    $location = $event->location ?? '';

    $lines = [];
    $lines[] = 'BEGIN:VEVENT';
    $lines[] = 'UID:' . ($u->id ?? uniqid('u', true)) . '@' . $host;
    $lines[] = 'DTSTAMP:' . dt_utc_now();
    $lines[] = 'DTSTART;TZID=' . ics_timezone() . ':' . dt_local((string) $u->date, $time);
    $lines[] = 'DURATION:PT' . $mins . 'M';
    $lines[] = 'SUMMARY:' . ics_escape($summary);
    $lines[] = 'DESCRIPTION:' . ics_escape($description);
    if ($location !== '') {
        $lines[] = 'LOCATION:' . ics_escape($location);
    }
    $lines[] = 'CATEGORIES:' . ics_escape(server_text($lang, 'ics.training'));
    // Erinnerung 1 Stunde vorher.
    $lines = array_merge($lines, valarm('-PT1H', server_text($lang, 'ics.alarmHour', ['title' => $summary])));
    // Erinnerung am Vorabend (gleiche Uhrzeit, ein Tag vorher).
    $lines = array_merge($lines, valarm('-P1D', server_text($lang, 'ics.alarmTomorrow', ['title' => $summary])));
    $lines[] = 'END:VEVENT';
    return $lines;
}

/** Baut ein VEVENT für den Wettkampf selbst. */
function vevent_race(object $event, string $appUrl, string $host, string $lang): array
{
    $time = '10:00';
    $mins = targettime_minutes($event->targetTime ?? null) + 30; // Puffer
    $summary = '🏁 ' . ($event->name ?? server_text($lang, 'ics.race'));

    $desc = [];
    $desc[] = isset($event->distanceKm)
        ? server_text($lang, 'ics.raceDistanceKm', ['distance' => $event->distanceType ?? '', 'km' => server_number((float) $event->distanceKm, 2, $lang)])
        : server_text($lang, 'ics.raceDistance', ['distance' => $event->distanceType ?? '']);
    if (!empty($event->targetTime)) {
        $desc[] = server_text($lang, 'ics.targetTime', ['time' => $event->targetTime]);
    }
    if (!empty($event->priority)) {
        $desc[] = server_text($lang, 'ics.priority', ['priority' => $event->priority]);
    }
    $desc[] = '';
    $desc[] = server_text($lang, 'ics.openInApp', ['url' => $appUrl . '/#/event/' . ($event->id ?? '')]);
    $description = implode("\n", $desc);

    $lines = [];
    $lines[] = 'BEGIN:VEVENT';
    $lines[] = 'UID:race-' . ($event->id ?? uniqid('e', true)) . '@' . $host;
    $lines[] = 'DTSTAMP:' . dt_utc_now();
    $lines[] = 'DTSTART;TZID=' . ics_timezone() . ':' . dt_local((string) $event->date, $time);
    $lines[] = 'DURATION:PT' . $mins . 'M';
    $lines[] = 'SUMMARY:' . ics_escape($summary);
    $lines[] = 'DESCRIPTION:' . ics_escape($description);
    if (!empty($event->location)) {
        $lines[] = 'LOCATION:' . ics_escape((string) $event->location);
    }
    $lines[] = 'CATEGORIES:' . ics_escape(server_text($lang, 'ics.race'));
    $lines = array_merge($lines, valarm('-PT2H', server_text($lang, 'ics.alarmRace')));
    $lines = array_merge($lines, valarm('-P1D', server_text($lang, 'ics.alarmRaceTomorrow', ['name' => $event->name ?? ''])));
    $lines[] = 'END:VEVENT';
    return $lines;
}

/** Erzeugt einen VALARM-Block (Anzeige-Erinnerung). */
function valarm(string $trigger, string $text): array
{
    return [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:' . $trigger,
        'DESCRIPTION:' . ics_escape($text),
        'END:VALARM',
    ];
}

/** Sekunden/km -> "m:ss". */
function sec_to_pace(int $sec): string
{
    $m = intdiv($sec, 60);
    $s = $sec % 60;
    return sprintf('%d:%02d', $m, $s);
}

// ---------------------------------------------------------------------------
// Einheiten je nach Scope sammeln.
// ---------------------------------------------------------------------------
$body = [];
$filename = 'training.ics';
/** File name in the person's language (ASCII only – it goes into a header). */
$fileName = static fn(string $kind): string =>
    (trim((string) preg_replace('/[^A-Za-z0-9_-]+/', '-', server_text($lang, 'ics.file.' . $kind)), '-') ?: $kind) . '-' . $id . '.ics';

if ($scope === 'session') {
    // Einzelne geplante Einheit in allen Plänen suchen.
    $unit = null;
    $event = null;
    foreach ($plans as $p) {
        foreach (($p->units ?? []) as $u) {
            if (($u->id ?? '') === $id) {
                $unit = $u;
                $event = find_event($events, $p->eventId ?? '');
                break 2;
            }
        }
    }
    if ($unit === null) {
        $icsError(404, 'ics.error.unitNotFound');
    }
    $body = vevent_unit($unit, $event, $appUrl, $host, $lang);
    $filename = $fileName('session');
} elseif ($scope === 'race') {
    $event = find_event($events, $id);
    if ($event === null) {
        $icsError(404, 'ics.error.eventNotFound');
    }
    $body = vevent_race($event, $appUrl, $host, $lang);
    $filename = $fileName('race');
} else {
    // scope=event: kompletter Plan + Wettkampf.
    $event = find_event($events, $id);
    foreach ($plans as $p) {
        if (($p->eventId ?? '') === $id) {
            foreach (($p->units ?? []) as $u) {
                // Ruhetage nicht in den Kalender exportieren.
                if (($u->type ?? '') === 'rest') {
                    continue;
                }
                $body = array_merge($body, vevent_unit($u, $event, $appUrl, $host, $lang));
            }
        }
    }
    if ($event !== null) {
        $body = array_merge($body, vevent_race($event, $appUrl, $host, $lang));
    }
    $filename = $fileName('plan');
}

// ---------------------------------------------------------------------------
// VCALENDAR zusammensetzen und ausgeben.
// ---------------------------------------------------------------------------
$cal = [];
$cal[] = 'BEGIN:VCALENDAR';
$cal[] = 'VERSION:2.0';
$cal[] = 'PRODID:-//Cat-O-Fit//Lauftraining//DE';
$cal[] = 'CALSCALE:GREGORIAN';
$cal[] = 'METHOD:PUBLISH';
$cal[] = 'X-WR-CALNAME:' . ics_escape(server_text($lang, 'ics.calendarName'));
// VTIMEZONE der Kalender-Zone (Europe/Berlin byte-gleich wie bisher, andere Zonen je
// Umstellung im Zeitraum vom Vorjahr bis zwei Jahre voraus).
$cal = array_merge($cal, vtimezone_lines(ics_timezone(), (int) gmdate('Y') - 1, (int) gmdate('Y') + 2));
$cal = array_merge($cal, $body);
$cal[] = 'END:VCALENDAR';

// Jede Zeile falten und mit CRLF verbinden (RFC 5545).
$output = '';
foreach ($cal as $line) {
    $output .= ics_fold($line) . "\r\n";
}

header('Content-Type: text/calendar; charset=utf-8', true);
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-store');
echo $output;
exit;
