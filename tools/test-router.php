<?php
/**
 * test-router.php — the router for PHP's built-in server (tools/dev-router.php):
 *
 *   php tools/test-router.php
 *
 * Starts `php -S … tools/dev-router.php` on a temporary copy (a fake data/ and .git inside) and checks
 * that what the .htaccess files close stays closed – also as "//data", "/DATA" or "/api/auth.php" – and
 * that the app pages carry the same security headers as with Apache. Exit code 0 = all green.
 */
declare(strict_types=1);

$root = dirname(__DIR__);
$pass = 0;
$fail = 0;
function check(string $name, bool $cond, $got = null): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FAILED  $name" . ($got !== null ? '  (got: ' . json_encode($got, JSON_UNESCAPED_UNICODE) . ')' : '') . "\n"; }
}
function rrmdir(string $dir): void
{
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
        if (in_array(basename($f), ['.', '..'], true)) continue;
        if (is_dir($f)) rrmdir($f); else @unlink($f);
    }
    @rmdir($dir);
}

// Temporary copy: the page, one module, the API with its catalogs, the router – and things that must stay closed.
$tmp = sys_get_temp_dir() . '/catofit-router-test-' . getmypid();
foreach (['api', 'js', 'tools', 'locales', 'data/family', '.git'] as $d) @mkdir("{$tmp}/{$d}", 0777, true);
foreach (['index.html', '.htaccess', 'README.md', 'package.json', 'js/app.js', 'tools/dev-router.php', 'locales/languages.json'] as $f) copy("{$root}/{$f}", "{$tmp}/{$f}");
foreach (glob($root . '/api/*.php') as $f) copy($f, $tmp . '/api/' . basename($f));
foreach (glob($root . '/locales/*/server.json') as $f) { @mkdir($tmp . '/locales/' . basename(dirname($f))); copy($f, $tmp . '/locales/' . basename(dirname($f)) . '/server.json'); }
file_put_contents("{$tmp}/data/family/family.json", '{"secret":"family"}');
file_put_contents("{$tmp}/.git/HEAD", 'ref: refs/heads/main');

$probe = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($probe, false), ':'), 1);
fclose($probe);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", 'tools/dev-router.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $tmp);
register_shutdown_function(static function () use ($proc, $tmp) {
    if (is_resource($proc)) { proc_terminate($proc); proc_close($proc); }
    rrmdir($tmp);
});
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);

/** Raw request (the path exactly as given – no client normalises "//" or "%2e" away). */
function get(int $port, string $path): array
{
    $s = fsockopen('127.0.0.1', $port);
    fwrite($s, "GET {$path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    $raw = stream_get_contents($s);
    fclose($s);
    [$head, $body] = array_pad(explode("\r\n\r\n", (string) $raw, 2), 2, '');
    preg_match('#^HTTP/\S+ (\d+)#', $head, $m);
    $headers = [];
    foreach (explode("\r\n", $head) as $line) if (str_contains($line, ':')) { [$k, $v] = explode(':', $line, 2); $headers[strtolower(trim($k))] = trim($v); }
    return ['status' => (int) ($m[1] ?? 0), 'headers' => $headers, 'body' => $body];
}

$closed = ['/data/family/family.json', '//data/family/family.json', '/DATA/family/family.json', '/data%2Ffamily%2Ffamily.json',
    '/.git/HEAD', '/.htaccess', '/README.md', '/package.json', '/api/auth.php', '/api/storage.php', '/tools/dev-router.php',
    '/js/../data/family/family.json', '/%2e%2e/etc/passwd'];
foreach ($closed as $p) {
    $r = get($port, $p);
    check("closed: {$p}", $r['status'] >= 400 && !str_contains($r['body'], 'secret') && !str_contains($r['body'], 'refs/heads'), [$r['status'], substr($r['body'], 0, 60)]);
}

$page = get($port, '/');
check('start page is served', $page['status'] === 200 && str_contains($page['body'], '<html'), $page['status']);
$ht = (string) file_get_contents($root . '/.htaccess');
preg_match_all('/^\s*Header always set ([A-Za-z-]+) "(.*)"\s*$/m', $ht, $m, PREG_SET_ORDER);
check('the .htaccess names its security headers', count($m) >= 5, count($m));
foreach (['/', '/js/app.js'] as $p) {
    $r = get($port, $p);
    foreach ($m as [, $name, $value]) {
        check("{$p}: {$name} as in .htaccess", ($r['headers'][strtolower($name)] ?? null) === $value, $r['headers'][strtolower($name)] ?? null);
    }
}
$js = get($port, '/js/app.js');
check('modules as text/javascript', str_starts_with($js['headers']['content-type'] ?? '', 'text/javascript'), $js['headers']['content-type'] ?? null);
$ping = get($port, '/api/api.php?action=ping');
check('the API answers', $ping['status'] === 200 && str_contains($ping['body'], '"pong"'), [$ping['status'], substr($ping['body'], 0, 80)]);

// The nginx proposal in the installation guide sends the same headers (en and de).
foreach (['docs/operations/installation.md', 'docs/de/operations/installation.md'] as $doc) {
    $text = (string) file_get_contents($root . '/' . $doc);
    foreach ($m as [, $name, $value]) {
        check("{$doc}: nginx sends {$name}", str_contains($text, "add_header {$name} \"{$value}\" always;"));
    }
}

echo "\nrouter: {$pass} ok, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
