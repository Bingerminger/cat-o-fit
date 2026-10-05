<?php
/**
 * health-import.php — import of an Apple Health export.
 *
 * Included by api.php for POST ?action=health-import.
 *
 * Flow:
 *   1. Accept the file upload (export.xml OR the Health export ZIP).
 *   2. For a ZIP: stream export.xml out (ZipArchive, if available).
 *   3. Stream export.xml with XMLReader (NOT SimpleXML – the file can
 *      be hundreds of MB).
 *   4. Extract the relevant data:
 *        - running workouts         -> candidates for completed sessions
 *        - weight/body fat/...      -> candidates for the health log (per day)
 *        - sleep analysis           -> sleep hours per night (aggregated)
 *   5. Return normalised candidates as JSON. De-duplicating against
 *      the local data and adopting them happens "local-first" in the client
 *      (health-import.js), so that LocalStorage remains the leading source.
 *
 * The functions respond()/fail() and $session come from api.php (already loaded).
 */

declare(strict_types=1);

@set_time_limit(0);

// Upper limits against "ZIP bombs" (tiny file, huge content): a genuine
// export.xml from many years is several GB and compresses by roughly 10 to 30 times.
const HX_MAX_XML_BYTES = 6 * 1024 * 1024 * 1024;   // 6 GiB unpacked
const HX_MAX_RATIO = 200;                          // unpacked / packed
const HX_DISK_RESERVE = 256 * 1024 * 1024;         // this much must remain free afterwards

// Never load external entities (XXE), even on older libxml versions.
libxml_set_external_entity_loader(static fn() => null);

if (!class_exists('XMLReader')) {
    fail('The XMLReader extension is missing on the server.', 500, 'xmlreader_missing');
}

// ---------------------------------------------------------------------------
// 1) Determine the upload.
// ---------------------------------------------------------------------------
if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    fail('No file received (expected field "file").', 400, 'no_file');
}

$uploadTmp  = $_FILES['file']['tmp_name'];
$uploadName = (string) ($_FILES['file']['name'] ?? 'upload');
$xmlPath    = $uploadTmp;
$cleanup    = [];

// ---------------------------------------------------------------------------
// 2) ZIP detection and unpacking of export.xml.
// ---------------------------------------------------------------------------
$isZip = preg_match('/\.zip$/i', $uploadName) === 1;
if (!$isZip) {
    // Check magic bytes ("PK\x03\x04").
    $fh = fopen($uploadTmp, 'rb');
    if ($fh) {
        $sig = fread($fh, 4);
        fclose($fh);
        if ($sig === "PK\x03\x04") {
            $isZip = true;
        }
    }
}

if ($isZip) {
    if (!class_exists('ZipArchive')) {
        fail('ZIP upload detected, but ZipArchive is not available on the server. '
           . 'Please unzip the archive locally and upload only the file export.xml.', 500, 'zip_unavailable');
    }
    $zip = new ZipArchive();
    if ($zip->open($uploadTmp) !== true) {
        fail('The ZIP could not be opened.', 400, 'zip_unreadable');
    }
    // Find export.xml in the archive (usually under apple_health_export/export.xml).
    $entry = null;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name !== false && preg_match('#(^|/)export\.xml$#i', $name)) {
            $entry = $name;
            break;
        }
    }
    if ($entry === null) {
        $zip->close();
        fail('No export.xml found in the ZIP.', 400, 'zip_no_export');
    }
    // Check the declared size up front (limit and compression ratio) – while unpacking, the
    // actual content counts as well, in case the archive's figures are wrong.
    $stat = $zip->statName($entry);
    $declared = is_array($stat) ? (int) ($stat['size'] ?? 0) : 0;
    $packed = is_array($stat) ? max(1, (int) ($stat['comp_size'] ?? 0)) : 1;
    if ($declared > HX_MAX_XML_BYTES || $declared / $packed > HX_MAX_RATIO) {
        $zip->close();
        fail('The export.xml in the archive is implausibly large – import cancelled.', 413, 'export_too_large');
    }
    $free = @disk_free_space(sys_get_temp_dir());
    if ($free !== false && $declared + HX_DISK_RESERVE > $free) {
        $zip->close();
        fail('There is not enough space on the server to unpack the export.', 507, 'disk_full');
    }
    $extracted = tempnam(sys_get_temp_dir(), 'hx_');
    $cleanup[] = $extracted;
    $stream = $zip->getStream($entry);
    if ($stream === false) {
        $zip->close();
        foreach ($cleanup as $f) { @unlink($f); }
        fail('export.xml could not be read.', 500, 'export_unreadable');
    }
    $out = fopen($extracted, 'wb');
    $written = 0;
    $tooBig = false;
    while (!feof($stream)) {
        $chunk = fread($stream, 1 << 20);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $written += strlen($chunk);
        if ($written > HX_MAX_XML_BYTES || $written / $packed > HX_MAX_RATIO * 1.05) {
            $tooBig = true;
            break;
        }
        fwrite($out, $chunk);
    }
    fclose($out);
    fclose($stream);
    $zip->close();
    if ($tooBig) {
        foreach ($cleanup as $f) { @unlink($f); }
        fail('The export.xml in the archive is implausibly large – import cancelled.', 413, 'export_too_large');
    }
    $xmlPath = $extracted;
}


// ---------------------------------------------------------------------------
// 3) Evaluate (pure logic in health-xml.php, which also handles units, sleep and dates)
//    and return candidates. De-duplication happens in the client.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/health-xml.php';

try {
    // Session titles in the language of the signed-in person (who sees the import).
    $parsed = hx_parse_file($xmlPath, person_language($session['user'] ?? null));
} catch (RuntimeException $e) {
    foreach ($cleanup as $f) { @unlink($f); }
    fail($e->getMessage(), 500, 'export_open_failed');
}
foreach ($cleanup as $f) { @unlink($f); }

respond([
    'ok' => true,
    'summary' => [
        'workouts'    => count($parsed['workouts']),
        'healthDays'  => count($parsed['health']),
        'sleepNights' => $parsed['sleepNights'],
        'periods'     => count($parsed['periods'] ?? []),
    ],
    'workouts' => $parsed['workouts'],
    'health'   => $parsed['health'],
    // Cycle only for adoption into the person's own private area – the app asks first.
    'periods'  => $parsed['periods'] ?? [],
]);
