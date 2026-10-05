<?php
/**
 * ics.php — server-side generation of iCalendar files (RFC 5545).
 *
 * Included by api.php for ?action=ics. Delivers an .ics file
 * for download that can be imported into the iOS Calendar (incl. VALARM
 * as a reliable reminder on iPhone/iPad).
 *
 * Calls (the user=<id> parameter is mandatory in multi-user operation,
 * `token` is the member's calendar key, see ?action=ics-token):
 *   ?action=ics&scope=event&id=<eventId>&user=<id>&token=<t>   -> complete plan (all sessions + race)
 *   ?action=ics&scope=session&id=<unitId>&user=<id>&token=<t>  -> a single planned session
 *   ?action=ics&scope=race&id=<eventId>&user=<id>&token=<t>    -> the race itself only
 *
 * Source of the data: data/users/<id>/plans.json and .../events.json (per member),
 * loaded via load_area('…','user',$user). The client (ics-export.js) passes
 * store.activeUserId() for this.
 */

declare(strict_types=1);

// storage.php/auth.php are already loaded via api.php; ensure it again, defensively.
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

// Access (since v3.20.0): calendar links carry a key per member
// (`token`, see ?action=ics-token) – they open outside the app without a
// session cookie. Inside the app the person's own session (or that of an
// admin person) is enough as well. Links without a key from older versions remain valid until
// ICS_LEGACY_UNTIL; after that the appointment has to be exported from the app once more.
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

/** Finds an event object by its ID. */
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
// Derive the app base URL for deep links back into the session view.
// ---------------------------------------------------------------------------
$scheme  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
// Accept the host only in a plausible form (it flows into deep links and the UID).
$host    = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
if (preg_match('/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/', $host) !== 1) {
    $host = 'localhost';
}
$scriptDir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/api.php'));
$appBase = preg_replace('#/api/?$#', '', $scriptDir);   // .../lauf-app
$appUrl  = $scheme . '://' . $host . rtrim($appBase, '/');

// ---------------------------------------------------------------------------
// Helper functions for RFC 5545-compliant output.
// ---------------------------------------------------------------------------

/** Escapes special characters in TEXT values (backslash, comma, semicolon, newline). */
function ics_escape(string $text): string
{
    $text = str_replace('\\', '\\\\', $text);
    $text = str_replace(["\r\n", "\r", "\n"], '\\n', $text);
    $text = str_replace(',', '\\,', $text);
    $text = str_replace(';', '\\;', $text);
    return $text;
}

/**
 * Line folding per RFC 5545: lines may be at most 75 octets long.
 * We fold conservatively at ~73 bytes and never break inside a
 * multi-byte UTF-8 character.
 */
function ics_fold(string $line): string
{
    $out = '';
    $len = strlen($line);
    $count = 0;
    for ($i = 0; $i < $len; $i++) {
        $byte = $line[$i];
        // Detect the start of a UTF-8 character (no continuation byte 10xxxxxx).
        $isCharStart = (ord($byte) & 0xC0) !== 0x80;
        if ($count >= 73 && $isCharStart) {
            $out .= "\r\n ";   // The continuation line starts with a space.
            $count = 1;
        }
        $out .= $byte;
        $count++;
    }
    return $out;
}

/** Local time (zone per ics_timezone()) as YYYYMMDDTHHMMSS for DTSTART;TZID=... */
function dt_local(string $date, string $time): string
{
    [$h, $m] = array_pad(explode(':', $time), 2, '00');
    $d = preg_replace('/[^0-9]/', '', $date);   // 2026-10-25 -> 20261025
    return sprintf('%sT%02d%02d00', $d, (int) $h, (int) $m);
}

/** UTC timestamp as YYYYMMDDTHHMMSSZ (for DTSTAMP). */
function dt_utc_now(): string
{
    return gmdate('Ymd\THis\Z');
}

/** Default start time per training type (HH:MM, local time). */
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

/** Estimated duration (minutes) of a session from distance/pace, or the default. */
function estimate_minutes(object $u): int
{
    if (!empty($u->targetDurationMin)) {
        return (int) round((float) $u->targetDurationMin);
    }
    // Programme sessions from earlier versions: duration in the field `dur`.
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

/** Target time "HH:MM:SS" -> minutes. */
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
// Create the VEVENT building blocks.
// ---------------------------------------------------------------------------

/** Builds a VEVENT for a planned training session. */
function vevent_unit(object $u, ?object $event, string $appUrl, string $host, string $lang): array
{
    $type = $u->type ?? 'easy';
    $time = !empty($u->time) ? (string) $u->time : default_time($type);
    $mins = estimate_minutes($u);

    $title = $u->title ?? server_text($lang, 'ics.training');
    $summary = $title;

    // DESCRIPTION with target values + deep link into the app.
    $descParts = [];
    if (!empty($u->description)) {
        $descParts[] = (string) $u->description;
    } elseif (!empty($u->desc)) {
        $descParts[] = (string) $u->desc;   // programme session from earlier versions
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
    // Reminder 1 hour before.
    $lines = array_merge($lines, valarm('-PT1H', server_text($lang, 'ics.alarmHour', ['title' => $summary])));
    // Reminder the evening before (same time of day, one day earlier).
    $lines = array_merge($lines, valarm('-P1D', server_text($lang, 'ics.alarmTomorrow', ['title' => $summary])));
    $lines[] = 'END:VEVENT';
    return $lines;
}

/** Builds a VEVENT for the race itself. */
function vevent_race(object $event, string $appUrl, string $host, string $lang): array
{
    $time = '10:00';
    $mins = targettime_minutes($event->targetTime ?? null) + 30; // buffer
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

/** Creates a VALARM block (display reminder). */
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

/** Seconds/km -> "m:ss". */
function sec_to_pace(int $sec): string
{
    $m = intdiv($sec, 60);
    $s = $sec % 60;
    return sprintf('%d:%02d', $m, $s);
}

// ---------------------------------------------------------------------------
// Collect the sessions depending on the scope.
// ---------------------------------------------------------------------------
$body = [];
$filename = 'training.ics';
/** File name in the person's language (ASCII only – it goes into a header). */
$fileName = static fn(string $kind): string =>
    (trim((string) preg_replace('/[^A-Za-z0-9_-]+/', '-', server_text($lang, 'ics.file.' . $kind)), '-') ?: $kind) . '-' . $id . '.ics';

if ($scope === 'session') {
    // Look up a single planned session across all plans.
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
    // scope=event: complete plan + race.
    $event = find_event($events, $id);
    foreach ($plans as $p) {
        if (($p->eventId ?? '') === $id) {
            foreach (($p->units ?? []) as $u) {
                // Do not export rest days to the calendar.
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
// Assemble the VCALENDAR and output it.
// ---------------------------------------------------------------------------
$cal = [];
$cal[] = 'BEGIN:VCALENDAR';
$cal[] = 'VERSION:2.0';
$cal[] = 'PRODID:-//Cat-O-Fit//Lauftraining//DE';
$cal[] = 'CALSCALE:GREGORIAN';
$cal[] = 'METHOD:PUBLISH';
$cal[] = 'X-WR-CALNAME:' . ics_escape(server_text($lang, 'ics.calendarName'));
// VTIMEZONE of the calendar zone (Europe/Berlin byte-identical to before, other zones per
// transition in the period from the previous year to two years ahead).
$cal = array_merge($cal, vtimezone_lines(ics_timezone(), (int) gmdate('Y') - 1, (int) gmdate('Y') + 2));
$cal = array_merge($cal, $body);
$cal[] = 'END:VCALENDAR';

// Fold every line and join with CRLF (RFC 5545).
$output = '';
foreach ($cal as $line) {
    $output .= ics_fold($line) . "\r\n";
}

header('Content-Type: text/calendar; charset=utf-8', true);
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-store');
echo $output;
exit;
