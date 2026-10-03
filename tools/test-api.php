<?php
/**
 * test-api.php — Prüft die echte API über HTTP gegen einen eigenen PHP-Server mit
 * leerem Temp-Datenverzeichnis (berührt nie echte Daten): Server-Sitzung nach
 * PIN-Prüfung, private Bereiche, Schutz vor fremden Seiten (CSRF), Familienregeln,
 * PIN-Hashes in Antworten, Kalender-Schlüssel, Health-Import-Grenzen, Host-Liste.
 *
 *   php tools/test-api.php
 *
 * Exit-Code 0 = alle grün, 1 = mind. ein Fehler. Läuft in der CI mit (.github/workflows/ci.yml).
 */
declare(strict_types=1);

$root = realpath(__DIR__ . '/..');
$tmp = sys_get_temp_dir() . '/catofit-api-test-' . getmypid();
@mkdir($tmp . '/api', 0775, true);
@mkdir($tmp . '/data', 0775, true);
foreach (glob($root . '/api/*.php') as $f) {
    copy($f, $tmp . '/api/' . basename($f));
}

function rrmdir(string $dir): void {
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
        if (in_array(basename($f), ['.', '..'], true)) continue;
        if (is_dir($f)) rrmdir($f); else @unlink($f);
    }
    @rmdir($dir);
}

// Freien Port suchen und Server starten (mit Host-Liste für den DNS-Rebinding-Test).
$probe = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($probe, false), ':'), 1);
fclose($probe);
// Ohne TZ-Angabe: Kalender in Europe/Berlin wie bisher (DOC-25, siehe test-ics.php).
$env = array_merge(getenv(), ['CATOFIT_ALLOWED_HOSTS' => 'nas.local', 'TZ' => '', 'CATOFIT_TZ' => '']);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", '-t', $tmp], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $tmp, $env);
register_shutdown_function(static function () use ($proc, $tmp) {
    if (is_resource($proc)) { proc_terminate($proc); proc_close($proc); }
    rrmdir($tmp);
});
$base = "http://127.0.0.1:{$port}/api/api.php";

/** HTTP-Anfrage; $jar = Cookie-Speicher eines simulierten Browsers. */
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
    else { $fail++; echo "  FEHLER  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}
$H = static fn(string $id, string $pin) => hash('sha256', "catofit:{$id}:{$pin}");

// Server bereit?
$ready = false;
for ($i = 0; $i < 50 && !$ready; $i++) { usleep(100000); $none = []; $ready = (http('GET', '?action=ping', null, $none)['json']['ok'] ?? false) === true; }
if (!$ready) { echo "Testserver startet nicht.\n"; exit(1); }

$nobody = [];
$r = http('GET', '?action=ping', null, $nobody);
check('ping liefert apiVersion', ($r['json']['apiVersion'] ?? null) === 1, $r['json']);

// --- Ersteinrichtung: erste Admin-Person darf ohne Sitzung angelegt werden ---
$setup = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-a', '_kind' => 'member', 'name' => 'Admin', 'role' => 'admin', 'createdAt' => '2026-01-01T00:00:00Z', 'pinHash' => $H('u-a', '2468')]],
]], $nobody);
check('Ersteinrichtung: Admin ohne Sitzung angelegt', $setup['status'] === 200 && empty($setup['json']['rejected']), $setup['json']);
$late = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-x', '_kind' => 'member', 'name' => 'Fremd', 'role' => 'admin', 'pinHash' => $H('u-x', '1111')]],
]], $nobody);
check('Danach: neues Mitglied ohne Admin-Sitzung abgelehnt', count($late['json']['rejected'] ?? []) === 1, $late['json']);

$fam = http('GET', '?action=changes&area=family&scope=family&since=0', null, $nobody);
$raw = $fam['body'];
check('Familien-Antwort ohne PIN-Hash', !str_contains($raw, $H('u-a', '2468')));
$ua = null;
foreach ($fam['json']['records'] ?? [] as $rec) if (($rec['id'] ?? '') === 'u-a') $ua = $rec;
check('Familien-Antwort: hasPin + Platzhalter', ($ua['hasPin'] ?? null) === true && ($ua['pinHash'] ?? null) === 'server', $ua);

// --- Anmeldung ---
$admin = [];
$bad = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '0000'], $admin);
check('Falsche PIN → 401 code pin', $bad['status'] === 401 && ($bad['json']['code'] ?? '') === 'pin', $bad['json']);
$ok = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $admin);
check('Richtige PIN → Sitzung', $ok['status'] === 200 && isset($admin['catofit_sid']), $ok['json']);
$cookieLine = implode(' ', $ok['cookies']);
check('Cookie: HttpOnly + SameSite=Strict', stripos($cookieLine, 'httponly') !== false && stripos($cookieLine, 'samesite=strict') !== false, $cookieLine);
$sess = http('GET', '?action=session', null, $admin);
check('session nennt die Person', ($sess['json']['user'] ?? null) === 'u-a' && ($sess['json']['role'] ?? null) === 'admin', $sess['json']);

// Admin legt ein Mitglied an (Start-PIN 0000 als Hash) – mit Sitzung erlaubt.
$add = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Kind', 'role' => 'user', 'createdAt' => '2026-01-02T00:00:00Z', 'pinHash' => $H('u-k', '0000')]],
]], $admin);
check('Admin-Sitzung: Mitglied angelegt', $add['status'] === 200 && empty($add['json']['rejected']), $add['json']);

// --- Private Bereiche ---
$w = http('POST', '?action=ops&area=labs&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'l1', 'analyte' => 'ferritin', 'value' => 40]]]], $admin);
check('Eigener privater Bereich: schreiben', $w['status'] === 200, $w['json']);
$r = http('GET', '?area=labs&user=u-a', null, $nobody);
check('Privater Bereich ohne Sitzung → 401', $r['status'] === 401 && ($r['json']['code'] ?? '') === 'session', $r['json']);
$kid = [];
http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0000'], $kid);
$r = http('GET', '?action=changes&area=labs&user=u-a&since=0', null, $kid);
check('Fremde Sitzung liest nicht → 403', $r['status'] === 403 && ($r['json']['code'] ?? '') === 'private', $r['json']);
$r = http('GET', '?action=changes&area=cycle&user=u-k&since=0', null, $admin);
check('Auch die Admin-Person nicht → 403', $r['status'] === 403, $r['json']);
$r = http('GET', '?action=changes&area=health&user=u-k&since=0', null, $nobody);
check('Nicht-private Bereiche wie bisher ohne Sitzung', $r['status'] === 200, $r['json']);

// --- Schutz vor fremden Seiten (CSRF) ---
$r = http('POST', '?action=ops&area=diary&user=u-a', null, $admin, [], '{"ops":[]}', 'text/plain');
check('ops mit text/plain → 415', $r['status'] === 415, $r['json']);
$r = http('POST', '?action=ops&area=diary&user=u-a', ['ops' => []], $admin, ['Sec-Fetch-Site: cross-site']);
check('ops von fremder Seite → 403', $r['status'] === 403 && ($r['json']['code'] ?? '') === 'origin', $r['json']);
$r = http('POST', '?action=delete-user&user=u-k', [], $nobody);
check('delete-user ohne Sitzung → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=delete-user&user=u-a', [], $kid);
check('delete-user als Mitglied → 403', $r['status'] === 403, $r['json']);
$r = http('POST', '?action=health-import', null, $nobody, [], 'x', 'multipart/form-data; boundary=zz');
check('health-import ohne Sitzung → 401', $r['status'] === 401, $r['json']);

// --- Familienregeln ---
$r = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Kind', 'role' => 'admin', 'pinHash' => $H('u-k', '9999')]],
]], $kid);
check('Mitglied macht sich nicht selbst zum Admin', count($r['json']['rejected'] ?? []) === 1, $r['json']);
$r = http('POST', '?action=ops&area=family&scope=family', ['ops' => [
    ['op' => 'upsert', 'record' => ['id' => 'u-k', '_kind' => 'member', 'name' => 'Lena', 'role' => 'user', 'pinHash' => $H('u-k', '9999')]],
]], $kid);
check('Namensänderung geht, fremder PIN-Hash wird ignoriert', empty($r['json']['rejected']) && !str_contains($r['body'], $H('u-k', '9999')), $r['json']);
$relog = []; $rr = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0000'], $relog);
check('… die PIN bleibt die alte', $rr['status'] === 200, $rr['json']);
check('Standard-PIN wird als schwach gemeldet', ($rr['json']['weakPin'] ?? null) === true, $rr['json']);

// --- PIN ändern ---
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '1357', 'old' => '1111'], $kid);
check('Eigene PIN mit falscher alter → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '0000', 'old' => '0000'], $kid);
check('0000 als neue PIN → 400 weak', $r['status'] === 400 && ($r['json']['code'] ?? '') === 'weak', $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-a', 'pin' => '1357'], $kid);
check('Fremde PIN als Mitglied → 403', $r['status'] === 403, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '1357', 'old' => '0000'], $kid);
check('Eigene PIN mit richtiger alter → ok', $r['status'] === 200, $r['json']);
$r = http('GET', '?action=session', null, $relog);
check('Andere Sitzungen der Person beendet', is_array($r['json']) && array_key_exists('user', $r['json']) && $r['json']['user'] === null, $r['json']);
$r = http('POST', '?action=set-pin', ['user' => 'u-k', 'pin' => '8642'], $admin);
check('Admin setzt PIN eines Mitglieds ohne alte → ok', $r['status'] === 200, $r['json']);

// --- Fehlversuchssperre ---
$locker = [];
for ($i = 0; $i < 4; $i++) http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0001'], $locker);
$r = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '0001'], $locker);
check('Fünfter Fehlversuch → 429 locked', $r['status'] === 429 && ($r['json']['code'] ?? '') === 'locked', $r['json']);
$r = http('POST', '?action=login', ['user' => 'u-k', 'pin' => '8642'], $locker);
check('Auch die richtige PIN wartet die Pause ab', $r['status'] === 429, $r['json']);

// --- Kalender-Schlüssel ---
http('POST', '?action=ops&area=events&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'e1', 'name' => 'Stadtlauf', 'date' => '2026-10-10', 'location' => 'Dresden']]]], $admin);
$t = http('POST', '?action=ics-token', ['user' => 'u-a'], $admin);
$token = (string) ($t['json']['token'] ?? '');
check('ics-token für die eigene Person', preg_match('/^[0-9a-f]{48}$/', $token) === 1, $t['json']);
$r = http('GET', "?action=ics&scope=race&id=e1&user=u-a&token={$token}", null, $nobody);
check('Kalender-Link mit Schlüssel → .ics', $r['status'] === 200 && str_contains($r['body'], 'BEGIN:VCALENDAR'), $r['status']);
check('Ohne TZ-Angabe bleibt die Kalender-Zone Europe/Berlin (bestehende Abos unverändert)', str_contains($r['body'], "TZID:Europe/Berlin\r\n") && str_contains($r['body'], 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'), substr($r['body'], 0, 300));
$r = http('GET', '?action=ics&scope=race&id=e1&user=u-a&token=' . str_repeat('0', 48), null, $nobody);
check('Falscher Schlüssel → 403', $r['status'] === 403, $r['status']);
$r = http('POST', '?action=ics-token', ['user' => 'u-a'], $kid);
check('Schlüssel einer anderen Person als Mitglied → 403', $r['status'] === 403 || $r['status'] === 401, $r['json']);

// --- Host-Liste (DNS-Rebinding) ---
$r = http('GET', '?action=ping', null, $nobody, ['Host: evil.example']);
check('Fremder Host → 421', $r['status'] === 421, $r['json']);
$r = http('GET', '?action=ping', null, $nobody, ['Host: nas.local']);
check('Erlaubter Host → 200', $r['status'] === 200, $r['json']);

// --- Health-Import: unplausibel stark gepacktes Archiv wird abgelehnt ---
if (class_exists('ZipArchive')) {
    $zipPath = $tmp . '/bomb.zip';
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE);
    $zip->addFromString('apple_health_export/export.xml', '<HealthData>' . str_repeat(' ', 40 * 1024 * 1024) . '</HealthData>');
    $zip->close();
    $bnd = 'catofitgrenze';
    $body = "--{$bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"export.zip\"\r\nContent-Type: application/zip\r\n\r\n" . file_get_contents($zipPath) . "\r\n--{$bnd}--\r\n";
    $r = http('POST', '?action=health-import', null, $admin, [], $body, "multipart/form-data; boundary={$bnd}");
    check('ZIP mit extremem Packverhältnis → 413', $r['status'] === 413, $r['json']);
} else {
    echo "  --  ZIP-Test übersprungen (ZipArchive fehlt)\n";
}

// --- Health-Eingang: schlankes Tagesformat einer Kurzbefehl-Vorlage (MKT-01) ---
$hkToken = str_repeat('ab', 24);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken]]]], $admin);
$r = http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-29', 'weight' => '72,4', 'restingHr' => 52], $nobody, ["X-Catofit-Token: {$hkToken}"]);
check('Kurzbefehl-Format wird angenommen', $r['status'] === 200 && ($r['json']['health']['days'] ?? 0) === 1, $r['json']);
$r = http('GET', '?area=health&user=u-a', null, $admin);
$day = array_values(array_filter($r['json']['data'] ?? [], fn ($x) => ($x['date'] ?? '') === '2026-09-29'))[0] ?? [];
check('… und landet als Tageswert (72,4 kg, Ruhepuls 52)', ($day['weight'] ?? null) == 72.4 && ($day['restingHr'] ?? null) == 52, $day);
$r = http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-29', 'weight' => 72], $nobody, ['X-Catofit-Token: falsch']);
check('… nur mit dem richtigen Schlüssel', $r['status'] === 401, $r['status']);
// Ein Tag mit anderer Herkunft (hier: Demo-Waage) behält sie – sonst würde seine Muskelmasse
// in der App als alte Apple-„Lean Body Mass“ und damit als fettfreie Masse gelesen.
http('POST', '?action=ops&area=health&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'h-scale', 'date' => '2026-09-27', 'source' => 'demo', 'muscleMass' => 28.2]]]], $admin);
http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-27', 'weight' => 72.1], $nobody, ["X-Catofit-Token: {$hkToken}"]);
http('POST', '?action=health-ingest&user=u-a', ['date' => '2026-09-26', 'weight' => 72.3], $nobody, ["X-Catofit-Token: {$hkToken}"]);
$r = http('GET', '?area=health&user=u-a', null, $admin);
$byDate = [];
foreach ($r['json']['data'] ?? [] as $x) $byDate[$x['date'] ?? ''] = $x;
check('Auto-Import in einen Tag anderer Herkunft: Herkunft und Muskelmasse bleiben', ($byDate['2026-09-27']['source'] ?? '') === 'demo' && ($byDate['2026-09-27']['muscleMass'] ?? null) == 28.2 && ($byDate['2026-09-27']['weight'] ?? null) == 72.1, $byDate['2026-09-27'] ?? null);
check('… ein neuer Tag stammt aus Apple Health', ($byDate['2026-09-26']['source'] ?? '') === 'apple-health', $byDate['2026-09-26'] ?? null);

// --- Sammelabruf und „since“ in der ops-Antwort (FE-26) ---
$r = http('GET', '?action=ping', null, $nobody);
check('ping meldet Sammelabruf und since (API-Version bleibt 1)', ($r['json']['apiVersion'] ?? null) === 1 && in_array('changes-all', $r['json']['features'] ?? [], true) && in_array('ops-since', $r['json']['features'] ?? [], true), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('sessions:0,health:0,labs:0'), null, $admin);
check('changes-all: mehrere Bereiche in einer Antwort, private mit eigener Sitzung', $r['status'] === 200
    && isset($r['json']['revs']['sessions'], $r['json']['revs']['labs']) && ($r['json']['locked'] ?? null) === [] && !empty($r['json']['changes']['health']), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('sessions:0,labs:0,cycle:0'), null, $nobody);
check('… ohne Sitzung: private Bereiche gesperrt, die übrigen geliefert', $r['status'] === 200
    && ($r['json']['locked'] ?? []) === ['labs', 'cycle'] && isset($r['json']['revs']['sessions']) && !isset($r['json']['revs']['labs']), $r['json']);
$r = http('GET', '?action=changes-all&user=u-a&since=' . rawurlencode('gibtsnicht:0'), null, $admin);
check('… unbekannte Bereiche zählen nicht (400 ohne gültigen Bereich)', $r['status'] === 400, $r['json']);
$before = http('GET', '?action=changes&area=sessions&user=u-a&since=0', null, $admin)['json']['rev'] ?? 0;
http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'fremd-1', 'date' => '2026-09-20']]]], $admin);
$r = http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'eigen-1', 'date' => '2026-09-21']]], 'since' => $before], $admin);
$ids = array_column($r['json']['changes']['records'] ?? [], 'id');
check('ops mit since: Antwort enthält auch die fremde Änderung', in_array('fremd-1', $ids, true) && in_array('eigen-1', $ids, true) && ($r['json']['changes']['rev'] ?? 0) === ($r['json']['rev'] ?? -1), $r['json']['changes'] ?? null);
$r = http('POST', '?action=ops&area=sessions&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'eigen-2', 'date' => '2026-09-22']]]], $admin);
check('ops ohne since: Antwort wie bisher', !isset($r['json']['changes']), array_keys($r['json'] ?? []));

// --- Strichcode-Abfrage (MKT-18): nur gültige GTIN gehen nach außen ---
$r = http('GET', '?action=foodfacts&code=' . rawurlencode('4006381333932'), null, $nobody);
check('Strichcode mit falscher Prüfziffer wird ohne Abfrage abgelehnt', ($r['json']['found'] ?? null) === false && ($r['json']['error'] ?? '') === 'Ungültiger Strichcode', $r['json']);
$r = http('GET', '?action=foodfacts&code=' . rawurlencode('../../etc/passwd'), null, $nobody);
check('… Unsinn im Code-Parameter ebenso', ($r['json']['found'] ?? null) === false && isset($r['json']['error']), $r['json']);

// --- Lesezugang für eigene Werkzeuge (MKT-15): standardmäßig aus, nur lesend, ohne Privates ---
$r = http('GET', '?action=read&user=u-a', null, $nobody, ['X-Catofit-Token: ' . str_repeat('cd', 24)]);
check('Lesezugang: ohne eingeschalteten Schlüssel → 401', $r['status'] === 401, $r['json']);
$readTok = str_repeat('cd', 24);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken, 'readToken' => $readTok, 'maxHr' => 188]]]], $admin);
http('POST', '?action=ops&area=labs&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'lab-r', 'analyte' => 'ferritin', 'value' => 40, 'date' => '2026-09-01']]]], $admin);
$r = http('GET', '?action=read&user=u-a&areas=' . rawurlencode('sessions,labs,cycle') . '&from=2026-09-21', null, $nobody, ["X-Catofit-Token: {$readTok}"]);
$data = $r['json']['data'] ?? [];
check('Lesezugang: mit Schlüssel die eigenen Trainings (ab from)', $r['status'] === 200 && isset($data['sessions'])
    && !in_array('2026-09-20', array_column($data['sessions'], 'date'), true) && in_array('eigen-1', array_column($data['sessions'], 'id'), true), $r['json']);
check('… Labor und Zyklus auch auf Wunsch nicht', !isset($data['labs']) && !isset($data['cycle']) && !str_contains($r['body'], 'ferritin'), array_keys($data));
check('… Profil ohne Schlüssel', ($r['json']['profile']['maxHr'] ?? null) === 188 && !str_contains($r['body'], $hkToken) && !str_contains($r['body'], $readTok), $r['json']['profile'] ?? null);
$r = http('GET', '?action=read&user=u-a', null, $nobody, ['X-Catofit-Token: ' . str_repeat('ab', 24)]);
check('… falscher Schlüssel → 401', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=read&user=u-a', ['x' => 1], $nobody, ["X-Catofit-Token: {$readTok}"]);
check('… nur lesend (POST → 405)', $r['status'] === 405, $r['json']);
http('POST', '?action=ops&area=profile&user=u-a', ['ops' => [['op' => 'upsert', 'record' => ['id' => 'profile', 'name' => 'Admin', 'healthToken' => $hkToken, 'readToken' => null]]]], $admin);
$r = http('GET', '?action=read&user=u-a', null, $nobody, ["X-Catofit-Token: {$readTok}"]);
check('… ausgeschaltet → der alte Schlüssel gilt sofort nicht mehr', $r['status'] === 401, $r['json']);

// --- Android: Health Connect über eine Brücken-App (MKT-02, MKT-19) ---
$hc = ['app_version' => '1.4.0',
    'weight' => [['kilograms' => 71.8, 'time' => '2026-09-25T05:00:00Z']],
    'exercise' => [['type' => 'RUNNING', 'start_time' => '2026-09-25T16:00:00Z', 'end_time' => '2026-09-25T16:45:00Z', 'duration_seconds' => 2700, 'distance_meters' => 8000]],
    'heart_rate' => [['bpm' => 148, 'time' => '2026-09-25T16:20:00Z']],
    'menstruation_period' => [['start_time' => '2026-09-10T06:00:00Z', 'end_time' => '2026-09-13T06:00:00Z']]];
$r1 = http('POST', '?action=health-ingest&user=u-a', $hc, $nobody, ["X-Catofit-Token: {$hkToken}"]);
$r2 = http('POST', '?action=health-ingest&user=u-a', $hc, $nobody, ["X-Catofit-Token: {$hkToken}"]);   // Brücke schickt 48 h rollierend
check('Health Connect: Tageswert, Training und Periode angenommen', $r1['status'] === 200 && ($r1['json']['sessions']['imported'] ?? 0) === 1 && ($r1['json']['cycle']['periods'] ?? 0) === 1, $r1['json']);
check('… wiederholte Sendung legt nichts doppelt an', ($r2['json']['cycle']['periods'] ?? -1) === 0, $r2['json']);
$s = http('GET', '?area=sessions&user=u-a', null, $admin);
$hcs = array_values(array_filter($s['json']['data'] ?? [], fn ($x) => ($x['source'] ?? '') === 'health-connect'));
check('… ein Training mit Ø-HF, Herkunft Health Connect', count($hcs) === 1 && ($hcs[0]['avgHr'] ?? null) === 148 && ($hcs[0]['date'] ?? '') === '2026-09-25', $hcs);
$c = http('GET', '?area=cycle&user=u-a', null, $admin);
$per = array_values(array_filter($c['json']['data'] ?? [], fn ($x) => ($x['startDate'] ?? '') === '2026-09-10'));
check('… Periode im privaten Zyklus-Bereich (4 Tage)', count($per) === 1 && ($per[0]['periodLength'] ?? null) === 4, $c['json']['data'] ?? null);

// --- Abmelden ---
http('POST', '?action=logout', [], $admin);
$r = http('GET', '?area=labs&user=u-a', null, $admin);
check('Nach dem Abmelden kein Zugriff mehr', $r['status'] === 401, $r['json']);

// --- Einzige Admin-Person hat die PIN vergessen: Werkzeug für den Server (DOC-10) ---
@mkdir($tmp . '/tools', 0775, true);
copy($root . '/tools/reset-pin.php', $tmp . '/tools/reset-pin.php');
$again = [];
http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $again);   // offene Sitzung, die enden muss
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tmp . '/tools/reset-pin.php') . ' Admin 0000 2>&1', $o1, $c1);
check('reset-pin: 0000 wird abgelehnt', $c1 === 1, implode(' ', $o1));
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tmp . '/tools/reset-pin.php') . ' Admin 1357 2>&1', $o2, $c2);
check('reset-pin: neue PIN gesetzt', $c2 === 0, implode(' ', $o2));
$r = http('GET', '?area=labs&user=u-a', null, $again);
check('reset-pin: bestehende Sitzungen der Person beendet', $r['status'] === 401, $r['status']);
$fresh = [];
$r = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '2468'], $fresh);
check('reset-pin: alte PIN gilt nicht mehr', $r['status'] === 401, $r['json']);
$r = http('POST', '?action=login', ['user' => 'u-a', 'pin' => '1357'], $fresh);
check('reset-pin: Anmeldung mit der neuen PIN', $r['status'] === 200, $r['json']);
$ctx = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 5]]);
$webBody = @file_get_contents("http://127.0.0.1:{$port}/tools/reset-pin.php?x=1", false, $ctx);
check('reset-pin läuft nicht über das Web (403, ohne Ausgabe)', str_contains((string) ($http_response_header[0] ?? ''), ' 403') && $webBody === '', $http_response_header[0] ?? null);

// --- Ergebnis --------------------------------------------------------------
echo "\napi: {$pass} ok, {$fail} fehlgeschlagen\n";
exit($fail === 0 ? 0 : 1);
