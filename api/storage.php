<?php
/**
 * storage.php — Kern-Persistenzschicht von Cat-O-Fit (Familien-/Mehrbenutzer).
 *
 * Seit v3.0.0 ist der SERVER die Merge-Autorität (Option B):
 *  - Jeder Bereich wird als „Store" gespeichert:  { "rev": <int>, "records": { "<id>": {…} } }
 *  - Clients schicken OPERATIONEN (upsert/delete/replace) statt ganzer Arrays.
 *    Der Server wendet sie unter exklusivem Lock an, vergibt eine streng
 *    monotone, server-autoritative `rev` pro Datensatz und einen Server-
 *    Zeitstempel. Dadurch entfällt jede Abhängigkeit von der Geräte-Uhr und
 *    konkurrierende Edits verschiedener Datensätze gehen nie verloren.
 *  - Clients holen Änderungen inkrementell (`changes since <rev>`).
 *  - Löschungen sind Tombstones (`deleted:true`) – sie tragen ihre eigene rev
 *    und setzen sich so über alle Geräte durch.
 *
 *  Speicherorte:
 *      • nutzerbezogen:  data/users/<userId>/<area>.json
 *      • familienweit:   data/family/<area>.json
 *  Die Familie ist eine Sammlung von Datensätzen: je Mitglied ein Record
 *  (_kind=member), plus __settings (_kind=settings) und __pantry (_kind=pantry).
 *  So mischt sich die Mitgliederliste PRO MITGLIED – kein stiller Verlust mehr,
 *  wenn zwei Admins gleichzeitig etwas ändern.
 *
 *  Schreibsicherheit: atomar (Temp-Datei -> rename) + flock über eine
 *  Sidecar-Lock-Datei (<area>.json.lock).
 *
 *  Migration: Alte (flache bzw. v2-) Daten werden beim ersten Lesen
 *  DETERMINISTISCH ins Store-Format überführt (gleiche rev-Vergabe bei Lese-
 *  und Schreibzugriff). Beim ersten Schreiben wird das Store-Format persistiert.
 *
 * Zielsystem: Synology Web Station, PHP 8.x (keine Datenbank).
 */

declare(strict_types=1);

// Verzeichnis mit den JSON-Daten (liegt eine Ebene über /api).
const DATA_DIR = __DIR__ . '/../data';

/** Nutzerbezogene Bereiche (pro Person) -> Default-Struktur. */
function user_areas(): array
{
    return [
        'profile'   => 'object',
        'events'    => 'array',
        'plans'     => 'array',
        'sessions'  => 'array',
        'health'    => 'array',
        'nutrition' => 'array',
        'diary'     => 'array',
        'shopping'  => 'array',
        'checklist' => 'array',
        'cycle'     => 'array',
        'reports'   => 'array',
    ];
}

/** Familienweite Bereiche (gemeinsam) -> Default-Struktur. */
function family_areas(): array
{
    return [
        'family' => 'object',   // Mitglieder, Rollen, Familien-Einstellungen, Lager
    ];
}

/** Default-Art eines Bereichs ('array' -> Liste, 'object' -> Einzel-Objekt) oder null. */
function area_kind(string $area, string $scope): ?string
{
    $map = $scope === 'family' ? family_areas() : user_areas();
    return $map[$area] ?? null;
}

/** Prüft, ob ein Bereich im jeweiligen Scope zulässig ist. */
function is_valid_area(string $area, string $scope): bool
{
    return area_kind($area, $scope) !== null;
}

/** userId-Format absichern (kein „..", kein „/", überschaubare Länge). */
function is_valid_user(string $userId): bool
{
    return preg_match('/^[A-Za-z0-9_-]{1,64}$/', $userId) === 1;
}

/** Datensatz-ID absichern (Pfad-/Injektionsschutz, großzügig genug für alle IDs). */
function valid_record_id(mixed $id): bool
{
    return is_string($id) && preg_match('/^[A-Za-z0-9_:.-]{1,128}$/', $id) === 1;
}

/** Verzeichnis eines Bereichs (familienweit oder pro Nutzer). */
function area_dir(string $scope, ?string $userId): string
{
    return $scope === 'family'
        ? DATA_DIR . '/family'
        : DATA_DIR . '/users/' . $userId;
}

/** Absoluter Pfad zur JSON-Datei eines Bereichs. */
function area_path(string $area, string $scope, ?string $userId): string
{
    return area_dir($scope, $userId) . '/' . $area . '.json';
}

/** Wirft, wenn Bereich/Scope/User ungültig sind (gemeinsame Vorprüfung). */
function assert_area(string $area, string $scope, ?string $userId): void
{
    if (!is_valid_area($area, $scope)) {
        throw new InvalidArgumentException("Unbekannter Bereich: {$area}");
    }
    if ($scope === 'user' && ($userId === null || !is_valid_user($userId))) {
        throw new InvalidArgumentException('Ungültige oder fehlende Nutzer-ID.');
    }
}

/* ===================== Store lesen / schreiben / migrieren ================= */

/**
 * Liest den Roh-Store eines Bereichs als ['rev'=>int, 'records'=>[id=>rec]].
 * Erkennt das Store-Format ({rev,records}) und migriert sonst altes Format
 * (flache Liste / Objekt / v2-Familie) DETERMINISTISCH in-memory.
 * Kein eigenes Locking – der Aufrufer hält den Sidecar-Lock.
 */
function read_store(string $area, string $scope, ?string $userId): array
{
    $path = area_path($area, $scope, $userId);
    if (!is_file($path)) {
        return ['rev' => 0, 'records' => []];
    }
    $raw = (string) @file_get_contents($path);
    if (trim($raw) === '') {
        return ['rev' => 0, 'records' => []];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['rev' => 0, 'records' => []]; // beschädigt -> leer statt Crash
    }
    // Bereits Store-Format?
    if (array_key_exists('rev', $data) && array_key_exists('records', $data) && is_array($data['records'])) {
        return ['rev' => (int) $data['rev'], 'records' => $data['records']];
    }
    // Altformat -> migrieren.
    return migrate_old($area, $scope, $data);
}

/**
 * Überführt altes Format in einen Store. Deterministisch: die rev-Vergabe
 * folgt der Reihenfolge in der Datei, damit Lese- und spätere Schreib-
 * Migration identische revs erzeugen.
 */
function migrate_old(string $area, string $scope, array $data): array
{
    $now = date('c');
    $records = [];
    $rev = 0;

    if ($scope === 'family') {
        foreach (($data['members'] ?? []) as $m) {
            $m = (array) $m;
            if (!valid_record_id($m['id'] ?? null)) {
                continue;
            }
            $m['_kind'] = 'member';
            $m['updatedAt'] = $m['updatedAt'] ?? $now;
            $m['rev'] = ++$rev;
            $records[$m['id']] = $m;
        }
        $settings = (array) ($data['settings'] ?? []);
        $settings['id'] = '__settings';
        $settings['_kind'] = 'settings';
        $settings['updatedAt'] = $now;
        $settings['rev'] = ++$rev;
        $records['__settings'] = $settings;

        $records['__pantry'] = [
            'id' => '__pantry', '_kind' => 'pantry',
            'items' => array_values((array) ($data['pantry'] ?? [])),
            'updatedAt' => $now, 'rev' => ++$rev,
        ];
        return ['rev' => $rev, 'records' => $records];
    }

    if (area_kind($area, $scope) === 'array') {
        foreach ($data as $rec) {
            $rec = (array) $rec;
            if (!valid_record_id($rec['id'] ?? null)) {
                continue;
            }
            $rec['updatedAt'] = $rec['updatedAt'] ?? $now;
            $rec['rev'] = ++$rev;
            $records[$rec['id']] = $rec;
        }
        return ['rev' => $rev, 'records' => $records];
    }

    // Objekt-Bereich (profile): genau ein Datensatz „profile".
    $rec = $data;
    $rec['id'] = 'profile';
    $rec['updatedAt'] = $rec['updatedAt'] ?? $now;
    $rec['rev'] = 1;
    return ['rev' => 1, 'records' => ['profile' => $rec]];
}

/** Schreibt den Store atomar (Temp-Datei -> rename). Aufrufer hält den Lock. */
function write_store(string $area, array $store, string $scope, ?string $userId): void
{
    $dir = area_dir($scope, $userId);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    // records IMMER als Objekt kodieren (leere Map sonst als [] statt {}).
    $payload = ['rev' => (int) $store['rev'], 'records' => (object) $store['records']];
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('JSON-Kodierung fehlgeschlagen: ' . json_last_error_msg());
    }

    $target = area_path($area, $scope, $userId);
    $tmp = tempnam($dir, '.tmp_' . $area . '_');
    if ($tmp === false) {
        throw new RuntimeException('Temp-Datei konnte nicht erstellt werden.');
    }
    $fp = fopen($tmp, 'wb');
    if ($fp === false) {
        @unlink($tmp);
        throw new RuntimeException('Temp-Datei konnte nicht geöffnet werden.');
    }
    try {
        $written = fwrite($fp, $json);
        fflush($fp);
    } finally {
        fclose($fp);
    }
    if ($written === false) {
        @unlink($tmp);
        throw new RuntimeException('Schreiben in Temp-Datei fehlgeschlagen.');
    }
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('Atomares Umbenennen fehlgeschlagen.');
    }
    @chmod($target, 0664);
}

/** Öffnet den Sidecar-Lock eines Bereichs (oder null, wenn nicht möglich). */
function store_lock(string $area, string $scope, ?string $userId, bool $exclusive)
{
    $dir = area_dir($scope, $userId);
    if (!is_dir($dir)) {
        if (!$exclusive) {
            return null; // Lesen ohne existierendes Verzeichnis -> kein Lock nötig
        }
        @mkdir($dir, 0775, true);
    }
    $fp = @fopen(area_path($area, $scope, $userId) . '.lock', 'c');
    if ($fp === false) {
        return null;
    }
    flock($fp, $exclusive ? LOCK_EX : LOCK_SH);
    return $fp;
}

function store_unlock($fp): void
{
    if ($fp) {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

/* ============================ Öffentliche API ============================== */

/**
 * Wendet eine Operationsliste atomar an und liefert die neue Bereichs-rev plus
 * die geänderten Datensätze (mit ihrer neuen rev).
 * Ops: {op:'upsert', record:{…,id}} | {op:'delete', id} | {op:'replace', records:[…]}
 */
function apply_ops(string $area, string $scope, ?string $userId, array $ops): array
{
    assert_area($area, $scope, $userId);
    $lock = store_lock($area, $scope, $userId, true);
    try {
        $store = read_store($area, $scope, $userId);
        $now = date('c');
        $applied = [];

        foreach ($ops as $op) {
            $op = (array) $op;
            $type = $op['op'] ?? '';

            if ($type === 'upsert') {
                $rec = (array) ($op['record'] ?? []);
                $id = $rec['id'] ?? null;
                if (!valid_record_id($id)) {
                    continue;
                }
                $rec['id'] = $id;
                unset($rec['deleted']);
                $rec['updatedAt'] = $now;
                $rec['rev'] = ++$store['rev'];
                $store['records'][$id] = $rec;
                $applied[] = $rec;
            } elseif ($type === 'delete') {
                $id = $op['id'] ?? null;
                if (!valid_record_id($id)) {
                    continue;
                }
                $prev = $store['records'][$id] ?? [];
                $tomb = ['id' => $id, 'deleted' => true, 'updatedAt' => $now, 'rev' => ++$store['rev']];
                if (isset($prev['_kind'])) {
                    $tomb['_kind'] = $prev['_kind'];
                }
                $store['records'][$id] = $tomb;
                $applied[] = $tomb;
            } elseif ($type === 'replace') {
                // Ganzen Bereich autoritativ setzen; fehlende IDs werden getombstoned.
                $newRecs = $op['records'] ?? [];
                if (!is_array($newRecs)) {
                    continue;
                }
                $keep = [];
                foreach ($newRecs as $rec) {
                    $rec = (array) $rec;
                    $id = $rec['id'] ?? null;
                    if (!valid_record_id($id)) {
                        continue;
                    }
                    $rec['id'] = $id;
                    unset($rec['deleted']);
                    $rec['updatedAt'] = $now;
                    $rec['rev'] = ++$store['rev'];
                    $store['records'][$id] = $rec;
                    $applied[] = $rec;
                    $keep[$id] = true;
                }
                foreach ($store['records'] as $id => $r) {
                    if (!isset($keep[$id]) && empty($r['deleted'])) {
                        $tomb = ['id' => $id, 'deleted' => true, 'updatedAt' => $now, 'rev' => ++$store['rev']];
                        if (isset($r['_kind'])) {
                            $tomb['_kind'] = $r['_kind'];
                        }
                        $store['records'][$id] = $tomb;
                        $applied[] = $tomb;
                    }
                }
            }
        }

        write_store($area, $store, $scope, $userId);
        return ['rev' => $store['rev'], 'records' => array_values($applied)];
    } finally {
        store_unlock($lock);
    }
}

/** Liefert alle Datensätze mit rev > $since plus die aktuelle Bereichs-rev. */
function changes_since(string $area, string $scope, ?string $userId, int $since): array
{
    assert_area($area, $scope, $userId);
    $lock = store_lock($area, $scope, $userId, false);
    try {
        $store = read_store($area, $scope, $userId);
    } finally {
        store_unlock($lock);
    }
    $out = [];
    foreach ($store['records'] as $r) {
        if ((int) ($r['rev'] ?? 0) > $since) {
            $out[] = $r;
        }
    }
    usort($out, static fn($a, $b) => ((int) ($a['rev'] ?? 0)) <=> ((int) ($b['rev'] ?? 0)));
    return ['rev' => (int) $store['rev'], 'records' => $out];
}

/**
 * Rekonstruiert die LOGISCHE Sicht eines Bereichs (Liste/Objekt ohne Tombstones)
 * aus dem Store. Für Abwärtskompatibilität (z. B. .ics-Erzeugung in ics.php) und
 * Debug-GETs.
 */
function store_to_logical(string $area, string $scope, array $store): mixed
{
    $records = $store['records'];

    if ($scope === 'family') {
        $members = [];
        $settings = new stdClass();
        $pantry = [];
        foreach ($records as $r) {
            if (!empty($r['deleted'])) {
                continue;
            }
            $kind = $r['_kind'] ?? 'member';
            if ($kind === 'member') {
                unset($r['_kind'], $r['rev']);
                $members[] = $r;
            } elseif ($kind === 'settings') {
                unset($r['id'], $r['_kind'], $r['rev'], $r['updatedAt']);
                $settings = (object) $r;
            } elseif ($kind === 'pantry') {
                $pantry = array_values((array) ($r['items'] ?? []));
            }
        }
        usort($members, static fn($a, $b) => strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? '')));
        return ['members' => $members, 'settings' => $settings, 'pantry' => $pantry];
    }

    if (area_kind($area, $scope) === 'array') {
        $out = [];
        foreach ($records as $r) {
            if (!empty($r['deleted'])) {
                continue;
            }
            unset($r['rev']);
            $out[] = $r;
        }
        return $out;
    }

    // profile
    $p = $records['profile'] ?? null;
    if (!is_array($p) || !empty($p['deleted'])) {
        return new stdClass();
    }
    unset($p['rev'], $p['id']);
    return (object) $p;
}

/**
 * Lädt die logische Sicht eines Bereichs (Liste/Objekt). ABWÄRTSKOMPATIBEL –
 * wird u. a. von ics.php genutzt.
 */
function load_area(string $area, string $scope = 'user', ?string $userId = null): mixed
{
    assert_area($area, $scope, $userId);
    $lock = store_lock($area, $scope, $userId, false);
    try {
        $store = read_store($area, $scope, $userId);
    } finally {
        store_unlock($lock);
    }
    $logical = store_to_logical($area, $scope, $store);
    // WICHTIG: PHP-Konsumenten (z. B. ics.php) greifen per OBJEKT-Syntax zu
    // (`$e->id`, `$u->type`). `read_store` arbeitet intern mit assoziativen Arrays;
    // hier tief in Objekte zurückwandeln – wie früher `json_decode(..., false)`.
    return json_decode(json_encode($logical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/**
 * Löscht das komplette Datenverzeichnis eines Nutzers (data/users/<id>/).
 * Wird beim Entfernen eines Familienmitglieds aufgerufen.
 */
function delete_user(string $userId): bool
{
    if (!is_valid_user($userId)) {
        throw new InvalidArgumentException('Ungültige Nutzer-ID.');
    }
    $dir = DATA_DIR . '/users/' . $userId;
    if (!is_dir($dir)) {
        return true; // schon weg
    }
    foreach (glob($dir . '/*') ?: [] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    // versteckte Lock-Dateien mitnehmen
    foreach (glob($dir . '/.*') ?: [] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    return @rmdir($dir);
}

/**
 * Einmalige, idempotente Migration: Existiert noch keine Familie, wird sie im
 * neuen Store-Format angelegt und die bisherigen (flachen) Single-User-Daten
 * dem ersten Admin zugeordnet (als Kopie; Originale bleiben liegen und werden
 * beim ersten Zugriff lazy ins Store-Format migriert).
 * Per Lock gegen Doppelausführung bei gleichzeitigem Erstzugriff geschützt.
 */
function ensure_bootstrap(): void
{
    $familyFile = DATA_DIR . '/family/family.json';
    if (is_file($familyFile)) {
        return; // bereits eingerichtet
    }
    if (!is_dir(DATA_DIR)) {
        @mkdir(DATA_DIR, 0775, true);
    }

    $lock = @fopen(DATA_DIR . '/.bootstrap.lock', 'c');
    if ($lock === false) {
        return;
    }
    try {
        flock($lock, LOCK_EX);
        if (is_file($familyFile)) {
            return; // zwischenzeitlich angelegt
        }
        @mkdir(DATA_DIR . '/family', 0775, true);

        // FRISCHE Installation (keine alten Single-User-Daten)? -> LEERE Familie.
        // Die App-Ersteinrichtung legt dann den ersten Admin an und fragt nach
        // Demodaten. Bewusst KEIN automatisches Mitglied mehr (ab v3.3.0).
        $hasLegacy = is_file(DATA_DIR . '/profile.json')
            || is_file(DATA_DIR . '/events.json')
            || is_file(DATA_DIR . '/sessions.json');
        if (!$hasLegacy) {
            write_store('family', ['rev' => 0, 'records' => []], 'family', null);
            return;
        }

        // --- Sonst: Legacy-Migration der alten Single-User-Daten zum ersten Admin ---
        // Name aus altem Profil übernehmen, falls vorhanden.
        $name = 'Admin';
        $oldProfile = DATA_DIR . '/profile.json';
        if (is_file($oldProfile)) {
            $p = json_decode((string) file_get_contents($oldProfile), true);
            if (is_array($p) && isset($p['name']) && trim((string) $p['name']) !== '') {
                $name = (string) $p['name'];
            }
        }

        $adminId = 'u-1';
        @mkdir(DATA_DIR . '/users/' . $adminId, 0775, true);
        @mkdir(DATA_DIR . '/family', 0775, true);

        // Alte flache Daten zum ersten Admin kopieren (Originale belassen; werden
        // beim ersten read_store() lazy ins Store-Format migriert).
        foreach (array_keys(user_areas()) as $area) {
            $src = DATA_DIR . '/' . $area . '.json';
            if (is_file($src)) {
                @copy($src, DATA_DIR . '/users/' . $adminId . '/' . $area . '.json');
            }
        }

        // Bestehendes (flaches) Lager übernehmen – ab jetzt familienweit.
        $pantry = [];
        $oldPantry = DATA_DIR . '/pantry.json';
        if (is_file($oldPantry)) {
            $pp = json_decode((string) file_get_contents($oldPantry), true);
            if (is_array($pp)) {
                $pantry = array_values($pp);
            }
        }

        $now = date('c');
        $store = ['rev' => 3, 'records' => [
            $adminId => [
                'id' => $adminId, '_kind' => 'member', 'name' => $name, 'role' => 'admin',
                'emoji' => '🏃', 'color' => '#18b48a', 'createdAt' => $now, 'updatedAt' => $now, 'rev' => 1,
            ],
            '__settings' => ['id' => '__settings', '_kind' => 'settings', 'updatedAt' => $now, 'rev' => 2],
            '__pantry' => ['id' => '__pantry', '_kind' => 'pantry', 'items' => $pantry, 'updatedAt' => $now, 'rev' => 3],
        ]];
        write_store('family', $store, 'family', null);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
