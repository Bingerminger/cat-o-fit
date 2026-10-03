<?php
/**
 * health-ingest.php — Automatischer, INKREMENTELLER Health-Eingang.
 *
 * Empfängt kleine JSON-Payloads der iOS-App „Health Auto Export" (REST-API-
 * Automation, JSON v2), das schlanke Tagesformat einer Kurzbefehl-Vorlage
 * ({ "date": …, "weight": …, … }, siehe hi_parse_simple) oder die Arrays einer
 * Android-Brücke für Health Connect (hi_parse_hcw) – und schreibt daraus
 * SERVER-SEITIG in die Bereiche des Nutzers:
 *   - health  : ein Eintrag pro Tag, feldweise gemergt (Gewicht, Ruhepuls, HRV,
 *               VO₂max, Schlaf, Körperfett, fettfreie Masse, Schritte, aktive Energie)
 *   - sessions: Workout-Zusammenfassungen, dedupliziert per HealthKit-UUID bzw. Startzeit
 *   - cycle   : Periodenbeginne, falls die Quelle sie schickt (privater Bereich)
 * Der Client zieht die neuen Werte beim nächsten Sync – kein Upload, kein
 * Client-Umbau. Statt eines 300-MB-Vollexports fließen nur KB-große Tagesdaten.
 *
 * Die REINE Mapping-Logik liegt in health-map.php (`hi_parse`, ohne DB – testbar,
 * siehe tools/test-health-ingest.php). Hier: Auth + Merge/Dedup + Schreiben.
 *
 * Auth: Der Endpunkt liegt hinter dem .htpasswd der Seite; ZUSÄTZLICH ein
 * per-Nutzer-Token (profile.healthToken). Aufruf:
 *   POST api/api.php?action=health-ingest&user=<id>   mit Header  X-Catofit-Token: <secret>
 * (empfohlen, der Schlüssel landet so in keinem Zugriffsprotokoll) oder – wie bisher –
 *   POST api/api.php?action=health-ingest&user=<id>&token=<secret>
 *
 * Eingebunden von api.php (respond()/fail() stehen dort bereit).
 */
declare(strict_types=1);

require_once __DIR__ . '/health-map.php';

// --- Nutzer + Token -------------------------------------------------------
$user  = isset($_GET['user']) ? (string) $_GET['user'] : '';
$token = isset($_GET['token']) ? (string) $_GET['token']
       : (string) ($_SERVER['HTTP_X_CATOFIT_TOKEN'] ?? '');

if ($user === '' || !is_valid_user($user)) {
    fail('Ungültige oder fehlende Nutzer-ID.', 400);
}
$profileStore = read_store('profile', 'user', $user);
$expected = (string) ($profileStore['records']['profile']['healthToken'] ?? '');
if ($expected === '') {
    fail('Für diesen Nutzer ist noch kein Health-Token hinterlegt (App → Health-Import → Apple Health).', 403);
}
if ($token === '' || !hash_equals($expected, $token)) {
    fail('Ungültiges Token.', 401);
}

// --- Body lesen -----------------------------------------------------------
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    fail('Leerer Request-Body.', 400);
}
if (strlen($raw) > 24 * 1024 * 1024) {   // Sicherheitslimit; Aggregat-Payloads sind KB-groß (Batches nutzen).
    fail('Payload zu groß – „Batch requests" aktivieren oder kleinere Zeiträume senden.', 413);
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    fail('Erwartet JSON.', 400);
}
// Health Auto Export kapselt unter "data"; tolerant bleiben.
$data = is_array($in['data'] ?? null) ? $in['data'] : $in;

// --- Reine Umwandlung (health-map.php) ------------------------------------
// Health Connect (Android-Brücke), schlankes Tagesformat (Kurzbefehl, eigene Skripte)
// oder Health-Auto-Export-Paket.
require_once __DIR__ . '/icstz.php';
$parsed = hi_is_hcw($data) ? hi_parse_hcw($data, ics_timezone())
    : (hi_is_simple($data) ? hi_parse_simple($data) : hi_parse($data));
$ingestSource = $parsed['source'] ?? 'apple-health';

// --- health: nach Datum mergen (ein Eintrag/Tag; Nutzerfelder erhalten) ---
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
        $merged = array_merge($base, $fields);        // Gerätewerte überschreiben; mood/energy/notes bleiben
        // Herkunft nur bei neuen oder schon automatisch importierten Tagen setzen. Ein Tag mit
        // anderer Herkunft (von Hand, Demo) behält sie – sonst läse die App dessen Waagen-
        // Muskelmasse als alte Apple-„Lean Body Mass“, also als fettfreie Masse.
        $src = (string) ($base['source'] ?? '');
        $merged['source'] = in_array($src, ['', 'apple-health', 'health', 'health-connect'], true) ? $ingestSource : $src;
        $healthOps[] = ['op' => 'upsert', 'record' => $merged];
    }
}

// --- sessions: dedup per hk-UUID + gegen manuell geloggte Einheiten -------
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
                if ($dd < 0.4 && $dt < 120) { $skippedDup++; continue 2; }   // manuelle Einheit gewinnt
            }
        }
        $s['createdAt'] = $store['records'][$id]['createdAt'] ?? $now;
        $sessionOps[] = ['op' => 'upsert', 'record' => $s];
    }
}

// --- cycle: Periodenbeginne (privater Bereich der Person; nur, was die Quelle schickt) ---
$cycleOps = [];
if (!empty($parsed['periods'])) {
    $store = read_store('cycle', 'user', $user);
    $known = [];
    foreach ($store['records'] as $rec) {
        if (is_array($rec) && !($rec['deleted'] ?? false) && empty($rec['_kind']) && isset($rec['startDate'])) $known[] = strtotime((string) $rec['startDate']);
    }
    foreach ($parsed['periods'] as $p) {
        $ts = strtotime($p['start']);
        // Schon erfasst (auch von Hand, ± 3 Tage)? Dann bleibt der vorhandene Eintrag.
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

// --- Schreiben (atomar, mit rev) ------------------------------------------
if ($healthOps)  apply_ops('health',   'user', $user, $healthOps);
if ($sessionOps) apply_ops('sessions', 'user', $user, $sessionOps);
if ($cycleOps)   apply_ops('cycle',    'user', $user, $cycleOps);

respond([
    'ok' => true,
    'received'       => $parsed['received'],
    'health'         => ['days' => count($healthOps), 'dates' => array_slice(array_keys($parsed['healthByDate']), 0, 10)],
    'sessions'       => ['imported' => count($sessionOps), 'skippedDuplicate' => $skippedDup, 'skippedUnmappedType' => $parsed['skippedUnmappedType']],
    'cycle'          => ['periods' => count($cycleOps)],
    'ignoredMetrics' => $parsed['ignoredMetrics'],   // welche Metrik-Namen (noch) nicht gemappt werden
    'warnings'       => $parsed['warnings'],
]);
