<?php
/**
 * auth.php — Server-Sitzung nach PIN-Prüfung (seit v3.20.0).
 *
 * Bewusst schlank und bestandsverträglich:
 *  - Der Server prüft die PIN selbst (dasselbe Hash-Schema wie bisher im Client,
 *    inkl. des alten djb2-Formats) und setzt danach ein HttpOnly-Cookie für diese
 *    Browser-Sitzung. Fehlversuche werden je Mitglied begrenzt.
 *  - Nur die privaten Bereiche (Zyklus, Labor, Ergänzungen) und Admin-Aktionen
 *    verlangen eine Sitzung. Alle anderen Bereiche bleiben im bisherigen
 *    Vertrauensmodell (Heimnetz), damit bestehende Geräte weiter synchronisieren.
 *  - PIN-Hashes verlassen den Server nicht mehr: Familien-Antworten tragen nur
 *    `hasPin` (plus einen Platzhalter, an dem ältere App-Versionen scheitern,
 *    statt ein Profil ohne PIN zu öffnen).
 *
 * Sitzungen liegen als kleine Dateien unter data/auth/sessions/ (Dateiname = Hash des
 * Cookie-Werts), Fehlversuche unter data/auth/fails/. Wird von api.php eingebunden;
 * nutzt DATA_DIR und die Store-Funktionen aus storage.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/storage.php';

const PRIVATE_AREAS = ['cycle', 'labs', 'supplements'];
const SESSION_COOKIE = 'catofit_sid';
const SESSION_IDLE_TTL = 30 * 86400;     // Sitzung verfällt nach 30 Tagen ohne Nutzung
const PIN_MAX_FAILS = 5;                 // Fehlversuche je Mitglied …
const PIN_FAIL_WINDOW = 900;             // … innerhalb von 15 Minuten, danach Pause
const PIN_PLACEHOLDER = 'server';        // statt des Hashes an Clients (ältere Apps scheitern daran)

/** Unterverzeichnis von data/auth (wird bei Bedarf angelegt). */
function auth_dir(string $sub): string
{
    $dir = DATA_DIR . '/auth/' . $sub;
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

/* ================================ PIN ===================================== */

/** PIN-Hash wie im Client (js/storage.js): SHA-256 über „catofit:<id>:<pin>". */
function pin_hash(string $userId, string $pin): string
{
    return hash('sha256', "catofit:{$userId}:{$pin}");
}

/** Altformat (djb2, vor v3.0.1 in unsicheren Kontexten erzeugt) – nur zum Prüfen. */
function legacy_pin_hash(string $userId, string $pin): string
{
    $text = "catofit:{$userId}:{$pin}";
    $h = 5381;
    for ($i = 0, $n = strlen($text); $i < $n; $i++) {
        $h = (($h << 5) + $h + ord($text[$i])) & 0xFFFFFFFF;
    }
    return 'fb' . dechex($h);
}

/** Ist ein Wert ein gültiger PIN-Hash (neu oder alt)? Platzhalter und Leeres nicht. */
function is_pin_hash(mixed $h): bool
{
    return is_string($h) && (preg_match('/^[0-9a-f]{64}$/', $h) === 1 || preg_match('/^fb[0-9a-f]{1,8}$/', $h) === 1);
}

/** Hat das Mitglied eine PIN? */
function member_has_pin(array $member): bool
{
    return is_pin_hash($member['pinHash'] ?? null);
}

/** Passt die PIN? Mitglieder ohne PIN brauchen keine. */
function pin_matches(array $member, string $userId, string $pin): bool
{
    if (!member_has_pin($member)) {
        return true;
    }
    $stored = (string) $member['pinHash'];
    return hash_equals($stored, pin_hash($userId, $pin)) || hash_equals($stored, legacy_pin_hash($userId, $pin));
}

/** Neue PIN zulässig? 4 bis 8 Ziffern, nicht die Standard-PIN 0000. */
function valid_new_pin(string $pin): bool
{
    return preg_match('/^\d{4,8}$/', $pin) === 1 && $pin !== '0000';
}

/* ============================== Familie =================================== */

/** Roh-Store der Familie (unter geteiltem Lock gelesen). */
function family_store(): array
{
    $lock = store_lock('family', 'family', null, false);
    try {
        return read_store('family', 'family', null);
    } finally {
        store_unlock($lock);
    }
}

/** Aktiver Mitglieds-Datensatz oder null. */
function family_member(string $userId, ?array $store = null): ?array
{
    $store ??= family_store();
    $r = $store['records'][$userId] ?? null;
    if (!is_array($r) || !empty($r['deleted']) || ($r['_kind'] ?? 'member') !== 'member') {
        return null;
    }
    return $r;
}

/** Gibt es in diesem Familien-Store mindestens eine aktive Admin-Person? */
function family_has_admin(array $store): bool
{
    foreach ($store['records'] as $r) {
        if (is_array($r) && empty($r['deleted']) && ($r['_kind'] ?? 'member') === 'member' && ($r['role'] ?? '') === 'admin') {
            return true;
        }
    }
    return false;
}

/** Familien-Datensatz für die Ausgabe: PIN-Hash durch `hasPin` (+ Platzhalter) ersetzen. */
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
 * Prüft eine eingehende Familien-Op und bereinigt Mitglieds-Datensätze. Liefert die
 * anzuwendende Op oder einen Ablehnungscode (string, siehe FAMILY_REJECTIONS). Regeln:
 *  - Neues Mitglied, Rollenwechsel, Mitglied löschen und `replace` brauchen eine
 *    Admin-Sitzung – außer bei der Ersteinrichtung (noch keine Admin-Person).
 *  - Ein PIN-Hash wird nur mit Admin-Sitzung (bzw. bei der Ersteinrichtung)
 *    übernommen; sonst bleibt der gespeicherte. `hasPin` ist abgeleitet und wird
 *    nie gespeichert.
 *  - Teams, Einstellungen und Lager bleiben im bisherigen Vertrauensmodell.
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

/** PIN-Hash eines Mitglieds serverseitig setzen (rev steigt → Geräte holen `hasPin`). */
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

/* =========================== Fehlversuche ================================= */

function fails_path(string $userId): string
{
    return auth_dir('fails') . '/' . $userId . '.json';
}

/** Zeitstempel der Fehlversuche im laufenden Fenster. */
function fails_recent(string $userId): array
{
    $raw = @file_get_contents(fails_path($userId));
    $data = is_string($raw) ? json_decode($raw, true) : null;
    $since = time() - PIN_FAIL_WINDOW;
    return array_values(array_filter((array) ($data['t'] ?? []), static fn($t) => is_int($t) && $t > $since));
}

/** Sekunden bis zum nächsten erlaubten Versuch (0 = frei). */
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

/** Fehlversuch zählen; liefert die verbleibenden Versuche. */
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

/* ============================== Sitzungen ================================= */

function session_path(string $token): string
{
    return auth_dir('sessions') . '/' . hash('sha256', $token) . '.json';
}

/** Cookie-Pfad = API-Verzeichnis: Mehrere Installationen auf derselben Origin (z. B. Produktion und Testumgebung) teilen sich nichts. */
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
        'expires' => $expire ? 1 : 0,          // 0 = Cookie der Browser-Sitzung
        'path' => cookie_path(),
        'secure' => request_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Legt eine Sitzung für ein Mitglied an und setzt das Cookie. Liefert das Token. */
function session_create(string $userId): string
{
    $token = bin2hex(random_bytes(32));
    $now = time();
    file_put_contents(session_path($token), json_encode(['user' => $userId, 'created' => $now, 'seen' => $now]), LOCK_EX);
    sessions_cleanup();
    send_session_cookie($token);
    return $token;
}

/** Cookie-Wert dieser Anfrage (oder ''). */
function session_token(): string
{
    $t = $_COOKIE[SESSION_COOKIE] ?? '';
    return is_string($t) && preg_match('/^[0-9a-f]{64}$/', $t) === 1 ? $t : '';
}

/**
 * Gültige Sitzung dieser Anfrage: ['user', 'role', 'token'] oder null. Abgelaufene
 * Sitzungen und solche entfernter Mitglieder werden dabei gelöscht.
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
    if (time() - (int) $s['seen'] > 3600) {        // „zuletzt gesehen" höchstens stündlich schreiben
        $s['seen'] = time();
        @file_put_contents($path, json_encode($s), LOCK_EX);
    }
    return ['user' => $s['user'], 'role' => ($member['role'] ?? 'user') === 'admin' ? 'admin' : 'user', 'token' => $token];
}

/** Sitzung dieser Anfrage beenden (Datei + Cookie). */
function session_end(): void
{
    $token = session_token();
    if ($token !== '') {
        @unlink(session_path($token));
    }
    send_session_cookie('', true);
}

/** Alle Sitzungen eines Mitglieds beenden (optional bis auf eine). */
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

/** Abgelaufene Sitzungen gelegentlich wegräumen. */
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

/* ========================= Kalender-Schlüssel ============================= */
// Kalender-Links (.ics) öffnen sich außerhalb der App (Safari, Kalender) und tragen
// deshalb keinen Sitzungs-Cookie, sondern einen Schlüssel je Mitglied.

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

/** Schlüssel eines Mitglieds (wird beim ersten Abruf bzw. mit $rotate neu erzeugt). */
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

/* ============================ Anfrage-Schutz ============================== */

/** Kommt der Body als JSON? Formulare fremder Seiten können das nicht senden. */
function request_is_json(): bool
{
    $ct = strtolower(trim((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')));
    return str_starts_with($ct, 'application/json');
}

/** Meldet der Browser eine fremde Herkunft? (Ohne Header – z. B. curl – gilt: nein.) */
function request_cross_site(): bool
{
    $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    return $site !== '' && $site !== 'same-origin' && $site !== 'none';
}

/** JSON-Body einer POST-Anfrage als Array (leer bei Fehlern). */
function request_json(): array
{
    $raw = file_get_contents('php://input');
    $data = is_string($raw) && trim($raw) !== '' ? json_decode($raw, true) : null;
    return is_array($data) ? $data : [];
}
