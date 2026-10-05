<?php
/**
 * reset-pin.php — reset a member's PIN on the server (command line).
 *
 * For the emergency where the only admin person has forgotten their PIN – otherwise
 * in the app an admin person sets other people's PINs. Whoever runs the server has
 * access to data/ anyway; this tool only changes the PIN, ends the person's sessions
 * and clears their failed attempts.
 *
 *   php tools/reset-pin.php                         (lists the members)
 *   php tools/reset-pin.php "<name or ID>" <new PIN>
 *
 * Docker:  docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Alex" 2468
 * The new PIN: 4 to 8 digits, not 0000. Afterwards sign in to the app with it and choose
 * one of your own under Settings → Account.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

$root = realpath(__DIR__ . '/..');
require $root . '/api/auth.php';

function out(string $s): void { fwrite(STDOUT, $s . "\n"); }
function bail(string $s): never { fwrite(STDERR, $s . "\n"); exit(1); }

$store = family_store();
$members = array_values(array_filter($store['records'] ?? [], fn ($r) => is_array($r) && ($r['_kind'] ?? '') === 'member' && !($r['deleted'] ?? false)));
if (!$members) {
    bail('No members found – is this the right folder? (expected: ' . DATA_DIR . ')');
}

$who = $argv[1] ?? '';
$pin = $argv[2] ?? '';
if ($who === '') {
    out('Members:');
    foreach ($members as $m) {
        out(sprintf('  %-24s %-8s %s', (string) ($m['name'] ?? '?'), ($m['role'] ?? '') === 'admin' ? 'Admin' : 'Member', (string) $m['id']));
    }
    out('');
    out('Set a new PIN: php tools/reset-pin.php "<name or ID>" <new PIN>');
    exit(0);
}

$lower = static fn (string $s): string => function_exists('mb_strtolower') ? mb_strtolower($s) : strtolower($s);
$hits = array_values(array_filter($members, fn ($m) => ($m['id'] ?? '') === $who || $lower((string) ($m['name'] ?? '')) === $lower($who)));
if (count($hits) !== 1) {
    bail(count($hits) ? "“{$who}” is not unique – please give the ID (call without arguments to list the members)." : "No member “{$who}” found.");
}
if (!valid_new_pin($pin)) {
    bail('The new PIN must have 4 to 8 digits and must not be 0000.');
}

$member = $hits[0];
$id = (string) $member['id'];
set_member_pin_hash($id, pin_hash($id, $pin));
fails_reset($id);
sessions_delete_user($id);

// Run as root (e.g. docker exec without -u): give the files back to the web server.
if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
    $owner = fileowner(DATA_DIR);
    $group = filegroup(DATA_DIR);
    foreach ([area_path('family', 'family', null)] as $f) {
        if (is_file($f)) { @chown($f, $owner); @chgrp($f, $group); }
    }
}

out(sprintf('PIN for “%s” has been reset. All sessions of this person have ended.', (string) ($member['name'] ?? $id)));
out('Now sign in to the app with the new PIN and choose your own under Settings → Account.');
