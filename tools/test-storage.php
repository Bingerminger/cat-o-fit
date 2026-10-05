<?php
/**
 * test-storage.php — tests for the persistence layer (api/storage.php) against a
 * fresh temp data directory. Without a server, never touches real data. Run:
 *
 *   php tools/test-storage.php
 *
 * Exit code 0 = all green, 1 = at least one failure. Also runs in CI (.github/workflows/ci.yml).
 */
declare(strict_types=1);

// storage.php fixes DATA_DIR relative to itself. A copy in a
// temp directory redirects all write accesses there.
$tmp = sys_get_temp_dir() . '/catofit-storage-test-' . getmypid();
@mkdir($tmp . '/api', 0775, true);
copy(__DIR__ . '/../api/storage.php', $tmp . '/api/storage.php');
require $tmp . '/api/storage.php';

function rrmdir(string $dir): void {
    foreach (glob($dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
        if (in_array(basename($f), ['.', '..'], true)) continue;
        if (is_dir($f)) rrmdir($f); else { @chmod($f, 0664); @unlink($f); }
    }
    @rmdir($dir);
}
register_shutdown_function(static fn() => rrmdir($tmp));

$pass = 0; $fail = 0;
function check(string $name, bool $cond, $got = null): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  OK  $name\n"; }
    else { $fail++; echo "  FAILED  $name" . ($got !== null ? "  (got: " . json_encode($got, JSON_UNESCAPED_UNICODE) . ")" : "") . "\n"; }
}
function live(array $recs, string $id): bool { return isset($recs[$id]) && empty($recs[$id]['deleted']); }

// --- 1) Unreadable file: fail loudly, existing data stays untouched -----------
$u = 'u-test';
apply_ops('sessions', 'user', $u, [
    ['op' => 'upsert', 'record' => ['id' => 's-1', 'date' => '2026-09-01']],
    ['op' => 'upsert', 'record' => ['id' => 's-2', 'date' => '2026-09-02']],
]);
$path = area_path('sessions', 'user', $u);
$before = file_get_contents($path);
chmod($path, 0000);
clearstatcache();
if (is_readable($path)) {
    echo "  --  unreadable file: skipped (process may read despite mode 000, e.g. root)\n";
} else {
    $threw = false;
    try { apply_ops('sessions', 'user', $u, [['op' => 'upsert', 'record' => ['id' => 's-3']]]); }
    catch (RuntimeException $e) { $threw = true; }
    chmod($path, 0664);
    check('unreadable file: writing fails with an error', $threw);
    check('unreadable file: contents unchanged (no one-record file)', file_get_contents($path) === $before);
}
chmod($path, 0664);

// --- 2) An empty file still counts as an empty area ----------------------------
file_put_contents(area_path('diary', 'user', $u), '');
$s = read_store('diary', 'user', $u);
check('empty file -> empty area', $s['rev'] === 0 && $s['records'] === [], $s);

// --- 3) Corrupt file: error + backup copy (existing behaviour) -------
file_put_contents(area_path('events', 'user', $u), '{kaputt');
$threw = false;
try { read_store('events', 'user', $u); } catch (RuntimeException $e) { $threw = true; }
check('corrupt file: error + .corrupt copy', $threw && (glob(area_path('events', 'user', $u) . '.corrupt-*') ?: []) !== []);

// --- 4) replace with baseRev: late restore spares newer data ------
$v = 'u-restore';
$r = apply_ops('health', 'user', $v, [
    ['op' => 'upsert', 'record' => ['id' => 'h-alt', 'weight' => 70]],
    ['op' => 'upsert', 'record' => ['id' => 'h-weg', 'weight' => 71]],
]);
$base = $r['rev'];
apply_ops('health', 'user', $v, [   // inputs made after the state of the restore
    ['op' => 'upsert', 'record' => ['id' => 'h-neu', 'weight' => 69]],
    ['op' => 'upsert', 'record' => ['id' => 'h-alt', 'weight' => 68.5]],
]);
apply_ops('health', 'user', $v, [['op' => 'replace', 'baseRev' => $base, 'records' => [
    ['id' => 'h-alt', 'weight' => 70],
    ['id' => 'h-backup', 'weight' => 72],
]]]);
$recs = read_store('health', 'user', $v)['records'];
check('baseRev: newer record is kept', live($recs, 'h-neu'));
check('baseRev: newer change is not rolled back', ($recs['h-alt']['weight'] ?? null) === 68.5, $recs['h-alt'] ?? null);
check('baseRev: record from the backup is added', live($recs, 'h-backup'));
check('baseRev: older record missing from the backup is removed', !empty($recs['h-weg']['deleted']));

// --- 5) replace without baseRev stays authoritative (existing behaviour) -----------
apply_ops('health', 'user', $v, [['op' => 'replace', 'records' => [['id' => 'h-nur', 'weight' => 1]]]]);
$recs = read_store('health', 'user', $v)['records'];
check('without baseRev: only the sent records remain', live($recs, 'h-nur') && !live($recs, 'h-neu') && !live($recs, 'h-alt') && !live($recs, 'h-backup'));

// --- Result --------------------------------------------------------------
echo "\nstorage: {$pass} ok, {$fail} failed\n";
exit($fail === 0 ? 0 : 1);
