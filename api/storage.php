<?php
/**
 * storage.php — core persistence layer of Cat-O-Fit (family / multi-user).
 *
 * Since v3.0.0 the SERVER is the merge authority (option B):
 *  - Each area is stored as a "store":  { "rev": <int>, "records": { "<id>": {…} } }
 *  - Clients send OPERATIONS (upsert/delete/replace) instead of whole arrays.
 *    The server applies them under an exclusive lock and assigns a strictly
 *    monotonic, server-authoritative `rev` per record plus a server
 *    timestamp. This removes any dependency on the device clock, and
 *    concurrent edits to different records are never lost.
 *  - Clients fetch changes incrementally (`changes since <rev>`).
 *  - Deletions are tombstones (`deleted:true`) – they carry their own rev
 *    and thus prevail across all devices.
 *
 *  Storage locations:
 *      • per user:     data/users/<userId>/<area>.json
 *      • family-wide:  data/family/<area>.json
 *  The family is a collection of records: one record per member
 *  (_kind=member), plus __settings (_kind=settings) and __pantry (_kind=pantry).
 *  This way the member list merges PER MEMBER – no more silent loss
 *  when two admins change something at the same time.
 *
 *  Write safety: atomic (temp file -> rename) + flock on a sidecar lock
 *  file (<area>.json.lock).
 *
 *  Migration: old (flat or v2) data is converted to the store format
 *  DETERMINISTICALLY on first read (same rev assignment for read and
 *  write access). The store format is persisted on the first write.
 *
 * Target system: Synology Web Station, PHP 8.x (no database).
 */

declare(strict_types=1);

// Directory holding the JSON data (one level above /api).
const DATA_DIR = __DIR__ . '/../data';

/** Per-user areas (one per person) -> default structure. */
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
        'labs'      => 'array',   // Lab values (private, like cycle)
        'supplements' => 'array', // Supplement plan + intake log (private)
    ];
}

/** Family-wide areas (shared) -> default structure. */
function family_areas(): array
{
    return [
        'family' => 'object',   // Members, roles, family settings, pantry
    ];
}

/** Default kind of an area ('array' -> list, 'object' -> single object) or null. */
function area_kind(string $area, string $scope): ?string
{
    $map = $scope === 'family' ? family_areas() : user_areas();
    return $map[$area] ?? null;
}

/** Checks whether an area is permitted in the given scope. */
function is_valid_area(string $area, string $scope): bool
{
    return area_kind($area, $scope) !== null;
}

/** Validate the userId format (no "..", no "/", reasonable length). */
function is_valid_user(string $userId): bool
{
    return preg_match('/^[A-Za-z0-9_-]{1,64}$/', $userId) === 1;
}

/** Validate a record ID (path / injection protection, generous enough for all IDs). */
function valid_record_id(mixed $id): bool
{
    return is_string($id) && preg_match('/^[A-Za-z0-9_:.-]{1,128}$/', $id) === 1;
}

/** Directory of an area (family-wide or per user). */
function area_dir(string $scope, ?string $userId): string
{
    return $scope === 'family'
        ? DATA_DIR . '/family'
        : DATA_DIR . '/users/' . $userId;
}

/** Absolute path to the JSON file of an area. */
function area_path(string $area, string $scope, ?string $userId): string
{
    return area_dir($scope, $userId) . '/' . $area . '.json';
}

/** Throws if area/scope/user are invalid (shared pre-check). */
function assert_area(string $area, string $scope, ?string $userId): void
{
    if (!is_valid_area($area, $scope)) {
        throw new InvalidArgumentException("Unknown area: {$area}");
    }
    if ($scope === 'user' && ($userId === null || !is_valid_user($userId))) {
        throw new InvalidArgumentException('Invalid or missing user ID.');
    }
}

/* ===================== Read / write / migrate store ================= */

/**
 * Reads the raw store of an area as ['rev'=>int, 'records'=>[id=>rec]].
 * Recognises the store format ({rev,records}); otherwise migrates the old
 * format (flat list / object / v2 family) DETERMINISTICALLY in memory.
 * No locking of its own – the caller holds the sidecar lock.
 */
function read_store(string $area, string $scope, ?string $userId): array
{
    $path = area_path($area, $scope, $userId);
    if (!is_file($path)) {
        return ['rev' => 0, 'records' => []];
    }
    $raw = @file_get_contents($path);
    if ($raw === false) {
        // UNREADABLE (permissions, ACL, I/O error) is not the same as "empty": carrying on
        // with an empty store would mean the next write replaces the whole data set
        // with the one new change. So fail loudly.
        throw new RuntimeException(
            "Data store '{$area}' is not readable (file permissions?). Nothing was changed."
        );
    }
    if (trim($raw) === '') {
        return ['rev' => 0, 'records' => []];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        // CORRUPT: never carry on as an "empty store" – the next
        // write would overwrite the data set for good. Instead,
        // set the file aside (forensics/rescue) and fail loudly.
        $backup = $path . '.corrupt-' . date('Ymd-His');
        if (!is_file($backup)) {
            @copy($path, $backup);
        }
        throw new RuntimeException(
            "Data store '{$area}' is damaged and was saved as " . basename($backup)
            . '. Please restore it from a backup.'
        );
    }
    // Already in store format?
    if (array_key_exists('rev', $data) && array_key_exists('records', $data) && is_array($data['records'])) {
        return ['rev' => (int) $data['rev'], 'records' => $data['records']];
    }
    // Old format -> migrate.
    return migrate_old($area, $scope, $data);
}

/**
 * Converts the old format into a store. Deterministic: the rev assignment
 * follows the order in the file, so that read-time and later write-time
 * migration produce identical revs.
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

    // Object area (profile): exactly one record "profile".
    $rec = $data;
    $rec['id'] = 'profile';
    $rec['updatedAt'] = $rec['updatedAt'] ?? $now;
    $rec['rev'] = 1;
    return ['rev' => 1, 'records' => ['profile' => $rec]];
}

/** Writes the store atomically (temp file -> rename). The caller holds the lock. */
function write_store(string $area, array $store, string $scope, ?string $userId): void
{
    $dir = area_dir($scope, $userId);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    // ALWAYS encode records as an object (otherwise an empty map becomes [] instead of {}).
    $payload = ['rev' => (int) $store['rev'], 'records' => (object) $store['records']];
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('JSON encoding failed: ' . json_last_error_msg());
    }

    $target = area_path($area, $scope, $userId);
    $tmp = tempnam($dir, '.tmp_' . $area . '_');
    if ($tmp === false) {
        throw new RuntimeException('Could not create the temp file.');
    }
    $fp = fopen($tmp, 'wb');
    if ($fp === false) {
        @unlink($tmp);
        throw new RuntimeException('Could not open the temp file.');
    }
    try {
        $written = fwrite($fp, $json);
        fflush($fp);
        // Really force the data onto the disk before the rename: otherwise the
        // directory entry may survive a power cut while the content does not.
        @fsync($fp);
    } finally {
        fclose($fp);
    }
    // IMPORTANT: on a full disk fwrite does NOT return false but a too-small
    // byte count. Without this comparison a truncated JSON file would land
    // atomically at the target – and the area would be unusable on the next read.
    if ($written === false || $written !== strlen($json)) {
        @unlink($tmp);
        throw new RuntimeException('Writing the temp file was incomplete (disk space?).');
    }
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('Atomic rename failed.');
    }
    @chmod($target, 0664);
}

/** Opens the sidecar lock of an area (or null if not possible). */
function store_lock(string $area, string $scope, ?string $userId, bool $exclusive)
{
    $dir = area_dir($scope, $userId);
    if (!is_dir($dir)) {
        if (!$exclusive) {
            return null; // Reading without an existing directory -> no lock needed
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

/* ============================ Public API ============================== */

/**
 * Applies a list of operations atomically and returns the new area rev, the
 * changed records (with their new rev) and rejected ops.
 * Ops: {op:'upsert', record:{…,id}} | {op:'delete', id} | {op:'replace', records:[…]}
 * Optional `$guard(op, store)`: returns the (sanitised) op or a
 * rejection reason (string) – this is how the family, for example, checks roles and
 * PINs under the same lock under which it writes.
 */
function apply_ops(string $area, string $scope, ?string $userId, array $ops, ?callable $guard = null): array
{
    assert_area($area, $scope, $userId);
    $lock = store_lock($area, $scope, $userId, true);
    try {
        $store = read_store($area, $scope, $userId);
        $now = date('c');
        $applied = [];
        $rejected = [];

        foreach ($ops as $op) {
            $op = (array) $op;
            if ($guard !== null) {
                $checked = $guard($op, $store);
                if (is_string($checked)) {
                    $rec = is_array($op['record'] ?? null) ? $op['record'] : [];
                    $rejected[] = ['op' => (string) ($op['op'] ?? ''), 'id' => (string) ($rec['id'] ?? ($op['id'] ?? '')), 'reason' => $checked];
                    continue;
                }
                $op = $checked;
            }
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
                // Set the whole area authoritatively; missing IDs are tombstoned.
                // Optional `baseRev`: the state the replacement refers to (e.g. a
                // restore that is only sent days later). Records that have
                // become NEWER since then (rev > baseRev) are then left untouched –
                // a late replacement does not overwrite more recent input.
                $newRecs = $op['records'] ?? [];
                if (!is_array($newRecs)) {
                    continue;
                }
                $baseRev = isset($op['baseRev']) && is_numeric($op['baseRev']) ? (int) $op['baseRev'] : null;
                $newer = static fn(array $r): bool => $baseRev !== null && (int) ($r['rev'] ?? 0) > $baseRev;
                $keep = [];
                foreach ($newRecs as $rec) {
                    $rec = (array) $rec;
                    $id = $rec['id'] ?? null;
                    if (!valid_record_id($id)) {
                        continue;
                    }
                    if (isset($store['records'][$id]) && $newer($store['records'][$id])) {
                        $keep[$id] = true;   // keep the newer server version
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
                    if (!isset($keep[$id]) && empty($r['deleted']) && !$newer($r)) {
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
        return ['rev' => $store['rev'], 'records' => array_values($applied), 'rejected' => $rejected];
    } finally {
        store_unlock($lock);
    }
}

/** Returns all records with rev > $since plus the current area rev. */
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
 * Reconstructs the LOGICAL view of an area (list/object without tombstones)
 * from the store. For backward compatibility (e.g. .ics generation in ics.php) and
 * debug GETs.
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
 * Loads the logical view of an area (list/object). BACKWARD COMPATIBLE –
 * used by ics.php, among others.
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
    // IMPORTANT: PHP consumers (e.g. ics.php) access via OBJECT syntax
    // (`$e->id`, `$u->type`). `read_store` works internally with associative arrays;
    // convert back deeply into objects here – like `json_decode(..., false)` used to.
    return json_decode(json_encode($logical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/**
 * Deletes the complete data directory of a user (data/users/<id>/).
 * Called when a family member is removed.
 */
function delete_user(string $userId): bool
{
    if (!is_valid_user($userId)) {
        throw new InvalidArgumentException('Invalid user ID.');
    }
    $dir = DATA_DIR . '/users/' . $userId;
    if (!is_dir($dir)) {
        return true; // already gone
    }
    foreach (glob($dir . '/*') ?: [] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    // take hidden lock files along too
    foreach (glob($dir . '/.*') ?: [] as $f) {
        if (is_file($f)) {
            @unlink($f);
        }
    }
    return @rmdir($dir);
}

/**
 * One-off, idempotent migration: if no family exists yet, it is created in the
 * new store format and the previous (flat) single-user data is assigned
 * to the first admin (as a copy; the originals stay in place and are lazily
 * migrated to the store format on first access).
 * Protected by a lock against double execution on simultaneous first access.
 */
function ensure_bootstrap(): void
{
    $familyFile = DATA_DIR . '/family/family.json';
    if (is_file($familyFile)) {
        return; // already set up
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
            return; // created in the meantime
        }
        @mkdir(DATA_DIR . '/family', 0775, true);

        // FRESH installation (no old single-user data)? -> EMPTY family.
        // The app's first-run setup then creates the first admin and asks about
        // demo data. Deliberately NO automatic member any more (since v3.3.0).
        $hasLegacy = is_file(DATA_DIR . '/profile.json')
            || is_file(DATA_DIR . '/events.json')
            || is_file(DATA_DIR . '/sessions.json');
        if (!$hasLegacy) {
            write_store('family', ['rev' => 0, 'records' => []], 'family', null);
            return;
        }

        // --- Otherwise: legacy migration of the old single-user data to the first admin ---
        // Take over the name from the old profile, if there is one.
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

        // Copy old flat data to the first admin (leave the originals; they are lazily
        // migrated to the store format on the first read_store()).
        foreach (array_keys(user_areas()) as $area) {
            $src = DATA_DIR . '/' . $area . '.json';
            if (is_file($src)) {
                @copy($src, DATA_DIR . '/users/' . $adminId . '/' . $area . '.json');
            }
        }

        // Take over the existing (flat) pantry – from now on family-wide.
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
