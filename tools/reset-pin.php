<?php
/**
 * reset-pin.php — PIN eines Mitglieds auf dem Server neu setzen (Kommandozeile).
 *
 * Für den Notfall, dass die einzige Admin-Person ihre PIN vergessen hat – in der App
 * setzt sonst eine Admin-Person fremde PINs. Wer den Server betreibt, hat ohnehin
 * Zugriff auf data/; dieses Werkzeug ändert nur die PIN, beendet die Sitzungen der
 * Person und löscht ihre Fehlversuche.
 *
 *   php tools/reset-pin.php                         (listet die Mitglieder)
 *   php tools/reset-pin.php "<Name oder ID>" <neue PIN>
 *
 * Docker:  docker exec -it -u www-data cat-o-fit php tools/reset-pin.php "Alex" 2468
 * Die neue PIN: 4 bis 8 Ziffern, nicht 0000. Danach in der App damit anmelden und unter
 * Einstellungen → Konto eine eigene wählen.
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
    bail('Keine Mitglieder gefunden – ist das der richtige Ordner? (erwartet: ' . DATA_DIR . ')');
}

$who = $argv[1] ?? '';
$pin = $argv[2] ?? '';
if ($who === '') {
    out('Mitglieder:');
    foreach ($members as $m) {
        out(sprintf('  %-24s %-8s %s', (string) ($m['name'] ?? '?'), ($m['role'] ?? '') === 'admin' ? 'Admin' : 'Mitglied', (string) $m['id']));
    }
    out('');
    out('Neue PIN setzen: php tools/reset-pin.php "<Name oder ID>" <neue PIN>');
    exit(0);
}

$lower = static fn (string $s): string => function_exists('mb_strtolower') ? mb_strtolower($s) : strtolower($s);
$hits = array_values(array_filter($members, fn ($m) => ($m['id'] ?? '') === $who || $lower((string) ($m['name'] ?? '')) === $lower($who)));
if (count($hits) !== 1) {
    bail(count($hits) ? "„{$who}“ ist nicht eindeutig – bitte die ID angeben (ohne Argumente aufrufen)." : "Kein Mitglied „{$who}“ gefunden.");
}
if (!valid_new_pin($pin)) {
    bail('Die neue PIN muss 4 bis 8 Ziffern haben und darf nicht 0000 sein.');
}

$member = $hits[0];
$id = (string) $member['id'];
set_member_pin_hash($id, pin_hash($id, $pin));
fails_reset($id);
sessions_delete_user($id);

// Als root ausgeführt (z. B. docker exec ohne -u): Dateien wieder dem Webserver geben.
if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
    $owner = fileowner(DATA_DIR);
    $group = filegroup(DATA_DIR);
    foreach ([area_path('family', 'family', null)] as $f) {
        if (is_file($f)) { @chown($f, $owner); @chgrp($f, $group); }
    }
}

out(sprintf('PIN für „%s“ neu gesetzt. Alle Sitzungen dieser Person sind beendet.', (string) ($member['name'] ?? $id)));
out('Jetzt in der App mit der neuen PIN anmelden und unter Einstellungen → Konto eine eigene wählen.');
