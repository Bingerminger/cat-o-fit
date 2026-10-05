<?php
/**
 * test-api.php — tests the real API over HTTP against a PHP server of its own with
 * an empty temp data directory (never touches real data): server session after
 * PIN verification, private areas, protection against foreign sites (CSRF), family rules,
 * PIN hashes in responses, calendar keys, health-import limits, host list.
 *
 *   php tools/test-api.php
 *
 * Exit code 0 = all green, 1 = at least one failure. Also runs in CI (.github/workflows/ci.yml).
 */
declare(strict_types=1);

$root = realpath(__DIR__ . '/..');
$tmp = sys_get_temp_dir() . '/catofit-api-test-' . getmypid();
@mkdir($tmp . '/api', 0775, true);
@mkdir($tmp . '/data', 0775, true);
foreach (glob($root . '/api/*.php') as $f) {
    copy($f, $tmp . '/api/' . basename($f));
}
// Server texts (calendar, import titles) come from locales/<lang>/server.json.
@mkdir($tmp . '/locales', 0775, true);
copy($root . '/locales/languages.json', $tmp . '/locales/languages.json');
foreach (glob($root . '/locales/*/server.json') as $f) {
    @mkdir($tmp . '/locales/' . basename(dirname($f)), 0775, true);
    copy($f, $tmp . '/locales/' . basename(dirname($f)) . '/server.json');
}

function rrmdir(string $dir): void {
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
        if (in_array(basename($f), ['.', '..'], true)) continue;
        if (is_dir($f)) rrmdir($f); else @unlink($f);
    }
    @rmdir($dir);
}

// Find a free port and start the server (with host list for the DNS rebinding test).
$probe = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($probe, false), ':'), 1);
fclose($probe);
// Without a TZ setting: calendar in Europe/Berlin as before (DOC-25, see test-ics.php).
$env = array_merge(getenv(), ['CATOFIT_ALLOWED_HOSTS' => 'nas.local', 'TZ' => '', 'CATOFIT_TZ' => '']);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", '-t', $tmp], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $tmp, $env);
register_shutdown_function(static function () use ($proc, $tmp) {
    if (is_resource($proc)) { proc_terminate($proc); proc_close($proc); }
    rrmdir($tmp);
});
$base = "http://127.0.0.1:{$port}/api/api.php";

/** HTTP request; $jar = cookie store of a simulated browser. */
function http(string $method, string $query, ?array $json = null, array &$jar = [], array $headers = [], ?string $raw = null, ?string $ctype = null): array {
    global $base;
    $h = $headers;
    if ($json !== null) { $raw = json_encode($json); $ctype ??= 'application/json'; }
    if ($ctype !== null) $h[] = "Content-Type: {$ctype}";
    if ($jar) $h[] = 'Cookie: ' . implode('; ', array_map(static fn($k, $v) => "{$k}={$v}", array_keys($jar), $jar));
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $h), 'content' => $raw ?? '', 'ignore_errors' => true, 'timeout' => 20]]);
    $body = @file_get_contents($base . $query, false, $ctx);
    $status = 0; $cookies = [];
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $line, $m)) $status = (int) $m[1];
        if (stripos($line, 'Set-Cookie:') === 0) {
            $cookies[] = $line;
            if (preg_match('/^Set-Cookie:\s*([^=]+)=([^;]*)/i', $line, $c)) {
                if ($c[2] === '' || stripos($line, 'expires=Thu, 01 Jan 1970') !== false) unset($jar[$c[1]]); else $jar[$c[1]] = $c[2];
            }
        }
    }
    return ['status' => $status, 'json' => json_decode((string) $body, true), 'body' => (string) $body, 'cookies' => $cookies];
}

$pass = 0; $fail = 0;
function check(string $name, bool $cond, $got = null): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FAILED  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}
$H = static fn(string $id, string $pin) => hash('sha256', "catofit:{$id}:{$pin}");

// Server ready?
$ready = false;
for ($i = 0; $i < 50 && !$ready; $i++) { usleep(100000); $none = []; $ready = (http('GET', '?action=ping', null, $none)['json']['ok'] ?? false) === true; }
if (!$ready) { echo "Test server does not start.\n"; exit(1); }

$nobody = [];
$r = http('GET', '?action=ping', null, $nobody);
check('ping returns apiVersion', ($r['json']['apiVersion'] ?? null) === 1, $r['json']);

// --- Initial setup: the first admin person may be created without a session ---
$setup = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-a', '_kind' => 'member', 'name' => 'Admin', 'role' => 'admin', 'createdAt' => '2026-01-01T00:00:00Z', 'pinHash' => $H('u-a', '2468')]],
]], $nobody);
check('Initial setup: admin created without a session', $setup['status'] === 200 && empty($setup['json']['rejected']), $setup['json']);
$late = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-x', '_kind' => 'member', 'name' => 'Fremd', 'role' => 'admin', 'pinHash' => $H('u-x', '1111')]],
]], $nobody);
check('Afterwards: new member without an admin session rejected', count($late['json']['rejected'] ?? []) === 1, $late['json']);
check('… with a code (the app translates it) and an English reason', ($late['json']['rejected'][0]['code'] ?? '') === 'admin_add_member'
    && str_starts_with((string) ($late['json']['rejected'][0]['reason'] ?? ''), 'Only an admin'), $late['json']['rejected'] ?? null);

$fam = http('GET', '?action=changes&area=family&scope=family&since=0', null, $nobody);
$raw = $fam['body'];
check('Family response without PIN hash', !str_contains($raw, $H('u-a', '2468')));
$ua = null;
foreach ($fam['json']['records'] ?? [] as $rec) if (($rec['id'] ?? '') === 'u-a') $ua = $rec;
check('Family response: hasPin + placeholder', ($ua['hasPin'] ?? null) === true && ($ua['pinHash'] ?? null) === 'server', $ua);

// --- Sign-in ---
$admin = [];
$bad = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '0000'], $admin);
check('Wrong PIN → 401 code pin', $bad['status'] === 401 && ($bad['json']['code'] ?? '') === 'pin', $bad['json']);
$r = http('POST', '?action=login', ['user' => '../x', 'pin' => '1'], $nobody);
check('Invalid user ID → 400 code invalid_user (English text)', $r['status'] === 400 && ($r['json']['code'] ?? '') === 'invalid_user'
    && ($r['json']['error'] ?? '') === 'Invalid user ID.', $r['json']);
$r = http('GET', '?action=login', null, $nobody);
check('Wrong method → 405 code method_not_allowed with action/expected', $r['status'] === 405 && ($r['json']['code'] ?? '') === 'method_not_allowed'
    && ($r['json']['action'] ?? '') === 'login' && ($r['json']['expected'] ?? '') === 'POST', $r['json']);
$r = http('GET', '?area=gibtsnicht&user=u-a', null, $nobody);
check('Unknown area → 404 code unknown_area with area', $r['status'] === 404 && ($r['json']['code'] ?? '') === 'unknown_area' && ($r['json']['area'] ?? '') === 'gibtsnicht', $r['json']);
$ok = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $admin);
check('Correct PIN → session', $ok['status'] === 200 && isset($admin['catofit_sid']), $ok['json']);
$cookieLine = implode(' ', $ok['cookies']);
check('Cookie: HttpOnly + SameSite=Strict', stripos($cookieLine, 'httponly') !== false && stripos($cookieLine, 'samesite=strict') !== false, $cookieLine);
$sess = http('GET', '?action=session', null, $admin);
check('session names the person', ($sess['json']['user'] ?? null) === 'u-a' && ($sess['json']['role'] ?? null) === 'admin', $sess['json']);

// Admin creates a member (start PIN 0000 as hash) – allowed with a session.
$add = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Kind', 'role' => 'user', 'createdAt' => '2026-01-02T00:00:00Z', 'pinHash' => $H('u-k', '0000')]],
]], $admin);
check('Admin session: member created', $add['status'] === 200 && empty($add['json']['rejected']), $add['json']);

// --- Private areas ---
$w = http('POST', '?action=ops&area=labs&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'l1', 'analyte' => 'ferritin', 'value' => 40]]]], $admin);
check('Own private area: write', $w['status'] === 200, $w['json']);
$r = http('GET', '?area=labs&user=u-a', null, $nobody);
check('Private area without a session → 401', $r['status'] === 401 && ($r['json']['code'] ?? '') === 'session', $r['json']);
$kid = [];
http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0000'], $kid);
$r = http('GET', '?action=changes&area=labs&user=u-a&since=0', null, $kid);
check('Session of another person cannot read → 403', $r['status'] === 403 && ($r['json']['code'] ?? '') === 'private', $r['json']);
$r = http('GET', '?action=changes&area=cycle&user=u-k&since=0', null, $admin);
check('Not even the admin person → 403', $r['status'] === 403, $r['json']);
$r = http('GET', '?action=changes&area=health&user=u-k&since=0', null, $nobody);
check('Non-private areas work without a session as before', $r['status'] === 200, $r['json']);

// --- Protection against foreign sites (CSRF) ---
$r = http('POST', '?action=ops&area=diary&user=u-a', null, $admin, [], '{"ops":[]}', 'text/plain');
check('ops with text/plain → 415', $r['status'] === 415, $r['json']);
$r = http('POST', '?action=ops&area=diary&user=u-a', ['ops' => []], $admin, ['Sec-Fetch-Site: cross-site']);
check('ops from a foreign site → 403', $r['status'] === 403 && ($r['json']['code'] ?? '') === 'origin', $r['json']);
$r = http('POST', '?action=delete-user&user=u-k', [], $nobody);
check('delete-user without a session → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=delete-user&user=u-a', [], $kid);
check('delete-user as a member → 403', $r['status'] === 403, $r['json']);
$r = http('POST', '?action=health-import', null, $nobody, [], 'x', 'multipart/form-data; boundary=zz');
check('health-import without a session → 401', $r['status'] === 401, $r['json']);

// --- Family rules ---
$r = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Kind', 'role' => 'admin', 'pinHash' => $H('u-k', '9999')]],
]], $kid);
check('A member cannot make themselves admin', count($r['json']['rejected'] ?? []) === 1, $r['json']);
$r = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Lena', 'role' => 'user', 'pinHash' => $H('u-k', '9999')]],
]], $kid);
check('Name change works, a foreign PIN hash is ignored', empty($r['json']['rejected']) && !str_contains($r['body'], $H('u-k', '9999')), $r['json']);
$relog = []; $rr = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0000'], $relog);
check('… the PIN stays the old one', $rr['status'] === 200, $rr['json']);
check('Default PIN is reported as weak', ($rr['json']['weakPin'] ?? null) === true, $rr['json']);

// --- Changing the PIN ---
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '1357', 'old' => '1111'], $kid);
check('Own PIN with wrong old PIN → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '0000', 'old' => '0000'], $kid);
check('0000 as new PIN → 400 weak', $r['status'] === 400 && ($r['json']['code'] ?? '') === 'weak', $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-a', 'pin' => '1357'], $kid);
check('PIN of another person as a member → 403', $r['status'] === 403, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '1357', 'old' => '0000'], $kid);
check('Own PIN with correct old PIN → ok', $r['status'] === 200, $r['json']);
$r = http('GET', '?action=session', null, $relog);
check('Other sessions of the person ended', is_array($r['json']) && array_key_exists('user', $r['json']) && $r['json']['user'] === null, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '8642'], $admin);
check('Admin sets the PIN of a member without the old one → ok', $r['status'] === 200, $r['json']);

// --- Failed-attempt lockout ---
$locker = [];
for ($i = 0; $i < 4; $i++) http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0001'], $locker);
$r = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0001'], $locker);
check('Fifth failed attempt → 429 locked', $r['status'] === 429 && ($r['json']['code'] ?? '') === 'locked', $r['json']);
$r = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '8642'], $locker);
check('Even the correct PIN has to wait out the pause', $r['status'] === 429, $r['json']);

// --- Calendar keys ---
http('POST', '?action=ops&area=events&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'e1', 'name' => 'Stadtlauf', 'date' => '2026-10-10', 'location' => 'Dresden']]]], $admin);
$t = http('POST', '?action=ics-token', ['user' => 'u-a'], $admin);
$token = (string) ($t['json']['token'] ?? '');
check('ics-token for the own person', preg_match('/^[0-9a-f]{48}$/', $token) === 1, $t['json']);
$r = http('GET', "?action=ics&scope=race&id=e1&user=u-a&token={$token}", null, $nobody);
check('Calendar link with key → .ics', $r['status'] === 200 && str_contains($r['body'], 'BEGIN:VCALENDAR'), $r['status']);
check('Without a TZ setting the calendar zone stays Europe/Berlin (existing subscriptions unchanged)', str_contains($r['body'], "TZID:Europe/Berlin\r\n") && str_contains($r['body'], 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'), substr($r['body'], 0, 300));
$r = http('GET', '?action=ics&scope=race&id=e1&user=u-a&token=' . str_repeat('0', 48), null, $nobody);
check('Wrong key → 403', $r['status'] === 403, $r['status']);
// Language of the calendar: own choice → instance default → German for instances from before v4.0.0 → English.
$icsBody = static function () use ($token, $nobody): string {
    $n = $nobody;
    return http('GET', "?action=ics&scope=race&id=e1&user=u-a&token={$token}", null, $n)['body'];
};
$setLang = static function (?string $person, ?string $instance) use ($admin): void {
    $a = $admin;
    http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'settings' => $person ? ['language' => $person] : []]]]], $a);
    http('POST', '?action=ops&area=family&scope=family', ['ops' => [['op' => 'upsert', 'record' => ['id' => '__settings', '_kind' => 'settings'] + ($instance ? ['language' => $instance] : [])]]], $a);
};
http('POST', '?action=ops&area=events&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'e1', 'name' => 'Stadtlauf', 'date' => '2026-10-10', 'location' => 'Dresden', 'distanceType' => 'HM', 'distanceKm' => 21.0975, 'priority' => 'A']]]], $admin);
$b = $icsBody();
check('Calendar: instance from before v4.0.0 (members, no language) → German as before', str_contains($b, "CATEGORIES:Wettkampf\r\n")
    && str_contains($b, 'Distanz: HM (21\\,1 km)') && str_contains($b, 'Priorität: A') && str_contains($b, 'DESCRIPTION:Morgen Wettkampf: Stadtlauf')
    && str_contains($b, 'X-WR-CALNAME:Catofit Training'), $b);
$r = http('GET', '?action=ics&scope=race&id=e1&user=u-a&token=' . str_repeat('0', 48), null, $nobody);
check('… also the error message of an invalid link', str_contains($r['body'], 'Dieser Kalender-Link ist nicht (mehr) gültig'), $r['body']);
$setLang('en', null);
$b = $icsBody();
check('Calendar: person with English → English labels and decimal point', str_contains($b, "CATEGORIES:Race\r\n")
    && str_contains($b, 'Distance: HM (21.1 km)') && str_contains($b, 'Priority: A') && str_contains($b, 'DESCRIPTION:Race tomorrow: Stadtlauf')
    && !str_contains($b, 'Wettkampf'), $b);
$setLang('de', 'en');
check('Calendar: own choice (German) before the instance default (English)', str_contains($icsBody(), "CATEGORIES:Wettkampf\r\n"));
$setLang(null, 'en');
check('Calendar: without an own choice the instance default applies', str_contains($icsBody(), "CATEGORIES:Race\r\n"));
$setLang('fr', 'en');
check('Calendar: person with French → French labels, decimal comma', str_contains($b = $icsBody(), "CATEGORIES:Course\r\n") && str_contains($b, '(21\\,1 km)'), $b);
$setLang('xx', 'en');
check('Calendar: unsupported language → the instance default', str_contains($icsBody(), "CATEGORIES:Race\r\n"));
$r = http('POST', '?action=ics-token', ['user' => 'u-a'], $kid);
check('Key of another person as a member → 403', $r['status'] === 403 || $r['status'] === 401, $r['json']);

// --- Host list (DNS rebinding) ---
$r = http('GET', '?action=ping', null, $nobody, ['Host: evil.example']);
check('Foreign host → 421', $r['status'] === 421, $r['json']);
$r = http('GET', '?action=ping', null, $nobody, ['Host: nas.local']);
check('Allowed host → 200', $r['status'] === 200, $r['json']);

// --- Health import: an implausibly heavily packed archive is rejected ---
if (class_exists('ZipArchive')) {
    $zipPath = $tmp . '/bomb.zip';
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE);
    $zip->addFromString('apple_health_export/export.xml', '<HealthData>' . str_repeat(' ', 40 * 1024 * 1024) . '</HealthData>');
    $zip->close();
    $bnd = 'catofitgrenze';
    $body = "--{$bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"export.zip\"\r\nContent-Type: application/zip\r\n\r\n" . file_get_contents($zipPath) . "\r\n--{$bnd}--\r\n";
    $r = http('POST', '?action=health-import', null, $admin, [], $body, "multipart/form-data; boundary={$bnd}");
    check('ZIP with an extreme compression ratio → 413', $r['status'] === 413, $r['json']);
} else {
    echo "  --  ZIP test skipped (ZipArchive missing)\n";
}

// --- Health intake: lean daily format of a Shortcuts template (MKT-01) ---
$hkToken = str_repeat('ab', 24);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken]]]], $admin);
$r = http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-29', 'weight' => '72,4', 'restingHr' => 52], $nobody, ["X-Catofit-Token: {$hkToken}"]);
check('Shortcuts format is accepted', $r['status'] === 200 && ($r['json']['health']['days'] ?? 0) === 1, $r['json']);
$r = http('GET', '?area=health&user=u-a', null, $admin);
$day = array_values(array_filter($r['json']['data'] ?? [], fn ($x) => ($x['date'] ?? '') === '2026-09-29'))[0] ?? [];
check('… and ends up as a daily value (72.4 kg, resting heart rate 52)', ($day['weight'] ?? null) == 72.4 && ($day['restingHr'] ?? null) == 52, $day);
$r = http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-29', 'weight' => 72], $nobody, ['X-Catofit-Token: falsch']);
check('… only with the correct key', $r['status'] === 401, $r['status']);
// A day with a different origin (here: demo scale) keeps it – otherwise its muscle mass
// would be read in the app as an old Apple "Lean Body Mass" and thus as lean mass.
http('POST', '?action=ops&area=health&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'h-scale', 'date' => '2026-09-27', 'source' => 'demo', 'muscleMass' => 28.2]]]], $admin);
http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-27', 'weight' => 72.1], $nobody, ["X-Catofit-Token: {$hkToken}"]);
http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-26', 'weight' => 72.3], $nobody, ["X-Catofit-Token: {$hkToken}"]);
$r = http('GET', '?area=health&user=u-a', null, $admin);
$byDate = [];
foreach ($r['json']['data'] ?? [] as $x) $byDate[$x['date'] ?? ''] = $x;
check('Auto import into a day of a different origin: origin and muscle mass are kept', ($byDate['2026-09-27']['source'] ?? '') === 'demo' && ($byDate['2026-09-27']['muscleMass'] ?? null) == 28.2 && ($byDate['2026-09-27']['weight'] ?? null) == 72.1, $byDate['2026-09-27'] ?? null);
check('… a new day comes from Apple Health', ($byDate['2026-09-26']['source'] ?? '') === 'apple-health', $byDate['2026-09-26'] ?? null);

// --- Bulk fetch and "since" in the ops response (FE-26) ---
$r = http('GET', '?action=ping', null, $nobody);
check('ping reports bulk fetch and since (API version stays 1)', ($r['json']['apiVersion'] ?? null) === 1 && in_array('changes-all', $r['json']['features'] ?? [], true) && in_array('ops-since', $r['json']['features'] ?? [], true), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('sessions:0,health:0,labs:0'), null, $admin);
check('changes-all: several areas in one response, private ones with an own session', $r['status'] === 200
    && isset($r['json']['revs']['sessions'], $r['json']['revs']['labs']) && ($r['json']['locked'] ?? null) === [] && !empty($r['json']['changes']['health']), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('sessions:0,labs:0,cycle:0'), null, $nobody);
check('… without a session: private areas locked, the rest delivered', $r['status'] === 200
    && ($r['json']['locked'] ?? []) === ['labs', 'cycle'] && isset($r['json']['revs']['sessions']) && !isset($r['json']['revs']['labs']), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('gibtsnicht:0'), null, $admin);
check('… unknown areas do not count (400 without a valid area)', $r['status'] === 400, $r['json']);
$before = http('GET', '?action=changes&area=sessions&user=u-a&since=0', null, $admin)['json']['rev'] ?? 0;
http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'fremd-1', 'date' => '2026-09-20']]]], $admin);
$r = http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'eigen-1', 'date' => '2026-09-21']]], 'since' => $before], $admin);
$ids = array_column($r['json']['changes']['records'] ?? [], 'id');
check('ops with since: response also contains the foreign change', in_array('fremd-1', $ids, true) && in_array('eigen-1', $ids, true) && ($r['json']['changes']['rev'] ?? 0) === ($r['json']['rev'] ?? -1), $r['json']['changes'] ?? null);
$r = http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'eigen-2', 'date' => '2026-09-22']]]], $admin);
check('ops without since: response as before', !isset($r['json']['changes']), array_keys($r['json'] ?? []));

// --- Barcode lookup (MKT-18): only valid GTINs go out ---
$r = http('GET', '?action=foodfacts&code=' . rawurlencode('4006381333932'), null, $nobody);
check('Barcode with a wrong check digit is rejected without a lookup', ($r['json']['found'] ?? null) === false && ($r['json']['error'] ?? '') === 'Invalid barcode', $r['json']);
$r = http('GET', '?action=foodfacts&code=' . rawurlencode('../../etc/passwd'), null, $nobody);
check('… nonsense in the code parameter likewise', ($r['json']['found'] ?? null) === false && isset($r['json']['error']), $r['json']);

// --- Read access for own tools (MKT-15): off by default, read-only, nothing private ---
$r = http('GET', '?action=read&user=u-a', null, $nobody, ['X-Catofit-Token: ' . str_repeat('cd', 24)]);
check('Read access: without an enabled key → 401', $r['status'] === 401, $r['json']);
$readTok = str_repeat('cd', 24);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken, 'readToken' => $readTok, 'maxHr' => 188]]]], $admin);
http('POST', '?action=ops&area=labs&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'lab-r', 'analyte' => 'ferritin', 'value' => 40, 'date' => '2026-09-01']]]], $admin);
$r = http('GET', '?action=read&user=u-a&areas=' . rawurlencode('sessions,labs,cycle') . '&from=2026-09-21', null, $nobody, ["X-Catofit-Token: {$readTok}"]);
$data = $r['json']['data'] ?? [];
check('Read access: with the key the own sessions (starting at from)', $r['status'] === 200 && isset($data['sessions'])
    && !in_array('2026-09-20', array_column($data['sessions'], 'date'), true) && in_array('eigen-1', array_column($data['sessions'], 'id'), true), $r['json']);
check('… labs and cycle not even on request', !isset($data['labs']) && !isset($data['cycle']) && !str_contains($r['body'], 'ferritin'), array_keys($data));
check('… profile without keys', ($r['json']['profile']['maxHr'] ?? null) === 188 && !str_contains($r['body'], $hkToken) && !str_contains($r['body'], $readTok), $r['json']['profile'] ?? null);
$r = http('GET', '?action=read&user=u-a', null, $nobody, ['X-Catofit-Token: ' . str_repeat('ab', 24)]);
check('… wrong key → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=read&user=u-a', ['x' => 1], $nobody, ["X-Catofit-Token: {$readTok}"]);
check('… read-only (POST → 405)', $r['status'] === 405, $r['json']);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken, 'readToken' => null]]]], $admin);
$r = http('GET', '?action=read&user=u-a', null, $nobody, ["X-Catofit-Token: {$readTok}"]);
check('… disabled → the old key stops working immediately', $r['status'] === 401, $r['json']);

// --- Android: Health Connect via a bridge app (MKT-02, MKT-19) ---
$hc = ['app_version' => '1.4.0',
    'weight' => [['kilograms' => 71.8, 'time' => '2026-09-25T05:00:00Z']],
    'exercise' => [['type' => 'RUNNING', 'start_time' => '2026-09-25T16:00:00Z', 'end_time' => '2026-09-25T16:45:00Z', 'duration_seconds' => 2700, 'distance_meters' => 8000]],
    'heart_rate' => [['bpm' => 148, 'time' => '2026-09-25T16:20:00Z']],
    'menstruation_period' => [['start_time' => '2026-09-10T06:00:00Z', 'end_time' => '2026-09-13T06:00:00Z']]];
$r1 = http('POST', '?action=health-ingest&user=u-a', $hc, $nobody, ["X-Catofit-Token: {$hkToken}"]);
$r2 = http('POST', '?action=health-ingest&user=u-a', $hc, $nobody, ["X-Catofit-Token: {$hkToken}"]);   // the bridge sends a rolling 48 h
check('Health Connect: daily value, session and period accepted', $r1['status'] === 200 && ($r1['json']['sessions']['imported'] ?? 0) === 1 && ($r1['json']['cycle']['periods'] ?? 0) === 1, $r1['json']);
check('… a repeated submission creates no duplicates', ($r2['json']['cycle']['periods'] ?? -1) === 0, $r2['json']);
$s = http('GET', '?area=sessions&user=u-a', null, $admin);
$hcs = array_values(array_filter($s['json']['data'] ?? [], fn ($x) => ($x['source'] ?? '') === 'health-connect'));
check('… one session with average HR, origin Health Connect', count($hcs) === 1 && ($hcs[0]['avgHr'] ?? null) === 148 && ($hcs[0]['date'] ?? '') === '2026-09-25', $hcs);
check('… title in the language of the person (here: instance default, English)', ($hcs[0]['title'] ?? '') === 'Run (Health Connect)', $hcs[0]['title'] ?? null);
$c = http('GET', '?area=cycle&user=u-a', null, $admin);
$per = array_values(array_filter($c['json']['data'] ?? [], fn ($x) => ($x['startDate'] ?? '') === '2026-09-10'));
check('… period in the private cycle area (4 days)', count($per) === 1 && ($per[0]['periodLength'] ?? null) === 4, $c['json']['data'] ?? null);

// --- Sign out ---
http('POST', '?action=logout', [], $admin);
$r = http('GET', '?area=labs&user=u-a', null, $admin);
check('No access after signing out', $r['status'] === 401, $r['json']);

// --- The only admin person has forgotten the PIN: tool for the server (DOC-10) ---
@mkdir($tmp . '/tools', 0775, true);
copy($root . '/tools/reset-pin.php', $tmp . '/tools/reset-pin.php');
$again = [];
http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $again);   // open session that has to end
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tmp . '/tools/reset-pin.php') . ' Admin 0000 2>&1', $o1, $c1);
check('reset-pin: 0000 is rejected', $c1 === 1, implode(' ', $o1));
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tmp . '/tools/reset-pin.php') . ' Admin 1357 2>&1', $o2, $c2);
check('reset-pin: new PIN set', $c2 === 0, implode(' ', $o2));
$r = http('GET', '?area=labs&user=u-a', null, $again);
check('reset-pin: existing sessions of the person ended', $r['status'] === 401, $r['status']);
$fresh = [];
$r = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $fresh);
check('reset-pin: old PIN no longer valid', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '1357'], $fresh);
check('reset-pin: sign-in with the new PIN', $r['status'] === 200, $r['json']);
$ctx = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 5]]);
$webBody = @file_get_contents("http://127.0.0.1:{$port}/tools/reset-pin.php?x=1", false, $ctx);
check('reset-pin does not run over the web (403, no output)', str_contains((string) ($http_response_header[0] ?? ''), ' 403') && $webBody === '', $http_response_header[0] ?? null);

// --- Result --------------------------------------------------------------
echo "\napi: {$pass} ok, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
