<?php
/**
 * health-ingest.php — automatic, INCREMENTAL health intake.
 *
 * Receives small JSON payloads from the iOS app "Health Auto Export" (REST API
 * automation, JSON v2), the lean daily format of a Shortcuts template
 * ({ "date": …, "weight": …, … }, see hi_parse_simple) or the arrays of an
 * Android bridge for Health Connect (hi_parse_hcw) – and writes from them
 * SERVER-SIDE into the user's areas:
 *   - health  : one entry per day, merged field by field (weight, resting HR, HRV,
 *               VO₂max, sleep, body fat, lean mass, steps, active energy)
 *   - sessions: workout summaries, deduplicated by HealthKit UUID or start time
 *   - cycle   : period starts, if the source sends them (private area)
 * The client pulls the new values on the next sync – no upload, no
 * client rework. Instead of a 300 MB full export only KB-sized daily data flows.
 *
 * The PURE mapping logic lives in health-map.php (`hi_parse`, no DB – testable,
 * see tools/test-health-ingest.php). Here: auth + merge/dedup + writing.
 *
 * Auth: the endpoint sits behind the site's .htpasswd; IN ADDITION a
 * per-user token (profile.healthToken). Call:
 *   POST api/api.php?action=health-ingest&user=<id>   with header  X-Catofit-Token: <secret>
 * (recommended, the key then ends up in no access log) or – as before –
 *   POST api/api.php?action=health-ingest&user=<id>&token=<secret>
 *
 * Included by api.php (respond()/fail() are available there).
 */
declare(strict_types=1);

require_once __DIR__ . '/health-map.php';

// --- User + token -------------------------------------------------------
$user  = isset($_GET['user']) ? (string) $_GET['user'] : '';
$token = isset($_GET['token']) ? (string) $_GET['token']
       : (string) ($_SERVER['HTTP_X_CATOFIT_TOKEN'] ?? '');

if ($user === '' || !is_valid_user($user)) {
    fail('Invalid or missing user ID.', 400, 'invalid_or_missing_user');
}
$profileStore = read_store('profile', 'user', $user);
$expected = (string) ($profileStore['records']['profile']['healthToken'] ?? '');
if ($expected === '') {
    fail('No health token has been set up for this user yet (app → Health import → Apple Health).', 403, 'no_health_token');
}
if ($token === '' || !hash_equals($expected, $token)) {
    fail('Invalid token.', 401, 'invalid_token');
}

// --- Read body -----------------------------------------------------------
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    fail('Empty request body.', 400, 'empty_body');
}
if (strlen($raw) > 24 * 1024 * 1024) {   // Safety limit; aggregate payloads are KB-sized (use batches).
    fail('Payload too large – turn on "Batch requests" or send shorter periods.', 413, 'payload_too_large');
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    fail('Expected JSON.', 400, 'invalid_json');
}
// Health Auto Export wraps its content under "data"; stay tolerant.
$data = is_array($in['data'] ?? null) ? $in['data'] : $in;

// --- Pure conversion (health-map.php) ------------------------------------
// Health Connect (Android bridge), lean daily format (Shortcuts, own scripts)
// or Health Auto Export payload.
// Session titles in the person's language.
require_once __DIR__ . '/icstz.php';
$lang = person_language($user);
$parsed = hi_is_hcw($data) ? hi_parse_hcw($data, ics_timezone(), $lang)
    : (hi_is_simple($data) ? hi_parse_simple($data, $lang) : hi_parse($data, $lang));
$ingestSource = $parsed['source'] ?? 'apple-health';

// --- health: merge by date (one entry/day; keep user fields) ---
$now = date('c');
$healthOps = [];
if ($parsed['healthByDate']) {
    $store = read_store('health', 'user', $user);
    $byDate = [];
    foreach ($store['records'] as $rec) {
        if (is_array($rec) && !($rec['deleted'] ?? false) && isset($rec['date'])) $byDate[$rec['date']] = $rec;
    }
    foreach ($parsed['healthByDate'] as $date => $fields) {
        $base = $byDate[$date] ?? ['id' => 'h-' . $date, 'date' => $date, 'createdAt' => $now];
        unset($base['rev'], $base['updatedAt']);
        $merged = array_merge($base, $fields);        // device values overwrite; mood/energy/notes stay
        // Set the origin only for new days or days already imported automatically. A day with
        // a different origin (by hand, demo) keeps it – otherwise the app would read its smart-scale
        // muscle mass as an old Apple "Lean Body Mass", i.e. as lean mass.
        $src = (string) ($base['source'] ?? '');
        $merged['source'] = in_array($src, ['', 'apple-health', 'health', 'health-connect'], true) ? $ingestSource : $src;
        $healthOps[] = ['op' => 'upsert', 'record' => $merged];
    }
}

// --- sessions: dedup per hk UUID + against manually logged sessions -------
$sessionOps = [];
$skippedDup = 0;
if ($parsed['newSessions']) {
    $store = read_store('sessions', 'user', $user);
    $existing = array_values(array_filter($store['records'], fn ($r) => is_array($r) && !($r['deleted'] ?? false)));
    foreach ($parsed['newSessions'] as $id => $s) {
        $isReimport = isset($store['records'][$id]);
        if (!$isReimport) {
            foreach ($existing as $ex) {
                if (($ex['date'] ?? '') !== $s['date']) continue;
                if (strncmp((string) ($ex['id'] ?? ''), 'hk-', 3) === 0) continue;
                $dd = abs((float) ($ex['distanceKm'] ?? 0) - (float) ($s['distanceKm'] ?? 0));
                $dt = abs((int) ($ex['durationSec'] ?? 0) - (int) ($s['durationSec'] ?? 0));
                if ($dd < 0.4 && $dt < 120) { $skippedDup++; continue 2; }   // the manual session wins
            }
        }
        $s['createdAt'] = $store['records'][$id]['createdAt'] ?? $now;
        $sessionOps[] = ['op' => 'upsert', 'record' => $s];
    }
}

// --- cycle: period starts (private area of the person; only what the source sends) ---
$cycleOps = [];
if (!empty($parsed['periods'])) {
    $store = read_store('cycle', 'user', $user);
    $known = [];
    foreach ($store['records'] as $rec) {
        if (is_array($rec) && !($rec['deleted'] ?? false) && empty($rec['_kind']) && isset($rec['startDate'])) $known[] = strtotime((string) $rec['startDate']);
    }
    foreach ($parsed['periods'] as $p) {
        $ts = strtotime($p['start']);
        // Already recorded (also by hand, ± 3 days)? Then the existing entry stays.
        $dup = false;
        foreach ($known as $k) if ($k !== false && abs($k - $ts) <= 3 * 86400) { $dup = true; break; }
        if ($dup) continue;
        $known[] = $ts;
        $cycleOps[] = ['op' => 'upsert', 'record' => [
            'id' => 'cyc-' . $ingestSource . '-' . $p['start'], 'startDate' => $p['start'],
            'periodLength' => max(1, min(10, (int) $p['length'])), 'source' => $ingestSource, 'createdAt' => $now,
        ]];
    }
}

// --- Write (atomic, with rev) ------------------------------------------
if ($healthOps)  apply_ops('health',   'user', $user, $healthOps);
if ($sessionOps) apply_ops('sessions', 'user', $user, $sessionOps);
if ($cycleOps)   apply_ops('cycle',    'user', $user, $cycleOps);

respond([
    'ok' => true,
    'received'       => $parsed['received'],
    'health'         => ['days' => count($healthOps), 'dates' => array_slice(array_keys($parsed['healthByDate']), 0, 10)],
    'sessions'       => ['imported' => count($sessionOps), 'skippedDuplicate' => $skippedDup, 'skippedUnmappedType' => $parsed['skippedUnmappedType']],
    'cycle'          => ['periods' => count($cycleOps)],
    'ignoredMetrics' => $parsed['ignoredMetrics'],   // which metric names are not (yet) mapped
    'warnings'       => $parsed['warnings'],
]);
