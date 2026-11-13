<?php
/**
 * dev-router.php — router for PHP's built-in web server, for working locally:
 *
 *   php -S localhost:8000 tools/dev-router.php
 *
 * `php -S` does not read `.htaccess`: without this router it hands out `data/` (everyone's training,
 * health and cycle data), `.git` and the tools to anyone who can reach the port. The router blocks
 * the same paths as the `.htaccess` files and sends the same security headers – it reads them from
 * the root `.htaccess`, so there is one source. Still only for your own computer: the built-in server
 * is not meant for a network (see docs/operations/installation.md).
 */

declare(strict_types=1);

$root = dirname(__DIR__);
// The path without the query – not via parse_url(): it reads "//data/…" as a host name.
$path = rawurldecode(explode('?', (string) ($_SERVER['REQUEST_URI'] ?? '/'), 2)[0]);
$path = '/' . ltrim((string) preg_replace('#[/\\\\]+#', '/', $path), '/');   // "//data" and "\data" are "/data"

// The same paths the .htaccess files close: data, tools, tests, docs, Docker and work folders, dot files
// (.git, .htaccess …), Markdown and project files, and every PHP file in api/ except the one entry point.
// Case-insensitive: "/DATA" is the same folder on macOS and Windows.
$blocked = preg_match('#^/(data|tools|test|docs|docker|scratch|graphify-out|node_modules)(/|$)#i', $path)
    || preg_match('#(^|/)\.#', $path)
    || preg_match('#\.md$#i', $path)
    || preg_match('#^/(package\.json|package-lock\.json|test-setup\.js|Dockerfile|docker-compose\.yml)$#i', $path)
    || (preg_match('#^/api/.+\.php$#i', $path) && $path !== '/api/api.php');

// Security headers exactly as in the root .htaccess ("Header always set <name> "<value>"").
$htaccess = (string) @file_get_contents($root . '/.htaccess');
if (preg_match_all('/^\s*Header always set ([A-Za-z-]+) "(.*)"\s*$/m', $htaccess, $m, PREG_SET_ORDER)) {
    foreach ($m as [, $name, $value]) {
        header("{$name}: {$value}");
    }
}

if ($blocked) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "403 Forbidden\n";
    return true;
}

if ($path === '/api/api.php') {
    return false;                                   // the API runs as usual
}
// Everything else is served here: with `return false` the built-in server would resolve the path itself
// ("//data/…" included) and leave out the headers above.
$file = $path === '/' ? $root . '/index.html' : $root . $path;
if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "404 Not Found\n";
    return true;
}
$types = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'webmanifest' => 'application/manifest+json',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp',
    'ico' => 'image/x-icon', 'woff2' => 'font/woff2', 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg',
    'wav' => 'audio/wav', 'txt' => 'text/plain; charset=utf-8', 'xml' => 'application/xml',
];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
if ($ext === 'php') {
    http_response_code(403);
    return true;
}
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('Content-Length: ' . (string) filesize($file));
if ($ext === 'html' || basename($file) === 'service-worker.js') {
    header('Cache-Control: no-cache');
}
readfile($file);
return true;
