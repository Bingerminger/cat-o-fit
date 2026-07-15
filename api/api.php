<?php
/**
 * api.php — schlanke REST-artige API für die Lauf-Trainings-App.
 *
 * Endpunkte (alle relativ zu /api/api.php):
 *   GET  ?action=changes&area=<a>&user=<u>&since=<rev>  -> geänderte Datensätze
 *   POST ?action=ops&area=<a>&user=<u>   (Body {ops:[…]}) -> Operationen anwenden
 *   GET  ?area=<bereich>            -> logische Sicht (Liste/Objekt) – Debug/Kompat
 *   GET  ?action=ping              -> Health-Check der API
 *   GET  ?action=ics&...           -> .ics-Kalenderexport (siehe ics.php)
 *   POST ?action=health-import     -> Apple-Health-Export importieren (siehe health-import.php)
 *   POST ?action=delete-user&user= -> Datenverzeichnis eines Nutzers löschen
 *
 * Die App ist "local-first": Das Frontend speichert sofort lokal und
 * synchronisiert im Hintergrund. Seit v3.0.0 ist der SERVER die Merge-Autorität:
 * Clients schicken Operationen, der Server vergibt eine monotone `rev` je
 * Datensatz (siehe storage.php).
 */

declare(strict_types=1);

require __DIR__ . '/storage.php';

// ---------------------------------------------------------------------------
// Header: JSON-Antworten, kein Caching der dynamischen Daten.
// (Gleicher Origin: Die App liegt auf derselben Synology -> kein CORS nötig.)
// ---------------------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** Einheitliche JSON-Antwort + sauberer Abbruch. */
function respond(mixed $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Fehlerantwort im einheitlichen Format. */
function fail(string $message, int $status = 400): never
{
    respond(['ok' => false, 'error' => $message], $status);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$area   = isset($_GET['area']) ? (string) $_GET['area'] : '';
$scope  = (isset($_GET['scope']) && $_GET['scope'] === 'family') ? 'family' : 'user';
$user   = isset($_GET['user']) ? (string) $_GET['user'] : null;

// ---------------------------------------------------------------------------
// Sonderaktionen vor der generischen Bereichs-API.
// ---------------------------------------------------------------------------
if ($action === 'ping') {
    respond(['ok' => true, 'pong' => true, 'time' => date('c'), 'php' => PHP_VERSION]);
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
    if ($method !== 'POST') {
        fail('Health-Import erwartet POST.', 405);
    }
    require __DIR__ . '/health-import.php';
    exit;
}

if ($action === 'health-ingest') {
    // Automatischer, inkrementeller Health-Eingang (App „Health Auto Export").
    if ($method !== 'POST') {
        fail('health-ingest erwartet POST.', 405);
    }
    require __DIR__ . '/health-ingest.php';
    exit;
}

if ($action === 'delete-user') {
    if ($method !== 'POST') {
        fail('delete-user erwartet POST.', 405);
    }
    if ($user === null || !is_valid_user($user)) {
        fail('Ungültige oder fehlende Nutzer-ID.', 400);
    }
    try {
        delete_user($user);
        respond(['ok' => true, 'deleted' => $user]);
    } catch (Throwable $e) {
        fail('Löschen fehlgeschlagen: ' . $e->getMessage(), 500);
    }
}

// ---------------------------------------------------------------------------
// Bereichs-API (Operationen/Änderungen, nutzerbezogen oder familienweit).
// ---------------------------------------------------------------------------
// Einmalige Migration alter Single-User-Daten zur ersten Familie sicherstellen.
ensure_bootstrap();

if ($area === '') {
    fail('Parameter "area" oder "action" fehlt.', 400);
}
if (!is_valid_area($area, $scope)) {
    fail("Unbekannter Bereich: {$area}", 404);
}

try {
    // Inkrementelle Änderungen holen: ?action=changes&since=<rev>
    if ($action === 'changes') {
        if ($method !== 'GET') {
            fail('changes erwartet GET.', 405);
        }
        $since = isset($_GET['since']) ? max(0, (int) $_GET['since']) : 0;
        $res = changes_since($area, $scope, $user, $since);
        respond(['ok' => true, 'area' => $area, 'rev' => $res['rev'], 'records' => $res['records']]);
    }

    // Operationen anwenden: ?action=ops  (Body {ops:[…]})
    if ($action === 'ops') {
        if ($method !== 'POST') {
            fail('ops erwartet POST.', 405);
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            fail('Leerer Request-Body.', 400);
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['ops']) || !is_array($decoded['ops'])) {
            fail('Erwartet {"ops": [...]}.', 400);
        }
        if (count($decoded['ops']) > 2000) {
            fail('Zu viele Operationen in einem Batch.', 413);
        }
        $res = apply_ops($area, $scope, $user, $decoded['ops']);
        respond(['ok' => true, 'area' => $area, 'rev' => $res['rev'], 'records' => $res['records']]);
    }

    // Debug/Kompatibilität: logische Sicht eines Bereichs.
    if ($method === 'GET') {
        $data = load_area($area, $scope, $user);
        respond(['ok' => true, 'area' => $area, 'data' => $data]);
    }

    fail('Unbekannte Aktion. Nutze ?action=changes (GET) oder ?action=ops (POST).', 400);
} catch (Throwable $e) {
    fail('Serverfehler: ' . $e->getMessage(), 500);
}
