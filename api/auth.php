<?php
/**
 * auth.php — server session after PIN verification (since v3.20.0).
 *
 * Deliberately lean and compatible with existing data:
 *  - The server verifies the PIN itself (same hash scheme as before in the client,
 *    including the old djb2 format) and then sets an HttpOnly cookie for this
 *    browser session. Failed attempts are limited per member.
 *  - Only the private areas (cycle, labs, supplements) and admin actions
 *    require a session. All other areas stay in the previous
 *    trust model (home network), so that existing devices keep syncing.
 *  - PIN hashes no longer leave the server: family responses carry only
 *    `hasPin` (plus a placeholder on which older app versions fail,
 *    rather than opening a profile without a PIN).
 *
 * Sessions are stored as small files under data/auth/sessions/ (file name = hash of the
 * cookie value), failed attempts under data/auth/fails/. Included by api.php;
 * uses DATA_DIR and the store functions from storage.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/storage.php';

const PRIVATE_AREAS = ['cycle', 'labs', 'supplements'];
const SESSION_COOKIE = 'catofit_sid';
const SESSION_IDLE_TTL = 30 * 86400;     // Session expires after 30 days without use
const PIN_MAX_FAILS = 5;                 // Failed attempts per member …
const PIN_FAIL_WINDOW = 900;             // … within 15 minutes, then a pause
const PIN_PLACEHOLDER = 'server';        // sent to clients instead of the hash (older apps fail on it)

/** Subdirectory of data/auth (created on demand). */
function auth_dir(string $sub): string
{
    $dir = DATA_DIR . '/auth/' . $sub;
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/* ================================ PIN ===================================== */

/** PIN hash as in the client (js/storage.js): SHA-256 over "catofit:<id>:<pin>". */
function pin_hash(string $userId, string $pin): string
{
    return hash('sha256', "catofit:{$userId}:{$pin}");
}

/** Old format (djb2, generated in insecure contexts before v3.0.1) – for verification only. */
function legacy_pin_hash(string $userId, string $pin): string
{
    $text = "catofit:{$userId}:{$pin}";
    $h = 5381;
    for ($i = 0, $n = strlen($text); $i < $n; $i++) {
        $h = (($h << 5) + $h + ord($text[$i])) & 0xFFFFFFFF;
    }
    return 'fb' . dechex($h);
}

/** Is a value a valid PIN hash (new or old)? Placeholder and empty values are not. */
function is_pin_hash(mixed $h): bool
{
    return is_string($h) && (preg_match('/^[0-9a-f]{64}$/', $h) === 1 || preg_match('/^fb[0-9a-f]{1,8}$/', $h) === 1);
}

/** Does the member have a PIN? */
function member_has_pin(array $member): bool
{
    return is_pin_hash($member['pinHash'] ?? null);
}

/** Does the PIN match? Members without a PIN need none. */
function pin_matches(array $member, string $userId, string $pin): bool
{
    if (!member_has_pin($member)) {
        return true;
    }
    $stored = (string) $member['pinHash'];
    return hash_equals($stored, pin_hash($userId, $pin)) || hash_equals($stored, legacy_pin_hash($userId, $pin));
}

/** Is the new PIN acceptable? 4 to 8 digits, not the default PIN 0000. */
function valid_new_pin(string $pin): bool
{
    return preg_match('/^\d{4,8}$/', $pin) === 1 && $pin !== '0000';
}

/* ============================== Family =================================== */

/** Raw family store (read under a shared lock). */
function family_store(): array
{
    $lock = store_lock('family', 'family', null, false);
    try {
        return read_store('family', 'family', null);
    } finally {
        store_unlock($lock);
    }
}

/** Active member record or null. */
function family_member(string $userId, ?array $store = null): ?array
{
    $store ??= family_store();
    $r = $store['records'][$userId] ?? null;
    if (!is_array($r) || !empty($r['deleted']) || ($r['_kind'] ?? 'member') !== 'member') {
        return null;
    }
    return $r;
}

/** Is there at least one active admin person in this family store? */
function family_has_admin(array $store): bool
{
    foreach ($store['records'] as $r) {
        if (is_array($r) && empty($r['deleted']) && ($r['_kind'] ?? 'member') === 'member' && ($r['role'] ?? '') === 'admin') {
            return true;
        }
    }
    return false;
}

/** Family record for output: replace the PIN hash with `hasPin` (+ placeholder). */
function public_family_record(array $r): array
{
    if (($r['_kind'] ?? 'member') !== 'member' || !empty($r['deleted'])) {
        unset($r['pinHash']);
        return $r;
    }
    $has = member_has_pin($r);
    unset($r['pinHash']);
    $r['hasPin'] = $has;
    if ($has) {
        $r['pinHash'] = PIN_PLACEHOLDER;
    }
    return $r;
}

/** Reasons for rejected family ops: code => English text (the app translates the code, server.<code>). */
const FAMILY_REJECTIONS = [
    'admin_add_member' => 'Only an admin with a server connection can add new members.',
    'admin_change_role' => 'Only an admin with a server connection can change roles.',
    'admin_remove_member' => 'Only an admin with a server connection can remove members.',
    'admin_replace_family' => 'Only an admin with a server connection can replace the whole family.',
];

/** Rejected op from apply_ops (reason = code from family_guard) as sent to clients: {op, id, code, reason}. */
function family_rejection(array $r): array
{
    $code = (string) ($r['reason'] ?? '');
    return ['op' => $r['op'] ?? '', 'id' => $r['id'] ?? '', 'code' => $code, 'reason' => FAMILY_REJECTIONS[$code] ?? $code];
}

/**
 * Checks an incoming family op and sanitises member records. Returns the
 * op to apply or a rejection code (string, see FAMILY_REJECTIONS). Rules:
 *  - A new member, a role change, deleting a member and `replace` need an
 *    admin session – except during initial setup (no admin person yet).
 *  - A PIN hash is only accepted with an admin session (or during
 *    initial setup); otherwise the stored one remains. `hasPin` is derived and is
 *    never stored.
 *  - Teams, settings and pantry stay in the previous trust model.
 */
function family_guard(array $op, array $store, ?array $session): array|string
{
    $isAdmin = $session !== null && ($session['role'] ?? '') === 'admin';
    $setup = !family_has_admin($store);
    $trusted = $isAdmin || $setup;
    $type = $op['op'] ?? '';

    $clean = static function (array $rec) use ($store, $trusted): array {
        if (($rec['_kind'] ?? 'member') !== 'member') {
            unset($rec['pinHash'], $rec['hasPin']);
            return $rec;
        }
        $incoming = $rec['pinHash'] ?? null;
        unset($rec['pinHash'], $rec['hasPin']);
        $prev = $store['records'][(string) ($rec['id'] ?? '')] ?? null;
        if ($trusted && is_pin_hash($incoming)) {
            $rec['pinHash'] = $incoming;
        } elseif (is_array($prev) && empty($prev['deleted']) && is_pin_hash($prev['pinHash'] ?? null)) {
            $rec['pinHash'] = $prev['pinHash'];
        }
        return $rec;
    };

    if ($type === 'upsert') {
        $rec = (array) ($op['record'] ?? []);
        $id = (string) ($rec['id'] ?? '');
        $prev = $store['records'][$id] ?? null;
        $exists = is_array($prev) && empty($prev['deleted']);
        $kind = $rec['_kind'] ?? ($exists ? ($prev['_kind'] ?? 'member') : 'member');
        if ($kind === 'member') {
            if (!$exists && !$trusted) {
                return 'admin_add_member';
            }
            $oldRole = $exists ? (($prev['role'] ?? 'user') === 'admin' ? 'admin' : 'user') : null;
            $newRole = (($rec['role'] ?? $oldRole ?? 'user') === 'admin') ? 'admin' : 'user';
            if ($exists && $oldRole !== $newRole && !$trusted) {
                return 'admin_change_role';
            }
        }
        $op['record'] = $clean($rec);
        return $op;
    }
    if ($type === 'delete') {
        $id = (string) ($op['id'] ?? '');
        $prev = $store['records'][$id] ?? null;
        if (is_array($prev) && empty($prev['deleted']) && ($prev['_kind'] ?? 'member') === 'member' && !$isAdmin) {
            return 'admin_remove_member';
        }
        return $op;
    }
    if ($type === 'replace') {
        if (!$trusted) {
            return 'admin_replace_family';
        }
        $op['records'] = array_map(static fn($r) => $clean((array) $r), is_array($op['records'] ?? null) ? $op['records'] : []);
        return $op;
    }
    return $op;
}

/** Set a member's PIN hash on the server (rev rises → devices fetch `hasPin`). */
function set_member_pin_hash(string $userId, string $hash): void
{
    $lock = store_lock('family', 'family', null, true);
    try {
        $store = read_store('family', 'family', null);
        $r = family_member($userId, $store);
        if ($r === null) {
            throw new RuntimeException('Member not found.');
        }
        $r['pinHash'] = $hash;
        $r['updatedAt'] = date('c');
        $r['rev'] = ++$store['rev'];
        $store['records'][$userId] = $r;
        write_store('family', $store, 'family', null);
    } finally {
        store_unlock($lock);
    }
}

/* =========================== Failed attempts ================================= */

function fails_path(string $userId): string
{
    return auth_dir('fails') . '/' . $userId . '.json';
}

/** Timestamps of failed attempts in the current window. */
function fails_recent(string $userId): array
{
    $raw = @file_get_contents(fails_path($userId));
    $data = is_string($raw) ? json_decode($raw, true) : null;
    $since = time() - PIN_FAIL_WINDOW;
    return array_values(array_filter((array) ($data['t'] ?? []), static fn($t) => is_int($t) && $t > $since));
}

/** Seconds until the next permitted attempt (0 = free). */
function fails_locked(string $userId): int
{
    $recent = fails_recent($userId);
    if (count($recent) < PIN_MAX_FAILS) {
        return 0;
    }
    sort($recent);
    $oldest = $recent[count($recent) - PIN_MAX_FAILS];
    return max(1, $oldest + PIN_FAIL_WINDOW - time());
}

/** Count a failed attempt; returns the remaining attempts. */
function fails_register(string $userId): int
{
    $recent = fails_recent($userId);
    $recent[] = time();
    $recent = array_slice($recent, -PIN_MAX_FAILS);
    @file_put_contents(fails_path($userId), json_encode(['t' => $recent]), LOCK_EX);
    return max(0, PIN_MAX_FAILS - count($recent));
}

function fails_reset(string $userId): void
{
    @unlink(fails_path($userId));
}

/* ============================== Sessions ================================= */

function session_path(string $token): string
{
    return auth_dir('sessions') . '/' . hash('sha256', $token) . '.json';
}

/** Cookie path = API directory: several installations on the same origin (e.g. production and test environment) share nothing. */
function cookie_path(): string
{
    $dir = str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/api.php')));
    return rtrim($dir, '/') . '/';
}

function request_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function send_session_cookie(string $value, bool $expire = false): void
{
    if (headers_sent()) {
        return;
    }
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expire ? 1 : 0,          // 0 = cookie of the browser session
        'path' => cookie_path(),
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Creates a session for a member and sets the cookie. Returns the token. */
function session_create(string $userId): string
{
    $token = bin2hex(random_bytes(32));
    $now = time();
    file_put_contents(session_path($token), json_encode(['user' => $userId, 'created' => $now, 'seen' => $now]), LOCK_EX);
    sessions_cleanup();
    send_session_cookie($token);
    return $token;
}

/** Cookie value of this request (or ''). */
function session_token(): string
{
    $t = $_COOKIE[SESSION_COOKIE] ?? '';
    return is_string($t) && preg_match('/^[0-9a-f]{64}$/', $t) === 1 ? $t : '';
}

/**
 * Valid session of this request: ['user', 'role', 'token'] or null. Expired
 * sessions and those of removed members are deleted in the process.
 */
function current_session(): ?array
{
    $token = session_token();
    if ($token === '') {
        return null;
    }
    $path = session_path($token);
    $raw = is_file($path) ? @file_get_contents($path) : false;
    $s = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($s) || !is_string($s['user'] ?? null) || time() - (int) ($s['seen'] ?? 0) > SESSION_IDLE_TTL) {
        @unlink($path);
        return null;
    }
    $member = family_member($s['user']);
    if ($member === null) {
        @unlink($path);
        return null;
    }
    if (time() - (int) $s['seen'] > 3600) {        // write "last seen" at most once an hour
        $s['seen'] = time();
        @file_put_contents($path, json_encode($s), LOCK_EX);
    }
    return ['user' => $s['user'], 'role' => ($member['role'] ?? 'user') === 'admin' ? 'admin' : 'user', 'token' => $token];
}

/** End this request's session (file + cookie). */
function session_end(): void
{
    $token = session_token();
    if ($token !== '') {
        @unlink(session_path($token));
    }
    send_session_cookie('', true);
}

/** End all sessions of a member (optionally except one). */
function sessions_delete_user(string $userId, ?string $keepToken = null): void
{
    $keep = $keepToken !== null ? session_path($keepToken) : null;
    foreach (glob(auth_dir('sessions') . '/*.json') ?: [] as $f) {
        if ($f === $keep) {
            continue;
        }
        $s = json_decode((string) @file_get_contents($f), true);
        if (is_array($s) && ($s['user'] ?? null) === $userId) {
            @unlink($f);
        }
    }
}

/** Clear out expired sessions now and then. */
function sessions_cleanup(): void
{
    if (random_int(1, 20) !== 1) {
        return;
    }
    foreach (glob(auth_dir('sessions') . '/*.json') ?: [] as $f) {
        $s = json_decode((string) @file_get_contents($f), true);
        if (!is_array($s) || time() - (int) ($s['seen'] ?? 0) > SESSION_IDLE_TTL) {
            @unlink($f);
        }
    }
}

/* ========================= Calendar key ============================= */
// Calendar links (.ics) open outside the app (Safari, Calendar) and therefore
// carry no session cookie, but a key per member.

function ics_token_path(string $userId): string
{
    return DATA_DIR . '/users/' . $userId . '/.ics-token';
}

function ics_token_read(string $userId): ?string
{
    $t = @file_get_contents(ics_token_path($userId));
    $t = is_string($t) ? trim($t) : '';
    return preg_match('/^[0-9a-f]{48}$/', $t) === 1 ? $t : null;
}

/** Key of a member (generated on first retrieval or anew with $rotate). */
function ics_token(string $userId, bool $rotate = false): string
{
    $t = $rotate ? null : ics_token_read($userId);
    if ($t === null) {
        $dir = DATA_DIR . '/users/' . $userId;
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $t = bin2hex(random_bytes(24));
        if (file_put_contents(ics_token_path($userId), $t, LOCK_EX) === false) {
            throw new RuntimeException('Could not save the calendar key.');
        }
    }
    return $t;
}

/* ============================ Request protection ============================== */

/** Does the body arrive as JSON? Forms on other sites cannot send that. */
function request_is_json(): bool
{
    $ct = strtolower(trim((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')));
    return str_starts_with($ct, 'application/json');
}

/** Does the browser report a foreign origin? (Without the header – e.g. curl – the answer is: no.) */
function request_cross_site(): bool
{
    $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    return $site !== '' && $site !== 'same-origin' && $site !== 'none';
}

/** JSON body of a POST request as an array (empty on errors). */
function request_json(): array
{
    $raw = file_get_contents('php://input');
    $data = is_string($raw) && trim($raw) !== '' ? json_decode($raw, true) : null;
    return is_array($data) ? $data : [];
}
