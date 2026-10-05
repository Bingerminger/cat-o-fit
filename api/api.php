<?php
/**
 * api.php — schlanke REST-artige API für Cat-O-Fit.
 *
 * Endpunkte (alle relativ zu /api/api.php):
 *   GET  ?action=changes&area=<a>&user=<u>&since=<rev>  -> geänderte Datensätze
 *   POST ?action=ops&area=<a>&user=<u>   (Body {ops:[…]}) -> Operationen anwenden
 *   GET  ?area=<bereich>            -> logische Sicht (Liste/Objekt) – Debug/Kompat
 *   GET  ?action=ping              -> Health-Check der API (mit apiVersion)
 *   GET  ?action=ics&...           -> .ics-Kalenderexport (siehe ics.php)
 *   POST ?action=health-import     -> Apple-Health-Export importieren (siehe health-import.php)
 *   POST ?action=health-ingest     -> automatischer Health-Eingang (Token, siehe health-ingest.php)
 *   GET  ?action=changes-all&user=<u>&since=<a>:<rev>,… -> Änderungen mehrerer Bereiche auf einmal
 *   GET  ?action=read&user=<u>     -> Lesezugang für eigene Werkzeuge (Token, siehe read-access.php)
 *   POST ?action=delete-user&user= -> Datenverzeichnis eines Nutzers löschen (Admin-Sitzung)
 *   POST ?action=login   {user,pin}       -> Server-Sitzung nach PIN-Prüfung (Cookie)
 *   POST ?action=logout                   -> Sitzung beenden
 *   GET  ?action=session                  -> {user, role} der laufenden Sitzung
 *   POST ?action=set-pin {user,pin,old?}  -> PIN ändern (eigene mit alter PIN, fremde als Admin)
 *   POST ?action=ics-token {user,rotate?} -> Schlüssel für Kalender-Links
 *
 * Die App ist "local-first": Das Frontend speichert sofort lokal und
 * synchronisiert im Hintergrund. Seit v3.0.0 ist der SERVER die Merge-Autorität:
 * Clients schicken Operationen, der Server vergibt eine monotone `rev` je
 * Datensatz (siehe storage.php). Seit v3.20.0 gibt der Server die privaten
 * Bereiche (Zyklus, Labor, Ergänzungen) nur an die angemeldete Person selbst
 * heraus (siehe auth.php); alle anderen Bereiche bleiben im Heimnetz-Modell.
 */

declare(strict_types=1);

require __DIR__ . '/storage.php';
require __DIR__ . '/auth.php';

/** Version der Schnittstelle (docs/SCHNITTSTELLEN.md). Nur bei inkompatiblen Änderungen erhöhen. */
const API_VERSION = 1;
/** Additive Fähigkeiten (ältere Clients ignorieren sie): Sammelabruf, „since“ in der ops-Antwort. */
const API_FEATURES = ['changes-all', 'ops-since'];

// ---------------------------------------------------------------------------
// Header: JSON-Antworten, kein Caching der dynamischen Daten.
// (Gleicher Origin: Die App liegt auf derselben Synology -> kein CORS nötig.)
// ---------------------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

/** Einheitliche JSON-Antwort + sauberer Abbruch. */
function respond(mixed $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Error response in the uniform format. `code` is the stable, machine-readable reason; the app
 * translates it (server.<code> in locales/<lang>/ui.json, placeholders filled from the other
 * fields). The English `error` text is only a fallback for API clients.
 */
function fail(string $message, int $status = 400, ?string $code = null, array $extra = []): never
{
    respond(['ok' => false, 'error' => $message] + ($code !== null ? ['code' => $code] : []) + $extra, $status);
}

// ---------------------------------------------------------------------------
// Optionale Host-Prüfung gegen DNS-Rebinding: CATOFIT_ALLOWED_HOSTS="nas.local,fit.example.org"
// (ohne Variable wie bisher jeder Host). Loopback bleibt immer erlaubt (Healthcheck).
// ---------------------------------------------------------------------------
$allowedHosts = trim((string) (getenv('CATOFIT_ALLOWED_HOSTS') ?: ($_SERVER['CATOFIT_ALLOWED_HOSTS'] ?? '')));
if ($allowedHosts !== '') {
    $reqHost = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $bareHost = (string) preg_replace('/:\d+$/', '', $reqHost);
    $allowed = array_filter(array_map(static fn($h) => strtolower(trim($h)), explode(',', $allowedHosts)));
    $allowed = array_merge($allowed, ['localhost', '127.0.0.1', '[::1]']);
    if (!in_array($reqHost, $allowed, true) && !in_array($bareHost, $allowed, true)) {
        fail('Unknown host.', 421, 'host');
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$area   = isset($_GET['area']) ? (string) $_GET['area'] : '';
$scope  = (isset($_GET['scope']) && $_GET['scope'] === 'family') ? 'family' : 'user';
$user   = isset($_GET['user']) ? (string) $_GET['user'] : null;

/** Zustandsändernde Aufrufe: nur als JSON und nicht von fremden Seiten (CSRF). */
function require_write_request(): void
{
    if (request_cross_site()) {
        fail('Request from another site rejected.', 403, 'origin');
    }
    if (!request_is_json()) {
        fail('Expected Content-Type application/json.', 415, 'content-type');
    }
}

function require_post(string $action, string $method): void
{
    if ($method !== 'POST') {
        fail("{$action} expects POST.", 405, 'method_not_allowed', ['action' => $action, 'expected' => 'POST']);
    }
}

/** Gültige Sitzung oder 401. */
function require_session(): array
{
    $s = current_session();
    if ($s === null) {
        fail('Please sign in – the sign-in at the server is missing or has expired.', 401, 'session');
    }
    return $s;
}

// ---------------------------------------------------------------------------
// Sonderaktionen vor der generischen Bereichs-API.
// ---------------------------------------------------------------------------
if ($action === 'ping') {
    respond(['ok' => true, 'pong' => true, 'apiVersion' => API_VERSION, 'features' => API_FEATURES, 'time' => date('c'), 'php' => (string) PHP_MAJOR_VERSION]);
}

if ($action === 'session') {
    $s = current_session();
    respond(['ok' => true, 'user' => $s['user'] ?? null, 'role' => $s['role'] ?? null]);
}

if ($action === 'login') {
    require_post('login', $method);
    require_write_request();
    ensure_bootstrap();
    $body = request_json();
    $uid = (string) ($body['user'] ?? '');
    $pin = (string) ($body['pin'] ?? '');
    if (!is_valid_user($uid)) {
        fail('Invalid user ID.', 400, 'invalid_user');
    }
    $member = family_member($uid);
    if ($member === null) {
        fail('This profile does not exist (any more).', 404, 'unknown');
    }
    if (member_has_pin($member)) {
        $wait = fails_locked($uid);
        if ($wait > 0) {
            fail('Too many failed attempts – please wait a moment.', 429, 'locked', ['retryAfter' => $wait]);
        }
        if (!pin_matches($member, $uid, $pin)) {
            $left = fails_register($uid);
            if ($left > 0) {
                fail('Wrong PIN.', 401, 'pin', ['left' => $left]);
            }
            fail('Too many failed attempts – please wait a moment.', 429, 'locked', ['retryAfter' => fails_locked($uid)]);
        }
        fails_reset($uid);
    }
    $previous = session_token();
    if ($previous !== '') {
        @unlink(session_path($previous));   // Wechsel der Person im selben Browser
    }
    session_create($uid);
    respond([
        'ok' => true, 'user' => $uid,
        'role' => ($member['role'] ?? 'user') === 'admin' ? 'admin' : 'user',
        'weakPin' => !member_has_pin($member) || $pin === '0000',
    ]);
}

if ($action === 'logout') {
    require_post('logout', $method);
    require_write_request();
    session_end();
    respond(['ok' => true]);
}

if ($action === 'set-pin') {
    require_post('set-pin', $method);
    require_write_request();
    $session = require_session();
    $body = request_json();
    $uid = (string) ($body['user'] ?? '');
    $pin = (string) ($body['pin'] ?? '');
    if (!is_valid_user($uid)) {
        fail('Invalid user ID.', 400, 'invalid_user');
    }
    $member = family_member($uid);
    if ($member === null) {
        fail('This profile does not exist (any more).', 404, 'unknown');
    }
    $self = $session['user'] === $uid;
    if ($self) {
        // Die eigene PIN nur mit der bisherigen ändern (fremde, offene Sitzung am geteilten Gerät).
        if (member_has_pin($member)) {
            $wait = fails_locked($uid);
            if ($wait > 0) {
                fail('Too many failed attempts – please wait a moment.', 429, 'locked', ['retryAfter' => $wait]);
            }
            if (!pin_matches($member, $uid, (string) ($body['old'] ?? ''))) {
                $left = fails_register($uid);
                fail('The current PIN is wrong.', 401, 'pin', ['left' => $left]);
            }
        }
    } elseif ($session['role'] !== 'admin') {
        fail("Only an admin can set another person's PIN.", 403, 'admin');
    }
    if (!valid_new_pin($pin)) {
        fail('The PIN needs 4 to 8 digits and must not be 0000.', 400, 'weak');
    }
    set_member_pin_hash($uid, pin_hash($uid, $pin));
    fails_reset($uid);
    // Andere Sitzungen dieser Person beenden (die eigene laufende bleibt).
    sessions_delete_user($uid, $self ? $session['token'] : null);
    respond(['ok' => true]);
}

if ($action === 'ics-token') {
    require_post('ics-token', $method);
    require_write_request();
    $session = require_session();
    $body = request_json();
    $uid = (string) ($body['user'] ?? '');
    if (!is_valid_user($uid) || family_member($uid) === null) {
        fail('This profile does not exist (any more).', 404, 'unknown');
    }
    if ($session['user'] !== $uid && $session['role'] !== 'admin') {
        fail('Only an admin can create calendar links for other people.', 403, 'admin');
    }
    try {
        respond(['ok' => true, 'token' => ics_token($uid, !empty($body['rotate']))]);
    } catch (Throwable $e) {
        fail('Server error: ' . $e->getMessage(), 500, 'server_error', ['detail' => $e->getMessage()]);
    }
}

if ($action === 'ics') {
    // Kalenderexport übernimmt eigene Header (text/calendar) -> hier abgeben.
    require __DIR__ . '/ics.php';
    exit;
}

if ($action === 'foodfacts') {
    // Open-Food-Facts-Nährwert-Proxy mit lokalem Cache (siehe foodfacts.php).
    require __DIR__ . '/foodfacts.php';
    exit;
}

if ($action === 'health-import') {
    require_post('health-import', $method);
    // Datei-Upload (multipart) – nur aus der eigenen App mit gültiger Anmeldung.
    if (request_cross_site()) {
        fail('Request from another site rejected.', 403, 'origin');
    }
    $session = require_session();
    require __DIR__ . '/health-import.php';
    exit;
}

if ($action === 'health-ingest') {
    // Automatischer, inkrementeller Health-Eingang (App „Health Auto Export", per Token).
    require_post('health-ingest', $method);
    require __DIR__ . '/health-ingest.php';
    exit;
}

if ($action === 'read') {
    // Lesezugang für eigene Werkzeuge (per Schlüssel, standardmäßig aus; siehe read-access.php).
    if ($method !== 'GET') {
        fail('read expects GET.', 405, 'method_not_allowed', ['action' => 'read', 'expected' => 'GET']);
    }
    require __DIR__ . '/read-access.php';
    exit;
}

if ($action === 'delete-user') {
    require_post('delete-user', $method);
    require_write_request();
    $session = require_session();
    if ($session['role'] !== 'admin') {
        fail('Only an admin can delete members.', 403, 'admin');
    }
    if ($user === null || !is_valid_user($user)) {
        fail('Invalid or missing user ID.', 400, 'invalid_or_missing_user');
    }
    try {
        delete_user($user);
        sessions_delete_user($user);
        fails_reset($user);
        respond(['ok' => true, 'deleted' => $user]);
    } catch (Throwable $e) {
        fail('Deleting failed: ' . $e->getMessage(), 500, 'delete_failed', ['detail' => $e->getMessage()]);
    }
}

// ---------------------------------------------------------------------------
// Sammelabruf: Änderungen mehrerer Bereiche einer Person in EINER Antwort (statt je
// Bereich eine Anfrage – unterwegs zählt jede Latenz 13-mal).
//   GET ?action=changes-all&user=<id>&since=sessions:120,health:55,plans:0
// Nur die genannten Bereiche; dieselben Regeln wie beim Einzelabruf: Private Bereiche
// gibt es nur mit der eigenen Sitzung – sonst stehen sie unter „locked“. Antwort:
//   { ok, revs: {bereich: rev}, changes: {bereich: [datensätze]}, locked: [bereiche] }
// Der Einzelabruf (?area=…&action=changes) bleibt unverändert; „ping“ meldet die Fähigkeit.
// ---------------------------------------------------------------------------
if ($action === 'changes-all') {
    if ($method !== 'GET') {
        fail('changes-all expects GET.', 405, 'method_not_allowed', ['action' => 'changes-all', 'expected' => 'GET']);
    }
    ensure_bootstrap();
    if ($user === null || !is_valid_user($user)) {
        fail('Invalid or missing user ID.', 400, 'invalid_or_missing_user');
    }
    $since = [];
    foreach (explode(',', (string) ($_GET['since'] ?? '')) as $pair) {
        if (preg_match('/^([a-z]+):(\d{1,12})$/', trim($pair), $m) && is_valid_area($m[1], 'user')) {
            $since[$m[1]] = (int) $m[2];
        }
    }
    if (!$since) {
        fail('Parameter "since" is missing (e.g. since=sessions:0,health:0).', 400, 'missing_since');
    }
    $sess = current_session();
    $own = $sess !== null && ($sess['user'] ?? null) === $user;
    $revs = [];
    $changes = [];
    $locked = [];
    try {
        foreach ($since as $a => $rev) {
            if (in_array($a, PRIVATE_AREAS, true) && !$own) { $locked[] = $a; continue; }
            $res = changes_since($a, 'user', $user, $rev);
            $revs[$a] = $res['rev'];
            if ($res['records']) $changes[$a] = $res['records'];
        }
    } catch (Throwable $e) {
        fail('Server error: ' . $e->getMessage(), 500, 'server_error', ['detail' => $e->getMessage()]);
    }
    respond(['ok' => true, 'revs' => (object) $revs, 'changes' => (object) $changes, 'locked' => $locked]);
}

// ---------------------------------------------------------------------------
// Bereichs-API (Operationen/Änderungen, nutzerbezogen oder familienweit).
// ---------------------------------------------------------------------------
// Einmalige Migration alter Single-User-Daten zur ersten Familie sicherstellen.
ensure_bootstrap();

if ($area === '') {
    fail('Parameter "area" or "action" is missing.', 400, 'missing_area');
}
if (!is_valid_area($area, $scope)) {
    fail("Unknown area: {$area}", 404, 'unknown_area', ['area' => $area]);
}

// Private Bereiche: lesen und schreiben nur die angemeldete Person selbst.
if ($scope === 'user' && in_array($area, PRIVATE_AREAS, true)) {
    $session = require_session();
    if ($user === null || $session['user'] !== $user) {
        fail('This area is private.', 403, 'private');
    }
}

try {
    // Inkrementelle Änderungen holen: ?action=changes&since=<rev>
    if ($action === 'changes') {
        if ($method !== 'GET') {
            fail('changes expects GET.', 405, 'method_not_allowed', ['action' => 'changes', 'expected' => 'GET']);
        }
        $since = isset($_GET['since']) ? max(0, (int) $_GET['since']) : 0;
        $res = changes_since($area, $scope, $user, $since);
        $records = $scope === 'family' ? array_map('public_family_record', $res['records']) : $res['records'];
        respond(['ok' => true, 'area' => $area, 'rev' => $res['rev'], 'records' => $records]);
    }

    // Operationen anwenden: ?action=ops  (Body {ops:[…]})
    if ($action === 'ops') {
        require_post('ops', $method);
        require_write_request();
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            fail('Empty request body.', 400, 'empty_body');
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['ops']) || !is_array($decoded['ops'])) {
            fail('Expected {"ops": [...]}.', 400, 'invalid_ops');
        }
        if (count($decoded['ops']) > 2000) {
            fail('Too many operations in one batch.', 413, 'too_many_ops');
        }
        $guard = null;
        if ($scope === 'family') {
            $session = current_session();
            $guard = static fn(array $op, array $store) => family_guard($op, $store, $session);
        }
        $res = apply_ops($area, $scope, $user, $decoded['ops'], $guard);
        $records = $scope === 'family' ? array_map('public_family_record', $res['records']) : $res['records'];
        $out = ['ok' => true, 'area' => $area, 'rev' => $res['rev'], 'records' => $records];
        if (!empty($res['rejected'])) {
            $out['rejected'] = array_map('family_rejection', $res['rejected']);
        }
        // Optional (additiv): Mit {"since": <rev>} kommen alle Änderungen seit dieser rev mit –
        // eigene und fremde. Der anschließende Abruf entfällt dann.
        if (isset($decoded['since']) && is_int($decoded['since']) && $decoded['since'] >= 0) {
            $ch = changes_since($area, $scope, $user, $decoded['since']);
            $out['changes'] = ['rev' => $ch['rev'], 'records' => $scope === 'family' ? array_map('public_family_record', $ch['records']) : $ch['records']];
        }
        respond($out);
    }

    // Debug/Kompatibilität: logische Sicht eines Bereichs.
    if ($method === 'GET') {
        $data = load_area($area, $scope, $user);
        if ($scope === 'family' && is_object($data) && isset($data->members) && is_array($data->members)) {
            $data->members = array_map(static fn($m) => public_family_record((array) $m), $data->members);
        }
        respond(['ok' => true, 'area' => $area, 'data' => $data]);
    }

    fail('Unknown action. Use ?action=changes (GET) or ?action=ops (POST).', 400, 'unknown_action');
} catch (Throwable $e) {
    fail('Server error: ' . $e->getMessage(), 500, 'server_error', ['detail' => $e->getMessage()]);
}
